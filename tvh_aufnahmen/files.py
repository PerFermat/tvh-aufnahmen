"""Videodateien im Aufnahmeverzeichnis finden und Angaben aus dem Dateinamen raten."""
import os
import re
import shutil
import subprocess
from datetime import datetime

VIDEO_EXT = {'.ts', '.mkv', '.mp4', '.m2ts', '.mpg', '.mpeg', '.avi', '.mov'}
DEFAULT_DURATION = 90 * 60
DATE_RE = re.compile(r'(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?:[ T_.-]{0,1}(\d{2})[-_.:h]?(\d{2}))?(?:-\d{1,2}(?!\d))?')


_duration_cache = {}


def probe_duration(path, mtime):
    """Laufzeit per ffprobe, falls installiert; sonst None."""
    key = (path, mtime)
    if key in _duration_cache:
        return _duration_cache[key]
    dur = None
    if shutil.which('ffprobe'):
        try:
            out = subprocess.run(
                ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                 '-of', 'default=nw=1:nk=1', path],
                capture_output=True, text=True, timeout=20).stdout.strip()
            dur = int(float(out)) if out else None
        except (subprocess.SubprocessError, ValueError):
            pass
    _duration_cache[key] = dur
    return dur


def suggest(path, st):
    """Titel, Start und Ende aus Dateiname, Änderungszeit und Laufzeit raten."""
    name = os.path.splitext(os.path.basename(path))[0]
    duration = probe_duration(path, st.st_mtime)
    start = None
    m = DATE_RE.search(name)
    if m:
        y, mo, d, h, mi = m.groups()
        try:
            start = datetime(int(y), int(mo), int(d), int(h or 0), int(mi or 0)).timestamp()
            name = name[:m.start()] + ' ' + name[m.end():]
        except ValueError:
            start = None
    title = re.sub(r'[_]+', ' ', name)
    title = re.sub(r'\s+', ' ', title).strip(' -._')
    mtime = st.st_mtime
    if start is None:
        stop = mtime
        start = stop - (duration or DEFAULT_DURATION)
    elif duration:
        stop = start + duration
    elif start < mtime < start + 6 * 3600:
        stop = mtime
    else:
        stop = start + DEFAULT_DURATION
    return {'title': title or os.path.basename(path), 'start': int(start), 'stop': int(stop),
            'duration_known': duration is not None}


def scan(recdir):
    for root, _dirs, files in os.walk(recdir):
        for f in files:
            if os.path.splitext(f)[1].lower() in VIDEO_EXT:
                yield os.path.join(root, f)


def file_exists(fn):
    return bool(fn) and os.path.isfile(fn)
