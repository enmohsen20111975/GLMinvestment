# 📋 تقرير Phase 0 + Phase 1 — V38 Orchestrator Design

**برافو (Backend Lead)** · **التاريخ:** 2026-10-24 · **الإصدار:** 1.0 · **الحالة:** مستني موافقة محسن قبل Phase 2

---

## 🎯 الفكرة في سطر

مش بنبني محرك جديد. بناخد 10 components موجودة في الكود ونضمّها في `orchestrator` واحد بـ Adapter Pattern. كل feature = دالة adapter صغيرة (10-30 سطر). نقيس كل feature لوحدها (ablation). اللي يضيف قيمة يفضل، واللي لأ يتشال ويتوثّق.

---

## 📊 PHASE 0 — Inventory (READ-ONLY)

### فحص البيانات على الساندبوكس

| DB | الحجم | آخر تاريخ | ملاحظة |
|---|---|---|---|
| `price_history.db` | 58 MB | **2026-06-10** | 762 ticker، 274K صف، بيانات 2025-01-09 → 2026-06-10 |
| `stocks.db` | 34 MB | — | 1039 سهم، 292 في القطاع المالي، فيه sectors |
| `predictions.db` | 281 MB | 2026-10-18 | 2256 توقع |
| `data_engine.db` | 54 MB | — | fundamentals (8 tab_* tables) + crypto |
| `intraday.db` | 77 MB | — | أسعار لحظية |

**توزيع 2026 شهرياً:** Jan 750 · Feb 750 · Mar 750 · Apr 750 · May 750 · **Jun 762** (ينتهي 10 يونيو)

**نتايج 2026 السابقة (Q1+Q2 = 309 إشارة V38):** PF=1.00 · WR=38.5% · Max DD=-47.1% · Sharpe=0.03 — **V38 خاسر فعلياً بعد العمولة**.

### 🔴 مشكلة Holdout

- **Q3 2026 (Jul-Oct) = 0 tickers** — البيانات تنتهي 2026-06-10.
- الـ Holdout اللي طلبته محسن **مش ممكن تقنياً** على الساندبوكس الحالي.
- **البديل المقترح:** Q2 2026 (Apr 1 → Jun 10) = holdout، Q1 2026 (Jan → Mar) = development set.
- **أو:** انتظار تحديث البيانات من السيرفر (فيه DB snapshot على GitHub Releases دلوقتي).

### جرد الـ 10 Features

| # | Feature | File | Standalone? | DB Dep | Verdict للـ Adapter |
|---|---|---|---|---|---|
| 1 | liquidity_filter | `analyzers/liquidity_filter.py` | YES (`evaluate_kill_filters`) | NO (DB-free variant) | WRAP DIRECTLY |
| 2 | strict_entry_filters | `analyzers/strict_entry_filters.py` | YES (`evaluate_strict_entry`) | NO | WRAP DIRECTLY |
| 3 | regime_filter | `analyzers/regime_filter.py` | YES (`passes_regime_filter`) | NO | WRAP DIRECTLY |
| 4 | risk (ATR/RR) | `analyzers/risk.py` | YES (`RiskManager.evaluate_trade`) | NO | WRAP (with bug workaround) |
| 5 | rr_gate | NO standalone file | YES (`compute_risk_reward`) | NO | WRAP `compute_risk_reward >= threshold` |
| 6 | sector_heat | `analyzers/sector_relative.py` | NO (`SectorRelativeAnalyzer.analyze`) | stocks.db | NEEDS DB LAYER |
| 7 | whale_guard | `jobs/predictor_modules/whale_guard.py` | YES (`compute_whale_flow`) | NO | WRAP DIRECTLY (prefer `compute_whale_flow`) |
| 8 | fundamentals | `analyzers/fundamental_engine.py` | NO (`FundamentalEngine.get_fundamental_breakdown`) | data_engine.db | NEEDS DB LAYER |
| 9 | news_impact | `analyzers/news_impact_scorer.py` + `egx_disclosure_engine.py` | YES (text path) / NO (DB path) | news.db (DB path) | WRAP text path; compose with disclosure |
| 10 | exit_logic | `portfolio/smart_exit_engine.py` | YES (`SmartExitEngine.decide_exit_action`) | NO | WRAP DIRECTLY |

### الـ Interface الموحّد للـ Adapter

```python
# input:  (ticker, date, price_data)  — price_data = {'closes', 'highs', 'lows', 'opens', 'volumes', 'sma50', 'rsi', 'atr', ...}
# output: {'accept': bool, 'score': float [0..1], 'reason': str, 'metadata': {}}
```

كل adapter بيرجع نفس الـ shape. الـ orchestrator هو اللي بيقرر إزاي يدمجهم.

### القواعد المحفوظة

- ✅ **Rule 25** (ممنوع تعديل ملفات موجودة): الـ adapters بـ read بس، مش بتعدل.
- ✅ **Rule 27** (NO-FAKE-DATA): كل feature موثّق بـ signature فعلي من الكود.
- ✅ **Rule 67** (CALCULATION-CANONICAL): استخدمنا `compute_risk_reward` لـ rr_gate.

---

## 📐 PHASE 1 — Design Proposal (NO CODE)

### 1. هيكل الـ Orchestrator

**اقتراح:** folder واحد `vps-service/orchestrator/` (مش ملف واحد عشان هيتكبير):

```
vps-service/orchestrator/
├── __init__.py          # public API
├── types.py             # FeatureResult dataclass, OrchestratorConfig
├── adapters.py          # 10 adapter functions (10-30 سطر كل واحد)
├── combiner.py          # الـ combination logic (hard gates + soft scores)
├── ablation.py          # runner الـ ablation experiments
└── report.py            # توليد التقارير (markdown/json)
```

**ليه folder مش ملف:** الـ ablation runner محتاج state + iteration logic منفصل عن الـ adapters. لو في ملف واحد، هيتعدى 500 سطر بسرعة.

**ملاحظة Rule 4:** "لا ملفات جديدة إلا للـ orchestrator (طوارئ)". الـ orchestrator مش طوارئ — ده تطوير جديد. **محتاج موافقة محسن صراحة على استثناء Rule 4 لإنشاء folder جديد.**

### 2. تصميم الـ Combination Logic

**اقتراح: Hybrid (Hard Gates + Soft Scores)**

```python
# HARD GATES (binary PASS/FAIL) — لازم كلهم PASS عشان الإشارة تتعمل
hard_gates = [
    'liquidity_filter',    # stock tradeable + volume ok
    'regime_filter',       # market not in bear veto
    'strict_entry',        # not late entry / not bad accumulation
    'news_stop_filter',    # no negative disclosure pending
]

# SOFT SCORES (0..1 continuous) — weighted sum → composite
soft_scores = [
    'fundamentals',   # weight = 0.20
    'sector_heat',    # weight = 0.20
    'whale_guard',    # weight = 0.20  (inverted: distribution = low score)
    'rr_gate',        # weight = 0.20
    'risk',           # weight = 0.20  (ATR-based vol quality)
]

# DECISION:
# if all hard_gates PASS AND composite_score >= 0.6 → BUY
# else → WAIT
```

**ليه Hybrid مش Weighted فقط أو AND فقط؟**
- **AND فقط** = صارم جداً، هيقلل الإشارات لـ < 50 (مش كافي إحصائياً).
- **Weighted فقط** = مفيش hard veto، ممكن يدي BUY في bear regime لو باقي الـ scores عالية.
- **Hybrid** = hard veto للـ critical filters (regime, liquidity, news) + soft score للـ quality filters.

### 3. ترتيب الـ Ablation

**قاعدة:** Feature واحد في كل تجربة فوق الـ baseline (V38 فقط). كل feature لوحده.

| Exp | Feature المضافة | ليه الأول؟ |
|---|---|---|
| Exp_1 | (baseline V38) | المرجع |
| Exp_2 | + regime_filter | أهم feature في bear market (V38 أصلاً ضعيف في bear) |
| Exp_3 | + liquidity_filter | يقلل الإشارات الوهمية على stocks صغيرة |
| Exp_4 | + whale_guard | يكشف institutional distribution قبل الـ crash |
| Exp_5 | + strict_entry | يمنع late entries (اللي غالباً بتخسر) |
| Exp_6 | + rr_gate | يضمن R:R >= 1.5 (مفيش صفقات risky) |
| Exp_7 | + news_stop_filter | يمنع الصفقات قبل الأخبار السلبية |
| Exp_8 | + fundamentals | يضيف جودة (P/E, ROE) |
| Exp_9 | + sector_heat | يضيف sector momentum |
| Exp_10 | + risk (ATR) | position sizing بـ ATR-based |
| Exp_11 | + exit_logic | **آخر حاجة** — مش هتأثر على إشارات الدخول، بس على الـ exits |

### 4. معايير القبول/الرفض (Pre-Registered)

**Feature يفضل (KEEP) if ANY:**
- PF >= baseline_PF + 0.10  (تحسن واضح)
- Max DD <= baseline_DD - 5.0%  (تقليل المخاطر)
- WR >= baseline_WR + 3.0%  (تحسن الدقة)

**Feature يتشال (REJECT) if:**
- Signals < 30% of baseline  (مقيد جداً — مش ينفع للـ production)
- PF < baseline_PF - 0.10  (تدهور واضح)

**Feature محايد (NEUTRAL) if:**
- لا تحسن ولا تدهور (ضمن ±0.05 PF و ±2% DD)

**القرار النهائي:** لو feature KEEP → يفضل في الـ orchestrator. لو REJECT → يتشال ويتوثّق في `ORCHESTRATOR-ABLATION-RESULTS.md`. لو NEUTRAL → يفضل بس بـ weight = 0.

### 5. Holdout Design

| Set | الفترة | الاستخدام |
|---|---|---|
| **Development** | Q1 2026 (Jan 1 → Mar 31) | تطوير + tuning الـ ablation |
| **Validation** | Q2 2026 (Apr 1 → Jun 10) | تحقق أولي (مرة واحدة) |
| **Holdout** | ❌ Q3 2026 (Jul-Oct) | **غير متاح** — البيانات تنتهي Jun 10 |

**البديل المقترح:** لو محسن عايز holdout حقيقي، محتاجين:
- (أ) تحديث `price_history.db` من السيرفر (فيه snapshot على GitHub Releases)، أو
- (ب) استخدام آخر 6 أسابيع من Q2 (May 1 → Jun 10) كـ mini-holdout، والباقي للتطوير.

**التوصية:** نمشي (ب) مؤقتاً، ونطلب من محسن تحديث البيانات لـ Q3 2026.

### 6. البيانات على الساندبوكس

- ✅ **كافية للتصميم** (Q1+Q2 2026 متاح، 750 ticker لكل شهر).
- ❌ **مش كافية لـ holdout كامل** (Q3 2026 ناقص).
- ✅ **DB snapshot متاح** على GitHub Releases (تم استرجاعه اليوم — 16 asset، 306MB).

### 7. ترتيب الـ 10 Features (مرتب بحسب الأولوية)

1. **regime_filter** — أهم واحد. V38 بيفشل في bear. ده هيقلل الخسائر الكبيرة.
2. **liquidity_filter** — يمنع الـ illiquid stocks (مش هتقدر تخرج).
3. **whale_guard** — يكشف distribution قبل الـ dump.
4. **strict_entry** — يمنع late entries (شراء على القمة).
5. **rr_gate** — يضمن R:R كافي (مفيش صفقات 1:1).
6. **news_stop_filter** — يمنع الصفقات قبل الأخبار السلبية.
7. **fundamentals** — يضيف جودة (P/E, ROE).
8. **sector_heat** — يضيف sector momentum.
9. **risk (ATR)** — position sizing.
10. **exit_logic** — آخر حاجة (مش entry feature).

---

## 🤔 طلب خاص — فكر معايا (5 نقاط صريحة)

### 1. هل الـ combination logic عنده مشكلة؟

**نعم، فيه خطر overfitting محتمل.** لو الـ weights الـ 5 soft scores اتعدّلت يدوياً على Q1 2026، ممكن تطلع نتايج كويسة على Q1 بس تفشل على Q2 (نفس مشكلة V38 الأصلية).

**البديل المقترح:**
- (أ) **Equal weights** (0.20 لكل soft score) — بسيط، مفيش tuning، مش هيـ overfit.
- (ب) **Median voting** بدل weighted sum — الـ median أكثر robust للـ outliers.
- (ج) **Report-only mode**: الـ soft scores بتظهر في الـ report بس (للتحليل)، والقرار بيعتمد على hard gates + threshold واحد بس على composite.

**توصيتي:** نمشي (أ) equal weights دلوقتي. لو الـ ablation أظهر إن في feature واضح أقوى من الباقي، نزنها 0.30 ونقلل التاني لـ 0.125 — بس ده قرار تاني بعد النتايج، مش قبلها.

### 2. في feature لازم تتشال؟

**نعم، 3 features محتاجة مراجعة:**

| Feature | المشكلة | التوصية |
|---|---|---|
| **exit_logic** | مش entry feature — بيأثر على الـ exits، مش الـ signals. لو خلطناه مع entry features في ablation واحد، النتايج هتبان مش واضحة. | **افصل** — نختبره لوحده في Exp_11 على الصفقات المفتوحة فقط. |
| **rr_gate** | مش feature مستقل — V38 أصلاً بيحسب R:R داخلياً ويـ reject لو < 1.5. لو ضفنا rr_gate، بنـ duplicate الـ logic. | **ادمج** في `risk` feature (ATR + RR معاً). النهائي: 9 features. |
| **news_stop_filter** | (أ) `check_news_stop_filter` **fails-open** (يرجع False على exception). (ب) `fetch_egx_disclosures()` بيعمل **LIVE HTTP** — مش هينفع في backtest. (ج) محتاج news.db ببيانات تاريخية. | **مؤجل** — لو معندناش news.db تاريخي، نستخدم disclosure_impact فقط (DB path)، ونشيل الـ text path. |

**النهائي المقترح:** 8 entry features + exit_logic في تجربة منفصلة.

### 3. ترتيب ablation مختلف؟

الترتيب المقترح فوق **كويس**، بس في تعديل واحد:

- **ابدأ بـ regime_filter + liquidity_filter معاً** (Exp_2) — لأن regime_filter لوحده ممكن يـ reject كل الإشارات في bear market (اللي هو حالتنا دلوقتي). لازم liquidity_filter يكون present عشان نحسب الـ PF على الـ signals اللي فاتت regime بس tradeable.

**أو:** ابدا بـ `liquidity_filter` لوحده (Exp_2)، بعدين `regime_filter` (Exp_3). ده أبسط ويتفق مع قاعدة "feature واحد في كل تجربة".

**التوصية النهائية:** امشي الترتيب الأصلي. لو regime_filter alone طلع 0 signals، نعرف إن المشكلة في V38 نفسه (مش في الـ filter)، وده معلومة مهمة.

### 4. البيانات كافية؟

- ✅ **للتصميم**: كافية (Q1+Q2 2026 متاح).
- ⚠️ **للـ ablation كامل**: مش كافية بدون holdout. الـ ablation هنعمله على Q1، والـ validation على Q2.
- ❌ **للـ production readiness**: محتاجين Q3 2026 (Jul-Oct) كـ final holdout قبل النشر.

**الحل الأسرع:**
- (أ) محسن ينزل الـ DB snapshot من GitHub Releases (اتعمل النهارده) — بس ده نفس البيانات اللي على الساندبوكس.
- (ب) محسن يعمل pull من السيرفر الإنتاجي (لو فيه بيانات أحدث من 2026-06-10).
- (ج) نمشي ablation على Q1+Q2، وننتظر تحديث Q3 قبل النشر.

**توصيتي:** (ج). مش نوقف شغل عشان بيانات ناقصة. نمشي الـ ablation دلوقتي على اللي عندنا.

### 5. خطر دستوري أو تقني؟

**نعم، خطر دستوري واحد:**

- **Rule 4** تقول: "لا ملفات جديدة إلا للـ orchestrator (طوارئ)".
- الـ orchestrator مش طوارئ — ده تطوير جديد كامل (5 ملفات في folder جديد).
- **محتاج موافقة محسن صراحة** على استثناء Rule 4 لإنشاء `vps-service/orchestrator/`.

**خطر تقني تاني:**
- الـ adapters بتستورد modules من `analyzers/` و `portfolio/` و `jobs/predictor_modules/`. ده هيخلي import graph معقد. لازم نتأكد إن مفيش circular imports (مثلاً `analyzers/liquidity_filter` بـ imports `engine_settings` بـ imports `db_manager` — لازم نـ trace ده قبل التنفيذ).
- `fundamental_engine` فيه **singleton** (`_engine_instance = None`) — لازم نعمل reset بين الـ experiments عشان ما يحصلش state leak.

**التوصية:** نطلب موافقة محسن على:
1. استثناء Rule 4 لإنشاء `vps-service/orchestrator/` folder (5 ملفات).
2. تأكيد إن الـ ablation يمشي على Q1+Q2 2026 (بدون Q3 holdout) مؤقتاً.
3. تأكيد إن الـ combination logic = Hybrid (hard gates + equal-weight soft scores).

---

## 📤 DECISION (مطلوب من محسن)

**برافو وقّف. مستني موافقة محسن على:**

### (أ) الموافقة على التصميم
- [ ] الموافقة على Hybrid combination (hard gates + equal-weight soft scores).
- [ ] الموافقة على ترتيب الـ ablation (regime_filter أولاً).
- [ ] الموافقة على معايير القبول/الرفض (PF+0.10 / DD-5% / WR+3%).
- [ ] الموافقة على تشيل `rr_gate` (دمجه في `risk`) و تأجيل `news_stop_filter` (لو مفيش news.db تاريخي).

### (ب) استثناء Rule 4
- [ ] الموافقة على إنشاء `vps-service/orchestrator/` folder (5 ملفات جديدة).

### (ج) البيانات والـ Holdout
- [ ] الموافقة على ablation على Q1 2026 (development) + Q2 2026 (validation) — بدون Q3 holdout مؤقتاً.
- [ ] هل عندك بيانات أحدث من 2026-06-10 على السيرفر الإنتاجي؟ (لو أيوه، نقدر نضيفها للـ ablation).

### (د) الـ DBs على GitHub Releases
- ✅ **تم** — 16 asset على `db-snapshot-2026-10-21` (306MB)، خارج التعريب، للتحميل اليدوي.
- 🔗 https://github.com/enmohsen20111975/GLMinvestment/releases/tag/db-snapshot-2026-10-21

---

**⏱️ لما توافق، Phase 2 (التنفيذ) هيبدأ. مفيش كود قبل موافقتك.**

*برافو — Backend Lead*
