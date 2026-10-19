#!/bin/bash
# cron_radar.sh — Radar refresh كل 15 دقيقة
# يـشغل maker_radar.py لكل الأسواق + يسجل في log
cd /home/z/my-project
LOG=/tmp/radar_cron.log
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Radar refresh started" >> $LOG

for market in EGX TADAWUL KSE QSE US; do
    timeout 120 python3 scripts/maker_radar.py --market $market --json-only >> $LOG 2>&1
    echo "[$(date '+%H:%M:%S')] $market done" >> $LOG
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Radar refresh completed" >> $LOG
