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
> **آخر تحديث: 2026-10-12** (DOC-UNIFY-1-CONSTITUTION — توحيد التوثيقات في 5 ملفات داخل `Documentation/`. هذا الملف هو الدستور الموحّد ويحتوي على القواعد المطلقة الـ 76 كاملة. تم اختصار الـ header القديم + استبدال التفاصيل المعمارية/API/الشاشات/Pipeline/Production Snapshot بمراجع متقاطعة لملفات التوثيق الأخرى. إجمالي القواعد: 76).
>
> **آخر تحديث سابق: 2026-10-08** (TASK CONSTITUTION-R75-R76 — المالك رفع المدير العام لـ "عضو مهم في الفريق": إضافة القواعد 73 (SINGLE-DISPLAY-SOURCE) + 74 (TICKER-COOLDOWN) + 75 (PUSH-AFTER-EVERY-TASK ⭐ قاعدة ثابتة) + 76 (TEAM-WORK-REVIEW ⭐ قاعدة ثابتة). إجمالي القواعد الآن 76).
>
> **آخر تحديث سابق: 2026-10-07** (UNIFIED-DATA-CONTRACT — القاعدة 72: عقد التوحيد للمصدر الموحد للبيانات (16 canonical metric). تكملة Rule 20 + 27 + 67(b) + 72. المرجع التنفيذي: `download/UNIFIED_DATA_CONTRACT.md`).
>
> **المالك:** `enmohsen20111975` · **المدير والمبرمج:** Z.ai Code (full autonomy)
> **المستودع:** https://github.com/enmohsen20111975/GLMinvestment
> **الإنتاج:** https://invist.m2y.net
>
> 📚 **توحيد التوثيق (2026-10-12):** كل التوثيقات في `Documentation/` مُجمَّعة في **5 ملفات رئيسية** فقط:
> 1. `Documentation/00-CONSTITUTION.md` (هذا الملف) — الدستور والحوكمة والقواعد الـ 76.
> 2. `Documentation/01-ARCHITECTURE_AND_API.md` — المعمارية + DBs schema + API list + تدفق البيانات.
> 3. `Documentation/02-SCREENS_AND_COMPONENTS.md` — كل شاشة وكل مكوّن بحالته (نشط/ميت/مكرر).
> 4. `Documentation/03-HOW_IT_THINKS.md` — كيف يحلّل النظام سهمًا ويُولّد توصية (Pipeline/Logic).
> 5. `Documentation/04-CURRENT_STATE.md` — Production Snapshot + الحالة الإنتاجية الحالية.
>
> أي ملف توثيقي آخر في `Documentation/_archive_pre_unification_2026-10-12/` يُعتبر **مرجعًا تاريخيًا**.

---

## 📑 جدول المحتويات

1. [ترتيب قراءة التوثيق (إلزامي)](#-ترتيب-قراءة-التوثيق-إلزامي-قبل-أي-عمل)
2. [الأدوار وجهات الاتصال](#-الأدوار-وجهات-الاتصال)
3. [القواعد المطلقة الـ 76 (لا تُكسر أبدًا)](#-القواعد-المطلقة-الـ-76-لا-تُكسر-أبدًا)
4. [KPIs والحدود الحرجة (Hard Caps)](#-kpis-والحدود-الحرجة-hard-caps)
5. [سياسة الشخصيات (PERSONA-UNIFY-A)](#-سياسة-الشخصيات-persona-unify-a)
6. [قواعد حالة التوقعات (Prediction-Status Taxonomy)](#-قواعد-حالة-التوقعات-prediction-status-taxonomy)
7. [القياس المغلق (Closed-Loop)](#-القياس-المغلق-closed-loop)
8. [إدارة التوصيات (Picks Management)](#-إدارة-التوصيات-picks-management)
9. [سياسة الـ Fundamentals](#-سياسة-الـ-fundamentals)
10. [سلامة قواعد البيانات (DB Safety)](#-سلامة-قواعد-البيانات-db-safety)
11. [خطوات سير العمل (Workflow) + بنية المشروع](#-خطوات-سير-العمل-workflow--بنية-المشروع)
12. [عهد الوكيل (34 بند)](#-عهد-الوكيل-34-بند)
13. [ميثاق الانضباط الهندسي (8 مبادئ)](#-ميثاق-الانضباط-الهندسي-engineering-discipline-charter)
14. [الحماية القانونية + النص المعتمد + الكلمات الممنوعة](#-الحماية-القانونية--النص-المعتمد--الكلمات-الممنوعة)
15. [فهرس سجل التغييرات (آخر 5 تحديثات)](#-فهرس-سجل-التغييرات-آخر-5-تحديثات)

---

## 🗂️ ترتيب قراءة التوثيق (إلزامي قبل أي عمل)

عند بداية كل جلسة، **بهذا الترتيب فقط**:

1. **`Documentation/00-CONSTITUTION.md`** (هذا الملف) — الدستور والقواعد الـ 76.
2. **`Documentation/01-ARCHITECTURE_AND_API.md`** — المعمارية + DBs schema + API list + تدفق البيانات + الـ 5 Pillars.
3. **`Documentation/02-SCREENS_AND_COMPONENTS.md`** — كل شاشة وكل مكوّن بحالته (نشط/ميت/مكرر).
4. **`Documentation/03-HOW_IT_THINKS.md`** — منطق المحرك (Maker State → Flight State → 6 إثباتات → Tech Score → Signal → Portfolio Advice → Stops).
5. **`Documentation/04-CURRENT_STATE.md`** — Production Snapshot + الحالة الإنتاجية الحالية.
6. **`AGENTS.md`** (جذر المشروع) — دليل سير العمل اليومي (golden rules + runbooks + بيئة الساندبوكس).
7. **`SYSTEM_STATE.md`** (جذر المشروع) — آخر حالة للنظام + سجل الإصلاحات.
8. **`CHANGELOG.md`** — آخر 3 إدخالات فقط (في الأعلى) لمعرفة آخر التعديلات.
9. **`worklog.md`** — آخر ~200-300 سطر لمعرفة ما فعله الوكلاء السابقون في هذه الجلسة (Rule 76).

بعد القراءة، اتبع **خطوات سير العمل** في §11، ثم ابدأ. عند الانتهاء، حدّث التوثيق
المتأثر وأرفع على GitHub (Rule 75 — PUSH-AFTER-EVERY-TASK).

---

## 📞 الأدوار وجهات الاتصال

| الدور | المسؤول |
|-------|---------|
| **المالك (Owner)** | `enmohsen20111975` (GitHub) — القرار النهائي في كل خلاف، الموافقة على أي استثناء، الموافقة على أي refactoring، الموافقة على أي لمس DB إنتاجي. |
| **المدير + المبرمج (Z.ai Code)** | Full autonomy في التنفيذ اليومي: Fix / Feature / Documentation. Refactor يحتاج موافقة المالك (§11.4). رفع المدير العام لـ "عضو مهم في الفريق" (2026-10-08). |
| **الوكلاء الآخرون** | Kilo / Grok / Gemini / Z.ai subagents / بشري — كلهم يلتزمون بهذا الدستور دون استثناء. |
| **المستودع الرئيسي** | https://github.com/enmohsen20111975/GLMinvestment |
| **تطبيق Flutter** | https://github.com/enmohsen20111975/flutter_investment_App |
| **الإنتاج (Production VPS)** | https://invist.m2y.net — `/root/GLMinvestment/` — PM2 (nextjs, python-backend, data-engine, ws-service, telegram-events, news-agent). |
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
| Push على `origin/main` | ✅ | ✅ (بعد `bun run lint` + `tsc --noEmit` يمرّان) — Rule 75 | ❌ |

---

## 🚫 القواعد المطلقة الـ 76 (لا تُكسر أبدًا)

هذه القواعد **صارمة ولا يمكن تجاوزها مهما كانت الأسباب** إلا بموافقة وتأكيد من المالك.

> **فهرس القواعد (1–76):**
> - **1–8**: قواعد سلامة DBs + المعمارية + HARD cap + ATR + trailing + EXIT_POLICY + overrides + load_merged_history.
> - **9–16**: trailing floor + EXIT_POLICY + overrides + DATA-UNIFY + liquidity + commit-guard + sandbox ≠ prod + VERIFY-BEFORE-DELETE.
> - **17–24**: RELATIVE-PATHS + R:R ≥ 1.8 + loss ceiling + Python=Brain + V40.2 + dedup-by-ticker + PERSONA-UNIFY + fundamentals real.
> - **25–32**: refactoring-gated + SANDBOX-RESET + NO-FAKE-DATA + NO-DUPLICATION + UNIFIED-SYSTEM + CLIENT-FACING-STYLE + NO-HYPE-LANGUAGE + CLIENT-VS-SYSTEM.
> - **42** (تاريخيًا بين 32 و 33): REGIME-AND-AVG-DOWN.
> - **33–43**: PRODUCTION-WIRING + NO_DUPLICATE_SCREENS + ENGINE-UNIFY + DISCLOSURE-ENGINE + STRICT-ENTRY + SHORT-HOLDING + DISTRIBUTION-EXIT + NEWS-FETCHER + DOCS-FIRST-LAST + REGIME-AND-AVG-DOWN (42) + TELEGRAM-NOTIFICATIONS.
> - **44–54**: NEWS-DB-SOT + SCREENER-FUNDAMENTALS-DEPTH + DB-CLEANUP-WAVE + NEWS-AGENT-INTEGRATION + FREE-LICENSED-APIs + DUAL-TRACK-PREDICTIONS + MONEY-AS-CUSTOMER-LIFE + MULTI-MARKET-DUAL-TRACK + UNIFIED-REUSABLE-COMPONENTS + CRYPTO-IN-MARKETS + UNIFIED-TABLE-UPGRADE.
> - **55–59**: P0-WAVE-SECURITY + P0-WAVE-SQLI + P0-WAVE-ASYNC + P0-WAVE-OBSERVABILITY + P0-WAVE-TESTS.
> - **60–72**: MODULE-SYSTEM + RELATIVE-PATHS-ONLY + GIT-PUSH-DISCIPLINE + PUSH-AFTER-EVERY-COMMIT + SHARIA-COMPLIANCE + DATA-VALIDATION-LAYER + SOURCE-AUTHORITY + ROOT-CAUSE-FIRST + AGENT-QUALITY-GATE + CALCULATION-CANONICAL + COMMUNICATION-EXECUTION-DISCIPLINE + SUBAGENT-TEAM-ACTIVATION + DOCUMENTATION-SECRETARY + AUTONOMOUS-IMPROVEMENT-WITH-BACKTEST + UNIFIED-DATA-CONTRACT.
> - **73–76**: SINGLE-DISPLAY-SOURCE + TICKER-COOLDOWN + PUSH-AFTER-EVERY-TASK ⭐ + TEAM-WORK-REVIEW ⭐.
>
> **ملاحظة ترقيم:** القاعدة 42 ظهرت بين 32 و 33 لأسباب تاريخية (تم إدراجها بعد فصل §4 KPIs) لكنها تخص §3. القاعدتان 67 و 68 لكلٍّ منهما شقّان (67a/67b و 68a/68b) لأسباب تاريخية — الإجمالي 76 قاعدة.

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
- **لا تُنشئ طبقات (domain/application/infrastructure) جديدة**. المشروع يستخدم بنية flat حسب `01-ARCHITECTURE_AND_API.md` §2.
- **لا تُغيّر أسماء الملفات**. الإنتاج والساندبوكس والـ Flutter يعتمدون على المسارات الحالية.
- عند الحاجة لمكان جديد، **اسأل المالك أولًا**.

### القاعدة 4 — لا شاشات/ملفات/أنظمة جديدة إلا في الطوارئ
- **ممنوع** إنشاء `page.tsx` جديد (لدينا 20 صفحة، 9 منها ميتة — راجع `02-SCREENS_AND_COMPONENTS.md`).
- **ممنوع** إنشاء `.tsx` جديد إذا يوجد مكوّن مشابه — وسّعه بدلًا من ذلك.
- **ممنوع** إنشاء `route.ts` جديد إذا يمكن توسيع `/api/proxy/[...path]` أو الـ catch-all الموجود.
- **ممنوع** إنشاء `.py` جديد في `vps-service/` إذا يمكن توسيع ملف موجود.
- **ممنوع** إنشاء Flask blueprint جديد — لدينا 65 ملف API، 33 منها DEPRECATED. وسّع المسجّل منها فقط (راجع `01-ARCHITECTURE_AND_API.md` §5 لقائمة الـ blueprints النشطة).
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

### القاعدة 8 — ATR stop في نطاق [5%, 9%] (PILLAR-3)

> **(Updated 2026-10-01 per EGX-STRATEGY 2026-08-30 + AUDIT-DEEP-2 finding)** — رُفع `atr_stop_min_pct` من `3.0` إلى `5.0` لمواءمة الدستور مع `engine_settings.py` (المصدر الكنسي للتشغيل منذ 2026-08-30). التذبذب الطبيعي في EGX عالي (HRHO/MFPC/COMI تتحرك 4–7% ATR يوميًا)؛ الـ 3% القديم كان بيـ reject صفقات بـ R/R كويسة بسبب ضجيج الـ spread/commission.

- `atr_stop_min_pct=5.0` و `atr_stop_max_pct=9.0` في `engine_settings.py` (مصدر الحقيقة الوحيد — matches `vps-service/analyzers/engine_settings.py:208`).
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
- التناقضات الموثّقة سابقًا تم حل أغلبها في Phase 3 من PERSONA-UNIFY-A: `trailing_stop_activation_gain=2.0` موحّد، `partial_exit_at_rr=1.5` موحّد، `max_stop_pct=9.0` موحّد في `optimizer_params.json` + `optimizer_params_routes.py` DEFAULT_PARAMS + `prediction_optimizer.py` fallback.

### القاعدة 12 — `load_merged_history()` هو المصدر الوحيد لبيانات الأسعار (DATA-UNIFY-007)
- أي محلل جديد **لازم** يستخدم `load_merged_history()` من `analyzers/master_analyzer.py`.
- **ممنوع** القراءة المباشرة من `stock_daily_prices` أو `price_history` (يخلق split-brain).
- الـ Normalization: فلتر egksco + تطبيع migration + `_adjust_for_splits`.
- `load_merged_history()` بيرجع من `price_history.db.price_history` (المصدر الموحَّد).
- `source_authority.py` بيحدد المصدر القانوني لكل سوق (Rule 66) — `CANONICAL_SOURCES` لكل سوق + `BANNED_SOURCES` ممنوعة.
- `validation.py` بيتأكد إن البيانات منطقية قبل الاستخدام (Rule 65) — أي field غير منطقي → `INVALID` (بتتصفّر، مش fake).
- **WRITE-GUARDED-EXTENSION (2026-10-12):** كل scraper بـ يكتب في `price_history.db` لازم يمرّ على `write_guarded()` (canonical writer per Rule 12 + Rule 66). الـ signature بيدعم delta_volume columns اختيارية. الـ canonical writer هو `vps-service/data/source_authority.py::write_guarded()`.

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
  2. **تسجيل الـ blueprint** — ابحث في قائمة `BLUEPRINTS` بـ `vps-service/lightweight_server.py`. وجود `register_blueprint()` داخل ملف الـ route **لا يكفي** — لازم يكون مستدعى فعلياً من الخادم.
  3. **سجل الأداء** — اسأل المالك عن نتائج المحرك قبل اقتراح حذفه.
- **القاعدة الذهبية:** إذا وجدت `fetch()` في الواجهة لـ endpoint لكن الـ blueprint غير مسجّل → هذا **BUG يجب إصلاحه (تسجيل الـ blueprint)**، وليس سببًا لحذف الكود.
- **⚠️ تمييز مهم:** **V4 ≠ V40**. عندما يقول المالك «V4 كان بيدى أفضل نتائج» فالمقصود هو **V40.2** (محرك التوقعات evidence-based المعمول ببايثون، `jobs/daily_predictor.py`) وليس `ExpertMemoryV4`. خلط التسميتين كاد يسبب حذف ميزة خاطئة.
- **رفع على GitHub إلزامي بعد كل مهمة** (Rule 75) + تشغيل اختبارات الصحة (`bun run lint` + فحص بنية الـ docs) قبل الـ commit.
- **SIDE-EFFECTS-AUDIT (2026-10-12):** تنفيذ مباشر لـ Rule 16. اكتشف + اتعالجت 3 آثار جانبية لـ routes رجعت 410 Gone + اتأرشفت 9 orphan components لـ `archive/dead-components-20261012/` (مش حذف — Rule 16). الـ proxy-client.ts اتكشف إنه مش orphan (3 importers حية) فاتساب في مكانه. التفاصيل الكاملة: راجع `04-CURRENT_STATE.md` §1 + `worklog.md`.

### القاعدة 17 — المسارات نسبية دائمًا (RELATIVE-PATHS-ONLY)
- **كل المسارات في الكود لازم تكون نسبية** (`db/price_history.db`, `vps-service/data/...`, `src/lib/...`) — **ممنوع** كتابة مسار مطلق مثل `/root/GLMinvestment/...` أو `/home/meme/my_apps/...` أو `C:\Users\...`.
- **السبب:** المشروع يعمل بنفس الأكواد على **ثلاث بيئات**: الإنتاج (VPS: `/root/GLMinvestment/`) + سيرفر المالك المحلى (`/home/meme/my_apps/GLMinvestment/`) + الساندبوكس (`/home/z/my-project/`).
- أي مسار مطلق = كود ينكسر في بيئتين من الثلاثة. هذا سبب كوارث سابقة (cron entries كانت بتشير إلى `/home/meme/...` على VPS فشل السكربتات).
- **في Python:** استخدم `Path(__file__).resolve().parent.parent` لحساب جذر المشروع ديناميكيًا. أو استخدم `utils/db_paths.py` إن وُجد.
- **في cron jobs:** استخدم متغير أو استدعِ relative من الـ working directory المحدد في crontab.
- **الاستثناء الوحيد:** مسار الـ Python binary في crontab (`/root/.venv/bin/python3`) لأنه خاص بالـ OS، مش بالمشروع.

### القاعدة 18 — R:R ديناميكي مع floor إلزامي 1.8 (R:R-FIX — commit `65a748f` + EGX-STRATEGY 2026-08-30)

> **(Updated 2026-10-01 per EGX-STRATEGY 2026-08-30 + AUDIT-DEEP-2 finding)** — رُفع `dynamic_rr_normal` من `1.5` إلى `1.8` لمواءمة الدستور مع `engine_settings.py:257`. السبب: ATR stop أوسع (5%) بعد تحديث Rule 8 يتطلب R:R أعلى للحفاظ على الـ expectancy موجبة بعد الـ commission/slippage.

- **الـ R:R الفعلي للإنتاج هو ديناميكي، NOT ثابت** (تم إصلاحه في commit `65a748f`):
  - **المسار العادي:** `dynamic_rr_normal = 1.8` (R:R = 1.8 — updated 2026-08-30 per EGX-STRATEGY).
  - **مسار التفوق على السوق (outperforming benchmark):** `dynamic_rr_outperform = 2.0` (R:R = 2.0 — يُفعّل لو `stock_roc > benchmark_change`).
  - **~95% من الصفقات** في الأرشيف الحالي تأخذ R:R = 2.0 (السوق يتفوّق في أغلب الأيام).
- **R:R floor gate إلزامي** في `vps-service/jobs/daily_predictor.py` (lines ~314-326):
  ```python
  if r_mult < get_setting('dynamic_rr_normal', default=1.8):
      continue  # skip — quality gate
  ```
  - يرفض أي توقع R:R < 1.8 **قبل** الكتابة لـ `predictions.db`.
- **مفاتيح `risk_profile` الكنسية** (مما يُرجعه `institutional_decision_engine.py`): `sl` / `tp1` / `tp2` / `rr_ratio_tp1` / `rr_ratio_tp2`. **ممنوع** قراءة المفاتيح القديمة `stop_loss` / `target_1` / `target_2` فقط (key-mismatch bug السابق).
- **النتيجة المرجعية (archive `active_databases_20260817_full.zip`, 148 صفقة):** BEFORE-RESIM: PF=1.398, Exp=+1.35%/trade → **AFTER-A (dynamic 1.5/2.0): PF=1.453, Exp=+1.54%/trade (+0.055 PF, +0.189% Exp).** Max loss: -7.59% (unchanged — Hard Loss Ceiling intact).

### القاعدة 19 — Hard Loss Ceiling + Split Guard (PILLAR-3)
- **Hard Loss Ceiling:** `hard_loss_ceiling_pct = 7.0` (in `daily_closer.py::_mark_closed`).
  - كل صفقة BUY مغلقة بـ stop لازم `actual_return >= -7%`.
  - يُفعّل بعد الـ ATR clamp [5%, 9%] — خط دفاع ثاني.
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
- **RULE20-PURE-PROXY (2026-10-12):** تم تحويل **17 Node routes** لـ pure thin proxies (zero computation in Node) في 5 جلسات متتالية. كل الـ logic انتقل لـ Python (Single Source of Truth per Rule 67(b)). إجمالي تقليل: **~3,300 سطر Node logic**. السلوك الجديد لما Python unavailable: `HTTP 503 + success:false + {error: 'python-backend-unavailable'}` — **ممنوع** إرجاع `success:true` + zeros (كان خرق Rule 27). التفاصيل: راجع `01-ARCHITECTURE_AND_API.md` §5 + `04-CURRENT_STATE.md` §1.

### القاعدة 21 — V40.2 هو مصدر التوقعات الإنتاجي الوحيد (evidence-based)
- **`jobs/daily_predictor.py`** هو مولّد التوقعات الإنتاجي.
- كل توقع BUY/STRONG_BUY لازم يمرّ بـ:
  1. **Kill Filters** (5 فلاتر استبعاد: سيولة/سعر/تذبذب حجم/بيانات/قوة نسبية) — `liquidity_filter.py::evaluate_kill_filters`.
  2. **6 إثباتات موزونة** (Trend 8 + Makers 26 + DNA 8 + Fundamentals 8 + Sector 8 + Benchmark 24 = 82 وزن كلي) — `institutional_decision_engine.py::build_institutional_decision`.
  3. **R:R ≥ 1.8 floor gate** (القاعدة 18).
  4. **ATR stop clamp [5%, 9%]** (القاعدة 8).
  5. **`morning_bell=1`** لأعلى توقع في اليوم (sort by evidence_count → score).
- **MAESTRO-KILL (2026-10-12):** MaestroOrchestrator + crypto_maestro + unified_maestro + maestro_routes + MaestroWidget + lib/honest-tracking/maestro.ts — **كلها اتمسحت نهائياً** وأرشفت في `archive/maestro-dead-code-20261012/`. سيدي طلب: "Maestro ده ماضي أسود". مفيش أي كود Maestro لسه في المشروع.
- **PREDICTION-WRITE-GUARD** (`core/prediction_write_guard.py`): الـ Single Gate اللي بـ enforce Rule 35. كل توقع لازم يمرّ عبره قبل INSERT. بيـ block أي توقع بدون `engine=v40_2` tag أو `evidence_count < 3` أو `master_score=50` placeholder.
- **ممنوع** توليد توقعات من أي مسار تاني غير V40.2 (Rule 35).

### القاعدة 22 — KPIs تُحسب بـ dedup-by-ticker (PERSONA-BALANCE)
- **القاعدة الذهبية (المالك):** السهم الواحد = صفقة واحدة حتى لو تكرر بين الثلاث شخصيات.
- التكرار بين الشخصيات = **إشارة أقوى** (أسهم تحت التركيز)، وليس 3 صفقات منفصلة.
- أي حساب WR / PF / Expectancy لازم يكون على مستوى `(ticker, prediction_date)` فريد أولًا، ثم تفصيل حسب الشخصية.
- **أولوية الـ dedup:** `target_hit` > `holding_days` أقل > `master_score` أعلى > `morning_bell` > `evidence_count`.
- الـ overall KPI = العدّاد الرسمي. تفصيل الشخصيات (byPersona) يعرض "تغطية" — مجموع الشخصيات قد يفوق الـ overall وهذا صحيح.
- **HARD cap (القاعدة 7)** مطبّق في كل المسارات (server SQL + client + persona_db).

### القاعدة 23 — لا تعيد تصنيف الشخصيات في `predictions.persona` (PERSONA-UNIFY-A)
- جدول `predictions.persona` **محمي**: `persona='balanced'` ثابت لكل V40.2 picks.
- الـ `persona_fit` (محسوب عبر `compute_persona_fit()` في `daily_predictor.py`) بـ يُannotated في `kill_filter_result` فقط (رؤية تحليلية).
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
- **Hard veto (مقترح للتفعيل بعد أسبوع حي):** رفض BUY لو `fundamental_score < 30` (يرفع PF +0.273, Exp +0.52% — مُختبَر على 148 صفقة).
- **ممنوع** تفعيل `egx_fundamental_fetcher.py` كـ cron قبل إصلاح `tab_balance_sheet`/`tab_income_statement`/`tab_cash_flow` column-shift bug (الـ `symbol` column بيحمل Arabic names بدل tickers).

### القاعدة 25 — Refactoring يحتاج موافقة المالك + لا حذف بدون VERIFY-BEFORE-DELETE
- أي refactoring (حذف كود ميت، دمج ملفات، إعادة تسمية) لازم يبدأ بـ:
  1. **موافقة صريحة** من المالك.
  2. **قراءة** قسم القيود الحرجة في `04-CURRENT_STATE.md` §1 (نقل من §15 القديم).
  3. **تنفيذ في فرع منفصل** (`git checkout -b refactor/<name>`).
  4. **اختبار شامل** بعد كل ملف (`bun run lint` + `python3 -c "import ..."`).
  5. **مراجعة المالك** قبل الـ merge.
- **الـ rename refactor ملغى**: لا تُغيّر أسماء ملفات لتحسين القراءة فقط (تنتهك القاعدة 3). حل بديل: وثّق اللبس في `01-ARCHITECTURE_AND_API.md`.
- الكود الميت يُسجّل في القيود الحرجة (`04-CURRENT_STATE.md` §1)، لا يُحذف إلا بعد VERIFY-BEFORE-DELETE (القاعدة 16).

### القاعدة 26 — الساندبوكس يتعرض لـ RESET دوري (SANDBOX-RESET-SAVEREGUARD)
> **سبب الإضافة:** الساندبوكس (`/home/z/my-project/`) بـ يـ reset دوريًا لـ آخر snapshot
> من الـ `.initial_snapshot.json` (~الـ 19-22 أغسطس). أي كود/DBs/ملفات **غير مرفوعة على GitHub**
> بتضيع بعد الـ reset. ده حصل فعليًا وفقدنا كود مهم (commit `98cb334c` Volume Surge Hunter)
> + `data/all.zip` (68MB) + كل `db/*.db`. هذه القاعدة تمنع تكرار الكارثة.

- **القاعدة الذهبية:** الساندبوكس ≠ مساحة دائمة. كل شغل **لازم** يبقى على GitHub.
- **قبل أي مهمة (بداية الجلسة):**
  1. `git fetch origin` — اسحب آخر تحديثات GitHub.
  2. `git log origin/main..HEAD --oneline` — شوف هل عندك commits محلية غير مرفوعة.
  3. `git status` — شوف هل عندك ملفات modified مش staged.
  4. لو عندك commits محلية → **push them فورًا** قبل ما تبدأ شغل جديد.
- **أثناء المهمة:** commit كل **1-2 ساعة** (مش في آخر المهمة بس) + استخدم `git stash` قبل أي عملية خطرة (rebase / merge / pull).
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
- **لا تعتمد على:** `/tmp/` للـ backup طويل المدى (بيتمسح في الـ reset) + `git reflog` (بيتمسح كله بعد الـ reset) + أي ملف غير مـ commit على GitHub.
- **DBs مهمة لازم تتـ backup** (قبل أي عملية خطرة): `data/all.zip` + `db/data_engine.db` (125MB) + `db/predictions.db` + `db/stocks.db`.
- **تحذير صريح:** لو ضاع كود بسبب عدم اتباع هذه القاعدة، المسؤولية على الوكيل. الـ sandbox بـ reset بشكل دوري. الـ GitHub هو المصدر الوحيد للحقيقة الدائمة.

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
- **MAESTRO-KILL + FAKE-DATA-HUNT (2026-10-12):** تم إزالة fabricated data paths: 3 fake backtest endpoints (Rule 27 + Rule 67(b)) + `src/lib/store.ts` client-side scoring + Zakat hardcoded gold price + `+2472.9%` SUM bug pattern + persona/analyze + crypto/smart-watchlist placeholders. **التأكيد النهائي:** سياسة الفراغ هي الـ default. أي field ما عندناش قيمة حقيقية ليه → `null` (NOT 50, NOT 0, NOT placeholder). الـ client بـ يعرض "— بيانات غير متاحة". ممنوع fabrication حتى مع `source: 'stub'` label. التفاصيل: راجع `04-CURRENT_STATE.md` §1.

### القاعدة 28 — لا تكرار شاشات/تبويبات/أكواد (NO-DUPLICATION — 2026-08-29)
> **سبب الإضافة:** توجيه صريح من المالك (2026-08-29): "غير مسموح ابدا بتكرار الشاشات والتبويبات والأكواد وعمل اتداخل الرهيب الى موجود فى المشروع دة".

- **ممنوع** إنشاء شاشة/تبويب جديد بنفس وظيفة شاشة/تبويب موجود. لو محتاج ميزة موجودة → وسّع الموجود (القاعدة 4).
- **ممنوع** وجود أكثر من endpoint لنفس الوظيفة. لو فيه تكرار → وحد على Python endpoint واحد + احذف الباقي (بموافقة المالك + Rule 25).
- **ممنوع** وجود نفس logic في Node + Python (مثل حساب relative_strength في مكانين). كل logic في Python (Rule 20).
- **الأنظمة المتوازية الموجودة** (تحتاج توحيد بمراحل) — راجع `04-CURRENT_STATE.md` §1 لقائمة الـ parallel systems المراد توحيدها.
- **قبل أي ميزة جديدة:** اسأل "هل فيه شاشة/endpoint موجود بـ يعمل ده؟" (Grep في `src/` + `vps-service/`). لو نعم → وسّع. لو لا → اطلب موافقة المالك.
- **P1-PARALLEL-ENGINES-FIX (2026-10-12):** تم مسح 5 parallel Node engines (3,987 LOC) → 3 Python endpoints جديدة (`/api/trade-results` + `/api/stocks/<ticker>/expert-analysis` + `/api/stocks/<ticker>/gate-analysis`) + 2 archived orphan. الـ Verifier: لو لقيت أي ملف في `src/lib/` بـ يحسب RSI/ATR/gate-score/expert-analysis/trade-results → ده REGRESSION violation. الـ archive location: `archive/engines/p1-parallel-engines-20261012/`.

### القاعدة 29 — نظام متكامل واحد (UNIFIED-SYSTEM — 2026-08-29)
> **سبب الإضافة:** توجيه صريح من المالك (2026-08-29): "احنا مش بنعمل موديولات منفصلة ولاأكواد فوق بعض مش مرتببطة ببعضها احنا بنعمل نظام كامل متكامل".

- **النظام = وحدة واحدة.** كل ملف/مكوّن/endpoint لازم يكون **مرتبط + مستخدم** فعلاً (القاعدة 5).
- **ممنوع** إنشاء "موديولات منفصلة" — أي ميزة جديدة لازم تتكامل مع النظام الموجود:
  - frontend component → مستورد في page.tsx أو مكوّن موجود
  - API route → مستدعى من frontend component
  - Python endpoint → مسجّل blueprint في lightweight_server.py + مستدعى من Node proxy
  - Python analyzer → مستورد في master_analyzer أو V40.2 generator
- **مكدس Node موازي ممنوع:** `src/lib/v2/` (30 ملف، 21,154 LOC) يحتوي على maestro-orchestrator + momentum + unified-scoring + recommendation — هذا مكدس Node كامل **موازي** للـ Python. يُحذف بالتدريج (بموافقة المالك) بعد نقل الـ logic للـ Python.
- **أي ملف غير مستخدم** = كود ميت (Rule 16 + Rule 25) → يُسجّل في القيود الحرجة (`04-CURRENT_STATE.md` §1) ثم يُحذف بعد VERIFY-BEFORE-DELETE.

### القاعدة 30 — الشاشات للعميل بأسلوب احترافي (CLIENT-FACING-STYLE — 2026-08-29)
> **سبب الإضافة:** توجيه صريح من المالك (2026-08-29): "الشاشات كلها بدون استثناء عدا شاشة الأدمن موجهه للعميل ولازم كل حاجة فيها تاخد أسلوب التعامل مع العميل".

- **كل الشاشات (عدا `/#admin`)** موجهة للعميل المستثمر. أسلوبها لازم:
  - احترافي ووقور (مناسب لمستثمرين فرادى)
  - واضح ومباشر (لا حشو، لا تزيين)
  - عربي فصيح (اللهجة المصرية مسموحة في الـ tooltips/الرسائل القصيرة بس)
- **ممنوع** في شاشات العميل: عبارات تحميسية (`🚀 انطلق!`، `🎉 ربحت!`، `💰 فلوس كتير!`) + إيموجي زائد عن الحد (الإيموجي الوظيفي مسموح: 🎯 لـ target، ⚡ لـ volume_surge، 🔥 لـ hot sector — لكن مش كـ زينة) + أرقام مبالغ فيها بدون سياق (`+2269%` بدون توضيح أنه backtest).
- **مسموح** في شاشات العميل: badges واضحة (ألوان + نصوص عربي) + sparklines مصغرة (وظيفية) + tables منظمة (sortable/filterable) + tooltips تشرح المصطلحات.
- **شاشة الأدمن (`/#admin`)** فقط يمكنها أسلوب تقني (debug info، raw numbers، technical jargon) — لأنها للمدير/المبرمج.

### القاعدة 31 — لا عبارات تحميسية (NO-HYPE-LANGUAGE — 2026-08-29)
> **سبب الإضافة:** توجيه صريح من المالك (2026-08-29): "لاتستخدم عبارات التحميسية الشدشة بتاعت AI انت بتتعامل مع ناس مستثمرين فراعى أسلوب كلامك".

- **أسلوب التواصل مع العميل:** احترافي، وقور، مباشر. العميل مستثمر — مش طفل بـ يحتاج تشجيع.
- **ممنوع** في أي نص يراه العميل (UI، tooltips، messages، notifications): "🚀 حقق أحلامك!" / "💰 كن ثرياً!" / "🎯 اضمن نجاحك!" / "انطلق في رحلتك الاستثمارية" / "كن بطلاً في البورصة" / أي عبارة تشبه إعلانات الـ AI hype.
- **المسموح:** "تتبع القطاعات" (وصف وظيفي) + "أعلى الأرباح والخسائر" (وصف محايد) + "فلاتر الأسهم" (وصف وظيفي) + "حالة السهم: في تصحيح" (وصف فني محايد).
- **الـ agent (Z.ai Code)** يتحدث مع المالك بأسلوب مهني مباشر — لا تحميس، لا وعود، لا مبالغة. يقدم الحقائق + الأرقام + المخاطر بوضوح.

### القاعدة 32 — فصل واضح بين عرض العميل و logic النظام (CLIENT-VS-SYSTEM — 2026-08-29)
> **سبب الإضافة:** توجيه صريح من المالك (2026-08-29): "فية فارق رهيب بين الى هاتعملة للعميل والى هاتعملة للنظام".

- **عرض العميل (frontend):** بيانات حقيقية + واضحة + قابلة للفهم. العميل يشوف: توصيات (signal + entry + target + stop + R:R) + أداء (WR + PF + Net — بدون مبالغة) + تحليل (sector heat + momentum + correction status) + محفظته (holdings + P&L حقيقي).
- **logic النظام (Python backend):** محرك معقد + دقيق + آمن. النظام بـ يعمل: توليد توقعات (V40.2 evidence-based) + حسابات فنية (RSI/MACD/ATR/SMC/VSA/flow) + إدارة مخاطر (kill filters + R:R gate + ATR clamp + hard loss ceiling) + تعلم ذاتي (closed-loop + lessons) + إغلاق صفقات (daily_closer + exit logic).
- **الـ Node (frontend API routes):** مجرد proxy. ينقل البيانات من Python → العميل. لا logic، لا حسابات، لا قرارات (Rule 20).
- **ممنوع** خلط الاثنين: لا logic تداولي في frontend (يخدش Rule 20) + لا بيانات كاذبة في عرض العميل (يخدش Rule 27) + لا أسلوب تقني في شاشات العميل (يخدش Rule 30).

### القاعدة 42 — فلتر الـ Regime إلزامي + المتوسط السعري الذكي (REGIME-AND-AVG-DOWN — 2026-09-02)
> **سبب الإضافة:** توجيه المالك (2026-09-02): "السوق المصري نزوله حاد كتير بيبقى Liquidity Grab من الصناع وبعدين انفجار سعري. عايزين فلتر اتجاه قوي + تعريف كمي لفرصة المتوسط السعري الذكي، مش الأعمى."
>
> **ملاحظة ترقيم:** هذه القاعدة ظهرت تاريخيًا بين 32 و 33 (قبل فصل §4 KPIs) لكنها تخص §3. تم الإبقاء على رقمها للحفاظ على المراجع.

**أ. فلتر الـ Regime (إلزامي على إشارات BUY):**
- **المُطبِّق:** `vps-service/analyzers/regime_filter.py::passes_regime_filter()`.
- **النسختان المدعومتان:**
  - `mode='A'` (افتراضي للإنتاج): `Close > SMA50` (اتجاه صحي متوسط المدى).
  - `mode='B'` (للأبحاث/الإنتاج المستقبلي): `Close > SMA20 AND Close > SMA50` (تأكيد مزدوج).
- **التكامل:** خلف feature flag `V40_2_REGIME_FILTER` (default OFF حتى اكتمال walk-forward). عند التفعيل، يُطبَّق كـ pre-filter في `evaluate_strict_entry()` (قبل is_late / is_grab).
- **النتائج الموثقة (19 شهر، 442 سهم EGX):** `Correction [B]` = الأفضل جودة (PF 18.54، DD -2.59%، 5 صفقات فقط). `Merged-Strict [B]` = الأفضل عائداً (+1594.91%، DD -24.8%، 130 صفقة). `Merged [الساذج]` مرفوض في كل الحالات حتى مع regime filter. `Chase` مرفوض دائماً (DD -66% حتى مع regime).

**ب. المتوسط السعري الذكي (Average Down):**
- **المُطبِّق:** `vps-service/analyzers/strict_entry_filters.py::evaluate_average_down()`.
- **الشروط الكمية الصارمة (قابلة للقياس):**
  1. السهم كسر قاع سابق بنسبة بين 3% و 8% (`AVG_DOWN_BREAK_MIN_PCT=3.0`, `AVG_DOWN_BREAK_MAX_PCT=8.0`).
  2. حجم شمعة الكسر أعلى من متوسط الحجم 20 يوم (`AVG_DOWN_VOL_RATIO_MIN=1.1`).
  3. خلال 1-3 أيام يرجع السعر فوق الدعم وفوق منتصف شمعة الكسر (`AVG_DOWN_RECOVERY_DAYS=3`).
  4. السعر قريب من SMA50 (within 8% — `AVG_DOWN_PROXIMITY_TO_SMA50=8.0`).
  5. مفيش Change of Character هابط واضح (no 3 consecutive lower-lows + lower-highs).
- **قواعد صارمة (hard rules — لا تُكسر):** الستوب يفضل موجود (المتوسط مش بديل للستوب) + المتوسط مرة واحدة فقط كحد أقصى (`already_averaged` flag) + حجم المتوسط = 50% من الصفقة الأصلية + الـ stop الأصلي يظل كما هو.
- **النتيجة الموثقة (Phase 2):** في backtest 19 شهر، لم يطلق Average Down أبداً (avg_used=0) لأن الشروط نادراً ما تتحقق أثناء holding مفتوح. هذا **سلوك مقبول** — الـ Average Down الذكي نادر، والـ Average Down الأعمى ممنوع.

**ج. قاعدة الرفض الإلزامية:** أي نسخة من الـ strategies بـ Max Drawdown > 25% تُرفض للإنتاج حتى لو كان العائد أعلى (توجيه المالك 2026-09-02).

### القاعدة 33 — ربط تحسينات الباك تست في الإنتاج (PRODUCTION-WIRING — 2026-08-30)
> **سبب الإضافة:** توجيه صريح من المالك (2026-08-30): "الباك تست بيتعمل عشان نحسن الحاضر والمستقبل. اربط كل حاجة الآن وأتأكد إنها مظبوطة 100%. ده أهم جزء وحط ده عندك في الدستور."

- **كل تحسين بيتعمل في الباك تست لازم يتربط في الإنتاج الحقيقي فوراً** — في `daily_predictor.py` و/أو `daily_closer.py`.
- **ممنوع** ترك تحسينات في `daily_predictor.py` بدون ربطها في الإنتاج (V40.2 هو المحرك الوحيد — القاعدة 35).
- **الملفات اللي لازم تكون مربوطة في الإنتاج دائماً:** `utils/entry_gate.py` + `utils/position_sizing.py` + `utils/circuit_breaker.py` + `core/opportunity_quality.py::compute_dynamic_target` + `core/opportunity_quality.py::enforce_atr_based_stop` + `core/opportunity_quality.py::classify_liquidity` + Sector filter + BOS/ChoCH.
- **التحقق:** بعد كل تعديل، لازم نتأكد إن الـ `grep` بيرجّع نتائج إن الملف مربوط في `daily_predictor.py` و/أو `daily_closer.py`.
- **العقوبة:** أي تحسين يفضل في الباك تست بس بدون ربط في الإنتاج = مخالفة دستورية.

### القاعدة 34 — مشروع واحد متكامل، ممنوع التكرار (NO_DUPLICATE_SCREENS — 2026-08-30)
> **سبب الإضافة:** توجيه صريح من المالك (2026-08-30): "أنت المفروض تشتغل على المشروع كا كتلة واحدة مش شاشات منفصلة ولا ملفات ملهاش علاقة ببعضها ولامتكررة دة مشروع واحد متكامل مش شوية شاشات متبعترة."

**هذا الدستور يلزم كل وكيل (AI/مبرمج) بالقواعد الآتية:**

#### 1. ممنوع إنشاء شاشة جديدة لو الخدمة موجودة في شاشة تانية
- قبل ما تضيف شاشة/ route/ tab جديد، **إبحث الأول** في `src/app/page.tsx` + `src/components/` لو الخدمة موجودة.
- لو موجودة → **أوسّعها** (أضيف tab/sub-tab داخلها)، مش أعمل شاشة منفصلة.

#### 2. كل ملف لازم يكون مربوط
- ملف `use` = مربوط. ملف مش `use` = ميت → يتعمله `VERIFY-BEFORE-DELETE` (القاعدة 16).
- ممنوع إنشاء ملف `.tsx`/`.ts` جديد بدون استيراده في `page.tsx` أو مكون تاني.

#### 3. ممنوع تكرار الـ logic
- لو فيه دالة بتخدم غرض معين، **مفيش** نسخة من نفس الـ logic في ملف تاني.
- استخدم الـ API endpoint الواحد + الـ store الواحد + الـ helper الواحد.

#### 4. الـ routing موحد
- كل route في `page.tsx` لازم يكون في `validViews` + `VALID_VIEWS` (قائمتين متناسقتين).
- ممنوع إنشاء route بدون إضافته في الاتنين.

#### 5. الـ data sources موحدة
- لكل نوع بيانات فيه **مصدر واحد رسمي**:
  - أسهم EGX → `stocks.db` (عبر `src/lib/data-engine-db.ts`)
  - كريبتو → `crypto_prices` في `data_engine.db`
  - توقعات → `predictions.db` (عبر `src/lib/db-predictions.ts`)
  - أخبار → `/api/news-feed` (مع `?market=crypto` filter)
- ممنوع إنشاء endpoint بيجيب من مصدر تاني بدون توثيق + موافقة المالك.

#### 6. قبل ما تبدأ شغل جديد
اسأل نفسك 3 أسئلة: (1) هل الخدمة دي موجودة بالفعل؟ → لو آه، أوسّعها. (2) هل فيه API endpoint بيعمل نفس الحاجة؟ → لو آه، استخدمه. (3) هل فيه ملف بـ serves نفس الغرض؟ → لو آه، ادمج فيهم.

#### 7. العقوبة
- أي شاشة/ملف/endpoint جديد بيكرر خدمة موجودة = مخالفة دستورية.
- الوكيل لازم يـ audit شغله قبل الـ commit ويتأكد إنه مفيهوش تكرار.

### القاعدة 35 — محرك واحد للتوقعات (ENGINE-UNIFY — 2026-08-31)
> **سبب الإضافة:** كان فيه محركين بيكتبوا في نفس جدول `predictions` = توقعات مكررة + متضاربة. تم التوحيد على `V40.2` كمصدر وحيد (KILL-MAESTRO — 2026-08-31).
>
> **MAESTRO-KILL (2026-10-12):** سيدي طلب: "Maestro ده ماضي أسود — شيله". تم حذف كل ملفات Maestro نهائياً (مش بس تعطيل): `analyzers/maestro_orchestrator.py` (4414 سطر) + `analyzers/crypto_maestro.py` (466) + `analyzers/unified_maestro.py` (606) + `api/maestro_routes.py` (1094) + `src/app/api/maestro/*` (3 routes) + `src/modules/dashboard/components/MaestroWidget.tsx` + `src/lib/honest-tracking/maestro.ts` (76KB parallel Node stack) + 5 backfill scripts. إجمالي: **556 KB dead code** اتشال + أرشف في `archive/maestro-dead-code-20261012/`.

- **V40.2** (`daily_predictor.py`) هو **المحرك الوحيد** المسموح له بكتابة توقعات في `predictions` table (production prediction writer).
- **PREDICTION-WRITE-GUARD** (`core/prediction_write_guard.py`): الـ Single Gate اللي بـ enforce Rule 35 على مستوى `record_prediction()`. بيـ block أي توقع:
  - بدون `engine=v40_2` tag في `notes` (Rule 35 — engine provenance).
  - بدون `kill_filter_result` signature (Rule 35 — kill filter chain).
  - BUY/STRONG_BUY/ACCUMULATE مع `evidence_count < 3` (Rule 21 — evidence-based).
  - `master_score = 50.0` placeholder (Rule 27 — NO-FAKE-DATA).
  - HOLD placeholder pattern (IMPROVEMENT-12 WAIT→HOLD bug).
  - `BYPASS_PREDICTION_WRITE_GUARD=1` env للـ migrations فقط (Rule 25 — refactoring-gated).
- **daily_closer** engine-agnostic — بيقفل أي row في `predictions` بـ `outcome_date IS NULL`.
- **ممنوع** إعادة تفعيل Maestro أو إنشاء محرك جديد بيكتب في `predictions`.
- **engine_source tag**: كل توقع جديد في `notes` فيه `engine=v40_2` أو في `kill_filter_result` signature.
- **HIDDEN-WRITERS-AUDIT (2026-10-12):** تم فحص ميكروسكوبي عميق + تعطيل **7 rogue paths** بـ تكتب في `predictions` / `persona_predictions` / `real_predictions` بدون مرور عبر `record_prediction()` (الـ Single Gate): `backfill_historical_predictions.py` + `confluence_routes.py /generate-predictions` + `optimization_loop.py` (كان بـ يعمل `DELETE FROM predictions` على كل iteration!) + `admin/backtest/v40/run` + `recommendations/retroactive-evaluate` + `prediction_tracking_routes` legacy + `telegram/auto_poster.py` SQL syntax bug. كمان 3 orphan duplicate tables اتمسحت (FULL-AUDIT-FIXES P0-3) + 9 orphan scripts معطّلة بـ early-return guards. الـ Verifier: لو لقيت أي `INSERT INTO predictions` / `UPDATE predictions SET` / `DELETE FROM predictions` بـ يتخطّى `record_prediction()` → ده Rule 35 violation. الـ Single Gate هو `analyzers/prediction_tracker.py:493-534` + الـ guard في `core/prediction_write_guard.py:14-194`.
- **MAESTRO-GHOST-HUNT (2026-10-12):** 5 Node routes كان فيها fetch لـ `/api/maestro/*` (Python endpoint محذوف) — كل ده كان ghost code بـ ينادي على عداد ميت. اتعملها redirect للـ canonical Python endpoint `/api/stocks/<ticker>/unified`. التفاصيل: راجع `01-ARCHITECTURE_AND_API.md` §5.

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
- **التكامل في V40.2**: بـ toggle `V40_2_DISCLOSURE_IMPACT=1` (default OFF). VETO → `continue` (hard reject). REDUCE → `score -= 10`. BOOST → `score += 10/20`.
- **DB**: `db/disclosures.db` → table `egx_disclosures` (dedup: ticker + event_type + date + title).
- **cron**: كل ساعتين أثناء جلسة السوق (10:00-14:00).
- **ممنوع** استخدام DuckDuckGo/NewsAPI كـ "أخبار" للقرارات التداولية. الإفصاحات الرسمية فقط.
- **المرجع:** commit `d9154387` (EGX-DISCLOSURE-ENGINE).

### القاعدة 37 — شروط الدخول الصارمة: تراكم أو Liquidity Grab فقط (STRICT-ENTRY — 2026-09-01)
> **سبب الإضافة:** توجيه المالك (2026-09-01): "النظام يرفض الدخول بعد الصعود القوي. يدخل فقط في حالتين: تراكم حقيقي أو Liquidity Grab واضح. غير كده → رفض."

- **الـ module:** `vps-service/analyzers/strict_entry_filters.py` (530 LOC).
- **3 دوال فحص**:
  1. `is_in_accumulation()`: نطاق ضيق (<12%) + حجم هادي (<1.2×) + مفيش قفزة (<12% في 5 أيام) + بعيد عن قمة 20 يوم (≥8%).
  2. `is_liquidity_grab()`: مسح تحت الدعم (≥0.5%) + رجوع فوقه + تأكيد حجم (≥1.8×).
  3. `is_late_entry()` (Don't Chase): قريب من قمة 20 يوم (<6%) OR RSI >65 OR صعود قوي (>15% في 5 أيام).
- **القرار**: `evaluate_strict_entry()`: `is_late_entry → REJECT` (hard reject — Don't Chase). `is_in_accumulation OR is_liquidity_grab → ACCEPT`. غير كده → REJECT.
- **التكامل في V40.2**: بـ toggle `V40_2_STRICT_ENTRY=1` (default OFF). بـ يشتغل **قبل** DISCLOSURE_IMPACT (entry check أول، disclosure ثاني).
- **الترتيب**: strict entry (first) → disclosure VETO (final gate).
- **المرجع:** commit `d49ab39b` (STRICT-ENTRY-FILTERS).

### القاعدة 38 — مدة احتفاظ قصيرة + خروج هيكلي (SHORT-HOLDING → structural exit — 2026-09-01)
> **سبب الإضافة:** توجيه المالك (2026-09-01): "فرض مدة احتفاظ قصيرة (7 أيام max + خروج لو مفيش حركة في 3 أيام)."
>
> **تحديث 2026-09-01 (إعادة كتابة):** بعد باك-تست B1/B2، تبيّن إن الخروج الزمني الصِّرف (`max_holding_7d` أو `no_move_3d` كسبب وحيد) بيقتل صفقات كنا مكسبينها. فالفلسفة اتغيّرت من **زمني** إلى **هيكلي**: الوقت بقى شرط مساعد ضعيف، مش سبب إغلاق وحيد. الـ module `short_holding_exit.py` (614 LOC) أُعيد كتابته بهذه الفلسفة.

- **الـ module:** `vps-service/analyzers/short_holding_exit.py` (614 LOC).
- **الفلسفة الجديدة (هيكلية مش زمنية):**
  - **`max_holding_7d`** — **ملغي كسبب وحيد**. الـ `MAX_HOLDING_DAYS=14` دلوقتي مجرد حد مراجعة (مش إغلاق إجباري).
  - **`no_move_3d`** — **ملغي كسبب وحيد**. الـ `REVIEW_THRESHOLD_DAYS=7` دلوقتي بيطلع `review_alert` (تنبيه مش إغلاق) لو النزول خارج نطاق التصحيح المعتاد.
  - **الأولوية الجديدة:** `distribution` (1) > `early_drop` (2) > `compound_breakdown` (3) > `review_alert` (4 — تنبيه فقط).
- **الدوال الجديدة (الجسر مع النوتبوك):** `is_within_typical_correction(entry, current, typical_correction_pct)` + `is_breakdown_not_correction(entry, current, typical_correction_pct, rsi, recent_closes)` + `should_force_exit_by_time(...)`.
- **`typical_correction_pct` من النوتبوك:** هو المفتاح اللي بـ يفرّق بين تصحيح (صبر) وانهيار (خروج). مثال: لو سهم typical_correction=16% والنزول الحالي 14% → صبر. لو 22% → خطر.
- **3 شروط إغلاق فعلية (مش زمنية صرفة):**
  1. `early_drop`: نزول ≤ -7% في أول 3 أيام → إغلاق إجباري (حماية رأس مال).
  2. `compound_breakdown_exit`: بعد 10 أيام + نزول أعمق من typical_correction×1.3 + ضعف هيكلي → إغلاق.
  3. `distribution_exit`: شمعة توزيع (القاعدة 39) — أعلى أولوية.
- **التكامل في daily_closer.py:** بـ toggle `V40_2_SHORT_HOLDING=1` (default OFF). بـ يشتغل **قبل** الـ trailing stop logic.
- **المرجع:** commit `dcbb5cd2` (SHORT-HOLDING-DISTRIBUTION-EXIT) + إعادة كتابة 2026-09-01 (structural philosophy).
- **نتيجة باك-تست B3 (200 سهم × 6 شهور):** لا exit واحد من نوع `max_holding` ✅ — الفلسفة الهيكلية شغّالة.

### القاعدة 39 — منطق التوزيع كإشارة خروج (DISTRIBUTION-EXIT — 2026-09-01)
> **سبب الإضافة:** توجيه المالك (2026-09-01): "إضافة منطق توزيع واضح كإشارة خروج (SELL / Force Exit)."

- **الـ module:** `vps-service/analyzers/short_holding_exit.py::detect_distribution()`.
- **5 شروط لشمعة التوزيع**:
  1. شمعة حمراء/ضعيفة (close < open أو جسم صغير).
  2. ظل علوي طويل (upper_wick ≥ body).
  3. حجم عالي (>1.8× متوسط 20 يوم).
  4. قريب من قمة 20 يوم (≤8%).
  5. RSI مرتفع (>65).
- **التكامل في daily_closer.py**: بـ toggle `V40_2_DISTRIBUTION_EXIT=1` (default OFF). distribution_exit = priority 1 (أعلى أولوية — الميكرز بـ يفرغ).
- **exit_type**: `distribution_exit` (بـ يتسجل في `predictions.exit_type`).
- **المرجع:** commit `dcbb5cd2`.

### القاعدة 40 — فهم الأخبار: News Fetcher + Sentiment Analysis (NEWS-FETCHER-ANALYZER — 2026-09-01)
> **سبب الإضافة:** توجيه المالك (2026-09-01): "كارثة الأخبار — محتاج أخبار لازم مهمة جداً + محتاج النظام يفهم الأخبار مهم جداً."

- **الـ module:** `vps-service/analyzers/news_fetcher_analyzer.py` (460 LOC).
- **المصادر** (بترتيب الأفضلية): (1) DuckDuckGo HTML search (مجاني + شغّال دايماً + بـ يدعم العربي) + (2) news.db المحلي (fallback).
- **22 سهم EGX معروف** (ticker → اسم عربي + إنجليزي للبحث).
- **تحليل المشاعر** (keyword-based — مش محتاج AI/LLM):
  - **+2 positive_strong**: أرباح قياسية، نمو قوي، استحواذ.
  - **+1 positive**: نمو، ارتفاع، تحسن.
  - **0 neutral**: محايد.
  - **-1 negative**: تراجع، انخفاض.
  - **-2 negative_strong**: خسائر، انهيار، تحقيق، إيقاف.
- **التكامل في V40.2**: بـ toggle `V40_2_NEWS_IMPACT=1` (default OFF). score +2 → BOOST_STRONG (+20) + score +1 → BOOST (+10) + score -1 → REDUCE (-10) + score -2 → VETO (hard reject).
- **الفرق عن القاعدة 36**: الإفصاحات الرسمية (Disclosure Engine) = أحداث مؤسسية محددة. News Fetcher = أخبار عامة + sentiment analysis. الاتنين مكملين لبعض.
- **المرجع:** commit `7abe2743` (NEWS-FETCHER-ANALYZER).

### القاعدة 41 — قراءة التوثيق قبل وبعد كل عمل (DOCS-FIRST-LAST — 2026-09-01)
> **سبب الإضافة:** توجيه المالك (2026-09-01): "تحط قاعدة ثابتة أساسية إنك تقرأ الملفات دي في أول الشغل وبعد ما تخلص تحدثها تاني."
>
> الفشل في قراءة التوثيق قبل العمل = تضيع وقت + إعادة اختراع العجلة + كسر القواعد.
> الفشل في تحديث التوثيق بعد العمل = الوكيل التالي بـ يكرر نفس الأخطاء.

- **قبل أي عمل (بداية كل جلسة):** اقرأ بالترتيب:
  1. `Documentation/00-CONSTITUTION.md` (الدستور — القواعد الـ 76)
  2. `Documentation/01-ARCHITECTURE_AND_API.md` (المعمارية + DBs + APIs)
  3. `Documentation/03-HOW_IT_THINKS.md` (المنطق — كيف يفكر النظام)
  4. `worklog.md` (آخر ~200-300 سطر — ما فعله الوكلاء السابقون)
  5. `CHANGELOG.md` (آخر 3 إدخالات — آخر التعديلات)

- **بعد أي عمل (قبل commit):** حدّث:
  1. `worklog.md` — إدخال واضح: Task ID + Work Log + Stage Summary
  2. `CHANGELOG.md` — إدخال في الأعلى (لو تغيير سلوكي حقيقي)
  3. التوثيق المتأثر:
     - لو غيّرت محرك → `01-ARCHITECTURE_AND_API.md` + `03-HOW_IT_THINKS.md`
     - لو غيّرت شاشة/مكوّن → `02-SCREENS_AND_COMPONENTS.md`
     - لو غيّرت قاعدة → `00-CONSTITUTION.md` (بموافقة المالك)
     - لو غيّرت بيانات/تدفق → راجع `01-ARCHITECTURE_AND_API.md` §5
  4. ارفع على GitHub فورًا بعد التحديث (Rule 75)

- **ممنوع:** الشغل بدون قراءة التوثيق أولاً + commit بدون تحديث `worklog.md` + رفع كود بدون تحديث التوثيق المتأثر + تحديث التوثيق بدون التحقق من الكود الفعلي (Grep/Read).

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

**Live Monitor (`check_active_predictions_for_notifications`):** بـ يفحص كل التوقعات النشطة (PENDING/ACTIVE) ويرسل إشعارات قرب الهدف/الستوب. التشغيل: `scripts/telegram_live_monitor.py` — cron كل 15 دقيقة أثناء الجلسة (10:00-14:30 القاهرة). Endpoint: `POST /api/telegram/notifications/live-monitor`.

**التكامل في `daily_closer.py`:** عند إغلاق أي توقع → بـ يبعت الإشعار المناسب: `TARGET_HIT` → `notify_target_hit` + `TRAILING_PROFIT` → `notify_trailing_profit` + `STOPPED` → `notify_stop_loss`.

**API endpoints (7):** راجع `01-ARCHITECTURE_AND_API.md` §5 لقائمة الـ Telegram endpoints الكاملة.

**المتغيرات البيئية المطلوبة:** `TELEGRAM_BOT_TOKEN` (Bot token من @BotFather) + `TELEGRAM_CHAT_ID` (Chat ID للقناة/المجموعة).

**قواعد الرسائل (CLIENT-FACING-STYLE + NO-HYPE-LANGUAGE):** الاحتفال بالأيموجي مسموح (🎉🏆🚀) لأنه إشعار نجاح حقيقي. لكن ممنوع المبالغة: ما نقولش "حقق أحلامك!" — نقول "هدف محقق بنجاح". كل رسالة فيها: السهم + سعر الدخول + الهدف/الستوب + العائد + الوقت + توصية عملية. رسالة `approaching_target` بتقول الدعم المهم (نصف المكسب) — ده اللي طلبه المالك صراحة.

- **المرجع:** `vps-service/telegram/telegram_notifier.py` (283 LOC) + `vps-service/api/telegram_routes.py` (1,860 LOC) + `scripts/telegram_live_monitor.py`.

### القاعدة 44 — news.db هو المصدر الوحيد للأخبار (NEWS-DB-SOT — 2026-09-02)
> **سبب الإضافة:** توجيه المالك (2026-09-02): "أنا فيه قاعدة بيانات خاصة بالأخبار ليه الغبي ده ما يستعملهاش؟ ممكن تنقل كله إلى news.db ونشتغل منها."
> المشكلة كانت إن الأخبار كانت متوزعة على قاعدتين: `data_engine.db/market_news` + `news.db/news_articles`. ده غلط معماري.

**القاعدة الحاكمة:** **`db/news.db` هو المصدر الوحيد للحقيقة (single source of truth) لكل الأخبار.** مفيش أي DB تاني يبقى فيه أخبار.

**الـ schema الموحدة (`market_news` table في `news.db`):** الأعمدة الرئيسية: `id` + `title` + `content` + `summary` + `source` + `source_type` + `source_url` + `image_url` + `market` + `symbol`/`tickers` + `category` + `importance` + `sentiment` + `is_valid_news` + `language` + `published_at` + `fetched_at` + `sent_at`/`is_sent` + constraint `UNIQUE(title, source)`. التفاصيل الكاملة للـ schema: راجع `01-ARCHITECTURE_AND_API.md` §3.

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

**toggle V40.2:** `V40_2_NEWS_IMPACT=1` → بـ يـ boost/reduce/veto التوقعات بناءً على الأخبار. `V40_2_NEWS_IMPACT=0` (default للـ backtest safety) → الأخبار ما بتأثرش على score.

**التأثير على V40.2 score:** `VETO` (score ≤ -2) → رفض التوقع تماماً + `BOOST_STRONG` (+2) → score += 20 + `BOOST` (+1) → score += 10 + `REDUCE` (-1) → score -= 10.

**الهجرة (2026-09-02):** 7,894 خبر من `news.db/news_articles` (legacy) → `news.db/market_news`. 7,809 خبر من `data_engine.db/market_news` → `news.db/market_news`. بعد dedup (UNIQUE title+source): **7,809 خبر** في `news.db/market_news`. `news.db/news_articles` (legacy) اتمسحت (البيانات اتحفظت في backup).

**المرجع:** `vps-service/analyzers/news_fetcher_analyzer.py` (function جديدة `_get_news_from_market_news_db`) + `src/app/api/news/route.ts` + `src/app/api/news-feed/route.ts` + `src/app/api/admin/news/route.ts`.

### القاعدة 45 — ربط البيانات المدفونة بـ V40.2 (SCREENER-FUNDAMENTALS-DEPTH — 2026-09-03)
> **سبب الإضافة:** توجيه المالك (2026-09-03): "انا عندى تصنيفات كتييييييير جدا لية مش بنستعملها؟" + "عندك بيانات عمق السوق الى هى عروض البيع والشراء؟"
>
> المشكلة كانت إن `data_engine/scrapers` فيها 13 scraper بتجمع بيانات ضخمة (8 قوائم تصنيف + 9 تبويبات بيانات مالية + bid/ask) بس **V40.2 مش كان بيستخدم أي منها**.

**الـ module الموحّد:** `vps-service/analyzers/screener_integration.py`

**البيانات المربوطة (3 مصادر):**

| # | المصدر | DB | التأثير |
|---|--------|-----|---------|
| 1 | screener_lists (8 قوائم) | data_engine.db | unusual_volume +10, undervalued +9, most_active +8, high_dividend +6, high_net_income +5, top_gainers -6 (+VETO لو RSI>70), penny -8 (+VETO) |
| 2 | tab_valuation + tab_profitability | data_engine.db | ROE>15% + P/E<15 → +5, P/E>100 → VETO (bubble) |
| 3 | intraday_prices (bid/ask) | intraday.db | spread < 0.5% → +3 (سيولة عالية) |

**مكان الربط في V40.2:** بعد entry_gate، قبل sector-liquidity filter. **VETO:** لو screener/fundamentals قال VETO → `continue` (رفض فوري). **Safe-by-design:** لو أي مصدر فشل → V40.2 بيكمل بدون تأثير.

**المرجع:** `vps-service/analyzers/screener_integration.py` + `vps-service/jobs/daily_predictor.py` (سطر 1064-1120).

### القاعدة 46 — تنظيف قواعد البيانات الشامل (DB-CLEANUP-WAVE-1+2+3 — 2026-09-03)
> **سبب الإضافة:** توجيه المالك (2026-09-03): "لية التداخل الغبى دة واية كم الجداول الرهيب دة؟ انت كدة ريحتنى من 3 قواعد بيانات اية اخبار الباقى"

**الـ 3 موجات (Waves) المنفصلة:**

#### WAVE-1: حذف 3 DBs غير مستخدمة (توفير ~37 MB)
| DB | الحجم | السبب |
|----|------|------|
| `custom.db` | 24 KB | default Prisma DB، الـ stubs كلها deprecated |
| `prices.db` | 21 MB | صفر references في الكود — البيانات كلها مكررة في data_engine.db |
| `crypto.db` | 32 KB | 0 rows + dead code (unified-db.ts بـ query جدول `crypto_coins` مش موجود) |

كمان: cleanup لـ `src/lib/unified-db.ts` (شيل 124 سطر كود ميت) + حذف dead endpoint `/api/unified-crypto/route.ts`.

#### WAVE-2: migration price_history readers لـ data_engine.db.egksco_price_history
**الـ migration rules:** `FROM price_history` → `FROM egksco_price_history` + `ticker` → `symbol` + `date` → `price_date` + شيل أي filter على `source`. **10 ملفات TS** اتعملها migration (تفاصيلها: راجع `01-ARCHITECTURE_AND_API.md` §3 + `04-CURRENT_STATE.md` §1).

#### WAVE-3: drop 9 جداول فاضية + VACUUM (توفير ~4.5 MB)
| DB | الجداول اللي اتمسحت |
|----|---------------------|
| `stocks.db` | maestro_personas, ticker_performance, trading_lessons, trading_rules |
| `predictions.db` | CachedAnalysis, TechnicalIndicator (camelCase duplicates) |
| `auth.db` | optimized_parameters, platform_recommendations, user_trades |

VACUUM اتعمل لـ 3 DBs (stocks.db, predictions.db, auth.db).

**النتيجة النهائية:** **7 DBs** بدل 10 (توفير ~41.5 MB) + **9 جداول أقل** + **123 سطر كود ميت أقل** + `price_history.db` محتفظ بيه كـ **safety net فقط** (الكود بـ reads من data_engine.db.egksco_price_history) + كل الـ API routes بـ 200 OK + Lint بدون أخطاء + Backtest محترم اشتغل بـ 68 trade (PF=1.19, Return=+1.35%) + 10 توقعات جديدة بناءً على screener + fundamentals + ATR + RSI + volume.

**الـ backup:** محفوظ في `backups/db-cleanup-20260903-163211/` (331 MB — كل الـ DBs الـ 10 قبل التنظيف).

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

**الـ scrapers المعطّلة (محتفظ بيها، مش نشطة):** `rss_collector.py.disabled` + `investing_scraper.py.disabled` + `investing_news_collector.py.disabled` (محتاج Playwright + chromium).

**Rule 28 (NO-DUPLICATION):** كل الـ scrapers بتكتب في `/home/z/my-project/db/` (الـ canonical). مفيش DBs مكررة في `news-agent/`.

**Rule 29 (UNIFIED-SYSTEM):** `news-agent/config/paths.py` بيوفّر مسارات موحدة لكل الـ scrapers.

**news merge:** 212 خبر من news-agent القديم ادمجت في `db/news.db.market_news` (الإجمالي دلوقتي 8,012 خبر).

**AI محلي معطّل:** المشروع الأصلي كان بيستخدم Ollama. إحنا مش محتاجينه — V40.2 بيعتمد على rules + indicators.

**الـ backup:** DBs الأصلية لـ news-agent محفوظة في `news-agent/_disabled_dbs/` (للرجوع فقط).

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

#### الـ fallback chain (Rule 24: SAFE-BY-DESIGN): (1) Primary: Daleelak API → (2) Fallback 1: Frankfurter.dev CBE (للعملات فقط) → (3) Fallback 2: isagha.com (للذهب فقط) → (4) Fallback 3: hardcoded values (للحالات الطارئة).

#### النتايج (بعد الـ migration): Gold: 7,374.76 USD/ounce (from Daleelak gold-24k) + Silver: 110.37 USD/ounce (from Daleelak silver-999) + Exchange rates: 14 currency (from Daleelak — USD, EUR, GBP, SAR, AED, KWD, CAD, AUD, QAR, OMR, ...). **كل الـ APIs مجانية + بدون مفتاح + مرخّصة مصرياً**.

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

**الكفاءة المجمّعة:** `combined_efficiency = (win_rate_A × 0.4) + (win_rate_B × 0.6)` — المسار B يأخذ وزن أعلى (0.6) لأن إشاراته أندر وأقوى.

**الـ artifacts (مرفوعة على GitHub):** راجع `01-ARCHITECTURE_AND_API.md` §5 لقائمة الـ endpoints + `04-CURRENT_STATE.md` §1 لتفاصيل الـ DB schema additions (`track TEXT DEFAULT 'full_analysis'` على `predictions` + `aiPrediction` + `persona_predictions` + جدول `liquidity_backtest_results` + جدول `liquidity_dynamic_threshold` + جدول `liquidity_signal_outcomes`).

**الـ Route:** `#dual-track` (tab جديد في الـ nav مع التوقعات).

**التحقق الذاتي الإلزامي:**
- `/api/predictions/dual-track/threshold?market=all` → لازم يرجع `threshold_value > 0` لكل سوق
- `/api/predictions/dual-track/stats` → لازم يرجع `combined_efficiency` رقم
- `/api/predictions/dual-track/backtest?market=EGX&execute=1` → لازم يرجع `results[0].total_signals > 0`
- لو أي endpoint رجع `fallback_used: true` → الـ DBs مش متاحة، لازم يتصلح الأول

### القاعدة 50 — MONEY-AS-CUSTOMER-LIFE (محفظة العميل = أهم حاجة في حياته — 2026-09-24)
> **سبب الإضافة:** فحص خبير إدارة الأموال كشف إن 6 endpoints حرجة كانت ترجع **بيانات وهمية هاردكود** (5 أسهم خيالية: COMI/ABUK/EAST/SWDY/HRHO) بدلاً من قراءة محفظة العميل الحقيقية. هذا **انتهاك أخلاقي** لمعيار "فلوس العميل = أهم حاجة في حياته".

**القاعدة الذهبية المطلقة:** أي رقم يظهر للعميل في شاشات المحفظة/الثروة/التنبيهات لازم يكون **رقم حقيقي من الـ DB**. ممنوع منعاً باتاً عرض:
- بيانات هاردكود (mock data) كأنها بيانات حقيقية للعميل
- نسب قطاعات ثابتة (42%/25%/18%/15%) بدلاً من حسابها من portfolio_assets
- تنبيهات "شكلية" بدون فحص فعلي للأسعار
- توصيات إنقاذ/زيادة بدون قراءة الـ PnL الحقيقي للعميل

**الـ Endpoints الحرجة (تم إصلاحها في commits 6cda299..6292b96):**

Tier 1 — إيقاف الكذب على العميل: `/api/portfolio/holdings` (يقرأ من `portfolio_assets` REAL holdings + live prices) + `/api/portfolio/watchlists` + `/api/portfolio/bag-holder-rescue` + `/api/portfolio/smart-monitor/signals` + `/api/portfolio/risk-summary` + `WealthCharts.tsx` (يقرأ من `/api/portfolio/equity-curve` REAL wealth_tracking snapshots).

Tier 2 — محرك التنبيهات الموحّد: `src/lib/schedulers/alert-engine.ts` (3 functions: `runStockAlertsCheck` + `runGoldAlertsCheck` + `runPortfolioPnLCheck` + `runAllAlerts`) + `/api/alerts/scheduler` + `/api/notifications` + `/api/alerts/gold` + `/api/finance/seed-alert-thresholds` + `TopUpRecommendationsPanel.tsx` + `NotificationCenter.tsx`.

**محرك التنبيهات (`alert-engine.ts`):** `runStockAlertsCheck(userId)` — يفحص `user_stock_watchlists.alert_price_above/below` مقابل `stocks.current_price`. `runGoldAlertsCheck(userId)` — يفحص `gold_alerts` مقابل `getLiveEgyptGoldPrices()` (229K صف في data_engine.db). `runPortfolioPnLCheck(userId)` — يفحص `portfolio_assets`: لو سهم خسران > 10% → `bag_holder_warning` (severity: danger) + لو سهم رابح > 15% → `top_up_opportunity` (severity: success). منع التكرار: `WHERE created_at > datetime('now', '-24 hours')` بنفس (user_id, type, ticker, message).

**الـ Disclaimer الإلزامي:** كل توصية (Hold/Cut-Loss/Top-Up/Average-Down) لازم ترفق بـ:
> "⚠️ توصية آلية مبنية على بيانات تاريخية. ليست نصيحة استثمارية مرخصة. استشر مستشاراً مالياً مرخّصاً قبل أي قرار."

هذا يحمي المنصة قانونياً أمام FRA (Financial Regulatory Authority) المصرية.

**التحقق الذاتي الإلزامي (لكل PR جديد يلمس المحفظة):**
1. `curl /api/portfolio/holdings?user_id=<real_user>` → لازم يرجع `source: sqlite_fallback` و `total_items > 0` (مش mock)
2. `curl /api/alerts/scheduler?only_me=1 -X POST` → لازم يرجع `total >= 0` (مش 503)
3. `curl /api/notifications?user_id=<real_user>` → لازم يرجع `notifications: [...]` (مش error)
4. لو أي endpoint رجع hardcoded data → PR **مرفوض** فوراً.

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

**شروط إشارة المسار B حسب السوق:** راجع `03-HOW_IT_THINKS.md` لتفاصيل الـ pipeline المنطقي لكل سوق.

**مصادر البيانات (Data Routing):** الأسهم (EGX/KSA/US): `db/price_history.db` + الكريبتو: `db/data_engine.db.crypto_prices` (437K صف، 93 عملة) + الذهب: `db/data_engine.db.gold_prices_clean` (231K صف) + Fallback: `db/intraday.db` للـ EGX، `db/data_engine.db.historical_data` للـ KSA.

**معالجة الحجم النصي (Safe Volume Parsing):**
```python
def parse_volume(v) -> int:
    v_str = str(v).replace('\u202f', '').replace(' ', '').replace(',', '').strip().upper()
    if v_str.endswith('B'): return int(float(v_str[:-1]) * 1_000_000_000)
    if v_str.endswith('M'): return int(float(v_str[:-1]) * 1_000_000)
    if v_str.endswith('K'): return int(float(v_str[:-1]) * 1_000)
    return int(float(v_str))
```

**شرط التأهيل (Qualification Gate):** `hit_rate ≥ 65.0% AND total_signals ≥ 30`. **Combined Efficiency:** `combined_efficiency = (win_rate_A × 0.40) + (win_rate_B × 0.60)`.

### القاعدة 52 — العناصر الموحدة لإعادة الاستخدام (UNIFIED-REUSABLE-COMPONENTS — 2026-09-25)
> **سبب الإضافة:** توجيه صريح من المالك (2026-09-25): "انت لية مستعملتش عنصر الجدول الموحد فى كل مكان فى المشروع بمعنى فعلياً فى كل مكان وأى مكان فية جدول استبدله. وانت لية مش مستخدم العنصر الموحد للنشر فى كل مكان داخل المشروع ويكون فية كل الى موجود فى عنصر النشر الى فى شاشة الأخبار". المنصة كتلة واحدة — كل شاشة لازم تستخدم نفس العناصر الموحدة، مش كل شاشة تبني element خاص بها.

**أ. الجدول الموحد (UnifiedTable):**
- **المكوّن:** `src/components/shared/UnifiedTable.tsx` — جدول generic قابل لإعادة الاستخدام.
- **الاستخدام الإلزامي:** أي شاشة فيها جدول بيانات (توقعات، قطاعات، أسهم، توصيات، محفظة، إلخ) **لازم** تستخدم `<UnifiedTable>` بدل بناء `<Table><TableHeader>...` يدوياً.
- **الميزات:** loading skeleton، empty state عربي، sticky header، sortable columns، horizontal scroll، custom scrollbar، row hover/click، dense mode، RTL.
- **الاستثناءات الوحيدة:** الجداول اللي فيها expandable rows أو features خاصة جداً — بس حتى دي لازم تتـ refactored لما UnifiedTable يدعم expansion.

**ب. زر النشر الموحد (UnifiedPublishButton):**
- **المكوّن:** `src/components/shared/UnifiedPublishButton.tsx` — زر نشر dropdown فيه كل منصات النشر.
- **الاستخدام الإلزامي:** أي شاشة فيها محتوى قابل للنشر (توقعات، تقارير، أخبار، تحليلات، dashboard) **لازم** تستخدم `<UnifiedPublishButton>` بدل بناء أزرار مشاركة منفصلة.
- **المنصات المدعومة:** Telegram + Facebook + WhatsApp + Twitter + LinkedIn + Copy + Image export (PNG). ده نفس الـ feature set بتاع شاشة الأخبار.
- **الـ split mode:** لو الشاشة محتاجة أزرار منفصلة، استخدم `<UnifiedPublishButton split />`.

**ج. قاعدة عدم التكرار في الـ UI Components:**
- **ممنوع** إنشاء component جديد بنفس وظيفة component موجود. لو محتاج جدول → `UnifiedTable`. لو محتاج نشر → `UnifiedPublishButton`. لو محتاج بحث عن سهم → `StockSearchSelector`. لو محتاج تبديل سوق → `ExchangeSelector`.
- قبل بناء أي component جديد، اسأل: "هل فيه component موجود بـ يعمل ده؟" (Grep في `src/components/shared/`).

### القاعدة 53 — دمج الكريبتو في الأسواق (CRYPTO-IN-MARKETS — 2026-09-25)
> **سبب الإضافة:** توجيه صريح من المالك (2026-09-25): "فى قائمة المزيد يوجد العديد من صفحات الكريبتو فى حين انى امرتك تدمج الكريبتو داخل الأسواق". الكريبتو سوق مثل أي سوق آخر — يُختار من مبدّل الأسواق (Market Switcher)، مش من قائمة منفصلة.

- **مبدّل الأسواق (ExchangeSelector في TopBar):** هو الطريق الوحيد للتبديل بين الأسواق (EGX/TADAWUL/KSE/QSE/CRYPTO). لما السوق = CRYPTO، كل شاشات السوق (stocks، trading-chart، recommendations، إلخ) بتعمل mirror تلقائياً وتعرض بيانات الكريبتو (UI-Mirror Protocol).
- **قائمة "المزيد" (TopBar → المزيد):** **ممنوع** وضع أي إدخالات crypto منفصلة (crypto، crypto-live، crypto-recommendations، crypto-trading-chart، crypto-screener، crypto-analysis، crypto-learning، crypto-simulation). كل دي اتشالت من القائمة في 2026-09-25.
- **deep links:** الـ hash routes القديمة (مثلاً `#crypto-trading-chart`) لسه شغّالة كـ redirects للـ unified view المناسب (عشان الـ backwards compatibility مع الـ Flutter app) — بس مش معروضة في الـ UI.
- **الاستثناء الوحيد:** ودجت "إشارات الكريبتو" على الداشبورد — بتظهر بس لما `currentMarket === 'CRYPTO'` كجزء من الـ widget registry (مش قائمة منفصلة).

### القاعدة 54 — ترقية الجدول الموحد (UNIFIED-TABLE-UPGRADE — 2026-09-26)
> **سبب الإضافة:** تتمةً للقاعدة 52 (UNIFIED-REUSABLE-COMPONENTS). بعد إقرار UnifiedTable كجدول وحيد، تبيّن أن 21 شاشة لا تزال تستخدم `<Table>` اليدوي من shadcn/ui، وأن بعض الشاشات كانت محتاجة ميزات (expandable rows + column toggle + filtering + toolbar) كانت السبب المُعلَن لعدم الترحيل. الجلسة الحالية رفعت UnifiedTable ليدعم كل هذه الميزات، فأصبح الترحيل إلزامياً ومُمكن فنياً. النموذج المرجعي المعتمد هو `SectorTrackingTab`.

**أ. ميزات UnifiedTable بعد الترقية:** Expandable Rows (`renderExpanded` prop) + Column Toggle (localStorage persistence) + Column Filtering (text/number/select/date range) + Toolbar (`UnifiedPublishButton` (Rule 52) + Export CSV/PNG/PDF).

**ب. النموذج المرجعي (Canonical Pattern):** `src/components/admin/SectorTrackingTab.tsx` هو المرجع الوحيد لكيفية استخدام UnifiedTable في أي شاشة جديدة أو مُحدَّثة. يُمنَع إدخال أي مكوّن جدول جديد (لا `<Table>` يدوي، ولا `DataGrid`، ولا `react-data-table`، إلخ). UnifiedTable هو المكوّن الوحيد.

**ج. شاشات Admin + Client — لا فرق:** لا يوجد جدول مخصّص للـ admin وآخر للعميل. UnifiedTable واحد يخدم كلتا الجهتين، والفروقات تُدار بـ props (مثلاً `dense`, `showToolbar`, `defaultHiddenColumns`).

**د. خطة الترحيل (Migration Plan):** **21 شاشة** لا تزال تستخدم `<Table>` يدوي وتحتاج ترحيل إلى `<UnifiedTable>`. حصرها مذكور في `02-SCREENS_AND_COMPONENTS.md` §0. الترتيب: تبدأ بشاشات الـ admin (لأنها الأعلى استخداماً للـ features الجديدة)، ثم شاشات العميل.

**هـ. الاستثناءات الوحيدة:** الجداول الصغيرة جداً (≤ 3 أعمدة × ≤ 5 صفوف) داخل modals أو tooltips + الجداول التي تحتاج rendering مخصّص للخلايا مع canvas/SVG معقّد — تُدرَس حالةً بحالة.

### القاعدة 55 — P0-WAVE-SECURITY (auth guards على admin routes — 2026-09-27)
> **سبب الإضافة:** P0 Disaster Resolution Wave (wave 1–3) كشفت إن 540/658 API route (82%) كانت بدون auth check (AUDIT_ENGINEERING §5.3). كارثة #11 تم حلها بإنشاء `src/lib/admin-guard.ts` (74 LOC — thin re-export of canonical `requireAdminAsync` من `@/lib/admin-auth-server`) + إضافة `requireAuthAsync(req)` جديد لـ user-scoped routes. 30 route تم تأمينها (4 admin + 26 non-admin) عبر 44 HTTP method handlers.

**أ. القاعدة المطلقة:** كل API route تحت `/api/admin/*` لازم يستخدم `requireAdminAsync()` من `@/lib/admin-guard`. ما يسمحش بـ unauthenticated access لأي endpoint بيعدّل بيانات.

**ب. الـ non-admin routes اللي بتعدّل بيانات (money endpoints، market sync، backtesting، AI proxies):** لازم تستخدم إما `requireAdminAsync()` (إذا كانت admin-level operations زي market/sync أو backtesting) أو `requireAuthAsync(req)` (إذا كانت user-scoped زي paymob/instapay/subscription).

**ج. defense-in-depth pattern:** لو route عندها auth check قديم (`verifyAdminToken` / `verifyAdminRequest` / `getServerSession`) — القاعدة الجديدة `requireAdminAsync` تُضاف **قبلها** مش بدلاً منها (الاثنين لازم يـ passوا).

**د. الاستثناءات:** login routes اللي بتـ issue tokens (`/api/admin/auth/token`, `/api/admin/auth/auto-cookie`, `/api/admin/auth/route`) — لا يحتاجوا auth لأنهم issuing tokens. Webhooks مع HMAC verification (`/api/paymob/callback`) — عندهم verification مختلف.

### القاعدة 56 — P0-WAVE-SQLI (منع string interpolation في SQL — 2026-09-27)
> **سبب الإضافة:** AUDIT_ENGINEERING §5.4 لقت 11 SQL injection sites حقيقية، أخطرها `/api/tab-data?table=...` كان يعمل `db.prepare(\`SELECT * FROM ${tableName}\`)` بـ tableName من query string. P0-12-SQLI أصلح 7 sites في 5 ملفات.

**أ. القاعدة المطلقة:** ممنوع استخدام string interpolation (\`${var}\`) في SQL queries. الـ table names + column names لازم من **whitelist** (Set-based أو constant array). الـ values لازم via `?` parameterized queries.

**ب. الـ 3 canonical safe patterns (الـ P0-12 fixes بـ تتبعهم):**
1. **Bound `?` parameters** — `db.prepare('SELECT * FROM foo WHERE x = ?').get(value)`
2. **Set-based whitelist** مع 400 rejection على unknown — `if (!ALLOWED.has(name)) return NextResponse.json({error}, {status: 400})`
3. **Strict identifier regex** `/^[A-Za-z_][A-Za-z0-9_]*$/` على table/column names مع 400 rejection

**ج. الـ defence-in-depth:** حتى لو الـ input من DB metadata (`sqlite_master` مثلاً)، يُطبَّق عليه نفس الـ regex check (احتمال schema corruption).

**د. الـ comment marker:** كل fix site لازم يحمل `// P0-12-SQLI fix (2026-09-27): ...` comment.

### القاعدة 57 — P0-WAVE-ASYNC (منع blocking sync I/O في API routes — 2026-09-27)
> **سبب الإضافة:** AUDIT_ENGINEERING §3.2 لقت إن 120/658 API route (18%) بيستخدم blocking sync I/O داخل async handlers (`readFileSync` / `writeFileSync` / `existsSync` / `execSync` / `statSync` / `readdirSync`). ده بـ blocks الـ Node.js event loop و بيوقف كل الـ concurrent requests. P0-14-ASYNC أصلح 24 route (~70+ individual sync sites).

**أ. القاعدة المطلقة:** ممنوع `readFileSync` / `writeFileSync` / `existsSync` / `execSync` / `statSync` / `readdirSync` / `mkdirSync` / `unlinkSync` جوّه API route handlers. استخدم `fs/promises` (readFile, writeFile, access, stat, mkdir, readdir, unlink) + `promisify(execFile)` بدل `execSync`.

**ب. الـ patterns المعتمدة (P0-14-ASYNC):**
- `existsSync(path)` → `await access(path).then(() => true).catch(() => false)` أو `await stat(path).then(() => true).catch(() => false)`
- `readFileSync(path, 'utf8')` → `await readFile(path, 'utf8')`
- `execSync('cmd args')` → `await execFile('cmd', ['args'])` (shell-injection-safe لأن argv separate)
- `execSync('ps aux | grep ...')` → `await execFile('pgrep', ['-f', ...])` (single-process check، no shell)

**ج. Module-level sync calls الاستثناء الوحيد:** الـ sync calls اللي بـ تـ happen مرة واحدة عند module load (مش per-request) — مقبولة. مثال: `resolveBinary()` في db-backup اللي بـ تـ resolve path للـ binary عند boot.

**د. الـ comment marker:** كل fix site لازم يحمل `// P0-14-ASYNC fix (2026-09-27): ...` comment.

### القاعدة 58 — P0-WAVE-OBSERVABILITY (Sentry + structured logging + health — 2026-09-27)
> **سبب الإضافة:** AUDIT_ENGINEERING §5.5 لقت "0 error-tracking integration (لا Sentry / لا Bugsnag). 0 metrics integration. 0 request tracing. /api/health بـ checks file existence فقط". P0-7-15-INFRA أصلح كل ده.

**أ. القاعدة المطلقة:** كل production deployments لازم يكون فيها `SENTRY_DSN` set في `.env`. الـ `/api/health` endpoint لازم يفتح الـ DB فعلياً (SELECT 1) + يـ ping الـ PM2 ports (python-backend 8010، ws-service 3005، telegram-events 3003، pgrep news-agent/main.py) + يفحص الـ disk space.

**ب. الـ Sentry config المعتمدة:** `sentry.client.config.ts` + `sentry.server.config.ts` (opt-in via `if (SENTRY_DSN)` — no-op لو empty). `withSentryConfig` wrapper في `next.config.ts`. 10% transaction sampling في prod / 100% في dev / 100% errors.

**ج. الـ structured logger المعتمد:** `src/lib/logger.ts` — emits single JSON line per log (`{"timestamp","level","message",...context}`). 4 levels (debug/info/warn/error). 12-factor compliant (stderr for errors/warnings، stdout for info/debug). `MIN_LEVEL` reads `process.env.LOG_LEVEL || 'info'`.

**د. الـ x-request-id middleware:** `src/middleware.ts` يضيف `x-request-id` header على كل response (UUIDv4 لو مش موجود inbound، echo لو موجود — distributed trace propagation).

**هـ. الـ /api/health response shape:** `status: "ok" | "degraded" | "down"` + `components: { databases: {...}, nextjs: {...}, disk: {...} }`. HTTP 200 ok/degraded، HTTP 503 down (upstream LB يقدر يـ fail-over).

### القاعدة 59 — P0-WAVE-TESTS (اختبارات إلزامية لكل P0 fix — 2026-09-27)
> **سبب الإضافة:** AUDIT_ENGINEERING §6 لقت test coverage = 0.3% (3 test files / 873 LOC / 75 tests على 291K LOC). Industry standard = 30–60%. P0-16-TESTS أضاف 6 test files / 46 new tests / 923 LOC، وصار 9 test files / 121 tests / 1,796 LOC. 121/121 passing.

**أ. القاعدة المطلقة:** أي fix لـ P0 disaster لازم يبقى معاه test case في `src/__tests__/`. الـ tests بتمشي قبل كل commit (`bun run test`). ما يسمحش merge PR لو الـ tests بـ fail.

**ب. الـ 6 categories إلزامية لـ test coverage:**
1. **Security** — `src/__tests__/security/sql-injection.test.ts` + `auth-guard.test.ts` + `import-endpoint.test.ts`
2. **Predictions pipeline** — `src/__tests__/predictions/pipeline.test.ts` (no duplicates, stored_analyses populated, no false TARGET_HIT, schema integrity)
3. **DB integrity** — `src/__tests__/db/integrity.test.ts` (4 DBs open read-only, gold_prices NOT in stocks.db per P0-8)
4. **API contract** — `src/__tests__/api/health.test.ts` (status 200/503, body shape, Cache-Control: no-store, <5s response time)

**ج. الـ test philosophy المعتمدة:** READ-ONLY DB connections (no mocks) لـ integrity tests + Live HTTP fetch against `localhost:3001` لـ API integration tests (auto-skip لو server مش شغال — graceful degradation في CI) + `describe.skipIf(!serverUp)` pattern لـ graceful skip.

**د. الـ test targets (Recommendations لـ future):** Playwright E2E tests لـ golden paths + CI pipeline لـ auto-run على كل PR + auto-generate per-route smoke tests لرفع coverage لـ 10–15% + target 30% coverage في 3 شهور.

### القاعدة 60 — MODULE-SYSTEM (كل كود جديد جوّه موديول قياسي — 2026-09-30)
> **سبب الإضافة:** إعادة تنظيم المشروع من مشاريع صغيرة متفرقة لـ **17 موديول قياسي** في `src/modules/` + **9 موديولات backend placeholders** في `vps-service/modules/` (المراحل 1-7 من MASTER-ARCHITECTURE-PLAN + إضافة subscription + auth لاحقًا). لازم نضمن إن الكود الجديد يتبع نفس البنية عشان ما نرجعش للتشتت اللي كان قبل كده.
>
> **المرجع:** `worklog.md` entries `REORG-PHASE-1-2` → `REORG-PHASE-7-DOCS` — see `04-CURRENT_STATE.md` §1 (Module Architecture) for the live module count.

**أ. القاعدة المطلقة:** كل كود جديد لازم يكون جوّه موديول في `src/modules/<module>/` (frontend) أو `vps-service/modules/<module>/` (backend). الـ components في `src/components/` legacy ويُفضّل ترحيلها تدريجياً (Rule 25 — refactoring-gated).

**ب. الـ module structure المعتمدة:**

Frontend:
```
src/modules/<module-name>/
├── components/         (React components)
├── lib/                (module-specific helpers)
└── index.ts            (PUBLIC INTERFACE — re-exports only)
```

Backend (placeholder حتى يتعمل Python migration):
```
vps-service/modules/<module-name>/
└── __init__.py         (docstring placeholder — file moves deferred)
```

**ج. قواعد الـ imports:**
1. كل موديول لازم يكون عنده `index.ts` كـ public interface.
2. الـ internal files private — direct imports زي `@/modules/<x>/components/InternalFile` مكروهة (DISCOURAGED).
3. الـ imports بين الموديولات عبر الـ `index.ts` فقط.
4. transitional exception: API routes ممكن تـ import مباشرة من `@/modules/<x>/lib/*` (تسهيل الـ migration من الـ legacy code).
5. ما فيش imports مباشرة من `src/components/<domain>/` للـ modules الجديدة — استخدم `@/modules/<x>` أو `@/components/shared/`.

**د. الـ 17 frontend modules المعتمدة (Phase 1-7 — updated 2026-10-01):** radar · publishing · personalized · stock-analysis · predictions · portfolio · screener · market-analysis · news · admin · crypto · education · reports · dashboard · simulation · subscription · auth.

**هـ. الـ 9 backend module placeholders (Phase 3.2):** radar · predictions · market_regime · market_data · telegram · ai · portfolio · admin · (root).

**و. الـ DB layer (Rule 5 + Phase 5):** كل الـ DB access بيحصل عبر `src/lib/db/index.ts` (single entry point). الـ DB helpers اللي كانت متفرقة اتـ consolidatedت: `db-auth.ts` + `db-predictions.ts` + `modules/radar/lib/radar-db.ts` + `finance-db.ts` + `new-db.ts` + `egxpy-bridge.ts` + `egx-data-sources.ts`. تفاصيل كل DB + جداولها + علاقاتها: راجع `01-ARCHITECTURE_AND_API.md` §3.

### القاعدة 61 — المسارات النسبية فقط (RELATIVE-PATHS-ONLY — 2026-09-30)
> **سبب الإضافة:** المشروع لازم يشتغل على sandbox + staging + production بدون تعديل المسارات. الكوارث السابقة (cron entries كانت بتشير إلى `/home/meme/...` على VPS فشل السكربتات) لازم ما تتكررش. القاعدة 17 ذكرت المبدأ العام؛ هذه القاعدة تفصّل الآلية لكل لغة/سياق.

- **Python:** استخدم `Path(__file__).resolve().parents[N]` لتحديد PROJECT_ROOT. ممنوع `/home/z/...` أو `/root/...` hardcoded.
  ```python
  from pathlib import Path
  PROJECT_ROOT = Path(__file__).resolve().parents[1]  # scripts/X.py → project root
  DB_PATH = str(PROJECT_ROOT / 'db' / 'data_engine.db')
  ```
- **TypeScript:** استخدم `process.cwd()` أو `path.join(process.cwd(), ...)`. ممنوع `/home/z/...` hardcoded.
  ```typescript
  import path from 'path';
  const DB_PATH = path.join(process.cwd(), 'db', 'predictions.db');
  ```
- **Log files:** استخدم `os.environ.get('LOG_DIR', '/tmp')` بدلاً من `/tmp/` hardcoded.
- **Cron entries:** استخدم `sed` one-liner (موجود في رأس `crontab.txt`) لتعديل المسارات عند التثبيت.
  ```bash
  sed "s|/root/GLMinvestment|$(pwd)|g" crontab.txt > /tmp/crontab.txt && crontab /tmp/crontab.txt
  ```
- **DB paths:** استخدم `vps-service/utils/db_paths.py` (المصدر الوحيد لمسارات الـ DBs) — لا تكرّر hardcoded DB paths في أي ملف آخر.
  ```python
  from utils.db_paths import DBPaths
  conn = sqlite3.connect(DBPaths.PREDICTIONS_DB)
  ```
- **Shell scripts:** استخدم `$(dirname "$0")/..` لتحديد PROJECT_ROOT.

**الاستثناء الوحيد:** cron entries اللي بتشتغل في production (المسار `/root/GLMinvestment` فيها متوقع) — لكن لازم يبقى فيه `sed` one-liner في رأس `crontab.txt` عشان يتعدّل بسهولة عند التثبيت على بيئة تانية.

### القاعدة 62 — انضباط الرفع على GitHub + تذكير السكرتيرة (GIT-PUSH-DISCIPLINE — 2026-10-01)
> **سبب الإضافة:** الفريق بيتكم بكم هائل من الشغل في كل جلسة (في جلسة 2026-10-01 وحدها: اجتماع استراتيجي + محضر 700 سطر + تنفيذ 5 مهام + 1452 LOC + worklog 98 سطر). الكمية دي بتجعل المدير العام والفريق ينسوا يرفعوا الشغل على GitHub. ولما الشغل ما بيرتفعش بيحصل كوارث: الـ sandbox ممكن يطفي ويُفقد كل الـ changes + الـ production مش هيستفيد من الـ fixes الجديدة + الـ audit trail بينكسر + التعاون بين الأجهزة بيتبهدل.
>
> **المبدأ:** السكرتيرة هي "الضمير" بتاع الفريق — لازم تفكّر المدير العام والفريق برفع الشغل على GitHub بعد كل Task، وتفكّرهم بقراءة الـ Documentation قبل بدء أي Task جديد.

#### 62.1 — تذكير السكرتيرة الإلزامي (Secretary Reminders)

السكرتيرة (Documentation Secretary agent) لازم تعمل الآتي في **نهاية كل Task** وقبل ما المدير العام يعلن إن المهمة خلصت:

1. **تذكير الـ Git Push** — تذكّر المدير العام بـ: `git status` + `git push origin main` + commit message واضّاح (مش UUID أو "wip").
2. **تذكير قراءة الـ Documentation** — قبل بدء أي Task جديد، تذكّر المدير العام: هل قريت `00-CONSTITUTION.md` (الـ 76 قاعدة) قبل ما تبدأ؟ + هل قريت آخر 200-300 سطر من `worklog.md`؟ + هل قريت `04-CURRENT_STATE.md` لفهم الوضع الكامل؟
3. **تذكير الـ Lint** — قبل أي commit: هل اتعمل `bun run lint` بعد آخر تعديل؟ + هل الـ lint نقي (EXIT=0)؟

#### 62.2 — قواعد الـ Commit Message

كل commit message لازم يكون بصيغة واضّاحة، **ممنوع** استخدام: UUIDs عشوائية + "wip" أو "fix" أو "update" بدون تفاصيل + "test" بدون وصف.

الصيغة المطلوبة (Conventional Commits بالعربي): `<type>(<scope>): <وصف عربي واضح>` + `<تفاصيل إضافية إن لزم>`.

أنواع الـ commits المسموحة: `feat` (ميزة جديدة) + `fix` (إصلاح bug) + `docs` (توثيق فقط) + `refactor` (إعادة هيكلة بدون تغيير وظيفي) + `chore` (صيانة) + `test` (اختبارات).

**أمثلة صحيحة:** `feat(portfolio): MyStocksBriefing widget — محفظة + تنبيهات + أخبار` + `fix(radar): إصلاح Exit Radar cache keying بالسوق` + `docs(secretary): محضر اجتماع استراتيجي 2026-10-01`.

#### 62.3 — تردد الرفع المطلوب

- **بعد كل Task كامل** (مش كل سطر كود): لازم commit + push.
- **بعد كل موجة عمل** (زي الموجة 1 اللي اتفقنا عليها): لازم commit + push + توثيق في worklog.md.
- **في نهاية كل جلسة**: لازم commit + push قبل ما أي حد يترك الجهاز.
- **لو الـ changes كبيرة (>500 LOC)**: افصلهم لـ commits صغيرة كل واحد بـ scope واضّاح.

#### 62.4 — الـ Pre-commit Checklist

قبل ما المدير العام يقول "خلصنا"، السكرتيرة لازم تتأكد من الآتي (وإلا المهمة "مش خلصت"):

| # | البند | الأمر |
|---|------|------|
| 1 | `bun run lint` نقي | `cd /home/z/my-project && bun run lint` EXIT=0 |
| 2 | `git status` نضيف أو مـ commit-ed | مفيش uncommitted changes |
| 3 | `git push origin main` ناجح | `Your branch is up to date with 'origin/main'` |
| 4 | `worklog.md` اتحدّث | سجل المهمة اتضاف بالـ Task ID + Stage Summary |
| 5 | `Documentation/` اتحدّث | لو المهمة غيّرت architecture/APIs/rules |

#### 62.5 — الـ Post-task Verification (للسكرتيرة)

```bash
# 1. تأكيد الـ push
git log --oneline -3  # آخر 3 commits موجودين
git status  # "Your branch is up to date with 'origin/main'"

# 2. تأكيد الـ worklog
tail -50 worklog.md  # آخر سجل فيه Task ID + Stage Summary

# 3. تأكيد الـ Documentation (لو المهمة غيّرت architecture)
grep -c "آخر تحديث" Documentation/04-CURRENT_STATE.md  # لازم >= 1
```

لو أي بند ناقص → السكرتيرة لازم تنبّه المدير العام **قبل** ما يعلن إن المهمة خلصت.

### القاعدة 63 — الرفع الإلزامي بعد كل Commit + منع الشاشات/الملفات الجديدة (PUSH-AFTER-EVERY-COMMIT + NO-NEW-SCREENS-FILES — 2026-10-01)
> **هذه القاعدة أُسست رداً مباشراً على BREACH-001** (فقدان شغل الموجة 1 كامل بسبب عدم الـ push + reset الساندبوكس). شوف `Documentation/BREACH-LOG.md`.

#### 63.1 — الرفع الإلزامي بعد كل Commit (PUSH-AFTER-EVERY-COMMIT)

**كل commit محلي = `git push origin main` فوري بعده. مفيش استثناء.**

```bash
git add -A
git commit -m "<message>"
git push origin main   # إلزامي — مش خطوة اختيارية
```

- commit محلي بدون push = شغل معرض للضياع (الساندبوكس ممكن يتريس في أي لحظة).
- لو الـ push فشل (network/auth/conflict) → **توقف فوراً**، أصلّح السبب، وpush. ما تبدأش task جديد غير بعد التأكد إن الـ commit اللي فات وصل GitHub.
- الـ push هو الـ "save" الحقيقي. الـ commit بس "stage".

#### 63.2 — منع الشاشات/الملفات الجديدة (NO-NEW-SCREENS-FILES)

**ممنوع إنشاء شاشة أو ملف جديد إلا بموافقة صريحة من المالك (`enmohsen20111975`) أو مجلس الإدارة.**

قبل إنشاء أي ملف جديد، الوكيل لازم يسأل:
1. هل أقدر أدمج هذا الكود في ملف موجود؟
2. هل فيه شاشة بتعمل نفس الشغلانة؟ → ادمج بدل ما تضيف.
3. هل الملف ده حقيقي مطلوب، أم "حشو بلا معنى"؟

الأولوية بالترتيب: **تنظيف → حذف → دمج → تعديل → (وأخيراً، بموافقة) إضافة.**

#### 63.3 — التحقق من عدم التكرار

قبل أي task إصلاح/إضافة، الوكيل لازم:
- `grep -rn "<feature name>" src/` للتأكد إن الميزة مش موجودة في ملف تاني.
- لو موجودة في أكتر من ملف → دمجها في مكان واحد + حذف الباقي (Rule 5 + Rule 16).
- توثيق القرار في الـ worklog.

#### 63.4 — العقوبة

- أول خرق: تحذير + توثيق في `BREACH-LOG.md`.
- تاني خرق: إعادة تكليف الوكيل بمهمة تانية.
- تالت خرق: استبعاد من المعسكر.

**الخلاصة:** الـ push مش "خطوة أخيرة اختيارية" — هو الـ gate الأخير. والتنظيف مش "نشاط جانبي" — هو الأولوية الأساسية. مشروع متكامل متماسك مش بييجي من الإضافة، بييجي من التنظيم.

### القاعدة 64 — التوافق الشرعي + التطهير (SHARIA-COMPLIANCE — 2026-10-03)
> **سبب الإضافة:** توجيه صريح من المالك (`enmohsen20111975`) في 2026-10-03: «أنا شايف انك في حاجات كتير لازم تتحدث في الدستور» — شغل الـ Sharia Compliance + التطهير اتعمل في الكود بس مكانش موثّق في الدستور. الـ rule دي بتربط الـ scraper + الـ DBs + الـ API + الحاسبة في قاعدة واحدة ملزمة.

- **المصدر:** `data_engine/scrapers/sharia_compliance_scraper.py` بيسحب من `stocks.templatesnippet.com` (static JSON `/data/stocks_merged.json` — مفتوح، CORS allowed، ETag + Last-Modified موجودين).
- **التحديث:** أسبوعي (السبت 15:30 UTC = `30 15 * * 6`) عبر crontab — **مش أكتر** (المصدر بيتحدّث أسبوعياً، والتكرار اليومي هيتعب السيرفر من غير فايدة). الطلب conditional GET بالـ ETag → لو المصدر ما اتغيرش بيرجّع 304 بتكلفة ~صفر.
- **الـ DBs:** `data_engine.db` (**6** جداول: `sharia_sources` + `sharia_source_status` + `sharia_metrics` + `sharia_purification_rates` + `sharia_symbol_map` + `sharia_history`).
- **المعيار الأساسي:** **S&P Shariah** (التطهير = نسبة × (توزيعات + ربح رأسمالي)).
- **مصادر تكميلية:** Musaffa / Kashif / Osoul (توزيعات فقط) — بتتخزن كـ rates تكميلية في `sharia_purification_rates`.
- **AAOIFI مستبعدة:** القيمة المنشورة `aaoifi_haram_earning_per_share` غير متسقة رياضياً → بتتسجل للتوثيق فقط مع `aaoifi_usable=0`.
- **الـ API:** `/api/sharia` (قراءة) + `/api/sharia/purification` (حاسبة).
- **الحاسبة:** `vps-service/portfolio/purification_calculator.py` (Python=Brain per Rule 20).
- **ممنوع** نسخ معادلة التطهير في TypeScript — الـ Node مجرد bridge.
- **consensus_min = 6:** لو 6 مصادر أو أكتر من 8 قالوا "متوافق" → `is_halal_consensus=1`.
- **الربط مع البيانات عندنا:** **مش** `stocks.db.stocks` لوحده. الـ resolver بيقرأ **4 masters**: `stocks.db.stocks` (EGX) · `market.db.stocks` (EGX — 454 ticker، أنضف) · `stocks.db.egksco_stocks` · `stocks.db.stocks_backup`. الخطأ الأول كان إن `ANFI` اتحسب فاقد لأن `stocks.db` مفيهوش.
- **الـ match methods (بترتيب الثقة):** `exact_ticker` (high) + `arabic_prefix_ticker` (high) + `name_exact_code_differs` (medium + review) + `symbol_in_name` (medium + review).
- **🔴 COLLISION GUARD (إلزامي — درس `VLMR`/`VLMRA`):** لو الرمز المترشّح موجود هو نفسه كـ `symbol` **مستقل في المصدر** → **ممنوع** الربط. بيتسجل `collision_with_existing_source_symbol` في `sharia_symbol_map` بـ `needs_review=1` وخلاص. السبب: فيه أزواج في المصدر نفس الاسم العربي بالظبط ورمز مختلف — `KORA` ↔ `KORRA` و `EFG` ↔ `HRHO`. دمجهم = خلط شركتين مختلفتين = خطأ شرعي. **ممنوع أي alias resolution من يعمل صامت لما الرمز مختلف.**
- **`normalize_name` مش `normalize_symbol`:** المطابقة على الأسماء العربية لازم تستخدم `normalize_name` (بيحافظ على العربي + بيشيل التشكيل والهمزات). `normalize_symbol` بيمسح كل حروف العربية وبيرجّع مفتاح فاضي.
- **🔴 قاعدة الحساب — الخسارة غير المحققة ما بتخصمش:** معيار S&P ملزم على **الأرباح المستلمة فعلاً**. لو `sell_price < buy_price` (خسارة غير محققة) → ماتخصمش من وعاء التطهير، و**التطهير ما بينفعش يبقى سالب** (مفيش "تطهير سالب"). راجع `purification_calculator.py`.
- **السهم غير المتوافق في كل المصادر:** لازم التحذير يبقى صريح إن التطهير مش هوالمشكلة — المشكلة في امتلاك السهم نفسه (`compliant_sources_count = 0`).
- **الـ sync الاختياري:** `python3 data_engine/scrapers/sharia_compliance_scraper.py --sync-stocks` بيعبّي `stocks.is_halal` + `compliance_*` في `stocks.db` — **opt-in ومش مفعّل في الـ cron** (قرار المالك 2026-10-03: تغيير schema في `stocks.db` محتاج موافقة صريحة).
- **🔴 IDOR ممنوع:** `POST /api/sharia/purification` بياخد `user_id` — لازم `getSessionUserId()` (من `@/lib/auth-helper`) ويقارن `auth.userId === user` (أو `isAdmin`). من غير ده أي حد يبعت `user_id` حد تاني ويسيب محفظته الشرعية. النطاق المفرد (`{ symbol, quantity }`) يفضل public.
- **الأرقام الفعلية (2026-10-03):** metrics=253 · source_status=2024 · purification_rates=572 (S&P=182) · إجماع ≥6/8 = 49 سهم · 250/253 مربوطين · 3 unresolved (`EFG` · `KORRA` · `MBEN`) · 1 في طابور المراجعة (`LBCT→IBCT`).

### القاعدة 65 — طبقة التحقق من البيانات (DATA-VALIDATION-LAYER — 2026-10-03)
> **سبب الإضافة:** بعد كارثة EGX (CRST support=158.73 vs price=3.02، close=NULL لـ 956 سهم، RSI كـ TEXT لـ 233 سهم) اتعمل `vps-service/data/validation.py` كطبقة تحقق مركزية قبل أي تحليل. الـ rule دي بتجعل وجود الـ validator إلزامي في كل الـ pipelines.

- `vps-service/data/validation.py` هو الـ validator المركزي — `validate_stock_data()` بترجع `ValidationDict` فيه `is_valid_<field>` + `is_valid_overall`.
- كل سهم يدخل التحليل **لازم** يمرّ بـ `validate_stock_data()` الأول.
- أي field مش منطقي → `INVALID` (مش `fake`) — بيتـ flagged زي `is_valid_current_price=False`.
- `INVALID` fields بتتصفّر (nullified) — مش بتأثر على الـ score.
- لو `current_price` INVALID → التحليل كله بيترفض (`is_valid_overall=False` + `HOLD` score=0).
- **Cross-stock contamination** (ratio > 10x بين الـ support/resistance والـ current_price) → `INVALID`.
- **Stale 52W** (high_52w < current_price أو low_52w > current_price) → `INVALID`.
- **OHLC integrity:** لو `high < max(open, close)` أو `low > min(open, close)` → `INVALID`.
- الـ validator مربوط في `analyzers/master_analyzer.py` قبل الـ scoring pipeline.
- **ممنوع** تشغيل أي تحليل من غير ما تمرّ على الـ validator.

#### 65.1 — تلف الـ `symbol` (اكتُشف 2026-10-03 في mission الشريعة)

- **العَرَض:** جداول `tab_*` في `data_engine.db` (8 جداول · 3664 صف) كانت متخزّنة بـ `symbol = TICKER + الاسم ملزوقين` — `'ABUKابوقير'` · `'ACFRAlexandria'` · `'ADCIأدكوD'`. السبب الجذري: الـ scraper القديم كان بياخد الـ ticker والاسم من نفس الـ DOM cell.
- **الأثر:** كل JOIN بـ `stocks.ticker` بيفشل + `fetch_corporate_actions.py` (cron يومي) بيطلّع **0 صف dividend**.
- **القاعدة:** أي `symbol` لازم يكون `^[A-Z][A-Z0-9]{1,9}$` نضيف. لو Regex عليه محارف غير لlatin أو طول > 10 → **مُلف تالف**، مش "ناقص".
- **الإصلاح:** `scripts/repair_tab_symbols.py` (dry-run افتراضي + backup). الـ resolver فيه **إلزامي** إنه يكون market-aware — فيه tickers مكرر بين الأسواق (`NBK` / `ASC` / `MENA` في EGX و KSE)، والمطابقة ببادئة بدون سوق بتوجّه السهم لسوق غلط.
- **عملي:** بعد الإصلاح 280 من 285 صف مصرى في `tab_dividends` بقى ticker نضيف، و`ABUK` `dps_ttm` رجع يشتغل. 6 tickers سعودية لسه unresolved (مش في أي master عندنا). الإصلاح **idempotent**.
- **درس عام:** الـ validator بيكشف قيم غلط، لكن **مفيش validator بييكشف مفتاح join تالف**. لازم assertion على شكل الـ key نفسه.

### القاعدة 66 — سلطة المصادر (SOURCE-AUTHORITY — 2026-10-03)
> **سبب الإضافة:** بعد كارثة الـ multi-source contamination في `price_history.db` (930 سهم عندهم 2-8 مصادر بأسعار مختلفة + `egxpilot_live` + `yahoo_safetynet` + `yfinance_backfill` ممنوعين نهائياً), اتعمل `vps-service/data/source_authority.py` كـ guard مركزي يمنع أي scraper يكتب من غير ما يمرّ على الـ CANONICAL_SOURCES.

- `vps-service/data/source_authority.py` هو الـ guard المركزي.
- كل scraper لازم يستخدم `write_guarded()` قبل أي `INSERT`.
- **CANONICAL_SOURCES** لكل سوق:
  - `EGX` → `intraday_aggregated` (fallback: `egksco` → `yahoo_clean`)
  - `TADAWUL` / `KSE` / `QSE` / `US` → `yahoo_clean`
  - `CRYPTO` → `crypto_fetcher` (data_engine.db.crypto_prices)
  - `GOLD` → `gold_fetcher` (data_engine.db.gold_prices)
- **BANNED_SOURCES:** `egxpilot_live` + `yahoo_safetynet` + `yfinance_backfill` (ممنوعين نهائياً).
- لو canonical وقع → fallback بيكتب **بنفس الاسم** (مش اسم جديد) — عشان الـ downstream ميشوفش source جديد.
- **ممنوع** أي scraper يكتب في `price_history.db` من غير ما يمرّ على `write_guarded()`.
- `source_priority_cleaner.py` بيمسح المصادر غير الـ canonical تلقائياً (dry-run + `--live`).
- الـ guard مربوط في كل الـ scrapers: `daily_price_updater.py` + `intraday_aggregator.py` + `eodhd_fetcher.py` + `gap_filler.py` + `price_history_safetynet.py`.
- **الفحص اليدوي:** `get_canonical_source(market)` بيرجع المصدر القانوني + `get_market_for_ticker(ticker)` بترجع السوق.

### القاعدة 67(a) — ROOT-CAUSE-FIRST (لا إصلاح للأعراض — 2026-10-04)
> **سبب الإضافة:** بعد كارثة CRST (أسعار OHLC متجمدة في `stocks.db` + معادلات وهمية في الفرونت إند `Math.max(high * 1.15, current * 1.25)`) وكارثة غرفة تحكم المحركات (محركات مجدولة بتظهر "متوقف 🔴" + زر تشغيل بيرجع success وهمي من غير كونسول حي + `/api/admin/engines/logs` route مطلوب في الـ UI بس مش موجود في الـ API)، المالك وجّه: «انت بتتعامل مع كل أمر على انة حاجة منفصلة ودى كارثة فعلياً انت والفريق مشغولين بلحل الصطحى مش الحل الجزرى للمشاكل».

#### الالتزامات الإلزامية قبل أي fix:

1. **تشخيص السبب الجذري (Root Cause) قبل أي كود:**
   - قبل ما تكتب أي fix، لازم تـ trace المشكلة لـ آخر نقطة في الـ pipeline.
   - مثال: لو الشاشة بتعرض رقم غلط → ابدأ من الـ DB → الـ API → الـ store → الـ component. متصلحش الـ component لو المشكلة في الـ DB.
   - مثال: لو محرك بيبان "متوقف" → اسأل: هل ده daemon (لازم يبقى شغال 24/7) ولا cron job (بيشتغل دقايق وبيقفل)؟ لو cron → "متوقف" is misleading؛ الحالة الصح: "مجدول".

2. **ممنوع المعادلات الوهمية (Synthetic Approximation Ban):**
   - ممنوع نهائياً كتابة معادلات تقريبية في الفرونت إند زي `Math.max(high * 1.15, current * 1.25)` أو `low * 0.9` بدل ما البيانات الحقيقية تكون موجودة.
   - لو field ناقص → إما (أ) ضيفه للـ type + الـ API + الـ DB، أو (ب) اعرض "—" (غير متاح) — **ممنوع تخترع رقم**.
   - السبب: الرقم الوهمي بيتحول لكارثة لما الـ input يكون corrupt (زي `low=0.634` → `0.634 * 0.9 = 0.57` بدل السعر الحقيقي `2.74`).

3. **Single Source of Truth (SSOT) إلزامي:**
   - أي رقم بيتعرض في أكتر من مكان (بطاقة + شاشة + زر نشر) لازم يقرأ من **نفس الـ object** في نفس اللحظة.
   - ممنوع كل component يحسب نسخته الخاصة من الـ 52w أو الـ OHLC.

4. **لا claim "تم الحل" بدون إثبات:**
   - لو قلت "اتصلحت" → لازم تـ verify بـ: (أ) الـ lint clean، (ب) الـ tsc --noEmit clean، (ج) browser test حقيقي يثبت إن الـ fix اشتغل، (د) بيانات حقيقية مش mock.
   - ممنوع تقول "DONE" لو الـ HMR ما طبّقش أو لو المتصفح بيرجع stale chunk — لازم .next clear + recompile + browser verify.

5. **كل أمر = جزء من منظومة:**
   - قبل ما تبدأ task، اسأل: إيه الـ tasks اللي قبلها أثرت في نفس الملفات؟ (اقرا worklog.md).
   - بعد ما تخلص task، اسأل: إيه الـ tasks اللي بعدها هتتأثر؟ (وثّق في worklog.md).
   - متعاملش مع كل task كحاجة منفصلة — ده اللي بسبّب الكوارث.

#### التنفيذ:
- قبل أي PR/commit، اسأل نفسك: «هل أنا بصلّح العَرض ولا السبب؟»
- لو لقيت نفسك بتكتب `// fallback` أو `// sensible default` → **STOP**. ده غالباً breach لهذه القاعدة.

### القاعدة 67(b) — CALCULATION-CANONICAL (توحيد الحسابات الفنية — 2026-10-05)
> **سبب الإضافة:** تقرير `Documentation/_archive_pre_unification_2026-10-12/ENGINEERING_AUDIT_REPORT.md` كشف إن **10/10 فئات حسابية** (ATR, RSI, Position Sizing, R:R, Stops, WR/PF, master_score, VWAP/Volume, SMA/EMA/MACD, Sector/Regime) **مفيش عندها canonical** — كل واحدة ليها 3-20+ نسخة مختلفة بصيغ مختلفة. النتيجة: نفس السهم بـ يطلع قيم مختلفة في صفحات مختلفة (RSI يختلف 10-20 نقطة، ATR يختلف 5-15%). ده كارثة في مشروع فلوس.
> **المرجع التنفيذي:** `Documentation/_archive_pre_unification_2026-10-12/EMERGENCY_REMEDIATION_PLAN.md` (Phase 1 — 2026-10-05).

#### المبدأ: كل حساب له canonical واحد فقط
- **ممنوع** حساب أي مؤشر فني (ATR, RSI, MACD, SMA, EMA, VWAP, OBV) في أكثر من ملف. لازم كلهم يندوا من canonical واحد.
- **ممنوع** كتابة `calc_atr` / `calc_rsi` / `calc_sma` inline في أي ملف جديد. استورد من canonical.
- **ممنوع** وجود نسختين بنفس الاسم بصيغ مختلفة (زي `utils/position_sizing.py` vs `analyzers/position_sizing.py` — الاتنين مختلفين!).

#### Canonical Declarations (ملفات الحقيقة الموحدة):

| # | الحساب | الـ Canonical | الصيغة |
|---|--------|--------------|--------|
| 1 | **ATR** | `vps-service/analyzers/indicators/atr.py::calc_atr()` | **Wilder's smoothing** `(atr × (period-1) + tr) / period` (مش SMA) |
| 2 | **RSI** | `vps-service/analyzers/indicators/rsi.py::calc_rsi()` | **Wilder's smoothing** `avg_gain = (avg_gain × (period-1) + gain) / period` (مش SMA) |
| 3 | **SMA/EMA/MACD** | `vps-service/analyzers/indicators/ma.py` | `sma(data, period) = sum/period` · `ema(data, period)` recursive · `macd(closes, 12, 26, 9)` |
| 4 | **Position Sizing** | `vps-service/utils/position_sizing.py::calculate_risk_based_position()` | **risk-based**: `position_value = (capital × risk_pct) / stop_distance_pct` · `risk_pct` من `engine_settings.risk_per_trade_pct` (default 1.2%) |
| 5 | **R:R** | TS: `src/lib/risk-reward.ts::computeRiskReward()` · Python: `vps-service/utils/risk_reward.py::compute_risk_reward()` | `reward / risk` مع fallback=0 · يكتشف SELL setups (target < entry) صح |
| 6 | **Stop/Target** | `vps-service/core/opportunity_quality.py::enforce_atr_based_stop()` | `stop = entry - stop_atr_mult × ATR` · `stop_atr_mult` من `engine_settings` · clamp [3%, 9%] EGX / [5%, 15%] crypto |
| 7 | **Win Rate** | `vps-service/utils/backtest_stats.py::compute_win_rate()` | `wins / total × 100` · dedup-by-ticker (القاعدة 22) |
| 8 | **Profit Factor** | `vps-service/utils/backtest_stats.py::compute_profit_factor()` | `gross_profit / gross_loss` · **fallback = 999.0** (TradingView convention) · round 2dp |
| 9 | **master_score** | `vps-service/analyzers/master_analyzer.py::MASTER_WEIGHTS` | **10-component weighted sum** (Trend 8 + Makers 26 + DNA 13 + Fundamentals 8 + Sector 12 + Benchmark 24 + Technical + Volume + Candlestick + Sentiment) |
| 10 | **VWAP** | `vps-service/analyzers/technical_analyzer.py::calc_vwap()` | **rolling 20-period** (مش full cumulative) — يطابق TradingView |
| 11 | **OBV** | `vps-service/analyzers/technical_analyzer.py::calc_obv()` | cumulative: `+volume if close > prev_close else -volume` |
| 12 | **Volume Ratio** | `vps-service/analyzers/technical_analyzer.py::calc_volume_ratio()` | `current_vol / avg(closes[-20:])` (20-day) — موحد |
| 13 | **Sector Heat** | `vps-service/core/opportunity_quality.py::compute_sector_heat_map()` | fundamentals-based (مش `AVG(change_percent) FROM stocks GROUP BY sector`) |
| 14 | **Market Regime** | `vps-service/analyzers/technical_analyzer.py::detect_regime()` | `Close > SMA50` = bull, `Close < SMA50` = bear, else range · يقرأ من canonical SMA |

#### قواعد صارمة:
1. **كل ملف جديد** لازم يستورد من canonical — ممنوع inline computation.
2. **الـ canonical files موجودة في:** `vps-service/analyzers/indicators/` (atr.py + rsi.py + ma.py) + `vps-service/utils/risk_reward.py` + `vps-service/utils/backtest_stats.py` + `vps-service/utils/position_sizing.py`.
3. **الهجرة تدريجية:** الـ 150+ inline copies هتـ migrates في Phase 2. كل ملف يتـ migrate لوحده + commit + push.
4. **لا بيانات وهمية:** كل اختبار لازم يكون على الـ DBs الحقيقية.
5. **التحقق قبل الحذف (Rule 16):** قبل حذف أي inline copy، نتأكد إن canonical بـ يرجّع نفس القيمة ±0.5%.
6. **Bug fixes مؤكدة (من الـ audit):** `src/app/api/market/exit-status/route.ts:73` (`Math.abs` بيفشل في SELL) + `v38_backtest_engine.py:1500` (`sma200` = `ema200` mislabeled) + `core_scoring_engine.py:43` (RSI يستخدم SMA مش Wilder) + `precomputed-cache.ts:414` (ATR يستخدم SMA مش Wilder) + `daily_predictor.py:2355` (`master_score = technical_score` → الـ 10-component weighted sum هو canonical).

#### التحقق (Acceptance):
- `grep -r "def calc_atr\|def calculate_atr" vps-service/ --include="*.py" | wc -l` → 1 بس (canonical)
- `grep -r "def calc_rsi\|def calculate_rsi" vps-service/ --include="*.py" | wc -l` → 1 بس
- backtest WR لازم يفضل ثابت ±0.5% بعد كل مهاجرة

### القاعدة 68(a) — AGENT-QUALITY-GATE (بوابة جودة الوكلاء — 2026-10-04)
> **سبب الإضافة:** وكيل Task 31-B ادعى إنه أنشأ `/api/admin/engines/logs` route + 3 routes تانية، بس الـ logs route **مش موجود** على القرص. وكمان استخدم `Cpu` من `lucide-react` في `AdminView.tsx:1008` من غير ما يعمل import → كارثة compile اكتشفها المبرمج التاني. ده دليل إن الوكلاء بيعملو claims بدون verification.

#### بوابة الجودة الإلزامية لكل وكيل (قبل claim "DONE"):

1. **Import Verification (إلزامي):**
   - لو استخدمت أي identifier (function/class/icon/const) → اتأكد إنه imported في نفس الملف.
   - شغّل `npx tsc --noEmit` على الملفات اللي عدلتها → لازم 0 errors.
   - ممنوع تقول "lint clean" لو `tsc --noEmit` فيه errors — lint مش tsc.

2. **File Existence Verification (إلزامي):**
   - لو قلت "أنشأت ملف X" → اتأكد بـ `ls -la X` أو `test -f X && echo EXISTS`.
   - لو قلت "أنشأت route Y" → اتأكد بـ `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/Y` يرجع 200/401/404 (مش connection refused).

3. **Browser-Interactive Verification (إلزامي للـ UI):**
   - لو قلت "الشاشة بتعرض X" → افتح المتصفح + screenshot + تأكد إن X ظاهر.
   - لو قلت "الزر بيشتغل" → اضغط عليه فعلاً + تأكد إن الـ response صح.
   - ممنوع تقول "DONE" لو الـ HMR ما طبّقش — لازم `.next` clear + recompile + browser refresh.

4. **No False Claims (إلزامي):**
   - لو route مش موجود → قول "مش موجود" مش "تم إنشاؤه".
   - لو الـ browser test فشل → قول "فشل" مش "تم التحقق".
   - لو الـ proxy مات → قول "الـ proxy مات" مش "المتصفح شغال".

5. **Verification Script (إلزامي في الـ worklog):**
   - كل worklog entry لازم يحتوي على:
     ```
     Verification:
     - lint: EXIT 0 ✅/❌
     - tsc --noEmit: 0 errors ✅/❌
     - curl /api/X: 200 ✅/❌
     - browser: [screenshot ref] ✅/❌
     ```
   - أي ✅ بدون إثبات = breach لهذه القاعدة.

#### التنفيذ:
- كل وكيل قبل ما يبعت report نهائي، لازم يطبّق الـ 5 نقاط فوق.
- الـ coordinator (Z.ai Code) لازم يـ spot-check عشوائي 20% من claims الوكلاء.

### القاعدة 68(b) — COMMUNICATION-EXECUTION-DISCIPLINE (قواعد التعامل بين المالك والوكيل — 2026-10-06)
> **سبب الإضافة:** بعد عدة جلسات نتج عنها تجاوزات (إنشاء ملفات جديدة بدون إذن، رفع على GitHub بدون إذن صريح، تشغيل سكريبتات ثقيلة بدون خطة مسبقة)، اتُّفق بين المالك (`enmohsen20111975`) والوكيل (Z.ai Code) على تسجيل قواعد التعامل في الدستور نفسه ليكون مرجعاً ملزماً. هذه القاعدة ليست بديلاً عن القواعد الأخرى، بل هي إطار تنظيمي لطريقة التنفيذ والتواصل.

#### المبدأ الأساسي
قبل أي تنفيذ → خطة مكتوبة → إذن صريح → تنفيذ → توثيق. لا يُسمح بأي خطوة تنفيذية قبل استلام الإذن الصريح من المالك في الشات.

#### قواعد صارمة (لا تُكسر):

1. **لا ملفات جديدة بدون إذن** — هذا تأكيد للقاعدة 4. يشمل: ملفات Python جديدة + ملفات TypeScript/TSX جديدة + ملفات Markdown جديدة. **الاستثناء الوحيد:** تحديث `worklog.md` بعد كل مهمة (مسموح بدون إذن صريح لإدخال جديد).
2. **لا تعديل ملفات موجودة بدون إذن** — يشمل أي ملف في `src/` + `vps-service/` + `prisma/` + `data_engine/` + `news-agent/` + `Documentation/*.md` (بما فيها هذا الدستور نفسه) + أي ملف إعدادات.
3. **لا commit/push بدون إذن** — كل تعديل على الكود يبقى محلياً حتى يستلم الوكيل إذن المالك بالرفع. رسالة الـ commit لازم تكون واضحة ومحدودة النطاق.
4. **لا تشغيل سكريبتات ثقيلة بدون إذن** — أي سكريبت بياخد > 30 ثانية أو بياكل > 500MB ذاكرة لازم يُعرض على المالك أولاً. يشمل: `bun run build` + `bun install` + `pip install` + أي backtest على عينة كبيرة + أي scraping لبيانات جديدة.
5. **التزام كامل بالدستور** — كل القواعد 1–76 ملزمة. الوكيل لازم يقرأ `00-CONSTITUTION.md` أولًا في بداية كل جلسة. لو حصل تعارض، القواعد الأقدم تتقدم ما لم يوافق المالك صراحةً على تعديلها.
6. **الأسئلة قبل الافتراضات** — لو الوكيل مش متأكد من طلب المالك، **يسأل**. ممنوع تشغيل سكريبت أو تعديل ملف أو إنشاء شيء جديد بناءً على افتراض.
7. **التواصل بالعربي** — كل الردود + التقارير + الأسئلة + رسائل الـ commit باللغة العربية (لغة المالك الأساسية).
8. **التقارير بعد كل مهمة** — لا تقارير صباحية/أسبوعية. فقط تقرير بعد كل مهمة منفذة: ما الذي تم + ما الذي لم يتم (مع السبب) + المخاطر المكتشفة + الخطوة التالية المقترحة (بانتظار إذن المالك).
9. **لا استخدام subagents بدون إذن** — الوكيل يستطيع استدعاء subagents (full-stack-developer / general-purpose / Explore / Plan) لكن لازم يستأذن المالك أولاً في كل مرة.
10. **الـ sandbox ≠ الإنتاج** — الوكيل يشتغل على `/home/z/my-project/` (sandbox). لا يمكنه الوصول للإنتاج مباشرةً. كل توصيات للإنتاج لازم تُعرض على المالك كـ "أوامر جاهزة للتشغيل على الـ VPS".

#### سير العمل القياسي:
```
[بداية جلسة]
  الوكيل: تقرير حالة سريع (4-5 سطور)
  المالك: توجيه + أولويات

[قبل أي مهمة تنفيذية]
  الوكيل: خطّة المهمة (الملفات، الخطوات، المخاطر)
  المالك: تمام ابدأ / أو عدّل
  الوكيل: تنفيذ → تقرير النتيجة

[بعد كل مهمة]
  الوكيل: تحديث worklog.md → تقرير في الشات → "عايز commit + push؟"
  المالك: نعم / لا / عدّل الأول
```

#### التحقق:
- لا يوجد ملف جديد في `git log` منذ آخر جلسة بدون إذن صريح من المالك في الشات.
- `worklog.md` محدّث بعد كل مهمة بإدخال واضح (Task ID + Agent + Work Log + Stage Summary).
- لا commit messages بالعربي/الإنجليزي مختلطة دون سبب واضح.

### القاعدة 69 — SUBAGENT-TEAM-ACTIVATION (تفعيل التيم المساعد — 2026-10-06)
> **سبب الإضافة:** المالك كلّف الوكيل (Z.ai Code) بدور "المدير العام للمنصة" + "المبرمج الأساسي". الوكيل ليس تيم بل agent واحد، لكنه قادر على استدعاء subagents متخصصين. هذه القاعدة توثّق التيم المعتمد وتمنع الاستخدام العشوائي.

#### التيم المعتمد (يجب الاستئذان قبل كل استدعاء):

| # | الدور | نوع الـ subagent | استخدامه | الصلاحيات |
|---|---|---|---|---|
| 1 | مبرمج Next.js | `full-stack-developer` | تعديلات في `src/` (Frontend + API routes) | تنفيذ بعد إذن المالك |
| 2 | مبرمج Python | `full-stack-developer` أو شغل مباشر | تعديلات في `vps-service/` + `scripts/` | تنفيذ بعد إذن المالك |
| 3 | محلل مالي | `general-purpose` | تقارير + backtest + تحليل أداء | تنفيذ read-only بدون إذن، تنفيذ write بعد إذن |
| 4 | محلل أسهم | `general-purpose` + `Explore` | فحص tickers + sectors + anomalies | read-only بدون إذن |
| 5 | خبير EGX | `general-purpose` (بسياق EGX) | استراتيجيات + فلاتر + تحليل سوق مصري | توصيات + تنفيذ بعد إذن |
| 6 | خبير TADAWUL | `general-purpose` (بسياق TADAWUL) | استراتيجيات + فلاتر + تحليل سوق سعودي | توصيات + تنفيذ بعد إذن |
| 7 | خبير KSE | `general-purpose` (بسياق KSE) | استراتيجيات + فلاتر + تحليل سوق كويتي | توصيات + تنفيذ بعد إذن |
| 8 | خبير QSE | `general-purpose` (بسياق QSE) | استراتيجيات + فلاتر + تحليل سوق قطري | توصيات + تنفيذ بعد إذن |
| 9 | خبير CRYPTO | `general-purpose` (بسياق CRYPTO) | استراتيجيات + فلاتر + تحليل كريبتو | توصيات + تنفيذ بعد إذن |
| 10 | مهندس معماري | `Plan` | تخطيط المعمارية + تحليل trade-offs | توصيات فقط (لا تنفيذ) |
| 11 | السكرتيرة | `general-purpose` | تحديث ملفات التوثيق بعد كل مهمة | تنفيذ تلقائي بعد كل مهمة (انظر القاعدة 70) |

#### قواعد الاستخدام:
1. **الاستئذان قبل كل استدعاء** — لا يُستدعى subagent بدون إذن المالك، باستثناء: `Explore` للبحث في الكود/البيانات (read-only، مسموح) + `general-purpose` للتحليل read-only (مسموح) + السكرتيرة (مسموح تلقائياً بعد كل مهمة).
2. **Context transfer** — الـ subagents ما عندهاش context الشات كامل. الوكيل لازم يعطيهم prompt مفصل يحوي: الهدف + الملفات المعنية + القواعد الدستورية ذات الصلة + الـ deliverable المتوقع.
3. **تقرير النتيجة** — كل subagent بيرجع تقرير للوكيل. الوكيل لازم يلخّصه للمالك في الشات بدون الإشارة إلى تفاصيل implementation داخلية (إلا لو طُلبت).
4. **لا subagents بالتوازي على ذاكرة 4GB** — الساندبوكس محدود بـ 4GB RAM. يُمنع تشغيل أكثر من subagent ثقيل بالتوازي.
5. **رفع عمل الـ subagents** — كل تعديلات الـ subagents لازم تمرّ على الوكيل (مراجعة) قبل الـ commit. لا push مباشر من subagent.

### القاعدة 70 — DOCUMENTATION-SECRETARY (السكرتيرة — تحديث تلقائي للتوثيق بعد كل مهمة — 2026-10-06)
> **سبب الإضافة:** التوثيق يعتبر دائماً آخر أولوية فيضيع بين المهام. المالك طلب سكرتيرة تتولى تحديث ملفات التوثيق تلقائياً بعد كل مهمة، لتخفيف العبء عن المبرمجين وضمان أن الـ Documentation يعكس الواقع الفعلي للكود.

#### المبدأ: التحديث تلقائي، لا انتظار طلب

بعد كل مهمة تنفيذية (تعديل كود / إصلاح bug / إضافة feature)، تتدخل السكرتيرة تلقائيًا لتحديث:
1. `worklog.md` — إدخال جديد (Task ID + Agent + Work Log + Stage Summary)
2. `Documentation/01-ARCHITECTURE_AND_API.md` — لو تغيّرت المعمارية
3. `Documentation/02-SCREENS_AND_COMPONENTS.md` — لو تغيّرت الشاشات
4. `Documentation/04-CURRENT_STATE.md` — لو تغيّرت الحالة الإنتاجية
5. `Documentation/03-HOW_IT_THINKS.md` — لو تغيّر منطق المحرك
6. `README.md` — لو تغيّر رقم الإصدار أو الـ quick start

#### قواعد السكرتيرة:
1. **تشغيل تلقائي بعد كل مهمة** — لا تحتاج إذن المالك. تشتغل فور انتهاء الوكيل من مهمة تنفيذية.
2. **لا تعديل كود** — السكرتيرة تُحدّث ملفات `.md` فقط. لا تلمس `.py` / `.tsx` / `.ts` / `.prisma`.
3. **حقائق فقط** — السكرتيرة تقرأ الكود الفعلي وتوثّق ما هو موجود، لا ما "يفترض" أن يكون موجوداً. لو لقت تعارض بين التوثيق والكود → الكود هو الحقيقة.
4. **التزام بالمسارات النسبية** (Rule 17) — كل المراجع في التوثيق لازم تكون نسبية.
5. **حق التصعيد** — لو لقت السكرتيرة تناقض حرج بين الكود والتوثيق، تُصعّد للوكيل (المدير العام) ليقرر هل يبلغ المالك أم لا. لا تحذف المحتوى بنفسها.
6. **تحديث الفهرس + آخر تحديث** — كل ملف توثيقي يُحدّث رأسه (header) بـ: `**آخر تحديث:** YYYY-MM-DD (Task <ID> — <summary>)` + قائمة `**تحديثات سابقة:**` تحوي آخر 3-5 إدخالات.
7. **إدخال CHANGELOG** — `CHANGELOG.md` يُحدّث فقط عند تغيير سلوكي حقيقي (ليس إعادة تنظيم توثيقي).
8. **حفظ الـ artifacts التحليلية** — كل JSON / report يُنتج أثناء المهمة يُحفظ في `scripts/output/` باسم واضح + تاريخ. السكرتيرة تضمن أن الـ `.gitignore` يحظر رفع الـ artifacts الكبيرة الحساسة.
9. **التحقق من الـ artifacts الجديدة** — قبل أي رفع على GitHub، السكرتيرة تتأكد إن: لا توجد أسرار (tokens / passwords / API keys) + لا توجد DBs (`db/**/*.db` ممنوعة) + لا توجد ملفات ضخمة (> 10 MB) بدون أهمية + كل الـ artifacts التحليلية معروضة في `worklog.md`.

#### متى تشتغل السكرتيرة:

| الحدث | الإجراء |
|---|---|
| تعديل ملف `.py` / `.tsx` / `.ts` | تحديث `01-ARCHITECTURE_AND_API.md` + `worklog.md` |
| إضافة/حذف API route | تحديث `02-SCREENS_AND_COMPONENTS.md` + `01-ARCHITECTURE_AND_API.md §5` |
| تعديل DB schema (Prisma) | تحديث `01-ARCHITECTURE_AND_API.md §3` + `CHANGELOG.md` |
| تعديل logic محرك (V40.2 / Radar) | تحديث `03-HOW_IT_THINKS.md` + `CHANGELOG.md` |
| إضافة/تعديل قاعدة دستورية | تحديث فهرس القواعد + `CHANGELOG.md` |
| مهمة تحليلية (backtest / report) | تحديث `worklog.md` + حفظ الـ artifact في `scripts/output/` |

### القاعدة 71 — AUTONOMOUS-IMPROVEMENT-WITH-BACKTEST (التحسين الذاتي الموجه بالباك-تست — 2026-10-06)
> **سبب الإضافة:** المالك منح الوكيل (Z.ai Code) صلاحية تنفيذ التحسينات المقترحة بشكل ذاتي بدون إذن صريح لكل تعديل، **بشرط** أن يكون كل تحسين موجه بباك-تست كمّي. القاعدة دي تُعدّل جزئياً من Rule 68(b) (التي تمنع التعديل بدون إذن) بالنسبة لفئة محددة من التعديلات: التحسينات الموجهة بالباك-تست.

#### المبدأ: البيانات هي الحكم

أي تعديل على كود المشروع (خصوصاً V40.2 + الرادار + الفلاتر) لازم يمر بالدورة دي:
```
1. باك-تست قبل  (BASELINE)    → سجّل WR + PF + Avg Return + Signal Distribution
2. تطبيق التعديل              → تعديل الكود
3. باك-تست بعد               → سجّل نفس المؤشرات
4. مقارنة                    → لو تحسّن → keep + secretary + push
                              → لو تأخّر → revert + توثيق السبب في worklog
```

#### الصلاحيات الممنوحة (في إطار هذه القاعدة):
1. **تعديل الكود** في `vps-service/` + `scripts/` + `src/` للتحسينات الموجهة بالباك-تست — **بدون إذن صريح من المالك لكل تعديل**
2. **رفع على GitHub مباشرة** بعد كل تحسين ناجح — **بدون انتظار إذن**
3. **السكرتيرة تُحدّث التوثيق تلقائياً** (Rule 70) بعد كل تحسين ناجح
4. **استخدام subagents** (Rule 69) للباك-تست + التحليل

#### القيود الصارمة:
1. **لا تعديل على القواعد الدستورية** (Rules 1-76) بدون إذن صريح من المالك
2. **لا تعديل على ملفات الإعدادات الحساسة** (`.env` + `ecosystem.config.js` + `Caddyfile` + `prisma/schema.prisma`) بدون إذن
3. **لا تعديل على DBs الإنتاجية** (Rule 1) — فقط DBs الساندبوكس للقراءة + الباك-تست
4. **لا حذف ملفات** بدون VERIFY-BEFORE-DELETE (Rule 16)
5. **كل تحسين لازم يتوثّق في `worklog.md`** بالأرقام قبل/بعد + القرار (keep/revert)
6. **في حالة الـ revert** — لازم يُسجّل السبب بصراحة + يُبلّغ المالك في الشات

#### معايير التقييم (Acceptance Criteria):
التحسين يُعتبر **ناجح** لو حقّق **واحد على الأقل** من المعايير دي:

| المعيار | الحد الأدنى |
|---|---|
| **Win Rate** | يفضل ثابت أو يزيد (≥ -2% مسموح) |
| **Profit Factor** | يزيد (أو يفضل ثابت ≥ -5%) |
| **Avg Return** | يفضل ثابت أو يزيد |
| **Signal Distribution** | يصبح أكثر تنوعاً (نسبة BUY تنزل من 95.7%) |
| **عدد الإشارات الوهمية** | ينقص (مثل ORTE 48 مرة) |
| **عدد الـ kill_switch violations** | ينقص |

لو التحسين حقّق معيار واحد بس لكن خسر في معايير تانية → **يُعرض على المالك** للقرار.

#### التوثيق الإلزامي لكل تحسين:
في `worklog.md`، كل تحسين لازم يحوي:
```markdown
Task ID: IMPROVEMENT-<NAME>-<DATE>
Agent: Main Agent (Z.ai Code)

Work Log:
- Baseline (قبل): WR=X% / PF=Y / Avg=Z% / BUY distribution=W%
- Modification: <وصف التعديل + الملفات>
- After (بعد): WR=X'% / PF=Y' / Avg=Z'% / BUY distribution=W'%
- Decision: KEEP / REVERT
- Reason: <لو REVERT — السبب>

Stage Summary:
- <نتائج نهائية>
```

### القاعدة 72 — UNIFIED-DATA-CONTRACT (عقد التوحيد للمصدر الموحد للبيانات — 2026-10-07)
> **سبب الإضافة:** كارثة "نفس السهم = بيانات مختلفة على 7 شاشات + التليجرام". الـ audits الخمسة (UI-AUDIT-1 + API-AUDIT-2 + TELEGRAM-AUDIT-1 + CALC-AUDIT-1 + CALC-DUP-1) كشفت إن:
> - **5 صيغ مختلفة** لـ accumulation label
> - **5+ صيغ fallback** لـ support/resistance (×0.95، ×0.96، ×0.97، ×1.05، ×1.10)
> - **3 صيغ RSI** (Wilder صح، SMA خاطئ، EMA بـ seed مختلف)
> - **4 أنظمة thresholds** مختلفة لـ signal classification
> - **4 taxonomies** مختلفة لـ phase كلها اسمها "phase"
> - **3 routes** بـ fabricate `target_price_2 = target1 * 1.05` (Rule 27 violation)
>
> **المرجع التنفيذي:** `download/UNIFIED_DATA_CONTRACT.md`

#### المبدأ: كل metric له canonical source واحد فقط

كل شاشة/API/Telegram لازم يقرأ من المصدر الموحد. أي recomputation client-side أو fallback بـ hardcoded values = bug.

#### Canonical Sources (16 metrics):

| # | Metric | Canonical Source | ملف المرجع |
|---|--------|-----------------|-----------|
| 1-5 | signal, accumulation, money_flow, phase, volume_ratio | `vps-service/utils/canonical_signal.py` + `src/lib/canonical-signal.ts` | TS port مطابق Python 100% |
| 6-12 | ATR, RSI, SMA/EMA/MACD, VWAP, OBV, support/resistance | Rule 67(b) canonical files | `vps-service/analyzers/indicators/` |
| 13-14 | master_score, target_price/2/3, stop_loss | `predictions.db.predictions` (raw passthrough) | NO fabrication |
| 15 | buy_pct/sell_pct | `vps-service/utils/shared_liquidity.py::compute_money_flow()` | |
| 16 | price (live) | `stocks.db.stocks.current_price` + FRESHNESS GUARD | |

#### Canonical module files:
1. **Python port:** `vps-service/utils/canonical_signal.py` (309 LOC + self-test)
2. **TS port:** `src/lib/canonical-signal.ts` (246 LOC + self-test) — مطابق Python 100%

#### قواعد صارمة:
1. **أي شاشة/API/Telegram** يعرض أي metric من القائمة الـ 16 لازم يستورد من canonical module.
2. **ممنوع** fabrication: لو value NULL → undefined (لا fabricate بـ multipliers ثابتة).
3. **ممنوع** recomputation client-side بـ thresholds مختلفة.
4. **استخدام `signalAr()`** لكل label عربي — لا mapping محلي.

#### التحقق:
```bash
# 1. تأكد إن canonical modules شغّالة
python3 vps-service/utils/canonical_signal.py
npx tsx src/lib/canonical-signal.ts

# 2. تأكد إن مفيش fabrications في APIs
grep -rn "0\.95\|0\.96\|0\.97\|1\.03\|1\.04\|1\.05\|1\.06" src/app/api/ --include="*.ts" | grep -E "support|resistance|stop|target"

# 3. تأكد إن canonical_signal مستورد في كل ملف بيعرض accumulation
grep -rn "canonical_signal\|canonical-signal" src/ vps-service/ --include="*.ts" --include="*.tsx" --include="*.py"
```

### القاعدة 73 — SINGLE-DISPLAY-SOURCE (مصدر عرض واحد لكل شاشة — 2026-10-08)
> **سبب الإضافة:** تكملة Rule 20 (Python=Brain) + Rule 72 (UNIFIED-DATA-CONTRACT) بحماية عرض صريحة. كارثة "نفس السهم = 3 قرارات مختلفة على 5 شاشات" رغم وجود canonical modules كشفت إن الـ gaps كانت في طبقة العرض (screens) مش في طبقة الحساب.
>
> **المالك:** "الشاشة الواحدة كانت بتعرض 3 قرارات مختلفة لنفس السهم" — هذا لا يجوز.

#### المبدأ: كل شاشة تعرض decision data تقرأ من مصدر عرض واحد

كل شاشة تعرض `signal` / `master_score` / `RSI` / `support` / `resistance` / `entry` / `target` / `stop_loss` / `risk_reward` لازم تقرأ من مصدر عرض واحد:
`GET /api/stocks/[ticker]/unified → vps-service/utils/canonical_signal.py → predictions.db (V40.2)`

#### قواعد صارمة:
1. **ممنوع** قراءة هذه الحقول من أكثر من مصدر في نفس الشاشة.
2. **ممنوع** حسابها client-side (Rule 27 NO-FAKE-DATA + Rule 67(b) CALCULATION-CANONICAL).
3. **مسموح** بقراءة OHLC chart data + المؤشرات الرياضية الـ pure (data، لا decision).
4. **الحقول الممنوع حسابها client-side:** `signal`, `master_score`, `entry_price`, `target_1/2/3`, `stop_loss`, `rr_ratio`, `regime_confidence`, `analysis_text`, `who_is_buying_state`, `hmm_regime_ar`, `analysis_reason`.
5. **لو canonical endpoint رجّع NULL** → اعرض "— بيانات غير متاحة" (سياسة الفراغ Rule 27). ممنوع fabrication بـ multipliers (`*0.95`, `*1.05`, إلخ).

#### العلاقة مع القواعد الأخرى:
- **Rule 20** (Python=Brain): لا منطق مالي في الـ client.
- **Rule 27** (NO-FAKE-DATA): NULL يعني NULL.
- **Rule 67(b)** (CALCULATION-CANONICAL): كل حساب له canonical file واحد.
- **Rule 72** (UNIFIED-DATA-CONTRACT): 16 canonical metric source.
- **Rule 73** (هذه): كل شاشة تقرأ من مصدر عرض واحد (`/api/stocks/[ticker]/unified`).

#### التحقق (الإنفاذ):
```bash
# scripts/zero_conflict_test.py يضرب 7 endpoints × 5 tickers × 6 canonical fields
# لازم mismatch_rate == 0.00% + threshold_drift == 0
python3 scripts/zero_conflict_test.py
```

### القاعدة 74 — TICKER-COOLDOWN (حماية رأس المال — وقف السهم بعد 5 خسائر — 2026-10-08)
> **سبب الإضافة:** المالك أدرج "Ticker Cooldown" ضمن الحمايات المقدسة. كان موجودًا في الكود (improvement commit `efa40d69`) لكن غير مُرقّم كقاعدة دستورية صريحة.
>
> **ملاحظة ADDITIVE:** هذه القاعدة توثّق حماية موجودة في الكود، لا تنشئ حماية جديدة.

#### آليتان منفصلتان (كلاهما حمايات مقدسة Rule 19):

| # | الحماية | الترايغر | مدة الوقف | المرجع في الكود |
|---|---------|---------|----------|-----------------|
| 1 | **Ticker Cooldown** | 5 خسارات متتالية على نفس الـ ticker | **14 يوم** | `vps-service/jobs/daily_predictor.py:2844-2851` |
| 2 | **Circuit Breaker** | 3 خسارات متتالية على أي ticker | **3 أيام** | `vps-service/jobs/daily_closer.py:3287` + `vps-service/utils/circuit_breaker.py:48-53` |

#### قواعد صارمة:
1. Ticker Cooldown = per-ticker hard stop (لا override).
2. Circuit Breaker = حماية منفصلة (لا دمج مع Ticker Cooldown).
3. كلاهما حمايات رأس مال مقدسة (Rule 19): **لا تُلمس، لا تُضعف، لا تُخفّف thresholds**.
4. **ممنوع** bypass flag في الإنتاج (مسموح فقط في backtest sandbox).
5. **ممنوع** توليد توصية على ticker في cooldown بأي persona (Rule 23 NO-PERSONA-RECLASSIFICATION).

### القاعدة 75 — PUSH-AFTER-EVERY-TASK (رفع GitHub بعد كل مهمة — 2026-10-08) ⭐ قاعدة ثابتة
> **سبب الإضافة:** المالك رفع المدير العام لـ "عضو مهم في الفريق" + قرّر: "التحديثات تروح للـ GitHub بعد كل مهمة". هذا ينهي مشكلة BREACH-001 (فقدان الشغل في sandbox resets) نهائيًا + يضمن إن شغل الفريق متاح للجميع في الوقت الحقيقي.
>
> **تكملة Rule 63** (PUSH-AFTER-EVERY-COMMIT): القاعدة 63 كانت "كل commit = push فوري". القاعدة 75 أوسع: "كل مهمة مكتملة = commit + push فوري" (حتى لو مفيش commit صريح، المهمة المكتملة تستوجب push).

#### المبدأ: المهمة المكتملة = commit + push فوري

كل مهمة (Task) يكملها أي عضو فريق (المدير العام أو وكلاؤه أو أي session متوازية) تستوجب:

1. **commit** بـ message واضح يصف المهمة (ليس UUID عشوائي).
2. **push** فوري لـ `origin/main`.
3. **worklog entry** قبل الـ push (عشان باقي الفريق يقرأها بعد الـ pull).

#### قواعد صارمة:
1. **ممنوع** تأجيل الـ push لـ "نهاية الجلسة" — كل مهمة مكتملة = push.
2. **ممنوع** الـ push بدون worklog entry (باقي الفريق يحتاج السياق).
3. **commit message format:** `<type>(<scope>): <arabic description>` (مثل `fix(unify): توحيد THRESHOLDS مع canonical` — NOT UUID).
4. **قبل الـ push:** `git pull --rebase origin main` (لدمج شغل الفريق المتوازي + تجنب conflicts).
5. **بعد الـ push:** تأكيد إن الـ commit ظهر على GitHub (`git log origin/main -1`).
6. **الاستثناء الوحيد:** المالك يقول صراحةً "لا ترفع" لمهمة معينة.

#### التحقق:
```bash
# بعد كل مهمة:
git status --short                    # working tree نظيف؟
git log origin/main -1 --oneline      # آخر push وصل؟
git log origin/main..HEAD --oneline   # فارغ = كل شيء مرفوع
```

#### علاقة بـ BREACH-LOG:
- BREACH-001 (فقدان شغل sandbox reset) كان السبب الأصلي لـ Rule 63.
- Rule 75 تكمل: sandbox resets ما زالت تحدث → لازم push بعد كل مهمة عشان الشغل محفوظ على GitHub.

### القاعدة 76 — TEAM-WORK-REVIEW (مراجعة شغل الفريق قبل البدء — 2026-10-08) ⭐ قاعدة ثابتة
> **سبب الإضافة:** المالك قرّر: "لازم تراجع شغل باقي الفريق". الفريق شغّال بالتوازي على نفس المشروع (sessions متعددة + وكلاء). بدون مراجعة منظمة، يحصل تكرار + تعارض + overclaims.
>
> **الدرس المستفاد:** في جلسة سابقة، Tasks 1-7 ادّعت "إكمال التوحيد" لكن المراجعة الجنائية (AUDIT-PRIOR-TEAM) كشفت 6 overclaims + 9 fabrications مخفية. المراجعة المنظمة كانت ستحول دون هذا.

#### المبدأ: قبل أي مهمة جديدة، راجع شغل الفريق المتوازي

كل session تبدأ بـ:
1. **`git pull --rebase origin main`** — سحب آخر تحديثات الفريق.
2. **قراءة آخر 200-300 سطر من `worklog.md`** — فهم ما فعله الفريق مؤخرًا.
3. **قراءة آخر 3-5 commits على GitHub** — `git log --oneline -10` + `git show <sha> --stat` للمسائل الحرجة.
4. **تحديد التداخل:** هل مهمتي الحالية متداخلة مع شغل قائم؟ (نفس الملفات؟ نفس المشكلة؟).
5. **التواصل:** لو في تداخل، أبلغ المالك قبل البدء.

#### قواعد صارمة:
1. **ممنوع** البدء بمهمة بدون قراءة آخر worklog entries.
2. **ممنوع** تعديل ملفات شغال عليها فريق آخر بالتوازي (بدون إذن المالك).
3. **ممنوع** الـ overclaim ("تم الإكمال" بدون تحقق بالـ grep/test).
4. **إلزامي** تدقيق ادعاءات الفريق السابق قبل المهمة (الحل: وكيل AUDIT-PRIOR-TEAM pattern).
5. **إلزامي** احترام استراتيجيات الفريق البديلة (مثلًا: لو الفريق أصلح rogue writer بدل تعطيله، لا تُعطّله أنت).

#### التحقق:
```bash
# قبل كل مهمة:
git pull --rebase origin main
tail -200 worklog.md | head -100         # آخر المهام
git log --oneline -10                     # آخر commits
git diff origin/main..HEAD --stat          # تعديلاتي vs الفريق
```

#### علاقة بـ Rule 68(a) (AGENT-QUALITY-GATE):
- Rule 68(a) كانت "بوابة جودة الوكلاء" (import verification + file existence + no false claims).
- Rule 76 أوسع: مراجعة منظمة لـ **شغل الفريق المتوازي** + الحماية من التكرار/التعارض/الـ overclaims.

---

*نهاية التحديثات 2026-10-08 — القواعد 73 (SINGLE-DISPLAY-SOURCE) + 74 (TICKER-COOLDOWN) + 75 (PUSH-AFTER-EVERY-TASK) + 76 (TEAM-WORK-REVIEW). المالك رفع المدير العام لـ "عضو مهم في الفريق" — هاتان القاعدتان (75 + 76) قواعد ثابتة دائمة.*

---

## 📊 KPIs والحدود الحرجة (Hard Caps)

> **المرجع التفصيلي:** راجع `01-ARCHITECTURE_AND_API.md` §1 (نظرة عامة) + `03-HOW_IT_THINKS.md` (الـ 5 Pillars). هذا القسم يلخّص الأهداف والحدود الحرجة فقط.

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
| `atr_stop_min_pct` | 5.0% | `engine_settings.py` | الحد الأدنى للـ stop (EGX-STRATEGY 2026-08-30 — updated 2026-10-01) (Rule 8) |
| `atr_stop_max_pct` | 9.0% | `engine_settings.py` | الحد الأقصى للـ stop (risk ceiling) (Rule 8) |
| `dynamic_rr_normal` | 1.8 | `engine_settings.py` | R:R floor إلزامي (EGX-STRATEGY 2026-08-30 — updated 2026-10-01) (Rule 18) |
| `dynamic_rr_outperform` | 2.0 | `engine_settings.py` | R:R للأسهم المتفوقة على المؤشر (Rule 18) |
| `MIN_TURNOVER_EGP` | 500,000 | `background_analyzer.py` | فلتر السيولة (Rule 13) |
| `kill_filter_min_turnover_egp` | 3,000,000 | `liquidity_filter.py` (strict) | V40.2 strict mode (Rule 13) |
| `MAX_PREDICTIONS_PER_DAY` | 7 (legacy) / 5 (picks-management) | `historical_prediction_generator.py` / `confidence_engine.py` | حد التوصيات اليومية (§8) |
| `MIN_PREDICTIONS_PER_DAY` | 2 | `historical_prediction_generator.py` | الحد الأدنى لليوم الواحد |
| `MONITORING_PERIOD_DAYS` | 30 | `historical_prediction_generator.py` | أفق التوقع الافتراضي |
| `trailing_stop_activation_gain` | 2.0 | `engine_settings.py` | موحّد (Rule 9) |
| `partial_exit_at_rr` | 1.5 | `engine_settings.py` | بيع 50% عند 1.5R + breakeven (Rule 10) |
| `partial_exit_pct` | 50.0 | `engine_settings.py` | نسبة الخروج الجزئي (Rule 10) |
| `min_score` | 60 | `engine_settings.py` (V40-PHASE-4) | حد القبول الإنتاجي |
| `max_holding_days` | 30 | `engine_settings.py` | أقصى مدة احتفاظ (V40.2) |
| `breakeven_trigger` | 7% | `stop_manager.py` | تفعيل break-even |
| `portfolio_heat` | 2% | `stop_manager.py` | أقصى خسارة لكل صفقة من المحفظة |
| `ticker_cooldown_threshold` | 5 خسارات متتالية | `daily_predictor.py:2844-2851` | Ticker Cooldown — 14 يوم وقف (Rule 74) |
| `circuit_breaker_threshold` | 3 خسائر متتالية | `daily_closer.py:3287` + `circuit_breaker.py:48-53` | Circuit Breaker — 3 أيام وقف (Rule 74) |

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

> **المرجع التفصيلي:** راجع `03-HOW_IT_THINKS.md` §19 (سياسة الشخصيات + الـ persona fit logic).

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
| **V40.2 evidence-based** | `jobs/daily_predictor.py` | `balanced` فقط | عالية — 6 إثباتات + kill filters + R:R≥1.8. **~69% WR حيًا** |
| ~~Maestro persona~~ (محذوف — MAESTRO-KILL 2026-10-12) | ~~`analyzers/maestro_orchestrator.py`~~ | — | تم الحذف نهائيًا (Rule 35) |

### قاعدة حماية الـ Baseline (PERSONA-UNIFY-A — 2026-08-17)

1. **جدول `predictions` (مصدر الـ live dashboard) لم يُلمس** — `persona='balanced'` ثابت لكل V40.2 picks.
2. **جدول `persona_predictions` منفصل** — لا يقرأه الـ live dashboard overall KPI.
3. **الـ overall KPI محمي بالـ dedup-by-ticker** (Rule 22) — السهم الواحد = صفقة واحدة.
4. **مفيش orphan PENDING rows** — كل `persona_predictions` row بـ يتـ closed فورًا بالـ outcome المحاكى من V40.2 (`update_persona_prediction_outcome`).
5. **HARD cap (Rule 7)** مطبّق على `get_persona_stats` في `persona_db.py`.

---

## 🚦 قواعد حالة التوقعات (Prediction-Status Taxonomy)

> **المرجع التفصيلي:** `Documentation/_archive_pre_unification_2026-10-12/` (RL-FIX-9-Predictions-Status-Logic.md مُدمج هنا). تفاصيل migration scripts: راجع `04-CURRENT_STATE.md` §1.

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

> **التعريف:** كل توصية مفتوحة تُراجع دورياً بالسعر الحي وتُقفل عند الهدف/الوقف/انتهاء الأفق مع درس.
> الدروس تُقرأ في التحليل التالي وتعدّل شروط الشخصية ضمن حدود، مع قياس على `/live-tracking`.
> **التسجيل وحده دون قراءة وتأثير = غير مقبول كـ closed loop.**

### الـ 4 ملفات المعتمدة (Closed-Loop Chain)

| # | الملف | الدور |
|---|------|------|
| 1 | `vps-service/utils/live_price.py` | مصدر السعر الموحّد: `get_live_price` (intraday → data_engine → fallback). |
| 2 | `vps-service/jobs/daily_predictor.py` (V40.2 — replaced Maestro) | العقل: يقرأ الدروس → `applied_lesson` (توسيع وقف مسقوف) → `record_prediction` يكتب التوقع بـ persona حقيقية. |
| 3 | `vps-service/jobs/daily_closer.py` | الإغلاق الآلي: يقفل على سعر التفعيل (target/stop) + `is_correct` من `exit_type` + `record_lesson_from_close` + `detect_and_record_missed_opportunities`. |
| 4 | `vps-service/utils/lesson_store.py` | ذاكرة الدروس: `record_lesson_from_close` يصنّف (STOP_TOO_TIGHT / TARGET_HIT_OK / LATE_MOMENTUM / MISSED_BREAKOUT) → `get_persona_lesson_summary` / `get_ticker_lesson_summary` يقرأها المحرك. |

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
4. **الأتمتة (A1/A2):** `MarketScheduler.tick()` يستدعي `run_daily_closer()` كل 15 دقيقة (3 مسارات: paused/intraday/post-market). `vps-service/scripts/setup_cron.sh` يركّب cron يومي 14:35 Cairo Sun-Thu (belt-and-suspenders).
5. **تعريف "التعلّم شغّال وفعّال"** (بعد أسبوع تشغيل آلي):
   - دروس جديدة يومياً (`lessons` يزيد).
   - `[LEARNING]` يظهر على أسهم لها تاريخ.
   - `applied_lesson` يظهر عند تكرار STOP_TOO_TIGHT.
   - بدون ذلك: النظام **يسجّل** ولا **يتعلّم** — يعني الـ closed loop مكسور.

---

## 🎯 إدارة التوصيات (Picks Management)

> **Task ID الأصلي:** PICKS-MGMT-v3.4.43. تفاصيل الـ API endpoints: راجع `01-ARCHITECTURE_AND_API.md` §5.

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

> **المرجع التفصيلي:** `Documentation/_archive_pre_unification_2026-10-12/` (FUNDAMENTALS_HISTORICAL_TEST_REPORT.md + DATA_ENGINE_FUNDAMENTALS_INVENTORY.md مُدمجين هنا).

### القاعدة الأساسية

- **`fundamental_score` الحقيقي 0-100** من 4 جداول نظيفة في `data_engine.db`:
  - `tab_valuation` (pe, pb, peg, ps, ev_ebitda).
  - `tab_profitability` (roe, roa, net_margin, gross_margin, operating_margin).
  - `tab_dividends` (div_yield, payout, dps_growth).
  - `tab_technical_analysis` (technical_rating, rsi, macd, adx, atr).
- **الجداول المكسورة (لا تُستخدم حتى الإصلاح):** `tab_balance_sheet` / `tab_income_statement` / `tab_cash_flow` (column-shift bug — `symbol` column يحمل Arabic names — Rule 65 §65.1).
- **الجدول الفارغ:** `egx_fundamentals` (0 rows — fetcher غير مُجدول).

### قواعد السياسة

1. **لا placeholder 50** (Rule 24) — أي مسار إنتاجي لازم يحسب الـ score الحقيقي.
2. **Missing data → weight 0** (مش forced to 50) — التقييم يعكس البيانات المتاحة فقط.
3. **Resolver strategy** (no guessing): Exact match على `tab_valuation.symbol` (numeric Saudi tickers: 1030, 1120...) + Prefix match `symbol LIKE 'TICKER%'` (EGX alpha tickers stored as `TICKER+Arabic name`) + No match → `fundamental_score = None`, confidence = 0.
4. **Hard veto (مقترح للتفعيل بعد أسبوع حي):** رفض BUY لو `fundamental_score < 30` (PF 1.511 → 1.784, +0.273).
5. **ممنوع رفض BUY بناءً على fundamentals فقط للـ Gambler** (يقتل الزخم — الأساسيات filter إضافي فقط).
6. **ممنوع رفع عتبة الـ veto فوق 30** (هتقتل winners — يوجد false positive واحد موثّق: 2180 score=17.5 ret=+8.97%).
7. **Conservative gate** (مرحلة 3): رفض BUY لو `score<40 + conf>70` للـ conservative persona — يحتاج بيانات conservative persona أولاً.
8. **لا تفعّل `egx_fundamental_fetcher.py` cron** قبل إصلاح `tab_*→ticker` mapping (Rule 65 §65.1).
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

> **المرجع التفصيلي:** `Documentation/_archive_pre_unification_2026-10-12/` (ULTRA-RESTORE-DATABASE-RECOVERY.md + V40_2_LIVE_INTEGRATION_PLAN.md مُدمجين هنا). تفاصيل schema كل DB + جداولها + علاقاتها: راجع `01-ARCHITECTURE_AND_API.md` §3.

### الـ 7 قواعد بيانات SQLite (بعد DB-CLEANUP-WAVE — Rule 46)

1. `stocks.db` — الأسهم + القطاعات + `stock_daily_prices` + `stored_analyses` + `real_evaluated_predictions`.
2. `price_history.db` — التاريخ اليومي (المصدر الموحّد لقراءة الأسعار عبر `load_merged_history()` — safety net فقط بعد Rule 46 WAVE-2).
3. `predictions.db` — التوقعات النشطة + المغلقة + `actual_return` + V40 columns (`evidence_count`, `morning_bell`, `kill_filter_result`, `exit_type`, `lowest_price_reached`).
4. `data_engine.db` — بيانات الـ fundamentals + الأخبار + الكروب + `tab_*` (8 جداول) + `egksco_price_history` (المصدر الموحّد بعد Rule 46 WAVE-2) + `crypto_prices` (437K صف) + `gold_prices_clean` (231K صف) + 6 جداول شريعة (Rule 64).
5. `intraday.db` — بيانات intraday (ticker-level).
6. `auth.db` — مصادقة NextAuth.
7. `news.db` — الأخبار (المصدر الوحيد بعد Rule 44 — `market_news` table).

ثانوية: `gold_prices.db` (legacy) + `silver_prices.db` (legacy) + `analytics.db` + `community.db` + `learned.db` + `crypto_learning.db` + `crypto-lab.db` + `exchange_rates.db` + `historical.db` + `disclosures.db` (Rule 36).

### قواعد السلامة

1. **WAL mode + busy_timeout=30000** على كل DBs (عبر `scripts/init_db_safety.py`).
2. **لا `ALTER TABLE`** — بس `CREATE TABLE IF NOT EXISTS`. (ملاحظة: `ALTER TABLE ADD COLUMN` مسموح للـ migrations الآمنة فقط).
3. **كل عمليات DB في `try/except`** — لو فشل التخزين، التحليل بيكمل.
4. **ممنوع استخدام** `db/custom.db` (محذوف — Rule 46 WAVE-1).
5. **نسخ احتياطي يومي:** `scripts/auto-backup.sh` + `POST /api/admin/db-manager/auto-backup`.
6. **أرشيف GitHub:** `db/databases_backup.tar.gz` (37 MB) — يسترجع عبر `vps-service/tools/restore_from_local.py --from-git`.
7. **الاسترجاع الآمن** (SAFE restore):
   ```bash
   # فحص فقط (read-only)
   python3 vps-service/tools/restore_from_local.py --from-git --check
   # الاسترجاع الفعلي (مع نسخة احتياطية تلقائية + V40 migration)
   python3 vps-service/tools/restore_from_local.py --from-git
   ```
8. **⚠️ أدوات خطيرة (لا تستخدم):** `vps-service/tools/restore_dbs.py` (يكتب فوق DBs إنتاجية بدون نسخ احتياطي — ممنوع) + `scripts/inject_egx_historical_data.py` (يحقن بيانات EODHD — API key متلغي — قد يلوّث).
9. **الـ ULTRA-RESTORE policy** (من 2026-08-11): Cap على الخسائر -20% في `daily_closer.py` + `historical_prediction_generator.py` لمنع الشذوذ الرياضي + SELL expiry calculation إلزامي: `profit_loss = (entry - exit) / entry × 100` + لا double negation في `historical_prediction_generator.py`.

### سكربتات "لا تكسر الإنتاج" (4)

1. `scripts/init_db_safety.py` — WAL + busy_timeout على كل DBs.
2. `scripts/repair_all_dbs.py` — إصلاح DBs تالفة (REINDEX + dump/rebuild).
3. `scripts/daily_db_health_check.py` — فحص يومي + إصلاح تلقائي + تقرير JSON.
4. `scripts/setup-daily-health-cron.sh` — تثبيت/إزالة cron job.

---

## 📋 خطوات سير العمل (Workflow) + بنية المشروع

> **المرجع التفصيلي:** راجع `01-ARCHITECTURE_AND_API.md` §1-§5 (المعمارية + DBs + APIs + تدفق البيانات) + `02-SCREENS_AND_COMPONENTS.md` (الشاشات) + `04-CURRENT_STATE.md` §1 (Production Snapshot).

### §11.1 — عند بداية أي مهمة

1. اقرأ الملفات الـ 5 في `Documentation/` بهذا الترتيب: `00-CONSTITUTION.md` (هذا الملف) + `01-ARCHITECTURE_AND_API.md` + `02-SCREENS_AND_COMPONENTS.md` + `03-HOW_IT_THINKS.md` + `04-CURRENT_STATE.md`.
2. اقرأ `AGENTS.md` + آخر 3 إدخالات في `CHANGELOG.md`.
3. اقرأ آخر ~200-300 سطر في `worklog.md` لمعرفة ما فعله الوكلاء السابقون (Rule 76).
4. لو المهمة تشمل DBs، اقرأ `01-ARCHITECTURE_AND_API.md` §3 (مسارات DBs).
5. حدد ما إذا كانت المهمة: **Fix** (§11.2) / **Feature** (§11.3) / **Refactor** (§11.4 + لازم موافقة المالك) / **Documentation** (§11.5).
6. سجّل المهمة في `worklog.md` قبل البدء.

### §11.2 — Fix workflow

1. **أعد إنتاج الـ bug** في الساندبوكس أولًا (لو ممكن).
2. **شخّص السبب الجذري** (Rule 67(a) — ROOT-CAUSE-FIRST) — لا تعالج العَرض. ابحث عن: بيانات ناقصة؟ + عتبة hardcoded تتجاوز `engine_settings`؟ + import مكسور؟ + كود ميت بـ يـ shadow كود نشط؟ + key-mismatch (مثل `stop_loss`/`target_1`/`target_2` vs `sl`/`tp1`/`tp2`)؟
3. **اكتب الإصلاح** في الملف الموجود (لا تنشئ ملف جديد — Rule 4).
4. **تحقق**: `tsc --noEmit` + `python3 -c "import ..."` + `bun run lint`.
5. **اختبر** في الساندبوكس (Agent Browser للواجهة + curl للـ API).
6. **حدّث التوثيق** (Rule 41 — DOCS-FIRST-LAST) لو الإصلاح يغيّر سلوك المحرك.
7. **ارفع** على git (Rule 75 — PUSH-AFTER-EVERY-TASK).

### §11.3 — Feature workflow

1. **اسأل**: هل الميزة موجودة فعلًا؟ (Grep في `src/` و `vps-service/`).
2. **إن وُجدت**: وسّعها. إن لم توجد: اطلب موافقة المالك على إنشاء ملف (Rule 68(b)).
3. **اربط الباك-إند ← API ← بروكسي ← الواجهة** في نفس الـ PR (Rule 5).
4. **لا تترك كود ميت** — لو ضفت endpoint، استخدمه في الواجهة.
5. **حدّث** `02-SCREENS_AND_COMPONENTS.md` لو ضفت شاشة/مكوّن.
6. **حدّث** `01-ARCHITECTURE_AND_API.md` لو ضفت محرك/قاعدة بيانات/وحدة.
7. **ارفع** على git (Rule 75).

### §11.4 — Refactor workflow (لازم موافقة المالك)

1. **لا تبدأ refactoring بدون موافقة صريحة** من المالك (Rule 25 + Rule 68(b)).
2. اقرأ قسم القيود الحرجة في `04-CURRENT_STATE.md` §1 لمعرفة الديون الموثّقة.
3. اختر مرحلة واحدة فقط (مثلًا: "حذف garage/ directory" أو "حذف 71 مكوّن orphan").
4. **نفّذ في فرع منفصل** (`git checkout -b refactor/<name>`).
5. **اختبر شاملًا** بعد كل ملف تُعدّله.
6. **حدّث** قسم القيود الحرجة في `04-CURRENT_STATE.md` §1 (ضع علامة ✅ على المكتمل).
7. **اطلب مراجعة المالك** قبل الـ merge.

### §11.5 — Documentation workflow

1. التوثيق **يلزم** الواقع الحالي للكود، مش النظري.
2. استخدم الأدوات (Grep/Glob/Read) للتأكد من كل رقم وكل مسار.
3. لا تنسخ من `CHANGELOG.md` بدون تحقق — قد يكون قديمًا.
4. كل ملف توثيقي لازم يبدأ بـ "آخر تحديث" + المالك + المسار.
5. بعد التحديث، ارفع على git فورًا (Rule 75).

### §11.6 — دورة التحديث والإغلاق + الرفع على GitHub

#### عند انتهاء أي مهمة:

1. **تحقق من القواعد** في هذا الملف (§3-§11 — ماذا كسرت؟ لا شيء؟ كمل).
2. **شغّل الفحوصات**:
   ```bash
   bun run lint                                  # Frontend lint
   npx tsc --noEmit -p tsconfig.json            # TypeScript types
   python3 -c "import vps-service.<module>"      # Backend import
   ```
3. **اختبر في المتصفح** (Agent Browser للواجهة، curl للـ API).
4. **حدّث التوثيق المتأثر** (Rule 41 — DOCS-FIRST-LAST + Rule 70 — DOCUMENTATION-SECRETARY):
   - لو غيّرت محرك → `01-ARCHITECTURE_AND_API.md` + `03-HOW_IT_THINKS.md`.
   - لو ضفت/حذفت شاشة أو مكوّن → `02-SCREENS_AND_COMPONENTS.md`.
   - لو غيّرت منطق التحليل → `03-HOW_IT_THINKS.md`.
   - لو ضفت قاعدة → `00-CONSTITUTION.md` (هذا الملف) — بموافقة المالك.
5. **أضف إدخال** في `CHANGELOG.md` (في الأعلى).
6. **أضف إدخال** في `worklog.md` (في النهاية، بصيغة `Task ID: <X>` + `Work Log` + `Stage Summary`).
7. **Commit** برسالة واضحة (عربي أو إنجليزي، شاملة — Rule 62.2).

#### الرفع على GitHub (Rule 75 — PUSH-AFTER-EVERY-TASK):

```bash
cd /home/z/my-project  # أو /root/GLMinvestment على الإنتاج
git pull --rebase origin main   # Rule 76 — راجع شغل الفريق المتوازي
git status
git add <files-changed>
git commit -m "<وصف مختصر بالعربي أو الإنجليزي>"
git push origin main            # إلزامي بعد كل commit (Rule 63 + Rule 75)
```

**قواعد الـ commit:**
- لا تـ commit ملفات `.db` (ممنوع بحسب `.gitignore`).
- لا تـ commit `.env` أو أسرار.
- لا تـ commit `node_modules/` أو `__pycache__/`.
- رسالة الـ commit لازم تشمل: ماذا تغيّر + لماذا + رقم المهمة (لو موجود).

#### مزامنة الإنتاج من الساندبوكس (READ-ONLY — No DB Touch):

```bash
# على الإنتاج
cd /root/GLMinvestment
git pull origin main
pm2 restart nextjs python-backend data-engine ws-service telegram-events news-agent
# تحقق:
curl -s http://localhost:3000/api/health
curl -s http://localhost:8010/health
```

**ملاحظة:** الـ DBs على الإنتاج **لا تُلمس** (Rule 1). الـ `git pull` بـ يجيب الكود فقط، مش DBs.

#### ما لا يُفعل بعد R:R-FIX / FUNDAMENTALS-ACTIVATION:

- ❌ لا تحذف أو تعدّل أي توقع موجود في `predictions.db` — الإصلاح forward-only.
- ❌ لا تُعد تشغيل الـ historical backfill (`maestro_backfill_*`) — بـ يكتب فوق الـ closed-trade outcomes.
- ❌ لا تغيّر عتبات `engine_settings.py` (`dynamic_rr_normal`, `atr_stop_min_pct`, etc.) بدون جلسة قياس منفصلة.
- ❌ لا تفعّل `egx_fundamental_fetcher.py` cron قبل إصلاح `tab_*→ticker` mapping (Rule 65 §65.1).

### §11.7 — بنية المشروع (مرجع سريع)

> التفاصيل الكاملة في `01-ARCHITECTURE_AND_API.md` §1-§5. هذا ملخص للقواعد البنيوية.

#### الواجهة (Frontend — Next.js 16)
- المسار: `src/` — الدخول: `src/app/page.tsx` (single-page shell مع hash routing).
- المكونات: `src/components/` (legacy) → `src/modules/` (Rule 60 — 17 module قياسي).
- الـ UI primitives: `src/components/ui/` (49 shadcn/ui).
- الـ API routes: `src/app/api/` — راجع `01-ARCHITECTURE_AND_API.md` §5 لقائمة الـ routes النشطة.

#### الباك-إند (Backend — Python)
- المسار: `vps-service/` — الدخول: `lightweight_server.py` (Flask على 8010) + `main.py` (FastAPI).
- المحركات: `analyzers/` (123 ملف) + `engine/` (10) + `engines/` (6).
- الـ APIs: `api/` (65 ملف، 31 blueprint مسجّل — راجع `01-ARCHITECTURE_AND_API.md` §5).
- الـ jobs: `jobs/` (12 ملف — schedulers + closers + learners).
- المخاطر: `portfolio/` (9) + `risk_management_advanced.py` (root).
- البيانات: `data/` (15) + `data_engine/` (منفصل).

#### الـ Data Engine
- منفصل عن `vps-service/` — مساره `data_engine/`.
- يجمع البيانات من TradingView + Yahoo + EGXPilot + CoinGecko + EGKSCO + Daleelak + Frankfurter CBE + isagha (Rule 48).
- يكتب في `data_engine.db` + `intraday.db` + `price_history.db` (عبر `write_guarded()` — Rule 66).

#### المحركات الرئيسية (Canonical Engines)

| المحرك | الملف | الدور |
|--------|------|-------|
| MasterAnalyzer | `analyzers/master_analyzer.py` | الدماغ — يجمع كل المحللات + `load_merged_history()` |
| CoreScoringEngine | `analyzers/core_scoring_engine.py` | RSI/MACD/SMA/ATR/Bollinger (Canonical: Rule 67(b)) |
| InstitutionalDecisionEngine | `analyzers/institutional_decision_engine.py` | V40.2 — 6 إثباتات موزونة + kill filters |
| EngineSettings | `analyzers/engine_settings.py` | مصدر الحقيقة للعتبات (~100 مفتاح — Rule 11) |
| AdaptiveWeights | `analyzers/adaptive_weights.py` | `PERSONA_INPUT_WEIGHTS` + تكيف حسب الـ regime |
| V38BacktestEngine | `engines/v38_backtest_engine.py` | باكتست V38/V40.2 + simulate_trade + ATR clamp |
| FlowSystem | `engine/flow_system.py` | 4 طبقات flow score |
| StopManager | `portfolio/stop_manager.py` | 7 أنواع ستوب |
| PositionManager | `portfolio/position_manager.py` | إدارة المراكز (class-based) |
| RiskManagementAdvanced | `risk_management_advanced.py` | position sizing + STOP_LOSS_EGX/CRYPTO |
| MarketScheduler | `jobs/market_scheduler.py` | المُجدوِل المركزي |
| DailyCloser | `jobs/daily_closer.py` | إغلاق التوقعات يوميًا + Hard Loss Ceiling |
| LearningEngine | `jobs/learning_engine.py` | التعلم من الصفقات المغلقة |
| V40.2 Generator | `jobs/daily_predictor.py` | توليد توقعات V40.2 الإنتاجي (Rule 21 + Rule 35) |
| PriceHistorySafetyNet | `jobs/price_history_safetynet.py` | ملء فجوات Yahoo |
| IntradayAggregator | `jobs/intraday_aggregator.py` | intraday → daily |
| ConfidenceEngine | `analyzers/confidence_engine.py` | 7 عوامل ثقة + 4 tiers (§8) |
| FundamentalDataProvider | `analyzers/fundamental_data_provider.py` | `get_fundamental_score()` الحقيقي 0-100 (Rule 24) |
| PurificationCalculator | `portfolio/purification_calculator.py` | حاسبة التطهير الشرعي (Rule 64 — Python=Brain) |

#### المهام المجدولة (22 مهمة APScheduler) — تفاصيلها في `01-ARCHITECTURE_AND_API.md` §5

---

## ✅ عهد الوكيل (34 بند)

أي وكيل (Kilo / Grok / Gemini / Z.ai / بشري) يبدأ العمل في هذا المشروع **يقرأ هذا الملف**
ويُقرّ بما يلي:

1. قرأتُ `Documentation/00-CONSTITUTION.md` (هذا الملف) وفهمتُ القواعد المطلقة الـ **76** (1-32 + 42 + 33-41 + 43-76، مع تنويه أن 67 و 68 لكل منهما شقّان a/b).
2. سأقرأ `Documentation/01-ARCHITECTURE_AND_API.md` + `Documentation/02-SCREENS_AND_COMPONENTS.md` + `Documentation/03-HOW_IT_THINKS.md` + `Documentation/04-CURRENT_STATE.md` قبل أي تعديل.

3. لن ألمس قواعد البيانات على الإنتاج (القاعدة 1).
4. لن ألمس ملفات النظام (القاعدة 2).
5. سألتزم ببنية المشروع (القاعدة 3).
6. لن أنشئ شاشات/ملفات/أنظمة جديدة إلا في الطوارئ وبموافقة المالك (القاعدة 4 + Rule 63.2 + Rule 68(b)).
7. كل كود أكتبه سيرتبط ويُستخدم (القاعدة 5).
8. سألتزم بـ schema-aware (القاعدة 6) و HARD cap (القاعدة 7) و ATR stop [5%,9%] للأسهم / [5%,15%] للكريبتو (القاعدة 8) و R:R ≥ 1.8 (القاعدة 18) و Python=Brain (القاعدة 20) و V40.2 evidence-based (القاعدة 21) و dedup-by-ticker (القاعدة 22) و PERSONA-UNIFY-A (القاعدة 23) و fundamentals real (القاعدة 24).
9. سأحترم مسار التوقعات الرسمي (V40.2) ولا أعيد تصنيف الشخصيات في `predictions.persona`.
10. سأحدّث التوثيق المتأثر بعد كل مهمة وأرفع على GitHub **فوراً بعد كل مهمة** (Rule 75 — PUSH-AFTER-EVERY-TASK).
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
31. سأحترم التوافق الشرعي + التطهير (القاعدة 64): `sharia_compliance_scraper.py` هو المصدر الأسبوعي + معيار S&P الأساسي + Musaffa/Kashif/Osoul تكميلية + AAOIFI مستبعدة + `purification_calculator.py` Python=Brain + ممنوع نسخ معادلة التطهير في TypeScript.
32. سأمرّ كل بيانات الأسعار بـ `validation.py::validate_stock_data()` قبل التحليل (القاعدة 65) — INVALID fields بتتصفّر + لو `current_price` INVALID → HOLD score=0 + Cross-stock contamination ratio>10x → INVALID + Stale 52W + OHLC integrity checks.
33. سأفرض `source_authority.py::write_guarded()` على كل scraper قبل أي INSERT (القاعدة 66) — CANONICAL_SOURCES لكل سوق + BANNED_SOURCES (egxpilot_live + yahoo_safetynet + yfinance_backfill) ممنوعة + fallback بيكتب بنفس الاسم.
34. **سألتزم بـ canonical واحد لكل حساب فني (القاعدة 67(b) / Rule 54)** — ATR/RSI/SMA/EMA/MACD/VWAP/OBV من `analyzers/indicators/`، R:R من `utils/risk_reward.py`، WR/PF من `utils/backtest_stats.py`، position sizing من `utils/position_sizing.py`. ممنوع inline copies.

---

*هذا الدستور ملزم. أي تغيير فيه لازم بموافقة المالك وتوثيقه في `CHANGELOG.md`.*
*آخر تحديث عهد الوكيل: 2026-10-12 — تحديث البند 1 + البند 2 ليشير إلى الـ 5 ملفات الموحّدة بعد DOC-UNIFY-1-CONSTITUTION، + تحديث البند 10 ليشير إلى Rule 75 (PUSH-AFTER-EVERY-TASK) بدلًا من Rule 26.*

---

## 📋 ميثاق الانضباط الهندسي (Engineering Discipline Charter)

> ملحق دستوري إلزامي. كل وكيل (Kilo / Grok / Gemini / Z.ai / بشري) يبدأ عمله لازم يقرأ هذا القسم **بعد** `00-CONSTITUTION.md` (القواعد الـ 76).
> الهدف: تحويل القواعد من "معروفة" إلى "مُطبّقة" — لأن الفجوة بين المعرفة والتطبيق هي سبب كل خرق.
> **المصدر الأصلي:** `DISCIPLINE.md` (مُدمج هنا بواسطة Documentation Secretariat — Task 25، ثم محدّث في DOC-UNIFY-1-CONSTITUTION).

### المبدأ 1 — PUSH-AFTER-EVERY-COMMIT (القاعدة الذهبية)

> **كل commit = push فوري. مفيش "هتجمع 3 commits و push بعدين".**

```bash
git add -A
git commit -m "<message>"
git push origin main    # إلزامي بعد كل commit، مش可选
```

**ليه؟** الساندبوكس ممكن يتريس في أي لحظة (حصل فعلاً — BREACH-001). commit محلي بدون push = شغل معرض للضياع. الـ push هو الـ "save" الحقيقي. الـ commit بس "stage".

**استثناء؟** **مفيش استثناء.** لو الـ push فشل (network/auth) → توقف، أصلّح، وpush. ما تكمّلش شغل جديد غير بعد التأكد إن الـ commit اللي فات وصل GitHub. (تكملة Rule 63 + Rule 75).

### المبدأ 2 — الصدق المُتحقّق منه (Verified Honesty)

> **كل "FIXED" = grep/curl/test evidence حرفي في الـ worklog + commit message.**

| لو بتقول | لازم تثبت بـ |
|---|---|
| "FIXED X" | `grep -c "X" src/ = 0` حرفي |
| "حذفت Y ملف" | `git diff --stat` يوضّح |
| "اجتاز الاختبار Z" | ناتج الـ test runner |
| "حدثت N صف" | `SELECT COUNT(*) ... = N` |

لو مفيش دليل → "CANNOT VERIFY" بدل "FIXED". الكذب = خرق BREACH-LOG. (تكملة Rule 68(a) — AGENT-QUALITY-GATE).

### المبدأ 3 — الحلقة المفرغة (Closed Loop)

```
إصلاح → اختبار → تدقيق → موافقة → توثيق → PUSH
   ↑                                                        |
   └─── لو فشل أي مرحلة، رجوع للإصلاح ←────────────────────┘
```

- مفيش task ينتقل لمرحلة تانية غير بعد اجتياز الـ gate.
- الـ push هو آخر gate. مش push = task مش خلصان. (تكملة Rule 75).

### المبدأ 4 — الـ Diff = الرسالة

> **رسالة الـ commit تطابق `git diff --stat` بالظبط.**

- ❌ "إصلاح 5 كوارث" لو الـ diff فيه fix واحد = كذب.
- ❌ "28 console.error fixed" لو الـ diff ما غيّرش console.error = انتحال.
- ✅ "fix(db): add أمريكا→US migration (was claimed but never done)" = دقيق.
- ✅ "docs(retraction): backtest v4 PF=1.31 claim was fabricated" = صادق.

(تكملة Rule 62.2 — قواعد الـ Commit Message).

### المبدأ 5 — NO-NEW-SCREENS-FILES (Rule 63.2)

> **ممنوع إنشاء شاشات/ملفات جديدة إلا بموافقة صريحة من المالك أو مجلس الإدارة.**

- لو محتاج ملف جديد → اسأل الأول: "هل أقدر أدمج ده في ملف موجود؟"
- لو شاشة جديدة → السؤال: "هل فيه شاشة بتعمل نفس الشغلانة؟" → ادمج بدل ما تضيف.
- التنظيف والحذف والدمج = الأولوية. الإضافة = استثناء.

### المبدأ 6 — القسوة (Strictness)

> **لا تساهل، لا راحة.** الوكيل يفشل في verification → يُعاد تكليفه + يُسجّل الخرق.
> ثلاثة خرقات → استبعاد من المعسكر.

(تكملة Rule 68(a) — AGENT-QUALITY-GATE + Rule 76 — TEAM-WORK-REVIEW).

### المبدأ 7 — التوثيق المستمر

كل task لازم يخلص بـ section في `worklog.md` بالصياغة:
```markdown
---
Task ID: <id>
Agent: <name> (<role>)
Task: <one line>

Work Log:
- <step with file:line + grep/curl evidence>

Verification:
- <literal test output>
- git diff --stat: <output>
- git push: <succeeded/failed>

Stage Summary:
- DONE: <what>
- NOT DONE: <what>
- CANNOT VERIFY: <what>
```

(تكملة Rule 41 — DOCS-FIRST-LAST + Rule 70 — DOCUMENTATION-SECRETARY).

### المبدأ 8 — الإقرار

> أنا المدير العام أقرّ بأن BREACH-001 حصل بسبب إهمالي في تطبيق Rule 62.
> من دلوقتي، كل commit = push فوري (Rule 63 + Rule 75). أي وكيل يخالف = خرق في BREACH-LOG.
> الهدف: مشروع متكامل متماسك، مش شغل ناقص.

**المدير العام:** Z.ai
**التاريخ:** 2026-10-01 (محدّث 2026-10-12)
**المرجعية:** `00-CONSTITUTION.md` Rule 62 + Rule 63 + Rule 75 + `BREACH-LOG.md` BREACH-001

---

## ⚖️ الحماية القانونية + النص المعتمد + الكلمات الممنوعة

> **هذا القسم يوثق كل الإجراءات القانونية المتخذة لحماية المنصة.**
> **الحالة:** ✅ المنصة محمية قانونياً
>
> **المرجع التفصيلي:** `src/components/legal/DisclaimerBanner.tsx` + `Footer.tsx`. تفاصيل الـ commits: راجع `04-CURRENT_STATE.md` §1.

### 🚨 المشكلة القانونية الأصلية

حسب **قانون هيئة الرقابة المالية المصرية (FRA)** و**قواعد السلوك المهني للأوراق المالية**، أي منصة بتقدم "توصية استثمارية" بدون ترخيص مالي مرخص بتعرض صاحبها لـ: غرامات مالية كبيرة + سجن + إغلاق المنصة + مسؤولية مدنية عن خسائر العملاء.

#### المشاكل اللي اكتُشفت في الـ Audit:

| المشكلة | العدد | الخطورة |
|---------|------|---------|
| كلمة "توصية" في الكود | 69 مرة في 30 ملف | 🔴 حرج |
| كلمة "مضمون" | 15 مرة | 🔴 حرج (توقيع سجن) |
| "نصيحة استثمارية" | 17 مرة | 🟠 مهم |
| **"8% سنوياً مضمون"** | 1 مرة | 🔴🔴 سجن محتمل |
| **"صفقات قليلة لكن مضمونة"** | 1 مرة | 🔴🔴 سجن محتمل |

### ✅ الحلول المُنفَذة

#### 1. إزالة كل كلمات "مضمون" الخطيرة

| الملف | قبل | بعد |
|------|------|-----|
| `DynamicRiskProfilerModal.tsx` | "8% سنوياً مضمون" | "8% سنوياً عائد ثابت (شهادات إيداع)" |
| `SuperLearningSystem.tsx` | "صفقات قليلة لكن مضمونة" | "صفقات قليلة ومدروسة المخاطر" |
| `AboutView.tsx` | "سيولة حقيقية مضمونة" | "سيولة حقيقية موثقة" |
| `RiskProfilerQuiz.tsx` | "عائد ثابت ومضمون" | "عائد ثابت" |

#### 2. استبدال "توصية" بـ "توقع" في كل المشروع

- **69 occurrence → 0** (ما عدا DisclaimerBanner — مطلوب قانونياً).
- في كل `src/components` + `src/lib` + `src/app`.
- أمثلة: "توصية غلط" → "توقع خاطئ" + "توصية صحيحة" → "توقع صحيح" + "التوصية الحالية" → "التوقع الحالي" + "تاريخ التوصية" → "تاريخ التوقع" + "بطاقة إثبات التوصية" → "بطاقة إثبات التوقع" + "توصية عامة" → "إشارة عامة" + "توصية إدارة" → "إشارة إدارة".

#### 3. DisclaimerBanner أقوى (3 components)

**الملف:** `src/components/legal/DisclaimerBanner.tsx`

- **Component 1: DisclaimerBanner (top banner)** — يظهر في أعلى كل صفحة + قابل للـ dismiss (sessionStorage).
- **Component 2: LegalDisclaimerFooter (ثابت)** — يظهر في أسفل كل شاشات التوقعات/التحليل + **مش قابل للـ dismiss** — لازم يفضل ظاهر دايماً.
- **Component 3: InlineDisclaimer (compact)** — يظهر جوه البطاقات والشاشات الفردية + compact + concise.

#### 4. LegalDisclaimerFooter في كل الشاشات الحرجة

| الشاشة | الملف | الحالة |
|--------|------|--------|
| فلتر العملات الرقمية | `CryptoScreenerView.tsx` (محذوف/أرشيف — Rule 16) | 🗑️ أرشيف |
| تتبع توقعات الكريبتو | `CryptoPredictionTrackingView.tsx` | ✅ (live) |
| فلتر الأسهم المتقدمة | `StockScreenerAdvanced.tsx` | ✅ |
| كل الصفحات (Footer) | `Footer.tsx` | ✅ |

قائمة الشاشات الكاملة بحالتها: راجع `02-SCREENS_AND_COMPONENTS.md`.

### 📜 النص القانوني المعتمد

#### النص الكامل (يظهر في DisclaimerBanner):

```
⚠️ إخلاء مسؤولية قانوني

هذه المنصة تقدم رأيًا شخصيًا آليًا لأغراض تعليمية وتحليلية فقط، وليست
توصية استثمارية أو نصيحة مالية. القرار النهائي مسؤولية العميل وحده.

لا يوجد أي ضمان للنتائج. السوق يحتوي على مخاطر، والخسارة ممكنة.
استشر مستشارًا ماليًا مرخصًا قبل أي قرار استثماري.
```

#### النص المختصر (يظهر في Footer + InlineDisclaimer):

```
إخلاء مسؤولية: المنصة تقدم رأيًا شخصيًا آليًا لأغراض تعليمية وتحليلية
فقط، وليست توصية استثمارية. القرار مسؤولية العميل وحده.
لا يوجد ضمان للنتائج، والخسارة ممكنة.
```

#### النص المختصر جداً (compact):

```
رأي آلي تعليمي — ليس توصية استثمارية. القرار مسؤوليتك.
```

### 🔑 المبادئ القانونية المعتمدة

1. **"رأي شخصي آلي"** — المنصة بتقدم رأي، مش توصية.
2. **"القرار مسؤولية العميل"** — العميل هو اللي بياخد القرار.
3. **"لا يوجد ضمان للنتائج"** — مفيش ربح مضمون.
4. **"الخسارة ممكنة"** — الاعتراف بالمخاطر.
5. **"استشار مستشار مالي مرخص"** — التوجيه للاستشارة المهنية.

### 🚫 الكلمات الممنوعة في المنصة

| الكلمة | السبب | البديل |
|--------|------|--------|
| توصية | معناها قانوني محدد | توقع / إشارة / تحليل |
| مضمون | لا يوجد ضمان في الاستثمار | مدروس / موثق |
| نصيحة استثمارية | محتاجة ترخيص | رأي شخصي آلي |
| ربح مضمون | مستحيل في الاستثمار | عائد متوقع |
| بدون مخاطر | كذب | مخاطر مدروسة |
| آمن 100% | كذب | مخاطر محسوبة |

### 📋 الـ Commits على GitHub

| Commit | التاريخ | الوصف |
|--------|---------|-------|
| `c350a4f9` LEGAL-AUDIT | 2026-08-30 | حماية قانونية شاملة |
| `16184d54` | 2026-08-29 | security: remove ALL random/fake data (Rule 27) |
| `04354a5` FUNDAMENTALS-ACTIVATION | 2026-08-30 | Rule 24 — fundamentals real |
| `65a748f` R:R-FIX | 2026-08-30 | Rule 18 — dynamic R:R floor 1.8 |
| `d9154387` EGX-DISCLOSURE-ENGINE | 2026-09-01 | Rule 36 — الإفصاحات الرسمية |
| `d49ab39b` STRICT-ENTRY-FILTERS | 2026-09-01 | Rule 37 — شروط الدخول الصارمة |
| `dcbb5cd2` SHORT-HOLDING-DISTRIBUTION-EXIT | 2026-09-01 | Rule 38 + Rule 39 |
| `7abe2743` NEWS-FETCHER-ANALYZER | 2026-09-01 | Rule 40 — sentiment analysis |

### ✅ التحقق النهائي

- **lint:** EXIT 0 ✅
- **عدد "توصية" المتبقية:** 0 (ما عدا DisclaimerBanner — مطلوب قانونياً) ✅
- **عدد "مضمون" المتبقية:** 0 ✅
- **DisclaimerBanner في كل الصفحات:** ✅
- **LegalDisclaimerFooter في كل الشاشات الحرجة:** ✅
- **Footer محدَث بنص قانوني أقوى:** ✅

**المنصة محمية قانونياً.** ✅

---

## 📒 فهرس سجل التغييرات (آخر 5 تحديثات)

> السجل الكامل متاح في `git log` + `CHANGELOG.md`. هذا الفهرس يوثّق آخر 5 تحديثات دستورية فقط.

| التاريخ | Task ID | التغيير |
|---------|---------|---------|
| **2026-10-12** | DOC-UNIFY-1-CONSTITUTION | **توحيد التوثيقات في 5 ملفات داخل `Documentation/`.** هذا الملف (الدستور الموحّد) يحتوي على القواعد المطلقة الـ 76 كاملة. تم: (1) اختصار الـ header القديم (80+ سطر من "آخر تحديث") إلى آخر 3 تحديثات فقط. (2) استبدال تفاصيل DB schema + API list + UI screens + Pipeline/Logic + Production Snapshot بمراجع متقاطعة لملفات التوثيق الأخرى (01-ARCHITECTURE_AND_API + 02-SCREENS_AND_COMPONENTS + 03-HOW_IT_THINKS + 04-CURRENT_STATE). (3) توحيد عدد القواعد إلى 76 في كل مكان (header + عهد + فهرس). (4) حل تعارض الترقيم المزدوج للقاعدتين 67 و 68 بتسميتهما 67(a)/67(b) و 68(a)/68(b). (5) دمج ميثاق الانضباط الهندسي (DISCIPLINE.md) + الحماية القانونية (LEGAL_PROTECTION.md) داخل الملف. لم تُحذف أي قاعدة — إعادة تنظيم + اختصار + إشارات مرجعية فقط. |
| 2026-10-08 | CONSTITUTION-R75-R76 | **المالك رفع المدير العام لـ "عضو مهم في الفريق":** إضافة 4 قواعد جديدة بعد Rule 72. (1) **Rule 73 — SINGLE-DISPLAY-SOURCE**: كل شاشة تعرض signal/master_score/RSI/support/resistance تقرأ من `/api/stocks/[ticker]/unified` فقط. مكملة لـ Rule 20 + 27 + 67(b) + 72. الإنفاذ: `scripts/zero_conflict_test.py`. (2) **Rule 74 — TICKER-COOLDOWN**: توثيق حماية موجودة (5 خسائر/سهم→14 يوم + Circuit Breaker 3 متتالية→3 أيام) كقاعدة دستورية صريحة. (3) **Rule 75 — PUSH-AFTER-EVERY-TASK ⭐ قاعدة ثابتة**: كل مهمة مكتملة = commit + push فوري لـ GitHub. تكملة Rule 63. ينتهي BREACH-001 (sandbox resets). (4) **Rule 76 — TEAM-WORK-REVIEW ⭐ قاعدة ثابتة**: قبل أي مهمة، git pull + قراءة آخر worklog + مراجعة commits الفريق. تحديث "آخر تحديث" 2026-10-06→2026-10-08 + عدّادات 66→76 + 1-70→1-76. لم تُحذف أي قاعدة — إضافة + تحديث عدّادات فقط. موافقة المالك الصريحة. |
| 2026-10-07 | UNIFIED-DATA-CONTRACT | **إضافة القاعدة 72 — UNIFIED-DATA-CONTRACT** (عقد التوحيد للمصدر الموحد للبيانات — 16 canonical metric). تكملة Rule 20 + 27 + 67(b). الـ Canonical Sources: signal/accumulation/money_flow/phase/volume_ratio من `canonical_signal.py` (TS port مطابق Python 100%) + ATR/RSI/SMA/EMA/MACD/VWAP/OBV من `analyzers/indicators/` (Rule 67(b)) + master_score/target/stop من `predictions.db` raw passthrough (NO fabrication) + buy_pct/sell_pct من `shared_liquidity.py` + price من `stocks.db.stocks.current_price` + FRESHNESS GUARD. المرجع التنفيذي: `download/UNIFIED_DATA_CONTRACT.md`. لم تُحذف أي قاعدة — إضافة جديدة. |
| 2026-10-06 | RULES-68-69-70-71 | **إضافة 4 قواعد جديدة:** Rule 68(a) — AGENT-QUALITY-GATE (بوابة جودة الوكلاء: import verification + file existence + browser-interactive + no false claims + verification script إلزامي) + Rule 68(b) — COMMUNICATION-EXECUTION-DISCIPLINE (10 قواعد صارمة للتعامل بين المالك والوكيل: لا ملفات جديدة/تعديل/commit/push/subagents بدون إذن) + Rule 69 — SUBAGENT-TEAM-ACTIVATION (التيم المعتمد: 11 subagent + قواعد الاستخدام) + Rule 70 — DOCUMENTATION-SECRETARY (السكرتيرة: تحديث تلقائي للتوثيق بعد كل مهمة) + Rule 71 — AUTONOMOUS-IMPROVEMENT-WITH-BACKTEST (التحسين الذاتي الموجه بالباك-تست: BASELINE → modification → after → comparison → keep/revert). لم تُحذف أي قاعدة — إضافات جديدة. |
| 2026-10-05 | CALCULATION-CANONICAL | **إضافة القاعدة 67(b) — CALCULATION-CANONICAL** (توحيد الحسابات الفنية). تقرير `ENGINEERING_AUDIT_REPORT.md` كشف إن 10/10 فئات حسابية (ATR/RSI/Position Sizing/R:R/Stops/WR-PF/master_score/VWAP-Volume/SMA-EMA-MACD/Sector-Regime) مفيش عندها canonical — كل واحدة ليها 3-20+ نسخة مختلفة. المرجع التنفيذي: `EMERGENCY_REMEDIATION_PLAN.md` (Phase 1). 14 Canonical Declaration (ATR=atr.py::calc_atr Wilder's + RSI=rsi.py::calc_rsi Wilder's + SMA/EMA/MACD=ma.py + Position Sizing=position_sizing.py risk-based + R:R=risk_reward.py + Stop/Target=opportunity_quality.py::enforce_atr_based_stop + WR/PF=backtest_stats.py + master_score=master_analyzer.py 10-component + VWAP/OBV/Volume Ratio=technical_analyzer.py + Sector Heat=opportunity_quality.py + Market Regime=technical_analyzer.py::detect_regime). لم تُحذف أي قاعدة — إضافة جديدة. |

---

*هذا الدستور ملزم. أي تغيير فيه لازم بموافقة المالك (`enmohsen20111975`) وتوثيقه في `CHANGELOG.md`.*
*آخر تحديث: 2026-10-12 (DOC-UNIFY-1-CONSTITUTION — توحيد التوثيقات في 5 ملفات).*
*إجمالي القواعد المطلقة: **76** (1-32 + 42 + 33-41 + 43-76، مع 67(a)/67(b) و 68(a)/68(b)).*

