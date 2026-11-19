"""Bilder zu Sendungen (vor allem Filmen) aus der Wikipedia.
Das EPG liefert keine Bilder. Gesucht wird der passende Artikel in der deutschen Wikipedia;
hat er kein Bild – Filmplakate sind dort aus Urheberrechtsgründen nicht erlaubt –, wird über
den Sprachlink das Bild des englischen Artikels genommen, dort gibt es meist das Plakat. Gesucht wird im Hintergrund – höchstens eine Anfrage pro
Sekunde, weil Wikipedia sonst mit HTTP 429 abblockt – und das Ergebnis dauerhaft
zwischengespeichert, auch „kein Bild gefunden“.

Findet die Wikipedia nichts oder nur ein Wikidata-Bild (meist ein Logo), wird bei TVmaze nach einer
Serie gesucht (freie API ohne Schlüssel, Daten unter CC BY-SA, Rücklink zur Serie im Detailfenster)."""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

MIN_DURATION = 80 * 60  # in der Programmübersicht nur für lange Sendungen
DE, EN = 'de.wikipedia.org', 'en.wikipedia.org'
CACHE_VERSION = 4  # 2: Plakat aus der englischen Wikipedia, 3: Wikidata, Jahr, breitere Prüfung, 4: TVmaze
USER_AGENT = 'tvh-aufnahmen/1.0 (https://github.com/PerFermat/tvh-aufnahmen)'  # Wikimedia verlangt Kontakt
# Art der Sendung in der Kurzbeschreibung des Artikels („Filmdrama von …“, „deutsche Kochsendung“).
# „Fernsehsender“ zählt nicht, Personen („Filmschauspieler“, „Regisseur“), Spiele, Bücher, Musik o. Ä. auch nicht.
KINDS = re.compile(r'film|serie|sendung|magazin|reihe|show|doku|drama|thriller|krimi|komödie|western|musical'
                   r'|zeichentrick|animation|sitcom|soap|telenovela|fernsehspiel', re.I)
NOT_PROGRAMME = re.compile(r'schauspieler|regisseur|produzent|moderator|sänger|musiker|autor|unternehmer|journalist'
                           r'|begriffsklärung|computerspiel|videospiel|brettspiel|kartenspiel|roman|buch|comic|album|lied|song|band\b|zeitschrift|zeitung'
                           r'|software|unternehmen|marke', re.I)
# Jahr aus der EPG-Zeile „Genre, Land Jahr“, z. B. „Drama, USA 2005“ oder „Action, USA/GB 2013“
EPG_YEAR = re.compile(r'^[^\n,]{2,40}, [^\n,]{1,30} ((?:19|20)\d\d)\s*$', re.M)
RETRY_NONE = 30 * 86400  # „nichts gefunden“ nach 30 Tagen erneut versuchen


def norm(title):
    """Titel vergleichbar machen: Klammerzusatz wie „(Film)“ weg, Satzzeichen weg, klein."""
    title = re.sub(r'\s*\([^)]*\)\s*$', '', title or '')
    return re.sub(r'\s+', ' ', re.sub(r'[^\w ]+', ' ', title.lower())).strip()


def wiki_query(host, **params):
    params.update(action='query', format='json')
    req = urllib.request.Request('https://%s/w/api.php?%s' % (host, urllib.parse.urlencode(params)),
                                 headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as r:
        pages = (json.load(r).get('query') or {}).get('pages', {}).values()
    return sorted(pages, key=lambda p: p.get('index', 0))


def is_programme(desc):
    return bool(desc and KINDS.search(desc) and not NOT_PROGRAMME.search(desc))


def wikidata_image(item):
    """Plakat, Bild oder Logo aus Wikidata (P3383 Filmplakat, P18 Bild, P154 Logo) als Commons-Datei."""
    req = urllib.request.Request('https://www.wikidata.org/w/api.php?' + urllib.parse.urlencode(
        {'action': 'wbgetclaims', 'entity': item, 'format': 'json'}), headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as r:
        claims = json.load(r).get('claims', {})
    for prop in ('P3383', 'P18', 'P154'):
        for c in claims.get(prop, []):
            name = ((c.get('mainsnak') or {}).get('datavalue') or {}).get('value')
            if isinstance(name, str):
                url = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + urllib.parse.quote(name.replace(' ', '_'))
                return {'thumbnail': {'source': url + '?width=400'}, 'original': {'source': url}, 'src': 'wikidata'}
    return {}


def wiki_lookup(title, year=None):
    """Bester passender Artikel mit Bild oder None. Nur Treffer, deren Titel genau passt und
    die laut Kurzbeschreibung ein Film, eine Serie o. Ä. sind – sonst lieber kein Bild.
    Das Bild kommt aus dem deutschen Artikel, sonst aus dem englischen (dort gibt es
    Filmplakate), sonst aus Wikidata (oft das Logo einer Sendung)."""
    pages = wiki_query(DE, generator='search', gsrsearch=title, gsrlimit=8,
                       prop='pageimages|description|langlinks|pageprops', piprop='thumbnail|original',
                       pithumbsize=400, lllang='en', ppprop='wikibase_item')
    want = norm(title)
    cands = [p for p in pages if norm(p['title']) == want and is_programme(p.get('description'))]
    if year:  # gleichnamige Artikel (Film und Serie): den mit passendem Jahr zuerst
        cands.sort(key=lambda p: year not in (p.get('description') or '') + p['title'])
    if not cands:
        return None
    page = img = cands[0]
    if not img.get('thumbnail') and page.get('langlinks'):
        time.sleep(1)  # Wikipedia nicht zu schnell befragen
        en = wiki_query(EN, titles=page['langlinks'][0]['*'], prop='pageimages', piprop='thumbnail|original',
                        pithumbsize=400, pilicense='any')
        img = en[0] if en else {}
    if not img.get('thumbnail') and (page.get('pageprops') or {}).get('wikibase_item'):
        time.sleep(1)
        img = wikidata_image(page['pageprops']['wikibase_item'])
    if not img.get('thumbnail'):
        return None
    return {'thumb': img['thumbnail']['source'], 'image': (img.get('original') or img['thumbnail'])['source'],
            'page': 'https://de.wikipedia.org/wiki/' + urllib.parse.quote(page['title'].replace(' ', '_')),
            'caption': page['title'] + (' – ' + page['description'] if page.get('description') else ''),
            'src': img.get('src', 'wikipedia')}


def tvmaze_lookup(title, year=None):
    """Plakat einer gleichnamigen Serie bei TVmaze oder None. Folgennummern („(S01/E03)“) fallen weg;
    ohne Treffer wird mit dem Teil vor „ - “ bzw. „: “ gesucht – dort hängt im EPG oft der Folgentitel."""
    name = re.sub(r'\s*\([^)]*\)\s*$', '', re.sub(r'\s*\(S\d+\s*/\s*E\d+\)', '', title)).strip()
    tries = [name]
    short = re.split(r' - |: ', name, maxsplit=1)[0].strip()
    if short != name and len(short) >= 3:
        tries.append(short)
    for i, q in enumerate(tries):
        if i:
            time.sleep(1)
        req = urllib.request.Request('https://api.tvmaze.com/search/shows?' + urllib.parse.urlencode({'q': q}),
                                     headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(req, timeout=15) as r:
            res = json.load(r)
        same = lambda n: norm(n).replace(' ', '') == norm(q).replace(' ', '')  # „Christies“ = „Christie's“
        shows = [x for x in res if same(x['show'].get('name')) and (x['show'].get('image') or {}).get('medium')]
        if year:  # Serie, die zum Jahr der Sendung schon lief, zuerst
            shows.sort(key=lambda x: (x['show'].get('premiered') or '9999')[:4] > year)
        if shows:
            show = shows[0]['show']
            start = (show.get('premiered') or '')[:4]
            return {'thumb': show['image']['medium'], 'image': show['image'].get('original') or show['image']['medium'],
                    'page': show['url'], 'caption': show['name'] + (' (%s)' % start if start else '') + ' – Serie',
                    'src': 'tvmaze'}
    return None


def still_valid(entry):
    p, old = entry.get('poster'), entry.get('v', 1) < CACHE_VERSION
    if not p:
        return not old  # „nichts gefunden“ aus einer älteren Suche: neu versuchen
    if p.get('src') == 'tvmaze':
        return True
    if 'Special:FilePath' in p.get('thumb', ''):
        return not old  # Wikidata-Bild (meist ein Logo) aus einer Suche ohne TVmaze
    return is_programme(p.get('caption', '').split(' – ', 1)[-1])


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
        # Neu suchen: Treffer, die die (evtl. verschärfte) Prüfung nicht mehr bestehen, und
        # „nichts gefunden“ aus einer älteren Suche (vor dem Plakat aus der englischen Wikipedia)
        self.cache = {t: v for t, v in self.cache.items() if still_valid(v)}
        threading.Thread(target=self.worker, daemon=True).start()

    def get(self, key, urgent=False):
        """Bild-Angaben, None (keins gefunden) oder 'pending' (wird gesucht).
        key: Titel oder „Titel|Jahr“ (siehe poster_key).
        urgent: gerade im Detailfenster geöffnet – vor allen anderen suchen."""
        title = key
        with self.lock:
            hit = self.cache.get(title)
            if hit and (hit.get('poster') or time.time() - hit.get('ts', 0) < RETRY_NONE):
                return hit.get('poster')
            if urgent and title in self.queue:
                self.queue.remove(title)
            if title not in self.queue:
                self.queue.insert(0, title) if urgent else self.queue.append(title)
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
                name, _, year = title.partition('|')
                poster = wiki_lookup(name, year or None)
                if not poster or poster.get('src') == 'wikidata':
                    time.sleep(1)
                    poster = tvmaze_lookup(name, year or None) or poster
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
                self.cache[title] = {'poster': poster, 'ts': int(time.time()), 'v': CACHE_VERSION}
                self.save()
            time.sleep(1)

    def save(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(self.cache, f, ensure_ascii=False)
        os.replace(tmp, self.path)


def poster_key(e):
    """Schlüssel für die Bildsuche: Titel, bei Filmen mit Jahr aus „Genre, Land Jahr“ im EPG."""
    m = EPG_YEAR.search((e.get('subtitle') or '') + '\n' + (e.get('description') or ''))
    return e['title'] + ('|' + m.group(1) if m else '')


def attach(posters, events, min_duration=MIN_DURATION, urgent=False):
    """Hängt an Sendungen ab min_duration das Bild an; gibt die Zahl der noch gesuchten zurück."""
    pending = 0
    for e in events:
        if e.get('stop', 0) - e.get('start', 0) >= min_duration and e.get('title'):
            e['poster_key'] = poster_key(e)
            p = posters.get(e['poster_key'], urgent)
            if p == 'pending':
                e['poster_pending'] = True
                pending += 1
            elif p:
                e['poster'] = p
    return pending
