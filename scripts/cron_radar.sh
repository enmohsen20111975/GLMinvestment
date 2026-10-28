#!/bin/bash
# cron_radar.sh — Radar + Indices refresh دوري
# ============================================================================
# يـشغل:
#   1. sync_market_indices_live.py — تحديث مؤشرات كل سوق (EGX30/70/100/33,
#      TADAWUL_TASI, KSE_COMPOSITE, QSE_QE_INDEX, US_COMPOSITE) من الأسعار
#      الحية في stocks.db. لازم يشتغل قبل الـ radar عشان الرادار يلاقي
#      آخر قيم للمؤشرات.
#   2. maker_radar.py لكل الأسواق بالتتابع لمنع إجهاد الـ CPU أو قفل الـ SQLite
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR" || cd /root/GLMinvestment || exit 1

LOG=/tmp/radar_cron.log
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Radar + Indices refresh started" >> $LOG

PYTHON_BIN="python3"
if [ -f "$SCRIPT_DIR/.venv/bin/python3" ]; then
    PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python3"
elif [ -f "/root/GLMinvestment/.venv/bin/python3" ]; then
    PYTHON_BIN="/root/GLMinvestment/.venv/bin/python3"
fi

# ── Step 1: sync market indices (EGX30/TASI/KSE/QSE/US composites) ──────────
# Computes indices from current stock prices and upserts into market_indices.
# Takes ~2 seconds. Runs BEFORE radar so the radar sees fresh index values.
echo "[$(date '+%H:%M:%S')] syncing market indices..." >> $LOG
timeout 60 "$PYTHON_BIN" scripts/sync_market_indices_live.py >> $LOG 2>&1
if [ $? -eq 0 ]; then
    echo "[$(date '+%H:%M:%S')] indices synced ✓" >> $LOG
else
    echo "[$(date '+%H:%M:%S')] indices sync FAILED (exit $?)" >> $LOG
fi

# ── Step 2: radar refresh per market (sequential) ───────────────────────────
for market in EGX TADAWUL KSE QSE US; do
    timeout 120 "$PYTHON_BIN" scripts/maker_radar.py --market "$market" --json-only >> $LOG 2>&1
    echo "[$(date '+%H:%M:%S')] $market radar done" >> $LOG
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Radar + Indices refresh completed" >> $LOG
