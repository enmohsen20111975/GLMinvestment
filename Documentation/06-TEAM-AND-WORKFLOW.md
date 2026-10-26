# 06 — الفريق وسير العمل

> **آخر تحديث:** 2026-10-25 | **Commit:** `a3d1d8b`

---

## 1. الفرق

| الفريق | الدور | التقييم الحالي | الهدف |
|--------|------|---------------|-------|
| **ألفا (Alpha)** | Frontend/UI | 62% | 85% |
| **برافو (Bravo)** | Backend/Data | 58% | 85% |
| **النظام** | Integration | 61% | 85% |

## 2. المسؤوليات

### ألفا
- ✅ عرض البيانات الصحيحة من API
- ✅ تجربة المستخدم + تصميم الشاشات
- ✅ المكونات الموحدة (WidgetCard, UnifiedTable, etc.)
- ✅ حالات loading/error/empty
- ❌ لا يحسب المؤشرات أو يتخذ القرار
- ❌ لا يخترع بيانات مالية

### برافو
- ✅ صحة البيانات + قواعد البيانات
- ✅ المحركات + الحسابات المالية
- ✅ APIs + تحقق النتائج
- ✅ إدارة رأس المال
- ❌ لا يعدّل الواجهة

## 3. سير العمل

```
1. Bravo يسلّم كود + اختبارات على branch معزول
2. Alpha يراجع الواجهة + يختبر العرض
3. النظام يتحقق من التكامل
4. المالك يوافق على الدمج
5. يُدمج في main + يُنشر
```

## 4. القواعد

- لا دمج لـ main بدون موافقة المالك
- لا نشر بدون اختبار قبول
- لا تعديل `maestro_orchestrator.py`
- لا fabrication — `null` بدل القيم الوهمية
- كل تسليم لازم فيه: branch + commit SHA + نتائج اختبارات فعلية

## 5. المهام الحالية

### ألفا (مكتمل):
- ✅ PremiumChart component (10 أدوات رسم)
- ✅ DbBackupPanel Live Console
- ✅ Issue #3 fabrication fixes (تحتاج إعادة تطبيق)
- ✅ Admin consolidation (30→18 tabs)
- ✅ Rescue framework (5 backend modules + frontend wiring)
- ✅ ALPHA-FRONTEND-RELIABILITY-AUDIT

### برافو (قيد التنفيذ):
- ⏳ RADAR-CLOSURE-02: عزل السوق + حساب النتائج
- ⏳ BACKEND-RELIABILITY-AUDIT
- ✅ Rescue backend modules (5 modules + 34 tests)
- ✅ P0 radar forensic validation
