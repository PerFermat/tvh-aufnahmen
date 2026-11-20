# tvh-aufnahmen

Web-Oberfläche für TVHeadend 4.3, um

- das **Programm** wie eine Fernsehzeitschrift zu zeigen – ein ganzer Tag, Sender als Spalten, sechs Zeilen zu je 4 Stunden mit allen Sendungen, die darin beginnen; die Schnellauswahl springt zum Block – und per Klick auf eine Sendung alle EPG-Angaben zu sehen, eine Aufnahme oder eine Serienaufnahme (mit allen Optionen von TVHeadend) zu planen,
- im Programm **über alle Tage zu suchen** (Titel, auf Wunsch auch Beschreibungen); laufende Sendungen sind markiert, vorbeigelaufene grau,
- den **Status** zu sehen: Tuner mit Signal und Fehlern, laufende Aufnahmen und Streams, Temperatur, Last und Speicher des Rechners,
- **Konflikte** zu erkennen, wenn mehr Aufnahmen gleichzeitig auf verschiedenen Transpondern geplant sind, als es Tuner gibt,
- **doppelte Aufnahmen** zu finden (Ansicht „Doppelte“ bei Aufnahmen: gleicher Titel und Untertitel, ohne Untertitel gleiche Beschreibung) – behalten wird die HD- bzw. längste Fassung, die übrigen sind zum Löschen vorausgewählt,
- Aufnahmen **von Hand** zu planen (Sender, Titel, Datum, Beginn, Ende, Vor-/Nachlauf) – Knopf „＋ Neue Aufnahme“ im Kopf bei „Aufnahmen“ und „Geplante Aufnahmen“,
- **Serienaufnahmen** zu verwalten (anlegen, bearbeiten, aktivieren/deaktivieren, löschen) und alle **geplanten Aufnahmen** einzeln zu sehen und zu löschen,
- **Live-TV**: alle Sender mit Logo, der laufenden Sendung (mit Fortschrittsbalken) und den nächsten drei Sendungen anzuzeigen und einen Sender direkt im Browser abzuspielen (oder extern, z. B. in VLC),
- den **Videotext** eines Senders anzusehen (mit Farben und Blockgrafik) und Videotext-**Untertitel** im Player einzublenden,
- **Aufnahmen** als Liste oder nach Ordnern gruppiert anzuzeigen, nach Name, Sender, Datum, Dauer oder Größe zu sortieren, zu durchsuchen, herunterzuladen, in VLC als Stream abzuspielen, Titel, Untertitel und Beschreibung zu ändern, die Videodatei zu ersetzen (z. B. nach dem Schneiden) und Aufnahmen samt Datei zu löschen; abgespielt wird ebenfalls direkt im Browser,
- Videodateien aus dem Aufnahmeordner, die TVHeadend nicht (mehr) kennt, wieder als Aufnahme einzutragen – mit Titel, Untertitel, Sender, Zeit und Beschreibung,
- alte Einträge, deren Datei nur in einen anderen Ordner gewandert ist, auf den neuen Pfad umzustellen,
- Einträge zu löschen, deren Datei nicht mehr existiert. Videodateien werden dabei nie gelöscht,
- einen **Sendersuchlauf** zu starten, neue unverschlüsselte deutschsprachige Fernsehsender anzulegen (fortlaufend nach der höchsten Nummer) und Sender zu löschen, die es nicht mehr gibt,
- vergangene Tage im Programm weiter zu sehen (dauerhaftes **EPG-Archiv**) und frühere Ausstrahlungen einer Sendung zu finden,
- TVHeadend zu **sichern** – komplett oder gezielt Aufnahmen und Sender, auch automatisch jede Nacht – und nach einer Neuinstallation wiederherzustellen.

## Bildschirmfotos

**Programm** – ein Tag als Fernsehzeitschrift, jede Zeile eine Zeitachse über 4 Stunden; Bilder zu Filmen und Serien

![Programm](docs/screenshots/programm.png)

**Sendung** – alle Angaben, Bild, Aufnahme oder Serienaufnahme planen

![Detailfenster einer Sendung](docs/screenshots/sendung.png)

**Live-TV** – laufende und nächste Sendungen, Abspielen im Browser, Videotext

![Live-TV](docs/screenshots/live-tv.png)

![Videotext](docs/screenshots/videotext.png)

**Aufnahmen** – mit Vorschaubild, Abspielen, Bearbeiten, Doppelte finden

![Aufnahmen](docs/screenshots/aufnahmen.png)

**Status** – Tuner, Rechner, Speicher, EPG-Archiv

![Status](docs/screenshots/status.png)

**Auf dem Handy**

<img src="docs/screenshots/handy-programm.png" alt="Programm auf dem Handy" width="300"> <img src="docs/screenshots/handy-live-tv.png" alt="Live-TV auf dem Handy" width="300">

Läuft auf einem Linux-Rechner mit TVHeadend (x86 oder ARM). Python 3.7+, keine zusätzlichen Python-Pakete; für internen Player, Untertitel und Vorschaubilder wird `ffmpeg` gebraucht. Benutzer und Passwörter mit Umlauten funktionieren. Das Tool läuft auf demselben Rechner wie TVHeadend, damit die Dateipfade übereinstimmen – läuft TVHeadend in Docker, muss der Aufnahmeordner im Container unter demselben Pfad liegen wie auf dem Rechner.

## Installation

Das Tool läuft auf jedem Linux-Rechner, auf dem auch TVHeadend läuft. Kopiert werden der Starter `tvh-aufnahmen.py` und der Ordner `tvh_aufnahmen` daneben – am besten ins Home-Verzeichnis des Benutzers, unter dem TVHeadend läuft (`<benutzer>`), damit das Tool Aufnahmen und Konfiguration lesen und schreiben darf:

```bash
rsync -a --exclude __pycache__ tvh-aufnahmen.py tvh_aufnahmen <benutzer>@<tvheadend-rechner>:~/tvh-aufnahmen/
ssh <benutzer>@<tvheadend-rechner> python3 ~/tvh-aufnahmen/tvh-aufnahmen.py
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
User=<benutzer>
ExecStart=/usr/bin/python3 /home/<benutzer>/tvh-aufnahmen/tvh-aufnahmen.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now tvh-aufnahmen
```

## Desktop-Verknüpfung (Linux)

Im Ordner `desktop/` liegen eine Verknüpfung und ein Icon. Installieren fürs Startmenü:

```bash
install -Dm644 desktop/tvh-aufnahmen.svg ~/.local/share/icons/hicolor/scalable/apps/tvh-aufnahmen.svg
install -Dm755 desktop/tvh-aufnahmen.desktop ~/.local/share/applications/tvh-aufnahmen.desktop
```

Danach lässt sie sich aus dem Startmenü oder direkt aus `desktop/` auf den Schreibtisch ziehen. Sie öffnet die Adresse aus der Zeile `Exec=` im Standardbrowser – dort vorher den Namen oder die IP-Adresse des TVHeadend-Rechners eintragen.

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
| `tvh_aufnahmen/epg.py` | Programmzeitschrift, Aufnahmen planen, Serienaufnahmen, geplante Aufnahmen, Formulare aus den TVHeadend-Klassen |
| `tvh_aufnahmen/epg_archive.py` | Dauerhaftes Archiv vergangener Sendungen (SQLite, gepackt) |
| `tvh_aufnahmen/player.py` | Interner Player: Live-TV und Aufnahmen per ffmpeg als H.264/AAC-MPEG-TS für den Browser |
| `tvh_aufnahmen/teletext.py` | Videotext: liest die Videotext-Pakete aus dem Senderstream und setzt die Seiten zusammen |
| `tvh_aufnahmen/posters.py` | Bilder zu langen Sendungen aus der Wikipedia, von TVmaze (Serien) und Trakt, im Hintergrund gesucht und zwischengespeichert |
| `tvh_aufnahmen/scan.py` | Sendersuchlauf, Auswertung, neue Sender anlegen, verschwundene löschen |
| `tvh_aufnahmen/status.py` | Status-Seite: Tuner, laufende Aufnahmen und Streams, Rechner |
| `tvh_aufnahmen/thumbs.py` | Vorschaubilder der Aufnahmen per ffmpeg |
| `tvh_aufnahmen/jobs.py` | Hintergrundaufgaben: nächtliche Sicherung, Benachrichtigungen per ntfy |
| `tvh_aufnahmen/state.py` | Abgleich Einträge ↔ Dateien: Aufnahmen, nicht eingetragene Dateien, Einträge ohne Datei |
| `tvh_aufnahmen/recordings.py` | Ändern: importieren, bearbeiten, Datei ersetzen, löschen, Pfade reparieren |
| `tvh_aufnahmen/backup.py` | Komplettsicherung des TVHeadend-Ordners und Wiederherstellung |
| `tvh_aufnahmen/transfer.py` | JSON-Export/-Import von Tags, Sendern, Serien-Timern und Aufnahmen |
| `tvh_aufnahmen/server.py` | HTTP-Routen, Download, Playlist, Auslieferung der Oberfläche |
| `tvh_aufnahmen/static/` | Oberfläche: `index.html`, `style.css` und ein JavaScript pro Reiter (`common.js` für Gemeinsames) |

Neue Funktionen bekommen ihre Logik in `recordings.py` (oder ein eigenes Modul), eine Route in `server.py` und die Bedienung im passenden Skript unter `static/`.

## Hinweise

- Die Oberfläche hat kein eigenes Login. Sie ist für das Heimnetz gedacht; mit `--bind 127.0.0.1` ist sie nur lokal erreichbar. Standard ist `::` (IPv6 und IPv4).
- Start- und Endzeit werden aus dem Dateinamen (z. B. `Tatort-2023-05-14-20-15.ts`) und der Änderungszeit geraten. Ist `ffprobe` installiert (`sudo apt install ffmpeg`), wird die echte Laufzeit verwendet.
- Ohne Sender legt TVHeadend keinen Eintrag an. Das Tool schlägt den Sender anderer Aufnahmen im selben Ordner vor, sonst „Unbekannt“.
- Das Ende einer Aufnahme muss in der Vergangenheit liegen, sonst würde TVHeadend einen Aufnahme-Timer anlegen. Das Tool verhindert das.
- Abspielen: Unter „Einstellungen“ wählt man je Gerät den **internen Player** (Standard) oder den externen. Der interne spielt Live-TV und Aufnahmen direkt im Browser ab (mpegts.js, mitgeliefert unter `static/vendor/`, Apache-2.0). Das Tool liefert dafür über ffmpeg MPEG-TS mit H.264-Bild und AAC-Ton: H.264 in Qualität „Home“ wird nur umverpackt (kaum Last), MPEG-2-Sender und kleinere Qualitäten werden umgerechnet (höchstens zwei gleichzeitig; ein kleiner Rechner schafft meist nur eine Umrechnung in Echtzeit). Aufnahmen spulen über eine eigene Zeitleiste. Funktioniert in Chrome, Firefox, Edge und auf Android – nicht auf dem iPhone (dort automatisch der externe Player). Der externe Player lädt eine kleine `.m3u`-Datei. Mit VLC (oder einem anderen Player) geöffnet, streamt sie die Aufnahme vom Tool; Vor- und Zurückspulen funktioniert. Im Browser selbst lassen sich `.ts`-Aufnahmen nicht abspielen.
- Videotext: Im Live-Player und in den Sendungsdetails öffnet „Videotext“ die Videotext-Seiten des Senders mit Farben und Blockgrafik. Man blättert mit ◀/▶ (Pfeiltasten), tippt Seitenzahlen ein oder klickt eine Seitenzahl im Text an; „?“ zeigt verdeckten Text. Text lässt sich mit der Maus markieren und kopieren, „Kopieren“ übernimmt die ganze Seite. Das Auslesen belegt kurz einen Tuner und endet 45 Sekunden nach dem Schließen.
- Untertitel: Der Knopf „Untertitel: an/aus“ im internen Player blendet die Videotext-Untertitel (Seite 150/777) ein, live und bei Aufnahmen, die den Videotext mit aufgezeichnet haben. ffmpeg liest sie dabei nebenher mit (`~/.cache/tvh-aufnahmen/subs`, wird nach der Wiedergabe gelöscht). Die Einstellung merkt sich das Gerät.
- Datei ersetzen: Die hochgeladene Datei überschreibt die bisherige. Hat sie eine andere Endung (z. B. `.mkv` statt `.ts`), wird die Aufnahme auf die neue Datei umgestellt und die alte gelöscht. Start und Ende lassen sich bei fertigen Aufnahmen in TVHeadend 4.3 nicht ändern.
- Beschreibung ändern: TVHeadend 4.3 erlaubt das bei fertigen Aufnahmen nicht direkt. Das Tool legt den Eintrag deshalb mit der neuen Beschreibung neu an; die Videodatei bleibt unverändert, der Eintrag bekommt aber eine neue ID.
- Live-TV abspielen: Die `.m3u`-Datei kommt von TVHeadend und enthält statt des Passworts ein Einmal-Ticket, das nur kurz gültig ist – die Datei also gleich öffnen. Gestreamt wird direkt von TVHeadend (Port 9981), unverändert wie empfangen. Wer die Oberfläche erreicht, kann damit auch Sender abspielen.
- Das Formular für Serienaufnahmen wird aus der Klassenbeschreibung von TVHeadend (`api/idnode/class`) erzeugt und zeigt deshalb alle Optionen der installierten Version; selten gebrauchte stehen unter „Weitere Optionen“.
- Programm: Jede Zeile ist eine Zeitachse über 4 Stunden – die Sendungen stehen an der Stelle ihrer Uhrzeit, so stehen gleichzeitige Sendungen nebeneinander; der Kasten einer Sendung reicht bis zur nächsten. Laufen bei einem Sender viele Sendungen, fällt die Beschreibung weg, lange Sendungen bekommen mehr Text. Volle Zellen zeigen 10 Sendungen, immer einschließlich der laufenden („+ n frühere“ / „+ n weitere“ klappen auf). Für Sendungen ab 80 Minuten sucht der Server im Hintergrund ein Bild, beim Öffnen einer Sendung im Detailfenster auch für kürzere (dann vorrangig, angezeigt nur dort). Gesucht wird der Artikel in der deutschen Wikipedia – nur bei genau passendem Titel und einer Kurzbeschreibung als Film, Serie, Sendung o. Ä.; bei gleichnamigen Artikeln zählt das Jahr aus dem EPG („Drama, USA 2005“). Das Bild kommt aus dem deutschen Artikel, sonst aus dem englischen (dort gibt es Filmplakate), sonst aus Wikidata. Findet die Wikipedia nichts oder nur ein Wikidata-Logo, wird bei [TVmaze](https://www.tvmaze.com) nach einer gleichnamigen Serie gesucht (ohne Anmeldung; Folgennummern und angehängte Folgentitel fallen dabei weg). Ist unter „Einstellungen“ eine Trakt-Client-ID eingetragen (kostenlos: Konto auf trakt.tv, dort unter Applications eine App mit Redirect URI `urn:ietf:wg:oauth:2.0:oob` anlegen), wird zuletzt bei [Trakt](https://trakt.tv) nach einem Film oder einer Serie gesucht; bei Filmen muss das Jahr passen. Die Client ID steht nur in der Konfigurationsdatei. Höchstens eine Anfrage pro Sekunde; die Ergebnisse liegen in `~/.cache/tvh-aufnahmen/posters.json`, die Bilder lädt der Browser direkt von Wikimedia, TVmaze bzw. Trakt.
- Suchlauf: Als neu gelten unverschlüsselte TV-Dienste ohne Sender, deren erste Tonspur deutsch ist. Testkanäle und Altlasten („Astra Demo“, „ALT_…“) werden ausgelassen; SD-, Regional- und Länderfassungen vorhandener Sender, Dienste ohne Sprachangabe und Erotikkanäle stehen getrennt und sind nicht vorausgewählt. Als verschwunden gilt ein Sender, dessen Dienste seit mindestens zwei Tagen vor dem Suchlauf nicht mehr gesehen wurden (TVHeadend aktualisiert „zuletzt gesehen“ nur grob).
- Programm-Archiv: TVHeadend löscht Sendungen aus dem EPG, sobald sie vorbei sind. Das Tool legt deshalb alle 10 Minuten laufende und bald beginnende Sendungen in `~/.cache/tvh-aufnahmen/epg-archiv` ab (SQLite-Datenbank `epg.sqlite`, dauerhaft), damit das Programm auch vergangene Tage zeigt. Eine Sendung ist eindeutig durch Sender und Startzeit; die Angaben liegen gepackt in der Datenbank, und geschrieben wird nur, was sich geändert hat (schont die SD-Karte). Platzbedarf etwa 1–1,5 MB pro Tag bei rund 130 Sendern, also gut 500 MB im Jahr; Anzahl und Größe zeigt „Status“. „Wiederholungen suchen“ zeigt zusätzlich die früheren Ausstrahlungen aus dem Archiv. Tagesdateien aus älteren Versionen werden beim Start einmalig übernommen. Die nächtliche Sicherung legt eine Kopie des Archivs als `epg-archiv.sqlite` in den Sicherungsordner (nur eine, jede Nacht ersetzt); „Archiv aus der Kopie ergänzen“ im Reiter „Sicherung“ holt fehlende Sendungen daraus zurück, z. B. nach einem Wechsel der SD-Karte.
- Speicher: Belegung, freier Platz und eine Warnung, wenn Aufnahmen wegen vollem Speicher gescheitert sind, stehen im Reiter „Status“. Jede Aufnahme bekommt ein Vorschaubild (Standbild 20 Minuten nach Beginn, bei kurzen Aufnahmen aus der Mitte, per ffmpeg, zwischengespeichert in `~/.cache/tvh-aufnahmen/thumbs`).
- Automatische Sicherung: jede Nacht (Standard 03:30, im Reiter „Sicherung“ einstellbar) eine Komplettsicherung ohne Programmdaten und der JSON-Export, standardmäßig nach `<Platte>/Backup/tvheadend-sicherungen`; die letzten 14 bleiben. Fällt die Uhrzeit aus (Rechner aus), wird nachgeholt. Dazu kommt eine Kopie des EPG-Archivs (siehe oben). Die Sicherung enthält die TVHeadend-Passwörter – der Ordner sollte also nicht für andere freigegeben sein.
- Benachrichtigungen (Einstellungen): über [ntfy](https://ntfy.sh) bei fertigen und fehlgeschlagenen Aufnahmen und wenn unter 10 % Speicher frei sind.
- Als App: Die Oberfläche hat ein Web-App-Manifest. Auf dem iPhone über „Teilen → Zum Home-Bildschirm“ als eigene App ohne Browserleiste; auf Android legt „Zum Startbildschirm hinzufügen“ eine Verknüpfung an (als echte App mit eigenem Fenster nur über HTTPS).
- Qualität beim Abspielen: wählbar unter „Einstellungen“, je Gerät. Neben „Home“ (Original) bietet die Oberfläche die kleineren Stufen aus `QUALITIES` in `live.py` an – aber nur, wenn es in TVHeadend ein Stream-Profil mit diesem Namen gibt (für den externen Player; der interne rechnet selbst mit ffmpeg um).
- Downloads unterstützen HTTP-Range, Player können also spulen.
- Vor dem ersten großen Import am besten den Ordner `~/.hts/tvheadend/dvr/log` sichern.
