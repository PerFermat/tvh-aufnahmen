"""Komplettsicherung: den Konfigurationsordner von TVHeadend als .tar.gz sichern und
wiederherstellen. Damit ist nach einer Neuinstallation alles exakt wie vorher –
Aufnahmen, Sender, Timer, Tuner und Benutzer, mit denselben IDs."""
import hmac
import io
import json
import os
import shutil
import subprocess
import tarfile
import time
import urllib.error

from .i18n import _

INFO_NAME = 'tvh-aufnahmen-info.json'
EPG_NAME = 'epgdb.v3'
SKIP = {'.lock', INFO_NAME}


def check_password(cfg, password):
    """Die Sicherung enthält die Benutzer und Passwörter von TVHeadend – deshalb nur
    mit dem Passwort aus den Einstellungen herausgeben."""
    if cfg.get('password') and not hmac.compare_digest((password or '').encode(), cfg['password'].encode()):
        raise ValueError(_('srv.wrong_password'))


def write_backup(conf, out, info, with_epg=True):
    """Packt den Konfigurationsordner als tar.gz direkt in den Ausgabestrom."""
    with tarfile.open(fileobj=out, mode='w|gz') as tar:
        data = json.dumps(info, indent=2, ensure_ascii=False).encode()
        ti = tarfile.TarInfo(INFO_NAME)
        ti.size, ti.mtime = len(data), int(time.time())
        tar.addfile(ti, io.BytesIO(data))
        for name in sorted(os.listdir(conf)):
            if name in SKIP or (name == EPG_NAME and not with_epg):
                continue
            tar.add(os.path.join(conf, name), arcname=name)


def check_archive(path):
    """Prüft das Archiv und gibt die mitgesicherte Info zurück. Erlaubt sind nur
    normale Dateien und Ordner mit relativem Pfad innerhalb des Archivs."""
    try:
        with tarfile.open(path, 'r:gz') as tar:
            members = tar.getmembers()
            info = {}
            for m in members:
                parts = m.name.split('/')
                if m.name.startswith('/') or '..' in parts or not (m.isfile() or m.isdir()):
                    raise ValueError(_('srv.bad_tar_entry', name=m.name))
                if m.name == INFO_NAME:
                    info = json.load(tar.extractfile(m))
    except (tarfile.TarError, EOFError, json.JSONDecodeError) as e:
        raise ValueError(_('srv.bad_backup', err=e))
    if not any(m.name == 'config' and m.isfile() for m in members):
        raise ValueError(_('srv.not_tvh_backup'))
    return info


def systemctl(action, service):
    r = subprocess.run(['sudo', '-n', 'systemctl', action, service],
                       capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise ValueError(_('srv.systemctl_failed', cmd='sudo systemctl %s %s' % (action, service),
                           err=(r.stderr or r.stdout).strip()))


def wait_for_tvh(tvh, seconds=60):
    end = time.time() + seconds
    while True:
        try:
            return tvh.call('serverinfo')
        except urllib.error.HTTPError:
            return {}  # läuft, nur die Anmeldedaten passen nicht mehr (Benutzer aus der Sicherung)
        except OSError:
            if time.time() > end:
                raise ValueError(_('srv.tvh_no_restart'))
            time.sleep(2)


def restore(app, length, body, force=False):
    """Spielt eine hochgeladene Sicherung ein. Der bisherige Ordner bleibt als
    <ordner>.vor-wiederherstellung-<zeit> erhalten."""
    conf = app.tvhconf.rstrip('/')
    service = app.service
    if length <= 0:
        raise ValueError(_('srv.empty_file'))
    parent = os.path.dirname(conf)
    if length > shutil.disk_usage(parent).free - 50 * 1024 * 1024:
        raise ValueError(_('srv.no_space_backup'))
    tmp = conf + '.upload.tar.gz'
    try:
        with open(tmp, 'wb') as f:
            left = length
            while left:
                chunk = body.read(min(left, 1024 * 1024))
                if not chunk:
                    raise ValueError(_('srv.upload_aborted'))
                f.write(chunk)
                left -= len(chunk)
        info = check_archive(tmp)
        running = app.tvh.call('serverinfo').get('sw_version')
        if not force and info.get('tvh_version') and info['tvh_version'] != running:
            return {'confirm': _('srv.version_differs', old=info['tvh_version'], new=running)}
        if service:
            try:
                systemctl('stop', service)
            except ValueError as e:  # noch nichts verändert – Weg von Hand zeigen
                raise ValueError('%s\n\n%s\n' % (e, _('srv.restore_manual')) +
                                 'sudo systemctl stop %s\nmv %s %s.alt\nmkdir %s\n'
                                 'tar xzf /tmp/<backup>.tar.gz -C %s\nsudo systemctl start %s'
                                 % (service, conf, conf, conf, conf, service))
        old = '%s.vor-wiederherstellung-%s' % (conf, time.strftime('%Y%m%d-%H%M%S'))
        os.rename(conf, old)
        try:
            os.mkdir(conf, 0o700)
            with tarfile.open(tmp, 'r:gz') as tar:
                for m in tar.getmembers():
                    if m.name != INFO_NAME:
                        tar.extract(m, conf)
        except Exception:
            shutil.rmtree(conf, ignore_errors=True)
            os.rename(old, conf)
            raise
        finally:
            if service:
                systemctl('start', service)
        wait_for_tvh(app.tvh)
        return {'restored': True, 'previous': old, 'from': info.get('created') or ''}
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
