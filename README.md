# tvh-aufnahmen

Web-Oberfläche für TVHeadend 4.3, um

- **Live-TV**: alle Sender mit Logo, der laufenden Sendung (mit Fortschrittsbalken) und den nächsten drei Sendungen anzuzeigen und einen Sender per Knopf in VLC abzuspielen,
- **Aufnahmen** als Liste oder nach Ordnern gruppiert anzuzeigen, nach Name, Sender, Datum, Dauer oder Größe zu sortieren, zu durchsuchen, herunterzuladen, in VLC als Stream abzuspielen, Titel, Untertitel und Beschreibung zu ändern, die Videodatei zu ersetzen (z. B. nach dem Schneiden) und Aufnahmen samt Datei zu löschen,
- Videodateien aus dem Aufnahmeordner, die TVHeadend nicht (mehr) kennt, wieder als Aufnahme einzutragen – mit Titel, Untertitel, Sender, Zeit und Beschreibung,
- alte Einträge, deren Datei nur in einen anderen Ordner gewandert ist, auf den neuen Pfad umzustellen,
- Einträge zu löschen, deren Datei nicht mehr existiert. Videodateien werden dabei nie gelöscht,
- TVHeadend zu **sichern** – komplett oder gezielt Aufnahmen und Sender – und nach einer Neuinstallation wiederherzustellen.

Python 3.7+, keine zusätzlichen Pakete. Benutzer und Passwörter mit Umlauten funktionieren. Läuft auf demselben Gerät wie TVHeadend, damit die Dateipfade übereinstimmen.

## Installation

Kopiert werden der Starter `tvh-aufnahmen.py` und der Ordner `tvh_aufnahmen` daneben:

```bash
rsync -a --exclude __pycache__ tvh-aufnahmen.py tvh_aufnahmen hts@<tvheadend-rechner>:~/tvh-aufnahmen/
ssh hts@<tvheadend-rechner> python3 ~/tvh-aufnahmen/tvh-aufnahmen.py
```

Dann im Browser `http://<tvheadend-rechner>:8099/` öffnen. Unter **Einstellungen** stellst du ein:

| Feld | Standard |
|---|---|
| Aufnahmeverzeichnis | `~/Tvheadend/Extern/Aufnahmen` (wenn vorhanden) |
| TVHeadend-Server | `http://localhost:9981` |
| Benutzer / Passwort | TVHeadend-Benutzer mit Admin-Rechten für den Rekorder |
| Sprachcode | `ger` |
| TVHeadend-Konfigurationsordner | `~/.config/hts` oder `~/.hts/tvheadend` (wenn vorhanden), für die Komplettsicherung |

Die Einstellungen landen in `~/.config/tvh-aufnahmen.json` (nur für den Benutzer lesbar). Alternativ gehen Startparameter, die Vorrang vor der Datei haben:

```bash
python3 tvh-aufnahmen.py --recdir /media/HDD/Aufnahmen --tvh http://localhost:9981 --user admin --port 8099
```

`python3 tvh-aufnahmen.py --help` zeigt alle Optionen.

## Dauerhaft als Dienst

`/etc/systemd/system/tvh-aufnahmen.service`:

```ini
[Unit]
Description=TVHeadend Aufnahmen-Verwaltung
After=network.target tvheadend.service

[Service]
User=hts
ExecStart=/usr/bin/python3 /home/hts/tvh-aufnahmen/tvh-aufnahmen.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now tvh-aufnahmen
```

## Sicherung

Der Reiter **Sicherung** bietet zwei Wege:

**Komplettsicherung** – lädt den ganzen Konfigurationsordner von TVHeadend als `.tar.gz` (einige MB). Beim Einspielen stoppt das Tool TVHeadend (`sudo -n systemctl stop tvheadend`), benennt den bisherigen Ordner in `<ordner>.vor-wiederherstellung-<zeit>` um, entpackt die Sicherung und startet TVHeadend wieder. Danach ist alles exakt wie vorher, mit denselben IDs – auch Gesehen-Status und Wiedergabeposition in Kodi, Serien-Timer, Tuner und Benutzer. Voraussetzung: gleiche Hardware und gleiche oder neuere TVHeadend-Version (bei abweichender Version fragt das Tool nach). Weil die Sicherung die TVHeadend-Benutzer und -Passwörter enthält, fragt der Download das Passwort aus den Einstellungen ab. Darf der Benutzer kein `sudo` ohne Passwort, ändert das Tool nichts und zeigt die Befehle für die Wiederherstellung von Hand. Mit `--tvh-service ''` fasst das Tool den Dienst nie an.

**Aufnahmen und Sender (JSON)** – für andere Hardware, eine andere Version oder einen anderen Aufnahmeordner. Exportiert Sender-Tags, Sender (Nummer, Tags, Dienste mit Netzwerk, Transponder und Service-ID), Serien-Timer und alle Aufnahmen mit Datei. Der Import zeigt zuerst eine Vorschau (neu / anpassen / vorhanden / Dienst nicht gefunden) und legt erst nach Bestätigung an – in der Reihenfolge Tags, Sender, Timer, Aufnahmen. Pfade unter dem alten Aufnahmeordner werden auf den aktuellen umgeschrieben. Aufnahmen bekommen dabei neue IDs.

Empfohlener Ablauf nach einer Neuinstallation:

1. TVHeadend installieren und einmal starten, dann dieses Tool installieren.
2. Komplettsicherung einspielen – fertig.
3. Geht das nicht (andere Hardware/Version): in TVHeadend Tuner einrichten und Suchlauf machen, dann die JSON-Datei importieren.

## Aufbau

| Datei | Inhalt |
|---|---|
| `tvh-aufnahmen.py` | Starter, ruft `tvh_aufnahmen.cli.main()` auf (alternativ `python3 -m tvh_aufnahmen`) |
| `tvh_aufnahmen/cli.py` | Startparameter, Server starten |
| `tvh_aufnahmen/config.py` | Einstellungen laden, prüfen, speichern |
| `tvh_aufnahmen/tvh.py` | Zugriff auf die TVHeadend-API (Digest-Login mit UTF-8) |
| `tvh_aufnahmen/files.py` | Videodateien finden, Titel und Zeiten aus dem Dateinamen raten |
| `tvh_aufnahmen/live.py` | Live-TV: Sender mit Programmdaten, Stream-Playlist, Senderlogos |
| `tvh_aufnahmen/state.py` | Abgleich Einträge ↔ Dateien: Aufnahmen, nicht eingetragene Dateien, Einträge ohne Datei |
| `tvh_aufnahmen/recordings.py` | Ändern: importieren, bearbeiten, Datei ersetzen, löschen, Pfade reparieren |
| `tvh_aufnahmen/backup.py` | Komplettsicherung des TVHeadend-Ordners und Wiederherstellung |
| `tvh_aufnahmen/transfer.py` | JSON-Export/-Import von Tags, Sendern, Serien-Timern und Aufnahmen |
| `tvh_aufnahmen/server.py` | HTTP-Routen, Download, Playlist, Auslieferung der Oberfläche |
| `tvh_aufnahmen/static/` | Oberfläche: `index.html`, `style.css` und ein JavaScript pro Reiter (`common.js` für Gemeinsames) |

Neue Funktionen bekommen ihre Logik in `recordings.py` (oder ein eigenes Modul), eine Route in `server.py` und die Bedienung im passenden Skript unter `static/`.

## Hinweise

- Die Oberfläche hat kein eigenes Login. Sie ist für das Heimnetz gedacht; mit `--bind 127.0.0.1` ist sie nur lokal erreichbar.
- Start- und Endzeit werden aus dem Dateinamen (z. B. `Tatort-2023-05-14-20-15.ts`) und der Änderungszeit geraten. Ist `ffprobe` installiert (`sudo apt install ffmpeg`), wird die echte Laufzeit verwendet.
- Ohne Sender legt TVHeadend keinen Eintrag an. Das Tool schlägt den Sender anderer Aufnahmen im selben Ordner vor, sonst „Unbekannt“.
- Das Ende einer Aufnahme muss in der Vergangenheit liegen, sonst würde TVHeadend einen Aufnahme-Timer anlegen. Das Tool verhindert das.
- Abspielen: Der Knopf lädt eine kleine `.m3u`-Datei. Mit VLC (oder einem anderen Player) geöffnet, streamt sie die Aufnahme vom Tool; Vor- und Zurückspulen funktioniert. Im Browser selbst lassen sich `.ts`-Aufnahmen nicht abspielen.
- Datei ersetzen: Die hochgeladene Datei überschreibt die bisherige. Hat sie eine andere Endung (z. B. `.mkv` statt `.ts`), wird die Aufnahme auf die neue Datei umgestellt und die alte gelöscht. Start und Ende lassen sich bei fertigen Aufnahmen in TVHeadend 4.3 nicht ändern.
- Beschreibung ändern: TVHeadend 4.3 erlaubt das bei fertigen Aufnahmen nicht direkt. Das Tool legt den Eintrag deshalb mit der neuen Beschreibung neu an; die Videodatei bleibt unverändert, der Eintrag bekommt aber eine neue ID.
- Live-TV abspielen: Die `.m3u`-Datei kommt von TVHeadend und enthält statt des Passworts ein Einmal-Ticket, das nur kurz gültig ist – die Datei also gleich öffnen. Gestreamt wird direkt von TVHeadend (Port 9981), unverändert wie empfangen. Wer die Oberfläche erreicht, kann damit auch Sender abspielen.
- Downloads unterstützen HTTP-Range, Player können also spulen.
- Vor dem ersten großen Import am besten den Ordner `~/.hts/tvheadend/dvr/log` sichern.
