#!/bin/bash
# =============================================================================
# فلترة توقعات الذكاء الاصطناعي على VPS - Smart Filter
# =============================================================================
#
# المشكلة: 538,396 توقع كتير جداً
# الحل: فلترة ذكية - الإبقاء على التوقعات الجيدة فقط
#
# معايير الحذف:
# 1. توقعات مكررة (نفس السهم + نفس التاريخ + نفس التوصية)
# 2. توقعات قديمة بدون نتيجة (أكثر من 60 يوم)
# 3. توقعات ثقة منخفضة جداً بدون نتيجة
# 4. توقعات بدون بيانات كافية
#
# معايير الاحتفاظ:
# 1. حققت الهدف ✓
# 2. وقف خسارة ✓
# 3. نشطة (تاريخ حديث) ✓
# 4. ثقة عالية ✓
#
# Usage:
#   chmod +x scripts/smart_filter_vps.sh
#   ./scripts/smart_filter_vps.sh
#
# =============================================================================

set -e

echo "========================================================================"
echo "🧹 فلترة توقعات الذكاء الاصطناعي - Smart Filter"
echo "========================================================================"

# البحث عن قاعدة البيانات
DB_PATHS=(
    "/root/GLMinvestment/db/stocks.db"
    "./db/stocks.db"
)

DB_PATH=""
for path in "${DB_PATHS[@]}"; do
    if [ -f "$path" ]; then
        DB_PATH="$path"
        break
    fi
done

if [ -z "$DB_PATH" ]; then
    echo "❌ لم يتم العثور على قاعدة البيانات"
    exit 1
fi

echo ""
echo "📂 قاعدة البيانات: $DB_PATH"
echo "   الحجم: $(du -h "$DB_PATH" | cut -f1)"
echo ""

# =============================================================================
# عرض الإحصائيات الحالية
# =============================================================================

echo "📊 الإحصائيات الحالية:"
echo "------------------------------------------------------------------------"

TOTAL=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM prediction_logs;" 2>/dev/null || echo "0")
HIT_TARGET=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM prediction_logs WHERE target_reached = 1;" 2>/dev/null || echo "0")
STOP_HIT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM prediction_logs WHERE stop_hit = 1;" 2>/dev/null || echo "0")
PENDING=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM prediction_logs WHERE target_reached = 0 AND stop_hit = 0;" 2>/dev/null || echo "0")

echo "   📈 إجمالى التوقعات: $TOTAL"
echo "   ✅ حققت الهدف: $HIT_TARGET"
echo "   ❌ وقف خسارة: $STOP_HIT"
echo "   ⏳ معلقة: $PENDING"

if [ "$TOTAL" == "0" ]; then
    echo ""
    echo "✓ لا توجد توقعات للفلترة"
    exit 0
fi

# =============================================================================
# تحليل ما سيتم حذفه
# =============================================================================

echo ""
echo "🔍 تحليل التوقعات للحذف:"
echo "------------------------------------------------------------------------"

# 1. التكرارات
DUPLICATES=$(sqlite3 "$DB_PATH" "
    SELECT COUNT(*) FROM prediction_logs
    WHERE rowid NOT IN (
        SELECT MAX(rowid) FROM prediction_logs
        GROUP BY ticker, prediction_date, recommendation
    );
" 2>/dev/null || echo "0")
echo "   🔁 توقعات مكررة: $DUPLICATES"

# 2. قديمة بدون نتيجة (60 يوم)
CUTOFF_DATE=$(date -d "60 days ago" +%Y-%m-%d 2>/dev/null || date -v-60d +%Y-%m-%d 2>/dev/null)
OLD_PENDING=$(sqlite3 "$DB_PATH" "
    SELECT COUNT(*) FROM prediction_logs
    WHERE prediction_date < '$CUTOFF_DATE'
    AND target_reached = 0 AND stop_hit = 0
    AND prediction_date IS NOT NULL;
" 2>/dev/null || echo "0")
echo "   📅 قديمة بدون نتيجة (قبل $CUTOFF_DATE): $OLD_PENDING"

# 3. ثقة منخفضة بدون نتيجة
LOW_CONF=$(sqlite3 "$DB_PATH" "
    SELECT COUNT(*) FROM prediction_logs
    WHERE (confidence < 40 OR confidence IS NULL)
    AND target_reached = 0 AND stop_hit = 0;
" 2>/dev/null || echo "0")
echo "   📉 ثقة منخفضة بدون نتيجة: $LOW_CONF"

# 4. بيانات ناقصة
INVALID=$(sqlite3 "$DB_PATH" "
    SELECT COUNT(*) FROM prediction_logs
    WHERE ticker IS NULL OR ticker = '' OR prediction_date IS NULL;
" 2>/dev/null || echo "0")
echo "   ❓ بيانات ناقصة: $INVALID"

TOTAL_DELETE=$((DUPLICATES + OLD_PENDING + LOW_CONF + INVALID))
KEEP=$((TOTAL - TOTAL_DELETE))

echo ""
echo "📋 ملخص:"
echo "   سيتم حذف: $TOTAL_DELETE"
echo "   سنبقى: $KEEP توقع"

# =============================================================================
# تأكيد المستخدم
# =============================================================================

echo ""
read -p "هل تريد تنفيذ الفلترة؟ (y/n): " confirm

if [ "$confirm" != "y" ]; then
    echo "❌ تم الإلغاء"
    exit 0
fi

# =============================================================================
# تنفيذ الفلترة
# =============================================================================

echo ""
echo "🧹 تنفيذ الفلترة..."
echo "------------------------------------------------------------------------"

# 1. حذف المكررات
echo "   حذف التكرارات..."
sqlite3 "$DB_PATH" "
    DELETE FROM prediction_logs
    WHERE rowid NOT IN (
        SELECT MAX(rowid) FROM prediction_logs
        GROUP BY ticker, prediction_date, recommendation
    );
" 2>/dev/null
echo "   ✓ تم حذف $DUPLICATES تكرار"

# 2. حذف القديمة بدون نتيجة
echo "   حذف التوقعات القديمة بدون نتيجة..."
sqlite3 "$DB_PATH" "
    DELETE FROM prediction_logs
    WHERE prediction_date < '$CUTOFF_DATE'
    AND target_reached = 0 AND stop_hit = 0;
" 2>/dev/null
echo "   ✓ تم حذف $OLD_PENDING توقع قديم"

# 3. حذف ثقة منخفضة
echo "   حذف التوقعات ذات الثقة المنخفضة..."
sqlite3 "$DB_PATH" "
    DELETE FROM prediction_logs
    WHERE (confidence < 40 OR confidence IS NULL)
    AND target_reached = 0 AND stop_hit = 0;
" 2>/dev/null
echo "   ✓ تم حذف $LOW_CONF توقع ثقة منخفضة"

# 4. حذف بيانات ناقصة
echo "   حذف التوقعات ذات البيانات الناقصة..."
sqlite3 "$DB_PATH" "
    DELETE FROM prediction_logs
    WHERE ticker IS NULL OR ticker = '' OR prediction_date IS NULL;
" 2>/dev/null
echo "   ✓ تم حذف $INVALID توقع ناقص"

# تنظيف قاعدة البيانات
sqlite3 "$DB_PATH" "VACUUM;" 2>/dev/null
echo "   ✓ تم تنظيف قاعدة البيانات"

# =============================================================================
# النتيجة النهائية
# =============================================================================

NEW_TOTAL=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM prediction_logs;" 2>/dev/null || echo "0")
NEW_HIT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM prediction_logs WHERE target_reached = 1;" 2>/dev/null || echo "0")
NEW_STOP=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM prediction_logs WHERE stop_hit = 1;" 2>/dev/null || echo "0")
NEW_PENDING=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM prediction_logs WHERE target_reached = 0 AND stop_hit = 0;" 2>/dev/null || echo "0")

echo ""
echo "========================================================================"
echo "✅ تمت الفلترة بنجاح!"
echo "========================================================================"
echo ""
echo "📊 النتيجة النهائية:"
echo "------------------------------------------------------------------------"
echo "   قبل: $TOTAL توقع"
echo "   بعد: $NEW_TOTAL توقع"
echo "   تم حذف: $((TOTAL - NEW_TOTAL)) توقع"
echo ""
echo "   ✅ حققت الهدف: $NEW_HIT"
echo "   ❌ وقف خسارة: $NEW_STOP"
echo "   ⏳ معلقة: $NEW_PENDING"
echo ""
echo "   الحجم الجديد: $(du -h "$DB_PATH" | cut -f1)"
echo ""
echo "⚠ تنبيه: أعد بناء التطبيق لتطبيق التغييرات"
echo "   cd /root/GLMinvestment && bun run build"
echo ""
