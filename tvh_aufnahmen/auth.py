"""Anmeldung für den Zugriff von außen.

Benutzer mit Name und Passwort stehen in der Konfiguration („users“, Passwort als scrypt-Hash). Wann eine
Anmeldung nötig ist, bestimmt „auth_mode“: off (nie), external (nur von außen – Heimnetz und VPN kommen
ohne Anmeldung rein) oder always. Ohne Benutzer kommt von außen niemand herein.

Heimnetz: private IPv4-Adressen, IPv6 ULA (fc00::/7), Link-Local und die IPv6-Präfixe dieses Rechners.
Läuft ein Proxy auf diesem Rechner (für HTTPS), sieht das Programm nur dessen Adresse 127.0.0.1 –
dann zählt die letzte Adresse aus X-Forwarded-For, die der Proxy einträgt. Dasselbe gilt für Proxys auf
anderen Rechnern, die in der Konfiguration unter „trusted_proxies“ stehen (z. B. ein Server, der über
einen WireGuard-Tunnel hereinkommt); ein solcher Proxy selbst gilt nie als Heimnetz, auch wenn seine
Adresse privat ist.

Sitzungen: zufälliges Token im Cookie (HttpOnly, SameSite=Lax), gespeichert wird nur sein SHA-256 – so
überstehen Sitzungen einen Neustart, ohne dass die Datei zum Anmelden taugt. Nach MAX_FAILS Fehlversuchen
einer Adresse ist sie für BLOCK Sekunden gesperrt. VLC schickt kein Cookie mit; Links in m3u-Dateien sind
deshalb signiert und zeitlich begrenzt (sign/verify)."""
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import threading
import time

from .i18n import _

COOKIE = 'tvhsid'
SESSIONS = os.path.expanduser('~/.cache/tvh-aufnahmen/sessions.json')
SESSION_DAYS = 30
MAX_FAILS, FAIL_WINDOW, BLOCK = 5, 15 * 60, 15 * 60
LINK_HOURS = 12  # so lange gelten signierte Links (m3u für VLC)
MODES = ('off', 'external', 'always')
PRIVATE = [ipaddress.ip_network(n) for n in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8',
                                               '169.254.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10')]


def hash_password(password):
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return 'scrypt$%s$%s' % (salt.hex(), digest.hex())


def check_password(password, stored):
    try:
        kind, salt, digest = (stored or '').split('$')
    except ValueError:
        return False
    if kind != 'scrypt':
        return False
    test = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1, dklen=32)
    return hmac.compare_digest(test.hex(), digest)


def own_prefixes():
    """Globale IPv6-Präfixe der eigenen Schnittstellen (/proc/net/if_inet6) – Geräte darin sind im Heimnetz."""
    nets = []
    try:
        with open('/proc/net/if_inet6') as f:
            for line in f:
                addr, _idx, plen, scope = line.split()[:4]
                if scope == '00':  # global
                    ip = ipaddress.ip_address(':'.join(addr[i:i + 4] for i in range(0, 32, 4)))
                    nets.append(ipaddress.ip_network('%s/%d' % (ip, int(plen, 16)), strict=False))
    except OSError:
        pass
    return nets


def plain_ip(text):
    ip = ipaddress.ip_address(text.strip().split('%')[0])
    return ip.ipv4_mapped if ip.version == 6 and ip.ipv4_mapped else ip


def client_ip(handler, proxies=()):
    """Absender der Anfrage und ob sie über einen Proxy kam. Bei einem Proxy auf diesem Rechner oder einem
    eingetragenen (proxies) ist der letzte Eintrag in X-Forwarded-For der echte Absender."""
    ip = plain_ip(handler.client_address[0])
    if ip.is_loopback or str(ip) in proxies:
        fwd = handler.headers.get('X-Forwarded-For')
        try:
            return plain_ip(fwd.split(',')[-1]), True
        except (AttributeError, ValueError):
            return ip, True  # ohne lesbare Angabe: als Zugriff des Proxys werten
    return ip, False


class Auth:
    def __init__(self, app):
        self.app = app
        self.lock = threading.Lock()
        self.fails = {}  # Adresse → [Zeitpunkte der Fehlversuche]
        self.nets = PRIVATE + own_prefixes()
        try:
            with open(SESSIONS) as f:
                self.sessions = json.load(f)
        except (OSError, ValueError):
            self.sessions = {}

    # ---------- Einstellungen ----------
    @property
    def users(self):
        return self.app.cfg.get('users') or {}

    @property
    def mode(self):
        m = self.app.cfg.get('auth_mode')
        return m if m in MODES else 'external'

    def secret(self):
        """Schlüssel für signierte Links, beim ersten Gebrauch erzeugt und gespeichert."""
        if not self.app.cfg.get('auth_secret'):
            self.app.save(dict(self.app.cfg, auth_secret=secrets.token_hex(32)))
        return bytes.fromhex(self.app.cfg['auth_secret'])

    # ---------- Wer fragt? ----------
    @property
    def proxies(self):
        return set(self.app.cfg.get('trusted_proxies') or [])

    def is_local(self, handler):
        ip = client_ip(handler, self.proxies)[0]
        if str(ip) in self.proxies:
            return False  # ein eingetragener Proxy selbst (ohne Absenderangabe) ist kein Heimnetz-Gerät
        return any(ip in n for n in self.nets if n.version == ip.version)

    def user(self, handler):
        """Angemeldeter Benutzer dieser Anfrage oder None."""
        m = re.search(r'(?:^|;\s*)%s=([\w-]+)' % COOKIE, handler.headers.get('Cookie') or '')
        if not m:
            return None
        key = hashlib.sha256(m.group(1).encode()).hexdigest()
        with self.lock:
            s = self.sessions.get(key)
            if not s or s['exp'] < time.time() or s['user'] not in self.users:
                return None
            if s['exp'] - time.time() < (SESSION_DAYS - 1) * 86400:  # höchstens einmal am Tag verlängern
                s['exp'] = time.time() + SESSION_DAYS * 86400
                self.save()
            return s['user']

    def allowed(self, handler):
        """Darf diese Anfrage ohne weitere Anmeldung an die Daten? Gibt (ja/nein, Grund) zurück."""
        if self.mode == 'off':
            return True, ''
        if self.mode == 'external' and self.is_local(handler):
            return True, ''
        if self.user(handler):
            return True, ''
        return False, _('srv.login_required') if self.users else _('srv.no_users')

    # ---------- Anmelden ----------
    def blocked(self, ip):
        now = time.time()
        times = [t for t in self.fails.get(ip, []) if now - t < FAIL_WINDOW]
        self.fails[ip] = times
        return len(times) >= MAX_FAILS and now - times[-1] < BLOCK

    def login(self, handler, name, password):
        """Prüft Name und Passwort; gibt das Cookie zurück (Set-Cookie)."""
        ip = str(client_ip(handler, self.proxies)[0])
        with self.lock:
            if self.blocked(ip):
                raise ValueError(_('srv.login_blocked', min=BLOCK // 60))
        u = self.users.get((name or '').strip())
        ok = bool(u) and check_password(password or '', u.get('hash'))
        with self.lock:
            if not ok:
                self.fails.setdefault(ip, []).append(time.time())
                time.sleep(1)  # Durchprobieren bremsen
                raise ValueError(_('srv.login_wrong'))
            self.fails.pop(ip, None)
            token = secrets.token_urlsafe(32)
            now = time.time()
            self.sessions = {k: s for k, s in self.sessions.items() if s['exp'] > now}  # Abgelaufene weg
            self.sessions[hashlib.sha256(token.encode()).hexdigest()] = {'user': name.strip(), 'exp': now + SESSION_DAYS * 86400}
            self.save()
        return self.cookie(handler, token, SESSION_DAYS * 86400)

    def logout(self, handler):
        m = re.search(r'(?:^|;\s*)%s=([\w-]+)' % COOKIE, handler.headers.get('Cookie') or '')
        if m:
            with self.lock:
                self.sessions.pop(hashlib.sha256(m.group(1).encode()).hexdigest(), None)
                self.save()
        return self.cookie(handler, '', 0)

    @staticmethod
    def cookie(handler, token, max_age):
        secure = (handler.headers.get('X-Forwarded-Proto') or '').lower() == 'https'
        return '%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax%s' % (COOKIE, token, max_age, '; Secure' if secure else '')

    def save(self):
        os.makedirs(os.path.dirname(SESSIONS), exist_ok=True)
        tmp = SESSIONS + '.tmp'
        with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f:
            json.dump(self.sessions, f)
        os.replace(tmp, SESSIONS)

    # ---------- Benutzer verwalten ----------
    def info(self, handler, full=True):
        """Stand der Anmeldung; die Benutzerliste nur für berechtigte Anfragen."""
        res = {'mode': self.mode, 'me': self.user(handler), 'local': self.is_local(handler)}
        if full:
            res['users'] = sorted(self.users)
        return res

    def manage(self, handler, req):
        action, name = req.get('action'), (req.get('name') or '').strip()
        users = dict(self.users)
        if action == 'mode':
            if req.get('mode') not in MODES:
                raise ValueError(_('srv.bad_mode'))
            if req['mode'] == 'always' and not self.user(handler):  # sonst sperrt man sich sofort selbst aus
                raise ValueError(_('srv.always_needs_login'))
            self.app.save(dict(self.app.cfg, auth_mode=req['mode']))
        elif action == 'set':
            if not re.fullmatch(r'[\w.@-]{1,40}', name):
                raise ValueError(_('srv.bad_username'))
            if len(req.get('password') or '') < 8:
                raise ValueError(_('srv.password_short'))
            users[name] = {'hash': hash_password(req['password'])}
            self.app.save(dict(self.app.cfg, users=users))
        elif action == 'delete':
            if self.mode == 'always' and set(users) <= {name}:
                raise ValueError(_('srv.last_user'))
            users.pop(name, None)
            self.app.save(dict(self.app.cfg, users=users))
            with self.lock:  # dessen Sitzungen beenden
                self.sessions = {k: s for k, s in self.sessions.items() if s['user'] != name}
                self.save()
        else:
            raise ValueError(_('srv.bad_action'))
        return self.info(handler)

    # ---------- Signierte Links (VLC) ----------
    def sign(self, path):
        exp = int(time.time() + LINK_HOURS * 3600)
        sig = hmac.new(self.secret(), ('%s|%d' % (path, exp)).encode(), hashlib.sha256).hexdigest()[:32]
        return '%s&exp=%d&sig=%s' % (path, exp, sig)

    def verify(self, path, exp, sig):
        try:
            exp = int(exp)
        except (TypeError, ValueError):
            return False
        good = hmac.new(self.secret(), ('%s|%d' % (path, exp)).encode(), hashlib.sha256).hexdigest()[:32]
        return exp > time.time() and hmac.compare_digest(good, sig or '')
