"""Startparameter auswerten und den Server starten."""
import argparse
import os
import socket
from http.server import ThreadingHTTPServer

from . import i18n
from .auth import Auth
from .config import App, find_tvhconf, load_config
from .epg_archive import EpgArchive
from .i18n import _
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
    # Sprache der Konsole aus der Umgebung (LANG=en_US.UTF-8 → en)
    i18n.set_default(i18n.pick('', os.environ.get('LANG', '').split('.')[0].replace('_', '-')))
    p = argparse.ArgumentParser(description=_('cli.description'))
    p.add_argument('--config', default=os.path.expanduser('~/.config/tvh-aufnahmen.json'), help=_('cli.config'))
    p.add_argument('--recdir', help=_('cli.recdir'))
    p.add_argument('--tvh', help=_('cli.tvh'))
    p.add_argument('--user', default=os.environ.get('TVH_USER'), help=_('cli.user'))
    p.add_argument('--password', default=os.environ.get('TVH_PASS'), help=_('cli.password'))
    p.add_argument('--lang', help=_('cli.lang'))
    p.add_argument('--tvhconf', help=_('cli.tvhconf'))
    p.add_argument('--tvh-service', default='tvheadend', help=_('cli.service'))
    p.add_argument('--port', type=int, default=8099, help=_('cli.port'))
    p.add_argument('--bind', default='::', help=_('cli.bind'))
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
            print(_('cli.warn_recdir', dir=cfg['recdir']))

    if cfg.get('tvhconf'):
        cfg['tvhconf'] = os.path.abspath(os.path.expanduser(cfg['tvhconf']))
    app = App(a.config, cfg, a.tvh_service)
    if cfg.get('ui_lang'):
        i18n.set_default(cfg['ui_lang'])  # zuletzt in der Oberfläche gewählt – für Benachrichtigungen
    app.posters = Posters(os.path.expanduser('~/.cache/tvh-aufnahmen/posters.json'),
                          client_id=lambda: app.cfg.get('trakt_id'))
    app.archive = EpgArchive()
    app.teletext = TeletextService(lambda: app.tvh)
    app.jobs = Jobs(app)
    app.auth = Auth(app)
    srv = make_server(a.bind, a.port, make_handler(app))
    print(_('cli.running', port=a.port, bind=a.bind))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass

