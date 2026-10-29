# 03 — المحركات والمنطق الاستثماري (تفاصيل كاملة)

> **آخر تحديث:** 2026-10-29 | **Commit:** `94e612c`
> **V3 هو النظام الإنتاجي الوحيد. V40.2 deprecated (مش في crontab).**
> **كل معادلة + كل threshold + كل branch logic موثّق من الكود الفعلي.**

---

## الفهرس

1. [فلسفة النظام](#1-فلسفة-النظام)
2. [V3 Smart Predictor — النظام الإنتاجي](#2-v3-smart-predictor)
3. [المنسّق V3 (orchestrator_v3.py)](#3-المنسق-v3)
4. [المنفّذ V3 (executor_v3.py)](#4-المنفذ-v3)
5. [محرك حالة السوق (MarketRegimeEngine)](#5-محرك-حالة-السوق)
6. [نظام السيولة والرادار (shared_liquidity.py)](#6-نظام-السيولة-والرادار)
7. [محرك التدفق (FlowSystemEngine)](#7-محرك-التدفق)
8. [فلتر السيولة (liquidity_filter.py)](#8-فلتر-السيولة)
9. [محرك الإغلاق (daily_closer.py)](#9-محرك-الإغلاق)
10. [V40.2 — DEPRECATED](#10-v402--deprecated)
11. [الأوزان + العتبات + الفلاتر](#11-الأوزان-والعتبات)
12. [المؤشرات الفنية Canonical](#12-المؤشرات-الفنية)
13. [المسار الإنتاجي الفعلي](#13-المسار-الإنتاجي)
14. [قواعد المخاطر المعتمدة](#14-قواعد-المخاطر)

---

## 1. فلسفة النظام

النظام **لا يستخدم Deep Learning**. يعتمد على 3 ركائز:
1. **Rule-Based** (7 عائلات تحليل)
2. **Statistical** (weighted scoring + conflict detection)
3. **LLM-Augmented** (Ollama — للـ sentiment فقط، placeholder حاليًا)

### القواعد الذهبية الثمانية

| # | القاعدة | التفصيل |
|---|---------|---------|
| 1 | **Liquidity First** | تخطّى التحليل لو السهم غير قابل للتداول (dynamic thresholds) |
| 2 | **Market Regime Filter** | تعديل الثقة + الأحجام + max_picks حسب حالة السوق |
| 3 | **State-Aware** | 10 حالات سهم (S1-S10) بـ أوزان مختلفة لكل عائلة |
| 4 | **Conflict Detection** | لو المحركات بتتعارض → confidence ينزل لـ 40% |
| 5 | **Unified Scoring** | Weighted combination من 7 عائلات |
| 6 | **Regime-Aware Thresholds** | BUY/SELL thresholds بـ تتغير حسب الـ regime |
| 7 | **Risk Profile** | Position + Stop + Target لكل إشارة |
| 8 | **Feedback Loop** | التعلّم من الأخطاء (learned_lessons table) |

---

## 2. V3 Smart Predictor — النظام الإنتاجي

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/jobs/new_daily_predictor.py` (505 سطر) |
| **الـ cron** | ✅ في crontab (صباح 03:00 UTC + مساء 15:00 UTC) |
| **المنسّق** | `vps-service/core/orchestrator_v3.py` (13,196 bytes) |
| **المنفّذ** | `vps-service/core/executor_v3.py` (10,037 bytes) |
| **الـ DB** | `predictions.db` → جدول `predictions` (نفس الـ table بتاع V40.2) |
| **الـ persona** | `v3_smart` |

### المسار

```
new_daily_predictor.py
  → get_active_tickers(market)
  → filter_stale_predictions() — شيل الأسهم اللي ليه توقع valid
  → filter_dead_stocks() — شيل الأسهم الميتة (price=0 أو flat history)
  → فلتر الإجازات — skip جمعة/سبت/أعياد
  → لكل ticker:
      → get_price_history() — اقرأ آخر 20+ يوم (closes, volumes, highs, lows, opens)
      → اقرأ market_cap + free_float من stocks.db
      → orchestrator_v3.create_v3_plan() — حدد الحالة (S1-S11) + الأوزان
      → executor_v3.execute_v3() — شغّل 7 عائلات + conflict + confidence + signal
      → STAGE-5: Ranking — رتّب الإشارات واختار أعلى max_picks
      → save_prediction() — احفظ في predictions.db (persona='v3_smart')
```

### CLI

```bash
python3 vps-service/jobs/new_daily_predictor.py --market EGX --today-only
python3 vps-service/jobs/new_daily_predictor.py --all-markets --yesterday-only
python3 vps-service/jobs/new_daily_predictor.py --market EGX --dry-run --max-tickers 5
```

### Smart Filters (مدمجة في V3)

1. **فلتر الإجازات** — skip جمعة/سبت/أعياد
2. **فلتر الأسهم الميتة** — price=0 فقط (volume=0 مش سبب للرفض — ممكن يوم هادي)
3. **فلتر التوقعات القديمة** — skip لو فيه توقع valid أقل من N أيام
4. **فلتر الأسهم الـ flat** — skip لو ≤2 قيمة مختلفة في 30 يوم
5. **minimum 20 يوم بيانات** — V3 محتاج 20+ يوم للتحليل (كان 50 — خُفّض)

### get_price_history (تفاصيل التنفيذ)

```python
# بـ تستخدم raw sqlite3 (readonly) مش db_manager
# بـ يجرب أسماء أعمدة مختلفة:
#   1. close, volume, high, low, open
#   2. close_price, volume, high_price, low_price, open_price (fallback)
# بـ يرجع: (closes, volumes, highs, lows, opens) — كلهم list[float]
```

### filter_dead_stocks (تفاصيل التنفيذ)

```python
# فلتر 1: price = 0 → ميت فعلاً
# فلتر 2: أسعار flat (≤2 قيمة مختلفة في 30 يوم) → ميت تاريخياً
# ملاحظة: volume=0 مش سبب للرفض (يوم هادي مش سهم ميت)
# ملاحظة: change_percent مش مستخدم (كان بيقتل 126/127 سهم غلط!)
```

---

## 3. المنسّق V3 (orchestrator_v3.py)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/core/orchestrator_v3.py` |
| **الدور** | يحدد حالة السهم (S1-S11) + يختار المحركات + يحدد الأوزان |
| **المدخلات** | `ticker, prices, volumes, market, fund_available, event_available` |
| **المخرجات** | `V3Plan(state_code, selected_engines, normalized_weights, decision_policy)` |

### مصفوفة الحالات الـ 11 (S1-S11)

| State | الوصف | TREND | MOM | MR | BRK | FLOW | FUND | EVENT |
|-------|------|-------|-----|-----|-----|------|------|-------|
| **S1** | صعود مستقر | 30 | 25 | 5 | 10 | 20 | 5 | 5 |
| **S2** | صعود يضعف | 25 | 15 | 10 | 5 | 25 | 10 | 10 |
| **S3** | عرضي (sideways) | 10 | 10 | 30 | 5 | 25 | 10 | 10 |
| **S4** | اختراق صاعد | 15 | 15 | 0 | 25 | 30 | 5 | 10 |
| **S5** | هبوط مستقر | 30 | 20 | 5 | 5 | 20 | 10 | 10 |
| **S6** | هبوط متسارع | 25 | 20 | 0 | 5 | 25 | 10 | 15 |
| **S7** | تذبذب مرتفع | 20 | 10 | 5 | 5 | 30 | 15 | 15 |
| **S8** | سيولة ضعيفة | 10 | 5 | 5 | 5 | **50** | 15 | 10 |
| **S9** | أدلة متعارضة | 15 | 15 | 10 | 10 | 30 | 10 | 10 |
| **S10** | UNKNOWN | 15 | 15 | 10 | 10 | 30 | 10 | 10 |
| **S11** | NO_TRADE | — | — | — | — | — | — | — |

> الأوزان مجموعها < 100 عمدًا، بـ تتطبّع برمجيًا لـ مجموع = 1.0

### منطق تحديد الحالة

```python
def detect_stock_state(prices, volumes, market_regime):
    # 1. لو بيانات ناقصة → S11 (NO_TRADE)
    if len(prices) < 50: return 'S11'

    # 2. حساب المؤشرات
    sma20 = avg(prices[-20:])
    sma50 = avg(prices[-50:]) if len(prices) >= 50 else sma20
    last = prices[-1]
    roc_5d = (last - prices[-6]) / prices[-6] * 100
    roc_20d = (last - prices[-21]) / prices[-21] * 100
    vol_ratio = volumes[-1] / avg(volumes[-20:]) if avg(volumes[-20:]) > 0 else 1

    # 3. تحديد الحالة
    if vol_ratio < 0.5: return 'S8'  # سيولة ضعيفة

    # اعتمادًا على market_regime + اتجاه السهم:
    if market_regime == 'BULL':
        if roc_5d > 3 and roc_20d > 5: return 'S1'   # صعود مستقر
        if roc_5d > 0 and roc_20d > 0: return 'S2'    # صعود يضعف
        if roc_5d < -2: return 'S5'                    # هبوط في سوق صاعد
        return 'S3'                                     # عرضي
    elif market_regime == 'BEAR':
        if roc_5d > 3: return 'S6'                     # هبوط متسارع
        return 'S5'                                     # هبوط مستقر
    else: # RANGE
        if roc_5d > 5: return 'S4'                    # اختراق
        if abs(roc_5d) < 1: return 'S3'               # عرضي
        return 'S9'                                     # متعارض
```

### الـ Plan Output

```python
V3Plan(
    plan_id="uuid",
    ticker="COMI",
    market="EGX",
    state_code="S1",           # صعود مستقر
    market_regime="BULL",
    stock_regime="UPTREND",
    selected_engines=['TREND', 'MOM', 'MR', 'BRK', 'FLOW'],  # حسب المتاح
    execution_order=['TREND', 'MOM', 'FLOW', 'BRK', 'MR'],   # ترتيب التنفيذ
    normalized_weights={'TREND': 0.30, 'MOM': 0.25, ...},    # مجموع = 1.0
    decision_policy='full',    # full | no_trade
    no_trade_reason=None,
)
```

---

## 4. المنفّذ V3 (executor_v3.py)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/core/executor_v3.py` |
| **الدور** | ينفذ الخطة — يشغّل 7 عائلات + يجمع النتائج |
| **الـ output** | `V3Result(signal_score, confidence, final_signal, position_size_pct)` |

### العائلات السبع (تفاصيل كاملة)

#### 4.1 TREND (MasterAnalyzer — محرك حقيقي)

```python
def _run_trend(plan, prices, volumes, ticker, market):
    # MasterAnalyzer (5,424 سطر) — محرك مستقل بـ 8 طبقات:
    # Macro + SMA50 + RSI + Volume + Bollinger + MACD + Candlestick + Fibonacci
    # مش V38 — محرك مستقل تمامًا
    a = MasterAnalyzer()
    r = a.analyze(ticker, prices=prices, volumes=volumes)
    score = r.master_score  # 0-100 (STRONG_BUY ≥ 78, BUY ≥ 65)
    signal = r.signal       # HOLD/BUY/SELL/etc
    # Normalize to -100..+100 (master_score 0-100, neutral=50)
    norm = (score - 50) * 2
    return norm, signal
```

#### 4.2 MOM — Wilder's RSI (STAGE-1.1 FIX)

```python
def _run_momentum(plan, prices, volumes, ticker, market):
    # STAGE-1.1: استخدم calc_rsi من analyzers/indicators/rsi.py (Wilder's)
    # قبل كده: حساب بدائي (SMA RSI) — غلط
    from analyzers.indicators.rsi import calc_rsi
    rsi = calc_rsi(prices, period=14)  # Wilder's smoothing
    # Normalize: RSI 50 → 0, RSI 70 → +40, RSI 30 → -40
    norm = max(-80, min(80, (rsi - 50) * 2))
    signal = 'BUY' if rsi > 60 else 'SELL' if rsi < 40 else 'HOLD'
    return norm, signal
```

#### 4.3 MR — Mean Reversion (STAGE-1.4 FIX: ATR-based)

```python
def _run_mean_reversion(plan, prices, volumes, ticker, market, highs, lows):
    # STAGE-1.4: لازم انحراف ≥ 1.8 × ATR(14) (مش 5% بس)
    # قبل كده: SMA20 deviation بس — سهل الإثارة في EGX
    from analyzers.indicators.atr import calc_atr
    atr = calc_atr(highs[-15:], lows[-15:], prices[-15:], 14)
    sma20 = sum(prices[-20:]) / 20
    deviation_pct = (last - sma20) / sma20 * 100
    atr_pct = (atr / last) * 100
    threshold = 1.8 * atr_pct

    if abs(deviation_pct) < threshold:
        # الانحراف مش كافي → neutral
        norm = max(-30, min(30, -deviation_pct * 3))
        signal = 'HOLD'
    else:
        # انحراف كافي → mean reversion signal
        strength = min(abs(deviation_pct) / threshold, 1.5)
        norm = max(-80, min(80, -deviation_pct * 8 * strength / threshold))
        signal = 'BUY' if deviation_pct < 0 else 'SELL'
    return norm, signal
```

#### 4.4 BRK — Breakout (STAGE-1.3 FIX: تشديد + volume + body)

```python
def _run_breakout(plan, prices, volumes, ticker, market, highs, lows, opens):
    # STAGE-1.3: اختراق حقيقي لازم 3 شروط
    # قبل كده: 0.98 من القمة (ضعيف أوي)
    # 1. high_20 = أعلى قمة 20 يوم BEFORE today (مش شامل اليوم)
    high_20 = max(highs[-21:-1])  # excludes today
    low_20 = min(lows[-21:-1])
    last = prices[-1]

    # 2. volume ≥ 1.4× متوسط 20 يوم
    vol_ratio = last_vol / avg_vol_20
    vol_confirmed = vol_ratio >= 1.4

    # 3. body ≥ 50% من range
    body_ratio = abs(last - last_open) / (high - low)
    body_ok = body_ratio >= 0.50

    # اختراق صاعد حقيقي
    if last > high_20 and vol_confirmed and body_ok:
        norm = min(75, 55 + (vol_ratio - 1.4) * 20)  # +55..+75
        signal = 'BUY'
    # كسر هابط حقيقي
    elif last < low_20 and vol_confirmed and body_ok:
        norm = max(-75, -55 - (vol_ratio - 1.4) * 20)  # -55..-75
        signal = 'SELL'
    # غير كده: موقع السعر في الـ range
    else:
        pos = (last - low_20) / (high_20 - low_20)
        norm = max(-40, min(40, (pos - 0.5) * 40))
        signal = 'HOLD'
    return norm, signal
```

#### 4.5 FLOW — compute_money_flow (STAGE-1.2 FIX)

```python
def _run_flow(plan, prices, volumes, ticker, market, highs, lows):
    # STAGE-1.2: استخدم compute_money_flow (6 طبقات) كمصدر وحيد
    # قبل كده: volume_ratio ساذج — غلط
    from utils.shared_liquidity import compute_money_flow
    mf = compute_money_flow(prices, volumes, highs, lows)
    # 6 طبقات: CLV + CMF + vol_confirmation + trend_penalty + dead_volume + SMA
    buy_pct = mf.get('buy_pct', 50)  # 0-100
    # Normalize: buy_pct 50 → 0, buy_pct 65 → +30, buy_pct 35 → -30
    norm = max(-100, min(100, (buy_pct - 50) * 2))
    signal = 'BUY' if buy_pct >= 65 else 'SELL' if buy_pct <= 35 else 'HOLD'
    return norm, signal
```

#### 4.6 FUND — وزن = 0 (STAGE-1.5 FIX)

```python
# STAGE-1.5: مش بـ ترجع (0, HOLD) على وزن 5-15%
# execute_v3 بـ يشيل FUND من الأوزان لو مش متاح
# + بـ يعيد تطبيع باقي الأوزان لمجموع = 1.0
# TODO: ربط بـ data_engine.db.tab_* (fundamentals)
def _run_fundamental(plan, ticker, market):
    return 0, 'HOLD'  # placeholder — لكن وزنها = 0
```

#### 4.7 EVENT — وزن = 0 (STAGE-1.5 FIX)

```python
# نفس منطق FUND — وزن = 0 + إعادة تطبيع
# TODO: ربط بـ news.db + Ollama sentiment
def _run_event(plan, ticker, market):
    return 0, 'HOLD'  # placeholder — لكن وزنها = 0
```

### الحساب النهائي (Signal Score + STAGE-3 Conflict + STAGE-4 Signal)

```python
# ── STAGE-1.5: إعادة تطبيع الأوزان (شيل FUND/EVENT لو مش متاح) ──
weights = dict(plan.normalized_weights)
if 'FUND' not in available_families: weights.pop('FUND', None)
if 'EVENT' not in available_families: weights.pop('EVENT', None)
# إعادة تطبيع لمجموع = 1.0
weights = {k: v / sum(weights.values()) for k, v in weights.items()}

# ─ـ Weighted Signal Score ──
signal_score = sum(family_scores[f] * weights[f] for f in family_scores) / total_weight
# signal_score = -100..+100

# ── Confidence (agreement between engines) ──
positive = count(scores > 20)
negative = count(scores < -20)
if positive > 0 and negative > 0:
    confidence = agreement * 60  # max 60% لو فيه تعارض
elif positive > 0:
    confidence = min(positive / total * 100, 90)
elif negative > 0:
    confidence = min(negative / total * 100, 90)
else:
    confidence = 30  # كلهم neutral → low
```

### STAGE-3: Conflict Detection (موسّع)

```python
# من orchestrator_v3.resolve_conflict:
# 1. TREND positive + MOM negative → conflict
# 2. BRK positive + FLOW weak → conflict
# 3. MR positive in bear → conflict

# إضافات executor_v3 (STAGE-3):
# 4. FLOW قوي + TREND ضعيف/سلبي → conflict (confidence ≤ 45)
# 5. MOM قوي + MR قوي في اتجاهين متعاكسين → conflict (confidence ≤ 45)
# 6. كل العائلات |score| < 15 → confidence ≤ 25 (ضعف شامل)

# Conflict reduces confidence:
if not ok:
    confidence = min(confidence, 40)
if _has_conflict:
    confidence = min(confidence, 45)
```

### STAGE-4: تحويل signal_score لـ final_signal + Confidence Gate

```python
# Thresholds حسب الـ regime:
#   DEFENSIVE:  buy ≥ 35, strong_buy ≥ 55, sell ≤ -35
#   NORMAL:     buy ≥ 30, strong_buy ≥ 50, sell ≤ -30
#   AGGRESSIVE: buy ≥ 25, strong_buy ≥ 45, sell ≤ -25

# STAGE-4: Confidence Gate — ممنوع BUY لو confidence < 58
_confidence_ok = confidence >= 58
_no_conflict = not _has_conflict and ok

if signal_score >= strong_thresh and _confidence_ok and _no_conflict:
    final_signal = 'STRONG_BUY'
elif signal_score >= buy_thresh and _confidence_ok:
    final_signal = 'BUY'
elif signal_score <= sell_thresh and confidence >= 50:
    final_signal = 'SELL'
else:
    final_signal = 'NO_TRADE'

# Position size من final_position_size (موحد + كامل العوامل)
position_size_pct = final_position_size(
    base_size=0.02,
    flow_score=signal_score + 50,  # normalize -100..100 → 0..100
    liquidity_intensity=intensity,  # من market_cap
    free_float=free_float,          # من stocks.db
    regime=market_regime
) * 100

# S8 (سيولة ضعيفة) → position cap 1%
if state_code == 'S8':
    position_size_pct = min(position_size_pct, 1.0)
```

### STAGE-5: Ranking اليومي

```python
# لما عدد الإشارات يعدي max_picks:
rank_score = (
    signal_score_normalized * 0.45 +  # -100..100 → 0..100
    confidence * 0.25 +               # 0..100
    liquidity_intensity_norm * 0.15 + # turnover/market_cap
    signal_score_normalized * 0.10 +  # rs proxy
    confidence * 0.05                 # flow quality proxy
)
# رتّب تنازليًا → خد أعلى max_picks بس
# الباقي → NO_TRADE
```

---

## 5. محرك حالة السوق (MarketRegimeEngine)

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/analyzers/market_regime_engine.py` |
| **المدخلات** | 6 مؤشرات: SMA20/50/200, breadth, ATR, turnover, loss streak |
| **المخرجات** | `Regime.DEFENSIVE` / `Regime.NORMAL` / `Regime.AGGRESSIVE` |

### عتبات الـ Regime

| Regime | min_rr | min_score | position_size | max_picks |
|--------|--------|-----------|---------------|-----------|
| **DEFENSIVE** | 1.8 | 65 | 0.5× (50%) | 5 |
| **NORMAL** | 1.5 | 65 | 1.0× | 10 |
| **AGGRESSIVE** | 1.2 | 55 | 1.5× | 15 |

---

## 6. نظام السيولة والرادار (shared_liquidity.py)

> **مفصل بالكامل في القسم 6 من النسخة السابقة.** كل الثوابت + المعادلات + الـ 15 إصلاح اللي اتعملت موجودة. ما تغيّرش.

**الملف:** `vps-service/utils/shared_liquidity.py` (1,200+ سطر)
**الدوال الرئيسية:**
- `dynamic_min_turnover(price)` — 80K/200K/400K حسب السعر
- `is_explosive_surge(volumes, closes)` — 2.8× + SMA20 + range < 11%
- `detect_quiet_accumulation(closes, volumes, highs, lows)` — 6 إشارات (مطلوب 5/6)
- `detect_pre_surge(closes, volumes, highs, lows)` — 4 إشارات (مطلوب 3/4)
- `compute_money_flow(closes, volumes, highs, lows)` — 6 طبقات (CLV + CMF + vol + trend + dead + SMA)
- `detect_life_cycle(closes, volumes, highs, lows)` — 6 مراحل
- `should_reject_by_liquidity(turnover, price, volumes, closes, market_cap)` — 6 خطوات قرار
- `final_position_size(base, flow, intensity, free_float, regime)` — موحد + سقف 2.5%
- `clean_series(values)` + `robust_avg(vols)` — حماية من البيانات المتقطعة
- `is_buy_day(o, h, l, c, v, avg_v)` — يوم شراء حقيقي (شمعة خضراء + body + vol)
- `liquidity_intensity(turnover, market_cap)` — turnover/market_cap %

---

## 7. محرك التدفق (FlowSystemEngine)

> **مفصل بالكامل في القسم 7 من النسخة السابقة.** ما تغيّرش.

**الملف:** `vps-service/engines/flow_system.py` (1,335 سطر)
**الـ 4 طبقات:** Macro (25%) + Sector (30%) + Stock (25%) + Cross (20%)
**الـ Stock Flow** دلوقتي بـ يستخدم `compute_money_flow` من `shared_liquidity` كمصدر وحيد لـ buy/sell pressure.
**Labels:** FIRE (≥80, 2.5%) / FIRE (≥70, 2.0%) / SPARK (≥60, 1.5%) / ASH / COLD

---

## 8. فلتر السيولة (liquidity_filter.py)

> **مفصل بالكامل في القسم 8 من النسخة السابقة.** ما تغيّرش.

**الملف:** `vps-service/analyzers/liquidity_filter.py` (1,111 سطر)
**Kill Filters الـ 6:** السيولة (dynamic) + السعر + تذبذب الحجم + البيانات + القوة النسبية + Free Float

---

## 9. محرك الإغلاق (daily_closer.py)

> **مفصل بالكامل في القسم 9 من النسخة السابقة.** ما تغيّرش.

**الملف:** `vps-service/jobs/daily_closer.py` (3,789 سطر)
**متوافق مع V3:** بـ يقرأ من `predictions` table (نفس اللي V3 بـ يكتب فيها)
**9 قواعد خروج** + Hard Loss Ceiling 7% + Split Guard 35%

---

## 10. V40.2 — DEPRECATED

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/jobs/daily_predictor.py` (4,744 سطر) |
| **المحرك** | `V38BacktestEngine` (`vps-service/engines/backtest_engine.py` — 2,373 سطر) |
| **في crontab؟** | ❌ **لا — تم استبداله بـ V3** |
| **الحالة** | **DEPRECATED** — الكود موجود بس مش بـ يشتغل |

### ليه V40.2 اتبدّل

1. **صندوق أسود** — `analyze_single_day()` بـ يحسب كل حاجة لوحده (score + signal + entry + stop + target) من غير فصل واضح
2. **مفيش orchestrator/executor** — V38 بيعمل كل حاجة لوحده
3. **`INSTITUTIONAL_BUY`** — كان WR=0% (13 توقع كلهم STOPPED) فاتقتل ورجع تحت اسم `maker_bullish + flight_up`
4. **مفيش state-aware weights** — كل الأسهم بـ تتحلل بنفس المنطق بغض النظر عن حالتها
5. **مفيش conflict detection** — لو المحركات بتتعارض، النتيجة بـ تتحسب عادي

### الـ code مش متمسوح

`daily_predictor.py` + `backtest_engine.py` لسه موجودين (مش متمسوحين) بس **مش في crontab** و **مش بـ يشتغلوا**.

---

## 11. الأوزان + العتبات + الفلاتر

### V3 Weights (حسب الحالة S1-S10)

شوف [القسم 3](#3-المنسق-v3) — مصفوفة كاملة بـ 10 حالات × 7 عائلات.

### V3 Signal Thresholds (regime-aware)

| Regime | STRONG_BUY | BUY | SELL | NO_TRADE |
|--------|-----------|-----|------|----------|
| DEFENSIVE | ≥ 55 | ≥ 35 | ≤ -35 | between |
| NORMAL | ≥ 50 | ≥ 30 | ≤ -30 | between |
| AGGRESSIVE | ≥ 45 | ≥ 25 | ≤ -25 | between |

### Position Sizing

| المسار | position size |
|--------|--------------|
| V3 STRONG_BUY (regime-aware) | `final_position_size()` — موحد |
| QUIET_ACCUMULATION | 1.5% |
| PRE_SURGE | 1.5% |
| EXPLOSIVE_SURGE | 2.0% |
| LIQUIDITY_BYPASS | 2.5% |
| FlowScore FIRE (≥80) | 2.5% |
| FlowScore FIRE (≥70) | 2.0% |
| FlowScore SPARK (≥60) | 1.5% |
| **سقف صارم** | **2.5%** |

### Kill Filters

| الفلتر | الشرط | الإجراء |
|--------|------|---------|
| Penny Stock | `price < 1.0` | EXCLUDED |
| Dead Volume | `volume < 1000` | EXCLUDED |
| Liquidity | `turnover < dynamic_min_turnover(price)` | EXCLUDED |
| Liquidity Intensity | `turnover/market_cap < 0.05%` | EXCLUDED |
| Volume Volatility | `std/avg > 3.0` | EXCLUDED |
| Data Bars | `bars < 20` | EXCLUDED |
| Relative Strength | `RS_10 < -3.5%` | EXCLUDED |
| Free Float | `< 5%` | EXCLUDED |
| Free Float | `< 15%` | position × 0.5 |
| Flat Stock | `range 10d < 2%` | skip (in V3 filter) |

---

## 12. المؤشرات الفنية (Canonical)

| المؤشر | الملف | الصيغة |
|--------|------|--------|
| **RSI** | `analyzers/indicators/rsi.py` | Wilder's smoothing |
| **MACD** | `analyzers/indicators/ma.py` | EMA-12/26 + signal EMA-9 |
| **SMA** | `analyzers/indicators/ma.py` | Simple Moving Average |
| **ATR** | `analyzers/indicators/atr.py` | Wilder's (14 period) |
| **Bollinger** | `analyzers/indicators/bollinger.py` | SMA20 ± 2σ |
| **Stochastic RSI** | `analyzers/indicators/srsi.py` | — |
| **MFI** | `analyzers/indicators/mfi.py` | Money Flow Index |
| **VWAP** | `analyzers/indicators/vwap.py` | Volume Weighted Average Price |
| **ADX** | `analyzers/indicators/adx.py` | Trend strength |
| **Volume Profile** | `analyzers/indicators/volume_profile.py` | POC/VAH/VAL |

> **Rule 67:** `analyzers/indicators/` هو المصدر الوحيد للمؤشرات.

> **ملاحظة:** MOM بـ يستخدم Wilder's RSI من analyzers/indicators/rsi.py (STAGE-1.1 FIX — كان بدائي).

---

## 13. المسار الإنتاجي الفعلي

```
1. tradingview_scanner_live.py → أسعار + مؤشرات من TV → stocks.db
2. fetch_tv_indices.py → مؤشرات رسمية → market_indices
3. new_daily_predictor.py (V3):
   a. get_active_tickers(market)
   b. filter_stale_predictions() — شيل الأسهم اللي ليه توقع valid
   c. filter_dead_stocks() — شيل الأسهم الميتة (price=0 أو flat history)
   d. فلتر الإجازات — skip جمعة/سبت/أعياد
   e. لكل ticker:
      - get_price_history() — اقرأ آخر 20+ يوم (closes, volumes, highs, lows, opens)
        (raw sqlite3 readonly + flexible column names)
      - اقرأ market_cap + free_float من stocks.db
      - orchestrator_v3.create_v3_plan():
        * حدد stock_state (S1-S11) — بـ يستخدم SMA20 + SMA50 + ROC5 + ROC20 + vol_ratio_5d
        * حدد market_regime (DEFENSIVE/NORMAL/AGGRESSIVE)
        * اختار المحركات + الأوزان (مع إعادة تطبيع لو FUND/EVENT مش متاح)
      - executor_v3.execute_v3():
        * شغّل TREND (MasterAnalyzer — 8 طبقات confluence)
        * شغّل MOM (Wilder's RSI من analyzers/indicators/rsi.py)
        * شغّل MR (ATR-based mean reversion — 1.8× ATR threshold)
        * شغّل BRK (real breakout — close > high_20 + vol ≥ 1.4× + body ≥ 50%)
        * شغّل FLOW (compute_money_flow — 6 طبقات: CLV + CMF + vol + trend + dead + SMA)
        * شغّل FUND (placeholder: وزن=0 + إعادة تطبيع)
        * شغّل EVENT (placeholder: وزن=0 + إعادة تطبيع)
        * احسب signal_score (weighted -100..+100)
        * احسب confidence (agreement between engines)
        * فحص conflict (6 قواعد: TREND+MOM, BRK+FLOW, MR+TREND, FLOW+TREND, MOM+MR, all-weak)
        * Confidence Gate: BUY يحتاج confidence ≥ 58
        * حوّل signal_score → final_signal (regime-aware thresholds)
        * احسب position_size (final_position_size: flow + intensity + free_float + regime)
        * S8 (سيولة ضعيفة) → position cap 1%
      - STAGE-5: Ranking — رتّب الإشارات (score×0.45 + conf×0.25 + intensity×0.15)
      - save_prediction() → predictions.db (persona='v3_smart')
4. daily_closer.py → 9 exit rules → يقفل
5. Next.js API + UI → يعرض
```

### نتائج اختبار V3 على بيانات EGX حقيقية (2026-10-29)

```
EGX: 127 أسهم نشطة → 6 عدّوا الفلتر → 5 اتحللوا

EHDR: NO_TRADE (S8, score=-4.8, conf=33 < 58)
  engine_scores: TREND=-29.6, MOM=-40.4, MR=2.8, BRK=10.0, FLOW=0.0
  engine_signals: TREND=HOLD, MOM=SELL, MR=HOLD, BRK=HOLD, FLOW=HOLD
  warnings: S8 (weak liquidity) → position capped at 1%

UASG: NO_TRADE (S9, score=-23.9, conf=33 < 58)
  TREND=REJECTED_LIQUIDITY, MOM=SELL

ESAC: NO_TRADE (S8, score=-8.2, conf=20 < 58)
  TREND=REJECTED_LIQUIDITY, MOM=BUY

DIFC: NO_TRADE (S3, score=-8.3, conf=17 < 58)
  TREND=HOLD, MOM=HOLD

HCFI: NO_TRADE (S9, score=-26.7, conf=33 < 58)
  TREND=REJECTED_LIQUIDITY, MOM=SELL
```

> كل النتائج NO_TRADE — صحيح لأن الأسهم دي ضعيفة (S8/S9) والـ confidence منخفضة.
> V3 بيشتغل كما هو مصمم: لا يصدر إشارة إلا لو فيه confidence ≥ 58 + لا تعارض.

---

## 14. قواعد المخاطر المعتمدة

| القاعدة | القيمة | التفصيل |
|---------|--------|---------|
| Hard Loss Ceiling | 7.0% | ممنوع تسجيل خسارة < -7% |
| Split Drop Threshold | 35.0% | لو < -35% → `split_excluded` |
| Max Holding Days | 90 | بعد كده → EXPIRED |
| Position Cap | 2.5% | سقف صارم من `final_position_size()` |
| R:R Floor | 1.5 | ممنوع دخول لو R:R < 1.5 |
| ATR Stop Clamp | [5%, 9%] | stop distance بين 5% و 9% (EGX) |
| Target R/R | 1.8 | target = stop_dist × 1.8 |

---

## المراجع

| الملف | الدور | السطور | الحالة |
|------|------|--------|--------|
| **`vps-service/jobs/new_daily_predictor.py`** | **V3 predictor (إنتاجي)** | **505** | ✅ نشط |
| **`vps-service/core/orchestrator_v3.py`** | **المنسّق V3** | — | ✅ نشط |
| **`vps-service/core/executor_v3.py`** | **المنفّذ V3** | — | ✅ نشط |
| `vps-service/utils/shared_liquidity.py` | نظام السيولة + الرادار | 1,200+ | ✅ نشط |
| `vps-service/engines/flow_system.py` | FlowSystemEngine | 1,335 | ✅ نشط |
| `vps-service/analyzers/liquidity_filter.py` | Kill Filters | 1,111 | ✅ نشط |
| `vps-service/jobs/daily_closer.py` | الإغلاق اليومي | 3,789 | ✅ نشط |
| `vps-service/analyzers/market_regime_engine.py` | MarketRegimeEngine | — | ✅ نشط |
| `vps-service/analyzers/indicators/` | المؤشرات Canonical | — | ✅ نشط |
| `vps-service/jobs/daily_predictor.py` | V40.2 predictor | 4,744 | ❌ DEPRECATED |
| `vps-service/engines/backtest_engine.py` | V38BacktestEngine | 2,373 | ❌ DEPRECATED |
| `vps-service/core/orchestrator.py` | orchestrator قديم | 127 | ❌ DEPRECATED |
| `vps-service/core/executor.py` | executor قديم | 235 | ❌ DEPRECATED |
