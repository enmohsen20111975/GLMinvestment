# 📚 توثيق المشروع — Project Documentation Index

> **آخر تحديث:** 2026-09-27 (Task `DOC-REORG-2`)
>
> هذا الملف هو **نقطة الدخول الموحَّدة** لكل توثيق المشروع. كل ملفات الـ Markdown موزَّعة على 6 تصنيفات: حجر الزاوية · تقارير المراجعة · النشر · التقارير الإنتاجية · نتائج الباك تست · المحتوى التعليمي.
>
> **القاعدة الذهبية:** أي ملف جديد لازم يُضاف لهذا الفهرس أولاً قبل ما يبقى "رسمي".

---

## 🏛️ حجر الزاوية (Cornerstone Documents)

> ديه الـ 4 ملفات الأساسية اللي كل مطور جديد لازم يقرأها قبل ما يلمس الكود.

| # | الملف | الوصف |
|---|------|------|
| 00 | [00-CONSTITUTION.md](./00-CONSTITUTION.md) | **الدستور** — القواعد الذهبية + المعمارية الأساسية + الـ governance |
| 01 | [01-PROJECT_ANATOMY.md](./01-PROJECT_ANATOMY.md) | **تشريح المشروع** — كل المكونات + الـ data flow + الـ DBs |
| 02 | [02-SCREENS_AND_COMPONENTS.md](./02-SCREENS_AND_COMPONENTS.md) | **الشاشات + المكونات** — every component mapped + state + API |
| 03 | [SYSTEM_HOW_IT_THINKS.md](./SYSTEM_HOW_IT_THINKS.md) | **كيف يفكر النظام** — pipeline + algorithms + §15 رادار السيولة (مدموج) |

---

## 📋 تقارير المراجعة (Audit Reports)

### أحدث تقارير المراجعة (2026-09-27 — Task `DOC-REORG-2`)
- [audit-logs/MASTER_AUDIT_REPORT.md](./audit-logs/MASTER_AUDIT_REPORT.md) — **التقرير النهائي الشامل + Checklist + To-Do + Wiring Matrix** (مشتق من `agent-ctx/SYNTHESIS_REPORT.md`)
- [audit-logs/frontend-backend-db-audits/AUDIT_FRONTEND.md](./audit-logs/frontend-backend-db-audits/AUDIT_FRONTEND.md) — Frontend audit (~2,036 lines)
- [audit-logs/frontend-backend-db-audits/AUDIT_BACKEND.md](./audit-logs/frontend-backend-db-audits/AUDIT_BACKEND.md) — Backend audit (~1,889 lines)
- [audit-logs/frontend-backend-db-audits/AUDIT_DATABASES.md](./audit-logs/frontend-backend-db-audits/AUDIT_DATABASES.md) — Database audit (~6,462 lines)

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

- **آخر تحديث للدستور:** راجع أعلى [`00-CONSTITUTION.md`](./00-CONSTITUTION.md)
- **آخر تحديث للتشريح:** راجع أعلى [`01-PROJECT_ANATOMY.md`](./01-PROJECT_ANATOMY.md)
- **آخر تحديث للشاشات:** راجع أعلى [`02-SCREENS_AND_COMPONENTS.md`](./02-SCREENS_AND_COMPONENTS.md)
- **آخر تحديث لطريقة التفكير:** راجع أعلى [`SYSTEM_HOW_IT_THINKS.md`](./SYSTEM_HOW_IT_THINKS.md) — *آخر دمج: 2026-09-27 (RADAR_LIQUIDITY_UPGRADE → §15)*
- **الـ worklog الكامل:** [`/worklog.md`](../worklog.md) (في root)

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

*تم الإنشاء بواسطة Documentation Secretary + Programmer — Task ID `DOC-REORG-2` — 2026-09-27*
