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


def epg_day(tvh, posters, archive, start=None):
    start = day_start(int(start) if start else time.time())
    end = day_end(start)
    # Zwei Bedingungen auf dasselbe Feld wertet TVHeadend nicht zuverlässig aus.
    flt = [{'field': 'stop', 'type': 'numeric', 'value': start, 'comparison': 'gt'},
           {'field': 'start', 'type': 'numeric', 'value': end, 'comparison': 'lt'}]
    raw = tvh.call('epg/events/grid', filter=json.dumps(flt), limit=100000).get('entries', [])
    # Was bald läuft, gleich archivieren – TVHeadend löscht Sendungen, sobald sie vorbei sind
    archive.store([e for e in raw if e.get('start', 0) < time.time() + 3 * 3600])
    events = [{k: e.get(k) for k in EVENT_FIELDS} for e in raw if start <= e.get('start', 0) < end]
    # Über Sender und Startzeit abgleichen – nach einem Neustart vergibt TVHeadend neue Kennungen
    known = {(e['channelUuid'], e['start']) for e in events}
    seen = set()
    for e in sorted(archive.day(start, end), key=lambda e: -int(e['eventId'])):  # neueste Angaben zuerst
        key = (e.get('channelUuid'), e['start'])
        if key not in known and key not in seen:
            seen.add(key)
            events.append(dict({k: e.get(k) for k in EVENT_FIELDS}, archived=True))
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


def epg_search(tvh, query, fulltext=False):
    """Sucht im ganzen EPG (alle Tage) nach Titel – mit fulltext auch in Untertitel und Beschreibung."""
    query = (query or '').strip()
    if len(query) < 2:
        raise ValueError('Bitte mindestens 2 Zeichen eingeben')
    params = {'title': query, 'limit': 500}
    if fulltext:
        params['fulltext'] = 1
    res = tvh.call('epg/events/grid', **params)
    planned = upcoming_entries(tvh)
    by_event = {e.get('broadcast') for e in planned if e.get('broadcast')}
    by_time = {(e.get('channel'), e.get('start')) for e in planned}
    now = time.time()
    events = []
    for e in res.get('entries', []):
        if e.get('stop', 0) <= now:
            continue
        ev = {k: e.get(k) for k in EVENT_FIELDS + ('channelName',)}
        if len(ev.get('description') or '') > 300:
            ev['description'] = ev['description'][:300].rsplit(' ', 1)[0] + ' …'
        ev['planned'] = e['eventId'] in by_event or (e.get('channelUuid'), e.get('start')) in by_time
        events.append(ev)
    events.sort(key=lambda e: e['start'])
    return {'query': query, 'total': res.get('totalCount', len(events)), 'events': events}


def event_detail(tvh, posters, archive, event_id):
    res = tvh.call('epg/events/load', eventId=int(event_id)).get('entries') or []
    if not res:  # schon vorbei und von TVHeadend gelöscht – aus dem Archiv
        old = archive.find(event_id)
        if not old:
            raise ValueError('Sendung nicht mehr im Programm')
        res = [dict(old, archived=True)]
    attach(posters, res, min_duration=0, urgent=True)  # beim Öffnen für jede Sendung, sofort
    return res[0]


def _norm(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^\w ]+', ' ', (s or '').lower())).strip()


def repeats(tvh, archive, event_id):
    """Weitere Ausstrahlungen einer Sendung in den kommenden Tagen und frühere aus dem Archiv. Hat sie
    einen eigenen Untertitel (Episode), müssen Titel und Untertitel passen, sonst genügt der gleiche Titel."""
    res = tvh.call('epg/events/load', eventId=int(event_id)).get('entries') or []
    ev = res[0] if res else archive.find(event_id)
    if not ev:
        raise ValueError('Sendung nicht gefunden')
    title, sub = _norm(ev.get('title')), _norm((ev.get('subtitle') or '').split('\n')[0])
    first = (ev.get('subtitle') or '').split('\n')[0]
    # „Komödie, USA 1962“ ist kein Episodenname, sondern Genre/Land/Jahr – dann zählt nur der Titel
    genre_line = re.match(r'^[^,]{2,40}, [^,]{1,30} (19|20)\d\d\b', first)
    episode = sub if sub and sub != title and not genre_line else ''
    now = time.time()
    planned = upcoming_entries(tvh)
    by_event = {e.get('broadcast') for e in planned if e.get('broadcast')}
    by_time = {(e.get('channel'), e.get('start')) for e in planned}
    hits = []
    for e in tvh.call('epg/events/grid', title=ev.get('title') or '', limit=500).get('entries', []):
        if e.get('eventId') == ev.get('eventId') or e.get('start', 0) <= now or _norm(e.get('title')) != title:
            continue
        if episode and _norm((e.get('subtitle') or '').split('\n')[0]) != episode:
            continue
        hits.append({'eventId': e['eventId'], 'title': e.get('title'), 'subtitle': e.get('subtitle') or '',
                     'channelName': e.get('channelName'), 'channelUuid': e.get('channelUuid'),
                     'start': e['start'], 'stop': e['stop'], 'hd': e.get('hd'),
                     'planned': e['eventId'] in by_event or (e.get('channelUuid'), e.get('start')) in by_time})
    hits.sort(key=lambda e: e['start'])
    past = []
    for e in archive.by_title(ev.get('title') or '', now):
        if (e.get('channelUuid'), e.get('start')) == (ev.get('channelUuid'), ev.get('start')):
            continue
        if episode and _norm((e.get('subtitle') or '').split('\n')[0]) != episode:
            continue
        past.append({k: e.get(k) for k in ('eventId', 'title', 'subtitle', 'channelName', 'channelUuid', 'start', 'stop', 'hd')})
    return {'title': ev.get('title'), 'episode': bool(episode), 'repeats': hits, 'past': past}


def poster_status(posters, keys, urgent=False):
    return {k: posters.get(k, urgent) for k in keys[:500] if isinstance(k, str)}


def record_event(tvh, event_id, config_uuid=''):
    res = tvh.call('dvr/entry/create_by_event', event_id=int(event_id), config_uuid=config_uuid or '')
    uuids = res.get('uuid') or []
    if not uuids:
        raise ValueError('TVHeadend hat keine Aufnahme angelegt (schon geplant oder Sendung vorbei?)')
    uuid = uuids[0] if isinstance(uuids, list) else uuids
    c = conflicts(tvh)
    return {'uuid': uuid, 'conflict': next((g for g in c['groups'] if uuid in g['uuids']), None), 'tuners': c['tuners']}


def record_manual(tvh, lang, req):
    """Aufnahme von Hand: fester Sender, Titel und Zeitraum (ohne Programmdaten)."""
    title = (req.get('title') or '').strip()
    start, stop = int(req.get('start') or 0), int(req.get('stop') or 0)
    if not title:
        raise ValueError('Bitte einen Titel angeben')
    if not req.get('channel'):
        raise ValueError('Bitte einen Sender wählen')
    if stop <= start:
        raise ValueError('Das Ende muss nach dem Beginn liegen')
    if stop <= time.time():
        raise ValueError('Das Ende liegt in der Vergangenheit')
    if stop - start > 12 * 3600:
        raise ValueError('Länger als 12 Stunden – bitte Zeiten prüfen')
    conf = {'enabled': True, 'channel': req['channel'], 'start': start, 'stop': stop, 'title': {lang: title},
            'comment': 'von Hand angelegt', 'start_extra': max(0, int(req.get('start_extra') or 0)),
            'stop_extra': max(0, int(req.get('stop_extra') or 0))}
    if (req.get('subtitle') or '').strip():
        conf['subtitle'] = {lang: req['subtitle'].strip()}
    if req.get('config'):
        conf['config_name'] = req['config']
    uuid = tvh.call('dvr/entry/create', conf=json.dumps(conf)).get('uuid')
    if not uuid:
        raise ValueError('TVHeadend hat die Aufnahme nicht angelegt')
    c = conflicts(tvh)
    return {'uuid': uuid, 'conflict': next((g for g in c['groups'] if uuid in g['uuids']), None), 'tuners': c['tuners']}


def conflicts(tvh, entries=None):
    """Zeiten, in denen mehr Transponder gleichzeitig gebraucht werden, als es Tuner gibt.
    Mehrere Sender auf demselben Transponder teilen sich einen Tuner. Vor- und Nachlauf zählen mit."""
    entries = upcoming_entries(tvh) if entries is None else entries
    tuners = len(tvh.call('status/inputs').get('entries', [])) or 1
    svc_mux = {s['uuid']: s.get('multiplex_uuid') for s in
               tvh.call('mpegts/service/grid', limit=100000, all=1).get('entries', [])}
    chan_mux = {c['uuid']: next((svc_mux.get(u) for u in c.get('services', []) if svc_mux.get(u)), c['uuid'])
                for c in tvh.call('channel/grid', limit=100000, all=1).get('entries', [])}
    span = lambda e: (e.get('start_real') or e.get('start') or 0, e.get('stop_real') or e.get('stop') or 0)
    active = [e for e in entries if e.get('enabled', True) is not False]
    groups = []
    for t in sorted({span(e)[0] for e in active}):
        now = [e for e in active if span(e)[0] <= t < span(e)[1]]
        muxes = {chan_mux.get(e.get('channel'), e.get('channel')) for e in now}
        if len(muxes) > tuners:
            uu = sorted(e['uuid'] for e in now)
            if not groups or groups[-1]['uuids'] != uu:
                groups.append({'start': t, 'uuids': uu, 'titles': [e.get('disp_title') or '' for e in now],
                               'muxes': len(muxes)})
    return {'tuners': tuners, 'groups': groups, 'uuids': sorted({u for g in groups for u in g['uuids']})}


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
    c = conflicts(tvh)
    for e in out:
        e['conflict'] = e['uuid'] in c['uuids']
    return {'upcoming': out, 'tuners': c['tuners'], 'conflicts': c['groups']}


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
