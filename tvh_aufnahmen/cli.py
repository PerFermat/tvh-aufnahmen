"""Startparameter auswerten und den Server starten."""
import argparse
import os
import socket
from http.server import ThreadingHTTPServer

from .config import App, find_tvhconf, load_config
from .epg_archive import EpgArchive
from .jobs import Jobs
from .posters import Posters
from .server import make_handler
from .teletext import TeletextService


class DualStackServer(ThreadingHTTPServer):
    """Lauscht auf IPv6 und IPv4 zugleich – Handys nehmen für „raspi5.fritz.box“ oft die IPv6-Adresse."""
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def make_server(bind, port, handler):
    if ':' in bind:  # IPv6-Adresse, z. B. „::“ = alle
        try:
            return DualStackServer((bind, port), handler)
        except OSError:
            if bind != '::':
                raise
            bind = '0.0.0.0'  # kein IPv6 auf diesem Rechner
    return ThreadingHTTPServer((bind, port), handler)


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
    p.add_argument('--bind', default='::', help='Adresse (Standard: %(default)s = IPv6 und IPv4)')
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
    app.archive = EpgArchive()
    app.teletext = TeletextService(lambda: app.tvh)
    app.jobs = Jobs(app)
    srv = make_server(a.bind, a.port, make_handler(app))
    print('Oberfläche läuft auf Port %d, Adresse %s (Strg+C beendet)' % (a.port, a.bind))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass

