"""Einstellungen: laden, prüfen und in einer JSON-Datei speichern."""
import json
import os
import re

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
        new['tvhconf'] = os.path.abspath(new['tvhconf']) if new.get('tvhconf') else ''
        if new['tvhconf'] and not os.path.isfile(os.path.join(new['tvhconf'], 'config')):
            raise ValueError('Kein TVHeadend-Konfigurationsordner (Datei „config“ fehlt): ' + new['tvhconf'])
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

    @property
    def tvhconf(self):
        if not self.cfg.get('tvhconf'):
            raise ValueError('Bitte zuerst unter „Einstellungen“ den TVHeadend-Konfigurationsordner eintragen')
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
