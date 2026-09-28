# 📋 UI/UX Audit + Fix Execution Checklist

> **Created:** 2026-09-30
> **Rollback Tag:** `v-ui-fix-start` (نقطة رجوع آمنة)
> **Constitution Rules:** Rule 4 (no new screens — بس إصلاح), Rule 30 (CLIENT-FACING-STYLE), Rule 5 (wiring)

---

## المرحلة 1: الفحص الشامل بـ Agent Browser

### Checklist قبل البدء:
- [x] إنشاء rollback tag: `v-ui-fix-start`
- [x] قراءة الدستور (Rule 4 + Rule 30)
- [ ] فحص كل الشاشات بـ Agent Browser + screenshots
- [ ] توثيق كل مشكلة في تقرير

### الشاشات المطلوب فحصها:
1. **#dashboard** (الرئيسية) — widgets + cards + layout
2. **#stocks** (الأسهم) — table + filters + stock detail
3. **#stock-filters** (فلاتر الأسهم) — screener
4. **#trading-chart** (الشارت التفاعلي) — chart + comparison
5. **#liquidity-radar** (رادار السيولة) — radar lists + drawer
6. **#recommendations** (متابعة التوقعات) — tabs + predictions table
7. **#specialist-analysis** (تحليل المتخصصين) — analysis view
8. **#portfolio** (المحفظة) — holdings + summary
9. **#watchlist** (قائمة المتابعة) — watchlist
10. **#alerts-center** (مركز التنبيهات) — alerts
11. **#finance** (أموالي) — wallet
12. **#reports** (التقارير) — reports list
13. **#news** (الأخبار) — news feed
14. **#learning** (مركز التعلم) — learning
15. **#simulation** (المحاكاة) — simulation
16. **#academy** (الأكاديمية) — academy
17. **#crypto** (الكريبتو) — crypto views
18. **#admin** (الأدمن) — admin tools

### لكل شاشة:
- [ ] screenshot (desktop + mobile)
- [ ] فحص الألوان (تناسق + تباين + قواعد)
- [ ] فحص الأحجام (عناصر كبيرة جداً / صغيرة جداً)
- [ ] فحص البيانات الناقصة (حقول فاضية / خطأ)
- [ ] فحص التنسيق العام (محاذاة + مسافات + ترتيب)

---

## المرحلة 2: تصنيف المشاكل

### تصنيف بالأولوية:
- **P0 (بيانات ناقصة)**: حقول فاضية، بيانات مش بتظهر، API errors
- **P1 (أحجام غلط)**: عناصر كبيرة جداً / صغيرة جداً، overflow، truncation
- **P2 (ألوان)**: تناسق، تباين، dark mode issues
- **P3 (ترتيب)**: محاذاة، مسافات، spacing غير متناسق
- **P4 (تحسينات)**: تحسينات بصرية اختيارية

---

## المرحلة 3: الإصلاح

### لكل مشكلة:
- [ ] تحديد الملف المصدر
- [ ] إصلاح بدون كسر (surgical edit)
- [ ] `bun run lint` بعد كل إصلاح
- [ ] screenshot بعد الإصلاح

---

## المرحلة 4: اختبارات قاسية + رفع

- [ ] `bun run lint` → exit 0
- [ ] `bun run test` → كل tests pass
- [ ] `curl localhost:3001/` → HTTP 200
- [ ] Agent Browser: إعادة فحص الشاشات المُصحّحة
- [ ] توثيق في `agent-ctx/UI-FIX-REPORT.md`
- [ ] `git commit` + `git tag v-ui-fix-complete` + `git push`
