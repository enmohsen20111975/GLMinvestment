#!/bin/bash
# تحديث التوقعات وإعادة توليد Prisma Client
# يجب تشغيل هذا السكربت على السيرفر

set -e  # يتوقف عند أي خطأ

echo "=========================================="
echo "🔄 تحديث التوقعات الشامل"
echo "=========================================="

# 1. توليد التوقعات أولاً (سينشئ الجدول مع عمود market)
echo ""
echo "📊 توليد التوقعات..."
python3 scripts/generate_real_predictions.py

# 2. إعادة توليد Prisma Client ليعرف عمود market
echo ""
echo "📦 إعادة توليد Prisma Client..."
npx prisma generate --schema=prisma/predictions-schema.prisma

# 3. إعادة تشغيل Next.js فقط (لتحميل Prisma Client الجديد)
echo ""
echo "🔄 إعادة تشغيل Next.js..."
pm2 restart nextjs-frontend

# 4. انتظار تحميل الخدمة
echo ""
echo "⏳ انتظار تحميل الخدمة..."
sleep 5

# 5. اختبار الـ API
echo ""
echo "🧪 اختبار الـ API..."
curl -s "http://localhost:3000/api/monthly-performance?year=2026" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data.get('success'):
        print(f'✅ نجح! إجمالي التوقعات: {data[\"summary\"][\"totalPredictions\"]}')
        print(f'   الأسواق: {len(data.get(\"byMarket\", []))} سوق')
        for m in data.get('byMarket', []):
            print(f'   - {m[\"marketName\"]}: {m[\"total\"]} توقع')
    else:
        print('❌ فشل في الاستجابة')
except Exception as e:
    print(f'❌ خطأ: {e}')
"

echo ""
echo "=========================================="
echo "✅ تم التحديث بنجاح!"
echo "🌐 يمكن عرض التوقعات من: https://invist.m2y.net/#prediction-performance"
echo "=========================================="
