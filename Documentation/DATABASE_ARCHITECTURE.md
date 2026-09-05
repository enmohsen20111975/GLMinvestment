# 📐 Database Architecture — المعمارية الهندسية لقواعد البيانات

> **آخر تحديث:** 2026-09-05
> **المرجع الحي:** `SYSTEM_STATE.md` + هذا الملف

---

## 🎯 المبادئ الهندسية

1. **مصدر واحد للحقيقة (Single Source of Truth)** — كل نوع بيانات يتخزن في مكان واحد بس
2. **لا تكرار** — ماينفعش نفس البيانات يتكتب في أكتر من DB أو أكتر من جدول
3. **Fallback chain واضحة** — لو المصدر الأساسي مش متاح، fallback ترتيبي
4. **جداول نشطة بس** — أي جدول فاضي يتحدف (مش بيـ accumulate)
5. **Schema ثابت** — كل جدول له schema واضح وموّثق

---

## 📊 خريطة الـ DBs (بعد التنظيف)

### الأسعار اليومية (Daily Prices)

| DB | Table | Rows | الحجم | الحالة |
|----|-------|------|-------|--------|
| **`data_engine.db`** | **`egksco_price_history`** | **29,006** | 86 MB | ✅ **Source of Truth** |
| `stocks.db` | `stock_daily_prices` | 47,534 | 13 MB | Mirror (للـ Next.js) |
| `price_history.db` | `price_history` | 1,205,599 | 279 MB | أرشيف تاريخي كامل |
| `data_engine.db` | `historical_data` | 99,076 | 86 MB | سعودي/أمريكي/ذهب |

### الأسعار اللحظية (Intraday)

| DB | Table | Rows | الحجم |
|----|-------|------|-------|
| `intraday.db` | `stock_intraday` | 1,105,352 | 363 MB |
| `intraday.db` | `crypto_intraday` | 151,245 | 363 MB |
| `intraday.db` | `commodity_intraday` | 77,087 | 363 MB |
| `data_engine.db` | `stock_prices` | 2,444 | 86 MB |

### الأسهم (Stocks Master)

| DB | Table | Rows | الحالة |
|----|-------|------|--------|
| **`stocks.db`** | **`stocks`** | **956** | ✅ Source of Truth |
| `data_engine.db` | `stocks` | 1,585 | Mirror |
| `stocks.db` | `egksco_stocks` | 250 | subset |

---

## 🎯 المصادر الموثوقة (Source of Truth)

### لكل نوع بيانات:

| نوع البيانات | المصدر الأساسي | Fallback |
|--------------|---------------|----------|
| أسعار EGX يومية | `data_engine.db.egksco_price_history` | `stocks.db.stock_daily_prices` |
| أسعار سعودي/أمريكي | `data_engine.db.historical_data` | - |
| أسعار لحظية (intraday) | `intraday.db.stock_intraday` | - |
| أرشيف تاريخي كامل | `price_history.db.price_history` | - |
| بيانات الأسهم (master) | `stocks.db.stocks` | `data_engine.db.stocks` |
| fundamentals | `data_engine.db.tab_*` | - |
| توقعات | `predictions.db.stored_analyses` | - |
| أخبار | `news.db.market_news` | - |
| ذهب/فضة/عملات | `data_engine.db.gold_prices` + `silver_prices` + `exchange_rates` | - |
| crypto | `data_engine.db.crypto_prices` | `intraday.db.crypto_intraday` |

---

## 🔄 Fallback Chain للرادار (Maker Radar)

```
1. data_engine.db.egksco_price_history (symbol/price_date/turnover)
   ↓ لو مش موجود أو فاضي
2. stocks.db.stock_daily_prices (ticker/price_date/turnover)
   ↓ لو مش موجود أو فاضي
3. data_engine.db.historical_data (symbol/date — سعودي/أمريكي)
   ↓ لو مش موجود أو فاضي
4. production_snapshot.db / vps_real/stocks.db (sandbox)
```

**الـ detection ذكي:**
- بـ يتخطى الجداول الفاضية (0 rows) تلقائياً
- بـ يكتشف الـ schema الصح لكل جدول
- بـ يرجّع الـ `db_source` في الـ API response

---

## 🧹 الجداول المحذوفة (Cleanup 2026-09-05)

### من `stocks.db` (26 جدول فاضي):
- `egksco_price_history`, `news`, `news_items`, `predictions`
- `morning_reports`, `page_views`, `error_logs`, `feature_usage`
- `daily_analytics_summary`, `user_sessions`, `context_logs`
- `regime_indicator_weights`, `indicator_weights`, `learned_lessons`
- `prediction_logs`, `signal_logs`, `user_notifications`
- `paper_trades`, `pending_settlements`, `scraping_status`
- `telegram_messages`, `telegram_recommendations`, `telegram_images`
- `tracked_channels`, `financial_obligations`, `financial_transactions`

### من `data_engine.db` (1 جدول فاضي):
- `egx_fundamentals`

**المحذوفة:** 27 جدول
**النتيجة:** 113 جدول نشط بدل 140 (توفير 19%)

---

## 🛠️ سكربتات الصيانة

### 1. `scripts/setup_radar.py` — فحص حالة الـ DBs
```bash
python3 scripts/setup_radar.py --status
# يعرض كل الـ DBs + الجداول + الصفوف + الحجم
```

### 2. `scripts/cleanup_db_architecture.py` — تنظيف + توحيد
```bash
python3 scripts/cleanup_db_architecture.py --dry-run    # معاينة
python3 scripts/cleanup_db_architecture.py --execute    # تنفيذ
python3 scripts/cleanup_db_architecture.py --report     # تقرير فقط
```

### 3. `scripts/fetch_production_data.py` — سحب من الإنتاج (sandbox فقط)
```bash
python3 scripts/fetch_production_data.py --days 365
# ⚠️ للـ sandbox/laptop فقط — في الإنتاج الـ DBs موجودة
```

---

## 📐 قواعد هندسية للمستقبل

### ✅ إيه اللي مسموح:
1. إضافة جدول جديد لو فيه نوع بيانات جديد
2. إضافة columns لجدول موجود (لو محتاج)
3. تحديث الـ fallback chain لو الـ schema اتغير

### ❌ إيه اللي ممنوع:
1. **لا** تكرار نفس البيانات في أكتر من جدول
2. **لا** إنشاء DB جديد من غير سبب واضح
3. **لا** ترك جداول فاضية (احذفها فوراً)
4. **لا** كتابة بيانات في `stocks.db` لو الـ source of truth هو `data_engine.db`
5. **لا** تعديل schema من غير تحديث الـ fallback chain

---

## 🚀 خطوات الإنتاج (Deploy)

### 1. على السيرفر:
```bash
cd /root/GLMinvestment
git pull origin main

# شغّل التنظيف (لو أول مرة)
python3 scripts/cleanup_db_architecture.py --execute

# أعد التشغيل
pm2 restart nextjs
pm2 restart python-backend
```

### 2. تحقق:
```bash
# فحص الـ DBs
python3 scripts/setup_radar.py --status

# اختبر الـ radar API
curl http://localhost:8010/api/maker-radar?market=EGX
# المفروض يرجع: db_source: data_engine.db
```

---

## 📊 إحصائيات (بعد التنظيف)

| المتر | قبل | بعد |
|-------|------|------|
| عدد الـ DBs | 19 | 19 |
| عدد الجداول | 140 | 113 |
| جداول فاضية | 60 | 32 |
| الحجم الإجمالي | 750 MB | 754 MB |
| `egksco_price_history` rows | 0 | 29,006 ✅ |

---

*تم التنظيف بواسطة `cleanup_db_architecture.py` — 2026-09-05*
