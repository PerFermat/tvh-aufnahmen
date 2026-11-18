"""HTTP-Server: liefert die Oberfläche aus und bietet die JSON-API an."""
import json
import os
import re
import time
import urllib.error
import urllib.parse
from http.server import BaseHTTPRequestHandler

from .backup import check_password, restore, write_backup
from .epg import (autorec_delete, autorec_load, autorec_save, autorecs, class_form, epg_day, epg_search,
                  event_detail, poster_status, record_event, upcoming, upcoming_cancel)
from .files import file_exists
from .live import channel_icon, channel_playlist, live_channels
from .recordings import do_delete, do_edit, do_import, do_move, do_remove, replace_file
from .status import status
from .scan import scan_add, scan_delete, scan_result, scan_start, scan_status
from .state import build_state
from .thumbs import thumbnail
from .transfer import export_all, plan_import
from .tvh import entry_info

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')
STATIC_TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
                '.webmanifest': 'application/manifest+json'}


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

        def static(self, name):
            path = os.path.join(STATIC_DIR, name)
            ctype = STATIC_TYPES.get(os.path.splitext(name)[1])
            if '/' in name or not ctype or not os.path.isfile(path):
                return self.send(404, {'error': 'nicht gefunden'})
            with open(path, 'rb') as f:
                self.send(200, f.read(), ctype)

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
            self.send_m3u(title, body)

        def channel_playlist(self, uuid):
            self.send_m3u(*channel_playlist(app.tvh, uuid, self.headers.get('Host')))

        def thumb(self, uuid):
            path = thumbnail(entry_info(app.tvh, uuid).get('filename'))
            if not path:
                return self.send(404, {'error': 'kein Vorschaubild'})
            with open(path, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'max-age=604800')
            self.end_headers()
            self.wfile.write(data)

        def icon(self, icon_id):
            data, ctype = channel_icon(app.tvh, icon_id)
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'max-age=86400')
            self.end_headers()
            self.wfile.write(data)

        def send_m3u(self, title, body):
            self.send_file_headers(title + '.m3u', 'audio/x-mpegurl; charset=utf-8', len(body))
            self.wfile.write(body)

        def send_file_headers(self, name, ctype, length=None):
            """Kopfzeilen für einen Download; ohne Länge endet die Antwort mit dem Verbindungsende."""
            name = re.sub(r'[\\/:*?"<>|]', '_', name)
            ascii_name = name.encode('ascii', 'replace').decode()
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Disposition', 'attachment; filename="%s"; filename*=UTF-8\'\'%s'
                             % (ascii_name, urllib.parse.quote(name)))
            if length is None:
                self.close_connection = True
            else:
                self.send_header('Content-Length', str(length))
            self.end_headers()

        def export(self):
            body = json.dumps(export_all(app.tvh, app.recdir), indent=1, ensure_ascii=False).encode()
            self.send_file_headers('tvh-export-%s.json' % time.strftime('%Y-%m-%d'),
                                   'application/json; charset=utf-8', len(body))
            self.wfile.write(body)

        def backup(self, req):
            check_password(app.cfg, req.get('password'))
            conf = app.tvhconf
            info = {'tvh_version': app.tvh.call('serverinfo').get('sw_version'),
                    'created': time.strftime('%Y-%m-%d %H:%M'), 'tvhconf': conf,
                    'recdir': app.cfg.get('recdir') or ''}
            self.send_file_headers('tvheadend-sicherung-%s.tar.gz' % time.strftime('%Y-%m-%d'), 'application/gzip')
            try:
                write_backup(conf, self.wfile, info, with_epg=bool(req.get('epg', True)))
            except (BrokenPipeError, ConnectionResetError):
                pass  # Download im Browser abgebrochen

        def do_GET(self):
            url = urllib.parse.urlsplit(self.path)
            q = dict(urllib.parse.parse_qsl(url.query))
            if url.path == '/':
                url = url._replace(path='/static/index.html')
            if url.path.startswith('/static/'):
                self.static(url.path[len('/static/'):])
            elif url.path == '/api/state':
                self.run(lambda: build_state(app.tvh, app.recdir))
            elif url.path == '/api/config':
                self.run(app.public)
            elif url.path == '/api/download':
                self.run(lambda: self.download(q['uuid']))
            elif url.path == '/api/playlist':
                self.run(lambda: self.playlist(q['uuid']))
            elif url.path == '/api/live':
                self.run(lambda: live_channels(app.tvh))
            elif url.path == '/api/channel-playlist':
                self.run(lambda: self.channel_playlist(q['uuid']))
            elif url.path == '/api/thumb':
                self.run(lambda: self.thumb(q['uuid']))
            elif url.path == '/api/icon':
                self.run(lambda: self.icon(q['id']))
            elif url.path == '/api/export':
                self.run(self.export)
            elif url.path == '/api/epg':
                self.run(lambda: epg_day(app.tvh, app.posters, app.archive, q.get('start')))
            elif url.path == '/api/epg-search':
                self.run(lambda: epg_search(app.tvh, q.get('q'), q.get('full') == '1'))
            elif url.path == '/api/epg/event':
                self.run(lambda: event_detail(app.tvh, app.posters, app.archive, q['id']))
            elif url.path == '/api/form':
                self.run(lambda: class_form(app.tvh, q['class']))
            elif url.path == '/api/autorecs':
                self.run(lambda: autorecs(app.tvh))
            elif url.path == '/api/autorec':
                self.run(lambda: autorec_load(app.tvh, q['uuid']))
            elif url.path == '/api/upcoming':
                self.run(lambda: upcoming(app.tvh))
            elif url.path == '/api/jobs':
                self.run(app.jobs.settings)
            elif url.path == '/api/status':
                self.run(lambda: status(app.tvh, app.recdir))
            elif url.path == '/api/scan-status':
                self.run(lambda: scan_status(app.tvh))
            elif url.path == '/api/scan-result':
                self.run(lambda: scan_result(app.tvh))
            else:
                self.send(404, {'error': 'nicht gefunden'})

        def do_POST(self):
            length = int(self.headers.get('Content-Length') or 0)
            url = urllib.parse.urlsplit(self.path)
            if url.path == '/api/upload':  # Rohdaten der Datei, kein JSON
                q = dict(urllib.parse.parse_qsl(url.query))
                self.run(lambda: replace_file(app.tvh, q['uuid'], q.get('name', ''), length, self.rfile))
                return
            if url.path == '/api/restore':  # Rohdaten der Sicherung
                q = dict(urllib.parse.parse_qsl(url.query))
                self.run(lambda: restore(app, length, self.rfile, force=q.get('force') == '1'))
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
            elif self.path == '/api/posters':
                self.run(lambda: poster_status(app.posters, req.get('keys') or [], bool(req.get('urgent'))))
            elif self.path == '/api/scan-start':
                self.run(lambda: scan_start(app.tvh))
            elif self.path == '/api/scan-add':
                self.run(lambda: scan_add(app.tvh, req.get('uuids') or []))
            elif self.path == '/api/scan-delete':
                self.run(lambda: scan_delete(app.tvh, req.get('uuids') or []))
            elif self.path == '/api/record':
                self.run(lambda: record_event(app.tvh, req['event'], req.get('config')))
            elif self.path == '/api/autorec-save':
                self.run(lambda: autorec_save(app.tvh, req))
            elif self.path == '/api/autorec-delete':
                self.run(lambda: autorec_delete(app.tvh, req['uuid']))
            elif self.path == '/api/upcoming-cancel':
                self.run(lambda: upcoming_cancel(app.tvh, req['uuid']))
            elif self.path == '/api/jobs':
                self.run(lambda: app.jobs.update(req))
            elif self.path == '/api/backup-now':
                self.run(app.jobs.run_backup)
            elif self.path == '/api/notify-test':
                self.run(lambda: {'sent': app.jobs.notify('Test von tvh-aufnahmen', 'Benachrichtigungen funktionieren.',
                                                           'tada', 3, url=(req.get('url') or '').strip() or None)})
            elif self.path == '/api/backup':
                self.run(lambda: self.backup(req))
            elif self.path in ('/api/import-preview', '/api/import-apply'):
                self.run(lambda: plan_import(app.tvh, app.recdir, req.get('data'),
                                             req.get('sections') or (), self.path == '/api/import-apply'))
            else:
                self.send(404, {'error': 'nicht gefunden'})
    return Handler
