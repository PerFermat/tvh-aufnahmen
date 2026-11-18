"""Startparameter auswerten und den Server starten."""
import argparse
import os
from http.server import ThreadingHTTPServer

from .config import App, find_tvhconf, load_config
from .posters import Posters
from .server import make_handler


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
    p.add_argument('--tvhconf', help='Konfigurationsordner von TVHeadend, z. B. ~/.config/hts')
    p.add_argument('--tvh-service', default='tvheadend',
                   help='systemd-Dienst, der beim Wiederherstellen gestoppt und gestartet wird; '
                        'leer = nicht anfassen (Standard: %(default)s)')
    p.add_argument('--port', type=int, default=8099, help='Port der Oberfläche (Standard: %(default)s)')
    p.add_argument('--bind', default='0.0.0.0', help='Adresse (Standard: %(default)s)')
    a = p.parse_args()

    default_dir = os.path.expanduser('~/Tvheadend/Extern/Aufnahmen')
    cfg = {'tvh': 'http://localhost:9981', 'lang': 'ger', 'user': '', 'password': '',
           'recdir': default_dir if os.path.isdir(default_dir) else '', 'tvhconf': find_tvhconf()}
    cfg.update(load_config(a.config))
    for k in App.KEYS:  # Startparameter haben Vorrang vor der Datei
        if getattr(a, k):
            cfg[k] = getattr(a, k)
    if cfg['recdir']:
        cfg['recdir'] = os.path.abspath(cfg['recdir'])
        if not os.path.isdir(cfg['recdir']):
            print('Warnung: Aufnahmeverzeichnis nicht gefunden: ' + cfg['recdir'])

    if cfg.get('tvhconf'):
        cfg['tvhconf'] = os.path.abspath(os.path.expanduser(cfg['tvhconf']))
    app = App(a.config, cfg, a.tvh_service)
    app.posters = Posters(os.path.expanduser('~/.cache/tvh-aufnahmen/posters.json'))
    srv = ThreadingHTTPServer((a.bind, a.port), make_handler(app))
    print('Oberfläche läuft auf http://%s:%d/ (Strg+C beendet)' % (a.bind, a.port))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass

