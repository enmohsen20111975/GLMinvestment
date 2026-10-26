# REGIME_WEIGHT_POLICY
> **Phase 3-4:** سياسة اختيار المحركات + الأوزان + الترتيب
> **Scope:** EGX فقط | **Status:** فرضيات قابلة للاختبار

---

## 1. فصل الحسابات

| المخرج | المعنى | كيف يُحسب |
|---|---|---|
| **Signal Score** | قوة الدليل على اتجاه/فرصة | مجموع موزون لمحركات التحليل |
| **Confidence** | موثوقية الاستنتاج | اتفاق المحركات + جودة البيانات + ثقة التصنيف |
| **Risk Score** | المخاطر والقيود | من risk_gate (Hard Loss, ATR, Split, Cooldown) |
| **Trade Eligibility** | هل يُسمح بالتداول؟ | NO_TRADE if risk gate blocks |
| **Position Size** | حجم المركز المسموح | من risk_gate (max 25%, clamped) |

**لا يُسمح لـ Signal Score المرتفع بتعويض مخالفة حد مخاطرة إلزامي.**

---

## 2. عائلات التحليل + المحركات الفعلية

| العائلة | المحركات الفعلية | النوع |
|---|---|---|
| **Trend/Direction** | technical, technical_weighted, technical_target_engine, multi_timeframe_engine | trend |
| **Momentum/Breakout** | breakout_signal, sniper_engine, sniper_detector, hunting_engine | momentum |
| **Mean Reversion/Range** | candlestick, candle_probability_engine, fibonacci, support_resistance_calculator | pattern |
| **Volume/Liquidity** | liquidity_filter, volume_profile, flow_system | liquidity |
| **Volatility/Risk** | risk, risk_adaptive, position_sizing, position_manager, news_stop_filter | risk |
| **Fundamentals** | fundamental, fundamental_engine, fundamental_scorer, fair_value_calculator, dividend_checker | fundamental |
| **News/Sentiment** | news_fetcher_analyzer, news_impact_scorer, sentiment_analyzer, ai_sentiment | news |
| **Confluence/Scoring** | confluence_engine_v3, core_scoring_engine, conviction_engine, fusion_engine, confidence_engine | scoring |
| **Regime/Macro** | market_regime_engine, regime_detector, regime_filter, hmm_market_regime, crypto_regime | regime |
| **Pattern/Structure** | smc_engine, ai_pattern_analyzer, patterns, institutional_levels | pattern |

---

## 3. مصفوفة الأوزان (فرضيات أولية — قابلة للاختبار)

### Policy A: أوزان أساسية ثابتة (Baseline)

| العائلة | الوزن |
|---|---|
| Trend | 20% |
| Momentum | 15% |
| Mean Reversion | 10% |
| Volume/Liquidity | 15% |
| Risk | 20% |
| Fundamentals | 10% |
| News | 5% |
| Confluence | 5% |

### Policy B: أوزان حسب حالة السوق

| Market Regime | Trend | Momentum | Range | Breakout | Volume | Risk | Fundamentals | News | Confirm |
|---|---|---|---|---|---|---|---|---|---|
| R1 صاعد مستقر | 25% | 20% | 5% | 10% | 10% | 15% | 10% | 5% | — |
| R3 هابط مستقر | 20% | 10% | 5% | 5% | 10% | 35% | 5% | 5% | 5% |
| R4 هابط متسارع | 5% | 5% | 0% | 5% | 5% | 50% | 5% | 5% | 20% |
| R5 عرضي | 5% | 10% | 25% | 5% | 15% | 20% | 5% | 5% | 10% |
| R6 اختراق صاعد | 10% | 15% | 0% | 25% | 20% | 15% | 5% | 5% | 5% |
| R8 تذبذب مرتفع | 5% | 5% | 5% | 5% | 10% | 45% | 5% | 5% | 20% |
| R9 سيولة ضعيفة | NO_TRADE | — | — | — | — | — | — | — | — |

### Policy C: أوزان حسب حالة السهم (مضافة لحالة السوق)

| Stock Regime | إضافة Trend | إضافة Momentum | إضافة Range | إضافة Breakout | إضافة Volume | إضافة Risk |
|---|---|---|---|---|---|---|
| S1 صاعد قوي | +5% | +5% | -5% | 0% | 0% | -5% |
| S4 عرضي | -10% | -5% | +10% | 0% | 0% | +5% |
| S5 اختراق محتمل | 0% | +5% | -5% | +10% | +5% | -5% |
| S6 ارتداد من دعم | -5% | -5% | +5% | 0% | 0% | +5% |

### Policy D: الحزمة الكاملة (B + C + معالجة التعارض + ترتيب)

---

## 4. ترتيب التنفيذ

```
1. Data Validation → جودة البيانات (staleness, completeness, market='EGX')
   ↓ (إذا ناقصة → NO_TRADE)
2. Market Regime → حالة السوق (R1-R11)
   ↓
3. Stock Regime → حالة السهم (S1-S14)
   ↓
4. Regime Context → المصفوفة المشتركة + درجة الثقة
   ↓
5. Engine Selection → اختيار المحركات حسب السياق
   ↓
6. Execute Primary Engines → trend, momentum, fundamental, liquidity
   ↓
7. Execute Confirmation Engines → confluence, conviction (إذا احتاج)
   ↓
8. Conflict Resolution → التعامل مع التعارض
   ↓ (إذا تعارض حرج → NO_TRADE)
9. Signal Score → الدرجة المجمعة
   ↓
10. Risk Gate → Hard Loss, ATR, Split, Cooldown, Position Size
    ↓ (إذا رفض → NO_TRADE)
11. Decision Log → تسجيل كل شيء
    ↓
12. Final Output → signal, score, risk_profile, position_size
```

---

## 5. قواعد التعارض

| حالة التعارض | الحل |
|---|---|
| Trend says BUY, Momentum says SELL | خفض الثقة + NO_TRADE إذا التعارض كامل |
| 3+ محركات تتفق | ثقة عالية |
| محرك واحد يخالف (outlier) | تجاهل الـ outlier |
| محرك حرج يفشل | NO_TRADE (لا يُعوّض بصفر) |
| محرك اختيارى يفشل | استمرار بدونه + خفض الثقة |

---

## 6. قواعد الرفض الإلزامية (مستقلة عن الأوزان)

| القاعدة | الشرط | النتيجة |
|---|---|---|
| Hard Loss 7% | loss > 7% | NO_TRADE + cooldown |
| ATR clamp 5-9% | ATR/price خارج النطاق | تعديل stop + NO_TRADE إذا خارج |
| Split Guard 35% | loss > 35% | NO_TRADE + exit |
| Ticker Cooldown | إشارة سابقة < N أيام | NO_TRADE |
| R:R minimum | R:R < 1.0 | downgrade + NO_TRADE إذا < 0.5 |
| Position max 25% | size > 25% | clamp to 25% |
| Liquidity critical | turnover < threshold | NO_TRADE |
| Data stale | staleness > 3d | NO_TRADE |
| Data insufficient | < 50 sessions | NO_TRADE |

---

## 7. منع الإفراط في التحسين (Overfitting Prevention)

- **Walk-Forward:** ضبط الأوزان على نصف البيانات، اختبار على النصف الآخر
- **No look-ahead:** التصنيف يستخدم بيانات ≤ T فقط
- **Ablation:** فصل أثر كل تحسين (Policy A vs B vs C vs D)
- **Sensitivity:** اختبار حساسية النتائج للتكاليف والانزلاق
- **NO_TRADE as decision:** قياس هل الامتناع كان مفيد (تجنب صفقات سيئة) أم ضار (فوّت فرص)
