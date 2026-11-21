"""Sendersuchlauf: neu scannen, neue TV-Sender finden und anlegen, Sender löschen, die es nicht mehr gibt.
Ausgewertet werden alle freien und verschlüsselten Dienste; Sprache und Verschlüsselung filtert die
Oberfläche. Das Ergebnis wird je Suchlauf zwischengespeichert (die Tonspuren abzufragen dauert)."""
import json
import os
import re
import time

from .i18n import _

TV_TYPES = {1, 17, 22, 25, 31, 32}  # SD, MPEG2-HD, AVC-SD, AVC-HD, HEVC, HEVC-UHD
VIDEO = {'MPEG2VIDEO', 'H264', 'HEVC'}
AUDIO = {'MPEG2AUDIO', 'AC3', 'EAC3', 'AAC', 'MP4A'}
# ISO 639-2: bibliografische Codes (z. B. „ger“) auf die terminologischen („deu“) abbilden, damit beide zusammenfallen
B2T = {'ger': 'deu', 'fre': 'fra', 'dut': 'nld', 'chi': 'zho', 'cze': 'ces', 'gre': 'ell', 'per': 'fas', 'rum': 'ron',
       'slo': 'slk', 'alb': 'sqi', 'arm': 'hye', 'baq': 'eus', 'bur': 'mya', 'geo': 'kat', 'ice': 'isl', 'mac': 'mkd',
       'mao': 'mri', 'may': 'msa', 'tib': 'bod', 'wel': 'cym', 'scc': 'srp', 'scr': 'hrv'}
CACHE = {}  # Zeitpunkt des Suchlaufs -> Auswertung der Dienste


def lang_code(code):
    code = (code or '').strip().lower()[:3]
    if code in ('und', 'zxx', 'mis'):  # unbestimmt, kein Sprachinhalt – wie ohne Angabe
        return ''
    return B2T.get(code, code)
# Testkanäle und Altlasten, die Betreiber parallel ausstrahlen
JUNK = re.compile(r'sendersuchlauf|astra demo|^alt_|_alt$|^\.|\btest\b|^tmp|^dummy|^service \d+$|^\d+$', re.I)
ADULT = re.compile(r'sex|erotik|babes|babestation|dates? tv|treff tv|girls tv', re.I)
# TVHeadend aktualisiert last_seen nur grob (höchstens etwa täglich) – deshalb mit Spielraum vergleichen
SEEN_SLACK = 2 * 86400
STAMP = os.path.expanduser('~/.cache/tvh-aufnahmen/scan-start')


def grid(tvh, path):
    return tvh.call(path, limit=100000, all=1).get('entries', [])


def scan_started():
    try:
        with open(STAMP) as f:
            return int(f.read())
    except (OSError, ValueError):
        return 0


def scan_start(tvh):
    nets = [n['uuid'] for n in grid(tvh, 'mpegts/network/grid')]
    if not nets:
        raise ValueError(_('srv.no_network'))
    os.makedirs(os.path.dirname(STAMP), exist_ok=True)
    with open(STAMP, 'w') as f:
        f.write(str(int(time.time())))
    tvh.call('mpegts/network/scan', uuid=json.dumps(nets))
    return scan_status(tvh)


def scan_status(tvh):
    t0 = scan_started()
    muxes = grid(tvh, 'mpegts/mux/grid')
    queued = sum(n.get('scanq_length') or 0 for n in grid(tvh, 'mpegts/network/grid'))
    active = sum(1 for m in muxes if m.get('scan_state') in (2, 3))  # 2 = wartet, 3 = läuft
    # Erfolgreich gescannt: neues Datum. Ohne Empfang setzt TVHeadend kein neues Datum, nur das Ergebnis „fehlgeschlagen“.
    done = sum(1 for m in muxes if t0 and (m.get('scan_last') or 0) >= t0)
    failed = sorted({m['name'] for m in muxes if m.get('scan_result') == 2 and (m.get('scan_last') or 0) < t0})
    return {'started': t0, 'muxes': len(muxes), 'scanned': done, 'queued': queued, 'active': active,
            'running': bool(t0) and (queued > 0 or active > 0), 'failed': failed}


def base_name(name):
    return re.sub(r'\s+(hd|uhd|sd)$', '', (name or '').lower().strip())


def candidates(tvh, t0, chans, svcs):
    """Alle TV-Dienste ohne Sender, die beim Suchlauf gesehen wurden, mit Sprache und Verschlüsselung.
    Gruppe: new (neu), other (andere Fassung eines vorhandenen Senders), unknown (Tonspur ohne Sprache),
    adult (Erotik/Kontakt)."""
    if t0 in CACHE:
        return CACHE[t0]
    fresh = t0 - SEEN_SLACK
    names = {(c.get('name') or '').lower() for c in chans} | {base_name(c.get('name')) for c in chans}
    # Regional- oder Länderfassung eines vorhandenen Senders: gleiches erstes Wort („WDR HD Aachen“ zu
    # „WDR HD Köln“, „SAT.1 Bayern“, „RTL Austria“)
    first = lambda n: (n or '').lower().split(' ')[0]
    firsts = {first(c.get('name')) for c in chans if len(first(c.get('name'))) >= 2}
    items, seen = [], set()
    for s in sorted(svcs.values(), key=lambda s: -(s.get('dvb_servicetype') or 0)):  # HD-Fassung zuerst
        name = (s.get('svcname') or '').strip()
        enc = bool(s.get('encrypted'))
        if (s.get('channel') or s.get('dvb_servicetype') not in TV_TYPES or not name or JUNK.search(name)
                or (s.get('last_seen') or 0) < fresh or (name.lower(), enc) in seen):
            continue
        streams = tvh.call('service/streams', uuid=s['uuid']).get('streams', [])
        video = [x for x in streams if x.get('type') in VIDEO]
        langs = [lang_code(x.get('language')) for x in streams if x.get('type') in AUDIO]
        if not video or not langs:
            continue  # gerade kein Bild oder Ton (z. B. Sendepause) – nicht sicher genug
        main = next((l for l in langs if l), '')
        if ADULT.search(name):
            group = 'adult'
        elif not main:
            group = 'unknown'
        elif name.lower() in names or base_name(name) in names or first(name) in firsts:
            group = 'other'
        else:
            group = 'new'
        items.append({'uuid': s['uuid'], 'name': name, 'provider': s.get('provider') or '', 'mux': s.get('multiplex'),
                      'langs': langs[:4], 'lang': main, 'encrypted': enc, 'group': group,
                      'hd': (video[0].get('height') or 0) >= 700 or s['dvb_servicetype'] in (17, 25, 31, 32)})
        seen.add((name.lower(), enc))  # gleicher Name auf mehreren Transpondern: nur einmal
    key = lambda x: (x['provider'].lower(), x['name'].lower())
    CACHE.clear()
    CACHE[t0] = sorted(items, key=key)
    return CACHE[t0]


def scan_result(tvh):
    """Wertet den letzten Suchlauf aus: Kandidaten für neue Sender (siehe candidates) und Sender, von denen
    kein Dienst in den zwei Tagen vor dem Suchlauf oder danach gesehen wurde."""
    t0 = scan_started()
    if not t0:
        raise ValueError(_('srv.no_scan'))
    fresh = t0 - SEEN_SLACK
    status = scan_status(tvh)
    chans = grid(tvh, 'channel/grid')
    svcs = {s['uuid']: s for s in grid(tvh, 'mpegts/service/grid')}
    items = [i for i in candidates(tvh, t0, chans, svcs) if not (svcs.get(i['uuid']) or {}).get('channel')]
    languages = {}
    for i in items:
        if i['lang']:
            languages[i['lang']] = languages.get(i['lang'], 0) + 1
    autorecs = grid(tvh, 'dvr/autorec/grid')
    dead = []
    for c in chans:
        ss = [svcs.get(u) for u in c.get('services', [])]
        if any(s and (s.get('last_seen') or 0) >= fresh for s in ss):
            continue
        dead.append({'uuid': c['uuid'], 'name': c.get('name') or '', 'number': c.get('number') or 0,
                     'enabled': c.get('enabled'),
                     'last_seen': max([s.get('last_seen') or 0 for s in ss if s] or [0]),
                     'autorecs': [a.get('name') or a.get('title') for a in autorecs if a.get('channel') == c['uuid']]})
    return {'status': status, 'items': items, 'languages': languages,
            'dead': sorted(dead, key=lambda d: d['number']),
            'next_number': max([c.get('number') or 0 for c in chans] or [0]) + 1}


def scan_add(tvh, uuids):
    """Legt für die Dienste Sender an, fortlaufend nach der höchsten vorhandenen Nummer, und schaltet die
    Dienste ein, falls sie in TVHeadend abgeschaltet sind."""
    chans = grid(tvh, 'channel/grid')
    svcs = {s['uuid']: s for s in grid(tvh, 'mpegts/service/grid')}
    number = max([c.get('number') or 0 for c in chans] or [0])
    added = []
    for u in uuids:
        s = svcs.get(u)
        if not s or s.get('channel'):
            continue  # unbekannt oder inzwischen schon zugeordnet
        number += 1
        res = tvh.call('channel/create', conf=json.dumps({'enabled': True, 'autoname': True,
                                                          'name': s.get('svcname') or '', 'number': number,
                                                          'services': [u]}))
        if res.get('uuid'):
            if not s.get('enabled'):  # abgeschaltete Dienste liefern kein Bild, der Sender bliebe stumm
                tvh.call('idnode/save', node=json.dumps({'uuid': u, 'enabled': 1}))
            added.append({'name': s.get('svcname'), 'number': number})
        else:
            number -= 1
    # Programmdaten: Transponder, deren EPG-Abfrage abgeschaltet ist (z. B. weil dort bisher kein
    # eigener Sender lag), für die neuen Sender wieder auf „automatisch“ stellen
    muxes = {svcs[u].get('multiplex_uuid') for u in uuids if u in svcs}
    for m in grid(tvh, 'mpegts/mux/grid'):
        if m['uuid'] in muxes and m.get('epg') == 0:
            tvh.call('idnode/save', node=json.dumps({'uuid': m['uuid'], 'epg': 1}))
    return {'added': added}


def scan_delete(tvh, uuids):
    """Löscht Sender einzeln (gemischte Listen löscht TVHeadend nur teilweise)."""
    known = {c['uuid']: c.get('name') for c in grid(tvh, 'channel/grid')}
    deleted = []
    for u in uuids:
        if u in known:
            tvh.call('idnode/delete', uuid=u)
            deleted.append(known[u])
    return {'deleted': deleted}
