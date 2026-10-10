# 📚 توثيق المشروع — Project Documentation Index

> **آخر تحديث:** 2026-10-05 (Task A + B + C — Technical Explanation Generator + Resource Monitoring System — إضافة **§19 + §20 جديد** في `SYSTEM_HOW_IT_THINKS.md`. **§19 Technical Explanation Generator:** `vps-service/analyzers/technical_explainer.py` (471 سطر) بيجمع الـ candlestick + SMC + Volume Profile + Chart Patterns + Proofs في شرح عربي واحد. التخزين في `stored_analyses.ai_reason` + `ai_narrative` + `analysis_json`. العرض في `PredictionsImageCard.tsx` (قسم "📝 التحليل الفني" قابل للطي) + رسائل التليجرام (auto_poster.py). **§20 Resource Monitoring System:** `src/lib/metrics-db.ts` + `metrics-collector.ts` + 3 APIs جديدة + 3 components. Collector كل 15 ثانية (instrumentation.ts). Tiered retention (raw 24h → 5min 7d → hourly 30d). Anomaly detection (threshold + spike + trend + memory_leak + recovered). UI: ResourceHistoryChart (AreaChart مع time range) + ResourceAlerts (health score + alerts list) + ProcessResourceHistory (per-process dialog). الملفات المعدّلة: 8 modified + 11 new. Canonical count: **6 ملفات canonical** (unchanged — تحديث داخل `SYSTEM_HOW_IT_THINKS.md` فقط). Per Rule 62 + Rule 63 + README editing rule 1.)
>
> **تحديث سابق 2026-10-03 (Sharia Pipeline AS-BUILT — بعد **التنفيذ الفعلي** لـ `sharia_compliance_scraper.py` + الحاسبة + الإصلاحين. **4 ملفات canonical اتحدّثت** — مفيش ملف جديد (Rule 4).) التحديثات: **`00-CONSTITUTION.md`** القاعدة 64 اتكتبت من جديد كـ as-built (الجدول السادس `sharia_symbol_map` · **collision guard إلزامي** — درس `VLMR`/`VLMRA` من تصحيح المالك، وطلع نفس الفخ في المصدر `KORA`↔`KORRA` + `EFG`↔`HRHO` · 4 masters للربط مش `stocks.db` لوحده · خسارة غير محققة ما بتخصمش من الوعاء · IDOR ممنوع على portfolio scope) + **§65.1 جديد** لتلف الـ `symbol` في `tab_*` (3664 صف · 8 جداول). **`03-API_REFERENCE.md`** §25 اتكتبت بالـ contract الحقيقي (`?consensus=true` مش `?consensus_only` · `method='S&P'` · `include_capital_gain` · `user_id` مش `portfolio:true` · **§25.1 قواعد الحساب** · **§25.2 alias map** · **IDOR gate** · **compat shim** مع `ShariaView.tsx`). **`01-PROJECT_ANATOMY.md`** قسم **AS-BUILT** قبل الـ Templatesnippet appendix (المبني فعلاً + 4 فروق عن الخطة). **`05-CURRENT_STATE.md`** **§17.10** (الـ pipeline + التغطية الفعلية 253/2024/572/182/49 · alias review queue · الـ tab_* data fix · جدول التطهير الحقيقي على المحفظتين · 7 مشاكل اتصلحت · الـ NOT DONE بقرارات المالك). **الأرقام:** metrics=**253** · source_status=**2024** · S&P rates=**182** · إجماع ≥6/8 = **49** سهم · 250/253 مربوطين · 3 unresolved. **7 إصلاحات** شاملة IDOR + تطهير سالب + market-blind resolver + اسم عربي + schema migration + 2 أخطاء TS pre-existing + عقد frontend mismatch. `tsc` نضيف على كل مسارات الـ sharia. Per Rule 62 + Rule 63 + README editing rule 1.)
>
> **تحديث سابق 2026-10-04 (Task `28-C` — Documentation Secretariat (Wave 8 Update):** تحديث counts في الفهرس بناءً على Wave 8: API routes **380 → 411** (Wave 8 Task `774a208` restored 32 Flutter API endpoints that were archived by mistake in Wave 2 — see `05-CURRENT_STATE.md` §17.2) · components **247 → 250** (+3 Sharia components — `ShariaView.tsx` + `ShariaBadge.tsx` + `ShariaStockCard.tsx` — Task 23-C — commits `324a095` + `704aa0c`) · hash views **45 → 46** (added `#sharia`) · admin tabs **16+ → 20+** (4 NEW Wave 8 tabs: Sharia management ✅ `f413bd7` + Source Authority ⏳ + Validation Monitor ⏳ + Cron Health ⏳ — see `02-SCREENS_AND_COMPONENTS.md` §0.7.C) · Constitution rules **66** (unchanged — Rules 64 + 65 + 66 added in Task 23-A — already reflected). تحديث روابط الـ canonical الأربعة بآخر تحديثات كل ملف. Per Rule 62 (Secretary updates docs) + Rule 63 (commit + push after each file — 6 pushes total — one per canonical doc) + README editing rule 1.)
>
> **تحديث سابق 2026-10-04 (Task `25` — Documentation Secretariat + Tech Support (Consolidate to 6 files max):** تنفيذ توجيه المالك الصريح: «دخل السكرتيرات + فريق الدعم الفنى يحدثو Documentation وكل ملفات التوثيق فى 6 ملفات بس بحد اقصى». **13 ملف توثيقي إضافي دُمجت في الـ 6 canonical files** + كل source file اتـ `git rm`'d (git history preserved): DISCIPLINE.md → 00-CONSTITUTION.md (appendix) · DATA-ENGINE-ARCHITECTURE.md + DB-RESILIENCE-STRATEGY.md + PROD-DATA-FIX-RUNBOOK.md + TICKER-SYMBOL-UNIFICATION-PLAN.md + TEMPLATESNIPPET-INTEGRATION-PLAN.md → 01-PROJECT_ANATOMY.md (5 appendices) · RETRACTION-backtest-v4.md + RETRACTION-console-error-claim.md + WAVE-2-3-CHANGELOG-2026-10-01.md + WAVE-6-PAYMENT-FIXES-2026-10-02.md + WAVE-7-DATA-CHART-FIXES-2026-10-03.md + MARKETING-OFFERS-STRATEGY.md + PAYWALL-STRATEGY-FINAL.md → 05-CURRENT_STATE.md (7 appendices). **13 commits + 13 pushes** (one per merge — Rule 63 compliant). NO info lost — every source file's content preserved verbatim as appendix under `## 📎 MERGED APPENDIX — <title>` header. Final doc count: **8 ملفات markdown** (6 canonical + BREACH-LOG + README) — within target ≤ 8. Per Rule 4 (NO new files) + Rule 25 (refactoring-gated — git rm preserves history) + Rule 62 (Secretary updates docs) + Rule 63 (commit + push after each) + README editing rule 1.)
>
> **تحديث سابق 2026-10-03 (Task `23-A`):** Documentation Secretariat (Constitution Update — Rules 64-66) — بعد توجيه المالك «أنا شايف انك في حاجات كتير لازم تتحدث في الدستور». إضافة 3 قواعد جديدة إلى `00-CONSTITUTION.md`: **Rule 64 — SHARIA-COMPLIANCE** (التوافق الشرعي + التطهير — `sharia_compliance_scraper.py` + 6 جداول في `data_engine.db` + `purification_calculator.py` Python=Brain + معيار S&P الأساسي + Musaffa/Kashif/Osoul تكميلية + AAOIFI مستبعدة + consensus_min=6) + **Rule 65 — DATA-VALIDATION-LAYER** (`validation.py::validate_stock_data()` + INVALID fields بتتصفّر + لو `current_price` INVALID → HOLD score=0 + Cross-stock contamination ratio>10x → INVALID + Stale 52W + OHLC integrity) + **Rule 66 — SOURCE-AUTHORITY** (`source_authority.py::write_guarded()` الإلزامي + CANONICAL_SOURCES لكل سوق + BANNED_SOURCES). توسيع Rule 12 بـ 3 نقاط مرجعية. تحديث فهرس القواعد 63 → 66. تحديث عهد الوكيل 30 → 33 بند.
>
> **تحديثات سابقة أخرى:**
> - 2026-10-03 (Task `DOC-20` — Documentation Secretariat (Wave 7 — Data + Chart docs) — إضافة رابط `WAVE-7-DATA-CHART-FIXES-2026-10-03.md` (consolidated changelog لكل إصلاحات Wave 7 Data Quality + Chart Quality). تحديث 'آخر تحديث' row لـ `05-CURRENT_STATE.md` لـ 2026-10-03 (§8.8 + §10.1 row 22 + §16 Wave 7). تحديث BREACH-LOG.md reference لـ 9 breaches. Canonical count: **6 ملفات canonical** (unchanged — Wave 7 file is a changelog reference, not a new canonical file). Per Rule 62 + Rule 63 + README editing rule 1.)
> - 2026-10-02 (Task `DOC-17` — Documentation Secretariat (Final P0 Documentation) — إضافة رابط `WAVE-6-PAYMENT-FIXES-2026-10-02.md` (consolidated changelog لكل إصلاحات Wave 6 Payment System P0). Canonical count: **6 ملفات canonical** (unchanged). Per Rule 62 + Rule 63 + README editing rule 1.)
> - 2026-10-01 (Task `WAVE-2-3-DOCS` — Documentation Secretariat catching up on backlog — تحديث canonical counts: components 294→**247** verified + routes 690→**380** + Python files 506→**450**.)
> - 2026-10-01 (Task `DOC-SYNC-FULL` — Documentation Secretary — توثيق شامل لكل الـ commits والملفات).
> - 2026-10-01 (Task `DOC-UPDATE-POST-AUDIT` — إضافة قسم 12 في 05-CURRENT_STATE).
> - 2026-09-30 (Task `API-DOC` + `DOC-CONSOLIDATION`).
>
> هذا الملف هو **نقطة الدخول الموحَّدة** لكل توثيق المشروع. بعد مهمة
> `DOC-CONSOLIDATION` + `API-DOC` + `DOC-SYNC-FULL` + `WAVE-2-3-DOCS` (2026-10-01)
> + Task `25` (Consolidate to 6 canonical — 2026-10-04)، الـ Documentation
> يحتوي على **6 ملفات canonical فقط** + `BREACH-LOG.md` (operational log) +
> هذا الفهرس = **8 ملفات markdown total** (within owner-mandated ceiling).

---

## 🏛️ الملفات الـ 6 الأساسية (Canonical Documentation)

> ديه الـ 6 ملفات اللي كل مطور جديد لازم يقرأها قبل ما يلمس الكود.
> كلها محدّثة (latest: 2026-10-04 Task 28-C — Wave 8 Update consolidated into these 6).

| # | الملف | الوصف |
|---|------|------|
| 00 | [00-CONSTITUTION.md](./00-CONSTITUTION.md) | **الدستور** — القواعد الذهبية (**66 قاعدة**) + المعمارية الأساسية + الـ governance + Rules 55–59 (P0-WAVE) + Rule 60 (MODULE-SYSTEM) + Rule 61 (RELATIVE-PATHS-ONLY) + Rule 62 (GIT-PUSH-DISCIPLINE) + Rule 63 (PUSH-AFTER-EVERY-COMMIT) + **Rule 64 (SHARIA-COMPLIANCE — as-built 2026-10-03: 6 جداول · collision guard · 4 masters · خسارة ما بتخصمش · IDOR ممنوع)** + Rule 65 (DATA-VALIDATION-LAYER · **§65.1 تلف الـ `symbol`**) + Rule 66 (SOURCE-AUTHORITY) + **📎 MERGED APPENDIX: Engineering Discipline Charter (was `DISCIPLINE.md`)** |
| 01 | [01-PROJECT_ANATOMY.md](./01-PROJECT_ANATOMY.md) | **تشريح المشروع** — كل المكونات + الـ data flow + الـ DBs + §1.7 P0 Wave + §1.8 — Module System (Phase 1-7 Reorganization) + **§1.9 — Flutter App Architecture (NEW Wave 8 — submodule at `/home/z/my-project/flutter_app/` — 113 .dart files, 4,374 LOC `client.dart`, ~181 endpoint methods, version 3.0.1+44)** + **📎 5 MERGED APPENDICES: (1) Data Engine Architecture (was `DATA-ENGINE-ARCHITECTURE.md`) + (2) DB Resilience Strategy (was `DB-RESILIENCE-STRATEGY.md`) + (3) Production Data Engine Fix Runbook (was `PROD-DATA-FIX-RUNBOOK.md`) + (4) Ticker/Symbol Unification Plan (was `TICKER-SYMBOL-UNIFICATION-PLAN.md`) + (5) Templatesnippet Sharia Integration Plan (was `TEMPLATESNIPPET-INTEGRATION-PLAN.md`)** |
| 02 | [02-SCREENS_AND_COMPONENTS.md](./02-SCREENS_AND_COMPONENTS.md) | **الشاشات + المكونات** — every component mapped + state + API + §0.3 P0 Wave + §0.4 — Module Mapping (hash view → module) + **§0.7 — Sharia Module + Wave 8 Visual Redesign + Admin Tabs (NEW Wave 8 — `ShariaView` + `ShariaBadge` + `ShariaStockCard` + 6 emerald-theme commits + 4 NEW admin tabs — Sharia management ✅ `f413bd7` + Source Authority ⏳ + Validation Monitor ⏳ + Cron Health ⏳)** |
| 03 | [03-API_REFERENCE.md](./03-API_REFERENCE.md) | **مرجع الـ APIs الشامل** — كل **411 route** عبر 26 قسم (updated 2026-10-04 — Wave 8 restored 32 Flutter API endpoints; was 380 in Wave 2/3). كل route موثّق بالـ HTTP method + path + وصف + الـ auth المطلوب. + **§25 Sharia Compliance APIs (NEW Wave 8 — `/api/sharia` GET + `/api/sharia/purification` POST)** + **§26 Source Authority Admin APIs (NEW Wave 8 — `/api/admin/sources` GET — ⏳ PENDING — Task 27-B P0 #2)** |
| 04 | [SYSTEM_HOW_IT_THINKS.md](./SYSTEM_HOW_IT_THINKS.md) | **كيف يفكر النظام** — pipeline + algorithms + §15 رادار السيولة (6 ميزات) + §16 HELI Forensics + §17 Observability + §18 Module Architecture + §18.9 Wave 2/3 deltas + §18.10 i18n Phase 1 Migration + **§1.1 pipeline diagram UPDATED Wave 8 (added STAGE 1.5 SOURCE AUTHORITY GUARD + STAGE 1.6 DATA VALIDATION LAYER per Rule 65 + Rule 66)** + **§14.8 Context-Aware Filters NEW (Task 47 — 2026-10-04 — 5 فلاتر: Entry Zone + Stock Phase + RSI Zone + POC Distance + Accumulation Ratio — WR 66% → 68.3%)** + **§19 Technical Explanation Generator NEW (Task A — 2026-10-05 — `technical_explainer.py` بيجمع candlestick + SMC + Volume Profile + Chart Patterns + Proofs في شرح عربي — عرض في `PredictionsImageCard.tsx` + رسائل التليجرام)** + **§20 Resource Monitoring System NEW (Task B+C — 2026-10-05 — collector كل 15s + tiered retention 24h/7d/30d + anomaly detection + 3 APIs + 3 UI components: ResourceHistoryChart + ResourceAlerts + ProcessResourceHistory)** |
| 05 | [05-CURRENT_STATE.md](./05-CURRENT_STATE.md) | **الحالة الحالية للكود** — comprehensive state snapshot (Module Architecture + API Map + Database Schema + Radar System + Prediction System + Telegram Bot + Flutter App + Security & Quality + Deployment + Audit Checklist + §13 Wave 2 + §14 Wave 3 + §15 Wave 6 Payment + §16 Wave 7 Data + Chart + **§17 Wave 8 — Pipeline Coherence + Flutter + Admin + QA + Backtest Comprehensive + Visual Redesign (NEW 2026-10-04 — 243 routes mapped + source_authority wired + 32 Flutter endpoints restored + PF=4.74 backtest + emerald theme + 10 Flutter P0 + 10 Admin P0 + concurrent work by other programmers)**) + **📎 7 MERGED APPENDICES: (1) RETRACTION-backtest-v4 + (2) RETRACTION-console-error-claim + (3) WAVE-2-3-CHANGELOG-2026-10-01 + (4) WAVE-6-PAYMENT-FIXES-2026-10-02 + (5) WAVE-7-DATA-CHART-FIXES-2026-10-03 + (6) MARKETING-OFFERS-STRATEGY + (7) PAYWALL-STRATEGY-FINAL**. كل محتوى source files محفوظ verbatim كـ appendices. |

---

## 📈 بيانات السوق (Market Index Data)

- [المؤشرات/](./المؤشرات/) — بيانات مؤشرات EGX (4 ملفات CSV: EGX 30 + EGX 70 + historical)

> ⚠️ **DO NOT TOUCH** — هذه الملفات بيانات خام تُحدَّث بالـ cron.

---

## 🎓 المحتوى التعليمي (Education)

تم نقل الـ 9 ملفات التعليمية من `Documentation/education/` إلى
`content/education/` (خارج مجلد التوثيق — content ليس docs).

---

## 🔗 روابط سريعة

> **كل الملفات الإضافية (PAYWALL-STRATEGY-FINAL + MARKETING-OFFERS-STRATEGY + DB-RESILIENCE-STRATEGY + DISCIPLINE + RETRACTION-* + WAVE-*-CHANGELOG + DATA-ENGINE-ARCHITECTURE + PROD-DATA-FIX-RUNBOOK + TICKER-SYMBOL-UNIFICATION-PLAN + TEMPLATESNIPPET-INTEGRATION-PLAN) تم دمجها كـ appendices داخل الـ 6 canonical files (Task 25 — 2026-10-04). الـ source files اتـ `git rm`'d (git history preserved). أي محتوى منهم موجود verbatim تحت `## 📎 MERGED APPENDIX — <title>` في الملف الـ canonical المُحدد.**

- **آخر تحديث للدستور:** راجع أعلى [`00-CONSTITUTION.md`](./00-CONSTITUTION.md) — *2026-10-04 (Task 25): merge DISCIPLINE.md as appendix · 2026-10-03 (Task 23-A): إضافة القواعد 64 + 65 + 66 + توسيع Rule 12 + تحديث الفهرس 63 → 66 + عهد الوكيل 30 → 33 بند*
- **آخر تحديث للتشريح:** راجع أعلى [`01-PROJECT_ANATOMY.md`](./01-PROJECT_ANATOMY.md) — *2026-10-04 (Task 28-C — Wave 8): API routes 380→411 (32 restored Flutter endpoints) + إضافة `source_authority.py` + `validation.py` + `sharia_compliance_scraper.py` + `purification_calculator.py` to §4.1 + إضافة `ticker_registry` table to `stocks.db` §3.1 + إضافة 5 Sharia tables to `data_engine.db` §3.1 + إضافة §1.9 Flutter App Architecture · 2026-10-04 (Task 25): merge 5 appendices · 2026-10-01 (WAVE-2-3-DOCS): Wave 2 backend cleanup*
- **آخر تحديث للشاشات:** راجع أعلى [`02-SCREENS_AND_COMPONENTS.md`](./02-SCREENS_AND_COMPONENTS.md) — *2026-10-04 (Task 28-C — Wave 8): إضافة §0.7 Sharia Module + Visual Redesign + Admin Tabs (3 NEW Sharia components + 6 emerald-theme commits + 4 NEW admin tabs — Sharia ✅ `f413bd7` + Source Authority ⏳ + Validation Monitor ⏳ + Cron Health ⏳) + components 247→250 + hash views 45→46 + admin tabs 16+→20+ · 2026-10-01 (WAVE-2-3-DOCS): Wave 2 cleanup + Wave 3 unification + i18n Phase 1*
- **آخر تحديث لمرجع الـ APIs:** راجع [`03-API_REFERENCE.md`](./03-API_REFERENCE.md) — *2026-10-04 (Task 28-C — Wave 8): 380→411 route (32 restored Flutter endpoints) + إضافة §25 Sharia Compliance APIs (`/api/sharia` GET + `/api/sharia/purification` POST) + إضافة §26 Source Authority Admin APIs (`/api/admin/sources` — ⏳ PENDING) · 2026-10-01 (WAVE-2-3-DOCS): 690→380 route + 5 admin routes auth-hardened + §24 Reports kept*
- **آخر تحديث لطريقة التفكير:** راجع أعلى [`SYSTEM_HOW_IT_THINKS.md`](./SYSTEM_HOW_IT_THINKS.md) — *2026-10-05 (Task A + B + C): إضافة **§19 جديد** (Technical Explanation Generator — `technical_explainer.py` بيجمع candlestick + SMC + Volume Profile + Chart Patterns + Proofs — تخزين في `ai_reason` + `ai_narrative` — عرض في `PredictionsImageCard.tsx` + رسائل التليجرام) + **§20 جديد** (Resource Monitoring System — collector كل 15s + tiered retention 24h/7d/30d + anomaly detection + 3 APIs + 3 UI components: ResourceHistoryChart + ResourceAlerts + ProcessResourceHistory) · 2026-10-04 (Task 47 — Context-Aware Filters): §14.8 · 2026-10-04 (Task 28-C — Wave 8): §1.1 pipeline diagram · 2026-10-01 (WAVE-2-3-DOCS): §18.9 Wave 2/3 deltas + §18.10 i18n Phase 1 Migration*
- **الحالة الحالية للكود:** راجع [`05-CURRENT_STATE.md`](./05-CURRENT_STATE.md) — *2026-10-04 (Task 28-C — Wave 8): §17 NEW (Wave 8 — Pipeline Coherence + Flutter + Admin + QA + Backtest Comprehensive + Visual Redesign — 243 routes mapped + source_authority wired + 32 Flutter endpoints restored + PF=4.74 backtest + emerald theme + 10 Flutter P0 + 10 Admin P0 + concurrent work by other programmers) · 2026-10-04 (Task 25): merge 7 appendices · 2026-10-03 (DOC-20): §8.8 + §16 Wave 7 Summary · 2026-10-02 (DOC-17): §8.7 + §15 Wave 6 Summary*
- **الـ worklog الكامل:** [`/worklog.md`](../worklog.md) (في root) — *آخر task: 28-C (Wave 8 — Documentation Secretariat update all 6 canonical docs)*
- **سجل الخروقات:** [`BREACH-LOG.md`](./BREACH-LOG.md) — *9 breaches documented: BREACH-001 + BREACH-002 (2026-10-01) + BREACH-003..006 (2026-10-02 — Wave 6 payment P0 breaches, all closed) + BREACH-007..009 (2026-10-03 — Wave 7 data + chart breaches, all closed).*
- **المراجع المُدمجة (merged INTO canonical — لا توجد كملفات منفصلة بعد Task 25):**
  - **DISCIPLINE.md** → `00-CONSTITUTION.md` 📎 MERGED APPENDIX
  - **DATA-ENGINE-ARCHITECTURE.md** → `01-PROJECT_ANATOMY.md` 📎 MERGED APPENDIX
  - **DB-RESILIENCE-STRATEGY.md** → `01-PROJECT_ANATOMY.md` 📎 MERGED APPENDIX
  - **PROD-DATA-FIX-RUNBOOK.md** → `01-PROJECT_ANATOMY.md` 📎 MERGED APPENDIX
  - **TICKER-SYMBOL-UNIFICATION-PLAN.md** → `01-PROJECT_ANATOMY.md` 📎 MERGED APPENDIX
  - **TEMPLATESNIPPET-INTEGRATION-PLAN.md** → `01-PROJECT_ANATOMY.md` 📎 MERGED APPENDIX
  - **RETRACTION-backtest-v4.md** → `05-CURRENT_STATE.md` 📎 MERGED APPENDIX
  - **RETRACTION-console-error-claim.md** → `05-CURRENT_STATE.md` 📎 MERGED APPENDIX
  - **WAVE-2-3-CHANGELOG-2026-10-01.md** → `05-CURRENT_STATE.md` 📎 MERGED APPENDIX
  - **WAVE-6-PAYMENT-FIXES-2026-10-02.md** → `05-CURRENT_STATE.md` 📎 MERGED APPENDIX
  - **WAVE-7-DATA-CHART-FIXES-2026-10-03.md** → `05-CURRENT_STATE.md` 📎 MERGED APPENDIX
  - **MARKETING-OFFERS-STRATEGY.md** → `05-CURRENT_STATE.md` 📎 MERGED APPENDIX
  - **PAYWALL-STRATEGY-FINAL.md** → `05-CURRENT_STATE.md` 📎 MERGED APPENDIX

---

## 🗂️ خريطة هيكل المجلد (Folder Structure — POST Task 25 Consolidation)

```
Documentation/
├── 00-CONSTITUTION.md                          ← canonical #1 (66 rules + 📎 MERGED APPENDIX: DISCIPLINE.md)
├── 01-PROJECT_ANATOMY.md                       ← canonical #2 (§1.8 Module System + 📎 5 MERGED APPENDICES: DATA-ENGINE-ARCHITECTURE + DB-RESILIENCE-STRATEGY + PROD-DATA-FIX-RUNBOOK + TICKER-SYMBOL-UNIFICATION-PLAN + TEMPLATESNIPPET-INTEGRATION-PLAN)
├── 02-SCREENS_AND_COMPONENTS.md                ← canonical #3 (§0.4 Module Mapping)
├── 03-API_REFERENCE.md                         ← canonical #4 (380 routes across 24 sections)
├── SYSTEM_HOW_IT_THINKS.md                     ← canonical #5 (§18 Module Architecture + §15 Radar + §16 HELI + §17 Observability)
├── 05-CURRENT_STATE.md                         ← canonical #6 (comprehensive state + 📎 7 MERGED APPENDICES: RETRACTION-backtest-v4 + RETRACTION-console-error-claim + WAVE-2-3-CHANGELOG + WAVE-6-PAYMENT-FIXES + WAVE-7-DATA-CHART-FIXES + MARKETING-OFFERS-STRATEGY + PAYWALL-STRATEGY-FINAL)
├── BREACH-LOG.md                               ← operational log (NOT a doc — exception to the 6-file ceiling)
├── README.md                                   ← هذا الملف (الفهرس — also exception)
│
└── المؤشرات/                                    ← بيانات EGX (CSV — لا تُمسس)
```

> **Final doc count: 8 markdown files** (6 canonical + BREACH-LOG + README) — within owner-mandated ceiling of 6 docs + exceptions.
>
> **13 files merged INTO canonical files (Task 25 — 2026-10-04):** DISCIPLINE.md + DATA-ENGINE-ARCHITECTURE.md + DB-RESILIENCE-STRATEGY.md + PROD-DATA-FIX-RUNBOOK.md + TICKER-SYMBOL-UNIFICATION-PLAN.md + TEMPLATESNIPPET-INTEGRATION-PLAN.md + RETRACTION-backtest-v4.md + RETRACTION-console-error-claim.md + WAVE-2-3-CHANGELOG-2026-10-01.md + WAVE-6-PAYMENT-FIXES-2026-10-02.md + WAVE-7-DATA-CHART-FIXES-2026-10-03.md + MARKETING-OFFERS-STRATEGY.md + PAYWALL-STRATEGY-FINAL.md. Every source file's content preserved verbatim as a `## 📎 MERGED APPENDIX — <title>` section in the target canonical file.
>
> **Note:** `AUDIT-2026-10-01-HONEST-REVIEW.md` and `BOARD-OF-DIRECTORS-PLAN-2026-10-01.md` were mentioned in the task list but were NOT present in the directory (already removed in a prior task).
>
> **All other directories removed (2026-09-30):**
> - `audit-logs/` (6 files → merged into `05-CURRENT_STATE.md` §10)
> - `backtest-results/` (~30 files → merged into `05-CURRENT_STATE.md` §5 + §10)
> - `deployment/` (4 files → merged into `05-CURRENT_STATE.md` §9)
> - `reports/` (9 files → merged into `05-CURRENT_STATE.md` §6 + §7 + §8 + §10)
> - `education/` (9 files → moved to `content/education/`)
> - `MODULE_CATALOG.md` + `ARCHITECTURE_DIAGRAM.md` (merged into `05-CURRENT_STATE.md` §1)
> - `agent-ctx/` (84 files — internal work reports, NOT user docs)

---

## 📝 قواعد التعديل (Editing Rules)

1. **أي تعديل في الـ cornerstone files** لازم يُحدِّث فيه الـ "آخر تحديث" + سجل التغييرات في الملف نفسه.
2. **أي ميزة جديدة** لازم تتوثّق في `SYSTEM_HOW_IT_THINKS.md` كقسم جديد (§<next-number>) أولاً، بعدها تُضاف للشاشات في `02-SCREENS_AND_COMPONENTS.md`.
3. **أي تغيير في القواعد الذهبية** لازم يُضاف كرقم جديد في `00-CONSTITUTION.md`.
4. **أي تغيير في الـ state (modules / APIs / DBs / routes)** لازم يُعكَس في `05-CURRENT_STATE.md`.
5. **لا تُنشئ ملف توثيقي جديد** — استخدم الـ 5 ملفات الموجودة فقط. Rule 4: NO new files.
6. **لا تستخدم `mv` في moving الملفات المتتبَّعة في git** — استخدم `git mv` للحفاظ على الـ history.
7. **لا تُنشئ ملف توثيقي جديد في الـ root** — كل توثيق جديد يُضاف داخل `Documentation/`.

---

## 🆕 تحديث 2026-09-30 (Task `DOC-CONSOLIDATION`)

> **توحيد نهائي لكل ملفات التوثيق في المشروع — 134 ملف (7.9MB) → 5 ملفات canonical فقط.**
>
> - **ملف جديد واحد (NEW):** `05-CURRENT_STATE.md` (1,020 LOC) — comprehensive state snapshot يحلّ محل كل الـ audit-logs + backtest-results + deployment + reports + MODULE_CATALOG + ARCHITECTURE_DIAGRAM + agent-ctx (84 ملف) + root-level docs. يحتوي على 10 أقسام: Module Architecture + API Map (675 routes) + Database Schema (6 active DBs) + Radar System (6 features + 5-stage alerts + 5 exit paths + 7 markets) + Prediction System (V40.2 + Regime Engine + 5-state taxonomy) + Telegram Bot + Flutter App (46 screens + 175 APIs + 13 new methods + 3 new screens) + Security & Quality (P0 wave) + Deployment (7 PM2 + 23 cron + 7 markets) + Audit Checklist (18 ✅ + 12 ⏳).
> - **الـ 4 cornerstone docs:** تحديث metadata فقط (last-updated date + DOC-CONSOLIDATION note) — لم تُحذف أي محتويات.
> - **الـ 9 education files:** moved من `Documentation/education/` لـ `content/education/` (خارج الـ Documentation folder — content وليس docs).
> - **الحذف الكامل (via `git rm`):**
>   - `Documentation/audit-logs/` (6 files)
>   - `Documentation/backtest-results/` (~30 files في 4 subfolders)
>   - `Documentation/deployment/` (4 files)
>   - `Documentation/reports/` (9 files)
>   - `Documentation/MODULE_CATALOG.md` + `Documentation/ARCHITECTURE_DIAGRAM.md`
>   - `agent-ctx/` (84 files — internal work reports، NOT user docs)
>   - root-level docs (لو موجودة)
> - **النتيجة النهائية:**
>   - قبل: 134 ملف توثيقي (5.5MB Documentation + 2.4MB agent-ctx = 7.9MB)
>   - بعد: 5 ملفات canonical + 1 README + `المؤشرات/` (4 CSV) = **6 ملفات markdown فقط**.
>   - LOC قبل: 71,463 (54,929 Documentation + 16,534 agent-ctx)
>   - LOC بعد: ~16,085 (cornerstones unchanged + 1,020 NEW 05-CURRENT_STATE + ~270 README) — **تخفيض 77%**
>   - `bun run lint` exit 0 ✅
>   - Rule 4 (No new files): ✅ ONLY 1 new doc file (`05-CURRENT_STATE.md`) — replaces all others.
>   - Rule 25 (refactoring-gated): ✅ All deletions via `git rm` (history preserved).
>   - Rule 39 (DOCS-FIRST-LAST): ✅ Docs updated FIRST (no code changes).
>   - Rule 61 (RELATIVE-PATHS-ONLY): ✅ The new file uses relative paths only.

---

*تم الإنشاء بواسطة Documentation Secretary + Programmer — Task ID `DOC-REORG-2` — 2026-09-27*
*تم التحديث بواسطة Documentation Secretary — Task ID `DOC-UPDATE-P0-WAVE` — 2026-09-27*
*تم التحديث بواسطة Documentation Secretary — Task ID `REORG-PHASE-7-DOCS` — 2026-09-30*
*تم التحديث بواسطة Documentation Secretary + Senior Engineers — Task ID `DOC-CONSOLIDATION` — 2026-09-30*
*تم التحديث بواسطة Documentation Secretary — Task ID `API-DOC` — 2026-09-30 (إضافة 03-API_REFERENCE.md — 679 route عبر 23 قسم)*
*تم التحديث بواسطة Documentation Secretary — Task ID `DOC-UPDATE-POST-AUDIT` — 2026-10-01 (إضافة قسم 12: التدقيق الشامل + 30 إصلاح + 23 نقطة تحقق)*
*تم التحديث بواسطة Documentation Secretary — Task ID `DOC-SYNC-FULL` — 2026-10-01 (إضافة 12.13 ⌀ button + 12.14 StockDetailDrawer + 12.15 MarketingStudio merged + تحديث counts: 17 modules, 292 components, 687 routes)*
*تم التحديث بواسطة Documentation Secretary + Constitution Keeper — Task ID `FIX-WAVE-4-DOCS` — 2026-10-01 (تحديث counts: 17 modules, 294 components, 380 routes, 117 admin routes + تحديث DB table counts + مواءمة Rule 8/18 مع engine_settings.py + إزالة مراجع MODULE_CATALOG.md/ARCHITECTURE_DIAGRAM.md النشطة + إضافة BACKLOG.md + إضافة §24 Reports APIs إلى 03-API_REFERENCE.md + تحديث 62 قاعدة)*
*تم التحديث بواسطة Documentation Secretariat — Task ID `WAVE-2-3-DOCS` — 2026-10-01 (catching up on backlog — تحديث canonical counts في الفهرس: 294→**247** components + 690→**380** routes + Python 506→**450** + إضافة رابط لـ `WAVE-2-3-CHANGELOG-2026-10-01.md` + تحديث روابط الـ canonical الأربعة بآخر تحديثات كل ملف + إضافة WAVE-2-3-CHANGELOG file path. Per Rule 62 (Secretary updates docs after every task) + README editing rule 1.)*
*تم التحديث بواسطة Documentation Secretariat — Task ID `DOC-17` — 2026-10-02 (Final P0 Documentation — إضافة رابط `WAVE-6-PAYMENT-FIXES-2026-10-02.md` + إضافة روابط BREACH-LOG + PAYWALL-STRATEGY-FINAL + MARKETING-OFFERS-STRATEGY + DB-RESILIENCE-STRATEGY + تحديث Folder Structure tree + تحديث 'آخر تحديث' row لـ `05-CURRENT_STATE.md` + تحديث 'آخر task' في الـ worklog reference. Canonical count: 6 (unchanged — Wave 6 file is a changelog reference, not a new canonical file). Per Rule 62 + Rule 63 + README editing rule 1.)*
*تم التحديث بواسطة Documentation Secretariat — Task ID `DOC-20` — 2026-10-03 (Wave 7 — Data + Chart docs — إضافة رابط `WAVE-7-DATA-CHART-FIXES-2026-10-03.md` + تحديث 'آخر تحديث' row لـ `05-CURRENT_STATE.md` لـ 2026-10-03 (§8.8 + §16 Wave 7) + تحديث 'آخر task' في الـ worklog reference لـ DOC-20 + تحديث BREACH-LOG reference لـ 9 breaches (BREACH-007..009 new) + تحديث Folder Structure tree (إضافة WAVE-7 file). Canonical count: 6 (unchanged — Wave 7 file is a changelog reference, not a new canonical file). Per Rule 62 + Rule 63 + README editing rule 1.)*
*تم التحديث بواسطة Documentation Secretariat — Task ID `23-A` — 2026-10-03 (Constitution Update — Rules 64-66 — بعد توجيه المالك «أنا شايف انك في حاجات كتير لازم تتحدث في الدستور»: إضافة 3 قواعد جديدة إلى `00-CONSTITUTION.md`: Rule 64 SHARIA-COMPLIANCE + Rule 65 DATA-VALIDATION-LAYER + Rule 66 SOURCE-AUTHORITY + توسيع Rule 12 بـ 3 نقاط مرجعية + تحديث فهرس القواعد 63 → 66 + تحديث عهد الوكيل 30 → 33 بند + تحديث مرجع Rule 62.1 «62 قاعدة» → «66 قاعدة». Canonical count: 6 (unchanged — Rules 64-66 added داخل `00-CONSTITUTION.md` الموجود). Per Rule 62 (GIT-PUSH-DISCIPLINE) + Rule 63 (commit + push after each — 5 commits + 5 pushes) + README editing rule 1.)*
*تم التحديث بواسطة Documentation Secretariat + Tech Support — Task ID `25` — 2026-10-04 (Consolidate to 6 files max — تنفيذ توجيه المالك الصريح «دخل السكرتيرات + فريق الدعم الفنى يحدثو Documentation وكل ملفات التوثيق فى 6 ملفات بس بحد اقصى». **13 ملف توثيقي إضافي دُمجت في الـ 6 canonical files** + كل source file `git rm`'d (git history preserved): DISCIPLINE → 00-CONSTITUTION (appendix) · 5 files → 01-PROJECT_ANATOMY (appendices) · 7 files → 05-CURRENT_STATE (appendices). **13 commits + 13 pushes** (Rule 63). NO info lost — content preserved verbatim. Final doc count: **8 markdown files** (6 canonical + BREACH-LOG + README — within target ≤ 8). Per Rule 4 + Rule 25 + Rule 62 + Rule 63 + README editing rule 1.)*
*تم التحديث بواسطة Documentation Secretariat (Wave 8 Update) — Task ID `28-C` — 2026-10-04 (تنفيذ توجيه المالك الصريح «متنساش التوثيق لازم لازم السكرتيرات تحدث Documentation مش بملفات جديدة بس تحدث الى موجود بكل الشغل القديم والى بيحصل» — تحديث الـ 6 canonical docs الموجودة بكل الشغل القديم والجديد — NO new files created): تحديث counts في الفهرس بناءً على Wave 8: API routes **380 → 411** (Wave 8 Task `774a208` restored 32 Flutter API endpoints that were archived by mistake in Wave 2 — see `05-CURRENT_STATE.md` §17.2) · components **247 → 250** (+3 Sharia components — `ShariaView.tsx` + `ShariaBadge.tsx` + `ShariaStockCard.tsx` — Task 23-C — commits `324a095` + `704aa0c`) · hash views **45 → 46** (added `#sharia`) · admin tabs **16+ → 20+** (4 NEW Wave 8 tabs: Sharia management ✅ `f413bd7` + Source Authority ⏳ + Validation Monitor ⏳ + Cron Health ⏳). تحديث كل canonical doc بآخر تغييرات Wave 8: `05-CURRENT_STATE.md` §17 NEW (Wave 8 summary) · `01-PROJECT_ANATOMY.md` §1.9 Flutter App Architecture NEW + §3.1 ticker_registry table NEW + §4.1 source_authority.py + validation.py + sharia_compliance_scraper.py + purification_calculator.py NEW + §5 API routes 380→411 · `02-SCREENS_AND_COMPONENTS.md` §0.7 Sharia + Visual Redesign + Admin Tabs NEW · `03-API_REFERENCE.md` §25 Sharia Compliance APIs NEW + §26 Source Authority Admin APIs NEW + 380→411 route · `SYSTEM_HOW_IT_THINKS.md` §1.1 pipeline diagram — STAGE 1.5 SOURCE AUTHORITY GUARD + STAGE 1.6 DATA VALIDATION LAYER NEW (Rule 65 + Rule 66). **6 commits + 6 pushes** (one per canonical doc — Rule 63). Constitution rules 66 (unchanged — Rules 64+65+66 added in Task 23-A). Canonical count: 6 (unchanged — only edited existing files). Per Rule 4 (NO new files) + Rule 62 (Secretary updates docs) + Rule 63 (commit + push after each) + README editing rule 1.)*
