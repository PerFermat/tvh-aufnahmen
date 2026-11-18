"""Status-Seite: Tuner mit Signal, laufende Aufnahmen und Streams, Zustand des Raspberry."""
import os
import time

from .state import disk_info

STARTED = time.time()


def read(path, default=''):
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return default


def level(value, scale):
    """Signal/SNR von TVHeadend: Skala 1 = relativ (0–65535), 2 = absolut in 1/1000 (dB bzw. dBm)."""
    if scale == 1:
        return {'pct': round(value / 65535 * 100), 'text': '%d %%' % round(value / 65535 * 100)}
    if scale == 2:
        return {'db': value / 1000, 'text': '%.1f dB' % (value / 1000)}
    return None


def tuners(tvh):
    out = []
    for i in tvh.call('status/inputs').get('entries', []):
        out.append({'name': i.get('input') or '', 'stream': i.get('stream') or '', 'subs': i.get('subs') or 0,
                    'signal': level(i.get('signal') or 0, i.get('signal_scale')),
                    'snr': level(i.get('snr') or 0, i.get('snr_scale')),
                    'ber': i.get('ber') or 0, 'unc': i.get('unc') or 0, 'cc': i.get('cc') or 0, 'te': i.get('te') or 0,
                    'kbps': round((i.get('bps') or 0) / 1000)})
    return out


def system():
    mem = {}
    for line in read('/proc/meminfo').splitlines():
        k, _, v = line.partition(':')
        mem[k] = int(v.split()[0]) * 1024 if v.split() else 0
    temp = read('/sys/class/thermal/thermal_zone0/temp').strip()
    return {'temp': int(temp) / 1000 if temp.isdigit() else None, 'load': os.getloadavg(), 'cpus': os.cpu_count(),
            'mem_total': mem.get('MemTotal', 0), 'mem_avail': mem.get('MemAvailable', 0),
            'uptime': float((read('/proc/uptime') or '0').split()[0]), 'tool_uptime': time.time() - STARTED,
            'model': read('/proc/device-tree/model').strip('\x00\n ')}


def status(tvh, recdir):
    subs = [{'title': s.get('title') or '', 'channel': s.get('channel') or '', 'service': s.get('service') or '',
             'state': s.get('state') or '', 'start': s.get('start') or 0, 'errors': s.get('errors') or 0,
             'kbps_in': round((s.get('in') or 0) * 8 / 1000), 'client': s.get('hostname') or s.get('username') or ''}
            for s in tvh.call('status/subscriptions').get('entries', [])]
    recording = [{'title': e.get('disp_title') or '', 'channel': e.get('channelname') or '', 'start': e.get('start'),
                  'stop': e.get('stop'), 'size': e.get('filesize') or 0}
                 for e in tvh.call('dvr/entry/grid_upcoming', limit=1000).get('entries', [])
                 if e.get('sched_status') == 'recording']
    return {'version': tvh.call('serverinfo').get('sw_version'), 'tuners': tuners(tvh), 'subscriptions': subs,
            'recording': recording, 'system': system(), 'disk': disk_info(recdir),
            'clients': len(tvh.call('status/connections').get('entries', []))}
