# 07-HOW_WE_THINK.md

> **Deep Dive 2** — منطق المحرك + كيف يفكر النظام + الخوارزميات + الإثباتات.
> مصدر الحقيقة لكل ما يخص منطق التفكير والقرار الاستثماري.

---

## 1. العقيدة التحليلية

### المبدأ الحاكم
> "مشروع حقيقي لأموال حقيقية — الحقيقة المجردة الصادمة أشرف وأربح بآلاف المرات من أي نسبة فوز وهمية."

### القاعدة الذهبية
**Python = العقل، Node = العرض فقط** (Rule 20)

- كل المنطق المالي في Python (`vps-service/`)
- Node.js يعرض فقط ما يرسله Python عبر API
- ممنوع أي logic مالي في React
- ممنوع `Math.random()` لإنتاج أرقام مالية

### الفلتر الكمي الحديدي
```
R:R ≥ 1.5 (مستهدف ≥ 2.0)
ثقة ≥ 65%
ممنوع شراء على زخم محايد/تصريفي
لو مفيش صفقات مؤكدة → "كاش وانتظار"
لا اختلاق صفقات كاذبة لملء الشاشة
```

---

## 2. عتبات الإشارات الكنسية (Canonical Signal Thresholds)

**الملف:** `vps-service/analyzers/master_analyzer.py:506-512`

```python
THRESHOLDS = {
    'STRONG_BUY': 78,    # was 80, reduced to 78
    'BUY': 65,
    'ACCUMULATE': 55,
    'REDUCE': 40,
    'STRONG_SELL': 25,
}
```

### المصنّف الكنسي
**الملف:** `vps-service/utils/canonical_signal.py` (309 LOC)
**TS Port:** `src/lib/canonical-signal.ts` (271 LOC — مطابق 100%)

```python
def classify_signal(master_score, buy_pct, sell_pct, net_flow, phase):
    if master_score >= 78 and buy_pct >= 45:
        return 'STRONG_BUY'
    elif master_score >= 65:
        return 'BUY'
    elif master_score >= 55:
        return 'ACCUMULATE'
    elif master_score >= 40:
        return 'REDUCE'
    else:
        return 'STRONG_SELL'
```

---

## 3. أوزان التسجيل (Master Scoring Weights)

**الملف:** `vps-service/analyzers/master_analyzer.py:470-482`

```python
MASTER_WEIGHTS = {
    'smc': 0.26,                  # Smart Money Concepts (LEADING)
    'fundamental': 0.40,          # ★ أكبر وزن (was 0.18 → 0.40)
    'technical': 0.042,           # SMA/EMA (LAGGING, -30%)
    'ai_pattern': 0.06,
    'sentiment': 0.04,
    'market_regime': 0.05,
    'sector_relative': 0.05,
    'enhanced_indicators': 0.024, # MACD/RSI/Bollinger (LAGGING, -40%)
    'multi_timeframe': 0.03,
    'volume_profile': 0.043,      # VWAP+OBV (LEADING, +43%)
    'timing': 0.015,              # Session timing (-25%)
}
# Total ≈ 1.024
```

### لماذا هذه الأوزان؟
- **Fundamentals (40%)**: الأساسيات هي الأهم — لا قمار على أسهم بلا أساس
- **SMC (26%)**: Smart Money Concepts تقود — مؤسسي يكشفون نوايا صناع السوق
- **Technical (4.2%)**: مؤشرات lagging — تؤكد الاتجاه ولا تتنبأ به
- **Volume Profile (4.3%)**: VWAP + OBV — مؤشرات قيادية (+43%)
- **Timing (1.5%)**: توقيت الجلسة — أقل وزن (-25%)

---

## 4. نظام الإثباتات الستة (6 Proofs)

**الملف:** `vps-service/analyzers/institutional_decision_engine.py:339-487`

> ⚠️ **تصحيح حرج**: الأقسام القديمة كانت تقول "5 Proofs" — هذا خطأ. الدالة الفعلية `_build_6_proofs` تبني **6 إثباتات**:

| # | الإثبات | الوزن | السطر | المصدر |
|---|---|---|---|---|
| 1 | Trend (الاتجاه) | 15 | 341 | close vs sma200 |
| 2 | Makers (صانعو السوق) | 20 | 342 | absorption/distribution |
| 3 | DNA/Fingerprint (البصمة) | 15 | 343 | candle prob + stock DNA |
| 4 | Fundamentals (الأساسيات) | 15 | 344 | fundamental_score |
| 5 | Sector (القطاع) | 10 | 345 | sector_change + market_regime |
| 6 | Benchmark/RS (القوة النسبية) | 15 | 346 | stock_roc vs benchmark_roc |

---

## 5. حالات صانع السوق (Maker States)

**الملف:** `vps-service/analyzers/institutional_decision_engine.py:114`

3 حالات:
1. **Accumulation** — صانع السوق يجمع (شراء تدريجي)
2. **Distribution** — صانع السوق يوزّع (بيع تدريجي)
3. **Neutral** — لا نشاط واضح

### Rule 80: تناسق تدفق الأموال
```python
def classify_money_flow(buy_pct, sell_pct, net_flow_egp, phase):
    if buy_pct < 40 or net_flow_egp < 0 or phase == 'تخفيض':
        return '🔴 ضغط بيعي قوي'  # NEVER "سيولة داخلة"
    elif 40 <= buy_pct < 45:
        return '🟡 سيولة متوازنة'  # NOT "داخلة"
    elif buy_pct >= 45 and diff >= 10:
        return '🟢 سيولة داخلة'
```

---

## 6. محرك V40.2 (THE BRAIN)

**الملف:** `vps-service/analyzers/core_scoring_engine.py`

### المكونات
1. **Core Scoring** — حساب master_score من 11 بُعد
2. **Master Analyzer** — الدمج الموحد لكل المحللات
3. **V68 Oracle** — probability/fingerprint supplement
4. **Institutional Decision Engine** — 6 proofs + maker states

### محركات معطّلة (DISABLED — لا تُفعّل)
- `v82_analyzer.py` — SUB_ENGINE_DISABLED=True
- `sniper_engine.py` — SUB_ENGINE_DISABLED=True
- `confluence_engine_v3.py` — SUB_ENGINE_DISABLED=True
- `board_of_analysts.py` — SUB_ENGINE_DISABLED=True

> Rule 73: canonical signal comes from `master_analyzer.py` only.

---

## 7. المؤشرات الكنسية (Canonical Indicators)

**Rule 67b: CALCULATION-CANONICAL** — كل حساب له canonical file واحد:

| المؤشر | Canonical (Python) | TS Port |
|---|---|---|
| ATR | `vps-service/analyzers/indicators/atr.py` | `src/lib/canonical-*.ts` |
| RSI | `vps-service/analyzers/indicators/rsi.py` | `src/lib/canonical-rsi.ts` |
| MA | `vps-service/analyzers/indicators/ma.py` | — |
| Stochastic RSI | `vps-service/analyzers/indicators/srsi.py` | — |

### ATR — Wilder's Smoothing (ليس SMA)
```python
# vps-service/analyzers/indicators/atr.py
TR[i] = max(high[i] - low[i],
           |high[i] - close[i-1]|,
           |low[i] - close[i-1]|)
ATR = (ATR_prev × (period-1) + TR) / period  # Wilder's smoothing
```

### السعر الكنسي (Canonical Price)
**الملف:** `src/lib/canonical-price.ts`

ترتيب الحل:
1. `stocks.db.stocks.current_price` (canonical primary)
2. `data_engine.db.egksco_price_history` (clean close)
3. VPS Python API `/api/stock/{ticker}` (live)

لو كل المصادر فشلت → `null` (Rule 27: NULL = NULL، لا fabrication)

---

## 8. إعدام نظام الشخصيات (Death of Personas)

> "تم دفن المتوازن والمضارب والمستثمر — المنصة مؤسسية موحدة تقدم High-Conviction Institutional Signals فقط."

### ما حدث
- النظام القديم كان يقدّم 3 شخصيات: المضارب / المتوازن / المستثمر
- كل شخصية لها توقعات مختلفة + R:R مختلف
- هذا أربك المستخدم + خلق تضارب

### ما حل محلّه
- **منصة مؤسسية موحدة** — توقيع واحد عالي الثقة لكل سهم
- `signal` واحد + `master_score` واحد + `entry/target/stop` واحد
- Rule 78: TradePlanCard يظهر فقط لـ BUY/STRONG_BUY/ACCUMULATE

---

## 9. حلقة العمل اليومية (Daily Cycle)

```
10:00-14:30 Cairo  → جلسة تداول EGX مفتوحة
                    → RealtimeTicker + LiveMonitor نشطة
                    → WS service يبث الأسعار كل 2s

15:00 Cairo        → إغلاق EGX
                    → سحب الإغلاقات اليومية من Data Engine

15:30 Cairo        → تقفيل الصفقات (verify pending predictions)
                    → hit_target / hit_stop / still_pending

15:35 Cairo        → توليد صفقات الغد
                    → Python master_analyzer يركض
                    → predictions.db تُحدّث

15:40 Cairo        → فحص ذاتي آلي
                    → KPIs + win rate + drift detection
```

---

## 10. Rule 78: التعرّض المشروط للصفقات

### المنطق
```typescript
// في ProfessionalTradingChart.tsx:730-828
if (isBuySignal && (entry !== null || target1 !== null || stop !== null)) {
  return <TradePlanCard entry={entry} target={target1} stop={stop} rr={rr} />;
}

switch (signal) {
  case 'SELL':
  case 'AVOID':
  case 'KILL':
  case 'REJECT':
    return <RedWarningPanel message="لا توجد فرصة شراء" />;
  case 'REDUCE':
    return <AmberWarningPanel message="قلّل المركز" />;
  case 'HOLD':
  case 'WAIT':
    return <AmberLightPanel message="انتظر تأكيد الإشارة" />;
}
```

### Rule 79: Falling Knife Quant Guard
```python
# لو السهم تحت MA50 بـ >5% + MA50 < MA200
# → targets_available = False
# → القمم = مقاومات تصريفية (لا أهداف شراء)
```

---

## 11. عقد البيانات الموحّد (Rule 72: UNIFIED-DATA-CONTRACT)

### 16 Canonical Metric
كل شاشة تعرض هذه المؤشرات تستوردها من canonical module:

| Metric | Source |
|---|---|
| signal | `canonical_signal.classify_signal()` |
| master_score | `master_analyzer.py` |
| entry_price | `/api/stocks/[ticker]/unified` |
| target_price | same |
| stop_loss | same |
| rr_ratio | same |
| regime | `market_regime` module |
| regime_confidence | same |
| analysis_text | same |
| buy_pct | `institutional_decision_engine` |
| sell_pct | same |
| net_flow | same |
| phase | same (Wyckoff) |
| fundamental_score | `fundamental_analyzer` |
| technical_score | `technical_analyzer` |
| volume_profile | `volume_profile_analyzer` |

---

## 12. منصّة الإنقاذ (Bag-Holder Rescue Platform)

**Rule 78 + V-08**: محرك إنقاذ الصفقات المتعثرة.

### 3 قرارات صارمة
```
1. CUT_LOSS (أحمر) — أوقف الخسارة فورًا
   - متى: regime bear + money flow negative + no recovery signal

2. AVERAGE_DOWN (amber) — متوسط التكلفة بشروط
   - متى: regime bull + money flow positive + close > MA200
   - شروط: requires additional capital + new avg cost calculation

3. HOLD (أخضر) — احتفظ وانتظر
   - متى: regime neutral + fundamentals strong + temporary drawdown
```

### مصدر البيانات
- `/api/portfolio/bag-holder-rescue` (POST)
- Body: `{ ticker, buy_price, quantity }`
- Response: `{ diagnosis, institutional_analysis, decisions }`

---

## 13. التدقيق الصادق (Audited Track Record)

### Rule 50: MONEY-AS-CUSTOMER-LIFE
- كل رقم في شاشات المحفظة/الثروة/التنبيهات لازم يكون حقيقي من DB
- لا mock data في أي portfolio endpoint
- comments في الكود توثّق التاريخ (BEFORE/AFTER)

### Audited Performance View (للـ VIP)
- `VIPLiveSignalsFeed.tsx` — catalyst amber box + copy button + audited banner
- 4 stat boxes: total / win rate / avg return / avg hold time
- Audited history table (آخر 20 صفقة)

---

## 14. حدود المخاطر المعتمدة

| الحد | القيمة | المصدر |
|---|---|---|
| R:R minimum | 1.5 (مستهدف 2.0) | Rule 18 |
| ATR stop range | [5%, 9%] | Rule 8 |
| Trailing stop | FLOOR not CAP | Rule 9 |
| EXIT_POLICY_MODE | `partial_1r_trailing` | Rule 10 |
| Hard Loss Ceiling | enforced | Rule 19 |
| Split Guard | enforced | Rule 19 |
| Fundamentals placeholder | ممنوع (لا 50) | Rule 24 |
| R:R floor | 1.8 | Rule 18 |

---

*آخر تحديث: 2026-10-14 by سوسو (CEO Agent)*
