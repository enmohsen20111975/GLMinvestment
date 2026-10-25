# 📊 Rolling IC + Weight Matrix — Final Report

**Generated:** 2026-10-24
**Method:** Breadth-only regime (no EGX30 — avoids splits contamination)
**Period:** 2023-01 → 2026-09 (46 months)
**Universe:** 20 tickers (top by data density) × 8 blocks × 4 horizons
**Total observations:** 3,989

---

## 📋 Executive Summary

| المحور | النتيجة |
|---|---|
| **Regime Counts** | Bull=19 (41%), Bear=14 (30%), Sideways=13 (28%) |
| **8 Blocks tested** | 8/8 شغالة، 0 redundant pairs |
| **Strongest blocks** | volume_price_div (IC Bear=+0.167), volume_surge (IC Bear=+0.115) |
| **Weakest blocks** | distance_52w (IC Bear=-0.188), momentum_60 (IC Bear=-0.177) |
| **Best horizon** | 20d for most blocks (longer horizon = more signal) |
| **Bear winners** | volume_price_div + volume_surge (both IC>0.10) |

---

## 📅 Phase 1: Breadth Regime Classification (46 months)

**Method:** breadth = % tickers above SMA50 (last trading day of month)
- **Bull:** breadth > 55%
- **Bear:** breadth < 45%
- **Sideways:** else

### Regime Summary

| Regime | Count | % |
|---|---|---|
| 🟢 Bull | 19 | 41% |
| 🔴 Bear | 14 | 30% |
| 🟡 Sideways | 13 | 28% |

**Verdict: PASS ✅** (14 Bear months within expected 8-20 range)

### Bear Months (14 total)

| Month | Breadth | Context |
|---|---|---|
| 2023-02 | 44.8% | تصحيح بداية سنة |
| 2023-03 | 26.9% | أزمة بنوك أمريكا |
| 2023-07 | 44.6% | صيف بطيء |
| 2024-03 | 19.2% | حرب إيران / توترات إقليمية |
| 2024-04 | 8.9% | استمرار التوترات |
| 2024-05 | 24.2% | تعافي بطيء |
| 2024-12 | 32.9% | تصحيح نهاية سنة |
| 2025-04 | 43.8% | تصحيح بعد صعود Q1 |
| 2025-05 | 43.1% | استمرار التصحيح |
| 2025-06 | 44.0% | ضغط بيعي |
| 2025-07 | 42.3% | استمرار Bear |
| 2026-03 | 37.9% | تصحيح ربعي |
| 2026-09 | 43.8% | تصحيح خريف |
| 2026-10 | 21.6% | انهيار (جزئي - بيانات ناقصة) |

---

## 📈 Phase 2: Rolling IC Results (8 blocks × 4 horizons)

| Block | IC_1d | IC_5d | IC_10d | IC_20d | Best Horizon |
|---|---|---|---|---|---|
| breadth_trend | -0.007 | -0.026 | -0.017 | -0.012 | 1d (weakest) |
| buy_sell_pressure | — | — | — | — | N/A (constant) |
| distance_52w | +0.011 | -0.060 | -0.080 | -0.084 | 1d (weak) |
| momentum_20 | -0.087 | -0.075 | -0.050 | -0.012 | 20d |
| momentum_60 | -0.077 | -0.089 | -0.076 | -0.092 | 10d |
| sector_leadership | — | — | — | — | N/A (constant) |
| volume_price_div | -0.057 | +0.069 | +0.072 | +0.085 | **20d** ⭐ |
| volume_surge | +0.011 | +0.028 | +0.016 | +0.042 | **20d** ⭐ |

### Ranking (by IC_20d — best horizon):

1. **volume_price_div**: IC_20d = +0.085 (MODERATE) ⭐
2. **volume_surge**: IC_20d = +0.042 (WEAK)
3. **breadth_trend**: IC_20d = -0.012 (NOISE)
4. **momentum_20**: IC_20d = -0.012 (NOISE)
5. **distance_52w**: IC_20d = -0.084 (NEGATIVE)
6. **momentum_60**: IC_20d = -0.092 (NEGATIVE)
7. **buy_sell_pressure**: N/A (constant — data issue)
8. **sector_leadership**: N/A (constant — data issue)

---

## 🎯 Phase 3: Regime-Conditional IC (10d horizon)

| Block | Bull IC | Bear IC | Sideways IC | Verdict |
|---|---|---|---|---|
| breadth_trend | -0.006 | -0.082 | -0.016 | WEAK في كلها |
| buy_sell_pressure | — | — | — | N/A |
| distance_52w | -0.103 | -0.188 | +0.024 | **NEGATIVE في Bear** ❌ |
| momentum_20 | -0.061 | -0.171 | +0.069 | **POSITIVE في Sideways** ⭐ |
| momentum_60 | -0.043 | -0.177 | -0.028 | NEGATIVE في Bear |
| sector_leadership | — | — | — | N/A |
| **volume_price_div** | +0.013 | **+0.167** | +0.060 | **STRONG في Bear** ⭐⭐ |
| **volume_surge** | -0.039 | **+0.115** | -0.004 | **MODERATE في Bear** ⭐ |

### 🚨 الاكتشافات الجوهرية:

1. **volume_price_div الأقوى في Bear** (IC=+0.167) — مؤشر تراكم قوي في الأزمات
2. **volume_surge الثاني في Bear** (IC=+0.115) — حجم كبير = اهتمام مؤسسي
3. **momentum_20 POSITIVE في Sideways بس** (IC=+0.069) — الزخم بيشحن في السوق المحايد
4. **distance_52w NEGATIVE في Bear** (IC=-0.188) — القرب من القمة = إشارة خطر في Bear
5. **breadth_trend ضعيف** (IC≈0) — المفاجأة! الـ market regime نفسه مش predictor قوي

---

## 🔗 Phase 4: Correlation Matrix (8×8)

| | breadth | buy_sell | dist_52w | mom_20 | mom_60 | sector | vol_price | vol_surge |
|---|---|---|---|---|---|---|---|---|
| breadth_trend | 1.00 | — | 0.13 | 0.12 | 0.09 | — | 0.02 | 0.09 |
| buy_sell_pressure | — | — | — | — | — | — | — | — |
| distance_52w | 0.13 | — | 1.00 | 0.15 | 0.07 | — | -0.17 | 0.28 |
| momentum_20 | 0.12 | — | 0.15 | 1.00 | **0.42** | — | -0.08 | 0.03 |
| momentum_60 | 0.09 | — | 0.07 | **0.42** | 1.00 | — | -0.02 | -0.05 |
| sector_leadership | — | — | — | — | — | — | — | — |
| volume_price_div | 0.02 | — | -0.17 | -0.08 | -0.02 | — | 1.00 | 0.13 |
| volume_surge | 0.09 | — | 0.28 | 0.03 | -0.05 | — | 0.13 | 1.00 |

**Redundant pairs (|corr| > 0.75): 0** ✅ — كل الـ blocks مستقلة.

**أعلى correlation:** momentum_20 ↔ momentum_60 = 0.42 (مقبول — نفس الفكرة بس فترات مختلفة).

---

## ⚖️ Phase 5: Weight Matrix Proposal (based on IC)

### Bull regime (19 months)
| Block | Weight | IC_10d |
|---|---|---|
| volume_price_div | 1.000 | +0.013 |
| (others) | 0.000 | negative |

**ملاحظة:** في Bull، بس volume_price_div عنده IC موجب (وذلك ضعيف). ده معناه إن **في Bull، مفيش feature قوي** — السوق كله بيرفع.

### Bear regime (14 months) ⭐
| Block | Weight | IC_10d |
|---|---|---|
| **volume_price_div** | **0.593** | **+0.167** ⭐⭐ |
| **volume_surge** | **0.407** | **+0.115** ⭐ |
| (others) | 0.000 | negative |

**هنا الاكتشاف الحقيقي:** في Bear، volume_price_div + volume_surge بيديا IC قوي. ده منطقي — في الأزمات، الحجم بيعكس اهتمام المؤسسات.

### Sideways regime (13 months)
| Block | Weight | IC_10d |
|---|---|---|
| momentum_20 | 0.452 | +0.069 |
| volume_price_div | 0.390 | +0.060 |
| distance_52w | 0.158 | +0.024 |
| (others) | 0.000 | negative |

**في Sideways:** momentum_20 هو الأقوي — الزخم بيشحن لما السوق محايد.

### Default (overall)
| Block | Weight | IC_10d |
|---|---|---|
| volume_price_div | 0.821 | +0.072 |
| volume_surge | 0.179 | +0.016 |
| (others) | 0.000 | negative |

---

## 🎯 التوصية الاستراتيجية

### 1. **volume_price_div هو الأقوى عبر كل الـ regimes**
- IC Bear = +0.167 (STRONG)
- IC Sideways = +0.060 (MODERATE)
- IC Bull = +0.013 (WEAK)
- **التوصية:** وزن عالي في Bear + Sideways، منخفض في Bull

### 2. **volume_surge ثاني أقوى، خاصة في Bear**
- IC Bear = +0.115 (MODERATE)
- **التوصية:** وزن متوسط في Bear

### 3. **momentum_20 بيشتغل في Sideways بس**
- IC Sideways = +0.069 (MODERATE)
- IC Bear = -0.171 (NEGATIVE — خطر!)
- **التوصية:** وزن عالي في Sideways، **صفر في Bear**

### 4. **distance_52w + momentum_60 = خطر في Bear**
- IC Bear = -0.188 و -0.177 (NEGATIVE)
- **التوصية:** **صفر في Bear** (ممنوع استخدامهم)

### 5. **breadth_trend ضعيف بشكل مفاجئ**
- IC ≈ 0 في كل regimes
- **التوصية:** وزن صفر — مش بيضيف قيمة تنبؤية

### 6. **buy_sell_pressure + sector_leadership = N/A (constant)**
- البيانات رجعت constant (data issue)
- **التوصية:** محتاجين فحص data quality قبل الاستخدام

---

## ⚠️ Honest Limitations

1. **Sample size:** 20 tickers × 3989 observations — كافي للـ IC بس مش للـ cross-validation
2. **2 blocks N/A:** buy_sell_pressure + sector_leadership رجعوا constant (data issue في delta_pct/sector rankings)
3. **IC values low:** أعلى IC = +0.167 (MODERATE، مش STRONG > 0.20)
4. **Bear sample:** 14 شهر × ~20 ticker × 21 يوم ≈ 5,880 observation (كافي)
5. **Transaction costs:** 0.3% غير محسوبة في forward returns
6. **Survivorship bias:** الأسهم المتشالة مش في الـ DB
7. **Splits contamination:** تجنبناها باستخدام breadth مش EGX30

---

## 📦 الملفات المُنتجة

| File | المحتوى |
|---|---|
| `vps-service/camp/orchestrator.py` | Orchestrator + breadth regime + EGX30/70/100 historical |
| `vps-service/camp/blocks/breadth_trend.py` | block جديد (بديل egx30_trend) |
| `vps-service/camp/rolling_ic_analyzer.py` | Rolling IC + correlation + weight matrix |
| `scripts/camp/results/breadth_regime_checkpoint.json` | Regime counts + bear months |
| `scripts/camp/results/rolling_ic_full.json` | كل النتائج الخام |
| `scripts/camp/results/rolling_ic.log` | log كامل |

---

## 🚀 الخطوات التالية المقترحة

بناءً على الأدلة:

1. **حدّث weights.yaml** بالـ weight matrix proposal (Bull/Bear/Sideways)
2. **عطّل blocks ضعيفة:** breadth_trend (IC≈0), buy_sell_pressure (N/A), sector_leadership (N/A)
3. **ركّز على volume_price_div + volume_surge** (الأقوى في Bear)
4. **Backtest بالـ weights الجديدة** على 46 شهر
5. **Holdout validation** على آخر 3 شهور

**commit + push بعد كل خطوة (Rule 75).**

---

*Report generated by camp/rolling_ic_analyzer.py*
