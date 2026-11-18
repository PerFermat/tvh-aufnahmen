"""Programmzeitschrift, Aufnahmen planen, Serienaufnahmen und geplante Aufnahmen."""
import json
import re
import time
from datetime import datetime

from .posters import attach

EVENT_FIELDS = ('eventId', 'channelUuid', 'title', 'subtitle', 'description', 'start', 'stop',
                'hd', 'subtitled', 'widescreen', 'audiodesc')
GRID_TEXT = 1500  # Zeichen Beschreibung in der Übersicht (reicht für ~40 Zeilen); vollständig im Detailfenster


def day_start(ts):
    """Mitternacht (Ortszeit) des Tages, in dem ts liegt."""
    return int(datetime.fromtimestamp(ts).replace(hour=0, minute=0, second=0, microsecond=0).timestamp())


def day_end(start):
    """Nächste Mitternacht; über das Datum gerechnet, damit Sommer-/Winterzeit stimmt."""
    return day_start(start + 26 * 3600)


def upcoming_entries(tvh):
    return tvh.call('dvr/entry/grid_upcoming', limit=100000).get('entries', [])


def epg_day(tvh, posters, start=None):
    start = day_start(int(start) if start else time.time())
    end = day_end(start)
    # Zwei Bedingungen auf dasselbe Feld wertet TVHeadend nicht zuverlässig aus.
    flt = [{'field': 'stop', 'type': 'numeric', 'value': start, 'comparison': 'gt'},
           {'field': 'start', 'type': 'numeric', 'value': end, 'comparison': 'lt'}]
    events = [{k: e.get(k) for k in EVENT_FIELDS}
              for e in tvh.call('epg/events/grid', filter=json.dumps(flt), limit=100000).get('entries', [])
              if start <= e.get('start', 0) < end]
    for e in events:
        if len(e.get('description') or '') > GRID_TEXT:
            e['description'] = e['description'][:GRID_TEXT].rsplit(' ', 1)[0] + ' …'
    planned = upcoming_entries(tvh)
    by_event = {e.get('broadcast') for e in planned if e.get('broadcast')}
    by_time = {(e.get('channel'), e.get('start')) for e in planned}
    for e in events:
        e['planned'] = e['eventId'] in by_event or (e['channelUuid'], e['start']) in by_time
    with_epg = {e['channelUuid'] for e in events}
    tags = {t['uuid']: t['name'] for t in tvh.call('channeltag/grid', limit=1000).get('entries', [])}
    channels = []
    for c in tvh.call('channel/grid', limit=100000).get('entries', []):
        icon = re.fullmatch(r'imagecache/(\d+)', c.get('icon_public_url') or '')
        channels.append({'uuid': c['uuid'], 'name': c.get('name') or '', 'number': c.get('number') or 0,
                         'icon': '/api/icon?id=' + icon.group(1) if icon else '',
                         'tags': [tags[t] for t in c.get('tags', []) if t in tags],
                         'epg': c['uuid'] in with_epg})
    channels.sort(key=lambda c: (c['number'] or 1 << 30, c['name'].lower()))
    events.sort(key=lambda e: e['start'])
    return {'start': start, 'end': end, 'prev': day_start(start - 1), 'next': end,
            'channels': channels, 'events': events, 'posters_pending': attach(posters, events)}


def event_detail(tvh, posters, event_id):
    res = tvh.call('epg/events/load', eventId=int(event_id)).get('entries') or []
    if not res:
        raise ValueError('Sendung nicht mehr im Programm')
    attach(posters, res, min_duration=0, urgent=True)  # beim Öffnen für jede Sendung, sofort
    return res[0]


def poster_status(posters, keys, urgent=False):
    return {k: posters.get(k, urgent) for k in keys[:500] if isinstance(k, str)}


def record_event(tvh, event_id, config_uuid=''):
    res = tvh.call('dvr/entry/create_by_event', event_id=int(event_id), config_uuid=config_uuid or '')
    uuids = res.get('uuid') or []
    if not uuids:
        raise ValueError('TVHeadend hat keine Aufnahme angelegt (schon geplant oder Sendung vorbei?)')
    return {'uuid': uuids[0] if isinstance(uuids, list) else uuids}


def resolve_enum(tvh, enum):
    """Auswahlliste als [{key, val}] – feste Listen aus der Klassenbeschreibung oder per API."""
    if isinstance(enum, dict) and enum.get('type') == 'api':
        enum = tvh.call(enum['uri'], **(enum.get('params') or {})).get('entries', [])
    return [x if isinstance(x, dict) else {'key': x, 'val': x} for x in enum]


def class_form(tvh, name):
    """Formularbeschreibung einer TVHeadend-Klasse (z. B. dvrautorec) mit allen Auswahllisten."""
    if not re.fullmatch(r'\w+', name or ''):
        raise ValueError('Ungültige Klasse')
    props = []
    for p in tvh.call('idnode/class', name=name).get('props', []):
        if p.get('rdonly') or p.get('noui'):
            continue
        prop = {k: p.get(k) for k in ('id', 'type', 'caption', 'description', 'default', 'list',
                                      'advanced', 'expert', 'hidden') if k in p}
        if p.get('enum') is not None:
            prop['enum'] = resolve_enum(tvh, p['enum'])
            keys = [x['key'] for x in prop['enum']]
            # z. B. Startzeit: Standard „Any“, die Liste beginnt aber übersetzt mit „Beliebig“
            if not prop.get('list') and prop.get('default') not in keys and keys and isinstance(keys[0], str):
                prop['enum'][0] = {'key': prop.get('default'), 'val': prop['enum'][0]['val']}
        props.append(prop)
    return {'class': name, 'props': props}


def autorecs(tvh):
    chans = {c['uuid']: c.get('name') or '' for c in tvh.call('channel/grid', limit=100000, all=1).get('entries', [])}
    tags = {t['uuid']: t['name'] for t in tvh.call('channeltag/grid', limit=1000, all=1).get('entries', [])}
    counts = {}
    for e in upcoming_entries(tvh):
        if e.get('autorec'):
            counts[e['autorec']] = counts.get(e['autorec'], 0) + 1
    out = []
    for a in tvh.call('dvr/autorec/grid', limit=100000).get('entries', []):
        out.append(dict(a, channelname=chans.get(a.get('channel'), ''), tagname=tags.get(a.get('tag'), ''),
                        planned=counts.get(a['uuid'], 0)))
    out.sort(key=lambda a: (a.get('name') or a.get('title') or '').lower())
    return {'autorecs': out}


def check_uuid(uuid):
    if not re.fullmatch(r'[0-9a-f]{32}', uuid or ''):
        raise ValueError('Ungültige ID')
    return uuid


def autorec_load(tvh, uuid):
    res = tvh.call('idnode/load', uuid=check_uuid(uuid)).get('entries') or []
    if not res:
        raise ValueError('Serienaufnahme nicht gefunden')
    return {p['id']: p.get('value') for p in res[0]['params']}


def autorec_save(tvh, conf):
    conf = dict(conf)
    uuid = conf.pop('uuid', None)
    if uuid:
        tvh.call('idnode/save', node=json.dumps(dict(conf, uuid=check_uuid(uuid))))
        return {'uuid': uuid}
    if not (conf.get('title') or conf.get('channel') or conf.get('tag') or conf.get('content_type')):
        raise ValueError('Bitte mindestens Titel, Sender, Tag oder Inhaltsart angeben – sonst würde alles aufgenommen')
    res = tvh.call('dvr/autorec/create', conf=json.dumps(conf))
    if not res.get('uuid'):
        raise ValueError('TVHeadend hat die Serienaufnahme nicht angelegt')
    return {'uuid': res['uuid']}


def autorec_delete(tvh, uuid):
    tvh.call('idnode/delete', uuid=check_uuid(uuid))
    return {'deleted': uuid}


def upcoming(tvh):
    out = []
    for e in upcoming_entries(tvh):
        out.append({k: e.get(k) for k in ('uuid', 'disp_title', 'disp_subtitle', 'channelname', 'start', 'stop',
                                          'start_real', 'stop_real', 'sched_status', 'status', 'autorec',
                                          'autorec_caption', 'enabled', 'config_name')})
    out.sort(key=lambda e: e.get('start') or 0)
    return {'upcoming': out}


def upcoming_cancel(tvh, uuid):
    """Einen geplanten Termin löschen; eine laufende Aufnahme wird gestoppt (Datei bleibt)."""
    uuid = check_uuid(uuid)
    entry = next((e for e in upcoming_entries(tvh) if e['uuid'] == uuid), None)
    if not entry:
        raise ValueError('Termin nicht (mehr) geplant')
    if entry.get('sched_status') == 'recording':
        tvh.call('dvr/entry/stop', uuid=uuid)
        return {'stopped': uuid}
    tvh.call('idnode/delete', uuid=uuid)  # geplant, noch keine Datei
    return {'deleted': uuid}
