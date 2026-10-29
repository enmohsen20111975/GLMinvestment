# 03 — المحركات والمنطق الاستثماري (تفاصيل كاملة)

> **آخر تحديث:** 2026-10-29 | **BRAVO-DATA-LAYER (`data_engine/data_layer.py`)**
> **V3 هو النظام الإنتاجي الوحيد. V40.2 deprecated (مش في crontab).**
> **كل معادلة + كل threshold + كل branch logic موثّق من الكود الفعلي.**
> **V3 دلوقتي بـ يقرا كل بياناته عبر `data_engine.data_layer` — مفيش أي قراءة مباشرة لـ stocks.db.**

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
15. [نتائج الاختبار على بيانات EGX حقيقية](#15-نتائج-الاختبار-على-بيانات-egx-حقيقية)

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
| **الملف** | `vps-service/jobs/new_daily_predictor.py` (~660 سطر) |
| **الـ cron** | ✅ في crontab (صباح 03:00 UTC + مساء 15:00 UTC) |
| **المنسّق** | `vps-service/core/orchestrator_v3.py` (13,196 bytes) |
| **المنفّذ** | `vps-service/core/executor_v3.py` (10,037 bytes) |
| **الـ DB** | `predictions.db` → جدول `predictions` (نفس الـ table بتاع V40.2) |
| **الـ persona** | `v3_smart` |
| **مصدر البيانات** | **`data_engine/data_layer.py`** — مفيش أي قراءة مباشرة لـ stocks.db |

### المسار

```
new_daily_predictor.py
  → get_active_tickers(market) ← data_layer.get_market_snapshots(market)
  → filter_stale_predictions() — شيل الأسهم اللي ليه توقع valid
                                    (current prices من data_layer)
  → filter_dead_stocks() — شيل الأسهم الميتة (price=0 أو flat history)
                            (snapshots من data_layer)
  → فلتر الإجازات — skip جمعة/سبت/أعياد
  → لكل ticker:
      → get_price_history() ← data_layer.get_history_lists(ticker, days, market)
          (historical_data + egksco_price_history + tv_snapshot merged)
      → اقرأ market_cap من data_layer.get_snapshot(ticker)
      → orchestrator_v3.create_v3_plan() — حدد الحالة (S1-S11) + الأوزان
      → executor_v3.execute_v3() — شغّل 7 عائلات + conflict + confidence + signal
      → STAGE-5: Ranking — رتّب الإشارات واختار أعلى max_picks
      → save_prediction() — احفظ في predictions.db (persona='v3_smart')
          (entry_price من data_layer.get_snapshot)
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
4. **فلتر الأسهم الـ flat** — skip لو ≤1 قيمة مختلفة في 30 يوم (STAGE-FIX: خُفّض من ≤2)
5. **minimum 20 يوم بيانات** — V3 محتاج 20+ يوم للتحليل (كان 50 — خُفّض)

### get_price_history (BRAVO-DATA-LAYER)

```python
# BRAVO-DATA-LAYER (2026-10-29): بـ يقرا عبر data_engine.data_layer
# مش بـ يفتح stocks.db مباشرة (تم حذف كل قراءات sqlite3 المباشرة)
#
# data_layer.get_history_lists(ticker, days, market) بـ يرجع:
#   (closes, volumes, highs, lows, opens) — كلهم list[float]
#
# الـ data layer بـ يدمج 3 مصادر:
#   1. historical_data (data_engine.db) — daily OHLCV نظيف من 2021-2026
#   2. egksco_price_history (data_engine.db) — EGX daily + buy/sell pressure
#   3. tv_snapshot (data_engine.db) — اليوم الطازج (لو مش موجود في historical_data)
#
# النتيجة: تاريخ صناعي نظيف، non-flat، ينتهي بالسعر اللحظي الطازج.
# مفيش حاجة لـ "synthetic day" أو "flat-data workaround" — الـ data layer بـ يحلها.
```

### filter_dead_stocks (BRAVO-DATA-LAYER)

```python
# فلتر 1: price = 0 → ميت فعلاً
# فلتر 2: أسعار flat (≤1 قيمة مختلفة في 30 يوم) → ميت تاريخياً
# ملاحظة: volume=0 مش سبب للرفض (يوم هادي مش سهم ميت)
# ملاحظة: change_percent مش مستخدم (كان بيقتل 126/127 سهم غلط!)
#
# البيانات بـ تيجي من data_layer.get_market_snapshots(market) + get_price_history()
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

| الخاصية | القيمة |
|---|---|
| **الملف** | `vps-service/analyzers/master_analyzer.py` (5,424 سطر) |
| **الـ class** | `MasterAnalyzer` |
| **المدخلات** | `ticker, prices[], volumes[], market_pulse, history` |
| **المخرجات** | `MasterAnalysis(signal, master_score 0-100, confidence, risk_profile)` |

**MasterAnalyzer مش V38** — محرك مستقل بـ 10 طبقات موزونة:

```python
master_score = (
    technical_score * 0.042 +        # SMA/EMA (LAGGING — -30%)
    fundamental_score * 0.40 +       # الأساسيات (قلب القرار)
    timing_score * 0.015 +           # توقيت الجلسة
    ai_pattern_score * 0.06 +        # Pattern recognition
    sentiment_score * 0.04 +         # News sentiment
    market_regime_score * 0.05 +     # حالة السوق
    sector_relative_score * 0.05 +   # السهم vs القطاع
    enhanced_indicators_score * 0.024 + # MACD/RSI/Bollinger (LAGGING — -40%)
    multi_timeframe_score * 0.03 +   # Daily/weekly/monthly
    volume_profile_score * 0.043 +   # VWAP/OBV/Volume Nodes (LEADING +43%)
)
# + SMC BLEND: ادمج SMC (Order Blocks) بـ نسبة 60% كأولوية قصوى
# = master_score (0-100)
```

**عتبات الإشارة** (من `canonical_signal.py` — SSOT):
- `STRONG_BUY` ≥ 78
- `BUY` ≥ 65
- `ACCUMULATE` ≥ 55
- `REDUCE` ≥ 40
- `STRONG_SELL` < 25

**Confluence 8-layer** (طبقة إضافية فوق الـ master_score):
1. **Macro** — اتجاه السوق العام
2. **SMA50** — السعر فوق/تحت SMA50
3. **RSI** — تشبع بيعي/شرائي
4. **Volume** — تأكيد الحجم
5. **Bollinger** — ضغط/توسع النطاق
6. **MACD** — تقاطع صاعد/هابط
7. **Candlestick** — أنماط الشموع
8. **Fibonacci** — مستويات الفيبو

**في V3:** `_run_trend` بـ يستدعي `MasterAnalyzer.analyze()` وبياخد `master_score` (0-100) ويحوّله لـ norm (-100..+100) بـ `(score - 50) * 2`.

```python
def _run_trend(plan, prices, volumes, ticker, market):
    a = MasterAnalyzer()
    r = a.analyze(ticker, prices=prices, volumes=volumes)
    score = r.master_score  # 0-100
    signal = r.signal       # HOLD/BUY/SELL/etc
    norm = (score - 50) * 2  # -100..+100
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

> **ملاحظة:** MOM بـ يستخدم Wilder's RSI من analyzers/indicators/rsi.py (STAGE-1.1 FIX — تم الإصلاح).

---

## 13. المسار الإنتاجي الفعلي

```
1. tradingview_scanner_live.py
   → TradingView Scanner API → data_engine.db (عبر data_layer)
   → tv_snapshot (snapshot) + tv_indicators (RSI/SMA/MACD/ATR) + historical_data (daily OHLCV)
   → السكرابر بـ يحط market slug صراحةً (EGX/TADAWUL/...) — مش بـ يعتمد على الـ API

2. fetch_tv_indices.py → مؤشرات رسمية → stocks.db.market_indices (legacy — لم يُهاجر بعد)

3. new_daily_predictor.py (V3):
   a. get_active_tickers(market) ← data_layer.get_market_snapshots(market)
      (tickers من tv_snapshot، مش stocks.db)
   b. filter_stale_predictions() — شيل الأسهم اللي ليه توقع valid
      (current prices من data_layer.get_market_snapshots)
   c. filter_dead_stocks() — شيل الأسهم الميتة (price=0 أو flat history)
      (snapshots + history من data_layer)
   d. فلتر الإجازات — skip جمعة/سبت/أعياد
   e. لكل ticker:
      - get_price_history() ← data_layer.get_history_lists(ticker, days, market)
        (historical_data + egksco_price_history + tv_snapshot merged — نظيف non-flat)
      - اقرأ market_cap من data_layer.get_snapshot(ticker)
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
        (entry_price من data_layer.get_snapshot — مطابق للسعر اللحظي 0.000%)

4. daily_closer.py → 9 exit rules → يقفل
5. Next.js API + UI → يعرض
```

### بنية البيانات الجديدة (BRAVO-DATA-LAYER)

```
┌─────────────────────────────────────────────────────────────────────┐
│              TradingView Scanner (مصدر خارجي)                       │
└────────────────────────────┬────────────────────────────────────────┘
                             │ POST scanner.tradingview.com/{market}/scan
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  data_engine/scrapers/tradingview_scanner_live.py                   │
│  (بـ يحط market slug صراحة: EGX/TADAWUL/KSE/QSE/US/crypto)         │
└────────────────────────────┬────────────────────────────────────────┘
                             │ upsert_snapshot() + upsert_indicators()
                             │ + append_daily_prices()
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│            data_engine/data_layer.py (طبقة البيانات الموحدة)        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  data_engine.db (المصدر الوحيد — 531 MB)                   │    │
│  │  • tv_snapshot (702 rows: EGX 295 + TADAWUL 407)           │    │
│  │  • tv_indicators (702 rows — RSI/SMA/MACD/ATR time-series) │    │
│  │  • historical_data (198K rows — daily OHLCV 2021-2026)     │    │
│  │  • egksco_price_history (60K rows — EGX + buy/sell)        │    │
│  │  • tab_* (fundamentals)                                    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  API:                                                               │
│    get_snapshot(ticker) → price + RSI + SMA + ATR + market_cap      │
│    get_history(ticker, days) → merged OHLCV (oldest→newest)         │
│    get_indicators(ticker) → RSI/MACD/SMA/ATR                        │
│    get_market_stocks(market) → [tickers]                            │
│    get_market_snapshots(market) → [snapshots]                       │
│    normalize_market(alias) → canonical slug                         │
│      (egypt/مصر/EGX → 'EGX', ksa/السعودية/TADAWUL → 'TADAWUL', ...) │
└────────────────────────────┬────────────────────────────────────────┘
                             │ قراءة موحدة (engines مش بـ تفتح DB مباشرة)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  V3 Predictor (new_daily_predictor.py)                              │
│  → كل قراءات البيانات عبر data_layer (0 قراءات مباشرة لـ stocks.db)│
│  → orchestrator_v3 + executor_v3 → 7 عائلات تحليل                   │
│  → save_prediction() → predictions.db                               │
└─────────────────────────────────────────────────────────────────────┘
```

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

## 15. نتائج الاختبار على بيانات EGX حقيقية

### 15.1 اختبار BRAVO-DATA-LAYER (2026-10-29 10:05)

**التشغيل:** `python3 new_daily_predictor.py --today-only --max-tickers 50 --market EGX`

```
EGX: 295 سهم نشط في tv_snapshot → 50 عدّوا الفلتر → كلهم اتحللوا

✅ 18 توقع SELL محفوظة في predictions.db
   - 0 errors
   - 32 NO_TRADE
   - متوسط الثقة: 60.6%
```

### 15.2 أعلى التوقعات (مرتبة بالثقة)

| ticker | signal | entry | target | stop | score | conf | RSI |
|--------|--------|-------|--------|------|-------|------|-----|
| **MEPA** | SELL | 1.29 | 1.23 | 1.33 | -52.4 | 80% | 31.8 |
| **ETEL** | SELL | 122.60 | 116.47 | 126.28 | -46.3 | 80% | 38.9 |
| CERA | SELL | 1.06 | 1.01 | 1.09 | -59.8 | 60% | 37.4 |
| AMII | SELL | 7.75 | 7.36 | 7.98 | -59.0 | 60% | 36.7 |
| ELEC | SELL | 1.51 | 1.43 | 1.56 | -58.9 | 60% | 36.8 |
| LUTS | SELL | 0.65 | 0.62 | 0.67 | -57.3 | 60% | — |
| EGCH | SELL | 10.71 | 10.17 | 11.03 | -56.7 | 60% | — |
| ISPH | SELL | 9.89 | 9.40 | 10.19 | -55.3 | 60% | — |
| POUL | SELL | 9.50 | 9.03 | 9.79 | -54.6 | 60% | — |
| PHDC | SELL | 11.65 | 11.07 | 12.00 | -50.2 | 60% | — |

### 15.3 التحقق من جودة التوقعات (Spot-Check)

تم التحقق من أعلى 5 توقعات عبر `data_layer.get_snapshot()` + `data_layer.get_history()`:

| الاختبار | النتيجة |
|----------|---------|
| `entry_price` = `live price` | ✅ 5/5 (0.000% diff) |
| منطق SELL صحيح (`target < entry < stop`) | ✅ 5/5 |
| RSI < 40 (oversold — منطقي على downtrend) | ✅ 5/5 |
| التاريخ non-flat (≥2 قيمة مختلفة في 10 أيام) | ✅ 5/5 |

### 15.4 اختبار TADAWUL (slug normalization)

**التشغيل:** `python3 new_daily_predictor.py --today-only --max-tickers 10 --market TADAWUL --dry-run`

```
TADAWUL: 407 سهم نشط في tv_snapshot → 10 اتحللوا

✅ 4 إشارات SELL (7010, 1150, 1120, 1180)
   - 0 errors
   - slug normalization شغّال: 'ksa' → 'TADAWUL' → data_layer
```

### 15.5 اختبار Idempotency (Scanner)

تشغيل السكرابر مرتين متتاليتين على نفس السوق:

| المقياس | قبل | بعد | التغيير |
|---------|-----|------|---------|
| `tv_snapshot` rows | 295 | 295 | 0 (upsert، مش duplicate) |
| `tv_indicators` rows | 295 | 295 | 0 |
| `historical_data` rows | 197,718 | 197,718 | 0 |
| COMI price | 120.5 | 120.15 | تحديث (السوق شغال) |

✅ السكرابر idempotent — مفيش duplicate أو data corruption.

### 15.6 حالة الـ data_engine.db بعد الاختبار

| الجدول | rows | max_date | المصدر |
|--------|------|----------|--------|
| `tv_snapshot` | 702 | 2026-10-29 10:07 | TV Scanner (EGX 295 + TADAWUL 407) |
| `tv_indicators` | 702 | 2026-10-29 | TV Scanner |
| `historical_data` | 198,125 | 2026-10-29 | TV Scanner + historical (merged) |
| `egksco_price_history` | 60,097 | — | EGKSCO scraper |
| `stocks` (legacy) | 1,098 | — | fallback فقط |

### 15.7 مقارنة قبل/بعد BRAVO-DATA-LAYER

| المقياس | قبل (V3 يقرا stocks.db) | بعد (V3 يقرا data_layer) |
|---------|-------------------------|--------------------------|
| أسهم EGX قابلة للتحليل | 5/127 (4%) | 50/295 (17%) |
| إشارات حقيقية | 0 (كلهم NO_TRADE) | 18 SELL |
| `entry_price` vs `live` | mismatch (snapshot قديم) | 0.000% diff |
| أخطاء قراءة بيانات | متكررة (flat data) | 0 |
| market slug | 'EGX' فقط (كسر TADAWUL) | normalized (11 alias → 6 canonical) |
| مصدر البيانات | stocks.db (متفرق) | data_engine.db (موحد) |

---

## المراجع

| الملف | الدور | السطور | الحالة |
|------|------|--------|--------|
| **`data_engine/data_layer.py`** | **طبقة البيانات الموحدة (BRAVO-DATA-LAYER)** | **~450** | ✅ نشط |
| **`data_engine/scrapers/tradingview_scanner_live.py`** | **TV Scanner — بـ يكتب لـ data_engine.db عبر data_layer** | **~780** | ✅ نشط |
| **`vps-service/jobs/new_daily_predictor.py`** | **V3 predictor (إنتاجي) — بـ يقرا عبر data_layer** | **~660** | ✅ نشط |
| **`vps-service/core/orchestrator_v3.py`** | **المنسّق V3** | — | ✅ نشط |
| **`vps-service/core/executor_v3.py`** | **المنفّذ V3** | — | ✅ نشط |
| `vps-service/utils/shared_liquidity.py` | نظام السيولة + الرادار | 1,200+ | ✅ نشط |
| `vps-service/engines/flow_system.py` | FlowSystemEngine | 1,335 | ✅ نشط |
| `vps-service/analyzers/liquidity_filter.py` | Kill Filters | 1,111 | ✅ نشط |
| `vps-service/jobs/daily_closer.py` | الإغلاق اليومي | 3,789 | ✅ نشط |
| `vps-service/analyzers/market_regime_engine.py` | MarketRegimeEngine | — | ✅ نشط |
| `vps-service/analyzers/indicators/` | المؤشرات Canonical | — | ✅ نشط |
| `scripts/create_tv_tables.py` | إنشاء tv_snapshot + tv_indicators | — | ✅ نشط |
| `scripts/run_all_bravo_commands.sh` | سكربت تشغيل كامل لكل المراحل | — | ✅ نشط |
| `vps-service/jobs/daily_predictor.py` | V40.2 predictor | 4,744 | ❌ DEPRECATED |
| `vps-service/engines/backtest_engine.py` | V38BacktestEngine | 2,373 | ❌ DEPRECATED |
| `vps-service/core/orchestrator.py` | orchestrator قديم | 127 | ❌ DEPRECATED |
| `vps-service/core/executor.py` | executor قديم | 235 | ❌ DEPRECATED |
