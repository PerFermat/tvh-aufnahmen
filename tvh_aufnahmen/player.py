"""Interner Player: Live-TV und Aufnahmen im Browser abspielen.

Browser können das Fernsehformat nicht direkt (MP2-/AC3-Ton, bei SD-Sendern MPEG-2-Bild).
ffmpeg macht daraus MPEG-TS mit H.264-Bild und AAC-Ton, das mpegts.js im Browser abspielt.
H.264 in Originalqualität wird dabei nur umverpackt (kaum Rechenlast); umgerechnet wird nur,
wenn nötig (MPEG-2, HEVC) oder eine kleinere Qualität gewählt ist.

TVHeadend 4.3 kann das mit seinen eigenen Transcode-Profilen nicht zuverlässig (Absturz bei
festem H.264-Profil, „Error applying bitstream filters“ beim Durchreichen) – daher ffmpeg hier."""
import os
import re
import subprocess
import threading
import time

from .files import file_exists
from .tvh import entry_info

# Qualität → (Bildhöhe, Video-Bitrate, x264-Preset); None = Original (H.264 nur umverpacken)
QUALITY = {'pass': None,
           'WLAN-Extern': (720, '3000k', 'ultrafast'),
           'Mobil': (540, '1500k', 'veryfast'),
           'Mobil-sparsam': (360, '500k', 'veryfast')}
AUDIO = {'pass': '160k', 'WLAN-Extern': '128k', 'Mobil': '96k', 'Mobil-sparsam': '64k'}
ENCODES = threading.BoundedSemaphore(2)  # der Raspberry schafft kaum mehr als eine Umrechnung gleichzeitig
SUBS = os.path.expanduser('~/.cache/tvh-aufnahmen/subs')  # Untertitel je Wiedergabe (WebVTT), nur solange sie läuft
SUB_MAX = 7  # Videotext-Untertitel haben kein Ende: bis zum nächsten, höchstens so viele Sekunden


def ffmpeg_args(src, video, quality, start=0, subs=None):
    """subs = (Stream-Auswahl des Videotexts, Zieldatei): Untertitel zusätzlich als WebVTT schreiben."""
    q = QUALITY.get(quality, None) if quality in QUALITY else None
    args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin']
    if subs:
        args += ['-txt_format', 'text', '-txt_page', 'subtitle']  # Videotext-Untertitelseite als Text
    if start:
        args += ['-ss', str(int(start))]
    if not src.startswith('http'):
        args += ['-readrate', '1.5']  # Datei nicht schneller als nötig lesen, sonst puffert der Browser alles
    args += ['-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn']
    if q is None and video == 'h264':
        args += ['-c:v', 'copy']
    else:
        height, rate, preset = q or (576, '2500k', 'veryfast')  # Original, aber kein H.264: SD-Auflösung
        args += ['-vf', 'yadif=0,scale=-2:%d' % height, '-c:v', 'libx264', '-preset', preset,
                 '-tune', 'zerolatency', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
                 '-b:v', rate, '-maxrate', rate, '-bufsize', rate, '-g', '50']
    args += ['-c:a', 'aac', '-ac', '2', '-b:a', AUDIO.get(quality, '128k'), '-f', 'mpegts', 'pipe:1']
    if subs:
        args += ['-map', subs[0], '-c:s', 'webvtt', '-flush_packets', '1', '-f', 'webvtt', subs[1]]
    return args


def needs_encoding(video, quality):
    return not (QUALITY.get(quality) is None and video == 'h264')


def probe_video(src):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name',
                          '-of', 'csv=p=0', src], capture_output=True, text=True, timeout=20).stdout.strip()
    return out.split('\n')[0] if out else ''


def live_source(tvh, channel_uuid):
    """Stream-Adresse (mit Einmal-Ticket, unverändert), Video-Codec und Videotext-Auswahl eines Senders."""
    if not re.fullmatch(r'[0-9a-f]{32}', channel_uuid or ''):
        raise ValueError('Ungültiger Sender')
    body, _ = tvh.get('/playlist/ticket/channel/' + channel_uuid)
    m = re.search(r'^(http\S+)', body.decode('utf-8', 'replace'), re.M)
    if not m:
        raise ValueError('TVHeadend liefert keine Stream-Adresse')
    url = re.sub(r'([?&]profile=)[^&\s]*', r'\1pass', m.group(1))
    video, teletext = '', None
    chan = next((c for c in tvh.call('channel/grid', limit=100000).get('entries', []) if c['uuid'] == channel_uuid), None)
    for svc in (chan or {}).get('services', []):
        for s in tvh.call('service/streams', uuid=svc).get('streams', []):
            if s.get('type') in ('H264', 'MPEG2VIDEO', 'HEVC') and not video:
                video = {'H264': 'h264', 'MPEG2VIDEO': 'mpeg2video', 'HEVC': 'hevc'}[s['type']]
            if s.get('type') == 'TELETEXT' and s.get('pid') and not teletext:
                teletext = '0:i:%d' % s['pid']  # Auswahl über die PID
        if video:
            break
    return url, video, teletext


def recording_source(tvh, uuid):
    fn = entry_info(tvh, uuid).get('filename')
    if not file_exists(fn):
        raise ValueError('Datei nicht gefunden')
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=index,codec_name', '-of', 'csv=p=0', fn],
                         capture_output=True, text=True, timeout=20).stdout.split()
    teletext = next(('0:' + x.split(',')[0] for x in out if x.endswith(',dvb_teletext')), None)
    return fn, probe_video(fn), teletext


def stream(handler, src, video, teletext, quality, start=0, sid=None):
    """ffmpeg starten und die Ausgabe an den Browser durchreichen, bis er abbricht.
    Mit sid (und Videotext im Stream) werden die Untertitel nebenher in SUBS/<sid>.vtt geschrieben."""
    subs = None
    if sid and teletext:
        if not re.fullmatch(r'[a-z0-9]{8,32}', sid):
            raise ValueError('Ungültige Kennung')
        os.makedirs(SUBS, exist_ok=True)
        subs = (teletext, os.path.join(SUBS, sid + '.vtt'))
    if quality not in QUALITY:
        quality = 'pass'
    encode = needs_encoding(video, quality)
    if encode and not ENCODES.acquire(blocking=False):
        raise ValueError('Es laufen schon zwei umgerechnete Streams – der Raspberry schafft nicht mehr. '
                         'Bitte einen beenden oder Qualität „Home“ bei HD-Sendern wählen.')
    proc = None
    try:
        proc = subprocess.Popen(ffmpeg_args(src, video, quality, start, subs), stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL)
        first = proc.stdout.read(188 * 64)
        if not first:
            raise ValueError('Stream lässt sich nicht starten (Sender nicht empfangbar oder Datei defekt?)')
        handler.send_response(200)
        handler.send_header('Content-Type', 'video/mp2t')
        handler.send_header('Cache-Control', 'no-store')
        handler.close_connection = True
        handler.end_headers()
        handler.wfile.write(first)
        while True:
            chunk = proc.stdout.read(65536)
            if not chunk:
                break
            handler.wfile.write(chunk)
    except (BrokenPipeError, ConnectionResetError):
        pass  # Player geschlossen oder gespult
    finally:
        if proc and proc.poll() is None:
            proc.kill()
        if proc:
            proc.wait()
        if encode:
            ENCODES.release()
        if subs and os.path.exists(subs[1]):
            os.remove(subs[1])


def subtitles(sid):
    """Bisher erkannte Untertitel einer laufenden Wiedergabe: [{start, end, text}] in Sekunden."""
    if not re.fullmatch(r'[a-z0-9]{8,32}', sid or ''):
        raise ValueError('Ungültige Kennung')
    path = os.path.join(SUBS, sid + '.vtt')
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            text = f.read()
    except FileNotFoundError:
        return {'cues': [], 'active': False}
    cues = []
    for block in re.split(r'\n\s*\n', text):
        m = re.match(r'\s*(?:(\d+):)?(\d+):(\d+)\.(\d+)\s*-->.*?\n(.*)', block, re.S)
        if m:
            h, mi, se, ms, body = m.groups()
            start = int(h or 0) * 3600 + int(mi) * 60 + int(se) + int(ms) / 1000
            body = body.strip()
            if body:
                cues.append({'start': round(start, 2), 'text': body})
    for i, c in enumerate(cues):  # Ende: nächster Untertitel, höchstens SUB_MAX Sekunden
        nxt = cues[i + 1]['start'] if i + 1 < len(cues) else c['start'] + SUB_MAX
        c['end'] = round(min(nxt, c['start'] + SUB_MAX), 2)
    return {'cues': cues, 'active': True, 'age': round(time.time() - os.path.getmtime(path), 1)}
