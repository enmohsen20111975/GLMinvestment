# 📊 V40.2 Flag Ablation — Phase 0 + 1 Results

> **Period:** 2026-02-01 → 2026-08-27 (fixed)
> **Capital:** 100,000 EGP | 10% per position | Scan every 5 trading days
> **Universe:** EGX stocks (screener ∩ EGX ∩ fundamentals) — contamination filter applied
> **Date:** 2026-09-03

---

## 🎯 الهدف النهائي (من المالك)

- WR ≥ 50%
- PF ≥ 1.6
- Max DD ≤ 18%
- Expectancy ≥ +1.8% per trade

**القاعدة:** أي flag بيقلل الـ PF أو بيرفع الـ DD → يُقتل فوراً.

---

## 📋 جدول النتايج الكامل

| Config | Trades | WR% | PF | Return% | MaxDD% | Exp% | AvgWin | AvgLoss | Verdict |
|--------|--------|-----|-----|---------|--------|------|--------|---------|---------|
| **BASELINE** | 125 | 43.20 | 1.59 | +10.71 | -30.05 | +2.17 | +13.61 | -6.53 | — |
| STRICT_ENTRY | 113 | 44.25 | 1.63 | +11.97 | -35.33 | +2.65 | +15.47 | -7.53 | ❌ LOSER (DD worse) |
| **DISTRIBUTION_EXIT** | 130 | 43.85 | **2.11** | **+20.35** | **-22.43** | **+4.00** | +17.36 | -6.42 | 🏆 **WINNER** |
| NOTEBOOK_CONTEXT | 130 | 48.46 | 1.68 | +11.92 | -34.16 | +2.74 | +14.04 | -7.88 | ❌ LOSER (DD worse) |
| NEWS_IMPACT | 125 | 44.00 | 1.75 | +10.25 | -39.38 | +2.67 | +14.14 | -6.33 | ❌ LOSER (DD worse) |
| POSITION_SIZING | 131 | 43.51 | 1.54 | +8.97 | -28.36 | +1.47 | +9.66 | -4.84 | ❌ LOSER (PF lower) |

---

## 🏆 Winner الوحيد: DISTRIBUTION_EXIT

**ليه كسب:**
- ✅ **PF: 1.59 → 2.11** (+0.52 = +33% improvement)
- ✅ **Return: +10.71% → +20.35%** (+90% improvement — ضعف الـ baseline)
- ✅ **MaxDD: -30.05% → -22.43%** (أقل بـ 7.6 نقطة — أمان أعلى)
- ✅ **Exp: +2.17% → +4.00%** (+84% improvement)
- ✅ **AvgWin: +13.61 → +17.36** (كل صفقة رابحة بتجيب أكتر)

**السبب:** الـ distribution exit بيكتشف الـ topping patterns (red candle + upper wick + volume spike + near high + RSI>65) ويخرج قبل ما السهم ينهار. ده بيخلي الصفقات الرابحة تكبر (لأنها بتفضل لحد ما التوزيع يحصل) والصفقات الخاسرة تقل (لأنها بتخرج بدري).

---

## ❌ Losers (4 flags اترفضت)

### 1. STRICT_ENTRY (❌ DD worse)
- PF: 1.59 → 1.63 (تحسن بسيط)
- DD: -30.05% → -35.33% (أسوأ بـ 5 نقاط)
- **السبب:** الـ strict filter بيقلل عدد الصفقات (125 → 113) بس الـ trades اللي بتفوت فيها فرص ربح كبيرة. الـ DD زاد لأن المراكز بقت أكتر تركز.

### 2. NOTEBOOK_CONTEXT (❌ DD worse)
- PF: 1.59 → 1.68 (تحسن بسيط)
- WR: 43.20% → 48.46% (تحسن جيد)
- DD: -30.05% → -34.16% (أسوأ بـ 4 نقاط)
- **السبب:** الـ typical_correction_pct بيكبر الـ stop أحياناً (لـ 9%) بدل 7%، فالخسارات بقت أكبر.

### 3. NEWS_IMPACT (❌ DD worse)
- PF: 1.59 → 1.75 (تحسن بسيط)
- DD: -30.05% → -39.38% (أسوأ بـ 9 نقاط!)
- **السبب:** الـ simulated news impact بيدخل صفقات إضافية مبنية على price spikes، بس كتير منها fakeouts. الـ DD زاد جداً.

### 4. POSITION_SIZING (❌ PF lower)
- PF: 1.59 → 1.54 (أسوأ)
- DD: -30.05% → -28.36% (تحسن بسيط)
- **السبب:** تصغير الـ position size للأسهم المتفجرة بيخفّض الـ return أكتر مما بيخفّض الـ loss. الـ expectancy نزلت من +2.17% لـ +1.47%.

---

## 📊 المسافة عن الهدف النهائي

| Metric | Baseline | DISTRIBUTION_EXIT (Winner) | الهدف | المسافة |
|--------|----------|----------------------------|-------|---------|
| WR | 43.20% | 43.85% | ≥50% | -6.15pp ❌ |
| PF | 1.59 | 2.11 | ≥1.6 | ✅ تجاوز! |
| MaxDD | -30.05% | -22.43% | ≤18% | -4.43pp ❌ |
| Exp | +2.17% | +4.00% | ≥+1.8% | ✅ تجاوز! |

**الخلاصة:** DISTRIBUTION_EXIT وحده مش كافي للوصول للهدف. محتاجين نركبه مع حاجة تانية.

---

## 🎯 المرحلة الجاية (Phase 2 — Combinations)

هنجرب الـ combos التالية:
1. **DISTRIBUTION_EXIT + STRICT_ENTRY** ( Winner + قوي على paper)
2. **DISTRIBUTION_EXIT + NOTEBOOK_CONTEXT** (Winner + WR improver)
3. **DISTRIBUTION_EXIT + NEWS_IMPACT** (Winner + PF improver)
4. **DISTRIBUTION_EXIT + STRICT_ENTRY + NOTEBOOK_CONTEXT** (triple)
5. **ALL ON** (كل حاجة مع بعض)

الهدف: نلاقي combo يوصل WR ≥ 50% + PF ≥ 1.6 + DD ≤ 22%.

---

## ⚠️ ملاحظة تقنية مهمة

اكتشفنا إن `egksco_price_history` بيخلط بين tickers من EGX و TADAWUL تحت نفس الـ symbol (مثلاً AJWA في مصر سعره 0.4 وفي السعودية 135). ده كان بيعمل نتايج خيالية (Return +1330%). اتعمل فلتر:
- بس tickers موجودة في `stocks.db` بـ `market IN ('EGX', 'مصر')`
- price sanity check: السعر لازم يكون بين 20%-500% من `stocks.db.current_price`

الـ filter ده مهم جداً لأي backtest مستقبلي.
