# AGENTS.md — بوابة الدخول الإلزامية لأي وكيل على GLMinvestment

> **المرجع الأعلى:** `Documentation/00-CONSTITUTION.md`. أي تعارض بين
> الملف ده والدستور → الدستور هو الحاكم.
> **الغرض:** أي AI Agent / مبرمج / Subagent يدخل المشروع، لازم يقرأ ده
> الأول. الملف ده بيوجهك **إزاي تشتغل** مش بيشرح المشروع.
> **آخر تحديث:** 2026-10-25

---

## A. Mandatory Startup Sequence — تسلسل القراءة الإلزامي

قبل أي سطر كود أو أي تعديل، اقرأ بهذا الترتيب:

1. **`Documentation/00-CONSTITUTION.md`** — الدستور (76 قاعدة)
2. **`Documentation/01-PROJECT-ANATOMY.md`** أو `01-ARCHITECTURE.md` (لو الأول مش موجود) — المعمارية
3. **`Documentation/02-DATABASES-COMPLETE.md`** — قواعد البيانات
4. **`Documentation/04-ENGINES-ARCHITECTURE.md`** — المحركات
5. **`Documentation/05-SCREENS-AND-COMPONENTS.md`** — الشاشات
6. **`SYSTEM_STATE.md`** — آخر حالة (لو موجود)
7. **آخر 200 سطر من `worklog.md`** — آخر شغل
8. **آخر 3 إدخالات من `CHANGELOG.md`** — آخر تعديلات

**بعدها:**
```bash
git status                    # حالة الفرع
git log --oneline -10         # آخر commits
git pull --rebase origin main # Rule 76




المستودع: https://github.com/enmohsen20111975/GLMinvestment
GitHub token: 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
انقل المشروع إلى /home/z/my-project
