"""Bilder zu langen Sendungen (vor allem Filmen) aus der deutschen Wikipedia.
Das EPG liefert keine Bilder. Gesucht wird im Hintergrund – höchstens eine Anfrage pro
Sekunde, weil Wikipedia sonst mit HTTP 429 abblockt – und das Ergebnis dauerhaft
zwischengespeichert, auch „kein Bild gefunden“."""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

MIN_DURATION = 80 * 60  # nur lange Sendungen
API = 'https://de.wikipedia.org/w/api.php'
USER_AGENT = 'tvh-aufnahmen/1.0 (TVHeadend-Weboberflaeche im Heimnetz)'
# Art der Sendung in der Kurzbeschreibung – „Fernsehsender“ o. Ä. zählt nicht
KINDS = re.compile(r'\b(\w*film|\w*serie|\w*sendung|\w*magazin|\w*reihe|\w*show|dokumentation|\w*doku)\b', re.I)
RETRY_NONE = 30 * 86400  # „nichts gefunden“ nach 30 Tagen erneut versuchen


def norm(title):
    """Titel vergleichbar machen: Klammerzusatz wie „(Film)“ weg, Satzzeichen weg, klein."""
    title = re.sub(r'\s*\([^)]*\)\s*$', '', title or '')
    return re.sub(r'\s+', ' ', re.sub(r'[^\w ]+', ' ', title.lower())).strip()


def wiki_lookup(title):
    """Bester passender Artikel mit Bild oder None. Nur Treffer, deren Titel genau passt und
    die laut Kurzbeschreibung ein Film, eine Serie o. Ä. sind – sonst lieber kein Bild."""
    q = urllib.parse.urlencode({'action': 'query', 'generator': 'search', 'gsrsearch': title, 'gsrlimit': 5,
                                'prop': 'pageimages|description', 'piprop': 'thumbnail|original',
                                'pithumbsize': 400, 'format': 'json'})
    req = urllib.request.Request(API + '?' + q, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as r:
        pages = sorted((json.load(r).get('query') or {}).get('pages', {}).values(), key=lambda p: p.get('index', 0))
    want = norm(title)
    for p in pages:
        if norm(p['title']) == want and KINDS.search(p.get('description') or '') and p.get('thumbnail'):
            return {'thumb': p['thumbnail']['source'], 'image': (p.get('original') or p['thumbnail'])['source'],
                    'page': 'https://de.wikipedia.org/wiki/' + urllib.parse.quote(p['title'].replace(' ', '_')),
                    'caption': p['title'] + (' – ' + p['description'] if p.get('description') else '')}
    return None


class Posters:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.queue = []
        self.wake = threading.Event()
        try:
            with open(path) as f:
                self.cache = json.load(f)
        except (OSError, ValueError):
            self.cache = {}
        # Treffer, die die (evtl. verschärfte) Prüfung nicht mehr bestehen, neu suchen
        self.cache = {t: v for t, v in self.cache.items()
                      if not v.get('poster') or KINDS.search(v['poster'].get('caption', '').split(' – ', 1)[-1])}
        threading.Thread(target=self.worker, daemon=True).start()

    def get(self, title):
        """Bild-Angaben, None (keins gefunden) oder 'pending' (wird gesucht)."""
        with self.lock:
            hit = self.cache.get(title)
            if hit and (hit.get('poster') or time.time() - hit.get('ts', 0) < RETRY_NONE):
                return hit.get('poster')
            if title not in self.queue:
                self.queue.append(title)
                self.wake.set()
        return 'pending'

    def worker(self):
        while True:
            self.wake.wait()
            with self.lock:
                title = self.queue.pop(0) if self.queue else None
                if not self.queue:
                    self.wake.clear()
            if title is None:
                continue
            try:
                poster = wiki_lookup(title)
            except urllib.error.HTTPError as e:
                with self.lock:
                    self.queue.append(title)  # später noch einmal
                    self.wake.set()
                time.sleep(60 if e.code == 429 else 10)
                continue
            except (OSError, ValueError):
                time.sleep(10)  # kein Internet o. Ä. – Titel bleibt ungeklärt und wird beim nächsten Abruf neu angefragt
                continue
            with self.lock:
                self.cache[title] = {'poster': poster, 'ts': int(time.time())}
                self.save()
            time.sleep(1)

    def save(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(self.cache, f, ensure_ascii=False)
        os.replace(tmp, self.path)


def attach(posters, events):
    """Hängt an lange Sendungen das Bild an; gibt die Zahl der noch gesuchten zurück."""
    pending = 0
    for e in events:
        if e.get('stop', 0) - e.get('start', 0) >= MIN_DURATION and e.get('title'):
            p = posters.get(e['title'])
            if p == 'pending':
                e['poster_pending'] = True
                pending += 1
            elif p:
                e['poster'] = p
    return pending
