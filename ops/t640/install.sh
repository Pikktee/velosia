#!/usr/bin/env bash
# Bringt die Velosia-Gesundheitsprüfung auf den T640 und trägt den Cron-Job ein
# (alle 30 Minuten). Geheimnisse legt dieses Skript nicht an, siehe README.md.
set -euo pipefail
HOST="${T640_HOST:-t640.local}"
DIR="velosia-health"
cd "$(dirname "$0")"
python3 -m py_compile velosia-health.py
ssh "$HOST" "mkdir -p ~/$DIR"
scp -q velosia-health.py "$HOST:~/$DIR/velosia-health.py"
ssh "$HOST" bash -s <<'REMOTE'
set -euo pipefail
chmod 755 ~/velosia-health/velosia-health.py
for f in ~/.config/velosia/monitor-token ~/.config/beacon/keys/velosia; do
  [ -s "$f" ] || { echo "Fehlt auf dem T640: $f" >&2; exit 1; }
done
LINE='*/30 * * * * python3 ~/velosia-health/velosia-health.py >> ~/velosia-health/run.log 2>&1'
( crontab -l 2>/dev/null | grep -v 'velosia-health/velosia-health.py' ; echo "$LINE" ) | crontab -
echo "Cron eingetragen:"; crontab -l | grep velosia-health
echo "Probelauf:"; python3 ~/velosia-health/velosia-health.py
REMOTE
