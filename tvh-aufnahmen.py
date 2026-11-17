#!/usr/bin/env python3
"""tvh-aufnahmen: Web-Oberfläche, um TVHeadend-Aufnahmen zu verwalten – anzeigen,
suchen, herunterladen, Datei ersetzen und löschen –, Videodateien wieder als
Aufnahmen einzutragen und Einträge zu bereinigen, deren Datei nicht mehr existiert.

Läuft direkt auf dem OSMC-Gerät (Python 3, nur Standardbibliothek).
Getestet gegen die API von TVHeadend 4.3.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VIDEO_EXT = {'.ts', '.mkv', '.mp4', '.m2ts', '.mpg', '.mpeg', '.avi', '.mov'}
DEFAULT_DURATION = 90 * 60
DATE_RE = re.compile(r'(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?:[ T_.-]{0,1}(\d{2})[-_.:h]?(\d{2}))?(?:-\d{1,2}(?!\d))?')
UNKNOWN_CHANNEL = 'Unbekannt'


class Utf8DigestAuthHandler(urllib.request.HTTPDigestAuthHandler):
    """Wie HTTPDigestAuthHandler, aber mit UTF-8 statt ASCII – sonst scheitern
    Benutzer oder Passwörter mit Umlauten."""
    ALGOS = {'MD5': hashlib.md5, 'SHA': hashlib.sha1, 'SHA-256': hashlib.sha256}

    def get_algorithm_impls(self, algorithm):
        algo = self.ALGOS.get(algorithm.upper())
        if algo is None:
            raise ValueError('Nicht unterstütztes Digest-Verfahren: %r' % algorithm)
        H = lambda x: algo(x.encode('utf-8')).hexdigest()
        KD = lambda s, d: H('%s:%s' % (s, d))
        return H, KD


class Tvh:
    def __init__(self, url, user, password):
        self.url = url.rstrip('/')
        handlers = []
        if user:
            mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
            mgr.add_password(None, self.url, user, password or '')
            handlers += [Utf8DigestAuthHandler(mgr),
                         urllib.request.HTTPBasicAuthHandler(mgr)]
        self.opener = urllib.request.build_opener(*handlers)

    def call(self, path, **params):
        data = urllib.parse.urlencode(params).encode()
        with self.opener.open(self.url + '/api/' + path, data=data, timeout=60) as r:
            body = r.read().decode('utf-8', 'replace')
        return json.loads(body) if body.strip() else {}

    def entries(self):
        seen = {}
        for grid in ('grid', 'grid_finished', 'grid_failed', 'grid_removed'):
            try:
                res = self.call('dvr/entry/' + grid, limit=100000)
            except urllib.error.HTTPError:
                continue
            for e in res.get('entries', []):
                seen[e['uuid']] = e
        return list(seen.values())

    def channels(self):
        res = self.call('channel/grid', limit=100000)
        chans = [{'uuid': c['uuid'], 'name': c.get('name', '')} for c in res.get('entries', [])]
        return sorted(chans, key=lambda c: c['name'].lower())


_duration_cache = {}


def probe_duration(path, mtime):
    """Laufzeit per ffprobe, falls installiert; sonst None."""
    key = (path, mtime)
    if key in _duration_cache:
        return _duration_cache[key]
    dur = None
    if shutil.which('ffprobe'):
        try:
            out = subprocess.run(
                ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                 '-of', 'default=nw=1:nk=1', path],
                capture_output=True, text=True, timeout=20).stdout.strip()
            dur = int(float(out)) if out else None
        except (subprocess.SubprocessError, ValueError):
            pass
    _duration_cache[key] = dur
    return dur


def suggest(path, st):
    """Titel, Start und Ende aus Dateiname, Änderungszeit und Laufzeit raten."""
    name = os.path.splitext(os.path.basename(path))[0]
    duration = probe_duration(path, st.st_mtime)
    start = None
    m = DATE_RE.search(name)
    if m:
        y, mo, d, h, mi = m.groups()
        try:
            start = datetime(int(y), int(mo), int(d), int(h or 0), int(mi or 0)).timestamp()
            name = name[:m.start()] + ' ' + name[m.end():]
        except ValueError:
            start = None
    title = re.sub(r'[_]+', ' ', name)
    title = re.sub(r'\s+', ' ', title).strip(' -._')
    mtime = st.st_mtime
    if start is None:
        stop = mtime
        start = stop - (duration or DEFAULT_DURATION)
    elif duration:
        stop = start + duration
    elif start < mtime < start + 6 * 3600:
        stop = mtime
    else:
        stop = start + DEFAULT_DURATION
    return {'title': title or os.path.basename(path), 'start': int(start), 'stop': int(stop),
            'duration_known': duration is not None}


def scan(recdir):
    for root, _dirs, files in os.walk(recdir):
        for f in files:
            if os.path.splitext(f)[1].lower() in VIDEO_EXT:
                yield os.path.join(root, f)


def file_exists(fn):
    return bool(fn) and os.path.isfile(fn)


def build_state(tvh, recdir):
    now = time.time()
    entries = tvh.entries()
    known = {os.path.realpath(e['filename']) for e in entries if e.get('filename')}

    # Sender-Vorschlag: der häufigste Sender anderer Aufnahmen im selben Ordner
    dir_channels = {}
    for e in entries:
        if e.get('filename') and e.get('channelname'):
            counts = dir_channels.setdefault(os.path.dirname(e['filename']), {})
            counts[e['channelname']] = counts.get(e['channelname'], 0) + 1

    unknown = []
    for path in sorted(scan(recdir)):
        if os.path.realpath(path) in known:
            continue
        st = os.stat(path)
        sug = suggest(path, st)
        counts = dir_channels.get(os.path.dirname(path))
        sug['channelname'] = max(counts, key=counts.get) if counts else ''
        unknown.append({'path': path, 'rel': os.path.relpath(path, recdir), 'size': st.st_size,
                        'mtime': int(st.st_mtime), 'suggest': sug})

    by_name = {}
    for u in unknown:
        by_name.setdefault(os.path.basename(u['path']), []).append(u['path'])

    missing = []
    for e in entries:
        # Geplante und laufende Aufnahmen haben noch keine Datei – nicht anfassen.
        if e.get('stop', 0) > now or e.get('sched_status') in ('scheduled', 'recording'):
            continue
        fn = e.get('filename') or ''
        if file_exists(fn):
            continue
        cands = by_name.get(os.path.basename(fn), []) if fn else []
        missing.append({'uuid': e['uuid'], 'title': e.get('disp_title') or '',
                        'subtitle': e.get('disp_subtitle') or '',
                        'channel': e.get('channelname') or '', 'start': e.get('start', 0),
                        'status': e.get('status') or '', 'filename': fn,
                        'candidate': cands[0] if len(cands) == 1 else None})
    missing.sort(key=lambda m: m['start'], reverse=True)

    recordings = []
    for e in entries:
        fn = e.get('filename') or ''
        if e.get('sched_status') in ('scheduled', 'recording') or not file_exists(fn):
            continue
        rel = os.path.relpath(fn, recdir) if fn.startswith(recdir + os.sep) else fn
        recordings.append({'uuid': e['uuid'], 'title': e.get('disp_title') or '',
                           'subtitle': e.get('disp_subtitle') or '',
                           'description': e.get('disp_description') or '',
                           'channel': e.get('channelname') or '', 'start': e.get('start', 0),
                           'stop': e.get('stop', 0), 'status': e.get('status') or '',
                           'rel': rel, 'size': os.path.getsize(fn)})
    recordings.sort(key=lambda r: r['start'], reverse=True)

    return {'recdir': recdir, 'recordings': recordings, 'unknown': unknown, 'missing': missing,
            'channels': tvh.channels(), 'known_count': len(entries)}


def entry_info(tvh, uuid):
    res = tvh.call('idnode/load', uuid=uuid)
    if not res.get('entries'):
        raise ValueError('Aufnahme nicht gefunden')
    return {p['id']: p.get('value') for p in res['entries'][0]['params']}


def file_moved(tvh, src, dst):
    # TVHeadend 4.3 übernimmt den neuen Pfad, antwortet aber trotzdem mit 404.
    try:
        tvh.call('dvr/entry/filemoved', src=src, dst=dst)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise


def do_import(tvh, recdir, lang, req):
    path = req['path']
    real = os.path.realpath(path)
    if not real.startswith(os.path.realpath(recdir) + os.sep) or not os.path.isfile(real):
        raise ValueError('Datei nicht gefunden oder außerhalb des Aufnahmeverzeichnisses')
    start, stop = int(req['start']), int(req['stop'])
    if stop <= start:
        raise ValueError('Ende muss nach dem Start liegen')
    if stop >= time.time():
        raise ValueError('Ende muss in der Vergangenheit liegen, sonst entsteht ein Aufnahme-Timer')
    title = (req.get('title') or '').strip()
    if not title:
        raise ValueError('Titel fehlt')
    conf = {'enabled': True, 'start': start, 'stop': stop, 'title': {lang: title},
            'comment': (req.get('comment') or 'nachträglich importiert').strip(),
            'files': [{'filename': path}]}
    for key in ('subtitle', 'description'):
        val = (req.get(key) or '').strip()
        if val:
            conf[key] = {lang: val}
    if req.get('channel'):
        conf['channel'] = req['channel']
    # Ohne Sender legt TVHeadend stillschweigend nichts an (Antwort 200 mit leerem {}).
    conf['channelname'] = (req.get('channelname') or '').strip() or UNKNOWN_CHANNEL
    res = tvh.call('dvr/entry/create', conf=json.dumps(conf))
    if not res.get('uuid'):
        raise ValueError('TVHeadend hat den Eintrag nicht angelegt: ' + os.path.basename(path))
    return res


def do_delete(tvh, uuids):
    entries = {e['uuid']: e for e in tvh.entries()}
    now = time.time()
    safe = []
    for u in uuids:
        e = entries.get(u)
        # Nur löschen, wenn die Datei wirklich fehlt – sonst würde TVHeadend sie mitlöschen.
        if e and e.get('stop', 0) < now and not file_exists(e.get('filename')):
            safe.append(u)
    if safe:
        tvh.call('idnode/delete', uuid=json.dumps(safe))
    return {'deleted': len(safe), 'skipped': len(uuids) - len(safe)}


def do_move(tvh, moves):
    done = 0
    for m in moves:
        if file_exists(m['src']) or not file_exists(m['dst']):
            continue
        file_moved(tvh, m['src'], m['dst'])
        done += 1
    return {'moved': done, 'skipped': len(moves) - done}


# Felder, die beim Neuanlegen eines Eintrags (Beschreibung ändern) übernommen werden
COPY_FIELDS = ('channel', 'channelname', 'start', 'stop', 'start_extra', 'stop_extra', 'comment',
               'config_name', 'owner', 'creator', 'pri', 'retention', 'removal', 'summary',
               'genre', 'image', 'fanart_image', 'copyright_year', 'age_rating', 'category',
               'keyword', 'credits', 'first_aired', 'content_type', 'playcount', 'playposition')


def do_edit(tvh, lang, req):
    norm = lambda s: (s or '').replace('\r\n', '\n').strip()  # Browser senden \r\n
    title = norm(req.get('title'))
    subtitle = norm(req.get('subtitle'))
    if not title:
        raise ValueError('Titel fehlt')
    info = entry_info(tvh, req['uuid'])
    desc = req.get('description')
    if desc is None or norm(desc) == norm(info.get('disp_description')):
        tvh.call('idnode/save', node=json.dumps({'uuid': req['uuid'], 'disp_title': title,
                                                 'disp_subtitle': subtitle}))
        return {'uuid': req['uuid']}
    return recreate_entry(tvh, req['uuid'], info, lang, title, subtitle, norm(desc))


def recreate_entry(tvh, uuid, info, lang, title, subtitle, desc):
    """Die Beschreibung fertiger Aufnahmen ist in TVHeadend 4.3 schreibgeschützt.
    Deshalb wird der Eintrag mit neuer Beschreibung neu angelegt. Den alten Eintrag
    zu löschen würde die Videodatei mitlöschen – daher zeigt er vorher auf einen
    leeren Platzhalter, und nur der wird mitgelöscht."""
    fn = info.get('filename')
    if not file_exists(fn):
        raise ValueError('Videodatei fehlt, Beschreibung kann nicht geändert werden')
    conf = {k: info[k] for k in COPY_FIELDS if info.get(k) not in (None, '', [], {})}
    conf.update(enabled=True, title={lang: title}, files=[{'filename': fn}])
    if subtitle:
        conf['subtitle'] = {lang: subtitle}
    if desc:
        conf['description'] = {lang: desc}
    if not conf.get('channel') and not conf.get('channelname'):
        conf['channelname'] = UNKNOWN_CHANNEL
    placeholder = fn + '.alter-eintrag'
    open(placeholder, 'wb').close()
    new = None
    try:
        file_moved(tvh, fn, placeholder)
        if entry_info(tvh, uuid).get('filename') != placeholder:
            raise ValueError('TVHeadend hat den alten Eintrag nicht umgestellt; nichts geändert')
        new = tvh.call('dvr/entry/create', conf=json.dumps(conf)).get('uuid')
        if not new:
            raise ValueError('TVHeadend hat den neuen Eintrag nicht angelegt; nichts geändert')
        tvh.call('idnode/delete', uuid=json.dumps([uuid]))
    except Exception:
        if not new:
            file_moved(tvh, placeholder, fn)  # alten Eintrag zurück auf die Videodatei
        raise
    finally:
        if os.path.exists(placeholder):
            os.remove(placeholder)
    return {'uuid': new}


def do_remove(tvh, uuids):
    """Löscht Aufnahmen samt Datei über TVHeadend."""
    if uuids:
        tvh.call('dvr/entry/remove', uuid=json.dumps(uuids))
    return {'removed': len(uuids)}


def replace_file(tvh, uuid, name, length, body):
    """Ersetzt die Datei einer Aufnahme durch den hochgeladenen Inhalt."""
    old = entry_info(tvh, uuid).get('filename')
    if not file_exists(old):
        raise ValueError('Die bisherige Datei fehlt, Ersetzen nicht möglich')
    ext = os.path.splitext(name)[1].lower()
    if ext not in VIDEO_EXT:
        raise ValueError('Keine Videodatei: ' + name)
    if length <= 0:
        raise ValueError('Leere Datei')
    if length > shutil.disk_usage(os.path.dirname(old)).free - 100 * 1024 * 1024:
        raise ValueError('Nicht genug freier Speicher für die neue Datei')
    new = os.path.splitext(old)[0] + ext
    if new != old and os.path.exists(new):
        raise ValueError('Datei existiert bereits: ' + new)
    tmp = new + '.upload'  # keine Video-Endung: taucht nicht als „nicht eingetragen“ auf
    try:
        with open(tmp, 'wb') as f:
            left = length
            while left:
                chunk = body.read(min(left, 1024 * 1024))
                if not chunk:
                    raise ValueError('Upload abgebrochen')
                f.write(chunk)
                left -= len(chunk)
        os.replace(tmp, new)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    if new != old:
        file_moved(tvh, old, new)
        if entry_info(tvh, uuid).get('filename') != new:
            raise ValueError('TVHeadend hat den neuen Pfad nicht übernommen; alte Datei bleibt erhalten')
        os.remove(old)
    return {'filename': new, 'size': length}


class App:
    """Hält die Einstellungen und speichert sie in einer JSON-Datei."""
    KEYS = ('recdir', 'tvh', 'user', 'password', 'lang')

    def __init__(self, path, cfg):
        self.path = path
        self.cfg = cfg
        self.tvh = Tvh(cfg['tvh'], cfg.get('user'), cfg.get('password'))

    def public(self):
        c = {k: self.cfg.get(k) or '' for k in self.KEYS if k != 'password'}
        c['has_password'] = bool(self.cfg.get('password'))
        c['config_file'] = self.path
        return c

    def update(self, req):
        new = dict(self.cfg)
        for k in self.KEYS:
            if k in req and (k != 'password' or req[k]):
                new[k] = (req[k] or '').strip()
        if req.get('clear_password'):
            new['password'] = ''
        new['recdir'] = os.path.abspath(new['recdir']) if new.get('recdir') else ''
        if not new['recdir'] or not os.path.isdir(new['recdir']):
            raise ValueError('Aufnahmeverzeichnis nicht gefunden: ' + (new['recdir'] or '(leer)'))
        if not re.match(r'https?://', new.get('tvh') or ''):
            raise ValueError('Server-Adresse muss mit http:// oder https:// beginnen')
        new['lang'] = new.get('lang') or 'ger'
        tvh = Tvh(new['tvh'], new.get('user'), new.get('password'))
        tvh.call('serverinfo')  # Verbindung und Login prüfen, bevor gespeichert wird
        self.cfg, self.tvh = new, tvh
        save_config(self.path, new)
        return self.public()

    @property
    def recdir(self):
        if not self.cfg.get('recdir'):
            raise ValueError('Bitte zuerst unter „Einstellungen“ das Aufnahmeverzeichnis eintragen')
        return self.cfg['recdir']


def load_config(path):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_config(path, cfg):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    tmp = path + '.tmp'
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f:
        json.dump(cfg, f, indent=2)
    os.replace(tmp, path)


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

        def send(self, code, body, ctype='application/json; charset=utf-8'):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def run(self, fn):
            try:
                result = fn()
                if result is not None:
                    self.send(200, result)
            except urllib.error.HTTPError as e:
                self.send(502, {'error': 'TVHeadend antwortet mit HTTP %d (%s)' % (e.code, e.reason)})
            except urllib.error.URLError as e:
                self.send(502, {'error': 'TVHeadend nicht erreichbar: %s' % e.reason})
            except (ValueError, KeyError, OSError) as e:
                self.close_connection = True  # evtl. ungelesener Upload
                self.send(400, {'error': str(e)})

        def download(self, uuid):
            fn = entry_info(app.tvh, uuid).get('filename')
            if not file_exists(fn):
                raise ValueError('Datei nicht gefunden')
            size = os.path.getsize(fn)
            start, end = 0, size - 1
            rng = re.match(r'bytes=(\d*)-(\d*)$', self.headers.get('Range') or '')
            if rng and (rng.group(1) or rng.group(2)):
                if rng.group(1):
                    start = int(rng.group(1))
                    end = min(int(rng.group(2)), end) if rng.group(2) else end
                else:
                    start = max(0, size - int(rng.group(2)))
                if start > end:
                    self.send_response(416)
                    self.send_header('Content-Range', 'bytes */%d' % size)
                    self.end_headers()
                    return
                self.send_response(206)
                self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
            else:
                self.send_response(200)
            name = os.path.basename(fn)
            ascii_name = name.encode('ascii', 'replace').decode().replace('"', '')
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Disposition', 'attachment; filename="%s"; filename*=UTF-8\'\'%s'
                             % (ascii_name, urllib.parse.quote(name)))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(end - start + 1))
            self.end_headers()
            try:
                with open(fn, 'rb') as f:
                    f.seek(start)
                    left = end - start + 1
                    while left:
                        chunk = f.read(min(left, 1024 * 1024))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass  # Download im Browser abgebrochen

        def playlist(self, uuid):
            """M3U-Datei, mit der VLC die Aufnahme über /api/download streamt."""
            info = entry_info(app.tvh, uuid)
            if not file_exists(info.get('filename')):
                raise ValueError('Datei nicht gefunden')
            title = ' '.join((info.get('disp_title') or 'Aufnahme').split())
            dur = max(0, (info.get('stop') or 0) - (info.get('start') or 0))
            host = self.headers.get('Host') or '%s:%d' % self.server.server_address[:2]
            body = ('#EXTM3U\n#EXTINF:%d,%s\nhttp://%s/api/download?uuid=%s\n'
                    % (dur, title, host, urllib.parse.quote(uuid))).encode()
            name = re.sub(r'[\\/:*?"<>|]', '_', title) + '.m3u'
            ascii_name = name.encode('ascii', 'replace').decode()
            self.send_response(200)
            self.send_header('Content-Type', 'audio/x-mpegurl; charset=utf-8')
            self.send_header('Content-Disposition', 'attachment; filename="%s"; filename*=UTF-8\'\'%s'
                             % (ascii_name, urllib.parse.quote(name)))
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urllib.parse.urlsplit(self.path)
            q = dict(urllib.parse.parse_qsl(url.query))
            if url.path in ('/', '/index.html'):
                self.send(200, PAGE.encode(), 'text/html; charset=utf-8')
            elif url.path == '/api/state':
                self.run(lambda: build_state(app.tvh, app.recdir))
            elif url.path == '/api/config':
                self.run(app.public)
            elif url.path == '/api/download':
                self.run(lambda: self.download(q['uuid']))
            elif url.path == '/api/playlist':
                self.run(lambda: self.playlist(q['uuid']))
            else:
                self.send(404, {'error': 'nicht gefunden'})

        def do_POST(self):
            length = int(self.headers.get('Content-Length') or 0)
            url = urllib.parse.urlsplit(self.path)
            if url.path == '/api/upload':  # Rohdaten der Datei, kein JSON
                q = dict(urllib.parse.parse_qsl(url.query))
                self.run(lambda: replace_file(app.tvh, q['uuid'], q.get('name', ''), length, self.rfile))
                return
            req = json.loads(self.rfile.read(length) or b'{}')
            if self.path == '/api/edit':
                self.run(lambda: do_edit(app.tvh, app.cfg.get('lang') or 'ger', req))
            elif self.path == '/api/remove':
                self.run(lambda: do_remove(app.tvh, req['uuids']))
            elif self.path == '/api/import':
                self.run(lambda: do_import(app.tvh, app.recdir, app.cfg.get('lang') or 'ger', req))
            elif self.path == '/api/delete':
                self.run(lambda: do_delete(app.tvh, req['uuids']))
            elif self.path == '/api/move':
                self.run(lambda: do_move(app.tvh, req['moves']))
            elif self.path == '/api/config':
                self.run(lambda: app.update(req))
            else:
                self.send(404, {'error': 'nicht gefunden'})
    return Handler


PAGE = r'''<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TVHeadend Aufnahmen</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1c2330;--muted:#6b7380;--line:#dfe3e8;--acc:#2563eb;--bad:#c0392b;--ok:#1e8a4c}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--card:#1d2128;--fg:#e6e9ee;--muted:#9aa3ad;--line:#2f353e;--acc:#5b8cff;--bad:#ff6b5b;--ok:#4cc27e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
header{padding:16px 20px;border-bottom:1px solid var(--line);background:var(--card)}
h1{margin:0;font-size:19px}.sub{color:var(--muted);font-size:13px}
nav{display:flex;gap:4px;padding:12px 20px 0}
nav button{border:1px solid var(--line);border-bottom:none;background:transparent;color:var(--fg);padding:8px 14px;border-radius:8px 8px 0 0;cursor:pointer}
nav button.on{background:var(--card);font-weight:600}
main{background:var(--card);margin:0 20px 20px;border:1px solid var(--line);border-radius:0 8px 8px 8px;padding:16px;overflow-x:auto}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase}
td.f{word-break:break-all;font-size:13px}.muted{color:var(--muted)}
.b{background:var(--acc);color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit}
.b.sec{background:transparent;color:var(--acc);border:1px solid var(--acc)}
.b.bad{background:var(--bad)}.b:disabled{opacity:.5;cursor:default}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
form.ed{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;padding:12px;background:var(--bg);border-radius:8px}
form.ed label{display:flex;flex-direction:column;font-size:12px;color:var(--muted);gap:3px}
form.ed .wide{grid-column:1/-1}
input,textarea,select{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
textarea{min-height:70px;resize:vertical}
#msg{margin:12px 20px 0;padding:10px 14px;border-radius:8px;display:none}
#msg.ok{display:block;background:color-mix(in srgb,var(--ok) 15%,transparent)}
#msg.err{display:block;background:color-mix(in srgb,var(--bad) 15%,transparent)}
th a{cursor:pointer;color:inherit;text-decoration:none}th a:hover{color:var(--acc)}th a.on{color:var(--fg)}
tr.fold td{background:var(--bg);cursor:pointer;font-weight:600}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}.seg button{border:0;background:transparent;color:var(--fg);padding:6px 12px;cursor:pointer;font:inherit}.seg button.on{background:var(--acc);color:#fff}
.tag{font-size:12px;padding:1px 6px;border-radius:4px;background:var(--bg);color:var(--muted)}
</style></head><body>
<header><h1>TVHeadend Aufnahmen</h1><div class="sub" id="info">Lade …</div></header>
<div id="msg"></div>
<nav><button id="t0" class="on" onclick="tab(0)">Aufnahmen</button>
<button id="t1" onclick="tab(1)">Nicht eingetragene Dateien</button>
<button id="t2" onclick="tab(2)">Einträge ohne Datei</button>
<button id="t3" onclick="tab(3)">Einstellungen</button></nav>
<main id="main">Lade …</main>
<datalist id="chans"></datalist>
<script>
let S=null,cur=0,Q='';
const store=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){}};
let VIEW=store('view')||'list',SORT=store('sort')||'date',DESC=(store('desc')??'1')=='1';const OPEN=new Set();
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const dtl=t=>{const d=new Date(t*1000);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())};
const fmt=t=>t?new Date(t*1000).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'}):'–';
const gb=b=>(b/1073741824).toFixed(2)+' GB';
function msg(t,ok){const m=$('#msg');m.textContent=t;m.className=ok?'ok':'err';if(ok)setTimeout(()=>m.className='',5000)}
async function api(p,body){const r=await fetch(p,body?{method:'POST',body:JSON.stringify(body)}:{});const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j}
async function load(){try{S=await api('/api/state');}catch(e){S=null;$('#info').textContent='Fehler: '+e.message;tab(3);msg(e.message);return}
 $('#info').textContent=`${S.recdir} · ${S.known_count} Einträge in TVHeadend`;
 $('#t0').textContent=`Aufnahmen (${S.recordings.length})`;
 $('#t1').textContent=`Nicht eingetragene Dateien (${S.unknown.length})`;
 $('#t2').textContent=`Einträge ohne Datei (${S.missing.length})`;
 $('#chans').innerHTML=S.channels.map(c=>`<option value="${esc(c.name)}">`).join('');render()}
function tab(n){cur=n;[0,1,2,3].forEach(k=>$('#t'+k).className=n==k?'on':'');render()}
function render(){if(cur==3)return renderConfig();if(!S){$('#main').innerHTML='<p class="muted">Keine Daten – bitte Einstellungen prüfen.</p>';return}
 [renderRecordings,renderUnknown,renderMissing][cur]()}
const mins=r=>Math.round((r.stop-r.start)/60)+' min';
const R=u=>S.recordings.find(r=>r.uuid===u);
function renderRecordings(){
 $('#main').innerHTML=`<div class="bar"><input id="q" type="search" placeholder="Suchen: Titel, Untertitel, Sender, Datei …" value="${esc(Q)}" style="flex:1;min-width:220px" oninput="Q=this.value;fillRecordings()">
 <span class="seg"><button id="v-list" onclick="setView('list')">Liste</button><button id="v-dir" onclick="setView('dir')">Ordner</button></span>
 <button class="b bad" onclick="removeSel()">Ausgewählte löschen</button>
 <label><input type="checkbox" id="allr" onchange="document.querySelectorAll('.cr').forEach(c=>c.checked=this.checked)"> alle sichtbaren</label></div>
 <p class="muted" id="rcount"></p>
 <table><thead><tr><th></th><th>${sh('title','Name')}</th><th>${sh('channel','Sender')} / ${sh('date','Datum')}</th><th>${sh('dur','Dauer')} / ${sh('size','Größe')}</th><th></th></tr></thead><tbody id="rbody"></tbody></table>`;
 fillRecordings()}
const sh=(k,t)=>`<a class="${SORT==k?'on':''}" onclick="sortBy('${k}')">${t}${SORT==k?(DESC?' ▼':' ▲'):''}</a>`;
function sortBy(k){if(SORT==k)DESC=!DESC;else{SORT=k;DESC=k=='date'||k=='size'||k=='dur'}store('sort',SORT);store('desc',DESC?'1':'0');renderRecordings()}
function setView(v){VIEW=v;store('view',v);fillRecordings()}
const folder=r=>{const i=r.rel.lastIndexOf('/');return i<0?'':r.rel.slice(0,i)};
const coll=new Intl.Collator('de',{numeric:true,sensitivity:'base'});
const KEYS={title:r=>r.title+' '+r.subtitle,channel:r=>r.channel,date:r=>r.start,dur:r=>r.stop-r.start,size:r=>r.size};
function cmp(a,b){const k=KEYS[SORT],x=k(a),y=k(b);
 const c=typeof x=='number'?x-y:coll.compare(x,y);return (DESC?-c:c)||b.start-a.start}
function toggleFolder(f){OPEN.has(f)?OPEN.delete(f):OPEN.add(f);fillRecordings()}
function fillRecordings(){const words=Q.toLowerCase().split(/\s+/).filter(Boolean);
 $('#v-list').className=VIEW=='list'?'on':'';$('#v-dir').className=VIEW=='dir'?'on':'';
 const list=S.recordings.filter(r=>{const t=(r.title+' '+r.subtitle+' '+r.channel+' '+r.rel).toLowerCase();return words.every(w=>t.includes(w))});
 list.sort(cmp);
 $('#rcount').textContent=list.length+' von '+S.recordings.length+' Aufnahmen';$('#allr').checked=false;
 if(VIEW=='list'){$('#rbody').innerHTML=list.map(recRow).join('');return}
 const groups=new Map();list.forEach(r=>{const f=folder(r);if(!groups.has(f))groups.set(f,[]);groups.get(f).push(r)});
 let gs=[...groups];const total=g=>g[1].reduce((n,r)=>n+r.size,0);
 if(SORT=='title')gs.sort((a,b)=>coll.compare(a[0],b[0])*(DESC?-1:1));
 if(SORT=='size')gs.sort((a,b)=>(total(a)-total(b))*(DESC?-1:1));
 const root=gs.filter(g=>!g[0]);gs=gs.filter(g=>g[0]);
 $('#rbody').innerHTML=gs.map(g=>{const open=OPEN.has(g[0])||words.length>0;
  return `<tr class="fold" onclick="toggleFolder(this.dataset.f)" data-f="${esc(g[0])}"><td>${open?'▾':'▸'}</td><td colspan="2">📁 ${esc(g[0])} <span class="muted">(${g[1].length})</span></td><td colspan="2"><span class="muted">${gb(total(g))}</span></td></tr>`+(open?g[1].map(recRow).join(''):'')}).join('')
  +root.flatMap(g=>g[1]).map(recRow).join('')}
const recRow=r=>`<tr><td><input type="checkbox" class="cr" value="${r.uuid}"></td>
 <td>${esc(r.title)}${r.subtitle?'<br><span class="muted">'+esc(r.subtitle.split('\n')[0])+'</span>':''}${r.status&&r.status!='Completed OK'?'<br><span class="tag">'+esc(r.status)+'</span>':''}</td>
 <td>${esc(r.channel)}<br><span class="muted">${fmt(r.start)}</span></td>
 <td>${mins(r)}<br><span class="muted">${gb(r.size)}</span></td>
 <td style="white-space:nowrap"><a class="b" style="text-decoration:none;display:inline-block" href="/api/download?uuid=${r.uuid}">Download</a>
 <a class="b sec" style="text-decoration:none;display:inline-block" href="/api/playlist?uuid=${r.uuid}" title="Öffnet die Aufnahme als Stream in VLC">Abspielen</a>
 <button class="b sec" id="eb-${r.uuid}" onclick="editRec('${r.uuid}')">Bearbeiten</button></td></tr>
 <tr id="er-${r.uuid}" hidden><td colspan="5"></td></tr>`;
function closeRec(u){$('#er-'+u).hidden=true;$('#eb-'+u).textContent='Bearbeiten';$('#eb-'+u).scrollIntoView({block:'nearest'})}
function editRec(u){const row=$('#er-'+u);if(!row.hidden)return closeRec(u);
 const r=R(u);row.hidden=false;$('#eb-'+u).textContent='Schließen';
 row.firstElementChild.innerHTML=`<form class="ed" onsubmit="event.preventDefault();saveRec('${u}',this)">
 <label class="wide">Titel<input name="title" required value="${esc(r.title)}"></label>
 <label class="wide">Untertitel / Episode<textarea name="subtitle" rows="2" style="min-height:0">${esc(r.subtitle)}</textarea></label>
 <label class="wide">Beschreibung<textarea name="description" rows="6">${esc(r.description)}</textarea></label>
 <div class="wide muted">Datei: ${esc(r.rel)}</div>
 <div class="wide" style="display:flex;gap:10px"><button class="b">Speichern</button>
  <button type="button" class="b sec" onclick="closeRec('${u}')">Schließen</button></div>
 <label class="wide">Datei ersetzen (z. B. nach dem Schneiden)<input type="file" accept="video/*,.ts,.mkv,.mp4,.m2ts,.mpg,.mpeg,.avi,.mov" id="up-${u}"></label>
 <div class="wide" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
  <button type="button" class="b sec" onclick="upload('${u}')">Hochladen und ersetzen</button><span id="pr-${u}" class="muted"></span>
  <button type="button" class="b bad" style="margin-left:auto" onclick="removeRec(['${u}'])">Aufnahme löschen</button></div></form>`}
async function saveRec(u,form){const f=Object.fromEntries(new FormData(form));
 const btn=form.querySelector('button');btn.disabled=true;
 try{await api('/api/edit',{uuid:u,title:f.title,subtitle:f.subtitle,description:f.description});msg('Gespeichert: '+f.title,true);await load()}catch(e){msg(e.message);btn.disabled=false}}
async function removeRec(uuids){if(!uuids.length)return msg('Nichts ausgewählt');
 const names=uuids.map(u=>R(u).title).slice(0,5).join(', ')+(uuids.length>5?' …':'');
 if(!confirm(`${uuids.length} Aufnahme(n) samt Videodatei endgültig löschen?\n\n${names}`))return;
 try{const r=await api('/api/remove',{uuids});msg(r.removed+' Aufnahme(n) gelöscht',true);await load()}catch(e){msg(e.message)}}
function removeSel(){removeRec([...document.querySelectorAll('.cr:checked')].map(c=>c.value))}
function upload(u){const f=$('#up-'+u).files[0];if(!f)return msg('Bitte zuerst eine Datei auswählen');
 if(!confirm(`Die Videodatei von „${R(u).title}“ durch „${f.name}“ (${gb(f.size)}) ersetzen?\nDie bisherige Datei wird überschrieben.`))return;
 const pr=$('#pr-'+u),x=new XMLHttpRequest();
 x.open('POST','/api/upload?uuid='+u+'&name='+encodeURIComponent(f.name));
 x.upload.onprogress=e=>{if(e.lengthComputable)pr.textContent='Hochladen … '+Math.round(e.loaded/e.total*100)+' %'};
 x.onload=()=>{let j={};try{j=JSON.parse(x.responseText)}catch(e){}
  if(x.status==200){pr.textContent='';msg('Datei ersetzt: '+f.name,true);load()}else{pr.textContent='';msg(j.error||'Fehler '+x.status)}};
 x.onerror=()=>{pr.textContent='';msg('Upload abgebrochen')};
 x.send(f)}
async function renderConfig(){let c;try{c=await api('/api/config')}catch(e){$('#main').textContent=e.message;return}
 $('#main').innerHTML=`<form class="ed" onsubmit="event.preventDefault();saveConfig(this)">
 <label class="wide">Aufnahmeverzeichnis (auf dem OSMC)<input name="recdir" required value="${esc(c.recdir)}" placeholder="/media/HDD/recordings"></label>
 <label class="wide">TVHeadend-Server<input name="tvh" required value="${esc(c.tvh)}" placeholder="http://localhost:9981"></label>
 <label>Benutzer<input name="user" value="${esc(c.user)}" autocomplete="off"></label>
 <label>Passwort<input type="password" name="password" autocomplete="new-password" placeholder="${c.has_password?'gespeichert – leer lassen = unverändert':''}"></label>
 <label>Sprachcode<input name="lang" value="${esc(c.lang)}" placeholder="ger"></label>
 ${c.has_password?'<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="clear_password"> Passwort entfernen</label>':''}
 <div class="wide muted">Gespeichert in ${esc(c.config_file)}</div>
 <div class="wide"><button class="b">Verbindung prüfen und speichern</button></div></form>`}
async function saveConfig(form){const f=Object.fromEntries(new FormData(form));f.clear_password=!!f.clear_password;
 try{await api('/api/config',f);msg('Einstellungen gespeichert',true);await load();if(S)tab(0)}catch(e){msg(e.message)}}
function renderUnknown(){
 if(!S.unknown.length){$('#main').innerHTML='<p class="muted">Alle Dateien im Aufnahmeverzeichnis sind in TVHeadend eingetragen.</p>';return}
 let h=`<div class="bar"><button class="b sec" onclick="bulk()">Ausgewählte mit Vorschlägen importieren</button>
 <label><input type="checkbox" onchange="document.querySelectorAll('.cu').forEach(c=>c.checked=this.checked)"> alle auswählen</label></div>
 <table><tr><th></th><th>Datei</th><th>Vorschlag</th><th>Größe</th><th></th></tr>`;
 S.unknown.forEach((u,i)=>{h+=`<tr><td><input type="checkbox" class="cu" data-i="${i}"></td><td class="f">${esc(u.rel)}</td>
 <td>${esc(u.suggest.title)}<br><span class="muted">${esc(u.suggest.channelname||'Sender unbekannt')} · ${fmt(u.suggest.start)}${u.suggest.duration_known?'':' · Dauer geschätzt'}</span></td>
 <td>${gb(u.size)}</td><td><button class="b" onclick="edit(${i})">Bearbeiten</button></td></tr><tr id="ed${i}" hidden><td colspan="5"></td></tr>`});
 $('#main').innerHTML=h+'</table>'}
function edit(i){const row=$('#ed'+i);if(!row.hidden){row.hidden=true;return}
 const u=S.unknown[i],s=u.suggest;row.hidden=false;
 row.firstElementChild.innerHTML=`<form class="ed" onsubmit="event.preventDefault();save(${i},this)">
 <label class="wide">Titel<input name="title" required value="${esc(s.title)}"></label>
 <label class="wide">Untertitel / Episode<input name="subtitle"></label>
 <label>Sender<input name="channelname" list="chans" value="${esc(s.channelname)}" placeholder="Unbekannt"></label>
 <label>Start<input type="datetime-local" name="start" required value="${dtl(s.start)}"></label>
 <label>Ende<input type="datetime-local" name="stop" required value="${dtl(s.stop)}"></label>
 <label class="wide">Beschreibung<textarea name="description"></textarea></label>
 <label class="wide">Kommentar<input name="comment" value="nachträglich importiert"></label>
 <div class="wide" style="display:flex;gap:10px"><button class="b">In TVHeadend eintragen</button>
  <button type="button" class="b sec" onclick="$('#ed${i}').hidden=true">Schließen</button></div></form>`}
function payload(u,f){const ch=S.channels.find(c=>c.name===f.channelname);
 return {path:u.path,title:f.title,subtitle:f.subtitle,description:f.description,comment:f.comment,
  channelname:f.channelname,channel:ch?ch.uuid:'',start:Math.floor(new Date(f.start).getTime()/1000),stop:Math.floor(new Date(f.stop).getTime()/1000)}}
async function save(i,form){const f=Object.fromEntries(new FormData(form));
 try{await api('/api/import',payload(S.unknown[i],f));msg('Eingetragen: '+f.title,true);await load()}catch(e){msg(e.message)}}
async function bulk(){const sel=[...document.querySelectorAll('.cu:checked')].map(c=>S.unknown[c.dataset.i]);
 if(!sel.length)return msg('Nichts ausgewählt');
 if(!confirm(sel.length+' Dateien mit den vorgeschlagenen Titeln und Zeiten eintragen?'))return;
 let ok=0,err=[];for(const u of sel){const s=u.suggest;
  try{await api('/api/import',{path:u.path,title:s.title,channelname:s.channelname,start:s.start,stop:s.stop,comment:'nachträglich importiert'});ok++}catch(e){err.push(u.rel+': '+e.message)}}
 msg(ok+' eingetragen'+(err.length?'. Fehler: '+err.join('; '):''),!err.length);await load()}
function renderMissing(){
 if(!S.missing.length){$('#main').innerHTML='<p class="muted">Keine Einträge mit fehlender Datei.</p>';return}
 const rep=S.missing.filter(m=>m.candidate).length;
 let h=`<div class="bar">${rep?`<button class="b" onclick="repairAll()">${rep} Pfade reparieren</button>`:''}
 <button class="b bad" onclick="del()">Ausgewählte Einträge löschen</button>
 <label><input type="checkbox" onchange="document.querySelectorAll('.cm').forEach(c=>c.checked=this.checked)"> alle auswählen</label></div>
 <p class="muted">Gelöscht werden nur Einträge, deren Datei wirklich fehlt. Videodateien werden dabei nicht angefasst.</p>
 <table><tr><th></th><th>Titel</th><th>Sender / Datum</th><th>Erwartete Datei</th><th></th></tr>`;
 S.missing.forEach((m,i)=>{h+=`<tr><td><input type="checkbox" class="cm" data-i="${i}"></td>
 <td>${esc(m.title)}${m.subtitle?'<br><span class="muted">'+esc(m.subtitle)+'</span>':''}<br><span class="tag">${esc(m.status)}</span></td>
 <td>${esc(m.channel)}<br><span class="muted">${fmt(m.start)}</span></td>
 <td class="f">${m.filename?esc(m.filename):'<span class="muted">keine Datei</span>'}${m.candidate?'<br>→ gefunden: '+esc(m.candidate):''}</td>
 <td>${m.candidate?`<button class="b" onclick="repair([${i}])">Pfad reparieren</button>`:''}</td></tr>`});
 $('#main').innerHTML=h+'</table>'}
async function repair(idx){const moves=idx.map(i=>({src:S.missing[i].filename,dst:S.missing[i].candidate}));
 try{const r=await api('/api/move',{moves});msg(r.moved+' Pfade repariert'+(r.skipped?', '+r.skipped+' übersprungen':''),true);await load()}catch(e){msg(e.message)}}
function repairAll(){repair(S.missing.map((m,i)=>m.candidate?i:-1).filter(i=>i>=0))}
async function del(){const uuids=[...document.querySelectorAll('.cm:checked')].map(c=>S.missing[c.dataset.i].uuid);
 if(!uuids.length)return msg('Nichts ausgewählt');
 if(!confirm(uuids.length+' Einträge endgültig aus TVHeadend löschen?'))return;
 try{const r=await api('/api/delete',{uuids});msg(r.deleted+' gelöscht'+(r.skipped?', '+r.skipped+' übersprungen (Datei vorhanden)':''),true);await load()}catch(e){msg(e.message)}}
load();
</script></body></html>'''


def main():
    p = argparse.ArgumentParser(
        description='Web-Oberfläche zum Re-Import und Bereinigen von TVHeadend-Aufnahmen. '
                    'Ordner und Server lassen sich auch in der Oberfläche unter „Einstellungen“ ändern.')
    p.add_argument('--config', default=os.path.expanduser('~/.config/tvh-aufnahmen.json'),
                   help='Konfigurationsdatei (Standard: %(default)s)')
    p.add_argument('--recdir', help='Aufnahmeverzeichnis, z. B. /media/HDD/recordings')
    p.add_argument('--tvh', help='TVHeadend-URL, z. B. http://localhost:9981')
    p.add_argument('--user', default=os.environ.get('TVH_USER'), help='TVHeadend-Benutzer (oder TVH_USER)')
    p.add_argument('--password', default=os.environ.get('TVH_PASS'), help='Passwort (oder TVH_PASS)')
    p.add_argument('--lang', help='Sprachcode für Titel/Beschreibung (Standard: ger)')
    p.add_argument('--port', type=int, default=8099, help='Port der Oberfläche (Standard: %(default)s)')
    p.add_argument('--bind', default='0.0.0.0', help='Adresse (Standard: %(default)s)')
    a = p.parse_args()

    default_dir = os.path.expanduser('~/Tvheadend/Extern/Aufnahmen')
    cfg = {'tvh': 'http://localhost:9981', 'lang': 'ger', 'user': '', 'password': '',
           'recdir': default_dir if os.path.isdir(default_dir) else ''}
    cfg.update(load_config(a.config))
    for k in App.KEYS:  # Startparameter haben Vorrang vor der Datei
        if getattr(a, k):
            cfg[k] = getattr(a, k)
    if cfg['recdir']:
        cfg['recdir'] = os.path.abspath(cfg['recdir'])
        if not os.path.isdir(cfg['recdir']):
            print('Warnung: Aufnahmeverzeichnis nicht gefunden: ' + cfg['recdir'])

    app = App(a.config, cfg)
    srv = ThreadingHTTPServer((a.bind, a.port), make_handler(app))
    print('Oberfläche läuft auf http://%s:%d/ (Strg+C beendet)' % (a.bind, a.port))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
