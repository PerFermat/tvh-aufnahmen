"""Vorschaubilder für Aufnahmen: ein Standbild bei etwa 15 % der Laufzeit, per ffmpeg erzeugt
und zwischengespeichert. Höchstens zwei gleichzeitig, damit der Raspberry nicht ausgelastet ist."""
import hashlib
import os
import shutil
import subprocess
import threading

from .files import file_exists, probe_duration

CACHE = os.path.expanduser('~/.cache/tvh-aufnahmen/thumbs')
LIMIT = threading.BoundedSemaphore(2)


SIZES = {'small': 320, 'large': 1280}


def thumbnail(filename, size='small'):
    """Pfad zum JPEG (erzeugt es bei Bedarf) oder None, wenn es nicht geht.
    size: 'small' für die Liste, 'large' für die vergrößerte Ansicht."""
    width = SIZES.get(size, SIZES['small'])
    if not file_exists(filename) or not shutil.which('ffmpeg'):
        return None
    st = os.stat(filename)
    key = hashlib.sha1(('%s|%d|%d' % (filename, st.st_size, st.st_mtime)).encode()).hexdigest()
    if width != SIZES['small']:
        key += '-%d' % width
    out = os.path.join(CACHE, key + '.jpg')
    if os.path.exists(out):
        return out if os.path.getsize(out) else None  # leere Datei = ging nicht, nicht erneut versuchen
    os.makedirs(CACHE, exist_ok=True)
    with LIMIT:
        if os.path.exists(out):  # inzwischen von einer parallelen Anfrage erzeugt
            return out if os.path.getsize(out) else None
        dur = probe_duration(filename, st.st_mtime) or 0
        pos = max(60, int(dur * 0.15)) if dur > 120 else 5
        tmp = out + '.tmp.jpg'
        try:
            subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(pos), '-i', filename, '-frames:v', '1',
                            '-vf', 'yadif=0,scale=%d:-2' % width, '-q:v', '4' if width > 320 else '5', '-y', tmp], capture_output=True, timeout=90)
        except subprocess.SubprocessError:
            pass
        if os.path.exists(tmp) and os.path.getsize(tmp):
            os.replace(tmp, out)
            return out
        if os.path.exists(tmp):
            os.remove(tmp)
        open(out, 'wb').close()
        return None
