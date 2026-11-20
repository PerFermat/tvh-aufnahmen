"""Sprachen der Oberfläche und der Meldungen. Je Sprache eine JSON-Datei in lang/ (de.json, en.json …)
mit Schlüssel → Text; Platzhalter in geschweiften Klammern ({name}). „_name“ ist der Name der Sprache
in ihr selbst, „_locale“ das Format für Datum und Zahlen. Fehlt ein Text, gilt der deutsche.

Welche Sprache gilt, entscheidet je Anfrage das Cookie „lang“ (vom Gerät gewählt), sonst die
Sprache des Browsers (Accept-Language), sonst Deutsch. Hintergrundaufgaben (Benachrichtigungen)
nehmen die zuletzt unter „Einstellungen“ gewählte Sprache (Konfiguration „ui_lang“)."""
import json
import os
import re
import threading

LANG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lang')
DEFAULT = 'de'
_current = threading.local()
_default = [DEFAULT]  # Sprache außerhalb von Anfragen
LANGS = {}


def load():
    LANGS.clear()
    for name in sorted(os.listdir(LANG_DIR)):
        m = re.fullmatch(r'([a-z]{2}(?:-[A-Za-z]{2})?)\.json', name)
        if m:
            with open(os.path.join(LANG_DIR, name), encoding='utf-8') as f:
                LANGS[m.group(1)] = json.load(f)


def languages():
    return [{'code': c, 'name': d.get('_name', c)} for c, d in sorted(LANGS.items())]


def pick(cookie='', accept=''):
    """Sprache aus Cookie oder Accept-Language (z. B. „en-US,en;q=0.9,de;q=0.8“)."""
    if cookie in LANGS:
        return cookie
    for part in (accept or '').split(','):
        code = part.split(';')[0].strip().lower()
        for c in (code, code.split('-')[0]):
            if c in LANGS:
                return c
    return DEFAULT


def set_lang(code):
    _current.code = code if code in LANGS else None


def set_default(code):
    _default[0] = code if code in LANGS else DEFAULT


def current():
    return getattr(_current, 'code', None) or _default[0]


def _(key, **kw):
    """Text zum Schlüssel in der aktuellen Sprache; kw füllt die Platzhalter."""
    text = LANGS.get(current(), {}).get(key) or LANGS.get(DEFAULT, {}).get(key) or key
    return text.format(**kw) if kw else text


def script(code):
    """JavaScript für die Oberfläche: die Texte der Sprache und (als Rückfall) die deutschen."""
    return ('window.T=%s;window.TDE=%s;window.LANGS=%s;' % (
        json.dumps(LANGS.get(code, {}), ensure_ascii=False), json.dumps(LANGS.get(DEFAULT, {}), ensure_ascii=False),
        json.dumps(languages(), ensure_ascii=False))).encode()


load()
