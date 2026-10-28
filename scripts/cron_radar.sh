#!/bin/bash
# cron_radar.sh — Radar refresh دوري
# يـشغل maker_radar.py لكل الأسواق العربية والأمريكية بالتتابع لمنع إجهاد الـ CPU أو قفل الـ SQLite
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR" || cd /root/GLMinvestment || exit 1

LOG=/tmp/radar_cron.log
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Radar sequential refresh started" >> $LOG

PYTHON_BIN="python3"
if [ -f "$SCRIPT_DIR/.venv/bin/python3" ]; then
    PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python3"
elif [ -f "/root/GLMinvestment/.venv/bin/python3" ]; then
    PYTHON_BIN="/root/GLMinvestment/.venv/bin/python3"
fi

for market in EGX TADAWUL KSE QSE US; do
    timeout 120 "$PYTHON_BIN" scripts/maker_radar.py --market "$market" --json-only >> $LOG 2>&1
    echo "[$(date '+%H:%M:%S')] $market done" >> $LOG
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Radar sequential refresh completed" >> $LOG
