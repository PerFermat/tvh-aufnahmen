"""Reiter „Sender ordnen“: alle Sender mit Nummer und Logo, neue Nummern in TVHeadend speichern.
Das Verschieben und Nachrücken selbst passiert in der Oberfläche; hier wird nur geprüft und gespeichert."""
import json
import re

from .i18n import _


def channel_list(tvh):
    """Alle Sender (auch abgeschaltete), nach Nummer sortiert; Sender ohne Nummer am Ende."""
    chans = []
    for c in tvh.call('channel/grid', limit=100000, all=1).get('entries', []):
        icon = re.fullmatch(r'imagecache/(\d+)', c.get('icon_public_url') or '')
        chans.append({'uuid': c['uuid'], 'name': c.get('name') or '', 'number': c.get('number') or 0,
                      'enabled': bool(c.get('enabled', True)),
                      'icon': '/api/icon?id=' + icon.group(1) if icon else ''})
    chans.sort(key=lambda c: (c['number'] or 1 << 30, c['name'].lower()))
    return {'channels': chans}


def channel_numbers(tvh, changes):
    """Speichert neue Nummern: changes = [{uuid, number}]. Nur geänderte Sender werden geschrieben. Doppelte
    Nummern sind erlaubt (TVHeadend kennt sie auch) – wer beim Verschieben nicht aufrücken lässt, bekommt sie."""
    current = {c['uuid']: c for c in channel_list(tvh)['channels']}
    new = {}
    for ch in changes or []:
        u, n = ch.get('uuid'), ch.get('number')
        if u not in current:
            raise ValueError(_('chn.unknown'))
        if not isinstance(n, int) or isinstance(n, bool) or not 0 <= n <= 99999:
            raise ValueError(_('chn.bad_number', n=n))
        if n != current[u]['number']:
            new[u] = n
    for u, n in new.items():
        tvh.call('idnode/save', node=json.dumps({'uuid': u, 'number': n}))
    return {'saved': len(new)}
