"""Einstellungen: laden, prüfen und in einer JSON-Datei speichern."""
import json
import os
import re

from . import i18n
from .i18n import _
from .posters import TraktKeyError, trakt_lookup
from .tvh import Tvh


class App:
    """Hält die Einstellungen und speichert sie in einer JSON-Datei."""
    KEYS = ('recdir', 'tvh', 'user', 'password', 'lang', 'tvhconf')

    def __init__(self, path, cfg, service='tvheadend'):
        self.path = path
        self.cfg = cfg
        self.service = service  # systemd-Dienst von TVHeadend, für die Wiederherstellung
        self.tvh = Tvh(cfg['tvh'], cfg.get('user'), cfg.get('password'))

    def public(self):
        c = {k: self.cfg.get(k) or '' for k in self.KEYS if k != 'password'}
        c['has_password'] = bool(self.cfg.get('password'))
        c['has_trakt'] = bool(self.cfg.get('trakt_id'))
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
            raise ValueError(_('srv.recdir_missing', dir=new['recdir'] or '–'))
        if not re.match(r'https?://', new.get('tvh') or ''):
            raise ValueError(_('srv.server_url'))
        new['lang'] = new.get('lang') or 'ger'
        new['tvhconf'] = os.path.abspath(new['tvhconf']) if new.get('tvhconf') else ''
        if new['tvhconf'] and not os.path.isfile(os.path.join(new['tvhconf'], 'config')):
            raise ValueError(_('srv.no_tvhconf', dir=new['tvhconf']))
        tvh = Tvh(new['tvh'], new.get('user'), new.get('password'))
        tvh.call('serverinfo')  # Verbindung und Login prüfen, bevor gespeichert wird
        self.cfg, self.tvh = new, tvh
        save_config(self.path, new)
        return self.public()

    def set_ui_lang(self, code):
        """Sprache für Meldungen ohne Anfrage (Benachrichtigungen); die Oberfläche merkt sich ihre per Cookie."""
        if code not in i18n.LANGS:
            raise ValueError(_('srv.unknown_lang', lang=code))
        self.cfg = dict(self.cfg, ui_lang=code)
        save_config(self.path, self.cfg)
        i18n.set_default(code)
        return {'lang': code}

    def set_trakt(self, client_id='', clear=False):
        """Trakt-Client-ID für die Bildersuche prüfen und speichern (wie das Passwort nie ausgeliefert)."""
        new = dict(self.cfg)
        if clear:
            new.pop('trakt_id', None)
        else:
            client_id = (client_id or '').strip()
            if not re.fullmatch(r'[A-Za-z0-9_-]{20,128}', client_id):
                raise ValueError(_('srv.trakt_format'))
            try:
                trakt_lookup(client_id, 'Titanic')
            except TraktKeyError:
                raise ValueError(_('srv.trakt_rejected')) from None
            except OSError as e:
                raise ValueError(_('srv.trakt_unreachable', err=e)) from None
            new['trakt_id'] = client_id
        save_config(self.path, new)
        self.cfg = new
        return self.public()

    @property
    def recdir(self):
        if not self.cfg.get('recdir'):
            raise ValueError(_('srv.need_recdir'))
        return self.cfg['recdir']

    @property
    def tvhconf(self):
        if not self.cfg.get('tvhconf'):
            raise ValueError(_('srv.need_tvhconf'))
        return self.cfg['tvhconf']


def find_tvhconf():
    """Üblicher Konfigurationsordner von TVHeadend für den aktuellen Benutzer."""
    for d in ('~/.config/hts', '~/.hts/tvheadend'):
        d = os.path.expanduser(d)
        if os.path.isfile(os.path.join(d, 'config')):
            return d
    return ''


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
