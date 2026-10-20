# 🔬 Event-driven Strategy — التحقق من الـ 4 نقاط (محسن طلبها)

> **التاريخ:** 2026-10-20
> **المهمة:** التحقق من 4 نقاط طلبها محسن قبل أي Paper Trading
> **الـ script:** `scripts/event_driven_4point_verification.py`

---

## 📊 النتائج النهائية

| Period | N | Mean | Std | Sharpe | MaxDD | Null Mean | p_normal | p_bootstrap | p_block | Edge? |
|--------|---|------|-----|--------|-------|-----------|----------|-------------|---------|-------|
| 2026 | 384 | +2.65% | 9.12% | 1.45 | 68.69% | +0.58% | 0.0% | 0.0% | 0.1% | ✅ |
| 2025 | 257 | +2.67% | 9.12% | 1.46 | 71.61% | +0.50% | 0.0% | 0.0% | 0.5% | ✅ |
| 2024-baseline | 122 | -0.44% | 8.13% | -0.27 | 83.80% | -0.61% | 42.0% | 40.7% | 43.4% | ❌ |
| 2024+regime | 120 | -0.34% | 8.17% | -0.21 | 81.66% | -1.10% | 18.4% | 16.7% | 20.7% | ❌ |
| 2026+regime | 358 | +2.57% | 9.13% | 1.41 | 68.69% | +0.40% | 0.0% | 0.0% | 0.1% | ✅ |
| 2025+regime | 108 | +0.79% | 7.98% | 0.49 | 68.17% | -0.03% | 17.7% | 16.1% | 21.3% | ❌ |

---

## ✅ النقطة 1: re-run بدون 2023 (2025 + 2026 بس = 641 صفقة)

**النتيجة:** Edge مثبت إحصائيًا على 641 صفقة.

- **2026:** N=384, Mean=+2.65%, Sharpe=1.45, p < 0.1% (Bootstrap + Block Bootstrap)
- **2025:** N=257, Mean=+2.67%, Sharpe=1.46, p < 0.5% (Bootstrap + Block Bootstrap)
- **Matched Null Model:** الـ strategy بـ outperform الـ null بـ +2.07% (2026) و +2.17% (2025)
- **الـ edge من التوقيت** (بعد التصحيح الحاد)، مش من اختيار الأسهم

**القرار:** 2023 مستبعد (38 صفقة + 97% clustering = مش موثوق). الاعتماد على 2025+2026 بس.

---

## ✅ النقطة 2: إصلاح MaxDD calculation

**الـ bug القديم:** `cumsum` على returns نسبوية → MaxDD ممكن يطلع > 100% (مستحيل رياضيًا).

**الـ FIX:** `cumprod` على equity curve (compounding).
```python
# OLD (buggy):
cumulative = np.cumsum(returns_arr)  # تراكم خطي لنسب
# NEW (fixed):
equity = np.cumprod(1 + returns_arr/100)  # equity curve بـ compounding
drawdown_pct = (peak - equity) / peak * 100
```

**النتائج بعد الإصلاح:**
| Period | MaxDD القديم (buggy) | MaxDD الجديد (fixed) |
|--------|---------------------|---------------------|
| 2026 | ~110-160% (مستحيل) | 68.69% ✅ |
| 2025 | ~110-160% (مستحيل) | 71.61% ✅ |
| 2024 | ~110-160% (مستحيل) | 83.80% ✅ |

**كل القيم < 100% دلوقتي.** الـ MaxDD الحقيقي = 68-84% (عالي جدًا — لازم position sizing صغير).

---

## ⚠️ النقطة 3: اختبار Regime Filter على 2024

**الـ Regime Filter:** COMI (proxy EGX30) فوق 200-day MA = BULL/RANGE، تحت = BEAR. skip الإشارات في BEAR.

**النتيجة:** الـ Regime Filter بسيط (200-day MA) **مش كفاية** لـ 2024.

| Period | N (baseline) | N (regime) | Mean (baseline) | Mean (regime) | p (baseline) | p (regime) |
|--------|-------------|-----------|-----------------|---------------|-------------|------------|
| 2024 | 122 | 120 | -0.44% | -0.34% | 42.0% | 18.4% |

- الـ filter شال بس **2 إشارة** (122 → 120) — 2024 كان bearish قوي، أغلب السنة تحت 200-day MA
- الـ p-value تحسن (42% → 18.4%) بس لسه مش edge (< 5%)
- **2025 + regime:** شال 149 إشارة (257 → 108)، والـ edge اختفى (p = 17.7%)

**القرار:** الـ Regime Filter بسيط (200-day MA) مش حل لـ 2024. محتاج regime filter أقوى (مثلا: volatility-based أو trend-strength-based). 2024 سنة bearish قوية — التصحيحات بـ تـكمل نزول (falling knives).

---

## ✅ النقطة 4: Matched Null Model (re-verify)

**الـ model:** لكل event signal، ندخل 3 random entries في نفس السهم + نفس الفترة + نفس SL/TGT/Hold. ده بـ يـلغي edge من stock selection.

**النتيجة:** مؤكد شغال — Null Mean دايمًا أقل من Strategy Mean.

| Period | Strategy Mean | Null Mean | Outperformance |
|--------|--------------|-----------|----------------|
| 2026 | +2.65% | +0.58% | +2.07% |
| 2025 | +2.67% | +0.50% | +2.17% |
| 2024 | -0.44% | -0.61% | +0.17% (مش معنوي) |

**الـ edge من التوقيت** (بعد التصحيح الحاد)، مش من اختيار الأسهم.

---

## 🎯 الخلاصة النهائية

| السؤال | الإجابة |
|--------|---------|
| هل Edge حقيقي بدون 2023؟ | ✅ أيوه، p < 0.5% على 641 صفقة (2025+2026) |
| هل MaxDD fixed؟ | ✅ أيوه، كل القيم < 100% (68-84%) |
| هل Regime Filter يحل 2024؟ | ❌ لأ، الـ filter البسيط مش كفاية |
| هل Matched Null شغال صح؟ | ✅ أيوه، edge من التوقيت مش stock selection |

---

## 📋 التوصيات

### ✅ جاهز لـ Paper Trading (بشروط صارمة)
- **Position Sizing:** 0.5% مخاطرة لكل صفقة (الـ MaxDD = 68-84% عالي)
- **Max Concurrent:** 5 صفقات
- **Kill Switch:** MaxDD > 10% → إيقاف
- **مدة Paper Trading:** 8 أسابيع
- **مقارنة Live vs Backtest:** Live PF المفروض قريب من 1.93

### ⚠️ محتاج تطوير قبل الإطلاق الكامل
- **Regime Filter أقوى:** الـ 200-day MA مش كفاية. محتاج:
  - Volatility-based filter (ATR ratio)
  - Trend-strength filter (ADX > 25)
  - أو EGX30 regime من HMM (موجود في Screener)
- **2024 acceptance:** الاستراتيجية مش شغالة في bear markets قوية. نتقبل ده + نضيف regime filter قوي.

### 🚫 ممنوع
- استثمار بـ 100% من رأس المال (الـ MaxDD = 68-84% = خسارة كارثية)
- تشغيل بدون regime filter (2024 بتـ خسران)
- احتفال قبل Paper Trading

---

## 📁 الـ artifacts

- `scripts/event_driven_4point_verification.py` — الـ script
- `vps-service/backtest_results/event_driven_4point_*.json` — النتائج الكاملة
- `EVENT-DRIVEN-4POINT-VERIFICATION.md` — هذا الملف
