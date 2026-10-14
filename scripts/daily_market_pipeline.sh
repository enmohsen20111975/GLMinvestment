#!/bin/bash
# daily_market_pipeline.sh — خط أنابيب الإنتاج اليومي
# =================================================================
# Task B-MARATHON-P3 (Owner Directive 2026-10-14)
#
# ينفذ دورة الحياة الاستثمارية كاملة بالترتيب:
#   A. 15:30 — تحديث أسعار الإغلاق + المؤشرات
#   B. 15:45 — إغلاق الصفقات المفتوحة
#   C. 08:00 — توليد صفقات الغد (السكانر المؤسسي)
#   D. 08:15 — توليد كاش Commercial Feed + الرادار
#
# Usage:
#   bash scripts/daily_market_pipeline.sh           # دورة كاملة
#   bash scripts/daily_market_pipeline.sh --dry-run  # فحص فقط
#   bash scripts/daily_market_pipeline.sh --step A   # خطوة محددة
#
# Cron setup (Cairo time = UTC+2):
#   # Step A+B: بعد إغلاق السوق (15:30 Cairo = 13:30 UTC)
#   30 13 * * 0-4 cd /path/to/project && bash scripts/daily_market_pipeline.sh --step A --step B
#   # Step C+D: قبل الافتتاح (08:00 Cairo = 06:00 UTC)
#   0  6  * * 0-4 cd /path/to/project && bash scripts/daily_market_pipeline.sh --step C --step D

set -e
cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

echo "[$(date)] === Daily Market Pipeline ==="
echo "[$(date)] Project: $PROJECT_DIR"

# تنفيذ الـ orchestrator
python3 scripts/daily_orchestrator.py "$@"

EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date)] ✅ Pipeline completed successfully"
else
    echo "[$(date)] ❌ Pipeline failed (exit=$EXIT_CODE)"
fi

exit $EXIT_CODE
