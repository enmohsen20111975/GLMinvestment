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
