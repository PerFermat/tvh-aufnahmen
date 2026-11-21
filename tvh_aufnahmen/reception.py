"""Empfangsverlauf: Signal, SNR und Fehler je Transponder über die Zeit.

Zwei Quellen: Solange ein Tuner arbeitet, legt die Hintergrundaufgabe jede Minute eine Messung ab (SQLite,
KEEP_DAYS Tage). Dazu kommen die Fehlerzähler der fertigen Aufnahmen – die reichen weiter zurück und zeigen
schon vor der ersten Messung, welche Transponder Probleme machen. Wetter trifft alle Transponder zugleich,
eine verstellte Schüssel oder ein schwacher Transponder nur einzelne."""
import os
import sqlite3
import threading
import time

from .epg import tuner_context

PATH = os.path.expanduser('~/.cache/tvh-aufnahmen/empfang.sqlite')
KEEP_DAYS = 60


def mux_name(stream):
    """„11493.75H in DVB-S Netzwerk“ (so meldet es TVHeadend 4.3) oder „DVB-S Netzwerk/11493.75H“ → „11493.75H“."""
    stream = (stream or '').split(' in ')[0]
    parts = [p for p in stream.split('/') if p]
    return parts[1] if len(parts) > 1 else (parts[0] if parts else '')


class Reception:
    def __init__(self, path=PATH):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        self.last = {}  # Tuner → Fehlerzähler der letzten Messung (TVHeadend zählt je Abstimmung hoch)
        with self.lock:
            self.db.execute('CREATE TABLE IF NOT EXISTS samples (ts INTEGER, tuner TEXT, mux TEXT, signal REAL, '
                            'snr REAL, unit TEXT, errors INTEGER, kbps INTEGER)')
            self.db.execute('CREATE INDEX IF NOT EXISTS samples_ts ON samples (ts)')
            self.db.commit()

    def sample(self, tvh):
        """Eine Messung je arbeitendem Tuner. Fehler = neue UNC + CC + TE seit der letzten Messung."""
        now = int(time.time())
        rows = []
        for i in tvh.call('status/inputs').get('entries', []):
            name = i.get('input') or ''
            if not i.get('subs') or not i.get('stream'):
                self.last.pop(name, None)
                continue
            count = (i.get('unc') or 0) + (i.get('cc') or 0) + (i.get('te') or 0)
            prev = self.last.get(name)
            self.last[name] = count
            errors = count - prev if prev is not None and count >= prev else 0
            unit = 'pct' if i.get('snr_scale') == 1 else 'db' if i.get('snr_scale') == 2 else ''
            conv = lambda v, s: v / 65535 * 100 if s == 1 else v / 1000 if s == 2 else None
            rows.append((now, name, mux_name(i['stream']), conv(i.get('signal') or 0, i.get('signal_scale')),
                         conv(i.get('snr') or 0, i.get('snr_scale')), unit, errors, round((i.get('bps') or 0) / 1000)))
        with self.lock:
            if rows:
                self.db.executemany('INSERT INTO samples VALUES (?,?,?,?,?,?,?,?)', rows)
            self.db.execute('DELETE FROM samples WHERE ts < ?', (now - KEEP_DAYS * 86400,))
            self.db.commit()
        return len(rows)

    def history(self, tvh, days=7):
        """Je Transponder: Stundenwerte (SNR-Mittel, Minimum, Fehler) der letzten Tage und die Aufnahmen
        mit Fehlern (aus TVHeadend, auch ältere). Transponder mit den meisten Fehlern zuerst."""
        since = int(time.time()) - days * 86400
        with self.lock:
            rows = self.db.execute(
                'SELECT mux, ts / 3600 * 3600, AVG(snr), MIN(snr), MAX(unit), SUM(errors), AVG(signal) '
                'FROM samples WHERE ts >= ? GROUP BY mux, ts / 3600 ORDER BY 2', (since,)).fetchall()
            first = self.db.execute('SELECT MIN(ts) FROM samples').fetchone()[0]
        muxes = {}
        for mux, hour, snr, snr_min, unit, errors, sig in rows:
            m = muxes.setdefault(mux, {'mux': mux, 'hours': [], 'errors': 0, 'unit': unit, 'recs': [], 'rec_errors': 0})
            m['hours'].append({'t': hour, 'snr': snr, 'min': snr_min, 'errors': errors, 'signal': sig})
            m['errors'] += errors or 0
        # Fertige Aufnahmen: Fehler je Transponder (über den Sender), letzte 90 Tage
        _tuners, chan_mux = tuner_context(tvh)
        names = {m['uuid']: m.get('name') or '' for m in tvh.call('mpegts/mux/grid', limit=10000).get('entries', [])}
        old = time.time() - 90 * 86400
        for e in tvh.call('dvr/entry/grid_finished', limit=100000).get('entries', []):
            if (e.get('start') or 0) < old:
                continue
            mux = names.get(chan_mux.get(e.get('channel')), '')
            if not mux:
                continue
            m = muxes.setdefault(mux, {'mux': mux, 'hours': [], 'errors': 0, 'unit': '', 'recs': [], 'rec_errors': 0})
            err = (e.get('errors') or 0) + (e.get('data_errors') or 0)
            m['recs'].append({'title': e.get('disp_title') or '', 'channel': e.get('channelname') or '',
                              'start': e.get('start'), 'errors': err})
            m['rec_errors'] += 1 if err else 0
        for m in muxes.values():
            m['recs'].sort(key=lambda r: -r['start'])
        out = sorted(muxes.values(), key=lambda m: (-(m['errors'] + m['rec_errors']), m['mux']))
        return {'days': days, 'since': first, 'muxes': out}
