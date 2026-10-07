# 🚨 تقرير كوارث خط سير البيانات — GLMinvestment
**التاريخ:** 2026-10-07
**المراجع:** DATA-AUDIT-1/2/3 + CODE-AUDIT-1 + API-AUDIT-1 + SCRAPER-AUDIT-1
**السبب الجذري لشكوى العميل "المشروع في وادٍ والسوق في وادٍ تانٍ"**

---

## 📊 خريطة خط سير البيانات الحالي (المكسور)

```
SCRAPERS (cron)
  ├─ tradingview_scraper ──────┐
  ├─ egksco_scraper            ├─→ DB1: db/data_engine.db.stocks            (✅ market='مصر')
  ├─ egxpilot_scraper          │      db/data_engine.db.egksco_price_history (🐛 market='US' — 95%+ EGX مُسمّى غلط)
  ├─ yahoo_scraper ────────────┘
  ├─ daily_price_updater ────→ DB2: db/stocks.db.stocks (current_price — OK)
  │                            DB2: db/stocks.db.stock_daily_prices (🐛 market='US' — 100% EGX مُسمّى غلط)
  │                            DB3: db/price_history.db.price_history (✅ للأسهم الأمريكية، 🐛 للـ EGX)
  ├─ gap_filler + eodhd ────→ DB2.stock_daily_prices (🐛 يرث 'US')
  └─ us_stock_scraper ──────→ DB3.price_history (✅ 'US' صحيح للأسهم الأمريكية)

CONSOLIDATION:
  └─ consolidate_prices.py ─── DB2.stock_daily_prices → DB1.egksco_price_history (🐛 ينقل الخطأ)

ANALYZERS (cron + on-demand):
  ├─ master_analyzer.py ───── يقرأ من DB3.price_history → DB1.egksco_price_history → DB2.stocks
  │   (مفيش فحص freshness على الـ historical candles — العميل بيشوف توقع بأسعار قديمة)
  │   └─ يكتب لـ DB4.predictions.db.predictions
  ├─ daily_predictor.py ───── يكتب نفس التوقع مرتين: predictions + stored_analyses
  │   (سبب التكرار: 6 جداول بتخزن نفس البيانات)
  └─ v40_2_daily_generator ─── يقرأ DB1.egksco_price_history (market='US' غلط) → predictions.db

RADAR:
  └─ maker_radar.py ───────── يقرأ DB2.stock_daily_prices (originally market='US' فلتر السوق بيتخطاه)
                              + DB2.stocks.current_price (live)
                              └─ يكتب DB2.radar_signal_tracking (إحنا أصلحنا الـ staleness)

APIs (Next.js :3000):
  ├─ /api/predictions/honest-tracking/list ─── يقرأ DB4.predictions (fallback لـ VPS الإنتاج)
  ├─ /api/predictions ──────────────────────── يقرأ DB4.predictions + stored_analyses (JOIN)
  ├─ /api/predictions/daily-picks ──────────── يقرأ DB4.predictions + DB2.stocks (sector)
  └─ /api/maker-radar ──────────────────────── يقرأ JSON cache فقط (مش DB مباشرة)
                                                warmup script بيقرأ DB2.stock_daily_prices
```

---

## 🐛 10 كوارث حقيقية مكتشفة

### 1. ⚠️ **خطأ `market='US'` على 95%+ من أسهم EGX**
- **DB1.egksco_price_history**: 70,511 صف مُسَمّى `market='US'` (يفترض `مصر`)
- **DB2.stock_daily_prices**: 96,013 صف EGX مُسَمّى `market='US'` (100% من EGX)
- **السبب**: schema `DEFAULT 'US'` على 3 جداول سعرية. الـ scrapers بتعمل INSERT بدون تحديد `market` → يرث 'US'.
- **الأثر**: أي فلتر `WHERE market='EGX'` بيرجّع 0 صفوف لأسهم EGX في كل الجداول دي.
- **الحل**: `UPDATE ... SET market='مصر' WHERE ticker IN (SELECT ticker FROM stocks WHERE market='EGX')` على الـ 3 جداول.

### 2. ⚠️ **6 جداول بيتخزن فيها نفس بيانات التوقع**
- `predictions` (1514 صف)
- `aiPrediction` (2603 صف — abandonware)
- `persona_predictions` (1669 صف — analysis_json بـ 0%)
- `platform_recommendations` (0 صف — ميتة)
- `stored_analyses` (41 صف فقط)
- `cached_analysis` (0 صف — ميتة)

**النتيجة**: HRHO entry_price = 24.30 في `predictions`، 25.69 في `aiPrediction`، 25.56 في `persona_predictions` — 3 أسعار مختلفة لنفس السهم في نفس اليوم!

**الحل**: اعتماد `predictions` كـ single source of truth + حذف الجداول الميتة.

### 3. ⚠️ **`stock_phase` قديم 43 يوم + scale خاطئ**
- كل الصفوف بتاريخ `2026-08-25`
- DTPP `last_close = 12.36` بينما السعر الفعلي `318`
- HRHO `last_close = 0.25` بينما السعر الفعلي `26.79`
- **السبب**: الـ phase computer مش بيشتغل من 25 أغسطس
- **الأثر**: واجهة العميل بتعرض support/resistance خاطئ

### 4. ⚠️ **`stocks.close = 0.0` لكل الأسهم**
- العمود ميت 100% — أي query بتستخدمه بترجّع 0
- كل الـ code لازم يستخدم `current_price` بدلاً منه

### 5. ⚠️ **8 من 50 توقع أخير entry_price قديم >5%**
- HRHO: 24.30 vs فعلي 26.00 (-6.54%)
- ETEL: -9.39%
- CPCI: -7.46%
- FNAR: -6.12%
- VALU: -5.16%
- GBCO: -5.78%
- **السبب**: `entry_price` بيتسجل قبل `prediction_date` بيوم تداول كامل

### 6. ⚠️ **`signal_date` format غير متسق**
- 1,087 صف بصيغة `YYYY-MM-DD`
- 11 صف بصيغة `YYYYMMDD` (بدون شرطة)
- **السبب**: 2 كتاب مختلفين ما بيتفقوش على الفورمات

### 7. ⚠️ **radar verification pipeline ما بيشتغلش أبداً**
- في 1,098 صف في `radar_signal_tracking`
- بس status فيه بس `pending` (766) و `stale_data` (332)
- ما فيش ولا `verified_win` ولا `verified_loss`
- **الأثر**: مفيش backtest على إشارات الرادار

### 8. ⚠️ **`real_evaluated_predictions` sign-flip bug**
- HRHO: signal=SELL, entry=26.51, exit=29.16, hit_target=1, return_pct=-10.0%
- يعني: توقع SELL نجح لكن النسبة سالبة → bug في حساب الإشارة

### 9. ⚠️ **`market_indices` قديم 7 شهور**
- EGX33 + EGX50 آخر تحديث `2026-03-11`
- **الأثر**: مؤشر السوق العامل بيه الرادار لأخذ ريجيم السوق قديم

### 10. ⚠️ **API radar مبيقرأش DB مباشرة**
- `/api/maker-radar` بيقرأ JSON cache من `scripts/output/maker_radar_*.json`
- لو الـ cache مفقود أو قديم → 503 "warming up"
- **الأثر**: لو scraper فشل → API بيرجّع قديم بدون warning للعميل

---

## 📋 خطة الإصلاح (مرتبة بالأولوية)

### Phase 1: إصلاحات عاجلة (اليوم)
1. **إصلاح market tag** — `UPDATE` على الـ 3 جداول المكسورة
2. **تنظيف التوقعات المكررة** — حذف `aiPrediction` (متعطل) + `platform_recommendations` (ميتة)
3. **توحيد signal_date format** — `UPDATE ... SET signal_date = substr(...)`
4. **حذف التكرار في `radar_signal_tracking`** — `2026-10-06` فيه 10 أسهم مكررة

### Phase 2: إعادة بناء (الأسبوع ده)
5. **تشغيل phase computer** — تحديث `stock_phase`
6. **تشغيل radar verification pipeline** — تفعيل الـ outcomes
7. **إصلاح `stocks.close`** — `UPDATE stocks SET close = current_price`
8. **تحديث `market_indices`** — تشغيل الـ scraper المختص

### Phase 3: توحيد البنية (الأسبوع الجاي)
9. **تعديل `daily_predictor.py`** — يكتب في `predictions` فقط (مش في `stored_analyses`)
10. **تعديل الـ scrapers** — إضافة `market` صريح في كل INSERT
11. **تعديل schema** — `ALTER TABLE ... DEFAULT 'EGX'` بدلاً من `'US'`
12. **API radar** — إضافة fallback يقرأ من DB مباشرة لو cache قديم

---

## 💻 أوامر السرفر — جاهزة للنسخ واللصق

كل الأوامر موجودة في `/home/z/my-project/download/SERVER_FIX_COMMANDS.sh` — سكريبت bash executable.

### تشغيل سريع على السرفر:
```bash
cd /root/GLMinvestment
git pull origin main
chmod +x download/SERVER_FIX_COMMANDS.sh
bash download/SERVER_FIX_COMMANDS.sh
```

### أوامر Git push:
```bash
cd /root/GLMinvestment
git add scripts/maker_radar.py scripts/backfill_stale_radar_signals.py scripts/verify_radar_fix.py download/DATA_AUDIT_REPORT.md download/SERVER_FIX_COMMANDS.sh worklog.md
git commit -m "fix(data): FRESHNESS GUARD + audit report — منع التوصيات بأسعار قديمة + تقرير كوارث خط سير البيانات

السبب الجذري لشكوى العميل 'المشروع في وادٍ والسوق في وادٍ تانٍ':
- 95%+ من أسهم EGX مُسَمّاة market='US' في 3 جداول سعرية
- 6 جداول بتخزن نفس بيانات التوقع (تكرار + تعارض)
- stock_phase قديم 43 يوم + scale خاطئ (DTPP last_close=12.36 vs 318)
- 8 من 50 توقع أخير entry_price قديم >5% من السعر الفعلي
- radar verification pipeline ما بيشتغلش أبداً (0 verified signals)

الإصلاحات المطبقة:
- FRESHNESS GUARD في maker_radar.py (3 طبقات: detection + freshest-source + schema upgrade)
- backfill_stale_radar_signals.py — 332 إشارة معلّمة stale_data
- verify_radar_fix.py — سكريبت تحقق من الإصلاح
- DATA_AUDIT_REPORT.md — تقرير الكوارث الكامل (10 كوارث + خطة إصلاح)
- SERVER_FIX_COMMANDS.sh — سكريبت أوامر السرفر الجاهز

النتيجة:
- HRHO entry=26.79 (live, fresh 1d) ✓
- DTPP entry القديم (326.01) → status=stale_data + daily_price=295.36 ✓
- 69 إشارة جديدة كلها marked fresh بـ price_source=live ✓

التالي: تنفيذ Phase 1 (إصلاحات عاجلة) من SERVER_FIX_COMMANDS.sh على السرفر"

git push origin main
```

### بعد الـ push، سجل في worklog.md:
```bash
echo "
---
Task ID: FINAL-PUSH-2026-10-07
Agent: main
Task: رفع إصلاح الـ FRESHNESS GUARD + تقرير الكوارث للـ GitHub

Work Log:
- تم commit eef2fa1f: FRESHNESS GUARD في maker_radar.py
- تم إعداد DATA_AUDIT_REPORT.md + SERVER_FIX_COMMANDS.sh
- تم رفع الكل على origin/main

Stage Summary:
- 5 subagents شغالة بالتوازي عملوا audit شامل لـ 4 DBs + codebase + APIs
- 10 كوارث حقيقية مكتشفة وموثقة
- خطة إصلاح 3 phases (12 خطوة) جاهزة للتنفيذ
- العميل يقدر يشغل SERVER_FIX_COMMANDS.sh على السرفر مباشرة
" >> worklog.md
git add worklog.md && git commit -m "docs: worklog نهائي للجلسة" && git push origin main
```
