# 03 — كيف يفكر النظام (How It Thinks)

> **المالك:** برافو | آخر تحديث: 2026-10-27
> منطق الاستثمار + المحركات + تدفق القرار.

---

## 1. العقيدة الاستثمارية

### Rule 20: PYTHON = BRAIN
كل الحسابات المالية في Python. Next.js = DISPLAY ONLY.
- ممنوع حساب RSI/ATR/أهداف في الـ frontend
- كل الأرقام تأتي من الـ backend كما هي (لا تعديل)

### Rule 27: NO-FAKE-DATA
- null = null (مش 0 أو رقم مزيف)
- لو البيانات مش متاحة → "غير متاح" أو empty array (graceful)

---

## 2. تدفق القرار (Decision Flow)

```
TradingView Scanner (كل 2 دقيقة)
    ↓
stocks.db.stock_daily_prices (LIVE — 2026-10-27)
    ↓
data.prices.load_price_history() (Python central DAL)
    ↓
┌───────────────────────────────────┐
│  المحركات (Analyzers)              │
│  1. master_analyzer.py            │
│  2. hunting_engine.py             │
│  3. sniper_engine.py              │
│  4. trend_following_analyzer.py   │
│  5. liquidity_filter.py           │
│  6. bag_holder_rescue.py          │
└───────────────────────────────────┘
    ↓
predictions.db (entry/stop/target + score + signal)
    ↓
Next.js API (thin wrapper via DAL)
    ↓
الواجهة (display only)
```

---

## 3. محرك التوقعات V40.2 (`daily_predictor.py`)

### المراحل
1. **جلب الأسعار**: `data.prices.load_price_history(ticker, limit=60)` من `stocks.db`
2. **حساب المؤشرات الفنية**: RSI(14) Wilder's, ATR Wilder's, SMA(20/50/200), EMA, MACD
3. **التصنيف الكنسي**: `classifySignal(master_score)` → STRONG_BUY/BUY/HOLD/SELL/STRONG_SELL
4. **حساب الأهداف**: entry/stop/target + risk_reward (ممنوع R/R < 1.5)
5. **فلاتر الأمان**:
   - ممنوع توصية لسهم حجمه اليوم = 0 (Rule 24)
   - ممنوع أهداف صاعدة لسهم هابط (Falling Knife)
   - ممنوع stop_loss < 0 (negative stop)
6. **الكتابة**: `predictions.db.predictions` (INSERT via db_manager)

### الـ Scoring
```
master_score = weighted_avg(
  technical_score,      # RSI + MACD + MA cross
  fundamental_score,    # P/E + ROE + margin
  ai_pattern_score,     # pattern recognition
  sentiment_score       # news sentiment
)
```

---

## 4. رادار صانع السوق (`maker_radar.py`)

### المراحل
1. **قراءة الأسعار**: `stocks.db.stock_daily_prices` (PRIMARY، price_history.db FALLBACK)
2. **حساب السيولة**:
   - `value_traded` (الكاش المنفّذ — من TradingView Scanner)
   - `avg_turnover_20d` (متوسط 20 يوم)
   - `volume_ratio_10d_vs_20d` (حجم نسبي)
3. **التصنيف (B3 Contract)**:
   - `quiet_accumulation` — تجميع هادي
   - `distribution` — تصريف
   - `dead_trap` — فخ ميت
   - `pre_surge` — قبل الانفجار
   - `explosive_surge` — انفجار حجمي
   - `early_break` — اختراق مبكر
   - `unclassified` / `INSUFFICIENT_DATA` / `DATA_INVALID`
4. **الحاضنة (Incubator)**: أسهم 4/6 أو 5/6 إشارات تجميع + بانتظار trigger
5. **الإخراج**: `scripts/output/maker_radar_{MARKET}_{date}.json`

### الـ Enrichment (برافو Wave 2)
- `value_traded_official` (من TradingView)
- `relative_volume_10d_official`
- `volume_surge = relative_volume_10d > 1.2`
- `pe_ratio_scanner`, `roe_scanner`, `profit_margin_scanner`, `eps_scanner`

---

## 5. المحرك القناص (`sniper_engine.py`)

### المنطق
- يفحص الأسهم للانفجارات الحجمية اللحظية
- يحسب: sniper_score (0-100) + live_price + breakout level
- فلاتر: R/R ≥ 1.5، حجم > avg_volume × 1.5
- المصدر: `data.prices.load_price_history()` (stocks.db)

---

## 6. محرك إنقاذ الأسهم المزنوقة (`bag_holder_rescue.py`)

### المعادلة
```
Q = Q0 × (A0 - T) / (T - P)
حيث:
  Q  = الكمية المطلوبة لمتوسط السعر إلى T
  Q0 = الكمية الحالية
  A0 = متوسط سعر الشراء الحالي
  T  = سعر المستهدف (متوسط إليه)
  P  = السعر الحالي
```

### القرار
- **HOLD**: لو R/R > 2 والسعر قريب من الدخول
- **AVERAGE_DOWN**: لو السعر أقل من الدخول بـ < 15% والأساسيات قوية
- **CUT_LOSS**: لو السعر أقل من الدخول بـ > 15% أو الأساسيات ضعيفة

---

## 7. تحليل الشخصيات (Persona Analysis)

| الشخصية | الأفق | التركيز |
|---------|-------|---------|
| **conservative** (مستثمر) | 6-12 شهر | أساسيات قوية + P/E منخفض + dividend |
| **balanced** (متوازن) | 2-6 أسبوع | زخم + أساسيات متوسطة |
| **gambler** (مضارب) | 1-5 يوم | انفجارات حجمية + breakout + volume surge |

### الـ Scoring لكل شخصية
- `gambler_rank_score` — للمضارب
- `investor_rank_score` — للمستثمر
- `sector_heat_boost` — دوران قطاعي للمضارب فقط
- `sector_role_boost` — دور السهم جوه قطاعه (leader/mid/laggard)

---

## 8. الـ Fallback Chain (مصادر البيانات)

### الأسعار (Python)
```
1. stocks.db.stock_daily_prices (PRIMARY — live)
2. data_engine.db.egksco_price_history (EGX archive)
3. data_engine.db.historical_data (other markets)
4. price_history.db (EMERGENCY — frozen 2026-09-24)
```

### الأسعار (Next.js — via DAL)
```
1. stocks.db.stock_daily_prices (getLiveSparkline)
2. stocks.db.index_daily_prices (for indices)
3. price_history.db (EMERGENCY FALLBACK only)
```

### الأيقونات (Logos)
```
1. stocks.db.stocks.logo_url (post-merge — logoid-based)
2. data_engine.db.stocks.logo_url (historical — 654/1098 populated)
→ DbManager.getUnifiedLogos() injects BOTH logo_url + logoUrl
```

---

## 9. الـ FRESHNESS GUARD

كل توصية في الواجهة عليها freshness metadata:
- `fresh`: آخر تحديث اليوم
- `stale`: 1-3 أيام قديمة (badge ⚠️)
- `very_stale`: > 3 أيام (badge ⛔)
- `invalid`: بيانات ملوثة (B1 price_sanity)

الـ frontend بـ يـ dim الصفوف القديمة + يعرض badge واضح.

---

## 10. الـ PRICE INVARIANT GUARD

في `PersonaTableView`:
- `STOPPED_OUT`: stop ≥ current → صفقة ميتة (badge 🚫)
- `TARGET_HIT`: current ≥ target → الهدف تحقق (badge ✅)
- `STALE`: |cur - entry| / cur > 10% → بيانات قديمة (badge ⚠️)
- `ANOMALY HIDE`: |cur - entry| / cur > 15% → الصف يُخفى كلياً (safety net)

---

## 11. المحركات الفرعية

### `hunting_engine.py`
- يصطاد الانفجارات الحجمية قبل حدوثها
- يحسب: accumulation_score + breakout_probability

### `trend_following_analyzer.py`
- يتبع الترند: above MA50 + MA50 > MA200 = uptrend
- trailing stop = ATR × multiplier

### `liquidity_filter.py`
- يفلتر الأسهم حسب السيولة: min_turnover + min_volume
- يحسب: money_flow_state (دخول قوي / خروج قوي / متوازن)

### `regime_detector.py`
- يكتشف نظام السوق: AGGRESSIVE / NORMAL / DEFENSIVE
- يؤثر على position_size + persona selection
