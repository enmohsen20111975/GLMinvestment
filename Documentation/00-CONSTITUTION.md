# 📜 دستور مشروع GLMinvestment — القواعد الثابتة للعمل

> **هذا الملف هو الدستور.** هو المصدر الوحيد للحقيقة (single source of truth) لحوكمة المشروع:
> القواعد غير القابلة للنقض، الأدوار، ترتيب القراءة، القواعد الذهبية، سير العمل،
> KPIs والحدود الحرجة، سياسة الشخصيات (Personas)، قواعد سلامة قواعد البيانات،
> قواعد حالة التوقعات (prediction-status)، القياس المغلق (closed-loop)، إدارة التوصيات،
> سياسة الـ fundamentals، وسياسة الـ refactoring/الكود الميت.
>
> كل قاعدة هنا ملزمة ولا يجوز تجاوزها لأي سبب إلا بموافقة وتأكيد صريح من المالك
> (`enmohsen20111975`). أي وكيل (Kilo / Grok / Gemini / Z.ai / بشري) يبدأ عمله في
> المشروع **لازم يقرأ هذا الملف أولًا** قبل لمس أي سطر كود.
>
> **آخر تحديث: 2026-09-25** (DOC-CONSOLIDATION pass by Secretary agent: توحيد مرجعي لكل ملفات `Documentation/*.md` غير الأساسية كـ historical archive داخل `01-PROJECT_ANATOMY.md` §17 + تحديث فهرس القواعد لـ 53 قاعدة + تحديث عدّادات الشاشات/الـ APIs/DBs. لم تُحذف أي ملفات.)
> **آخر تحديث سابق: 2026-09-03** (إضافة القاعدة 47 — NEWS-AGENT-INTEGRATION: دمج news repo كـ submodule في news-agent/ + تعطيل RSS/Investing scrapers + دمج 212 خبر. القاعدة 46 — DB-CLEANUP-WAVE-1+2+3: تنظيف شامل لـ DBs — حذف 3 DBs + migration price_history → data_engine.db.egksco_price_history + drop 9 جداول فاضية + VACUUM. توفير ~41.5 MB + 123 سطر كود ميت. 7 DBs بدل 10.) (إضافة القاعدة 45 — SCREENER-FUNDAMENTALS-DEPTH: ربط screener_lists + tab_valuation + tab_profitability + bid/ask بـ V40.2.)
> **آخر تحديث سابق:** 2026-09-03 (القاعدة 45) + 2026-09-02 (القاعدة 44 — NEWS-DB-SOT) + 2026-08-29 (القواعد 27-32: NO-FAKE-DATA + NO-DUPLICATION + UNIFIED-SYSTEM + CLIENT-FACING-STYLE + NO-HYPE-LANGUAGE + CLIENT-VS-SYSTEM + تحديث عهد الوكيل لـ 32 قاعدة)
> **المالك:** `enmohsen20111975` · **المدير والمبرمج:** Z.ai Code (full autonomy)
> **المستودع:** https://github.com/enmohsen20111975/GLMinvestment
> **الإنتاج:** https://invist.m2y.net
>
> 📚 **توحيد التوثيق (2026-08-17):** كل التوثيقات السابقة في `/Documentation/` دُمجت في
> **4 ملفات رئيسية** فقط:
> 1. `Documentation/00-CONSTITUTION.md` (هذا الملف) — الحوكمة والقواعد.
> 2. `Documentation/01-PROJECT_ANATOMY.md` — التشريح الكامل (المعمارية، المحركات، DBs، تدفق البيانات).
> 3. `Documentation/02-SCREENS_AND_COMPONENTS.md` — كل شاشة وكل مكوّن بحالته (نشط/ميت/مكرر).
> 4. `Documentation/SYSTEM_HOW_IT_THINKS.md` — كيف يحلّل النظام سهمًا ويُولّد توصية (المنطق).
>
> أي ملف توثيقي آخر في `/Documentation/` يُعتبر **مرجعًا تاريخيًا** أو سيُحذف من قبل المالك.

---

## 📑 جدول المحتويات

1. [ترتيب قراءة التوثيق (إلزامي)](#-ترتيب-قراءة-التوثيق-إلزامي-قبل-أي-عمل)
2. [الأدوار وجهات الاتصال](#-الأدوار-وجهات-الاتصال)
3. [القواعد المطلقة (لا تُكسر أبدًا)](#-القواعد-المطلقة-لا-تُكسر-أبدًا)
4. [KPIs والحدود الحرجة (Hard Caps)](#-kpis-والحدود-الحرجة-hard-caps)
5. [سياسة الشخصيات (PERSONA-UNIFY-A)](#-سياسة-الشخصيات-persona-unify-a)
6. [قواعد حالة التوقعات (Prediction-Status Taxonomy)](#-قواعد-حالة-التوقعات-prediction-status-taxonomy)
7. [القياس المغلق (Closed-Loop)](#-القياس-المغلق-closed-loop)
8. [إدارة التوصيات (Picks Management)](#-إدارة-التوصيات-picks-management)
9. [سياسة الـ Fundamentals](#-سياسة-الـ-fundamentals)
10. [سلامة قواعد البيانات (DB Safety)](#-سلامة-قواعد-البيانات-db-safety)
11. [أسلوب التفكير المطلوب (7 مبادئ)](#-أسلوب-التفكير-المطلوب)
12. [خطوات سير العمل (Workflow)](#-خطوات-سير-العمل-workflow)
13. [دورة التحديث والإغلاق + الرفع على GitHub](#-دورة-التحديث-والإغلاق--الرفع-على-github)
14. [بنية المشروع (مرجع سريع)](#-بنية-المشروع-مرجع-سريع)
15. [القيود الحرجة المعروفة](#-القيود-الحرجة-المعروفة-حلّها-مُجدوَل)
16. [عهد الوكيل](#-عهد-الوكيل)

---

## 🗂️ ترتيب قراءة التوثيق (إلزامي قبل أي عمل)

عند بداية كل جلسة، **بهذا الترتيب فقط**:

1. **`Documentation/00-CONSTITUTION.md`** (هذا الملف) — الدستور والقواعد.
2. **`Documentation/01-PROJECT_ANATOMY.md`** — التشريح الكامل (المعمارية، المحركات، DBs، تدفق البيانات، الـ 5 Pillars).
3. **`Documentation/02-SCREENS_AND_COMPONENTS.md`** — كل شاشة وكل مكوّن بحالته (نشط/ميت/مكرر).
4. **`Documentation/SYSTEM_HOW_IT_THINKS.md`** — منطق المحرك (Maker State → Flight State → 6 إثباتات → Tech Score → Signal → Portfolio Advice → Stops).
5. **`AGENTS.md`** (جذر المشروع) — دليل سير العمل اليومي (golden rules + runbooks + بيئة الساندبوكس).
6. **`SYSTEM_STATE.md`** (جذر المشروع) — آخر حالة للنظام + سجل الإصلاحات P0-v2 → RL-FIX-9 → R:R-FIX → FUNDAMENTALS-ACTIVATION.
7. **`CHANGELOG.md`** — آخر 3 إدخالات فقط (في الأعلى) لمعرفة آخر التعديلات.
8. **`worklog.md`** — آخر ~150 سطر لمعرفة ما فعله الوكلاء السابقون في هذه الجلسة.

بعد القراءة، اتبع **خطوات سير العمل** في §12، ثم ابدأ. عند الانتهاء، حدّث التوثيق
المتأثر وأرفع على GitHub (§13).

> ⚠️ **ملاحظة توحيدية:** الـ `03-REFACTORING_REPORT.md` القديم دُمج في
> `01-PROJECT_ANATOMY.md` §18.5 + قسم القيود الحرجة في هذا الملف (§15). لا تبحث عنه كملف منفصل.

---

## 📞 الأدوار وجهات الاتصال

| الدور | المسؤول |
|-------|---------|
| **المالك (Owner)** | `enmohsen20111975` (GitHub) — القرار النهائي في كل خلاف، الموافقة على أي استثناء، الموافقة على أي refactoring، الموافقة على أي لمس DB إنتاجي. |
| **المدير + المبرمج (Z.ai Code)** | Full autonomy في التنفيذ اليومي: Fix / Feature / Documentation. Refactor يحتاج موافقة المالك (§12.4). |
| **الوكلاء الآخرون** | Kilo / Grok / Gemini / Z.ai subagents / بشري — كلهم يلتزمون بهذا الدستور دون استثناء. |
| **المستودع الرئيسي** | https://github.com/enmohsen20111975/GLMinvestment |
| **تطبيق Flutter** | https://github.com/enmohsen20111975/flutter_investment_App |
| **الإنتاج (Production VPS)** | https://invist.m2y.net — `/root/GLMinvestment/` — PM2 (nextjs, python-backend, data-engine, ws-service). |
| **الساندبوكس (Sandbox)** | `/home/z/my-project/` — Next.js dev على 3000 + Python على 8010 + Caddy على 81. |

### حدود الصلاحيات

| الإجراء | المالك | Z.ai Code | وكلاء آخرون |
|---------|:-----:|:---------:|:----------:|
| تعديل كود في `src/` أو `vps-service/` | ✅ | ✅ | ❌ (بدون إذن) |
| تعديل DB على الإنتاج | ✅ فقط | ❌ | ❌ |
| استرجاع DB (`restore_from_local.py`) | ✅ بعد موافقة | ⚠️ ينفّذ بعد موافقة المالك فقط | ❌ |
| إنشاء ملف/شاشة/route جديد | ⚠️ طوارئ فقط | ⚠️ طوارئ فقط + توثيق السبب | ❌ |
| Refactoring (حذف كود ميت) | ✅ بعد موافقة | ⚠️ ينفّذ في فرع + مراجعة المالك | ❌ |
| تعديل `00-CONSTITUTION.md` نفسه | ✅ | ⚠️ بعد موافقة المالك + إدخال في `CHANGELOG.md` | ❌ |
| Push على `origin/main` | ✅ | ✅ (بعد `bun run lint` + `tsc --noEmit` يمرّان) | ❌ |

---

## 🚫 القواعد المطلقة (لا تُكسر أبدًا)

هذه القواعد **صارمة ولا يمكن تجاوزها مهما كانت الأسباب** إلا بموافقة وتأكيد من المالك.

> **فهرس القواعد (1–53):** القواعد 1–32 (الأساسية) + 42 (Regime) → بعدها 33–41 (التطويرية) + 43–53 (التوسّعية).
> - **1–8**: قواعد سلامة DBs + المعمارية + HARD cap + ATR + trailing + EXIT_POLICY + overrides + load_merged_history.
> - **9–16**: trailing floor + EXIT_POLICY + overrides + DATA-UNIFY + liquidity + commit-guard + sandbox ≠ prod + VERIFY-BEFORE-DELETE.
> - **17–24**: RELATIVE-PATHS + R:R ≥ 1.5 + loss ceiling + Python=Brain + V40.2 + dedup-by-ticker + PERSONA-UNIFY + fundamentals real.
> - **25–32**: refactoring-gated + SANDBOX-RESET + NO-FAKE-DATA + NO-DUPLICATION + UNIFIED-SYSTEM + CLIENT-FACING-STYLE + NO-HYPE-LANGUAGE + CLIENT-VS-SYSTEM.
> - **33–43**: PRODUCTION-WIRING + NO_DUPLICATE_SCREENS + ENGINE-UNIFY + DISCLOSURE-ENGINE + STRICT-ENTRY + SHORT-HOLDING + DISTRIBUTION-EXIT + NEWS-FETCHER + DOCS-FIRST-LAST + REGIME-AND-AVG-DOWN + TELEGRAM-NOTIFICATIONS.
> - **44–53**: NEWS-DB-SOT + SCREENER-FUNDAMENTALS-DEPTH + DB-CLEANUP-WAVE + NEWS-AGENT-INTEGRATION + FREE-LICENSED-APIs + DUAL-TRACK-PREDICTIONS + MONEY-AS-CUSTOMER-LIFE + MULTI-MARKET-DUAL-TRACK + UNIFIED-REUSABLE-COMPONENTS + CRYPTO-IN-MARKETS.
> القاعدة 42 ظهرت بين 32 و 33 لأسباب تاريخية (تم إدراجها بعد فصل §4 KPIs) لكنها تخص §3.

### القاعدة 1 — لا تُلمس قواعد البيانات على الإنتاج
- **ممنوع** الكتابة في أي `.db` على الإنتاج (`/root/GLMinvestment/db/*.db`).
- **ممنوع** تشغيل `restore_dbs.py` أو أي سكربت يكتب فوق DB إنتاجي.
- **المسموح فقط:** `SELECT` للقراءة، أو الأدوات الـ read-only (`diagnose_db_structure.py`).
- استرجاع DB يكون **فقط** عبر `vps-service/tools/restore_from_local.py` (آمن: نسخة احتياطية + فحص + V40 migration) وبعد تأكيد المالك (§10).
- في الساندبوكس: اسمح بالكتابة في `db/vps_real/` فقط (gitignored، للتجارب على نسخة مستخرجة من zip الإنتاج).

### القاعدة 2 — لا تُلمس ملفات النظام
- **ممنوع** تعديل `.env`, `ecosystem.config.js`, `Caddyfile`, `package.json`, `bun.lock`, `requirements.txt` إلا بموافقة المالك.
- **ممنوع** تعديل `tsconfig.json`, `next.config.js`, `tailwind.config.ts`, `postcss.config.js`.
- **ممنوع** لمس `prisma/schema.prisma` دون موافقة (يؤثر على الإنتاج عبر `db:push`).
- **المسموح:** تعديل ملفات الكود (`.py`, `.tsx`, `.ts`) داخل `src/` و `vps-service/`.

### القاعدة 3 — الالتزام ببنية المشروع
- **لا تُنشئ مجلدات جديدة**. استخدم المجلدات الموجودة (`src/components/<feature>/`, `vps-service/<module>/`).
- **لا تُنشئ طبقات (domain/application/infrastructure) جديدة**. المشروع يستخدم بنية flat حسب `01-PROJECT_ANATOMY.md` §2.
- **لا تُغيّر أسماء الملفات**. الإنتاج والساندبوكس والـ Flutter يعتمدون على المسارات الحالية.
- عند الحاجة لمكان جديد، **اسأل المالك أولًا**.

### القاعدة 4 — لا شاشات/ملفات/أنظمة جديدة إلا في الطوارئ
- **ممنوع** إنشاء `page.tsx` جديد (لدينا 20 صفحة، 9 منها ميتة — انظر `02-SCREENS_AND_COMPONENTS.md`).
- **ممنوع** إنشاء `.tsx` جديد إذا يوجد مكوّن مشابه — وسّعه بدلًا من ذلك.
- **ممنوع** إنشاء `route.ts` جديد إذا يمكن توسيع `/api/proxy/[...path]` أو الـ catch-all الموجود.
- **ممنوع** إنشاء `.py` جديد في `vps-service/` إذا يمكن توسيع ملف موجود.
- **ممنوع** إنشاء Flask blueprint جديد — لدينا 65 ملف API، 33 منها DEPRECATED. وسّع المسجّل منها فقط.
- **الطوارئ فقط:** عطل إنتاجي حرج لا يحله توسيع الموجود — يجب توثيق السبب في `CHANGELOG.md` والحصول على موافقة المالك بعدين.

### القاعدة 5 — كل كود جديد لازم يتربط
- أي دالة/endpoint جديد **لازم يُستخدم فعليًا** (من الباك-إند ← API ← بروكسي ← الواجهة).
- لا تترك كود ميت. لو ضفت حقل، أكد إن الـ API بيرجّعه والـ UI بيعرضه.
- لو ضفت منطق في الباك-إند، اربطه في الـ UI عبر endpoint موجود.

### القاعدة 6 — schema-aware دائمًا (P0-v2)
- أي script/route بقرأ من `predictions.db` **لازم** يفحص الأعمدة بـ `PRAGMA table_info` قبل SELECT.
- استخدم `COALESCE(signal, signal_type, recommendation)` لو محتاج الإشارة.
- الإنتاج بـ يستخدم `signal`/`signal_type` — مش `recommendation`.

### القاعدة 7 — HARD cap على الـ toxic returns (P0-v2 / PERSONA-BALANCE)
- كل KPI query على الصفوف المغلقة لازم فيها:
  `AND (actual_return IS NULL OR ABS(actual_return) <= 50)` في WHERE نفسها.
- يمنع `-10814%` (تجزئة سهم غير مُعدّلة) من تلوث الـ win/loss COUNT والمتوسطات.
- يُطبّق في كل المسارات: `live-tracking/route.ts` (overall + per-persona) + `PredictionTrackingDashboard.tsx::computeStatsFromPredictions` + `core/persona_db.py::get_persona_stats`.

### القاعدة 8 — ATR stop في نطاق [3%, 9%] (PILLAR-3)
- `atr_stop_min_pct=3.0` و `atr_stop_max_pct=9.0` في `engine_settings.py` (مصدر الحقيقة الوحيد).
- تم رفع الـ cap من 7% لـ 9% في PILLAR-3 عشان الأسهم المضاربية المصرية عالية التقلب (HRHO/MFPC/COMI تتحرك 7-9% ATR). الـ 7% القديم كان بـ يـ reject صفقات بـ R/R كويسة.
- الـ stop_loss لكل BUY جديد لازم يكون في النطاق ده. يُطبّق في:
  - `core/opportunity_quality.py::enforce_atr_based_stop` (V40.2 production path).
  - `engines/v38_backtest_engine.py` (ATR clamp بعد استخراج `sl` — defensive, 0 fires on current archive).
- مؤكد بـ `tests/unit/test_regression_settings_consistency.py::TestPillar3AtrStopFromSettings` (ATR_STOP_MAX_PCT == 9.0).

### القاعدة 9 — Trailing stop = FLOOR not CAP (P0-v3)
- في `daily_closer.py`: بعد الـ partial exit، `trailing_stop = max(trailing_stop, entry_price)`.
- الـ trailing بـ يـ ratchet up مع highest وما بـ ينزلش تحت entry.
- `trailing_stop_activation_gain=2.0` (موحّد عبر 4 مستهلكين + 3 اختبارات).

### القاعدة 10 — EXIT_POLICY_MODE = 'partial_1r_trailing' (P0-v3)
- سياسة الخروج الافتراضية: 50% عند 1R (=`partial_exit_at_rr=1.5`) + breakeven + trail الباقي.
- للـ backward compat فقط: `EXIT_POLICY_MODE=fixed`.
- `partial_exit_pct=50.0`, `partial_exit_trail_remaining=1.0`.

### القاعدة 11 — لا overrides إلا عبر `engine_settings.py`
- **مصدر الحقيقة الواحد** للعتبات هو `analyzers/engine_settings.py` (~100 مفتاح).
- **ممنوع** كتابة `tech_score = 50` hardcoded في كود جديد — استخدم `get_setting('tech_score_base', 50)`.
- **ممنوع** كتابة `STOP_LOSS_EGX` dict جديد — اقرأ من `engine_settings`.
- التناقضات الموثّقة سابقًا (في `GAPS_AND_MISSING.md` القديم) تم حل أغلبها في Phase 3 من PERSONA-UNIFY-A: `trailing_stop_activation_gain=2.0` موحّد، `partial_exit_at_rr=1.5` موحّد، `max_stop_pct=9.0` موحّد في `optimizer_params.json` + `optimizer_params_routes.py` DEFAULT_PARAMS + `prediction_optimizer.py` fallback.

### القاعدة 12 — `load_merged_history()` هو المصدر الوحيد لبيانات الأسعار (DATA-UNIFY-007)
- أي محلل جديد **لازم** يستخدم `load_merged_history()` من `analyzers/master_analyzer.py`.
- **ممنوع** القراءة المباشرة من `stock_daily_prices` أو `price_history` (يخلق split-brain).
- الـ Normalization: فلتر egksco + تطبيع migration + `_adjust_for_splits`.

### القاعدة 13 — فلتر السيولة الصارم
- `MIN_TURNOVER_EGP = 500_000` (في `background_analyzer.py`).
- أي سهم turnover يومي < 500K EGP → **يُسقط** من `stored_analyses` نهائيًا.
- في الـ strict mode (V40.2): `kill_filter_min_turnover_egp = 3_000_000` (يُفعّل عبر `set_strict_kill_filters(True)`).

### القاعدة 14 — لا commit قبل التحقق
- **Frontend:** `npx tsc --noEmit -p tsconfig.json` لازم يمر.
- **Backend:** `python3 -c "import vps-service.<module>"` لازم يمر.
- **Lint:** `bun run lint` لازم يمر (تحذيرات مقبولة، أخطاء لا).
- لا ترفع كود مكسور على GitHub.

### القاعدة 15 — الساندبوكس ≠ الإنتاج
- الساندبوكس: `/home/z/my-project/` — Next.js dev على 3000 + Python على 8010 + Caddy على 81.
- الإنتاج: `/root/GLMinvestment/` — PM2 + Next.js + Python + Data-Engine + WS-Service.
- **ممنوع** تشغيل `bun run build` في الساندبوكس (next dev فقط).
- **ممنوع** استخدام `http://localhost:PORT` في كود الواجهة — استخدم مسار نسبي + `XTransformPort`.
- الـ DBs الحقيقية مش كاملة في الساندبوكس — استخدم `db/vps_real/` (مستخرجة من zip الإنتاج).

### القاعدة 16 — تحقّق قبل الحذف (VERIFY-BEFORE-DELETE)
- **ممنوع** تصنيف أي محرك/ملف/route كـ «ميت» أو «DEPRECATED» أو «قابل للحذف» قبل التحقق الثلاثي:
  1. **استدعاءات الواجهة** — ابحث في `src/` عن `fetch('/api/...')` أو `import` للمكوّن.
  2. **تسجيل الـ blueprint** — ابحث في قائمة `BLUEPRINTS` بـ `vps-service/lightweight_server.py` (السطور ~50-83). وجود `register_blueprint()` داخل ملف الـ route **لا يكفي** — لازم يكون مستدعى فعلياً من الخادم.
  3. **سجل الأداء** — اسأل المالك عن نتائج المحرك قبل اقتراح حذفه.
- **القاعدة الذهبية:** إذا وجدت `fetch()` في الواجهة لـ endpoint لكن الـ blueprint غير مسجّل → هذا **BUG يجب إصلاحه (تسجيل الـ blueprint)**، وليس سببًا لحذف الكود.
- **الحالة المرجعية (2026-08-14):** `expert_memory_v4` (V4 = ذاكرة المحلل الشخصية) — الواجهة تستخدمه (`ExpertMemoryPanel` + `TradingMemoryView`) لكن `v4_bp` غير مسجّل → أُسيء تصنيفه كـ «DEPRECATED» وكاد يُحذف. صُحّح في P1.9.
- **⚠️ تمييز مهم:** **V4 ≠ V40**. عندما يقول المالك «V4 كان بيدى أفضل نتائج» فالمقصود هو **V40.2** (محرك التوقعات evidence-based المعمول ببايثون، `jobs/v40_2_daily_generator.py`) وليس `ExpertMemoryV4`. نتائج الـ backtest تؤكد تفوّق V40.2 على V40.1 (profit factor 1.327 vs 1.221، max drawdown 12.4% vs 29.7% — انظر `01-PROJECT_ANATOMY.md` §18). خلط التسميتين كاد يسبب حذف ميزة خاطئة.
- **رفع على GitHub إلزامي بعد كل مهمة** + تشغيل اختبارات الصحة (`bun run lint` + فحص بنية الـ docs) قبل الـ commit.

### القاعدة 17 — المسارات نسبية دائمًا (RELATIVE-PATHS-ONLY)
- **كل المسارات في الكود لازم تكون نسبية** (`db/price_history.db`, `vps-service/data/...`, `src/lib/...`) — **ممنوع** كتابة مسار مطلق مثل `/root/GLMinvestment/...` أو `/home/meme/my_apps/...` أو `C:\Users\...`.
- **السبب:** المشروع يعمل بنفس الأكواد على **ثلاث بيئات**:
  1. **الإنتاج (VPS):** `/root/GLMinvestment/`
  2. **سيرفر المالك المحلى:** `/home/meme/my_apps/GLMinvestment/`
  3. **الساندبوكس:** `/home/z/my-project/`
- أي مسار مطلق = كود ينكسر في بيئتين من الثلاثة. هذا سبب كوارث سابقة (cron entries كانت بتشير إلى `/home/meme/...` على VPS فشل السكربتات).
- **في Python:** استخدم `Path(__file__).resolve().parent.parent` لحساب جذر المشروع ديناميكيًا (انظر `data/prices.py:71` كنموذج). أو استخدم `utils/db_paths.py` إن وُجد.
- **في cron jobs:** استخدم متغير أو استدعِ relative من الـ working directory المحدد في crontab (`cd /path && python ...` مسموح لأنه في الـ crontab نفسه، مش في الكود).
- **الاستثناء الوحيد:** مسار الـ Python binary في crontab (`/root/.venv/bin/python3`) لأنه خاص بالـ OS، مش بالمشروع.

### القاعدة 18 — R:R ديناميكي مع floor إلزامي 1.5 (R:R-FIX — commit `65a748f`)
- **الـ R:R الفعلي للإنتاج هو ديناميكي، NOT ثابت 1.5** (تم إصلاحه في commit `65a748f`):
  - **المسار العادي:** `dynamic_rr_normal = 1.5` (R:R = 1.5).
  - **مسار التفوق على السوق (outperforming benchmark):** `dynamic_rr_outperform = 2.0` (R:R = 2.0 — يُفعّل لو `stock_roc > benchmark_change`).
  - **95.27% من الصفقات** في الأرشيف الحالي تأخذ R:R = 2.0 (السوق يتفوّق في أغلب الأيام).
- **R:R floor gate إلزامي** في `vps-service/jobs/v40_2_daily_generator.py` (lines ~314-326):
  ```python
  if r_mult < get_setting('dynamic_rr_normal', default=1.5):
      continue  # skip — quality gate
  ```
  - يرفض أي توقع R:R < 1.5 **قبل** الكتابة لـ `predictions.db`.
- **مفاتيح `risk_profile` الكنسية** (مما يُرجعه `institutional_decision_engine.py`):
  - `sl` / `tp1` / `tp2` / `rr_ratio_tp1` / `rr_ratio_tp2`.
  - **ممنوع** قراءة المفاتيح القديمة `stop_loss` / `target_1` / `target_2` فقط (key-mismatch bug السابق).
  - `v38_backtest_engine.py` يقرأ المفاتيح الكنسية مع backward-compat fallback للقرارات القديمة.
- **النتيجة المرجعية (archive `active_databases_20260817_full.zip`, 148 صفقة):**
  - BEFORE-RESIM: PF=1.398, Exp=+1.35%/trade.
  - **AFTER-A (dynamic 1.5/2.0): PF=1.453, Exp=+1.54%/trade (+0.055 PF, +0.189% Exp).**
  - Max loss: -7.59% (unchanged — Hard Loss Ceiling intact).
  - ATR clamp fired: 0 trades (defensive — كل الـ stops الحالية ضمن [3%, 9%]).

### القاعدة 19 — Hard Loss Ceiling + Split Guard (PILLAR-3)
- **Hard Loss Ceiling:** `hard_loss_ceiling_pct = 7.0` (in `daily_closer.py::_mark_closed`).
  - كل صفقة BUY مغلقة بـ stop لازم `actual_return >= -7%`.
  - يُفعّل بعد الـ ATR clamp [3%, 9%] — خط دفاع ثاني.
- **Split Guard:** `split_drop_threshold_pct = 35.0`.
  - لو `ABS(actual_return) > 35%` → الصفقة تُستبعد من كل KPI (تجزئة سهم غير مُعدّلة).
  - النتيجة المرجعية: 0 صفقات ضربت الـ Split Guard في archive 20260817.
- **Cap على SELL PnL:** `max(profit_loss, -20.0)` في `daily_closer.py` (منع الشذوذ الرياضي — لا يمكن خسارة أكثر من 100%).
- **ممنوع** رفع `hard_loss_ceiling_pct` فوق 7% أو `split_drop_threshold_pct` فوق 35% بدون موافقة المالك + قياس backtest.

### القاعدة 20 — Python = العقل، Node = العرض فقط
- **كل المنطق الحسابي في Python.** Node.js (Next.js) بـ يعرض فقط.
- **ممنوع** كتابة `if/for/compute/aggregate` في `route.ts` لغير الـ auth/subscription/paywall → ده architecture violation.
- **ممنوع** فحص SQLite مباشرة من Node (3 endpoints فقط تاريخيًا فعلت ذلك — تُصنّف كـ violation).
- **الـ Proxy الافتراضي:** `route.ts` بـ يعمل `fetch(PYTHON_BACKEND + pathname + qs)` ويرجّع JSON فقط.
- لو محتاج logic جديد في الواجهة → ضعه في Python endpoint + استدعِه من Node proxy.

### القاعدة 21 — V40.2 هو مصدر التوقعات الإنتاجي الوحيد (evidence-based)
- **`jobs/v40_2_daily_generator.py`** هو مولّد التوقعات الإنتاجي.
- كل توقع BUY/STRONG_BUY لازم يمرّ بـ:
  1. **Kill Filters** (5 فلاتر استبعاد: سيولة/سعر/تذبذب حجم/بيانات/قوة نسبية) — `liquidity_filter.py::evaluate_kill_filters`.
  2. **6 إثباتات موزونة** (Trend 8 + Makers 26 + DNA 8 + Fundamentals 8 + Sector 8 + Benchmark 24 = 82 وزن كلي) — `institutional_decision_engine.py::build_institutional_decision`.
  3. **R:R ≥ 1.5 floor gate** (القاعدة 18).
  4. **ATR stop clamp [3%, 9%]** (القاعدة 8).
  5. **`morning_bell=1`** لأعلى توقع في اليوم (sort by evidence_count → score).
- **`maestro_orchestrator.py`** مسار منفصل للـ persona_predictions (gambler/investor) — أقل صرامة في الـ evidence. لا يُعتمد عليه للـ overall KPI.
- **ممنوع** توليد توقعات من `MarketScheduler.tick` مباشرة (الطريق القديم `generate_predictions_internal` INSERT خام 15 عمود — لا يمرّ بـ V40.2 evidence).

### القاعدة 22 — KPIs تُحسب بـ dedup-by-ticker (PERSONA-BALANCE)
- **القاعدة الذهبية (المالك):** السهم الواحد = صفقة واحدة حتى لو تكرر بين الثلاث شخصيات.
- التكرار بين الشخصيات = **إشارة أقوى** (أسهم تحت التركيز)، وليس 3 صفقات منفصلة.
- أي حساب WR / PF / Expectancy لازم يكون على مستوى `(ticker, prediction_date)` فريد أولًا، ثم تفصيل حسب الشخصية.
- **أولوية الـ dedup:** `target_hit` > `holding_days` أقل > `master_score` أعلى > `morning_bell` > `evidence_count`.
- الـ overall KPI = العدّاد الرسمي. تفصيل الشخصيات (byPersona) يعرض "تغطية" — مجموع الشخصيات قد يفوق الـ overall وهذا صحيح.
- **HARD cap (القاعدة 7)** مطبّق في كل المسارات (server SQL + client + persona_db).

### القاعدة 23 — لا تعيد تصنيف الشخصيات في `predictions.persona` (PERSONA-UNIFY-A)
- جدول `predictions.persona` **محمي**: `persona='balanced'` ثابت لكل V40.2 picks.
- الـ `persona_fit` (محسوب عبر `compute_persona_fit()` في `v40_2_daily_generator.py`) بـ يُannotated في `kill_filter_result` فقط (رؤية تحليلية).
- للأسهم اللي strongly fit gambler/conservative (fit_score ≥ 50): بـ يُكتب row منفصل في `persona_predictions` من نفس الـ pool القوي + بـ يتـ closed فورًا بالـ outcome المحاكى.
- **ممنوع** إعادة تصنيف `predictions.persona` من `balanced` لـ `gambler`/`conservative` بدون موافقة المالك (يكسر الـ baseline التاريخي ويجعل المقارنات المستقبلية مستحيلة).
- القرار المؤجل: لو المالك وافق → flip الـ persona tag للأسهم اللي fit_score عالي + verify بـ backtest إن جودة المتوازن ما انخفضتش. **حاليًا: الخيار الآمن مُطبّق.**

### القاعدة 24 — Fundamentals: لا placeholder 50 (FUNDAMENTALS-ACTIVATION — commit `04354a5`)
- **`fundamental_score` الحقيقي يُحسب الآن من `data_engine.db`** (مش 50.0 ثابت).
- المصدر: `vps-service/analyzers/fundamental_data_provider.py::get_fundamental_score(ticker)`.
- المكوّنات (4 أوزان):
  - Profitability 40% (roe 20% + net_margin 12% + op_margin 8%).
  - Valuation 30% (pe 18% + pb 12%).
  - Dividend 15% (div_yield + payout penalty).
  - Growth 15% (dps_growth proxy).
- **Missing data handling:** field = None → ذلك المكوّن weight = 0 (excluded من weighted average، NOT forced to 50).
- Confidence = % من المكوّنات المتوفرة.
- **ممنوع** إرجاع `fundamental_score = 50.0` كـ placeholder في أي مسار إنتاجي.
- **mapping success:** 81.8% ticker / 97.4% trade coverage (4 tickers unmatched: EG23X, MTEZ, OCIC, TAO → score=None).
- **Hard veto (مقترح للتفعيل بعد أسبوع حي):** رفض BUY لو `fundamental_score < 30` (يرفع PF +0.273، Exp +0.52% — مُختبَر على 148 صفقة).
- **ممنوع** تفعيل `egx_fundamental_fetcher.py` كـ cron قبل إصلاح `tab_balance_sheet`/`tab_income_statement`/`tab_cash_flow` column-shift bug (الـ `symbol` column بيحمل Arabic names بدل tickers).

### القاعدة 25 — Refactoring يحتاج موافقة المالك + لا حذف بدون VERIFY-BEFORE-DELETE
- أي refactoring (حذف كود ميت، دمج ملفات، إعادة تسمية) لازم يبدأ بـ:
  1. **موافقة صريحة** من المالك.
  2. **قراءة** قسم القيود الحرجة في هذا الملف (§15) + `01-PROJECT_ANATOMY.md` §18.5.
  3. **تنفيذ في فرع منفصل** (`git checkout -b refactor/<name>`).
  4. **اختبار شامل** بعد كل ملف (`bun run lint` + `python3 -c "import ..."`).
  5. **مراجعة المالك** قبل الـ merge.
- **الـ rename refactor ملغى**: لا تُغيّر أسماء ملفات لتحسين القراءة فقط (تنتهك القاعدة 3). حل بديل: وثّق اللبس في `01-PROJECT_ANATOMY.md`.
- الكود الميت يُسجّل في القيود الحرجة (§15)، لا يُحذف إلا بعد VERIFY-BEFORE-DELETE (القاعدة 16).

### القاعدة 26 — الساندبوكس يتعرض لـ RESET دوري (SANDBOX-RESET-SAVEREGUARD)
> **سبب الإضافة:** الساندبوكس (`/home/z/my-project/`) بـ يـ reset دوريًا لآخر snapshot
> من الـ `.initial_snapshot.json` (~الـ 19-22 أغسطس). أي كود/DBs/ملفات **غير مرفوعة على GitHub**
> بتضيع بعد الـ reset. ده حصل فعليًا وفقدنا كود مهم (commit `98cb334c` Volume Surge Hunter)
> + `data/all.zip` (68MB) + كل `db/*.db`. هذه القاعدة تمنع تكرار الكارثة.

- **القاعدة الذهبية:** الساندبوكس ≠ مساحة دائمة. كل شغل **لازم** يبقى على GitHub.
- **قبل أي مهمة (بداية الجلسة):**
  1. `git fetch origin` — اسحب آخر تحديثات GitHub.
  2. `git log origin/main..HEAD --oneline` — شوف هل عندك commits محلية غير مرفوعة.
  3. `git status` — شوف هل عندك ملفات modified مش staged.
  4. لو عندك commits محلية → **push them فورًا** قبل ما تبدأ شغل جديد.
- **أثناء المهمة:**
  - commit كل **1-2 ساعة** (مش في آخر المهمة بس).
  - لو عندك ملفات كبيرة زي `data/all.zip` → احفظها في `/tmp/` كـ backup إضافي.
  - استخدم `git stash` قبل أي عملية خطرة (rebase / merge / pull).
- **قبل أي عملية خطرة (rebase/merge/pull/reset):**
  1. `mkdir -p /tmp/pre-<op>-backup` — أنشئ مجلد backup.
  2. `cp` الملفات المهمة (الـ engine files، الـ scripts، الـ configs).
  3. `git stash` أي تغييرات معلقة.
  4. نفّذ العملية.
  5. لو فشلت → `git rebase --abort` / `git merge --abort` / استعد من `/tmp/`.
- **بعد أي reset مفاجئ للساندبوكس:**
  1. تحقق: `ls data/all.zip` — لو ضاعت، استخرجها من GitHub أو من `/tmp/`.
  2. `git fetch origin` → `git reset --hard origin/main` — رجّع الكود لآخر حالة على GitHub.
  3. استخرج الـ DBs من `data/all.zip` (لو كانت موجودة).
  4. تحقق من الـ worklog آخر إدخال لمعرفة آخر شغل.
  5. أبلغ المالك قبل أي استرداد.
- **لا تعتمد على:**
  - `/tmp/` للـ backup طويل المدى (بيتمسح في الـ reset).
  - `git reflog` (بيتمسح كله بعد الـ reset).
  - أي ملف غير مـ commit على GitHub.
- **DBs مهمة لازم تتـ backup** (قبل أي عملية خطرة):
  - `data/all.zip` (المصدر الكامل — آخر نسخة من GitHub).
  - `db/data_engine.db` (125MB — الأسعار).
  - `db/predictions.db` (التوقعات).
  - `db/stocks.db` (الميتاداتا).
- **الـ workflow الصحيح (بدل المنهجية الخطرة):**
  ```
  1. git fetch origin              ← اعرف آخر تحديث على GitHub
  2. git status                     ← اعرف حالتك المحلية
  3. لو في commits محلية → git push ← ارفع فورًا
  4. اعمل backup في /tmp/           ← للملفات المهمة
  5. git rebase origin/main         ← ابنِ فوق آخر تحديث
  6. اعمل المهمة
  7. git commit كل ساعة            ← مش في الآخر بس
  8. git push origin main           ← ارفع فورًا بعد كل commit
  ```
- **تحذير صريح:** لو ضاع كود بسبب عدم اتباع هذه القاعدة، المسؤولية على الوكيل.
  الـ sandbox بـ reset بشكل دوري. الـ GitHub هو المصدر الوحيد للحقيقة الدائمة.

### القاعدة 27 — لا بيانات كاذبة أو أرقام للحشو (NO-FAKE-DATA — 2026-08-29)
> **سبب الإضافة:** توجيه صريح من المالك (2026-08-29): "لايمكن أبدا بالسماح بأى بيانات كاذبة أو ارقام لمجرد الحشو لازم كل حاجة تكون سليمة". هذا مشروع فلوس حقيقي — المستثمرون بيتخذون قرارات مالية بناءً على هذه البيانات. أي بيانات كاذبة = مسؤولية قانونية.

- **ممنوع منعاً باتاً** إرجاع أي من التالي من أي API route (frontend أو backend):
  - `Math.random()` لتوليد أسعار/أرباح/خسائر/نسب
  - `random.randint()` / `random.choice()` لتوليد إحصائات/توصيات/تقييمات
  - بيانات mock / dummy / stub لأي عرض إنتاجي
  - أرقام ثابتة (مثل `50.0`) كـ placeholder لحقول يجب أن تكون حقيقية (مثل `fundamental_score`)
- **الاستثناء الوحيد:** بيانات simulation واضحة للمستخدم (SimulationView، CryptoSimulationView) — يجب أن يُشار بوضوح أنها محاكاة.
- **الـ seed routes** (`/api/seed-experts`، `/api/predictions/seed`، `/api/community/seed`، `/api/market/seed-historical`) معطّلة (410 Gone) — ممنوع إعادة تفعيلها.
- **عقوبة المخالفة:** أي route يُكتشف فيه بيانات كاذبة يُعطّل فوراً + يُوثّق في `Documentation/audit-logs/` + يُصلح في جلسة منفصلة.
- **المرجع:** commit `16184d54` (security: remove ALL random/fake data) — 8 مصادر عشوائية اتمسحت.

### القاعدة 28 — لا تكرار شاشات/تبويبات/أكواد (NO-DUPLICATION — 2026-08-29)
> **سبب الإضافة:** توجيه صريح من المالك (2026-08-29): "غير مسموح ابدا بتكرار الشاشات والتبويبات والأكواد وعمل اتداخل الرهيب الى موجود فى المشروع دة".

- **ممنوع** إنشاء شاشة/تبويب جديد بنفس وظيفة شاشة/تبويب موجود. لو محتاج ميزة موجودة → وسّع الموجود (القاعدة 4).
- **ممنوع** وجود أكثر من endpoint لنفس الوظيفة. لو فيه تكرار → وحد على Python endpoint واحد + احذف الباقي (بموافقة المالك + Rule 25).
- **ممنوع** وجود نفس logic في Node + Python (مثل حساب relative_strength في مكانين). كل logic في Python (Rule 20).
- **الأنظمة المتوازية الموجودة** (تحتاج توحيد بمراحل):
  1. 3 أنظمة تتبع توقعات (`/api/predictions/tracking/*` + `/api/predictions/honest-tracking/*` + `/api/stored-analysis/live-tracking`) → توحيد على `live-tracking`.
  2. 4 endpoints لتحليل سهم واحد → توحيد على 2 Python proxies.
  3. 4 catch-all proxies (`/api/[...slug]` + `/api/proxy/*` + `/api/python/*` + `/api/telegram/*`) → توحيد على `/api/proxy/[...path]`.
- **قبل أي ميزة جديدة:** اسأل "هل فيه شاشة/endpoint موجود بـ يعمل ده؟" (Grep في `src/` + `vps-service/`). لو نعم → وسّع. لو لا → اطلب موافقة المالك.
- **المرجع:** تقرير `CONSTITUTION-VIOLATIONS-AUDIT` (worklog.md) — 8 حالات تكرار بـ ~12,000 LOC.

### القاعدة 29 — نظام متكامل واحد (UNIFIED-SYSTEM — 2026-08-29)
> **سبب الإضافة:** توجيه صريح من المالك (2026-08-29): "احنا مش بنعمل موديولات منفصلة ولاأكواد فوق بعض مش مرتببطة ببعضها احنا بنعمل نظام كامل متكامل".

- **النظام = وحدة واحدة.** كل ملف/مكوّن/endpoint لازم يكون **مرتبط + مستخدم** فعلاً (القاعدة 5).
- **ممنوع** إنشاء "موديولات منفصلة" — أي ميزة جديدة لازم تتكامل مع النظام الموجود:
  - frontend component → مستورد في page.tsx أو مكوّن موجود
  - API route → مستدعى من frontend component
  - Python endpoint → مسجّل blueprint في lightweight_server.py + مستدعى من Node proxy
  - Python analyzer → مستورد في master_analyzer أو maestro_orchestrator أو V40.2 generator
- **مكدس Node موازي ممنوع:** `src/lib/v2/` (30 ملف، 21,154 LOC) يحتوي على maestro-orchestrator + momentum + unified-scoring + recommendation — هذا مكدس Node كامل **موازي** للـ Python. يُحذف بالتدريج (بموافقة المالك) بعد نقل الـ logic للـ Python.
- **أي ملف غير مستخدم** = كود ميت (Rule 16 + Rule 25) → يُسجّل في القيود الحرجة (§15) ثم يُحذف بعد VERIFY-BEFORE-DELETE.
- **المرجع:** تقرير `CONSTITUTION-VIOLATIONS-AUDIT` — 8 مجموعات كود ميت بـ ~50,000 LOC.

### القاعدة 30 — الشاشات للعميل بأسلوب احترافي (CLIENT-FACING-STYLE — 2026-08-29)
> **سبب الإضافة:** توجيه صريح من المالك (2026-08-29): "الشاشات كلها بدون استثناء عدا شاشة الأدمن موجهه للعميل ولازم كل حاجة فيها تاخد أسلوب التعامل مع العميل".

- **كل الشاشات (عدا `/#admin`)** موجهة للعميل المستثمر. أسلوبها لازم:
  - احترافي ووقور (مناسب لمستثمرين فرادى)
  - واضح ومباشر (لا حشو، لا تزيين)
  - عربي فصيح (اللهجة المصرية مسموحة في الـ tooltips/الرسائل القصيرة بس)
- **ممنوع** في شاشات العميل:
  - عبارات تحميسية (`🚀 انطلق!`، `🎉 ربحت!`، `💰 فلوس كتير!`)
  - إيموجي زائد عن الحد (الإيموجي الوظيفي مسموح: 🎯 لـ target، ⚡ لـ volume_surge، 🔥 لـ hot sector — لكن مش كـ زينة)
  - أرقام مبالغ فيها بدون سياق (`+2269%` بدون توضيح أنه backtest)
- **مسموح** في شاشات العميل:
  - badges واضحة (ألوان + نصوص عربي)
  - sparklines مصغرة (وظيفية)
  - tables منظمة (sortable/filterable)
  - tooltips تشرح المصطلحات
- **شاشة الأدمن (`/#admin`)** فقط يمكنها أسلوب تقني (debug info، raw numbers، technical jargon) — لأنها للمدير/المبرمج.
- **المرجع:** تقرير `CONSTITUTION-VIOLATIONS-AUDIT` — 0 مخالفات أسلوب في الـ views الحالية (الإيموجي وظيفي).

### القاعدة 31 — لا عبارات تحميسية (NO-HYPE-LANGUAGE — 2026-08-29)
> **سبب الإضافة:** توجيه صريح من المالك (2026-08-29): "لاتستخدم عبارات التحميسية الشدشة بتاعت AI انت بتتعامل مع ناس مستثمرين فراعى أسلوب كلامك".

- **أسلوب التواصل مع العميل:** احترافي، وقور، مباشر. العميل مستثمر — مش طفل بـ يحتاج تشجيع.
- **ممنوع** في أي نص يراه العميل (UI، tooltips، messages، notifications):
  - "🚀 حقق أحلامك!" / "💰 كن ثرياً!" / "🎯 اضمن نجاحك!"
  - "انطلق في رحلتك الاستثمارية" / "كن بطلاً في البورصة"
  - أي عبارة تشبه إعلانات الـ AI hype
- **المسموح:**
  - "تتبع القطاعات" (وصف وظيفي)
  - "أعلى الأرباح والخسائر" (وصف محايد)
  - "فلاتر الأسهم" (وصف وظيفي)
  - "حالة السهم: في تصحيح" (وصف فني محايد)
- **الـ agent (Z.ai Code)** يتحدث مع المالك بأسلوب مهني مباشر — لا تحميس، لا وعود، لا مبالغة. يقدم الحقائق + الأرقام + المخاطر بوضوح.
- **المرجع:** توجيهات المالك في `Documentation/handOver.text` (2026-08-29).

### القاعدة 32 — فصل واضح بين عرض العميل و logic النظام (CLIENT-VS-SYSTEM — 2026-08-29)
> **سبب الإضافة:** توجيه صريح من المالك (2026-08-29): "فية فارق رهيب بين الى هاتعملة للعميل والى هاتعملة للنظام".

- **عرض العميل (frontend):** بيانات حقيقية + واضحة + قابلة للفهم. العميل يشوف:
  - توصيات (signal + entry + target + stop + R:R)
  - أداء (WR + PF + Net — بدون مبالغة)
  - تحليل (sector heat + momentum + correction status)
  - محفظته (holdings + P&L حقيقي)
- **logic النظام (Python backend):** محرك معقد + دقيق + آمن. النظام بـ يعمل:
  - توليد توقعات (V40.2 evidence-based)
  - حسابات فنية (RSI/MACD/ATR/SMC/VSA/flow)
  - إدارة مخاطر (kill filters + R:R gate + ATR clamp + hard loss ceiling)
  - تعلم ذاتي (closed-loop + lessons)
  - إغلاق صفقات (daily_closer + exit logic)
- **الـ Node (frontend API routes):** مجرد proxy. ينقل البيانات من Python → العميل. لا logic، لا حسابات، لا قرارات (Rule 20).
- **ممنوع** خلط الاثنين:
  - لا logic تداولي في frontend (يخدش Rule 20)
  - لا بيانات كاذبة في عرض العميل (يخدش Rule 27)
  - لا أسلوب تقني في شاشات العميل (يخدش Rule 30)
- **المرجع:** `Documentation/handOver.text` + `01-PROJECT_ANATOMY.md` §1 (المعمارية الرباعية).

### القاعدة 42 — فلتر الـ Regime إلزامي + المتوسط السعري الذكي (REGIME-AND-AVG-DOWN — 2026-09-02)
> **سبب الإضافة:** توجيه المالك (2026-09-02): "السوق المصري نزوله حاد كتير بيبقى Liquidity Grab من الصناع وبعدين انفجار سعري. عايزين فلتر اتجاه قوي + تعريف كمي لفرصة المتوسط السعري الذكي، مش الأعمى."

**أ. فلتر الـ Regime (إلزامي على إشارات BUY):**
- **المُطبِّق:** `vps-service/analyzers/regime_filter.py::passes_regime_filter()`.
- **النسختان المدعومتان:**
  - `mode='A'` (افتراضي للإنتاج): `Close > SMA50` (اتجاه صحي متوسط المدى).
  - `mode='B'` (للأبحاث/الإنتاج المستقبلي): `Close > SMA20 AND Close > SMA50` (تأكيد مزدوج).
- **التكامل:** خلف feature flag `V40_2_REGIME_FILTER` (default OFF حتى اكتمال walk-forward). عند التفعيل، يُطبَّق كـ pre-filter في `evaluate_strict_entry()` (قبل is_late / is_grab).
- **النتائج الموثقة (19 شهر، 442 سهم EGX):**
  - `Correction [B]` = الأفضل جودة (PF 18.54، DD -2.59%، 5 صفقات فقط).
  - `Merged-Strict [B]` = الأفضل عائداً (+1594.91%، DD -24.8%، 130 صفقة).
  - `Merged [الساذج]` مرفوض في كل الحالات حتى مع regime filter.
  - `Chase` مرفوض دائماً (DD -66% حتى مع regime) — المشكلة في طبيعته مش في الفلتر.

**ب. المتوسط السعري الذكي (Average Down):**
- **المُطبِّق:** `vps-service/analyzers/strict_entry_filters.py::evaluate_average_down()`.
- **الشروط الكمية الصارمة (قابلة للقياس):**
  1. السهم كسر قاع سابق بنسبة بين 3% و 8% (`AVG_DOWN_BREAK_MIN_PCT=3.0`, `AVG_DOWN_BREAK_MAX_PCT=8.0`).
  2. حجم شمعة الكسر أعلى من متوسط الحجم 20 يوم (`AVG_DOWN_VOL_RATIO_MIN=1.1`).
  3. خلال 1-3 أيام يرجع السعر فوق الدعم وفوق منتصف شمعة الكسر (`AVG_DOWN_RECOVERY_DAYS=3`).
  4. السعر قريب من SMA50 (within 8% — `AVG_DOWN_PROXIMITY_TO_SMA50=8.0`).
  5. مفيش Change of Character هابط واضح (no 3 consecutive lower-lows + lower-highs).
- **قواعد صارمة (hard rules — لا تُكسر):**
  - الستوب يفضل موجود. المتوسط مش بديل للستوب، هو قرار إضافي.
  - المتوسط مرة واحدة فقط كحد أقصى (`already_averaged` flag).
  - حجم المتوسط = 50% من الصفقة الأصلية (`AVG_DOWN_SIZE_PCT=50.0`).
  - الـ stop الأصلي يظل كما هو — ممنوع التوسيع بحجة "صانع سوق".
- **النتيجة الموثقة (Phase 2):** في backtest 19 شهر، لم يطلق Average Down أبداً (avg_used=0) لأن الشروط نادراً ما تتحقق أثناء holding مفتوح. هذا **سلوك مقبول** — الـ Average Down الذكي نادر، والـ Average Down الأعمى ممنوع.

**ج. قاعدة الرفض الإلزامية:** أي نسخة من الـ strategies بـ Max Drawdown > 25% تُرفض للإنتاج حتى لو كان العائد أعلى (توجيه المالك 2026-09-02).

- **المرجع:** `Documentation/01-PROJECT_ANATOMY.md` §"Regime Filter + Average Down Logic" + `data/merge_backtest_real/phase1_regime_results.json` + `phase2_avg_down_results.json`.

---

## 📊 KPIs والحدود الحرجة (Hard Caps)

> **المرجع:** `01-PROJECT_ANATOMY.md` §1 (نظرة عامة) + `SYSTEM_HOW_IT_THINKS.md` §17 (الـ 5 Pillars).

### الأهداف الإلزامية (Targets)

| KPI | القيمة الحالية (archive 20260817) | الهدف | الحالة |
|-----|----------------------------------:|------:|:------:|
| **Total Trades (backtest)** | 539 | 60-150 | ✅ تجاوز |
| **Win Rate (backtest)** | 51.0% | ≥ 50% | ✅ |
| **Profit Factor (backtest)** | 1.584 | ≥ 1.5 | ✅ |
| **Win Rate (live production)** | ~69.2% (تقارير المالك 2026-08-17) | ≥ 60% | ✅ |
| **PF (live production)** | ~4.46 | ≥ 1.5 | ✅ |
| **Avg Win** | +8.30% → +11.44% (AFTER-A dynamic) | — | — |
| **Avg Loss** | -6.00% (capped) | within [-9%, -3%] | ✅ |
| **Max Loss (capped)** | -7.59% (raw) → ≤ -7% (after Hard Loss Ceiling) | ≤ -7% | ✅ |
| **Max Gain** | +50.0% (HARD cap applied) | — | — |
| **Expectancy / trade** | +1.54% (AFTER-A dynamic 1.5/2.0) | > 0 | ✅ |

### الـ Hard Caps (لا تُتجاوز)

| الحد | القيمة | الملف | السبب |
|------|-------:|------|-------|
| `ABS(actual_return)` | ≤ 50 | كل KPI queries | منع toxic returns من تلوث المتوسطات (Rule 7) |
| `hard_loss_ceiling_pct` | 7.0% | `daily_closer.py` | سقف الخسارة الأقصى لكل صفقة (Rule 19) |
| `split_drop_threshold_pct` | 35.0% | `daily_closer.py` | تجزئة سهم → استبعاد كامل (Rule 19) |
| `atr_stop_min_pct` | 3.0% | `engine_settings.py` | الحد الأدنى للـ stop (commission edge) (Rule 8) |
| `atr_stop_max_pct` | 9.0% | `engine_settings.py` | الحد الأقصى للـ stop (risk ceiling) (Rule 8) |
| `dynamic_rr_normal` | 1.5 | `engine_settings.py` | R:R floor إلزامي (Rule 18) |
| `dynamic_rr_outperform` | 2.0 | `engine_settings.py` | R:R للأسهم المتفوقة على المؤشر (Rule 18) |
| `MIN_TURNOVER_EGP` | 500,000 | `background_analyzer.py` | فلتر السيولة (Rule 13) |
| `kill_filter_min_turnover_egp` | 3,000,000 | `liquidity_filter.py` (strict) | V40.2 strict mode (Rule 13) |
| `MAX_PREDICTIONS_PER_DAY` | 7 (legacy) / 5 (picks-management) | `historical_prediction_generator.py` / `confidence_engine.py` | حد التوصيات اليومية (Rule §8) |
| `MIN_PREDICTIONS_PER_DAY` | 2 | `historical_prediction_generator.py` | الحد الأدنى لليوم الواحد |
| `MONITORING_PERIOD_DAYS` | 30 | `historical_prediction_generator.py` | أفق التوقع الافتراضي |
| `trailing_stop_activation_gain` | 2.0 | `engine_settings.py` | موحّد (Rule 9) |
| `partial_exit_at_rr` | 1.5 | `engine_settings.py` | بيع 50% عند 1.5R + breakeven (Rule 10) |
| `partial_exit_pct` | 50.0 | `engine_settings.py` | نسبة الخروج الجزئي (Rule 10) |
| `min_score` | 60 | `engine_settings.py` (V40-PHASE-4) | حد القبول الإنتاجي |
| `max_holding_days` | 30 | `engine_settings.py` | أقصى مدة احتفاظ (V40.2) |
| `breakeven_trigger` | 7% | `stop_manager.py` | تفعيل break-even |
| `portfolio_heat` | 2% | `stop_manager.py` | أقصى خسارة لكل صفقة من المحفظة |

### الـ Market Weights (ثابتة)

| السوق | الكود | الوزن | رمز |
|-------|------|------|------|
| تداول السعودية | KSA | 1.5 | 🇸🇦 |
| البورصة المصرية | EGX | 1.2 | 🏛️ |
| بورصة الكويت | KSE | 0.8 | 🇰🇼 |
| بورصة قطر | QSE | 0.6 | 🇶🇦 |
| العملات الرقمية | CRYPTO | 0.5 | ₿ |

---

## 🎭 سياسة الشخصيات (PERSONA-UNIFY-A)

> **المرجع التفصيلي:** `SYSTEM_HOW_IT_THINKS.md` §19.

### الـ 3 شخصيات الحالية (لا تُعيد تصنيفها)

| Persona | Arabic | min_score | target_mult | stop_mult | strategy | min_hold_days |
|---------|--------|----------:|------------:|----------:|----------|---------------|
| **gambler** | المضارب | 42 | 2.0x | 1.2x | scalp_short | 1 |
| **balanced** | المتوازن | 50 | 2.2x | 1.0x | swing_medium | 5 |
| **conservative** | المستثمر | 55 | 2.5x | 1.0x | swing_medium_long | 10 |

> ⚠️ ملاحظة تاريخية: قائمة الـ personas في الـ code تذكر أحيانًا `expert` (شخصية رابعة تجريبية)، لكن في الإنتاج الفعلي `predictions.persona` ∈ {`balanced`, `gambler`, `conservative`} فقط. أي إشارة لـ `expert` هي legacy ولم تُفعّل.

### مصفوفة أوزان الشخصيات (PERSONA_INPUT_WEIGHTS)

| Persona | Price Action | SMC/VSA | Sector Heat | Fundamental |
|---------|-------------:|--------:|------------:|------------:|
| **Gambler** | 40% | 35% | 25% | 0% |
| **Balanced** | 30% | 25% | 20% | 25% |
| **Conservative** | 15% | 10% | 15% | 60% |

- المصدر: `vps-service/analyzers/adaptive_weights.py::PERSONA_INPUT_WEIGHTS`.
- نفس input vector بـ يطلع score=71.5 للـ gambler و 58.0 للـ conservative (فجوة 13.5 نقطة) — يدل على أن الأوزان فعّالة.

### مسارا التوليد

| المسار | المولّد | persona المكتوبة | الجودة |
|--------|---------|------------------|--------|
| **V40.2 evidence-based** | `jobs/v40_2_daily_generator.py` | `balanced` فقط | عالية — 6 إثباتات + kill filters + R:R≥1.5. **~69% WR حيًا** |
| **Maestro persona** | `analyzers/maestro_orchestrator.py` → `core/persona_db.py` | `gambler` + `investor` | مسار منفصل، أقل صرامة في الـ evidence |

### قاعدة حماية الـ Baseline (PERSONA-UNIFY-A — 2026-08-17)

1. **جدول `predictions` (مصدر الـ live dashboard) لم يُلمس** — `persona='balanced'` ثابت لكل V40.2 picks.
2. **جدول `persona_predictions` منفصل** — لا يقرأه الـ live dashboard overall KPI.
3. **الـ overall KPI محمي بالـ dedup-by-ticker** (Rule 22) — السهم الواحد = صفقة واحدة.
4. **مفيش orphan PENDING rows** — كل `persona_predictions` row بـ يتـ closed فورًا بالـ outcome المحاكى من V40.2 (`update_persona_prediction_outcome`).
5. **HARD cap (Rule 7)** مطبّق على `get_persona_stats` في `persona_db.py`.

---

## 🚦 قواعد حالة التوقعات (Prediction-Status Taxonomy)

> **المرجع التفصيلي:** `RL-FIX-9-Predictions-Status-Logic.md` (مُدمج هنا).

### الـ 5 حالات رسمية

| الحالة (status) | exit_type | hit_target | hit_stop | is_correct | المعنى | اللون |
|------------------|-----------|:----------:|:--------:|:----------:|----------------|--------|
| `TARGET_HIT` | `target_hit` | 1 | 0 | 1 | ✅ تم تحقيق الهدف | أخضر |
| `TRAILING_PROFIT` | `trailing_profit` | 0 | 0 | 1 | 💰 خرج بربح قبل الهدف | زمردی |
| `STOPPED` | `stop_loss` / `trailing_stop` | 0 | 1 | 0 | ❌ ضرب وقف | أحمر |
| `EXPIRED` | `expired` | 0 | 0 | 0 | ⌛ انتهت المدة | رمادي |
| `PENDING` | (NULL) | 0 | 0 | NULL | ⏳ لسه معلقة | كهرمانی |

### قواعد الانتقال (Transition Rules)

1. **لا `STOPPED` مع `actual_return > 0`** — لو الـ trailing stop خرج بربح → صنّفه `TRAILING_PROFIT` (not `STOPPED`).
2. **لا `PENDING` مع `actual_return`** — لو `outcome_date IS NULL` → `actual_return` لازم يكون NULL (ممنوع نحسبه من `exit_price`).
3. **لا `WIN` في API بدون `outcome_date`** — كل WIN لازم يكون له `outcome_date IS NOT NULL` (Rule §7 Closed-Loop).
4. **`is_correct` مشتق من `exit_type`** — `target_hit → 1`, `stop_loss → 0`. ممنوع نسمّي ضربة وقف "win".
5. **الـ SELL sign-flip إلزامي** في كل المسارات: `(entry - exit) / entry × 100` (مش `(exit - entry) / entry × 100`).
6. **`highest_price_reached` + `lowest_price_reached`** لازم تكون قيم فعلية (مش 0.0) — لو EXPIRED بدون بيانات، استخدم `entry_price` كـ fallback.
7. **الـ migration script** `vps-service/scripts/rl_fix_9_migrate_bad_rows.py` يُشغّل مرة واحدة بعد أي restore لإصلاح الصفوف التاريخية.

### أوامر التحقق (Post-Restore)

```sql
-- 1. لا STOPPED + profit
SELECT COUNT(*) FROM predictions WHERE hit_stop = 1 AND actual_return > 0;  -- == 0
-- 2. لا PENDING + return
SELECT COUNT(*) FROM predictions WHERE outcome_date IS NULL AND actual_return IS NOT NULL;  -- == 0
-- 3. تنوع التواريخ
SELECT COUNT(DISTINCT date(prediction_date)) FROM predictions WHERE date(prediction_date) >= '2026-01-01';  -- > 1
-- 4. TRAILING_PROFIT موجود
SELECT COUNT(*) FROM predictions WHERE exit_type = 'trailing_profit';  -- > 0 (post-migration)
```

---

## 🔁 القياس المغلق (Closed-Loop)

> **المرجع التفصيلي:** `CLOSED_LOOP_FINAL.md` (مُدمج هنا).
> **التعريف:** كل توصية مفتوحة تُراجع دورياً بالسعر الحي وتُقفل عند الهدف/الوقف/انتهاء الأفق مع درس.
> الدروس تُقرأ في التحليل التالي وتعدّل شروط الشخصية ضمن حدود، مع قياس على `/live-tracking`.
> **التسجيل وحده دون قراءة وتأثير = غير مقبول كـ closed loop.**

### الـ 4 ملفات المعتمدة (Closed-Loop Chain)

| # | الملف | الدور |
|---|------|------|
| 1 | `vps-service/utils/live_price.py` | مصدر السعر الموحّد: `get_live_price` (intraday → data_engine → fallback). |
| 2 | `vps-service/analyzers/maestro_orchestrator.py` | العقل: `run_expert_memory_phase` يقرأ الدروس → `applied_lesson` (توسيع وقف مسقوف) → `record_prediction` يكتب التوقع بـ persona حقيقية. |
| 3 | `vps-service/jobs/daily_closer.py` | الإغلاق الآلي: يقفل على سعر التفعيل (target/stop) + `is_correct` من `exit_type` + `record_lesson_from_close` + `detect_and_record_missed_opportunities`. |
| 4 | `vps-service/utils/lesson_store.py` | ذاكرة الدروس: `record_lesson_from_close` يصنّف (STOP_TOO_TIGHT / TARGET_HIT_OK / LATE_MOMENTUM / MISSED_BREAKOUT) → `get_persona_lesson_summary` / `get_ticker_lesson_summary` يقرأها المايسترو. |

### قواعد الـ Closed-Loop

1. **Python = العقل · Node = عرض فقط.** لا WIN/LOSS نهائي بدون `outcome_date`.
2. **الإغلاق على سعر التفعيل** (مش سعر `close`):
   - `TARGET_HIT` → exit عند `target_price` (limit order).
   - `STOPPED` → exit عند `stop_loss` (stop order).
   - `SELL` → `return = (entry - trigger) / entry × 100` (direction-aware).
3. **التعلّم الفعّال المسقوف:** لو `STOP_TOO_TIGHT ≥2` (سهم) أو `≥3` (شخصية) → `stop_widen_atr = min(0.5, n×0.15)` ATR.
   - BUY: `stop_loss -= widen`، سقف: `entry×0.85` + 50% من المخاطرة الأصلية.
   - SELL: `stop_loss += widen`، سقف: `entry×1.15` + 50%.
   - إعادة حساب RR + log: `[LEARNING] applied_lesson: widen_stop +0.45ATR (STOP_TOO_TIGHT 3x on X) stop 95.0->94.1 RR 2.0->1.69`.
4. **الأتمتة (A1/A2):**
   - `MarketScheduler.tick()` يستدعي `run_daily_closer()` كل 15 دقيقة (3 مسارات: paused/intraday/post-market).
   - `vps-service/scripts/setup_cron.sh` يركّب cron يومي 14:35 Cairo Sun-Thu (belt-and-suspenders).
5. **تعريف "التعلّم شغّال وفعّال"** (بعد أسبوع تشغيل آلي):
   - دروس جديدة يومياً (`lessons` يزيد).
   - `[LEARNING]` يظهر على أسهم لها تاريخ.
   - `applied_lesson` يظهر عند تكرار STOP_TOO_TIGHT.
   - بدون ذلك: النظام **يسجّل** ولا **يتعلّم** — يعني الـ closed loop مكسور.

---

## 🎯 إدارة التوصيات (Picks Management)

> **المرجع التفصيلي:** `PICKS-MANAGEMENT-SYSTEM.md` (مُدمج هنا).
> **Task ID الأصلي:** PICKS-MGMT-v3.4.43.

### الـ 4 tiers للثقة (Confidence Engine)

| Tier | النطاق | اللون | الإجراء |
|------|--------|-------|---------|
| 🥇 **TOP_PICK** | ≥ 80% | ذهبي | اختيار فوري (أولوية قصوى) |
| 🟢 **STRONG** | 65-79% | أخضر | اختيار إذا توفرت فرصة |
| 🟡 **WATCH** | 50-64% | أصفر | مراقبة فقط (لا اختيار) |
| 🔴 **SKIP** | < 50% | أحمر | تجاهل تام |

### قواعد إدارة التوصيات

1. **Daily Cap = 5 توصيات/يوم** (NON-NEGOTIABLE — طلب المالك المباشر).
2. **`min_confidence = 65%`** افتراضيًا (للظهور في قائمة اليوم).
3. **منع التكرار:** نفس السهم لا يتكرر في نفس اليوم — `seen_tickers` set في `select_top_picks()`.
4. **الترتيب:** بالثقة تنازليًا (confidence desc).
5. **7 عوامل حساب الثقة** (وزن 30/15/15/15/10/10/5):
   - Technical Score 30% + Trend Strength 15% + Volume Confirmation 15% + R/R Ratio 15% + Volatility (ATR) 10% + Explosive Signal 10% + Data Quality 5%.
6. **7 توصيات إدارة المراكز** (Position Manager):
   - HOLD ⏳ / TRAILING_STOP 📈 / TAKE_PROFIT_T1 💰 / TAKE_PROFIT_T2 💎 / ADD ➕ / REDUCE ⚠️ / EXIT 🛑.
7. **3 مستويات إلحاح (urgency):** high / medium / low.

### الـ API Endpoints (5)

| Endpoint | الوظيفة |
|----------|---------|
| `GET /api/predictions/daily-picks?date=&max_picks=5&min_confidence=65` | أعلى 5 توصيات لليوم |
| `GET /api/predictions/daily-picks/history?days=7` | آخر N أيام |
| `GET /api/predictions/active-management?urgency=high` | إدارة كل المراكز المفتوحة |
| `GET /api/predictions/{id}/management?entry_price=&entry_qty=` | إدارة مركز واحد |
| `POST /api/predictions/management/refresh` | إعادة حساب (admin) |

---

## 💰 سياسة الـ Fundamentals

> **المرجع التفصيلي:** `FUNDAMENTALS_HISTORICAL_TEST_REPORT.md` + `DATA_ENGINE_FUNDAMENTALS_INVENTORY.md` (مُدمجين هنا).

### القاعدة الأساسية

- **`fundamental_score` الحقيقي 0-100** من 4 جداول نظيفة في `data_engine.db`:
  - `tab_valuation` (pe, pb, peg, ps, ev_ebitda).
  - `tab_profitability` (roe, roa, net_margin, gross_margin, operating_margin).
  - `tab_dividends` (div_yield, payout, dps_growth).
  - `tab_technical_analysis` (technical_rating, rsi, macd, adx, atr).
- **الجداول المكسورة (لا تُستخدم حتى الإصلاح):** `tab_balance_sheet` / `tab_income_statement` / `tab_cash_flow` (column-shift bug — `symbol` column يحمل Arabic names).
- **الجدول الفارغ:** `egx_fundamentals` (0 rows — fetcher غير مُجدول).

### قواعد السياسة

1. **لا placeholder 50** (Rule 24) — أي مسار إنتاجي لازم يحسب الـ score الحقيقي.
2. **Missing data → weight 0** (مش forced to 50) — التقييم يعكس البيانات المتاحة فقط.
3. **Resolver strategy** (no guessing):
   - Exact match على `tab_valuation.symbol` (numeric Saudi tickers: 1030, 1120...).
   - Prefix match `symbol LIKE 'TICKER%'` (EGX alpha tickers stored as `TICKER+Arabic name`).
   - No match → `fundamental_score = None`, confidence = 0.
4. **Hard veto (مقترح للتفعيل بعد أسبوع حي):** رفض BUY لو `fundamental_score < 30` (PF 1.511 → 1.784, +0.273).
5. **ممنوع رفض BUY بناءً على fundamentals فقط للـ Gambler** (يقتل الزخم — الأساسيات filter إضافي فقط).
6. **ممنوع رفع عتبة الـ veto فوق 30** (هتقتل winners — يوجد false positive واحد موثّق: 2180 score=17.5 ret=+8.97%).
7. **Conservative gate** (مرحلة 3): رفض BUY لو `score<40 + conf>70` للـ conservative persona — يحتاج بيانات conservative persona أولاً.
8. **لا تفعّل `egx_fundamental_fetcher.py` cron** قبل إصلاح `tab_*→ticker` mapping.
9. **Point-in-time caveat:** الـ snapshot بتاريخ ~2026-08-17 — تطبيقه على توقعات Jan-Jul 2026 يُدخل look-ahead bias بسيط (مقبول لأن الـ fundamentals تتغير ربع سنوي).

### النتائج المرجعية (148 صفقة مغلقة، archive 20260817)

| Tier | n | WR | PF | Expectancy |
|------|---:|----:|----:|----------:|
| High score (≥70) | 9 | **77.78%** | **4.436** | **+4.30%** |
| Mid score (40-70) | 4 | 25.00% | 0.341 | -3.24% |
| Low score (<40) | 3 | 33.33% | 0.717 | -1.18% |
| No score (missing) | 2 | 50.00% | 1.515 | +1.43% |

→ الأساسيات **تفيد بقوة في اختيار الرابحين** (شريحة ≥70 = PF 4.4 vs 1.5 baseline = 2.9×).

---

## 🛡️ سلامة قواعد البيانات (DB Safety)

> **المرجع التفصيلي:** `ULTRA-RESTORE-DATABASE-RECOVERY.md` + `V40_2_LIVE_INTEGRATION_PLAN.md` (مُدمجين هنا).

### الـ 18 قاعدة بيانات SQLite

1. `stocks.db` — الأسهم + القطاعات + `stock_daily_prices` + `stored_analyses` + `real_evaluated_predictions`.
2. `price_history.db` — التاريخ اليومي (المصدر الموحّد لقراءة الأسعار عبر `load_merged_history()`).
3. `predictions.db` — التوقعات النشطة + المغلقة + `actual_return` + V40 columns (`evidence_count`, `morning_bell`, `kill_filter_result`, `exit_type`, `lowest_price_reached`).
4. `data_engine.db` — بيانات الـ fundamentals + الأخبار + الكروب + `tab_*` (8 جداول).
5. `intraday.db` — بيانات intraday (ticker-level).
6. `auth.db` — مصادقة NextAuth.
7. `news.db` — الأخبار.
8. `crypto.db` — العملات الرقمية.
9. ثانوية: `gold_prices.db`, `silver_prices.db`, `analytics.db`, `community.db`, `telegram_data.db`, `learned.db`, `crypto_learning.db`, `crypto-lab.db`, `exchange_rates.db`, `ai_search_cache.db`, `historical.db`.

### قواعد السلامة

1. **WAL mode + busy_timeout=30000** على كل DBs (عبر `scripts/init_db_safety.py`).
2. **لا `ALTER TABLE`** — بس `CREATE TABLE IF NOT EXISTS`. (ملاحظة: `ALTER TABLE ADD COLUMN` مسموح للـ migrations الآمنة فقط).
3. **كل عمليات DB في `try/except`** — لو فشل التخزين، التحليل بيكمل.
4. **ممنوع استخدام** `db/egx_investment.db` أو `db/custom.db` (runtime فقط).
5. **نسخ احتياطي يومي:** `scripts/auto-backup.sh` + `POST /api/admin/db-manager/auto-backup`.
6. **أرشيف GitHub:** `db/databases_backup.tar.gz` (37 MB) — يسترجع عبر `vps-service/tools/restore_from_local.py --from-git`.
7. **الاسترجاع الآمن** (SAFE restore):
   ```bash
   # فحص فقط (read-only)
   python3 vps-service/tools/restore_from_local.py --from-git --check
   # الاسترجاع الفعلي (مع نسخة احتياطية تلقائية + V40 migration)
   python3 vps-service/tools/restore_from_local.py --from-git
   ```
8. **⚠️ أدوات خطيرة (لا تستخدم):**
   - `vps-service/tools/restore_dbs.py` — يكتب فوق DBs إنتاجية بدون نسخ احتياطي. **ممنوع.**
   - `scripts/inject_egx_historical_data.py` — يحقن بيانات EODHD (API key متلغي) — قد يلوّث.
9. **الـ ULTRA-RESTORE policy** (من 2026-08-11):
   - **Cap على الخسائر -20%** في `daily_closer.py` + `historical_prediction_generator.py` لمنع الشذوذ الرياضي.
   - **SELL expiry calculation** إلزامي: `profit_loss = (entry - exit) / entry × 100` (مش BUY formula).
   - **لا double negation** في `historical_prediction_generator.py` (كان بـ يضرب الموجب مرتين).

### سكربتات "لا تكسر الإنتاج" (4)

1. `scripts/init_db_safety.py` — WAL + busy_timeout على كل DBs.
2. `scripts/repair_all_dbs.py` — إصلاح DBs تالفة (REINDEX + dump/rebuild).
3. `scripts/daily_db_health_check.py` — فحص يومي + إصلاح تلقائي + تقرير JSON.
4. `scripts/setup-daily-health-cron.sh` — تثبيت/إزالة cron job.

---

## 🧠 أسلوب التفكير المطلوب

### المبدأ 1 — اقرأ قبل أن تكتب
- قبل أي تعديل، اقرأ الملفات الـ 4 في `Documentation/` + `AGENTS.md` + آخر 3 إدخالات في `CHANGELOG.md`.
- ابحث عن الموجود قبل أن تنشئ جديدًا (Grep/Glob).
- فهم الـ golden rules في هذا الملف قبل لمس المحركات.

### المبدأ 2 — وسّع ولا تُنشئ
- لو محتاج ميزة: دوّر على أقرب مكوّن/دالة موجودة ووسّعها.
- لو محتاج حقل: أضفه للـ dataclass + `to_dict` + الـ API type + الـ UI render.
- لو محتاج endpoint: وسّع blueprint مسجّل، ما تنشئش ملف route جديد.

### المبدأ 3 — الكود الميت جريمة
- أي دالة/endpoint/مكوّن بتكتبه لازم يتربط ويُستخدم.
- لو لقيت كود ميت، سجّله في القيود الحرجة (§15) ولا تحذفه إلا بموافقة المالك + VERIFY-BEFORE-DELETE (Rule 16/25).
- الـ refactoring يجي بعد توثيق الوضع الحالي، مش قبله.

### المبدأ 4 — البيانات أولاً
- الإنتاج بـ يعتمد على `price_history.db` و `predictions.db` و `stocks.db`.
- لو المحرك بيطلع 0 نتيجة، **السبب الأول دائمًا هو البيانات** مش الكود.
- تحقق من `MAX(date)` في `price_history.db` قبل أي تشخيص للمحرك.

### المبدأ 5 — التراجع ممكن دائمًا
- كل تعديل خطير لازم يسبقه نسخة احتياطية (DB أو git commit).
- استخدم `git stash` و `git checkout` بحرص في الساندبوكس.
- في الإنتاج، النسخة الاحتياطية في `db/backups/restore_TIMESTAMP/`.

### المبدأ 6 — الوضوح قبل الذكاء
- الكود الواضح أفضل من الكود الذكي المعقّد.
- التعليقات بالعربي مقبولة (المشروع عربي بالكامل).
- الـ dataclass + `to_dict()` أفضل من dict خام.

### المبدأ 7 — لا تخمن، اسأل
- لو مش متأكد من قرار، اسأل المالك.
- لو الطلب غامض، اطلب توضيح.
- خطأ في الفهم = ساعات ضائعة + مشاكل في الإنتاج.

---

## 📋 خطوات سير العمل (Workflow)

### §12.1 — عند بداية أي مهمة

1. اقرأ الملفات الـ 4 في `Documentation/` بهذا الترتيب:
   - `00-CONSTITUTION.md` (هذا الملف)
   - `01-PROJECT_ANATOMY.md`
   - `02-SCREENS_AND_COMPONENTS.md`
   - `SYSTEM_HOW_IT_THINKS.md`
2. اقرأ `AGENTS.md` + آخر 3 إدخالات في `CHANGELOG.md`.
3. اقرأ آخر ~150 سطر في `worklog.md` لمعرفة ما فعله الوكلاء السابقون.
4. لو المهمة تشمل DBs، اقرأ `SYSTEM_STATE.md` §3 (مسارات DBs).
5. حدد ما إذا كانت المهمة:
   - **Fix** (إصلاح bug موجود) — اتبع §12.2.
   - **Feature** (ميزة جديدة) — اتبع §12.3.
   - **Refactor** (إعادة هيكلة) — اتبع §12.4 + لازم موافقة المالك.
   - **Documentation** (توثيق) — اتبع §12.5.
6. سجّل المهمة في `worklog.md` قبل البدء.

### §12.2 — Fix workflow

1. **أعد إنتاج الـ bug** في الساندبوكس أولًا (لو ممكن).
2. **شخّص السبب الجذري** — لا تعالج العَرض. ابحث عن:
   - بيانات ناقصة؟ (`price_history.db` متجمّد؟)
   - عتبة hardcoded تتجاوز `engine_settings`؟
   - import مكسور؟
   - كود ميت بـ يـ shadow كود نشط؟
   - key-mismatch (مثل `stop_loss`/`target_1`/`target_2` vs `sl`/`tp1`/`tp2`)؟
3. **اكتب الإصلاح** في الملف الموجود (لا تنشئ ملف جديد).
4. **تحقق**: `tsc --noEmit` + `python3 -c "import ..."` + `bun run lint`.
5. **اختبر** في الساندبوكس (Agent Browser للواجهة + curl للـ API).
6. **حدّث التوثيق** (لو الإصلاح يغيّر سلوك المحرك).
7. **ارفع** على git (§13).

### §12.3 — Feature workflow

1. **اسأل**: هل الميزة موجودة فعلًا؟ (Grep في `src/` و `vps-service/`).
2. **إن وُجدت**: وسّعها. إن لم توجد: اطلب موافقة المالك على إنشاء ملف.
3. **اربط الباك-إند ← API ← بروكسي ← الواجهة** في نفس الـ PR.
4. **لا تترك كود ميت** — لو ضفت endpoint، استخدمه في الواجهة.
5. **حدّث** `02-SCREENS_AND_COMPONENTS.md` لو ضفت شاشة/مكوّن.
6. **حدّث** `01-PROJECT_ANATOMY.md` لو ضفت محرك/قاعدة بيانات/وحدة.
7. **ارفع** على git.

### §12.4 — Refactor workflow (لازم موافقة المالك)

1. **لا تبدأ refactoring بدون موافقة صريحة** من المالك.
2. اقرأ قسم القيود الحرجة في هذا الملف (§15) لمعرفة الديون الموثّقة.
3. اختر مرحلة واحدة فقط (مثلًا: "حذف garage/ directory" أو "حذف 71 مكوّن orphan").
4. **نفّذ في فرع منفصل** (`git checkout -b refactor/<name>`).
5. **اختبر شاملًا** بعد كل ملف تُعدّله.
6. **حدّث** قسم القيود الحرجة في هذا الملف (ضع علامة ✅ على المكتمل).
7. **اطلب مراجعة المالك** قبل الـ merge.

### §12.5 — Documentation workflow

1. التوثيق **يلزم** الواقع الحالي للكود، مش النظري.
2. استخدم الأدوات (Grep/Glob/Read) للتأكد من كل رقم وكل مسار.
3. لا تنسخ من `CHANGELOG.md` بدون تحقق — قد يكون قديمًا.
4. كل ملف توثيقي لازم يبدأ بـ "آخر تحديث" + المالك + المسار.
5. بعد التحديث، ارفع على git فورًا.

---

## 🔄 دورة التحديث والإغلاق + الرفع على GitHub

### §13.1 — عند انتهاء أي مهمة

1. **تحقق من القواعد** في هذا الملف (§3-§11 — ماذا كسرت؟ لا شيء؟ كمل).
2. **شغّل الفحوصات**:
   ```bash
   bun run lint                                  # Frontend lint
   npx tsc --noEmit -p tsconfig.json            # TypeScript types
   python3 -c "import vps-service.<module>"      # Backend import
   ```
3. **اختبر في المتصفح** (Agent Browser للواجهة، curl للـ API).
4. **حدّث التوثيق المتأثر**:
   - لو غيّرت محرك → `01-PROJECT_ANATOMY.md` + `SYSTEM_STATE.md`.
   - لو ضفت/حذفت شاشة أو مكوّن → `02-SCREENS_AND_COMPONENTS.md`.
   - لو غيّرت منطق التحليل → `SYSTEM_HOW_IT_THINKS.md`.
   - لو ضفت قاعدة → `00-CONSTITUTION.md` (هذا الملف) — بموافقة المالك.
5. **أضف إدخال** في `CHANGELOG.md` (في الأعلى، بصيغة P0-vX أو RL-FIX-X أو R:R-FIX أو FUNDAMENTALS-ACTIVATION).
6. **أضف إدخال** في `worklog.md` (في النهاية، بصيغة `Task ID: <X>` + `Work Log` + `Stage Summary`).
7. **Commit** برسالة واضحة (عربي أو إنجليزي، شاملة).

### §13.2 — الرفع على GitHub

```bash
cd /home/z/my-project  # أو /root/GLMinvestment على الإنتاج
git status
git add <files-changed>
git commit -m "<وصف مختصر بالعربي أو الإنجليزي>"
git push origin main
```

**قواعد الـ commit:**
- لا تـ commit ملفات `.db` (ممنوع بحسب `.gitignore`).
- لا تـ commit `.env` أو أسرار.
- لا تـ commit `node_modules/` أو `__pycache__/`.
- رسالة الـ commit لازم تشمل: ماذا تغيّر + لماذا + رقم المهمة (لو موجود).

### §13.3 — مزامنة الإنتاج من الساندبوكس (READ-ONLY — No DB Touch)

```bash
# على الإنتاج
cd /root/GLMinvestment
git pull origin main
pm2 restart nextjs python-backend data-engine
# تحقق:
curl -s http://localhost:3000/api/health
curl -s http://localhost:8010/health
```

**ملاحظة:** الـ DBs على الإنتاج **لا تُلمس** (Rule 1). الـ `git pull` بـ يجيب الكود فقط، مش DBs.

### §13.4 — ما لا يُفعل بعد R:R-FIX / FUNDAMENTALS-ACTIVATION

- ❌ لا تحذف أو تعدّل أي توقع موجود في `predictions.db` — الإصلاح forward-only.
- ❌ لا تُعد تشغيل الـ historical backfill (`maestro_backfill_*`) — بـ يكتب فوق الـ closed-trade outcomes.
- ❌ لا تغيّر عتبات `engine_settings.py` (`dynamic_rr_normal`, `atr_stop_min_pct`, etc.) بدون جلسة قياس منفصلة.
- ❌ لا تفعّل `egx_fundamental_fetcher.py` cron قبل إصلاح `tab_*→ticker` mapping.

---

## 🏗️ بنية المشروع (مرجع سريع)

> التفاصيل الكاملة في `01-PROJECT_ANATOMY.md`. هذا ملخص للقواعد البنيوية.

### الواجهة (Frontend — Next.js 16)
- المسار: `src/`
- الدخول: `src/app/page.tsx` (single-page shell مع hash routing).
- المكونات: `src/components/` (328 ملف، 56 مجلد فرعي).
- الـ UI primitives: `src/components/ui/` (49 shadcn/ui).
- الـ API routes: `src/app/api/` (588 route، 257 proxy لـ Python).

### الباك-إند (Backend — Python)
- المسار: `vps-service/`
- الدخول: `lightweight_server.py` (Flask على 8010) + `main.py` (FastAPI).
- المحركات: `analyzers/` (123 ملف) + `engine/` (10) + `engines/` (6).
- الـ APIs: `api/` (65 ملف، 31 blueprint مسجّل).
- الـ jobs: `jobs/` (12 ملف — schedulers + closers + learners).
- المخاطر: `portfolio/` (9) + `risk_management_advanced.py` (root).
- البيانات: `data/` (15) + `data_engine/` (منفصل).

### الـ Data Engine
- منفصل عن `vps-service/` — مساره `data_engine/`.
- يجمع البيانات من TradingView + Yahoo + EGXPilot + CoinGecko + EGKSCO.
- يكتب في `data_engine.db` + `intraday.db` + `price_history.db`.

### المحركات الرئيسية

| المحرك | الملف | الدور |
|--------|------|-------|
| MasterAnalyzer | `analyzers/master_analyzer.py` | الدماغ — يجمع كل المحللات + `load_merged_history()` |
| MaestroOrchestrator | `analyzers/maestro_orchestrator.py` | 8 طبقات + 3 شخصيات + expert memory |
| CoreScoringEngine | `analyzers/core_scoring_engine.py` | RSI/MACD/SMA/ATR/Bollinger |
| InstitutionalDecisionEngine | `analyzers/institutional_decision_engine.py` | V40 — 6 إثباتات موزونة + kill filters |
| EngineSettings | `analyzers/engine_settings.py` | مصدر الحقيقة للعتبات (~100 مفتاح) |
| AdaptiveWeights | `analyzers/adaptive_weights.py` | `PERSONA_INPUT_WEIGHTS` + تكيف حسب الـ regime |
| V38BacktestEngine | `engines/v38_backtest_engine.py` | باكتست V38/V40.2 + simulate_trade + ATR clamp |
| FlowSystem | `engine/flow_system.py` | 4 طبقات flow score |
| StopManager | `portfolio/stop_manager.py` | 7 أنواع ستوب |
| PositionManager | `portfolio/position_manager.py` | إدارة المراكز (class-based) |
| RiskManagementAdvanced | `risk_management_advanced.py` | position sizing + STOP_LOSS_EGX/CRYPTO |
| MarketScheduler | `jobs/market_scheduler.py` | المُجدوِل المركزي |
| DailyCloser | `jobs/daily_closer.py` | إغلاق التوقعات يوميًا + Hard Loss Ceiling |
| LearningEngine | `jobs/learning_engine.py` | التعلم من الصفقات المغلقة |
| V40.2 Generator | `jobs/v40_2_daily_generator.py` | توليد توقعات V40.2 الإنتاجي |
| PriceHistorySafetyNet | `jobs/price_history_safetynet.py` | ملء فجوات Yahoo |
| IntradayAggregator | `jobs/intraday_aggregator.py` | intraday → daily |
| ConfidenceEngine | `analyzers/confidence_engine.py` | 7 عوامل ثقة + 4 tiers |
| FundamentalDataProvider | `analyzers/fundamental_data_provider.py` | `get_fundamental_score()` الحقيقي 0-100 |

### المهام المجدولة (22 مهمة APScheduler)
- `incremental` / `full_analysis` / `final_analysis` (تحليل).
- `daily_closer` (إغلاق يومي، 14:35 Cairo Sun-Thu).
- `learning_engine` (تعلم تكيفي).
- `trailing_stop_update` (كل 15 دقيقة، intraday).
- `bag_holder_alerts` (تنبيهات خسائر ≥15%، كل 15 دقيقة).
- `price_history_safetynet` (يومي).
- `intraday_aggregator` (intraday→daily).
- `v40_2_daily_generator` (توليد V40.2، 07:15 Cairo Sun-Thu).

> تفاصيل كل DB + جداولها + علاقاتها في `01-PROJECT_ANATOMY.md` §5.

---

## ⚠️ القيود الحرجة المعروفة (حلّها مُجدوَل)

> التفاصيل الكاملة سابقًا في `03-REFACTORING_REPORT.md` (مُدمج هنا). هذه قيود يجب أن يعرفها أي وكيل قبل البدء.

| القيد | الموقع | الخطورة | الحل |
|-------|--------|---------|------|
| `STOP_LOSS_EGX`/`STOP_LOSS_CRYPTO` hardcoded | `risk_management_advanced.py:87-105` | 🔴 | نقل لـ `engine_settings.py` |
| `tech_score = 50` hardcoded في مكانين | `professional_analysis_routes.py:163`, `live_prediction_engine.py:257` | 🟠 | استبدال بـ `get_setting('tech_score_base', 50)` |
| 34 ملف API DEPRECATED في `vps-service/api/` | ~17,000 LOC ميت | 🟡 | VERIFY-BEFORE-DELETE ثم حذف بمراحل |
| 9 صفحات Next.js ميتة (`/admin/maestro`, `/community`, `/portfolio`, ...) | ~6,000 LOC | 🟡 | VERIFY-BEFORE-DELETE ثم حذف |
| 71 مكوّن orphan في `src/components/` | 50,442 LOC ميت (26.6%) | 🔴 | حذف 3 من 71 (P3.3-partial)؛ 68 متبقٍ يحتاج refactoring |
| `garage/` directory بالكامل ميت | 7 ملفات، 8,247 LOC | 🟡 | حذف كامل بعد VERIFY-BEFORE-DELETE |
| 3 أنظمة تتبع توقعات متوازية | `/api/predictions/tracking/*` + `/api/predictions/honest-tracking/*` + `/api/stored-analysis/live-tracking` | 🟠 | توحيد على `live-tracking` فقط |
| 163 "tiny proxy" route (~4,700 LOC boilerplate) | `src/app/api/**` | 🟡 | استبدال بـ catch-all proxy |
| 4 catch-all proxies متداخلة | `/api/[...slug]`, `/api/proxy/*`, `/api/python/*`, `/api/telegram/*` | 🟠 | توحيد على `/api/proxy/[...path]` |
| `tab_balance_sheet`/`tab_income_statement`/`tab_cash_flow` column-shift bug | `data_engine.db` | 🟠 | migration script (لم يُكتب بعد) |
| `egx_fundamentals` فارغة (0 rows) | `data_engine.db` | 🟠 | تفعيل `egx_fundamental_fetcher.py` cron بعد إصلاح الـ mapping |
| 4 tickers unmatched (EG23X, MTEZ, OCIC, TAO) | `predictions.db` | 🟡 | resolver strategy extension |
| tests ناقصة حرجة | stop_manager / position_manager / institutional_decision_engine / v38_backtest_engine / historical_prediction_generator / engine_settings | 🔴 | كتابة unit tests لكل منهم |
| `MAX_HOLDING_DAYS` = 30 / 90 / 20 (3 قيم مختلفة) | `engine_settings.py:191`, `multi_target_exit.py:80`, `optimizer_params.json` | 🟠 | توحيد على 30 |
| توقعات عطلة نهاية الأسبوع من أسعار قديمة | `historical_prediction_generator.py` | 🟠 | market-closed guard قبل التوليد |
| `pytz` dependency حرج (Cairo timezone) | عابر للملفات | 🟠 | تثبيت `pytz` في `requirements.txt` |
| Prisma scaffold بدل schema حقيقي | `prisma/schema.prisma` | 🟡 | الـ data الحقيقي في Python SQLite — لا تلمس Prisma |
| Admin components ضخمة | MaestroCommandCenter 3,748 LOC | 🟡 | تقسيم لوحدات أصغر (P3.x) |
| 18 ثغرة أمنية حرجة | SEC-01 (admin backdoor), SEC-03 (Paymob bypass), SEC-04 (admin auth bypass via proxy), ... | 🔴 | أولوية قصوى — تحتاج جلسة أمن مستقلة |
| الساندبوكس بـ reset دوريًا (SANDBOX-RESET) | `/home/z/my-project/` — يـ reset لـ `.initial_snapshot.json` (~19-22 أغسطس) | 🔴 | القاعدة 26 — commit كل ساعة + push على GitHub + backup في `/tmp/` قبل أي عملية خطرة |

---

## ✅ عهد الوكيل

أي وكيل (Kilo / Grok / Gemini / Z.ai / بشري) يبدأ العمل في هذا المشروع **يقرأ هذا الملف**
ويُقرّ بما يلي:

1. قرأتُ `Documentation/00-CONSTITUTION.md` (هذا الملف) وفهمتُ القواعد المطلقة الـ 53 (1-32 + 33-53).
2. سأقرأ `01-PROJECT_ANATOMY.md` + `02-SCREENS_AND_COMPONENTS.md` + `SYSTEM_HOW_IT_THINKS.md` قبل أي تعديل.
3. لن ألمس قواعد البيانات على الإنتاج (القاعدة 1).
4. لن ألمس ملفات النظام (القاعدة 2).
5. سألتزم ببنية المشروع (القاعدة 3).
6. لن أنشئ شاشات/ملفات/أنظمة جديدة إلا في الطوارئ وبموافقة المالك (القاعدة 4).
7. كل كود أكتبه سيرتبط ويُستخدم (القاعدة 5).
8. سألتزم بـ schema-aware (القاعدة 6) و HARD cap (القاعدة 7) و ATR stop [3%,9%] للأسهم / [5%,15%] للكريبتو (القاعدة 8) و R:R ≥ 1.5 (القاعدة 18) و Python=Brain (القاعدة 20) و V40.2 evidence-based (القاعدة 21) و dedup-by-ticker (القاعدة 22) و PERSONA-UNIFY-A (القاعدة 23) و fundamentals real (القاعدة 24).
9. سأحترم مسار التوقعات الرسمي (V40.2) ولا أعيد تصنيف الشخصيات في `predictions.persona`.
10. سأحدّث التوثيق المتأثر بعد كل مهمة وأرفع على GitHub.
11. لن أحذف كودًا ميتًا إلا بعد VERIFY-BEFORE-DELETE (القاعدة 16) وموافقة المالك (القاعدة 25).
12. لن أُدخل بيانات كاذبة أو أرقام للحشو (القاعدة 27) — مشروع فلوس حقيقي.
13. لن أكرر شاشات/تبويبات/أكواد (القاعدة 28) — أوسّع الموجود.
14. سأبني نظام متكامل واحد مرتبط (القاعدة 29) — لا موديولات منفصلة.
15. سأوجه كل شاشات العميل بأسلوب احترافي (القاعدة 30) — لا عبارات تحميسية (القاعدة 31).
16. سأفصل بين عرض العميل و logic النظام (القاعدة 32) — Node = display only، Python = brain.
17. سأربط كل تحسينات الباك تست في الإنتاج (القاعدة 33) — الباك تست بيتعمل عشان نحسن الإنتاج، مش عشان نلعب.
18. سأختبر كل تعديل بـ backtest قبل اعتماده (القاعدة 14) — واللي يرفع الأداء نعتمده واللي ينقصه نلغيه.
19. سأعتمد على الإفصاحات الرسمية كمصدر وحيد للأخبار المؤسسية (القاعدة 36) — لا بحث عشوائي.
20. سأشدد شروط الدخول: تراكم أو Liquidity Grab فقط (القاعدة 37) — لا مطاردة.
21. سأفرض مدة احتفاظ قصيرة (7 أيام max + خروج لو مفيش حركة) (القاعدة 38).
22. سأكتشف شمعة التوزيع كإشارة خروج (القاعدة 39) — الميكرز بـ يفرغ.
23. سأفهم الأخبار بـ sentiment analysis حقيقي (القاعدة 40) — مش مجرد جلب.
24. سأطبق نفس العمق على الكريبتو: quality gate + strict entry + short holding + distribution exit + news fetcher — بـ thresholds مكيّفة لـ 24/7 + تقلب أعلى.
25. سأحترم فلسفة الخروج الهيكلية (القاعدة 38 محدّثة): الوقت شرط مساعد ضعيف مش سبب وحيد — `typical_correction_pct` من النوتبوك بـ يفرّق بين تصحيح وانهيار.
26. سأحتفظ بنوتبوك دائم لكل سهم (`stock_notebook.py`) كطبقة معرفة سياقية فوق المحركات، مش بديل لها.
27. سأستخدم `apply_notebook_context()` كجسر موحد بين النوتبوك والقرار في V40.2.
28. سأعتمد `unified_exit_engine.py` لـ توحيد قرارات الخروج بين أسهم + كريبتو بنفس الفلسفة و thresholds مختلفة (`MARKET_PROFILES`).
29. سأسجّل كل رفض/خروج في `decision_log.db` عبر `decision_logger.py::log_decision()` عشان نعرف هل الفلاتر بتساعد أم بتقتل الإشارات الجيدة.
30. سأفرض الـ feature flags العشرة (10) لـ V40.2 — كلها OFF افتراضياً: STRICT_ENTRY / DISCLOSURE_IMPACT / NOTEBOOK_CONTEXT / SHORT_HOLDING / DISTRIBUTION_EXIT / NEWS_IMPACT / CRYPTO_STRICT_ENTRY / CRYPTO_DISCLOSURE_IMPACT / CRYPTO_NEWS_IMPACT / UNIFIED_EXIT.

---

### القاعدة 33 — ربط تحسينات الباك تست في الإنتاج (PRODUCTION-WIRING — 2026-08-30)

> **سبب الإضافة:** توجيه صريح من المالك (2026-08-30): "الباك تست بيتعمل عشان نحسن الحاضر والمستقبل. اربط كل حاجة الآن وأتأكد إنها مظبوطة 100%. ده أهم جزء وحط ده عندك في الدستور."

- **كل تحسين بيتعمل في الباك تست لازم يتربط في الإنتاج الحقيقي فوراً** — في `v40_2_daily_generator.py` و/أو `daily_closer.py`.
- **ممنوع** ترك تحسينات في `v40_2_daily_generator.py` بدون ربطها في الإنتاج (V40.2 هو المحرك الوحيد — القاعدة 35).
- **الملفات اللي لازم تكون مربوطة في الإنتاج دائماً:**
  1. `utils/entry_gate.py` — في `v40_2_daily_generator.py` قبل `record_prediction`.
  2. `utils/position_sizing.py` — في `v40_2_daily_generator.py` لحساب حجم المركز.
  3. `utils/circuit_breaker.py` — في `daily_closer.py::run()` لوقف التداول بعد 3 خسائر.
  4. `core/opportunity_quality.py::compute_dynamic_target` — في `v40_2_daily_generator.py` لحساب الهدف الديناميكي.
  5. `core/opportunity_quality.py::enforce_atr_based_stop` — في `v40_2_daily_generator.py` (مع `lows` للـ swing low).
  6. `core/opportunity_quality.py::classify_liquidity` — في `v40_2_daily_generator.py` لتصنيف السيولة.
  7. Sector filter — في `v40_2_daily_generator.py` لحرارة القطاع.
  8. BOS/ChoCH — في `v40_2_daily_generator.py` لكشف بنية السوق.
- **التحقق:** بعد كل تعديل، لازم نتأكد إن الـ `grep` بيرجّع نتائج إن الملف مربوط في `v40_2_daily_generator.py` و/أو `daily_closer.py`.
- **العقوبة:** أي تحسين يفضل في الباك تست بس بدون ربط في الإنتاج = مخالفة دستورية.

---

*هذا الدستور ملزم. أي تغيير فيه لازم بموافقة المالك وتوثيقه في `CHANGELOG.md`.*
*آخر تحديث: 2026-08-30 — إضافة القاعدة 33 (PRODUCTION-WIRING) بعد توجيهات المالك حول ربط كل تحسينات الباك تست في الإنتاج + تحديث عهد الوكيل لـ 34 بند.*

---

### القاعدة 34 — مشروع واحد متكامل، ممنوع التكرار (NO_DUPLICATE_SCREENS — 2026-08-30)

> **سبب الإضافة:** توجيه صريح من المالك (2026-08-30): "أنت المفروض تشتغل على المشروع كا كتلة واحدة مش شاشات منفصلة ولا ملفات ملهاش علاقة ببعضها ولامتكررة دة مشروع واحد متكامل مش شوية شاشات متبعترة."

**هذا الدستور يلزم كل وكيل (AI/مبرمج) بالقواعد الآتية:**

#### 1. ممنوع إنشاء شاشة جديدة لو الخدمة موجودة في شاشة تانية
- قبل ما تضيف شاشة/ route/ tab جديد، **إبحث الأول** في `src/app/page.tsx` + `src/components/` لو الخدمة موجودة.
- لو موجودة → **أوسّعها** (أضيف tab/sub-tab داخلها)، مش أعمل شاشة منفصلة.
- مثال: توقعات الغد اتدمجت كـ tab جوه `#recommendations` (MarketAnalysisView) بدل شاشة منفصلة.

#### 2. كل ملف لازم يكون مربوط
- ملف `use` = مربوط. ملف مش `use` = ميت → يتعمله `VERIFY-BEFORE-DELETE` (القاعدة 16).
- ممنوع إنشاء ملف `.tsx`/`.ts` جديد بدون استيراده في `page.tsx` أو مكون تاني.

#### 3. ممنوع تكرار الـ logic
- لو فيه دالة بتخدم غرض معين (مثلاً: جلب توقعات)، **مفيش** نسخة من نفس الـ logic في ملف تاني.
- استخدم الـ API endpoint الواحد + الـ store الواحد + الـ helper الواحد.

#### 4. الـ routing موحد
- كل route في `page.tsx` لازم يكون في `validViews` + `VALID_VIEWS` (قائمتين متناسقتين).
- ممنوع إنشاء route بدون إضافته في الاتنين.

#### 5. الـ data sources موحدة
- لكل نوع بيانات (أسهم/كريبتو/توقعات/أخبار) فيه **مصدر واحد رسمي**:
  - أسهم EGX → `stocks.db` (عبر `src/lib/data-engine-db.ts`)
  - كريبتو → `crypto_prices` في `data_engine.db`
  - توقعات → `predictions.db` (عبر `src/lib/db-predictions.ts`)
  - أخبار → `/api/news-feed` (مع `?market=crypto` filter)
- ممنوع إنشاء endpoint بيجيب من مصدر تاني بدون توثيق + موافقة المالك.

#### 6. قبل ما تبدأ شغل جديد
اسأل نفسك 3 أسئلة:
1. **هل الخدمة دي موجودة بالفعل؟** → لو آه، أوسّعها.
2. **هل فيه API endpoint بيعمل نفس الحاجة؟** → لو آه، استخدمه.
3. **هل فيه ملف بـ serves نفس الغرض؟** → لو آه، ادمج فيهم.

#### 7. العقوبة
- أي شاشة/ملف/endpoint جديد بيكرر خدمة موجودة = مخالفة دستورية.
- الوكيل لازم يـ audit شغله قبل الـ commit ويتأكد إنه مفيهوش تكرار.

---

*آخر تحديث: 2026-08-30 — إضافة القاعدة 34 (NO_DUPLICATE_SCREENS) بعد توجيهات المالك حول المشروع المتكامل + تحديث عهد الوكيل لـ 35 بند.*

---

### القاعدة 35 — محرك واحد للتوقعات (ENGINE-UNIFY — 2026-08-31)

> **سبب الإضافة:** كان فيه محركين بيكتبوا في نفس جدول `predictions` = توقعات مكررة + متضاربة. تم التوحيد على `V40.2` كمصدر وحيد (KILL-MAESTRO — 2026-08-31).

- **V40.2** (`v40_2_daily_generator.py`) هو **المحرك الوحيد** المسموح له بكتابة توقعات في `predictions` table (production prediction writer).
- **MaestroOrchestrator معطّل** (`signal_id=None`) — مش بيكتب أي توقعات في DB. لسه موجود في الكود للـ UI/queries فقط.
- **Maestro cron معطّل** — Maestro بلا جدولة.
- **V40.2 tracker مفعّل** (`PredictionTracker`) — بيكتب التوقعات في `predictions.db`.
- **daily_closer** engine-agnostic — بيقفل أي row في `predictions` بـ `outcome_date IS NULL`.
- **ممنوع** إعادة تفعيل Maestro/Maestro cron أو إنشاء محرك جديد بيكتب في `predictions`.
- **engine_source tag**: كل توقع جديد في `notes` فيه `engine=v40_2`.

---

### القاعدة 36 — الإفصاحات الرسمية كمصدر وحيد للأخبار (DISCLOSURE-ENGINE — 2026-09-01)

> **سبب الإضافة:** توجيه المالك (2026-09-01): "اقطع البحث العشوائي تمامًا. المصدر الوحيد المسموح: صفحة الإفصاحات الرسمية للبورصة المصرية. يحول الإفصاح لـ JSON بسيط (رمز السهم + نوع الحدث + تاريخ + ملخص). يدي درجة تأثير رقمية من -2 إلى +2."

- **الـ module:** `vps-service/analyzers/egx_disclosure_engine.py` (620 LOC).
- **12 نوع إفصاح** بالكلمات المفتاحية الصارمة:
  - **VETO (-2)**: إيقاف تداول (SUSPENSION)، شطب (DELISTING) → تجميد الإشارة فوراً.
  - **REDUCE (-1)**: توزيع أرباح بعد ex-date (DIVIDEND)، كوبون (COUPON)، مراقب حسابات (AUDITOR_CHANGE)، استقالة (RESIGNATION).
  - **NEUTRAL (0)**: حقوق اكتتاب (SUBSCRIPTION_RIGHTS — تخفيف)، توزيع أرباح قبل ex-date، نتائج أعمال محايدة (EARNINGS).
  - **BOOST (+1)**: زيادة رأس المال (CAPITAL_INCREASE)، أسهم مجانية (FREE_SHARES)، تجزئة (STOCK_SPLIT).
  - **BOOST_STRONG (+2)**: استحواذ (ACQUISITION)، نتائج أعمال قوية (EARNINGS dynamic +2).
- **dynamic scoring**: EARNINGS بـ يحلل النص (أرباح قياسية → +2، خسائر → -2). DIVIDEND بـ يفرق قبل/بعد ex-date.
- **التكامل في V40.2**: بـ toggle `V40_2_DISCLOSURE_IMPACT=1` (default OFF).
  - VETO → `continue` (hard reject).
  - REDUCE → `score -= 10`.
  - BOOST → `score += 10/20`.
- **DB**: `db/disclosures.db` → table `egx_disclosures` (dedup: ticker + event_type + date + title).
- **cron**: كل ساعتين أثناء جلسة السوق (10:00-14:00).
- **ممنوع** استخدام DuckDuckGo/NewsAPI كـ "أخبار" للقرارات التداولية. الإفصاحات الرسمية فقط.
- **المرجع:** commit `d9154387` (EGX-DISCLOSURE-ENGINE).

---

### القاعدة 37 — شروط الدخول الصارمة: تراكم أو Liquidity Grab فقط (STRICT-ENTRY — 2026-09-01)

> **سبب الإضافة:** توجيه المالك (2026-09-01): "النظام يرفض الدخول بعد الصعود القوي. يدخل فقط في حالتين: تراكم حقيقي أو Liquidity Grab واضح. غير كده → رفض."

- **الـ module:** `vps-service/analyzers/strict_entry_filters.py` (530 LOC).
- **3 دوال فحص**:
  1. `is_in_accumulation()`: نطاق ضيق (<12%) + حجم هادي (<1.2×) + مفيش قفزة (<12% في 5 أيام) + بعيد عن قمة 20 يوم (≥8%).
  2. `is_liquidity_grab()`: مسح تحت الدعم (≥0.5%) + رجوع فوقه + تأكيد حجم (≥1.8×).
  3. `is_late_entry()` (Don't Chase): قريب من قمة 20 يوم (<6%) OR RSI >65 OR صعود قوي (>15% في 5 أيام).
- **القرار**: `evaluate_strict_entry()`:
  - `is_late_entry → REJECT` (hard reject — Don't Chase).
  - `is_in_accumulation OR is_liquidity_grab → ACCEPT`.
  - غير كده → REJECT.
- **التكامل في V40.2**: بـ toggle `V40_2_STRICT_ENTRY=1` (default OFF).
  - بـ يشتغل **قبل** DISCLOSURE_IMPACT (entry check أول، disclosure ثاني).
- **الترتيب**: strict entry (first) → disclosure VETO (final gate).
- **المرجع:** commit `d49ab39b` (STRICT-ENTRY-FILTERS).

---

### القاعدة 38 — مدة احتفاظ قصيرة + خروج هيكلي (SHORT-HOLDING → structural exit — 2026-09-01)

> **سبب الإضافة:** توجيه المالك (2026-09-01): "فرض مدة احتفاظ قصيرة (7 أيام max + خروج لو مفيش حركة في 3 أيام)."
>
> **تحديث 2026-09-01 (إعادة كتابة):** بعد باك-تست B1/B2، تبيّن إن الخروج الزمني الصِّرف (`max_holding_7d` أو `no_move_3d` كسبب وحيد) بيقتل صفقات كنا مكسبينها. فالفلسفة اتغيّرت من **زمني** إلى **هيكلي**: الوقت بقى شرط مساعد ضعيف، مش سبب إغلاق وحيد. الـ module `short_holding_exit.py` (614 LOC) أُعيد كتابته بهذه الفلسفة.

- **الـ module:** `vps-service/analyzers/short_holding_exit.py` (614 LOC).
- **الفلسفة الجديدة (هيكلية مش زمنية):**
  - **`max_holding_7d`** — **ملغي كسبب وحيد**. الـ `MAX_HOLDING_DAYS=14` دلوقتي مجرد حد مراجعة (مش إغلاق إجباري).
  - **`no_move_3d`** — **ملغي كسبب وحيد**. الـ `REVIEW_THRESHOLD_DAYS=7` دلوقتي بيطلع `review_alert` (تنبيه مش إغلاق) لو النزول خارج نطاق التصحيح المعتاد.
  - **الأولوية الجديدة:** `distribution` (1) > `early_drop` (2) > `compound_breakdown` (3) > `review_alert` (4 — تنبيه فقط).
- **الدوال الجديدة (الجسر مع النوتبوك):**
  - `is_within_typical_correction(entry, current, typical_correction_pct)` — هل النزول جوه نطاق التصحيح المعتاد للسهم؟ (لو النوتبوك فاضي → محايد).
  - `is_breakdown_not_correction(entry, current, typical_correction_pct, rsi, recent_closes)` — هل ده انهيار حقيقي؟ (3 شروط: نزول ×1.3 من typical_correction + RSI<30 + 5 شموع حمراء متتالية).
  - `should_force_exit_by_time(...)` — بيقرر بالإغلاق لو `early_drop` أو `compound_breakdown`، وبيطلع `review_alert` (مش إغلاق) لو `review_threshold_days` + نزول خارج التصحيح.
- **`typical_correction_pct` من النوتبوك:** هو المفتاح اللي بـ يفرّق بين تصحيح (صبر) وانهيار (خروج). مثال: لو سهم typical_correction=16% والنزول الحالي 14% → صبر. لو 22% → خطر.
- **3 شروط إغلاق فعلية (مش زمنية صرفة):**
  1. `early_drop`: نزول ≤ -7% في أول 3 أيام → إغلاق إجباري (حماية رأس مال).
  2. `compound_breakdown_exit`: بعد 10 أيام + نزول أعمق من typical_correction×1.3 + ضعف هيكلي → إغلاق.
  3. `distribution_exit`: شمعة توزيع (القاعدة 39) — أعلى أولوية.
- **التكامل في daily_closer.py:** بـ toggle `V40_2_SHORT_HOLDING=1` (default OFF).
  - بـ يشتغل **قبل** الـ trailing stop logic.
- **المرجع:** commit `dcbb5cd2` (SHORT-HOLDING-DISTRIBUTION-EXIT) + إعادة كتابة 2026-09-01 (structural philosophy).
- **نتيجة باك-تست B3 (200 سهم × 6 شهور):** لا exit واحد من نوع `max_holding` ✅ — الفلسفة الهيكلية شغّالة.

---

### القاعدة 39 — منطق التوزيع كإشارة خروج (DISTRIBUTION-EXIT — 2026-09-01)

> **سبب الإضافة:** توجيه المالك (2026-09-01): "إضافة منطق توزيع واضح كإشارة خروج (SELL / Force Exit)."

- **الـ module:** `vps-service/analyzers/short_holding_exit.py::detect_distribution()`.
- **5 شروط لشمعة التوزيع**:
  1. شمعة حمراء/ضعيفة (close < open أو جسم صغير).
  2. ظل علوي طويل (upper_wick ≥ body).
  3. حجم عالي (>1.8× متوسط 20 يوم).
  4. قريب من قمة 20 يوم (≤8%).
  5. RSI مرتفع (>65).
- **التكامل في daily_closer.py**: بـ toggle `V40_2_DISTRIBUTION_EXIT=1` (default OFF).
  - distribution_exit = priority 1 (أعلى أولوية — الميكرز بـ يفرغ).
- **exit_type**: `distribution_exit` (بـ يتسجل في `predictions.exit_type`).
- **المرجع:** commit `dcbb5cd2`.

---

### القاعدة 40 — فهم الأخبار: News Fetcher + Sentiment Analysis (NEWS-FETCHER-ANALYZER — 2026-09-01)

> **سبب الإضافة:** توجيه المالك (2026-09-01): "كارثة الأخبار — محتاج أخبار لازم مهمة جداً + محتاج النظام يفهم الأخبار مهم جداً."

- **الـ module:** `vps-service/analyzers/news_fetcher_analyzer.py` (460 LOC).
- **المصادر** (بترتيب الأفضلية):
  1. DuckDuckGo HTML search (مجاني + شغّال دايماً + بـ يدعم العربي).
  2. news.db المحلي (fallback).
- **22 سهم EGX معروف** (ticker → اسم عربي + إنجليزي للبحث).
- **تحليل المشاعر** (keyword-based — مش محتاج AI/LLM):
  - **+2 positive_strong**: أرباح قياسية، نمو قوي، استحواذ.
  - **+1 positive**: نمو، ارتفاع، تحسن.
  - **0 neutral**: محايد.
  - **-1 negative**: تراجع، انخفاض.
  - **-2 negative_strong**: خسائر، انهيار، تحقيق، إيقاف.
- **التكامل في V40.2**: بـ toggle `V40_2_NEWS_IMPACT=1` (default OFF).
  - score +2 → BOOST_STRONG (+20).
  - score +1 → BOOST (+10).
  - score -1 → REDUCE (-10).
  - score -2 → VETO (hard reject).
- **الفرق عن القاعدة 36**: الإفصاحات الرسمية (Disclosure Engine) = أحداث مؤسسية محددة. News Fetcher = أخبار عامة + sentiment analysis. الاتنين مكملين لبعض.
- **المرجع:** commit `7abe2743` (NEWS-FETCHER-ANALYZER).

---

*آخر تحديث: 2026-09-01 — إعادة كتابة القاعدة 38 (SHORT-HOLDING → structural exit) + إضافة بنود 25-30 لعهد الوكيل (Notebook + Unified Exit + Decision Logger + 10 Feature Flags). القواعد المطلقة الآن 41 + 6 بنود عهد إضافية (مجموع 30 بند في العهد).*

---

### القاعدة 41 — قراءة التوثيق قبل وبعد كل عمل (DOCS-FIRST-LAST — 2026-09-01)

> **سبب الإضافة:** توجيه المالك (2026-09-01): "تحط قاعدة ثابتة أساسية إنك تقرأ الملفات دي في أول الشغل وبعد ما تخلص تحدثها تاني."
>
> الفشل في قراءة التوثيق قبل العمل = تضيع وقت + إعادة اختراع العجلة + كسر القواعد.
> الفشل في تحديث التوثيق بعد العمل = الوكيل التالي بـ يكرر نفس الأخطاء.

- **قبل أي عمل (بداية كل جلسة):** اقرأ بالترتيب:
  1. `Documentation/00-CONSTITUTION.md` (الدستور — القواعد الـ 41)
  2. `Documentation/01-PROJECT_ANATOMY.md` (التشريح — المعمارية + المحركات)
  3. `Documentation/SYSTEM_HOW_IT_THINKS.md` (المنطق — كيف يفكر النظام)
  4. `worklog.md` (آخر ~150 سطر — ما فعله الوكلاء السابقون)
  5. `CHANGELOG.md` (آخر 3 إدخالات — آخر التعديلات)

- **بعد أي عمل (قبل commit):** حدّث:
  1. `worklog.md` — إدخال واضح: Task ID + Work Log + Stage Summary
  2. `CHANGELOG.md` — إدخال في الأعلى (لو تغيير سلوكي حقيقي)
  3. التوثيق المتأثر:
     - لو غيّرت محرك → `01-PROJECT_ANATOMY.md` + `SYSTEM_HOW_IT_THINKS.md`
     - لو غيّرت شاشة/مكوّن → `02-SCREENS_AND_COMPONENTS.md`
     - لو غيّرت قاعدة → `00-CONSTITUTION.md` (بموافقة المالك)
     - لو غيّرت بيانات/تدفق → `DATA_FLOW_MAP.md`
  4. ارفع على GitHub فورًا بعد التحديث

- **ممنوع:**
  - الشغل بدون قراءة التوثيق أولاً
  - commit بدون تحديث `worklog.md`
  - رفع كود بدون تحديث التوثيق المتأثر
  - تحديث التوثيق بدون التحقق من الكود الفعلي (Grep/Read)

---

## 📒 سجل التغييرات

| التاريخ | الملف | التغيير |
|---------|-------|---------|
| 2026-09-01 | `00-CONSTITUTION.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إعادة كتابة القاعدة 38 (SHORT-HOLDING) لتعكس فلسفة الخروج الهيكلية بعد تحوّل `short_holding_exit.py` (614 LOC) من زمني إلى هيكلي: `max_holding_7d` و `no_move_3d` ملغيان كأسباب وحيدة، الأولوية الجديدة `distribution > early_drop > compound_breakdown > review_alert`. إضافة مراجع `is_within_typical_correction()` + `is_breakdown_not_correction()` + `typical_correction_pct` من النوتبوك. إضافة بنود 25-30 لعهد الوكيل (Notebook + apply_notebook_context + Unified Exit Engine + Decision Logger + 10 Feature Flags). |


### القاعدة 43 — التليجرام كذراع إعلاني + إشعارات شاملة (TELEGRAM-NOTIFICATIONS — 2026-09-02)
> **سبب الإضافة:** توجيه المالك (2026-09-02): "التليجرام هو الذراع الإعلاني للمشروع وأهميته = أهمية الـ Frontend. لازم رسائل تقول إن السهم جاب الهدف بنسبة ربح كذا ومعاها فرح بالأيموجي. ورسالة سهم كذا قرب من الهدف خد بالك من الدعم عند كذا."

**5 أنواع إشعارات (في `vps-service/telegram/telegram_notifier.py`):**

| # | الإشعار | الترايغر | الإيموجي |
|---|---|---|---|
| 1 | `notify_target_hit` | توقع جاب الهدف | 🎉🏆🚀 (حسب حجم الربح: ≥20%=🚀, ≥10%=🏆, ≥5%=🎉) |
| 2 | `notify_approaching_target` | السهم دخل 3% من الهدف | 🔥 |
| 3 | `notify_stop_warning` | السهم قرب 5% من الستوب | ⚠️🚨 (حرج لو ≤2%) |
| 4 | `notify_trailing_profit` | توقع خرج بربح قبل الهدف (trailing stop) | 💰 |
| 5 | `notify_stop_loss` | توقع ضرب الستوب (خسارة محسوبة) | 🛑 |

**Live Monitor (`check_active_predictions_for_notifications`):**
- بـ يفحص كل التوقعات النشطة (PENDING/ACTIVE) ويرسل إشعارات قرب الهدف/الستوب.
- التشغيل: `scripts/telegram_live_monitor.py` — cron كل 15 دقيقة أثناء الجلسة (10:00-14:30 القاهرة).
- Endpoint: `POST /api/telegram/notifications/live-monitor`.

**التكامل في `daily_closer.py`:**
- عند إغلاق أي توقع → بـ يبعت الإشعار المناسب:
  - `TARGET_HIT` → `notify_target_hit` (احتفال بالأيموجي حسب الربح)
  - `TRAILING_PROFIT` → `notify_trailing_profit` (خرج بربح قبل الهدف)
  - `STOPPED` → `notify_stop_loss` (خسارة محسوبة)

**API endpoints (7):**
- `POST /api/telegram/notifications/test/target-hit` — اختبار احتفال الهدف
- `POST /api/telegram/notifications/test/approaching-target` — اختبار قرب الهدف
- `POST /api/telegram/notifications/test/stop-warning` — اختبار تحذير الستوب
- `POST /api/telegram/notifications/test/trailing-profit` — اختبار trailing
- `POST /api/telegram/notifications/test/stop-loss` — اختبار ضرب الستوب
- `POST /api/telegram/notifications/live-monitor` — تشغيل الـ monitor
- `GET /api/telegram/notifications/types` — قائمة كل الإشعارات

**المتغيرات البيئية المطلوبة:**
- `TELEGRAM_BOT_TOKEN` — Bot token من @BotFather
- `TELEGRAM_CHAT_ID` — Chat ID للقناة/المجموعة

**قواعد الرسائل (CLIENT-FACING-STYLE + NO-HYPE-LANGUAGE):**
- الاحتفال بالأيموجي مسموح (🎉🏆🚀) لأنه إشعار نجاح حقيقي.
- لكن ممنوع المبالغة: ما نقولش "حقق أحلامك!" — نقول "هدف محقق بنجاح".
- كل رسالة فيها: السهم + سعر الدخول + الهدف/الستوب + العائد + الوقت + توصية عملية.
- رسالة `approaching_target` بتقول الدعم المهم (نصف المكسب) — ده اللي طلبه المالك صراحة.

- **المرجع:** `vps-service/telegram/telegram_notifier.py` (283 LOC) + `vps-service/api/telegram_routes.py` (1,860 LOC) + `scripts/telegram_live_monitor.py`.


---

### القاعدة 44 — news.db هو المصدر الوحيد للأخبار (NEWS-DB-SOT — 2026-09-02)
> **سبب الإضافة:** توجيه المالك (2026-09-02): "أنا فيه قاعدة بيانات خاصة بالأخبار ليه الغبي ده ما يستعملهاش؟ ممكن تنقل كله إلى news.db ونشتغل منها."
> المشكلة كانت إن الأخبار كانت متوزعة على قاعدتين: `data_engine.db/market_news` + `news.db/news_articles`. ده غلط معماري.

**القاعدة الحاكمة:**
**`db/news.db` هو المصدر الوحيد للحقيقة (single source of truth) لكل الأخبار.** مفيش أي DB تاني يبقى فيه أخبار.

**الـ schema الموحدة (`market_news` table في `news.db`):**

| العمود | النوع | الوصف |
|--------|------|------|
| `id` | INTEGER PK | AUTOINCREMENT |
| `title` | TEXT NOT NULL | عنوان الخبر |
| `content` | TEXT | نص الخبر الكامل |
| `summary` | TEXT | ملخص (legacy) |
| `summary_ar` / `summary_en` | TEXT | ملخصات عربي/إنجليزي |
| `source` | TEXT | مصدر الخبر (AlphaVantage, GNews, telegram, ...) |
| `source_type` | TEXT | telegram/web/rss/copy |
| `source_url` / `url` | TEXT | الرابط الأصلي |
| `image_url` / `image_paths` | TEXT | صورة واحدة (legacy) / JSON array |
| `ocr_text` | TEXT | نص مستخرج من الصور |
| `raw_analysis` | TEXT (JSON) | تحليل Ollama الكامل |
| `market` / `market_code` | TEXT | EGX / GENERAL |
| `symbol` / `tickers` | TEXT | ticker واحد (legacy) / JSON array |
| `category` / `impact_type` | TEXT | تصنيف (earnings/dividend/ipo/...) |
| `importance` | INTEGER 0-100 | درجة الأهمية |
| `sentiment` | TEXT | bullish/bearish/neutral |
| `is_valid_news` | INTEGER | 0/1 — فلتر للأخبار غير الصالحة |
| `language` | TEXT | ar/en |
| `published_at` / `fetched_at` / `created_at` | TEXT | timestamps |
| `sent_at` / `is_sent` | TEXT / INTEGER | حالة الإرسال لـ Telegram |
| `UNIQUE(title, source)` | constraint | منع التكرار |

**التكامل مع V40.2:**

```python
# vps-service/analyzers/news_fetcher_analyzer.py
def get_news_with_impact(ticker, max_news=3):
    # 1. PRIMARY: news.db → market_news (الأخبار المحللة من News Agent)
    articles = _get_news_from_market_news_db(ticker, max_results=max_news)
    if articles:
        return _analyze_articles(articles)  # → BOOST/REDUCE/VETO/NEUTRAL
    
    # 2. FALLBACK: DuckDuckGo HTML search (لو مفيش أخبار في news.db)
    articles = fetch_news_for_ticker(ticker, max_results=max_news)
    return _analyze_articles(articles)
```

**toggle V40.2:**
- `V40_2_NEWS_IMPACT=1` → بـ يـ boost/reduce/veto التوقعات بناءً على الأخبار
- `V40_2_NEWS_IMPACT=0` (default للـ backtest safety) → الأخبار ما بتأثرش على score

**التأثير على V40.2 score:**
- `VETO` (score ≤ -2) → رفض التوقع تماماً
- `BOOST_STRONG` (+2) → score += 20
- `BOOST` (+1) → score += 10
- `REDUCE` (-1) → score -= 10

**الـ endpoints اللي بتقرأ/تكتب من news.db:**
- `POST /api/news` — News Agent يبعت خبر → يتحفظ في `news.db/market_news`
- `GET /api/news` — يقرأ من `news.db/market_news`
- `GET /api/news-feed` — يقرأ من `news.db/market_news` (و `predictions.db/news_signals` كـ fallback)
- `GET/POST/DELETE /api/admin/news` — admin management من `news.db/market_news`
- `POST /api/news/agent` (Python) — News Agent endpoint مباشر على Python backend

**الهجرة (2026-09-02):**
- 7,894 خبر من `news.db/news_articles` (legacy) → `news.db/market_news`
- 7,809 خبر من `data_engine.db/market_news` → `news.db/market_news`
- بعد dedup (UNIQUE title+source): **7,809 خبر** في `news.db/market_news`
- `news.db/news_articles` (legacy) اتمسحت (البيانات اتحفظت في backup).

**Sources count:**
- AlphaVantage: 6616 خبر
- GNews: 1090 خبر
- NewsAPI: 100 خبر
- integration_test + fallback + test: 3 أخبار

**المرجع:** `vps-service/analyzers/news_fetcher_analyzer.py` (function جديدة `_get_news_from_market_news_db`) + `src/app/api/news/route.ts` + `src/app/api/news-feed/route.ts` + `src/app/api/admin/news/route.ts`.



---

### القاعدة 45 — ربط البيانات المدفونة بـ V40.2 (SCREENER-FUNDAMENTALS-DEPTH — 2026-09-03)
> **سبب الإضافة:** توجيه المالك (2026-09-03): "انا عندى تصنيفات كتييييييير جدا لية مش بنستعملها؟" + "عندك بيانات عمق السوق الى هى عروض البيع والشراء؟"
>
> المشكلة كانت إن `data_engine/scrapers` فيها 13 scraper بتجمع بيانات ضخمة (8 قوائم تصنيف + 9 تبويبات بيانات مالية + bid/ask) بس **V40.2 مش كان بيستخدم أي منها**. V40.2 بيستخدم `V38BacktestEngine` اللي مش مربوط بـ `MasterAnalyzer` (اللي كان بيستخدم screener data بس).

**الـ module الموحّد:** `vps-service/analyzers/screener_integration.py`

**البيانات المربوطة (3 مصادر):**

| # | المصدر | DB | التأثير |
|---|--------|-----|---------|
| 1 | screener_lists (8 قوائم) | data_engine.db | unusual_volume +10, undervalued +9, most_active +8, high_dividend +6, high_net_income +5, top_gainers -6 (+VETO لو RSI>70), penny -8 (+VETO) |
| 2 | tab_valuation + tab_profitability | data_engine.db | ROE>15% + P/E<15 → +5, P/E>100 → VETO (bubble) |
| 3 | intraday_prices (bid/ask) | intraday.db | spread < 0.5% → +3 (سيولة عالية) |

**مكان الربط في V40.2:** بعد entry_gate، قبل sector-liquidity filter.
**VETO:** لو screener/fundamentals قال VETO → `continue` (رفض فوري).
**Safe-by-design:** لو أي مصدر فشل → V40.2 بيكمل بدون تأثير.

**المرجع:** `vps-service/analyzers/screener_integration.py` + `vps-service/jobs/v40_2_daily_generator.py` (سطر 1064-1120).

---

### القاعدة 46 — تنظيف قواعد البيانات الشامل (DB-CLEANUP-WAVE-1+2+3 — 2026-09-03)
> **سبب الإضافة:** توجيه المالك (2026-09-03): "لية التداخل الغبى دة واية كم الجداول الرهيب دة؟ انت كدة ريحتنى من 3 قواعد بيانات اية اخبار الباقى"
>
> المشكلة كانت إن فيه **10 DBs** بإجمالي ~345 MB، فيها DBs مش مستخدمة (custom, prices, crypto) + تكرار في البيانات (price_history.db و data_engine.db.egksco_price_history فيهم نفس الـ 162,946 rows) + 9 جداول فاضية منتشرة في 3 DBs.

**الـ 3 موجات (Waves) المنفصلة:**

#### WAVE-1: حذف 3 DBs غير مستخدمة (توفير ~37 MB)
| DB | الحجم | السبب |
|----|------|------|
| `custom.db` | 24 KB | default Prisma DB، الـ stubs كلها deprecated (بتـ route لـ stocks.db) |
| `prices.db` | 21 MB | صفر references في الكود — البيانات كلها مكررة في data_engine.db |
| `crypto.db` | 32 KB | 0 rows + dead code (unified-db.ts بـ query جدول `crypto_coins` مش موجود) |

**كمان:** cleanup لـ `src/lib/unified-db.ts` (شيل 124 سطر كود ميت: getCryptoDb + CryptoCoin interface + 3 query functions) + حذف dead endpoint `/api/unified-crypto/route.ts`.

#### WAVE-2: migration price_history readers لـ data_engine.db.egksco_price_history
**الـ migration rules:**
- `FROM price_history` → `FROM egksco_price_history`
- `ticker` → `symbol`
- `date` → `price_date`
- شيل أي filter على `source` (egksco_price_history مفيهاش source column)

**10 ملفات TS اتعملها migration:**
1. `src/lib/data-engine-db.ts` — getPriceHistoryDb() بقى alias + 3 SQL queries rewritten
2. `src/lib/data-engine-db-sqljs.ts` — getPriceHistoryDbSqlJs() بقى alias + getLastCleanClose + getHistoricalData rewritten
3. `src/lib/market-data-access.ts` — Source 3 في getAvailableTickers + getPriceHistory rewritten
4. `src/lib/new-db-queries.ts` — DB_PATHS + getPriceHistoryFromNewDb + areNewDbsAvailable + getNewDbHealth rewritten
5. `src/app/api/health/route.ts` — check على data_engine.db
6. `src/app/api/admin/db-health/route.ts` — probe egksco_price_history
7. `src/app/api/admin/engines-status/route.ts` — MAX(price_date) من egksco_price_history
8. `src/app/api/data-engine/health/route.ts` — probe table egksco_price_history
9. `src/app/api/data-engine/status/route.ts` — COUNT(*) FROM egksco_price_history
10. `src/app/api/chart/[ticker]/route.ts` — fallback query rewritten

#### WAVE-3: drop 9 جداول فاضية + VACUUM (توفير ~4.5 MB)
| DB | الجداول اللي اتمسحت |
|----|---------------------|
| `stocks.db` | maestro_personas, ticker_performance, trading_lessons, trading_rules |
| `predictions.db` | CachedAnalysis, TechnicalIndicator (camelCase duplicates) |
| `auth.db` | optimized_parameters, platform_recommendations, user_trades |

VACUUM اتعمل لـ 3 DBs (stocks.db, predictions.db, auth.db).

**النتيجة النهائية:**
- **7 DBs** بدل 10 (توفير ~41.5 MB)
- **9 جداول أقل**
- **123 سطر كود ميت أقل**
- `price_history.db` محتفظ بيه كـ **safety net فقط** (الكود بـ reads من data_engine.db.egksco_price_history)
- كل الـ API routes بـ 200 OK
- Lint بدون أخطاء
- Backtest محترم اشتغل بـ 68 trade (PF=1.19, Return=+1.35%)
- 10 توقعات جديدة بناءً على screener + fundamentals + ATR + RSI + volume

**الـ scripts المساعدة:**
- `scripts/restore-and-clean.py` — استرجاع DBs من data/all.zip + تنظيف تلقائي
- `scripts/migrate-news-table.py` — migration news_articles → market_news
- `scripts/drop-safe-tables.py` — drop الجداول الفاضية + VACUUM
- `scripts/v40_2_treasures_backtest.py` — backtest بـ الكنوز المدفونة
- `scripts/v40_2_build_predictions.py` — بناء توقعات جديدة

**الـ backup:** محفوظ في `backups/db-cleanup-20260903-163211/` (331 MB — كل الـ DBs الـ 10 قبل التنظيف).

**المرجع:** `worklog.md` (Task IDs: WAVE-1a, WAVE-1b, WAVE-1c, WAVE-2a-2c, WAVE-3, SANDBOX-RESTART-DATA-LOSS, BACKTEST-AND-PREDICTIONS-FINAL).

---

### القاعدة 47 — دمج news-agent submodule (NEWS-AGENT-INTEGRATION — 2026-09-03)
> **سبب الإضافة:** توجيه المالك (2026-09-03): "خد المشروع عندك عالشان يكون جزء من المشروع بتاعنا أعتقد ممكن تدمجة مع محرك البيانات"

دمج [news repo](https://github.com/enmohsen20111975/news/) كـ submodule جوه المشروع الرئيسي في `news-agent/`.

**الـ scrapers النشطة (تكتب في db/ بتاعنا):**
1. `tradingview_rest.py` — scanner.tradingview.com (REST API، urllib فقط، 296 سهم في <1 ثانية)
2. `tradingview_screener_lists.py` — screener lists (1,459 entries)
3. `tradingview_market_movers.py` — 9 tabs market movers
4. `egx_news_scraper.py` — EGX official site → `news.db.market_news`
5. `marketmaker_news_scraper.py` — MarketMaker → `news.db.market_news`
6. `telegram_collector.py` — Telegram channels → `news.db.market_news` (محتاج telethon)

**الـ scrapers المعطّلة (محتفظ بيها، مش نشطة):**
- `rss_collector.py.disabled` — محتاج `feedparser`
- `investing_scraper.py.disabled` — محتاج Playwright + chromium
- `investing_news_collector.py.disabled` — محتاج Playwright + chromium

**Rule 28 (NO-DUPLICATION):** كل الـ scrapers بتكتب في `/home/z/my-project/db/` (الـ canonical). مفيش DBs مكررة في `news-agent/`.

**Rule 29 (UNIFIED-SYSTEM):** `news-agent/config/paths.py` بيوفّر مسارات موحدة لكل الـ scrapers.

**news merge:** 212 خبر من news-agent القديم ادمجت في `db/news.db.market_news` (الإجمالي دلوقتي 8,012 خبر).

**AI محلي معطّل:** المشروع الأصلي كان بيستخدم Ollama. إحنا مش محتاجينه — V40.2 بيعتمد على rules + indicators.

**الـ backup:** DBs الأصلية لـ news-agent محفوظة في `news-agent/_disabled_dbs/` (للرجوع فقط).

**المرجع:** `news-agent/README.md` + `news-agent/config/paths.py`

---

### القاعدة 48 — استبدال APIs الخارجية بـ APIs مجانية مرخّصة (FREE-LICENSED-APIs — 2026-09-03)
> **سبب الإضافة:** توجيه المالك (2026-09-03): "لية نعمل سكراب وأحنا عندنا API free"

استبدال الـ scrapers اللي بتستخدم APIs مدفوعة/غير موثوقة بـ APIs مجانية مرخّصة من مصادر مصرية رسمية.

#### الـ APIs الجديدة (مجانية + مفتوحة المصدر + بدون مفتاح):

| API | المصدر | البيانات | الحد |
|-----|--------|----------|------|
| `getdaleelak.com/api/v1/feed.json` | مصادر مصرية مرخّصة (بنوك + تجار معتمدين) | عملات (13) + معادن (10) + أحسن جهة بيع/شرا + تقييم اليوم | 240 طلب/دقيقة |
| `api.frankfurter.dev/v2/rates?providers=CBE` | Central Bank of Egypt (CBE) | 19 عملة vs EUR | غير محدود (مفتوح) |
| `api.isagha.com` | isagha.com | أسعار الذهب بالعيارات (24K, 21K, 18K, Oz) | غير محدود |

#### الـ APIs الملغاة (في `data_engine/scrapers/metals_forex_fetcher.py`):

| API القديم | السبب | البديل |
|-----------|------|--------|
| `api.metals.live/v1/spot/gold` | غير موثوق + مش مرخّص | Daleelak API (metals category) |
| `api.metals.live/v1/spot/silver` | غير موثوق + مش مرخّص | Daleelak API (metals category) |
| `forex-data.p.rapidapi.com/metal/gold` | محتاج مفتاح RapidAPI | Daleelak API |
| `api.exchangerate-api.com/v4/latest/USD` | غير مرخّص مصري | Daleelak (primary) + Frankfurter CBE (fallback) |

#### الـ fallback chain (Rule 24: SAFE-BY-DESIGN):

1. **Primary**: Daleelak API (مصادر مصرية مرخّصة)
2. **Fallback 1**: Frankfurter.dev CBE (للعملات فقط)
3. **Fallback 2**: isagha.com (للذهب فقط)
4. **Fallback 3**: hardcoded values (للحالات الطارئة)

#### الـ artifacts:
- `news-agent/collectors/scrappers/daleelak_api.py` — scraper جديد ( Daleelak + Frankfurter + isagha)
- `data_engine/scrapers/metals_forex_fetcher.py` — migration (3 functions اتعدّلوا)
- `data_engine/scrapers/metals_forex_fetcher.py.original` — backup

#### النتايج (بعد الـ migration):
- **Gold**: 7,374.76 USD/ounce (from Daleelak gold-24k)
- **Silver**: 110.37 USD/ounce (from Daleelak silver-999)
- **Exchange rates**: 14 currency (from Daleelak — USD, EUR, GBP, SAR, AED, KWD, CAD, AUD, QAR, OMR, ...)
- **كل الـ APIs مجانية** + **بدون مفتاح** + **مرخّصة مصرياً**

**المرجع:** `news-agent/collectors/scrappers/daleelak_api.py` + `data_engine/scrapers/metals_forex_fetcher.py`

---

### القاعدة 49 — نظام التوقعات المزدوج (DUAL-TRACK-PREDICTIONS — 2026-09-24)
> **سبب الإضافة:** معدل المكاسب على السرفر الإنتاجي كان ضعيفاً (~40% perceived) رغم وجود بيانات تاريخية ضخمة (13K صفقة، 1,365 توقع EGX). الحل: تقسيم التوقعات لمسارين — المسار A (تحليل كامل متوازن) + المسار B (سيولة مؤسسية استثنائية فقط).

**الفلسفة:**
- **المسار A (full_analysis):** نفس منطق V40.2 الحالي — تحليل فني + مالي + سيولة متوازنة، حد أقصى 5 توقعات يومياً.
- **المسار B (liquidity):** سيولة مؤسسية استثنائية فقط (بلا حد)، بشروط صارمة:
  - `volume >= dynamic_threshold` (p75 آخر 30 يوم)
  - `volume >= 2× avg_volume_20` (momentum)
  - `buy_pressure >= 80%` (لو buy_volume متوفر)
  - `net_flow > 0` (تدفق موجب)
  - السوق مؤهل من الـ backtest (hit_rate ≥ 65%)

**الكفاءة المجمّعة:**
```
combined_efficiency = (win_rate_A × 0.4) + (win_rate_B × 0.6)
```
المسار B يأخذ وزن أعلى (0.6) لأن إشاراته أندر وأقوى.

**الـ artifacts (مرفوعة على GitHub):**

| الملف | الدور |
|---|---|
| `vps-service/scripts/liquidity_backtest_engine.py` | Backtest حقيقي: لكل يوم volume >= p75، هل السعر طلع >= 1.5% في 5 أيام؟ |
| `vps-service/scripts/dual_track_generator.py` | يولّد توقعات `track='liquidity'` بشروط صارمة |
| `src/app/api/predictions/dual-track/threshold/route.ts` | يحسب p75 لكل سوق + يحفظ في `liquidity_dynamic_threshold` |
| `src/app/api/predictions/dual-track/list/route.ts` | يعرض التوقعات مع `track_label` (📊 / 💧) |
| `src/app/api/predictions/dual-track/stats/route.ts` | يحسب combined_efficiency + Track A/B win_rate |
| `src/app/api/predictions/dual-track/backtest/route.ts` | يشغّل Python script ويرجع النتائج |
| `src/components/predictions/DualTrackPredictionsView.tsx` | Frontend view: tabs + hero card + run backtest button |

**DB Schema additions (predictions.db):**
- `track TEXT DEFAULT 'full_analysis'` على `predictions` + `aiPrediction` + `persona_predictions`
- جدول `liquidity_backtest_results` — نتائج الـ backtest لكل سوق/ticker
- جدول `liquidity_dynamic_threshold` — threshold يومي ديناميكي
- جدول `liquidity_signal_outcomes` — outcomes الـ signals الفردية

**الـ Route:** `#dual-track` (tab جديد في الـ nav مع التوقعات)

**شروط التشغيل على الـ VPS:**
1. الـ DBs الإنتاجية لازم تكون في `db/` (intraday.db, price_history.db, predictions.db, data_engine.db)
2. تشغيل `python3 vps-service/scripts/liquidity_backtest_engine.py --execute` مرة واحدة (يحسب threshold + backtest)
3. إضافة cron يومي لتشغيل `dual_track_generator.py --execute` بعد إغلاق السوق
4. إضافة cron أسبوعي لإعادة تشغيل الـ backtest (يحدث qualified status)

**التحقق الذاتي الإلزامي:**
- `/api/predictions/dual-track/threshold?market=all` → لازم يرجع `threshold_value > 0` لكل سوق
- `/api/predictions/dual-track/stats` → لازم يرجع `combined_efficiency` رقم
- `/api/predictions/dual-track/backtest?market=EGX&execute=1` → لازم يرجع `results[0].total_signals > 0`
- لو أي endpoint رجع `fallback_used: true` → الـ DBs مش متاحة، لازم يتصلح الأول

---

*نهاية التحديثات 2026-09-24 — القاعدة 49 (DUAL-TRACK-PREDICTIONS).*

---

### القاعدة 50 — MONEY-AS-CUSTOMER-LIFE (محفظة العميل = أهم حاجة في حياته — 2026-09-24)
> **سبب الإضافة:** فحص خبير إدارة الأموال كشف إن 6 endpoints حرجة كانت ترجع **بيانات وهمية هاردكود** (5 أسهم خيالية: COMI/ABUK/EAST/SWDY/HRHO) بدلاً من قراءة محفظة العميل الحقيقية. هذا **انتهاك أخلاقي** لمعيار "فلوس العميل = أهم حاجة في حياته".

**القاعدة الذهبية المطلقة:** أي رقم يظهر للعميل في شاشات المحفظة/الثروة/التنبيهات لازم يكون **رقم حقيقي من الـ DB**. ممنوع منعاً باتاً عرض:
- بيانات هاردكود (mock data) كأنها بيانات حقيقية للعميل
- نسب قطاعات ثابتة (42%/25%/18%/15%) بدلاً من حسابها من portfolio_assets
- تنبيهات "شكلية" بدون فحص فعلي للأسعار
- توصيات إنقاذ/زيادة بدون قراءة الـ PnL الحقيقي للعميل

**الـ Endpoints الحرجة (تم إصلاحها في commits 6cda299..6292b96):**

Tier 1 — إيقاف الكذب على العميل:
- `/api/portfolio/holdings` → يقرأ من `portfolio_assets` (REAL holdings + live prices)
- `/api/portfolio/watchlists` → يقرأ من `user_stock_watchlists` (REAL watchlist)
- `/api/portfolio/bag-holder-rescue` → fallback حقيقي يقرأ أكبر خاسر + يولّد توصية Hold/Average-Down/Cut-Loss
- `/api/portfolio/smart-monitor/signals` → multi-factor signal (HOLD/TAKE_PROFIT/STOP_LOSS/BUY_MORE) من PnL الحقيقي
- `/api/portfolio/risk-summary` → يحسب نسب القطاعات من `portfolio_assets JOIN stocks.sector` + يحسب portfolio_heat
- `WealthCharts.tsx` → بيقرأ من `/api/portfolio/equity-curve` (REAL wealth_tracking snapshots)

Tier 2 — محرك التنبيهات الموحّد:
- `src/lib/schedulers/alert-engine.ts` — 3 functions: `runStockAlertsCheck` + `runGoldAlertsCheck` + `runPortfolioPnLCheck` + `runAllAlerts`
- `/api/alerts/scheduler` — يطلق الـ engine كل 60s (frontend polling)
- `/api/notifications` — يقرأ `user_notifications` مع ALTER TABLE لـ legacy schemas
- `/api/alerts/gold` — CRUD لتنبيهات الذهب (karat 24/21/18 + threshold)
- `/api/finance/seed-alert-thresholds` — يزرع ±5% thresholds لكل الأسهم
- `TopUpRecommendationsPanel.tsx` — جديد، يعرض الأسهم الرابحة ≥ 10%
- `NotificationCenter.tsx` — polling كل 60s + يطلق scheduler tick + صوت beep عند التنبيه الجديد

**محرك التنبيهات (`alert-engine.ts`):**
- `runStockAlertsCheck(userId)` — يفحص `user_stock_watchlists.alert_price_above/below` مقابل `stocks.current_price`
- `runGoldAlertsCheck(userId)` — يفحص `gold_alerts` مقابل `getLiveEgyptGoldPrices()` (229K صف في data_engine.db)
- `runPortfolioPnLCheck(userId)` — يفحص `portfolio_assets`:
  - لو سهم خسران > 10% → يطلق `bag_holder_warning` (severity: danger)
  - لو سهم رابح > 15% → يطلق `top_up_opportunity` (severity: success)
- منع التكرار: `WHERE created_at > datetime('now', '-24 hours')` بنفس (user_id, type, ticker, message)

**الـ Disclaimer الإلزامي:** كل توصية (Hold/Cut-Loss/Top-Up/Average-Down) لازم ترفق بـ:
> "⚠️ توصية آلية مبنية على بيانات تاريخية. ليست نصيحة استثمارية مرخصة. استشر مستشاراً مالياً مرخّصاً قبل أي قرار."

هذا يحمي المنصة قانونياً أمام FRA (Financial Regulatory Authority) المصرية.

**التحقق الذاتي الإلزامي (لكل PR جديد يلمس المحفظة):**
1. `curl /api/portfolio/holdings?user_id=<real_user>` → لازم يرجع `source: sqlite_fallback` و `total_items > 0` (مش mock)
2. `curl /api/alerts/scheduler?only_me=1 -X POST` → لازم يرجع `total >= 0` (مش 503)
3. `curl /api/notifications?user_id=<real_user>` → لازم يرجع `notifications: [...]` (مش error)
4. لو أي endpoint رجع hardcoded data → PR **مرفوض** فوراً.

---

*نهاية التحديثات 2026-09-24 — القاعدة 50 (MONEY-AS-CUSTOMER-LIFE).*

---

### القاعدة 51 — MULTI-MARKET-DUAL-TRACK (نظام التوقعات المزدوج متعدد الأسواق — 2026-09-24)
> **سبب الإضافة:** الخطة المعمارية الشاملة بتحدد إن كل سوق له شروط تداول مختلفة (حدود سعرية، فترات احتفاظ، شروط سيولة). التطبيق الموحد يقلل الكفاءة. الحل: MARKET_CONFIG dictionary يطبق شروط كل سوق بشكل مستقل.

**مصفوفة سياسات الأسواق (Market Matrix):**

| السوق | Target | Stop | Holding | شروط إشارة المسار B | Hit Rate المثبت |
|---|---|---|---|---|---|
| 🇪🇬 EGX | +2.5% | -2.0% | 5d | Volume ≥ p75 + 1.5×Avg20 + شمعة خضراء | **80.53%** |
| 🇸🇦 KSA | +2.0% | -1.8% | 5d | نفس EGX + صافي سيولة موجب | **83.24%** |
| 🇺🇸 US | +3.0% | -1.5% (ATR) | 5d | Volume ≥ p75 + 1.5×Avg20 + شمعة خضراء | **69.69-73.55%** |
| 🪙 CRYPTO | +3.0% | -2.5% | 4d | Volume ≥ p75 + change_24h ≥ +2.0% | **80.19%** |
| 🥇 GOLD | +1.5% | -1.5% | 7d | تجاوز SMA(10) + زخم الأونصة صاعد | **78.40%** |

**الـ artifacts المُحدّثة (commits 1b7e13e..678c7a2):**

| الملف | التحديث |
|---|---|
| `vps-service/scripts/liquidity_backtest_engine.py` | + MARKET_CONFIG dict (5 أسواق) + دعم CRYPTO (crypto_prices) + GOLD (gold_prices_clean) + معادلة نجاح 3-way (hit/stop/expire) |
| `vps-service/scripts/dual_track_generator.py` | + MARKET_CONFIG dict + دعم CRYPTO + GOLD في load_recent_market_liquidity + filter_track_b_candidates بـ market param |
| `src/app/api/predictions/dual-track/threshold/route.ts` | + CRYPTO (crypto_prices.total_volume) + GOLD (gold_prices_clean.price_per_gram) |

**معادلة النجاح (Profit Reach Logic):**
```python
# ممنوع مقارنة إغلاق اليوم الخامس فقط
# لازم فحص أعلى سعر خلال نافذة الـ N أيام:
target_price = entry_price * (1.0 + target_pct / 100.0)
stop_price = entry_price * (1.0 - stop_pct / 100.0)
future_highs = [r['high'] for r in ticker_rows[i+1 : i+1+holding_days]]
future_lows = [r['low'] for r in ticker_rows[i+1 : i+1+holding_days]]

if max(future_highs) >= target_price:
    hit = 1  # HIT — exit at target
elif min(future_lows) <= stop_price:
    hit = 0  # MISS — stopped out
else:
    hit = 0  # MISS — expired at close
```

**شروط إشارة المسار B حسب السوق:**
- 🇪🇬 EGX: Volume ≥ p75 + Volume ≥ 1.5×Avg20 + **شمعة خضراء (Close ≥ Open)** — تجميع مش تصريف
- 🇸🇦 KSA: نفس EGX + **صافي سيولة موجب**
- 🇺🇸 US: Volume ≥ p75 + Volume ≥ 1.5×Avg20 + **وقف خسارة ديناميكي (1.5×ATR)**
- 🪙 CRYPTO: Volume ≥ p75 + **change_24h ≥ +2.0%** (زخم إيجابي إلزامي) — تجنّب طفرات الحجم في البيع الهلعي
- 🥇 GOLD: **تجاوز متوسط سعر 10 أيام (SMA10)** + زخم الأونصة العالمية صاعد

**مصادر البيانات (Data Routing):**
- الأسهم (EGX/KSA/US): `db/price_history.db` (سلاسل بيانات طويلة)
- الكريبتو: `db/data_engine.db.crypto_prices` (437K صف، 93 عملة)
- الذهب: `db/data_engine.db.gold_prices_clean` (231K صف)
- Fallback: `db/intraday.db` للـ EGX، `db/data_engine.db.historical_data` للـ KSA

**معالجة الحجم النصي (Safe Volume Parsing):**
```python
def parse_volume(v) -> int:
    # تنظيف '2.56 M' و '1.64 K' و \u202f و الأصفار
    v_str = str(v).replace('\u202f', '').replace(' ', '').replace(',', '').strip().upper()
    if v_str.endswith('B'): return int(float(v_str[:-1]) * 1_000_000_000)
    if v_str.endswith('M'): return int(float(v_str[:-1]) * 1_000_000)
    if v_str.endswith('K'): return int(float(v_str[:-1]) * 1_000)
    return int(float(v_str))
```

**شرط التأهيل (Qualification Gate):**
```
hit_rate ≥ 65.0% AND total_signals ≥ 30
```

**Combined Efficiency:**
```
combined_efficiency = (win_rate_A × 0.40) + (win_rate_B × 0.60)
```

**التحقق الذاتي الإلزامي:**
1. `python3 vps-service/scripts/liquidity_backtest_engine.py --execute` → لازم يرجع `qualified=1` لكل سوق
2. `/api/predictions/dual-track/threshold?market=all` → لازم يرجع 5 markets
3. `/api/predictions/dual-track/stats` → لازم يرجع `combined_efficiency` رقم
4. لو أي سوق `qualified=0` → ما يتفعّلش المسار B له

---

*نهاية التحديثات 2026-09-24 — القاعدة 51 (MULTI-MARKET-DUAL-TRACK).*

---

### القاعدة 52 — العناصر الموحدة لإعادة الاستخدام (UNIFIED-REUSABLE-COMPONENTS — 2026-09-25)

> **سبب الإضافة:** توجيه صريح من المالك (2026-09-25): "انت لية مستعملتش عنصر الجدول الموحد فى كل مكان فى المشروع بمعنى فعلياً فى كل مكان وأى مكان فية جدول استبدله. وانت لية مش مستخدم العنصر الموحد للنشر فى كل مكان داخل المشروع ويكون فية كل الى موجود فى عنصر النشر الى فى شاشة الأخبار". المنصة كتلة واحدة — كل شاشة لازم تستخدم نفس العناصر الموحدة، مش كل شاشة تبني element خاص بها.

**أ. الجدول الموحد (UnifiedTable):**
- **المكوّن:** `src/components/shared/UnifiedTable.tsx` — جدول generic قابل لإعادة الاستخدام.
- **الاستخدام الإلزامي:** أي شاشة فيها جدول بيانات (توقعات، قطاعات، أسهم، توصيات، محفظة، إلخ) **لازم** تستخدم `<UnifiedTable>` بدل بناء `<Table><TableHeader>...` يدوياً.
- **الميزات:** loading skeleton، empty state عربي، sticky header، sortable columns، horizontal scroll، custom scrollbar، row hover/click، dense mode، RTL.
- **الاستثناءات الوحيدة:** الجداول اللي فيها expandable rows أو features خاصة جداً (مثل sectors-tracking table اللي بيتوسّع كل row) — بس حتى دي لازم تتـ refactored لما UnifiedTable يدعم expansion.

**ب. زر النشر الموحد (UnifiedPublishButton):**
- **المكوّن:** `src/components/shared/UnifiedPublishButton.tsx` — زر نشر dropdown فيه كل منصات النشر.
- **الاستخدام الإلزامي:** أي شاشة فيها محتوى قابل للنشر (توقعات، تقارير، أخبار، تحليلات، dashboard) **لازم** تستخدم `<UnifiedPublishButton>` بدل بناء أزرار مشاركة منفصلة.
- **المنصات المدعومة:** Telegram + Facebook + WhatsApp + Twitter + LinkedIn + Copy + Image export (PNG). ده نفس الـ feature set بتاع شاشة الأخبار.
- **الـ split mode:** لو الشاشة محتاجة أزرار منفصلة، استخدم `<UnifiedPublishButton split />`.

**ج. قاعدة عدم التكرار في الـ UI Components:**
- **ممنوع** إنشاء component جديد بنفس وظيفة component موجود. لو محتاج جدول → `UnifiedTable`. لو محتاج نشر → `UnifiedPublishButton`. لو محتاج بحث عن سهم → `StockSearchSelector`. لو محتاج تبديل سوق → `ExchangeSelector`.
- قبل بناء أي component جديد، اسأل: "هل فيه component موجود بـ يعمل ده؟" (Grep في `src/components/shared/`).

---

### القاعدة 53 — دمج الكريبتو في الأسواق (CRYPTO-IN-MARKETS — 2026-09-25)

> **سبب الإضافة:** توجيه صريح من المالك (2026-09-25): "فى قائمة المزيد يوجد العديد من صفحات الكريبتو فى حين انى امرتك تدمج الكريبتو داخل الأسواق". الكريبتو سوق مثل أي سوق آخر — يُختار من مبدّل الأسواق (Market Switcher)، مش من قائمة منفصلة.

- **مبدّل الأسواق (ExchangeSelector في TopBar):** هو الطريق الوحيد للتبديل بين الأسواق (EGX/TADAWUL/KSE/QSE/CRYPTO). لما السوق = CRYPTO، كل شاشات السوق (stocks، trading-chart، recommendations، إلخ) بتعمل mirror تلقائياً وتعرض بيانات الكريبتو (UI-Mirror Protocol).
- **قائمة "المزيد" (TopBar → المزيد):** **ممنوع** وضع أي إدخالات crypto منفصلة (crypto، crypto-live، crypto-recommendations، crypto-trading-chart، crypto-screener، crypto-analysis، crypto-learning، crypto-simulation). كل دي اتشالت من القائمة في 2026-09-25.
- **deep links:** الـ hash routes القديمة (مثلاً `#crypto-trading-chart`) لسه شغّالة كـ redirects للـ unified view المناسب (عشان الـ backwards compatibility مع الـ Flutter app) — بس مش معروضة في الـ UI.
- **الاستثناء الوحيد:** ودجت "إشارات الكريبتو" على الداشبورد — بتظهر بس لما `currentMarket === 'CRYPTO'` كجزء من الـ widget registry (مش قائمة منفصلة).

---

*نهاية التحديثات 2026-09-25 — القواعد 52 (UNIFIED-REUSABLE-COMPONENTS) + 53 (CRYPTO-IN-MARKETS).*
# ⚖️ التوثيق القانوني — حماية المنصة من مسؤولية "توصية استثمارية"

> **هذا الملف يوثق كل الإجراءات القانونية المتخذة لحماية المنصة.**
> **آخر تحديث:** 2026-09-01 (إضافة قسم "تحديث 2026-09-01: المراجعة القانونية للموديولات الجديدة")
> **آخر تحديث سابق:** 2026-08-30
> **الحالة:** ✅ المنصة محمية قانونياً

---

## 🚨 المشكلة القانونية الأصلية

### الخطر:
حسب **قانون هيئة الرقابة المالية المصرية (FRA)** و**قواعد السلوك المهني للأوراق المالية**، أي منصة بتقدم "توصية استثمارية" بدون ترخيص مالي مرخص بتعرض صاحبها لـ:
- ✋ غرامات مالية كبيرة
- ✋ سجن
- ✋ إغلاق المنصة
- ✋ مسؤولية مدنية عن خسائر العملاء

### المشاكل اللي اكتُشفت في الـ Audit:

| المشكلة | العدد | الخطورة |
|---------|------|---------|
| كلمة "توصية" في الكود | 69 مرة في 30 ملف | 🔴 حرج |
| كلمة "مضمون" | 15 مرة | 🔴 حرج (توقيع سجن) |
| "نصيحة استثمارية" | 17 مرة | 🟠 مهم |
| **"8% سنوياً مضمون"** | 1 مرة | 🔴🔴 سجن محتمل |
| **"صفقات قليلة لكن مضمونة"** | 1 مرة | 🔴🔴 سجن محتمل |

---

## ✅ الحلول المُنفَذة

### 1. إزالة كل كلمات "مضمون" الخطيرة

| الملف | قبل | بعد |
|------|------|-----|
| `DynamicRiskProfilerModal.tsx` | "8% سنوياً مضمون" | "8% سنوياً عائد ثابت (شهادات إيداع)" |
| `SuperLearningSystem.tsx` | "صفقات قليلة لكن مضمونة" | "صفقات قليلة ومدروسة المخاطر" |
| `AboutView.tsx` | "سيولة حقيقية مضمونة" | "سيولة حقيقية موثقة" |
| `RiskProfilerQuiz.tsx` | "عائد ثابت ومضمون" | "عائد ثابت" |

### 2. استبدال "توصية" بـ "توقع" في كل المشروع

- **69 occurrence → 0** (ما عدا DisclaimerBanner — مطلوب قانونياً)
- في كل `src/components` + `src/lib` + `src/app`
- أمثلة:
  - "توصية غلط" → "توقع خاطئ"
  - "توصية صحيحة" → "توقع صحيح"
  - "التوصية الحالية" → "التوقع الحالي"
  - "تاريخ التوصية" → "تاريخ التوقع"
  - "بطاقة إثبات التوصية" → "بطاقة إثبات التوقع"
  - "توصية عامة" → "إشارة عامة"
  - "توصية إدارة" → "إشارة إدارة"

### 3. DisclaimerBanner أقوى (3 components)

**الملف:** `src/components/legal/DisclaimerBanner.tsx`

#### Component 1: DisclaimerBanner (top banner)
- يظهر في أعلى كل صفحة
- قابل للـ dismiss (sessionStorage)
- النص الكامل:

> ⚠️ إخلاء مسؤولية قانوني: هذه المنصة تقدم **رأيًا شخصيًا آليًا** لأغراض تعليمية وتحليلية فقط، وليست **توصية استثمارية** أو نصيحة مالية. القرار النهائي مسؤولية العميل وحده.
>
> لا يوجد أي ضمان للنتائج. السوق يحتوي على مخاطر، والخسارة ممكنة. استشر مستشارًا ماليًا مرخصًا قبل أي قرار استثماري.

#### Component 2: LegalDisclaimerFooter (ثابت)
- يظهر في أسفل كل شاشات التوقعات/التحليل
- **مش قابل للـ dismiss** — لازم يفضل ظاهر دايماً
- النص:

> **إخلاء مسؤولية:** المنصة تقدم رأيًا شخصيًا آليًا لأغراض تعليمية وتحليلية فقط، وليست توصية استثمارية أو نصيحة مالية. القرار مسؤولية العميل وحده. لا يوجد ضمان للنتائج، والخسارة ممكنة. استشر مستشارًا ماليًا مرخصًا قبل أي قرار.

#### Component 3: InlineDisclaimer (compact)
- يظهر جوه البطاقات والشاشات الفردية
- compact + concise

### 4. LegalDisclaimerFooter في كل الشاشات الحرجة

| الشاشة | الملف | الحالة |
|--------|------|--------|
| فلتر العملات الرقمية | `CryptoScreenerView.tsx` | ✅ |
| تتبع توقعات الكريبتو | `CryptoPredictionTrackingView.tsx` | ✅ |
| التحليل المتقدم للعملات | `CryptoAdvancedAnalysisView.tsx` | ✅ |
| شارت العملات | `CryptoTradingChartView.tsx` | ✅ |
| فلتر الأسهم المتقدمة | `StockScreenerAdvanced.tsx` | ✅ |
| كل الصفحات (Footer) | `Footer.tsx` | ✅ |

### 5. تحديث Footer.tsx

**قبل:**
> المنصة لأغراض تعليمية وتحليلية فقط. المحتوى لا يُعد تحليل استثمارية أو نصيحة مالية. استشر متخصصًا ماليًا قبل اتخاذ أي قرار استثمار.

**بعد:**
> **إخلاء مسؤولية:** المنصة تقدم رأيًا شخصيًا آليًا لأغراض تعليمية وتحليلية فقط، وليست توصية استثمارية أو نصيحة مالية. القرار مسؤولية العميل وحده. لا يوجد ضمان للنتائج، والخسارة ممكنة. استشر مستشارًا ماليًا مرخصًا قبل أي قرار.

### 6. إصلاح أخطاء نحوية
- "تحليل استثمارية" → "توصية استثمارية" (النص القديم كان فيه خطأ نحوي)

---

## 📜 النص القانوني المعتمد

### النص الكامل (يظهر في DisclaimerBanner):

```
⚠️ إخلاء مسؤولية قانوني

هذه المنصة تقدم رأيًا شخصيًا آليًا لأغراض تعليمية وتحليلية فقط، وليست
توصية استثمارية أو نصيحة مالية. القرار النهائي مسؤولية العميل وحده.

لا يوجد أي ضمان للنتائج. السوق يحتوي على مخاطر، والخسارة ممكنة.
استشر مستشارًا ماليًا مرخصًا قبل أي قرار استثماري.
```

### النص المختصر (يظهر في Footer + InlineDisclaimer):

```
إخلاء مسؤولية: المنصة تقدم رأيًا شخصيًا آليًا لأغراض تعليمية وتحليلية
فقط، وليست توصية استثمارية. القرار مسؤولية العميل وحده.
لا يوجد ضمان للنتائج، والخسارة ممكنة.
```

### النص المختصر جداً (compact):

```
رأي آلي تعليمي — ليس توصية استثمارية. القرار مسؤوليتك.
```

---

## 🔑 المبادئ القانونية المعتمدة

1. **"رأي شخصي آلي"** — المنصة بتقدم رأي، مش توصية
2. **"القرار مسؤولية العميل"** — العميل هو اللي بياخد القرار
3. **"لا يوجد ضمان للنتائج"** — مفيش ربح مضمون
4. **"الخسارة ممكنة"** — الاعتراف بالمخاطر
5. **"استشار مستشار مالي مرخص"** — التوجيه للاستشارة المهنية

---

## 🚫 الكلمات الممنوعة في المنصة

| الكلمة | السبب | البديل |
|--------|------|--------|
| توصية | معناها قانوني محدد | توقع / إشارة / تحليل |
| مضمون | لا يوجد ضمان في الاستثمار | مدروس / موثق |
| نصيحة استثمارية | محتاجة ترخيص | رأي شخصي آلي |
| ربح مضمون | مستحيل في الاستثمار | عائد متوقع |
| بدون مخاطر | كذب | مخاطر مدروسة |
| آمن 100% | كذب | مخاطر محسوبة |

---

## 📋 الـ Commits على GitHub

| Commit | التاريخ | الوصف |
|--------|---------|-------|
| `c350a4f9` LEGAL-AUDIT | 2026-08-30 | حماية قانونية شاملة |

---

## ✅ التحقق النهائي

- **lint:** EXIT 0 ✅
- **عدد "توصية" المتبقية:** 0 (ما عدا DisclaimerBanner — مطلوب قانونياً) ✅
- **عدد "مضمون" المتبقية:** 0 ✅
- **DisclaimerBanner في كل الصفحات:** ✅
- **LegalDisclaimerFooter في كل الشاشات الحرجة:** ✅
- **Footer محدَث بنص قانوني أقوى:** ✅

---

**المنصة محمية قانونياً.** ✅

---

## 🆕 تحديث 2026-09-01: المراجعة القانونية للموديولات الجديدة

> **السياق:** أُضيفت 12 موديول Python جديد (~6,594 LOC) + 259 ملف JSON + 7 API endpoints + NotebookAdminTab.tsx + 10 Feature Flags. تم فحصها قانونياً للتأكد من عدم وجود كلمات تخالف FRA.

### الفحص القانوني للموديولات الجديدة

| الـ module | الفحص | النتيجة |
|---|---|---|
| `egx_disclosure_engine.py` | كلمات: "VETO", "hard reject", "score", "disclosure" | ✅ محايد قانونياً — مصطلحات تقنية داخلية (مش للعميل) |
| `strict_entry_filters.py` | كلمات: "Don't Chase", "REJECT", "ACCEPT" | ✅ محايد — logic داخلي |
| `short_holding_exit.py` | كلمات: "force_exit", "compound_breakdown", "early_drop" | ✅ محايد — logic داخلي |
| `unified_exit_engine.py` | كلمات: "MARKET_PROFILES", "evaluate_unified_force_exit" | ✅ محايد — logic داخلي |
| `stock_notebook.py` | كلمات: "machine_summary", "danger_level", "typical_correction_pct" | ✅ محايد — logic داخلي |
| `decision_logger.py` | كلمات: "log_decision", "reason_code", "reject_entry" | ✅ محايد — logic داخلي |
| `news_fetcher_analyzer.py` | كلمات: "sentiment", "score", "VETO" | ✅ محايد — logic داخلي |
| `news_impact_scorer.py` | كلمات: "BOOST", "REDUCE", "VETO", "verdict" | ✅ محايد — logic داخلي |
| `crypto_*.py` (4 modules) | نفس فحص الـ EGX counterparts | ✅ محايد |
| `api/notebook_routes.py` | كلمات: "refresh", "build-all", "lesson" | ✅ محايد — admin endpoints |
| `NotebookAdminTab.tsx` | شاشة أدمن (مش للعميل) — Rule 30 تسمح بأسلوب تقني | ✅ محايد |
| `ai/news_signals_reader.py` | كلمات: "bias", "apply_news_bias_to_score" | ✅ محايد — logic داخلي |

### DisclaimerBanner + LegalDisclaimerFooter

- ✅ الـ DisclaimerBanner ما اتعدّلش — لسه موجود في كل الصفحات.
- ✅ الـ LegalDisclaimerFooter لسه موجود في كل الشاشات الحرجة.
- ✅ الـ Footer الـ sticky لسه فيه النص القانوني القوي.
- ⚠️ **ملاحظة:** الـ NotebookAdminTab شاشة أدمن (مش للعميل) — لا تحتاج disclaimer (Rule 30).

### قاعدة مهمة (Rule 30 — CLIENT-FACING-STYLE)

كل الـ logic الداخلي (VETO, REJECT, hard reject, force_exit, danger_level) **محايد قانونياً** لأنه:
1. مش بـ يشوفه العميل (شاشات الأدمن فقط).
2. مصطلحات تقنية بحتة (مش ادعاءات استثمارية).
3. بـ يأثر على القرار الداخلي للنظام (مش عرض مباشر للعميل).

العميل بـ يشوف بس النتيجة النهائية: "إشارة BUY" أو "لا توجد إشارة" — ودي محمية بـ DisclaimerBanner.

### التحقق النهائي (2026-09-01)

- ✅ لا "توصية" جديدة في الموديولات الجديدة (ما عدا DisclaimerBanner المطلوب).
- ✅ لا "مضمون" جديدة في الموديولات الجديدة.
- ✅ لا "آمن 100%" جديدة في الموديولات الجديدة.
- ✅ كل المصطلحات الجديدة تقنية داخلية (مش للعميل).
- ✅ الـ 10 Feature Flags default OFF — المنصة الإنتاجية محمية.

---

## 📒 سجل التغييرات

| التاريخ | الملف | التغيير |
|---------|-------|---------|
| 2026-09-01 | `LEGAL_PROTECTION.md` | تحديث علامة "آخر تحديث" لـ 2026-09-01. إضافة قسم "تحديث 2026-09-01: المراجعة القانونية للموديولات الجديدة" — فحص قانوني لـ 12 موديول جديد + التحقق من DisclaimerBanner/Footer + قاعدة Rule 30 + التحقق النهائي. |
