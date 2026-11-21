"""Reiter „Sender ordnen“: alle Sender mit Nummer und Logo, neue Nummern in TVHeadend speichern (gelöscht
wird über scan_delete). Senderlisten (Favoriten) sind Sender-Tags von TVHeadend; eigene erkennt man am
Kommentar OWN – die übrigen legt TVHeadend selbst an (Netz, Anbieter, SD/HD).
Das Verschieben und Nachrücken selbst passiert in der Oberfläche; hier wird nur geprüft und gespeichert."""
import json
import re

from .i18n import _

OWN = 'Senderliste (tvh-aufnahmen)'


def channel_list(tvh):
    """Alle Sender (auch abgeschaltete), nach Nummer sortiert; Sender ohne Nummer am Ende."""
    autorecs = {}
    for a in tvh.call('dvr/autorec/grid', limit=100000).get('entries', []):
        autorecs.setdefault(a.get('channel'), []).append(a.get('name') or a.get('title') or '')
    chans = []
    for c in tvh.call('channel/grid', limit=100000, all=1).get('entries', []):
        icon = re.fullmatch(r'imagecache/(\d+)', c.get('icon_public_url') or '')
        chans.append({'uuid': c['uuid'], 'name': c.get('name') or '', 'number': c.get('number') or 0,
                      'enabled': bool(c.get('enabled', True)),
                      'icon': '/api/icon?id=' + icon.group(1) if icon else '',
                      'autorecs': autorecs.get(c['uuid'], []), 'tags': c.get('tags') or []})
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


def tag_list(tvh):
    """Alle Sender-Tags, eigene Listen zuerst; mit der Zahl der Sender."""
    count = {}
    for c in tvh.call('channel/grid', limit=100000, all=1).get('entries', []):
        for t in c.get('tags') or []:
            count[t] = count.get(t, 0) + 1
    tags = [{'uuid': t['uuid'], 'name': t.get('name') or '', 'own': t.get('comment') == OWN,
             'count': count.get(t['uuid'], 0)}
            for t in tvh.call('channeltag/grid', limit=1000, all=1).get('entries', []) if t.get('enabled', True)]
    tags.sort(key=lambda t: (not t['own'], t['name'].lower()))
    return {'tags': tags}


def tag_create(tvh, name):
    name = (name or '').strip()
    if not name or len(name) > 40:
        raise ValueError(_('chn.list_name'))
    if any(t['name'].lower() == name.lower() for t in tag_list(tvh)['tags']):
        raise ValueError(_('chn.list_exists', name=name))
    tvh.call('channeltag/create', conf=json.dumps({'enabled': True, 'name': name, 'comment': OWN, 'internal': False}))
    return tag_list(tvh)


def tag_delete(tvh, uuid):
    """Nur eigene Listen – die Tags von TVHeadend legt es beim nächsten Suchlauf ohnehin neu an."""
    if not any(t['uuid'] == uuid and t['own'] for t in tag_list(tvh)['tags']):
        raise ValueError(_('chn.list_not_own'))
    tvh.call('idnode/delete', uuid=uuid)
    return tag_list(tvh)


def tag_toggle(tvh, tag, channel, on):
    """Sender in eine Liste aufnehmen oder herausnehmen."""
    ch = next((c for c in tvh.call('channel/grid', limit=100000, all=1).get('entries', []) if c['uuid'] == channel), None)
    if not ch:
        raise ValueError(_('chn.unknown'))
    tags = [t for t in ch.get('tags') or [] if t != tag] + ([tag] if on else [])
    tvh.call('idnode/save', node=json.dumps({'uuid': channel, 'tags': tags}))
    return {'tags': tags}
