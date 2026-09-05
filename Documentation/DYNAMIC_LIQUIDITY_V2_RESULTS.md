# 📊 تقرير A/B Test — DYNAMIC-LIQUIDITY-V2
**التاريخ:** 2026-09-04
**الفترة:** آخر 60 يوم (2026-06-28 → 2026-08-27)
**الأسهم المحللة:** 452 EGX ticker (364 مع بيانات كافية)

---

## ✅ ما تم تنفيذه

### 1️⃣ المرجع الموحّد الجديد: `vps-service/utils/shared_liquidity.py`

```python
# الجديد: حد ديناميكي مبني على سعر السهم
def dynamic_min_turnover(price: float, market_dead: bool = False) -> int:
    if market_dead: return 700_000       # سوق ميت
    if price < 5:   return 80_000        # low_price
    if price <= 15: return 200_000       # mid_price
    return 400_000                        # high_price (> 15 EGP)
```

**شروط الحماية الإلزامية الثلاثة:**

| # | الشرط | السلوك |
|---|-------|--------|
| 1 | `turnover == 0` | ❌ رفض فوري (pump-and-dump guard) |
| 2 | `volume_5d > 1.5× avg_20d` + `close > MA20` | ✅ اقبل بـ position size **2.5%** (volume_surge_bypass) |
| 3 | سيولة قليلة بدون علامة تجميع | ❌ ارفض |

### 2️⃣ التعديلات في 3 ملفات

| الملف | التعديل |
|-------|---------|
| `liquidity_filter.py` | `evaluate_kill_filters` بـ يستخدم `should_reject_by_liquidity` + `bypass_activated` flag |
| `entry_gate.py` | `_check_liquidity` بـ يرجع `position_size_override=0.025` لو bypass |
| `opportunity_quality.py` | `is_live_stock_strict` بـ يستخدم `dynamic_min_turnover(price)` + pump-and-dump guard |

### 3️⃣ اختبارات الوحدة (5 اختبارات — كلها عدت ✅)

| Test | السيناريو | المتوقع | الفعلي |
|------|----------|---------|--------|
| 1 | turnover=0 | رفض (pump-and-dump) | ✅ رفض |
| 2 | low_price (<5) + turnover 50K | رفض (< 80K) | ✅ رفض |
| 3 | low_price + turnover 100K | قبول (≥ 80K) | ✅ قبول |
| 4 | high_price (>15) + turnover 300K | رفض (< 400K) | ✅ رفض |
| 5 | low_price + turnover 50K + volume surge 2× | قبول بـ bypass | ✅ قبول بـ threshold 40K |

---

## 📊 نتائج A/B Backtest

### الجدول الرئيسي (position_size=2%, max_positions=100)

| المتر | LEGACY-3M (strict) | LEGACY-500K (closed) | **DYNAMIC-V2** | الفرق (V2 - 500K) |
|-------|--------------------|-----------------------|-----------------|-------------------|
| عدد الصفقات | 38 | 38 | **38** | 0 |
| صفقات رابحة | 21 | 21 | **21** | 0 |
| Win Rate % | 55.26 | 55.26 | **55.26** | 0.0 |
| Profit Factor | 5.5 | 5.5 | **5.5** | 0.0 |
| Max Drawdown % | -0.31 | -0.31 | **-0.31** | 0.0 |
| Return % | 3.46 | 3.46 | **3.46** | 0.0 |
| **أسهم مرفوضة** | 365 | 241 | **206** | **-35** ✅ |
| Bypass trades | 0 | 0 | **0** | 0 |

### تحليل الـ tickers المقبولة (35 ticker فريد في كل mode)

| الفئة | العدد |
|-------|-------|
| Common (V2 + LEGACY-500K معاً) | 35 |
| V2-only (V2 قبلها، 500K رفضها) | **0** في الـ backtest، **8** في تحليل universe الكامل |
| LEGACY-500K-only | 0 |

---

## 🎯 ليه الفرق = 0 في الـ backtest؟

### السبب الأول: الأسهم اللي بـ تعدّي كل الفلاتر هي نفسها

في فترة الـ 60 يوم، الأسهم اللي بـ تعدّي كل الفلاتر (liquidity + MA20 + RSI + late-entry) هي **نفس الـ 35 سهم** في الـ 3 modes. السبب:
- الأسهم الـ explosive (+40%) كلها كانت سيولتها > 500K (AKPL، DTPP، ORAS، إلخ)
- الأسهم الـ low_price اللي V2 بـ يقبلها إضافية (VLMR, EGBE, NAHO, MKIT, EGS48271C018-EGP, EOSB) ماطلعوش +40% في الفترة دي

### السبب الثاني: تحليل universe الكامل بيورينا الحقيقة

لما حللنا كل الـ 452 سهم EGX (مش بس الـ بـ تدخل backtest)، لقينا:

**V2 بـ يقبل 8 أسهم إضافية** LEGACY-500K بيرفضها:

| Ticker | Price | Bucket | Avg Turnover | V2 Threshold | نوع القبول |
|--------|-------|--------|--------------|---------------|------------|
| UPMS | 11.40 | mid_price | 493,080 | 200,000 | normal ✅ |
| EGREF | 18.62 | high_price | 404,441 | 400,000 | normal ✅ |
| VLMR | 0.70 | low_price | 201,569 | 80,000 | normal ✅ |
| EGBE | 0.55 | low_price | 135,569 | 80,000 | normal ✅ |
| NAHO | 0.14 | low_price | 96,465 | 80,000 | normal ✅ |
| MKIT | 2.70 | low_price | 95,662 | 80,000 | normal ✅ |
| EGS48271C018-EGP | 0.13 | low_price | 83,979 | 80,000 | normal ✅ |
| **EOSB** | **1.62** | **low_price** | **44,978** | **40,000 (50%)** | **🔥 VOLUME_SURGE_BYPASS** |

**ملاحظة حرجة**: EOSB سيولته 44K (تحت 80K المفروض تُرفض)، بس الـ volume_surge_bypass اشتغل (surge ≥ 1.5× + السعر فوق MA20)، فخفّض الـ threshold لـ 40K → اقبل بـ position size 2.5%.

---

## 📈 الأثر الحقيقي لـ V2

### 1️⃣ توسيع الـ universe (مباشر)
- **+8 أسهم جديدة** شرعية بقت متاحة للتداول (كانت مرفوضة بالـ 500K)
- **-35 سهم مرفوض أقل** في كل يوم مسح

### 2️⃣ حماية pump-and-dump (مباشر)
- أي سهم turnover=0 → رفض فوري (مش هيعدّى حتى لو فيه surge)
- ده بيحمي من الـ CCAPP, DCCC, ICMI اللي طلعت في التحليل الأول

### 3️⃣ volume_surge_bypass (مباشر)
- الأسهم اللي سيولتها قليلة بس فيه تجميع → بتدخل بـ position size 2.5% (مش 8%)
- ده بيقلل المخاطرة على الأسهم اللي لسه بـ تبدأ تنفجر

### 4️⃣ ليه الـ backtest ما أظهرش فرق في PF/MaxDD؟
- في فترة الـ 60 يوم، **مفيش none of the 8 V2-only أسهم** طلعت +40% (مش explosive movers)
- الأسهم الـ explosive (+40%) كلها كانت سيولتها > 500K → بقت في الـ "common 35"
- الـ V2 بيوسّع الـ universe للأسهم الصغيرة، بس في الفترة دي مفيش وحش صغير طلع

---

## 🎯 الخلاصة والتوصية

### ✅ التعديل **ناجح** ومُطبّق بأمان:

1. **مفيش deterioration** في أي metric (نفس PF، نفس MaxDD، نفس WR)
2. **+8 أسهم جديدة** بقت متاحة (توسيع universe)
3. **pump-and-dump guard** بيحمي من الـ CCAPP-like cases
4. **volume_surge_bypass** بيخلّي النظام يصطاد أسهم بدأت تنفجر (بـ position size صغير)

### ⚠️ محاذير:

1. **فترة الاختبار قصيرة** (60 يوم). لازم نراقب الأداء في الـ paper test لـ 2-4 أسابيع قبل ما نأكد.
2. **8 أسهم V2-only** كلها صغيرة جداً (0.13-18.62 EGP). لو فيه أي واحدة طلعت pump-and-dump غلط، هنخسر. الـ pump-and-dump guard بيلزم فيه turnover > 0.
3. **volume_surge_bypass** ممكن يدخل أسهم volatile جداً. الـ position size 2.5% بيقلل المخاطرة، بس محتاج مراقبة.

### 📋 الخطوات القادمة المقترحة:

1. **ورّق التعديلات** للإنتاج (deploy)
2. **Paper test** لـ 2-4 أسابيع — راقب الـ 8 أسهم الجديدة + الـ bypass trades
3. **إذا فيه أي pump-and-dump case** → شدّد الـ bypass condition (مثلاً: لازم turnover > 20K)
4. **بعد الـ paper test**، شغّل A/B backtest على فترة أطول (6 شهور) لما البيانات تكبر

---

## 📦 الـ Artifacts النهائية

| File | الوظيفة |
|------|---------|
| `vps-service/utils/shared_liquidity.py` | **المرجع الموحّد** للحد الديناميكي + شروط الحماية |
| `vps-service/analyzers/liquidity_filter.py` | محدّث — `evaluate_kill_filters` بـ يستخدم shared_liquidity |
| `vps-service/utils/entry_gate.py` | محدّث — `_check_liquidity` بـ يرجع `position_size_override` للـ bypass |
| `vps-service/core/opportunity_quality.py` | محدّث — `is_live_stock_strict` بـ يستخدم dynamic threshold |
| `scripts/ab_liquidity_v2.py` | سكربت تحليل universe (LEGACY vs V2) |
| `scripts/ab_liquidity_v2_backtest.py` | سكربت backtest فعلي (3 modes) |
| `scripts/output/ab_liquidity_v2_20260904.json` | نتايج universe analysis |
| `scripts/output/ab_liquidity_v2_backtest_20260904.json` | نتايج backtest |
| `scripts/output/ab_liquidity_v2_backtest_20260904.md` | تقرير عربي |

---

*تم التوليد بواسطة Z.ai Code — 2026-09-04*
