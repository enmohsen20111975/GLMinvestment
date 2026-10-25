#!/bin/bash
# ============================================================
# setup-daily-health-cron.sh — تثبيت cron job للفحص اليومي
# ============================================================
# ينشئ مهمة cron تشغل daily_db_health_check.py يومياً
# الساعة 3 صباحاً بتوقيت القاهرة (Africa/Cairo)
#
# الاستخدام:
#   bash scripts/setup-daily-health-cron.sh          # تثبيت
#   bash scripts/setup-daily-health-cron.sh --remove # إزالة
#   bash scripts/setup-daily-health-cron.sh --status  # حالة
# ============================================================

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$PROJECT_DIR/scripts/daily_db_health_check.py"
LOG_FILE="$PROJECT_DIR/db/backups/daily_health.log"
CRON_MARKER="# GLMinvestment daily DB health check"
CRON_SCHEDULE="0 3 * * *"  # يومياً 3 صباحاً
PYTHON_BIN="${PYTHON_BIN:-python3}"

# التأكد من وجود TZ Africa/Cairo (لو متاح)
export TZ="Africa/Cairo"

case "${1:---install}" in
  --install|--setup|"")
    # التحقق من المتطلبات
    if [ ! -f "$SCRIPT_PATH" ]; then
      echo "❌ السكربت غير موجود: $SCRIPT_PATH"
      exit 1
    fi
    
    if ! command -v $PYTHON_BIN >/dev/null 2>&1; then
      echo "❌ Python غير موجود: $PYTHON_BIN"
      exit 1
    fi
    
    if ! command -v crontab >/dev/null 2>&1; then
      echo "❌ crontab غير متاح. ثبّته: sudo apt install cron"
      exit 1
    fi
    
    # إنشاء مجلد backups
    mkdir -p "$PROJECT_DIR/db/backups"
    
    # إزالة أي cron قديم لنفس المشروع
    TEMP_CRON=$(mktemp)
    crontab -l 2>/dev/null | grep -v "$CRON_MARKER" | grep -v "daily_db_health_check" > "$TEMP_CRON" || true
    
    # إضافة الـ cron الجديد
    echo "$CRON_SCHEDULE cd $PROJECT_DIR && TZ=Africa/Cairo $PYTHON_BIN $SCRIPT_PATH >> $LOG_FILE 2>&1 $CRON_MARKER" >> "$TEMP_CRON"
    
    # تثبيت
    crontab "$TEMP_CRON"
    rm "$TEMP_CRON"
    
    echo "✅ تم تثبيت cron job بنجاح"
    echo ""
    echo "📋 التفاصيل:"
    echo "   - الجدولة: $CRON_SCHEDULE (يومياً 3 صباحاً بتوقيت Africa/Cairo)"
    echo "   - السكربت: $SCRIPT_PATH"
    echo "   - السجل:   $LOG_FILE"
    echo "   - Python:  $PYTHON_BIN"
    echo ""
    echo "🔍 المهمات الحالية:"
    crontab -l 2>/dev/null | grep -A1 "daily_db_health_check" || echo "   (لا توجد)"
    echo ""
    echo "💡 للفحص اليدوي الآن:"
    echo "   $PYTHON_BIN $SCRIPT_PATH --dry-run"
    echo "   $PYTHON_BIN $SCRIPT_PATH --verbose"
    ;;
    
  --remove|--uninstall)
    TEMP_CRON=$(mktemp)
    crontab -l 2>/dev/null | grep -v "$CRON_MARKER" | grep -v "daily_db_health_check" > "$TEMP_CRON" || true
    crontab "$TEMP_CRON"
    rm "$TEMP_CRON"
    echo "✅ تم إزالة cron job"
    ;;
    
  --status)
    echo "📋 حالة cron job:"
    if crontab -l 2>/dev/null | grep -q "daily_db_health_check"; then
      echo "   ✅ مثبت"
      crontab -l 2>/dev/null | grep "daily_db_health_check"
    else
      echo "   ❌ غير مثبت"
    fi
    echo ""
    echo "📋 آخر تقرير:"
    if [ -f "$PROJECT_DIR/db/backups/daily_health_report.json" ]; then
      $PYTHON_BIN -c "
import json
with open('$PROJECT_DIR/db/backups/daily_health_report.json') as f:
    d = json.load(f)
print(f'   Timestamp: {d[\"timestamp\"]}')
print(f'   Mode: {d[\"mode\"]}')
print(f'   Duration: {d[\"duration_seconds\"]}s')
s = d['summary']
print(f'   DBs: OK={s[\"ok_count\"]} Repaired={s[\"repaired_count\"]} Failed={s[\"failed_count\"]}')
if d.get('stocks_refresh'):
    sr = d['stocks_refresh']
    print(f'   Stocks refreshed: {sr[\"stocks_updated\"]} (NULL fixed: {sr[\"null_fixed\"]})')
" 2>/dev/null || echo "   (تعذر قراءة التقرير)"
    else
      echo "   (لا يوجد تقرير بعد)"
    fi
    echo ""
    echo "📋 آخر 10 أسطر من السجل:"
    if [ -f "$LOG_FILE" ]; then
      tail -10 "$LOG_FILE" 2>/dev/null | sed 's/^/   /'
    else
      echo "   (لا يوجد سجل بعد)"
    fi
    ;;
    
  *)
    echo "الاستخدام: $0 [--install|--remove|--status]"
    echo ""
    echo "الأوامر:"
    echo "  --install  تثبيت cron job (افتراضي)"
    echo "  --remove   إزالة cron job"
    echo "  --status   عرض الحالة والآخر تقرير"
    exit 1
    ;;
esac
