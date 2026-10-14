# Documentation — GLMinvestment

> **المرجعية الكاملة للمشروع** — منظّمة في 3 طبقات + أرشيف.

## 📂 الهيكلية

```
Documentation/
├── README.md                          ← هذا الملف (الفهرس)
├── MASTER_REFERENCE/                  ← الـ 5 ملفات المرجعية (تبني المشروع من الصفر)
├── DEEP_DIVE/                         ← 4 ملفات تفصيلية أعمق
├── OWNER/                             ← ملفات المالك/المدير (لا تموت مننا)
├── screenshots/                       ← لقطات شاشة
└── _archive_pre_unification_2026-10-12/  ← أرشيف (29+ ملف قديم — للقراءة التاريخية فقط)
```

---

## 🔴 MASTER_REFERENCE/ (5 ملفات — المرجعية الأساسية)

هذه الـ 5 ملفات كافية لإعادة بناء المشروع من الصفر:

| # | الملف | المحتوى | متى تقرأه |
|---|---|---|---|
| 1 | `01-CONSTITUTION_AND_ARCHITECTURE.md` | الدستور (82 قاعدة) + المعمارية + الفرق | قبل أي عمل |
| 2 | `02-SCREENS_AND_API_CONTRACTS.md` | 59 شاشة + 463 API route + Prisma schemas | عند بناء/تعديل شاشة |
| 3 | `03-ENGINEERING_AND_DEPLOYMENT.md` | الأدوات + التبعيات + النشر + Ops + المراقبة | عند النشر أو الصيانة |
| 4 | `04-SECURITY_AND_GOVERNANCE.md` | الأمن + الصلاحيات + سير العمل + إدارة الفريق | قبل أي تعديل أمني |
| 5 | `05-REBUILD_FROM_SCRATCH.md` | دليل إعادة البناء خطوة بخطوة (10 مراحل) | عند الإعادة من الصفر |

---

## 🟡 DEEP_DIVE/ (4 ملفات — تفاصيل أعمق)

| # | الملف | المحتوى | متى تقرأه |
|---|---|---|---|
| 6 | `06-API_GLOSSARY.md` | مرجع شامل لكل API route (463 route) | عند بناء/تعديل API |
| 7 | `07-HOW_WE_THINK.md` | منطق المحرك + الخوارزميات + الإثباتات الـ 6 | عند تعديل logic |
| 8 | `08-SCREENS_AND_COMPONENTS_DEEP.md` | جرد تفصيلي لكل شاشة + مكون + تنقل | عند بناء/تعديل UI |
| 9 | `09-FULL_ARCHITECTURE.md` | المعمارية الشاملة العميقة + تدفق البيانات | عند فهم البنية |

---

## 🟢 OWNER/ (3 ملفات — ملفات المالك/المدير)

> **هذه الملفات لا تموت مننا** — تحوي شخصية المالك + فلسفته + خططه الاستراتيجية.

| الملف | المحتوى |
|---|---|
| `SESSION_HANDOFF_JIMMY.md` | وثيقة استنساخ الجلسة — جيمي (GM) + الفرق + الحالة الراهنة |
| `ENGINEER_SOUL_AND_PLAYBOOK.md` | فلسفة المهندس + القواعد + الـ Playbook |
| `MASTER_STRATEGIC_PLAN.md` | الخطة الاستراتيجية الكبرى + خارطة الطريق 3-Phase |

---

## ⚪ _archive_pre_unification_2026-10-12/ (أرشيف)

29+ ملف توثيقي قديم قبل التوحيد (2026-10-12). **للقراءة التاريخية فقط** — لا تعتمد عليها كمرجعية فعلية. كل المحتوى المفيد فيها تم دمجه في MASTER_REFERENCE/ و DEEP_DIVE/.

---

## ❓ هل البيانات مأخوذة من كل ملفات التوثيق؟

**نعم.** كل ملف في MASTER_REFERENCE/ و DEEP_DIVE/ مبني من:

1. **فحص الكود الفعلي** (الطريقة الأساسية):
   - `grep` + `Read` على كل ملفات `src/` + `vps-service/` + `prisma/`
   - استخراج الأرقام + المسارات + الأسطر من الكود مباشرةً
   - مثال: `master_analyzer.py:506-512` للـ THRESHOLDS

2. **مراجعة التوثيقات القديمة** (للمقارنة + اكتشاف التعارضات):
   - `00-CONSTITUTION.md` (228 KB — 82 قاعدة)
   - `01-ARCHITECTURE_AND_API.md` (293 KB — معمارية + API)
   - `02-SCREENS_AND_COMPONENTS.md` (150 KB — شاشات)
   - `03-HOW_IT_THINKS.md` (364 KB — منطق المحرك)
   - `04-CURRENT_STATE.md` (354 KB — الحالة الحالية)
   - `05-PHASE2_SNAPSHOT_2026-10-14.md` (25 KB — لقطة المرحلة الثانية)
   - `06-SCRIPTS_DICTIONARY.md` (105 KB — قاموس السكربتات)
   - `07-DATABASE_DNA.md` (8 KB — DNA قواعد البيانات)
   - `AUDIT_REPORT_FULL.md` (132 KB — تقرير الفحص الشامل)
   - `ENGINEER_SOUL_AND_PLAYBOOK.md` (6 KB — فلسفة المهندس)
   - `MASTER_STRATEGIC_PLAN.md` (42 KB — الخطة الاستراتيجية)
   - `SESSION_HANDOFF_JIMMY.md` (3 KB — تسليم الجلسة)
   - `UX_SCREEN_DESIGN_PACKAGE.md` (169 KB — حزمة تصميم UX)
   - 29 ملف في `_archive_pre_unification_2026-10-12/`

3. **فحص الـ 8 وكلاء AUDIT** (للتحقق من الحقائق):
   - AUDIT-A (الدستور) + AUDIT-B (dead code) + AUDIT-C (overlaps) + AUDIT-D (duplication)
   - AUDIT-E (engineering) + AUDIT-F (DBs/APIs) + AUDIT-G (security) + AUDIT-H (production)

**النتيجة**: كل رقم + مسار + سطر في الـ 9 ملفات موثّق من الكود الفعلي، وليس منسوخًا من التوثيقات القديمة دون تحقق.

---

*آخر تحديث: 2026-10-14 by سوسو (CEO Agent)*
