#!/bin/bash
# =============================================================================
# تنظيف توقعات الذكاء الاصطناعي على VPS
# =============================================================================
#
# المشكلة: 538,396 توقع من التعلم التكرارى الفاسد
# الحل: تنظيف البيانات والإبقاء فقط على توصيات الخبراء
#
# الاستخدام:
#   chmod +x scripts/clean_vps_predictions.sh
#   ./scripts/clean_vps_predictions.sh
#
# =============================================================================

echo "========================================================================"
echo "تنظيف توقعات الذكاء الاصطناعي على VPS"
echo "========================================================================"

# تحديد مسار قاعدة البيانات
DB_PATH="/root/GLMinvestment/db/stocks.db"

# التحقق من وجود قاعدة البيانات
if [ ! -f "$DB_PATH" ]; then
    echo "❌ قاعدة البيانات غير موجودة: $DB_PATH"
    echo "   جارى البحث عن قاعدة البيانات..."
    
    # البحث عن قاعدة البيانات
    FOUND_DB=$(find /root -name "stocks.db" -type f 2>/dev/null | head -1)
    
    if [ -z "$FOUND_DB" ]; then
        echo "❌ لم يتم العثور على قاعدة البيانات"
        exit 1
    fi
    
    DB_PATH="$FOUND_DB"
    echo "✓ تم العثور على قاعدة البيانات: $DB_PATH"
fi

echo ""
echo "📂 قاعدة البيانات: $DB_PATH"
echo "   الحجم: $(du -h "$DB_PATH" | cut -f1)"
echo ""

# عرض الإحصائيات الحالية
echo "📊 الإحصائيات الحالية:"
echo "------------------------------------------------------------------------"

PREDICTIONS_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM prediction_logs;" 2>/dev/null || echo "0")
echo "   توقعات AI: $PREDICTIONS_COUNT"

EXPERT_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM ExpertRecommendation;" 2>/dev/null || echo "0")
echo "   توصيات الخبراء: $EXPERT_COUNT"

echo ""

# تأكيد المستخدم
read -p "هل تريد حذف $PREDICTIONS_COUNT توقع والإبقاء على توصيات الخبراء؟ (y/n): " confirm

if [ "$confirm" != "y" ]; then
    echo "❌ تم الإلغاء"
    exit 0
fi

echo ""
echo "🧹 جارى التنظيف..."
echo "------------------------------------------------------------------------"

# 1. حذف التوقعات القديمة
echo "   حذف التوقعات القديمة..."
sqlite3 "$DB_PATH" "DELETE FROM prediction_logs;" 2>/dev/null
sqlite3 "$DB_PATH" "DELETE FROM sqlite_sequence WHERE name='prediction_logs';" 2>/dev/null
echo "   ✓ تم حذف التوقعات القديمة"

# 2. إعادة بناء التوقعات من الخبراء
echo "   إعادة بناء التوقعات من الخبراء..."

sqlite3 "$DB_PATH" "
INSERT INTO prediction_logs (id, ticker, prediction_date, recommendation, confidence, entry_price, target_price, stop_loss, target_reached, stop_hit, direction_correct_5d)
SELECT 
    'expert_' || id,
    stock_symbol,
    session_date,
    CASE 
        WHEN action IN ('BUY', 'BUY_AND_HOLD', 'AVERAGE_DOWN') THEN 'ACCUMULATE'
        WHEN action = 'SELL' THEN 'REDUCE'
        ELSE 'HOLD'
    END,
    75,
    entry_price,
    target_price,
    stop_loss,
    CASE WHEN status IN ('TARGET_HIT', 'CLOSE_TO_TARGET') THEN 1 ELSE 0 END,
    CASE WHEN status = 'STOPPED' THEN 1 ELSE 0 END,
    CASE WHEN status IN ('TARGET_HIT', 'CLOSE_TO_TARGET') THEN 1 ELSE 0 END
FROM ExpertRecommendation
WHERE session_date IS NOT NULL;
" 2>/dev/null

NEW_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM prediction_logs;" 2>/dev/null || echo "0")
echo "   ✓ تم إدخال $NEW_COUNT توقع من الخبراء"

# 3. تنظيف الدروس المستفادة (لو موجودة)
echo "   تنظيف الدروس المستفادة..."
sqlite3 "$DB_PATH" "DELETE FROM learned_lessons WHERE created_at < date('now', '-30 days');" 2>/dev/null
echo "   ✓ تم الاحتفاظ بالدروس من آخر 30 يوم"

echo ""
echo "========================================================================"
echo "✓ تم التنظيف بنجاح!"
echo "========================================================================"
echo ""
echo "📊 الإحصائيات الجديدة:"
echo "------------------------------------------------------------------------"
echo "   توقعات AI: $NEW_COUNT"
echo "   توصيات الخبراء: $EXPERT_COUNT"
echo ""
echo "⚠ تنبيه: يجب إعادة بناء Next.js لتطبيق التغييرات"
echo "   cd /root/GLMinvestment && bun run build"
echo ""
