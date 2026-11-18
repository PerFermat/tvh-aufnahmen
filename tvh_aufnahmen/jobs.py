"""Hintergrundaufgaben: nächtliche Sicherung und Benachrichtigungen per ntfy.
Beide laufen in einem eigenen Thread und prüfen jede Minute, ob etwas zu tun ist."""
import glob
import json
import os
import re
import threading
import time
import urllib.request

from .backup import write_backup
from .config import save_config
from .epg_archive import archive_upcoming
from .state import disk_info
from .transfer import export_all

STATE = os.path.expanduser('~/.cache/tvh-aufnahmen/jobs.json')
BACKUP_NAME = re.compile(r'^tvheadend-sicherung-\d{4}-\d{2}-\d{2}\.tar\.gz$|^tvh-export-\d{4}-\d{2}-\d{2}\.json$')
LOW_DISK = 0.10  # Warnung unter 10 % frei


def default_backup_dir(recdir):
    """Neben dem Aufnahmeordner: in einen vorhandenen Ordner „Backup“, sonst eigener Ordner."""
    base = os.path.dirname((recdir or '').rstrip('/'))
    if not base:
        return ''
    if os.path.isdir(os.path.join(base, 'Backup')):
        return os.path.join(base, 'Backup', 'tvheadend-sicherungen')
    return os.path.join(base, 'tvheadend-sicherungen')


class Jobs:
    def __init__(self, app):
        self.app = app
        self.lock = threading.Lock()
        try:
            with open(STATE) as f:
                self.state = json.load(f)
        except (OSError, ValueError):
            self.state = {}
        threading.Thread(target=self.loop, daemon=True).start()

    # ---------- Einstellungen ----------
    def settings(self):
        cfg = self.app.cfg
        b = dict({'enabled': True, 'dir': default_backup_dir(cfg.get('recdir')), 'hour': 3, 'minute': 30, 'keep': 14},
                 **(cfg.get('autobackup') or {}))
        n = dict({'url': '', 'done': True, 'failed': True, 'disk': True}, **(cfg.get('notify') or {}))
        return {'autobackup': b, 'notify': n, 'state': self.state, 'backups': self.backups(b['dir'])}

    def update(self, req):
        b, n = req.get('autobackup') or {}, req.get('notify') or {}
        new_b = {'enabled': bool(b.get('enabled')), 'dir': (b.get('dir') or '').strip(),
                 'hour': int(b.get('hour', 3)) % 24, 'minute': int(b.get('minute', 30)) % 60,
                 'keep': max(1, min(365, int(b.get('keep', 14))))}
        if new_b['enabled'] and not new_b['dir']:
            raise ValueError('Bitte einen Ordner für die Sicherungen angeben')
        if new_b['dir']:
            new_b['dir'] = os.path.abspath(os.path.expanduser(new_b['dir']))
            os.makedirs(new_b['dir'], exist_ok=True)
        url = (n.get('url') or '').strip()
        if url and not re.match(r'https?://[^/\s]+/\S+$', url):
            raise ValueError('ntfy-Adresse bitte vollständig angeben, z. B. https://ntfy.sh/mein-geheimes-thema')
        self.app.cfg['autobackup'] = new_b
        self.app.cfg['notify'] = {'url': url, 'done': bool(n.get('done')), 'failed': bool(n.get('failed')),
                                  'disk': bool(n.get('disk'))}
        save_config(self.app.path, self.app.cfg)
        return self.settings()

    def save_state(self):
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        tmp = STATE + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(self.state, f)
        os.replace(tmp, STATE)

    # ---------- Sicherung ----------
    @staticmethod
    def backups(folder):
        if not folder or not os.path.isdir(folder):
            return []
        files = [f for f in os.listdir(folder) if BACKUP_NAME.match(f)]
        return sorted(({'name': f, 'size': os.path.getsize(os.path.join(folder, f)),
                        'mtime': int(os.path.getmtime(os.path.join(folder, f)))} for f in files),
                      key=lambda x: x['name'], reverse=True)

    def run_backup(self):
        """Komplettsicherung und JSON-Export in den Sicherungsordner, alte darüber hinaus löschen."""
        b = self.settings()['autobackup']
        if not b['dir']:
            raise ValueError('Kein Ordner für die Sicherungen eingestellt')
        if not self.lock.acquire(blocking=False):
            raise ValueError('Eine Sicherung läuft gerade')
        try:
            os.makedirs(b['dir'], exist_ok=True)
            day = time.strftime('%Y-%m-%d')
            app = self.app
            tar = os.path.join(b['dir'], 'tvheadend-sicherung-%s.tar.gz' % day)
            info = {'tvh_version': app.tvh.call('serverinfo').get('sw_version'), 'created': time.strftime('%Y-%m-%d %H:%M'),
                    'tvhconf': app.tvhconf, 'recdir': app.cfg.get('recdir') or ''}
            with open(tar + '.tmp', 'wb') as f:
                write_backup(app.tvhconf, f, info, with_epg=False)
            os.replace(tar + '.tmp', tar)
            js = os.path.join(b['dir'], 'tvh-export-%s.json' % day)
            with open(js + '.tmp', 'w') as f:
                json.dump(export_all(app.tvh, app.recdir), f, ensure_ascii=False)
            os.replace(js + '.tmp', js)
            for pattern in ('tvheadend-sicherung-*.tar.gz', 'tvh-export-*.json'):
                for old in sorted(glob.glob(os.path.join(b['dir'], pattern)), reverse=True)[b['keep']:]:
                    if BACKUP_NAME.match(os.path.basename(old)):
                        os.remove(old)
            self.state['backup'] = {'ts': int(time.time()), 'ok': True, 'file': os.path.basename(tar),
                                    'size': os.path.getsize(tar)}
            return self.state['backup']
        except Exception as e:
            self.state['backup'] = {'ts': int(time.time()), 'ok': False, 'error': str(e)}
            self.notify('Sicherung fehlgeschlagen', str(e), 'warning', 4)
            raise
        finally:
            self.save_state()
            self.lock.release()

    # ---------- Benachrichtigungen ----------
    def notify(self, title, text, tags='', priority=3, url=None):
        """Nachricht an ntfy. Als JSON an die Server-Adresse, weil Umlaute in HTTP-Kopfzeilen nicht gehen."""
        url = url or self.settings()['notify']['url']
        if not url:
            return False
        server, topic = url.rstrip('/').rsplit('/', 1)
        body = json.dumps({'topic': topic, 'title': title, 'message': text, 'priority': priority,
                           'tags': [t for t in tags.split(',') if t]}).encode()
        req = urllib.request.Request(server, data=body, headers={'Content-Type': 'application/json',
                                                                 'User-Agent': 'tvh-aufnahmen'})
        with urllib.request.urlopen(req, timeout=15):
            return True

    def check_recordings(self):
        n = self.settings()['notify']
        if not n['url'] or not (n['done'] or n['failed']):
            return
        tvh = self.app.tvh
        recent = time.time() - 2 * 86400
        seen = set(self.state.get('notified', []))
        first = 'notified' not in self.state  # beim ersten Mal nur merken, nicht alles Alte melden
        fresh = []
        for grid, ok in (('grid_finished', True), ('grid_failed', False)):
            for e in tvh.call('dvr/entry/' + grid, limit=100000).get('entries', []):
                if (e.get('stop') or 0) < recent or e['uuid'] in seen:
                    continue
                seen.add(e['uuid'])
                ok_real = ok and not e.get('errorcode')
                if not first and ((ok_real and n['done']) or (not ok_real and n['failed'])):
                    fresh.append((e, ok_real))
        for e, ok in fresh:
            title = ('Aufnahme fertig: ' if ok else 'Aufnahme fehlgeschlagen: ') + (e.get('disp_title') or '')
            text = '%s · %s' % (e.get('channelname') or '', time.strftime('%d.%m. %H:%M', time.localtime(e.get('start') or 0)))
            if not ok:
                text += '\n' + (e.get('status') or 'Fehler')
            self.notify(title, text, 'white_check_mark' if ok else 'warning', 3 if ok else 4)
        self.state['notified'] = sorted(seen)[-2000:]
        self.save_state()

    def check_disk(self):
        n = self.settings()['notify']
        if not n['url'] or not n['disk'] or self.state.get('disk_warned') == time.strftime('%Y-%m-%d'):
            return
        d = disk_info(self.app.recdir)
        if d['free'] < d['total'] * LOW_DISK:
            self.notify('Speicher fast voll', 'Nur noch %.0f GB frei (%.0f %%). Neue Aufnahmen können fehlschlagen.'
                        % (d['free'] / 1e9, d['free'] / d['total'] * 100), 'floppy_disk', 4)
            self.state['disk_warned'] = time.strftime('%Y-%m-%d')
            self.save_state()

    # ---------- Takt ----------
    def loop(self):
        while True:
            time.sleep(60)
            for step in (self.archive_epg, self.maybe_backup, self.check_recordings, self.check_disk):
                try:
                    step()
                except Exception as e:  # ein Fehler darf die anderen Aufgaben nicht stoppen
                    print('Hintergrundaufgabe %s: %s' % (step.__name__, e))

    def archive_epg(self):
        """Alle 10 Minuten laufende und bald beginnende Sendungen archivieren (siehe epg_archive)."""
        if time.time() - getattr(self, 'archived_at', 0) >= 600:
            archive_upcoming(self.app.tvh, self.app.archive)
            self.app.archive.prune()
            self.archived_at = time.time()

    def maybe_backup(self):
        b = self.settings()['autobackup']
        now = time.localtime()
        last = time.strftime('%Y-%m-%d', time.localtime((self.state.get('backup') or {}).get('ts', 0)))
        if (b['enabled'] and b['dir'] and (now.tm_hour, now.tm_min) >= (b['hour'], b['minute'])
                and last != time.strftime('%Y-%m-%d', now)):
            self.run_backup()
