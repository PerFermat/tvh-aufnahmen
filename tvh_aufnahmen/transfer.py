"""Gezielter Export und Import von Sender-Tags, Sendern, Serien-Timern und Aufnahmen als JSON.
Läuft nur über die API und funktioniert deshalb auch mit anderer Hardware oder Version.
Sender werden nach dem Suchlauf über ihre Dienste wiedergefunden, Aufnahmen über den Dateipfad."""
import json
import os
import time

from .files import file_exists
from .i18n import _
from .recordings import COPY_FIELDS, create_entry
from .tvh import entry_info

FORMAT = 'tvh-aufnahmen-export'
SECTIONS = ('tags', 'channels', 'autorecs', 'recordings')
TAG_FIELDS = ('name', 'enabled', 'index', 'internal', 'private', 'icon', 'titled_icon', 'comment')
CHANNEL_FIELDS = ('name', 'number', 'enabled', 'autoname', 'icon', 'epgauto', 'epglimit',
                  'dvr_pre_time', 'dvr_pst_time', 'remote_timeshift')
SERVICE_FIELDS = ('network', 'multiplex', 'sid', 'svcname', 'provider')


def grid(tvh, path):
    # all=1: sonst fehlen deaktivierte Sender
    return tvh.call(path, limit=100000, all=1).get('entries', [])


def lower(s):
    return (s or '').strip().lower()


class Target:
    """Was in TVHeadend gerade vorhanden ist, mit Zuordnungen über Namen statt uuids."""

    def __init__(self, tvh):
        self.tags = grid(tvh, 'channeltag/grid')
        self.channels = grid(tvh, 'channel/grid')
        self.services = grid(tvh, 'mpegts/service/grid')
        self.autorecs = grid(tvh, 'dvr/autorec/grid')
        self.configs = {c['uuid'] for c in grid(tvh, 'dvr/config/grid')}
        self.tag_by_name = {lower(t['name']): t['uuid'] for t in self.tags}
        self.tag_name = {t['uuid']: t['name'] for t in self.tags}
        self.chan_name = {c['uuid']: c.get('name') or '' for c in self.channels}
        self.chan_by_name = {}
        for c in sorted(self.channels, key=lambda c: c.get('number') or 0):
            self.chan_by_name.setdefault(lower(c.get('name')), c['uuid'])
        self.chan_by_service = {s: c['uuid'] for c in self.channels for s in c.get('services', [])}
        self.svc_index = {}
        for s in self.services:
            for key in (('n', s.get('network'), s.get('sid')), ('m', s.get('multiplex'), s.get('sid')),
                        ('s', lower(s.get('svcname')))):
                self.svc_index.setdefault(key, s['uuid'])

    def find_service(self, svc):
        for key in (('n', svc.get('network'), svc.get('sid')), ('m', svc.get('multiplex'), svc.get('sid')),
                    ('s', lower(svc.get('svcname')))):
            if key in self.svc_index and key[-1] not in (None, ''):
                return self.svc_index[key]
        return None

    def channel_uuid(self, name, number=None):
        """Sender über Namen (bei doppelten Namen bevorzugt mit passender Nummer)."""
        if number:
            for c in self.channels:
                if lower(c.get('name')) == lower(name) and c.get('number') == number:
                    return c['uuid']
        return self.chan_by_name.get(lower(name))


def export_all(tvh, recdir):
    t = Target(tvh)
    services = {s['uuid']: {k: s.get(k) for k in SERVICE_FIELDS} for s in t.services}
    out = {'format': FORMAT, 'version': 1, 'exported_at': int(time.time()),
           'tvh_version': tvh.call('serverinfo').get('sw_version'), 'recdir': recdir}
    out['tags'] = [{k: tag.get(k) for k in TAG_FIELDS} for tag in t.tags]
    out['channels'] = [dict({k: c.get(k) for k in CHANNEL_FIELDS},
                            tags=[t.tag_name[u] for u in c.get('tags', []) if u in t.tag_name],
                            services=[services[u] for u in c.get('services', []) if u in services])
                       for c in t.channels]
    out['autorecs'] = []
    for a in t.autorecs:
        a = dict(a)
        a['channelname'] = t.chan_name.get(a.pop('channel', ''), '')
        a['tagname'] = t.tag_name.get(a.pop('tag', ''), '')
        a['old_uuid'] = a.pop('uuid')
        out['autorecs'].append(a)
    out['recordings'] = []
    for e in tvh.entries():
        fn = e.get('filename') or ''
        if e.get('sched_status') in ('scheduled', 'recording') or not file_exists(fn):
            continue
        info = entry_info(tvh, e['uuid'])
        # Sender und Serien-Timer über Namen bzw. alte uuid – die uuids ändern sich bei Neuinstallation
        rec = {k: info.get(k) for k in COPY_FIELDS + ('title', 'subtitle', 'description', 'autorec')
               if k != 'channel' and info.get(k) not in (None, '', [], {})}
        rec['filename'] = fn
        out['recordings'].append(rec)
    return out


def load_export(data):
    if not isinstance(data, dict) or data.get('format') != FORMAT:
        raise ValueError(_('srv.not_export'))
    return data


def plan_import(tvh, recdir, data, sections=SECTIONS, apply=False):
    """Vergleicht den Export mit der laufenden Installation. Mit apply=True wird es auch angelegt –
    in der Reihenfolge Tags, Sender, Serien-Timer, Aufnahmen, damit spätere Teile die
    vorherigen wiederfinden."""
    data = load_export(data)
    result = {}
    autorec_map = {}  # alte uuid → neue uuid, damit Aufnahmen ihren Serien-Timer behalten
    for section in SECTIONS:
        t = Target(tvh)  # nach jedem Teil neu einlesen
        items = []
        for obj in data.get(section) or []:
            items.append(PLANNERS[section](tvh, t, obj, recdir, data, autorec_map,
                                           apply and section in sections))
        result[section] = items
    return result


def item(label, action, detail=''):
    return {'label': label, 'action': action, 'detail': detail}


def plan_tag(tvh, t, tag, recdir, data, autorec_map, apply):
    if lower(tag.get('name')) in t.tag_by_name:
        return item(tag['name'], 'exists')
    if apply:
        tvh.call('channeltag/create', conf=json.dumps(tag))
        return item(tag['name'], 'created')
    return item(tag['name'], 'new')


def plan_channel(tvh, t, ch, recdir, data, autorec_map, apply):
    label = '%s %s' % (ch.get('number') or '', ch.get('name') or '')
    services = [u for u in (t.find_service(s) for s in ch.get('services', [])) if u]
    tags = sorted(t.tag_by_name[lower(n)] for n in ch.get('tags', []) if lower(n) in t.tag_by_name)
    existing = next((t.chan_by_service[u] for u in services if u in t.chan_by_service), None) \
        or t.channel_uuid(ch.get('name'), ch.get('number'))
    if existing:
        cur = next(c for c in t.channels if c['uuid'] == existing)
        changes = {}
        if ch.get('number') and cur.get('number') != ch['number']:
            changes['number'] = ch['number']
        if tags and sorted(cur.get('tags', [])) != tags:
            changes['tags'] = tags
        if bool(cur.get('enabled')) != bool(ch.get('enabled')):
            changes['enabled'] = bool(ch.get('enabled'))
        if not changes:
            return item(label, 'exists')
        detail = ', '.join({'number': 'Nummer', 'tags': 'Tags', 'enabled': 'aktiv'}[k] for k in changes)
        if apply:
            tvh.call('idnode/save', node=json.dumps(dict(changes, uuid=existing)))
            return item(label, 'adjusted', detail)
        return item(label, 'adjust', detail)
    if not services:
        return item(label, 'no_service', _('srv.imp_scan_first'))
    if apply:
        conf = {k: ch[k] for k in ('name', 'number', 'enabled', 'autoname', 'icon', 'epgauto', 'epglimit',
                                   'dvr_pre_time', 'dvr_pst_time', 'remote_timeshift') if ch.get(k) is not None}
        conf.update(services=services, tags=tags)
        if not tvh.call('channel/create', conf=json.dumps(conf)).get('uuid'):
            return item(label, 'error', _('srv.imp_channel_failed'))
        return item(label, 'created')
    return item(label, 'new', _('srv.imp_services', n=len(services)))


def plan_autorec(tvh, t, a, recdir, data, autorec_map, apply):
    label = a.get('name') or a.get('title') or '(ohne Namen)'
    channel = t.channel_uuid(a['channelname']) if a.get('channelname') else ''
    for cur in t.autorecs:
        if (cur.get('title') or '') == (a.get('title') or '') and (cur.get('name') or '') == (a.get('name') or '') \
                and (cur.get('channel') or '') == (channel or ''):
            autorec_map[a.get('old_uuid')] = cur['uuid']
            return item(label, 'exists')
    if a.get('channelname') and not channel:
        if not apply and any(lower(c.get('name')) == lower(a['channelname']) for c in data.get('channels') or []):
            return item(label, 'new', _('srv.imp_channel_from_import', ch=a['channelname']))
        return item(label, 'channel_missing', a['channelname'])
    if apply:
        conf = {k: v for k, v in a.items() if k not in ('channelname', 'tagname', 'old_uuid', 'uuid')}
        conf['channel'] = channel or ''
        conf['tag'] = t.tag_by_name.get(lower(a.get('tagname')), '')
        if conf.get('config_name') not in t.configs:
            conf.pop('config_name', None)  # Aufnahmeprofil der alten Installation → Standardprofil
        new = tvh.call('dvr/autorec/create', conf=json.dumps(conf)).get('uuid')
        if not new:
            return item(label, 'error', _('srv.imp_autorec_failed'))
        autorec_map[a.get('old_uuid')] = new
        return item(label, 'created')
    return item(label, 'new', a.get('channelname') or _('srv.all_channels'))


def new_path(fn, old_recdir, recdir):
    if old_recdir and recdir and fn.startswith(old_recdir.rstrip('/') + '/'):
        return os.path.join(recdir, fn[len(old_recdir.rstrip('/')) + 1:])
    return fn


def plan_recording(tvh, t, rec, recdir, data, autorec_map, apply):
    title = next(iter((rec.get('title') or {}).values()), '') or os.path.basename(rec.get('filename', ''))
    fn = new_path(rec.get('filename') or '', data.get('recdir'), recdir)
    label = '%s (%s)' % (title, os.path.basename(fn))
    if not hasattr(t, 'known_files'):
        t.known_files = {os.path.realpath(e['filename']) for e in tvh.entries() if e.get('filename')}
    if os.path.realpath(fn) in t.known_files:
        return item(label, 'exists')
    if not file_exists(fn):
        return item(label, 'file_missing', fn)
    if rec.get('stop', 0) >= time.time():
        return item(label, 'error', _('srv.imp_end_future'))
    if apply:
        conf = {k: v for k, v in rec.items() if k not in ('channel', 'autorec', 'filename')}
        conf.update(enabled=True, files=[{'filename': fn}])
        channel = t.channel_uuid(rec.get('channelname'))
        if channel:
            conf['channel'] = channel
        if conf.get('config_name') not in t.configs:
            conf.pop('config_name', None)
        if autorec_map.get(rec.get('autorec')):
            conf['autorec'] = autorec_map[rec['autorec']]
        if not create_entry(tvh, conf):
            return item(label, 'error', _('srv.imp_entry_failed'))
        t.known_files.add(os.path.realpath(fn))
        return item(label, 'created')
    return item(label, 'new', fn if fn != rec.get('filename') else '')


PLANNERS = {'tags': plan_tag, 'channels': plan_channel, 'autorecs': plan_autorec,
            'recordings': plan_recording}
