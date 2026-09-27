# 📚 توثيق المشروع — Project Documentation Index

> **آخر تحديث:** 2026-09-27 (Task `DOC-UPDATE-P0-WAVE`)
>
> هذا الملف هو **نقطة الدخول الموحَّدة** لكل توثيق المشروع. كل ملفات الـ Markdown موزَّعة على 6 تصنيفات: حجر الزاوية · تقارير المراجعة · النشر · التقارير الإنتاجية · نتائج الباك تست · المحتوى التعليمي.
>
> **القاعدة الذهبية:** أي ملف جديد لازم يُضاف لهذا الفهرس أولاً قبل ما يبقى "رسمي".

---

## 🏛️ حجر الزاوية (Cornerstone Documents)

> ديه الـ 4 ملفات الأساسية اللي كل مطور جديد لازم يقرأها قبل ما يلمس الكود. كلها محدّثة في 2026-09-27 لتعكس P0 Disaster Resolution Wave (16/16 P0 items ✅).

| # | الملف | الوصف |
|---|------|------|
| 00 | [00-CONSTITUTION.md](./00-CONSTITUTION.md) | **الدستور** — القواعد الذهبية (59 rule now) + المعمارية الأساسية + الـ governance + **Rules 55–59 (P0-WAVE-SECURITY/SQLI/ASYNC/OBSERVABILITY/TESTS) NEW 2026-09-27** + قسم جديد "§N — P0 Disaster Resolution Wave (2026-09-27)" يوثّق كل الكوارث الـ 16 المُنجَزة |
| 01 | [01-PROJECT_ANATOMY.md](./01-PROJECT_ANATOMY.md) | **تشريح المشروع** — كل المكونات + الـ data flow + الـ DBs + **§1.7 — P0 Wave 2026-09-27 — Security + Observability + Tests (NEW)** + تحديث §1.5 الإحصائيات (30 routes secured + 7 SQLi fixed + 9 duplicate tables dropped + PM2 6→7 + tests 3→9 files) |
| 02 | [02-SCREENS_AND_COMPONENTS.md](./02-SCREENS_AND_COMPONENTS.md) | **الشاشات + المكونات** — every component mapped + state + API + **§0.3 — P0 Wave 2026-09-27 (NEW)** + 3 orphan tabs wired (LiveTrackingTab + ExpertPredictionsTab + CryptoPredictionsTab) + help modal persistence fix (30-day) |
| 03 | [SYSTEM_HOW_IT_THINKS.md](./SYSTEM_HOW_IT_THINKS.md) | **كيف يفكر النظام** — pipeline + algorithms + §15 رادار السيولة (مدموج) + **§16 — HELI False-Target Forensics (NEW)** + **§17 — Observability Stack (NEW)** — Win Rate 67.4% → ~50–55% (actual بعد HELI-CLEANUP-2) |

---

## 📋 تقارير المراجعة (Audit Reports)

### أحدث تقارير المراجعة (2026-09-27 — Task `DOC-REORG-2` + `DOC-UPDATE-P0-WAVE`)
- [audit-logs/MASTER_AUDIT_REPORT.md](./audit-logs/MASTER_AUDIT_REPORT.md) — **التقرير النهائي الشامل + Checklist + To-Do + Wiring Matrix** (مشتق من `agent-ctx/SYNTHESIS_REPORT.md`) — ✅ **تم تحديثه 2026-09-27: كل الـ 16 P0 items marked as ✅ completed (16/16)**
- [audit-logs/frontend-backend-db-audits/AUDIT_FRONTEND.md](./audit-logs/frontend-backend-db-audits/AUDIT_FRONTEND.md) — Frontend audit (~2,036 lines)
- [audit-logs/frontend-backend-db-audits/AUDIT_BACKEND.md](./audit-logs/frontend-backend-db-audits/AUDIT_BACKEND.md) — Backend audit (~1,889 lines)
- [audit-logs/frontend-backend-db-audits/AUDIT_DATABASES.md](./audit-logs/frontend-backend-db-audits/AUDIT_DATABASES.md) — Database audit (~6,462 lines)
- [audit-logs/frontend-backend-db-audits/AUDIT_ENGINEERING.md](./audit-logs/frontend-backend-db-audits/AUDIT_ENGINEERING.md) — Engineering audit (2,006 lines) — code quality + security + performance + tests — تم حل كل P0 items اللي اكتشفته
- [audit-logs/frontend-backend-db-audits/AUDIT_BACKTEST.md](./audit-logs/frontend-backend-db-audits/AUDIT_BACKTEST.md) — Backtest audit (1,561 lines) — predictions validation + anomaly detection — HELI false TARGET_HITs تم حلها
- [audit-logs/frontend-backend-db-audits/AUDIT_UIUX.md](./audit-logs/frontend-backend-db-audits/AUDIT_UIUX.md) — UI/UX audit (127 screenshots + 23 issues)

### تقارير المراجعة السابقة
- [audit-logs/JULY_2026_LOSS_ANALYSIS.md](./audit-logs/JULY_2026_LOSS_ANALYSIS.md) — تحليل خسائر يوليو 2026
- [audit-logs/LAST_30DAYS_WEAKNESS_ANALYSIS.md](./audit-logs/LAST_30DAYS_WEAKNESS_ANALYSIS.md) — تحليل نقاط الضعف في آخر 30 يوم

---

## 🚀 النشر والـ Deployment

| الملف | المصدر الأصلي | الوصف |
|---|---|---|
| [deployment/DEPLOYMENT_GUIDE.md](./deployment/DEPLOYMENT_GUIDE.md) | `DEPLOYMENT_GUIDE.md` (root) | دليل النشر الكامل (45KB) |
| [deployment/VPS_DEPLOY_README.md](./deployment/VPS_DEPLOY_README.md) | `vps-service/scripts/VPS_DEPLOY_README.md` | تعليمات نشر VPS |
| [deployment/DEPLOYMENT.md](./deployment/DEPLOYMENT.md) | `vps-service/DEPLOYMENT.md` | دليل نشر الـ vps-service |
| [deployment/PRODUCTION_TOOLS_README.md](./deployment/PRODUCTION_TOOLS_README.md) | `vps-service/tools/PRODUCTION_TOOLS_README.md` | أدوات الإنتاج |

---

## 📊 التقارير الإنتاجية (Production Reports)

| الملف | المصدر الأصلي | الوصف |
|---|---|---|
| [reports/SYSTEM_STATE.md](./reports/SYSTEM_STATE.md) | `SYSTEM_STATE.md` (root) | الحالة الحالية للنظام (52KB) |
| [reports/EFFICIENCY_PROOF_REPORT.md](./reports/EFFICIENCY_PROOF_REPORT.md) | `EFFICIENCY_PROOF_REPORT.md` (root) | تقرير إثبات الكفاءة |
| [reports/Grok-Report-V40.2-Detailed-Analysis.md](./reports/Grok-Report-V40.2-Detailed-Analysis.md) | `Grok-Report-V40.2-Detailed-Analysis.md` (root) | تحليل تفصيلي لـ V40.2 |
| [reports/AGENTS.md](./reports/AGENTS.md) | `AGENTS.md` (root) | تعليمات الـ AI agents (34KB) |
| [reports/Agent-messages-from-news.md](./reports/Agent-messages-from-news.md) | `Agent messages (from news).md` (root, renamed) | رسائل الـ agents من الأخبار |
| [reports/CHANGELOG.md](./reports/CHANGELOG.md) | `CHANGELOG.md` (root) | سجل التغييرات (900KB) |
| [reports/final_audit_certificate.md](./reports/final_audit_certificate.md) | `scripts/final_audit_certificate.md` | شهادة المراجعة النهائية |
| [reports/implementation_plan.md](./reports/implementation_plan.md) | `vps-service/implementation_plan.md` | خطة التنفيذ |

---

## 🧪 نتائج الباك تست (Backtest Results)

- [backtest-results/README.md](./backtest-results/README.md) — فهرس شامل لكل نتائج الباك تست

### الأقسام الفرعية:
- [backtest-results/archived/](./backtest-results/archived/) — 8 تقارير قديمة (audits + morning bell + backtest full)
- [backtest-results/radar/](./backtest-results/radar/) — 6 تقارير الرادار (ab_liquidity_v2 + explosive_rejections + maker_radar)
- [backtest-results/vps-service/](./backtest-results/vps-service/) — تقارير V40.x (~30 ملف، شامل subfolders)

#### vps-service subfolders:
- `v40_2_flag_ablation/` — تقرير الـ flag ablation + 6 ملفات trades_*.csv
- `v40_2_full_pipeline/` — تقرير الـ pipeline الكامل + 6 ملفات JSON/CSV
- `v40_2_treasures/` — تقرير الكنوز + predictions/summary/trades
- `v40_4_multi_market/` — تقرير multi-market
- `proof_20260817/` — تقرير إثبات الكفاءة + 10 ملفات JSON/.done

---

## 🎓 المحتوى التعليمي (Education)

8 ملفات تعليمية للمستخدم النهائي — مرتبة من الـ 01 للـ 08:

- [education/README.md](./education/README.md) — فهرس المحتوى التعليمي
- [education/01_saykolojeya_altadawul.md](./education/01_saykolojeya_altadawul.md) — سيكولوجية التداول
- [education/02_stage_analysis.md](./education/02_stage_analysis.md) — تحليل المراحل (Stage Analysis)
- [education/03_can_slim.md](./education/03_can_slim.md) — استراتيجية CAN SLIM
- [education/04_mean_reversion.md](./education/04_mean_reversion.md) — Mean Reversion
- [education/05_risk_management.md](./education/05_risk_management.md) — إدارة المخاطر
- [education/06_price_action.md](./education/06_price_action.md) — Price Action
- [education/07_legends_stories.md](./education/07_legends_stories.md) — قصص أساطير التداول
- [education/08_crypto_beginner.md](./education/08_crypto_beginner.md) — مدخل للـ Crypto

---

## 📈 بيانات السوق (Market Index Data)

- [المؤشرات/](./المؤشرات/) — بيانات مؤشرات EGX (4 ملفات CSV: EGX 30 + EGX 70 + historical)

> ⚠️ **DO NOT TOUCH** — هذه الملفات بيانات خام تُحدَّث بالـ cron.

---

## 🔗 روابط سريعة

- **آخر تحديث للدستور:** راجع أعلى [`00-CONSTITUTION.md`](./00-CONSTITUTION.md) — *2026-09-27 (DOC-UPDATE-P0-WAVE): Rules 55–59 (P0-WAVE) + قسم P0 Disaster Resolution Wave*
- **آخر تحديث للتشريح:** راجع أعلى [`01-PROJECT_ANATOMY.md`](./01-PROJECT_ANATOMY.md) — *2026-09-27 (DOC-UPDATE-P0-WAVE): §1.7 — P0 Wave — Security + Observability + Tests*
- **آخر تحديث للشاشات:** راجع أعلى [`02-SCREENS_AND_COMPONENTS.md`](./02-SCREENS_AND_COMPONENTS.md) — *2026-09-27 (DOC-UPDATE-P0-WAVE): §0.3 P0 Wave + 3 orphan tabs wired*
- **آخر تحديث لطريقة التفكير:** راجع أعلى [`SYSTEM_HOW_IT_THINKS.md`](./SYSTEM_HOW_IT_THINKS.md) — *2026-09-27 (DOC-UPDATE-P0-WAVE): §16 HELI Forensics + §17 Observability Stack (WR 67.4% → ~50–55% actual)*
- **الـ worklog الكامل:** [`/worklog.md`](../worklog.md) (في root) — *آخر task: DOC-UPDATE-P0-WAVE*

---

## 🗂️ خريطة هيكل المجلد (Folder Structure)

```
Documentation/
├── 00-CONSTITUTION.md                          ← cornerstone
├── 01-PROJECT_ANATOMY.md                       ← cornerstone
├── 02-SCREENS_AND_COMPONENTS.md                ← cornerstone
├── SYSTEM_HOW_IT_THINKS.md                     ← cornerstone (§15 = radar merged 2026-09-27)
├── README.md                                   ← هذا الملف (الفهرس)
│
├── audit-logs/                                  ← تقارير المراجعة
│   ├── JULY_2026_LOSS_ANALYSIS.md
│   ├── LAST_30DAYS_WEAKNESS_ANALYSIS.md
│   ├── MASTER_AUDIT_REPORT.md                  ← NEW 2026-09-27 (checklist format)
│   └── frontend-backend-db-audits/
│       ├── AUDIT_FRONTEND.md
│       ├── AUDIT_BACKEND.md
│       └── AUDIT_DATABASES.md
│
├── deployment/                                  ← أدلة النشر
│   ├── DEPLOYMENT_GUIDE.md
│   ├── DEPLOYMENT.md
│   ├── VPS_DEPLOY_README.md
│   └── PRODUCTION_TOOLS_README.md
│
├── reports/                                     ← التقارير الإنتاجية
│   ├── SYSTEM_STATE.md
│   ├── EFFICIENCY_PROOF_REPORT.md
│   ├── Grok-Report-V40.2-Detailed-Analysis.md
│   ├── AGENTS.md
│   ├── Agent-messages-from-news.md
│   ├── CHANGELOG.md
│   ├── final_audit_certificate.md
│   └── implementation_plan.md
│
├── backtest-results/                            ← نتائج الباك تست
│   ├── README.md
│   ├── archived/      (8 ملفات)
│   ├── radar/         (6 ملفات)
│   └── vps-service/   (~30 ملف + 5 subfolders)
│
├── education/                                   ← المحتوى التعليمي (8 ملفات + README)
│
└── المؤشرات/                                     ← بيانات EGX (CSV — لا تُمسس)
```

---

## 📝 قواعد التعديل (Editing Rules)

1. **أي تعديل في الـ cornerstone files** لازم يُحدِّث فيه الـ "آخر تحديث" + سجل التغييرات في الملف نفسه.
2. **أي ميزة جديدة** لازم تتوثّق في `SYSTEM_HOW_IT_THINKS.md` كقسم جديد (§<next-number>) أولاً، بعدها تُضاف للشاشات في `02-SCREENS_AND_COMPONENTS.md`.
3. **أي تغيير في القواعد الذهبية** لازم يُضاف كرقم جديد في `00-CONSTITUTION.md`.
4. **التقارير الجديدة** بتروح في:
   - `audit-logs/` لو هي مراجعة شاملة.
   - `reports/` لو هي تقرير حالة أو تحليل إنتاجي.
   - `backtest-results/<subfolder>/` لو هي نتيجة باك تست.
5. **أي ملف جديد** لازم يُضاف لهذا الفهرس أولاً قبل ما يبقى "رسمي".
6. **لا تستخدم `mv` في moving الملفات المتتبَّعة في git** — استخدم `git mv` للحفاظ على الـ history.
7. **لا تُنشئ ملف توثيقي جديد في الـ root** — كل توثيق جديد يُضاف داخل `Documentation/`.

---

## 🧭 خريطة الهجرة (Migration Map — 2026-09-27 DOC-REORG-2)

| الملف | المصدر القديم | الوجهة الجديدة |
|---|---|---|
| RADAR_LIQUIDITY_UPGRADE.md | `Documentation/RADAR_LIQUIDITY_UPGRADE.md` | `Documentation/SYSTEM_HOW_IT_THINKS.md §15` *(merged + deleted)* |
| DEPLOYMENT_GUIDE.md | `./DEPLOYMENT_GUIDE.md` | `Documentation/deployment/DEPLOYMENT_GUIDE.md` |
| DEPLOYMENT.md | `vps-service/DEPLOYMENT.md` | `Documentation/deployment/DEPLOYMENT.md` |
| VPS_DEPLOY_README.md | `vps-service/scripts/VPS_DEPLOY_README.md` | `Documentation/deployment/VPS_DEPLOY_README.md` |
| PRODUCTION_TOOLS_README.md | `vps-service/tools/PRODUCTION_TOOLS_README.md` | `Documentation/deployment/PRODUCTION_TOOLS_README.md` |
| SYSTEM_STATE.md | `./SYSTEM_STATE.md` | `Documentation/reports/SYSTEM_STATE.md` |
| EFFICIENCY_PROOF_REPORT.md | `./EFFICIENCY_PROOF_REPORT.md` | `Documentation/reports/EFFICIENCY_PROOF_REPORT.md` |
| Grok-Report-V40.2-Detailed-Analysis.md | `./Grok-Report-V40.2-Detailed-Analysis.md` | `Documentation/reports/Grok-Report-V40.2-Detailed-Analysis.md` |
| AGENTS.md | `./AGENTS.md` | `Documentation/reports/AGENTS.md` |
| Agent messages (from news).md | `./Agent messages (from news).md` | `Documentation/reports/Agent-messages-from-news.md` *(renamed)* |
| CHANGELOG.md | `./CHANGELOG.md` | `Documentation/reports/CHANGELOG.md` |
| final_audit_certificate.md | `scripts/final_audit_certificate.md` | `Documentation/reports/final_audit_certificate.md` |
| implementation_plan.md | `vps-service/implementation_plan.md` | `Documentation/reports/implementation_plan.md` |
| AUDIT_FRONTEND.md | `agent-ctx/AUDIT_FRONTEND.md` | `Documentation/audit-logs/frontend-backend-db-audits/AUDIT_FRONTEND.md` |
| AUDIT_BACKEND.md | `agent-ctx/AUDIT_BACKEND.md` | `Documentation/audit-logs/frontend-backend-db-audits/AUDIT_BACKEND.md` |
| AUDIT_DATABASES.md | `agent-ctx/AUDIT_DATABASES.md` | `Documentation/audit-logs/frontend-backend-db-audits/AUDIT_DATABASES.md` |
| MASTER_AUDIT_REPORT.md | *(new — derived from `agent-ctx/SYNTHESIS_REPORT.md`)* | `Documentation/audit-logs/MASTER_AUDIT_REPORT.md` |
| 8 audit/backtest reports | `scripts/_archived/*.md` | `Documentation/backtest-results/archived/*.md` |
| 6 radar reports | `scripts/output/*.md` | `Documentation/backtest-results/radar/*.md` |
| ~30 vps-service backtest reports | `vps-service/backtest_results/**` | `Documentation/backtest-results/vps-service/**` |
| 9 education files | `content/education/*` | `Documentation/education/*` |

> **Total files moved:** 91 · **Files merged:** 1 · **Files created:** 3 (README.md + MASTER_AUDIT_REPORT.md + backtest-results/README.md) · **Files deleted:** 1 (RADAR_LIQUIDITY_UPGRADE.md بعد الدمج)

---

## 🆕 تحديث 2026-09-27 (Task `DOC-UPDATE-P0-WAVE`)

> **P0 Disaster Resolution Wave كاملة (16/16 P0 items ✅).** الـ 4 cornerstone docs كلها اتـ updated لتعكس:
> - **Rules 55–59 (NEW)** — P0-WAVE-SECURITY + P0-WAVE-SQLI + P0-WAVE-ASYNC + P0-WAVE-OBSERVABILITY + P0-WAVE-TESTS
> - **30 API routes secured** (auth guards) + **7 SQLi sites fixed** + **70 sync I/O refactored**
> - **9 duplicate DB tables dropped** (333 rows preserved as JSON sidecars) + **4 DBs backed up لـ `*.bak-unify`** (511.2 MB)
> - **PM2 services 6→7** (news-agent added)
> - **Test coverage 3→9 files / 75→121 tests / 873→1,796 LOC** (121/121 passing)
> - **Observability stack (NEW)** — Sentry + structured logger + deep-check /api/health + x-request-id middleware
> - **HELI False-Target Forensics** — 308 false TARGET_HITs cleaned (reconciliation mismatch rate: 41.96% → 31.66%)
> - **Win Rate actual: ~50–55%** (was 67.4% recorded — was مُضخَّم بسبب false TARGET_HITs)
> - **3 orphan tabs wired** (LiveTrackingTab + ExpertPredictionsTab + CryptoPredictionsTab)
> - **help modal persistence fix** (30-day localStorage expiration)
> - **§16 — HELI False-Target Forensics (NEW in SYSTEM_HOW_IT_THINKS.md)**
> - **§17 — Observability Stack (NEW in SYSTEM_HOW_IT_THINKS.md)**

---

*تم الإنشاء بواسطة Documentation Secretary + Programmer — Task ID `DOC-REORG-2` — 2026-09-27*
*تم التحديث بواسطة Documentation Secretary — Task ID `DOC-UPDATE-P0-WAVE` — 2026-09-27*
