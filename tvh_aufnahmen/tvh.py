"""Zugriff auf die HTTP-API von TVHeadend 4.3."""
import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request

from .i18n import _


class Utf8DigestAuthHandler(urllib.request.HTTPDigestAuthHandler):
    """Wie HTTPDigestAuthHandler, aber mit UTF-8 statt ASCII – sonst scheitern
    Benutzer oder Passwörter mit Umlauten."""
    ALGOS = {'MD5': hashlib.md5, 'SHA': hashlib.sha1, 'SHA-256': hashlib.sha256}

    def get_algorithm_impls(self, algorithm):
        algo = self.ALGOS.get(algorithm.upper())
        if algo is None:
            raise ValueError(_('srv.digest', algo=algorithm))
        H = lambda x: algo(x.encode('utf-8')).hexdigest()
        KD = lambda s, d: H('%s:%s' % (s, d))
        return H, KD


class Tvh:
    def __init__(self, url, user, password):
        self.url = url.rstrip('/')
        handlers = []
        if user:
            mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
            mgr.add_password(None, self.url, user, password or '')
            handlers += [Utf8DigestAuthHandler(mgr),
                         urllib.request.HTTPBasicAuthHandler(mgr)]
        self.opener = urllib.request.build_opener(*handlers)

    def call(self, path, **params):
        data = urllib.parse.urlencode(params).encode()
        with self.opener.open(self.url + '/api/' + path, data=data, timeout=60) as r:
            body = r.read().decode('utf-8', 'replace')
        return json.loads(body) if body.strip() else {}

    def get(self, path):
        """Rohdaten außerhalb von /api, z. B. Playlists und Senderlogos."""
        with self.opener.open(self.url + path, timeout=60) as r:
            return r.read(), r.headers.get('Content-Type')

    def entries(self):
        seen = {}
        for grid in ('grid', 'grid_finished', 'grid_failed', 'grid_removed'):
            try:
                res = self.call('dvr/entry/' + grid, limit=100000)
            except urllib.error.HTTPError:
                continue
            for e in res.get('entries', []):
                seen[e['uuid']] = e
        return list(seen.values())

    def channels(self):
        res = self.call('channel/grid', limit=100000)
        chans = [{'uuid': c['uuid'], 'name': c.get('name', '')} for c in res.get('entries', [])]
        return sorted(chans, key=lambda c: c['name'].lower())

def entry_info(tvh, uuid):
    res = tvh.call('idnode/load', uuid=uuid)
    if not res.get('entries'):
        raise ValueError(_('srv.rec_not_found'))
    return {p['id']: p.get('value') for p in res['entries'][0]['params']}


def file_moved(tvh, src, dst):
    # TVHeadend 4.3 übernimmt den neuen Pfad, antwortet aber trotzdem mit 404.
    try:
        tvh.call('dvr/entry/filemoved', src=src, dst=dst)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
