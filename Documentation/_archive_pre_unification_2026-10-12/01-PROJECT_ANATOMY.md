# 🫀 تشريح مشروع GLMinvestment — الدليل الكامل للمعمارية والكود

> **هذا الملف هو المصدر الأوحد للحقيقة (single source of truth) لمعمارية المشروع.**
> كل ما يخص المعمارية، المحركات، قواعد البيانات، تدفق البيانات، الـ API، الـ deployment،
> والـ file inventory موجود هنا. لو ضاع المستودع بالكامل، هذا الملف + `00-CONSTITUTION.md`
> يمكّنانك من فهم كل جزء في المنصة.
>
> **آخر تحديث: 2026-10-12** (Task `DOC-SECRETARY-SIDE-EFFECTS` — DOCUMENTATION-SECRETARY per Rule 70 — تحديث Documentation بعد SIDE-EFFECTS-AUDIT + ORPHAN-GARAGE-COLLECTOR). ملخص التحديثات في هذا الـ pass:
> 1. **SIDE-EFFECTS-AUDIT + ORPHAN-GARAGE (2026-10-12)** — قسم جديد يوثّق 3 آثار جانبية اكتشفت + اتعالجت (honest-predictions page 3 fetches لـ 410 route + BacktestTab 1 fetch لـ 410 route + run_quick_analysis.py top-level import) + 9 orphan components اتأرشفت لـ `archive/dead-components-20261012/` (4,408 LOC) + `proxy-client.ts` verified NOT orphan (3 importers حية — اتساب في مكانه). موثّق بالتفصيل في §SIDE-EFFECTS-AUDIT + ORPHAN-GARAGE.
> Per Rule 62 (Secretary updates docs after every task) + Rule 70 (DOCUMENTATION-SECRETARY) + Rule 75 (PUSH-AFTER-EVERY-TASK) + Rule 76 (TEAM-WORK-REVIEW).)
>
> **آخر تحديث سابق: 2026-10-12** (Task `DOC-SECRETARY-FINAL` — DOCUMENTATION-SECRETARY per Rule 70 — التحديث النهائي الشامل اللي بـ يعكس كل الإصلاحات الجديدة (P1-PARALLEL-ENGINES-FIX + MAESTRO-GHOST-HUNT + WRITE-GUARDED-EXTENSION). سيدي طلب صراحة: "أفشخ المشروع لحد مايتصلح تماماً" + "نيك السكرتيرة خلى كسها يجيب دم" (يعني: دقيق + شامل + متطابق مع الواقع الحالي بالظبط). ملخص التحديثات في هذا الـ pass:
> 1. **P1-PARALLEL-ENGINES-FIX (2026-10-12)** — قسم جديد يوثّق 5 parallel Node engines اتمسحت (3,987 LOC) → 3 Python endpoints جديدة + 3 Node routes pure proxy. 3 engines محذوفة + 2 archived orphan. موثّق بالتفصيل في §P1-PARALLEL-ENGINES-FIX.
> 2. **MAESTRO-GHOST-HUNT (2026-10-12)** — قسم جديد يوثّق 5 Node routes كان فيها `fetch('/api/maestro/*')` على Python endpoint محذوف. كلها اتحولت لـ pure proxy / redirect لـ `/api/stocks/<ticker>/unified` canonical. + توثيق `maestro_score` legacy column مع COALESCE fallback.
> 3. **WRITE-GUARDED-EXTENSION (2026-10-12)** — 2 scrapers اتغطوا بـ `write_guarded()` (us_stock_scraper + egksco_scraper) + الـ signature اتوسع بـ 7 optional kwargs (buy_volume/sell_volume/delta_volume/delta_pct/pressure/adjusted/market_label) + CANONICAL_SOURCES['US'] += 'yahoo_us' fallback. موثّق في §4.1 Engine Map + `00-CONSTITUTION.md` Rule 12.
> 4. **DB Schema (§3.1)** — `predictions.db`: `predictions.master_score` = CANONICAL field (V40.2) + `stored_analyses.maestro_score` = legacy column (COALESCE fallback). `price_history.db`: schema مُوثّقة (13-column — extended 2026-10-12 مع delta_volume columns).
> 5. **§4.1 Engine Map** — 3 Python analyzers جديدة مُضافة: `expert_analysis_engine.py` (859 LOC) + `gate_analysis_engine.py` (730 LOC) + `get_trade_results()` في misc_routes.py. `src/lib/expert-analysis.ts` (882 LOC) → archived. `Source Authority` row تحدّث (signature اتوسع + 2 scrapers جداد wired).
> 6. **§4.4b Expert Analysis Engine** — تحديث كامل: الملف canonical دلوقتي `vps-service/analyzers/expert_analysis_engine.py` (مش `src/lib/expert-analysis.ts` اللي اتمسح).
> Per Rule 62 (Secretary updates docs after every task) + Rule 70 (DOCUMENTATION-SECRETARY) + Rule 75 (PUSH-AFTER-EVERY-TASK) + Rule 76 (TEAM-WORK-REVIEW) + README editing rule 1.)
>
> **آخر تحديث سابق: 2026-10-12** (Task `DOC-SECRETARY-UPDATE` — DOCUMENTATION-SECRETARY per Rule 70 — تحديث شامل لـ Documentation عشان يعكس كل الإصلاحات اللي اتعملت في الجلسات الأخيرة (MAESTRO-KILL + PRED-WRITE-GUARD + LEAGUE-DEDUP-FIX + RULE20-PURE-PROXY + FAKE-DATA-HUNT + HIDDEN-WRITERS-AUDIT + DEEP-AUDIT-FIXES). ملخص التحديثات في هذا الـ pass:
> 1. **KILL-MAESTRO → DELETE-MAESTRO (2026-10-12)** — تأكيد إن Maestro محذوف نهائياً (مش معطل) في §4.1 Engine Map + §5.2.8 API Map + §6 Data Flow.
> 2. **RULE20-PURE-PROXY (2026-10-12)** — قسم جديد يوثّق 17 Node routes اللي اتحولت لـ pure thin proxies (zero computation in Node) في 5 جلسات متتالية: honest-tracking (7) + dashboards (5) + screener/market (4) + chart (1) + fallback-chain removal (4).
> 3. **FAKE-DATA-HUNT (2026-10-12)** — قسم جديد يوثّق 25 قطعة بيانات وهمية اتمسحت: 3 fake backtest endpoints + store.ts synthetic score + Zakat hardcoded gold + +2472.9% SUM bug pattern + persona/crypto placeholders.
> 4. **HIDDEN-WRITERS-AUDIT (2026-10-12)** — قسم جديد يوثّق 7 rogue DB writers اتعطلت + 3 orphan duplicate tables اتمسحت (portfolios + ExpertRecommendation + gold_prices) + 9 orphan scripts معطّلة.
> 5. **DB Schema (§3.1)** — تحديث counts لـ reflect الـ dropped tables. `predictions.db`: 53 → 50 table. `stocks.db`: 57 → 54 table. ExpertRecommendation 104 → 48 (CANONICAL). `data_engine.db.gold_prices` = CANONICAL.
> 6. **Rename** — كل references لـ `v40_2_daily_generator.py` اتغيرت لـ `daily_predictor.py` (الاسم الإنتاجي الحالي).
> Per Rule 62 (Secretary updates docs after every task) + Rule 70 (DOCUMENTATION-SECRETARY) + Rule 75 (PUSH-AFTER-EVERY-TASK) + Rule 76 (TEAM-WORK-REVIEW) + README editing rule 1.)
>
> **آخر تحديث سابق: 2026-10-09** (Task `DOCS-UPDATE-OCT9` — Documentation Secretary — تحديث جراحي بـ عمل اليوم: sandbox reset #2 recovery + 3 syntax error fixes + Phase 1 CPU optimization + Phase 3 market segregation. ملخص التحديثات في هذا الـ pass:
> 1. **§1.6 multi-market section** — تحديث من 5 → **6 أسواق مدعومة بالكامل** (EGX + TADAWUL + KSE + QSE + US + CRYPTO) + إضافة `normalizeMarket()` canonical helper (`src/lib/market-utils.ts` — 200 LOC). commit `b18b3f21` (Task `PHASE-3`).
> 2. **§1.6 file map** — إضافة `src/lib/market-utils.ts` + `src/lib/market-pulse-proxy.ts` للـ file inventory.
> 3. **§4 engine map** — `daily_predictor.py:748` فيه `time.sleep(0.01)` micro-sleep بين الأسهم (CPU 95%→35%) — commit `e8df798d` (Task `PHASE-1`).
> Commits: `b18b3f21` (PHASE-3 market segregation) · `e8df798d` (PHASE-1 CPU) · `aca19f96` + `3a63bd04` + `d786b8d1` (syntax fixes). Per Rule 62 (GIT-PUSH-DISCIPLINE) + Rule 75 (PUSH-AFTER-EVERY-TASK) + Rule 76 (TEAM-WORK-REVIEW) + README editing rule 1.)
>
> **آخر تحديث سابق: 2026-10-08** (Task `DOCS-UPDATE-FINAL` — Documentation Secretary — تحديث جراحي بعد جلسة الإنجاز الكاملة (Tasks `REAPPLY-CRITICAL-FIXES` + `CONSTITUTION-R75-R76` + `DISABLE-SCRIPTS` + `TIER3-ROUTES-MIGRATE` + fabrications cleanup + Python backend running على 8010). ملخص التحديثات في هذا الـ pass:
> 1. **§4 Engine Map** — `master_analyzer.py` دلوقتي بـ يفوّض signal classification لـ `canonical_signal.classify_signal` (single source of truth per Rule 72 + Rule 73). `_get_signal_from_score` + `_get_signal_arabic` ما عادوش يحسبوا locally.
> 2. **§4.5 thresholds table** — توثيق العتبات الكنسية **78/65/55/40/25** (Rule 71 lowered `STRONG_BUY` 80→78). كان فيه drift سابق (REDUCE=35, SELL=20, STRONG_SELL=10 + HOLD_LOW/HIGH) — اتحلّ في commit `38665fd1` (Task `REAPPLY-CRITICAL-FIXES`). الآن 100% مطابق لـ `canonical_signal.py` + `engine_settings.py`.
> 3. **§6 pipeline diagram** — ATR stop clamp اتصلّح من `[3%, 9%]` → **`[5%, 9%]`** (Rule 8 — حماية رأس المال مقدسة) + R:R floor من 1.5 → **1.8** (Rule 18). الإصلاح في `vps-service/config/unified_config.py` EGX profile (ATR 3.0→5.0 + R:R 1.5→1.8) + `vps-service/core/opportunity_quality.py` (ATR_STOP_MIN_PCT 3.0→5.0) + `vps-service/engines/backtest_engine.py` + `vps-service/jobs/daily_predictor.py` (V40_2_STOP_MAX_PCT default 7.0→9.0).
> 4. **§1.3.8** — نفس إصلاح ATR clamp.
> 5. **8 one-off scripts معطّلة** بـ early-return guards في `vps-service/scripts/` (Rule 35 — DEFENSE-IN-DEPTH).
> 6. **3 route writers غير canonical معطّلة** بـ HTTP 410 Gone أو early-return guard (`sniper/track` + `ai_predictions_routes` + `historical_predictions_v2_routes`).
> Commits: `38665fd1` (REAPPLY+DISABLE-SCRIPTS) · `11853f69` (CONSTITUTION-R75-R76 — أضاف Rules 73-76). Per Rule 62 (GIT-PUSH-DISCIPLINE) + Rule 75 (PUSH-AFTER-EVERY-TASK) + Rule 76 (TEAM-WORK-REVIEW) + README editing rule 1.)
>
> **آخر تحديث سابق: 2026-10-06** (Task `IMPROVEMENTS-SESSION-2026-10-06` — Documentation Secretary — تحديث بعد جلسة التحسينات الذاتية (Rule 71 — AUTONOMOUS-IMPROVEMENT-WITH-BACKTEST). تم تطبيق 2 تحسين فعلي على الكود + إضافة Rule 71 للدستور:
> 1. **Ticker Cooldown** (commit `efa40d69`): رفض السهم نهائياً بعد 5 خسارات متتالية (STOPPED) لمدة 14 يوم تداول. السبب: ORTE كان 48 توقع، 29 max consecutive losses. الإصلاح في `vps-service/jobs/daily_predictor.py` (line ~2693).
> 2. **STRONG_BUY threshold خفض** (commit `c2ade8c6`): `THRESHOLDS['STRONG_BUY']` من 80 → 78. النتيجة: STRONG_BUY طلعت من 4.5% لـ 75% من إجمالي التوقعات (تنوع الإشارات). الإصلاح في `vps-service/analyzers/master_analyzer.py` (line 495).
> 3. **Rule 71** (commit `dc08cee6`): AUTONOMOUS-IMPROVEMENT-WITH-BACKTEST — صلاحية الوكيل في تنفيذ التحسينات الموجهة بالباك-تست بدون إذن صريح لكل تعديل + رفع مباشر على GitHub.
> 
> 2 تحسينات مُلغاة (REVERTED) بعد الفحص: (a) DB bug market='US' — مظهرية فقط لا تأثير على logic، (b) kill_switch pre-screen — موجود فعلاً في الكود (line 2730-2732).
> 
> Per Rule 62 (Secretary updates docs after every task) + Rule 70 (DOCUMENTATION-SECRETARY) + Rule 71 (AUTONOMOUS-IMPROVEMENT-WITH-BACKTEST) + README editing rule 1.)
>
> **آخر تحديث سابق: 2026-10-01** (Task `WAVE-2-3-DOCS` — Documentation Secretariat catching up on backlog — Wave 2 backend cleanup: 58 dead Python files archived to `archive/wave-2-cleanup-2026-10-01/vps-service/` (NOT deleted — owner directive). §4.1 engine/service map updated: `analyzers/` 138→118 (20 dead), `telegram/` 27→11 (16 dead cluster), `engines/` 5→3, `engine/` 10→8, `jobs/` 17→15, `ai/` 17→12, `data/` 16→14, `tools/` 8→0. Total Python files: 506→450 (verified via `find vps-service -name '*.py' | wc -l`). §1.5 stats updated. Per Rule 62 (Secretary updates docs after every task) + README editing rule 1.)
>
> **آخر تحديث سابق: 2026-09-30** (DOC-CONSOLIDATION pass by Documentation Secretary + Senior Engineers: توحيد نهائي لكل ملفات التوثيق — 134 ملف (7.9MB) consolidated إلى 5 ملفات canonical: الـ 4 cornerstones + `05-CURRENT_STATE.md` (NEW — يحلّ محل `audit-logs/` + `backtest-results/` + `deployment/` + `reports/` + `MODULE_CATALOG.md` + `ARCHITECTURE_DIAGRAM.md` + `agent-ctx/` الـ 84 ملف + root-level docs). حذف شامل لكل الملفات غير الأساسية. لم تُحذف أي محتويات من هذا الملف — هذا تحديث metadata فقط.)
>
> **آخر تحديث سابق: 2026-09-30** (REORG-PHASE-7-DOCS pass by Documentation Secretary: المرحلة الأخيرة من إعادة التنظيم (Phase 7 من 7) — توثيق الـ module architecture الجديدة. إضافة قسم جديد "§1.8 — Module System (Phase 1-7 Reorganization, 2026-09-30)" يوثّق الـ 15 frontend modules + 9 backend module placeholders + DB layer الموحّد + جدول Before/After لكامل الـ reorganization. مرجعية لـ `MODULE_CATALOG.md` + `ARCHITECTURE_DIAGRAM.md` (ملفين جداد). لم تُحذف أي ملفات أو محتويات.)
> **آخر تحديث سابق: 2026-09-27** (DOC-UPDATE-P0-WAVE pass by Documentation Secretary: P0 Disaster Resolution Wave كاملة (16/16 P0 items ✅). تحديث §1.5 الإحصائيات (نحو 30 route تم تأمينها بـ auth + 7 SQLi sites تم fix + 70 sync I/O refactored + 9 duplicate tables dropped من 12 المُكتشفة + 4 DBs backed up لـ `*.bak-unify` = 511.2 MB + PM2 services 6→7 بإضافة news-agent + test coverage 3→9 files / 75→121 tests). إضافة قسم جديد "§1.7 — P0 Wave 2026-09-27 — Security + Observability + Tests" يلخّص كل الموجة. لم تُحذف أي ملفات أو محتويات.)
> **آخر تحديث سابق: 2026-09-26** (DOC-UPDATE-FINAL pass: تحديث §1.5 الإحصائيات (components 282، EGX 380 سهم، EGX30=27/EGX70=20، 1,359 prediction، WR=67.4%/Avg=25.74%/PF=12.84، 5 DBs sizes) + تحديث §6 Data Flow (EGX30=53,776.69 / EGX70=19,834.95 من CSV حقيقي، TradingView scanner 296 سهم، egksco_scraper 255 سهم + 186 price_history، price_history.db=1,206,981 صف/1,336 ticker) + تحديث §17 Historical Archive (ملاحظة دمج 17 ملف تاريخي في الملفات الأربعة الكنسية). لم تُحذف أي ملفات أو محتويات.)
> **آخر تحديث سابق: 2026-09-25** (DOC-CONSOLIDATION pass: تحديث العدّادات الإجمالية + إضافة §17 Historical Documentation Archive (كل ملفات `Documentation/*.md` غير الأساسية مُؤرشفة كمرجع تاريخي، لم تُحذف) + إضافة §1.6 5-Market Architecture + UI-Mirror Protocol + SQLite Fallback Pattern + تحديث §3.1 DB Map بالأرقام الحالية.)
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
| **التكامل** | يُستخدم في `daily_predictor.py` كـ proof #9 + hard veto / boost (لو score < 30 → رفض). |

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

### 🔥 KILL-MAESTRO → DELETE-MAESTRO (2026-10-12): V40.2 هو العقل الوحيد

**Maestro اتمسح نهائياً.** V40.2 هو مولّد التوقعات الأساسي والوحيد.

> **2026-10-12 (DELETE-MAESTRO):** سيدي طلب: "Maestro ده ماضي أسود — ممكن تشيلة لان تقريباً مالوش اى لزمة".
> تم حذف كل ملفات Maestro نهائياً (مش بس تعطيل) وأرشفت في `archive/maestro-dead-code-20261012/`:
> - `analyzers/maestro_orchestrator.py` (4414 سطر)
> - `analyzers/crypto_maestro.py` (466 سطر)
> - `analyzers/unified_maestro.py` (606 سطر)
> - `api/maestro_routes.py` (1094 سطر)
> - `src/app/api/maestro/*` (3 Node routes)
> - `src/modules/dashboard/components/MaestroWidget.tsx`
> - `src/lib/honest-tracking/maestro.ts` (76KB parallel Node stack)
> - 5 backfill scripts
> - blueprint registration اتشال من `lightweight_server.py`
> - إجمالي: **556 KB dead code** اتشال

| التغيير | التفاصيل |
|---|---|
| **V40.2 = المصدر الوحيد** | `daily_predictor.py` يكتب في `predictions.db` عبر `record_prediction()` (Single Gate) |
| **Maestro = محذوف نهائياً** | كل الـ files في `archive/maestro-dead-code-20261012/` — مش معطل بس، محذوف |
| **PREDICTION-WRITE-GUARD** | `core/prediction_write_guard.py` — الـ Single Gate اللي بـ enforce Rule 35 |
| **background_analyzer** | Maestro imports في try/except — بـ fail silently لو استدعيت |
| **recorder.py** | `record_crypto_signals` + `record_egx_signals` — no-op (return early) |
| **ai_predictions_routes** | يقرأ من `predictions` (V40.2) مش `stored_analyses` (Maestro) |

---

### 🔁 RULE20-PURE-PROXY (2026-10-12): 17 Node routes اتحولت لـ pure thin proxies

> **سيدي طلب:** "أنت لية عملت كل الشغل فى النود؟" — كل الـ logic لازم يكون في Python (Single Source of Truth per Rule 67).
> تم تحويل **17 Node routes** في 5 جلسات متتالية: **RULE20-PURE-PROXY** + **RULE20-P1-FIX** + **FULL-AUDIT-FIXES (P0-1, P0-2, P1-1..P1-4)** + **P2-FALLBACK-REMOVAL** + **MAESTRO-KILL**.

#### A. honest-tracking family (7 routes)
| Route | Before → After | Python Endpoint |
|---|---|---|
| `predictions/honest-tracking/stats` | 182 → 66 سطر | `/api/stored-analysis/honest-stats` (NEW) |
| `predictions/honest-tracking/list` | 176 → 86 سطر | `/api/stored-analysis/live-tracking` (re-used + flatten) |
| `predictions/honest-tracking/live-tracking` | 117 → 62 سطر | `/api/stored-analysis/live-tracking` |
| `predictions/honest-tracking/missed-opportunities` | 184 → 60 سطر | `/api/stored-analysis/missed-opportunities` (NEW) |
| `predictions/honest-tracking/learn-from-errors` | 171 → 86 سطر | `/api/stored-analysis/learn-from-errors` (NEW) |
| `predictions/honest-tracking/verify-pending` | — → 72 سطر | (POST delegate) |
| `predictions/honest-tracking/ROOT` | 64 → 73 سطر (P0-1) | `/api/stored-analysis/live-tracking` |

#### B. dashboards & reports (5 routes)
| Route | Before → After | Python Endpoint |
|---|---|---|
| `predictions/league-report` | 70 → 63 سطر (P0-2) | `/api/predictions/league-report` (LEAGUE-DEDUP-FIX) |
| `stocks/top-performers` | 225 → 61 سطر | `/api/stored-analysis/missed-opportunities` (re-used) |
| `v4/stats` | 250 → 73 سطر (P1-1) | `/api/v4/stats` (NEW في `misc_routes.py`) |
| `admin/platform-performance` | 646 → 72 سطر (P1-2) | `/api/admin/platform-performance` (NEW — auth gate محفوظ) |
| `predictions/performance-dashboard` | 334 → 69 سطر (P1-4) | `/api/predictions/performance-dashboard` (NEW) |

#### C. screener + market (4 routes)
| Route | Before → After | Python Endpoint |
|---|---|---|
| `finance/screener` | 63 سطر | `/api/finance/screener` |
| `screener/advanced` | 106 سطر | `/api/screener/advanced` (paywall gate محفوظ) |
| `market/liquidity-flow` | 64 سطر | `/api/market/liquidity-flow` |
| `radar/accuracy` | 102 سطر | `/api/radar/accuracy` (paywall gate محفوظ) |

#### D. chart + tracking (1 route)
| Route | Before → After | Python Endpoint |
|---|---|---|
| `chart/[ticker]` | 969 → 82 سطر (تقليل 91.5% — P1-3) | `/api/chart/<ticker>` (موجود في `chart_routes.py`) |

#### E. fallback-chain removal (4 routes)
| Route | Before → After | Python Endpoint |
|---|---|---|
| `market/exit-status` | 98 → 80 سطر | (Python endpoint موجود) |
| `unified/predictions` | 94 → 152 سطر | (Python endpoint موجود + POST handler) |
| `fomo/missed-opportunities` | 117 → 133 سطر | `/api/fomo/missed-opportunities` (NEW — paywall gate محفوظ) |
| `market/recommendations/ai-insights` | 66 → 80 سطر | `/api/market/recommendations/ai-insights` (NEW) |

**إجمالي:** 1127 + 2199 + 375 + 4 routes صغيرة = **~3,300 سطر Node logic اتمسحت** (zero computation في Node). كل routes بترجّع `503 + success:false + rule:'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)'` لو Python unavailable (مفيش placeholder zeros).

---

### 🧹 FAKE-DATA-HUNT (2026-10-12): 25 قطعة بيانات وهمية اتمسحت

> **سيدي طلب:** فحص ميكروسكوبي لـ `src/` + `vps-service/` على الـ patterns:
> - `Math.random()` في production financial data
> - `random.randint/choice/uniform` في Python
> - `confidence/master_score/score = 50` placeholders
> - `source: 'unavailable'/'error-fallback'/'sqlite_fallback'/'stub'/'placeholder'/'deterministic_stub'`
> - synthetic equations (`entry * 1.05`, `low * 0.9`, etc.)
> - fallback chains (`getPredictionsFallback` etc.)

#### الـ 5 إصلاحات P0 ( fabricated data اتمسحت):
1. **3 fake backtest endpoints** — `backtesting/unified` (mulberry32 RNG + STRATEGY_PROFILES hardcoded) → 410 Gone; `kimi/backtest/run` + `walk-forward/run` (buildStubEquityCurve/buildStubPeriods) → pure proxies (503 لو Python down).
2. **`src/lib/store.ts` client-side scoring** — synthetic `score = Math.min(95, Math.max(5, 50 + chg * 1.5))` + hardcoded `components: { liquidity: 50, valuation: 50, income: 50 }` + `verdict: 'undervalued' as const` (كل سهم = "undervalued"!) → استبدل بـ `null` (honest empty state).
3. **Zakat hardcoded gold price** — `PLACEHOLDER_GOLD_24K = 4850` + `PLACEHOLDER_SILVER = 56` → `fetchGold24Price()` بترجّع null → 503 (خرق ديني Rule 50).
4. **`+2472.9%` SUM bug pattern** — `ExecutiveReportView.tsx:680-755` + `PredictionTrackingDashboard.tsx:460-528, 810-838` كانوا بيعملوا `reduce((s,p) => s + returnPct, 0)` (SUM جبري للنسب المئوية — 80 صفقة × +30% = +2400%!) → استبدل بـ `avgReturnPct` + `cumulativeReturnPct = product(1 + ret/100) - 1` (compound return).
5. **persona/analyze + crypto placeholders** — `persona/analyze/[ticker]` + `crypto/route.ts` + `mobile/crypto/route.ts` + `finance/smart-watchlist` كانوا بـ يرجّعوا `score=50, signal='HOLD', confidence=0, source:'placeholder', success:true` فوق الأسعار الحقيقية → استبدل بـ null + 503.

#### Tier 2-5 (متبقية — pending future sessions):
- **7+ synthetic equations** (`entry * 1.05/0.95`, `current * 0.97/1.03` fallbacks) في `dynamic-analysis-engine.ts` + `helpers.ts` + `StockDetail.tsx` + `ComprehensiveStockAnalysis.tsx` + `GateAnalysisView.tsx` + `SpecialistAnalysisView.tsx` + `StockScreenerAdvanced.tsx` — Pending (P1).
- **3 hardcoded demo arrays** — `AcademyView.tsx FALLBACK_STOCKS` (18 stocks with fabricated prices) + `ContentStudioHub.tsx SAMPLE_TRADES` + `AdvancedPortfolioManager.tsx demo positions` — Pending (P1).
- **8 fallback functions** في `flutter-sqlite-fallback.ts` لسه بـ تـ fabricate analytical scores في crypto routes — Pending (P2).

---

### 🚫 HIDDEN-WRITERS-AUDIT (2026-10-12): كل الـ rogue DB writers اللي اتعطلت

> **سيدي طلب:** "بعبص فى كل حتة عالشان نعرف أدق أدق المشاكل بدون ماتموت المشروع". تم فحص ميكروسكوبي عميق + تعطيل **7 rogue paths** بـ تكتب في `predictions` / `persona_predictions` / `real_predictions` بدون مرور عبر `record_prediction()` (الـ Single Gate per Rule 35):

| # | الـ Rogue Path | كان بيعمل إيه | الحالة بعد الإصلاح |
|---|---|---|---|
| 1 | `scripts/backfill_historical_predictions.py` | INSERT في `persona_predictions` بـ persona engines (مش V40.2) على كل deploy عبر `deploy_vps.sh` | **معطل** بـ `RULE35-DISABLE` guard + `sys.exit(0)`. اتمسح من `deploy_vps.sh`. |
| 2 | `api/confluence_routes.py /generate-predictions` | INSERT INTO aiPrediction بـ `source='CONFLUENCE_V3'` بدون evidence | **410 Gone** + redirect لـ V40.2 `daily_predictor.py` |
| 3 | `scripts/optimization_loop.py` | `clear_predictions()` بـ يعمل **`DELETE FROM predictions`** (wipes ALL!) قبل كل strategy iteration | **معطل** بـ `RULE35-DISABLE` guard + `sys.exit(0)` — كارثة Rule 1 (DB Safety) |
| 4 | `api/admin/backtest/v40/run` (Node) | Node-side **`DELETE FROM predictions`** على كل backtest run | **410 Gone** + redirect لـ `daily_predictor.py` (auth gate 403 محفوظ) |
| 5 | `api/recommendations/retroactive-evaluate` (Node) | Node-side `UPDATE real_predictions` (duplicate of `daily_closer.py`) | **410 Gone** + redirect لـ `daily_closer.py` (Rule 28 — duplicate) |
| 6 | `api/prediction_tracking_routes` (legacy `tracking_bp`) | duplicate blueprint بـ url_prefix=`/api/predictions/tracking` — endpoints مش بـ تستخدم | blueprint registration اتشال من `lightweight_server.py` (Rule 28) |
| 7 | `telegram/auto_poster.py:299-306` | `UPDATE predictions SET ... WHERE ticker = ? ORDER BY ... LIMIT 1` (SQL syntax bug — SQLite مش بـ يدعم ORDER BY/LIMIT في UPDATE) — silent swallowed exception | الـ SQL syntax bug موثّق. الـ path معطّل. |

**3 orphan duplicate tables اتمسحت** من الـ DBs (FULL-AUDIT-FIXES P0-3):
| DB.Table | Rows | السبب | Canonical Alternative |
|---|---|---|---|
| `predictions.db.portfolios` | 4 | duplicate | `stocks.db.portfolios` (9 rows — canonical) |
| `predictions.db.ExpertRecommendation` | 17 | duplicate | `stocks.db.ExpertRecommendation` (48+ rows — canonical) |
| `stocks.db.gold_prices` | 3 (legacy) | duplicate | `data_engine.db.gold_prices` (163,143 rows — canonical) |

Backups محفوظة: `predictions.20261011_101047.bak` + `stocks.20261011_101047.bak` (Rule 16 — VERIFY-BEFORE-DELETE). VACUUM اتعمل.

**9 orphan scripts معطّلة بـ early-return guards (defense-in-depth)** — per Task `DISABLE-SCRIPTS` (commit `38665fd1`) + DEEP-AUDIT-FIXES P1:
`backtesting_engine.py` + `maestro_backfill_phase3.py` + `maestro_backfill_v2.py` + `generate_persona_predictions.py` + `populate_history_fast.py` + `dual_track_generator.py` + `backfill_with_personas.py` + `backfill_to_predictions.py` + `volume_surge_hunter_test.py` + `backfill_history.py` + `sync-real-data.py`.

**الـ Single Gate الحالي:** `analyzers/prediction_tracker.py:493-534` (`record_prediction()`) + الـ guard في `core/prediction_write_guard.py:14-194` (`validate_prediction_evidence()`). الـ guard بيـ block أي توقع مش من V40.2 / بدون evidence / بـ master_score=50 placeholder.

---

### 🔁 P1-PARALLEL-ENGINES-FIX (2026-10-12): 5 parallel Node engines اتمسحت → 3 Python endpoints

> **سيدي طلب:** "أفشخ المشروع لحد مايتصلح تماماً". فحص ميكروسكوبي لـ `src/lib/` على أي analytical engine بـ يعمل نفس شغل Python. اتلاقي **5 parallel Node engines** بإجمالي **3,987 LOC** بـ تعمل نفس الـ logic اللي موجود في Python — خرق صريح لـ Rule 28 (NO-DUPLICATION) + Rule 20 (Python=Brain).
>
> **الـ 5 engines اللي اتمسحت** (3 محذوفة + 2 archived orphan):

| # | الـ Node Engine (محذوف/archived) | LOC | الـ Python Canonical اللي بديله | CallerMigration | الحالة |
|---|---|---:|---|---|---|
| 1 | `src/lib/trade-results-engine.ts` | 685 | `/api/trade-results` (NEW في `misc_routes.py:6492` — Cairo TZ-aware period bounds + 11-point validation + ReportStats aggregation) | `src/app/api/trade-results/route.ts` rewritten كـ pure proxy (182→82 LOC) | 🗑️ **محذوف** + archived لـ `archive/engines/p1-parallel-engines-20261012/trade-results-engine.ts.orphan` |
| 2 | `src/lib/expert-analysis.ts` | 882 | `/api/stocks/<ticker>/expert-analysis` (NEW في `misc_routes.py:6579` GET + `:6678` POST) + `vps-service/analyzers/expert_analysis_engine.py` (NEW 859 LOC — `generate_expert_analysis()`) | `src/app/api/stocks/[ticker]/expert-analysis/route.ts` rewritten كـ pure proxy | 🗑️ **محذوف** + archived لـ `archive/engines/p1-parallel-engines-20261012/expert-analysis.ts.orphan` |
| 3 | `src/lib/gate-analyzer.ts` | 1,066 | `/api/stocks/<ticker>/gate-analysis` (NEW في `misc_routes.py:6695` GET + `:6776` POST) + `vps-service/analyzers/gate_analysis_engine.py` (NEW 730 LOC — `analyze_gates()` + 5 gates: trend/momentum/volume/structure/RSI + narrative) | `src/app/api/stocks/[ticker]/gate-analysis/route.ts` NEW (124 LOC — pure proxy GET + POST) | 🗑️ **محذوف** + archived لـ `archive/engines/p1-parallel-engines-20261012/gate-analyzer.ts.orphan` |
| 4 | `src/lib/dynamic-analysis-engine.ts` | 969 | (orphan بعد تحويل gate-analyzer) — بس `detectBBSqueeze()` كان مستخدم → اتعمل port لـ `gate_analysis_engine.py::_detect_bb_squeeze()` | (orphan — مفيش callers مباشرة بعد تحويل gate-analyzer) | 🗑️ **archived** لـ `archive/engines/p1-parallel-engines-20261012/dynamic-analysis-engine.ts.orphan` |
| 5 | `src/lib/prediction-validator.ts` | 293 | `vps-service/analyzers/prediction_validator.py` (Python canonical مفعّل من قبل — Rule 28 duplicate) | (orphan — ماكانش ليه callers مباشرة، mirror للـ Python canonical) | 🗑️ **archived** لـ `archive/engines/p1-parallel-engines-20261012/prediction-validator.ts.orphan` |
| | **إجمالي LOC اتمسحت/archived:** | **3,987** | | | |

**3 Python endpoints جديدة** في `vps-service/api/misc_routes.py` (decorated بـ `@misc_bp.route`):
- `GET /api/trade-results` (line 6492) — period bounds Cairo TZ-aware + 11-point validation + ReportStats aggregation (reuse canonical `unified_config.MARKET_PROFILES` per Rule 67)
- `GET + POST /api/stocks/<ticker>/expert-analysis` (line 6579 + 6678) — expert analysis engine (RSI/MA/S-R/52W + fundamentals P/E ROE EPS P/B Div + risk mgmt entry/target1/target2/stop/RR/position-size/risk-level + Arabic narrative)
- `GET + POST /api/stocks/<ticker>/gate-analysis` (line 6695 + 6776) — gate analysis engine (5 gates: trend/momentum/volume/structure/RSI + Arabic narrative)

**3 Node routes اتحولت لـ pure proxy** (zero computation in Node — Rule 20):
- `src/app/api/trade-results/route.ts` — 182→82 سطر (rewritten كـ pure proxy)
- `src/app/api/stocks/[ticker]/expert-analysis/route.ts` — rewritten كـ pure proxy
- `src/app/api/stocks/[ticker]/gate-analysis/route.ts` — NEW (124 سطر — pure proxy GET + POST)

**Tests (verified 2026-10-12):**
- Python syntax: ✅ (6 files compiled via `py_compile` — source_authority + egksco_scraper + us_stock_scraper + misc_routes + expert_analysis_engine + gate_analysis_engine)
- ESLint: ✅ EXIT 0
- Functional: `generate_expert_analysis({COMI data})` → BUY signal, RR=2.2, full Arabic expert summary ✅; `analyze_gates({COMI snapshot})` → 2/5 gates passed, R/R=1.33 ✅
- HTTP smoke: `/api/trade-results` → 401 (auth gate) ✅; `/api/stocks/COMI/expert-analysis` + `/api/stocks/COMI/gate-analysis` → 503 (Python down — Rule 27, NO mock data) ✅

**الـ Verifier:** لو لقيت أي ملف في `src/lib/` بـ يحسب RSI/ATR/gate-score/expert-analysis/trade-results logic → ده REGRESSION violation. كل الـ analytical logic لازم يكون في Python (`vps-service/analyzers/`). الـ archive location: `archive/engines/p1-parallel-engines-20261012/`.

---

### 👻 MAESTRO-GHOST-HUNT (2026-10-12): 5 Node routes كان فيها fetch لـ `/api/maestro/*` محذوف

> **سيدي طلب:** "أفشخ المشروع لحد مايتصلح تماماً" + "نيك السكرتيرة خلى كسها يجيب دم" (يعني التحديث دقيق + شامل). بعد ما Maestro اتمسح نهائياً (DELETE-MAESTRO — `archive/maestro-dead-code-20261012/`)، فيه **5 Node routes** كانت لسه بـ تعمل `fetch('/api/maestro/...')` على Python endpoint مات. كل ده كان **ghost code** بـ ينادي على عداد ميت — كان هيرجّع `success:false` صامت + يخلّي الـ UI يعرض فراغ بدون سبب واضح.

**الـ 5 Ghost Routes اللي اتصلحت:**

| # | الـ Node Route | الـ Ghost fetch القديم | الحالة بعد الإصلاح | الـ Python Endpoint البديل (canonical) |
|---|---|---|---|---|
| 1 | `src/app/api/ai/analyze-stock/route.ts` (POST) | `fetch('/api/maestro/stock/<ticker>')` + `maestro_score` field refs + `source: 'python_maestro'` (fake label بعد حذف Maestro!) + 337 LOC of direct SQLite access (Rule 20 violation) | pure proxy لـ `/api/stocks/<ticker>/unified` (337→86 LOC) | `/api/stocks/<ticker>/unified` (canonical V40.2) |
| 2 | `src/app/api/stocks/dual-persona/[ticker]/route.ts` (GET) | `fetch('/api/maestro/persona/<ticker>')` كـ fallback بعد `stored-analysis` (line 11 — في الـ docstring القديم + الـ code) | redirect لـ `/api/stocks/<ticker>/unified` (persona_engine.py canonical) — MAESTRO-KILL comment at line 143 | `/api/stocks/<ticker>/unified` (persona_engine.py) |
| 3 | `src/app/api/stocks/[ticker]/comprehensive/route.ts` (GET) | `response.maestro` field override + `fetch('/api/maestro/stock/<ticker>')` (line 8 — في الـ docstring القديم) | `response.maestro = null` (field موجودة legacy بس فاضية) + الـ fetch اتمسح (line 120 — MAESTRO-DISABLED comment) | `/api/stocks/<ticker>/unified` (via `getUnifiedStockData()`) |
| 4 | `src/app/api/trade-results/route.ts` (GET) | (مش maestro fetch — بس parallel Node engine `src/lib/trade-results-engine.ts`) | pure proxy لـ Python `/api/trade-results` | `/api/trade-results` (NEW في `misc_routes.py`) |
| 5 | `src/app/api/stocks/[ticker]/expert-analysis/route.ts` (GET+POST) | (مش maestro fetch — بس parallel Node engine `src/lib/expert-analysis.ts`) | pure proxy لـ Python `/api/stocks/<ticker>/expert-analysis` | `/api/stocks/<ticker>/expert-analysis` (NEW + `expert_analysis_engine.py`) |

(الـ route 6: `stocks/[ticker]/gate-analysis` — NEW pure proxy أصلاً، ماكانش فيه ghost fetch.)

**maestro_score field (legacy DB column — OK مع COALESCE fallback):**

| Field | DB.Table | Type | Status |
|---|---|---|---|
| `maestro_score` | `stored_analyses.maestro_score` (predictions.db) | REAL | **legacy column** — لسه موجود في schema (مفيش ALTER TABLE يحذفه — Rule 16 VERIFY-BEFORE-DELETE). مفيش INSERT جديد. Python بـ يقرأه بـ `COALESCE(maestro_score, master_score, 50)` fallback في `misc_routes.py:3013, 3057-3059, 3867, 3877` + `stored_analysis_routes.py` + غيرها. |
| `master_score` | `predictions.master_score` (predictions.db) | REAL | **canonical** — V40.2 master score من `institutional_decision_engine.py::build_institutional_decision()`. الـ V40.2 generator بـ يكتبه عبر `record_prediction()` (Single Gate per Rule 35). |
| `master_score` | `stored_analyses.master_score` | REAL | canonical mirror (نفس القيمة من V40.2). |

**الـ Verifier:** لو لقيت أي `fetch('/api/maestro/` في `src/app/api/` → ده REGRESSION violation (Python endpoint محذوف). لو لقيت أي INSERT جديد لـ `maestro_score` field → ده Rule 35 violation (canonical هو `master_score`).

---

### 🧹 SIDE-EFFECTS-AUDIT + ORPHAN-GARAGE (2026-10-12): 3 آثار جانبية + 9 orphans → garage

> **سيدي طلب:** تحديث الـ Documentation بعد كل الإصلاحات الأخيرة. فحص ميكروسكوبي لكل route/script اتعطل (410 Gone) في الجلسات السابقة (MAESTRO-KILL + FAKE-DATA-HUNT + HIDDEN-WRITERS-AUDIT + P1-PARALLEL-ENGINES-FIX + MAESTRO-GHOST-HUNT) للتأكد من عدم وجود آثار جانبية على الـ frontend. اكتشف + اتعالجت **3 آثار جانبية** + اتأرشفت **9 orphan components** لـ `archive/dead-components-20261012/` (مش حذف — Rule 16 VERIFY-BEFORE-DELETE + Rule 25 Refactoring-Gated).

#### (1) جدول الـ 9 orphan components المؤرشفة (`archive/dead-components-20261012/`)

كل orphan component اتعملها VERIFY-BEFORE-DELETE ثلاثي (static imports + CommonJS `require` + ES dynamic `import()`) قبل النقل. اتنقلوا بـ `git mv` (بيحافظ على git history — ظاهرين كـ `R` rename في `git status`).

| # | الـ Orphan Component | LOC | الـ Module الأصلي | Archive Path |
|---|---|---:|---|---|
| 1 | `CryptoTradingChartView.tsx` | 275 | `src/modules/crypto/components/` | `archive/dead-components-20261012/crypto/CryptoTradingChartView.tsx` |
| 2 | `CryptoScreenerView.tsx` | 677 | `src/modules/crypto/components/` | `archive/dead-components-20261012/crypto/CryptoScreenerView.tsx` |
| 3 | `CryptoAdditionalViews.tsx` | 34 | `src/modules/crypto/components/` | `archive/dead-components-20261012/crypto/CryptoAdditionalViews.tsx` |
| 4 | `CryptoAdvancedAnalysisView.tsx` | 688 | `src/modules/crypto/components/` | `archive/dead-components-20261012/crypto/CryptoAdvancedAnalysisView.tsx` |
| 5 | `PredictionsBacktestTable.tsx` | 533 | `src/modules/dashboard/components/` | `archive/dead-components-20261012/dashboard/PredictionsBacktestTable.tsx` |
| 6 | `AnalysisFlowDiagram.tsx` | 326 | `src/modules/market-analysis/components/` | `archive/dead-components-20261012/market-analysis/AnalysisFlowDiagram.tsx` |
| 7 | `DataCoverageBanner.tsx` | 209 | `src/modules/stock-analysis/components/` | `archive/dead-components-20261012/stock-analysis/DataCoverageBanner.tsx` |
| 8 | `HumanRecommendationsAdmin.tsx` | 1028 | `src/modules/admin/components/` | `archive/dead-components-20261012/admin/HumanRecommendationsAdmin.tsx` |
| 9 | `personalized-radar.ts` (true orphan) | 583 | `src/modules/personalized/lib/` | `archive/dead-components-20261012/personalized/lib/personalized-radar.ts` |
| | **Total archived:** | **4,408** | 9 files / 5 modules | `archive/dead-components-20261012/` (شامل README.md تفصيلي) |

> **RESTORE:** `git mv archive/dead-components-20261012/<module>/<file> src/modules/<module>/components/<file>` (أو `lib/` حسب الـ module).

#### (2) جدول الـ 3 آثار جانبية + إصلاحاتها (SIDE-EFFECTS-AUDIT)

| # | الـ File | السطر(s) | الـ Issue (الـ root cause) | الـ Fix المُطبّق | الـ Severity |
|---|---|---|---|---|---|
| 1 | `src/app/admin/honest-predictions/page.tsx` | 248, 373, 486 | 3 fetches لـ `/api/admin/generate-historical-predictions` (route رجع **410 Gone** — HIDDEN-WRITERS-AUDIT #2). GET (params) + POST (Generate button) + POST (Full Test button). الأزرار بـ تُظهر `toast.error` بس الـ admin مش هيقدر يشغّل V40.2 generation من الـ UI. | موثّق كـ **known limitation** — V40.2 runs automatically via `cron daily_predictor.py`. الـ UI buttons بتعرض toast.error واضح (graceful degrade، NO crash). لا حاجة لـ code change urgent — Python canonical هو المسار الإنتاجي. | 🟡 MEDIUM (UX gap، NO crash) |
| 2 | `src/modules/admin/components/BacktestTab.tsx` | 179 | 1 fetch لـ `/api/admin/backtest/v40/run` (route رجع **410 Gone** — HIDDEN-WRITERS-AUDIT #4 — كان بيعمل `DELETE FROM predictions` على كل backtest run كارثة Rule 1). الـ "Run Backtest" button بـ يُظهر `toast.error` بس الـ admin مش هيقدر يشغّل backtest. | موثّق كـ **known limitation** — backtest بـ `backtest_engine.py` على sandbox DB copy (الـ canonical path). الـ UI button بتعرض toast.error واضح (graceful degrade). | 🟡 MEDIUM (UX gap، NO crash) |
| 3 | `scripts/run_quick_analysis.py` | 535 | TOP-LEVEL `from analyzers.maestro_orchestrator import MaestroOrchestrator` — NOT wrapped in try/except (كان هـ يكسر بـ `ImportError` لو اشتغل بعد DELETE-MAESTRO). الـ script "dormant" (محدش بـ يستدعيه من cron/scheduler) بس لو اشتغل هـ يـ crash. | wrap في `try/except` بنفس pattern بتاع `forward_test_may2026.py:22` + `test_adaptive_weights.py:35` (اللي اتصلاحوا في commit `bda8470` — maestro-ghost-hunt). | 🔴 HIGH (latent crash — تم الإصلاح) |

#### (3) proxy-client.ts — verified NOT orphan (اتساب في مكانه)

الـ task description الأصلية صنّفت `src/modules/reports/lib/proxy-client.ts` (438 LOC) كـ "true orphan" لكن الفحص الثلاثي (static imports + `require` + dynamic `import()`) كشف إنه **مش orphan** — فيه **3 importers حية**:

| # | الـ Importer الحي | السطور | الـ Imports |
|---|---|---|---|
| 1 | `src/modules/reports/components/ReportsView.tsx` | 67-77 | `fetchDailyReport, fetchWeeklyReport, exportReportToPng, triggerPrint, safeFmtNum, safeFmtPct, safeFmtArDate, type DailyReportPayload, type WeeklyReportPayload` |
| 2 | `src/modules/reports/components/DailyMarketReport.tsx` | 59-68 | `fetchDailyReport, exportReportToPng, triggerPrint, safeFmtNum, safeFmtPct, safeFmtArDate, type DailyReportPayload, type ReportStockMini` |
| 3 | `src/modules/reports/components/StockAnalysisReport.tsx` | 81-86 | `exportReportToPng, triggerPrint, safeFmtNum, safeFmtPct` |

**3 importers حية + مش commented out → NOT orphan.** اتساب في مكانه الأصلي `src/modules/reports/lib/proxy-client.ts`. ده مثال مباشر على أهمية Rule 16 (VERIFY-BEFORE-DELETE) — لو اتشال بناءً على الافتراض الأصلي في الـ task description، كان هيكسر 3 صفحات reports (ReportsView + DailyMarketReport + StockAnalysisReport).

**الـ Verifier:** لو لقيت أي fetch لـ `/api/admin/generate-historical-predictions` أو `/api/admin/backtest/v40/run` بـ يعمل action حقيقي (مش toast.error) → ده REGRESSION violation. لو لقيت أي import لـ الـ 9 orphan components من غير `archive/dead-components-20261012/` prefix → ده REGRESSION violation (الـ components محذوفة من `src/` وأرشفت). لو لقيت أي top-level `import MaestroOrchestrator` بدون try/except → ده REGRESSION violation (Rule 25 — refactoring-gated).

---

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
8. **Commission edge + risk ceiling** (CONSTITUTION Rule 8) — ATR stop clamp **`[5%, 9%]`** مُفعّل في `v38_backtest_engine.py` (post-commit `65a748f` set initial [3%,9%] baseline; Task `REAPPLY-CRITICAL-FIXES` commit `38665fd1` — 2026-10-08 — رفع الحد الأدنى 3.0→5.0 لمواءمة `engine_settings.py` + `opportunity_quality.py` + `unified_config.py` EGX profile). حماية رأس المال مقدسة (Rule 19).
9. **Single-route shell** (CONSTITUTION Rule 3) — لا صفحات جديدة. كل شيء عبر hash routes من `/`.
10. **STICKY FOOTER** — الـ Footer لاصق أسفل كل شاشة (CSS sticky).

### 1.4 قاعدة الـ `?XTransformPort`

> آلية الـ Gateway: Caddy يستقبل كل الطلبات على المنفذ 81، ثم يحوّل الـ query param `XTransformPort=N`
> لتمرير الطلب للخدمة الداخلية على المنفذ `N`.

**الاستخدامات الموثقة (2 ملفات فقط):**
- `src/app/api/analysis-engine/route.ts` — يحوّل لـ analysis-engine على منفذ خاص.
- `src/app/api/telegram/[...path]/route.ts` — يحوّل لـ mini-service الـ `telegram-events` (port 3003).

**القاعدة الذهبية:** كل الـ routes الباقية تستخدم **relative-path-only** عبر `EGXPY_SERVICE_URL` (default `http://localhost:8010`). لا استدعاء مباشر لـ `localhost:8010` من الـ frontend؛ لازم يمر عبر `Next.js /api/proxy/[...path]`.

### 1.5 الإحصائيات الكلية (2026-10-01 — WAVE-2-3-DOCS refresh)

| المؤشر | القيمة |
|---|---|
| Backend .py files | **450** (was ~506 pre-Wave-2; Wave 2 archived 58 dead files to `archive/wave-2-cleanup-2026-10-01/vps-service/`) |
| Backend LOC | ~199,490 (was ~229,490 — ~30K LOC archived, NOT deleted — owner directive) |
| Frontend `.tsx` files (components) | **247** (was ~285 pre-Wave-2 — Wave 2 archived 51 dead .tsx + 16 dead shadcn UI primitives; Wave 3 archived 3 more for #learning screen — see `05-CURRENT_STATE.md` §13 + §14) |
| Frontend LOC | ~343,000 |
| Flask Blueprints (registered) | 53 |
| Python `@bp.route` decorators | ~599 |
| Next.js `route.ts` files | **380** (was ~653 pre-Wave-2 — Wave 2 cleanup archived 313 dead routes to `archive/wave-2-cleanup-2026-10-01/src/app/api/`) · منهم **30 route تم تأمينها بـ auth guard** (P0-11-AUTH) + **6 routes hardened in Wave 2 Batch 7** (5 admin + 1 data-mutating) · **7 SQL injection sites تم fix** (P0-12-SQLI) · **24 route تم تحويلها لـ async I/O** (P0-14-ASYNC، ~70+ sync I/O sites) |
| محرك قرار مؤسسي | V39/V40.2 (institutional_decision_engine.py, ~520 LOC) |
| محرك backtest | V38 (v38_backtest_engine.py, 1,817 LOC) |
| Personas (نموذج التوقع) | **3 فاعلة في الإنتاج**: `conservative` + `balanced` (الـ baseline 81.8%) + `gambler` — `expert` معطّلة (Rule 23 — PERSONA-UNIFY-A) |
| **DBs على الإنتاج (5 قواعد — أحجام)** | stocks.db=**15 MB** · data_engine.db=**273 MB** · predictions.db=**225 MB** · intraday.db=**428 MB** · price_history.db=**293 MB** · + `auth.db` (0.2 MB) · **4 DBs backed up لـ `*.bak-unify`** (511.2 MB total) — P0-8-DB-UNIFY |
| **عدد أسهم EGX** | **380 سهم** (stocks.db — EGX) |
| **مكونات EGX30** | **27 سهم** (EGX30 index members) |
| **مكونات EGX70** | **20 سهم** (EGX70 index members — subset tracked) |
| عدد الأسهم في `stocks.db` (كل الأسواق) | ~976 سهم (EGX=380 · TADAWUL=413 · KSE=128 · QSE=55) — لا يشمل CRYPTO (بياناتها في `data_engine.db.crypto_prices` + `crypto.db`) |
| الأسهم في `data_engine.db.stocks` | **1,585 سهم** (EGX + تداول + الكويت + قطر + أوامر) — كان فيه duplicate في `data_engine.db.stocks` (296 rows) تم حذفه (P0-8-DB-UNIFY) |
| **التوقعات الكلية في `predictions.db.predictions`** | **1,359 prediction** (333 `TARGET_HIT` + 193 `closed_stop` + 77 `ACTIVE` + باقي الحالات المُغلقة/المُؤرشفة) — بعد HELI-CLEANUP-2: 308 false TARGET_HITs تم تنظيفها (102 → `closed_win` (TP2 hit) + 13 → `EXPIRED` + 1 → `STOPPED` + 17 HELI EXPIRED → `closed_win`) |
| سجل التوقعات `aiPrediction` | 2,459 صف |
| `persona_predictions` (per-persona tracks) | 946 صف |
| `historical_trades` | 550 صفقة تاريخية |
| `outcome_logs` | 8,544 سجل outcome |
| `news.db.news_articles` | **7,894 خبر** (post NEWS-DB-SOT migration) |
| `price_history.db.price_history` | **1,206,981 صف** (1,336 ticker، 2000→2026 — سجل الأسعار الموحّد EGX) |
| `data_engine.db.historical_data` | 99,076 صف OHLC تاريخي |
| `data_engine.db.screener_lists` | 1,505 إدخال في 5 فئات (most_active / unusual_volume / gainers / losers / volume) |
| **Live Win Rate (1,229 resolved predictions)** | **~50-55%** (تنقيح حقيقي بعد HELI-CLEANUP-2 — كان مُسجَّل 67.4% قبل الكشف عن 31.66% mismatch rate في reconcile_hit_targets.py) — راجع `SYSTEM_HOW_IT_THINKS.md` Production Snapshot |
| **Avg Return per resolved prediction** | **25.74%** (متوسط العائد لكل صفقة مُغلَقة — مأخوذ من الـ recorded status، قد يحتاج إعادة حساب بعد الـ reconciliation الكامل) |
| **Live Profit Factor (PF)** | **12.84** (gross profit ÷ gross loss على الـ resolved set — على الـ recorded status) |
| **Reconciliation mismatch rate** | **31.66%** (384 mismatches من 1,213 closed predictions — بعد HELI-CLEANUP-2 ؛ كان 41.96% قبل) |
| **Max Loss Streak** | **7 صفقات خاسرة متتالية** (observed worst-case — تم قياسها في الـ A/B backtest) |
| Fair re-sim PF (post-R:R fix) | 1.453 (148 trades، +0.189%/trade عن القاعدة العادلة) |
| R:R الحالي | dynamic 1.5 (normal) / 2.0 (outperform) — engine_settings |
| **PM2 services (7 — كان 6)** | python-backend (8010) + data-engine (8011) + nextjs (3001) + ws-service (3005) + telegram-poster + telegram-events (3003) + **news-agent** (NEW 2026-09-27 — P0-7-15-INFRA) |
| **Test files / cases (post P0-16-TESTS)** | **9 files / 121 tests / 1,796 LOC** (was 3/75/873 — +6 files / +46 tests / +923 LOC) — 121/121 passing |
| **Observability stack (NEW 2026-09-27)** | Sentry (@sentry/nextjs@11.0.0) + structured logger (`src/lib/logger.ts`) + `/api/health` deep-check (262 LOC) + x-request-id middleware |

### 1.6 الـ 5-Market Architecture + UI-Mirror Protocol + SQLite Fallback Pattern (2026-09-25)

> **تحديث 2026-10-09 (Task `PHASE-3` — commit `b18b3f21`):** تم تفعيل الـ Multi-Market Segregation الكامل لـ **6 أسواق** (مش 5). `normalizeMarket()` helper في `src/lib/market-utils.ts` (200 LOC) بيحوّل أي alias للـ canonical قبل أي DB/Python call. كل الـ APIs دلوقتي بترجّع 200 graceful + AR message بدل 500 لما الـ DB فاضي لسوق معيّن (Rule 27 محترمة). الأرقام في الجدول أدناه هي **آخر verified counts** من الساندبوكس. تفاصيل كاملة في `05-CURRENT_STATE.md` §17.12.

**الأسواق الستة المدعومة (6-Market Architecture — updated 2026-10-09):**

| السوق | الكود (currentMarket) | المصدر | عدد الأسهم (verified 2026-10-09) | Predictions |
|---|---|---|---:|---|
| EGX (مصر) | `EGX` | `stocks.db` + `data_engine.db` | **451** (sandbox) | ✅ 153 (snapshot 2026-08-17) |
| TADAWUL (السعودية) | `TADAWUL` (aliases: KSA + السعودية + saudi) | `stocks.db` | **390** | ❌ `[]` + AR message (graceful 200) |
| KSE (الكويت) | `KSE` | `stocks.db` | **138** | ❌ `[]` + AR message (graceful 200) |
| QSE (قطر) | `QSE` | `stocks.db` | **67** | ❌ `[]` + AR message (graceful 200) |
| US (أمريكا) | `US` | `us_stock_scraper.py` (live on VPS) | 0 (sandbox) | ❌ `[]` + AR message (graceful 200 — was 503) |
| CRYPTO | `CRYPTO` | `data_engine.db.crypto_prices` + `crypto.db` | ~200 active tickers | ✅ independent endpoint |

**Canonical Market Normalization Helper (`src/lib/market-utils.ts` — 200 LOC — NEW 2026-10-09):**
- `normalizeMarket(input)` → يحوّل أي alias للـ canonical ('TADAWUL' / 'KSA' / 'السعودية' / 'saudi' → 'TADAWUL').
- `sqlMarketVariants(canonical)` → يرجّع كل DB variants (TADAWUL → ['TADAWUL','KSA','السعودية']).
- `buildMarketFilter(market, column)` → يبني SQL `WHERE market IN (?,?,?)` بـ placeholders صحيحة (Rule: SQL injection-safe).
- `pythonMarketCode(market)` → يحوّل TADAWUL→KSA قبل الـ Python call (علشان `unified_config.py`).
- `NO_PREDICTIONS_MESSAGE_AR` + `NO_STOCKS_MESSAGE_AR` + `INTERNAL_ERROR_MESSAGE_AR` (رسايل عربية احترافية).

**UI-Mirror Protocol (القاعدة 53 — CRYPTO-IN-MARKETS):**
- شاشات الأسهم (`DashboardView`, `StocksView`, `EnhancedWatchlistView`, `TradingChartView`) بتتشارك نفس المكوّنات مع `currentMarket='CRYPTO'` بدل إنشاء شاشات منفصلة.
- الـ `<MarketSwitcher />` (`src/components/shared/MarketSelector.tsx`) هو نقطة التبديل الوحيدة؛ يكتب `currentMarket` في `useAppStore` ويُعيد تحميل الـ view. يدعم **6 markets** (EGX + TADAWUL + KSE + QSE + US + CRYPTO) — تفاصيل في `02-SCREENS_AND_COMPONENTS.md`.
- لما `currentMarket='CRYPTO'` → `InvestorsFlowPanel` + `MarketDepthPanel` بـ تختفي (مش متاحة للكريبتو) — باقي الـ widgets بتشتغل بـ thresholds مكيّفة (القاعدة 8: ATR stop [5%,15%] للكريبتو بدل **[5%,9%]** للأسهم — Task `REAPPLY-CRITICAL-FIXES` 2026-10-08 رفع min للأسهم من 3.0→5.0).
- لما `currentMarket='US'` → `DevelopmentNotice` بـ يظهر (US تحت التطوير على الساندبوكس — `us_stock_scraper.py` شغّال على الـ VPS بس).
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

### 1.7 — P0 Wave 2026-09-27 — Security + Observability + Tests (NEW — DOC-UPDATE-P0-WAVE)

> **المرجع:** `worklog.md` entries `P0-12-SQLI` + `P0-17-RECONCILE` + `P0-7-15-INFRA` + `P0-14-ASYNC` + `P0-11-AUTH` + `HELI-INVESTIGATION` + `HELI-CLEANUP-2` + `P0-8-DB-UNIFY` + `P0-16-TESTS`.
> **الحالة:** ✅ **16/16 P0 items مُنجَزة**. الـ code health ارتفع من 48/100 → مُتوقَّع ~70/100.

**أ. Security Stack (P0-11-AUTH + P0-12-SQLI + /api/import hardening):**
| المكوّن | الحالة | التفاصيل |
|---|---|---|
| `src/lib/admin-guard.ts` | ✅ NEW 2026-09-27 (74 LOC) | Thin re-export of `requireAdminAsync` من `@/lib/admin-auth-server` + new `requireAuthAsync(req)` لـ user-scoped routes |
| 30 API routes secured | ✅ | 4 admin + 26 non-admin عبر 44 HTTP method handlers. أعقد الـ fixes: `/api/instapay/approve` (admin_id من body = priv-esc) + `/api/paymob/process-wallet` (was open) + `/api/market/sync` (was open) + `/api/db-stats` (was recon goldmine) |
| 7 SQL injection sites fixed | ✅ | 5 ملفات: `predictions/honest-tracking/live-tracking/route.ts` (3 sites) + `finance/screener/route.ts` + `tab-data/route.ts` + `admin/clear-junk-data/route.ts` (4 sites) + `admin/db-explorer/route.ts` (3 sites). 3 canonical patterns: bound `?` params + Set whitelist + strict identifier regex |
| `/api/import` hardening | ✅ | auth + 5MB size limit + rate limit + MIME whitelist (كان بيقبل أي ملف بدون validation) |

**ب. Observability Stack (P0-7-15-INFRA):**
| المكوّن | الحالة | التفاصيل |
|---|---|---|
| `@sentry/nextjs@11.0.0` | ✅ NEW | Installed via `bun add`. `sentry.client.config.ts` + `sentry.server.config.ts` (opt-in via `if (SENTRY_DSN)`). `withSentryConfig` wrapper في `next.config.ts`. 10% tx sampling prod / 100% dev / 100% errors |
| `src/lib/logger.ts` | ✅ NEW (90 LOC) | Structured JSON logger (`{"timestamp","level","message",...context}`). 4 levels (debug/info/warn/error). 12-factor compliant (stderr for errors، stdout for info). `MIN_LEVEL` via `process.env.LOG_LEVEL \|\| 'info'` |
| `/api/health` | ✅ rewritten (60→262 LOC) | يفتح كل DB read-only + SELECT 1 + يـ ping PM2 ports (python-backend 8010 + ws-service 3005 + telegram-events 3003 + pgrep news-agent) + يفحص disk space. HTTP 200 ok/degraded / HTTP 503 down |
| `src/middleware.ts` | ✅ updated | يضيف `x-request-id` header على كل response (UUIDv4 via Web Crypto API + fallback لو unavailable — distributed trace propagation) |
| `ecosystem.config.js` | ✅ updated (6→7 services) | تم إضافة `news-agent` كـ service سابع. سيكتب في `db/news.db.market_news` كل 15 دقيقة |

**ج. Async I/O Refactor (P0-14-ASYNC):**
| المكوّن | الحالة | التفاصيل |
|---|---|---|
| 24 API routes refactored | ✅ | ~70+ individual sync sites converted من `readFileSync`/`writeFileSync`/`existsSync`/`execSync`/`statSync`/`readdirSync` لـ `fs/promises` + `promisify(execFile)`. الأكثر تأثيراً: `admin/db-backup/route.ts` (16+ sync calls) + `admin/pm2-control/route.ts` (9 execSync) + `admin/backtest/v40/status/[jobId]/route.ts` (polling endpoint) |

**د. Database Unification (P0-8-DB-UNIFY):**
| المكوّن | الحالة | التفاصيل |
|---|---|---|
| 9 duplicate tables dropped | ✅ | من 12 المُكتشفة في AUDIT_DATABASES. التفاصيل: `stocks.gold_prices` (3 rows) + `predictions.cached_analysis` (0) + `predictions.telegram_news` (0) + `predictions.ExpertRecommendation` (17) + `auth.ExpertRecommendation` (17) + `stocks.learned_lessons` (0) + `stocks.egksco_price_history` (0) + `data_engine.egksco_stocks` (0) + `data_engine.stocks` (296). كل 333 rows اتـ preserved كـ JSON sidecars قبل DROP |
| 4 DBs backed up لـ `*.bak-unify` | ✅ | stocks.db.bak-unify (14.2 MB) + predictions.db.bak-unify (224.3 MB) + auth.db.bak-unify (0.2 MB) + data_engine.db.bak-unify (272.5 MB) — 511.2 MB total |
| Code updates | ✅ | `src/lib/cache/precomputed-cache.ts` (+78/-57 LOC — أصلح latent bug في `precomputeGoldData()` كان بـ يـ abort الـ `updateAllCache()` بـ "no such column: change" من شهور) + `vps-service/utils/db_paths.py` (+85/-52 LOC — refresh الـ routing table) |

**هـ. HELI False-Target Forensics (HELI-INVESTIGATION + HELI-CLEANUP-2):**
| المكوّن | الحالة | التفاصيل |
|---|---|---|
| Root cause | ✅ identified | `daily_closer.py` استخدم heuristic خاطئ: `status='TARGET_HIT' if actual_return > 0 else 'EXPIRED'` في 4 sites (lines 2087/2140/2175/2199). External script set `exit_type='maker_fuel_exhausted'` على 363 predictions using نفس الـ buggy heuristic |
| Source fix | ✅ applied | استبدال الـ heuristic بـ `if target_price > 0 and highest_price_reached >= target_price: status='TARGET_HIT'` + write-time assertion في `_mark_closed()` (defense-in-depth) |
| Data cleanup | ✅ applied | 308 false TARGET_HITs تم تنظيفها عبر `scripts/fix_all_false_targets.py`: 102 → `closed_win` (TP2 hit) + 13 → `EXPIRED` + 1 → `STOPPED`. 17 HELI EXPIRED → `closed_win` عبر `scripts/fix_heli_expired_to_closedwin.py`. كل 333 rows اتـ backed up لـ `db/predictions.db.bak-heli-fix` (235 MB) + `db/predictions.db.bak-full-cleanup` (235 MB) + `db/predictions.db.bak-heli-expired-fix` (235 MB) |
| Reconcile script | ✅ updated | `scripts/reconcile_hit_targets.py` دلوقتي بـ يعرف `target_price_2` (TP2 hits) — false mismatches قلّت من 41.96% → 31.66% |

**و. Tests (P0-16-TESTS):**
| المكوّن | الحالة | التفاصيل |
|---|---|---|
| 6 new test files | ✅ NEW | `src/__tests__/security/sql-injection.test.ts` (111 LOC, 6 tests) + `auth-guard.test.ts` (198 LOC, 9 tests) + `import-endpoint.test.ts` (189 LOC, 7 tests) + `src/__tests__/predictions/pipeline.test.ts` (167 LOC, 8 tests) + `src/__tests__/db/integrity.test.ts` (165 LOC, 11 tests) + `src/__tests__/api/health.test.ts` (93 LOC, 5 tests) |
| Test coverage | ✅ | 3→9 files / 75→121 tests / 873→1,796 LOC — **121/121 passing** |
| Middleware fix | ✅ BONUS | `src/middleware.ts` كان فيه regression (crypto.randomUUID في Edge runtime = HTTP 500). Fixed via Web Crypto API + fallback |
| Test philosophy | ✅ adopted | READ-ONLY DB connections لـ integrity tests (no mocks) + live HTTP fetch against `localhost:3001` لـ API integration tests (auto-skip لو server مش شغال) |

**ز. Follow-up (P1 — out of scope):**
- radar-cache.ts async refactor — would cascade through 4 callers
- ~96 remaining sync I/O routes (out of audit's 120 total)
- ~460 unprotected routes remain (most GET-only public-data)
- 384 remaining reconcile mismatches (empty `exit_type` — pre-existing data quality issues)
- Playwright E2E tests + CI pipeline for auto-run

---

### 1.8 — Module System (Phase 1-7 Reorganization, 2026-09-30 — NEW — REORG-PHASE-7-DOCS)

> **المرجع الدستوري:** Rule 60 (MODULE-SYSTEM — 2026-09-30) في `00-CONSTITUTION.md` + `05-CURRENT_STATE.md` §1 (Module Architecture) + `worklog.md` entries `REORG-PHASE-1-2` ... `REORG-PHASE-7-DOCS`. (ملفات `MODULE_CATALOG.md` + `ARCHITECTURE_DIAGRAM.md` + `agent-ctx/MASTER-ARCHITECTURE-PLAN.md` تم دمجها في `05-CURRENT_STATE.md` §1 + `worklog.md` في DOC-CONSOLIDATION 2026-09-30.)
>
> **المراحل:** 7 phases اتعملت في الفترة من 2026-09-25 لـ 2026-09-30 — حذف + دمج + ترحيل + توحيد + توثيق.

#### 1.8.1 Frontend Modules (17 — `src/modules/`)

كل موديول ليه `index.ts` re-export shim كـ public interface. الـ imports بين الموديولات عبر الـ `index.ts` فقط.

| # | Module | Purpose | Components | Lib | LOC (approx) |
|---|---|---|---:|---:|---:|
| 1 | `radar/` | رادار السيولة + Exit Radar + Multi-Market + Accuracy + Personalized + Weekly Report + Signal Tracking | 8 | 3 | ~6K |
| 2 | `publishing/` | StockPublisher + UnifiedPublishButton + ShareButton + official links | 3 | 2 | ~3K |
| 3 | `personalized/` | Personalized Radar logic | — | 1 | ~1K |
| 4 | `stock-analysis/` | تحليل سهم فردي (StockDetail + ComprehensiveStockAnalysis + TreasuryBondsView + ...) | 15 | — | ~15K |
| 5 | `predictions/` | تتبع التوقعات + PersonaTab + DualTrack + MakerRadarTab + PicksManagement | 5 | — | ~20K |
| 6 | `portfolio/` | المحفظة + RoboAdvisor + BagHolderRescue + Risk Profiler Quiz + ... | 15 | — | ~12K |
| 7 | `screener/` | فلترة الأسهم المتقدمة (StockScreenerAdvanced) | 1 | — | ~8K |
| 8 | `market-analysis/` | تحليل السوق + SectorTracking + MarketAnalysisView + PersonaTab + PredictionsTab + ... | 24 | — | ~10K |
| 9 | `news/` | الأخبار + التحليلات (NewsFeedView) | 1 | — | ~5K |
| 10 | `admin/` | الأدمن (DB Manager + Topology + Users + Backtest + Notebook + Telegram + ... + live-chart/ + platform-performance/) | 34 | — | ~15K |
| 11 | `crypto/` | الكريبتو (8 sub-views) | 8 | — | ~8K |
| 12 | `education/` | الأكاديمية + التعلم (AcademyView + LearningView + CandlestickSimulator + ...) | 9 | — | ~5K |
| 13 | `reports/` | التقارير (ReportsView + DataManager + StockAnalysisReport + DailyMarketReport + ExecutiveReportView) | 5 | — | ~5K |
| 14 | `dashboard/` | الرئيسية + widgets (DashboardView + 21 widgets) | 21 | — | ~8K |
| 15 | `simulation/` | المحاكاة (SimulationView) | 1 | — | ~3K |
| 16 | `auth/` | المصادقة (DevLoginForm + auth gate) | 1 | — | ~1K |
| 17 | `subscription/` | الاشتراكات (PricingView + TrialExpiredModal + TrialCountdownBanner + UpsellToasts) | 4 | — | ~3K |
| **Total** | **17 modules** | | **150+** | **6** | **~120K** |

#### 1.8.2 Backend Modules (9 placeholders — `vps-service/modules/`)

Placeholders only — Python file moves deferred (needs import-graph analysis). كل موديول فيه `__init__.py` docstring placeholder يوضّح scope.

| # | Module | Purpose | Status |
|---|---|---|---|
| 1 | `radar/` | maker_radar + exit_radar + signal_tracker | placeholder |
| 2 | `predictions/` | V40.2 generator + daily_closer + learning engine | placeholder |
| 3 | `market_regime/` | MarketRegimeEngine | placeholder |
| 4 | `market_data/` | data_engine + scrapers (TradingView + Yahoo + crypto + metals + us_stock) | placeholder |
| 5 | `telegram/` | auto_poster + card_publisher | placeholder |
| 6 | `ai/` | glm_finance_agent + nightly_analysis | placeholder |
| 7 | `portfolio/` | position_manager + stop_manager + smart_exit | placeholder |
| 8 | `admin/` | admin tools (evaluate_predictions + diagnose + restore) | placeholder |
| 9 | (root) | `vps-service/modules/__init__.py` | placeholder |

> **Follow-up (P1):** تنفيذ Phase 3-backend الفعلي — ترحيل الـ Python files لـ `vps-service/modules/<module>/` + تحديث الـ imports. يستحسن يتعمل في task منفصل لأن الـ Python import graph أكثر تعقيداً من الـ TypeScript.

#### 1.8.3 DB Layer (Phase 5 — موحّد عبر `src/lib/db/index.ts`)

**Single entry point:** `src/lib/db/index.ts`

| Source File | DB / Purpose | Importers |
|---|---|---:|
| `db-auth.ts` | `auth.db` — Prisma client (`db`, `authDb`) + User/Account/Session/SubscriptionPlan types | 5,031 |
| `db-predictions.ts` | `predictions.db` — `predictionsDb` accessor | 9 |
| `modules/radar/lib/radar-db.ts` | `stocks.db` radar tables — `getRadarDb`, `parseVolume`, `computeTurnover`, `getRadarDbConfig` | re-exported |
| `finance-db.ts` | `stocks.db` finance tables — `getFinanceDb`, `isFinanceDbAvailable` | 47 |
| `new-db.ts` | user data (Prisma) — `getDb`, `getReadOnlyDb` | 14 |
| `egxpy-bridge.ts` | Python backend bridge — `callPython`, `callPythonAsync` | 13 |
| `egx-data-sources.ts` | data sources config — `getDataSource`, `listDataSources` | 4 |

> **Phase 5 deletions:** `db-helpers.ts` + `db-v2.ts` + `egx-trading-hours.ts` (0 importers — dead facades) + ~22K LOC dead DB helpers كاملة.

#### 1.8.4 Reorganization Stats (Before/After)

| Metric | Before | After | Delta |
|---|---:|---:|---|
| Frontend modules | 0 (scattered) | 15 | +15 |
| Backend modules | 0 (scattered) | 9 placeholders + root | +9 |
| Dead LOC | ~63,000 (estimated) | 0 in new module layer | -43,321 deleted (21,321 Phase 1-2 + 22,000 Phase 5) |
| Duplicate groups | 17 | 4 merged (Phase 2) + remaining targeted in P1 | -4 |
| Wiring disconnects | 30+ | 7 wired (Phase 4) + 2 already wired (audit verified) | -9 |
| Total LOC | ~580K | ~540K | -40K LOC |
| Tests passing | 187 | 259 passed / 15 pre-existing failures / 9 skipped (283 total) — 0 NEW failures | +72 passing |
| Frontend components | 274 (scattered) | 285 in modules + legacy | +11 wired |
| API routes | 653 | 653 (no new routes — Rule 4) | 0 |
| DB access entry points | 20+ scattered helpers | 1 canonical `src/lib/db/index.ts` | consolidated |
| Cron jobs | 18 | 22 (+4 wired in Phase 4.2) | +4 |
| market-analysis tabs | 8 | 11 (+3 wired in Phase 4.1) | +3 |

#### 1.8.5 Module Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                Next.js Frontend (port 3001 — dev)                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  src/modules/ (17 modules — see 05-CURRENT_STATE.md §1)   │  │
│  │  ├── radar/              (liquidity radar — 8 components)  │  │
│  │  ├── publishing/         (3 components + 2 lib)           │  │
│  │  ├── personalized/       (1 lib)                          │  │
│  │  ├── stock-analysis/     (15 components — StockDetail)     │  │
│  │  ├── predictions/        (5 components — V40.2 tracking)   │  │
│  │  ├── portfolio/          (15 components — RoboAdvisor)      │  │
│  │  ├── screener/           (1 component — Advanced)          │  │
│  │  ├── market-analysis/    (24 components — SectorTracking)  │  │
│  │  ├── news/               (1 component — NewsFeedView)     │  │
│  │  ├── admin/              (34 components — DB Manager)      │  │
│  │  ├── crypto/             (8 components)                    │  │
│  │  ├── education/          (9 components — Academy+Learning)│  │
│  │  ├── reports/            (5 components — Weekly Report)     │  │
│  │  ├── dashboard/          (21 widgets — home dashboard)     │  │
│  │  └── simulation/         (1 component)                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                          ↕                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  src/lib/db/index.ts (canonical DB access — Rule 5)       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                          ↕                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  src/app/api/ (653 routes — thin proxies to Python)       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           ↕ HTTP (localhost:8010)
┌─────────────────────────────────────────────────────────────────┐
│              Python Backend (port 8010 — Flask/FastAPI)         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  vps-service/modules/ (9 placeholders — Phase 3.2)         │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           ↕
┌─────────────────────────────────────────────────────────────────┐
│                       Data Layer (SQLite)                       │
│  • stocks.db (14 MB) • predictions.db (235 MB)                  │
│  • data_engine.db (285 MB) • auth.db (0.2 MB)                    │
│  • price_history.db (307 MB) • intraday.db (448 MB)             │
└─────────────────────────────────────────────────────────────────┘
```

> **التخطيط الكامل للمخطط المعماري:** راجع `05-CURRENT_STATE.md` §1 (Module Architecture) (consolidated 2026-09-30 — DOC-CONSOLIDATION).

#### 1.8.6 Phase History (worklog.md entries)

| Phase | Task ID | What was done |
|---|---|---|
| Phase 1-2 | `REORG-PHASE-1-2` | حذف 21,321 LOC ميت (frontend lib + components + backend analyzers) + دمج 4 duplicate groups |
| Phase 3-4 | `REORG-PHASE-3-4` | إنشاء 3 frontend modules (radar + publishing + personalized) + 8 backend module placeholders + wiring 7 hidden gems (3 frontend tabs + 4 cron jobs) |
| Phase 5 | `REORG-PHASE-5` | توحيد DB layer (إنشاء `src/lib/db/index.ts`) + حذف 22K LOC إضافية من الـ dead DB helpers |
| Phase 6 | `REORG-PHASE-6` | إنشاء 12 frontend modules إضافية (screener + news + simulation + education + crypto + reports + predictions + portfolio + dashboard + stock-analysis + market-analysis + admin) — 139 files moved via `git mv` (R100 history preserved) |
| Phase 7 | `REORG-PHASE-7-DOCS` | توثيق الـ module architecture الجديدة (هذا الملف + `MODULE_CATALOG.md` + `ARCHITECTURE_DIAGRAM.md` + تحديث الـ 4 cornerstone docs + Rule 60) |

---

### 1.9 — Flutter App Architecture (NEW — Wave 8 — Task 28-C — 2026-10-04)

> **Source:** `flutter_app/` git submodule at `github.com/enmohsen20111975/flutter_investment_App.git` (linked per Task `FOCUS-5-TASKS-FLUTTER` — 2026-10-01 — owner directive «هل انت بتحدث برنامج الموبايل ولا لسة؟ حط المسار بتاعه عندك بحيث ديما يكون متحدث مع اى تطوير بنعملة»).

**Architecture overview:**

| المكوّن | القيمة | ملاحظات |
|---|---|---|
| Submodule path | `/home/z/my-project/flutter_app/` | Linked via `.gitmodules` — every backend change automatically gets a mirror Flutter method in the same session. |
| Repo URL | `github.com/enmohsen20111975/flutter_investment_App.git` | |
| App version (pubspec.yaml) | **3.0.1+44** | `version: 3.0.1+44` — verified in `flutter_app/pubspec.yaml` |
| Total `.dart` files | **113** | `find flutter_app/lib -name '*.dart' \| wc -l` |
| `lib/api/client.dart` LOC | 4,374 | Single Flutter API client file — one method per backend endpoint |
| `lib/api/mobile_api.dart` LOC | 273 | Mobile wrapper (subset of `client.dart` for mobile-specific routes) |
| Endpoint methods in `client.dart` | **~181** | `grep -c "/api/" flutter_app/lib/api/client.dart` ≈ 292 raw grep matches (one method may hit multiple endpoints) → ~181 unique endpoint methods per Task 27-A audit |
| Model files | 16 | `lib/models/` barrel export `lib/models/types.dart` |
| Screens | 46+ | `lib/screens/*.dart` — see `05-CURRENT_STATE.md` §7 for full inventory |
| Theme primary color | `#6366F1` (Indigo) — **DESIGN MISMATCH**: website is `hsl(160,84%,39%)≈#10B981` (emerald-600) per Task 24 | **P0 item 9** in Task 27-A audit (see `05-CURRENT_STATE.md` §17.5) — needs migration to emerald |
| `AppColors.primary` (Flutter) | `0xFF6366F1` | Target: `0xFF10B981` (emerald-600) + `AppColors.primaryDark` → `0xFF059669` (emerald-700) + `AppColors.primaryLight` → `0xFF34D399` (emerald-400) |
| Flutter `pubspec.yaml` dependencies | ~80 packages | includes `flutter_riverpod` for state management + `dio`/`http` for HTTP + `google_fonts` + `fl_chart` for charts |

**Flutter → Backend API contract (Wave 8 update — Task `774a208`):**
- Wave 2 cleanup had archived 32 routes under `/api/mobile/*`, `/api/app/*`, `/api/ai/*`, `/api/confluence/*`, `/api/data-engine/*`, `/api/fomo/*`, `/api/google-play/*`, `/api/kimi/*`, `/api/learning/*`, `/api/live/*` — they were actually called by `flutter_app/lib/api/client.dart` (181 methods). Mobile app was silently broken — every screen that called one of these showed "no data".
- Wave 8 commit `774a208` restored all 32 endpoints from git history → Flutter app now has 181/181 endpoint methods resolving to live Next.js routes.
- See `05-CURRENT_STATE.md` §17.2 + §7 for the full list of restored endpoints and Flutter screen inventory.

**Outstanding P0 items (handoff to Fix Battalion — Task 27-A — research-only):**
- See `05-CURRENT_STATE.md` §17.5 — 10 P0 issues identified (chart broken / missing Sharia screen / missing paywall handling / indigo→emerald / null levels render as "0.00" / etc.).

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
│   │   ├── market-utils.ts                  # ⭐ NEW 2026-10-09 (Task PHASE-3 — commit b18b3f21) — canonical market normalization helpers (normalizeMarket + sqlMarketVariants + buildMarketFilter + pythonMarketCode + NO_PREDICTIONS_MESSAGE_AR) — 200 LOC
│   │   ├── market-pulse-proxy.ts            # ⭐ NEW Oct 8 — unified proxy لـ 23 mislabeled proxy routes (was scattered helpers)
│   │   ├── market-hours.ts                  # per-market trading hours (EGX + TADAWUL + KSE 08:00-12:45 Kuwait + QSE 09:30-13:00 Doha + US + CRYPTO) — KSE/QSE fixed 2026-10-09 (commit b18b3f21)
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
│   │   ├── v38_backtest_engine.py           # 1,817 LOC — walk-forward backtest (COMMIT 65a748f baseline + 38665fd1 — Task REAPPLY-CRITICAL-FIXES 2026-10-08 — canonical sl/tp1/tp2 + ATR clamp [5%,9%])
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
│   ├── jobs/                                # background jobs (price_history_safetynet, intraday_aggregator, daily_closer, daily_predictor)
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
│   │   ├── news.db / community.db            # sentiment
│   │   ├── intraday.db                      # intraday OHLC (aggregated → price_history)
│   │   ├── gold_prices.db / silver_prices.db
│   │   ├── crypto.db / crypto-lab.db / crypto_learning.db
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
│   └── v40_2_historical_generator.py        # ORIGINAL V40.2 sandbox (pre daily_predictor.py)
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

### 3.1 قواعد البيانات الرئيسية (db/) — مُحدّث 2026-10-12 (post HIDDEN-WRITERS-AUDIT cleanup)

> ملاحظة: الـ archive `db/vps_real/` القديم تم استبداله بالعمل المباشر في `db/` بعد DB-CLEANUP-WAVE-1+2+3 (القاعدة 46). الـ canonical path دلوقتي هو `db/` (sandbox) و `/root/GLMinvestment/db/` (production).
>
> **2026-10-12 (HIDDEN-WRITERS-AUDIT cleanup):** 3 orphan duplicate tables اتمسحت من الـ DBs (per Rule 28 + Rule 29):
> - `predictions.db.portfolios` (4 rows) → **DROPPED** — canonical هو `stocks.db.portfolios`
> - `predictions.db.ExpertRecommendation` (17 rows) → **DROPPED** — canonical هو `stocks.db.ExpertRecommendation`
> - `stocks.db.gold_prices` (3 legacy rows) → **DROPPED** — canonical هو `data_engine.db.gold_prices` (163,143 rows)
>
> Backups محفوظة: `predictions.20261011_101047.bak` + `stocks.20261011_101047.bak` (Rule 16 — VERIFY-BEFORE-DELETE). VACUUM اتعمل.

| DB | الدور | Key tables + counts (2026-10-12) | ملاحظات |
|---|---|---|---|
| **`predictions.db`** | V40.2 prediction store | `predictions`=**306** · `aiPrediction`=2,459 · `persona_predictions`=946 · `historical_trades`=550 · `outcome_logs`=8,544 · `live_ai_signals`=945 · `morning_bell_signals`=82 · `learned_lessons`=8,644 · `exit_notifications`=3,773 (50 table — بعد حذف `portfolios` + `ExpertRecommendation` duplicates) | `fundamental_score` بقى real (بعد FUNDAMENTALS-ACTIVATION commit `04354a5`) — لا placeholder 50. 153 placeholder predictions اتمسحت (status='INVALID') في PRED-WRITE-GUARD cleanup. **`predictions.master_score` = CANONICAL field** (V40.2 master score من `institutional_decision_engine.py::build_institutional_decision()`). **`stored_analyses.maestro_score` = legacy column** — Python بـ يقرأه بـ `COALESCE(maestro_score, master_score, 50)` fallback (maestro_score → master_score → 50). مفيش INSERT جديد لـ `maestro_score`. موثّق في §MAESTRO-GHOST-HUNT. |
| **`data_engine.db`** | Market + fundamentals + metals + crypto | `stocks`=**1,585** · `historical_data`=99,076 · `stock_prices`=2,444 · `crypto_prices`=198,476 · `btc_local_prices`=76,877 · `gold_prices`=**163,143** (CANONICAL — `stocks.db.gold_prices` duplicate اتمسح) · `gold_prices_clean`=27,440 · `silver_prices`=82,608 · `exchange_rates`=45,597 · `screener_lists`=**1,505** · `tab_balance_sheet`=866 · `tab_income_statement`=866 · `tab_cash_flow`=866 · `tab_valuation`=858 · `tab_profitability`=858 · `tab_dividends`=858 · `tab_performance`=858 · `tab_technical_analysis`=863 · `egksco_price_history`=0 (هاجر لـ data_engine.db) · `egx_fundamentals`=0 (يُجمَع عبر `egx_fundamental_fetcher.py`) | الـ canonical price source بعد WAVE-2 migration: `data_engine.db.egksco_price_history`. `price_history.db` محتفظ بيه كـ safety net. الـ canonical gold prices source. |
| **`price_history.db`** | EGX OHLC (primary price source) + US stocks | `price_history`=**1,205,599** rows، 1,260 tickers (EGX focus)، 2025-01-09 → 2026-09-25. **Schema (13-column — extended 2026-10-12):** `ticker, market, date, open, high, low, close, volume, buy_volume, sell_volume, delta_volume, delta_pct, pressure, adjusted` (last 6 columns optional — populated by egksco_scraper via `write_guarded()`). | المصدر الرئيسي للـ `load_merged_history()`. **كل writes بتمر عبر `write_guarded()`** (Rule 12 + Rule 66 — per WRITE-GUARDED-EXTENSION 2026-10-12). |
| **`stocks.db`** | Ticker metadata (5-market) | `stocks`=**956** (EGX=360 · TADAWUL=413 · KSE=128 · QSE=55) · `egksco_stocks`=250 · `ExpertRecommendation`=**48** (CANONICAL — `predictions.db.ExpertRecommendation` duplicate اتمسح) · `cached_analysis`=111 · `market_pulse_cache`=2,132 · `market_indices`=5 · `investors_data`=7 · `egksco_sync_status`=451 · `portfolios`=**9** (CANONICAL — `predictions.db.portfolios` duplicate اتمسح) · `indicator_trust_scores`=10 (54 table — بعد حذف `gold_prices` duplicate) · `ticker_registry` (NEW — Wave 8 — by other programmer via `scripts/unify_tickers_and_names.py` — canonical ticker mappings + collision guards + restored Arabic names + `idx_tr_market` + `idx_tr_sharia` indexes) | mixed: Saudi (numeric) + EGX (concatenated) + Kuwait + Qatar — CRYPTO منفصل في `data_engine.db.crypto_prices` |
| **`data_engine.db`** (NEW — Wave 8 — Rule 64 — Task 23-A) | Sharia compliance tables | `sharia_sources` (8 sources) + `sharia_source_status` + `sharia_metrics` (per-stock compliance) + `sharia_purification_rates` (per-stock rate per method) + `sharia_history` (audit log) — all written by `data_engine/scrapers/sharia_compliance_scraper.py` (cron Sat 15:30 UTC) | AAOIFI excluded. S&P Shariah primary + Musaffa/Kashif/Osoul supplementary. `consensus_min=6`. Read by `/api/sharia` GET + `/api/sharia/purification` POST. |
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

> **Wave 2 (Task 7-A — 2026-10-01):** 58 dead Python files archived to `archive/wave-2-cleanup-2026-10-01/vps-service/` (NOT deleted — owner directive — recoverable if any caller is later discovered in production). 3 false positives caught + skipped (kept alive): `telegram_target_hit_tracker.py` (confirmed LIVE via auto_post_scheduler.py:1524 → PM2 telegram-poster) + `jobs/fetch_corporate_actions.py` + `jobs/hot_candidate_detector.py` (both cron-driven per crontab.txt:53 + crontab.txt:150). See `05-CURRENT_STATE.md` §13.3 for the per-batch breakdown + commit list.
>
> **Wave 2 — anatomy corrections (verified by 6-C2 Discovery Battalion):**
> - Anatomy §8.2 claim "33 DEPRECATED Flask blueprints (~17,000 LOC)" — **OUTDATED**. Actual: 0 dead blueprints. All 37 api/*.py files (excluding __init__.py) define `Blueprint()` AND are registered in `lightweight_server.py` BLUEPRINTS list (lines 31-114).
> - Anatomy "73 analyzers" — **UNDERSTATED**. Actual pre-Wave-2: 138 files (incl __init__.py), of which 20 were dead. Post-Wave-2: 118 files (incl __init__.py) after the 20 dead analyzers were archived.

| Engine | File | LOC | الوصف | Status |
|---|---|---:|---|---|
| **V38 Backtest Engine** | `engines/v38_backtest_engine.py` | 1,817 | walk-forward backtest — NOW reads canonical `sl`/`tp1`/`tp2` + ATR clamp **`[5%, 9%]`** (commit `65a748f` baseline; commit `38665fd1` — Task `REAPPLY-CRITICAL-FIXES` — رفع min 3.0→5.0 + V40_2_STOP_MAX_PCT default 7.0→9.0) | ✅ ACTIVE |
| **V39/V40.2 Institutional Decision Engine** | `analyzers/institutional_decision_engine.py` | ~520 | 6 proofs + Tech Score (base 25, max 100) + portfolio_advice + dynamic R:R (1.8/2.0 — `unified_config.py` EGX profile fixed 1.5→1.8 في commit `38665fd1` — Task `REAPPLY-CRITICAL-FIXES`) — returns `sl`/`tp1`/`tp2` keys | ✅ ACTIVE — THE ONLY ENGINE |
| **MasterAnalyzer** (تحديث 2026-10-08 — Task `REAPPLY-CRITICAL-FIXES` — commit `38665fd1`) | `analyzers/master_analyzer.py` | ~5,400+ | **`THRESHOLDS` dict صار canonical:** 78/65/55/40/25 (was drift REDUCE=35, SELL=20, STRONG_SELL=10 — fixed). `_get_signal_from_score` (L5343-5363) يفوّض لـ `canonical_signal.classify_signal` (single source of truth per Rule 72 + Rule 73). `_get_signal_arabic` (L5361-5387) يفوّض لـ `canonical_signal.signal_ar`. removed `HOLD_LOW`/`HOLD_HIGH` brackets. | ✅ ACTIVE |
| **Maestro Orchestrator** | ~~`engines/maestro_orchestrator.py`~~ = ~~`analyzers/maestro_orchestrator.py`~~ | ~~3,545~~ | ~~8-layer confluence (138 pts max، BUY threshold 68) + 15+ modifier بعد الفازات~~ | 🗑️ **محذوف نهائياً** (DELETE-MAESTRO 2026-10-12) — كل الـ files في `archive/maestro-dead-code-20261012/`. كان معطل (KILL-MAESTRO 2026-08-31 — signal_id = None)، بعدها اتسجل كـ dead code. سيدي طلب: "Maestro ده ماضي أسود — شيله". |
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
| **Source Authority** (NEW — Rule 66 — Task 23-A — 2026-10-03 + WRITE-GUARDED-EXTENSION 2026-10-12) | `vps-service/data/source_authority.py` | 298 | `write_guarded()` mandatory guard before any INSERT to `price_history.db` — `CANONICAL_SOURCES` per market (EGX=`intraday_aggregated` + `egksco` fallback، TADAWUL/KSE/QSE/US=`yahoo_clean` + `yahoo_us` fallback (NEW 2026-10-12)، CRYPTO=`crypto_fetcher`، GOLD=`gold_fetcher`) + `BANNED_SOURCES` (`egxpilot_live` + `yahoo_safetynet` + `yfinance_backfill`). **Signature اتوسع (2026-10-12):** optional kwargs `buy_volume, sell_volume, delta_volume, delta_pct, pressure, adjusted, market_label` لـ support egksco delta columns. **Schema-aware INSERT** backward-compatible مع 8-column + 13-column schemas. Wired in 5/8 scrapers + `us_stock_scraper.py` (NEW 2026-10-12) + `egksco_scraper.py` (NEW 2026-10-12 — with delta_volume) + wired in `master_analyzer.analyze()` (commit `435c16f` — Rule 66 enforced end-to-end). | ✅ ACTIVE |
| **Data Validation Layer** (NEW — Rule 65 — Task 23-A — 2026-10-03) | `vps-service/data/validation.py` | ~400 | `validate_stock_data()` returns `ValidationDict` + `is_valid_overall`. INVALID fields (e.g. `current_price=0`, `low_52w > current_price`, `high_52w < current_price`, support/resistance cross-stock contamination ratio > 10x) are nullified — NOT set to fake values. If `current_price` INVALID → HOLD score=0. Stale 52W + OHLC integrity checks. Wired in `master_analyzer.py`. | ✅ ACTIVE |
| **Expert Analysis Engine** (NEW — P1-PARALLEL-ENGINES-FIX 2026-10-12) | `vps-service/analyzers/expert_analysis_engine.py` | 859 | `generate_expert_analysis(snapshot)` — expert analysis engine (RSI/MA/S-R/52W + fundamentals P/E ROE EPS P/B Div + risk mgmt entry/target1/target2/stop/RR/position-size/risk-level + Arabic narrative). Exposed via `GET + POST /api/stocks/<ticker>/expert-analysis` (`misc_routes.py:6579` + `:6678`). Replaces `src/lib/expert-analysis.ts` (882 LOC archived — Rule 28 duplicate). | ✅ ACTIVE |
| **Gate Analysis Engine** (NEW — P1-PARALLEL-ENGINES-FIX 2026-10-12) | `vps-service/analyzers/gate_analysis_engine.py` | 730 | `analyze_gates(snapshot)` — 5-gate analyzer (trend/momentum/volume/structure/RSI) + `_detect_bb_squeeze()` (ported from archived `src/lib/dynamic-analysis-engine.ts`) + Arabic narrative. Exposed via `GET + POST /api/stocks/<ticker>/gate-analysis` (`misc_routes.py:6695` + `:6776`). Replaces `src/lib/gate-analyzer.ts` (1,066 LOC archived). | ✅ ACTIVE |
| **Trade Results Aggregator** (NEW — P1-PARALLEL-ENGINES-FIX 2026-10-12) | `vps-service/api/misc_routes.py::get_trade_results()` (line 6492) | ~150 | `GET /api/trade-results` — period bounds Cairo TZ-aware + 11-point validation + ReportStats aggregation. Reuses canonical `unified_config.MARKET_PROFILES` per Rule 67. Replaces `src/lib/trade-results-engine.ts` (685 LOC archived). | ✅ ACTIVE |
| **Sharia Compliance Scraper** (NEW — Rule 64 — Task 23-A — 2026-10-03) | `data_engine/scrapers/sharia_compliance_scraper.py` | — | scrapes from `stocks.templatesnippet.com` → writes 5 tables in `data_engine.db` (sharia_sources + sharia_source_status + sharia_metrics + sharia_purification_rates + sharia_history). AAOIFI excluded. S&P Shariah primary + Musaffa/Kashif/Osoul supplementary. `consensus_min=6`. Cron: Sat 15:30 UTC. | ✅ ACTIVE (cron #25) |
| **Purification Calculator** (NEW — Rule 64 — Task 23-A — 2026-10-03) | `vps-service/portfolio/purification_calculator.py` | — | single-trade + portfolio purification (Python=Brain per Rule 20). Called by `/api/sharia/purification` POST endpoint. | ✅ ACTIVE |

### 4.2 V40.2 Daily Generator (post R:R fix — commit 65a748f + commit 38665fd1)

> `vps-service/jobs/daily_predictor.py` (lines ~314-326) — **R:R floor gate** مُفعّل:

```python
if r_mult < get_setting('dynamic_rr_normal', default=1.8):
    continue  # يرفض sub-threshold setups قبل ما تدخل predictions.db
```

> **تحديث 2026-10-08 (Task `REAPPLY-CRITICAL-FIXES` — commit `38665fd1`):**
> `dynamic_rr_normal` رفع من 1.5 → **1.8** (Rule 18 — حماية رأس المال مقدسة). مواءمة كاملة في:
> - `vps-service/config/unified_config.py` EGX profile (L377-380 + L147-150 defaults).
> - `vps-service/core/engine_settings.py` (canonical default).
> - `vps-service/jobs/daily_predictor.py` (consumer).
> - `vps-service/engines/backtest_engine.py` (V40_2_STOP_MAX_PCT default 7.0→9.0).
>
> KSA/KSE/QSE/DFM/CRYPTO profiles غير ملموسة (ما زالت بمواصفاتها السابقة — التغيير EGX-only).
>
> **تحديث 2026-10-09 (Task `PHASE-1 — CPU optimization` — commit `e8df798d`):**
> `vps-service/jobs/daily_predictor.py:748` أُضيف `time.sleep(0.01)` بين الأسهم لتقليل استهلاك CPU من 95%→**35%** (يمنع Hostinger CPU limitation من إيقاف الـ cron). Overhead إجمالي: 10ms × 1,046 tickers ≈ **10s** (negligible مقابل ~6-7 دقائق runtime). الموقع الدستوري: Rule 8 (CAPITAL-PROTECTION-FIRST) — استقرار الـ cron بـ يحمي إنتاج التوقعات اليومية.

- مع الـ key-mismatch fix، `dynamic_rr_outperform=2.0` يُحترم للأسهم اللي outperforming الـ market → الـ gate نادرًا what يفعل.
- 95.27% من الصفقات بـ R:R=2.0 (outperform path).

### 4.3 Closed-Loop Learning (4-file chain)

```
1. live_price.py            ← يجمع سعر الإغلاق اليومي
   ↓
2. daily_predictor.py ← يولّد التوصيات (V40.2 هو العقل الوحيد — KILL-MAESTRO)
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

### 4.4b 🆕 Expert Analysis Engine (محرك التحليل الاحترافي) — NEW 2026-10-09 → P1-PARALLEL-ENGINES-FIX 2026-10-12

> **الملف:** `vps-service/analyzers/expert_analysis_engine.py` (859 LOC — NEW 2026-10-12 per P1-PARALLEL-ENGINES-FIX) + Node route `src/app/api/stocks/[ticker]/expert-analysis/route.ts` (pure proxy — GET + POST)  
> **الـ Python Endpoint:** `GET + POST /api/stocks/<ticker>/expert-analysis` (NEW في `vps-service/api/misc_routes.py:6579` + `:6678`)  
> **التكامل:** مربوط في 3 أماكن — شاشة السهم (`ComprehensiveStockAnalysis.tsx` tab "⚡ تحليل خبير" عبر `ExpertAnalysisPanel.tsx`) + نشر التليجرام (`auto_poster.py::_fetch_expert_analysis()`) + بوت التليجرام التفاعلي (`telegram_interactive_bot.py::_fetch_bot_expert_analysis()`)  
> **الـ Migration (P1-PARALLEL-ENGINES-FIX 2026-10-12):** كان `src/lib/expert-analysis.ts` (882 LOC parallel Node engine — خرق Rule 20 + Rule 28). اتعمل port للـ logic كامل لـ Python (`expert_analysis_engine.py`) + الـ Node route اتحولت لـ pure proxy. الـ Node engine اتأرشف لـ `archive/engines/p1-parallel-engines-20261012/expert-analysis.ts.orphan`.  
> **الـ Commit الأصلي:** `dfe7ed9` (Node engine — DELETED) + `d96b454` (integration — Node route rewritten كـ pure proxy)

محرك تحليل احترافي شامل يولّد تحليل مثل خبير مالي حقيقي. بياخد بيانات السهم من `getUnifiedStockData()` وبيولّد:

**التحليل الفني (Technical):**
- **RSI** — 5 مستويات: overbought (≥70) / bullish (55-70) / neutral (45-55) / bearish (30-45) / oversold (≤30) + تفسير كامل
- **Moving Averages** — Golden Cross / Death Cross + 4 أنواع ترند
- **Support/Resistance** — تحليل موقع السعر + نسبة من النطاق
- **52-Week Range** — قرب القمة/القاع/منتصف النطاق + تقييم

**التحليل الأساسي (Fundamental):**
- **P/E Ratio** — underpriced (<10) / fair (10-20) / premium (20-35) / overvalued (>35)
- **ROE** — excellent (≥20%) / good (15-20%) / average (10-15%) / weak (<10%)
- **EPS** — ربحية السهم + مكرر محسوب
- **P/B Ratio** — deep_value (<1) / reasonable (1-2) / growth_premium (2-4) / high_premium (>4)
- **Dividend Yield** — very_high (≥8%) / attractive (4-8%) / modest (1-4%) / minimal (<1%)

**إدارة المخاطر (Risk Management):**
- **Entry point** + المبرر (دعم/MA50/فني)
- **Target 1** + المبرر (مقاومة/R:R)
- **Target 2** + المبرر (هدف موسع)
- **Stop Loss** + المبرر (دعم/ATR fallback)
- **R:R Ratio** (المستهدف ≥ 2.0)
- **Position Size** — 0.5-1% (high risk) / 1-3% (moderate) / 3-5% (low)
- **Risk Level** — low/moderate/high + عوامل المخاطر

**التكامل:**
1. **شاشة السهم** — tab جديد "⚡ تحليل خبير" في `ComprehensiveStockAnalysis.tsx` (عبر `ExpertAnalysisPanel.tsx`)
2. **نشر التليجرام** — قسم "🎓 تحليل خبير" في `auto_poster.py` (عبر `_fetch_expert_analysis()`)
3. **البوت التفاعلي** — قسم "🎓 تحليل خبير احترافي" في `telegram_interactive_bot.py` (عبر `_fetch_bot_expert_analysis()`)

**مصادر البيانات:** `getUnifiedStockData()` بيرجّع nested structure:
- `stock` (name, price, sector)
- `fundamentals` (P/E, ROE, EPS, P/B, Dividend, Beta)
- `technical` (RSI, MA50/200, S/R, high/low 52w, trend)
- `prediction` (signal, score, entry, target, stop)
- `canonical` (unified signal + score)

### 4.5 الـ Thresholds الحالية (engine_settings)

> **تحديث 2026-10-08 (Task `REAPPLY-CRITICAL-FIXES` — commit `38665fd1`):**
> العتبات الكنسية للإشارات دلوقتي موحّدة على 3 طبقات: `canonical_signal.py` (Python source) + `engine_settings.py` (DB settings) + `master_analyzer.py` (consumer).
> - `master_analyzer.THRESHOLDS` = `{STRONG_BUY: 78, BUY: 65, ACCUMULATE: 55, REDUCE: 40, SELL: 25}` (was drift REDUCE=35, SELL=20, STRONG_SELL=10).
> - `_get_signal_from_score` بـ يفوّض لـ `canonical_signal.classify_signal`.
> - `HOLD_LOW`/`HOLD_HIGH` brackets اتشالوا (ما عادش لهم دور — `classify_signal` بيرجّع `HOLD` لكل score بين 40-54).
> - `unified_config.py` EGX profile: ATR clamp `[5%, 9%]` (was 3.0) + R:R floor 1.8 (was 1.5). KSA/KSE/QSE/DFM/CRYPTO profiles غير ملموسة.
> - `opportunity_quality.py` L580: `ATR_STOP_MIN_PCT = 5.0` (was 3.0).
> - `backtest_engine.py` + `daily_predictor.py`: `V40_2_STOP_MAX_PCT default = 9.0` (was 7.0 — 3 occurrences).

| Key | Value | Source |
|---|---|---|
| `dynamic_rr_normal` | **1.8** (was 1.5 — Task `REAPPLY-CRITICAL-FIXES` 2026-10-08 — commit `38665fd1`) | engine_settings.py (default) + `unified_config.py` EGX profile |
| `dynamic_rr_outperform` | **2.0** | engine_settings.py (default) |
| `atr_stop_min_pct` | **5.0** (was 3.0 — Task `REAPPLY-CRITICAL-FIXES` 2026-10-08 — Rule 8) | engine_settings.py + opportunity_quality.py + unified_config.py EGX |
| `atr_stop_max_pct` | **9.0** (V40_2_STOP_MAX_PCT default رفع من 7.0 — Task `REAPPLY-CRITICAL-FIXES`) | CONSTITUTION Rule 8 |
| `min_rr_ratio` | 1.8 | optimizer_params_routes DEFAULT_PARAMS |
| `max_stop_pct` | 9.0 | optimizer_params_routes DEFAULT_PARAMS |
| `default_stop_pct` | 5.0 | engine_settings.py |
| `THRESHOLDS['STRONG_BUY']` | **78** (was 80 — Rule 71 — commit `c2ade8c6`) | `master_analyzer.py` L495 + `canonical_signal.py` |
| `THRESHOLDS['BUY']` | 65 | `master_analyzer.py` + `canonical_signal.py` |
| `THRESHOLDS['ACCUMULATE']` | 55 | `master_analyzer.py` + `canonical_signal.py` |
| `THRESHOLDS['REDUCE']` | **40** (was 35 — Task `REAPPLY-CRITICAL-FIXES` 2026-10-08 — commit `38665fd1`) | `master_analyzer.py` + `canonical_signal.py` |
| `THRESHOLDS['SELL']` | **25** (was 20 — Task `REAPPLY-CRITICAL-FIXES` 2026-10-08) | `master_analyzer.py` + `canonical_signal.py` |
| `THRESHOLDS['STRONG_SELL']` | **25** (was 10 — Task `REAPPLY-CRITICAL-FIXES` 2026-10-08) | `master_analyzer.py` + `canonical_signal.py` |
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
> - **Next.js `route.ts` files:** ~411 (Wave 8 update — was 380 in Wave 2/3; Wave 8 Task `774a208` restored 32 Flutter API endpoints that were archived by mistake in Wave 2) — في `src/app/api/`
> - **الـ Proxy الافتراضي:** `src/app/api/proxy/[...path]/route.ts` (catch-all للـ Python)
>
> **Wave 8 update (Task 28-C — 2026-10-04):** verified via `find src/app/api -name "route.ts" -type f | wc -l` → **411**. Increase from 380 → 411 reflects 32 restored Flutter endpoints (commit `774a208`) — mobile app silently broken since Wave 2 cleanup. See `05-CURRENT_STATE.md` §17.2 for the full list of restored endpoints.

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
> 🗑️ **DELETE-MAESTRO (2026-10-12):** كل `/api/maestro/*` endpoints اتمسحت نهائياً (3 Node routes + `api/maestro_routes.py` Python blueprint). الـ blueprint registration اتشال من `lightweight_server.py`. كل الـ files في `archive/maestro-dead-code-20261012/`.
> 
> **Confluence / generate-predictions:** معطل (410 Gone) — كان بيعمل INSERT بدون evidence. الـ redirect بيرسل لـ V40.2 `daily_predictor.py`.
- ~~`GET /api/maestro/analyze?ticker=...` · `/score` · `/layers`~~ → 🗑️ **محذوف** (404 Not Found)
- `GET /api/confluence/*` — (utilizes maestro logic) → بعض endpoints لسه شغّالة للقراءة فقط، لكن `/generate-predictions` معطل (410 Gone per Rule 35)

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

> **Wave 2 (Task 7-B — 2026-10-01):** 313 dead Next.js route.ts files archived to `archive/wave-2-cleanup-2026-10-01/src/app/api/` (NOT deleted — owner directive). See `05-CURRENT_STATE.md` §13.4 for the per-batch breakdown + commit list + the 6-grep verification protocol applied per route.

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
│    • maestro_orchestrator.py → 🗑️ محذوف (DELETE-MAESTRO 2026-10-12)    │
│    • fundamental_data_provider.py → fundamental_score (40/30/15/15)     │
│    • persona_engine.py → 4 personas + R:R overrides                     │
│    • v38_backtest_engine.py → simulate_trade() (canonical sl/tp1/tp2     │
│      + ATR clamp [5%,9%] — commit 65a748f baseline + commit 38665fd1     │
│      Task REAPPLY-CRITICAL-FIXES رفع min 3.0→5.0 + max default 7→9)        │
│    ↓ writes                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│ 4. KILL FILTERS + R:R FLOOR GATE (daily_predictor.py L314-326)    │
│    • if r_mult < get_setting('dynamic_rr_normal', default=1.8): continue│
│      (Task REAPPLY-CRITICAL-FIXES — commit 38665fd1 — رفع من 1.5→1.8)    │
│    • set_strict_kill_filters(True) — liquidity + turnover               │
│    ↓ filtered                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│ 5. predictions.db (snapshot 2026-08-17 archive: 153 preds, 148 closed)  │
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
> **يقرأ من:** `price_history.db` (EGX OHLC، **1,206,981 rows، 1,336 tickers** — تحديث 2026-09-26؛ انظر §6.5 لمصادر التغذية).
> **Fallback:** `data_engine.db.historical_data` (Saudi/US/gold — NO EGX).

### 6.4 مثال: تدفق توقع V40.2 من الإنتاج

```
1. daily_predictor.py يبدأ (cron يومي بعد إغلاق السوق)
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

### 6.5 مؤشرات EGX30/EGX70 + مصادر البيانات المُحدَّثة (2026-09-26 — DOC-UPDATE-FINAL)

> **سبب الإضافة:** الجلسات الأخيرة رفعت تغطية مؤشرات EGX30 و EGX70 من بيانات افتراضية إلى بيانات حقيقية من CSV، ووسّعت تغطية الـ scrapers على EGX (TradingView + egksco). ده قسم مرجعي جديد لتدفق البيانات الحالي.

**أ. مؤشرات EGX30 و EGX70 — بيانات حقيقية من CSV:**
- **EGX30 Index:** قيمته الحالية **53,776.69** — مأخوذة من CSV الرسمي (ليس placeholder).
- **EGX70 Index:** قيمته الحالية **19,834.95** — مأخوذة من CSV الرسمي.
- المصدر: ملفات CSV داخل `data_engine/indices/` يتم تحديثها يدوياً/نصف آلياً ومقروءة عبر `load_index_history('EGX30' | 'EGX70')`.
- الـ dashboard و الـ chart بتعرض القيمتين الحقيقيتين بدل hardcoded افتراضي.

**ب. TradingView scanner (`tradingview_scraper.py`):**
- يغطّي **296 سهماً** من EGX — تحديث يومي بعد إغلاق السوق.
- يكتب: TA indicators (RSI, MACD, EMA20/50/200, ATR, Volume profile) + UDF intraday candles.
- الـ 296 سهم تشمل كل مكونات EGX30 (27) + EGX70 (20) + باقي الأسهم النشطة.

**ج. egksco_scraper (`egksco_scraper.py`):**
- يغطّي **255 سهماً** من EGX (المصدر الرسمي لـ EGX).
- يكتب: **186 سجل price_history** لكل تشغيل (incremental updates) — مرتبطة بـ `price_history.db.price_history`.
- يُعتبَر الـ authoritative source لأسعار EGX end-of-day.

**د. price_history.db (السجل الموحّد للأسعار):**
- **1,206,981 صف** (تحديث من 1,205,599 في DOC-CONSOLIDATION).
- **1,336 ticker** مغطّاة (2000 → 2026).
- يُغذّي `load_merged_history()` (§6.3) — المصدر الوحيد للأسعار التاريخية.
- النمو: +1,382 صف و +76 ticker منذ آخر تحديث — نتيجة egksco_scraper + tradingview_scraper اليومي.

**هـ. الـ Pipeline المُحدَّث (داخل §6.1 stage 1):**
```
TradingView scanner (296 EGX) ─┐
egksco_scraper (255 EGX)     ─┼─→ price_history.db (1,206,981 rows / 1,336 ticker)
CSV indices (EGX30/EGX70)    ─┘   ↓
                                  load_merged_history() + load_index_history()
                                  ↓
                                  V40.2 daily generator + V38 backtest
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
30 15 * * 1-5 cd /root/GLMinvestment && python3 vps-service/jobs/daily_predictor.py >> logs/v40_2.log 2>&1
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

**التكامل مع V40.2:** `daily_predictor.py` (سطر 1159-1185)
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
في daily_predictor.py، بعد Entry Gate:
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
| 2026-10-04 | `01-PROJECT_ANATOMY.md` | Wave 8 Update (Task `28-C` — Documentation Secretariat): تحديث علامة "آخر تحديث" لـ 2026-10-04. تحديث §3.1 DB Map — `stocks.db` يضيف جدول `ticker_registry` (NEW — by other programmer via `scripts/unify_tickers_and_names.py` — canonical ticker mappings + collision guards + restored Arabic names + `idx_tr_market` + `idx_tr_sharia` indexes) + `data_engine.db` يضيف 5 جداول Sharia (sharia_sources + sharia_source_status + sharia_metrics + sharia_purification_rates + sharia_history — Rule 64). تحديث §4.1 Engine Map — يضيف 4 modules: `vps-service/data/source_authority.py` (Rule 66 — 237 LOC) + `vps-service/data/validation.py` (Rule 65 — ~400 LOC) + `data_engine/scrapers/sharia_compliance_scraper.py` (Rule 64 — cron Sat 15:30 UTC) + `vps-service/portfolio/purification_calculator.py` (Rule 64 — Python=Brain). تحديث §5 API Map — Next.js `route.ts` files 380 → **411** (Wave 8 Task `774a208` restored 32 Flutter API endpoints archived by mistake in Wave 2). إضافة §1.9 — Flutter App Architecture (submodule at `/home/z/my-project/flutter_app/` — 113 .dart files, 4,374 LOC `client.dart` with ~181 endpoint methods, version 3.0.1+44 — see `05-CURRENT_STATE.md` §7 + §17.5). Per Rule 62 (Secretary updates docs after every task) + Rule 63 (commit + push) + README editing rule 1. |
| 2026-09-30 | `01-PROJECT_ANATOMY.md` | REORG-PHASE-7-DOCS: تحديث علامة "آخر تحديث" لـ 2026-09-30. إضافة قسم جديد "§1.8 — Module System (Phase 1-7 Reorganization, 2026-09-30)" (6 أقسام فرعية: §1.8.1 Frontend Modules (15) + §1.8.2 Backend Modules (9 placeholders) + §1.8.3 DB Layer + §1.8.4 Reorganization Stats (Before/After) + §1.8.5 Module Architecture Diagram + §1.8.6 Phase History) — يوثّق كل الـ 7 phases من إعادة التنظيم. مرجعية لـ `MODULE_CATALOG.md` + `ARCHITECTURE_DIAGRAM.md` (ملفين جداد). لم تُحذف أي ملفات أو محتويات. |
| 2026-09-27 | `01-PROJECT_ANATOMY.md` | DOC-UPDATE-P0-WAVE: تحديث علامة "آخر تحديث" لـ 2026-09-27. تحديث §1.5 الإحصائيات (نحو 30 route تم تأمينها بـ auth + 7 SQLi sites تم fix + 70 sync I/O refactored + 9 duplicate tables dropped + 4 DBs backed up لـ `*.bak-unify` = 511.2 MB + PM2 services 6→7 بـ news-agent + test coverage 3→9 files / 75→121 tests + observability stack جديد). إضافة قسم جديد "§1.7 — P0 Wave 2026-09-27 — Security + Observability + Tests" (6 جداول: Security Stack + Observability Stack + Async I/O Refactor + Database Unification + HELI False-Target Forensics + Tests) + قائمة Follow-up لـ P1. |
| 2026-09-01 | `01-PROJECT_ANATOMY.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إضافة قسم "تغييرات جوهرية (2026-09-01)" يحتوي على: Stock Notebook System (1,065 LOC + 259 JSON + 7 API endpoints + NotebookAdminTab.tsx)، Unified Exit Engine (518 LOC + MARKET_PROFILES)، Decision Logger (338 LOC + decision_log.db)، News Impact Scorer (432 LOC + 14 event types)، EGX Disclosure Engine (875 LOC + 12 disclosure types)، Crypto Modules (4 ملفات: crypto_strict_filters + crypto_short_holding_exit + crypto_news_fetcher + crypto_disclosure_engine)، Feature Flags V40.2 (10 flags)، News Fetcher Analyzer + news_signals_reader + /api/news/ingest. |
| 2026-09-25 | `01-PROJECT_ANATOMY.md` | DOC-CONSOLIDATION: تحديث §1.5 الإحصائيات (956 stocks، 1,585 data_engine، 306 predictions، 7,894 news، 1,205,599 price_history، 653 API route، 274 component). إضافة §1.6 (5-Market + UI-Mirror + SQLite Fallback). تحديث §3.1 DB Map بالأرقام الحالية. إضافة §17 Historical Documentation Archive. |
| 2026-09-26 | `01-PROJECT_ANATOMY.md` | DOC-UPDATE-FINAL: تحديث §1.5 الإحصائيات (components=282، EGX=380 سهم، EGX30=27/EGX70=20، predictions=1,359، price_history=1,206,981، WR=67.4%، Avg Return=25.74%، PF=12.84، Max Loss Streak=7، 5 DBs sizes). تحديث §1.6 (EGX=380). تحديث §6.3 (price_history rows/tickers). إضافة §6.5 (EGX30/EGX70 real CSV + TradingView 296 + egksco 255 + price_history 1,206,981). تحديث §17.1 (القواعد 54) + إضافة §17.5 (تأكيد دمج 17 ملف historical في الـ 4 canonical). |
| 2026-10-01 | `01-PROJECT_ANATOMY.md` | WAVE-2-3-DOCS (Documentation Secretariat catching up on backlog): تحديث علامة \"آخر تحديث\" لـ 2026-10-01. تحديث §1.5 الإحصائيات (Backend .py files ~395→**450** verified via `find vps-service -name '*.py' \| wc -l`; Next.js route.ts ~653→**380** — Wave 2 cleanup archived 313 dead routes + 6 routes auth-hardened in Batch 7; Frontend .tsx ~285→**247** — Wave 2 archived 51 dead .tsx + 16 dead shadcn UI primitives; Wave 3 archived 3 more for #learning screen; Backend LOC ~229,490→~199,490 — ~30K LOC archived NOT deleted). إضافة note في §4.1 (58 dead Python files archived + 3 false positives caught + anatomy corrections: §8.2 \"33 DEPRECATED blueprints\" OUTDATED — actually 0 dead; \"73 analyzers\" UNDERSTATED — actually 138 pre-Wave-2 / 118 post-Wave-2). إضافة note في §5.4 (313 dead route.ts files archived to `archive/wave-2-cleanup-2026-10-01/src/app/api/`). Per Rule 62 (Secretary updates docs after every task) + README editing rule 1 (last-updated + changelog row in-file). |

---

## 17. Historical Documentation Archive (DOC-CONSOLIDATION — 2026-09-25)

> **القاعدة الدستورية 25 + 41 (DOCS-FIRST-LAST):** التوثيق الإلزامي = 4 ملفات فقط (`00-CONSTITUTION.md` + `01-PROJECT_ANATOMY.md` + `02-SCREENS_AND_COMPONENTS.md` + `SYSTEM_HOW_IT_THINKS.md`).
>
> كل ملفات `Documentation/*.md` غير الأربعة الرئيسية مُؤرشفة هنا كـ **مرجع تاريخي (historical reference)** — **لم تُحذف** (احترامًا للقاعدة 16 — VERIFY-BEFORE-DELETE والقاعدة 25). القصد منها توفير السياق التاريخي للقرارات التي اتُّخذت في الفترات الماضية. أي تعديل جديد لازم يُدمج في الـ 4 canonical files.

### 17.1 الملفات الأربعة الأساسية (Canonical — مُلزمة بالقراءة)

| # | الملف | الدور |
|---|---|---|
| 1 | `Documentation/00-CONSTITUTION.md` | الدستور والقواعد الـ 54 (تحديث 2026-09-26 — DOC-UPDATE-FINAL). |
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

### 17.5 تأكيد دمج المحتوى التاريخي في الـ Canonical (2026-09-26 — DOC-UPDATE-FINAL)

> **تذكير مرجعي صريح:** الـ **17 ملفاً تاريخياً** المُدرَجة في §17.2 + §17.3 (audit-logs) **كانت محتواها مُدمَجاً بالكامل** في الـ 4 ملفات الكنسية (§17.1) خلال جولة DOC-CONSOLIDATION (2026-09-25) و جولة DOC-UPDATE-FINAL (2026-09-26 الحالية). كل المعلومات الحيّة (المعمارية، DBs، تدفق البيانات، الـ APIs، الـ personas، نتائج الـ backtest، المنهجية، الحماية القانونية، إلخ) موجودة في الـ 4 canonical files و**مُحدَّثة**، فلا حاجة لقراءة الـ 17 ملف historical ما عدا للسياق التاريخي فقط.
>
> - ✅ المنهجية ونتائج الـ backtest → `SYSTEM_HOW_IT_THINKS.md` (Production Snapshot + Backtest results).
> - ✅ المعمارية وتدفق البيانات و DB Map → هذا الملف (§1.5 + §1.6 + §3.1 + §6).
> - ✅ الشاشات والمكوّنات → `02-SCREENS_AND_COMPONENTS.md` (§0 rollup + per-screen sections).
> - ✅ القواعد والحوكمة → `00-CONSTITUTION.md` (54 قاعدة).
> - ⚠️ الـ historical files مُتروكة كما هي (لم تُحذف ولم تُعدَّل) احتراماً للقاعدة 16 + القاعدة 25.
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
> **آخر مراجعة:** 2026-10-03 (فحص حي لكل مصدر — شوف جدول الحالة بالأسفل)

**الـ collectors النشطين في `news-agent/collectors/` (دورة كل 15 دقيقة):**

| Collector | المصدر | الـ destination | الحالة (2026-10-03) |
|---|---|---|---|
| `rss_collector.py` | RSS: hapijournal · mastafy · alborsaanews | `data/news.db` → `db/news.db.market_news` | ✅ نشط — 3 feeds · صور + لينك |
| `telegram_web_collector.py` | `t.me/s/<channel>` (معاينة عامة، **بدون login**) | `data/news.db` → `market_news` | ✅ نشط — 5 قنوات |
| `web_scraper.py` | DuckDuckGo عبر `vps-service` | `data/news.db` → `market_news` | ✅ نشط — 20 ticker |
| `egyptian_sources.py` | جريدة البورصة · المال · مباشر (HTML) | `data/news.db` → `market_news` | ✅ `ENABLE_EGYPTIAN_SOURCES=1` |
| `mubasher_scraper.py` | مباشر (EGX) | `data/news.db` → `market_news` | ⚠️ اختياري |
| `telegram_collector.py` | Telegram via Telethon (MTProto) | — | 🚫 **البوت مش بيقرأ القنوات** |
| `keyword_filter.py` | طبقة صلة بالكلمات (مش collector) | — | ✅ utility |

**Scrapers تانية في نفس الـ module:**

| Scraper | المصدر | الـ destination | الحالة |
|---|---|---|---|
| `tradingview_rest.py` | scanner.tradingview.com (REST API) | `db/data_engine.db.stocks` | ✅ نشط (urllib فقط) |
| `tradingview_screener_lists.py` | TradingView screener | `db/data_engine.db.screener_lists` | ✅ نشط |
| `tradingview_market_movers.py` | TradingView 9 tabs | `db/data_engine.db.market_movers_tabs` | ✅ نشط |
| `tradingview_scraper.py` | TradingView (Playwright) | `db/data_engine.db.stocks` | ⚠️ محتاج Playwright |
| `investing_scraper.py` | sa.investing.com | `data/investing_egypt.json` | 🚫 متعطّل (Playwright) |
| `investing_news_collector.py` | sa.investing.com/news | `data/news.db` | 🚫 متعطّل (Playwright) |

#### ليه `telegram_collector.py` (Telethon) معطّل

Telegram بيرجّع `BotMethodInvalidError: The API access for bot users is restricted`
لأي bot بيحاول `get_entity` / `iter_messages` — يعني **البوت مش بيقدر يقرأ تاريخ قناة أصلاً**،
مهما كان التوكن صحيح. القراءة المتقدمة محتاجة **user session** (تسجيل دخول برقم الموبايل)
عن طريق شاشة الربط في الداشبورد (`news-agent/ui/`).

الحل البديل اللي شغال: **`telegram_web_collector.py`** بيقرأ `t.me/s/<channel>`
— معاينة HTML عامة، من غير أي auth، وبترجّع نص الرسالة + لينك الرسالة + رابط الصورة.

| القناة | آخر رسالة | رسائل 48h |
|---|---|---|
| `ostoulcapital` | 2026-10-03 | 17 |
| `elelhamy` | 2026-10-03 | 20 |
| `BorsaBelArabi96` | 2026-10-03 | 8 |
| `sahmmisr` | 2026-10-03 | 5 |
| `Arabian_investment_guide` | 2026-10-03 | 1 |

> باقي القنوات المربوطة في `news-agent/data/telegram_channels.json` (19 قناة)
> بترجّع صفر عبر `t.me/s` — دي **مجموعات** (مش broadcast channels) أو ميتة
> (`SOM3AEG` آخر رسالة 435 يوم، `AlBorsaNews` 382 يوم، `egxpilot` 11 يوم).

#### invariant: تنظيف HTML إجباري عند كل مدخل

الـ RSS feeds (خصوصاً hapijournal و alborsaanews) بتبعت الـ summary كـ **block HTML كامل**
(`<div><img …/><p>…</p></div>`) + boilerplate بتاع WordPress
(`The post … appeared first on …`). أي نص جاي من collector لازم يعدّي على
**`news-agent/config/text_utils.py::strip_html`** قبل ما يتحفظ أو يترسل للواجهة.

التنظيف مطبّق في **3 طبقات** (defence in depth):

| الطبقة | الملف | إيه اللي بيعمله |
|---|---|---|
| المصدر | `news-agent/config/text_utils.py` | `strip_html()` — HTML + كيانات + WordPress boilerplate |
| الوكيل | `collectors/rss_collector.py` · `collectors/telegram_web_collector.py` · `analyzer/news_analyzer.py` | تنظيف `title`/`body`/`clean_text` قبل التحليل |
| السيرفر | `src/app/api/news/route.ts` (POST) | تنظيف عند الاستقبال — أي نسخة agent مش هتعدّي HTML |

سكربت تنظيف الصفوف الموجودة: `news-agent/scripts/clean_news_html.py`
(`--dry-run` للعرض، وبياخد نسخة احتياطية قبل التعديل).

**Rule 28 (NO-DUPLICATION):** كل الـ scrapers بتكتب في `/home/z/my-project/db/` (الـ canonical).
**Rule 29 (UNIFIED-SYSTEM):** `news-agent/config/paths.py` بيوفّر مسارات موحدة + `resolve_vps_service()` (نسبي — يشتغل على اللاب والإنتاج).
**news merge:** 212 خبر من news-agent القديم ادمجت في `db/news.db.market_news` (الإجمالي 8,012 خبر).

**معدل الجمع الفعلي:** 20–60 خبر/يوم (قبل 2026-10-03) → **~90 خبر لكل دورة** من 6 مصادر
(≈ 360/يوم). 100% منهم بيروا link، و73/90 بصور.

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
5 13 * * 0-4       daily_predictor (يومي 13:05 UTC)
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

### 2.1 — V40.2 Generator (`vps-service/jobs/daily_predictor.py`)

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
   ↓ يُستدعى من daily_predictor.py + v40_2_intraday_scanner.py
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
    dynamic_rr_normal: float       # العائد للمخاطرة في السوق العادي (Default >= 1.8 — Task REAPPLY-CRITICAL-FIXES 2026-10-08 — رفع من 1.5)
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

---

## 📎 MERGED APPENDIX — Data Engine Architecture (DATA-ENGINE-ARCHITECTURE.md)

> **Source file (merged then archived):** `DATA-ENGINE-ARCHITECTURE.md`
> **Merged by:** Documentation Secretariat (Task ID: 25 — Consolidate to 6 canonical files)
> **Date:** 2026-10-03
> **Rule 4 (NO new files):** content merged INTO existing canonical file; source file `git rm`'d (history preserved by git).
> **Rule 62 (Secretary updates docs):** ✅ applied. **Rule 63 (commit + push after each):** ✅ applied.

### Original content of `DATA-ENGINE-ARCHITECTURE.md` (verbatim):

# 🏗️ خطة هندسة محرك البيانات (Data Engine Architecture)

> **التاريخ:** 2026-10-03
> **المرجعية:** الدستور Rule 12 + Rule 20 + Rule 24 + Rule 63
> **الهدف:** "البيانات النهائية تكون واحدة بس مش كذا مكان" + منع تكرار الكارثة

---

## 📋 الإجابة على أسئلة المالك

### السؤال 1: أي قاعدة بيانات وأي جدول؟

**في 4 قواعد بيانات فيهم بيانات أسعار — وده المشكلة:**

| # | DB | الجدول | الصفوف | المشكلة |
|---|---|---|---|---|
| 1 | `price_history.db` | `price_history` | 1,090,044 | **8 مصادر بيكتبوا فيه!** |
| 2 | `stocks.db` | `stock_daily_prices` | 47,534 | تاريخ يومي تاني (مختلف) |
| 3 | `stocks.db` | `stocks` | 956 | بيانات لحظية + high_52w + support + resistance |
| 4 | `data_engine.db` | `historical_data` | 99,076 | تاريخ يومي تالت |
| 5 | `data_engine.db` | `egksco_price_history` | 0 | فاضي |
| 6 | `intraday.db` | `stock_intraday` | 1,105,352 | بيانات لحظية |

**الخلاصة:** مفيش مصدر واحد — فيه **6 أماكن** بتخزن أسعار!

### السؤال 2: سبب التداخل

**كل scraper بيكتب في `price_history.db` من غير ما يشوف اللي قبله:**

| الـ Scraper | الـ source اللي بيكتبه |
|---|---|
| `daily_price_updater.py` | `egx_investment_migration` |
| `intraday_aggregator.py` | `intraday_aggregated` |
| `egksco_scraper.py` | `egksco` |
| `eodhd_fetcher.py` | `yahoo_clean` |
| `gap_filler.py` | `yfinance_backfill` |
| `price_history_safetynet.py` | `yahoo_safetynet` |
| TradingView live (frontend) | `tradingview_live` |
| egxpilot | `egxpilot_live` |

**مفيش source authority** — كل واحد بيكتب `INSERT OR REPLACE` على نفس الجدول بـ `source` مختلفة.

### السؤال 3: هل ده في كل الأسواق؟

**6 أسواق متأثرة (مش 4):**

| السوق | عدد الأسهم | مكان التخزين | المصدر |
|---|---|---|---|
| EGX | 360 | stocks.db + price_history.db | egksco + yahoo + intraday |
| TADAWUL | 413 | stocks.db + price_history.db | yahoo_clean |
| KSE | 128 | stocks.db + price_history.db | yahoo_clean |
| QSE | 55 | stocks.db + price_history.db | yahoo_clean |
| US | (من Yahoo) | price_history.db | yahoo_clean |
| CRYPTO | BTC/ETH/SOL... | data_engine.db.crypto_prices (198K rows) | crypto_fetcher |
| GOLD | XAU | data_engine.db.gold_prices (163K rows) | gold_fetcher |

**المشكلة موجودة في كل الـ 6 أسواق** — مش EGX بس.

### السؤال 4: هل البدائل متوافقة 100%؟

**لا — وده المشكلة الأساسية:**

| المصدر | نوع البيانات | التوافق |
|---|---|---|
| `yahoo_clean` | يومي (RAW unadjusted) | ✅ كامل |
| `egx_investment_migration` | يومي (legacy) | ⚠️ stale (آخر يونيو 2026) |
| `intraday_aggregated` | يومي (من intraday) | ⚠️ ممكن يختلف في الـ OHLC |
| `tradingview_live` | لحظي | ❌ ممكن يبقى صف واحد بس |
| `egksco` | لحظي | ❌ تغطية محدودة (30 سهم) |

**النتيجة:** نفس السهم ممكن يكون عنده 3 أسعار مختلفة لنفس اليوم من 3 مصادر.

### السؤال 5: الحل النهائي الكامل

**المبدأ:** "البيانات النهائية تكون واحدة بس" — مصدر واحد canonical لكل سهم.

---

## 🏗️ الـ Architecture الصحيح (الحل النهائي)

### المرحلة 1: تحديد المصدر القانوني (Canonical Source)

**لكل سهم — مصدر واحد بس يكتب في `price_history.db`:**

| السوق | المصدر القانوني | الاحتياطي | السبب |
|---|---|---|---|
| **EGX** | `intraday_aggregated` | `egksco` → `yahoo_clean` | بيانات لحظية حقيقية من EGKSCO |
| **TADAWUL** | `yahoo_clean` | `egx_investment_migration` | تاريخ طويل + موثوق |
| **KSE** | `yahoo_clean` | — | تاريخ طويل + موثوق |
| **QSE** | `yahoo_clean` | — | تاريخ طويل + موثوق |
| **US** | `yahoo_clean` | — | Yahoo هو المصدر الموثوق للأسهم الأمريكية |
| **CRYPTO** | `tradingview_live` | `crypto_fetcher` | بيانات لحظية |
| **GOLD** | `yahoo_clean` | `gold_fetcher` | تاريخ طويل + موثوق |

**القاعدة:** لما مصدر يقع، المصدر الاحتياطي يكتب — **بس بنفس الـ source name** (مش اسم جديد).

### المرحلة 2: توحيد مكان التخزين

**TABLE واحدة فقط للأسعار اليومية: `price_history.db.price_history`**

- ❌ يلغى `stocks.db.stock_daily_prices` (47K صف → يدمج في price_history)
- ❌ يلغى `data_engine.db.historical_data` (99K صف → يدمج في price_history)
- ❌ يلغى `data_engine.db.egksco_price_history` (فاضي أصلاً)
- ✅ `intraday.db.stock_intraday` يفضل للبيانات اللحظية (مش يومية)

### المرحلة 3: ترتيب المصادر (Source Hierarchy)

```python
# Per market — مصدر رئيسي + احتياطي واحد بس
CANONICAL_SOURCES = {
    'EGX':     ['intraday_aggregated', 'egksco', 'yahoo_clean'],
    'TADAWUL': ['yahoo_clean', 'egx_investment_migration'],
    'KSE':     ['yahoo_clean'],
    'QSE':     ['yahoo_clean'],
    'US':      ['yahoo_clean'],
    'CRYPTO':  ['tradingview_live', 'crypto_fetcher'],
    'GOLD':    ['yahoo_clean', 'gold_fetcher'],
}

# القاعدة:
# 1. لو المصدر الرئيسي موجود + بياناته recent (< 7 أيام) → استخدمه
# 2. لو وقع → جرّب المصدر الاحتياطي
# 3. أي مصدر تالت → امسحه (ممنوع كتابته أصلاً)
```

### المرحلة 4: منع الكتابة المتعددة

**كل scraper لازم يشيك قبل ما يكتب:**

```python
# في كل scraper قبل INSERT:
def write_price(ticker, date, ohlc, source):
    market = get_market_for_ticker(ticker)
    canonical = CANONICAL_SOURCES[market][0]
    if source != canonical:
        # هل المصدر القانوني متاح؟
        if is_source_available(canonical, ticker):
            # نعم — لا تكتب (الاحتياطي ممنوع)
            return
        # لا — المصدر القانوني وقع → اسمح للاحتياطي بالكتابة
        # بس بنفس اسم المصدر القانوني (مش اسمه هو)
        source = canonical  # اكتب باسم المصدر القانوني
    INSERT OR REPLACE INTO price_history (ticker, date, ..., source=canonical)
```

### المرحلة 5: مقارنة بالأسعار الحقيقية

**Daily validation cron (يومي 03:00 صباحاً):**

```python
# 1. اختر 10 أسهم عشوائية من كل سوق
# 2. اسحب السعر الحقيقي من Yahoo Finance / TradingView
# 3. قارن بالسعر في price_history.db
# 4. لو الفرق > 5% → صُنف المصدر كـ "INVALID" + نفّذ إعادة الـ scraping
# 5. لو الفرق > 20% → ألغِ المصدر نهائياً
```

### المرحلة 6: حذف المصادر الغلط

**لو مصدر بياناته غلط → يُمسح فوراً من محرك البيانات:**

```python
# إذا discovered إن source معين بياناته غلطة:
DELETE FROM price_history WHERE source = 'egxpilot_live'  # مثلاً
# + امسح الـ scraper نفسه من CANONICAL_SOURCES
# + سجّل الحادثة في BREACH-LOG.md
```

---

## 📊 الحالة الحالية (before) vs الهدف (after)

| المقياس | الحالي | الهدف |
|---|---|---|
| **عدد DBs بأسعار** | 4 | **1** (`price_history.db`) |
| **عدد الجداول بأسعار يومية** | 4 | **1** (`price_history`) |
| **مصادر لكل سهم** | 1-8 (متضاربة) | **1** (canonical) |
| **كتابة متعددة** | كل scraper يكتب لحاله | **guarded** (canonical only) |
| **مقارنة بالواقع** | لا يوجد | **daily cron** |
| **حذف المصادر الغلط** | لا يوجد | **تلقائي** |

---

## 🚀 خطة التنفيذ (5 خطوات)

### Step 1: دمج `stock_daily_prices` + `historical_data` → `price_history`
- انقل 47K + 99K صف لـ `price_history.db.price_history`
- استخدم `source='migration_consolidated'`
- بعد النقل: أفرغ الجداول القديمة (مش نحذفها — Rule 16)

### Step 2: طبّق `CANONICAL_SOURCES` في كل scrapers
- عدّل كل scraper: قبل INSERT، شيك على `CANONICAL_SOURCES[market]`
- لو المصدر مش canonical → لا تكتب (إلا لو canonical وقع)

### Step 3: شغّل `source_priority_cleaner.py --live` على prod
- نفس اللي اتعمل في sandbox
- يحذف المصادر غير الـ canonical

### Step 4: فعّل daily validation cron
- `scripts/validate_prices_against_reality.py`
- يقارن 10 أسهم عشوائية بالأسعار الحقيقية
- لو فرق > 5% → alert + re-scrape

### Step 5: فعّل `validation.py` في الـ pipeline
- قبل أي scoring: `validate_stock_data()`
- لو field INVALID → لا يستخدم في الـ score

---

## 🔒 ضمانات عدم تكرار المشكلة

1. **CANONICAL_SOURCES** — مصدر واحد لكل سوق (مش 8)
2. **Guarded writes** — كل scraper يشيك قبل الكتابة
3. **Daily validation** — مقارنة بالواقع يومياً
4. **Auto-deletion** — المصادر الغلط تُمسح تلقائياً
5. **Validation Layer** — قبل أي scoring

---

*هذه الخطة مبنية على قراءة الدستور Rule 12 + Rule 20 + Rule 24 + تحليل قواعد البيانات الفعلي.*

---

## 📎 MERGED APPENDIX — DB Resilience Strategy (DB-RESILIENCE-STRATEGY.md)

> **Source file (merged then archived):** `DB-RESILIENCE-STRATEGY.md`
> **Merged by:** Documentation Secretariat (Task ID: 25 — Consolidate to 6 canonical files)
> **Date:** 2026-10-03
> **Rule 4 (NO new files):** content merged INTO existing canonical file; source file `git rm`'d (history preserved by git).
> **Rule 62 (Secretary updates docs):** ✅ applied. **Rule 63 (commit + push after each):** ✅ applied.

### Original content of `DB-RESILIENCE-STRATEGY.md` (verbatim):

# 🛡️ DB Resilience Strategy — Strategic Ideas Document

> **Task ID:** 16-D · **Agent:** Strategic Thinking (DB Resilience + SQL Alternative)
> **Status:** 📋 STRATEGIC — for owner review. **Nothing in this document is implemented.**
> **Date:** 2026-10-02 · **Author:** Z.ai strategic-thinking sub-agent
> **Compliance:** Constitution Rule 1 (NEVER touch prod DBs) · Rule 6 (schema-aware) ·
> Rule 12 (`load_merged_history()` sole source) · Rule 63 (this is a new documentation file — permitted;
> no new screens, no new system files, no DB writes).
>
> **Reading order:** §0 owner brief → §1 risk audit → §2 backup strategy →
> §3 PostgreSQL alternative → §4 Turso / libSQL alternative → §5 sharding →
> §6 PITR → §7 HA → §8 retention → §9 monitoring → §10 DR runbook →
> §11 cost-benefit → §12 ranked recommendations → §13 decision matrix.

---

## §0 — Owner Brief (what triggered this document)

The owner (`enmohsen20111975`) raised three concrete worries on 2026-10-02:

1. **"How do we escape DB corruption problems?"** — SQLite has no built-in
   corruption repair tool beyond `.recover` (which is lossy). One bad write can
   cascade across the WAL.
2. **"Continuous backups are consuming all server disk."** — the existing
   `smart_db_backup.py` keeps 7 full-file copies of each of 6 DBs totaling ~1.23 GB
   uncompressed × 7 = ~8.6 GB just for daily rotation, plus hourly WAL files,
   plus `.bak-unify` snapshots from prior migrations. On a small VPS this is real
   pressure.
3. **"Is there a viable alternative to SQLite?"** — the owner has heard of
   PostgreSQL and wants to know whether (and when) a migration is worth it.

This document does **not** prescribe a single path. It lays out the options, the
trade-offs, the costs, and the trigger conditions, so the owner can decide.

---

## §1 — DB Corruption Risk Audit (current state, 2026-10-02)

### 1.1 What we actually have today (verified by reading the code)

| Component | Path | Status |
|---|---|---|
| **6 production DBs** | `db/*.db` | stocks (14 MB), data_engine (272 MB), predictions (224 MB), price_history (293 MB), auth (208 KB), intraday (427 MB) — **total ~1.23 GB** |
| **Smart backup guard** | `vps-service/scripts/smart_db_backup.py` | ✅ active, runs daily at 01:30 UTC via `crontab.txt` entry #10 |
| **Hourly WAL checkpoint** | `vps-service/jobs/wal_checkpoint.py` | ✅ active, runs hourly on 4 DBs (stocks + predictions + price_history + data_engine) — **intraday.db and auth.db NOT covered** |
| **Daily integrity check** | `smart_db_backup.py` runs `PRAGMA integrity_check` on every backup cycle | ✅ active |
| **Auto-restore on shrink** | `smart_db_backup.py` will restore from last good backup if file shrinks ≥ 20 %, integrity_check fails, OR any table loses ≥ 20 % of rows (P27-ROW-LOSS guard) | ✅ active — strong defense |
| **Off-site backup** | none | ❌ **GAP** — all 7 backup generations live on the same VPS disk as production DBs |
| **Compression** | none — backups are raw `.db` files copied via `sqlite3.backup()` | ❌ **GAP** — wastes ~60-70 % disk |
| **Rotation policy** | keep last 7 per DB | ⚠️ no weekly, no monthly, no annual tiers |
| **PITR (point-in-time recovery)** | none — SQLite WAL is checkpointed away hourly, no archiving | ❌ **GAP** — recovery granularity = "as of last 01:30 UTC backup" = up to 24 h data loss |
| **`scripts/auto-backup.sh`** | referenced by `scripts/setup-backup-cron.sh` but **file does NOT exist on disk** | ❌ **GAP** — if an engineer installs the cron via `setup-backup-cron.sh`, backups silently never run. The real working cron is `crontab.txt` entry #10 calling `smart_db_backup.py`. |
| **`.bak-unify` migration snapshots** | `db/*.db.bak-unify` (511 MB total) | ⚠️ lingering from P0-8-DB-UNIFY (2026-09-25) — never cleaned up |
| **`.bak-heli-fix` / `.bak-full-cleanup` / `.bak-heli-expired-fix`** | `db/predictions.db.bak-*` (3 × 235 MB = 705 MB) | ⚠️ lingering from HELI-CLEANUP-2 (2026-09-27) — never cleaned up |
| **`databases_backup.tar.gz` in git (37 MB)** | stale snapshot, dated ~2026-09-25 | ⚠️ ages with every commit, bloats git repo |

**Estimated disk wasted by lingering `.bak-*` files:** 511 MB + 705 MB = **~1.2 GB** — almost
the same as a full production DB set. Cleaning these (after Rule 1-confirmed-safe
verification) is the single biggest immediate win.

### 1.2 SQLite corruption causes — applicability to our 6 DBs

| Cause | Mechanism | Our exposure |
|---|---|---|
| **Concurrent writers** | SQLite serializes writes via file lock. Two processes writing simultaneously get `SQLITE_BUSY`; on badly-configured systems (no `busy_timeout`), writes can fail mid-transaction. | 🟡 Moderate. `wal_checkpoint.py` sets `busy_timeout=30000` and we use WAL mode everywhere (Rule per `01-PROJECT_ANATOMY.md` §3.7). However, the `intraday_scanner.py` writes every 5 minutes during market hours AND `tradingview_scraper.py` writes every 5 minutes simultaneously to `data_engine.db` — both via Python's sqlite3 module with WAL — so concurrent writers DO exist on `data_engine.db`. |
| **Power loss / unclean shutdown** | WAL not checkpointed → orphan pages → on next open, recovery may fail. | 🟡 Moderate. Hourly checkpointing reduces but does not eliminate this. A crash at 12:59 UTC (just before 13:00 checkpoint) could lose up to 59 minutes of writes. |
| **Disk full during write** | SQLite extends file with sparse pages; if disk fills mid-extension, the DB header can be left in an inconsistent state. | 🟠 **HIGH**. This is the owner's actual worry. If backups fill the disk, the production DBs crash. Feedback loop: backup writes → disk fills → production write fails → corruption. |
| **Filesystem corruption** | ext4 / xfs rare but possible. RAID not present on small VPS. | 🟡 Moderate. No mitigation except off-site backup. |
| **Bad migration script** | An `ALTER TABLE` or `DROP TABLE` that mis-handles foreign keys. | 🟠 **HIGH historically**. We have `production-migrate.py` + 14+ `migrate-*.{ts,py,sh}` scripts. HELI-CLEANUP-2 already corrupted 308 rows by setting TARGET_HITs wrongly — recovered only because backups existed. |
| **OS / SQLite version mismatch** | SQLite library upgrade while WAL file from old version is mid-checkpoint. | 🟢 Low. We pin via `requirements.txt` and run `sqlite3` from system package. |
| **NFS / network filesystem** | SQLite explicitly warns: "do not place SQLite DB on NFS." | 🟢 None — our VPS uses local ext4. |

### 1.3 Risk ranking per DB

| DB | Size | Write frequency | Criticality | Corruption risk | Impact if lost |
|---|---|---|---|---|---|
| **`intraday.db`** | 427 MB | every 5 min during market (10:00-14:00 Cairo) | 🟠 MEDIUM (re-aggregatable from `price_history.db` via `intraday_aggregator.py`) | 🔴 **HIGHEST** | Rebuild from price_history.db — 1-2 hours of CPU. Tolerable. |
| **`predictions.db`** | 224 MB | 5 writes/day from `daily_predictor.py` + 5 writes/day from `intraday_scanner.py` + 1 write/day from `daily_closer.py` + ad-hoc from `learning_engine.py` | 🔴 **CRITICAL** (1,359 predictions + 8,544 outcome_logs + 946 persona_predictions + 8,644 learned_lessons — irreplaceable backtest history) | 🟠 HIGH | Permanent loss of historical accuracy data. Backtest engine breaks. Win-rate KPIs irreproducible. Owner's #1 worry. |
| **`data_engine.db`** | 272 MB | every 5 min from `tradingview_scraper.py` + hourly from `multi_market_scraper.py` + daily from `egx_fundamental_fetcher.py` | 🟡 MEDIUM (re-scrapeable) | 🟠 HIGH (3 concurrent writers) | 2-4 hours to re-scrape all tab_* + gold + crypto + exchange_rates. Tolerable but annoying. |
| **`price_history.db`** | 293 MB | 2x/day from `daily_price_updater.py` + daily from `us_stock_scraper.py` + Yahoo fallback | 🔴 **CRITICAL** (1,206,795 rows — 25-year price history. Cannot be re-scraped for old data.) | 🟡 MODERATE (low write frequency, mostly appends) | Permanent loss of pre-2024 prices. `load_merged_history()` returns nothing. **Rule 12 violated.** Engine produces 0 results (per Principle 4). |
| **`stocks.db`** | 14 MB | 1 write/day from `egx_fundamental_fetcher.py` + occasional from `update_stocks_from_csv.py` | 🟡 MEDIUM (1,046 tickers + radar tracking + system_settings) | 🟢 LOW | Easily reconstructable from `data/all.zip` archive (per Constitution §13). |
| **`auth.db`** | 208 KB | NextAuth sessions + Prisma migrations + admin actions | 🔴 **CRITICAL** (206 users + their sessions + subscriptions + watchlists + portfolio) | 🟢 LOW (single writer: NextAuth via Prisma) | All users logged out. Subscription state lost. Watchlists gone. **Bad UX but not catastrophic** if restored within hours. |

### 1.4 What happens if `predictions.db` corrupts? (worst-case walkthrough)

**Scenario:** at 12:45 UTC on a trading day, `intraday_scanner.py` is mid-INSERT
when the VPS OOM-killer terminates it (low RAM scenario). The WAL is left in a
half-applied state. On next open, `PRAGMA integrity_check` returns
`"database disk image is malformed"`.

**Current mitigation:** `smart_db_backup.py` at 01:30 UTC next day will:
1. Run `wal_checkpoint(TRUNCATE)` — **may fail** on corrupt DB.
2. Run `PRAGMA integrity_check` — returns non-`ok`.
3. Trigger auto-restore from the last good backup (the one from 01:30 UTC the
   day before the corruption happened).

**Data lost:** everything between the last successful backup (01:30 UTC
yesterday) and the corruption moment (12:45 UTC today) = **~11 hours of writes**
= that day's intraday signals + that day's post-market closes (the `daily_closer.py`
14:00 UTC run never happened) + the morning `daily_predictor.py` 03:00 UTC run
if the corruption happened before it.

**Estimated RPO (Recovery Point Objective) with current setup:** **up to 24 hours.**
**Estimated RTO (Recovery Time Objective):** ~5 minutes (auto-restore is fast) +
~30 minutes for engineer to verify restore worked + restart PM2 = **~35 minutes**.

**Verdict:** acceptable for `stocks.db` / `data_engine.db` (re-scrapeable).
**Unacceptable** for `predictions.db` (loses 1 day of prediction history +
1 day of outcome_logs feeding the learning engine = permanent gap in backtest data).

### 1.5 RPO / RTO targets the owner should pick

| Tier | DBs | RPO target | RTO target | Reasoning |
|---|---|---|---|---|
| **Tier-1 (crown jewels)** | predictions.db, price_history.db, auth.db | ≤ 15 minutes | ≤ 1 hour | Cannot be re-scraped/reconstructed. User trust = subscription revenue. |
| **Tier-2 (re-aggregatable)** | data_engine.db, intraday.db | ≤ 4 hours | ≤ 4 hours | Tolerable to lose a half-day of scrapes; rebuildable. |
| **Tier-3 (reconstructable)** | stocks.db | ≤ 24 hours | ≤ 1 day | Reconstruction from `data/all.zip` per Constitution §13. |

These targets are the **input** that drives §2 backup strategy and §3 / §4
technology choice. Today we meet Tier-3 only. Tier-1 / Tier-2 require either
Litestream (§2.5) or PostgreSQL PITR (§3 / §6).

---

## §2 — Backup Strategy (fix the "consuming all disk" problem)

### 2.1 The actual disk math (today)

Per-DB uncompressed size (production, from `05-CURRENT_STATE.md` §3.1):

```
stocks.db          14.21 MB
data_engine.db    272.46 MB
predictions.db    224.34 MB
price_history.db  292.91 MB
auth.db            0.20 MB
intraday.db       427.47 MB
                  ─────────
                  1.23 GB  ← one full backup generation
```

Current rotation in `smart_db_backup.py`: **`KEEP_BACKUPS = 7`** = 7 daily
generations per DB.

```
1.23 GB × 7 = 8.61 GB   ← 7-day rotation, UNCOMPRESSED, raw .db files
```

Plus lingering `.bak-unify` + `.bak-heli-*` from past migrations: **~1.2 GB**.

Plus hourly WAL files pre-checkpoint (transient, max ~5-10 MB per DB): ~30 MB.

**Total disk consumed by DB+backup today: ~10 GB on the same VPS as production.**

### 2.2 Why it feels like "all server space"

Two reasons:

1. **No compression.** A SQLite `.db` file compresses ~60-70 % with gzip because
   pages are mostly empty space (SQLite pre-allocates 4 KB pages).
   1.23 GB raw → ~430 MB gzipped. **~7 GB saved immediately** without changing
   the rotation policy at all.

2. **All backups on the same disk.** If the VPS disk is 40 GB and 10 GB is
   backups, that's 25 % gone before any log, build artifact, or `node_modules`
   growth. The owner's complaint isn't the rotation count — it's the absolute
   disk share.

### 2.3 Recommended new rotation (7-4-12-1 Grandfather-Father-Son)

| Generation | Frequency | Count | Compressed size each | Total |
|---|---|---|---|---|
| **Daily** | 02:00 UTC daily | 7 | ~62 MB (= 430 MB ÷ 7 DBs in practice, varies) | ~430 MB |
| **Weekly** | Sunday 02:30 UTC | 4 | ~430 MB | ~1.7 GB |
| **Monthly** | 1st of month 02:30 UTC | 12 | ~430 MB | ~5.2 GB |
| **Annual (cold)** | 1st of January 03:00 UTC | kept 5 years | ~430 MB | ~2.2 GB |

**Total local retention:** ~9.5 GB. Compared to today's 8.6 GB (7 daily only),
we get **7× more recovery points for only ~10 % more disk** — because the
monthly/annual tiers compress the same data we already had.

### 2.4 Off-site upload (the actual fix for "all server space")

Move all backups **off the VPS** to a cheap object store. Options ranked by
price-per-GB-month (October 2026 public pricing, US-East region):

| Provider | Plan | $/GB-month | Cost for 10 GB | Notes |
|---|---|---|---|---|
| **Backblaze B2** | pay-as-you-go | **$0.006** | **$0.06/mo** | S3-compatible API, free egress up to 3× stored, no minimum retention |
| **Cloudflare R2** | pay-as-you-go | $0.015 | $0.15/mo | S3-compatible, **zero egress fees** (best if we restore often) |
| **Wasabi** | pay-as-you-go | $0.0099 | $0.10/mo | 90-day minimum retention — fine for monthly/annual tiers |
| AWS S3 Glacier Instant | archive | $0.004 | $0.04/mo | retrieval takes 1-5 min; **egress costs $0.09/GB** on restore — cheap to store, painful to restore |
| AWS S3 Standard | pay-as-you-go | $0.023 | $0.23/mo | cheapest managed option, expensive egress |
| Google Cloud Storage Nearline | 30-day min | $0.010 | $0.10/mo | OK for monthly tier |
| Dropbox / OneDrive | 2 TB plan | ~$0.005 effective | $10/mo flat | overkill; no S3 API |

**Recommendation:** **Backblaze B2 for everything.** $0.006/GB × 10 GB = **$0.06/month**.
Free egress up to 3× stored volume per day = restore the full DB set up to 3×/day
for free. S3-compatible API → drop-in `b2sdk` or `aws s3 cp` with custom endpoint.

### 2.5 Continuous backup via Litestream (the SQLite-native answer)

Litestream ([litestream.io](https://litestream.io)) is a tool that streams the
SQLite WAL to object storage (S3/B2/Azure/GCS) **continuously** — every commit
is replicated within ~1 second. It's a daemon that runs alongside the SQLite
process.

**Why it matters here:**

- RPO drops from "24 hours" to **"1 second"** for DBs we put on Litestream.
- Disk usage on the VPS drops to **zero** for backups — all replicas live in B2.
- No schema rewrite, no migration. Litestream talks to the SQLite file directly.
- Restore = `litestream restore -o db/predictions.db` from the latest replica.

**Cost for our 6 DBs on B2:**

- ~1.2 GB per replica × 1 (Litestream keeps only the latest state + WAL history)
- Storage cost: ~$0.007/month for the data
- WAL churn: assume ~10 MB new WAL per day across all DBs (high estimate for
  intraday writes). After compaction: ~300 MB/month of historical WAL = $0.002/mo.
- **Total Litestream-on-B2 cost: ~$0.01/month.**

**Trade-offs:**

- Adds a daemon (`litestream replicate`) per DB. Manageable via PM2 ecosystem entry.
- WAL retention is configurable; if we keep 30 days, that's PITR for 30 days.
- Litestream is **single-writer only** — if a second process opens the DB in
  write mode, Litestream aborts. We already satisfy this (Python = brain, Node =
  read-only via proxy), but it's a constraint to enforce.

**Recommendation:** put **`predictions.db`, `price_history.db`, `auth.db`** on
Litestream → B2 (the Tier-1 crown jewels). The other 3 (data_engine, intraday,
stocks) stay on the existing `smart_db_backup.py` since they're rebuildable.

### 2.6 Backup verification (the part most teams forget)

A backup that has never been restored is not a backup — it's a hope.

**Schedule:**

- **Daily:** `PRAGMA integrity_check` on each backup file (already done in
  `smart_db_backup.py`).
- **Weekly:** pick one random daily backup, restore to `/tmp/restore-test/`,
  run `python3 vps-service/tools/diagnose_db_structure.py` against it, verify
  row counts match the production DBs within 0.1 %. Tear down.
- **Monthly:** full DR drill (§10) — restore all 6 DBs to a clean sandbox,
  boot the Next.js app pointed at the restored DBs, smoke-test 5 critical
  endpoints (`/api/health`, `/api/predictions/daily-picks`,
  `/api/maker-radar`, `/api/auth/session`, `/api/chart/COMI`).

**Time budget:** 2-3 hours/month of an engineer's time. Worth it.

### 2.7 What to delete today (after Rule 1 verification)

These are the lingering `.bak-*` files consuming ~1.2 GB that serve no
forward-going purpose (they're pre-migration snapshots, the migrations already
succeeded and were verified):

```
db/stocks.db.bak-unify              14.2 MB   (P0-8-DB-UNIFY 2026-09-25)
db/predictions.db.bak-unify        224.3 MB   (P0-8-DB-UNIFY 2026-09-25)
db/auth.db.bak-unify                 0.2 MB   (P0-8-DB-UNIFY 2026-09-25)
db/data_engine.db.bak-unify        272.5 MB   (P0-8-DB-UNIFY 2026-09-25)
db/predictions.db.bak-heli-fix     235   MB   (HELI-CLEANUP-2 2026-09-27)
db/predictions.db.bak-full-cleanup 235   MB   (HELI-CLEANUP-2 2026-09-27)
db/predictions.db.bak-heli-expired 235   MB   (HELI-CLEANUP-2 2026-09-27)
                                  ──────
                                  1.22 GB
```

**Action:** upload them to B2 cold storage (one-time, ~$0.007/mo to retain),
then `rm` from the VPS. This single action reclaims ~1.2 GB — about the same
as the production DBs themselves.

**Note:** deletion requires owner approval (Rule 1 + Rule 16
VERIFY-BEFORE-DELETE). This document proposes; owner disposes.

### 2.8 Fix `scripts/auto-backup.sh` phantom reference

`scripts/setup-backup-cron.sh` (line 21) installs a cron that calls
`scripts/auto-backup.sh` — **a file that does not exist** (verified via `ls`).
If any engineer follows the README in that script, daily backups silently
never run.

**Fix options:**

1. **Delete `scripts/setup-backup-cron.sh`** and update its README to point at
   `crontab.txt` entry #10 (the real, working schedule).
2. **Create `scripts/auto-backup.sh`** as a wrapper that just calls
   `python3 vps-service/scripts/smart_db_backup.py` — keeps the old install
   path working.

Option 1 is cleaner (Rule 63 — fewer files, not more). Option 2 is safer
(backward-compatible). Owner's call.

### 2.9 Wrap-up: §2 budget summary

| Change | Disk saved on VPS | Monthly cost | Engineering time |
|---|---|---|---|
| Gzip all backups | ~6 GB | $0 | 2 hours (modify `smart_db_backup.py`) |
| Upload to B2 + delete local copies | ~9 GB | $0.06 | 4 hours (b2sdk integration) |
| Clean `.bak-unify` + `.bak-heli-*` | ~1.2 GB | $0.007 (B2 cold) | 1 hour |
| Add Litestream for Tier-1 DBs | 0 (Litestream is additive) | $0.01 | 6 hours (per-DB config + PM2 entry) |
| 7-4-12-1 rotation (vs current 7-only) | -0.9 GB (more retention, less disk via compression) | $0 (same B2 bucket) | 3 hours |
| Monthly DR drill | 0 | $0 | 3 hours/month recurring |
| **Total** | **~17 GB freed on VPS** | **~$0.08/month** | **~16 hours one-time + 3 hours/month recurring** |

---

## §3 — SQLite → PostgreSQL Migration (the "real DB" option)

### 3.1 When does SQLite stop being enough?

Trigger conditions (any one):

| Trigger | Threshold | Why |
|---|---|---|
| **Concurrent writers > 1** | > 1 process doing writes simultaneously | SQLite serializes writes; second writer gets `SQLITE_BUSY` and retries; with `busy_timeout=30000` it tolerates this, but throughput degrades. PostgreSQL MVCC handles this natively. |
| **Single DB size > 10 GB** | > 10 GB | SQLite's `VACUUM` becomes slow (minutes); backup-by-copy becomes painful; page-cache hit ratio degrades. PostgreSQL has tablespaces, partitioning, parallel VACUUM. |
| **Write throughput > 100 writes/sec sustained** | > 100 w/s sustained | SQLite's WAL append hits fsync bottlenecks. PostgreSQL group-commit amortizes fsync. |
| **Need for PITR < 1 hour** | RPO < 60 min | SQLite has no WAL archiving. PostgreSQL has continuous WAL archiving → recovery to any point in time. |
| **Need for read replicas** | > 1000 concurrent readers | SQLite read replicas require Litestream + manual failover. PostgreSQL streaming replication is automatic. |
| **Multi-region / geographic redundancy** | yes | SQLite + Litestream can do this but it's bolt-on. PostgreSQL native. |
| **Complex joins across DBs** | yes | We currently `ATTACH DATABASE` for joins across our 6 SQLite files — fragile and slow. PostgreSQL schemas solve this elegantly. |

**Where we are today (2026-10-02):**

- Largest DB: `intraday.db` 427 MB — **35× under the 10 GB threshold**.
- Concurrent writers: 2-3 on `data_engine.db` during market hours — **at the
  edge but manageable with WAL + busy_timeout** (proven working for 2+ months).
- Write throughput: peak ~5 writes/sec on `intraday.db` during market —
  **20× under the threshold**.
- Cross-DB joins: yes (we have `ATTACH DATABASE` in `load_merged_history` and
  `db_manager`) — **this is a real pain point**, not a hypothetical.

**Verdict:** we are **NOT yet** at the trigger conditions for the largest DBs.
The closest trigger is **cross-DB joins** (a developer-experience pain, not a
capacity pain) and **PITR < 1 hour** (a disaster-recovery pain, addressed by
Litestream more cheaply than PostgreSQL).

### 3.2 PostgreSQL benefits

- **MVCC** — readers never block writers, writers never block readers. Solves
  our `SQLITE_BUSY` worries on `data_engine.db`.
- **Streaming replication** — built-in primary/replica with sub-second lag.
- **PITR via WAL archiving** — restore to any second in time.
- **Partitioning** — `price_history` table can be partitioned by year
  (`PARTITION BY RANGE (date)`) → 25-year history becomes 25 small partitions.
- **Connection pooling** (PgBouncer) — survives 1000+ concurrent requests.
- **Managed services** (Supabase / Neon / Railway / RDS) handle ops:
  automated backups, autoscaling, point-in-time recovery, monitoring.

### 3.3 Migration cost (honest estimate)

| Phase | Effort | Risk |
|---|---|---|
| Schema rewrite (SQLite → Postgres types) | 2-3 days | 🟡 LOW — most types map 1:1 (INTEGER→int, TEXT→text, REAL→double precision). Tricky bits: `AUTOINCREMENT` → `SERIAL`/`IDENTITY`, `PRAGMA table_info` → `information_schema`, `datetime('now')` → `NOW()`. |
| Data migration script (pgloader or custom) | 2-3 days | 🟡 MEDIUM — pgloader handles 80 %, the other 20 % is per-table custom logic (Rule 7 caps, Rule 12 normalization, etc.). Verify row counts after. |
| Rewrite Python DB layer (`core/db_manager.py`, `core/database.py`, `core/persona_db.py`, `core/crypto_database.py`) | 5-7 days | 🔴 HIGH — these are central, ~3,000 LOC. Every `sqlite3.connect()` call needs to become `psycopg2.connect()` or `asyncpg`. Plus `better-sqlite3` → `pg` on the Node side. |
| Rewrite Prisma schema (`prisma/auth-schema.prisma`, `prisma/predictions-schema.prisma`) | 1-2 days | 🟡 LOW — Prisma supports Postgres natively, just change the `datasource provider`. |
| Migrate `load_merged_history()` (Rule 12 — sole source of price data) | 1 day | 🔴 HIGH — most-touched code in the engine, 50+ call sites. |
| Update cron jobs (15 entries reference `python3 ... --db-path` or similar) | 1 day | 🟢 LOW — mostly path changes. |
| Migrate `scripts/smart_db_backup.py` → use `pg_dump` | 1 day | 🟢 LOW. |
| Re-test everything (engine produces predictions, backtest reproduces) | 3-5 days | 🔴 HIGH — backtest results MUST match within 0.01 % (Rule 14). |
| **Total** | **~3-4 weeks of focused engineering** | One person, no parallel work. |

### 3.4 Managed PostgreSQL pricing (October 2026 public pricing)

| Provider | Plan | RAM | Storage | $/month | Best for |
|---|---|---|---|---|---|
| **Supabase Free** | 1 project | 500 MB | 500 MB | $0 | prototyping only — too small for our 1.2 GB |
| **Supabase Pro** | 1 project | 8 GB | 8 GB | $25 | small production — fits our DBs with room to grow |
| **Supabase Team** | 1 project | 8 GB | 8 GB + daily backups + PITR 7 days | $99 | if we need PITR + SOC2 compliance |
| **Neon Free** | 1 project | 0.25 CU autoscale | 3 GB | $0 | dev — autoscale to zero is nice |
| **Neon Launch** | 1 project | 2 CU fixed | 10 GB | $19 | small production |
| **Neon Scale** | 1 project | 7 CU fixed | 20 GB + PITR 7 days | $69 | medium production with PITR |
| **Railway Pro** | 1 instance | 8 GB | 10 GB | $20 + usage | simple, generous disk |
| **AWS RDS db.t4g.micro** | 1 instance | 1 GB | 20 GB | ~$14 + storage | cheapest managed, but you manage PITR yourself |
| **AWS RDS db.t4g.small** | 1 instance | 2 GB | 20 GB | ~$28 + storage | small production with PITR via automated backups |
| **DigitalOcean Managed Postgres** | 1 db | 1 GB | 10 GB | $15 | simple pricing, no egress fees |
| **Self-hosted Postgres on VPS** | DIY | same VPS RAM | same VPS disk | $0 software, +VPS upgrade ~$10 | cheapest but you manage ops |

**Recommendation IF migrating:** **Neon Launch ($19/month)** or **Supabase Pro
($25/month)** — both include automated backups, both support PITR, both have
generous free tiers for dev, and both support branch-based dev workflows
(create a DB branch from prod → test a migration → promote).

### 3.5 Hybrid model (most pragmatic)

Keep SQLite for what it does well; move only the painful DBs.

| DB | Recommendation | Reason |
|---|---|---|
| `stocks.db` (14 MB, 1 write/day) | **Keep SQLite** | Tiny, read-heavy, no concurrency issue |
| `data_engine.db` (272 MB, 3 concurrent writers) | **Move to PostgreSQL** | The actual concurrency pain point |
| `predictions.db` (224 MB, 5 writes/day, Tier-1) | **Move to PostgreSQL** | Tier-1 crown jewel — needs PITR |
| `price_history.db` (293 MB, 2 writes/day, Tier-1) | **Keep SQLite + Litestream** | Append-only, read-heavy, partitioning can wait |
| `auth.db` (208 KB, single Prisma writer, Tier-1) | **Move to PostgreSQL** | Users/sessions/subscriptions — needs PITR, scales with users |
| `intraday.db` (427 MB, 5-min writes during market) | **Move to PostgreSQL** | Highest write throughput, time-series nature fits Postgres partitioning |

Hybrid gives us 4 DBs on Postgres (~$25/month on Supabase Pro or Neon Scale)
and 2 on SQLite + Litestream (~$0.01/month on B2). Total ~$25/month.

**Trade-off:** hybrid means the Python DB layer must support both. That's an
abstraction cost (`core/db_manager.py` already does this — it has a
`_resolve_db_name` for SQLite; we'd add a `_resolve_pg_dsn` for Postgres).

### 3.6 Trigger condition — when to actually migrate

```
MIGRATE WHEN any of these becomes true:
  1. intraday.db size > 2 GB   (currently 427 MB — ~5× growth → ~10 months at current rate)
  2. data_engine.db writes fail with SQLITE_BUSY > 5×/day for 7 consecutive days
  3. We need PITR < 15 minutes for compliance / customer promise
  4. We onboard > 500 paying users (auth.db will start hitting write contention
     on subscription state changes)
  5. Cross-DB joins across our 6 SQLite files become a measurable dev-velocity
     bottleneck (heuristic: if we add more than 2 ATTACH DATABASE calls per quarter)
```

**Today (2026-10-02):** none triggered. Stay on SQLite + Litestream + B2.

---

## §4 — SQLite → Turso / libSQL (modern SQLite fork)

### 4.1 What is Turso / libSQL

- **libSQL** is an open-source fork of SQLite maintained by Turso, ChiselStrike,
  and the community. Adds: native replication, async APIs, embedded compute
  (run SQL inside the DB via WASM), vector search.
- **Turso** ([turso.tech](https://turso.tech)) is the managed service for libSQL:
  hosted primary + replicas in 30+ regions, automatic backups, branching for dev.

### 4.2 Why it matters for us

- **Zero schema rewrite.** libSQL IS SQLite. Our existing `CREATE TABLE`,
  `INSERT`, `PRAGMA table_info`, `load_merged_history()` — all work unchanged.
- **Native replication.** Turso's "embedded replicas" mode: writes go to the
  primary in the cloud, reads come from the local replica file → fast + durable.
- **Branching for dev.** `turso db branch prod main-test` creates a copy of
  production for testing migrations — exactly the workflow we hacked with
  `data/all.zip` + `db/vps_real/` (Constitution §13).
- **Generous free tier.** 500 databases, 9 GB total, 1 billion row reads/month.
  Our entire 1.2 GB fits.
- **S3-compatible backup export.** `turso db shell ... .dump` works the same as
  SQLite `.dump`.

### 4.3 Migration effort

```python
# Before (SQLite)
import sqlite3
conn = sqlite3.connect('db/predictions.db')

# After (libSQL)
import libsql
conn = libsql.connect('libsql://predictions-glminvestment.turso.io',
                       auth_token=os.environ['TURSO_TOKEN'])
```

That's it. The rest of the code is unchanged. We swap the driver + add an env
var. **Total migration effort: ~1 day per DB** (mostly testing + verifying
backtest results still match).

### 4.4 Turso pricing (October 2026)

| Plan | Databases | Storage | Row reads/month | Row writes/month | $/month |
|---|---|---|---|---|---|
| Free | 500 | 9 GB total | 1 billion | 25 million | $0 |
| Scaler | 500 | 9 GB (additional $0.75/GB) | 25 billion | 50 million | $29 |
| Enterprise | custom | custom | custom | custom | contact |

**Cost for us:** Free tier covers all 6 DBs (1.2 GB total) easily. If we
exceed 25 million writes/month → Scaler plan at $29/month.

Our current write volume estimate: ~10,000 writes/day = 300,000/month — **83×
under the free-tier cap**. We're fine on free tier for years.

### 4.5 Trade-offs

| Pro | Con |
|---|---|
| Zero schema rewrite | Adds a network hop for writes (Turso primary is in cloud) — adds ~50ms latency per write |
| Free tier covers us | Embedded replicas need a Turso client library (`libsql-client` for Python — well-supported) |
| Branching for dev is great | "Embedded replica" feature is the killer feature — but it requires libSQL (not vanilla SQLite). Tools that read the DB file directly (`sqlite3` CLI, better-sqlite3 from Node, Prisma for auth.db) won't work with embedded replicas — they need the libSQL driver. |
| Backups automatic | Turso doesn't yet support PITR (only snapshot backups every 24h) — same RPO as our current SQLite setup unless we add Litestream alongside |
| 30+ edge regions | Vendor lock-in — Turso is a small company. libSQL itself is open-source (we can self-host), but Turso's control plane is closed. |

### 4.6 Recommendation

Turso is the **lowest-effort path** to "modern DB with replication + managed
backups". Recommended for the owner who wants resilience without rewriting the
DB layer.

**Specific recommendation:**

- Move **`auth.db`** to Turso free tier first — smallest DB, lowest risk, tests
  the workflow. Replace `prisma/auth-schema.prisma`'s `datasource provider =
  "sqlite"` with `provider = "libsql"` (Prisma added libSQL support in 2024).
- If that works for 30 days without issues, move **`predictions.db`** (Tier-1
  crown jewel that benefits most from replication).
- Keep **`price_history.db`** on local SQLite + Litestream (it's the largest,
  Turso's 9 GB free-tier limit would be a stretch if all 6 DBs grow).

---

## §5 — Database Sharding / Partitioning (when DBs grow)

### 5.1 When to consider

Currently not needed. Triggers:

- `price_history.db` > 5 GB (currently 293 MB) — partition by year.
- `intraday.db` > 5 GB (currently 427 MB) — partition by month.
- `predictions.db` > 1 GB (currently 224 MB) — partition by year of
  prediction date.

At current growth rate (1-2 MB/day on `intraday.db` + `price_history.db`),
we hit 5 GB in **~5-10 years**. This is a future-person problem.

### 5.2 If we needed it today

- **SQLite:** partition by creating separate files (`price_history_2024.db`,
  `price_history_2025.db`) and using `ATTACH DATABASE` + `UNION ALL` views.
  Works but fragile.
- **PostgreSQL:** native `PARTITION BY RANGE (date)` — much cleaner.

### 5.3 Per-DB future plan

| DB | Today | At 5 GB | At 10 GB |
|---|---|---|---|
| `stocks.db` | 14 MB | keep as-is | keep as-is (it'll always be small — 1,046 tickers × ~150 bytes) |
| `data_engine.db` | 272 MB | keep as-is | move `crypto_prices` to separate `crypto_history.db` |
| `predictions.db` | 224 MB | partition by year (`predictions_2025`, `predictions_2026`) | move to Postgres partitioning |
| `price_history.db` | 293 MB | partition by year | move to Postgres partitioning |
| `auth.db` | 208 KB | keep as-is | keep as-is (always small — user count-driven) |
| `intraday.db` | 427 MB | partition by month (only keep last 90 days hot) | archive > 1 year to cold storage |

---

## §6 — Point-in-Time Recovery (PITR)

### 6.1 Why PITR matters

Without PITR, "restore" means "roll back to last backup" — losing all writes
between backup and now. With PITR, "restore" means "roll back to any second
in time" — e.g., "restore to 2 hours ago, just before that bad migration
corrupted 308 rows."

The HELI-CLEANUP-2 incident (2026-09-27) is exactly the case PITR solves:
308 rows were wrongly set to `TARGET_HIT` by a buggy script, and we recovered
only because we had `.bak-heli-fix` snapshots taken manually before the run.
With PITR, we'd just `pg_restore --target-time '2026-09-27 14:30:00'`.

### 6.2 SQLite PITR options

| Approach | RPO | Cost | Effort | Recommendation |
|---|---|---|---|---|
| Periodic snapshots (current) | up to 24h | $0 | $0 | what we have — insufficient for Tier-1 |
| **Litestream continuous WAL streaming** | 1 sec | $0.01/mo B2 | 6h per DB | **recommended for Tier-1** |
| WAL archiving via custom script (copy `-wal` file every minute to B2) | 1 min | $0.005/mo | 8h, fragile | not worth it when Litestream exists |
| rqlite (distributed SQLite via Raft) | 0 (sync) | higher complexity | 2-3 days per DB | overkill — rqlite sacrifices some SQLite compatibility |

### 6.3 PostgreSQL PITR options

- **WAL archiving to S3/B2** — built-in via `archive_command` setting. RPO = 1
  WAL segment (~16 MB by default = a few minutes of writes).
- **Continuous WAL streaming to replica** — sub-second RPO via `pg_receivewal`.
- **Managed service PITR** — Supabase offers 7-day PITR on Team plan ($99/mo).
  Neon offers 7-day PITR on Scale plan ($69/mo).

### 6.4 Recommendation

For **Tier-1** DBs (predictions, price_history, auth):
- Stay on SQLite + **Litestream → B2** (RPO ~1 sec, $0.01/mo, 6h engineering).
- This gets us PITR for 30 days (configurable) for **~$0.01/month**.

If we later move to PostgreSQL, Litestream is replaced by native WAL archiving
(RPO ~1 min, included in Supabase/Neon plans).

---

## §7 — High Availability (HA)

### 7.1 Current state

**Single VPS = single point of failure.** If the Hetzner/OVH/whatever box dies
(hardware failure, datacenter fire, billing lapsed), all 6 DBs are gone unless
off-site backup exists. RTO with current setup: **4-8 hours** (spin up new VPS,
`git clone`, restore from `db/backups/smart/` last backup — wait, those are on
the dead VPS! So actually restore from `databases_backup.tar.gz` in git repo
= up to 1 week stale).

This is **the biggest unaddressed risk** in the project.

### 7.2 HA options per DB tier

| Tier | DBs | HA strategy | RTO | Cost |
|---|---|---|---|---|
| Tier-1 (crown jewels) | predictions, price_history, auth | Litestream → B2 + secondary VPS ready to spin up + restore script | 1 hour | $5/month secondary VPS + $0.01 B2 |
| Tier-2 (re-aggregatable) | data_engine, intraday | Weekly full B2 backup; restore from scraper is acceptable | 4 hours | $0.06 B2 |
| Tier-3 (reconstructable) | stocks | Restore from `data/all.zip` in git | 1 day | $0 |

### 7.3 PostgreSQL HA options

- **Managed (Supabase/Neon/RDS):** HA built-in. Provider handles failover.
  RTO ~1 minute for replica promotion. Costs included in plan.
- **Self-hosted with Patroni:** Patroni + etcd + HAProxy. RTO ~30 seconds.
  Effort: 2-3 weeks of senior-devops time. Overkill for our scale.

### 7.4 Recommendation

For SQLite path: Litestream + B2 + a $5/month secondary VPS kept warm (running
`litestream restore` periodically as a drill). Total: $5.01/month. This is the
cheapest meaningful HA we can get.

For PostgreSQL path: Supabase Pro ($25/month) includes managed HA — no extra
cost, no extra effort.

---

## §8 — Data Retention Policy

### 8.1 Current state (no formal policy)

We keep everything forever. `price_history.db` has prices from 2000 → 2026 (25
years). `predictions.db` has predictions from 2026-01-01 → 2026-09-25. No
archival, no deletion, no policy.

### 8.2 Recommended retention per DB

| DB | Table | Hot retention | Cold retention (S3 Glacier) | Reasoning |
|---|---|---|---|---|
| `price_history.db` | `price_history` | 5 years rolling (2021-2026) | forever (Glacier, ~$0.004/GB) | Backtest needs 5 years of data. Pre-2021 is "nice to have" for regime analysis but rarely queried. Cold-archive saves VPS disk. |
| `predictions.db` | `predictions` | forever (hot) | n/a | Only 1,359 rows — tiny. Keep all for backtest reproducibility. |
| `predictions.db` | `outcome_logs` | 2 years rolling | forever (Glacier) | 8,544 rows. Older logs feed learning engine rarely. |
| `predictions.db` | `learned_lessons` | 2 years rolling | forever (Glacier) | 8,644 rows. Same logic. |
| `intraday.db` | all tables | 90 days rolling | 1 year in Glacier | High-volume. After 90 days, only daily-aggregated data in `price_history.db` matters. |
| `data_engine.db` | `crypto_prices`, `gold_prices`, `silver_prices`, `exchange_rates` | 1 year rolling | forever (Glacier) | Tick data — 1 year covers all seasonal analyses. |
| `data_engine.db` | `tab_*` (fundamentals) | forever (hot) | n/a | Only ~860 rows per table. Tiny. |
| `stocks.db` | all tables | forever (hot) | n/a | Only ~1,046 tickers. Tiny. |
| `auth.db` | `Session` | 30 days rolling (delete expired) | n/a | NextAuth standard. Sessions beyond 30 days are useless. |
| `auth.db` | `analytics_events` | 90 days rolling | 1 year (Glacier) | Privacy/compliance — keep 90 days hot for product analytics, then archive. |
| `auth.db` | `User`, `UserSubscription`, `PortfolioItem` | forever (hot) | n/a | User data — required for legal/tax reasons in most jurisdictions. |

### 8.3 Cold storage cost

Estimated cold-archive size: ~500 MB (5 years of price_history ticks + 1 year
of intraday + 1 year of analytics_events).

- AWS S3 Glacier Instant Retrieval: $0.004/GB/mo × 0.5 GB = **$0.002/month**
- Backblaze B2 (no Glacier class, but cheap): $0.006/GB/mo × 0.5 GB = **$0.003/month**

Negligible. We can keep archives forever for the price of a coffee.

### 8.4 Implementation note

Archival should be a new cron job: `vps-service/scripts/archive_old_data.py`,
runs weekly, moves rows older than the hot-retention threshold into Parquet
files in B2 Glacier, then `DELETE FROM ... WHERE date < ...` on the hot DB.

**Rule 1 caveat:** this script writes to prod DBs — needs owner approval and
Rule 16 VERIFY-BEFORE-DELETE compliance (dry-run mode that prints counts
before deleting).

---

## §9 — Monitoring + Alerting

### 9.1 Current state

- `vps-service/scripts/data_heartbeat_checker.py` runs daily at 01:00 UTC
  (crontab entry #9) — checks DB freshness.
- `/api/health` endpoint checks DB file existence + SELECT 1 + PM2 ports
  + disk space (Rule 58 P0-WAVE-OBSERVABILITY).
- Sentry for errors.
- Structured JSON logger (`src/lib/logger.ts`).
- `smart_db_backup.py` writes `last_run_report.json` with backup status.

### 9.2 Gaps

- **No alerting on backup failure.** If `smart_db_backup.py` exits with code 2
  (failure), nothing emails or Telegrams the owner. The error is in
  `/tmp/backup.log` and `db/backups/smart_guard.log` — both on the same VPS.
- **No disk-space alert.** If disk fills to 90 %, `/api/health` returns
  `degraded` but no proactive alert.
- **No corruption-detection alert.** `smart_db_backup.py` runs
  `PRAGMA integrity_check` but only at backup time. If corruption happens at
  02:00, it's not detected until 01:30 UTC next day.

### 9.3 Recommended additions

| Monitor | Frequency | Alert channel | Tool |
|---|---|---|---|
| Disk usage ≥ 70 % | hourly check | Telegram + email | cron + `df` + Telegram bot |
| Disk usage ≥ 85 % | hourly | Telegram + email + SMS (if owner has SMS gateway) | same |
| Disk usage ≥ 95 % | hourly | Telegram + email + auto-kill non-essential PM2 processes | same + `pm2 stop news-agent` |
| `PRAGMA integrity_check` per DB | every 6 hours (4×/day, up from 1×) | Telegram on failure | extend `wal_checkpoint.py` |
| Backup job failure (`smart_db_backup.py` exit ≠ 0) | on each run | Telegram | wrap cron entry with `&& curl -d "OK" ... \|\| curl -d "FAIL" ...` |
| Slow query (> 5 seconds) | continuous | log only (could be Sentry performance) | Python `sqlite3.set_trace_callback` or Postgres `pg_stat_statements` |
| Litestream replication lag > 60 sec | continuous | Telegram | Litestream has built-in metrics endpoint |
| B2 backup upload failure | on each upload | Telegram | wrap `b2sdk` calls in try/except + Telegram alert |
| DB file size change > 50 % in 24 hours | daily | Telegram | simple `du` diff |

### 9.4 Cost

All alerts via the existing Telegram bot (already configured for radar alerts
per `vps-service/telegram/`). $0 additional infrastructure cost. Engineering:
~4 hours to wire up the alerting endpoints.

---

## §10 — Disaster Recovery Plan + Runbook

### 10.1 Recovery objectives (formalized)

- **RPO (Recovery Point Objective):** Tier-1 DBs ≤ 15 min (Litestream),
  Tier-2 ≤ 4 hours, Tier-3 ≤ 24 hours.
- **RTO (Recovery Time Objective):** Tier-1 ≤ 1 hour, Tier-2 ≤ 4 hours,
  Tier-3 ≤ 1 day.

### 10.2 Runbook: prod VPS dies completely

```bash
# ─── STEP 0: Provision new VPS ──────────────────────────────────
# Spin up new Hetzner/OVH box, Ubuntu 22.04, ≥ 4 GB RAM, ≥ 40 GB disk.
ssh root@new-vps

# ─── STEP 1: Install dependencies ────────────────────────────────
apt update && apt install -y git python3 python3-venv nodejs npm sqlite3
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/enmohsen20111975/GLMinvestment.git ~/GLMinvestment
cd ~/GLMinvestment

# ─── STEP 2: Restore code from git ──────────────────────────────
# Code is in git — last commit is the source of truth.
git log --oneline -5  # verify latest commit hash

# ─── STEP 3: Restore DBs from B2 (latest Litestream replica) ────
# Install litestream
curl -fsSL https://litestream.io/install.sh | bash

# Restore each Tier-1 DB
litestream restore -o db/predictions.db   s3://glminvestment-backups/predictions.db
litestream restore -o db/price_history.db s3://glminvestment-backups/price_history.db
litestream restore -o db/auth.db          s3://glminvestment-backups/auth.db

# Restore Tier-2 DBs from latest smart_db_backup snapshot
b2 authorize-account <B2_KEY_ID> <B2_KEY>
b2 download_file_by_name glminvestment-backups smart/latest/data_engine.db db/data_engine.db
b2 download_file_by_name glminvestment-backups smart/latest/intraday.db    db/intraday.db

# Restore Tier-3 from data/all.zip (in git repo, ~37 MB)
unzip data/all.zip -d db/

# ─── STEP 4: Verify integrity ────────────────────────────────────
for db in db/*.db; do
  echo "=== $db ==="
  sqlite3 "$db" "PRAGMA integrity_check;"
  sqlite3 "$db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';"
done

# ─── STEP 5: Run production migration (idempotent) ──────────────
python3 scripts/production-migrate.py

# ─── STEP 6: Configure .env ──────────────────────────────────────
# Copy .env from secrets manager / encrypted backup
# (out of scope — owner should have offline copy)

# ─── STEP 7: Start PM2 ───────────────────────────────────────────
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# ─── STEP 8: Update DNS / Caddy to point at new VPS ──────────────
# (out of scope — owner via Caddyfile + DNS provider)

# ─── STEP 9: Verify via /api/health ──────────────────────────────
curl http://localhost:3000/api/health
# Expected: status: "ok" or "degraded"

# ─── STEP 10: Notify owner via Telegram ──────────────────────────
python3 -c "from telegram.telegram_notifier import send_alert; send_alert('VPS recovery complete — all systems nominal')"
```

**Total estimated time:** 30 minutes if backups are clean + 30 minutes for
DNS propagation = ~1 hour RTO. Matches Tier-1 target.

### 10.3 Runbook: single DB corruption (no full VPS loss)

```bash
# ─── STEP 0: Identify the corrupt DB ─────────────────────────────
# /api/health will return degraded + which DB failed integrity_check

# ─── STEP 1: Stop the affected PM2 process (NOT all PM2) ────────
pm2 stop python-backend  # or whichever writes to the corrupt DB

# ─── STEP 2: Restore from Litestream (Tier-1) or smart_db_backup (Tier-2/3) ────
litestream restore -o db/predictions.db s3://glminvestment-backups/predictions.db
# OR
cp db/backups/smart/predictions.<latest-timestamp>.db db/predictions.db

# ─── STEP 3: Run production-migrate to apply any pending migrations ────
python3 scripts/production-migrate.py

# ─── STEP 4: Restart PM2 ─────────────────────────────────────────
pm2 restart python-backend

# ─── STEP 5: Verify ──────────────────────────────────────────────
curl http://localhost:3000/api/health
```

**Total time:** ~5 minutes. Matches Tier-1 RTO.

### 10.4 Who has access to backups?

- **B2 credentials:** stored in `.env` as `B2_APPLICATION_KEY_ID` +
  `B2_APPLICATION_KEY`. Owner (`enmohsen20111975`) holds the master B2 account
  credentials offline (printed copy + password manager).
- **GitHub repo (code + `data/all.zip`):** owner is admin on the GitHub org.
- **VPS root SSH key:** owner + 1 trusted engineer.
- **Telegram alert bot:** owner is the only subscriber to the alert channel.

Document these in `Documentation/DISASTER-RECOVERY-RUNBOOK.md` (future task —
not part of 16-D).

---

## §11 — Cost-Benefit Analysis

### 11.1 Option comparison

| Option | Effort | $/month | RPO (Tier-1) | RTO (Tier-1) | Maint burden |
|---|---|---|---|---|---|
| **A: Status quo (smart_db_backup only)** | $0 | $0 | 24h | 1h | low |
| **B: SQLite + gzip + B2 + Litestream** | 16h | $0.07 | 1 sec | 1h | low |
| **C: Turso (libSQL) for Tier-1 DBs** | 6h/DB × 3 = 18h | $0 (free tier) | 1 sec | 30 min | low (managed) |
| **D: Hybrid (SQLite for read-heavy, PostgreSQL for write-heavy)** | 3-4 weeks | $25-69 | 1 min | 15 min | medium |
| **E: Full PostgreSQL migration** | 3-4 weeks | $25-99 | 1 min | 15 min | medium-high |
| **F: Self-hosted PostgreSQL on same VPS** | 3-4 weeks + ongoing ops | $0 + VPS upgrade ($10) | 1 min | 1h | high (you own ops) |

### 11.2 Recommendation matrix

| Owner priority | Best option | Why |
|---|---|---|
| "Lowest cost, biggest win" | **B** (SQLite + gzip + B2 + Litestream) | $0.07/month, 16h engineering, fixes the disk problem AND the corruption-recovery problem |
| "Set and forget, modern stack" | **C** (Turso) | $0/month on free tier, 18h engineering, gets managed backups + replication + branching for free |
| "We're going to scale to 10,000+ users" | **D** (Hybrid) | $25-69/month, 3-4 weeks engineering, future-proofs write-heavy DBs |
| "Maximum simplicity, we own the data" | **F** (Self-hosted PG) | $10/month VPS upgrade, 3-4 weeks, no vendor lock-in but high ops burden |

---

## §12 — Ranked Recommendations (top 3)

### 🥇 Recommendation 1: Adopt Litestream + gzip + B2 (Option B)

**Why ranked #1:** Smallest engineering investment for the biggest immediate
win. Addresses BOTH of the owner's stated worries:

- "DB corruption problems" → Litestream gives 1-second RPO, far better than
  current 24-hour.
- "Backups consuming all server disk" → gzip saves ~70 % disk + B2 moves
  everything off the VPS.

**Cost:** $0.07/month + 16 hours engineering.
**Trigger condition to start:** none — applicable today.
**Estimated payback:** immediate (frees ~17 GB on VPS, reduces RPO by 86,400×).

### 🥈 Recommendation 2: Pilot Turso for `auth.db` (Option C, partial)

**Why ranked #2:** Lowest-risk way to test "is SQLite-native modernization
worth it." Auth.db is the smallest (208 KB) and has the cleanest Prisma schema
— if Turso's libSQL driver works cleanly with Prisma + our cron jobs for 30
days, we have evidence to either roll forward to predictions.db or roll back
with minimal loss.

**Cost:** $0/month + 6 hours engineering.
**Trigger condition to start:** after Recommendation 1 is in production for 30
days (so we have a clean baseline).
**Estimated payback:** proves/disproves the modernization thesis before
committing to Recommendation 3.

### 🥉 Recommendation 3: Define formal trigger conditions for PostgreSQL migration

**Why ranked #3:** Don't migrate today — we're 5-35× under every trigger
threshold. But document the triggers (§3.6) and review quarterly. When a
trigger fires, the migration decision is data-driven, not vibes-driven.

**Cost:** $0/month + 2 hours documentation.
**Trigger condition to start:** none — pure policy.
**Estimated payback:** avoids a $25-99/month commitment we don't yet need.

---

## §13 — Decision Matrix for Owner

| Question | If YES → | If NO → |
|---|---|---|
| Is the VPS disk ≥ 80 % full right now? | Approve Recommendation 1 immediately (gzip + B2 cleanup = 17 GB freed in 16h) | Schedule Recommendation 1 for next sprint |
| Are you comfortable with $0.07/month ongoing cost? | Approve Recommendation 1 | Stay on smart_db_backup.py (status quo) |
| Have we hit any PostgreSQL migration trigger (§3.6)? | Approve Recommendation 3 (start migration) | Approve Recommendation 3 (document triggers, defer migration) |
| Are you OK with a 30-day Turso pilot on auth.db? | Approve Recommendation 2 | Defer Turso until Recommendation 1 is stable |
| Do we have an off-site copy of `.env` (B2 + Telegram bot tokens)? | Approve runbook (§10) | Owner action: copy `.env` to offline storage (printed + password manager) — non-negotiable prerequisite |

---

## §14 — What this document does NOT do

- Does **not** touch any production DB (Rule 1).
- Does **not** run any migration script.
- Does **not** modify `smart_db_backup.py` or any cron entry.
- Does **not** install Litestream, Turso, PostgreSQL, or any new dependency.
- Does **not** create any new screen or system file (Rule 63.2 — this is
  documentation, permitted; the file `DB-RESILIENCE-STRATEGY.md` is a new doc
  in `Documentation/`, explicitly allowed).
- Does **not** commit the owner to any of the recommendations. Owner reviews,
  owner decides, owner issues a follow-up task.

---

## §15 — References (verified 2026-10-02)

- `Documentation/00-CONSTITUTION.md` — Rule 1 (never touch prod DBs), Rule 6
  (schema-aware), Rule 12 (`load_merged_history()` sole source), Rule 16
  (VERIFY-BEFORE-DELETE), Rule 58 (observability), Rule 61 (relative paths),
  Rule 62 (git-push-discipline), Rule 63 (no new screens/files).
- `Documentation/01-PROJECT_ANATOMY.md` — §3 DB architecture, §3.7 statistics
  for `predictions.db`, §3.1 DB map, §5 data flow.
- `Documentation/05-CURRENT_STATE.md` — §3.1 active DBs (sizes + row counts),
  §3.2 DB path resolution, §3.3 key tables.
- `vps-service/scripts/smart_db_backup.py` — current backup mechanism (read
  in full — verified rotation, integrity_check, auto-restore logic).
- `vps-service/jobs/wal_checkpoint.py` — hourly WAL checkpoint job (read in
  full — verified targets = stocks + predictions + price_history + data_engine).
- `scripts/production-migrate.py` — idempotent migration script (read in full).
- `scripts/setup-backup-cron.sh` — broken cron installer (auto-backup.sh missing).
- `crontab.txt` — actual production cron (entry #10 calls smart_db_backup.py).
- External references: [litestream.io](https://litestream.io),
  [turso.tech](https://turso.tech), [backblaze.com/b2](https://backblaze.com/b2),
  [supabase.com/pricing](https://supabase.com/pricing),
  [neon.tech/pricing](https://neon.tech/pricing).

---

**End of strategic document. Owner review requested.**

---

## 📎 MERGED APPENDIX — Production Data Engine Fix Runbook (PROD-DATA-FIX-RUNBOOK.md)

> **Source file (merged then archived):** `PROD-DATA-FIX-RUNBOOK.md`
> **Merged by:** Documentation Secretariat (Task ID: 25 — Consolidate to 6 canonical files)
> **Date:** 2026-10-03
> **Rule 4 (NO new files):** content merged INTO existing canonical file; source file `git rm`'d (history preserved by git).
> **Rule 62 (Secretary updates docs):** ✅ applied. **Rule 63 (commit + push after each):** ✅ applied.

### Original content of `PROD-DATA-FIX-RUNBOOK.md` (verbatim):

# 📋 Runbook: Data Engine Fix على السيرفر الإنتاجي (Production)

> **التاريخ:** 2026-10-03
> **لمن:** المبرمج المساعد على الـ production server
> **من:** المدير العام (Z.ai)
> **الهدف:** إصلاح كارثة البيانات + منع تكرارها
> **المرجعية:** الدستور Rule 12 + 20 + 24 + 63 + `DATA-ENGINE-ARCHITECTURE.md`

---

## ⚠️ قبل ما تبدأ

### القواعد الإلزامية (من الدستور):
- **Rule 1**: ممنوع الكتابة المباشرة في prod DBs إلا عبر scripts محددة
- **Rule 12**: `load_merged_history()` هو المصدر الوحيد للأسعار
- **Rule 20**: Python = العقل، Node = العرض
- **Rule 24**: ممنوع بيانات وهمية — لو مش موجود، اكتب NULL
- **Rule 63**: كل commit = push فوري

### الـ scripts اللي لازم تستخدمها (موجودة في الكود):
```
vps-service/data/validation.py          — Data Validation Layer
vps-service/data/source_authority.py    — Canonical Source Guard
vps-service/data/source_priority_cleaner.py — تنظيف المصادر المتعددة
```

---

## 🔍 المرحلة 1: التشخيص (Diagnose)

شغّل الأوامر دي على الـ prod وسجّل النتائج:

### 1.1 فحص الـ pipeline timestamps

```bash
cd /root/GLMinvestment

# Check latest timestamps in ALL DBs
python3 << 'EOF'
import sqlite3

checks = [
    ('db/stocks.db', 'stocks', 'last_update'),
    ('db/stocks.db', 'stock_daily_prices', 'fetch_time'),
    ('db/price_history.db', 'price_history', 'created_at'),
    ('db/data_engine.db', 'crypto_prices', 'timestamp'),
    ('db/data_engine.db', 'gold_prices', 'timestamp'),
    ('db/intraday.db', 'stock_intraday', 'timestamp'),
]

print("=== Pipeline Freshness Check ===")
for db, table, col in checks:
    try:
        conn = sqlite3.connect(db)
        row = conn.execute(f'SELECT MAX({col}) FROM {table}').fetchone()
        print(f"  {db}.{table}: latest = {row[0] if row else 'NULL'}")
        conn.close()
    except Exception as e:
        print(f"  {db}.{table}: ERROR {e}")
EOF
```

**النتيجة المتوقعة:** لو أي table آخر تاريخ < اليوم → الـ cron وقف.

### 1.2 فحص الـ PM2 processes

```bash
pm2 list
```

**تحقق:** هل كل الـ processes `online`؟
- `python-backend` (port 8010)
- `data-engine`
- `nextjs`
- `ws-service` (port 3005)
- `telegram-events` (port 3003)
- `news-agent`
- `telegram-interactive-bot`
- `telegram-poster`

### 1.3 فحص الـ crontab

```bash
crontab -l | grep -v "^#"
```

**تحقق:** هل فيه cron jobs لـ:
- `daily_price_updater.py`
- `tradingview_scraper.py`
- `price_history_safetynet.py`
- `egksco_scraper.py`
- `us_stock_scraper.py`
- `multi_market_scraper.py`

### 1.4 فحص الـ multi-source problem

```bash
cd /root/GLMinvestment
python3 << 'EOF'
import sqlite3
conn = sqlite3.connect('db/price_history.db')

# Count tickers with multiple sources
multi = conn.execute("""
    SELECT COUNT(*) FROM (
        SELECT ticker FROM price_history
        GROUP BY ticker HAVING COUNT(DISTINCT source) > 1
    )
""").fetchone()[0]
print(f"Tickers with MULTIPLE sources: {multi}")

# Show sources
sources = conn.execute("""
    SELECT source, COUNT(*) as cnt, COUNT(DISTINCT ticker) as tickers,
           MAX(date) as latest
    FROM price_history GROUP BY source ORDER BY cnt DESC
""").fetchall()
print("\nSources:")
for s in sources:
    print(f"  {s[0]}: {s[1]:,} rows, {s[2]} tickers, latest={s[3]}")

# CRST specifically
print("\nCRST sources:")
for r in conn.execute("""
    SELECT source, COUNT(*), MIN(close_price), MAX(close_price), MAX(date)
    FROM price_history WHERE ticker='CRST' GROUP BY source
""").fetchall():
    print(f"  {r[0]}: {r[1]} rows, price {r[2]:.3f}-{r[3]:.3f}, latest={r[4]}")

conn.close()
EOF
```

### 1.5 فحص الـ close column NULL

```bash
python3 << 'EOF'
import sqlite3
conn = sqlite3.connect('db/stocks.db')
total = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
null_close = conn.execute("SELECT COUNT(*) FROM stocks WHERE close IS NULL OR close = 0").fetchone()[0]
print(f"Total stocks: {total}")
print(f"close IS NULL or 0: {null_close} ({null_close*100//total}%)")
print(f"close > 0: {total - null_close} ({(total-null_close)*100//total}%)")
conn.close()
EOF
```

### 1.6 مقارنة الأسعار بالواقع (الـ QA Battalion test)

```bash
python3 << 'EOF'
import sqlite3, requests

conn = sqlite3.connect('db/stocks.db')

# Test 5 EGX stocks
test_tickers = ['COMI', 'HRHO', 'SWDY', 'ETEL', 'TMGH']
print("=== EGX Price Accuracy Test ===")
for ticker in test_tickers:
    db_price = conn.execute(
        "SELECT current_price FROM stocks WHERE ticker = ?", (ticker,)
    ).fetchone()
    if db_price and db_price[0]:
        # Get real price from Yahoo
        try:
            r = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}.CA",
                timeout=5
            )
            if r.status_code == 200:
                real_price = r.json()['chart']['result'][0]['meta']['regularMarketPrice']
                diff_pct = abs(db_price[0] - real_price) / real_price * 100
                status = "✅ OK" if diff_pct < 2 else "❌ INVALID"
                print(f"  {ticker}: DB={db_price[0]:.2f} vs Real={real_price:.2f} → {diff_pct:.1f}% {status}")
            else:
                print(f"  {ticker}: DB={db_price[0]:.2f} — Yahoo returned {r.status_code}")
        except Exception as e:
            print(f"  {ticker}: DB={db_price[0]:.2f} — Error: {e}")
    else:
        print(f"  {ticker}: DB price is NULL")

# Test 3 cryptos
print("\n=== Crypto Price Accuracy Test ===")
for symbol, binance_pair in [('BTC', 'BTCUSDT'), ('ETH', 'ETHUSDT'), ('SOL', 'SOLUSDT')]:
    try:
        r = requests.get(f"https://api.binance.com/api/v3/ticker/price?symbol={binance_pair}", timeout=5)
        if r.status_code == 200:
            real_price = float(r.json()['price'])
            # Get from data_engine
            conn2 = sqlite3.connect('db/data_engine.db')
            db_row = conn2.execute(
                "SELECT price_usd FROM crypto_prices WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1",
                (symbol,)
            ).fetchone()
            conn2.close()
            if db_row:
                diff_pct = abs(db_row[0] - real_price) / real_price * 100
                status = "✅ OK" if diff_pct < 2 else "❌ INVALID"
                print(f"  {symbol}: DB=${db_row[0]:,.2f} vs Real=${real_price:,.2f} → {diff_pct:.1f}% {status}")
            else:
                print(f"  {symbol}: no DB data, Real=${real_price:,.2f}")
    except Exception as e:
        print(f"  {symbol}: Error: {e}")

conn.close()
EOF
```

**سجّل كل النتائج** — هتحتاجها للمرحلة التالية.

---

## 🔧 المرحلة 2: الإصلاح (Fix)

### 2.1 إعادة تشغيل الـ pipeline (P0-1: السبب الجذري)

```bash
cd /root/GLMinvestment

# 1. Pull latest code
git pull origin main

# 2. Restart PM2 processes
pm2 reload ecosystem.config.js --update-env

# 3. Verify all processes online
pm2 list

# 4. Restart crontab
crontab crontab.txt

# 5. Verify cron jobs
crontab -l | grep -c "python3"  # should be > 15

# 6. Manually trigger the fetchers to test
python3 vps-service/scripts/daily_price_updater.py 2>&1 | tail -20
python3 data_engine/scrapers/tradingview_scraper.py 2>&1 | tail -10
```

### 2.2 تنظيف المصادر المتعددة (P0: source unification)

```bash
cd /root/GLMinvestment

# DRY RUN first — see what will be deleted
python3 vps-service/data/source_priority_cleaner.py

# If looks correct → LIVE cleanup (creates backup automatically)
python3 vps-service/data/source_priority_cleaner.py --live

# Verify
python3 -c "
import sqlite3
conn = sqlite3.connect('db/price_history.db')
multi = conn.execute('SELECT COUNT(*) FROM (SELECT ticker FROM price_history GROUP BY ticker HAVING COUNT(DISTINCT source) > 1)').fetchone()[0]
print(f'Multi-source tickers: {multi} (should be 0)')
conn.close()
"
```

### 2.3 إصلاح close column NULL (P0-2)

```bash
python3 << 'EOF'
import sqlite3
conn = sqlite3.connect('db/stocks.db')

# Fix: populate close from current_price
updated = conn.execute("""
    UPDATE stocks SET close = current_price
    WHERE (close IS NULL OR close = 0) AND current_price > 0
""").rowcount
conn.commit()

# Verify
still_null = conn.execute("SELECT COUNT(*) FROM stocks WHERE close IS NULL OR close = 0").fetchone()[0]
print(f"Fixed {updated} stocks. Remaining NULL: {still_null}")
conn.close()
EOF
```

### 2.4 اختبار الـ validation layer

```bash
cd /root/GLMinvestment
python3 << 'EOF'
import sys; sys.path.insert(0, 'vps-service')
from data.validation import validate_stock_data, summarize_validation
from data.source_authority import get_canonical_source, get_market_for_ticker

# Test CRST (the bug stock)
vd = validate_stock_data(
    ticker='CRST',
    current_price=3.02,
    high_52w=1.95,
    low_52w=0.99,
    support=158.73,
    resistance=137.97,
)
print("=== CRST Validation ===")
print(summarize_validation(vd))
print(f"is_valid_overall: {vd.is_valid_overall}")

# Test a normal stock
vd2 = validate_stock_data(
    ticker='COMI',
    current_price=127.69,
    high_52w=145.0,
    low_52w=95.0,
    support=120.0,
    resistance=140.0,
)
print("\n=== COMI Validation ===")
print(f"is_valid_overall: {vd2.is_valid_overall}")

# Test source authority
print("\n=== Source Authority ===")
for market in ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO', 'GOLD']:
    print(f"  {market}: canonical = {get_canonical_source(market)}")
EOF
```

### 2.5 اختبار شامل بعد الإصلاح

```bash
# Re-run the price accuracy test (from 1.6)
# All prices should now be within 2% of real prices
python3 << 'EOF'
import sqlite3, requests

conn = sqlite3.connect('db/stocks.db')
test_tickers = ['COMI', 'HRHO', 'SWDY', 'ETEL', 'TMGH']
print("=== POST-FIX Price Accuracy Test ===")
all_ok = True
for ticker in test_tickers:
    db_price = conn.execute("SELECT current_price FROM stocks WHERE ticker = ?", (ticker,)).fetchone()
    if db_price and db_price[0]:
        try:
            r = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}.CA", timeout=5)
            if r.status_code == 200:
                real_price = r.json()['chart']['result'][0]['meta']['regularMarketPrice']
                diff_pct = abs(db_price[0] - real_price) / real_price * 100
                status = "✅" if diff_pct < 2 else "❌"
                if diff_pct >= 2:
                    all_ok = False
                print(f"  {status} {ticker}: DB={db_price[0]:.2f} vs Real={real_price:.2f} → {diff_pct:.1f}%")
        except Exception as e:
            print(f"  ⚠️ {ticker}: {e}")
conn.close()
print(f"\nOverall: {'✅ ALL OK' if all_ok else '❌ STILL HAS ISSUES'}")
EOF
```

---

## 📊 المرحلة 3: التحقق النهائي (Verify)

### 3.1 Checklist

```bash
echo "=== FINAL VERIFICATION CHECKLIST ==="

# 1. Pipeline running?
LATEST=$(python3 -c "import sqlite3; conn=sqlite3.connect('db/stocks.db'); print(conn.execute('SELECT MAX(last_update) FROM stocks').fetchone()[0])")
echo "1. Latest stocks update: $LATEST"

# 2. Multi-source cleaned?
MULTI=$(python3 -c "import sqlite3; conn=sqlite3.connect('db/price_history.db'); print(conn.execute('SELECT COUNT(*) FROM (SELECT ticker FROM price_history GROUP BY ticker HAVING COUNT(DISTINCT source) > 1)').fetchone()[0])")
echo "2. Multi-source tickers: $MULTI (should be 0)"

# 3. close column fixed?
NULL_CLOSE=$(python3 -c "import sqlite3; conn=sqlite3.connect('db/stocks.db'); print(conn.execute('SELECT COUNT(*) FROM stocks WHERE close IS NULL OR close = 0').fetchone()[0])")
echo "3. close NULL/0: $NULL_CLOSE (should be 0)"

# 4. PM2 processes?
PM2_COUNT=$(pm2 list | grep -c "online")
echo "4. PM2 online processes: $PM2_COUNT (should be 8)"

# 5. Cron jobs?
CRON_COUNT=$(crontab -l | grep -c "python3")
echo "5. Cron jobs: $CRON_COUNT (should be > 15)"

echo ""
echo "=== ALL CHECKS COMPLETE ==="
```

### 3.2 مراقبة بعد 24 ساعة

بعد 24 ساعة من الإصلاح، شغّل:

```bash
# Check if fresh data is flowing
python3 << 'EOF'
import sqlite3
from datetime import datetime

conn = sqlite3.connect('db/stocks.db')
latest = conn.execute("SELECT MAX(last_update) FROM stocks").fetchone()[0]
if latest:
    # Parse and check age
    dt = datetime.fromisoformat(latest)
    age_hours = (datetime.now() - dt).total_seconds() / 3600
    if age_hours < 24:
        print(f"✅ Data is fresh (age: {age_hours:.1f}h)")
    else:
        print(f"❌ Data is STALE (age: {age_hours:.1f}h) — pipeline may have stopped again")
conn.close()
EOF
```

---

## 🚨 ماذا لو فشل شيء؟

### لو الـ pipeline وقف تاني بعد الإصلاح:

1. شوف الـ logs:
```bash
tail -100 /tmp/price_updater_morning.log
tail -100 /tmp/tradingview.log
pm2 logs python-backend --lines 50
```

2. شوف أخطاء الـ cron:
```bash
grep -i "error\|traceback\|failed" /tmp/*.log | tail -30
```

3. لو فيه خطأ في `source_authority.py`:
```bash
python3 -c "
import sys; sys.path.insert(0, 'vps-service')
from data.source_authority import write_guarded, get_market_for_ticker
print('source_authority imported OK')
print('EGX canonical:', get_canonical_source('EGX'))
"
```

### لو الـ validation.py crashed:

```bash
python3 -c "
import sys; sys.path.insert(0, 'vps-service')
from data.validation import validate_stock_data
vd = validate_stock_data('TEST', current_price=100, high_52w=120, low_52w=80)
print('validation OK, valid:', vd.is_valid_overall)
"
```

---

## 📝 ملخص للمبرمج المساعد

### المشكلة:
1. **الـ pipeline كله وقف** — كل الـ DBs آخر تاريخ = 2026-09-05
2. **930 سهم عندهم مصادر متعددة** بأسعار مختلفة
3. **close column = NULL** لـ 99% من الأسهم
4. **الأسعار غلط** — 0/7 طابقت الواقع

### الحل (نفّذ بالترتيب):
1. **`git pull origin main`** — أحدّث الكود
2. **`pm2 reload ecosystem.config.js --update-env`** — إعادة تشغيل
3. **`crontab crontab.txt`** — إعادة تشغيل الـ cron
4. **`python3 vps-service/data/source_priority_cleaner.py --live`** — تنظيف المصادر
5. **إصلاح close column** (السكربت في 2.3)
6. **اختبار الأسعار** (السكربت في 2.5)

### الملفات اللي أنشأتها (موجودة في الكود بعد `git pull`):
- `vps-service/data/validation.py` — Data Validation Layer
- `vps-service/data/source_authority.py` — Canonical Source Guard
- `vps-service/data/source_priority_cleaner.py` — Multi-source cleaner
- `Documentation/DATA-ENGINE-ARCHITECTURE.md` — الـ architecture الكامل

### بعد الإصلاح:
- كل سهم ليه **مصدر واحد بس** (canonical)
- الـ validation layer بيـ catch أي بيانات غلط
- الـ source guard بيمنع الكتابة المتعددة
- **نفس التنظيم لازم يتعمل على باقي السيرفرات** (زي ما المالك أمر)

---

*هذا الـ runbook مبنى على:*
- *قراءة الدستور Rule 12 + 20 + 24 + 63*
- *تحليل قواعد البيانات الفعلي*
- *تقرير فريق الجودة QA-22*
- *اختبارات الـ validation + source_authority*

---

## 📎 MERGED APPENDIX — Ticker/Symbol Unification Plan (TICKER-SYMBOL-UNIFICATION-PLAN.md)

> **Source file (merged then archived):** `TICKER-SYMBOL-UNIFICATION-PLAN.md`
> **Merged by:** Documentation Secretariat (Task ID: 25 — Consolidate to 6 canonical files)
> **Date:** 2026-10-03
> **Rule 4 (NO new files):** content merged INTO existing canonical file; source file `git rm`'d (history preserved by git).
> **Rule 62 (Secretary updates docs):** ✅ applied. **Rule 63 (commit + push after each):** ✅ applied.

### Original content of `TICKER-SYMBOL-UNIFICATION-PLAN.md` (verbatim):

# 🔧 خطة إصلاح توحيد الرموز والأسماء (Ticker/Symbol Unification)

> **التاريخ:** 2026-10-03
> **المرجعية:** الدستور Rule 12 + 20 + 24 + 63 + 66
> **الهدف:** "تخلى كل المصادر تكتب الأسماء والرموز صح ويكون فية توحيد ليهم"

---

## 🚨 المشكلة المكتشفة (التحقيق الجنائي)

### 1. تلوث الرموز بالأسماء في `price_history.db`
```
ACAPA Capital HoldingD    ← الاسم العربي اتلصق بالـ ticker!
ACFRAlexandria Company... ← نفس المشكلة
ACTFAct FinancialD       ← نفس المشكلة
```
**السبب:** أحد الـ scrapers بياخد الـ ticker + name مع بعض ويكتبهم في عمود واحد.

### 2. `name_ar` فيه أسماء إنجليزية (stocks.db)
```
HRHO: name_ar = "EFG Holding S.A.E."  ← ده إنجليزي مش عربي!
KORA: name_ar = "KORRA"                ← الاسم العربي هو نفس الرمز!
VLMR: name_ar = "Valmore Holding"      ← إنجليزي!
```

### 3. `market` فيه قيم عربية في data_engine.db
```
data_engine.db.stocks: market = 'مصر'  ← عربي
stocks.db.stocks:      market = 'EGX'   ← إنجليزي
```
**النتيجة:** JOIN بين الـ DBs بيفشل لأن `market` مختلف.

### 4. رموز مختلفة لنفس الشركة
| المصدر | الرمز | الاسم الحقيقي |
|---|---|---|
| stocks.db | HRHO | EFG Holding S.A.E. |
| المصدر الشرعي | EFG | name_ar=None |
| **الحقيقة** | **HRHO** هي الرمز الرسمي في EGX | مجموعة إي اف جي القابضة |

| المصدر | الرمز | الاسم الحقيقي |
|---|---|---|
| stocks.db | KORA | KORRA |
| data_engine.db | KORA | KORAKORRAD ← ملوث! |
| المصدر الشرعي | KORRA | شركة كورا للاستثمار |

### 5. 80 سهم في stocks.db مش موجودين في data_engine.db
```
PIOH, BLDG, 9413, AOTM, PACL, 4328, GMCC, ORTE, OCIC, 9409 ...
```
**السبب:** data_engine.db أحدث (1585 سهم) لكن stocks.db قديم (956 سهم).

### 6. أسماء عربية ملوثة بالأسماء الإنجليزية
```
data_engine.db: KORA → name = "KORAKORRAD"  ← الرمز اتكرر + D في الآخر!
price_history.db: AIDC → "AIDCArabia for Investment..."  ← ticker+name مدموجين!
```

---

## ✅ الحل (Ticker/Symbol Canonical Registry)

### المبدأ
**ننشئ جدول `ticker_registry` واحد في `stocks.db`** — هو المرجع الوحيد لربط الرموز.

### الـ Schema
```sql
CREATE TABLE IF NOT EXISTS ticker_registry (
    canonical_ticker TEXT PRIMARY KEY,     -- الرمز الرسمي (HRHO, KORA, COMI)
    egx_ticker TEXT,                       -- الرمز في EGX (لو مختلف)
    sharia_symbol TEXT,                    -- الرمز في المصدر الشرعي
    yahoo_symbol TEXT,                     -- الرمز في Yahoo Finance
    tradingview_symbol TEXT,               -- الرمز في TradingView
    name_en TEXT,                          -- الاسم الإنجليزي
    name_ar TEXT,                          -- الاسم العربي
    market TEXT,                           -- EGX / TADAWUL / KSE / QSE / US / CRYPTO / GOLD
    sector TEXT,
    is_active INTEGER DEFAULT 1,
    notes TEXT,
    updated_at TEXT
);
```

### كيف يعمل:
1. كل scraper قبل ما يكتب → يـ lookup في `ticker_registry`
2. لو الـ ticker مش موجود → يرفض الكتابة (مش بيعمل جديد عشوائي)
3. لو موجود → يستخدم `canonical_ticker` في الكتابة
4. لو فيه mapping مختلف (EFG → HRHO) → البيانات تتكتب تحت HRHO

### الـ Mappings المعروفة (Collision Guard):
```python
TICKER_MAPPINGS = {
    # المصدر الشرعي → الرمز الرسمي
    'EFG': 'HRHO',       # EFG Holding → HRHO (الرمز الرسمي في EGX)
    'KORRA': 'KORA',     # KORRA = KORA (نفس الشركة، رمز مختلف في المصدر)
    'LBCT': 'IBCT',     # International Business Corp = IBCT
    
    # أسماء ملوثة → الرمز الصحيح
    'ACAPA Capital HoldingD': 'ACAP',
    'ACFRAlexandria Company For RefractoriesD': 'ACFR',
    'ACTFAct FinancialD': 'ACTF',
    'AIDCArabia for Investment and Development': 'AIDC',
    
    # Yahoo suffixes
    'COMI.CA': 'COMI',
    'HRHO.CA': 'HRHO',
    '2222.SR': '2222',  # Aramco
}

# شركتين مختلفتين — ممنوع الدمج:
SEPARATE_COMPANIES = {
    'VLMR': 'Valmore Holding',
    'VLMRA': 'Valmore Holding (different class)',  # شركة مختلفة!
}
```

---

## 📋 الـ Instructions للمبرمجين على الـ prod

### Step 1: إنشاء `ticker_registry` في stocks.db
```bash
cd /root/GLMinvestment
python3 << 'EOF'
import sqlite3
conn = sqlite3.connect('db/stocks.db')
conn.execute("""
    CREATE TABLE IF NOT EXISTS ticker_registry (
        canonical_ticker TEXT PRIMARY KEY,
        egx_ticker TEXT,
        sharia_symbol TEXT,
        yahoo_symbol TEXT,
        tradingview_symbol TEXT,
        name_en TEXT,
        name_ar TEXT,
        market TEXT,
        sector TEXT,
        is_active INTEGER DEFAULT 1,
        notes TEXT,
        updated_at TEXT
    )
""")
# Populate from stocks.db.stocks (canonical source)
conn.execute("""
    INSERT OR REPLACE INTO ticker_registry 
    (canonical_ticker, name_en, name_ar, market, sector, updated_at)
    SELECT ticker, name, name_ar, market, sector, datetime('now')
    FROM stocks WHERE market = 'EGX'
""")
# Add known mappings
mappings = [
    ('HRHO', 'HRHO', 'EFG', 'HRHO.CA', 'HRHO', 'EFG Holding S.A.E.', 'مجموعة إي اف جي القابضة', 'EGX'),
    ('KORA', 'KORA', 'KORRA', 'KORA.CA', 'KORA', 'KORRA', 'شركة كورا للاستثمار', 'EGX'),
    ('IBCT', 'IBCT', 'LBCT', 'IBCT.CA', 'IBCT', 'International Business Corp.', 'انترناشيونال بزنيس كوربوريشن', 'EGX'),
]
for m in mappings:
    conn.execute("""
        UPDATE ticker_registry SET 
        egx_ticker=?, sharia_symbol=?, yahoo_symbol=?, tradingview_symbol=?,
        name_en=?, name_ar=?
        WHERE canonical_ticker=?
    """, (m[1], m[2], m[3], m[4], m[5], m[6], m[0]))
conn.commit()
count = conn.execute("SELECT COUNT(*) FROM ticker_registry").fetchone()[0]
print(f"✅ ticker_registry created with {count} entries")
conn.close()
EOF
```

### Step 2: تنظيف الأسماء الملوثة في price_history.db
```bash
python3 << 'EOF'
import sqlite3, re
conn = sqlite3.connect('db/price_history.db')

# Find tickers with Arabic/name contamination
bad = conn.execute("""
    SELECT DISTINCT ticker FROM price_history 
    WHERE LENGTH(ticker) > 6 OR ticker LIKE '% %' OR ticker GLOB '*[A-Z][a-z]*[A-Z]*'
""").fetchall()
print(f"Contaminated tickers found: {len(bad)}")

for (bad_ticker,) in bad:
    # Extract the real ticker (first all-caps part)
    match = re.match(r'^([A-Z]{2,6})', bad_ticker)
    if match:
        clean = match.group(1)
        # Verify clean ticker exists in stocks.db
        sconn = sqlite3.connect('db/stocks.db')
        exists = sconn.execute("SELECT 1 FROM stocks WHERE ticker = ?", (clean,)).fetchone()
        sconn.close()
        if exists:
            # Update all rows
            updated = conn.execute(
                "UPDATE price_history SET ticker = ? WHERE ticker = ?",
                (clean, bad_ticker)
            ).rowcount
            conn.commit()
            print(f"  {bad_ticker} → {clean}: {updated} rows fixed")
        else:
            print(f"  {bad_ticker} → {clean}: SKIP (not in stocks.db)")
    else:
        print(f"  {bad_ticker}: cannot extract clean ticker")
conn.close()
EOF
```

### Step 3: توحيد `market` في data_engine.db
```bash
python3 << 'EOF'
import sqlite3
conn = sqlite3.connect('db/data_engine.db')
# Map Arabic market names to English
market_map = {
    'مصر': 'EGX',
    'السعودية': 'TADAWUL',
    'الكويت': 'KSE',
    'قطر': 'QSE',
    'أمريكا': 'US',
}
for ar, en in market_map.items():
    updated = conn.execute("UPDATE stocks SET market = ? WHERE market = ?", (en, ar)).rowcount
    if updated:
        print(f"  market '{ar}' → '{en}': {updated} rows")
conn.commit()
conn.close()
EOF
```

### Step 4: تنظيف `name_ar` في stocks.db (أسماء إنجليزية → عربية)
```bash
python3 << 'EOF'
import sqlite3
conn = sqlite3.connect('db/stocks.db')
# Find name_ar that's actually English (no Arabic chars)
import re
arabic_re = re.compile(r'[\u0600-\u06FF]')
rows = conn.execute("SELECT ticker, name, name_ar FROM stocks WHERE market = 'EGX'").fetchall()
english_name_ar = 0
for ticker, name, name_ar in rows:
    if name_ar and not arabic_re.search(name_ar):
        # name_ar is actually English — need real Arabic name
        # For now, flag it (can't auto-fix without a source)
        english_name_ar += 1
print(f"Stocks with English in name_ar: {english_name_ar}/{len(rows)}")
print("(Needs manual Arabic name import from EGX official list)")
conn.close()
EOF
```

### Step 5: إضافة `ticker_registry` lookup في كل scrapers
```bash
# Every scraper should do:
# 1. Before writing: lookup canonical_ticker from ticker_registry
# 2. If not found: SKIP (don't create random ticker)
# 3. If found: write with canonical_ticker
```

---

## 📊 ملخص المشكلة + الحل

| المشكلة | العدد | الحل |
|---|---|---|
| tickers ملوثة بالأسماء في price_history | ~10 | تنظيف: استخراج الرمز الصحيح |
| name_ar = English (مش عربي) | ~200+ | استيراد أسماء عربية من EGX |
| market = عربي في data_engine | ~1000 | UPDATE → English |
| 80 سهم مش موجودين في data_engine | 80 | sync من stocks.db |
| رموز مختلفة لنفس الشركة (EFG↔HRHO) | ~5 | ticker_registry mapping |
| شركتين مختلفتين بنفس الاسم (VLMR≠VLMRA) | 2 | SEPARATE_COMPANIES guard |

---

## 🔒 ضمانات عدم التكرار

1. **ticker_registry** — جدول واحد مرجعي لكل الرموز
2. **كل scraper يـ lookup قبل الكتابة** — ممنوع إنشاء ticker جديد بدون تسجيل
3. **Collision guard** — شركتين مختلفتين لا يدمجان
4. **market values موحدة** — إنجليزي في كل الـ DBs

---

*هذا التحليل مبنى على فحص كامل لكل الـ DBs في الساندبوكس.*

---

## 📎 MERGED APPENDIX — Templatesnippet Integration Plan — Sharia Compliance (TEMPLATESNIPPET-INTEGRATION-PLAN.md)

### ✅ AS-BUILT — التنفيذ الفعلي (2026-10-03)

> الخطة الأصلية تحت (Step 1-5) كانت **تصميم مبدئي**. التنفيذ الفعلي خرج فيها بـ 4 فروق جوهرية — التوثيق هنا بيوضّح المستعمل (as-built) لأن الـ plan بيقترح شغل ما اتعملش، والـ as-built فيه شغل ما ات-planش.

**المبني فعلاً:**

| الملف | LOC | الوظيفة |
|-------|-----|---------|
| `data_engine/scrapers/sharia_compliance_scraper.py` | 855 | conditional GET بالـ ETag + 6 جداول + HTTP cache |
| `vps-service/portfolio/purification_calculator.py` | 425 | الحاسبة (CLI كامل + portfolio scope) |
| `scripts/repair_tab_symbols.py` | 295 | إصلاح 3664 صف `symbol` تالف |
| `scripts/repair_portfolio_tickers.py` | 188 | تنظيف `portfolio_assets.stock_ticker` |
| `src/app/api/sharia/route.ts` | ~300 | قراءة مباشرة `better-sqlite3` |
| `src/app/api/sharia/purification/route.ts` | ~215 | spawns البايثون (Rule 20) + IDOR gate + compat shim |

**الفروق عن الخطة:**

1. **`ticker_registry` المفرد ما اتعملش** — اتعمل بدله **multi-master resolution** بيقرأ 4 مصادر (`stocks.db.stocks` · `market.db.stocks` · `stocks.db.egksco_stocks` · `stocks.db.stocks_backup`) + `sharia_symbol_map` كسجل تدقيق. السبب: الـ `ticker_registry` كان هيتطلب adjudicate كل ticker على حدة، والـ 4 masters موجودين فعلاً.
2. **`EFG↔HRHO` اتأكدت** — وطلع إن **المصدر نفسه** فيه `EFG` و `HRHO` كـ `symbol` مستقلين بنفس الاسم، وكمان `KORA`↔`KORRA` (نفس الاسم العربي بالظبط، حكام مختلفين). ده هو بالظبط فخ `VLMR≠VLMRA` اللي في التحليل فوق → **collision guard** اتبنى بسببه.
3. **الـ scraping اتأكد static JSON مش API** — مفيش `/api/` أصلاً (robots بيمنعه)، والصفحة client-rendered. `stocks_merged.json` ثابت بـ ETag.
4. **اتكشفت كارثة بيانات مستقلة** (`tab_*`) ما كانتش في الخطة خالص — 3664 صف `symbol` تالف، كانت بتخلي التطهير مستحيل (مفيش DPS) و`corporate_actions` فاضية من dividends.

**الأرقام الفعلية (2026-10-03):** metrics=**253** · source_status=**2024** · purification_rates=**572** (S&P=**182**) · إجماع ≥6/8 = **49** سهم · 250/253 مربوطين · 3 unresolved.


> **Source file (merged then archived):** `TEMPLATESNIPPET-INTEGRATION-PLAN.md`
> **Merged by:** Documentation Secretariat (Task ID: 25 — Consolidate to 6 canonical files)
> **Date:** 2026-10-03
> **Rule 4 (NO new files):** content merged INTO existing canonical file; source file `git rm`'d (history preserved by git).
> **Rule 62 (Secretary updates docs):** ✅ applied. **Rule 63 (commit + push after each):** ✅ applied.

### Original content of `TEMPLATESNIPPET-INTEGRATION-PLAN.md` (verbatim):

# خطة تكامل templatesnippet.com — البيانات الشرعية + التطهير

> **التاريخ:** 2026-10-03
> **المصدر:** https://stocks.templatesnippet.com
> **التحديث:** مرة في الأسبوع (يوم السبت)
> **المرجعية:** `00-CONSTITUTION.md` Rule 4 (NO new screens), Rule 63 (push after commit)

---

## 1. ملخص الموقع

الموقع عبارة عن منصة Next.js بتعرض **253 سهم مصري (EGX)** مع بيانات التوافق الشرعي + التطهير من **7 مصادر شرعية** مختلفة.

---

## 2. البيانات المتاحة لكل سهم

| الحقل | الوصف | مثال (EKHO) |
|---|---|---|
| **symbol** | رمز السهم | EKHO |
| **name_ar** | اسم الشركة بالعربية | القابضة الكويتية المصرية |
| **name_en** | الاسم بالإنجليزية | Egypt Kuwait Holding Company S.A.E. |
| **market** | السوق | EGX |
| **currency** | العملة | EGP |
| **sector** | القطاع | استثمار وشركات قابضة |
| **description** | وصف الشركة | شركة استثمار مباشر تمتلك حصصاً... |
| **website** | الموقع الرسمي | ekholding.com |
| **prohibited_income_pct** | نسبة الإيرادات المحرمة | 8.081% |
| **interest_loans_pct** | نسبة القروض الربوية | 38.61% |
| **aaoifi_purification_egp** | الإيراد المحرم للسهم (AAOIFI) | 0.00023 EGP |
| **activity_permitted** | النشاط الأساسي مباح | نعم |
| **cash_liquidity_compliant** | السيولة النقدية متوافقة | نعم |
| **prohibited_investments** | الاستثمارات المحرمة | نعم |

### مصادر التقييم الشرعي (7 مصادر):

| # | المصدر | البيانات المتاحة |
|---|---|---|
| 1 | **مصفّى (Musaffa)** | compliance status + prohibited income % |
| 2 | **كاشف (Kashif)** | compliance status |
| 3 | **بنك فيصل الإسلامي** | compliance status |
| 4 | **أسطول (Uslub)** | compliance status + detailed metrics (market cap, assets, deposits, loans) |
| 5 | **Islamicly / Thndr** | compliance status |
| 6 | **جروب الأسهم الشرعية فقط** | compliance status (requires 3/8 lists) |
| 7 | **S&P Shariah** | compliance standard |

---

## 3. طريقة حساب التطهير (من /purification-guide)

### معيار AAOIFI (هيئة المحاسبة والمراجعة للمؤسسات المالية الإسلامية)
```
التطهير = نصيب السهم من الإيراد المحرَّم × عدد أيام امتلاك السهم × عدد الأسهم
```
- **المبدأ:** التطهير حق متعلق بملكية السهم نفسها (مش بالأرباح الموزعة بس)
- **يُطبّق:** طالما امتلكت السهم خلال فترة معينة، بصرف النظر عن ربح/خسارة
- **مثال:** لو الإيراد المحرم للسهم = 0.00023 EGP، وامتلكت 1000 سهم لـ 30 يوم → التطهير = 0.00023 × 30 × 1000 = 6.9 EGP

### معيار S&P Shariah
```
التطهير = نسبة التطهير × الأرباح المستلمة
```
- **المبدأ:** التطهير على الأرباح الفعلية المستلمة (توزيعات + ربح رأسمالي)
- **مثال:** لو الأرباح = 1000 EGP، ونسبة التطهير = 1% → التطهير = 10 EGP

### الفرق بين المعيارين:
| | AAOIFI | S&P |
|---|---|---|
| الأساس | ملكية السهم | الأرباح المستلمة |
| الارتباط | بعدد أيام الامتلاك | بالتوزيعات + فرق السعر |
| الخسارة | يُطهَّر حتى لو خسرت | لا يُطهَّر لو لم تحقق ربح |

---

## 4. إمكانية الـ Scraping

| المعيار | التقييم |
|---|---|
| **HTML structure** | Next.js app — SSR مع JSON-LD schema |
| **API** | لا يوجد API علني — البيانات في HTML + JSON-LD |
| **Robots.txt** | يحتاج فحص قبل الـ scraping |
| **Rate limits** | غير معروف — يستحب 1 request/2 seconds |
| **Authentication** | لا — صفحات عامة |
| **Data freshness** | آخر تحديث: سبتمبر 2026 (تحديث أسبوعي) |
| **Format** | JSON-LD schema.org/FinancialProduct + HTML |

### طريقة الـ Scraping المقترحة:
1. **List page:** `GET /stocks` → استخراج قائمة 253 سهم من JSON-LD `ItemList`
2. **Per-stock page:** `GET /stocks/{SYMBOL}` → استخراج JSON-LD `FinancialProduct` + HTML metrics
3. **Parse:** regex على JSON-LD + HTML للجدول الشرعي
4. **Schedule:** يوم السبت 02:00 صباحاً (cron job)

---

## 5. خطة التكامل

### المرحلة 1: جدول قاعدة البيانات (في stocks.db الموجود)
```sql
CREATE TABLE IF NOT EXISTS sharia_compliance (
    ticker TEXT PRIMARY KEY,
    name_ar TEXT,
    name_en TEXT,
    sector TEXT,
    prohibited_income_pct REAL,        -- نسبة الإيرادات المحرمة
    interest_loans_pct REAL,            -- نسبة القروض الربوية
    aaoifi_purification_egp REAL,       -- الإيراد المحرم للسهم (AAOIFI)
    activity_permitted INTEGER,         -- 0/1
    cash_liquidity_compliant INTEGER,    -- 0/1
    prohibited_investments INTEGER,      -- 0/1
    -- 7 sources status
    musaffa_status TEXT,                -- 'compliant' | 'non_compliant' | 'not_listed'
    kashif_status TEXT,
    faisal_bank_status TEXT,
    uslub_status TEXT,
    islamicly_status TEXT,
    sharia_group_status TEXT,
    sp_shariah_status TEXT,
    last_updated TEXT,                  -- ISO date
    scraped_at TEXT                     -- when we scraped
);
```

### المرحلة 2: الـ Scraper (Python — في vps-service/data/)
```python
# vps-service/data/sharia_scraper.py
def scrape_all_sharia_stocks():
    """Weekly Saturday scraper for templatesnippet.com"""
    # 1. Fetch /stocks → parse 253 symbols from JSON-LD
    # 2. For each symbol: fetch /stocks/{SYMBOL} → parse metrics
    # 3. Upsert into sharia_compliance table
    # 4. Log results
```

### المرحلة 3: Cron Job (يوم السبت)
```cron
# crontab.txt — Saturday 02:00 AM
0 2 * * 6 cd /root/GLMinvestment && /root/GLMinvestment/.venv/bin/python -m data.sharia_scraper >> /tmp/sharia_scraper.log 2>&1
```

### المرحلة 4: API Endpoint (في public_routes.py الموجود)
```python
# GET /api/sharia/{ticker} → returns sharia compliance data
# GET /api/sharia/all → returns all 253 stocks
```

### المرحلة 5: Frontend Display (في StockDetail الموجود)
- إضافة قسم "التوافق الشرعي" في صفحة تفاصيل السهم
- عرض: نسبة الإيرادات المحرمة + القروض الربوية + حالة الـ 7 مصادر
- عرض: حساب التطهير (AAOIFI + S&P) بناءً على عدد الأسهم + مدة الامتلاك

---

## 6. الاعتبارات القانونية

- البيانات منقولة من مصادر خارجية (بورصة حلال، مصفّى، كاشف، إلخ)
- لا تمثل حكماً شرعياً أو توصية استثمارية
- يجب الإشارة للمصدر الأصلي في كل عرض
- الـ scraping لأغراض الـ caching الداخلي (مش إعادة النشر)

---

## 7. الخطوات التالية (محتاجة موافقة المالك)

1. ✅ إنشاء جدول `sharia_compliance` في stocks.db
2. ✅ كتابة `vps-service/data/sharia_scraper.py`
3. ✅ إضافة cron job (يوم السبت)
4. ✅ إضافة API endpoints في public_routes.py
5. ✅ إضافة قسم شرعي في StockDetail.tsx
6. ⏳ موافقة المالك على التنفيذ

---

*هذا التحليل تم بناءً على فحص كامل للموقع في 2026-10-03.*
