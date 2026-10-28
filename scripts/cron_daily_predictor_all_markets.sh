#!/bin/bash
# cron_daily_predictor_all_markets.sh — V40.2 predictions for ALL markets
# ============================================================================
# يـشغل daily_predictor.py لكل سوق على حدة بعد إغلاق السوق.
#
# ليه السكريبت ده موجود؟
# - daily_predictor.py بيقبل --market EGX|KSA|KSE|QSE|CRYPTO
# - لكن قبل كده كان بيشتغل EGX-only (الـ get_tickers كان بيفلتر EGX-canonical بس)
# - دلوقتي بعد الـ fix، كل سوق ليه tickers الخاصة بيه:
#     EGX      → 289 tickers (via egx_gate filter)
#     KSA/TADAWUL → 395 tickers (stocks.db WHERE market='TADAWUL')
#     KSE      → 179 tickers
#     QSE      → 67 tickers
#     CRYPTO   → handled separately by run_crypto_generator()
#
# الجدولة المقترحة (بعد إغلاق كل سوق):
#   - EGX      يقفل 14:30 Cairo  → شغّل 15:00
#   - TADAWUL  يقفل 15:00 Cairo  → شغّل 15:30
#   - KSE      يقفل 13:30 Cairo  → شغّل 14:00
#   - QSE      يقفل 13:00 Cairo  → شغّل 13:30
#   - US       يقفل 21:00 Cairo  → شغّل 21:30
#
# الأبسط: شغّلهم كلهم مرة واحدة بعد آخر إغلاق (15:30 Cairo):
#   30 15 * * 1-5 cd /path/to/GLMinvestment && bash scripts/cron_daily_predictor_all_markets.sh >> logs/predictions.log 2>&1
#
# الوقت المتوقع: ~5-10 دقايق لكل سوق (EGX أبطأ بسبب 289 ticker + fundamentals)
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR" || exit 1

LOG=/tmp/predictions_cron.log
echo "[$(date '+%Y-%m-%d %H:%M:%S')] === Daily predictor ALL MARKETS started ===" >> $LOG

PYTHON_BIN="python3"
if [ -f "$SCRIPT_DIR/.venv/bin/python3" ]; then
    PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python3"
elif [ -f "/root/GLMinvestment/.venv/bin/python3" ]; then
    PYTHON_BIN="/root/GLMinvestment/.venv/bin/python3"
fi

# ── Yesterday-only mode (بعد إغلاق السوق، نولّد توقعات لأمس) ──────────────
# استخدم --today-only لو بتشغل خلال الجلسة (للتجربة الحية)
MODE="${1:---yesterday-only}"
if [ "$1" == "--today" ]; then
    MODE="--today-only"
fi

# ── شغّل لكل سوق بالتتابع (عشان ما نقفلش SQLite) ───────────────────────────
# ترتيب الإغلاق: KSE → QSE → EGX → TADAWUL → US
for market in KSE QSE EGX KSA; do
    echo "[$(date '+%H:%M:%S')] generating predictions for $market..." >> $LOG
    timeout 600 "$PYTHON_BIN" vps-service/jobs/daily_predictor.py $MODE --market "$market" >> $LOG 2>&1
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then
        echo "[$(date '+%H:%M:%S')] $market ✓" >> $LOG
    elif [ $EXIT_CODE -eq 124 ]; then
        echo "[$(date '+%H:%M:%S')] $market ✗ TIMEOUT (10min)" >> $LOG
    else
        echo "[$(date '+%H:%M:%S')] $market ✗ FAILED (exit $EXIT_CODE)" >> $LOG
    fi
    # فاصل قصير بين الأسواق عشان SQLite يفرّغ WAL
    sleep 2
done

# ── CRYPTO: السكريبت بتاعه منفصل (run_crypto_generator) ────────────────────
# daily_predictor.py بيدعم --market CRYPTO بس بيسحب من crypto_predictions_log
# اللي بيتملى من مصدر تاني. شغّله كمان لو حابب.
echo "[$(date '+%H:%M:%S')] generating predictions for CRYPTO..." >> $LOG
timeout 300 "$PYTHON_BIN" vps-service/jobs/daily_predictor.py $MODE --market CRYPTO >> $LOG 2>&1
EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date '+%H:%M:%S')] CRYPTO ✓" >> $LOG
else
    echo "[$(date '+%H:%M:%S')] CRYPTO ✗ (exit $EXIT_CODE)" >> $LOG
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] === Daily predictor ALL MARKETS completed ===" >> $LOG

# ── ملخص سريع: عدد التوقعات لكل سوق بعد التشغيل ────────────────────────────
echo "" >> $LOG
echo "=== Predictions count by market ===" >> $LOG
"$PYTHON_BIN" -c "
import sqlite3, os
db = os.path.join('$SCRIPT_DIR', 'db', 'predictions.db')
c = sqlite3.connect(db)
try:
    for r in c.execute('SELECT market, COUNT(*) FROM aiPrediction WHERE prediction_date >= date(\"now\", \"-1 day\") GROUP BY market ORDER BY COUNT(*) DESC').fetchall():
        print(f'  {r[0]}: {r[1]} new predictions')
except Exception as e:
    print(f'  (query error: {e})')
" >> $LOG 2>&1
