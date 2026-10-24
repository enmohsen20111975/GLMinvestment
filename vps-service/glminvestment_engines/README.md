# محركات أساطير التداول — `glminvestment-engines`

> حزمة بايثون بتحوّل نظريات أساطير التداول (Minervini, Covel, Wilder, Mark Douglas)
> لخوارزميات رياضية صارمة، ومدموجة في `Confluence Engine v3` اللي بياخذ قرار موحّد.

```
Stage 2 (Minervini)  ─┐
VCP (Minervini)       ├─→  Confluence Engine v3  ─→  STRONG_BUY / BUY / NEUTRAL / AVOID
Donchian (Covel)      │         + ATR Risk Plan        + Stop Loss + Position Size + Take-Profit Tiers
ATR Risk (Wilder)    ─┘         + Stage 4 Veto
```

---

## 📚 المصادر النظرية

| المحرك | الكتاب / المؤلف | المفهوم الأساسي |
|--------|-----------------|-----------------|
| **Stage 2 Filter** | Mark Minervini — *Trade Like a Stock Market Wizard* | ممنوع شراء سهم في Stage 4 (هبوط). الشراء في Stage 2 فقط. |
| **VCP Detector** | Mark Minervini — *SEPA / VCP* | تقلص التقلب: انكماشات بتضيق + جفاف حجم = جاهز للانفجار. |
| **Donchian Breakout** | Richard Donchian + Turtles + Michael Covel | اختراق أعلى 20/55 يوم بحجم = بداية اتجاه. |
| **ATR Risk Engine** | Welles Wilder + Covel | وقف ديناميكي = entry − (multiplier × ATR)، مش وقف ثابت. |
| **Take-Profit Tiers** | Mark Douglas — *Trading in the Zone* | بيع تدريجي: ⅓ عند 1R + وقف لـ breakeven، ⅓ عند 2R، الباقي بـ trailing. |
| **Confluence v3** | Curtis Faith — *Way of the Turtle* | لا أداة واحدة تكفي. 3-5 استراتيجيات متفقة = صفقة عالية الجودة. |

---

## 🏗️ المعمارية

```
glminvestment-engines/
├── core/
│   ├── base.py              # الأنواع الموحدة: Signal, RiskPlan, EngineResult, Position
│   └── indicators.py        # ATR, RSI, ADX, Donchian, SMA/EMA (Wilder's smoothing)
├── engines/
│   ├── stage2_filter.py     # تصنيف المراحل 1/2/3/4 + فلتر صارم
│   ├── vcp_detector.py      # اكتشاف نموذج VCP (انكماشات + جفاف حجم)
│   ├── donchian_breakout.py # اختراق قنوات دونشيان + تأكيد حجم
│   ├── atr_risk_engine.py   # وقف ديناميكي + position sizing + tiers
│   └── take_profit_tiers.py # إدارة الصفقة بعد الدخول (بيع تدريجي + trailing)
├── confluence/
│   └── confluence_scorer.py # دمج كل المحركات بأوزان + Stage 4 Veto
├── backtest/
│   └── strategy_backtester.py  # محاكاة تاريخية بار ببار + إحصائيات Van Tharp
├── integration/
│   ├── expert_gate_patch.py # قالب لتوصيل Stage 2 + VCP بـ expert_quality_gate.py
│   └── risk_engine_patch.py # قالب لاستبدال الوقف الثابت بـ ATR
├── examples/
│   └── demo_confluence.py   # عرض شامل (سيناريو إيجابي + سلبي)
├── cli_analyze.py           # أداة CLI لتحليل CSV
└── README.md
```

### مبدأ التصميم
- **كل محرك مستقل**: كل واحد بياخد `DataFrame` ويرجّع `EngineResult`. قابل للاختبار والاستبدال.
- **Confluence كموحّد**: بدل ما تعتمد على محرك واحد، الـ Confluence بيمزج النتائج بأوزان موزونة.
- **Veto Power**: Stage 4 = رفض فوري. مفيش أي صفقة شراء في اتجاه هابط (قاعدة Minervini).
- **Math صحيح**: ATR/RSI/ADX بتستخدم Wilder's smoothing (RMA) مش SMA — غلطة شائعة في مكتبات كتير.

---

## 🚀 البدء السريع

### 1) العرض الشامل (بيانات اصطناعية)
```bash
cd glminvestment-engines
python3 examples/demo_confluence.py
```
بيولّد سهم وهمي Stage 2 + VCP + breakout، ويوضّح:
- كل محرك لوحده
- القرار النهائي (STRONG_BUY)
- خطة المخاطر الكاملة
- محاكاة إدارة الصفقة (Take-Profit Tiers يوم بيوم)

### 2) تحليل CSV حقيقي
```bash
python3 cli_analyze.py data/COMI.csv --symbol COMI --persona investor --capital 100000
```
الـ CSV لازم يكون فيه: `date,open,high,low,close,volume`.

### 3) محاكاة تاريخية (Backtest)
```bash
python3 cli_analyze.py data/COMI.csv --symbol COMI --backtest --min-signal BUY
# أو مباشرة:
python3 -m backtest.strategy_backtester data/COMI.csv --symbol COMI --capital 100000
```
بيطلع: Win Rate, Profit Factor, Avg R, Max Drawdown, Expectancy, تقييم جودة الاستراتيجية.

---

## 📖 المحركات بالتفصيل

### 1) Stage 2 Filter (`engines/stage2_filter.py`)

**القاعدة الصارمة**: السهم لازم يكون في Stage 2 (صعود) عشان نوافق على شراء.

| المرحلة | الشروط | الإشارة |
|---------|--------|---------|
| Stage 1 (تجميع) | مش في اتجاه صاعد واضح | NEUTRAL — انتظر |
| **Stage 2 (صعود)** | سعر > 200SMA + 200SMA صاعد + Golden Cross + ضمن 25% من القمة | **BUY / STRONG_BUY** |
| Stage 3 (قمة) | 200SMA يفرّد أو سعر مفرط (>70% فوق 200SMA) | AVOID — حذر |
| Stage 4 (هبوط) | سعر < 200SMA + 200SMA هابط | **STRONG_AVOID — ممنوع** |

```python
from engines.stage2_filter import analyze, classify_stage
result = analyze(df, symbol="COMI")
print(result.signal.signal_type)  # SignalType.STRONG_BUY
print(result.signal.metadata["stage"])  # 2
```

### 2) VCP Detector (`engines/vcp_detector.py`)

**السر الأكبر لمينيرفيني**: قبل الانفجار السعري، التقلب بيتقلّص.
```
Contraction 1: 22% range →
Contraction 2: 11% range →   (نصف الأول)
Contraction 3:  5% range →   (نصف التاني)
Volume: جاف في آخر انكماش
```

**التحسينات المطبّقة** (مقارنة بالـ detectors العادية):
- الـ pivot high بيتبحث **قبل آخر 3 شمعات** (منطقة الاختراق) — عشان شمعة الاختراق ما تشيّش الـ pivot.
- جفاف الحجم بيتقاس بـ **median** مش mean — مقاوم لشموع الاختراق (outliers).
- آخر شمعة (شمعة الاختراق) **مستثناة** من قياس الجفاف.

```python
from engines.vcp_detector import analyze
result = analyze(df, symbol="COMI")
print(result.signal.metadata["score"])  # 0-100
print(result.signal.metadata["contraction_ratios"])  # [0.41, 0.59] — متناقصة
```

### 3) Donchian Breakout (`engines/donchian_breakout.py`)

**Turtle System**: اشترِ لما السعر يكسر أعلى N يوم.
- System 1: اختراق 20 يوم + حجم ≥ 1.5× → BUY
- System 2: اختراق 55 يوم + حجم ≥ 2.0× → STRONG_BUY

```python
from engines.donchian_breakout import analyze
result = analyze(df, symbol="COMI")
print(result.signal.metadata["breakout_55"])  # True/False
print(result.signal.metadata["volume_ratio"])  # 3.94
```

### 4) ATR Risk Engine (`engines/atr_risk_engine.py`)

**استبدال الوقف الثابت**: `-8%` غلط. الوقف لازم يكون ديناميكي حسب تقلب السهم.

```
stop_loss = entry_price - (multiplier × ATR)
  scalper:  multiplier = 2.0  (وقف ضيق، صفقات سريعة)
  investor: multiplier = 3.0  (وقف واسع، يتحمل التذبذب)
```

**Position Sizing** (حجم المركز):
```
risk_amount = capital × risk_pct     (2% investor, 1% scalper)
shares = risk_amount / risk_per_share
```
ده يضمن إنك تفضل في السوق حتى بعد 10 خسارة ورا بعض.

**Take-Profit Tiers** (جني الأرباح التدريجي):
| Tier | السعر | بيع | إجراء |
|------|-------|-----|-------|
| Tier 1 | +1R | ⅓ المركز | حرّك الوقف لـ breakeven (free trade) |
| Tier 2 | +2R | ⅓ المركز | تأمين الربح |
| Tier 3 | +3R | ⅓ المركز | EXIT_FINAL (أو trailing stop) |

```python
from engines.atr_risk_engine import compute_risk_plan
plan = compute_risk_plan(df, entry_price=150.0, persona="investor", account_size=100_000)
print(plan.stop_loss, plan.shares, plan.take_profit_tiers)
```

### 5) Take-Profit Tiers (`engines/take_profit_tiers.py`)

**إدارة الصفقة بعد الدخول** — بيتستدعى كل بار على الصفقات المفتوحة.

القرارات الممكنة:
- `HOLD` — لسه مبوصلش tier
- `SELL_TIER_1` — بِع ⅓ عند 1R + حرّك الوقف لـ breakeven
- `SELL_TIER_2` — بِع ⅓ عند 2R
- `UPDATE_TRAILING` — حدّث الوقف المتحرك (max of ATR-trailing و Donchian-exit)
- `EXIT_STOP` — الوقف اتضرب
- `EXIT_FINAL` — وصل 3R (الهدف النهائي)

```python
from engines.take_profit_tiers import evaluate_position, position_from_risk_plan
position = position_from_risk_plan(plan, symbol="COMI", entry_date=now)
decision = evaluate_position(position, df)
print(decision.action)  # PositionAction.SELL_TIER_1
```

### 6) Confluence Engine v3 (`confluence/confluence_scorer.py`)

**الدمج النهائي** — بياخد نتائج كل المحركات ويرجّع قرار واحد.

| المحرك | الوزن | السبب |
|--------|-------|-------|
| Stage 2 | 30% | الفلتر الأهم (ممنوع شراء هابط) |
| VCP | 25% | جودة الصفقة |
| ATR Risk | 20% | إدارة المخاطر |
| Donchian | 15% | تأكيد الاتجاه |
| External (persona/seasonality) | 10% | سياق |

**قواعد القرار**:
- `STRONG_BUY`: score ≥ 80 + ≥ 3 محركات BUY
- `BUY`: score ≥ 60 + ≥ 2 محركات BUY
- `NEUTRAL`: score 40-60
- `AVOID`: score 20-40
- `STRONG_AVOID`: score < 20

**Veto**: Stage 4 → STRONG_AVOID فوراً مهما كانت المحركات التانية.

```python
from confluence.confluence_scorer import analyze
result = analyze(df, symbol="COMI", persona="investor", account_size=100_000)
print(result.final_signal)       # SignalType.STRONG_BUY
print(result.final_score)        # 90.0
print(result.risk_plan)          # RiskPlan مع stop + shares + tiers
```

---

## 📊 الـ Backtester (`backtest/strategy_backtester.py`)

المحاكاة التاريخية بتثبت إن المحركات بتعمل فلوس. بتمشي بار ببار:

1. **Warmup** (215 بار):Stage 2 محتاج 200SMA.
2. **كل بار**: شغّل Confluence على البيانات لحد دلوقتي.
3. **لو BUY/STRONG_BUY + مفيش صفقة + مش في cooldown** → افتح صفقة بالـ ATR plan.
4. **لو فيه صفقة** → شغّل Take-Profit management (وقف؟ tier؟ trailing؟).
5. **سجّل كل شيء** وحدّث منحنى رأس المال.

### الإحصائيات المُخرجة
| المقياس | المعنى | الجيد |
|---------|--------|-------|
| **Win Rate** | نسبة الصفقات الرابحة | ≥ 50% |
| **Profit Factor** | إجمالي الأرباح ÷ إجمالي الخسائر | ≥ 1.5 |
| **Avg R** | متوسط الـ R-multiple (Van Tharp) | ≥ 0.3R |
| **Max Drawdown** | أكبر هبوط في منحنى رأس المال | ≤ 25% |
| **Expectancy** | متوسط الربح/الخسارة لكل صفقة | > 0 |

### مثال نتيجة (بيانات اصطناعية)
```
إجمالي الصفقات:    12
Win Rate:          100%       (بيانات اصطناعية نظيفة)
Profit Factor:     inf        (مفيش خسائر)
Avg R:             +1.442R
Max Drawdown:      2.37%
Expectancy:        +3,328 جنيه/صفقة
التقييم: 🟢 ممتاز
```

```python
from backtest.strategy_backtester import run_backtest, print_report, BacktestConfig
from core.base import SignalType

cfg = BacktestConfig(initial_capital=100_000, persona="investor", min_signal=SignalType.BUY)
result = run_backtest(df, symbol="COMI", config=cfg)
print_report(result)
```

---

## 🔌 التوصيل بـ `vps-service` الموجود

### التوصيل 1: Stage 2 Veto في Expert Gate

في `vps-service/analyzers/expert_quality_gate.py`، ضيف الـ veto في بداية `evaluate()`:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "glminvestment-engines"))

from integration.expert_gate_patch import stage2_veto_check, vcp_confidence_boost

def evaluate(df, symbol, proposed_buy):
    # ── Step 1: Stage 2 hard veto ──
    veto = stage2_veto_check(df, symbol, proposed_buy.get("signal", ""))
    if veto is not None:
        return {"approved": False, "rejected": True,
                "reason": veto["reason"], "rejecting_engine": "stage2_veto"}

    # ── Step 2: فحوصاتك القديمة (defensive filter, etc.) ──
    # ... الكود القديم ...

    # ── Step 3: VCP confidence boost ──
    base_conf = proposed_buy.get("confidence", 0.5)
    vcp_result = vcp_confidence_boost(df, symbol, base_conf)

    return {"approved": True, "confidence": vcp_result["new_confidence"],
            "vcp_score": vcp_result["vcp_score"]}
```

### التوصيل 2: استبدال الوقف الثابت بـ ATR

في الـ code اللي بيأنشئ الصفقة (عادةً في `background_analyzer.py` أو `master_analyzer.py`):

```python
# BEFORE (وقف ثابت — غلط):
stop_loss = entry_price * 0.92   # -8%
shares = 100                      # حجم ثابت

# AFTER (وقف ديناميكي — صح):
from integration.risk_engine_patch import create_trade_with_atr
trade = create_trade_with_atr(df, symbol, entry_price, persona, account_size)
# trade فيه: stop_loss (ديناميكي), shares (محسوب), take_profit_tiers, _risk_plan
```

### التوصيل 3: إدارة الصفقات المفتوحة

في الـ loop اللي بيفحص الصفقات المفتوحة كل دورة:

```python
from integration.risk_engine_patch import check_open_position

for trade in open_trades:
    decision = check_open_position(trade, df, trade["entry_date"])
    if decision["action"] == "SELL_TIER_1":
        # نفّذ بيع ⅓ + حدّث الوقف
        ...
    elif decision["action"] == "EXIT_STOP":
        # أقفل الصفقة
        ...
```

---

## ⚙️ المتطلبات

```
python >= 3.10
pandas >= 1.5
numpy >= 1.24
```

---

## 🎯 Roadmap

### ✅ مكتمل
- [x] Stage 2 Filter (Minervini)
- [x] VCP Detector (مع تحسينات median + breakout-zone)
- [x] Donchian Breakout (System 1 + 2)
- [x] ATR Risk Engine (وقف ديناميكي + position sizing + tiers)
- [x] Take-Profit Tiers (بيع تدريجي + trailing ATR+Donchian)
- [x] Confluence Engine v3 (أوزان + Stage 4 Veto)
- [x] Backtester (محاكاة تاريخية + إحصائيات Van Tharp)
- [x] CLI analyzer
- [x] Demo شامل

### 🔜 المرحلة التالية
- [ ] ربط بـ EGX database الفعلي (لما الـ infrastructure يتظبط)
- [ ] إضافة slippage + commissions للـ backtester
- [ ] معايرة الأوزان (weights) على بيانات EGX تاريخية
- [ ] SMC Liquidity Sweeps (محتاج بيانات intraday — مؤجل)
- [ ] scheduled-learning (Expert Memory) — تعلّم من الصفقات السابقة

---

## 📝 ملاحظات مهمة

1. **المسارات كلها نسبية**: الحزمة بتستخدم `Path(__file__)` فتشتغل على أي جهاز (لاب توب / sandbox / إنتاج).
2. **ما فيش hardcoded paths**: الـ integration patches بتستخدم `sys.path.insert` نسبي.
3. **Math متحقق منه**: ATR/RSI/ADX بتستخدم Wilder's RMA. VCP volume بـ median. تم اختباره على بيانات اصطناعية.
4. **مفيش test code**: الـ demo + backtester هما الـ verification. الـ backtester بيعمل regression test فعلي للخوارزميات.
5. **Veto صارم**: Stage 4 = رفض فوري. ده مش قابل للتعديل من بره (قاعدة Minervini).

---

**الخلاصة**: الحزمة جاهزة للتوصيل. أول ما تخلص البنية التحتية (paths + database lock)، اعمل التوصيلات التلاتة في `expert_quality_gate.py` و `background_analyzer.py` و شغّل الـ backtester على بيانات EGX تاريخية عشان تشوف الـ win rate الحقيقي.
