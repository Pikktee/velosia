# Velosia-Gesundheitsprüfung auf dem T640

Meldet über Beacon (Projekt `velosia`), wenn das automatische Ausfüllen auf einer
Plattform bricht, typischerweise weil Vinted, Kleinanzeigen oder eBay ihr Formular
umgebaut haben.

**Warum auf dem T640:** Railway erreicht Beacon nicht, Beacon ist absichtlich nur im
Heimnetz und über Tailscale erreichbar. Der T640 fragt deshalb alle 30 Minuten
`GET /api/monitor/autofill-health` ab (Bearer `MONITOR_TOKEN`) und legt jedes Problem
als Beacon-Nachricht ab. Der Problem-Schlüssel (`plattform:feld:erste-fehl-id`) ist
Beacons Doppelschutz: ein Ausfall wird einmal gemeldet.

**Regel** (in `backend/main.py`, `autofill_problems`): Ein Feld, das auf der Plattform
schon geklappt hat, scheitert bei den neuesten Einstellversuchen hintereinander,
egal welcher Nutzer: Titel, Beschreibung, Preis, Kategorie, Zustand ab 2, Größe,
Farbe, Material ab 3. Die Marke nie (nur exakte Treffer, leer ist oft richtig).

**Lebenszeichen:** Jeder erfolgreiche Lauf meldet die Aufgabe `autofill-check`. Fehlt es
länger als 3 Stunden (Velosia nicht erreichbar, Token falsch, Skript kaputt), warnt
Beacon von selbst.

## Einrichten / ändern

Geheimnisse liegen nur auf dem T640, nie im Repo:

- `~/.config/velosia/monitor-token`: derselbe Wert wie `MONITOR_TOKEN` auf Railway
  (Dienst backend). Am Mac liegt eine Kopie unter demselben Pfad.
- `~/.config/beacon/keys/velosia`: Beacon-Schlüssel, am Mac angelegt mit
  `beacon projekt velosia`, dann auf den T640 kopiert.

```bash
ops/t640/install.sh
```

kopiert das Skript nach `~/velosia-health/`, trägt den Cron-Job ein (alle 30 Minuten,
Protokoll `~/velosia-health/run.log`) und macht einen Probelauf.
