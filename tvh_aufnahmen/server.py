"""HTTP-Server: liefert die Oberfläche aus und bietet die JSON-API an."""
import json
import os
import re
import urllib.error
import urllib.parse
from http.server import BaseHTTPRequestHandler

from .files import file_exists
from .recordings import do_delete, do_edit, do_import, do_move, do_remove, replace_file
from .state import build_state
from .tvh import entry_info

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')
STATIC_TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8'}


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
