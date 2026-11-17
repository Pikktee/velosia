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
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.velosia.henrikheil.net/api/monitor/autofill-health"
BEACON = "http://beacon.home"
PROJECT = "velosia"
TASK = "autofill-check"
MAX_HOURS = 3

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
        headers={"Authorization": f"Bearer {BEACON_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.load(resp)


def main():
    health = fetch_health()
    for p in health.get("problems") or []:
        versions = ", ".join(p.get("engine_versions") or []) or "?"
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
        print(("Gemeldet: " if result.get("new") else "Schon gemeldet: ") + p["key"])
    beacon("/api/heartbeats", {"task": TASK, "max_hours": MAX_HOURS})
    print(f"OK, {len(health.get('problems') or [])} Problem(e).")


if __name__ == "__main__":
    main()
