#!/bin/bash
# Installiert oder aktualisiert tvh-aufnahmen auf dem TVHeadend-Rechner.
#
#   curl -fsSL https://raw.githubusercontent.com/PerFermat/tvh-aufnahmen/main/install.sh | sudo bash
#
# Ablauf: Benutzer von TVHeadend ermitteln, Pakete (python3, ffmpeg, optional comskip) installieren, die neueste
# Version von GitHub laden, nach ~<benutzer>/tvh-aufnahmen kopieren, systemd-Dienst einrichten und starten.
# Erneut ausgeführt aktualisiert es die Programmdateien; Einstellungen (~/.config/tvh-aufnahmen.json) und Cache
# bleiben. Optionen: siehe --help.
# shellcheck disable=SC1111  # deutsche Anführungszeichen in Meldungen sind gewollt
set -euo pipefail

REPO="PerFermat/tvh-aufnahmen"
SERVICE="tvh-aufnahmen"
UNIT="/etc/systemd/system/$SERVICE.service"
SUDOERS="/etc/sudoers.d/$SERVICE"

# ---------- Sprache der Meldungen (Deutsch, sonst Englisch) ----------
case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in de*) DE=1 ;; *) DE=0 ;; esac
t() { if [ "$DE" = 1 ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
say() { printf '\033[1;34m==>\033[0m %s\n' "$(t "$1" "$2")"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$(t "$1" "$2")" >&2; }
die() { printf '\033[1;31mFehler/Error:\033[0m %s\n' "$(t "$1" "$2")" >&2; exit 1; }

usage() {
  if [ "$DE" = 1 ]; then cat <<'EOF'
Aufruf: install.sh [Optionen]
  --user NAME        Benutzer, unter dem TVHeadend läuft (sonst automatisch ermittelt)
  --dir PFAD         Zielordner (Standard: ~<benutzer>/tvh-aufnahmen)
  --port N           Port der Oberfläche (Standard: 8099)
  --version TAG      bestimmte Version, z. B. v1.0, oder „main“ für den neuesten Stand (Standard: neuestes Release)
  --from ORDNER      aus einem lokalen Ordner statt von GitHub installieren
  --comskip / --no-comskip       Werbeerkennung (Paket comskip) installieren oder nicht
  --restore-rights / --no-restore-rights
                     dem Benutzer erlauben, TVHeadend für das Einspielen einer Komplettsicherung
                     zu stoppen und zu starten (sudo-Regel nur für diese zwei Befehle)
  --no-service       keinen systemd-Dienst einrichten
  --yes              nichts fragen, Standardantworten nehmen
  --uninstall        Dienst und Programmdateien entfernen (Einstellungen und Cache bleiben)
EOF
  else cat <<'EOF'
Usage: install.sh [options]
  --user NAME        user Tvheadend runs as (detected automatically otherwise)
  --dir PATH         target folder (default: ~<user>/tvh-aufnahmen)
  --port N           port of the interface (default: 8099)
  --version TAG      specific version, e.g. v1.0, or "main" for the latest code (default: latest release)
  --from FOLDER      install from a local folder instead of GitHub
  --comskip / --no-comskip       install ad detection (package comskip) or not
  --restore-rights / --no-restore-rights
                     allow the user to stop and start Tvheadend for restoring a full backup
                     (sudo rule for exactly these two commands)
  --no-service       do not set up a systemd service
  --yes              ask nothing, use the defaults
  --uninstall        remove service and program files (settings and cache stay)
EOF
  fi
}

TVH_USER="" DIR="" PORT="" VERSION="" FROM="" COMSKIP="" RIGHTS="" NOSERVICE=0 YES=0 UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --user) TVH_USER="$2"; shift ;;
    --dir) DIR="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --version) VERSION="$2"; shift ;;
    --from) FROM="$2"; shift ;;
    --comskip) COMSKIP=1 ;; --no-comskip) COMSKIP=0 ;;
    --restore-rights) RIGHTS=1 ;; --no-restore-rights) RIGHTS=0 ;;
    --no-service) NOSERVICE=1 ;;
    --yes|-y) YES=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
  shift
done

[ "$(id -u)" = 0 ] || die "Bitte mit sudo bzw. als root ausführen." "Please run with sudo or as root."
[ "$(uname -s)" = Linux ] || die "Nur für Linux." "Linux only."

# Ja/Nein-Frage; bei „curl | bash“ ist stdin das Skript, deshalb vom Terminal lesen
ask() {  # ask "Frage" "question" Standard(1/0)
  local def="$3" ans
  if [ "$YES" = 1 ] || ! { : </dev/tty; } 2>/dev/null; then echo "$def"; return; fi
  printf '%s %s ' "$(t "$1" "$2")" "$([ "$def" = 1 ] && t '[J/n]' '[Y/n]' || t '[j/N]' '[y/N]')" >/dev/tty
  read -r ans </dev/tty || ans=""
  case "$ans" in [JjYy]*) echo 1 ;; [Nn]*) echo 0 ;; *) echo "$def" ;; esac
}
has_systemd() { [ "$NOSERVICE" = 0 ] && command -v systemctl >/dev/null && [ -d /run/systemd/system ]; }

# ---------- Benutzer von TVHeadend ----------
if [ -z "$TVH_USER" ]; then
  TVH_USER=$(ps -o user= -C tvheadend 2>/dev/null | head -n1 | tr -d ' ' || true)
  [ "$TVH_USER" = root ] && TVH_USER=""
  if [ -z "$TVH_USER" ] && [ -f /etc/default/tvheadend ]; then
    TVH_USER=$(sed -n 's/^TVH_USER=["'\'']\{0,1\}\([^"'\'' ]*\).*/\1/p' /etc/default/tvheadend | head -n1)
  fi
  if [ -z "$TVH_USER" ] && [ -f "$UNIT" ]; then
    TVH_USER=$(sed -n 's/^User=//p' "$UNIT" | head -n1)
  fi
  [ -z "$TVH_USER" ] && id hts >/dev/null 2>&1 && TVH_USER=hts
fi
[ -n "$TVH_USER" ] || die "Benutzer von TVHeadend nicht gefunden – bitte mit --user NAME angeben." \
                          "Could not find the Tvheadend user – please pass --user NAME."
id "$TVH_USER" >/dev/null 2>&1 || die "Benutzer „$TVH_USER“ gibt es nicht." "User '$TVH_USER' does not exist."
HOME_DIR=$(getent passwd "$TVH_USER" | cut -d: -f6)
DIR="${DIR:-$HOME_DIR/tvh-aufnahmen}"

# ---------- Deinstallieren ----------
if [ "$UNINSTALL" = 1 ]; then
  if has_systemd && [ -f "$UNIT" ]; then
    systemctl disable --now "$SERVICE" 2>/dev/null || true
    rm -f "$UNIT"; systemctl daemon-reload
  fi
  rm -f "$SUDOERS"
  rm -rf "$DIR/tvh_aufnahmen" "$DIR/tvh-aufnahmen.py" "$DIR/install.sh"
  rmdir "$DIR" 2>/dev/null || true
  say "Entfernt. Einstellungen ($HOME_DIR/.config/tvh-aufnahmen.json) und Cache ($HOME_DIR/.cache/tvh-aufnahmen) sind geblieben." \
      "Removed. Settings ($HOME_DIR/.config/tvh-aufnahmen.json) and cache ($HOME_DIR/.cache/tvh-aufnahmen) were kept."
  exit 0
fi

UPDATE=0; [ -f "$DIR/tvh-aufnahmen.py" ] && UPDATE=1
say "Benutzer: $TVH_USER · Ordner: $DIR$([ "$UPDATE" = 1 ] && t ' (Aktualisierung)' ' (update)')" \
    "User: $TVH_USER · folder: $DIR$([ "$UPDATE" = 1 ] && t ' (Aktualisierung)' ' (update)')"
{ command -v pgrep >/dev/null && pgrep -x tvheadend >/dev/null; } || warn "TVHeadend läuft gerade nicht – das Tool lässt sich trotzdem installieren." \
                                      "Tvheadend is not running right now – the tool can be installed anyway."

# ---------- Pakete ----------
need=()
command -v python3 >/dev/null || need+=(python3)
command -v ffmpeg >/dev/null || need+=(ffmpeg)
command -v curl >/dev/null || need+=(curl ca-certificates)
command -v tar >/dev/null || need+=(tar)
if [ -z "$COMSKIP" ]; then
  if command -v comskip >/dev/null; then COMSKIP=0
  else COMSKIP=$(ask "Werbeerkennung mit comskip installieren?" "Install ad detection with comskip?" 1); fi
fi
[ "$COMSKIP" = 1 ] && ! command -v comskip >/dev/null && need+=(comskip)
if [ ${#need[@]} -gt 0 ]; then
  if command -v apt-get >/dev/null; then
    say "Installiere: ${need[*]}" "Installing: ${need[*]}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq "${need[@]}" >/dev/null || {
      # comskip fehlt in manchen Paketquellen – ohne weitermachen
      warn "Nicht alle Pakete ließen sich installieren, versuche es ohne comskip." "Not all packages could be installed, trying without comskip."
      rest=(); for p in "${need[@]}"; do [ "$p" = comskip ] || rest+=("$p"); done
      [ ${#rest[@]} -eq 0 ] || apt-get install -y -qq "${rest[@]}" >/dev/null; }
  else
    warn "Kein apt-get – bitte selbst installieren: ${need[*]}" "No apt-get – please install yourself: ${need[*]}"
  fi
fi
command -v python3 >/dev/null || die "python3 fehlt." "python3 is missing."
python3 -c 'import sys; sys.exit(sys.version_info < (3, 7))' || die "Python 3.7 oder neuer nötig." "Python 3.7 or newer required."
command -v ffmpeg >/dev/null || warn "ffmpeg fehlt – ohne gehen interner Player, Untertitel und Vorschaubilder nicht." \
                                     "ffmpeg is missing – the internal player, subtitles and thumbnails need it."

# ---------- Programm holen ----------
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
if [ -n "$FROM" ]; then
  SRC="$FROM"; LABEL="$FROM"
else
  if [ -z "$VERSION" ]; then
    VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
              | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])' 2>/dev/null || true)
    [ -n "$VERSION" ] || VERSION=main
  fi
  case "$VERSION" in main|master) URL="https://github.com/$REPO/archive/refs/heads/$VERSION.tar.gz" ;;
                     *) URL="https://github.com/$REPO/archive/refs/tags/$VERSION.tar.gz" ;; esac
  say "Lade $VERSION von GitHub …" "Downloading $VERSION from GitHub …"
  curl -fsSL "$URL" | tar xz -C "$TMP" || die "Download fehlgeschlagen: $URL" "Download failed: $URL"
  SRC=$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n1); LABEL="$VERSION"
fi
[ -f "$SRC/tvh-aufnahmen.py" ] && [ -d "$SRC/tvh_aufnahmen" ] || die "Keine Programmdateien in $SRC." "No program files in $SRC."

# ---------- Kopieren (alter Programmordner wird ersetzt, damit gelöschte Dateien nicht liegen bleiben) ----------
mkdir -p "$DIR"
rm -rf "$DIR/tvh_aufnahmen.neu"
cp -a "$SRC/tvh_aufnahmen" "$DIR/tvh_aufnahmen.neu"
find "$DIR/tvh_aufnahmen.neu" -name __pycache__ -type d -prune -exec rm -rf {} +
rm -rf "$DIR/tvh_aufnahmen"; mv "$DIR/tvh_aufnahmen.neu" "$DIR/tvh_aufnahmen"
cp "$SRC/tvh-aufnahmen.py" "$DIR/"
[ -f "$SRC/install.sh" ] && cp "$SRC/install.sh" "$DIR/"
chown -R "$TVH_USER:" "$DIR"
VER=$(cd "$DIR" && python3 -c 'import tvh_aufnahmen; print(tvh_aufnahmen.__version__)' 2>/dev/null || echo "$LABEL")
say "tvh-aufnahmen $VER installiert." "tvh-aufnahmen $VER installed."

# ---------- Recht, TVHeadend für das Einspielen einer Komplettsicherung zu stoppen/starten ----------
if [ -z "$RIGHTS" ]; then
  if [ -f "$SUDOERS" ] || sudo -n -l -U "$TVH_USER" 2>/dev/null | grep -q 'NOPASSWD: ALL'; then RIGHTS=0
  else RIGHTS=$(ask "Dem Benutzer erlauben, TVHeadend zum Einspielen einer Komplettsicherung zu stoppen und zu starten?" \
                    "Allow the user to stop and start Tvheadend for restoring a full backup?" 1); fi
fi
if [ "$RIGHTS" = 1 ] && command -v systemctl >/dev/null; then
  SC=$(command -v systemctl)
  printf '%s ALL=(root) NOPASSWD: %s stop tvheadend, %s start tvheadend\n' "$TVH_USER" "$SC" "$SC" > "$SUDOERS.tmp"
  chmod 440 "$SUDOERS.tmp"
  if visudo -cf "$SUDOERS.tmp" >/dev/null 2>&1; then mv "$SUDOERS.tmp" "$SUDOERS"
  else rm -f "$SUDOERS.tmp"; warn "sudo-Regel ließ sich nicht prüfen – übersprungen." "Could not validate the sudo rule – skipped."; fi
fi

# ---------- Dienst ----------
PY=$(command -v python3)
if has_systemd; then
  if [ ! -f "$UNIT" ] || [ -n "$PORT" ]; then
    cat > "$UNIT" <<EOF
[Unit]
Description=tvh-aufnahmen (web UI for Tvheadend)
After=network.target tvheadend.service

[Service]
User=$TVH_USER
ExecStart=$PY $DIR/tvh-aufnahmen.py${PORT:+ --port $PORT}
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
  fi
  systemctl daemon-reload
  systemctl enable "$SERVICE" >/dev/null 2>&1
  systemctl restart "$SERVICE"
  PORT=$(sed -n 's/.*--port \([0-9]*\).*/\1/p' "$UNIT" | head -n1); PORT=${PORT:-8099}
  for _ in $(seq 1 20); do
    curl -fs -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break
    sleep 0.5
  done
  if systemctl is-active -q "$SERVICE"; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    say "Läuft. Im Browser öffnen: http://${IP:-$(hostname)}:$PORT/" "Running. Open in the browser: http://${IP:-$(hostname)}:$PORT/"
    [ "$UPDATE" = 0 ] && say "Dort unter „Einstellungen“ den TVHeadend-Benutzer mit Passwort eintragen." \
                             "There, enter the Tvheadend user and password under “Settings”."
  else
    warn "Der Dienst startet nicht – Protokoll: journalctl -u $SERVICE" "The service does not start – log: journalctl -u $SERVICE"
    exit 1
  fi
else
  say "Ohne systemd-Dienst. Starten mit: sudo -u $TVH_USER $PY $DIR/tvh-aufnahmen.py${PORT:+ --port $PORT}" \
      "Without systemd service. Start with: sudo -u $TVH_USER $PY $DIR/tvh-aufnahmen.py${PORT:+ --port $PORT}"
fi
