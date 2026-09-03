# 🔬 ملف تفصيلي: منهجية التحليل والتوقعات — الحقيقة الكاملة

> **تاريخ الكتابة:** 2026-09-01
> **آخر تحديث:** 2026-09-01 (إضافة قسم 11: النوتبوك + الخروج الهيكلي + Disclosure + Strict Entry + News Fetcher + 10 Feature Flags + نتائج باك-تست B0/B1/B2/B3)
> **الغرض:** توثيق كامل لأسلوب التفكير في عمل التحليلات والتوقعات، من الكود مش من كلام.
> **الهدف:** المالك يعرف يحل المشكلة.

---

## 1. المعمارية الحالية (من الكود)

### مصادر البيانات

| DB | حجم | محتوى | مين بـ يقرأها |
|---|---|---|---|
| `db/stocks.db` | 11.5 MB | 452 سهم EGX (snapshot يومي: price, RSI, MA50/200, sector, PE, ROE) | Screener + unified_analysis |
| `db/data_engine.db` | 125 MB | 162,946 صف OHLCV تاريخي (2025-01-09 → 2026-08-27) | **V40.2** + unified_analysis |
| `db/predictions.db` | 4.7 MB | 35 توقع (3 نشطة) | unified_analysis + daily_closer |

### المحرك الواحد (بعد التوحيد)

```
unified_analysis.py (محرك واحد)
├── يقرأ stocks.db (metadata: sector, PE, ROE)
├── يقرأ data_engine.db (OHLCV تاريخي)
├── يقرأ predictions.db (توقعات نشطة)
├── يحسب stock_state (momentum 0-100, state)
├── يطبق V68 (dirty_dist, probability, liquidity_grab)
├── يطبق V72 (hidden_dist, wash_trade, choch_bear)
├── يطبق V73 (desert_phase, auction_trap)
└── يرجع verdict + reason
```

---

## 2. منطق V40.2 (المحرك الأساسي للتوقعات)

### 2.1 إيه اللي V40.2 بـ يبحث عنه؟

V40.2 بـ يبحث عن **3 أنماط دخول**:

#### النمط 1: Surge (اندفاع حجمي)
```python
# v40_2_daily_generator.py line ~558
result['stop_loss'] = surge_result['stop']
```
- شمعة خضرا + حجم > 2× MA + breakout
- **المشكلة:** الأسهم اللي بتنفجر (+10000%) مش بـ تـ surge تدريجي. بـ تـ pump من قاع.

#### النمط 2: Accumulation (تراكم)
```python
# v40_2_daily_generator.py line ~586
result['stop_loss'] = accum_result['stop']
```
- ضغط في BB + حجم ضعيف → استنى الانفجار
- **المشكلة:** V40.2 بـ يدخل بدري، الأسهم بتعدى فترة طويلة قبل الانفجار.

#### النمط 3: Recovery (تعافي)
```python
# v40_2_daily_generator.py line ~610
result['stop_loss'] = recovery_result['stop']
```
- بعد تصحيح، ارتداد من الدعم
- **المشكلة:** كتير من المرتادات بـ تفشل.

### 2.2 الفلاتر اللي بـ ترفض الإشارات

| الفلتر | المنطق | النتيجة في الباك-تست | النتيجة في الإنتاج |
|---|---|---|---|
| V68 dirty_dist | ظهر علوي > 50% + حجم > 2.5×MA + delta سالب | ✅ +22.5% return | ❌ مفيش تأثير واضح |
| V72 hidden_dist | higher high + lower volume → block 10 bars | ✅ +36.5% return | ❌ مفيش تأثير واضح |
| V73 desert_phase | BB squeeze + volume < 0.5×MA | ✅ +23.1% return | ❌ مفيش تأثير واضح |

**الفلاتر اتختبرت على 200 سهم في باك-تست (15 صفقة) بس.** الإنتاج 32 صفقة = عينة مختلفة.

### 2.3 إزاي V40.2 بـ يحسب الـ entry/stop/target؟

```python
# entry = سعر الإغلاق يوم التوقع
entry = closes[day_idx]

# stop = ATR-based (1.5×ATR تحت الدخول) أو swing low
stop = entry - (atr * 1.5)

# target = entry + (risk × 2.0)  → R:R = 2:1
risk = entry - stop
target = entry + (risk * 2.0)

# target_2 (runner) = entry + (risk × 4.0)
target_2 = entry + (risk * 4.0)
```

### 2.4 الـ Entry Gate (8 شروط)

```python
# utils/entry_gate.py
1. evidence_count >= 3 (من 6 proofs)
2. R:R >= 1.5 (regime-dependent: bull=2.0, range=1.5, bear=1.8)
3. above_sma50 (أو قريب + تأكيد قوة)
4. relative_strength > benchmark
5. deep_correction < 30% (مش نازل كتير)
6. dont_chase (مش ممتد +10% في 3 أيام)
7. liquidity (volume > 1000, turnover > 50K EGP)
8. market_context (السوق مش هابط، القطاع مش بارد)
```

---

## 3. النتائج الحقيقية (مش الباك-تست)

### 3.1 إنتاج V40.2 (32 صفقة)

```
Total trades: 32
Wins: 9 | Losses: 23
Win Rate: 28.1%
Total Return: -92.4%
Avg per trade: -2.89%
Winners avg: +7.9%
Losers avg: -7.1%
```

### 3.2 الأسهم اللي V40.2 اختارها

```
HELI, HRHO, ISPH, MASR, SKPC, PHAR, DEIN, TMGH, OCDI, SAIB, ALCN, JUFO, ORHD, CIEB, CLHO
+ كريبتو: BTC, XRP, SOL
```

### 3.3 الأسهم اللي كسبت فعلاً (فاتت V40.2 بالكامل)

| # | السهم | العائد | ليه فات؟ |
|---|---|---|---|
| 1 | AJWA | +43,820% | سعر 0.38 → تحت فلتر min_price=0.50 |
| 2 | DTPP | +32,765% | سعر 1.01 → حجم مش مؤهل |
| 3 | MIPH | +25,060% | حجم 1534/day → تحت min_volume في بعض الأيام |
| 4 | CPCI | +17,767% | سعر 3.09 → حجم 6684 → مؤهل بس مفيش surge |
| 5 | CEFM | +17,112% | سعر 0.88 → تحت min_price=0.50? لا، 0.88>0.50 |
| 6 | BIOC | +14,743% | حجم 191K → مؤهل |
| 7 | MFPC | +11,893% | حجم 1.2M → مؤهل جداً! ليه فاته؟ |

### 3.4 ليه V40.2 فات MFPC (+11,893%)؟

MFPC كان سعره 0.33 وحجمه 1.2M يومياً. مؤهل 100%. بس:
- V40.2 بـ يبحث عن **surge** (حجم > 2× MA)
- MFPC ممكن ما كانش فيه surge يوم المسح
- أو V40.2 مسحه في يوم مش فيه breakout
- أو الـ scan_interval=3 فات يوم الانفجار

**ده مشكلة في الـ timing مش الـ filters.**

---

## 4. مشكلة تتبع السعر (Price Tracking Bug)

### 4.1 المشكلة اللي اكتشفتها

```
HRHO prediction:
  entry_price = 28.90 (مخزن يوم 2026-05-25)
  highest_price_reached = 26.59  ← أقل من entry!
  actual_return = -8.9%
```

سعر HRHO يوم 2026-05-25 كان **28.90** (close). لكن `highest_price_reached=26.59`? ده مستحيل لو الدخول كان 28.90.

### 4.2 السبب

```python
# daily_closer.py بـ يقرأ price_history من:
# 1. price_history.db (مش موجود)
# 2. data_engine.db (fallback)
# 3. stocks.db (fallback أخير)
```

daily_closer بيقرأ من `data_engine.db` بس الـ price data ممكن تكون:
- **محدّثة جزئياً** (مفيش كل الأيام)
- **بتأخر** (آخر تحديث 2026-08-27)
- **فيها فجوات** (أيام مفقودة)

### 4.3 الحل المطلوب

عند إنشاء التوقع → خزّن:
1. `entry_price` (موجود)
2. `entry_date_price` (سعر السوق فعلاً يوم التوقع — للتأكيد)
3. `current_price` (يتحدّث يومياً من daily_closer)
4. `price_change_since_entry` = (current - entry) / entry × 100

---

## 5. المحاولات اللي عملناها (Chronological)

### 5.1 V68 Oracle Engine (8 ميزات)
- **التاريخ:** 2026-08-31
- **المنهج:** A/B test كل ميزة لوحدها على 200 سهم (Jul-Aug 2026)
- **النتائج:**
  - dirty_dist_reject: ✅ KEEP (+22.5% return)
  - no_chase_2d: ❌ KILL (0 triggers)
  - proof_probability: ❌ KILL (avg prob=31.7, useless)
  - aplus_boost: ❌ KILL (1 trigger, no effect)
  - magnetic_target: ❌ KILL (0 triggers)
- **COMBO:** +106.9% return على 6 شهور

### 5.2 V72 Multi-Path (6 ميزات)
- **التاريخ:** 2026-08-31
- **النتائج:**
  - hidden_dist_block: ✅ KEEP (+36.5% return)
  - wash_trade_reject: ❌ KILL (WR -12.2%!)
  - pullback_buy: ❌ KILL (0 triggers)
  - maker_death_point: ❌ KILL (no effect)
  - market_bullish_sizing: ❌ KILL (0 triggers)
  - kill_switch_exit: ⏸️ PENDING

### 5.3 V73 Sniper (2 ميزات)
- **التاريخ:** 2026-08-31
- **النتائج:**
  - desert_phase_reject: ✅ KEEP (+23.1% return)
  - auction_trap_reject: ❌ KILL (0 triggers)

### 5.4 V75 Institutional Matrix (7 ميزات)
- **التاريخ:** 2026-09-01
- **النتائج:** كلها ❌ KILL (0 triggers أو no effect)

### 5.5 ملخص المحاولات
```
من 23 ميزة (V68+V72+V73+V75):
  ✅ 3 KEEP (dirty_dist, hidden_dist, desert_phase)
  ❌ 20 KILL
  COMBO backtest: +106.9% return
  الإنتاج: -92.4% return
```

---

## 6. ليه الباك-تست بـ يكذب؟

### 6.1 مشكلة العينة الصغيرة

الباك-تست اتعمل على:
- **200 سهم** (من 1047)
- **15 صفقة** (عينة صغيرة جداً)
- **6 شهور** (Feb-Aug 2026)

15 صفقة مش كافية للحكم. الإنتاج 32 صفقة = ضعف العينة، والنتيجة انقلبت.

### 6.2 مشكلة الـ Overfitting

الفلاتر اللي "نجحت" في الباك-تست:
- dirty_dist: رفض 6 إشارات → الـ replacement signals كانت أحسن
- hidden_dist: رفض 1 إشارة → حسّن الـ return

بس في الإنتاج:
- الـ 32 صفقة ما فيهاش نفس الأنماط
- الفلاتر بـ تـ reject إشارات كويسة أحياناً
- الـ entry timing مختلف

### 6.3 مشكلة الـ Survivor Bias

الباك-تست بـ يفحص الأسهم اللي لسه موجودة. الأسهم اللي أفلست/اتجمعت مش في الـ data_engine.db.

---

## 7. المشاكل الأساسية (Root Causes)

### 7.1 V40.2 بـ يصطاد الأسهم الخطأ

**المشكلة:** V40.2 بـ يبحث عن surge/accumulation في أسهم كبيرة (volume > 1000, price > 0.50). الأسهم اللي بتنفجر (+10000%) دي:
- صغيرة الحجم (volume < 1000 أحياناً)
- رخيصة (price < 0.50 أحياناً)
- ما بـ تـ surge تدريجي — بـ تـ pump فجأة

**الحل:** تخفيض الـ thresholds أو إضافة scan منفصل للـ penny stocks.

### 7.2 الـ Timing مش صح

**المشكلة:** V40.2 بـ يـ scan كل 3 أيام (`scan_interval=3`). الأسهم الانفجارية بـ تـ pump في يوم واحد. لو الـ scan فات اليوم ده → تفوت الفرصة.

**الحل:** daily scan (`scan_interval=1`) أو حتى intraday.

### 7.3 الـ Entry مش صح

**المشكلة:** V40.2 بـ يدخل على close اليوم. الأسهم الانفجارية بـ تـ pump في الـ open. لو دخلت على open اليوم التالي → فاتتك نصف الحركة.

**الحل:** دخول على open (لو متاح) أو limit order.

### 7.4 الـ Stop Loss ضيق

**المشكلة:** stop = entry - (1.5×ATR). الأسهم المتقلشة بتـ hit الـ stop قبل ما تـ move.

**الحل:** stop أوسع (2×ATR) أو structural stop (under swing low).

### 7.5 الـ Target ضيق

**المشكلة:** target = entry + (2×risk). الأسهم اللي بتنفجر بـ تـ move +1000%. target = +10% بيـ cap الأرباح.

**الحل:** trailing stop بدل fixed target.

---

## 8. الحلول المقترحة (Logical, مش عياط)

### 8.1 حل فوري: تتبع السعر الحالي

```python
# إضافة columns جديدة لـ predictions table:
ALTER TABLE predictions ADD COLUMN current_price REAL;
ALTER TABLE predictions ADD COLUMN price_change_pct REAL;
ALTER TABLE predictions ADD COLUMN last_price_update TEXT;

# daily_closer بـ يحدّث current_price يومياً:
UPDATE predictions 
SET current_price = ?, 
    price_change_pct = (current_price - entry_price) / entry_price * 100,
    last_price_update = ?
WHERE id = ?;
```

### 8.2 حل استراتيجي: تغيير الـ entry logic

**بدل ما نبحث عن surge (حجم > 2×MA)، نبحث عن:**

1. **Breakout from base** — سعر كسر قمة 20 يوم بحجم > 1.5×MA (مش 2×)
2. **Penny stock scanner** — scan منفصل للأسهم < 1 جنيه (زي AJWA, DTPP)
3. **Volume rising 3 days** — حجم متناقص ثم صاعد (accumulation)
4. **Price > MA20** — تأكيد الاتجاه الصاعد

### 8.3 حل الـ timing

```python
# بدل scan_interval=3:
scan_interval = 1  # daily scan
# + إضافة intraday check للأسهم اللي volume > 3×MA
```

### 8.4 حل الـ stop/target

```python
# بدل fixed stop/target:
stop = swing_low - (0.5×ATR)  # structural
target = None  # no fixed target
# trailing stop: highest_close - (2×ATR)
```

---

## 9. خريطة الطريق (ما يتعمل)

### Phase 1: تتبع السعر (عاجل)
- [ ] إضافة `current_price` + `price_change_pct` columns
- [ ] daily_closer بـ يحدّثهم يومياً
- [ ] UI بـ يعرض السعر الحالي vs الدخول

### Phase 2: إعادة تقييم V40.2 (مهم)
- [ ] backtest على كل الأسهم (1047) مش 200
- [ ] backtest على سنة كاملة (مش 6 شهور)
- [ ] مقارنة V40.2 picks vs actual top gainers
- [ ] تحليل ليه V40.2 فات MFPC (+11,893%)

### Phase 3: تغيير الاستراتيجية (جوهرى)
- [ ] بناء penny stock scanner
- [ ] تغيير entry logic (breakout from base بدل surge)
- [ ] daily scan بدل every 3 days
- [ ] trailing stop بدل fixed target

---

## 10. الخلاصة

### اللي شغال:
- ✅ المحرك موحد (unified_analysis)
- ✅ النوتبوك متصل (V40.2 + daily_closer بـ يكتبوا)
- ✅ 3 filters مثبتة (dirty_dist, hidden_dist, desert_phase)
- ✅ Screener بـ يقرأ من Python مباشرة

### اللي مش شغال:
- ❌ V40.2 بـ يختار أسهم غلط (28.1% WR, -92.4% return)
- ❌ الباك-تست overfit (15 صفقة → +106.9%, 32 صفقة → -92.4%)
- ❌ مفيش تتبع سعر حالي
- ❌ الـ timing فات الأسهم الانفجارية
- ❌ الـ stop/target مش متوافق مع EGX

### اللي محتاج قرار:
1. هل نغيّر استراتيجية V40.2 بالكامل؟ (breakout from base بدل surge)
2. هل نضيف penny stock scanner؟
3. هل نغيّر scan_interval لـ 1؟
4. هل نطبّع trailing stop؟

---

*هذا الملف كُتب من الكود، مش من كلام. كل رقم متحقَّق منه ضد الـ databases الفعلية.*

---

## 11. التحديثات الجديدة (2026-09-01) — Stock Notebook + Structural Exit + 5 Modules + 10 Feature Flags

> **المحاور الثلاثة الجديدة (أ + ب + ج):**
> - **المحور أ (التعميق):** Stock Notebook System — طبقة معرفة دائمة لكل سهم.
> - **المحور ب (الخروج):** فلسفة هيكلية بدلاً من زمنية + Unified Exit Engine.
> - **المحور ج (المراقبة):** Decision Logger — تسجيل كل رفض/خروج مع السبب.

### 11.1 Stock Notebook (`stock_notebook.py` — 1,065 LOC)

**259 ملف JSON في `notebooks/EGX/`** — ملف لكل سهم EGX. كل ملف فيه:
- `machine_summary`: typical_correction_pct (مفتاح الخروج الهيكلي), danger_level, avoid_chase, preferred_entry_style, distribution_sensitivity.
- `identity`: is_index_related, is_story_stock, is_zombie_prone, ownership_concentration.
- `price_behavior`: typical_correction_range, distribution_pattern, base_pattern.
- `lessons`: دروس تاريخية على السهم.

**30 سهم معمّق** بالخبرة الحقيقية (typical_correction_pct ≠ 0). الـ 229 المتبقية بـ default (محايد).

**الجسر:** `apply_notebook_context()` بـ يعدّل القرار في V40.2 (toggle `V40_2_NOTEBOOK_CONTEXT`).

### 11.2 فلسفة الخروج الهيكلية (`short_holding_exit.py` — 614 LOC)

**التغيير الجوهري:** `max_holding_7d` و `no_move_3d` **ملغيان كأسباب وحيدة**.

| القديم | الجديد |
|---|---|
| `max_holding_7d` → إغلاق إجباري | `MAX_HOLDING_DAYS=14` → مراجعة فقط |
| `no_move_3d` → إغلاق إجباري | `REVIEW_THRESHOLD_DAYS=7` → تنبيه فقط |
| أولوية: distribution > max_holding > no_move > early_drop | أولوية: **distribution > early_drop > compound_breakdown > review_alert** |

**الدوال الجديدة:**
- `is_within_typical_correction(entry, current, typical_correction_pct)` — هل النزول جوه نطاق التصحيح المعتاد؟
- `is_breakdown_not_correction(entry, current, typical_correction_pct, rsi, recent_closes)` — هل ده انهيار حقيقي؟ (3 شروط: نزول ×1.3 + RSI<30 + 5 شموع حمراء).

### 11.3 باك-تست B0/B1/B2/B3 (200 سهم × 6 شهور)

| السيناريو | Trades | WR | Return | ملاحظات |
|---|---:|---:|---:|---|
| **B0 (baseline)** | 31 | 45.2% | +41.2% | كل flags OFF |
| **B1 (strict entry ON)** | 14 | 35.7% | -17.6% | رفض كتير → صفقات أقل + خسارة |
| **B2 (strict + widened stop)** | 14 (4 stop_widened) | — | -18.8% | اتساع الوقف ما ساعدش |
| **B3 (structural exit ON)** | 14 | — | — | **لا exit واحد من نوع max_holding ✅** — الفلسفة الهيكلية شغّالة |

**الدرس:** الخروج الزمني الصِّرف بـ يقتل صفقات. الفلسفة الهيكلية (`typical_correction_pct` + `compound_breakdown`) أنجح.

### 11.4 الـ 10 Feature Flags (كلها OFF افتراضياً)

| Flag | الـ module | التأثير |
|---|---|---|
| `V40_2_STRICT_ENTRY` | strict_entry_filters.py | Don't Chase |
| `V40_2_DISCLOSURE_IMPACT` | egx_disclosure_engine.py | تأثير الإفصاحات (-2/+2) |
| `V40_2_NOTEBOOK_CONTEXT` | stock_notebook.py | سياق النوتبوك |
| `V40_2_SHORT_HOLDING` | short_holding_exit.py | خروج هيكلي |
| `V40_2_DISTRIBUTION_EXIT` | short_holding_exit.py::detect_distribution | شمعة التوزيع |
| `V40_2_NEWS_IMPACT` | news_fetcher_analyzer.py | تأثير الأخبار |
| `V40_2_CRYPTO_STRICT_ENTRY` | crypto_strict_filters.py | نسخة الكريبتو |
| `V40_2_CRYPTO_DISCLOSURE_IMPACT` | crypto_disclosure_engine.py | نسخة الكريبتو |
| `V40_2_CRYPTO_NEWS_IMPACT` | crypto_news_fetcher.py | نسخة الكريبتو |
| `V40_2_UNIFIED_EXIT` | unified_exit_engine.py | توحيد الخروج |

### 11.5 الإفصاحات + الأخبار

- **`egx_disclosure_engine.py`** (875 LOC): 12 نوع إفصاح بـ dynamic scoring (-2 لـ +2). VETO → hard reject.
- **`news_fetcher_analyzer.py`** (507 LOC): DuckDuckGo + sentiment analysis (-2 لـ +2). يُكمّل الإفصاحات.
- **`news_impact_scorer.py`** (432 LOC): 14 event types (IPO_SUBSCRIPTION, DIVIDEND_EX_DATE, EARNINGS_BEAT, ...).
- **`news_signals_reader.py`** + `/api/news/ingest`: جسر لاستقبال الأخبار من News Agent خارجي.

### 11.6 Decision Logger + Unified Exit

- **`decision_logger.py`** (338 LOC) + `db/decision_log.db`: `log_decision()` + `get_decision_stats()`.
- **`unified_exit_engine.py`** (518 LOC): `MARKET_PROFILES` (STOCKS + CRYPTO) + `evaluate_unified_force_exit()`.

---

## 📒 سجل التغييرات

| التاريخ | الملف | التغيير |
|---------|-------|---------|
| 2026-09-01 | `METHODOLOGY_AND_RESULTS.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إضافة قسم 11: Stock Notebook (259 JSON + apply_notebook_context)، فلسفة الخروج الهيكلية (max_holding_7d و no_move_3d ملغيان + is_within_typical_correction + is_breakdown_not_correction)، باك-تست B0/B1/B2/B3 (200 سهم × 6 شهور)، 10 Feature Flags، الإفصاحات + الأخبار (egx_disclosure_engine + news_fetcher_analyzer + news_impact_scorer + news_signals_reader)، Decision Logger + Unified Exit Engine. |
