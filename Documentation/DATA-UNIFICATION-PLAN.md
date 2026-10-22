# Data Unification Plan — توحيد مصادر الأسعار

## القاعدة الذهبية
**مافيش أي حاجة تتمسح خالص.** كل البيانات تروح للأرشيف + ملف index.

## المراحل (كل مرحلة ب اختبار صارم)

### Phase 0: بناء فهرس المصادر (Source Index) ← **المرحلة الحالية**
- إنشاء `db/data_source_index.db` (قاعدة جديدة، ما تلمس أي قاعدة موجودة)
- فيها جدول واحد: `source_inventory` يسجل كل مصدر أسعار موجود:
  - `db_name` (stocks.db / price_history.db / data_engine.db / intraday.db)
  - `table_name` (price_history / stock_daily_prices / egksco_price_history / historical_data / stock_intraday)
  - `row_count`, `date_min`, `date_max`, `markets_covered`, `tickers_count`
  - `status` (active / deprecated / frozen)
  - `canonical_priority` (1 = primary, 2 = fallback, 3 = legacy)
- السكربت: `scripts/build_source_index.py`
- الاختبار: السكربت بيتحقق إن كل المدخلات صحيحة + يطبع تقرير

### Phase 1: إنشاء الأرشيف (Archive)
- نسخ `egksco_price_history` و `historical_data` كاملين إلى `db/archive/`
- تحديث `source_inventory`: status = `archived` للتلات جداول
- الاختبار: مقارنة row counts قبل/بعد الأرشفة

### Phase 2: توحيد price_history.db (المصدر الكاثوليكي)
- دمج بيانات `egksco_price_history` + `historical_data` + `stock_daily_prices` → `price_history.db.price_history`
- `INSERT OR IGNORE` (ما يلوشش أي حاجة موجودة)
- الاختبار: row count قبل/بعد + sample tickers + date ranges

### Phase 3: تعديل maker_radar.py (محرك واحد بس)
- تغيير مصدر القراءة من `historical_data` → `price_history.db`
- الاحتفاظ بـ fallback قديم مؤقتاً (للأمان)
- الاختبار: تشغيل `maker_radar.py --dry-run` ومقارنة النتائج قبل/بعد

### Phase 4: تعديل daily_predictor.py
- نفس المرحلة 3 بس لمحرك التوقعات
- الاختبار: backtest على 10 أسهم ومقارنة الإشارات

### Phase 5: تعديل liquidity_radar_v2.py + باقي المحركات
- باقي المحركات اللي بتقرا من المصادر القديمة
- الاختبار: تشغيل كل محرك + مقارنة outputs

### Phase 6: cron واحد بيملا price_history.db يومياً
- شيل الـ cron القديمة (sync_historical_data, sync_egksco, إلخ)
- حط cron واحد: `sync_to_canonical_price_history.py`
- الاختبار: مراقبة يومين

## الملفات اللي هتتعمل
- `db/data_source_index.db` (جديد — فهرس)
- `db/archive/` (جديد — أرشيف الجداول الملغاة)
- `scripts/build_source_index.py` (المرحلة 0)
- `scripts/archive_legacy_sources.py` (المرحلة 1)
- `scripts/unify_to_price_history.py` (المرحلة 2)
- تعديل `scripts/maker_radar.py` (المرحلة 3)
- تعديل `vps-service/jobs/daily_predictor.py` (المرحلة 4)
- `scripts/sync_to_canonical_price_history.py` (المرحلة 6)

## القواعد الصارمة
1. ✅ مافيش مسح — أرشفة فقط
2. ✅ كل مرحلة ب اختبار قبل الانتقال
3. ✅ كل تعديل في commit منفصل
4. ✅ backup قبل كل مرحلة
5. ✅ rollback plan جاهز لكل مرحلة
