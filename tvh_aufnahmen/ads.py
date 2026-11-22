"""Werbung erkennen mit comskip (Debian-Paket „comskip“).

Die Hintergrundaufgabe nimmt sich jede Minute höchstens eine fertige Aufnahme vor – mit niedrigster Priorität
(nice/ionice), immer nur eine zugleich. Automatisch werden nur Aufnahmen der letzten AUTO_DAYS Tage untersucht,
ältere auf Wunsch. Ergebnis je Aufnahme: Werbeblöcke in Sekunden ab Dateianfang, die Dateilänge und der
Versatz des ersten Videobilds (für Avidemux, das ab dem Dateianfang zählt). Die Aufnahmen selbst bleiben
unverändert; comskip schreibt nur in den Cache-Ordner.

Gespeichert werden die Blöcke so, wie comskip sie findet. Der Zeitversatz aus den Einstellungen (Beginn und Ende
je eigens, in Sekunden) wird erst bei der Ausgabe angewendet – so wirkt eine Änderung sofort auf alle Aufnahmen.
Er gleicht aus, dass Sender ihr Logo oft schon ein paar Sekunden vor der Werbung ausblenden und danach eine
Programmvorschau mit Logo zeigen, die comskip zur Sendung zählt. Betriebsart: auto (neue Aufnahmen von selbst),
manual (nur auf Wunsch) oder off (keine Erkennung, keine Anzeige)."""
import json
import os
import shutil
import subprocess
import threading
import time

from .i18n import _

DIR = os.path.expanduser('~/.cache/tvh-aufnahmen/werbung')
AUTO_DAYS = 30
MODES = ('auto', 'manual', 'off')
MAX_SHIFT = 120  # Sekunden Zeitversatz höchstens
INI = """detect_method=111
verbose=0
output_edl=1
output_txt=0
output_default=0
output_framearray=0
live_tv=0
thread_count=4
"""


def probe(path):
    """Länge der Datei, Versatz des ersten Videobilds gegenüber dem Dateianfang (Sekunden) und der Zeitstempel
    des Dateianfangs (für next_keyframe)."""
    try:
        out = subprocess.run(['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_entries',
                              'format=start_time,duration:stream=codec_type,start_time', path],
                             capture_output=True, text=True, timeout=120).stdout
        d = json.loads(out or '{}')
        start = float(d.get('format', {}).get('start_time') or 0)
        video = next((float(s['start_time']) for s in d.get('streams', [])
                      if s.get('codec_type') == 'video' and s.get('start_time')), start)
        return float(d.get('format', {}).get('duration') or 0), max(0.0, video - start), start
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0.0, 0.0, 0.0


def next_keyframe(path, t, base):
    """Erstes Schlüsselbild ab t (Sekunden ab Dateianfang). Avidemux schneidet im Kopiermodus nur an
    Schlüsselbildern sauber – sonst fragt es nach und das Bild ist an der Schnittstelle gestört."""
    try:
        out = subprocess.run(['ffprobe', '-v', 'quiet', '-select_streams', 'v:0', '-read_intervals',
                              '%.3f%%+6' % max(0.0, base + t - 1), '-show_entries', 'packet=pts_time,flags',
                              '-of', 'csv=p=0', path], capture_output=True, text=True, timeout=60).stdout
        keys = sorted(float(p) - base for p, f in (l.split(',')[:2] for l in out.splitlines() if l.count(',') >= 1)
                      if 'K' in f and p not in ('', 'N/A') and float(p) - base >= t - 0.001)
        return keys[0] if keys else t
    except (OSError, ValueError, subprocess.SubprocessError):
        return t


def shifted(ads, duration, start, end):
    """Werbeblöcke mit Zeitversatz. Ein Block ab Dateianfang bzw. bis Dateiende bleibt dort verankert."""
    out = []
    for a, b in ads:
        a2 = a if a <= 1 else max(0.0, a + start)
        b2 = b if duration and b >= duration - 1 else (min(duration, b + end) if duration else b + end)
        if b2 - a2 > 1:
            out.append([round(a2, 2), round(b2, 2)])
    return out


def cut_list(path, ads, duration, offset, base):
    """Teile ohne Werbung für Avidemux in Mikrosekunden: [[Anfang, Länge], …], jeder Anfang auf einem
    Schlüsselbild. Gezählt ab dem ersten Schlüsselbild – wo das bei Avidemux liegt, liest das Projektskript selbst
    aus (getTimeOffsetForSegment), denn Avidemux legt den Nullpunkt anders als ffprobe."""
    first = next_keyframe(path, offset, base)
    end, keep, t = max(0.0, duration - offset), [], 0.0
    for a, b in ads:
        if a > t + 1:
            keep.append([t, a])
        t = max(t, b)
    if end > t + 1:
        keep.append([t, end])
    out = []
    for a, b in keep:
        start = next_keyframe(path, a + offset, base)
        if b + offset - start > 1:
            out.append([round((start - first) * 1e6), round((b + offset - start) * 1e6)])
    return out


def read_edl(path):
    """comskip-EDL: je Zeile „Anfang Ende 0“ in Sekunden."""
    blocks = []
    try:
        with open(path) as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    a, b = float(parts[0]), float(parts[1])
                    if b > a:
                        blocks.append([round(a, 2), round(b, 2)])
    except (OSError, ValueError):
        pass
    return blocks


class Ads:
    def __init__(self, app):
        self.app = app
        self.lock = threading.Lock()
        self.proc = None  # (uuid, Popen, Arbeitsordner, Dateiname, auf Wunsch?)
        self.wanted = []  # auf Wunsch vorgezogene Aufnahmen (übersteht einen Neustart, siehe save_wanted)
        os.makedirs(DIR, exist_ok=True)
        with open(os.path.join(DIR, 'comskip.ini'), 'w') as f:
            f.write(INI)
        try:
            with open(os.path.join(DIR, 'wanted.json')) as f:
                self.wanted = json.load(f)
        except (OSError, ValueError):
            pass
        self.results = {}
        for name in os.listdir(DIR):
            if name.endswith('.json') and name != 'wanted.json':
                try:
                    with open(os.path.join(DIR, name)) as f:
                        self.results[name[:-5]] = json.load(f)
                except (OSError, ValueError):
                    pass

    def save_wanted(self):
        with open(os.path.join(DIR, 'wanted.json'), 'w') as f:
            json.dump(self.wanted, f)

    @staticmethod
    def available():
        return bool(shutil.which('comskip'))

    def settings(self):
        cfg = self.app.cfg
        mode = cfg.get('ads_mode') if cfg.get('ads_mode') in MODES else ('auto' if cfg.get('ads', True) else 'manual')
        return {'mode': mode, 'start': float(cfg.get('ads_start') or 0), 'end': float(cfg.get('ads_end') or 0)}

    def blocks(self, r):
        s = self.settings()
        return shifted(r.get('ads', []), r.get('duration', 0), s['start'], s['end'])

    def summary(self):
        """Für die Oberfläche: je Aufnahme Werbeblöcke (mit Zeitversatz), dazu was gerade läuft und was wartet.
        Bei „off“ bleibt die Liste leer – dann zeigt die Oberfläche nichts zur Werbung."""
        s = self.settings()
        with self.lock:
            running = self.proc[0] if self.proc else None
            return dict(s, comskip=self.available(), available=self.available() and s['mode'] != 'off',
                        running=running, wanted=list(self.wanted),
                        results={} if s['mode'] == 'off' else
                        {u: {'ads': self.blocks(r), 'error': r.get('error')} for u, r in self.results.items()})

    def configure(self, req):
        mode = req.get('mode')
        if mode not in MODES:
            raise ValueError(_('srv.bad_mode'))
        try:
            start, end = float(req.get('start') or 0), float(req.get('end') or 0)
        except (TypeError, ValueError):
            raise ValueError(_('srv.ads_shift', n=MAX_SHIFT))
        if abs(start) > MAX_SHIFT or abs(end) > MAX_SHIFT:
            raise ValueError(_('srv.ads_shift', n=MAX_SHIFT))
        self.app.save(dict(self.app.cfg, ads_mode=mode, ads_start=start, ads_end=end))
        if mode == 'off':
            self.stop()
        return self.summary()

    def stop(self):
        with self.lock:
            if self.proc:
                self.proc[1].terminate()
                self.proc = None

    def cuts(self, uuid):
        """Teile ohne Werbung für Avidemux – mit dem aktuellen Zeitversatz, Schnitte auf Schlüsselbildern."""
        r = self.results.get(uuid)
        if not r:
            raise ValueError(_('srv.ads_none'))
        fn = (self.app.tvh.call('idnode/load', uuid=uuid).get('entries') or [{}])[0]
        fn = next((p.get('value') for p in fn.get('params', []) if p['id'] == 'filename'), '')
        if not os.path.isfile(fn or ''):
            raise ValueError(_('srv.file_not_found'))
        duration, offset, base = probe(fn)
        return {'cuts': cut_list(fn, self.blocks(r), duration, offset, base)}

    def request(self, uuid):
        if self.settings()['mode'] == 'off':
            raise ValueError(_('srv.ads_off'))
        with self.lock:
            self.results.pop(uuid, None)
            try:
                os.remove(os.path.join(DIR, uuid + '.json'))
            except OSError:
                pass
            if uuid not in self.wanted and not (self.proc and self.proc[0] == uuid and self.proc[4]):
                self.wanted.append(uuid)
                self.save_wanted()
        return self.summary()

    def step(self):
        """Läuft comskip, nur nachsehen; sonst die nächste Aufnahme beginnen. Wartet eine gewünschte Aufnahme,
        wird eine automatische Untersuchung abgebrochen – sie kommt später von vorn wieder dran."""
        if not self.available() or self.settings()['mode'] == 'off':
            return
        with self.lock:
            if self.proc:
                uuid, p, work, fn, wanted = self.proc
                if p.poll() is None:
                    if not (self.wanted and not wanted):
                        return
                    p.terminate()
                    p.wait(timeout=30)
                    self.proc, uuid = None, None
                else:
                    self.proc = None
            else:
                uuid = None
        if uuid:
            self.finish(uuid, p.returncode, work, fn)
            return
        uuid, fn, wanted = self.next()
        if not uuid:
            return
        work = os.path.join(DIR, 'arbeit')
        shutil.rmtree(work, ignore_errors=True)
        os.makedirs(work)
        cmd = ['nice', '-n', '19', 'ionice', '-c', '3', 'comskip', '--ini=' + os.path.join(DIR, 'comskip.ini'),
               '--output=' + work, fn]
        with self.lock:
            self.proc = (uuid, subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL), work, fn,
                         wanted)

    def next(self):
        entries = self.app.tvh.call('dvr/entry/grid_finished', limit=100000).get('entries', [])
        by_uuid = {e['uuid']: e for e in entries}
        with self.lock:
            while self.wanted:
                u = self.wanted.pop(0)
                self.save_wanted()
                e = by_uuid.get(u)
                if e and os.path.isfile(e.get('filename') or ''):
                    return u, e['filename'], True
            done = set(self.results)
        if self.settings()['mode'] != 'auto':
            return None, None, False
        since = time.time() - AUTO_DAYS * 86400
        for e in sorted(entries, key=lambda e: -(e.get('start') or 0)):
            if e['uuid'] in done or (e.get('start') or 0) < since:
                continue
            if os.path.isfile(e.get('filename') or ''):
                return e['uuid'], e['filename'], False
        return None, None, False

    def finish(self, uuid, code, work, fn):
        edl = next((os.path.join(work, n) for n in os.listdir(work) if n.endswith('.edl')), None) if os.path.isdir(work) else None
        duration, offset = probe(fn)[:2]
        ads = read_edl(edl) if edl else []
        res = {'at': int(time.time()), 'duration': duration, 'offset': offset, 'ads': ads}
        if code not in (0, 1) and not edl:  # comskip endet mit 1, wenn es keine Werbung findet
            res['error'] = 'comskip %s' % code
        with open(os.path.join(DIR, uuid + '.json'), 'w') as f:
            json.dump(res, f)
        shutil.rmtree(work, ignore_errors=True)
        with self.lock:
            self.results[uuid] = res
