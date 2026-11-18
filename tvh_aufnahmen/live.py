"""Live-TV: Sender mit laufender und folgenden Sendungen, Stream-Playlists, Senderlogos."""
import json
import re
import time
import urllib.parse

EPG_HOURS = 8  # so weit voraus werden Sendungen geladen
LOCAL_HOSTS = ('localhost', '127.0.0.1', '::1')


def live_channels(tvh, upcoming=3):
    now = int(time.time())
    events = {}
    flt = [{'field': 'start', 'type': 'numeric', 'value': now + EPG_HOURS * 3600, 'comparison': 'lt'}]
    for e in tvh.call('epg/events/grid', filter=json.dumps(flt), limit=100000).get('entries', []):
        if e.get('stop', 0) > now and e.get('channelUuid'):
            events.setdefault(e['channelUuid'], []).append(
                {'title': e.get('title') or '', 'subtitle': e.get('subtitle') or '',
                 'start': e.get('start', 0), 'stop': e.get('stop', 0)})
    chans = []
    for c in tvh.call('channel/grid', limit=100000).get('entries', []):
        if not c.get('enabled', True):
            continue
        evs = sorted(events.get(c['uuid'], []), key=lambda e: e['start'])
        current = evs[0] if evs and evs[0]['start'] <= now else None
        icon = re.fullmatch(r'imagecache/(\d+)', c.get('icon_public_url') or '')
        chans.append({'uuid': c['uuid'], 'name': c.get('name') or '', 'number': c.get('number') or 0,
                      'icon': '/api/icon?id=' + icon.group(1) if icon else '',
                      'now': current, 'next': evs[1 if current else 0:][:upcoming]})
    chans.sort(key=lambda c: (c['number'] or 1 << 30, c['name'].lower()))
    return {'time': now, 'channels': chans}


def channel_playlist(tvh, uuid, client_host):
    """M3U von TVHeadend mit Einmal-Ticket statt Passwort. Zeigt der Server auf localhost,
    werden die Adressen auf den Rechner umgeschrieben, über den der Browser zugreift."""
    if not re.fullmatch(r'[0-9a-f]{32}', uuid or ''):
        raise ValueError('Ungültiger Sender')
    body, _ctype = tvh.get('/playlist/ticket/channel/' + uuid)
    text = body.decode('utf-8', 'replace')
    base = urllib.parse.urlsplit(tvh.url)
    client = urllib.parse.urlsplit('//' + (client_host or '')).hostname
    if base.hostname in LOCAL_HOSTS and client and client not in LOCAL_HOSTS:
        netloc = client if base.port is None else '%s:%d' % (client, base.port)
        text = text.replace('%s://%s' % (base.scheme, base.netloc), '%s://%s' % (base.scheme, netloc))
    m = re.search(r'#EXTINF:[^\n]*,([^\n]+)', text)
    return (m.group(1).strip() if m else 'Sender'), text.encode()


def channel_icon(tvh, icon_id):
    if not re.fullmatch(r'\d+', icon_id or ''):
        raise ValueError('Ungültiges Logo')
    data, ctype = tvh.get('/imagecache/' + icon_id)
    if not ctype or not ctype.startswith('image/'):
        ctype = ('image/png' if data[:8] == b'\x89PNG\r\n\x1a\n' else
                 'image/jpeg' if data[:3] == b'\xff\xd8\xff' else
                 'image/gif' if data[:4] == b'GIF8' else
                 'image/svg+xml' if b'<svg' in data[:500] else 'application/octet-stream')
    return data, ctype
