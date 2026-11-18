"""Änderungen an Aufnahmen: importieren, bearbeiten, Datei ersetzen, löschen, bereinigen."""
import json
import os
import shutil
import time

from .files import VIDEO_EXT, file_exists
from .tvh import entry_info, file_moved

UNKNOWN_CHANNEL = 'Unbekannt'


def create_entry(tvh, conf):
    """Legt einen Aufnahme-Eintrag an und gibt die neue uuid zurück (None, wenn TVHeadend ablehnt).
    Ohne Sender legt TVHeadend stillschweigend nichts an (Antwort 200 mit leerem {})."""
    if not conf.get('channel') and not conf.get('channelname'):
        conf = dict(conf, channelname=UNKNOWN_CHANNEL)
    return tvh.call('dvr/entry/create', conf=json.dumps(conf)).get('uuid')


def do_import(tvh, recdir, lang, req):
    path = req['path']
    real = os.path.realpath(path)
    if not real.startswith(os.path.realpath(recdir) + os.sep) or not os.path.isfile(real):
        raise ValueError('Datei nicht gefunden oder außerhalb des Aufnahmeverzeichnisses')
    start, stop = int(req['start']), int(req['stop'])
    if stop <= start:
        raise ValueError('Ende muss nach dem Start liegen')
    if stop >= time.time():
        raise ValueError('Ende muss in der Vergangenheit liegen, sonst entsteht ein Aufnahme-Timer')
    title = (req.get('title') or '').strip()
    if not title:
        raise ValueError('Titel fehlt')
    conf = {'enabled': True, 'start': start, 'stop': stop, 'title': {lang: title},
            'comment': (req.get('comment') or 'nachträglich importiert').strip(),
            'files': [{'filename': path}]}
    for key in ('subtitle', 'description'):
        val = (req.get(key) or '').strip()
        if val:
            conf[key] = {lang: val}
    if req.get('channel'):
        conf['channel'] = req['channel']
    conf['channelname'] = (req.get('channelname') or '').strip()
    uuid = create_entry(tvh, conf)
    if not uuid:
        raise ValueError('TVHeadend hat den Eintrag nicht angelegt: ' + os.path.basename(path))
    return {'uuid': uuid}


def do_delete(tvh, uuids):
    entries = {e['uuid']: e for e in tvh.entries()}
    now = time.time()
    safe = []
    for u in uuids:
        e = entries.get(u)
        # Nur löschen, wenn die Datei wirklich fehlt – sonst würde TVHeadend sie mitlöschen.
        if e and e.get('stop', 0) < now and not file_exists(e.get('filename')):
            safe.append(u)
    if safe:
        tvh.call('idnode/delete', uuid=json.dumps(safe))
    return {'deleted': len(safe), 'skipped': len(uuids) - len(safe)}


def do_move(tvh, moves):
    done = 0
    for m in moves:
        if file_exists(m['src']) or not file_exists(m['dst']):
            continue
        file_moved(tvh, m['src'], m['dst'])
        done += 1
    return {'moved': done, 'skipped': len(moves) - done}


# Felder, die beim Neuanlegen eines Eintrags (Beschreibung ändern) übernommen werden
COPY_FIELDS = ('channel', 'channelname', 'start', 'stop', 'start_extra', 'stop_extra', 'comment',
               'config_name', 'owner', 'creator', 'pri', 'retention', 'removal', 'summary',
               'genre', 'image', 'fanart_image', 'copyright_year', 'age_rating', 'category',
               'keyword', 'credits', 'first_aired', 'content_type', 'playcount', 'playposition')


def do_edit(tvh, lang, req):
    norm = lambda s: (s or '').replace('\r\n', '\n').strip()  # Browser senden \r\n
    title = norm(req.get('title'))
    subtitle = norm(req.get('subtitle'))
    if not title:
        raise ValueError('Titel fehlt')
    info = entry_info(tvh, req['uuid'])
    desc = req.get('description')
    if desc is None or norm(desc) == norm(info.get('disp_description')):
        tvh.call('idnode/save', node=json.dumps({'uuid': req['uuid'], 'disp_title': title,
                                                 'disp_subtitle': subtitle}))
        return {'uuid': req['uuid']}
    return recreate_entry(tvh, req['uuid'], info, lang, title, subtitle, norm(desc))


def recreate_entry(tvh, uuid, info, lang, title, subtitle, desc):
    """Die Beschreibung fertiger Aufnahmen ist in TVHeadend 4.3 schreibgeschützt.
    Deshalb wird der Eintrag mit neuer Beschreibung neu angelegt. Den alten Eintrag
    zu löschen würde die Videodatei mitlöschen – daher zeigt er vorher auf einen
    leeren Platzhalter, und nur der wird mitgelöscht."""
    fn = info.get('filename')
    if not file_exists(fn):
        raise ValueError('Videodatei fehlt, Beschreibung kann nicht geändert werden')
    conf = {k: info[k] for k in COPY_FIELDS if info.get(k) not in (None, '', [], {})}
    conf.update(enabled=True, title={lang: title}, files=[{'filename': fn}])
    if subtitle:
        conf['subtitle'] = {lang: subtitle}
    if desc:
        conf['description'] = {lang: desc}
    placeholder = fn + '.alter-eintrag'
    open(placeholder, 'wb').close()
    new = None
    try:
        file_moved(tvh, fn, placeholder)
        if entry_info(tvh, uuid).get('filename') != placeholder:
            raise ValueError('TVHeadend hat den alten Eintrag nicht umgestellt; nichts geändert')
        new = create_entry(tvh, conf)
        if not new:
            raise ValueError('TVHeadend hat den neuen Eintrag nicht angelegt; nichts geändert')
        tvh.call('idnode/delete', uuid=json.dumps([uuid]))
    except Exception:
        if not new:
            file_moved(tvh, placeholder, fn)  # alten Eintrag zurück auf die Videodatei
        raise
    finally:
        if os.path.exists(placeholder):
            os.remove(placeholder)
    return {'uuid': new}


def do_remove(tvh, uuids):
    """Löscht Aufnahmen samt Datei über TVHeadend."""
    if uuids:
        tvh.call('dvr/entry/remove', uuid=json.dumps(uuids))
    return {'removed': len(uuids)}


def replace_file(tvh, uuid, name, length, body):
    """Ersetzt die Datei einer Aufnahme durch den hochgeladenen Inhalt."""
    old = entry_info(tvh, uuid).get('filename')
    if not file_exists(old):
        raise ValueError('Die bisherige Datei fehlt, Ersetzen nicht möglich')
    ext = os.path.splitext(name)[1].lower()
    if ext not in VIDEO_EXT:
        raise ValueError('Keine Videodatei: ' + name)
    if length <= 0:
        raise ValueError('Leere Datei')
    if length > shutil.disk_usage(os.path.dirname(old)).free - 100 * 1024 * 1024:
        raise ValueError('Nicht genug freier Speicher für die neue Datei')
    new = os.path.splitext(old)[0] + ext
    if new != old and os.path.exists(new):
        raise ValueError('Datei existiert bereits: ' + new)
    tmp = new + '.upload'  # keine Video-Endung: taucht nicht als „nicht eingetragen“ auf
    try:
        with open(tmp, 'wb') as f:
            left = length
            while left:
                chunk = body.read(min(left, 1024 * 1024))
                if not chunk:
                    raise ValueError('Upload abgebrochen')
                f.write(chunk)
                left -= len(chunk)
        os.replace(tmp, new)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    if new != old:
        file_moved(tvh, old, new)
        if entry_info(tvh, uuid).get('filename') != new:
            raise ValueError('TVHeadend hat den neuen Pfad nicht übernommen; alte Datei bleibt erhalten')
        os.remove(old)
    return {'filename': new, 'size': length}
