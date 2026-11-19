"""Videotext: aus dem laufenden Stream eines Senders auslesen und seitenweise bereitstellen.

Ein Hintergrund-Thread liest den Stream von TVHeadend, filtert die Videotext-Pakete
(DVB/EBU-Teletext, ETSI EN 300 472 / 300 706) und setzt daraus die Seiten zusammen.
Gezeichnet wird im Browser (Level 1: Farben, Blockgrafik, doppelte Höhe); hier werden nur
die rohen Zeilen (40 Zeichen, 7 Bit) geliefert. Solange niemand abfragt, endet das Lesen
nach IDLE Sekunden wieder – dann ist auch der Tuner wieder frei."""
import re
import threading
import time
import urllib.request

IDLE = 45  # Sekunden ohne Abfrage → Lesen beenden
REV = bytes(int('{:08b}'.format(i)[::-1], 2) for i in range(256))  # Bits sind gespiegelt übertragen


def unham(b):
    """Hamming 8/4: Datenbits stehen an den Positionen 1, 3, 5, 7."""
    return ((b >> 1) & 1) | ((b >> 2) & 2) | ((b >> 3) & 4) | ((b >> 4) & 8)


class Teletext:
    def __init__(self):
        self.pages = {}        # Seite → {Unterseite: {'rows': [40 Bytes] * 25, 'nos': int, 'flags': dict, 'ts': float}}
        self.current = {}      # Magazin → (Seite, Unterseite) der gerade gesendeten Seite
        self.header = None     # zuletzt gesendete Kopfzeile (für Uhrzeit)
        self.lock = threading.Lock()

    def packet(self, data):
        """Ein Teletext-Paket: 2 Bytes Adresse + 40 Bytes Daten (Bits schon gespiegelt)."""
        mrag = unham(data[0]) | (unham(data[1]) << 4)
        mag = (mrag & 7) or 8
        row = mrag >> 3
        d = data[2:]
        if row == 0:
            units, tens = unham(d[0]), unham(d[1])
            s1, s2, s3, s4 = unham(d[2]), unham(d[3]), unham(d[4]), unham(d[5])
            c7_10, c11_14 = unham(d[6]), unham(d[7])
            hdr = bytes([0x20] * 8) + bytes(b & 0x7F for b in d[8:])
            with self.lock:
                self.header = hdr
                if units > 9 or tens > 9:  # Füllkopf (z. B. 0xFF) – keine echte Seite
                    self.current.pop(mag, None)
                    return
                page = mag * 100 + tens * 10 + units
                sub = (s1 | ((s2 & 7) << 4) | (s3 << 8) | ((s4 & 3) << 12)) & 0x3F7F
                flags = {'erase': bool(s2 & 8), 'news': bool(s4 & 4), 'subtitle': bool(s4 & 8),
                         'suppress': bool(c7_10 & 1), 'update': bool(c7_10 & 2)}
                nos = (c11_14 >> 1) & 7
                subs = self.pages.setdefault(page, {})
                p = subs.get(sub)
                if p is None or flags['erase']:
                    p = subs[sub] = {'rows': [bytes(40)] * 25, 'nos': nos, 'flags': flags, 'ts': 0}
                p['rows'][0] = hdr
                p['nos'], p['flags'], p['ts'] = nos, flags, time.time()
                self.current[mag] = (page, sub)
        elif 1 <= row <= 24:
            with self.lock:
                cur = self.current.get(mag)
                if cur:
                    p = self.pages[cur[0]][cur[1]]
                    p['rows'][row] = bytes(b & 0x7F for b in d)
                    p['ts'] = time.time()

    def pes(self, payload):
        """PES-Nutzdaten: data_identifier, dann Einheiten zu je 44 Bytes."""
        if not payload or not (0x10 <= payload[0] <= 0x1F):
            return
        i = 1
        while i + 2 <= len(payload):
            unit_id, length = payload[i], payload[i + 1]
            unit = payload[i + 2:i + 2 + length]
            i += 2 + length
            if unit_id in (0x02, 0x03) and length == 0x2C and len(unit) == 44:
                self.packet(bytes(REV[b] for b in unit[2:44]))


class Capture:
    """Liest den Stream eines Senders, solange der Videotext gebraucht wird."""

    def __init__(self, url, pid):
        self.url, self.pid = url, pid
        self.tt = Teletext()
        self.seen = time.time()
        self.started = time.time()
        self.error = None
        self.alive = True
        threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        buf = bytearray()
        pes = None
        try:
            with urllib.request.urlopen(self.url, timeout=20) as r:
                while self.alive and time.time() - self.seen < IDLE:
                    chunk = r.read(188 * 512)
                    if not chunk:
                        break
                    buf += chunk
                    # auf das Sync-Byte 0x47 ausrichten
                    start = 0
                    while start + 188 <= len(buf):
                        if buf[start] != 0x47:
                            start = buf.find(b'\x47', start + 1)
                            if start < 0:
                                start = len(buf)
                            continue
                        pkt = buf[start:start + 188]
                        start += 188
                        pid = ((pkt[1] & 0x1F) << 8) | pkt[2]
                        if pid != self.pid:
                            continue
                        afc = (pkt[3] >> 4) & 3
                        off = 4 + (1 + pkt[4] if afc & 2 else 0)
                        if not afc & 1 or off >= 188:
                            continue
                        if pkt[1] & 0x40:  # Beginn eines neuen PES-Pakets
                            if pes:
                                self.handle_pes(pes)
                            pes = bytearray(pkt[off:])
                        elif pes is not None:
                            pes += pkt[off:]
                    del buf[:start]
        except Exception as e:  # Sender nicht empfangbar, Tuner belegt …
            self.error = str(e)
        finally:
            self.alive = False

    def handle_pes(self, pes):
        if len(pes) < 9 or pes[:3] != b'\x00\x00\x01':
            return
        self.tt.pes(bytes(pes[9 + pes[8]:]))


class TeletextService:
    def __init__(self, tvh_getter):
        self.tvh = tvh_getter
        self.captures = {}  # Sender-uuid → Capture
        self.lock = threading.Lock()

    def source(self, channel):
        tvh = self.tvh()
        chan = next((c for c in tvh.call('channel/grid', limit=100000).get('entries', []) if c['uuid'] == channel), None)
        if not chan:
            raise ValueError('Sender nicht gefunden')
        pid = None
        for svc in chan.get('services', []):
            pid = next((s.get('pid') for s in tvh.call('service/streams', uuid=svc).get('streams', [])
                        if s.get('type') == 'TELETEXT'), None)
            if pid:
                break
        if not pid:
            raise ValueError('Dieser Sender sendet keinen Videotext')
        body, _ = tvh.get('/playlist/ticket/channel/' + channel)
        m = re.search(r'^(http\S+)', body.decode('utf-8', 'replace'), re.M)
        if not m:
            raise ValueError('TVHeadend liefert keine Stream-Adresse')
        return re.sub(r'([?&]profile=)[^&\s]*', r'\1pass', m.group(1)), pid

    def capture(self, channel):
        if not re.fullmatch(r'[0-9a-f]{32}', channel or ''):
            raise ValueError('Ungültiger Sender')
        with self.lock:
            cap = self.captures.get(channel)
            if not cap or not cap.alive:
                cap = self.captures[channel] = Capture(*self.source(channel))
            cap.seen = time.time()
            return cap

    def page(self, channel, page=100, sub=None):
        cap = self.capture(channel)
        tt = cap.tt
        with tt.lock:
            pages = sorted(tt.pages)
            subs = tt.pages.get(page, {})
            keys = sorted(subs)
            if sub is None or sub not in subs:
                # neueste Unterseite zeigen (rotierende Unterseiten)
                sub = max(keys, key=lambda k: subs[k]['ts']) if keys else None
            p = subs.get(sub) if sub is not None else None
            return {'pages': pages, 'page': page, 'subpages': keys, 'sub': sub,
                    'rows': [list(r) for r in p['rows']] if p else None,
                    'nos': p['nos'] if p else 0, 'flags': p['flags'] if p else {},
                    'header': list(tt.header) if tt.header else None,
                    'subtitle_pages': [n for n in pages if any(x['flags'].get('subtitle') for x in tt.pages[n].values())],
                    'running': cap.alive, 'error': cap.error, 'since': int(time.time() - cap.started)}
