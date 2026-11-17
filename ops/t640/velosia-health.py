#!/usr/bin/env python3
"""Velosia-Gesundheitsprüfung auf dem T640, meldet an Beacon.

Railway erreicht Beacon nicht (Beacon ist nur im Heimnetz und über Tailscale
erreichbar, mit Absicht). Deshalb fragt der T640 alle 30 Minuten den Endpunkt
/api/monitor/autofill-health ab und legt jedes gemeldete Problem als
Beacon-Nachricht ab. Der Problem-Schlüssel ist zugleich Beacons Doppelschutz:
derselbe Ausfall wird einmal gemeldet, egal wie oft geprüft wird.

Am Ende jedes erfolgreichen Laufs ein Lebenszeichen (Aufgabe autofill-check).
Ist Velosia nicht erreichbar oder antwortet falsch, fehlt es, und Beacon warnt
nach 3 Stunden von selbst.

Nur Standardbibliothek. Geheimnisse liegen nur auf dem T640:
  ~/.config/velosia/monitor-token   MONITOR_TOKEN (wie auf Railway)
  ~/.config/beacon/keys/velosia     Beacon-Schlüssel des Projekts velosia
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.velosia.henrikheil.net/api/monitor/autofill-health"
# Auf dem T640 selbst löst beacon.home nicht auf. Caddy unterscheidet die Dienste
# am Host-Kopf, also an 127.0.0.1 mit Host: beacon.home (wie Maptales Jobs).
BEACON = "http://127.0.0.1"
BEACON_HOST = "beacon.home"
PROJECT = "velosia"
TASK = "autofill-check"
MAX_HOURS = 3

# Gegen Fehlalarm-Fluten: Telemetrie kann jedes Velosia-Konto senden, also auch
# eins, das absichtlich Ausfälle vortäuscht. Höchstens so viele neue Meldungen pro
# Tag, danach eine Sammelmeldung.
MAX_NEW_PER_DAY = 3
STATE = Path.home() / "velosia-health" / "state.json"
VERSION_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){1,3}$")
FIELDS = {"Titel", "Beschreibung", "Preis", "Kategorie", "Zustand", "Größe", "Farbe", "Material"}
PLATFORMS = {"vinted": "Vinted", "kleinanzeigen": "Kleinanzeigen", "ebay": "eBay"}

HOME = Path.home()
TOKEN = (HOME / ".config/velosia/monitor-token").read_text().strip()
BEACON_KEY = (HOME / f".config/beacon/keys/{PROJECT}").read_text().strip()


def fetch_health():
    req = urllib.request.Request(API, headers={"Authorization": f"Bearer {TOKEN}"})
    # Railway kann schlafen; der erste Aufruf weckt den Dienst.
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except (urllib.error.URLError, OSError, ValueError) as err:
            if attempt == 3:
                sys.exit(f"Velosia nicht erreichbar: {err}")
            time.sleep(attempt * 10)


def beacon(path, payload):
    req = urllib.request.Request(
        f"{BEACON}{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {BEACON_KEY}",
            "Content-Type": "application/json",
            "Host": BEACON_HOST,  # urllib übernimmt einen gesetzten Host-Kopf
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.load(resp)


def load_state(today):
    try:
        state = json.loads(STATE.read_text())
    except (OSError, ValueError):
        state = {}
    if state.get("day") != today:
        state = {"day": today, "new": 0}
    return state


def main():
    health = fetch_health()
    today = time.strftime("%Y-%m-%d", time.gmtime())
    state = load_state(today)
    for p in health.get("problems") or []:
        # Nur bekannte Werte in die Nachricht, nie freien Text aus der Telemetrie.
        if p.get("field") not in FIELDS or p.get("platform") not in PLATFORMS:
            continue
        p["platform_name"] = PLATFORMS[p["platform"]]
        if not re.fullmatch(r"[a-z]+:[a-z_]+:\d+", str(p.get("key", ""))):
            continue
        if not re.fullmatch(r"\d{4}-\d\d-\d\dT[\d:.]+Z?", str(p.get("since", ""))):
            p["since"] = "?"
        p["failed_in_a_row"] = int(p.get("failed_in_a_row") or 0)
        p["users"] = int(p.get("users") or 0)
        versions = ", ".join(v for v in (p.get("engine_versions") or []) if VERSION_RE.match(str(v))) or "?"
        if state["new"] >= MAX_NEW_PER_DAY:
            beacon("/api/messages", {
                "title": "Velosia: weitere Ausfall-Meldungen heute unterdrückt",
                "body": f"Heute kamen schon {MAX_NEW_PER_DAY} Meldungen. Weitere Probleme zeigt "
                        f"GET /api/monitor/autofill-health; ungewöhnlich viele können auch "
                        f"vorgetäuschte Telemetrie sein.",
                "urgency": "normal",
                "dedupe_key": f"cap:{today}",
            })
            break
        body = (
            f"{p['field']} wird auf {p['platform_name']} seit {p.get('since', '?')[:16].replace('T', ' ')} UTC "
            f"bei {p['failed_in_a_row']} Einstellversuchen hintereinander nicht mehr gesetzt "
            f"({p.get('users', '?')} Nutzer, Engine {versions}). Vorher hat es geklappt.\n\n"
            f"Wahrscheinlich hat {p['platform_name']} das Formular geändert. In der Velosia-Sitzung "
            f"prüfen lassen: Selektoren in shared/autofill-engine.js, Telemetrie-Tabelle autofill_events."
        )
        result = beacon("/api/messages", {
            "title": f"Velosia: {p['field']} auf {p['platform_name']} kaputt",
            "body": body,
            "urgency": "normal",
            "dedupe_key": p["key"],
        })
        if result.get("new"):
            state["new"] += 1
        print(("Gemeldet: " if result.get("new") else "Schon gemeldet: ") + p["key"])
    try:
        STATE.write_text(json.dumps(state))
    except OSError:
        pass
    beacon("/api/heartbeats", {"task": TASK, "max_hours": MAX_HOURS})
    print(f"OK, {len(health.get('problems') or [])} Problem(e).")


if __name__ == "__main__":
    main()
