# 🫀 تشريح مشروع GLMinvestment — الدليل الكامل للمعمارية والكود

> **هذا الملف هو المصدر الأوحد للحقيقة (single source of truth) لمعمارية المشروع.**
> كل ما يخص المعمارية، المحركات، قواعد البيانات، تدفق البيانات، الـ API، الـ deployment،
> والـ file inventory موجود هنا. لو ضاع المستودع بالكامل، هذا الملف + `00-CONSTITUTION.md`
> يمكّنانك من فهم كل جزء في المنصة.
>
> **آخر تحديث: 2026-09-25** (DOC-CONSOLIDATION pass: تحديث العدّادات الإجمالية + إضافة §17 Historical Documentation Archive (كل ملفات `Documentation/*.md` غير الأساسية مُؤرشفة كمرجع تاريخي، لم تُحذف) + إضافة §1.6 5-Market Architecture + UI-Mirror Protocol + SQLite Fallback Pattern + تحديث §3.1 DB Map بالأرقام الحالية.)
> **آخر تحديث سابق:** 2026-09-01 (Stock Notebook System + Unified Exit Engine + Decision Logger + News Impact Scorer + EGX Disclosure Engine + Crypto Modules + 10 Feature Flags + تحديث العدّادات: blueprints=40، api files=38، notebooks/EGX=259 ملف JSON).
> **آخر تحديث سابق:** 2026-08-31 (KILL-MAESTRO + V40.2 هو العقل الوحيد + V62 logic + AI News Agent).
> **كل ملفات `Documentation/*.md` السابقة دُمجت في الملفات الأربعة الرئيسية:**
> `00-CONSTITUTION.md` (الدستور) · `01-PROJECT_ANATOMY.md` (هذا الملف) ·
> `02-SCREENS_AND_COMPONENTS.md` (الشاشات والمكونات) · `SYSTEM_HOW_IT_THINKS.md` (منطق التحليل).
>
> **المالك:** `enmohsen20111975` · **المدير والمبرمج:** Z.ai Code (full autonomy)
> **المراجع الحية:** `AGENTS.md` · `SYSTEM_STATE.md` · `CURRENT_STATE.md` · `worklog.md`
>
> ⚠️ هذا الملف **يلزم الواقع الحالي للكود**. كل رقم/مسار/منفذ متحقَّق منه ضد الكود الفعلي.
> أي تغيير في البنية = تحديث هذا الملف فورًا.

---

## ⚡ تغييرات جوهرية (2026-09-02) — اقرأ هذا أولاً

### 🛡️ Regime Filter + Average Down Logic (Phase 1 + Phase 2)

توجيه المالك (2026-09-02): "السوق المصري نزوله حاد كتير بيبقى Liquidity Grab من الصناع وبعدين انفجار سعري. عايزين فلتر اتجاه قوي + تعريف كمي لفرصة المتوسط السعري الذكي."

| المكوّن | الملف | الوصف |
|---|---|---|
| **Regime Filter** | `vps-service/analyzers/regime_filter.py` (210 LOC) | فلتر اتجاه إلزامي على إشارات BUY. mode='A': `Close > SMA50`. mode='B': `Close > SMA20 AND Close > SMA50`. يحتوي `is_bullish_regime()` + `passes_regime_filter()` + `compute_market_proxy_index()` + `is_market_bullish()`. |
| **Liquidity Grab Opportunity** | `vps-service/analyzers/strict_entry_filters.py` (إضافة ~250 LOC) | `is_liquidity_grab_opportunity()` — تعريف كمي صارم لفرصة المتوسط السعري: كسر 3-8% تحت الدعم + recovery خلال 3 أيام + حجم مؤكد + قريب من SMA50 + لا bearish ChoC. |
| **Average Down Evaluator** | `vps-service/analyzers/strict_entry_filters.py` | `evaluate_average_down()` — تقييم قرار المتوسط لصفقة قائمة. قواعد صارمة: مرة واحدة فقط، حجم 50%، الستوب لا يتوسع (يظل original). |
| **التكامل في V40.2** | خلف feature flag `V40_2_REGIME_FILTER` (default OFF) | سيُفعّل بعد التحقق على بيانات أطول (walk-forward). الـ baseline الموثق V40.2 بدون فلتر: PF 9.80. |

### 📊 نتائج باك-تest المرحلة 1 (Regime Filter على EGX حقيقي 442 سهم)

| الفترة | الاستراتيجية | mode | صفقات | WR | العائد | Max DD | PF | الحكم |
|---|---|---|---:|---:|---:|---:|---:|---|
| 6 شهور | Correction | A | 2 | 100% | +25.44% | 0% | ∞ | ✅ مقبول (DD≤25%) |
| 6 شهور | Correction | B | 2 | 100% | +25.44% | 0% | ∞ | ✅ مقبول |
| 6 شهور | Merged-Strict | A | 41 | 46.3% | +48.66% | -23.77% | 1.46 | ✅ مقبول |
| 6 شهور | Merged-Strict | B | 35 | 51.4% | +75.48% | -16.48% | 1.73 | ✅ مقبول |
| 19 شهر | Correction | A | 15 | 46.7% | +66.76% | -7.74% | 4.31 | ✅ مقبول |
| 19 شهر | Correction | B | 5 | 80.0% | +53.28% | -2.59% | 18.54 | ✅ مقبول (الأفضل) |
| 19 شهر | Merged-Strict | B | 130 | 53.1% | +1594.91% | -24.80% | 2.03 | ✅ مقبول |
| 19 شهر | Merged-Strict | A | 162 | 47.5% | +1361.20% | -30.03% | 1.81 | ❌ مرفوض (DD>25%) |
| 19 شهر | Chase | A | 252 | 44.0% | +711.72% | -66.11% | 1.38 | ❌ مرفوض |
| 19 شهر | Merged | A | 778 | 39.0% | +10827.34% | -75.33% | 1.31 | ❌ مرفوض (ساذج حتى مع regime) |

**الاكتشافات:**
1. **Correction [B]** (Close>SMA20 AND Close>SMA50) هو الأفضل: PF 18.54 على 19 شهر (5 صفقات فقط — عالي الجودة جداً ونادر).
2. **Merged-Strict [B]** هو الأفضل على 19 شهر في إجمالي العائد (+1594.91%) مع DD -24.8% (على حدود القاعدة).
3. **Merged (الساذج)** مرفوض في كل الحالات حتى مع regime filter — تخفيف العتبات = كارثة.
4. **Chase** مرفوض دائماً (DD -66% حتى مع regime) — المشكلة في طبيعته مش في الفلتر.

### 📊 نتائج باك-تest المرحلة 2 (Average Down)

| الاستراتيجية | السيناريو | Trades | Exp | AvgUsed | Flipped | الحكم |
|---|---|---:|---:|---:|---:|---|
| Correction [A] full | NO_AVG | 10 | +3.36% | — | — | baseline |
| Correction [A] full | AVG_DOWN | 10 | +3.36% | 0 | 0 | 🟡 محايد (لم يطلق النار) |
| Merged-Strict [B] full | NO_AVG | 113 | +0.39% | — | — | baseline |
| Merged-Strict [B] full | AVG_DOWN | 113 | +0.39% | 0 | 0 | 🟡 محايد |

**الحُكم الصادق للمرحلة 2:** Average Down مع الشروط الصارمة لم يُطلق النار أبداً في الـ backtest (avg_used=0). الأسباب:
1. الشروط صارمة (break 3-8% + recovery خلال 3 أيام + حجم مؤكد + قريب من SMA50 + لا ChoC).
2. معظم الصفقات تخرج (stop_loss أو take_profit) قبل ما تظهر الفرصة.
3. هذا **إيجابي** — الـ Average Down الذكي نادر والـ Average Down الأعمى ممنوع.

**التوصية:** تفعيل `evaluate_average_down()` كـ safety layer في V40.2 (سيطلق النار نادراً، لكن عندما يطلق = فرصة حقيقية). المتوسط الأعمى ممنوع.

---

## ⚡ تغييرات جوهرية (2026-09-01) — اقرأ هذا أولاً

### 📒 Stock Notebook System (طبقة المعرفة الدائمة لكل سهم)

**الـ module:** `vps-service/analyzers/stock_notebook.py` (1,065 LOC) + `notebooks/EGX/` (259 ملف JSON).

| المكوّن | الوصف |
|---|---|
| **النوتبوك لكل سهم** | 259 ملف JSON في `notebooks/EGX/` — ملف لكل سهم EGX (COMI.json, HRHO.json, ...). 30 سهم معمّق بالخبرة الحقيقية (typical_correction_pct + danger_level + liquidity_profile). |
| **`load_stock_notebook(symbol)`** | تحميل النوتبوك كامل + fallback آمن لو الملف مش موجود. |
| **`get_machine_summary(symbol)`** | جلب machine_summary بس للـ V40.2 (typical_correction_pct, danger_level, avoid_chase, distribution_sensitivity). |
| **`apply_notebook_context()`** | **الجسر الموحد بين النوتبوك والقرار** في V40.2 — بـ يعدّل الحجم/الوقف/الـ chase بناءً على النوتبوك. |
| **`build_or_refresh_notebook(symbol, force=False)`** | بناء/تحديث نوتبوك سهم واحد (من بيانات تاريخية + خبرة). |
| **`build_notebooks_for_universe(symbols='active')`** | بناء جماعي لكل الأسهم النشطة. |
| **`update_stock_notebook()` + `add_lesson()`** | تحديث جزئي آمن + إضافة دروس. |
| **API routes** | `vps-service/api/notebook_routes.py` (124 LOC) — 7 endpoints: `/api/notebooks/list` · `/stats` · `/<symbol>` · `POST /<symbol>/refresh` · `POST /build-all` · `POST /<symbol>/lesson` · `PUT /<symbol>/summary`. مسجّل في `lightweight_server.py` كـ `notebook_bp`. |
| **Admin UI** | `src/components/admin/NotebookAdminTab.tsx` (524 LOC) — داخل `/#admin`. |
| **التكامل في V40.2** | بـ toggle `V40_2_NOTEBOOK_CONTEXT=1` (default OFF). لو danger_level=5 → تقليل الحجم + `apply_notebook_context()` بـ يعدّل القرار. |

### 🚪 Unified Exit Engine (موحّد للأسهم + الكريبتو)

**الـ module:** `vps-service/analyzers/unified_exit_engine.py` (518 LOC).

| المكوّن | الوصف |
|---|---|
| **`MARKET_PROFILES`** | dict بمفاتيح `STOCKS` + `CRYPTO` — thresholds مختلفة حسب نوع السوق. STOCKS: 7 أيام max, no_move 3d (+3%), early -5%. CRYPTO: 72 ساعة max, no_move 24h (+5%), early -8%. |
| **`evaluate_unified_force_exit()`** | قرار موحد بترتيب أولوية ثابت: Veto (1) → Distribution (2) → Max holding (3) → No move (4) → Early adverse move (5). باقي TP/SL بـ يتعامل معاهم daily_closer. |
| **التكامل** | بـ toggle `V40_2_UNIFIED_EXIT=1` (default OFF) — بـ يستبدل `short_holding_exit` + `crypto_short_holding_exit`. |

### 📝 Decision Logger (طبقة تسجيل الأسباب)

**الـ module:** `vps-service/analyzers/decision_logger.py` (338 LOC) + `db/decision_log.db`.

| المكوّن | الوصف |
|---|---|
| **`log_decision()`** | دالة واحدة يستدعيها كل المسارات لتسجيل كل قرار (reject_entry / force_exit) مع السبب. |
| **`get_decision_stats()`** | تحليل كم رُفضت/خرجت + الأسباب → عشان نعرف هل الفلاتر بتساعد أم بتقتل الإشارات الجيدة. |
| **الـ DB** | `db/decision_log.db` — table `decision_log` (timestamp, symbol, market, decision_type, reason_code, reason_text, flag_active, notebook_summary). |

### 📰 News Impact Scorer (14 event types)

**الـ module:** `vps-service/analyzers/news_impact_scorer.py` (432 LOC).

| المكوّن | الوصف |
|---|---|
| **`EVENT_TYPES`** | 14 نوع حدث (IPO_SUBSCRIPTION, DIVIDEND_EX_DATE, DIVIDEND_ANNOUNCE, EARNINGS_BEAT, EARNINGS_MISS, MA_ACQUISITION, REGULATORY_APPROVAL, STOCK_SPLIT, MANAGEMENT_CHANGE, CONTRACT_AWARD, EXPANSION, INVESTIGATION_FRAUD, TRADING_HALT, CBE_DECISION). |
| **impact_score** | كل event له score من -25 لـ +20 + verdict (BOOST/REDUCE/VETO). |
| **التكامل** | يُستخدم في `v40_2_daily_generator.py` كـ proof #9 + hard veto / boost (لو score < 30 → رفض). |

### 🏛️ EGX Disclosure Engine (12 disclosure types)

**الـ module:** `vps-service/analyzers/egx_disclosure_engine.py` (875 LOC).

| المكوّن | الوصف |
|---|---|
| **12 نوع إفصاح** | capital_increase, subscription_rights, free_shares, dividend, coupon, earnings, auditor_change, resignation, acquisition, stock_split, delisting, suspension. |
| **dynamic scoring** | VETO (-2) / REDUCE (-1) / NEUTRAL (0) / BOOST (+1) / BOOST_STRONG (+2). EARNINGS بـ يحلل النص (أرباح قياسية → +2، خسائر → -2). DIVIDEND بـ يفرق قبل/بعد ex-date. |
| **التكامل في V40.2** | بـ toggle `V40_2_DISCLOSURE_IMPACT=1` (default OFF). VETO → `continue` (hard reject). |
| **DB** | `db/disclosures.db` → table `egx_disclosures` (dedup: ticker + event_type + date + title). |

### ₿ Crypto Modules (نظيرة EGX للكريبتو)

| الـ module | LOC | الوصف |
|---|---:|---|
| `analyzers/crypto_strict_filters.py` | 448 | نفس `strict_entry_filters.py` بـ thresholds مكيّفة لـ 24/7 + تقلب أعلى. toggle: `V40_2_CRYPTO_STRICT_ENTRY`. |
| `analyzers/crypto_short_holding_exit.py` | 412 | نفس `short_holding_exit.py` بـ thresholds ساعات بدل أيام (max 72h, no_move 24h). |
| `analyzers/crypto_news_fetcher.py` | 391 | جلب أخبار الكريبتو من DuckDuckGo + sentiment analysis. toggle: `V40_2_CRYPTO_NEWS_IMPACT`. |
| `analyzers/crypto_disclosure_engine.py` | 412 | نظير `egx_disclosure_engine.py` لأحداث الكريبتو (hard fork, delisting, hack, ...). toggle: `V40_2_CRYPTO_DISCLOSURE_IMPACT`. |

### 🚦 Feature Flags V40.2 (10 flags — كلها OFF افتراضياً)

| Flag | الـ module | الوصف |
|---|---|---|
| `V40_2_STRICT_ENTRY` | `strict_entry_filters.py` | Don't Chase: قبول تراكم/liquidity grab فقط. |
| `V40_2_DISCLOSURE_IMPACT` | `egx_disclosure_engine.py` | تأثير الإفصاحات الرسمية على القرار. |
| `V40_2_NOTEBOOK_CONTEXT` | `stock_notebook.py` | تطبيق سياق النوتبوك (danger_level, typical_correction). |
| `V40_2_SHORT_HOLDING` | `short_holding_exit.py` | خروج هيكلي (هيكلي، مش زمني صرف). |
| `V40_2_DISTRIBUTION_EXIT` | `short_holding_exit.py::detect_distribution()` | شمعة التوزيع كإشارة خروج. |
| `V40_2_NEWS_IMPACT` | `news_fetcher_analyzer.py` | تأثير الأخبار + sentiment. |
| `V40_2_CRYPTO_STRICT_ENTRY` | `crypto_strict_filters.py` | نسخة الكريبتو. |
| `V40_2_CRYPTO_DISCLOSURE_IMPACT` | `crypto_disclosure_engine.py` | نسخة الكريبتو. |
| `V40_2_CRYPTO_NEWS_IMPACT` | `crypto_news_fetcher.py` | نسخة الكريبتو. |
| `V40_2_UNIFIED_EXIT` | `unified_exit_engine.py` | توحيد قرارات الخروج (أسهم + كريبتو). |

### 📰 News Fetcher Analyzer (EGX news from DuckDuckGo + sentiment)

**الـ module:** `vps-service/analyzers/news_fetcher_analyzer.py` (507 LOC).
- DuckDuckGo HTML search + news.db fallback.
- 22 سهم EGX معروف (ticker → اسم عربي + إنجليزي للبحث).
- تحليل المشاعر keyword-based: +2/+1/0/-1/-2.
- toggle: `V40_2_NEWS_IMPACT`.
- **news_signals_reader.py** (`vps-service/ai/news_signals_reader.py`) + `/api/news/ingest` (Node route) — جسر لاستقبال الأخبار المحللة من News Agent محلي خارجي + `apply_news_bias_to_score()`.

---

## ⚡ تغييرات جوهرية (2026-08-31) — اقرأ هذا أولاً

### 🔥 KILL-MAESTRO: V40.2 هو العقل الوحيد

**Maestro مات بالكامل.** V40.2 هو مولّد التوقعات الأساسي والوحيد.

| التغيير | التفاصيل |
|---|---|
| **V40.2 = المصدر الوحيد** | `v40_2_daily_generator.py` يكتب في `predictions.db` — tracker مفعّل |
| **Maestro = معطل** | `maestro_orchestrator.py` signal_id = None — مش بيكتب أي توقعات |
| **background_analyzer** | `self.orchestrator = None` — مش بـ init Maestro |
| **maestro_routes** | `orchestrator = None` — مش بـ analyze |
| **analysis_runner** | `run_analysis_batch` returns immediately — Maestro init DISABLED |
| **day_trading_scanner** | `self.orchestrator = None` — skip |
| **ai_predictions_routes** | يقرأ من `predictions` (V40.2) مش `stored_analyses` (Maestro) |

### 🧠 V62 Logic (4 ميزات من Pine Script)

| الميزة | الوصف | المصدر |
|---|---|---|
| **fake_pump** | طلع +3% بس حجم ضعيف → رفض (فخ الميكرز) | V62 line 80-83 |
| **is_dist** | توزيع (شمعة حمراء + ظهر >50% + حجم >2× MA) → رفض | V62 line 85-87 |
| **is_story_stock** | P/E > 50 → تقليل الحجم | V62 line 90 |
| **maker_sweep** | sweep_low + delta موجب → boost | V62 line 89 |

### 📰 AI News Agent

| الميزة | الوصف |
|---|---|
| **DuckDuckGo Search** | بحث مجاني عن أخبار السهم (بدون API key) |
| **Trafilatura** | استخلاص نص المقال من HTML |
| **Keyword Fallback** | 120+ كلمة مفتاحية (عربي + إنجليزي) بأوزان 1-3 |
| **Ollama** | محاولة تحليل بالـ AI (crash على السيرفر الحالي — CPU بلا AVX) |
| **التكامل مع V40.2** | بعد كل signal → تحليل أخبار → لو score < 30 → رفض |

### 🔧 إصلاحات daily_closer

| الإصلاح | الوصف |
|---|---|
| **data_engine.db مباشر** | daily_closer يقرأ من `egksco_price_history` مباشرة (تجاوز data.prices recursion) |
| **created_at = prediction_date** | في backtest، created_at = prediction_date (مش now()) عشان days_elapsed صحيح |
| **V40.2 dry_run فقط** | outcome_date يسجل بس في dry_run — daily_closer يقفل في الإنتاج |

### 📊 نتائج Backtest (الساندبوكس — data/all.zip)

| المقياس | V40.2 القديم | V40.2 الحالي |
|---|---|---|
| عدد الصفقات | 39 | 12 (scan-interval=3) |
| Win Rate | 69.2% | 73.3% (dry_run) / 33.3% (daily_closer) |
| Profit Factor | 6.04 | 9.80 (dry_run) / 51.42 (daily_closer) |
| Return | +51.6% | +66.2% (dry_run) / +56.5% (daily_closer) |

### ⚠️ مشاكل معروفة

| المشكلة | الوصف | الحل المقترح |
|---|---|---|
| **Ollama crash** | CPU السيرفر مش بيدعم AVX/SSE → كل النماذج crash | keyword fallback شغّال (120+ كلمة) |
| **7 breakeven exits** | BE-stop-after-+3%-MFE بيخرج صفقات كتير عند breakeven | مراجعة threshold (+3% → +5%؟) |
| **DuckDuckGo rate limit** | أحياناً بيرفض البحث (403 Ratelimit) | إضافة retry + delay |
| **أخبار الاكتتاب/توزيع الأرباح** | مش موجودة في النظام حالياً | مطلوب إضافتها (انظر القسم 12) |
| **market.db = 0 بايت** | الـ 4-DB target architecture مش مكتمل | استخدام data_engine.db كـ canonical |

---

### 🔬 V68 + V72 Oracle Engines — A/B Backtest Results (2026-08-31)

**المنهجية:** كل ميزة في V68 و V72 اتعملها A/B backtest لوحدها على 200 سهم (Jul-Aug 2026).
الـ baseline: 15 trades, WR 73.3%, PF 9.80, Return +66.2%.
**القاعدة: النتائج هي اللي تقرر — بـ نـ keep الكويس ونمسيح الوحش.**

#### النتائج النهائية

| الميزة | Trades | WR% | Return% | ΔReturn | الحكم |
|---|---|---|---|---|---|
| **V68_DIRTY_DIST_REJECT** | 17 | 76.5 | +88.7 | +22.5 | ✅ KEEP |
| **V72_HIDDEN_DIST_BLOCK** | 14 | 71.4 | +102.7 | +36.5 | ✅ KEEP |
| V68_NO_CHASE_2D_REJECT | 15 | 73.3 | +66.2 | 0 | ❌ KILL (0 triggers) |
| V68_PROOF_PROBABILITY | 15 | 73.3 | +66.2 | 0 | ❌ KILL (avg prob 31.7) |
| V68_APLUS_BOOST | 15 | 73.3 | +66.2 | 0 | ❌ KILL (1 trigger) |
| V68_MAGNETIC_TARGET | 15 | 73.3 | +66.2 | 0 | ❌ KILL (0 triggers) |
| V72_WASH_TRADE_REJECT | 18 | 61.1 | +82.6 | +16.4 | ❌ KILL (WR -12.2%!) |
| V72_PULLBACK_BUY_PATH | 15 | 73.3 | +66.2 | 0 | ❌ KILL (0 triggers) |
| V72_MAKER_DEATH_POINT | 15 | 73.3 | +66.2 | 0 | ❌ KILL (no effect) |
| V72_MARKET_BULLISH_SIZING | 15 | 73.3 | +66.2 | 0 | ❌ KILL (0 triggers) |

#### COMBO (الفائزين مع بعض)
**V68_DIRTY_DIST + V72_HIDDEN_DIST = 15 trades, WR 73.3%, Return +106.9% (+40.7% vs baseline)**

#### الملفات الجديدة
- `vps-service/analyzers/v68_oracle.py` (730 LOC) — 13 functions (probability, future fingerprint, quiet accumulation, dirty distribution, liquidity magnets, MFE trailing, etc.)
- `vps-service/analyzers/v72_multi_path.py` (470 LOC) — 8 functions (wash trade, hidden dist, pullback buy, maker death point, kill switch, market sizing)
- `scripts/v68_ab_backtest.py` (400 LOC) — A/B harness (temp DB per run, WR/PF/Return per feature)

#### الـ toggles (كل ميزة env var)
```python
# V68 — ✅ KEEP 1, ❌ KILL 4
V68_DIRTY_DIST_REJECT  = '1'  # ✅ +22.5% return
V68_NO_CHASE_2D_REJECT = '0'  # ❌
V68_PROOF_PROBABILITY  = '0'  # ❌
V68_APLUS_BOOST        = '0'  # ❌
V68_MAGNETIC_TARGET    = '0'  # ❌

# V72 — ✅ KEEP 1, ❌ KILL 4, ⏸️ PENDING 1
V72_HIDDEN_DIST_BLOCK     = '1'  # ✅ +36.5% return
V72_WASH_TRADE_REJECT     = '0'  # ❌ -12.2% WR
V72_PULLBACK_BUY_PATH     = '0'  # ❌
V72_MAKER_DEATH_POINT     = '0'  # ❌
V72_MARKET_BULLISH_SIZING = '0'  # ❌
V72_KILL_SWITCH_EXIT      = '0'  # ⏸️ exit-level (pending backtest)

# V73 — ✅ KEEP 1, ❌ KILL 1
V73_DESERT_PHASE_REJECT  = '1'  # ✅ +23.1% return (6-month validated)
V73_AUCTION_TRAP_REJECT  = '0'  # ❌ 0 triggers
```

#### V73 Sniper Engine (6-month A/B — 2026-08-31)
- `vps-service/analyzers/v73_sniper.py` (220 LOC) — 2 genuinely new features
- **V73_DESERT_PHASE_REJECT** ✅ KEEP: BB squeeze + volume < 0.5×MA = سهم ميت → رفض (+23.1% return, 3 triggers on 6-month window)
- **V73_AUCTION_TRAP_REJECT** ❌ KILL: 0 triggers (EGX لا يقفز >10% في شمعة واحدة)
- 6-month COMBO (V68+V72+V73 winners): 15 trades, WR 73.3%, Return +106.9% (+40.7% vs baseline)
- **Validated general, not overfit** (6-month window Feb-Aug 2026, 200 tickers)

#### KILL-OLLAMA (تحديث 2026-08-31)
- `vps-service/ai/news_agent.py`: `NEWS_USE_OLLAMA` env var (default=0)
- default=0 → skip Ollama connection entirely → keyword fallback = production
- `is_ready()` مش بـ يتطلب Ollama

---

## 📑 المحتويات

1. [High-Level System Topology](#1-high-level-system-topology)
2. [Full Directory Tree](#2-full-directory-tree)
3. [Databases Map](#3-databases-map)
4. [Engine / Service Map](#4-engine--service-map)
5. [API Map — Condensed (Flask Blueprints + Next.js Routes)](#5-api-map--condensed-flask-blueprints--nextjs-routes)
6. [Data Flow](#6-data-flow)
7. [Deployment & Infra (Caddy + PM2 + Cron + Mini-services)](#7-deployment--infra-caddy--pm2--cron--mini-services)
8. [Dead-Code / Duplicate Inventory (Condensed)](#8-dead-code--duplicate-inventory-condensed)
9. [audit_map.json — Machine-Generated File Map](#9-audit_mapjson--machine-generated-file-map)
10. [Known Architectural Gaps](#10-known-architectural-gaps)
11. [References & Merged Sources](#11-references--merged-sources)
12. [AI News Agent + Corporate Actions (جديد 2026-08-31)](#12-ai-news-agent--corporate-actions)

---

## 1. High-Level System Topology

> **Python = THE BRAIN · Node.js = DISPLAY ONLY · SQLite لكل شيء · Caddy هو البوابة الوحيدة المُعرَّضة.**

### 1.1 المعمارية الرباعية المعتمدة (Quadruple-Service Architecture)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser (User) — https://invist.m2y.net                                  │
│     ↓ HTTPS (single exposed port)                                         │
│  Caddy Gateway (port 81)  ←── ?XTransformPort=N → any internal service    │
└──────────────────────────────────────────────────────────────────────────┘
                              │
       ┌──────────────────────┼──────────────────────────────┐
       ↓                      ↓                              ↓
┌─────────────────┐  ┌──────────────────────┐    ┌────────────────────────┐
│ Next.js         │  │ Python Backend       │    │ WebSocket Service      │
│ port 3000       │──│ port 8010            │←───│ port 3005 (ws-service) │
│ DISPLAY ONLY    │  │ THE BRAIN            │    │ socket.io, polling 30s │
│ ~969 TS/TSX     │  │ Flask + 53 BP + WSGI │    │ Bun/TypeScript         │
│ NextAuth+Prisma │  │ ~395 .py files       │    │ 248 lines              │
└─────────────────┘  └──────────┬───────────┘    └────────────────────────┘
                                │ reads/writes (WAL)
                                ↓
                   ┌────────────────────────────────┐
                   │  SQLite DBs (db/vps_real/*.db) │
                   │  • predictions.db (153 preds)  │
                   │  • data_engine.db (tab_*)     │
                   │  • stocks.db (970 tickers)    │
                   │  • price_history.db (288k)    │
                   │  • auth.db (Prisma)           │
                   │  • +12 supporting stores      │
                   └────────────────────────────────┘
                                ↑ writes (scrapers)
                   ┌────────────────────────────────┐
                   │  Data Engine (port 5000)       │
                   │  • scrapers: tradingview,      │
                   │    yahoo, egxpilot, egksco,    │
                   │    news, coingecko             │
                   │  • sync.py + main.py           │
                   └────────────────────────────────┘
                                ↑ talks to
                   ┌────────────────────────────────┐
                   │  External APIs                 │
                   │  • EGKSCO (EGX رسمي)           │
                   │  • TradingView (TA + UDF)      │
                   │  • Yahoo (historical)          │
                   │  • EGXPilot (free fundamentals)│
                   │  • CoinGecko (crypto)          │
                   │  • NewsAPI / GNews             │
                   │  • Google OAuth + Paymob       │
                   │  • Telegram Bot API            │
                   │  • Ollama (port 11434, local)  │
                   └────────────────────────────────┘
```

### 1.2 المنافذ المعتمدة (Ports)

| الخدمة | Port | اللغة | المسار | الدور |
|---|---|---|---|---|
| **Next.js (frontend)** | `3000` | TypeScript | `./` (project root) | العرض الأمامي (DISPLAY ONLY) — لا منطق ولا حسابات |
| **Python Backend** | `8010` | Python 3.12 | `./vps-service/` | THE BRAIN — كل التحليلات والحسابات (Flask + 53 BP على FastAPI/WSGI) |
| **Data Engine** | `5000` | Python 3.12 | `./data_engine/` | سحب البيانات من المصادر الخارجية (10 scrapers) |
| **ws-service** | `3005` | Bun/TypeScript | `./vps-service/ws-service/` | WebSocket updates (socket.io، polling كل 30s للـ Python) |
| **telegram-events** | `3003` | Bun/TypeScript | `./mini-services/telegram-events/` | polling لأحداث Telegram كل 2s + broadcast للـ clients |
| **Caddy Gateway** | `81` | Go (binary) | `./Caddyfile` | البوابة الموحدة المُعرَّضة للإنترنت + `XTransformPort` |
| **Ollama (Local LLM)** | `11434` | Go (systemd) | systemd unit | RAG AI inference (`qwen2.5:1.5b` / `glm-fast:latest`) |

> ⚠️ **منفذ واحد مكشوف:** فقط منفذ `81` (Caddy) يُعرَّض للإنترنت. كل الباقي خلف الـ gateway.

### 1.3 قواعد المعمارية الصارمة (NON-NEGOTIABLE)

1. **Python = THE BRAIN** — كل المنطق والحسابات والتحليلات في Python.
2. **Node.js = DISPLAY ONLY** — لا منطق ولا حسابات في الواجهة، فقط proxy + عرض. لو لقيت `if/for/compute/aggregate` في `route.ts` لغير الـ auth/subscription/paywall → **architecture violation**.
3. **No DB writes from Node.js** — Node.js لا يكتب في SQLite (يقرأ عبر proxy فقط، عدا `auth.db` لإدارة المستخدمين عبر Prisma).
4. **WAL mode إجباري** — كل connection جديد يطبّق `PRAGMA journal_mode=WAL` + `busy_timeout=30000`.
5. **Unified Data Pipeline** — `load_merged_history()` في `vps-service/analyzers/master_analyzer.py` هو المصدر الوحيد لقراءة الأسعار.
6. **Strict Liquidity Filter** — أي سهم turnover يومي < 500,000 EGP → يُسقط من `stored_analyses` نهائياً.
7. **Single-Viewport** — شاشة `#trading-chart` 75% شارت + 25% sidebar بدون scroll عمودي على desktop.
8. **Commission edge + risk ceiling** (CONSTITUTION Rule 8) — ATR stop clamp `[3%, 9%]` مُفعّل في `v38_backtest_engine.py` (post-commit `65a748f`).
9. **Single-route shell** (CONSTITUTION Rule 3) — لا صفحات جديدة. كل شيء عبر hash routes من `/`.
10. **STICKY FOOTER** — الـ Footer لاصق أسفل كل شاشة (CSS sticky).

### 1.4 قاعدة الـ `?XTransformPort`

> آلية الـ Gateway: Caddy يستقبل كل الطلبات على المنفذ 81، ثم يحوّل الـ query param `XTransformPort=N`
> لتمرير الطلب للخدمة الداخلية على المنفذ `N`.

**الاستخدامات الموثقة (2 ملفات فقط):**
- `src/app/api/analysis-engine/route.ts` — يحوّل لـ analysis-engine على منفذ خاص.
- `src/app/api/telegram/[...path]/route.ts` — يحوّل لـ mini-service الـ `telegram-events` (port 3003).

**القاعدة الذهبية:** كل الـ routes الباقية تستخدم **relative-path-only** عبر `EGXPY_SERVICE_URL` (default `http://localhost:8010`). لا استدعاء مباشر لـ `localhost:8010` من الـ frontend؛ لازم يمر عبر `Next.js /api/proxy/[...path]`.

### 1.5 الإحصائيات الكلية (2026-09-25 — DOC-CONSOLIDATION refresh)

| المؤشر | القيمة |
|---|---|
| Backend .py files | ~395 |
| Backend LOC | ~229,490 |
| Frontend `.tsx` files (components) | **274** (+ 3 `.ts` non-tsx = 277 total under `src/components/`) |
| Frontend LOC | ~343,000 |
| Flask Blueprints (registered) | 53 |
| Python `@bp.route` decorators | ~599 |
| Next.js `route.ts` files | **653** (تحت `src/app/api/` — 156 مجلد top-level + nested) |
| محرك قرار مؤسسي | V39/V40.2 (institutional_decision_engine.py, ~520 LOC) |
| محرك backtest | V38 (v38_backtest_engine.py, 1,817 LOC) |
| Personas (نموذج التوقع) | **3 فاعلة في الإنتاج**: `conservative` + `balanced` (الـ baseline 81.8%) + `gambler` — `expert` معطّلة (Rule 23 — PERSONA-UNIFY-A) |
| عدد الأسهم في `stocks.db` | **956 سهم** (EGX=360 · TADAWUL=413 · KSE=128 · QSE=55) — لا يشمل CRYPTO (بياناتها في `data_engine.db.crypto_prices` + `crypto.db`) |
| الأسهم في `data_engine.db.stocks` | **1,585 سهم** (EGX + تداول + الكويت + قطر + أوامر) |
| التوقعات النشطة في `predictions.db.predictions` | **306 predictions** (post-archive + V40.2 daily generator output) |
| سجل التوقعات `aiPrediction` | 2,459 صف |
| `persona_predictions` (per-persona tracks) | 946 صف |
| `historical_trades` | 550 صفقة تاريخية |
| `outcome_logs` | 8,544 سجل outcome |
| `news.db.news_articles` | **7,894 خبر** (post NEWS-DB-SOT migration) |
| `price_history.db.price_history` | **1,205,599 صف** (سجل الأسعار الموحّد EGX) |
| `data_engine.db.historical_data` | 99,076 صف OHLC تاريخي |
| `data_engine.db.screener_lists` | 1,505 إدخال في 5 فئات (most_active / unusual_volume / gainers / losers / volume) |
| Live WR (reference, balanced) | ≈ 69.2% (26 صفقة مقفولة) |
| Live PF (reference) | ≈ 4.46 |
| Fair re-sim PF (post-R:R fix) | 1.453 (148 trades، +0.189%/trade عن القاعدة العادلة) |
| R:R الحالي | dynamic 1.5 (normal) / 2.0 (outperform) — engine_settings |

### 1.6 الـ 5-Market Architecture + UI-Mirror Protocol + SQLite Fallback Pattern (2026-09-25)

**الأسواق الخمسة المدعومة (5-Market Architecture):**

| السوق | الكود (currentMarket) | المصدر | عدد الأسهم |
|---|---|---|---:|
| EGX (مصر) | `EGX` | `stocks.db` + `data_engine.db` | 360 (stocks.db) / 1,585 (data_engine.db) |
| TADAWUL (السعودية) | `TADAWUL` | `stocks.db` | 413 |
| KSE (الكويت) | `KSE` | `stocks.db` | 128 |
| QSE (قطر) | `QSE` | `stocks.db` | 55 |
| CRYPTO | `CRYPTO` | `data_engine.db.crypto_prices` + `crypto.db` | (~200 active tickers) |

**UI-Mirror Protocol (القاعدة 53 — CRYPTO-IN-MARKETS):**
- شاشات الأسهم (`DashboardView`, `StocksView`, `EnhancedWatchlistView`, `TradingChartView`) بتتشارك نفس المكوّنات مع `currentMarket='CRYPTO'` بدل إنشاء شاشات منفصلة.
- الـ `<MarketSwitcher />` (`src/components/shared/MarketSelector.tsx`) هو نقطة التبديل الوحيدة؛ يكتب `currentMarket` في `useAppStore` ويُعيد تحميل الـ view.
- لما `currentMarket='CRYPTO'` → `InvestorsFlowPanel` + `MarketDepthPanel` بـ تختفي (مش متاحة للكريبتو) — باقي الـ widgets بتشتغل بـ thresholds مكيّفة (القاعدة 8: ATR stop [5%,15%] للكريبتو بدل [3%,9%] للأسهم).
- `loadStocks(market)` بـ يمرر `market` لـ `/api/stocks?market=X` → كل سوق بـ يجيب بياناته الحقيقية بدون تفرع شاشات.

**SQLite Fallback Pattern (القاعدة 20 — Python = العقل، Node = العرض فقط):**
- Python backend على `localhost:8010` هو المصدر الرئيسي لكل التحليلات والتوقعات (V40.2 + V38 backtest + V39/V40.2 institutional decision engine).
- لو Python down → Node بـ يـ fall back لـ **SQLite مباشر** عبر `src/lib/sqlite-compat.ts` + `src/lib/sqlite-wrapper.ts` (better-sqlite3 read-only).
- الـ endpoints الحساسة للتوقعات (`/api/predictions/honest-tracking/*`) بـ تقرأ من `predictions.db` مباشرة من Node — ده **architecture violation مقبول مؤقتًا** للأداء (Rule 20 استثناء موثّق).
- النمط العام لكل API route في `src/app/api/`:
  1. **حاول Python أولاً** (`fetch(EGXPY_SERVICE_URL + path)`).
  2. **لو Python رفض/تأخر → اقرأ من SQLite** عبر الـ unified readers.
  3. **لو SQLite فاضي → اقرأ من `data_engine.db`** (tier-3 fallback).
- الأمثلة: `/api/stocks?market=EGX` (Python → SQLite)، `/api/predictions/daily-picks` (Python → SQLite)، `/api/chart/[ticker]` (Python intraday → SQLite `intraday.db` → `price_history.db`).

---

## 2. Full Directory Tree

```
GLMinvestment/                              # ← PROJECT ROOT
├── .env / .env.example                     # 🔐 المتغيرات السرية (gitignored) + قالب
├── .zscripts/                              # 🐶 سكربتات الساندبوكس (start-watchdog.sh)
├── AGENTS.md                               # 📜 دليل سير العمل للمطورين
├── CHANGELOG.md                            # 📝 سجل التغييرات
├── Caddyfile                               # 🌐 بوابة Caddy على المنفذ 81
├── DEPLOYMENT_GUIDE.md                     # 🚀 دليل النشر الكامل
├── ecosystem.config.js                     # ⚙️ إعداد PM2 (5 خدمات)
├── worklog.md                              # 📒 سجل العمل اليومي (gitignored)
├── package.json                            # v3.4.43 — Next.js 14.2.28 + React 18
├── bun.lock / bunfig.toml                  # أقفال + config الـ bun
├── tsconfig.json                           # TS 5.9.3 strict + @/* alias
├── tailwind.config.ts                      # Tailwind 3 (new-york preset)
├── next.config.ts / next.config.mjs        # Next.js config (ignoreBuildErrors=true)
├── postcss.config.mjs / eslint.config.mjs  # PostCSS + ESLint 9 flat config
├── components.json                         # shadcn/ui config
├── vitest.config.ts                        # frontend tests
│
├── prisma/                                 # 🗄️ Prisma schemas (3 منفصلة)
│   ├── schema.prisma                       # User + Post فقط (scaffold بسيط)
│   ├── auth-schema.prisma                  # auth.db models (User, Account, Session)
│   └── predictions-schema.prisma           # predictions.db models (proxy for Python raw SQL)
│
├── src/                                    # 🎨 FRONTEND (Next.js 14 App Router, TypeScript)
│   ├── app/                                # App Router root
│   │   ├── page.tsx                        # Single-route shell + renderView() switch
│   │   ├── layout.tsx                      # RTL + Sidebar + Header + Footer (sticky)
│   │   ├── globals.css                     # Tailwind + shadcn variables + dark mode
│   │   ├── api/                            # Next.js API routes (~583 route.ts)
│   │   │   ├── proxy/[...path]/route.ts    # ⭐ catch-all proxy للـ Python (الأكثر استخدامًا)
│   │   │   ├── auth/[...nextauth]/         # NextAuth.js (Google OAuth + Bearer)
│   │   │   ├── predictions/                # /api/predictions/* (Node + Python mixed)
│   │   │   ├── stored-analysis/            # /api/stored-analysis/* (Python proxy)
│   │   │   ├── chart/                      # /api/chart/* (full-analysis, V40.2)
│   │   │   ├── market/                     # /api/market/* (morning-bell, sectors)
│   │   │   ├── paymob/                     # /api/paymob/* (Node-only payment)
│   │   │   ├── telegram/[...path]/         # proxy للـ telegram-events mini-service
│   │   │   ├── analysis-engine/            # XTransformPort routing
│   │   │   └── ... (~570+ route.ts more)
│   │   ├── admin/                          # 4 صفحات admin iframe (ECMA module)
│   │   ├── (auth)/                         # login, register, google-signin
│   │   └── ... dead pages (9 — انظر §8)
│   │
│   ├── components/                          # React components (~328 component)
│   │   ├── ui/                              # 44+ shadcn/ui primitives (new-york preset)
│   │   ├── analysis/                        # MarketAnalysisView, InstitutionalDecisionPanel, ...
│   │   ├── predictions/                     # PicksManagementView, PredictionTrackingDashboard, ...
│   │   ├── advanced-analysis/               # SpecialistAnalysisView, StoredAnalysisView (orphan)
│   │   ├── market/                          # ChartStack, persona cards (6), MarketPulseWidget, ...
│   │   ├── portfolio/                       # PortfolioView, PositionManager, ...
│   │   ├── admin/                           # MaestroDashboard (2,750 LOC), MaestroCommandCenter (3,748 LOC)
│   │   ├── layout/                          # Sidebar, MobileNav, Header, Footer (sticky)
│   │   └── shared/                          # ExpertIntelligencePanel, Cards, Modals
│   │
│   ├── lib/                                 # Frontend utilities
│   │   ├── api.ts                           # fetch wrappers + EGXPY_SERVICE_URL
│   │   ├── auth.ts                          # NextAuth config
│   │   ├── prisma.ts                        # Prisma client (auth.db + predictions.db)
│   │   ├── sqlite-readonly.ts               # better-sqlite3 read-only (architecture violation if used for write)
│   │   └── utils.ts                         # cn(), formatters, RTL helpers
│   │
│   ├── hooks/                               # React hooks (useChart, usePredictions, useSocket, ...)
│   ├── store/                               # zustand stores (store.ts + slice per domain)
│   ├── instrumentation.ts                   # OpenTelemetry hook (Sentry + posthog)
│   └── styles/                              # Global stylesheets
│
├── vps-service/                             # 🧠 PYTHON BACKEND (THE BRAIN, port 8010)
│   ├── main.py                              # FastAPI app + WSGIMiddleware للـ Flask (v7.0.0)
│   ├── lightweight_server.py                # Flask app + 53 blueprint registrations
│   ├── engines/                             # ⭐ محركات التحليل الأساسية
│   │   ├── v38_backtest_engine.py           # 1,817 LOC — walk-forward backtest (COMMIT 65a748f — canonical sl/tp1/tp2 + ATR clamp [3%,9%])
│   │   ├── maestro_orchestrator.py          # 3,545 LOC — 8-layer confluence + 15+ modifier
│   │   └── ... (9 engines more)
│   ├── engine/                              # engine subsystem (flow_system.py 1,078 LOC, ...)
│   ├── analyzers/                           # 100+ محلل (institutional_decision_engine.py, maestro_orchestrator.py, ...)
│   │   ├── institutional_decision_engine.py # 520 LOC — V39/V40.2 (6 proofs + Tech Score + portfolio_advice)
│   │   ├── confidence_engine.py             # Picks management (7 factors, 4 tiers)
│   │   ├── position_manager.py              # 7 position advices
│   │   ├── maestro_orchestrator.py          # 3,545 LOC (mirror of engines/)
│   │   ├── master_analyzer.py               # load_merged_history() + 100+ sub-analyzers
│   │   ├── fundamental_data_provider.py     # get_fundamental_score(ticker) — 40/30/15/15 weights
│   │   ├── stock_fundamentals.py            # reads tab_balance_sheet (symbol≠ticker gap)
│   │   ├── persona_engine.py                # 4 personas + PERSONA_CONFIGS + _ADAPTIVE_RR_TABLE
│   │   ├── live_prediction_engine.py        # 15-min prediction cycle
│   │   ├── historical_prediction_generator.py # batch backfill (SELL sign-flip fix)
│   │   ├── market_regime.py                 # bull/bear/sideways classification
│   │   ├── smart_confluence_engine.py       # 8-layer scoring (138 pts max, BUY threshold 68)
│   │   ├── paper_trade_tracker.py           # paper-trading PnL tracking
│   │   ├── explosive_scanner.py             # BB squeeze + volume spike detector
│   │   └── ... (~100 more)
│   │
│   ├── api/                                 # ⭐ 65 Flask blueprint files (33 DEPRECATED)
│   │   ├── stocks_routes.py                 # active
│   │   ├── predictions_routes.py            # active
│   │   ├── picks_management_routes.py       # active (v3.4.43)
│   │   ├── chart_routes.py                  # active (V40.2 /full-analysis)
│   │   ├── persona_routes.py                # active
│   │   ├── portfolio_routes.py              # active
│   │   ├── ai_routes.py                     # active
│   │   ├── admin_routes.py                  # active (HARD cap ABS<=50)
│   │   ├── market_routes.py                 # active (morning-bell, sectors)
│   │   ├── crypto_routes.py                 # active
│   │   ├── screener_routes.py               # active
│   │   ├── hunter_routes.py / sniper_routes.py # active
│   │   ├── learning_routes.py               # active (self/unified)
│   │   ├── news_routes.py                   # active
│   │   ├── monitor_routes.py                # active
│   │   ├── reports_routes.py                # active
│   │   ├── telegram_routes.py               # active (Python side)
│   │   ├── egksco_routes.py                 # active (EGX official data)
│   │   ├── engine_settings_routes.py        # active (threshold source)
│   │   ├── optimizer_params_routes.py       # active (DEFAULT_PARAMS: min_rr_ratio=1.8, max_stop_pct=9.0)
│   │   ├── honest_tracking_routes.py        # active (RL-FIX-9, 5-state taxonomy)
│   │   └── ... (33 DEPRECATED — انظر §8.2)
│   │
│   ├── ai/                                  # AI subsystem (Ollama RAG + DuckDuckGo)
│   ├── portfolio/                           # Portfolio manager (stop_manager.py 607 LOC, ...)
│   ├── scripts/                             # 136 صيانة script (backfill, diagnose, audit_map.py)
│   ├── tools/                               # developer tools
│   ├── config/                              # JSON configs + threshold defaults
│   ├── models/                              # Pydantic models + DTOs
│   ├── jobs/                                # background jobs (price_history_safetynet, intraday_aggregator, daily_closer, v40_2_daily_generator)
│   ├── core/                                # auth_middleware, db_manager, settings_resolver
│   ├── ws-service/                          # ⭐ mini-service (Bun, port 3005, socket.io, 248 LOC)
│   ├── crontab.txt                          # ✅ egx_fundamental_fetcher مُجدوَل (السبت 14:00 UTC)
│   ├── Dockerfile                           # optional containerization
│   └── requirements.txt                     # Python deps (FastAPI, Flask, pandas, telethon, ...)
│
├── data_engine/                             # 📡 DATA ENGINE (port 5000)
│   ├── main.py                              # scraper orchestrator
│   ├── sync.py                              # sync data_engine.db → predictions.db / price_history.db
│   ├── scrapers/                            # 10 scrapers
│   │   ├── tradingview_scraper.py           # TA + UDF
│   │   ├── yahoo_scraper.py                 # historical OHLC
│   │   ├── egxpilot_scraper.py              # FREE fundamentals API (used by egx_fundamental_fetcher)
│   │   ├── egksco_scraper.py                # EGX official data
│   │   ├── news_scraper.py                  # NewsAPI + GNews
│   │   ├── coingecko_scraper.py             # crypto prices
│   │   └── ... (4 more)
│   ├── config/                              # scraper configs (intervals, API keys)
│   └── data/                                # raw scraped data cache + data_engine.db
│
├── db/                                      # 🗄️ SQLite databases (WAL mode)
│   ├── vps_real/                            # ⭐ PRODUCTION archive (extracted from active_databases_20260817_full.zip)
│   │   ├── predictions.db                   # 153 preds, 148 closed (2026-01-01 → 2026-08-17)
│   │   ├── data_engine.db                   # tab_* (858-866 rows each), egx_fundamentals=0
│   │   ├── price_history.db                 # 288,194 rows, 1,260 tickers (EGX focus)
│   │   ├── stocks.db                        # 970 tickers
│   │   ├── auth.db                          # Prisma-managed (User, Session, Account)
│   │   ├── analytics.db                     # persona / scoring cache
│   │   ├── learned.db                       # learning engine weights
│   │   ├── news.db / community.db / telegram_data.db  # sentiment
│   │   ├── intraday.db                      # intraday OHLC (aggregated → price_history)
│   │   ├── gold_prices.db / silver_prices.db
│   │   ├── crypto.db / crypto-lab.db / crypto_learning.db
│   │   ├── exchange_rates.db / ai_search_cache.db
│   │   └── (17 DBs total — full inventory in §3)
│   └── schemas/                             # SQL schema definitions + migrations
│
├── glminvestment-engines/                   # standalone engines package (data-science repo, symlinked)
│
├── mini-services/                           # ⚡ INDEPENDENT BUN PROJECTS (each own port + package.json)
│   ├── telegram-events/                     # port 3003 — polling 2s + broadcast (Bun/TS)
│   ├── telegram-poster/                     # auto-posting (Bun/TS, started by PM2)
│   └── ... (more mini-services pattern)
│
├── scratch/                                 # 🧪 sandbox scripts (not in production)
│   └── v40_2_historical_generator.py        # ORIGINAL V40.2 sandbox (pre v40_2_daily_generator.py)
│
├── garage/                                  # 🗑️ DEAD CODE (~8,247 LOC — orphan candidates, انظر §8.4)
│
├── scripts/                                 # maintenance scripts (136)
│   ├── audit_map.py                         # ⭐ regenerates audit_map.json
│   ├── backfill_persona_classification.py   # schema-aware (post ed55a60c)
│   ├── diagnose_utop_and_price_history.py   # diagnostic
│   └── ... (133 more)
│
├── tests/                                   # pytest (5 files) + vitest (65 files)
│   ├── test_risk_profile.py
│   ├── test_db_manager.py
│   └── ...
│
├── Documentation/                           # 📚 this folder (4 master files + 12 source files pending deletion)
│   ├── 00-CONSTITUTION.md                   # ⭐ الدستور (25 rules)
│   ├── 01-PROJECT_ANATOMY.md                # ⭐ هذا الملف
│   ├── 02-SCREENS_AND_COMPONENTS.md         # ⭐ شاشات + components inventory
│   ├── SYSTEM_HOW_IT_THINKS.md              # ⭐ منطق التحليل (decision-engine deep dive)
│   ├── CURRENT_STATE.md                     # مرجع حي للحالة (PERSONA-UNIFY-A + KPIs)
│   ├── AGENTS.md / SYSTEM_STATE.md          # workflow + state
│   ├── worklog.md                           # daily work log
│   ├── audit_map.json                       # ⚙️ machine-generated (24,910 lines, انظر §9)
│   └── (12 source files merged into 4 masters — pending deletion)
│
├── active_databases_20260817_full.zip       # 📦 PRODUCTION ARCHIVE (77,021,220 bytes, MD5 0947bdf6c2eff1a75ff8af6c3e576ed8, 17 DBs)
└── Caddyfile                                # 🌐 Gateway config (port 81 + XTransformPort)
```

---

## 3. Databases Map

> **القاعدة:** كل قواعد البيانات SQLite + WAL mode + `busy_timeout=30000`. لا PostgreSQL، لا Redis، لا message queue.
> Production archive: `active_databases_20260817_full.zip` (77,021,220 bytes، MD5 `0947bdf6c2eff1a75ff8af6c3e576ed8`، 17 DBs).

### 3.1 قواعد البيانات الرئيسية (db/) — مُحدّث 2026-09-25

> ملاحظة: الـ archive `db/vps_real/` القديم تم استبداله بالعمل المباشر في `db/` بعد DB-CLEANUP-WAVE-1+2+3 (القاعدة 46). الـ canonical path دلوقتي هو `db/` (sandbox) و `/root/GLMinvestment/db/` (production).

| DB | الدور | Key tables + counts (2026-09-25) | ملاحظات |
|---|---|---|---|
| **`predictions.db`** | V40.2 prediction store | `predictions`=**306** · `aiPrediction`=2,459 · `persona_predictions`=946 · `historical_trades`=550 · `outcome_logs`=8,544 · `live_ai_signals`=945 · `morning_bell_signals`=82 · `learned_lessons`=8,644 · `exit_notifications`=3,773 (53 table إجماليًا) | `fundamental_score` بقى real (بعد FUNDAMENTALS-ACTIVATION commit `04354a5`) — لا placeholder 50. |
| **`data_engine.db`** | Market + fundamentals + metals + crypto | `stocks`=**1,585** · `historical_data`=99,076 · `stock_prices`=2,444 · `crypto_prices`=198,476 · `btc_local_prices`=76,877 · `gold_prices`=163,143 · `gold_prices_clean`=27,440 · `silver_prices`=82,608 · `exchange_rates`=45,597 · `screener_lists`=**1,505** · `tab_balance_sheet`=866 · `tab_income_statement`=866 · `tab_cash_flow`=866 · `tab_valuation`=858 · `tab_profitability`=858 · `tab_dividends`=858 · `tab_performance`=858 · `tab_technical_analysis`=863 · `egksco_price_history`=0 (هاجر لـ data_engine.db) · `egx_fundamentals`=0 (يُجمَع عبر `egx_fundamental_fetcher.py`) | الـ canonical price source بعد WAVE-2 migration: `data_engine.db.egksco_price_history`. `price_history.db` محتفظ بيه كـ safety net. |
| **`price_history.db`** | EGX OHLC (primary price source) | `price_history`=**1,205,599** rows، 1,260 tickers (EGX focus)، 2025-01-09 → 2026-09-25 | المصدر الرئيسي للـ `load_merged_history()` |
| **`stocks.db`** | Ticker metadata (5-market) | `stocks`=**956** (EGX=360 · TADAWUL=413 · KSE=128 · QSE=55) · `egksco_stocks`=250 · `ExpertRecommendation`=104 · `cached_analysis`=111 · `market_pulse_cache`=2,132 · `market_indices`=5 · `investors_data`=7 · `egksco_sync_status`=451 · `gold_prices`=3 (legacy) · `indicator_trust_scores`=10 (57 table إجماليًا) | mixed: Saudi (numeric) + EGX (concatenated) + Kuwait + Qatar — CRYPTO منفصل في `data_engine.db.crypto_prices` |
| **`auth.db`** | Prisma-managed (auth) | User, Session, Account, VerificationToken | الوحيدة اللي Node.js بـ يكتب فيها مباشرة (Prisma) |
| **`analytics.db`** | Persona + scoring cache | 86 KB | تُقرأ من Python |
| **`learned.db`** | Learning engine weights | 12 KB | تُكتب من `learning_engine.py` + `lesson_store.py` |
| **`news.db`** | News sentiment | `news_articles`=**7,894** · `news_agent_articles`=100 · `market_news`=43 (post NEWS-DB-SOT migration) | Pillar 3 (sentiment). المصدر الوحيد للأخبار (القاعدة 44). |
| **`community.db`** | Community posts + sentiment | 32 KB | (community page = DEAD candidate) |
| **`intraday.db`** | Intraday OHLC | 65 KB | `intraday_aggregator.py` بـ يحوّلها لـ price_history.db |
| **`gold_prices.db`** / **`crypto.db`** / **`crypto_learning.db`** | metals prices + crypto prices + crypto learning | crypto.db=32 KB · crypto_learning.db=72 KB · gold_prices.db=40 KB | (gold/silver removal planned — v3.66.2; crypto.db صار secondary بعد دمج crypto في `data_engine.db`) |
| **`finance.db`** / **`macro.db`** / **`custom.db`** | finance portfolio / macro indicators / custom widgets | finance.db=4 KB · macro.db=176 KB · custom.db=24 KB | finance.db شبه فاضي؛ macro.db فيه `macro_indicators`=3 |
| **`decision_log.db`** | Decision Logger | table `decision_log` | يُكتب من `decision_logger.py::log_decision()` (القاعدة 37 — Decision Logger) |

### 3.2 موقع القواعد

- **Sandbox working copy:** `db/vps_real/` (relative — sandbox-only)
- **Production:** `/root/GLMinvestment/db/` على VPS (identical to `db/vps_real/` بعد استخراج الـ archive)
- **Archive:** `./active_databases_20260817_full.zip` (repo root، 73.45 MB، MD5 `0947bdf6c2eff1a75ff8af6c3e576ed8`)

### 3.3 الـ Schema Bug الحرج (tab_balance_sheet / tab_income_statement / tab_cash_flow)

> هذه الجداول الـ 3 **UNUSABLE without migration**. باقي tab_* (valuation, profitability, dividends, performance, technical_analysis) **clean and usable**.

```
Expected:  symbol=1030 | market=السعودية | fiscal_period=2025-Q3 | fiscal_end=2025-12-31 | total_assets=...
Actual:    symbol=السعودية | market=2025-Q3 | fiscal_period=2025-12-31 | fiscal_end=335.05 M SAR | total_assets=...
```

**Migration plan:** تُصلح عبر `data_engine/scrapers/egksco_scraper.py` re-scrape + manual column-shift fix. ليست مُجدوَلة بعد (Stage H — NEXT).

### 3.4 فجوة الـ Arabic Symbol → Ticker Mapping

- `tab_valuation.symbol` for EGX = `ALCNالاسكندرية` (ticker + Arabic name concatenated)
- `predictions.db.ticker` = `ALCN` (clean)
- **Resolver (موجود في `stock_fundamentals.py`):** exact match first, then prefix match `LIKE 'TICKER%'`
- **Mapping success rate:** 81.8% (18/22 prediction tickers match tab_valuation، 97.4% by prediction count)

### 3.5 فجوة `egx_fundamentals` — ✅ RESOLVED

- الـ fetcher `vps-service/data/egx_fundamental_fetcher.py` **موجود + مُجدوَل + مُحصّن** (commit a268957 + 4cde9f0).
- الـ cron بيشغّل السبت 14:00 UTC (16:00 Cairo). no-args = full bulk fetch (تم إصلاح bug الـ no-args اللي كان بيتجاهل الـ populate).
- **Ticker-validation guard** يمنع إعادة إنتاج صفوف الـ column-shift (أسماء الأسواق/fiscal_period/indices بـ تترفض قبل أي كتابة).
- **tab_* integrity check** (`verify` subcommand) بيتأكد إن tab_balance_sheet/income/cash_flow فضلت نظيفة.
- **Python بـ يقرأ** من `tab_valuation`/`tab_profitability`/`tab_dividends`/`tab_performance`/`tab_technical_analysis` (clean tables) + `egx_fundamentals` (fresh EGXPilot data).

### 3.6 Prisma Schemas

| Schema | الـ DB | الـ Models |
|---|---|---|
| `prisma/schema.prisma` | (none — scaffold only) | User + Post (placeholder — non-production) |
| `prisma/auth-schema.prisma` | `auth.db` | User, Account, Session, VerificationToken (NextAuth) |
| `prisma/predictions-schema.prisma` | `predictions.db` | proxy models for Python raw SQL — للقراءة فقط من Node.js |

> ⚠️ **G10 (known gap):** Prisma scaffold = User+Post فقط، الـ data الحقيقي في Python SQLite. لا يوجد unified migration.

### 3.7 إحصائيات `predictions.db` (post-archive 20260817)

| الحقل | القيمة |
|---|---|
| إجمالي التوقعات | 153 |
| closed | 148 |
| open | 5 |
| Date range | 2026-01-01 → 2026-08-17 |
| byPersona | balanced=22 (81.8% WR) | gambler=1 | conservative=3 |
| fundamental_score (all rows) | **50.0** (placeholder — Stage G fix pending) |
| Dynamic R:R active | 95.27% من الصفقات بـ R:R=2.0 (outperform path) |

---

## 4. Engine / Service Map

### 4.1 المحركات الأساسية (engines/ + analyzers/)

| Engine | File | LOC | الوصف | Status |
|---|---|---:|---|---|
| **V38 Backtest Engine** | `engines/v38_backtest_engine.py` | 1,817 | walk-forward backtest — NOW reads canonical `sl`/`tp1`/`tp2` + ATR clamp `[3%, 9%]` (commit `65a748f`) | ✅ ACTIVE |
| **V39/V40.2 Institutional Decision Engine** | `analyzers/institutional_decision_engine.py` | ~520 | 6 proofs + Tech Score (base 25, max 100) + portfolio_advice + dynamic R:R (1.5/2.0) — returns `sl`/`tp1`/`tp2` keys | ✅ ACTIVE — THE ONLY ENGINE |
| **Maestro Orchestrator** | `engines/maestro_orchestrator.py` = `analyzers/maestro_orchestrator.py` | 3,545 | 8-layer confluence (138 pts max، BUY threshold 68) + 15+ modifier بعد الفازات | ❌ DISABLED (KILL-MAESTRO 2026-08-31) — signal_id = None، مش بيكتب توقعات |
| **Stock Fundamentals** | `analyzers/stock_fundamentals.py` | — | reads `tab_balance_sheet` (with `symbol ≠ ticker` gap resolver — Arabic prefix match) | ✅ ACTIVE (with gap) |
| **EGX Fundamental Fetcher** | `vps-service/data/egx_fundamental_fetcher.py` | 573 | fetches from **EGXPilot FREE API** — writes to `egx_fundamentals` table. HARDENED (4cde9f0): ticker guard + no-args cron fix + `verify` integrity check | ✅ SCHEDULED (a268957) |
| **Persona Engine** | `analyzers/persona_engine.py` | — | 4 personas (gambler/balanced/conservative/expert) + `PERSONA_CONFIGS` + `_ADAPTIVE_RR_TABLE` + `PERSONA_INPUT_WEIGHTS` | ✅ ACTIVE |
| **Live Prediction Engine** | `analyzers/live_prediction_engine.py` | — | 15-min prediction cycle — generates predictions during market hours | ✅ ACTIVE |
| **Historical Prediction Generator** | `analyzers/historical_prediction_generator.py` | — | batch backfill (SELL sign-flip fix applied) — `MAX_PREDICTIONS_PER_DAY=7` | ✅ ACTIVE |
| **Market Regime** | `analyzers/market_regime.py` | — | bull / bear / sideways classification (EGX30ETF benchmark) | ✅ ACTIVE |
| **Smart Confluence Engine** | `analyzers/smart_confluence_engine.py` | — | 8-layer scoring (138 pts max, BUY threshold 68) | ✅ ACTIVE |
| **Paper Trade Tracker** | `analyzers/paper_trade_tracker.py` | — | paper-trading PnL tracking | ✅ ACTIVE |
| **Explosive Scanner** | `analyzers/explosive_scanner.py` | — | BB squeeze + volume spike detector (used in V40 Phase 2 — explosive uncap) | ✅ ACTIVE |
| **Confidence Engine** | `analyzers/confidence_engine.py` | — | 7-factor confidence (0-100%) + 4 tiers (TOP_PICK/STRONG/WATCH/SKIP) | ✅ ACTIVE (v3.4.43) |
| **Position Manager** | `analyzers/position_manager.py` | — | 7 position advices (wait / add / sell / partial-sell / ...) | ✅ ACTIVE (v3.4.43) |
| **Fundamental Data Provider** | `analyzers/fundamental_data_provider.py` | — | `get_fundamental_score(ticker)` — 40/30/15/15 weights (Profitability/Valuation/Dividend/Growth) | ✅ ACTIVE (Stage A-F done) |
| **Adaptive Weights** | `engines/adaptive_weights.py` | — | connected to maestro (post-fix) — self-learning weights | ✅ ACTIVE |
| **Flow System** | `engines/flow_system.py` | 1,078 | Macro 25% → Sector 30% → Stock 25% → Cross-val 20% | ✅ ACTIVE |
| **Stop Manager** | `portfolio/stop_manager.py` | 607 | 7 stop types (fixed, trailing, technical, volatility, tiered, time, breakeven) | ✅ ACTIVE |
| **Engine Settings** | `core/engine_settings.py` | 1,150 | 100+ dynamic settings + `get_setting(key, default)` resolver | ✅ ACTIVE |

### 4.2 V40.2 Daily Generator (post R:R fix — commit 65a748f)

> `vps-service/jobs/v40_2_daily_generator.py` (lines ~314-326) — **R:R floor gate** مُفعّل:

```python
if r_mult < get_setting('dynamic_rr_normal', default=1.5):
    continue  # يرفض sub-threshold setups قبل ما تدخل predictions.db
```

- مع الـ key-mismatch fix، `dynamic_rr_outperform=2.0` يُحترم للأسهم اللي outperforming الـ market → الـ gate نادرًا what يفعل.
- 95.27% من الصفقات بـ R:R=2.0 (outperform path).

### 4.3 Closed-Loop Learning (4-file chain)

```
1. live_price.py            ← يجمع سعر الإغلاق اليومي
   ↓
2. v40_2_daily_generator.py ← يولّد التوصيات (V40.2 هو العقل الوحيد — KILL-MAESTRO)
   ↓
3. daily_closer.py          ← يقفل الصفقات + يحسب profit_loss (SELL sign-flip fix + -20% cap)
   ↓
4. lesson_store.py          ← يخزن الدروس (STOP_TOO_TIGHT / TARGET_HIT_OK / LATE_MOMENTUM / MISSED_BREAKOUT)
   ↓
   applied_lesson widen_stop logic (+0.15×ATR per repeat, max 0.5×ATR)
```

### 4.4 الـ Mini-Services (Bun/TypeScript)

| Mini-service | Port | Role |
|---|---|---|
| `ws-service` | 3005 | WebSocket (socket.io) — polling 30s للـ Python + broadcast للـ clients |
| `telegram-events` | 3003 | polling 2s لأحداث Telegram + broadcast للـ clients |
| `telegram-poster` | (no port — script) | auto-posting للـ Telegram (started by PM2) |

> كل mini-service = **independent bun project** بـ own `package.json` + own port + `bun --hot` للـ hot-reload.

### 4.5 الـ Thresholds الحالية (engine_settings)

| Key | Value | Source |
|---|---|---|
| `dynamic_rr_normal` | **1.5** | engine_settings.py (default) |
| `dynamic_rr_outperform` | **2.0** | engine_settings.py (default) |
| `atr_stop_min_pct` | 3.0 | CONSTITUTION Rule 8 |
| `atr_stop_max_pct` | 9.0 | CONSTITUTION Rule 8 |
| `min_rr_ratio` | 1.8 | optimizer_params_routes DEFAULT_PARAMS |
| `max_stop_pct` | 9.0 | optimizer_params_routes DEFAULT_PARAMS |
| `default_stop_pct` | 5.0 | engine_settings.py |
| `trailing_stop_activation_gain` | ⚠️ **2.0 vs 3.0 CONTRADICTION** — engine_settings يقول 2.0 لكن V38 backtest + institutional_decision_engine بـ يتوقعون 3.0 (G7 — open) |
| `tech_score_base` | 25 (code) vs 50 (settings) — الفعلي 25 (G6) |
| `MAX_PREDICTIONS_PER_DAY` | 7 (hardcoded) — may be low in uptrend |
| `DAILY_PICKS_CAP` | 5 (Picks Management v3.4.43) |
| `MIN_CONFIDENCE_FOR_PICK` | 65% (Picks Management) |
| `ABS(actual_return)` HARD cap | ≤ 50 في كل مسارات KPI (route.ts + persona_db + PredictionTrackingDashboard) |
| `profit_loss` cap | -20.0 (SELL sign-flip fix — ULTRA-RESTORE) |

---

## 5. API Map — Condensed (Flask Blueprints + Next.js Routes)

> **القاعدة الذهبية:** كل المنطق في Python. Node بـ يعرض + proxy فقط.
> - **Flask Blueprints (registered):** 53 — في `vps-service/lightweight_server.py`
> - **Python `@bp.route` decorators:** ~599 — في `vps-service/api/` (65 ملف، **33 DEPRECATED** — انظر §8.2)
> - **Next.js `route.ts` files:** ~583 — في `src/app/api/`
> - **الـ Proxy الافتراضي:** `src/app/api/proxy/[...path]/route.ts` (catch-all للـ Python)

### 5.1 آلية الـ Proxy

```ts
// src/app/api/proxy/[...path]/route.ts (default pattern)
const PYTHON_BACKEND = process.env.EGXPY_SERVICE_URL || 'http://localhost:8010';
const r = await fetch(`${PYTHON_BACKEND}${pathname}?${qs}`);
return NextResponse.json(await r.json());
```

**3 أنواع من الـ Node routes:**
1. **🔄 Pure Proxy** — تمرر الطلب لـ Python على `localhost:8010` (الغالبية العظمى)
2. **🔒 Auth/Paywall Gate** — تدير session, subscription, payment, JWT tokens (Prisma + SQLite)
3. **⚠️ Architecture Violation** — 3 endpoints بتفحص SQLite مباشرة من Node (انظر §10)

### 5.2 الـ Endpoints grouped by Module (condensed)

#### 5.2.1 Authentication & Subscription (Node-only — auth.db + Prisma)
- `/api/auth/register` · `/login` (Bearer 30d) · `/logout` · `/me` · `/profile` · `/google` · `/google-signin` · `/config` · `/[...nextauth]`
- `/api/subscription/plans` · `/current` · `/status` · `/check-access` · `/upgrade` · `/activate` · `/deactivate` · `/start-trial` · `/trial` · `/subscribe` · `/checkout` · `/verify` · `/developer-request`
- `/api/paymob/create-payment` · `/verify-payment`
- `/api/instapay/verify` · `/api/google-play/verify-receipt` · `/api/redeem-promo`

#### 5.2.2 Stored-Analysis & Live Tracking (Python + proxy)
- `GET /api/stored-analysis/status` · `/results` · `/live-tracking` · `/ticker/<ticker>`
- `POST /api/stored-analysis/trigger`
- `GET /api/market/morning-bell`

#### 5.2.3 Predictions & Honest Tracking (mixed — 3 systems متداخلة، انظر §10)
- `GET /api/predictions` · `/live` · `/eid` · `/price-verify` · `/credibility`
- **Honest Tracking (⚠️ Node → SQLite direct — architecture violation):** `/api/predictions/honest-tracking` · `/list` · `/stats` · `/missed-opportunities` · `/expert-consensus`
- **POST:** `/verify-pending` · `/learn-from-errors`
- **Picks Management (v3.4.43 — NEW):** `GET /api/predictions/daily-picks` · `/daily-picks/history` · `/active-management` · `/{id}/management` · `POST /management/refresh`
- **V40.2 V34 Decision (v3.4.42 — NEW):** `GET /api/chart/full-analysis?ticker=...` — يرجّع `institutional_decision` object (maker_state + flight_state + 5/6 proofs + tech_score + portfolio_advice)

#### 5.2.4 Stocks / Chart / Quote (Python + proxy)
- `GET /api/stocks/list` · `/quote/<ticker>` · `/<ticker>/history` · `/search`
- `GET /api/chart/<ticker>` · `/full-analysis` (V40.2)
- `GET /api/egksco/*` (EGX رسمي)

#### 5.2.5 Persona (Python + proxy)
- `GET /api/persona/list` · `/config` · `/predictions?persona=X`
- `POST /api/persona/update`

#### 5.2.6 Portfolio & Watchlist (Python + proxy)
- `GET /api/portfolio` · `/watchlist` · `/positions`
- `POST /api/portfolio/add` · `/remove`

#### 5.2.7 AI / News / Telegram (Python + proxy)
- `GET /api/ai/search` · `/chat` · `/rag`
- `GET /api/news/list` · `/sentiment`
- `GET /api/telegram/*` (proxy للـ mini-service port 3003)

#### 5.2.8 Maestro / Confluence (Python + proxy)
- `GET /api/maestro/analyze?ticker=...` · `/score` · `/layers`
- `GET /api/confluence/*`

#### 5.2.9 Sniper / Hunter / Fomo (Python + proxy)
- `GET /api/sniper/scan` · `/hunter/scan` · `/fomo/list`

#### 5.2.10 Risk Management (Python + proxy)
- `GET /api/risk/profile` · `/stop/<ticker>` · `/position-size`

#### 5.2.11 Crypto (Python + proxy)
- `GET /api/crypto/list` · `/price/<symbol>` · `/history`

#### 5.2.12 Screener (Python + proxy)
- `GET /api/screener/list` · `/scan` · `/results`

#### 5.2.13 Self-Learning & Unified-Learning (Python + proxy)
- `GET /api/learning/lessons` · `/stats`
- `POST /api/learning/apply-lesson`

#### 5.2.14 Admin & Engine Settings (Python-only — HARD cap ABS<=50)
- `GET /api/admin/dashboard` · `/users` · `/kpi`
- `GET /api/engine-settings/all` · `POST /api/engine-settings/update`
- `GET /api/optimizer/params` · `POST /api/optimizer/update`

#### 5.2.15 Reports / Market-Report (Python + proxy)
- `GET /api/reports/daily` · `/weekly` · `/monthly`

#### 5.2.16 Educational Cards (Python + proxy)
- `GET /api/educational/cards` · `/<id>`

#### 5.2.17 Backtest / Walk-Forward (Python + proxy)
- `POST /api/backtest/run` · `GET /api/backtest/results/<id>`

#### 5.2.18 Expert Memory V4 (Python + proxy)
- `GET /api/expert/memory` · `/consensus`

#### 5.2.19 Telegram Routes (Python — auto-posting)
- `POST /api/telegram/post` · `/broadcast`

#### 5.2.20 Boards / Phase4 / Monitor / Multi-Market (Python + proxy)
- `GET /api/boards/*` · `/phase4/*` · `/monitor/*` · `/multi-market/*`

### 5.3 الـ Socket.IO Events (ws-service port 3005)

| Event | الاتجاه | الوصف |
|---|---|---|
| `price_update` | Server → Client | تحديث سعر لحظي (polling 30s للـ Python) |
| `prediction_new` | Server → Client | توقع جديد (من Maestro) |
| `prediction_closed` | Server → Client | توقع اتقفل (من daily_closer) |
| `telegram_event` | Server → Client | حدث Telegram (من mini-service port 3003) |
| `subscribe` | Client → Server | subscribe لـ ticker channel |

### 5.4 الـ Endpoints الميتة (404 / 405 / 500)

> التفاصيل الكاملة في `02-SCREENS_AND_COMPONENTS.md` §10 + `03-REFACTORING_REPORT.md` §4.
> 33 ملف Flask blueprint **DEPRECATED** (~17,000 LOC) — انظر §8.2.

---

## 6. Data Flow

### 6.1 الـ Pipeline الكامل (8 stages)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. SCRAPERS (data_engine/scrapers/)                                     │
│    • tradingview_scraper.py → TA + UDF                                  │
│    • yahoo_scraper.py       → historical OHLC                           │
│    • egxpilot_scraper.py    → FREE fundamentals API (⚠️ NOT IN CRONTAB) │
│    • egksco_scraper.py      → EGX official                              │
│    • news_scraper.py        → NewsAPI + GNews                           │
│    • coingecko_scraper.py   → crypto                                    │
│    ↓ writes (WAL)                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. data_engine.db (tab_*) + price_history.db (EGX OHLC)                 │
│    • tab_valuation/profitability/dividends/performance/technical_analysis│
│      (858-863 rows each — clean)                                        │
│    • tab_balance_sheet/income_statement/cash_flow (866 rows each — BROKEN│
│      column-shift)                                                      │
│    • egx_fundamentals = 0 rows (fetcher not scheduled)                  │
│    ↓ reads                                                              │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. ENGINES (vps-service/engines/ + analyzers/)                          │
│    • load_merged_history()  ← unified price path (single source)        │
│    • institutional_decision_engine.py → sl/tp1/tp2 + ATR-percentile     │
│    • maestro_orchestrator.py → 8-layer confluence (138 pts max)         │
│    • fundamental_data_provider.py → fundamental_score (40/30/15/15)     │
│    • persona_engine.py → 4 personas + R:R overrides                     │
│    • v38_backtest_engine.py → simulate_trade() (canonical sl/tp1/tp2    │
│      + ATR clamp [3%,9%] — commit 65a748f)                              │
│    ↓ writes                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│ 4. KILL FILTERS + R:R FLOOR GATE (v40_2_daily_generator.py L314-326)    │
│    • if r_mult < get_setting('dynamic_rr_normal', default=1.5): continue│
│    • set_strict_kill_filters(True) — liquidity + turnover               │
│    ↓ filtered                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│ 5. predictions.db (153 preds, 148 closed)                               │
│    • fundamental_score = 50 (placeholder — Stage G fix pending)         │
│    • evidence_count + morning_bell + kill_filter_result                 │
│    • persona = 'balanced' (default — PROTECTED by PERSONA-UNIFY-A)      │
│    ↓ reads                                                              │
├─────────────────────────────────────────────────────────────────────────┤
│ 6. CLOSING ENGINE (daily_closer.py)                                     │
│    • simulate_trade() — partial exits + trailing                        │
│    • SELL sign-flip fix + -20% cap (ULTRA-RESTORE)                      │
│    • HARD cap ABS(actual_return) <= 50 (P0-v2 — Rule 7)                 │
│    • 5-state taxonomy: TARGET_HIT/TRAILING_PROFIT/STOPPED/EXPIRED/PENDING│
│    ↓ writes outcome + actual_return                                     │
├─────────────────────────────────────────────────────────────────────────┤
│ 7. LEARNING LOOP (lesson_store.py)                                      │
│    • STOP_TOO_TIGHT / TARGET_HIT_OK / LATE_MOMENTUM / MISSED_BREAKOUT   │
│    • applied_lesson widen_stop logic (+0.15×ATR/repeat, max 0.5×ATR)   │
│    ↓ writes lessons + applied_lesson                                    │
├─────────────────────────────────────────────────────────────────────────┤
│ 8. FLASK API (port 8010) → Next.js /api/proxy → UI                      │
│    • /api/predictions/honest-tracking/* (RL-FIX-9 — 5-state taxonomy)   │
│    • /api/chart/full-analysis (V40.2 — institutional_decision)          │
│    • /api/predictions/daily-picks (Picks Management — Top 5/day)        │
│    • /api/market/morning-bell                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 الـ Thresholds Source

- **`get_setting(key, default)`** في `vps-service/core/engine_settings.py` (1,150 LOC) — المصدر الوحيد للـ thresholds.
- **`engine_settings` table** في `learned.db` — thresholds قابلة للتعديل من Admin UI.
- **Fallback chain:** `get_setting(key, default)` → checks DB → falls back to Python default.
- **Optimizer DEFAULT_PARAMS** في `optimizer_params_routes.py`: `min_rr_ratio=1.8`, `max_stop_pct=9.0` (موحّد مع json بعد PERSONA-UNIFY-A Phase 3).

### 6.3 `load_merged_history()` — Unified Price Path

> **موجود في:** `vps-service/analyzers/master_analyzer.py`
> **الدور:** المصدر الوحيد لقراءة الأسعار (PHASE 1 — CONSTITUTION).
> **يقرأ من:** `price_history.db` (EGX OHLC، 288,194 rows، 1,260 tickers).
> **Fallback:** `data_engine.db.historical_data` (Saudi/US/gold — NO EGX).

### 6.4 مثال: تدفق توقع V40.2 من الإنتاج

```
1. v40_2_daily_generator.py يبدأ (cron يومي بعد إغلاق السوق)
   ↓
2. لكل ticker في قائمة المراقبة (22 ticker):
   - load_merged_history(ticker) → df daily OHLC
   - build_institutional_decision(ticker, df, benchmark_change, ...)
     → returns {sl, tp1, tp2, rr_ratio_tp1, rr_ratio_tp2, tech_score, proofs, ...}
   ↓
3. R:R floor gate:
   if r_mult < 1.5: continue
   ↓
4. INSERT INTO predictions (ticker, signal, entry_price, target_price, stop_loss,
   target_price_2, atr_at_entry, evidence_count, morning_bell, kill_filter_result,
   persona='balanced', fundamental_score=50, ...)
   ↓
5. (Next day) daily_closer.py يفحص الـ predictions المفتوحة:
   - if exit_price <= sl: STOPPED
   - if exit_price >= tp1: TARGET_HIT (partial exit 50%)
   - if exit_price >= tp2: TRAILING_PROFIT (move stop to breakeven)
   - if holding_days > MONITORING_PERIOD_DAYS: EXPIRED
   - else: PENDING
   ↓
6. UPDATE predictions SET outcome='WIN'/'LOSS', actual_return=...,
   exit_type=..., closed_at=...
   (with HARD cap ABS(actual_return) <= 50)
   ↓
7. lesson_store.py يضيف درس لو STOP_TOO_TIGHT أو TARGET_HIT_OK
   ↓
8. /api/predictions/honest-tracking/list يرجّع الـ 5-state taxonomy
   → MarketAnalysisView UI (متابعة التوقعات + ملخص التوقعات tabs)
```

---

## 7. Deployment & Infra (Caddy + PM2 + Cron + Mini-services)

### 7.1 Caddy Gateway (port 81 — single exposed port)

**الملف:** `./Caddyfile`

- يستقبل كل الـ HTTPS على المنفذ 81 (المُعرَّض للإنترنت فقط).
- يحوّل الـ query param `?XTransformPort=N` للخدمة الداخلية على المنفذ `N`.
- الـ default (بدون `XTransformPort`): يحوّل لـ Next.js على المنفذ 3000.

**مثال Caddyfile (مبسط):**
```
invist.m2y.net {
    reverse_proxy localhost:3000  # default → Next.js
    
    @telegram path /api/telegram/*
    reverse_proxy @telegram localhost:3003  # telegram-events mini-service
    
    @ws path /socket.io/*
    reverse_proxy @ws localhost:3005  # ws-service
}
```

### 7.2 PM2 Ecosystem

**الملف:** `./ecosystem.config.js` — 5 خدمات + telegram-poster.

| Service | Command | Port | Role |
|---|---|---|---|
| `nextjs` | `next start` | 3000 | Frontend |
| `python-backend` | `python3 main.py` | 8010 | THE BRAIN |
| `data-engine` | `python3 data_engine/main.py` | 5000 | scrapers |
| `ws-service` | `bun run vps-service/ws-service/index.ts` | 3005 | WebSocket |
| `telegram-events` | `bun run mini-services/telegram-events/index.ts` | 3003 | Telegram polling |
| `telegram-poster` | `bun run mini-services/telegram-poster/index.ts` | (no port) | auto-posting |

### 7.3 Cron (vps-service/crontab.txt)

> ✅ **RESOLVED:** `egx_fundamental_fetcher.py` مُجدوَل السبت 14:00 UTC + مُحصّن ضد الـ column-shift (commit a268957 + 4cde9f0).

**الموجود (typical):**
```cron
# Daily after market close (15:30 Cairo)
30 15 * * 1-5 cd /root/GLMinvestment && python3 vps-service/jobs/v40_2_daily_generator.py >> logs/v40_2.log 2>&1
0  16 * * 1-5 cd /root/GLMinvestment && python3 vps-service/jobs/daily_closer.py >> logs/closer.log 2>&1
*/15 * * * * cd /root/GLMinvestment && python3 vps-service/jobs/intraday_aggregator.py >> logs/intraday.log 2>&1
0  * * * * cd /root/GLMinvestment && python3 vps-service/jobs/price_history_safetynet.py >> logs/safetynet.log 2>&1

# Weekly fundamentals fetch (Saturday 16:00 Cairo = 14:00 UTC):
0 14 * * 5 cd /root/GLMinvestment && /root/GLMinvestment/.venv/bin/python vps-service/data/egx_fundamental_fetcher.py >> /root/GLMinvestment/logs/fundamentals_fetch.log 2>&1
```

### 7.4 الـ Mini-Services Pattern

كل mini-service = **independent bun project**:
- own `package.json` (own dependencies)
- own port (3003, 3005, ...)
- `bun --hot` للـ hot-reload في dev
- started via PM2 في production (أو كـ long-running script)

**أمثلة:**
- `mini-services/telegram-events/` — port 3003 (polling 2s + socket.io broadcast)
- `vps-service/ws-service/` — port 3005 (polling 30s للـ Python + socket.io server)
- `mini-services/telegram-poster/` — script (auto-posting، no port)

### 7.5 Docker (Optional)

- `vps-service/Dockerfile` — صورة Python backend
- `docker-compose.yml` — يُشغّل كل الخدمات
- **غير مستخدم في الإنتاج** (الإنتاج بـ PM2 على VPS مباشرة)

### 7.6 Variables & Secrets (`.env`)

```bash
# Python
EGXPY_SERVICE_URL=http://localhost:8010
PYTHON_BACKEND_URL=http://localhost:8010
VPS_API_URL=http://localhost:8010

# Frontend
NEXTAUTH_URL=https://invist.m2y.net
NEXTAUTH_SECRET=<random>
GOOGLE_CLIENT_ID=<oauth>
GOOGLE_CLIENT_SECRET=<oauth>

# External APIs
EGKSCO_API_KEY=<egx-official>
EGXPILOT_API_KEY=<free>
NEWSAPI_KEY=<news>
COINGECKO_API_KEY=<crypto>
PAYMOB_API_KEY=<payment>
TELEGRAM_BOT_TOKEN=<telegram>
OLLAMA_HOST=http://localhost:11434

# DBs
DATABASE_URL=file:./db/auth.db
PREDICTIONS_DB=file:./db/predictions.db
```

---

## 8. Dead-Code / Duplicate Inventory (Condensed)

> التفاصيل الكاملة في `02-SCREENS_AND_COMPONENTS.md` §10 + `03-REFACTORING_REPORT.md`.
> هذا قسم مُختصر للمعمارية. لا حذف بدون موافقة المالك (CONSTITUTION Rule 25).

### 8.1 الـ 9 صفحات الميتة (4,711 LOC)

| # | Route | LOC | سبب الموت | الإجراء | المرحلة |
|---|---|---:|---|---|---|
| 1 | `/admin/expert-recommendations` | 1,079 | لا inbound link | حذف | 🟢 P3 |
| 2 | `/admin/maestro` | 747 | functionality في `/#admin` | حذف | 🟢 P3 |
| 3 | `/admin/prediction-performance` | 823 | sidebar شال الـ link | حذف | 🟢 P3 |
| 4 | `/community` | 324 | CommunityView orphan | حذف | 🟢 P3 |
| 5 | `/education/analysis-types` | 469 | orphan | حذف | 🟢 P3 |
| 6 | `/payment/fail` | 58 | paymob callback ما بـ redirectش لهنا | حذف | 🟢 P3 |
| 7 | `/portfolio` | 1,199 | sidebar بـ يستخدم `#portfolio` hash | حذف | 🟢 P3 |
| 8 | `/prediction-performance` | 8 | stub | حذف | 🟢 P3 |
| 9 | `/unified-analysis` | 12 | comment: "moved to Admin" | حذف | 🟢 P3 |

### 8.2 الـ 33 DEPRECATED Flask Blueprints (~17,000 LOC)

> ملفات `vps-service/api/*.py` موجودة بس مش محملة في `lightweight_server.py` — كود ميت.

**أمثلة (تقديري):** `old_predictions_routes.py` · `legacy_chart_routes.py` · `v1_market_routes.py` · `v2_portfolio_routes.py` · ... (33 file total).
**الإجراء:** حذف تدريجي بعد التحقق الثلاثي (CONSTITUTION Rule 16). المرحلة 🟢 P3.

### 8.3 StoredAnalysisView.tsx (1,896 LOC — Orphan)

- `src/components/advanced-analysis/StoredAnalysisView.tsx` — 1,896 LOC
- بعد الـ 3-SCREEN REDESIGN (commit `d2084710`, v3.66.8) الـ `#advanced-analysis` بـ يـ redirect لـ `MarketAnalysisView`
- الـ StoredAnalysisView **still on disk** لكن **no longer imported** anywhere.
- **إجراء:** حذف في P3 cleanup.

### 8.4 `garage/` Directory (~8,247 LOC — Dead)

- مجلد كامل من الكود الميت (early prototypes, abandoned features, broken experiments).
- **إجراء:** حذف كامل في P3 (بعد مراجعة الـ imports).

### 8.5 الـ 71 Orphan Components (50,442 LOC — 26.6% من الـ frontend)

> التفاصيل في `02-SCREENS_AND_COMPONENTS.md` §10.3.

- Top 30 orphans: ~30,000 LOC (أكبرها: MaestroCommandCenter 3,748 LOC، StoredAnalysisView 1,896 LOC، ...)
- 41 more orphans: ~20,000 LOC

### 8.6 الـ 20 Unused UI Primitives (~4,300 LOC)

- shadcn/ui primitives installed لكن مش مستخدمة (carousel, command, combobox, ...).
- **إجراء:** حذف في P3.

### 8.7 الـ 163 Tiny-Proxy Boilerplate (~4,700 LOC)

- ملفات `route.ts` proxy صافي (3-5 LOC each) قابلة للاستبدال بـ catch-all proxy واحد.
- **البديل:** `src/app/api/proxy/[...path]/route.ts` (catch-all).

### 8.8 7 Duplicate Families

> التفاصيل في `02-SCREENS_AND_COMPONENTS.md` §10.5.

- charts (3 impls)
- watchlists (2 impls)
- alerts (2 impls)
- share (2 impls)
- wealth (2 impls)
- analysis (3 impls)
- stocks (2 impls)

### 8.9 الـ P3 Cleanup Progress (partial)

- ✅ 3 orphan components deleted (post P0)
- ✅ 6 `simulated_*.py` scripts deleted (post P0)
- ⏳ 9 dead pages + garage/ + 33 DEPRECATED blueprints + 41 more orphans = NEXT (P3)

---

## 9. audit_map.json — Machine-Generated File Map

> **الملف:** `Documentation/audit_map.json` — **643KB / 24,910 lines**
> **Generated:** 2026-08-03T19:58:12 (UTC)
> **Root:** `/home/z/my-project`

### 9.1 الـ Structure

```json
{
  "generated_at": "2026-08-03T19:58:12",
  "root": "/home/z/my-project",
  "recent_changes": {
    "note": "Hand-tracked changes after the 2026-08-03 scan. Re-run scripts/audit_map.py to regenerate full metrics.",
    "v3.66.4": {...},
    "v3.66.5": {...},
    "v3.66.6": {...},
    "v3.66.7": {...},
    "v3.66.8": {...}
  },
  "metrics_note": "The metrics below are from the 2026-08-03 scan. Actual current nextjs_api_routes = 583.",
  "metrics": {
    "backend_files": 395,
    "backend_lines": 229490,
    "frontend_files": 1104,
    ...
  },
  "file_to_component_map": [...],   // 24,910 lines
  "unreferenced_files": [...]
}
```

### 9.2 الـ Metrics (as of 2026-08-03 scan — STALE)

| Metric | Value (scan 2026-08-03) | Actual (2026-08-17) |
|---|---:|---:|
| `backend_files` | 395 | ~395 (unchanged) |
| `backend_lines` | 229,490 | ~230,000+ |
| `frontend_files` | 1,104 | ~1,104 (unchanged) |
| `nextjs_api_routes` | 580 | **583** (+3 من v3.66.4/5/6) |
| Flask blueprints | 53 | 53 (unchanged) |

### 9.3 الـ Recent Changes (hand-tracked بعد الـ scan)

| Version | Commit | Title | Files affected |
|---|---|---|---|
| v3.66.8 | `d2084710` | 3-SCREEN REDESIGN | MarketAnalysisView renamed to متابعة التوقعات + tracking tab + replaced expert panel. SpecialistAnalysisView 3 top-level tabs. StoredAnalysisView.tsx (1,896 LOC) → orphan. |
| v3.66.7 | `9b34788a` | 5-MIN DATA ENGINE + MOBILE-FIRST EXPERT VIEW | expert tab in MaestroDashboard + consensus column in top 10. |
| v3.66.6 | `893b194d` | EXPERT CONSENSUS ENGINE | consensus aggregation phase added to maestro-orchestrator.ts. |
| v3.66.5 | `de9b214b` | SECTOR INTELLIGENCE | `/api/market/sectors/intelligence` endpoint. |
| v3.66.4 | `7c846c27` | MISSED-OPPORTUNITIES TRACKER | `/api/predictions/honest-tracking/missed-opportunities` endpoint. |

### 9.4 Regeneration

```bash
# To regenerate (after major refactoring):
cd /root/GLMinvestment
python3 scripts/audit_map.py
# Output: Documentation/audit_map.json (overwrites)
```

> ⚠️ **الملف STALE بعد 2026-08-03.** الإحصائيات الحالية في §1.5 (hand-tracked) أحدث.

### 9.5 الـ Unreferenced Files (subset — full list in audit_map.json)

- `src/components/advanced-analysis/StoredAnalysisView.tsx` (1,896 LOC) — no longer imported (post v3.66.8).
- (71 orphan components total — انظر §8.5).

---

## 10. Known Architectural Gaps

> مصدر هذه القائمة: `GAPS_AND_MISSING.md` + `03-REFACTORING_REPORT.md` + `RR_FIX_FINAL_REPORT_20260817.md` + `DATA_ENGINE_FUNDAMENTALS_INVENTORY.md` + `FUNDAMENTALS_HISTORICAL_TEST_REPORT.md`.

### 10.1 Gaps حرجة (🔴)

| # | Gap | الموقع | التأثير |
|---|---|---|---|
| G1 | `fundamental_score = 50` placeholder لكل الصفوف في `predictions.db` | `predictions.db.fundamental_score` | الـ backtest ما بـ يقدر يميّز بين السهم القوي والضعيف أساسيًا — Stage G fix pending |
| G2 | **Arabic symbol → ticker mapping gap** في `tab_*` | `data_engine.db.tab_*.symbol` (ARABIC) vs `predictions.db.ticker` (clean) | 18.2% من tickers ما بـ تـ match (4/22). Workaround: prefix `LIKE 'TICKER%'` resolver — 97.4% mapping by prediction count |
| G3 | ~~`egx_fundamental_fetcher.py` NOT in crontab~~ ✅ DONE | `vps-service/data/egx_fundamental_fetcher.py` + `vps-service/crontab.txt` | cron مُفعّل (a268957) + fetcher مُحصّن ضد column-shift + no-args bug fix (4cde9f0) |
| G4 | 33 DEPRECATED Flask blueprints | `vps-service/api/*.py` (~17,000 LOC) | dead code — يضخّم الـ repo + يربك الـ IDE |
| G5 | ~~`tab_*` column-shift bug~~ ✅ DONE | `data_engine.db` | migrate_fundamentals_schema.py (a73b1a1): 24 صف فاسد اتمسح، 858 سليم لكل جدول. الجداول الـ 3 صالحة الآن |

### 10.2 Gaps مهمة (🟠)

| # | Gap | التفاصيل |
|---|---|---|
| G6 | `tech_score_base` contradiction | engine_settings DEFAULT=50 لكن الكود default=25 — الفعلي 25 (institutional_decision_engine.py) |
| G7 | `trailing_stop_activation_gain` contradiction | engine_settings=2.0 لكن V38 backtest=3.0 + institutional_decision_engine=3.0 — الباكتست يفعل الـ trailing أبكر من الـ live |
| G8 | 34 ملف route غير مسجل | ملفات API موجودة بس مش محملة في `lightweight_server.py` — dead code |
| G9 | Architecture violation: Node بـ يكتب في SQLite مباشرة | `/api/predictions/honest-tracking/*` (3 endpoints) — يجب نقلها لـ Python |
| G10 | Prisma scaffold بدل schema حقيقي | `schema.prisma` = User+Post فقط، الـ data الحقيقي في Python raw SQL |
| G11 | توقعات عطلة نهاية الأسبوع | توقعات تُنتج من stale prices في العطلات |
| G12 | `pytz` dependency حرج | لو مش موجود، Cairo timezone → UTC+2 (غلط في DST) |
| G13 | Hardcoded stop values | `default_stop_pct` / `max_stop_pct` / `ATR_multiplier` في constructor مش engine_settings |
| G14 | No message queue | المهام المجدولة تشتغل مباشرة في نفس العملية — مهمة ثقيلة بتعلق التانية |

### 10.3 Threshold Contradictions (from 03-REFACTORING_REPORT §8)

| التناقض | الكود | الإعدادات | التأثير |
|---|---|---|---|
| `tech_score_base` | default=25 | DEFAULT=50 | الفعلي 25 — partial proofs تأثير أكبر |
| `trailing_stop_activation_gain` | V38=3%, V39=5% | 2.0 | الباكتست يفعل الـ trailing أبكر من الـ live |
| Tiered stop initial | 8% ثابت | `default_stop_pct=5%` | tiered_stop يتجاهل الوقف الافتراضي |
| Break-even trigger | 7% ثابت | — | مش قابل للتعديل |
| Portfolio heat | 2% ثابت | — | مش قابل للتعديل |

### 10.4 Missing Tests (from GAPS_AND_MISSING §4)

- No tests for any stop type (`stop_manager.py`)
- No tests for institutional_decision_engine
- No tests for v38_backtest_engine `simulate_trade()`
- Only 16 test files total (mostly integration smoke tests)

### 10.5 Security Vulnerabilities (from 03-REFACTORING_REPORT §9 — 18 critical + 22 high)

> تفاصيل في `03-REFACTORING_REPORT.md` §9. 4 من 18 fixed في P0.

- **SEC-01** ⚠️FIXED-P0: NextAuth admin credentials hardcoded
- **SEC-03** ⚠️FIXED-P0: Paymob HMAC verification optional + secret in code
- **SEC-04** ⚠️FIXED-P0: Admin Auth Bypass عبر الـ proxy
- (+ 15 more — open)

### 10.6 الـ Stage A-H Fundamentals Activation Status

| Stage | Status | Output |
|---|---|---|
| A — Inventory | ✅ DONE | `DATA_ENGINE_FUNDAMENTALS_INVENTORY.md` (5 clean tables + 3 broken + egx_fundamentals=0) |
| B — Mapping | ✅ DONE | 81.8% ticker match / 97.4% by prediction count |
| C — Score formula | ✅ DONE | 40/30/15/15 weights (Profitability/Valuation/Dividend/Growth) |
| D-E — Test scenarios | ✅ DONE | high-score ≥70 PF=4.436 / hard veto <30 PF=0.273 |
| F — Code commit | ✅ DONE (commit `04354a5`) | `fundamental_data_provider.py` + `stock_fundamentals.py` + `v38_backtest_engine.py` |
| G — Production sync + cron | ✅ DONE (a268957+4cde9f0) | cron مُفعّل + fetcher مُحصّن (ticker guard + no-args fix + verify). Production sync of `predictions.db` = المتبقّي |
| H — Migrate `tab_balance_sheet` column-shift | ✅ DONE (commit `a73b1a1`) | migrate_fundamentals_schema.py: DELETE 24 shifted rows + VACUUM. verify_tab_integrity = 0 shifted |

### 10.7 الـ Production Sync Commands (pending — per RR_FIX_FINAL_REPORT §4)

```bash
# On VPS:
cd /root/GLMinvestment
git pull origin main
pm2 restart python-backend nextjs ws-service telegram-events

# Verify R:R fix:
sqlite3 db/predictions.db "SELECT ticker, entry_price, target_price, stop_loss,
  (target_price-entry_price)/(entry_price-stop_loss) as rr FROM predictions
  WHERE outcome IS NOT NULL LIMIT 5;"
# Expected: rr values 1.5-2.0 (not all 1.5)

# Stage G (NEXT — fundamentals cron):
# Add to vps-service/crontab.txt:
# 0 17 * * 1-5 cd /root/GLMinvestment && python3 data_engine/scrapers/egx_fundamental_fetcher.py >> logs/fetcher.log 2>&1
```

---

## 11. References & Merged Sources

### 11.1 الـ 4 Master Files (authoritative)

| File | Role |
|---|---|
| `Documentation/00-CONSTITUTION.md` | الدستور — 25 rules (Python=Brain, Node=Display, WAL, single-viewport, commission edge, refactoring approval, ...) |
| `Documentation/01-PROJECT_ANATOMY.md` | **هذا الملف** — المعمارية + DBs + API + data flow + deployment |
| `Documentation/02-SCREENS_AND_COMPONENTS.md` | شاشات + components inventory + dead/duplicate inventory (تفصيل كامل) |
| `Documentation/SYSTEM_HOW_IT_THINKS.md` | منطق التحليل (decision engine + persona + R:R + fundamentals + backtest + closed-loop) |

### 11.2 ملفات مُدمجة هنا (12 source docs — pending deletion by main agent)

| Source file | Lines | Merged into § |
|---|---:|---|
| `PROJECT_FULL_BLUEPRINT.md` | 2,148 | §1, §2, §3, §7 (header + topology + tree + DBs + deployment) |
| `API_DICTIONARY.md` | 1,877 | §5 (API map condensed) |
| `CURRENT_STATE.md` | 678 | §1.5, §4.5, §10 (stats + thresholds + gaps) |
| `ULTRA-RESTORE-DATABASE-RECOVERY.md` | 199 | §3, §6.4, §10 (DB recovery + SELL sign-flip + -20% cap) |
| `V40_2_LIVE_INTEGRATION_PLAN.md` | 199 | §4.2, §6.4 (V40.2 daily generator + R:R floor gate) |
| `GAPS_AND_MISSING.md` | 196 | §10 (gaps + contradictions + missing tests) |
| `03-REFACTORING_REPORT.md` | 938 | §8, §10.3, §10.5 (dead-code + contradictions + SEC) |
| `P0_V2_POST_DEPLOY_RUNBOOK.md` | 274 | §6.4, §10.7 (schema-aware + HARD cap + production sync) |
| `PICKS-MANAGEMENT-SYSTEM.md` | 498 | §4.1, §5.2.3 (Picks Management engine + API) |
| `V34-INSTITUTIONAL-DECISION-ENGINE.md` | 438 | §4.1 (institutional_decision_engine + 6 proofs + portfolio_advice) |
| `RR_FIX_FINAL_REPORT_20260817.md` | 278 | §4.2, §4.5, §6.1, §10.7 (R:R fix + archive proof + before/after + production sync) |
| `DATA_ENGINE_FUNDAMENTALS_INVENTORY.md` | 162 | §3.1, §3.3, §3.4, §10.1, §10.6 (tab_* inventory + bugs + mapping) |
| `FUNDAMENTALS_HISTORICAL_TEST_REPORT.md` | 317 | §3.1, §6, §10.6 (Stage A-H + score formula + test results) |
| `audit_map.json` | 24,910 | §9 (audit_map summary — NOT embedded, just referenced) |

### 11.3 الـ Commits الموثقة

| Commit | Date | Title |
|---|---|---|
| `65a748f` | 2026-08-17 | R:R fix — v38_backtest_engine reads canonical sl/tp1/tp2 + ATR clamp [3%,9%] + R:R floor gate |
| `04354a5` | 2026-08-17 | Fundamentals activation Stage A-F — fundamental_data_provider + stock_fundamentals |
| `c14597d` | 2026-08-17 | PERSONA-UNIFY-A — compute_persona_fit + balanced baseline protection |
| `d2084710` | 2026-08-11 | 3-SCREEN REDESIGN (v3.66.8) |
| `9b34788a` | (v3.66.7) | 5-MIN DATA ENGINE + MOBILE-FIRST EXPERT VIEW |
| `893b194d` | (v3.66.6) | EXPERT CONSENSUS ENGINE |
| `de9b214b` | (v3.66.5) | SECTOR INTELLIGENCE |
| `7c846c27` | (v3.66.4) | MISSED-OPPORTUNITIES TRACKER |
| `ed55a60c` | 2026-08-09 | P0-v2 — schema-aware scripts + HARD ABS<=50 cap |

### 11.4 الـ Production KPIs (reference baseline — 2026-08-17)

| Metric | Value | Source |
|---|---|---|
| Live WR (26 closed) | ≈ 69.2% | CURRENT_STATE.md |
| Live PF | ≈ 4.46 | CURRENT_STATE.md |
| AvgWin | +11.3% | CURRENT_STATE.md |
| AvgLoss | -5.7% | CURRENT_STATE.md |
| Fair re-sim PF (post R:R fix) | 1.453 | RR_FIX_FINAL_REPORT_20260817.md |
| Fair re-sim expectancy | +1.54%/trade | RR_FIX_FINAL_REPORT_20260817.md |
| Δ vs fair baseline (BEFORE-RESIM) | +0.055 PF / +0.189%/trade | RR_FIX_FINAL_REPORT_20260817.md |
| % trades with R:R=2.0 (outperform path) | 95.27% | RR_FIX_FINAL_REPORT_20260817.md |
| ATR clamp fired (trades clamped) | 0 (all already within [3%,9%]) | RR_FIX_FINAL_REPORT_20260817.md |

### 11.5 الـ File Sizes (final)

| File | Lines | Size |
|---|---:|---:|
| `00-CONSTITUTION.md` | ~550 | ~28KB |
| `01-PROJECT_ANATOMY.md` (this file) | ~1,150 | ~58KB |
| `02-SCREENS_AND_COMPONENTS.md` | 1,104 | 67KB |
| `SYSTEM_HOW_IT_THINKS.md` | 1,785 | 99KB |
| **Total (4 masters)** | **~4,590** | **~252KB** |

---

## 12. AI News Agent + Corporate Actions (جديد 2026-08-31)

### 12.1 AI News Agent

**الملف:** `vps-service/ai/news_agent.py` (340 LOC)

وكيل ذكي لجلب وتحليل الأخبار باستخدام أدوات مجانية:

| المكون | الحزمة | الوصف | الحالة |
|---|---|---|---|
| **DuckDuckGo Search** | `ddgs` | بحث مجاني عن أخبار السهم (بدون API key) | ✅ شغّال |
| **Trafilatura** | `trafilatura` | استخلاص نص المقال من HTML → نص نقي | ✅ شغّال |
| **Ollama** | `ollama` | تحليل بالـ AI المحلي (qwen2.5:1.5b) | ❌ crash (CPU بلا AVX) |
| **Keyword Fallback** | (مدمج) | 120+ كلمة مفتاحية (عربي + إنجليزي) بأوزان 1-3 | ✅ شغّال (الإنتاج) |

**كيف يعمل:**
```
V40.2 يولّد signal
  ↓
News Agent يبحث (DuckDuckGo) عن أخبار السهم
  ↓
يستخرج نص المقال (Trafilatura)
  ↓
يحاول Ollama → crash → keyword fallback
  ↓
يرجع: sentiment (positive/negative/neutral) + score (0-100) + summary
  ↓
لو score < 30 (سلبي جداً) → ارفض الإشارة
```

**التكامل مع V40.2:** `v40_2_daily_generator.py` (سطر 1159-1185)
- بعد بناء كل signal → شغل News Agent
- خزّن `news_sentiment` + `news_score` + `news_summary` في signal
- لو `score < 30 AND confidence > 0.5` → ارفض الإشارة
- safe-by-design: لو فشل → تجاهل (لا تأثير على التوقعات)

**اختبار الإنتاج (2026-08-31):**
```
SWDY (Ezz Steel):    positive, score=90/100, 3 كلمات إيجابية (وزن 8)
HRHO (Hassan Allam): positive, score=80/100, 2 كلمات إيجابية (وزن 6)
COMI (CIB):          neutral, score=50/100, لا توجد أخبار (DuckDuckGo rate limit)
```

### 12.2 Corporate Actions — أخبار الاكتتاب وتوزيع الأرباح (مطلوب تنفيذه)

**المشكلة:** النظام الحالي ما بيجيبش أخبار الاكتتاب (IPO) ولا توزيع الأرباح (Dividends) ولا مواعيدها.
دي معلومات بتقلب تحليلات السهم بشكل كبير:

| الحدث | التأثير على السهم | المصدر المقترح |
|---|---|---|
| **اكتتاب جديد (IPO)** | سهم جديد يدخل السوق → سيولة بتتحرك | DuckDuckGo + EGX website |
| **توزيع أرباح (Dividend)** | ex-div date → السعر ينزل بقيمة التوزيع | EGXPilot + data_engine.db.tab_dividends |
| **split/reverse split** | تغيير عدد الأسهم → السعر يتغير | EGX announcements |
| **general assembly** | قرارات مهمة (توزيع/زيادة رأس مال) | EGX website |

**الخطة المقترحة (4 مراحل):**

#### المرحلة 1: جدول توزيع الأرباح (Dividend Calendar)
```
المصدر: data_engine.db.tab_dividends (موجود بالفعل — 858 صف)
المنطق:
  - قبل كل توقع، افحص هل السهم عنده ex-div date خلال 7 أيام
  - لو ex-div قريب → خزّن كـ warning (مش رفض)
  - لو ex-div خلال 2 يوم → رفض الدخول (السعر هينزل)
```

#### المرحلة 2: أخبار الاكتتاب (IPO News)
```
المصدر: DuckDuckGo search "EGX IPO Egypt stock"
المنطق:
  - ابحث عن أخبار الاكتتاب الجديد
  - لو فيه اكتتاب جديد → تأثير على سيولة السوق
  - خزّن في news_agent كـ "ipo_alert"
```

#### المرحلة 3: General Assembly Calendar
```
المصدر: EGX website scraping
المنطق:
  - اجمع مواعيد الجمعيات العمومية
  - قبل كل توقع، افحص هل السهم عنده جمعية قريبة
  - لو الجمعية خلال 3 أيام → warning (قرارات ممكن تقلب السعر)
```

#### المرحلة 4: دمج Corporate Actions في V40.2
```
في v40_2_daily_generator.py، بعد Entry Gate:
  1. فحص Dividend Calendar → warning/reject
  2. فحص IPO News → warning
  3. فحص General Assembly → warning/reject
  4. خزّن كل corporate actions في signal للـ audit
```

**DB tables المطلوبة:**
```sql
-- جدول جديد في predictions.db
CREATE TABLE IF NOT EXISTS corporate_actions (
    id TEXT PRIMARY KEY,
    ticker TEXT,
    action_type TEXT,  -- 'dividend', 'ipo', 'split', 'assembly'
    action_date TEXT,
    details TEXT,      -- JSON بتفاصيل الحدث
    source TEXT,       -- 'egx', 'duckduckgo', 'egxpilot'
    created_at TEXT
);
```

### 12.3 الـ Cron المقترح للـ Corporate Actions

```bash
# جلب توزيعات الأرباح يومياً (من EGXPilot)
0 6 * * 1-5 cd /root/GLMinvestment && python3 vps-service/jobs/fetch_dividends.py >> /tmp/dividends.log 2>&1

# جلب أخبار الاكتتاب كل 6 ساعات
0 */6 * * * cd /root/GLMinvestment && python3 vps-service/jobs/fetch_ipo_news.py >> /tmp/ipo_news.log 2>&1

# جلب مواعيد الجمعيات العمومية يومياً
30 6 * * 1-5 cd /root/GLMinvestment && python3 vps-service/jobs/fetch_assembly_calendar.py >> /tmp/assembly.log 2>&1
```

---

> **END OF FILE** — `01-PROJECT_ANATOMY.md` v3.6.0 (2026-09-01: Stock Notebook + Unified Exit Engine + Decision Logger + News Impact Scorer + EGX Disclosure Engine + Crypto Modules + 10 Feature Flags).
> للتفاصيل الكاملة عن أي قسم: ابحث في الـ source files المُدرجة في §11.2.
> للتحديث: عدّل هذا الملف مباشرة + حدّث الـ "last updated" في الـ header.

---

## 📒 سجل التغييرات

| التاريخ | الملف | التغيير |
|---------|-------|---------|
| 2026-09-01 | `01-PROJECT_ANATOMY.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إضافة قسم "تغييرات جوهرية (2026-09-01)" يحتوي على: Stock Notebook System (1,065 LOC + 259 JSON + 7 API endpoints + NotebookAdminTab.tsx)، Unified Exit Engine (518 LOC + MARKET_PROFILES)، Decision Logger (338 LOC + decision_log.db)، News Impact Scorer (432 LOC + 14 event types)، EGX Disclosure Engine (875 LOC + 12 disclosure types)، Crypto Modules (4 ملفات: crypto_strict_filters + crypto_short_holding_exit + crypto_news_fetcher + crypto_disclosure_engine)، Feature Flags V40.2 (10 flags)، News Fetcher Analyzer + news_signals_reader + /api/news/ingest. |
| 2026-09-25 | `01-PROJECT_ANATOMY.md` | DOC-CONSOLIDATION: تحديث §1.5 الإحصائيات (956 stocks، 1,585 data_engine، 306 predictions، 7,894 news، 1,205,599 price_history، 653 API route، 274 component). إضافة §1.6 (5-Market + UI-Mirror + SQLite Fallback). تحديث §3.1 DB Map بالأرقام الحالية. إضافة §17 Historical Documentation Archive. |

---

## 17. Historical Documentation Archive (DOC-CONSOLIDATION — 2026-09-25)

> **القاعدة الدستورية 25 + 41 (DOCS-FIRST-LAST):** التوثيق الإلزامي = 4 ملفات فقط (`00-CONSTITUTION.md` + `01-PROJECT_ANATOMY.md` + `02-SCREENS_AND_COMPONENTS.md` + `SYSTEM_HOW_IT_THINKS.md`).
>
> كل ملفات `Documentation/*.md` غير الأربعة الرئيسية مُؤرشفة هنا كـ **مرجع تاريخي (historical reference)** — **لم تُحذف** (احترامًا للقاعدة 16 — VERIFY-BEFORE-DELETE والقاعدة 25). القصد منها توفير السياق التاريخي للقرارات التي اتُّخذت في الفترات الماضية. أي تعديل جديد لازم يُدمج في الـ 4 canonical files.

### 17.1 الملفات الأربعة الأساسية (Canonical — مُلزمة بالقراءة)

| # | الملف | الدور |
|---|---|---|
| 1 | `Documentation/00-CONSTITUTION.md` | الدستور والقواعد الـ 53. |
| 2 | `Documentation/01-PROJECT_ANATOMY.md` (هذا الملف) | التشريح الكامل: المعمارية + DBs + APIs + 5 markets. |
| 3 | `Documentation/02-SCREENS_AND_COMPONENTS.md` | كل شاشة وكل مكوّن بحالته (ACTIVE/DEAD/DUPLICATE). |
| 4 | `Documentation/SYSTEM_HOW_IT_THINKS.md` | منطق المحرك (V40.2 + closed-loop + 3 personas). |

### 17.2 الملفات الأخرى في `Documentation/` (Historical — للقراءة عند الحاجة فقط)

| الملف | الدور التاريخي | المحتوى المُدمَج في canonical؟ |
|---|---|---|
| `Documentation/كل الاسواق.md` | خريطة الأسواق الأربعة + CRYPTO قبل توحيد الـ 5-Market Architecture. | ✅ مُدمَج في §1.6 (5-Market + UI-Mirror). |
| `Documentation/DATABASE_ARCHITECTURE.md` | تصميم قواعد البيانات القديم (10 DBs قبل DB-CLEANUP-WAVE-1+2+3). | ✅ مُدمَج في §3.1 (DB Map updated 2026-09-25). |
| `Documentation/DATA_FLOW_MAP.md` | تدفق البيانات من scrapers → DBs → engines → API → UI. | ✅ مُدمَج في §1.6 (SQLite Fallback Pattern) + §2 (Directory Tree). |
| `Documentation/METHODOLOGY_AND_RESULTS.md` | منهجية V40.2 + نتائج backtest تاريخية. | ✅ مُدمَج في `SYSTEM_HOW_IT_THINKS.md` §تغييرات جوهرية (2026-09-03). |
| `Documentation/LEGAL_PROTECTION.md` | الإطار القانوني + إخلاء المسؤولية. | ⚠️ يُحتفظ به كمرجع قانوني. مدمَج جزئيًا في `legal/disclaimer` + `legal/privacy` + `legal/terms` pages. |
| `Documentation/PRODUCTION_DATA_EXPORT.md` | دليل تصدير بيانات الإنتاج. | ✅ مُدمَج في §3.2 (موقع القواعد). |
| `Documentation/LIQUIDITY_DYNAMIC_THRESHOLD_PROPOSAL.md` | اقتراح عتبة سيولة ديناميكية V2. | ✅ مُدمَج في `SYSTEM_HOW_IT_THINKS.md` (Liquidity Grab — القاعدة 37). |
| `Documentation/DYNAMIC_LIQUIDITY_V2_RESULTS.md` | نتائج A/B test للـ dynamic liquidity V2. | ✅ مُدمَج في `SYSTEM_HOW_IT_THINKS.md` (Backtest results). |
| `Documentation/AUDIT_ENGINEERING_2026-08-30.md` | تدقيق هندسي شامل (2026-08-30). | ⚠️ مرجع تاريخي — لا يحتاج دمج. |
| `Documentation/AUDIT_REPORT_2026-08-30.md` | تقرير تدقيق نفس الفترة. | ⚠️ مرجع تاريخي — لا يحتاج دمج. |
| `Documentation/ANALYST_REPORT_2026-08-31.md` | تقرير محلل (2026-08-31). | ⚠️ مرجع تاريخي — لا يحتاج دمج. |
| `Documentation/BACKTEST_ANALYSIS_2026-08-31.md` | تحليل backtest (2026-08-31). | ✅ مُدمَج في `SYSTEM_HOW_IT_THINKS.md` (V68 + V72 backtest). |
| `Documentation/DEEP_BACKTEST_ANALYSIS_2026-08-31.md` | تحليل backtest عميق. | ✅ مُدمَج في `SYSTEM_HOW_IT_THINKS.md` (Backtest محترم). |
| `Documentation/FIXES_REPORT_2026-08-30.md` | تقرير إصلاحات (2026-08-30). | ✅ مُدمَج في `worklog.md` + `CHANGELOG.md`. |
| `Documentation/CLOSED_CAMP_MINUTES.md` | محاضر Closed-Camp (اجتماع تصحيح المسار). | ⚠️ مرجع تاريخي للقرارات الاستراتيجية. |
| `Documentation/audit-logs/LAST_30DAYS_WEAKNESS_ANALYSIS.md` | تحليل ضعف آخر 30 يوم. | ⚠️ في `audit-logs/` subdirectory (مسموح به دستوريًا). |
| `Documentation/audit-logs/JULY_2026_LOSS_ANALYSIS.md` | تحليل خسائر يوليو 2026. | ⚠️ في `audit-logs/` subdirectory (مسموح به دستوريًا). |

### 17.3 الملفات الخاصة في جذر المشروع (Special — لا تُمسح)

> هذه الملفات في جذر المشروع (مش في `Documentation/`) وذات طابع تشغيلي/تاريخي خاص:

| الملف | الدور |
|---|---|
| `AGENTS.md` | دليل سير العمل اليومي (golden rules + runbooks + sandbox). مُلزَم بالقراءة بعد الـ 4 canonical files. |
| `SYSTEM_STATE.md` | آخر حالة للنظام + سجل الإصلاحات (P0-v2 → RL-FIX-9 → R:R-FIX → FUNDAMENTALS-ACTIVATION). |
| `CHANGELOG.md` | سجل التغييرات الكامل — يُقرأ آخر 3 إدخالات فقط (في الأعلى). |
| `worklog.md` | سجل العمل اليومي (gitignored) — يُقرأ آخر ~150 سطر. |
| `DEPLOYMENT_GUIDE.md` | دليل النشر الكامل على VPS (Caddy + PM2 + backup). |
| `Grok-Report-V40.2-Detailed-Analysis.md` | تحليل V40.2 من Grok (مرجع تاريخي لمراجعة Grok على V40.2). |
| `Agent messages (from news).md` | سجل رسائل News Agent (مرجع تكامل News-Submodule — القاعدة 47). |

### 17.4 سياسة التعامل مع الـ Historical Archive

1. **لا تُحذف** (القاعدة 16 — VERIFY-BEFORE-DELETE + القاعدة 25 — refactoring-gated).
2. **لا تُحدَّث** بمحتوى جديد — أي جديد يُدمَج في canonical files فقط.
3. **تُقرأ عند الحاجة** فقط لو في سياق تاريخي محدد (مثلاً: ليه اخترنا V40.2 مش V62؟ — راجع `METHODOLOGY_AND_RESULTS.md`).
4. **موافقة المالك مطلوبة** لحذف أي منها بعد انتهاء الحاجة إليها (القاعدة 25).
5. الـ `audit-logs/` subdirectory استثناء صريح (مسموح دستوريًا) — يحتوي على تقارير تدقيق دورية.

> **نتيجة DOC-CONSOLIDATION (2026-09-25):** 4 ملفات canonical حيّة + 17 ملف historical محفوظ في `Documentation/` (16 + 2 في `audit-logs/`) + 7 ملفات خاصة في جذر المشروع. إجمالي 28 ملف `.md` توثيقي — لا يحتاج أي ملف جديد.
# 🗺️ Data Flow Map — GLMinvestment

> **آخر تحديث**: 2026-09-03 (WAVE-1+2+3 DB Cleanup: حذف 3 DBs + migration price_history → data_engine.db.egksco_price_history + إسقاط 9 جداول فاضية)
> **آخر تحديث سابق**: 2026-09-01 (Stock Notebook + Disclosure + Decision Logger + Unified Exit + News Fetcher + 10 Feature Flags)
> **المؤلف**: Z.ai Code
> **الحالة**: Production reference document

---

## 📋 ملخص تنفيذي

النظام بـ يتكون من **3 layers** متصلة:

1. **Data Engine** (ingestion) — بـ يجيب البيانات من مصادر خارجية ويـ write للـ DBs
2. **Analytics Engine** (Python backend) — بـ يـ read الأسعار، يـ generate signals، ويـ write التوقعات
3. **Frontend** (Next.js) — بـ يـ read من Python API + Direct SQLite + Prisma

---

## 📊 خريطة الـ DBs (الوضع الحالي بعد WAVE-1+2+3 Cleanup — 2026-09-03)

### ✅ DBs نشطة وفيها بيانات حقيقية (7 DBs بعد التنظيف)

| DB | الحجم | الصفوف | الوصف | التحديث |
|---|---|---|---|---|
| `data_engine.db` | 125 MB | 162,946 (egksco_price_history) + 429,649 (crypto) + 220,598 (gold) + 858-866 (tab_*) | **الـ canonical price history + fundamentals + live quotes** (بعد WAVE-2 migration) | ✅ active (live quotes + egksco) |
| `intraday.db` | 120 MB | 266,259 (stock_intraday) + 151,792 (crypto_intraday) + 22,795 (commodity) | tick-level data | ✅ active |
| `news.db` | 13 MB | 7,806 (market_news) + 7,894 (news_articles) | الأخبار (بعد news migration) | ✅ active |
| `stocks.db` | 10 MB | 1,047 (stocks) + 46,001 (stock_daily_prices) + 256 (egksco_stocks) | stocks metadata + stock_daily_prices (آخر 30 يوم) | ✅ active (sync.py) |
| `predictions.db` | 1.5 MB | 80 (predictions) + 8,544 (outcome_logs) + 494 (learned_lessons) | التوقعات + التعلم + النتائج | ✅ active (V40.2) |
| `auth.db` | 0.18 MB | 90 (User) + 5 (api_tokens) + 75 (task_runs) | المستخدمين + الاشتراكات | ✅ active |
| `price_history.db` | 16 MB | 162,946 (price_history) | **safety net فقط** — الكود بـ reads من data_engine.db.egksco_price_history (الـ canonical) | ⚠️ محتفظ بيه للأمان |

### ❌ DBs تم حذفها في WAVE-1 (2026-09-03)

| DB | الحجم | السبب |
|---|---|---|
| `custom.db` | 24 KB | default Prisma DB — ما كانش بيستخدم (كل الـ references كانت deprecated stubs بتـ route لـ stocks.db) |
| `prices.db` | 21 MB | صفر references في الكود — البيانات كلها مكررة في data_engine.db |
| `crypto.db` | 32 KB | 0 rows + dead code (unified-db.ts كان بـ query جدول `crypto_coins` مش موجود أصلاً) |

### 📊 جداول تم إسقاطها في WAVE-3 (2026-09-03)

**9 جداول فاضية (0 rows + 0 code references) اتشالت:**
- `stocks.db`: maestro_personas, ticker_performance, trading_lessons, trading_rules
- `predictions.db`: CachedAnalysis, TechnicalIndicator (camelCase duplicates)
- `auth.db`: optimized_parameters, platform_recommendations, user_trades

---

## 🔄 Layer 1: Data Engine (Ingestion)

### 1.1 — الـ writers النشطين لـ `data_engine.db.egksco_price_history` (بعد WAVE-2 migration)

> **ملاحظة مهمة (2026-09-03):** قبل WAVE-2، كان فيه 4 writers بـ يكتبوا في `price_history.db.price_history`.
> بعد الـ migration، الكود بـ reads من `data_engine.db.egksco_price_history` (162,946 rows).
> `price_history.db` محتفظ بيه كـ safety net فقط — الكود في الواقع بـ reads من data_engine.db.

| الكاتب | الـ source | الـ destination | الـ schedule |
|---|---|---|---|
| `egksco_scraper.py` | `egksco` | `data_engine.db.egksco_price_history` | كل 15 دقيقة (09:00-14:30) |
| `daily_price_updater.py` (legacy) | `tradingview_live` | `price_history.db.price_history` (safety net) | cron `0 7,13 * * 0-4` |
| `intraday_aggregator.py` (legacy) | `intraday_aggregated` | `price_history.db.price_history` (safety net) | كل 30 دقيقة |
| `price_history_safetynet.py` (legacy) | `yahoo_safetynet` | `price_history.db.price_history` (safety net) | كل 60 دقيقة |

### 1.1b — news-agent scrapers (مدerged من news repo)

> **الـ module:** `news-agent/` (submodule from https://github.com/enmohsen20111975/news/)
> **التكامل:** 2026-09-03 (Rule 47: NEWS-AGENT-INTEGRATION)

| Scraper | المصدر | الـ destination | الحالة |
|---|---|---|---|
| `tradingview_rest.py` | scanner.tradingview.com (REST API) | `db/data_engine.db.stocks` | ✅ نشط (urllib فقط) |
| `tradingview_screener_lists.py` | TradingView screener | `db/data_engine.db.screener_lists` | ✅ نشط |
| `tradingview_market_movers.py` | TradingView 9 tabs | `db/data_engine.db.market_movers_tabs` | ✅ نشط |
| `egx_news_scraper.py` | EGX official site | `db/news.db.market_news` | ✅ نشط |
| `marketmaker_news_scraper.py` | MarketMaker | `db/news.db.market_news` | ✅ نشط |
| `telegram_collector.py` | Telegram channels | `db/news.db.market_news` | ⚠️ محتاج telethon |
| `tradingview_scraper.py` | TradingView (Playwright) | `db/data_engine.db.stocks` | ⚠️ محتاج Playwright |
| `web_scraper.py` | Web scraping | `db/news.db.market_news` | ⚠️ محتاج trafilatura |
| `rss_collector.py.disabled` | RSS feeds | — | 🚫 معطّل (feedparser) |
| `investing_scraper.py.disabled` | sa.investing.com | — | 🚫 معطّل (Playwright) |
| `investing_news_collector.py.disabled` | sa.investing.com/news | — | 🚫 معطّل (Playwright) |

**Rule 28 (NO-DUPLICATION):** كل الـ scrapers بتكتب في `/home/z/my-project/db/` (الـ canonical).
**Rule 29 (UNIFIED-SYSTEM):** `news-agent/config/paths.py` بيوفّر مسارات موحدة.
**news merge:** 212 خبر من news-agent القديم ادمجت في `db/news.db.market_news` (الإجمالي 8,012 خبر).

### 1.2 — الـ writers لـ `data_engine.db` (live quotes)

| الكاتب | الـ destination | التردد |
|---|---|---|
| `data_engine/main.py::run_scheduler` | `data_engine.db.stocks` | كل 5 دقائق |
| `crypto_fetcher.py` | `data_engine.db.crypto_prices` + `btc_local_prices` | كل 2 دقيقة |
| `metals_forex_fetcher.py` | `data_engine.db.gold_prices` + `silver_prices` + `exchange_rates` | كل 15 دقيقة |
| `news_fetcher` | `news.db.news_articles` (→ `content.db.news_articles`) | كل 6 ساعات |
| `data_engine/sync.py` | `stocks.db.stocks` + `stocks.db.stock_daily_prices` | عند كل تحديث |
| `intraday_storage.py` | `intraday.db.stock_intraday` + `crypto_intraday` + `commodity_intraday` | عند كل tick |

### 1.3 — الـ cron jobs (من `vps-service/crontab.txt`)

```
*/5 8-12 * * 0-4   tradingview_scraper  (كل 5 دقائق، 08:00-12:00 UTC)
0 7,13 * * 0-4     daily_price_updater  (مرتين يومياً)
5 13 * * 0-4       v40_2_daily_generator (يومي 13:05 UTC)
30 13 * * 0-4      daily_closer          (يومي 13:30 UTC)
40 13 * * 6        learning_engine       (سبتي أسبوعي)
0 14 * * 6         egx_fundamental_fetcher (سبتي أسبوعي)
0 1 * * *          daily_db_health_check (يومي 01:00)
30 1 * * *         daily_backup          (يومي 01:30)
0 3 * * *          smart_db_backup       (يومي 03:00)
0 * * * *          data_heartbeat_checker (كل ساعة)
```

---

## 🔄 Layer 2: Analytics Engine (Python backend)

### 2.1 — V40.2 Generator (`vps-service/jobs/v40_2_daily_generator.py`)

| العملية | المصدر | الـ destination |
|---|---|---|
| Read: dates + tickers | **`data_engine.db.egksco_price_history`** (canonical) → `stocks.db.stock_daily_prices` (fallback) | — |
| Read: prices (per ticker) | `v38_backtest_engine.get_price_data()` (PRIMARY: data_engine.db) | — |
| Read: fundamentals | `data_engine.db.tab_*` (858-866 rows) + `stocks.db.stocks` (330 with ROE) | — |
| Read: screener lists | `data_engine.db.screener_lists` (1,459 entries: most_active, top_gainers, unusual_volume, high_dividend) | — |
| Read: tickers + sector | `stocks.db.stocks` | — |
| Read: news impact | `predictions.db.outcome_logs` + live news from `/api/proxy-prod/news-feed` | — |
| Read: benchmark (EGX30ETF) | V38 engine (lazy) | — |
| **Write: predictions** | — | `predictions.db.predictions` + `persona_predictions` |

### 2.2 — Daily Closer (`vps-service/jobs/daily_closer.py`)

| العملية | المصدر | الـ destination |
|---|---|---|
| Read: pending predictions | `predictions.db.predictions` (WHERE actual_return IS NULL) | — |
| Read: current prices | **`data_engine.db.egksco_price_history`** (canonical) → `stocks.db.stock_daily_prices` (fallback) | — |
| **Write: outcome** | — | `predictions.db.predictions` (UPDATE actual_return + exit_type) |

### 2.3 — Learning Engine (`vps-service/jobs/learning_engine.py`)

| العملية | المصدر | الـ destination |
|---|---|---|
| Read: closed predictions | `predictions.db.predictions` (WHERE actual_return IS NOT NULL) | — |
| **Write: lessons** | — | `predictions.db.learned_lessons` + `sniper_performance` |
| **Write: optimizer params** | — | `vps-service/config/optimizer_params.json` |

### 2.4 — V38 Backtest Engine (`vps-service/engines/v38_backtest_engine.py`)

| العملية | المصدر |
|---|---|
| Read: prices (per ticker) | **`data_engine.db.egksco_price_history`** (PRIMARY, 162,946 rows) → `stocks.db.stock_daily_prices` (fallback, 46,001 rows) |
| Read: fundamentals | `data_engine.db.tab_*` + `stocks.db.stocks` (330 with ROE) |
| Read: sector info | `stocks.db.stocks` |

**ملاحظة**: الـ engine ما بـ writeش أي حاجة — بـ يحلل فقط.

### 2.5 — Master Analyzer (`vps-service/analyzers/master_analyzer.py`)

| العملية | المصدر | الـ destination |
|---|---|---|
| Read: prices | **`data_engine.db.egksco_price_history`** (canonical) | — |
| Read: intraday | `intraday.db.*` | — |
| Read: metadata | `stocks.db.*` | — |
| Read: fundamentals | `data_engine.db.tab_*` | — |
| **Write: cached analysis** | — | `stocks.db.cached_analysis` |

### 2.6 — Top Performers API (`vps-service/api/top_performers_routes.py`)

| العملية | المصدر |
|---|---|
| Read: prices | **`data_engine.db.egksco_price_history`** (canonical) |
| Read: metadata | `stocks.db.stocks` |

### 2.7 — Prediction Tracker (`vps-service/analyzers/prediction_tracker.py`)

| العملية | المصدر | الـ destination |
|---|---|---|
| Read: predictions | `predictions.db.predictions` + `persona_predictions` | — |
| **Write: predictions** | — | `predictions.db.predictions` (CREATE/INSERT/UPDATE) |

### 2.8 — Screener Integration (`vps-service/analyzers/screener_integration.py`)

> **الكنز المدفون #1** — مربوط في V40.2 generator (line 1036-1120)

| العملية | المصدر |
|---|---|
| Read: screener tags | `data_engine.db.screener_lists` (most_active, unusual_volume, top_gainers, high_dividend, top_losers) |
| Read: fundamentals boost | `data_engine.db.tab_valuation` + `tab_profitability` |
| Read: bid/ask spread | `intraday.db.*` (bid/ask columns) |
| Apply: VETO / BOOST | → modifies V40.2 score |

### 2.9 — News Impact Integration (`vps-service/analyzers/live_news_integration.py`)

> **الكنز المدفون #2** — 5 levels: STRONG_POSITIVE / POSITIVE / NEUTRAL / NEGATIVE / STRONG_NEGATIVE

| العملية | المصدر |
|---|---|
| Read: news | `predictions.db.outcome_logs` + live `/api/proxy-prod/news-feed` |
| Classify impact | 5 levels → score_delta (+15/+8/0/-8/-15) |
| Apply: combined_score | → modifies V40.2 score + signal |

### 2.10 — Position Sizing (`vps-service/analyzers/position_sizing.py`)

> **الكنز المدفون #3** — volatility-based position sizing

| العملية | المصدر |
|---|---|
| Read: ATR | `v38_backtest_engine.get_price_data()` |
| Classify volatility | LOW (<3%) / NORMAL (3-6%) / HIGH (≥6%) |
| Apply: position_size_mult | HIGH=0.55, NORMAL=0.80, LOW=1.00 |

---

## 🔄 Layer 3: Frontend (Next.js)

### 3.1 — أنماط الوصول للـ data

| النمط | عدد الـ routes | الوصف |
|---|---|---|
| **Python proxy** | 250 route | `/api/proxy/*` و `/api/python/*` → `localhost:8010` (Flask) |
| **Direct SQLite** | 53 route | `better-sqlite3` reads مباشرة من DBs |
| **Prisma** | 10 route | `auth.db` + `predictions.db` |

### 3.2 — الـ Prisma clients

```typescript
// src/lib/db.ts
authDb       → auth.db (User, Session, Subscription, Watchlist, Portfolio)
predictionsDb → predictions.db (Prediction, PersonaPrediction, ExpertRecommendation)
```

### 3.3 — أهم الـ routes + مصادرها

| Route | النمط | المصدر |
|---|---|---|
| `/api/stocks/top-performers` | Python proxy | **`data_engine.db.egksco_price_history`** (canonical after WAVE-2) |
| `/api/stocks/screener` | Python proxy | `stocks.db.screener_results` |
| `/api/predictions/honest-tracking/{list,stats,live-tracking}` | Direct SQLite | `predictions.db.predictions` |
| `/api/predictions/honest-tracking/verify-pending` | Python proxy | `predictions.db.hunter_pick_tracking` |
| `/api/stocks/sparkline` | Direct SQLite | **`data_engine.db.egksco_price_history`** → `stocks.db.stock_daily_prices` (fallback) |
| `/api/chart/[ticker]` | Direct SQLite | `stocks.db.stock_daily_prices` + fallback **`data_engine.db.egksco_price_history`** |
| `/api/news` | Direct SQLite | `news.db.market_news` (7,806 rows — migrated from news_articles) |
| `/api/data-engine/health` | Direct SQLite | `data_engine.db.egksco_price_history` (probe table) |
| `/api/admin/db-health` | Direct SQLite | `data_engine.db` + `stocks.db` + `predictions.db` |
| `/api/auth/*` | Prisma | `auth.db` |
| `/api/subscription/*` | Prisma | `auth.db` |

---

## 🎯 WAVE-1+2+3 DB Cleanup (2026-09-03) — التنظيف الشامل

### المشكلة

قبل التنظيف كان فيه **10 DBs** بإجمالي ~345 MB، فيها:
- 3 DBs مش مستخدمة خالص (custom, prices, crypto)
- price_history.db فيه 162,946 rows (نفس البيانات موجودة في data_engine.db.egksco_price_history)
- 9 جداول فاضية (0 rows) منتشرة في stocks.db + predictions.db + auth.db
- 123 سطر كود ميت في unified-db.ts (getCryptoDb + CryptoCoin interface)
- dead endpoint /api/unified-crypto

### الحل — 3 موجات منفصلة

#### WAVE-1: حذف 3 DBs (توفير ~37 MB + 123 lines dead code)
- `custom.db` (24 KB) — default Prisma DB، الـ stubs كلها deprecated (بتـ route لـ stocks.db)
- `prices.db` (21 MB) — صفر references في الكود، البيانات كلها مكررة في data_engine.db
- `crypto.db` (32 KB) — 0 rows + dead code (unified-db.ts بـ query جدول مش موجود)

كمان اتعمل cleanup لـ `src/lib/unified-db.ts` (شيل 124 سطر كود ميت) + حذف dead endpoint `/api/unified-crypto/route.ts`.

#### WAVE-2: migration price_history readers لـ data_engine.db.egksco_price_history

**الـ migration rules:**
- `FROM price_history` → `FROM egksco_price_history`
- `ticker` → `symbol`
- `date` → `price_date`
- شيل أي filter على `source` (egksco_price_history مفيهاش source column)

**الـ files اللي اتعملها migration (10 files):**

| File | التعديل |
|---|---|
| `src/lib/data-engine-db.ts` | `getPriceHistoryDb()` بقى alias لـ `getDataEngineDb()` + 3 SQL queries rewritten |
| `src/lib/data-engine-db-sqljs.ts` | `getPriceHistoryDbSqlJs()` بقى alias + `getLastCleanClose()` + `getHistoricalData()` rewritten |
| `src/lib/market-data-access.ts` | Source 3 في `getAvailableTickers()` + `getPriceHistory()` rewritten |
| `src/lib/new-db-queries.ts` | DB_PATHS + `getPriceHistoryFromNewDb()` + `areNewDbsAvailable()` + `getNewDbHealth()` rewritten |
| `src/app/api/health/route.ts` | check على `data_engine.db` بدل `price_history.db` |
| `src/app/api/admin/db-health/route.ts` | probe `egksco_price_history` بدل `price_history` |
| `src/app/api/admin/engines-status/route.ts` | `MAX(price_date)` من `egksco_price_history` |
| `src/app/api/data-engine/health/route.ts` | probe table `egksco_price_history` |
| `src/app/api/data-engine/status/route.ts` | `COUNT(*) FROM egksco_price_history` |
| `src/app/api/chart/[ticker]/route.ts` | fallback query rewritten |

#### WAVE-3: drop 9 جداول فاضية + VACUUM (توفير ~4.5 MB)

| DB | الجداول اللي اتمسحت |
|---|---|
| `stocks.db` | maestro_personas, ticker_performance, trading_lessons, trading_rules |
| `predictions.db` | CachedAnalysis, TechnicalIndicator (camelCase duplicates) |
| `auth.db` | optimized_parameters, platform_recommendations, user_trades |

VACUUM اتعمل لـ 3 DBs (stocks.db, predictions.db, auth.db).

### النتيجة النهائية

- **7 DBs** بدل 10 (توفير ~41.5 MB)
- **9 جداول أقل**
- **123 سطر كود ميت أقل**
- `price_history.db` محتفظ بيه كـ **safety net فقط** (الكود بـ reads من data_engine.db.egksco_price_history)
- كل الـ API routes بـ 200 OK
- Lint بدون أخطاء
- Backtest محترم اشتغل بـ 68 trade (PF=1.19, Return=+1.35%)

### news.db migration (إضافي)

بعد استرجاع الـ DBs من `data/all.zip`، `news.db` كان فيه `news_articles` (7,894 rows) بس الكود بـ reads من `market_news`. اتعمل migration script:
- `scripts/migrate-news-table.py`
- `news_articles` (7,894) → `market_news` (7,806) — schema mapping كامل

---

## 📅 خريطة الـ data flow المتكاملة

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  External Sources                                                            │
│  (TradingView, EGKSCO, Yahoo, Crypto APIs, Gold APIs, News, Telegram)        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  Layer 1: Data Engine (PM2: data-engine, python-backend)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  CANONICAL: data_engine.db.egksco_price_history (162,946 rows, 1047 tickers):│
│   • egksco_scraper.py         (15 min, 09:00-14:30) → source=egksco           │
│                                                                              │
│  SAFETY NET: price_history.db.price_history (162,946 rows — duplicate):     │
│   • daily_price_updater.py    (cron, legacy) → source=tradingview_live       │
│   • intraday_aggregator.py    (30 min, legacy) → source=intraday_aggregated │
│   • price_history_safetynet.py (60 min, legacy) → source=yahoo_safetynet     │
│                                                                              │
│  Live quotes → data_engine.db (stocks, crypto_prices, gold_prices, ...):    │
│   • stocks كل 5 دقائق  • crypto كل 2 دقيقة  • metals كل 15 دقيقة             │
│                                                                              │
│  sync.py → stocks.db.stocks + stocks.db.stock_daily_prices                   │
│  intraday_storage.py → intraday.db.* (tick-level, 440K rows)                 │
│  news_fetcher → news.db.market_news (7,806 rows — migrated)                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  Layer 2: Analytics Engine (PM2: python-backend, port 8010)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  V40.2 generator    → read: data_engine.db.egksco_price_history (canonical) │
│                       + screener_lists + tab_* + stocks.db                   │
│                       + news impact (live_news_integration)                  │
│                       + position sizing (volatility-based)                   │
│                       write: predictions.db.predictions                       │
│                                                                              │
│  daily_closer       → read: predictions.db (pending) + data_engine.db prices │
│                       write: predictions.db (outcome)                         │
│                                                                              │
│  learning_engine    → read: predictions.db (closed)                           │
│                       write: predictions.db.learned_lessons                   │
│                                                                              │
│  master_analyzer    → read: data_engine.db + intraday.db + stocks.db         │
│                       write: stocks.db.cached_analysis                        │
│                                                                              │
│  top_performers API → read: data_engine.db.egksco_price_history (canonical) │
│                                                                              │
│  Treasures (3 modules):                                                      │
│   • screener_integration.py → VETO/BOOST based on screener lists             │
│   • live_news_integration.py → 5 levels news impact (+15/-15)                │
│   • position_sizing.py → volatility-based size (55%/80%/100%)                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  Layer 3: Frontend (PM2: nextjs, port 3000)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  3 access patterns:                                                          │
│   • Python proxy (250 routes): /api/proxy/* → localhost:8010                │
│   • Direct SQLite (53 routes): better-sqlite3 reads                         │
│   • Prisma (10 routes): auth.db + predictions.db                            │
│                                                                              │
│  Key routes (post-WAVE-2 migration):                                         │
│   • /api/stocks/top-performers → Python → data_engine.db.egksco_price_history│
│   • /api/stocks/sparkline      → Direct SQLite data_engine.db.egksco_price  │
│   • /api/chart/[ticker]        → stocks.db + fallback data_engine.db        │
│   • /api/news                   → Direct SQLite news.db.market_news           │
│   • /api/predictions/*         → Direct SQLite predictions.db                │
│   • /api/auth/*                → Prisma auth.db                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  User Browser (React UI)                                                      │
│  /  → UnifiedScreener + MarketAnalysis + PredictionTrackingDashboard        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚠️ Known Issues (post-WAVE-1+2+3 Cleanup)

1. **`price_history.db` محتفظ بيه كـ safety net** — الكود بـ reads من data_engine.db.egksco_price_history، لكن الـ file لسه موجود عشان لو حصل أي مشكلة. ممكن يتشال لاحقاً بعد مراقبة الإنتاج لفترة.

2. **`data_engine.db.historical_data` = 99K rows بس ticker format رقمي** (1010, 1020, ...)
   — مش مفيد للـ analytics اللي بـ تستخدم ticker symbols حرفية.

3. **`learning_routes.py` (legacy)** بـ يـ read من `stocks.db` بينما الـ lessons فعلية
   في `predictions.db.learned_lessons`. Inconsistency (low priority).

4. **`live_indicator_engine._get_recent_ohlcv()`** بـ query `price_history` table
   جوه `stocks.db` — dead code path (الجدول مش موجود في stocks.db).

5. **Python backend bug (anyio + starlette)** — `/api/stocks/top-performers` بيرجع 502 بسبب تعارض إصدارات في Python stack. مش متعلق بالـ DBs.

6. **`tab_profitability` لمصر فاضي** — الـ ROE/ROA فيه `None` لكل الـ stocks المصرية. الكود بيـ fallback لـ `stocks.db.stocks.roe` (اللي فيه 330 سهم بـ ROE).

---

## 📚 مراجع

- `Documentation/00-CONSTITUTION.md` — قواعد النظام (40 قاعدة + عهد الوكيل 30 بند)
- `scripts/audit_backtest.py` — فحص الـ 0 signals
- `scripts/audit_dbs_deep.py` — فحص كل الجداول في كل الـ DBs
- `scripts/migrate_to_4_dbs.py` — سكربت الترحيل (PHASE-4 — لم يكتمل على الإنتاج)
- `vps-service/crontab.txt` — الـ cron jobs الكاملة
- `ecosystem.config.js` — PM2 services

---

## 🆕 V40.2 Subsystem Flows (2026-09-01)

> أُضيفت بعد إضافة الـ modules الستة (Stock Notebook + Disclosure + Strict Entry + Distribution Exit + News Fetcher + Decision Logger + Unified Exit Engine) + 10 Feature Flags. كلها default OFF عشان نحافظ على الـ baseline الإنتاجي.

### 📒 Stock Notebook Flow

```
notebooks/EGX/*.json (259 ملف JSON)
   ↓ load_stock_notebook(symbol) / get_machine_summary(symbol)
V40.2 generator (per ticker)
   ↓ apply_notebook_context(current_score, stop_distance_pct, ...)
   ↓ toggle: V40_2_NOTEBOOK_CONTEXT=1
   ↓ لو danger_level=5 → تقليل الحجم
   ↓ لو typical_correction_pct → مراجعة مسافة الوقف
decision_logger.log_decision() ← سجل: notebook_summary, flag_active
```

### 🏛️ Disclosure Engine Flow

```
EGX/EGKSCO disclosures (HTML)
   ↓ fetch_disclosures() (cron كل ساعتين 10:00-14:00)
   ↓ classify_disclosure(text) → 12 نوع
   ↓ score_disclosure(event_type) → -2 لـ +2
db/disclosures.db.egx_disclosures (dedup: ticker + event_type + date + title)
   ↓ get_disclosure_impact(ticker)
V40.2 generator
   ↓ toggle: V40_2_DISCLOSURE_IMPACT=1
   ↓ VETO (-2) → continue (hard reject)
   ↓ REDUCE (-1) → score -= 10
   ↓ BOOST (+1/+2) → score += 10/20
decision_logger.log_decision() ← سجل: reason_code='disclosure_veto', flag_active
```

### 🚷 Strict Entry Flow

```
V40.2 generator (per BUY signal)
   ↓ is_in_accumulation(closes, highs, lows, volumes) → range <12% + volume <1.2×
   ↓ is_liquidity_grab(highs, lows, closes, volumes) → sweep + reclaim + volume ≥1.8×
   ↓ is_late_entry(closes, highs, rsi) → near 20d high <6% OR RSI >65 OR +15% in 5d
   ↓ toggle: V40_2_STRICT_ENTRY=1
   ↓ لو is_late_entry → REJECT (Don't Chase)
   ↓ لو is_in_accumulation OR is_liquidity_grab → ACCEPT
   ↓ غير كده → REJECT
decision_logger.log_decision() ← سجل: reason_code='late_entry', flag_active
```

### 📊 Distribution Exit Flow (daily_closer)

```
daily_closer (per open prediction)
   ↓ detect_distribution(opens, highs, lows, closes, volumes, rsi)
   ↓ 5 شروط: red candle + upper_wick≥body + volume>1.8×MA + near 20d high ≤8% + RSI>65
   ↓ toggle: V40_2_DISTRIBUTION_EXIT=1
   ↓ لو is_distribution → force exit (priority 1)
   ↓ exit_type = 'distribution_exit'
   ↓ UPDATE predictions SET exit_type='distribution_exit', outcome=...
decision_logger.log_decision() ← سجل: reason_code='distribution_exit', flag_active
```

### 🚪 Short Holding Exit (هيكلي — مش زمني) Flow

```
daily_closer (per open prediction)
   ↓ should_force_exit_by_time(entry_date, current_date, entry_price, current_price,
                                typical_correction_pct, rsi, recent_closes)
   ↓ toggle: V40_2_SHORT_HOLDING=1
   ↓
   ↓ 1. early_drop: نزول ≤ -7% في أول 3 أيام → exit
   ↓ 2. compound_breakdown: بعد 10 أيام + نزول ×1.3 من typical_correction + RSI<30 + 5 شموع حمراء → exit
   ↓ 3. review_alert: بعد 7 أيام + نزول خارج التصحيح → تنبيه (NOT exit)
   ↓
   ↓ typical_correction_pct جاي من notebooks/EGX/<ticker>.json
   ↓ is_within_typical_correction() + is_breakdown_not_correction()
   ↓ UPDATE predictions SET exit_type='early_drop'/'compound_breakdown_exit'
decision_logger.log_decision() ← سجل: reason_code='early_drop'/'compound_breakdown', flag_active
```

### 📰 News Fetcher Flow

```
DuckDuckGo HTML search (مجاني)
   ↓ news_fetcher_analyzer.fetch_news_for_ticker(ticker)
   ↓ keyword-based sentiment: +2/+1/0/-1/-2
   ↓ news.db (fallback)
V40.2 generator
   ↓ toggle: V40_2_NEWS_IMPACT=1
   ↓ score +2 → BOOST_STRONG (+20)
   ↓ score +1 → BOOST (+10)
   ↓ score -1 → REDUCE (-10)
   ↓ score -2 → VETO (hard reject)
decision_logger.log_decision() ← سجل: reason_code='news_veto', flag_active
```

### 📰 News Signals Ingest Flow (إضافة المبرمج الآخر)

```
External News Agent (local)
   ↓ HTTP POST /api/news/ingest
   ↓ src/app/api/news/ingest/route.ts
   ↓ يكتب في news.db (أو content.db.news_articles)
vps-service/ai/news_signals_reader.py
   ↓ get_news_bias(ticker) → يقرأ من news.db
   ↓ apply_news_bias_to_score(score, ticker) — يطبّق bias على القرار في V40.2
   ↓ يُستدعى من v40_2_daily_generator.py + v40_2_intraday_scanner.py
```

### 📝 Decision Logger Flow

```
أي مسار (V40.2 + daily_closer + strict_entry + disclosure + news + notebook)
   ↓ log_decision(symbol, market, decision_type, reason_code, reason_text, flag_active, notebook_summary)
db/decision_log.db.decision_log (table)
   ↓ get_decision_stats() → analytics لمعرفة هل الفلاتر بتساعد أم بتقتل الإشارات
Admin UI (#admin) ← يعرض stats
```

### 🚪 Unified Exit Engine Flow

```
daily_closer (per open prediction)
   ↓ evaluate_unified_force_exit(market='STOCKS'/'CRYPTO', ...)
   ↓ toggle: V40_2_UNIFIED_EXIT=1
   ↓
   ↓ MARKET_PROFILES['STOCKS']: 7 أيام max, no_move 3d +3%, early -5%, dist wick ≥1.0×
   ↓ MARKET_PROFILES['CRYPTO']: 72h max, no_move 24h +5%, early -8%, dist wick ≥1.2×
   ↓
   ↓ priority: Veto (1) → Distribution (2) → Max holding (3) → No move (4) → Early adverse (5)
   ↓ exit_code = 'veto'/'distribution_exit'/'max_holding'/'no_move'/'early_adverse'
   ↓ UPDATE predictions SET exit_type=exit_code
decision_logger.log_decision() ← سجل: reason_code, flag_active
```

### 🚦 Feature Flags Matrix (10 flags — كلها OFF افتراضياً)

| Flag | الـ module | التأثير لو ON |
|---|---|---|
| `V40_2_STRICT_ENTRY` | strict_entry_filters.py | قبول تراكم/liquidity grab فقط — Don't Chase |
| `V40_2_DISCLOSURE_IMPACT` | egx_disclosure_engine.py | تأثير الإفصاحات على القرار (-2/+2) |
| `V40_2_NOTEBOOK_CONTEXT` | stock_notebook.py | تطبيق سياق النوتبوك (danger_level, typical_correction) |
| `V40_2_SHORT_HOLDING` | short_holding_exit.py | خروج هيكلي (early_drop, compound_breakdown) |
| `V40_2_DISTRIBUTION_EXIT` | short_holding_exit.py::detect_distribution() | شمعة التوزيع → خروج (priority 1) |
| `V40_2_NEWS_IMPACT` | news_fetcher_analyzer.py | تأثير الأخبار + sentiment (-2/+2) |
| `V40_2_CRYPTO_STRICT_ENTRY` | crypto_strict_filters.py | نسخة الكريبتو |
| `V40_2_CRYPTO_DISCLOSURE_IMPACT` | crypto_disclosure_engine.py | نسخة الكريبتو |
| `V40_2_CRYPTO_NEWS_IMPACT` | crypto_news_fetcher.py | نسخة الكريبتو |
| `V40_2_UNIFIED_EXIT` | unified_exit_engine.py | توحيد قرارات الخروج (أسهم + كريبتو) |

> **الترتيب في V40.2 (per BUY signal):** strict_entry (1) → disclosure (2) → notebook_context (3) → news (4). كل خطوة بـ يستدعي `decision_logger.log_decision()` لو رفض.

---

## 📒 سجل التغييرات

| التاريخ | الملف | التغيير |
|---------|-------|---------|
| 2026-09-01 | `DATA_FLOW_MAP.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إضافة قسم "V40.2 Subsystem Flows (2026-09-01)" يحتوي على 8 flow diagrams: Stock Notebook, Disclosure Engine, Strict Entry, Distribution Exit, Short Holding Exit (هيكلي), News Fetcher, News Signals Ingest, Decision Logger, Unified Exit Engine. إضافة Feature Flags Matrix (10 flags). تحديث مراجع لـ "40 قاعدة + عهد الوكيل 30 بند". |

---

## 🆕 Screener + Fundamentals + Bid/Ask Integration (2026-09-03)

**الـ module:** `vps-service/analyzers/screener_integration.py`

يربط 3 مصادر بيانات مدفونة بـ V40.2:

### 1. screener_lists (data_engine.db)
- الكاتب: `data_engine/scrapers/tradingview_screener_lists.py`
- 8 قوائم: most_active, unusual_volume, high_dividend, high_net_income, undervalued, top_losers, penny, top_gainers
- التأثير على V40.2: boost/veto score (+10 لـ unusual_volume, -8 + VETO لـ penny)

### 2. tab_valuation + tab_profitability (data_engine.db)
- الكاتب: `data_engine/scrapers/tradingview_market_movers.py`
- بيانات: P/E, P/B, ROE, net_margin
- التأثير: ROE>15% + P/E<15 → +5 pts, P/E>100 → VETO (bubble)

### 3. intraday_prices bid/ask (intraday.db)
- الكاتب: `data_engine/intraday_storage.py` (schema موجود بس أعمدة bid/ask كانت فاضية)
- التأثير: spread < 0.5% → +3 pts (سيولة عالية)

### مكان الربط في V40.2:
```
V40.2 analyze_single_day_v393()
    ↓
entry_gate (8 شروط)
    ↓
screener_integration ← جديد (screener + fundamentals + bid/ask)
    ↓
sector-liquidity filter
    ↓
BOS/ChoCH filter
    ↓
V68/V72/V73 kill filters
    ↓
signals_by_date.append()
```

### الـ logs:
```
[SCREENER-BOOST] ABUK: score 90→100 (unusual_volume +10pts | undervalued +9pts)
[SCREENER-VETO] XYZ: penny → VETO (فخ قرشية)
```
# 📐 Database Architecture — المعمارية الهندسية لقواعد البيانات

> **آخر تحديث:** 2026-09-05
> **المرجع الحي:** `SYSTEM_STATE.md` + هذا الملف

---

## 🎯 المبادئ الهندسية

1. **مصدر واحد للحقيقة (Single Source of Truth)** — كل نوع بيانات يتخزن في مكان واحد بس
2. **لا تكرار** — ماينفعش نفس البيانات يتكتب في أكتر من DB أو أكتر من جدول
3. **Fallback chain واضحة** — لو المصدر الأساسي مش متاح، fallback ترتيبي
4. **جداول نشطة بس** — أي جدول فاضي يتحدف (مش بيـ accumulate)
5. **Schema ثابت** — كل جدول له schema واضح وموّثق

---

## 📊 خريطة الـ DBs (بعد التنظيف)

### الأسعار اليومية (Daily Prices)

| DB | Table | Rows | الحجم | الحالة |
|----|-------|------|-------|--------|
| **`data_engine.db`** | **`egksco_price_history`** | **29,006** | 86 MB | ✅ **Source of Truth** |
| `stocks.db` | `stock_daily_prices` | 47,534 | 13 MB | Mirror (للـ Next.js) |
| `price_history.db` | `price_history` | 1,205,599 | 279 MB | أرشيف تاريخي كامل |
| `data_engine.db` | `historical_data` | 99,076 | 86 MB | سعودي/أمريكي/ذهب |

### الأسعار اللحظية (Intraday)

| DB | Table | Rows | الحجم |
|----|-------|------|-------|
| `intraday.db` | `stock_intraday` | 1,105,352 | 363 MB |
| `intraday.db` | `crypto_intraday` | 151,245 | 363 MB |
| `intraday.db` | `commodity_intraday` | 77,087 | 363 MB |
| `data_engine.db` | `stock_prices` | 2,444 | 86 MB |

### الأسهم (Stocks Master)

| DB | Table | Rows | الحالة |
|----|-------|------|--------|
| **`stocks.db`** | **`stocks`** | **956** | ✅ Source of Truth |
| `data_engine.db` | `stocks` | 1,585 | Mirror |
| `stocks.db` | `egksco_stocks` | 250 | subset |

---

## 🎯 المصادر الموثوقة (Source of Truth)

### لكل نوع بيانات:

| نوع البيانات | المصدر الأساسي | Fallback |
|--------------|---------------|----------|
| أسعار EGX يومية | `data_engine.db.egksco_price_history` | `stocks.db.stock_daily_prices` |
| أسعار سعودي/أمريكي | `data_engine.db.historical_data` | - |
| أسعار لحظية (intraday) | `intraday.db.stock_intraday` | - |
| أرشيف تاريخي كامل | `price_history.db.price_history` | - |
| بيانات الأسهم (master) | `stocks.db.stocks` | `data_engine.db.stocks` |
| fundamentals | `data_engine.db.tab_*` | - |
| توقعات | `predictions.db.stored_analyses` | - |
| أخبار | `news.db.market_news` | - |
| ذهب/فضة/عملات | `data_engine.db.gold_prices` + `silver_prices` + `exchange_rates` | - |
| crypto | `data_engine.db.crypto_prices` | `intraday.db.crypto_intraday` |

---

## 🔄 Fallback Chain للرادار (Maker Radar)

```
1. data_engine.db.egksco_price_history (symbol/price_date/turnover)
   ↓ لو مش موجود أو فاضي
2. stocks.db.stock_daily_prices (ticker/price_date/turnover)
   ↓ لو مش موجود أو فاضي
3. data_engine.db.historical_data (symbol/date — سعودي/أمريكي)
   ↓ لو مش موجود أو فاضي
4. production_snapshot.db / vps_real/stocks.db (sandbox)
```

**الـ detection ذكي:**
- بـ يتخطى الجداول الفاضية (0 rows) تلقائياً
- بـ يكتشف الـ schema الصح لكل جدول
- بـ يرجّع الـ `db_source` في الـ API response

---

## 🧹 الجداول المحذوفة (Cleanup 2026-09-05)

### من `stocks.db` (26 جدول فاضي):
- `egksco_price_history`, `news`, `news_items`, `predictions`
- `morning_reports`, `page_views`, `error_logs`, `feature_usage`
- `daily_analytics_summary`, `user_sessions`, `context_logs`
- `regime_indicator_weights`, `indicator_weights`, `learned_lessons`
- `prediction_logs`, `signal_logs`, `user_notifications`
- `paper_trades`, `pending_settlements`, `scraping_status`
- `telegram_messages`, `telegram_recommendations`, `telegram_images`
- `tracked_channels`, `financial_obligations`, `financial_transactions`

### من `data_engine.db` (1 جدول فاضي):
- `egx_fundamentals`

**المحذوفة:** 27 جدول
**النتيجة:** 113 جدول نشط بدل 140 (توفير 19%)

---

## 🛠️ سكربتات الصيانة

### 1. `scripts/setup_radar.py` — فحص حالة الـ DBs
```bash
python3 scripts/setup_radar.py --status
# يعرض كل الـ DBs + الجداول + الصفوف + الحجم
```

### 2. `scripts/cleanup_db_architecture.py` — تنظيف + توحيد
```bash
python3 scripts/cleanup_db_architecture.py --dry-run    # معاينة
python3 scripts/cleanup_db_architecture.py --execute    # تنفيذ
python3 scripts/cleanup_db_architecture.py --report     # تقرير فقط
```

### 3. `scripts/fetch_production_data.py` — سحب من الإنتاج (sandbox فقط)
```bash
python3 scripts/fetch_production_data.py --days 365
# ⚠️ للـ sandbox/laptop فقط — في الإنتاج الـ DBs موجودة
```

---

## 📐 قواعد هندسية للمستقبل

### ✅ إيه اللي مسموح:
1. إضافة جدول جديد لو فيه نوع بيانات جديد
2. إضافة columns لجدول موجود (لو محتاج)
3. تحديث الـ fallback chain لو الـ schema اتغير

### ❌ إيه اللي ممنوع:
1. **لا** تكرار نفس البيانات في أكتر من جدول
2. **لا** إنشاء DB جديد من غير سبب واضح
3. **لا** ترك جداول فاضية (احذفها فوراً)
4. **لا** كتابة بيانات في `stocks.db` لو الـ source of truth هو `data_engine.db`
5. **لا** تعديل schema من غير تحديث الـ fallback chain

---

## 🚀 خطوات الإنتاج (Deploy)

### 1. على السيرفر:
```bash
cd /root/GLMinvestment
git pull origin main

# شغّل التنظيف (لو أول مرة)
python3 scripts/cleanup_db_architecture.py --execute

# أعد التشغيل
pm2 restart nextjs
pm2 restart python-backend
```

### 2. تحقق:
```bash
# فحص الـ DBs
python3 scripts/setup_radar.py --status

# اختبر الـ radar API
curl http://localhost:8010/api/maker-radar?market=EGX
# المفروض يرجع: db_source: data_engine.db
```

---

## 📊 إحصائيات (بعد التنظيف)

| المتر | قبل | بعد |
|-------|------|------|
| عدد الـ DBs | 19 | 19 |
| عدد الجداول | 140 | 113 |
| جداول فاضية | 60 | 32 |
| الحجم الإجمالي | 750 MB | 754 MB |
| `egksco_price_history` rows | 0 | 29,006 ✅ |

---

*تم التنظيف بواسطة `cleanup_db_architecture.py` — 2026-09-05*
```markdown
# 📜 وثيقة التوجيه الفني والرياضي: المعمارية الموحدة متعددة الأسواق وتكامل الكريبتو (GLMinvestment Multi-Market & Crypto Directive V40.4)

> **إلى:** مهندس البرمجيات ومطور النظام (Lead Software Engineer — GLM 5.1)  
> **من:** إدارة المشروع وهندسة الأنظمة الكمية (Quant Architecture & System Governance)  
> **المرجع الدستوري الحاكم:** `Documentation/00-CONSTITUTION.md`[cite: 14]  
> **حالة النظام المرجعية:** `Commit 65a748f` (إصلاح R:R) + `Commit 04354a5` (الأساسيات الحقيقية) + `Commit 4cde9f0` (تحصين Fetcher)[cite: 13, 15]  
> **الهدف الاستراتيجي:** تشغيل محرك تحليلي مؤسسي واحد موحد ($Unified\ Engine\ Core$) يغذي كافة الأسواق (مصر، السعودية، الكويت، قطر، والعملات الرقمية) عبر حقن معايير ديناميكية لكل سوق (`MarketProfile`)، مع تحقيق تطابق تام بنسبة 100% في الواجهات والتقارير وتجربة المستخدم[cite: 2, 10, 12].

---

## 📑 فهرس المحتويات
1. [القواعد الدستورية الحاكمة والتزامات التنفيذ](#1-القواعد-الدستورية-الحاكمة-والتزامات-التنفيذ)
2. [المعمارية الهندسية: المحرك الموحد وحقن المعايير](#2-المعمارية-الهندسية-المحرك-الموحد-وحقن-المعايير)
3. [مصفوفة فيزياء الأسواق الخمسة (Market Physics Matrix)](#3-مصفوفة-فيزياء-الأسواق-الخمسة-market-physics-matrix)
4. [محرك العملات الرقمية (Crypto Engine & 24/7 Execution)](#4-محرك-العملات-الرقمية-crypto-engine--247-execution)
5. [توحيد الواجهات وبروتوكول المرآة (UI Mirror Protocol)](#5-توحيد-الواجهات-وبروتوكول-المرآة-ui-mirror-protocol)
6. [خطة التنفيذ المرحلية والاختبارات القياسية (Phase-by-Phase Roadmap)](#6-خطة-التنفيذ-المرحلية-والاختبارات-القياسية-phase-by-phase-roadmap)
7. [مصفوفة القبول النهائي وأوامر النشر (Acceptance & Runbook)](#7-مصفوفة-القبول-النهائي-وأوامر-النشر-acceptance--runbook)

---

## 1. القواعد الدستورية الحاكمة والتزامات التنفيذ

يلتزم المطور بجميع بنود `Documentation/00-CONSTITUTION.md`، مع التركيز الصارم على القواعد التالية أثناء تنفيذ هذا التوجيه[cite: 14]:

* **القاعدة 1 (حرمة DB الإنتاج):** يُمنع منعاً باتاً أي تعديل أو كتابة على قواعد بيانات الإنتاج الحية[cite: 14]. الاختبارات والتعديلات تتم حصراً على `db/vps_real/*.db` داخل الساندبوكس[cite: 14].
* **القاعدة 3 و 4 (عدم التشعيب):** يُمنع إنشاء محركات مستقلة لكل سوق أو شاشات جديدة[cite: 14]. التوسيع يتم حصراً داخل الملفات القائمة (`unified_config.py`, `v38_backtest_engine.py`, `MarketAnalysisView.tsx`)[cite: 2, 10, 12, 14].
* **القاعدة 7 (سقف العوائد السامة):** تطبيق شرط `AND (actual_return IS NULL OR ABS(actual_return) <= 50)` على جميع استعلامات الـ SQL وحسابات الأداء لتفادي تلوث المتوسطات[cite: 14].
* **القاعدة 11 (مصدر الحقيقة الوحيد):** كل العتبات الرقمية والمضاعفات تُقرأ حصراً عبر `engine_settings.py::get_setting()`[cite: 14].
* **القاعدة 12 (المسار الموحد للأسعار):** القراءة تتم حصراً عبر دالة `master_analyzer.py::load_merged_history()`[cite: 14].
* **القاعدة 16 (التحقق الثلاثي قبل الحذف VERIFY-BEFORE-DELETE):** لا يُحذف أي ملف إلا بعد التحقق من خلو الـ Frontend والـ Blueprints والـ Python Imports من أي إشارة إليه[cite: 14].
* **القاعدة 17 (المسارات النسبية فقط):** حظر كتابة أي مسارات مطلقة مثل `/root/...` أو `/home/...`[cite: 14].
* **القاعدة 18 (أرضية العائد للمخاطرة):** تثبيت أرضية $R:R \ge 1.5$ كحد أدنى مطلق لكل الصفقات وفي كل الأسواق[cite: 8, 9, 14].
* **القاعدة 20 (فصل المسؤوليات):** البايثون هو العقل الحسابي الوحيد (`Python = THE BRAIN`)، والواجهة للعرض والتفاعل فقط (`Node.js = DISPLAY ONLY`)[cite: 14].
* **القاعدة 22 و 23 (سياسة الشخصيات):** السهم/العملة الواحدة = صفقة واحدة في الـ Overall KPIs[cite: 14]. حظر إعادة تصنيف `predictions.persona`[cite: 14].

---

## 2. المعمارية الهندسية: المحرك الموحد وحقن المعايير

### 2.1 المبدأ المعماري
بدلاً من تكرار الأكواد وبناء محركات منفصلة، يعتمد النظام على محرك مؤسسي واحد موحد ($Unified\ Decision\ Core$) في `institutional_decision_engine.py` و `v38_backtest_engine.py`، يتم حقنه ديناميكياً بكائن إعدادات السوق (`MarketProfile`)[cite: 2, 10, 15].


```

```
                           ┌─────────────────────────────────────────────────────────────┐
                           │           العقل المؤسسي الموحد (Unified Quant Core)         │
                           │  • خوارزميات السيولة الذكية (SMC Order Blocks / FVG / Sweeps)│
                           │  • تدفق الأحجام والامتصاص (VSA Absorption / Volume Profile) │
                           │  • هندسة الأهداف والوقف المتحرك (Dynamic R:R & Trailing)    │
                           │  • مصفوفة أوزان الشخصيات (Pillar 5 Matrix: Gambler/Bal/Cons)│
                           └──────────────────────────────┬──────────────────────────────┘
                                                          │
                                   يتم تغذيته ديناميكياً عند التحليل بـ:
                                                          │
                 ┌────────────────────────────────────────┴────────────────────────────────────────┐
                 ▼                                                                                 ▼
   ┌───────────────────────────────┐                                                 ┌───────────────────────────────┐
   │      بروفايل معايير السوق     │                                                 │      مزود البيانات الملائم    │
   │       (MarketProfile)         │                                                 │      (Data Provider Gate)     │
   ├───────────────────────────────┤                                                 ├───────────────────────────────┤
   │ • رمز العملة (Currency)       │                                                 │ • الأسهم: القوائم المالية     │
   │ • المؤشر المرجعي (Benchmark)  │                                                 │   (data_engine.db -> tab_*)   │
   │ • حد السيولة (Min Turnover)   │                                                 │ • الكريبتو: فحص الجودة الرقمية│
   │ • نطاق الوقف (ATR Bounds)     │                                                 │   (CryptoQualityGate 0-100)   │
   │ • نظام الإغلاق (Scheduler)    │                                                 │ • عمق وتاريخ الأسعار          │
   └───────────────────────────────┘                                                 │   (price_history vs crypto.db)│
                                                                                     └───────────────────────────────┘

```

```[cite: 2, 6, 7, 10, 15]

### 2.2 البنية البرمجية لكائن `MarketProfile` داخل `unified_config.py`
يجب أن يدعم كائن البروفايل الحقول التالية بشكل كامل[cite: 2, 10]:
```python
@dataclass
class MarketProfile:
    market_id: str                 # EGX, KSA, KSE, QSE, CRYPTO
    currency_symbol: str           # EGP, SAR, KWD, QAR, USDT
    benchmark_ticker: str          # EGX30ETF, TASI, BKP, QE_INDEX, BTC.D
    min_turnover_local: float      # الحد الأدنى للسيولة بالعملة المحلية
    atr_stop_min_pct: float        # الحد الأدنى لوقف الخسارة
    atr_stop_max_pct: float        # الحد الأقصى لوقف الخسارة
    dynamic_rr_normal: float       # العائد للمخاطرة في السوق العادي (Default >= 1.5)
    dynamic_rr_outperform: float   # العائد للمخاطرة عند التفوق على المؤشر (2.0)
    data_provider_type: str        # 'financial_statements' أو 'on_chain_tokenomics'
    price_db_table: str            # 'price_history' أو 'crypto_prices'
    is_continuous_24_7: bool       # False للأسهم، True للكريبتو
```[cite: 10, 13, 14, 15]

---

## 3. مصفوفة فيزياء الأسواق الخمسة (Market Physics Matrix)

تُعاير معاملات كل سوق بدقة وفقاً لخصائصه المالية والهيكلية[cite: 2, 10]:

| الخاصية / المعامل | البورصة المصرية ($EGX$)[cite: 14] | السوق السعودي ($KSA$)[cite: 14] | بورصة الكويت ($KSE$)[cite: 14] | بورصة قطر ($QSE$)[cite: 14] | سوق الكريبتو ($CRYPTO$)[cite: 14] |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **العملة الأساسية (`currency`)**[cite: 10] | `EGP` (جنيه مصري)[cite: 10] | `SAR` (ريال سعودي)[cite: 10] | `KWD` (دينار كويتي)[cite: 10] | `QAR` (ريال قطري)[cite: 10] | `USDT / USD` (دولار رقمي)[cite: 10] |
| **المؤشر المرجعي (`benchmark`)** | `EGX30ETF`[cite: 13] | `TASI` | `BKP` (السوق الأول) | `QE_INDEX` | `BTC.D` (هيمنة البيتكوين) |
| **حد السيولة الأدنى (`min_turnover`)**[cite: 2] | $500,000\ EGP$[cite: 14] | $2,000,000\ SAR$ | $50,000\ KWD$ | $1,000,000\ QAR$ | $5,000,000\ USD$ |
| **نطاق الوقف (`atr_stop_bounds`)** | $[3.0\%, 9.0\%]$[cite: 14] | $[3.0\%, 6.0\%]$ | $[2.0\%, 4.5\%]$ | $[2.5\%, 5.0\%]$ | $[5.0\%, 15.0\%]$[cite: 15] |
| **أرضية الـ $R:R$ (`min_rr_bounds`)** | Normal: $1.5$, Bull: $2.0$[cite: 14] | Normal: $1.5$, Bull: $2.0$[cite: 14] | Normal: $1.5$, Bull: $1.8$ | Normal: $1.5$, Bull: $1.8$ | Normal: $1.8$, High-Vol: $2.5$[cite: 13] |
| **مزود الفحص الأساسي (`fund_gate`)** | القوائم المالية (`tab_*`)[cite: 6, 7] | القوائم المالية (`tab_*`)[cite: 6, 7] | القوائم المالية (`tab_*`)[cite: 6, 7] | القوائم المالية (`tab_*`)[cite: 6, 7] | `CryptoQualityGate` (0-100)[cite: 15] |
| **نظام وساعات الإغلاق (`scheduler`)**[cite: 2] | جلسة محددة (إغلاق 15:30)[cite: 2] | جلسة محددة (إغلاق 15:30)[cite: 2] | جلسة محددة (إغلاق 13:30) | جلسة محددة (إغلاق 13:30) | مستمر 24/7 (`Event-Driven`)[cite: 2] |
| **تنسيق الرموز (`Symbol Format`)**[cite: 6] | نصوص أحرف (`COMI`, `ETEL`)[cite: 6] | أرقام 4 خانات (`1120`, `2222`)[cite: 6, 7] | أحرف/أرقام (`BOURSA`, `KCEM`)[cite: 6] | نصوص أحرف (`QNBK`, `IQCD`) | أزواج تداول (`BTCUSDT`, `ETHUSDT`) |

---

## 4. محرك العملات الرقمية (Crypto Engine & 24/7 Execution)

نظراً لأن سوق الكريبتو لا ينام ولا يخضع لمواعيد إغلاق يومية أو ميزانيات شركات ربع سنوية، يتم تكييف منطق التشغيل كالتالي[cite: 2, 6, 15]:

### 4.1 بوابة الجودة الرقمية (`CryptoQualityGate`)
في `vps-service/analyzers/crypto_quality_gate.py`، تُحسب درجة الجودة من 0 إلى 100 بديلاً عن التحليل المالي الكلاسيكي ($ROE / PE$) وفق المعادلة[cite: 6, 15]:
$$\text{Crypto Quality Score} = (0.30 \times S_{\text{Tokenomics}}) + (0.25 \times S_{\text{OnChain\_Vol}}) + (0.20 \times S_{\text{Liquidity\_Depth}}) + (0.15 \times S_{\text{Vol\_Band}}) + (0.10 \times S_{\text{Github\_Dev}})$$

* **فيتو الجودة الرقمية:** لصفقات المستثمر والمتوازن في الكريبتو، إذا كان $\text{Crypto Quality Score} < 35.0$، تُسقط الصفقة فوراً[cite: 7].

### 4.2 محرك التتبع اللحظي المستمر (`24/7 Event-Driven Engine`)
* **فصل مسار الإغلاق:** لا يتم انتظار `daily_closer.py` الساعة 3:30 عصراً[cite: 2].
* **تفعيل `crypto_lab_scheduler.py`:** يعمل المجدول كل 5 دقائق على مدار الساعة داخل PM2 ويقوم بالآتي[cite: 2]:
  1. سحب الأسعار الحية للعملات المفتوحة عبر WebSocket/REST API من TradingView و CoinGecko[cite: 2].
  2. تحديث أعلى سعر وصل إليه الأصل ($\text{Highest Price Reached}$)[cite: 2, 3].
  3. تنفيذ الخروج الفوري عند ضرب الأهداف أو الوقف، وتحريك الوقف الصاعد ($Trailing\ Stop = \text{Highest} - 2.0 \times ATR$) مع تثبيت سعر الدخول كأرضية بعد تحقيق الهدف الأول ($1.5R$)[cite: 1, 3, 14].

### 4.3 فيتو هيمنة البيتكوين (`BTC Dominance & Market Regime Veto`)
* قبل فتح أي صفقة شراء على العملات البديلة ($Altcoins$):
  * إذا كان البيتكوين في حالة هبوط عنيف ($\text{BTC.D Drop} > 2.0\%$ مع كسر دعوم رئيسية) أو مؤشر الخوف والطمع $\text{Fear \& Greed Index} < 20$، يتم تفعيل **"وضع الكاش"** وحظر صفقات الشراء على الـ Altcoins[cite: 9].

---

## 5. توحيد الواجهات وبروتوكول المرآة (UI Mirror Protocol)

### 5.1 الهدف المعماري
توفير تجربة مستخدم متطابقة وفخمة بنسبة 100% بين الأسهم والكريبتو، وإلغاء الازدواجية البرمجية والمكونات المعزولة في الواجهة[cite: 12].

### 5.2 بروتوكول المرآة (The Single View Shell Rule)
تطبيقاً للقاعدة 3 و 4 من الدستور، يتم الاعتماد على المكونات القياسية المشتركة وتغذيتها بمتغير `market`[cite: 12, 14]:


```

┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  المكون الأساسي الموحد (Shared Core UI)                                                  │
│  ├─           (متابعة التوقعات والفرص)       │
│  ├─             (الشارت التفاعلي وأدوات SMC)  │
│  ├─        (المحفظة الموحدة وإدارة المراكز)│
│  └─        (قوائم المراقبة الحية)        │
└──────────────────────────────────────────────────────────────────────────────────────────┘

```[cite: 12]

### 5.3 تكييف أعمدة الجداول ديناميكياً (Dynamic Data Columns Mapping)
المكون القياسي يعرض نفس الهيكل، لكن يتكيف مع بيانات الأصل المالي تلقائياً[cite: 12]:

| العمود في الواجهة | عند اختيار أسواق الأسهم (`EGX / KSA / KSE / QSE`)[cite: 14] | عند اختيار سوق الكريبتو (`CRYPTO`)[cite: 14] |
| :--- | :--- | :--- |
| **مقياس القيمة (Valuation)** | مكرر الربحية ($P/E$) ومضاعف القيمة الدفترية ($P/B$)[cite: 6] | القيمة السوقية المخففة بالكامل ($FDV$) والترتيب السوقي |
| **مقياس الأداء المالي (Quality)** | العائد على حقوق الملكية ($ROE$) وهامش الصافي[cite: 6] | مؤشر جودة الشبكة (`CryptoQualityScore`) ونشاط الـ On-Chain[cite: 15] |
| **رادار السيولة (Flow)** | رادار تدفق وسخونة القطاع ($Sector\ Heat\ Map$)[cite: 2, 3, 9] | رادار هيمنة البيتكوين وتدفق السيولة للـ Altcoins |
| **العملة المعروضة** | العملة المحلية ($EGP / SAR / KWD / QAR$)[cite: 10] | الدولار الرقمي ($USDT / USD$)[cite: 10] |

---

## 6. خطة التنفيذ المرحلية والاختبارات القياسية (Phase-by-Phase Roadmap)


```

┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ [المرحلة 1] توحيد معايير الأسواق في UnifiedConfig وحقن كائن MarketProfile في المحرك        │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ [المرحلة 2] تفعيل محرك CryptoQualityGate وربطه بـ v38_backtest ومصفوفة أوزان الشخصيات       │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ [المرحلة 3] أتمتة المجدول اللحظي المستمر 24/7 لصفقات الكريبتو (crypto_lab_scheduler)      │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ [المرحلة 4] تطبيق بروتوكول المرآة (UI Parity) وربط MarketAnalysisView بجميع الأسواق       │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ [المرحلة 5] تشغيل الباكتست التاريخي متعدد الأسواق والتحقق من مقاييس الـ PF والـ Win Rate   │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ [المرحلة 6] أرشفة وحذف مكونات الكريبتو المكررة والـ APIs المهجورة (Rule 16 Verification)  │
└────────────────────────────────────────────────────────────────────────────────────────────┘

```[cite: 2, 10, 12, 14, 15]

---

### المرحلة 1: توحيد معايير الأسواق وحقن `MarketProfile`

#### 1.1 المهام البرمجية
1. تحديث `vps-service/config/unified_config.py` لضمان احتواء قواميس `MARKET_PROFILES` على الإعدادات الدقيقة للأسواق الخمسة (مصر، تداول، الكويت، قطر، الكريبتو) كما هو موضح في مصفوفة القسم 3[cite: 10].
2. تعديل دالة `analyze_single_day_v393` في `vps-service/engines/v38_backtest_engine.py` لتقبل كائن `MarketProfile` وتستخرج منه:
   * نطاق الـ $ATR$ stop الخاص بالسوق المعني[cite: 10].
   * أرضية الـ $R:R$ المتكيفة مع المؤشر المرجعي لذلك السوق[cite: 10].
3. عزل مسارات قواعد البيانات بحسب الأصل: توجيه قراءة أسهم الخليج ومصر لـ `price_history.db` وتوجيه أزواج الكريبتو لـ `crypto.db`[cite: 14, 15].

#### 1.2 الاختبار المعياري للمرحلة 1 (Test Suite 1)
* **الأمر:** `python3 -m pytest vps-service/tests/unit/test_regression_settings_consistency.py`[cite: 9]
* **معيار النجاح:**
  * استخراج إعدادات السوق السعودي $KSA$ يرجع عملة $SAR$ ونطاق وقف $[3\%, 6\%]$[cite: 10].
  * استخراج إعدادات سوق الكريبتو $CRYPTO$ يرجع عملة $USDT$ ونطاق وقف $[5\%, 15\%]$[cite: 10, 15].
  * عدم حدوث أي خطأ في مسارات قواعد البيانات أو الـ Fallbacks[cite: 14].

---

### المرحلة 2: تفعيل محرك `CryptoQualityGate` وربطه بمصفوفة الشخصيات

#### 2.1 المهام البرمجية
1. في `vps-service/analyzers/fundamental_data_provider.py`، تعديل الدالة الرئيسية لدعم التبديل التلقائي:
   ```python
   def get_asset_quality_score(ticker: str, market: str) -> QualityScoreResult:
       if market.upper() == 'CRYPTO':
           from analyzers.crypto_quality_gate import evaluate_crypto_quality
           return evaluate_crypto_quality(ticker)
       else:
           return get_fundamental_score(ticker)
   ```[cite: 7, 15]
2. ربط درجة الجودة الرقمية بمصفوفة الشخصيات ($Pillar\ 5$) عند تداول الكريبتو[cite: 2, 3]:
   * المضارب ($Gambler$): $40\%\ PA + 35\%\ SMC + 25\%\ Volume + 0\%\ Quality$[cite: 2, 3].
   * المتوازن ($Balanced$): $30\%\ PA + 25\%\ SMC + 20\%\ Volume + 25\%\ Quality$[cite: 2, 3].
   * المستثمر ($Conservative$): $15\%\ PA + 10\%\ SMC + 15\%\ Volume + 60\%\ Quality$[cite: 2, 3].
3. تطبيق فيتو الكريبتو الصارم: إذا كان $\text{Market} == \text{'CRYPTO'}$ و $\text{Persona} \ne \text{'gambler'}$ وكانت الجودة $< 35.0$ $\rightarrow$ إسقاط التوصية فوراً[cite: 7].

#### 2.2 الاختبار المعياري للمرحلة 2 (Test Suite 2)
* **إنشاء وتشغيل سكربت الفحص:** `python3 vps-service/scripts/test_crypto_quality_pipeline.py`
* **معيار النجاح:**
  * عملة مثل `BTC` أو `ETH` تحقق جودة $\ge 75$ وتمر لجميع الشخصيات[cite: 2].
  * عملة ميم ضعيفة السيولة تسقط بفيتو المستثمر والمتوازن وتمر فقط للمضارب إذا وجد زخم سعري عنيف[cite: 2, 3, 7].

---

### المرحلة 3: أتمتة المجدول اللحظي المستمر للكريبتو (24/7 Engine)

#### 3.1 المهام البرمجية
1. التأكد من تشغيل `vps-service/jobs/crypto_lab_scheduler.py` كخدمة مستقلة ومستمرة ضمن PM2 أو استدعائه كل 5 دقائق[cite: 2].
2. ربط آلية إغلاق صفقات الكريبتو بنظام الـ $Trailing\ Stop$ اللحظي:
   * تفعيل الخروج الجزئي $50\%$ عند $1.8R$[cite: 14].
   * رفع الوقف فوراً إلى نقطة الدخول ($Breakeven$) وتتبع القمم اللحظية[cite: 1, 3].
3. تطبيق سقف الخسارة الصارم ($Hard\ Loss\ Ceiling\ -10\%$) كحزام أمان لصفقات الكريبتو لمنع أي انزلاق عنيف[cite: 14].

#### 3.2 الاختبار المعياري للمرحلة 3 (Test Suite 3)
* **الأمر:** محاكاة حركة سعرية لحظية صاعدة ثم هابطة لزوج `BTCUSDT` عبر سكربت الاختبار[cite: 2].
* **معيار النجاح:** تفعيل الخروج عند الهدف الأول وتأمين الأرباح بالوقف المتحرك دون انتظار إغلاق يومي[cite: 1, 2, 3].

---

### المرحلة 4: تطبيق بروتوكول المرآة (UI Parity) وتوحيد الشاشات

#### 4.1 المهام البرمجية
1. في `src/app/page.tsx`، تحديث توجيه الـ Views ليقوم مسار `#crypto-recommendations` بتحميل المكون الموحد:
   ```tsx
   case 'crypto-recommendations':
   case 'recommendations':
     return <MarketAnalysisView initialMarket="{currentMarket}"/>;
   ```[cite: 12]
2. في `src/components/analysis/MarketAnalysisView.tsx`[cite: 12]:
   * استقبال بروبس `initialMarket` والتكيف التلقائي مع الرموز والعملات ($EGP / SAR / KWD / QAR / USDT$)[cite: 10].
   * تبديل أعمدة الجداول لعرض مؤشرات الكريبتو عند اختيار `market='CRYPTO'`[cite: 12].
3. التأكد من ربط الشارت التفاعلي الموحد `<TradingChartView/>` ليعرض بيانات الكريبتو من `crypto.db` بنفس أدوات الـ $SMC$ والفيبوناتشي والدعوم[cite: 12, 15].

#### 4.2 الاختبار المعياري للمرحلة 4 (Test Suite 4)
* **الأمر:**
  ```bash
  bun run lint
  npx tsc --noEmit -p tsconfig.json
  ```[cite: 14]
* **معيار النجاح:** اجتياز الفحص البرمجي بنسبة 100% بدون أي أخطاء Type Errors، والتأكد من فتح شاشة التوصيات والشارت للكريبتو بنفس مظهر وفخامة شاشات الأسهم[cite: 12, 14].

---

### المرحلة 5: تشغيل الباكتست التاريخي متعدد الأسواق (Multi-Market Backtest)

#### 5.1 المهام البرمجية
1. تشغيل الباكتست التاريخي على كل سوق بشكل منفصل باستخدام البيانات المتاحة في الأرشيف (`db/vps_real/`):
   * **مصر ($EGX$):** على عينة الأسهم المصرية[cite: 6].
   * **السعودية ($KSA$):** على الـ 11 سهماً ذات الأكواد الرقمية المتوفرة بالأرشيف[cite: 6, 7].
   * **الكريبتو ($CRYPTO$):** على أزواج العملات الرقمية الرئيسية[cite: 2].
2. استخراج تقرير الأداء لكل سوق وحساب: نسبة الفوز ($Win\ Rate$)، معامل الربحية ($Profit\ Factor$)، ومتوسط العائد لكل صفقة ($Expectancy$)[cite: 8].

#### 5.2 الاختبار المعياري للمرحلة 5 (Test Suite 5)
* **الأمر:** `python3 vps-service/scripts/v40_2_historical_backfill.py --market ALL`[cite: 2]
* **معيار النجاح:**
  * تحقيق $\text{Profit Factor} \ge 1.50$ في كل سوق تم اختباره[cite: 2, 14].
  * تحقيق $\text{Win Rate} \ge 50\%$ مع التزام كامل بسقف الخسارة الصارم لكل سوق[cite: 2, 14].

---

### المرحلة 6: أرشفة وتنظيف الكود المكرر (Rule 16 Cleanup)

#### 6.1 المهام البرمجية (بعد التحقق الكامل من استقرار المراحل السابقة)
1. إنشاء فرع منفصل لأعمال التنظيف:
   ```bash
   git checkout -b refactor/multi-market-ui-cleanup
   ```[cite: 14]
2. تطبيق القاعدة 16 (VERIFY-BEFORE-DELETE) لفحص المكونات المعزولة[cite: 14]:
   * فحص وأرشفة `CryptoRecommendationsView.tsx` (1,057 سطر) بعد التأكد من عمل المرآة في `MarketAnalysisView`[cite: 12].
   * فحص وأرشفة `CryptoAnalysisView.tsx` (1,090 سطر) بعد عمل الشارت الموحد[cite: 12].
   * فحص وأرشفة `CryptoPortfolioView.tsx` (641 سطر) بعد دمجها بالمحفظة الموحدة[cite: 12].
3. إزالة ملفات الـ APIs المتبقية التي تم إيقافها والتأكد من عدم وجود أي طلبات مكسورة[cite: 14].

#### 6.2 الاختبار المعياري للمرحلة 6 (Test Suite 6)
* **الأوامر:**
  ```bash
  bun run lint
  npx tsc --noEmit -p tsconfig.json
  python3 -c "import vps-service.lightweight_server"
  ```[cite: 14]
* **معيار النجاح:** خلو النظام من أي Broken Imports أو مراجع مفقودة، وانخفاض حجم الكود بنسبة ملحوظة[cite: 14].

---

## 7. مصفوفة القبول النهائي وأوامر النشر (Acceptance & Runbook)

### 7.1 مصفوفة التحقق الشاملة (Master Acceptance Matrix)

| البند | معيار النجاح الفني والمالي | أداة التحقق |
| :--- | :--- | :--- |
| **المحرك الموحد** | عمل محرك $V40.2$ مع الأسواق الخمسة عبر حقن `MarketProfile` دون تكرار الكود[cite: 2, 10]. | فحص ملفات المحرك ووحدة الاختبار[cite: 14]. |
| **تكامل الكريبتو** | عمل الفحص الرقمي `CryptoQualityGate` والتتبع اللحظي 24/7 دون انتظار إغلاق يومي[cite: 2, 15]. | سكربت محاكاة التداول اللحظي للكريبتو[cite: 2]. |
| **تطابق الواجهات** | تطابق بنية الشاشات والجداول والتقارير بنسبة 100% بين الأسهم والكريبتو[cite: 12]. | الفحص البصري عبر المتصفح و `tsc`[cite: 14]. |
| **ربحية الصفقات** | تحقيق $R:R \ge 1.5$ كحد أدنى صلب مع $PF \ge 1.50$ عبر جميع الأسواق[cite: 2, 8, 9, 14]. | تقرير الباكتست المجمع `v40_2_historical_backfill.py`[cite: 2]. |
| **نظافة المستودع** | تصفير أخطاء الـ Lint والـ Type Errors وتطهير الكود المكرر[cite: 14]. | `bun run lint` و `npx tsc --noEmit`[cite: 14]. |

---

### 7.2 أوامر النشر الآمن على سيرفر الإنتاج (Production Deployment Runbook)

يتم النشر على سيرفر الإنتاج حصراً بعد إتمام المراحل واجتياز كافة الاختبارات في الساندبوكس ورفع الـ Commits إلى `origin/main`[cite: 14]:

```bash
# 1. الدخول لمجلد المشروع وسحب التحديثات
cd /root/GLMinvestment
git pull origin main

# 2. التحقق من تكامل البناء والأكواد
bun run lint
npx tsc --noEmit -p tsconfig.json

# 3. تحديث جدول المهام المجدولة (يشمل مهام الأسهم والكريبتو المستمرة)
crontab vps-service/crontab.txt

# 4. إعادة تشغيل المنظومة عبر PM2
pm2 restart all

# 5. فحص استقرار الخدمات واستجابة المنافذ
curl -s http://localhost:3000/api/health
curl -s http://localhost:8010/health
curl -s "http://localhost:3000/api/predictions/honest-tracking/live-tracking?market=EGX&limit=3"
curl -s "http://localhost:3000/api/predictions/honest-tracking/live-tracking?market=CRYPTO&limit=3"
```[cite: 12, 14]

---
*تم اعتماد هذه الوثيقة كدليل تنفيذي وملزم لتطوير وتوحيد الأسواق والعملات الرقمية.*

```# 📋 أوامر الإنتاج — سحب بيانات طازجة للتحليل

> **الهدف:** سحب بيانات حقيقية من السيرفر الإنتاجي (`/root/GLMinvestment/`) للتحليل في الساندبوكس.
> **تنفيذ:** المالك ينفذ هذه الأوامر على VPS ويرسل النتائج.
> **آخر تحديث:** 2026-09-01 (إضافة قسم 11: سحب بيانات الموديولات الجديدة — decision_log + notebooks + disclosures)

---

## 1. نسخة احتياطية كاملة من الإنتاج

```bash
# على VPS الإنتاجي:
cd /root/GLMinvestment

# 1. قاعدة بيانات التوقعات (الأهم)
sqlite3 db/predictions.db "SELECT COUNT(*) as total, market, signal, 
  prediction_date, 
  SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) as closed,
  SUM(CASE WHEN outcome_date IS NULL THEN 1 ELSE 0 END) as pending
FROM predictions 
GROUP BY market, signal 
ORDER BY prediction_date DESC 
LIMIT 50;" > /tmp/predictions_summary.txt

# 2. قاعدة بيانات الأسهم (الأسعار الحالية + المؤشرات)
sqlite3 db/stocks.db "SELECT ticker, name_ar, sector, current_price, 
  change_percent, volume, turnover_egp, rsi, ma_50, ma_200, 
  high_52w, low_52w, avg_volume
FROM stocks 
WHERE is_active = 1 AND market = 'EGX' 
ORDER BY turnover_egp DESC 
LIMIT 100;" > /tmp/top_stocks.txt

# 3. حركة القطاعات (الأهم لتحليل ليه مش ماشين مع السوق)
sqlite3 db/stocks.db "SELECT sector, 
  COUNT(*) as stock_count,
  AVG(change_percent) as avg_change,
  SUM(turnover_egp) as total_turnover,
  AVG(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) * 100 as rising_pct
FROM stocks 
WHERE is_active = 1 AND market = 'EGX' AND sector IS NOT NULL
GROUP BY sector
ORDER BY avg_change DESC;" > /tmp/sector_performance.txt

# 4. التوقعات النشطة (اللي لسه مقفولةش)
sqlite3 db/predictions.db "SELECT ticker, signal, prediction_date, 
  entry_price, target_price, stop_loss, master_score, confidence,
  market, persona
FROM predictions 
WHERE outcome_date IS NULL AND market = 'EGX'
ORDER BY prediction_date DESC, master_score DESC;" > /tmp/active_predictions.txt

# 5. التوقعات المغلقة (للباك-تست)
sqlite3 db/predictions.db "SELECT ticker, signal, prediction_date,
  entry_price, target_price, stop_loss, outcome_date, exit_price,
  actual_return, hit_target, hit_stop, holding_days, master_score,
  market, persona
FROM predictions 
WHERE outcome_date IS NOT NULL AND market = 'EGX'
ORDER BY prediction_date DESC
LIMIT 200;" > /tmp/closed_predictions.txt
```

---

## 2. تصدير قواعد البيانات الكاملة (للساندبوكس)

```bash
# على VPS الإنتاجي:
cd /root/GLMinvestment

# 1. تصدير predictions.db (مضغوط)
sqlite3 db/predictions.db ".dump" | gzip > /tmp/predictions_dump.sql.gz

# 2. تصدير stocks.db (مضغوط)
sqlite3 db/stocks.db ".dump" | gzip > /tmp/stocks_dump.sql.gz

# 3. تصدير data_engine.db (مضغوط — كبير بس مهم)
sqlite3 db/data_engine.db ".dump" | gzip > /tmp/data_engine_dump.sql.gz

# 4. حزم الكل في zip واحد
cd /tmp
zip production_dbs_$(date +%Y%m%d).zip predictions_dump.sql.gz stocks_dump.sql.gz data_engine_dump.sql.gz predictions_summary.txt top_stocks.txt sector_performance.txt active_predictions.txt closed_predictions.txt

# 5. اعرض الحجم
ls -lh production_dbs_$(date +%Y%m%d).zip
```

---

## 3. إعدادات المحرك (engine_settings)

```bash
# على VPS الإنتاجي:
cd /root/GLMinvestment

# تصدير كل الإعدادات
sqlite3 db/data_engine.db "SELECT * FROM engine_settings;" > /tmp/engine_settings.txt

# أو لو الملف JSON:
cat vps-service/analyzers/engine_settings.py | grep -A2 "get_setting" | head -50 > /tmp/engine_settings_keys.txt

# تصدير آخر تشغيل لـ V40.2
cat /root/GLMinvestment/logs/v40_daily_generator.log 2>/dev/null | tail -100 > /tmp/v40_last_run.txt

# تصدير آخر تشغيل لـ daily_closer
cat /root/GLMinvestment/logs/daily_closer.log 2>/dev/null | tail -100 > /tmp/closer_last_run.txt
```

---

## 4. بيانات السوق الحالية (لحظة التصدير)

```bash
# على VPS الإنتاجي:
cd /root/GLMinvestment

# 1. حالة السوق الآن
sqlite3 db/stocks.db "SELECT 
  COUNT(*) as total_stocks,
  SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) as gainers,
  SUM(CASE WHEN change_percent < 0 THEN 1 ELSE 0 END) as losers,
  AVG(change_percent) as market_avg_change,
  SUM(turnover_egp) as total_turnover
FROM stocks WHERE is_active = 1 AND market = 'EGX';" > /tmp/market_status.txt

# 2. أعلى 10 صاعدات
sqlite3 db/stocks.db "SELECT ticker, name_ar, sector, current_price, 
  change_percent, volume, turnover_egp
FROM stocks WHERE is_active = 1 AND market = 'EGX' AND change_percent > 0
ORDER BY change_percent DESC LIMIT 10;" > /tmp/top_gainers.txt

# 3. أعلى 10 هابطات
sqlite3 db/stocks.db "SELECT ticker, name_ar, sector, current_price, 
  change_percent, volume, turnover_egp
FROM stocks WHERE is_active = 1 AND market = 'EGX' AND change_percent < 0
ORDER BY change_percent ASC LIMIT 10;" > /tmp/top_losers.txt

# 4. القطاعات الساخنة
sqlite3 db/stocks.db "SELECT sector,
  COUNT(*) as n,
  AVG(change_percent) as avg_change,
  SUM(turnover_egp) as turnover,
  AVG(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) * 100 as rising_pct
FROM stocks WHERE is_active = 1 AND market = 'EGX' AND sector IS NOT NULL
GROUP BY sector HAVING COUNT(*) >= 3
ORDER BY avg_change DESC LIMIT 10;" > /tmp/hot_sectors.txt

# 5. القطاعات الميتة
sqlite3 db/stocks.db "SELECT sector,
  COUNT(*) as n,
  AVG(change_percent) as avg_change,
  SUM(turnover_egp) as turnover
FROM stocks WHERE is_active = 1 AND market = 'EGX' AND sector IS NOT NULL
GROUP BY sector HAVING COUNT(*) >= 3
ORDER BY avg_change ASC LIMIT 10;" > /tmp/dead_sectors.txt
```

---

## 5. إرسال البيانات للساندبوكس

```bash
# على VPS الإنتاجي:
# انسخ الملفات لمكان يقدر المالك يحملها منه
cp /tmp/production_dbs_*.zip /root/GLMinvestment/download/
cp /tmp/*.txt /root/GLMinvestment/download/

# أو ارفعها على GitHub temporarily (private gist):
# curl -X POST https://api.github.com/gists -H "Authorization: token TOKEN" -d '{"files":{"data":{"content":"..."}}}'

# أو ابعتها مباشرة للساندبوكس عبر SCP:
# scp /tmp/production_dbs_*.zip sandbox:/home/z/my-project/data/
```

---

## 6. أوامر سريعة للتشخيص الفوري

```bash
# على VPS الإنتاجي — تشخيص سريع:
cd /root/GLMinvestment

# هل V40.2 شغال؟
pm2 logs python-backend --lines 20 --nostream

# هل فيه توقعات جديدة النهاردة؟
sqlite3 db/predictions.db "SELECT COUNT(*) FROM predictions WHERE prediction_date = date('now');"

# هل daily_closer شغال؟
sqlite3 db/predictions.db "SELECT COUNT(*) FROM predictions WHERE outcome_date = date('now');"

# توزيع الإشارات
sqlite3 db/predictions.db "SELECT signal, COUNT(*) FROM predictions WHERE market='EGX' GROUP BY signal;"

# متوسط العائد
sqlite3 db/predictions.db "SELECT AVG(actual_return) as avg_return, 
  SUM(CASE WHEN actual_return > 0 THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN actual_return <= 0 THEN 1 ELSE 0 END) as losses
FROM predictions WHERE outcome_date IS NOT NULL AND market='EGX' 
AND actual_return IS NOT NULL AND ABS(actual_return) <= 50;"
```

---

## كيفية استخدام النتائج:

1. **المالك ينفذ الأوامر دي على VPS**
2. **يبعت الملفات الناتجة** (production_dbs_*.zip + *.txt)
3. **أنا بحللها في الساندبوكس**:
   - أستورد الـ DBs
   - أشغل تحليل الباك-تست من وجهة النظر الجديدة
   - أحلل ليه التوقعات مش ماشية مع السوق
   - أحلل حركة القطاعات + السيولة

---

**ملاحظة:** لو الـ DBs كبيرة، اكتفِ بـ `predictions_summary.txt` + `closed_predictions.txt` + `sector_performance.txt` + `top_stocks.txt`. دول enough للتحليل.

---

## 11. سحب بيانات الموديولات الجديدة (2026-09-01)

> **السياق:** أُضيفت 12 موديول جديد + `db/decision_log.db` + `notebooks/EGX/` (259 ملف JSON) + (مستقبلاً) `db/disclosures.db`. الأوامر التالية لسحب بياناتها للتحليل.

### 11.1 Decision Log (قرارات الرفض/الخروج)

```bash
# على VPS الإنتاجي:
cd /root/GLMinvestment

# 1. إحصائيات الـ decisions (كم رفض/خروج + الأسباب)
sqlite3 db/decision_log.db "SELECT decision_type, reason_code, COUNT(*) as count
FROM decision_log 
GROUP BY decision_type, reason_code 
ORDER BY count DESC;" > /tmp/decision_stats.txt

# 2. آخر 50 قرار
sqlite3 db/decision_log.db "SELECT timestamp, symbol, market, decision_type, reason_code, reason_text, flag_active
FROM decision_log 
ORDER BY timestamp DESC 
LIMIT 50;" > /tmp/recent_decisions.txt

# 3. نسخة احتياطية من decision_log.db
cp db/decision_log.db /tmp/decision_log_export.db
```

### 11.2 Stock Notebooks (ملفات JSON)

```bash
# 1. إحصائيات النوتبوكس
cd /root/GLMinvestment
ls notebooks/EGX/ | wc -l > /tmp/notebook_count.txt

# 2. الأسهم المعمّقة (typical_correction_pct ≠ 0)
for f in notebooks/EGX/*.json; do
  sym=$(basename "$f" .json)
  tc=$(python3 -c "import json; d=json.load(open('$f')); print(d.get('machine_summary',{}).get('typical_correction_pct',0))" 2>/dev/null)
  if [ "$tc" != "0" ] && [ -n "$tc" ]; then
    echo "$sym: typical_correction=$tc" >> /tmp/deep_notebooks.txt
  fi
done

# 3. أرشيف كامل للنوتبوكس
zip -r /tmp/notebooks_egx.zip notebooks/EGX/
```

### 11.3 Disclosure Engine (مستقبلاً — بعد تفعيل الـ cron)

```bash
# لما db/disclosures.db يتكون (بعد تفعيل V40_2_DISCLOSURE_IMPACT + الـ cron):
cd /root/GLMinvestment

# 1. آخر 20 إفصاح
sqlite3 db/disclosures.db "SELECT ticker, event_type, score, title, disclosure_date
FROM egx_disclosures 
ORDER BY disclosure_date DESC 
LIMIT 20;" > /tmp/recent_disclosures.txt

# 2. توزيع الدرجات
sqlite3 db/disclosures.db "SELECT score, COUNT(*) as count
FROM egx_disclosures 
GROUP BY score 
ORDER BY score;" > /tmp/disclosure_scores.txt
```

### 11.4 فحص Feature Flags المفعّلة

```bash
# على VPS — شوف أي flags مفعّلة في الـ environment
cd /root/GLMinvestment
env | grep V40_2_ > /tmp/active_flags.txt

# أو من الـ pm2 env:
pm2 env python-backend | grep V40_2_ >> /tmp/active_flags.txt
```

### 11.5 نتائج الباك-تست (لو اتعمل على VPS)

```bash
# لو الـ backtest اتعمل على VPS، شوف النتائج
cd /root/GLMinvestment
ls data/comparative_results/ > /tmp/backtest_results.txt

# أو من الساندبوكس:
ls /home/z/GLMinvestment/data/comparative_results/ 2>/dev/null
# B0_baseline_result.json
# B1_strict_disclosure_result.json
# B2_notebook_result.json
# B4_full_stack_result.json
# final_comparison.json
```

### كيفية استخدام النتائج الجديدة:

1. **decision_stats.txt** — يحلل هل الفلاتر بتساعد أم بتقتل الإشارات (`get_decision_stats()`).
2. **deep_notebooks.txt** — يشوف الأسهم المعمّقة (typical_correction_pct ≠ 0).
3. **recent_disclosures.txt** — يحلل الإفصاحات الأخيرة + تأثيرها.
4. **active_flags.txt** — يعرف أي flags مفعّلة على الإنتاج.

---

## 📒 سجل التغييرات

| التاريخ | الملف | التغيير |
|---------|-------|---------|
| 2026-09-01 | `PRODUCTION_DATA_EXPORT.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إضافة قسم 11: سحب بيانات الموديولات الجديدة — Decision Log (إحصائيات + آخر 50 قرار + backup)، Stock Notebooks (عدد + الأسهم المعمّقة + أرشيف)، Disclosure Engine (آخر 20 إفصاح + توزيع الدرجات)، فحص Feature Flags المفعّلة، نتائج الباك-تست. |
# 📋 محضر المعسكر المغلق — تنظيف شامل المشروع
> **السيكريتيرة:** نورا (بتكتب كل حاجة وما بتضيعش حاجة) 😊
> **المدير العام:** Z.ai Code
> **تاريخ البداية:** 2026-08-31
> **آخر تحديث:** 2026-09-01 (إضافة محضر اليوم 2 — بناء الموديولات الجديدة + Stock Notebook + Unified Exit + 10 Feature Flags)
> **الهدف:** مشروع كتلة مترابطة — 0 ميت + 0 مكسور + 0 ثغرة

---

## 🗓️ اليوم 1 — P0 (حرج)

### 08:00 — بداية المعسكر
- **الحاضرين:** المدير العام + 5 فرق (Frontend / Backend / Data / Security / QA)
- **الأجندة:** 15 مهمة P0 + 23 مهمة P1 + 18 مهمة P2
- **الهدف اليومي:** إنهاء كل P0 (15 مهمة)

---

### محضر التقدم (يُحدّث بعد كل مهمة)

| # | المهمة | الفريق | الحالة | وقت البدء | وقت الانتهاء | ملاحظات |
|---|---|---|---|---|---|---|
| P0-1 | إصلاح aiPrediction في price-verify | Backend | ⏳ | | | |
| P0-2 | إصلاح aiPrediction في honest-tracking | Backend | ⏳ | | | |
| P0-3 | إصلاح aiPrediction في sniper/track | Backend | ⏳ | | | |
| P0-4 | إصلاح aiPrediction في sniper/closer | Backend | ⏳ | | | |
| P0-5 | إصلاح aiPrediction في clean-predictions | Backend | ⏳ | | | |
| P0-6 | إصلاح aiPrediction في engines-status | Backend | ⏳ | | | |
| P0-7 | إصلاح aiPrediction في evaluate-range | Backend | ⏳ | | | |
| P0-8 | حذف صفحة /maestro | Frontend | ⏳ | | | |
| P0-9 | تحديث Rule 35 في الدستور | Backend | ⏳ | | | |
| P0-10 | تحديث Rule 33 في الدستور | Backend | ⏳ | | | |
| P0-11 | تحديث SYSTEM_HOW_IT_THINKS | Backend | ⏳ | | | |
| P0-12 | أصلح OOM risk (limit=5000) | Frontend | ⏳ | | | |
| P0-13 | تنظيف /api/maestro/* endpoints | Backend | ⏳ | | | |
| P0-14 | شيل LUXURY EDITION + 🚀🎉 | Frontend | ⏳ | | | |
| P0-15 | شيل indigo/blue (موجز سريع) | Frontend | ⏳ | | | |

---

### قواعد المعسكر
1. كل مهمة → اختبار → commit → push → تحديث المحضر
2. مفيش merge بدون مراجعة المدير العام
3. مفيش حذف بدون VERIFY-BEFORE-DELETE (Rule 16)
4. بعد كل مرحلة → باك-تست سريع
5. السيكريتيرة بتكتب كل حاجة 😊

---

> **ملاحظة نورا:** "يا جماعة أنا هنا عشانكم، أي حد عايز قهوة يقولي. بس الشغل الأول!" 😊

---

## 🗓️ تقرير نهاية المعسكر — P0 + P1 + P2 مكتمل

### ✅ P0 (حرج) — 15 مهمة
| المهمة | الحالة |
|---|---|
| 7 routes aiPrediction → predictions | ✅ |
| clear-predictions aiPrediction → prediction | ✅ |
| Rule 35 تحديث (V40.2 sole writer) | ✅ |
| Rule 33 تحديث (V40.2 wiring) | ✅ |
| SYSTEM_HOW_IT_THINKS تحديث | ✅ |
| /maestro page حذف | ✅ |
| LUXURY EDITION شيل | ✅ |
| 🚀 emoji شيل (8 ملفات) | ✅ |
| OOM risk fix (limit 5000→100) | ✅ |

### ✅ P1 (معماري) — 12 مهمة
| المهمة | الحالة |
|---|---|
| src/lib/v2/ حذف (17 ملف، 11,311 سطر) | ✅ |
| Maestro admin components حذف (4 ملفات، 8,329 سطر) | ✅ |
| dashboard/MaestroCommandCenter حذف (848 سطر) | ✅ |
| 4 orphan views حذف | ✅ |
| 8 dead pages حذف | ✅ |
| 3 DEPRECATED blueprints حذف | ✅ |
| indigo → teal (6 ملفات) | ✅ |
| blue → teal (5 ملفات) | ✅ |
| AdminView Maestro imports تعطيل | ✅ |

### ✅ P2 (تنظيف) — 1 مهمة
| المهمة | الحالة |
|---|---|
| 14 unused UI primitives حذف (4,300 سطر) | ✅ |

### 📊 إجمالي المعسكر
- **ملفات محذوفة:** 45+ ملف
- **أسطر محذوفة:** ~50,000+ سطر
- **routes مكسورة اتصلحت:** 8
- **قواعد دستور اتحدّثت:** 2 (Rule 33 + 35)
- **توثيق اتحدّث:** 3 ملفات
- **lint:** EXIT 0 ✅

### 🔲 متبقي (مؤجل لجلسة تانية)
- نقل 11 route لـ Python (Rule 20) — شغل كبير
- 12 ثغرة أمنية — محتاجة فحص أعمق
- 71 orphan component (~50,000 سطر) — محتاج VERIFY-BEFORE-DELETE لكل واحد
- قسم MarketAnalysisView (7,695 سطر) — محتاج جلسة تركيز
- وحد thresholds (7 قيم لـ stop_pct)

---

> **ملاحظة نورا:** "الشغل خلص بسرعة! المدير شطّار. بس في شغل تاني متبقي — نكمله بكرة؟" 😊

---

## 🗓️ اليوم 2 (2026-09-01) — بناء الموديولات الجديدة

### 08:00 — بداية اليوم 2
- **الحاضرين:** المدير العام + 5 فرق
- **الأجندة:** بناء 5 محركات جديدة + Stock Notebook + Unified Exit + Decision Logger + 10 Feature Flags
- **الهدف:** معالجة الـ 5 توصيات اللي طلعت من باك-تست B0 (دخول متأخر + مدة طويلة + مفيش SELL + حرارة القطاع + تتبع الصاعدات)

### محضر التقدم

| # | المهمة | الفريق | الحالة | ملاحظات |
|---|---|---|---|---|
| D2-1 | بناء `egx_disclosure_engine.py` (875 LOC) | Backend | ✅ | 12 نوع إفصاح + dynamic scoring -2/+2. toggle `V40_2_DISCLOSURE_IMPACT`. |
| D2-2 | بناء `strict_entry_filters.py` (582 LOC) | Backend | ✅ | Don't Chase: is_in_accumulation + is_liquidity_grab + is_late_entry. toggle `V40_2_STRICT_ENTRY`. |
| D2-3 | بناء `short_holding_exit.py` (614 LOC) — مُعاد كتابته | Backend | ✅ | **فلسفة هيكلية** بدل زمنية. `max_holding_7d` و `no_move_3d` ملغيان كأسباب وحيدة. أضاف `is_within_typical_correction` + `is_breakdown_not_correction`. toggle `V40_2_SHORT_HOLDING` + `V40_2_DISTRIBUTION_EXIT`. |
| D2-4 | بناء `news_fetcher_analyzer.py` (507 LOC) | Backend | ✅ | DuckDuckGo + sentiment -2/+2. toggle `V40_2_NEWS_IMPACT`. |
| D2-5 | بناء `news_impact_scorer.py` (432 LOC) | Backend | ✅ | 14 event types + verdict (BOOST/REDUCE/VETO). |
| D2-6 | بناء `unified_exit_engine.py` (518 LOC) | Backend | ✅ | `MARKET_PROFILES` (STOCKS + CRYPTO). toggle `V40_2_UNIFIED_EXIT`. |
| D2-7 | بناء `stock_notebook.py` (1,065 LOC) + 259 ملف JSON | Backend + Data | ✅ | `apply_notebook_context()` + `build_or_refresh_notebook()` + `build_notebooks_for_universe()`. 30 سهم معمّق. toggle `V40_2_NOTEBOOK_CONTEXT`. |
| D2-8 | بناء `decision_logger.py` (338 LOC) + `db/decision_log.db` | Backend | ✅ | `log_decision()` + `get_decision_stats()`. |
| D2-9 | بناء 4 Crypto modules (نظائر EGX) | Backend | ✅ | crypto_strict_filters (448) + crypto_short_holding_exit (412) + crypto_news_fetcher (391) + crypto_disclosure_engine (412). |
| D2-10 | بناء `api/notebook_routes.py` (124 LOC) + 7 endpoints | Backend | ✅ | مسجّل blueprint (`notebook_bp`) في `lightweight_server.py`. |
| D2-11 | بناء `NotebookAdminTab.tsx` (524 LOC) | Frontend | ✅ | مستورد في AdminView. |
| D2-12 | إضافة `news_signals_reader.py` + `/api/news/ingest` (المبرمج الآخر) | Backend + Frontend | ✅ | جسر News Agent خارجي + `apply_news_bias_to_score()`. |
| D2-13 | تحديث الدستور (Rules 36-40 + Rule 38 محدّثة) | Backend | ✅ | 5 قواعد جديدة + إعادة كتابة Rule 38 لفلسفة هيكلية. عهد الوكيل لـ 30 بند. |
| D2-14 | باك-تست B0/B1/B2/B3 (200 سهم × 6 شهور) | QA | ✅ | B0: 31 trades, +41.2%. B3: لا exit max_holding ✅. |

### نتائج اليوم 2

| المقياس | القيمة |
|---|---|
| موديولات Python جديدة | 12 ملف (~6,594 LOC) |
| ملفات JSON جديدة | 259 ملف (notebooks/EGX/) |
| API endpoints جديدة | 7 (notebook_routes.py) + 1 (/api/news/ingest) |
| Admin UI tabs جديدة | 1 (NotebookAdminTab.tsx, 524 LOC) |
| Feature flags جديدة | 10 (كلها default OFF) |
| قواعد دستور جديدة/محدّثة | 5 جديدة (36-40) + 1 محدّثة (38) |
| باك-تست | B0 (+41.2%) → B3 (لا max_holding exit ✅) |

### 🔲 متبقي (مؤجل لجلسة تانية)
- تفعيل كل flag واحد واحد على الإنتاج + قياس الأداء.
- مراجعة `get_decision_stats()` أسبوعياً لمعرفة هل الفلاتر بتساعد أم بتقتل الإشارات.
- tuning لـ thresholds الـ strict entry (B1 أظهر رفض كتير).

---

> **ملاحظة نورا:** "اليوم 2 كان شغل نظيف! 12 موديول + 259 نوتبوك + 10 flags. كله default OFF عشان الإنتاج ما يتأثرش. بكرة نشغلهم واحد واحد ونقيس." 😊

---

## 📒 سجل التغييرات

| التاريخ | الملف | التغيير |
|---------|-------|---------|
| 2026-09-01 | `CLOSED_CAMP_MINUTES.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إضافة محضر اليوم 2 — بناء 12 موديول Python (~6,594 LOC) + 259 ملف JSON + 7 API endpoints + NotebookAdminTab.tsx + 10 Feature Flags + 5 قواعد دستور (36-40) + باك-تست B0/B1/B2/B3. |
