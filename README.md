# tvh-aufnahmen

Web-Oberfläche für TVHeadend 4.3, um

- Videodateien aus dem Aufnahmeordner, die TVHeadend nicht (mehr) kennt, wieder als Aufnahme einzutragen – mit Titel, Untertitel, Sender, Zeit und Beschreibung,
- alte Einträge, deren Datei nur in einen anderen Ordner gewandert ist, auf den neuen Pfad umzustellen,
- Einträge zu löschen, deren Datei nicht mehr existiert. Videodateien werden dabei nie gelöscht.

Python 3.7+, keine zusätzlichen Pakete. Benutzer und Passwörter mit Umlauten funktionieren. Läuft auf demselben Gerät wie TVHeadend, damit die Dateipfade übereinstimmen.

## Installation

```bash
scp tvh-aufnahmen.py hts@<tvheadend-rechner>:~/
ssh hts@<tvheadend-rechner> python3 ~/tvh-aufnahmen.py
```

Dann im Browser `http://<tvheadend-rechner>:8099/` öffnen. Unter **Einstellungen** stellst du ein:

| Feld | Standard |
|---|---|
| Aufnahmeverzeichnis | `~/Tvheadend/Extern/Aufnahmen` (wenn vorhanden) |
| TVHeadend-Server | `http://localhost:9981` |
| Benutzer / Passwort | TVHeadend-Benutzer mit Admin-Rechten für den Rekorder |
| Sprachcode | `ger` |

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
ExecStart=/usr/bin/python3 /home/hts/tvh-aufnahmen.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now tvh-aufnahmen
```

## Hinweise

- Die Oberfläche hat kein eigenes Login. Sie ist für das Heimnetz gedacht; mit `--bind 127.0.0.1` ist sie nur lokal erreichbar.
- Start- und Endzeit werden aus dem Dateinamen (z. B. `Tatort-2023-05-14-20-15.ts`) und der Änderungszeit geraten. Ist `ffprobe` installiert (`sudo apt install ffmpeg`), wird die echte Laufzeit verwendet.
- Ohne Sender legt TVHeadend keinen Eintrag an. Das Tool schlägt den Sender anderer Aufnahmen im selben Ordner vor, sonst „Unbekannt“.
- Das Ende einer Aufnahme muss in der Vergangenheit liegen, sonst würde TVHeadend einen Aufnahme-Timer anlegen. Das Tool verhindert das.
- Vor dem ersten großen Import am besten den Ordner `~/.hts/tvheadend/dvr/log` sichern.
