"""Werbung erkennen mit comskip (Debian-Paket „comskip“).

Die Hintergrundaufgabe nimmt sich jede Minute höchstens eine fertige Aufnahme vor – mit niedrigster Priorität
(nice/ionice), immer nur eine zugleich. Automatisch werden nur Aufnahmen der letzten AUTO_DAYS Tage untersucht,
ältere auf Wunsch. Ergebnis je Aufnahme: Werbeblöcke in Sekunden ab Dateianfang, die Dateilänge und der
Versatz des ersten Videobilds (für Avidemux, das ab dem Dateianfang zählt). Die Aufnahmen selbst bleiben
unverändert; comskip schreibt nur in den Cache-Ordner."""
import json
import os
import shutil
import subprocess
import threading
import time

DIR = os.path.expanduser('~/.cache/tvh-aufnahmen/werbung')
AUTO_DAYS = 30
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

    def summary(self):
        """Für die Oberfläche: je Aufnahme Werbeblöcke, dazu was gerade läuft und was noch wartet."""
        with self.lock:
            running = self.proc[0] if self.proc else None
            return {'available': self.available(), 'enabled': self.app.cfg.get('ads', True), 'running': running,
                    'wanted': list(self.wanted),
                    'results': {u: {'ads': r.get('ads', []), 'cuts': r.get('cuts', []), 'error': r.get('error')}
                                for u, r in self.results.items()}}

    def set_enabled(self, on):
        self.app.save(dict(self.app.cfg, ads=bool(on)))
        return self.summary()

    def request(self, uuid):
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
        if not self.available():
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
        since = time.time() - AUTO_DAYS * 86400
        for e in sorted(entries, key=lambda e: -(e.get('start') or 0)):
            if e['uuid'] in done or (e.get('start') or 0) < since:
                continue
            if os.path.isfile(e.get('filename') or ''):
                return e['uuid'], e['filename'], False
        return None, None, False

    def finish(self, uuid, code, work, fn):
        edl = next((os.path.join(work, n) for n in os.listdir(work) if n.endswith('.edl')), None) if os.path.isdir(work) else None
        duration, offset, base = probe(fn)
        ads = read_edl(edl) if edl else []
        res = {'at': int(time.time()), 'duration': duration, 'offset': offset, 'ads': ads,
               'cuts': cut_list(fn, ads, duration, offset, base) if ads else []}
        if code not in (0, 1) and not edl:  # comskip endet mit 1, wenn es keine Werbung findet
            res['error'] = 'comskip %s' % code
        with open(os.path.join(DIR, uuid + '.json'), 'w') as f:
            json.dump(res, f)
        shutil.rmtree(work, ignore_errors=True)
        with self.lock:
            self.results[uuid] = res
