"""Archiv vergangener Sendungen. TVHeadend löscht Sendungen aus dem EPG, sobald sie vorbei sind;
damit das Programm auch vergangene Tage zeigen kann, werden laufende und bald beginnende Sendungen
vorher hier abgelegt – dauerhaft, in einer SQLite-Datenbank.

Eine Sendung ist eindeutig durch Sender und Startzeit (TVHeadend vergibt nach einem Neustart neue
Kennungen). Die Angaben liegen gepackt (zlib) in der Datenbank; geschrieben wird nur, was sich
geändert hat – die SD-Karte wird so geschont. Frühere Ausstrahlungen eines Titels findet die Suche
über den normierten Titel (Spalte tnorm)."""
import glob
import gzip
import json
import os
import re
import sqlite3
import threading
import time
import zlib

FOLDER = os.path.expanduser('~/.cache/tvh-aufnahmen/epg-archiv')
FIELDS = ('eventId', 'channelUuid', 'channelName', 'title', 'subtitle', 'summary', 'description', 'start', 'stop',
          'hd', 'subtitled', 'widescreen', 'audiodesc', 'episodeOnscreen', 'genre', 'ageRating', 'starRating')


def norm_title(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^\w ]+', ' ', (s or '').lower())).strip()


class EpgArchive:
    def __init__(self, folder=FOLDER):
        self.folder = folder
        self.lock = threading.Lock()
        os.makedirs(folder, exist_ok=True)
        self.db = sqlite3.connect(os.path.join(folder, 'epg.sqlite'), check_same_thread=False, uri=True)  # uri: Sicherungskopie schreibgeschützt anhängen
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=NORMAL')
        self.db.execute('''CREATE TABLE IF NOT EXISTS events (
            channel TEXT NOT NULL, start INTEGER NOT NULL, stop INTEGER, event_id INTEGER,
            tnorm TEXT, data BLOB NOT NULL, PRIMARY KEY (channel, start))''')
        self.db.execute('CREATE INDEX IF NOT EXISTS ev_start ON events(start)')
        self.db.execute('CREATE INDEX IF NOT EXISTS ev_id ON events(event_id)')
        self.db.execute('CREATE INDEX IF NOT EXISTS ev_title ON events(tnorm, start)')
        self.db.commit()
        self.migrate()

    def migrate(self):
        """Tagesdateien aus der Zeit vor der Datenbank übernehmen und danach löschen."""
        for path in sorted(glob.glob(os.path.join(self.folder, '*.json')) + glob.glob(os.path.join(self.folder, '*.json.gz'))):
            try:
                with (gzip.open if path.endswith('.gz') else open)(path, 'rt', encoding='utf-8') as f:
                    day = json.load(f)
            except (OSError, ValueError):
                continue
            # älteste Angaben zuerst, damit neuere (höhere Kennung) sie ersetzen
            self.store(sorted(day.values(), key=lambda e: int(e.get('eventId') or 0)))
            os.remove(path)

    def store(self, events):
        """Übernimmt Sendungen ins Archiv (neuere Angaben ersetzen ältere). Gibt die Zahl der
        tatsächlich geänderten Sendungen zurück."""
        rows = []
        for e in events:
            if not e.get('eventId') or not e.get('start') or not e.get('channelUuid'):
                continue
            rec = {k: e[k] for k in FIELDS if e.get(k) not in (None, '', [])}
            data = zlib.compress(json.dumps(rec, ensure_ascii=False, sort_keys=True).encode(), 6)
            rows.append((e['channelUuid'], int(e['start']), int(e.get('stop') or 0), int(e['eventId']),
                         norm_title(e.get('title')), data))
        if not rows:
            return 0
        with self.lock:
            before = self.db.total_changes
            # unveränderte Sendungen nicht neu schreiben (WHERE … IS NOT …)
            self.db.executemany('''INSERT INTO events (channel, start, stop, event_id, tnorm, data) VALUES (?,?,?,?,?,?)
                ON CONFLICT(channel, start) DO UPDATE SET stop=excluded.stop, event_id=excluded.event_id,
                tnorm=excluded.tnorm, data=excluded.data WHERE events.data IS NOT excluded.data''', rows)
            self.db.commit()
            return self.db.total_changes - before

    @staticmethod
    def unpack(row):
        return json.loads(zlib.decompress(row[0]))

    def day(self, start, end):
        """Archivierte Sendungen, die zwischen start und end beginnen."""
        with self.lock:
            rows = self.db.execute('SELECT data FROM events WHERE start >= ? AND start < ?', (start, end)).fetchall()
        return [self.unpack(r) for r in rows]

    def find(self, event_id):
        """Eine archivierte Sendung (für das Detailfenster, wenn TVHeadend sie schon gelöscht hat).
        Kennungen können sich nach einem Neustart von TVHeadend wiederholen – dann die jüngste."""
        with self.lock:
            row = self.db.execute('SELECT data FROM events WHERE event_id = ? ORDER BY start DESC LIMIT 1',
                                  (int(event_id),)).fetchone()
        return self.unpack(row) if row else None

    def by_title(self, title, before, limit=300):
        """Frühere Ausstrahlungen eines Titels (vor dem Zeitpunkt before), neueste zuerst."""
        with self.lock:
            rows = self.db.execute('SELECT data FROM events WHERE tnorm = ? AND start < ? ORDER BY start DESC LIMIT ?',
                                   (norm_title(title), before, limit)).fetchall()
        return [self.unpack(r) for r in rows]

    def backup_to(self, path):
        """Stimmige Kopie der Datenbank (SQLite-Backup, auch während geschrieben wird) nach path."""
        tmp = path + '.tmp'
        if os.path.exists(tmp):
            os.remove(tmp)
        dst = sqlite3.connect(tmp)
        try:
            with self.lock:
                self.db.backup(dst)
        finally:
            dst.close()
        os.replace(tmp, path)
        return os.path.getsize(path)

    def merge_from(self, path):
        """Sendungen aus einer Sicherungskopie übernehmen, die hier fehlen (vorhandene bleiben).
        Gibt die Zahl der übernommenen Sendungen zurück."""
        if not os.path.isfile(path):
            raise ValueError('Keine Sicherungskopie des Archivs gefunden: ' + path)
        with self.lock:
            self.db.execute('ATTACH DATABASE ? AS bak', ('file:%s?mode=ro' % path,))
            try:
                before = self.db.total_changes
                self.db.execute('INSERT OR IGNORE INTO events (channel, start, stop, event_id, tnorm, data) '
                                'SELECT channel, start, stop, event_id, tnorm, data FROM bak.events')
                self.db.commit()
                return self.db.total_changes - before
            except sqlite3.DatabaseError as e:
                raise ValueError('Sicherungskopie des Archivs ist nicht lesbar: %s' % e) from None
            finally:
                self.db.execute('DETACH DATABASE bak')

    def stats(self):
        with self.lock:
            n, first = self.db.execute('SELECT COUNT(*), MIN(start) FROM events').fetchone()
        size = sum(os.path.getsize(p) for p in glob.glob(os.path.join(self.folder, 'epg.sqlite*')))
        return {'events': n, 'since': first, 'bytes': size}


def archive_upcoming(tvh, archive, hours=3):
    """Laufende und in den nächsten Stunden beginnende Sendungen ablegen, bevor TVHeadend sie löscht."""
    flt = [{'field': 'start', 'type': 'numeric', 'value': int(time.time() + hours * 3600), 'comparison': 'lt'}]
    events = tvh.call('epg/events/grid', filter=json.dumps(flt), limit=100000).get('entries', [])
    return archive.store(events)
