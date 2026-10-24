#!/bin/bash
# screener_watchdog.sh — يحافظ على تشغيل stock_screener_api
while true; do
    if ! ss -tlnp 2>/dev/null | grep -q ":8012"; then
        echo "[$(date '+%H:%M:%S')] Screener API down — restarting..." >> /tmp/screener_watchdog.log
        cd /home/z/my-project
        nohup python3 scripts/stock_screener_api.py >> /tmp/screener_api.log 2>&1 &
        echo "[$(date '+%H:%M:%S')] Started PID=$!" >> /tmp/screener_watchdog.log
    fi
    sleep 30
done
