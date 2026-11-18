"""Archiv vergangener Sendungen. TVHeadend löscht Sendungen aus dem EPG, sobald sie vorbei sind;
damit das Programm auch gestern und heute Vormittag noch zeigen kann, werden laufende und bald
beginnende Sendungen vorher hier abgelegt – eine JSON-Datei pro Tag, 14 Tage lang."""
import json
import os
import threading
import time

ARCHIVE = os.path.expanduser('~/.cache/tvh-aufnahmen/epg-archiv')
KEEP_DAYS = 14
FIELDS = ('eventId', 'channelUuid', 'channelName', 'title', 'subtitle', 'summary', 'description', 'start', 'stop',
          'hd', 'subtitled', 'widescreen', 'audiodesc', 'episodeOnscreen', 'genre', 'ageRating', 'starRating')


def day_key(ts):
    return time.strftime('%Y-%m-%d', time.localtime(ts))


class EpgArchive:
    def __init__(self, folder=ARCHIVE):
        self.folder = folder
        self.lock = threading.Lock()
        self.days = {}  # Tag -> {eventId: Sendung}

    def path(self, key):
        return os.path.join(self.folder, key + '.json')

    def load(self, key):
        if key not in self.days:
            try:
                with open(self.path(key)) as f:
                    self.days[key] = json.load(f)
            except (OSError, ValueError):
                self.days[key] = {}
        return self.days[key]

    def store(self, events):
        """Übernimmt Sendungen ins Archiv (neuere Angaben ersetzen ältere)."""
        changed = set()
        with self.lock:
            for e in events:
                if not e.get('eventId') or not e.get('start'):
                    continue
                key = day_key(e['start'])
                day = self.load(key)
                rec = {k: e[k] for k in FIELDS if e.get(k) not in (None, '', [])}
                if day.get(str(e['eventId'])) != rec:
                    day[str(e['eventId'])] = rec
                    changed.add(key)
            os.makedirs(self.folder, exist_ok=True)
            for key in changed:
                tmp = self.path(key) + '.tmp'
                with open(tmp, 'w') as f:
                    json.dump(self.days[key], f, ensure_ascii=False)
                os.replace(tmp, self.path(key))
        return len(changed)

    def day(self, start, end):
        """Archivierte Sendungen, die zwischen start und end beginnen."""
        with self.lock:
            return [dict(e) for e in self.load(day_key(start)).values() if start <= e['start'] < end]

    def find(self, event_id):
        """Eine archivierte Sendung (für das Detailfenster, wenn TVHeadend sie schon gelöscht hat)."""
        with self.lock:
            for d in range(KEEP_DAYS + 1):
                e = self.load(day_key(time.time() - d * 86400)).get(str(event_id))
                if e:
                    return dict(e)
        return None

    def prune(self):
        """Tage löschen, die älter als KEEP_DAYS sind."""
        limit = day_key(time.time() - KEEP_DAYS * 86400)
        with self.lock:
            for name in os.listdir(self.folder) if os.path.isdir(self.folder) else []:
                if name.endswith('.json') and name[:-5] < limit:
                    os.remove(os.path.join(self.folder, name))
                    self.days.pop(name[:-5], None)
            # Tage, die gerade nicht gebraucht werden, nicht dauerhaft im Speicher halten
            for key in [k for k in self.days if k < day_key(time.time() - 86400)]:
                del self.days[key]


def archive_upcoming(tvh, archive, hours=3):
    """Laufende und in den nächsten Stunden beginnende Sendungen ablegen, bevor TVHeadend sie löscht."""
    flt = [{'field': 'start', 'type': 'numeric', 'value': int(time.time() + hours * 3600), 'comparison': 'lt'}]
    events = tvh.call('epg/events/grid', filter=json.dumps(flt), limit=100000).get('entries', [])
    return archive.store(events)
