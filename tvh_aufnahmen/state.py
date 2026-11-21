"""Abgleich zwischen TVHeadend-Einträgen und Dateien auf der Platte."""
import os
import shutil
import time

from .files import file_exists, scan, suggest


def build_state(tvh, recdir):
    now = time.time()
    entries = tvh.entries()
    known = {os.path.realpath(e['filename']) for e in entries if e.get('filename')}

    # Sender-Vorschlag: der häufigste Sender anderer Aufnahmen im selben Ordner
    dir_channels = {}
    for e in entries:
        if e.get('filename') and e.get('channelname'):
            counts = dir_channels.setdefault(os.path.dirname(e['filename']), {})
            counts[e['channelname']] = counts.get(e['channelname'], 0) + 1

    unknown = []
    for path in sorted(scan(recdir)):
        if os.path.realpath(path) in known:
            continue
        st = os.stat(path)
        sug = suggest(path, st)
        counts = dir_channels.get(os.path.dirname(path))
        sug['channelname'] = max(counts, key=counts.get) if counts else ''
        unknown.append({'path': path, 'rel': os.path.relpath(path, recdir), 'size': st.st_size,
                        'mtime': int(st.st_mtime), 'suggest': sug})

    by_name = {}
    for u in unknown:
        by_name.setdefault(os.path.basename(u['path']), []).append(u['path'])

    missing = []
    for e in entries:
        # Geplante und laufende Aufnahmen haben noch keine Datei – nicht anfassen.
        if e.get('stop', 0) > now or e.get('sched_status') in ('scheduled', 'recording'):
            continue
        fn = e.get('filename') or ''
        if file_exists(fn):
            continue
        cands = by_name.get(os.path.basename(fn), []) if fn else []
        missing.append({'uuid': e['uuid'], 'title': e.get('disp_title') or '',
                        'subtitle': e.get('disp_subtitle') or '',
                        'channel': e.get('channelname') or '', 'start': e.get('start', 0),
                        'status': e.get('status') or '', 'filename': fn,
                        'candidate': cands[0] if len(cands) == 1 else None})
    missing.sort(key=lambda m: m['start'], reverse=True)

    recordings = []
    for e in entries:
        fn = e.get('filename') or ''
        if e.get('sched_status') in ('scheduled', 'recording') or not file_exists(fn):
            continue
        rel = os.path.relpath(fn, recdir) if fn.startswith(recdir + os.sep) else fn
        recordings.append({'uuid': e['uuid'], 'title': e.get('disp_title') or '',
                           'subtitle': e.get('disp_subtitle') or '',
                           'description': e.get('disp_description') or '',
                           'channel': e.get('channelname') or '', 'start': e.get('start', 0),
                           'stop': e.get('stop', 0), 'status': e.get('status') or '',
                           'rel': rel, 'size': os.path.getsize(fn),
                           'played': e.get('playcount') or 0, 'pos': e.get('playposition') or 0,
                           'errors': (e.get('errors') or 0) + (e.get('data_errors') or 0)})
    recordings.sort(key=lambda r: r['start'], reverse=True)

    return {'recdir': recdir, 'recordings': recordings, 'unknown': unknown, 'missing': missing,
            'channels': tvh.channels(), 'known_count': len(entries), 'disk': disk_info(recdir, entries)}


def disk_info(recdir, entries=()):
    """Belegung der Platte mit dem Aufnahmeordner und die Zahl der Aufnahmen der letzten 30 Tage,
    die TVHeadend wegen vollem Speicher nicht machen konnte."""
    du = shutil.disk_usage(recdir)
    since = time.time() - 30 * 86400
    full = sum(1 for e in entries if (e.get('start') or 0) > since
               and (e.get('errorcode') == 403 or 'disk space' in (e.get('status') or '').lower()))
    return {'total': du.total, 'used': du.used, 'free': du.free, 'failed_full': full}
