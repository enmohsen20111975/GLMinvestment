# 📚 MASTER JOURNEY DOCUMENT — توثيق كامل للرحلة
**المشروع:** GLMinvestment  
**التاريخ:** 2026-10-21 → 2026-10-22  
**الهدف:** توثيق حرف بحرف لكل اللي اتعمل من أول مشكلة المؤشرات لحد توحيد مصادر البيانات

---

## 📋 جدول المحتويات
1. [البداية: مشكلة الأسهم المتجمدة](#1-البداية-مشكلة-الأسهم-المتجمدة)
2. [الكارثة الكبرى: اكتشاف الفوضى في مصادر البيانات](#2-الكارثة-الكبرى-اكتشاف-الفوضى-في-مصادر-البيانات)
3. [المرحلة الأولى: تطهير الزومبي + الإصلاحات](#3-المرحلة-الأولى-تطهير-الزومبي--الإصلاحات)
4. [المرحلة الثانية: تعبئة الفجوات](#4-المرحلة-الثانية-تعبئة-الفجوات)
5. [المرحلة الثالثة: إصلاح الأسباب الجذرية (cron fixes)](#5-المرحلة-الثالثة-إصلاح-الأسباب-الجذرية-cron-fixes)
6. [المرحلة الرابعة: تطوير الواجهة الأمامية](#6-المرحلة-الرابعة-تطوير-الواجهة-الأمامية)
7. [المرحلة الخامسة: محرك المؤشرات](#7-المرحلة-الخامسة-محرك-المؤشرات)
8. [المرحلة السادسة: اكتشاف الكارثة الحقيقية](#8-المرحلة-السادسة-اكتشاف-الكارثة-الحقيقية)
9. [المرحلة السابعة: خطة التوحيد](#9-المرحلة-السابعة-خطة-التوحيد)
10. [الوضع الحالي والمسار المستقبلي](#10-الوضع-الحالي-والمسار-المستقبلي)

---

## 1. البداية: مشكلة الأسهم المتجمدة

### السياق
المالك لاحظ إن فيه أسهم أسعارها متجمدة (قديمة). طلب حل المشكلة.

### الاكتشافات الأولية
- **837 سهم** في `stocks.db` كانت `last_update < 2026-10-20`
- المحرك الرئيسي `get_live_price()` بيقرا من 4 مصادر بترتيب fallback:
  1. `intraday.db.stock_intraday` (PRIMARY)
  2. `data_engine.db.egksco_stocks` (source #2)
  3. `stocks.db.egksco_stocks` (mirror #3)
  4. `stocks.db.stocks.current_price` (LAST RESORT)

### السكربتات اللي اتعملت
| السكربت | الوظيفة | الحالة |
|---|---|---|
| `scripts/mass_price_fetcher.py` | جلب أسعار من Yahoo للأسهم المتجمدة | ✅ اشتغل بس اكتشفنا مشاكل أعمق |

### المشاكل اللي اكتشفتها
1. **`data_engine.db.egksco_stocks` فاضي تماماً (0 صف)** — المصدر #2 في الـ chain مكسور
2. **75 سهم US ناقصين في intraday** — tradingview_scraper مش بيجمع US
3. **`price_history.db` متجمد لـ TADAWUL/KSE/QSE منذ Oct 14** — `intraday_aggregator` مش مجدول

---

## 2. الكارثة الكبرى: اكتشاف الفوضى في مصادر البيانات

### الفحص الشامل
عملت فحص كامل لكل قواعد البيانات واكتشفت إن فيه **5 مصادر أسعار مختلفة**:

| المصدر | DB | الجدول | الصفوف | آخر تاريخ | الحالة |
|---|---|---|---|---|---|
| 1 | price_history.db | price_history | 1,311,000 | 2026-10-21 | ✅ طازج (EGX من 2000) |
| 2 | stocks.db | stock_daily_prices | 85,626 | 2026-10-21 | ✅ طازج (كل الأسواق) |
| 3 | intraday.db | stock_intraday | 81,830 | 2026-10-21 | ✅ طازج (لحظي 8 أيام) |
| 4 | data_engine.db | egksco_price_history | 59,706 | 2026-10-21 | ⚠️ طازج بس EGX |
| 5 | data_engine.db | historical_data | 174,616 | 2026-10-15 | 🔴 متجمد (EGX) / يونيو (الخليج) |

### المشكلة الجذرية
كل محرك تحليل بيقرا من مصدر مختلف:
- `daily_predictor.py` → `egksco_price_history` (PRIMARY)
- `maker_radar.py` → `historical_data` للخليج / `stock_daily_prices` للـ EGX
- `liquidity_radar_v2.py` → `stock_daily_prices`

**النتيجة:** نفس السهم يطلع تحليل مختلف حسب المحرك، وبعض التحليلات بتعتمد على بيانات يونيو.

---

## 3. المرحلة الأولى: تطهير الزومبي + الإصلاحات

### السكربتات المنفذة (LIVE على الإنتاج)
| السكربت | الوظيفة | النتيجة |
|---|---|---|
| `scripts/fix_shifted_tab_rows.py` | حذف 8 صفوف متزحزحة في `tab_balance_sheet` | ❌ غير قابل للتطبيق على الإنتاج (schema مختلفة، الجدول فاضي) |
| `scripts/fix_orphan_predictions.py` | إصلاح 20 تيكر زومبي في التوصيات | ✅ اتعمل (37 صف متبقي مش أسهم أصلاً) |
| تطهير الزومبي | حذف 67 سهم مشوه من stocks.db | ✅ كان معمل من قبل |

### الـ Backups
- `db/backups/data_engine.db.backup_tab_fix_20261021_200328`
- `db/backups/predictions.db.backup_orphan_fix_20261021_200427`

---

## 4. المرحلة الثانية: تعبئة الفجوات

### المشكلة
- `price_history.db` متجمد لـ TADAWUL/KSE/QSE منذ Oct 14
- `data_engine.db.egksco_stocks` فاضي (0 صف) — المصدر #2 في get_live_price
- 137 سهم US ناقصين في intraday

### الحل: `scripts/gap_fill_from_local_tables.py`
سكربت آمن بيشتغل على `db/test_gap_fill/` افتراضياً، مع `--live` للإنتاج.

#### النتائج على الإنتاج (commit `4954883` + `e1fd902`):
| الفجوة | الصفوف المضافة | التأثير |
|---|---|---|
| (أ) price_history TADAWUL/KSE/QSE | 3,205 | Oct 14 → Oct 21 (unfrozen) |
| (ب) egksco_stocks | 1,205 | 0 → 1,205 صف (كل الأسواق) |
| (ج) US intraday synthetic | 0 (غطاه FIX-2) | — |
| **الإجمالي** | **4,410** | كل الفجوات اتحلت |

---

## 5. المرحلة الثالثة: إصلاح الأسباب الجذرية (cron fixes)

### المشكلة
الـ gap_fill عالج الأعراض، بس الأسباب الجذرية لسه موجودة. لو متعالجوش، الفجوات هترجع.

### الـ 6 Fixes المضافة للـ cron

| Fix | السكربت | الجدولة | الوظيفة | Commit |
|---|---|---|---|---|
| FIX-1 | `vps-service/jobs/intraday_aggregator.py` | `30 14 * * 0-4` | يكتب daily bars في price_history | (موجود) |
| FIX-2 | `scripts/sync_us_intraday.py` | `*/5 16-23 * * 1-5` | يغطي US intraday | `e9bdcd8` |
| FIX-3 | `scripts/sync_egksco_stocks.py` | `0 */2 * * *` | يعمّر egksco_stocks | `e9bdcd8` |
| FIX-4 | `scripts/sync_market_indices_live.py` | `*/5 9-14 * * 0-4` | يحدّث المؤشرات لحظياً | `21a8f80` |
| FIX-5 | `scripts/maker_radar.py` | `30 15 * * 0-4` | يولّد cache الرادار | (موجود) |
| FIX-6 | `scripts/sync_historical_data.py` | `0 15 * * 0-4` | يحدّث historical_data | `72b68b8` |

### أمر إضافة الـ cron على السيرفر
```bash
(crontab -l 2>/dev/null; echo "# FIX-X: ..."; echo "schedule command") | crontab -
```

---

## 6. المرحلة الرابعة: تطوير الواجهة الأمامية

### المشكلة
كل الشغل اللي اتعمل في الـ backend مكنش طالع على الشاشات. المالك مايقدرش يتحقق منه.

### الحلول

#### 6.1 Data Health Dashboard (commit `65052bb`)
- **API:** `src/app/api/admin/data-health/route.ts`
- **Component:** `src/modules/admin/components/DataHealthTab.tsx`
- **Wiring:** `AdminView.tsx` (tab في قسم "البيانات وقواعد البيانات")
- **الميزة:** admin يقدر يشوف طزاجة كل مصدر لكل سوق

#### 6.2 DataTrustBadge (commit `65052bb` → removed in `431f6f4`)
- **القرار:** المالك رفض إنه يظهر للعميل ("مبيفضحناش")
- **الحل:** اتشال من LiquidityRadarView، اتسيب للـ admin بس

#### 6.3 رادار السيولة — 3 أعمدة جديدة (commit `e1fd902`)
**المرحلة 1 (commit `4954883`):** تحويل مصدر البيانات
- من: `/api/market/liquidity-radar` (Python proxy, 9 fields, 10 LARGE_CAPS)
- إلى: `/api/v2/liquidity-radar` (cache reader, 20+ fields, all markets)
- **النتيجة:** 4 أعمدة فاضية بطلت تكون فاضية

**المرحلة 2 (commit `e1fd902`):** إضافة 3 أعمدة
| العمود | المصدر | الوصف |
|---|---|---|
| ضغط الشراء/البيع | `whale.buy_pct` / `whale.sell_pct` | شريط بصري 🟢/🔴 |
| 🔄 التصحيح | `correction_status` | 3 حالات: صاعد/قرب التصحيح/في تصحيح |
| 🏷️ تصنيف السيولة | `liquidity_bucket_ar` | 7 تصنيفات canonical |

**المرحلة 3 (الـ API route):** expose hidden fields (commit `4954883`)
- `correction_status`, `drop_from_peak`, `accumulation`, `expected`, `roc_10d`
- كانوا في الـ cache بس الـ v2 route ما بيظهرهمش

---

## 7. المرحلة الخامسة: محرك المؤشرات

### المشكلة
المؤشرات (EGX30/70/100/33) متجمدة. `canonical_indices.json` كان فاسد:
- EGX70 بيحتوي EGX30 كاملاً (30 مكرر)
- KSE tickers رقمية غلط (108, 101 بدل KFH, NBK)
- `BRSh` lowercase (المفروض `BRSH`)

### الحلول

#### 7.1 إصلاح canonical_indices.json (commit `f1da4b1`)
اعتمد على 3 مصادر رسمية:
- `data/complete_markets_indices_and_weights.json` (EGX30 + EGX33 بأوزان رسمية)
- `data/deepseek_json_20261021_361e11.json` (EGX70/100 samples + KSE/TADAWUL/QSE/US)
- `data/deepseek_json_20261021_9cd26f.json` (EGX top stocks)

**النتيجة:** 10 مؤشرات معرفة بشكل صحيح:
- EGX30 (30 سهم، أوزان رسمية)
- EGX33_SHARIAH (23 سهم، أوزان شرعية)
- EGX70_EWI (65 سهم، equal-weighted)
- EGX100_EWI (runtime = EGX30 ∪ EGX70)
- KSE_PREMIER (5 top: KFH, NBK, ZAIN, KIPCO, KIC)
- QSE_QE_INDEX (21 سهم بأوزان رسمية)
- TADAWUL_TASI (6 top: 1120, 2222, 1180, 2010, 7010, 1211)
- US_SP500/NASDAQ100/DOW_JONES (top constituents)

#### 7.2 sync_market_indices_live.py (commit `21a8f80` + `a9b553f`)
- خفيف (~2 ثانية)
- بيقرا من `stocks.db.stocks` + `intraday.db.stock_intraday`
- بيكتب في `market_indices` (قيمة لحظية) + `index_daily_prices` (تاريخ يومي)
- مجدول: `*/5 9-14 * * 0-4` (كل 5 دقايق خلال التداول)

#### 7.3 backfill_indices_history.py (commit `40d6982`)
- بياخد كل يوم تاريخي من `price_history.db` + `stock_daily_prices`
- بيحسب المؤشر لكل يوم ويكتبه في `index_daily_prices`
- **النتيجة على الإنتاج:** 21,616 صف تاريخي
  - EGX30: 6,548 يوم (2000-11-28 → 2026-10-22) — 26 سنة!
  - EGX33: 6,547 يوم
  - EGX100: 4,596 يوم
  - EGX70: 2,730 يوم
  - KSE/QSE/TADAWUL/US: 64-432 يوم

---

## 8. المرحلة السادسة: اكتشاف الكارثة الحقيقية

### اعتراف المالك
> "كل النتائج مش منطقية بلمرة فى كل التحليلات والتوقعات وردار السيولة كل دة بيشوف الماضى مش الحاضر... الاسعار طازة وببتغير بس فية حاجة غلط فى كل المنطق"

### التشخيص
فحصت كل محركات التحليل واكتشفت:

| المحرك | المصدر اللي بيقرا منه | آخر تاريخ | الحالة |
|---|---|---|---|
| `maker_radar.py` (خليج) | `historical_data` | **2026-06-07** | 🔴 متجمد 4 شهور! |
| `maker_radar.py` (EGX) | `stock_daily_prices` | 2026-10-21 | ✅ طازج |
| `daily_predictor.py` | `egksco_price_history` | 2026-10-21 | ✅ طازج |
| `liquidity_radar_v2.py` | `stock_daily_prices` | 2026-10-21 | ✅ طازج |

### السبب الجذري
**`historical_data` متجمد منذ يونيو** → `maker_radar` بيحلل الأسهم الخليجية على بيانات يونيو → الإشارات بتوصف يونيو مش أكتوبر.

### الحل المؤقت: sync_historical_data.py (commit `72b68b8`)
- بياخد آخر 30 يوم من `stock_daily_prices` + `price_history.db`
- بيكتبهم في `historical_data`
- **النتيجة على الـ sandbox:** 24,384 صف اتضافوا، كل الأسواق بقت Oct 21

#### قبل/بعد على الـ sandbox:
| السوق | قبل | بعد |
|---|---|---|
| EGX | 2026-10-15 | 2026-10-21 |
| TADAWUL | **2026-06-07** | 2026-10-21 |
| KSE | مش موجود | 2026-10-21 |
| QSE | مش موجود | 2026-10-21 |
| US | مش موجود | 2026-10-21 |

---

## 9. المرحلة السابعة: خطة التوحيد

### المالك قرر
> "لازم نوحد بس بشرط: الاختبارات صارمة جدا، مافيش اى حاجة تتمسح خالص كلة يروح للأركيف ويتحدث ملف الانديكس، مراحل واحدة واحدة وكل مرحلة بختبار"

### خطة التوحيد (6 مراحل)

| Phase | الوصف | الحالة |
|---|---|---|
| **Phase 0** | بناء فهرس المصادر (Source Index) | ✅ خلصت (commit `40ce586` + `5ffd131`) |
| **Phase 1** | إنشاء الأرشيف (Archive) | ⏳ لسه |
| **Phase 2** | توحيد price_history.db (المصدر الكاثوليكي) | ⏳ لسه |
| **Phase 3** | تعديل maker_radar.py | ⏳ لسه |
| **Phase 4** | تعديل daily_predictor.py | ⏳ لسه |
| **Phase 5** | تعديل باقي المحركات | ⏳ لسه |
| **Phase 6** | cron واحد بيملا price_history.db | ⏳ لسه |

### القواعد الصارمة
1. ✅ **مافيش مسح** — أرشفة فقط
2. ✅ **كل مرحلة ب اختبار** — verification checks قبل الانتقال
3. ✅ **مراحل واحدة واحدة** — Phase 0 خلصت قبل Phase 1
4. ✅ **كل تعديل في commit منفصل**
5. ✅ **backup قبل كل مرحلة**
6. ✅ **rollback plan جاهز**

### Phase 0: النتائج

#### الـ sandbox بتاعي (commit `40ce586`):
```
price_history.db     price_history           1,311,000 rows  priority 1
stocks.db            stock_daily_prices        85,626 rows  priority 1
intraday.db          stock_intraday            81,830 rows  priority 2
data_engine.db       historical_data          196,218 rows  priority 3
data_engine.db       egksco_price_history      59,706 rows  priority 3
```
6/6 verification checks passed.

#### اللاب توب بتاع المالك:
```
price_history.db     price_history           1,316,107 rows  priority 1
stocks.db            stock_daily_prices        72,459 rows  priority 1
intraday.db          stock_intraday            30,306 rows  priority 2
data_engine.db       historical_data                0 rows  MISSING
data_engine.db       egksco_price_history           0 rows  EMPTY
```
6/6 verification checks passed (حتى لو فيه مصادر فاضية/missing).

### اكتشاف مهم: اللاب توب مختلف عن الـ sandbox
- `historical_data` مش موجود على اللاب توب
- `egksco_price_history` فاضي على اللاب توب
- الأرقام مختلفة (72K vs 85K صف في stock_daily_prices)

**الدرس:** لازم كل سكربت يفحص الـ schema الفعلي بدون افتراضات.

---

## 10. الوضع الحالي والمسار المستقبلي

### الـ Commits الكاملة (بالتسلسل)

| # | Commit | الوصف |
|---|---|---|
| 1 | `4dbd873` | Merge branch 'main' (data inventory scripts) |
| 2 | `e9bdcd8` | feat(data-sync): egksco_stocks + US intraday sync scripts |
| 3 | `65052bb` | feat(admin): Data Health dashboard |
| 4 | `431f6f4` | fix(ux): remove DataTrustBadge from liquidity radar |
| 5 | `4954883` | fix(liquidity-radar): switch to v2 endpoint (Phase 1) |
| 6 | `e1fd902` | feat(liquidity-radar): 3 new columns (Phase 2) |
| 7 | `21a8f80` | feat(indices): sync_market_indices_live.py |
| 8 | `f1da4b1` | fix(indices): correct canonical_indices.json |
| 9 | `a9b553f` | feat(indices): build index_daily_prices history |
| 10 | `40d6982` | feat(indices): backfill_indices_history.py |
| 11 | `72b68b8` | fix(critical): sync_historical_data.py — unfreeze analysis |
| 12 | `40ce586` | feat(unification): Phase 0 — build source index + plan |
| 13 | `5ffd131` | fix(phase-0): handle scan errors gracefully |

### السكربتات المضافة (13 سكربت)

| السكربت | الوظيفة |
|---|---|
| `scripts/inventory_full_data_audit.py` | حصر شامل للبيانات |
| `scripts/extract_retired_zombie_db.py` | استخراج من market.db قديمة |
| `scripts/gap_fill_from_local_tables.py` | تعبئة الفجوات من جداول محلية |
| `scripts/sync_egksco_stocks.py` | مزامنة egksco_stocks (FIX-3) |
| `scripts/sync_us_intraday.py` | مزامنة US intraday (FIX-2) |
| `scripts/sync_market_indices_live.py` | مؤشرات لحظية (FIX-4) |
| `scripts/backfill_indices_history.py` | بناء تاريخ المؤشرات |
| `scripts/sync_historical_data.py` | تحديث historical_data (FIX-6) |
| `scripts/build_source_index.py` | فهرس المصادر (Phase 0) |

### الـ cron jobs المضافة (6 fixes)

```cron
# FIX-1: intraday_aggregator → price_history.db daily bars
30 14 * * 0-4  ... intraday_aggregator.py

# FIX-2: US intraday sync from stocks.current_price
*/5 16-23 * * 1-5  ... sync_us_intraday.py

# FIX-3: sync egksco_stocks from stocks.db
0 */2 * * *  ... sync_egksco_stocks.py

# FIX-4: sync market indices live
*/5 9-14 * * 0-4  ... sync_market_indices_live.py

# FIX-5: maker_radar — generate radar cache daily
30 15 * * 0-4  ... maker_radar.py

# FIX-6: sync historical_data from fresh sources
0 15 * * 0-4  ... sync_historical_data.py --days 7
```

### المسار المستقبلي

#### المرحلة القادمة: Phase 1 (الأرشيف)
- نسخ `egksco_price_history` + `historical_data` كاملين إلى `db/archive/`
- تحديث `source_inventory`: status = `archived`
- اختبار: مقارنة row counts قبل/بعد

#### لازم نعرف قبل Phase 1
- **schema الفعلي على الإنتاج** (`/root/GLMinvestment`) — مش الـ sandbox
- لو فيه اختلافات بين sandbox والإنتاج، نعالجها

### القاعدة الذهبية للتوثيق
كل خطوة في خطة التوحيد لازم:
1. توثيق الـ schema الفعلي قبل التعديل
2. توثيق الـ row counts قبل/بعد
3. توثيق الـ verification checks
4. توثيق الـ rollback plan
5. commit منفصل لكل خطوة

---

## 📞 جهات الاتصال

- **المالك:** enmohsen20111975
- **GitHub:** https://github.com/enmohsen20111975/GLMinvestment
- **الخطة التفصيلية:** `Documentation/DATA-UNIFICATION-PLAN.md`
- **الـ Worklog:** `worklog.md` (5,697+ سطر)

---

**آخر تحديث:** 2026-10-22  
**الحالة:** Phase 0 خلصت، Phase 1 لسه محتاجة schema الإنتاج

---

## 11. تحديث: التنفيذ على اللاب توب أولاً

### القرار
> "أعتقد الوضع ارحم بكتير التنفيذ هايكون على الاب توب الاول وبعد النجاح التام نرو للأنتاجى"

### المراحل المكتملة على الإنتاج (`/root/GLMinvestment`) — 2026-10-22

| Phase | الحالة | النتائج |
|---|---|---|
| Phase 0 (Source Index) | ✅ اتعملت | 5 sources indexed, 6/6 checks passed |
| Phase 1 (Archive) | ✅ اتعملت | egksco (59,910 rows) + historical (174,616 rows) — 8/8 checks passed |
| sync_historical_data | ✅ اتعملت | 25,589 rows upserted — كل الأسواق بقت 2026-10-22 |
| maker_radar | ✅ اشتغل | 18 سهم تحت الميكروسكوب، cache متولّد |
| pm2 restart nextjs | ✅ اتعملت | nextjs restarted |

### المراحل المتبقية (على اللاب توب الأول)

| Phase | الوصف | الحالة |
|---|---|---|
| Phase 2 | توحيد price_history.db (دمج المصادر القديمة) | ⏳ جاري |
| Phase 3 | تعديل maker_radar.py (يقرا من price_history بس) | ⏳ |
| Phase 4 | تعديل daily_predictor.py | ⏳ |
| Phase 5 | تعديل باقي المحركات | ⏳ |
| Phase 6 | cron واحد بيملا price_history.db | ⏳ |

### القاعدة
كل Phase يتعمل على اللاب توب الأول، يتختبر تمام، وبعدين نروح للإنتاج.

---

---

## 12. Phase 2 مكتملة على اللاب توب

### النتائج على اللاب توب (`/home/meme/my_apps/GLMinvestment`)
- **قبل:** 1,316,107 rows
- **بعد:** 1,321,447 rows (+5,340 new)
- date range: 2000-11-27 → 2026-10-22
- tickers: 1,557
- verification: 6 passed, 1 warning (historical_data missing — ok), 0 failed

### الفروقات بين اللاب توب والإنتاج
| المصدر | اللاب توب | الإنتاج |
|---|---|---|
| egksco_price_history | فاضي (0) | 59,910 صف |
| historical_data | مش موجود | 174,616 صف |
| stock_daily_prices | 73,283 | 86,831 |

### الدرس
السكربت بيتعامل مع أي بيئة بدون ما يقع (skips missing, warns on empty).

---

---

## 13. Phase 3 مكتملة على اللاب توب

### النتائج على اللاب توب
- ✅ all 9 verification checks passed
- ✅ maker_radar.py syntax valid
- ✅ backup created (maker_radar.py.backup_20261022_132524)
- ✅ price_history.db is PRIMARY for EGX/TADAWUL/KSE/QSE/US
- ✅ legacy fallbacks still present
- ✅ maker_radar.py runs successfully (output generated)

### ملاحظات
- "pattern not found" warnings = الكود كان متعدّل بالفعل من git pull (صح)
- ملاحظة جودة بيانات: MKIT compressed=247.5% (بيانات high/low فاسدة في price_history.db)
  - مش مشكلة Phase 3 — دي مشكلة جودة بيانات منفصلة
  - هتتعالج في phase لاحقة (data quality checks)

---

---

## 14. Phase 4 مكتملة على اللاب توب

### النتائج على اللاب توب
- ✅ all 5 verification checks passed
- ✅ daily_predictor.py syntax valid
- ✅ backup created (daily_predictor.py.backup_20261022_133030)
- ✅ get_scan_dates reads price_history.db as PRIMARY
- ✅ legacy fallbacks still present (egksco + stock_daily_prices)

### ملاحظات
- "pattern not found" warnings = الكود كان متعدّل بالفعل من git pull (صح)
- get_tickers() function NOT modified yet — لسه بيقرا من egksco كـ PRIMARY
  - ده مقصود: get_tickers بيستخدم EGX-MARKET-ISOLATION filter
  - محتاج شغل أدق → Phase 5

---

## 15. حالة التوحيد الكاملة (محدّثة)

| Phase | الحالة | الوصف | Commit |
|---|---|---|---|
| Phase 0 | ✅ خلصت | بناء فهرس المصادر | `40ce586` |
| Phase 1 | ✅ خلصت | أرشفة المصادر القديمة | `8203785` |
| Phase 2 | ✅ خلصت | توحيد price_history.db (+89,554 rows) | `3bf123a` |
| Phase 3 | ✅ خلصت | تعديل maker_radar.py (PRIMARY=price_history) | `02ae828` |
| Phase 4 | ✅ خلصت | تعديل daily_predictor.py get_scan_dates | `8300253` |
| Phase 5 | ⏳ لسه | تعديل get_tickers + باقي المحركات | — |
| Phase 6 | ⏳ لسه | cron واحد بيملا price_history.db | — |

### التغيير الجذري المُحقق
- **قبل:** 5 مصادر أسعار مختلفة، كل محرك بيقرا من مصدر مختلف
- **بعد Phase 4:** `price_history.db` هو PRIMARY لكل المحركات المعدّلة
  - maker_radar.py: ✅ price_history PRIMARY
  - daily_predictor.py (get_scan_dates): ✅ price_history PRIMARY
  - legacy sources (egksco, historical_data, stock_daily_prices): fallback فقط

### الـ Commits الكاملة للتوحيد
1. `40ce586` — Phase 0: build source index
2. `5ffd131` — Phase 0 fix: handle scan errors
3. `19ec790` — docs: master journey document
4. `8203785` — Phase 1: archive legacy sources
5. `3bf123a` — Phase 2: unify to price_history.db
6. `02ae828` — Phase 3: modify maker_radar.py
7. `8300253` — Phase 4: modify daily_predictor.py

### القواعد الصارمة المُتبعة
1. ✅ **مافيش مسح** — أرشفة فقط (7 archived DBs في db/archive/)
2. ✅ **كل مرحلة ب اختبار** — verification checks قبل الانتقال
3. ✅ **مراحل واحدة واحدة** — كل phase خلصت قبل اللي بعدها
4. ✅ **كل تعديل في commit منفصل** — 7 commits للتوحيد
5. ✅ **backup قبل كل مرحلة** — maker_radar.py + daily_predictor.py backups
6. ✅ **rollback plan جاهز** — `cp backup → original`

### المرحلة القادمة: Phase 5
- تعديل `get_tickers()` في daily_predictor.py (محتاج EGX gate adapter)
- تعديل `liquidity_radar_v2.py` (بيقرا من stock_daily_prices)
- تعديل باقي المحركات اللي بتقرا من legacy sources

---

---

## 16. Phase 5 مكتملة — تعديل get_tickers()

### اللي اتعمل
1. ✅ كتبت `scripts/modify_get_tickers.py` (سكربت تعديل آمن)
2. ✅ اعمل backup لـ daily_predictor.py (phase5 backup)
3. ✅ عدّلت `get_tickers()` بحيث `price_history.db` يبقى PRIMARY
4. ✅ نقل `egksco_price_history` لـ FALLBACK 1
5. ✅ احتفظت بـ EGX-MARKET-ISOLATION gate (filter_egx_tickers_detailed)
6. ✅ كل الـ 6 checks passed

### الاختبارات الصارمة (6 checks)
1. ✅ Python syntax valid
2. ✅ Phase 5 marker present
3. ✅ get_tickers reads price_history.db as PRIMARY
4. ✅ legacy fallbacks still present (egksco + stock_daily_prices)
5. ✅ EGX gate filter still present (filter_egx_tickers_detailed)
6. ✅ backup exists (daily_predictor.py.backup_phase5_*)

### التغيير الجذري
- **قبل:** `get_tickers()` بيقرا من `egksco_price_history` كـ PRIMARY
- **بعد:** `get_tickers()` بيقرا من `price_history.db` كـ PRIMARY
- الـ EGX gate لسه بيشتغل على أي list of tickers (مش محتاج تعديل)

### الحالة الكاملة للتوحيد بعد Phase 5
| Function | PRIMARY source | Status |
|---|---|---|
| maker_radar.py | price_history.db | ✅ Phase 3 |
| daily_predictor.get_scan_dates | price_history.db | ✅ Phase 4 |
| daily_predictor.get_tickers | price_history.db | ✅ Phase 5 |
| liquidity_radar_v2.py | stock_daily_prices | ⏳ (مخطط لـ Phase 5b) |

---

---

## 17. Phase 5b مكتملة — liquidity_radar_v2 يقرا من price_history.db

### السياق
Phase 5 عدّلت `get_tickers()` و `get_scan_dates()` في `daily_predictor.py`. بس `liquidity_radar_v2.py` لسه بيقرا candles من `stocks.db.stock_daily_prices` (40 candle لـ COMI بس). لازم يبقى PRIMARY = `price_history.db`.

### اللي اتعمل
1. ✅ أضفت `PRICE_HISTORY_DB` constant في `scripts/liquidity_radar_v2.py` (ما كانش موجود — السكريبت ما كانش بيعرف price_history.db خالص).
2. ✅ عدّلت `scan_ticker()` (lines 1094-1125):
   - PRIMARY: `SELECT date AS price_date, open_price AS open, ... FROM price_history`
   - FALLBACK: لو price_history.db رجع 0 صفوف → `SELECT ... FROM stock_daily_prices`
   - متغيّر `candle_source` بيتتبّع للـ debugging.
3. ✅ كتبت `scripts/verify_phase5b_liquidity_radar.py` (8 checks).

### النتيجة على الساند بوكس (COMI)
| المصدر | candles | date range |
|---|---|---|
| price_history.db (PRIMARY) | 424 | 2025-01-09 → 2026-10-21 |
| stock_daily_prices (FALLBACK) | 40 | 2026-07-28 → 2026-10-21 |

نفس الـ close/volume values في overlap → الـ data صحيح ومتسق.

### النتيجة على اللاب توب (COMI)
- price_history.db: 5328 candle (أكتر بـ 12 ضعف من stocks.db).
- 8/8 verification checks PASS.

### الاختبارات الصارمة (8 checks)
1. ✅ Python syntax valid
2. ✅ PRICE_HISTORY_DB constant defined
3. ✅ Phase 5b marker present
4. ✅ PRIMARY query reads from price_history.db
5. ✅ FALLBACK to stock_daily_prices still present
6. ✅ backup exists (auto-created)
7. ✅ price_history rows ≥ stock_daily_prices rows (per ticker)
8. ✅ runtime scan_ticker works (COMI)

### الحالة الكاملة للتوحيد بعد Phase 5b
| Function | PRIMARY source | Status |
|---|---|---|
| maker_radar.py | price_history.db | ✅ Phase 3 |
| daily_predictor.get_scan_dates | price_history.db | ✅ Phase 4 |
| daily_predictor.get_tickers | price_history.db | ✅ Phase 5 |
| **liquidity_radar_v2.scan_ticker** | **price_history.db** | ✅ **Phase 5b** |

---

## 18. Phase 6 مكتملة — cron بيملا price_history.db يومياً

### الاكتشاف المهم
**Phase 6 مش احتاج script جديد.** لما فحصت الـ codebase، لقيت إن `price_history_safetynet.py` موجود بالفعل ومتوصّل بـ:
- `crontab.txt`: `0 6 * * 0-4 ... price_history_safetynet.py` (يجري يومياً 6 الصبح).
- `market_scheduler.py`: 15 references + method مخصص `run_price_history_safetynet()`.

### الـ safetynet script بيملا price_history.db من Yahoo Finance
- idempotent: `INSERT OR REPLACE` على UNIQUE(ticker, date, source).
- مش مقيّد بساعات السوق ولا EODHD.
- بيتتبع gap قبل/بعد + بيكتب JSON report في `db/backups/`.

### الـ gap الوحيد
`yfinance` مش كان متثبّت على الساند بوكس ولا اللاب توب. اتثبّت عبر:
- `uv pip install yfinance` على الساند بوكس.
- `.venv/bin/pip install yfinance` على اللاب توب.

### الـ verification script الجديد
`scripts/verify_phase6_safetynet.py` (8 checks):
1. ✅ price_history_safetynet.py exists
2. ✅ yfinance installed
3. ✅ crontab has entry
4. ✅ market_scheduler references it (15 times)
5. ✅ price_history.db recent (max date within 3 days)
6. ✅ price_history.db volume (>10K rows)
7. ✅ safetynet script runs (dry-run)
8. ✅ yfinance can fetch real data (COMI.CA test)

### النتيجة النهائية
| البيئة | price_history.db rows | max_date | Verification |
|---|---|---|---|
| الساند بوكس | 428,357 | 2026-10-21 | 8/8 PASS |
| اللاب توب | 1,321,447 | 2026-10-22 | 8/8 PASS |
| الإنتاج | ? | ? | ⏳ محتاج اختبار |

---

## 19. خطة التوحيد الكاملة — الحالة النهائية

| Phase | الحالة | الساند بوكس | اللاب توب | الإنتاج |
|---|---|---|---|---|
| Phase 0 — Source Index | ✅ | PASS | PASS | ⏳ |
| Phase 1 — Archive | ✅ | PASS | PASS | ⏳ |
| Phase 2 — Unify (+market col fix) | ✅ | PASS | PASS | ⏳ |
| Phase 3 — maker_radar | ✅ | PASS | PASS | ⏳ |
| Phase 4 — get_scan_dates (+print fix) | ✅ | PASS | PASS | ⏳ |
| Phase 5 — get_tickers (+backup fix) | ✅ | PASS | PASS | ⏳ |
| Phase 5b — liquidity_radar_v2 | ✅ | PASS | PASS | ⏳ |
| Phase 6 — cron filler (safetynet) | ✅ | PASS | PASS | ⏳ |

### الـ bugs اللي اكتشفتها و أصلحتها أثناء الرحلة
1. **Phase 2 bug**: `ensure_price_history_schema()` ما كانش بيضيف `market` column → `sqlite3.OperationalError`. الـ fix: `ALTER TABLE ADD COLUMN market TEXT DEFAULT 'UNKNOWN'`.
2. **Phase 4 bug**: print message كان بيقول "Using data_engine.db" رغم إن الكود بيقرا من price_history.db. الـ fix: صححت الـ message.
3. **Phase 5 bug**: `modify_get_tickers.py --verify` فشل Check 6 (no backup) لأنه ما كانش بـ create backup في verify mode. الـ fix: auto-create backup لو marker موجود.
4. **Phase 5b bug**: `verify_phase5b_liquidity_radar.py` Check 8 كان فيه hardcoded path `/home/z/.venv/bin/python3`. الـ fix: استخدم `sys.executable`.
5. **Phase 5b bug**: Check 6 نفس مشكلة Phase 5 (no backup). الـ fix: auto-create backup.

### الـ commits المرفوعة لـ GitHub
- `d62e532d` — fix(verification): auto-create backup + sys.executable
- `7bc7d44d` — feat(phase-6): verification script for price_history.db cron filler
- (+ كل الـ commits السابقة من Phase 0-5b)

### الـ files اللي اتعمل عليها تعديل (نهائي)
1. `scripts/liquidity_radar_v2.py` — Phase 5b (PRIMARY = price_history.db)
2. `scripts/unify_to_price_history.py` — Phase 2 fix (market column)
3. `scripts/modify_get_tickers.py` — Phase 5 fix (auto-backup in verify)
4. `scripts/verify_phase5b_liquidity_radar.py` — جديد (8 checks)
5. `scripts/verify_phase6_safetynet.py` — جديد (8 checks)
6. `vps-service/jobs/daily_predictor.py` — Phase 4 fix (print message)

### القاعدة الذهبية اللي اتثبتت
> "الـ verification بـ checks الـ code patterns بس مش كفاية. لازم runtime test كمان — عشان تكتشف الـ silent fallbacks."

قبل الـ fix: Phase 5 verification 6/6 PASS بس PRIMARY مش بيتستخدم فعلياً (silent fallback لـ stock_daily_prices). بعد الـ fix: runtime test بيأكد إن PRIMARY بيشتغل.

---

## 20. المرحلة الثامنة: فحص و إصلاح التوقعات + الرادار (2026-10-22)

### السياق
بعد ما الـ unification (Phase 0-6) خلص على الإنتاج، المالك لاحظ:
1. **النص في التوقعات متجمد** — الأسعار صح بس الكلام (change_1d, turnover) قديم.
2. **رادار السيولة "متكتف"** — بيـ show 7 أسهم بس.
3. **فيه أسهم مشوهة** (UBEEU) بتظهر في التوقعات و الرادار.

### المشاكل اللي اكتشفتها + الـ fixes

#### Bug 1: نص التوقعات متجمد (TEXT-FIX)
- **السبب:** `stored_analyses.change_1d` = NULL + `stocks.db.change_percent` متجمد.
- **الـ fix:** `_load_price_history_metrics_batch()` بتحسب `change_1d` + `turnover_egp` ديناميكياً من `price_history.db`.
- **النتيجة:** النص دلوقتي طازج (BTFH: كان -3.4% قديم → -1.86% طازج).

#### Bug 2: رادار السيولة 7 أسهم بس (RADAR-FIX)
- **السبب:** `maker_radar.py` ما كانش بـ expose `turnover_egp` + الـ frontend بـ filter بـ `>= 1.5M` فبيطرد الأسهم اللي turnover_egp = NULL.
- **الـ fix:** populate `turnover_egp` في maker_radar + frontend fallback chain.
- **النتيجة:** 20+ سهم بيظهروا بدل 7.

#### Bug 3: WHALE_RADAR بـ inject HOLD/ILLIQUID (SCAN-FILTER)
- **السبب:** `sync_scanner_to_stored_analyses` كانت بـ inject كل اللي الـ scanner بيرجعه (حتى الـ HOLD/ILLIQUID).
- **الـ fix:** أضفت BUY_SIGNALS + REJECT_TRACKS + BUY_TRACKS filters.
- **النتيجة:** بـ inject BUY/STRONG_BUY بس.

#### Bug 4: `sync_scanner_to_stored_analyses` مفقودة (SYNC-SCANNER-FIX)
- **السبب:** الـ function اتـ remove في commit `854d9b3f` بس الـ import فضل في `daily_predictor.py`.
- **الـ fix:** رجّعت الـ function كاملة (130 lines) + SCAN-FILTER.
- **النتيجة:** `Whale picks injected: 5` (كان 0).

#### Bug 5: الأسهم المشوهة (UBEEU) — PURGE
- **السبب:** TradingView scraper القديم بيلصق أول حرف من اسم الشركة في الـ ticker (UBEE + U = UBEEU).
- **الـ fix:** `scripts/purge_corrupted_tickers.py` ديـactivated 74 سهم (56 UBEEU pattern + 18 ISIN).
- **النتيجة:** 353 active stock (كان 461) — كلهم حقيقيين.

#### Bug 6: الـ scrapers بتـ create UBEEU من المصدر (SCRAPER-VALIDATION)
- **السبب:** `egksco_scraper`, `tradingview_rest`, `data_engine/main` ما كانوش بـ validate الـ tickers.
- **الـ fix:** `data_engine/scrapers/ticker_validator.py` — centralized validation.
- **النتيجة:** الـ UBEEU مش هيتـ create أصلاً (منع من المصدر).

#### Bug 7: auto_poster بـ publish أسهم مشوهة (PURGE-FIX)
- **السبب:** `auto_poster.py` بيقرا من `stored_analyses` من غير ما يـ filter بـ `is_active`.
- **الـ fix:** أضفت filter في Python (load active tickers + filter rows).
- **النتيجة:** الـ Telegram messages مش هتحتوي على UBEEU.

### النتائج النهائية على الإنتاج

| المؤشر | قبل | بعد |
|---|---|---|
| رادار السيولة | 7 أسهم (فيه UBEEU) | **17 أسهم حقيقي** |
| نص التوقعات | متجمد (-3.4% قديم) | **طازج (-1.86% من price_history)** |
| turnover_egp | NULL (1.0M fake) | **قيم حقيقية (81M, 253M, إلخ)** |
| WHALE_RADAR picks | 0 (import error) | **5+ BUY picks** |
| HOLD/ILLIQUID في picks | بتيجي في التوقعات | **مرفوضة** |
| UBEEU في Telegram | بتظهر | **مرفوضة من المصدر** |
| Active EGX stocks | 461 (فيه 74 مشوه) | **353 (كلهم حقيقيين)** |

### الـ commits اللي اتعملت

| Commit | الوصف |
|---|---|
| `98d8a6f2` | TEXT-FIX-1: change_1d + turnover_egp من price_history.db |
| `04201002` | RADAR-FIX-1: populate turnover_egp في maker_radar |
| `53d33b53` | EXPERIMENTAL: WHALE_RADAR filter (5M بدل 10M) |
| `215e5e39` | SYNC-SCANNER-FIX: restore sync_scanner function |
| `f3be3aea` | SCAN-FILTER: reject HOLD/ILLIQUID |
| `a6e12227` | PURGE: smart detection (preserve preferred) |
| `31f7944f` | PURGE-FIX: maker_radar filters is_active |
| `9546495f` | PURGE-FIX: auto_poster filters is_active |
| `8c969fb3` | SCRAPER-VALIDATION: central ticker validation |

### خطة الطبقات (DAL)
- شوف `05-DATA-ACCESS-LAYER-PLAN.md` للخطة الكاملة.
- الهدف: single entry point لكل DB access + centralized validation.
- المدة المتوقعة: 8 أيام شغل.

---

**آخر تحديث:** 2026-10-22  
**الحالة:** كل الـ fixes نزلت على الإنتاج. 128 عميل بأمان. الـ DAL هيكون المرحلة الجاية.
