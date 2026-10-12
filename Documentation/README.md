# 📚 توثيق مشروع GLMinvestment — الدليل الموحّد

> **آخر تحديث: 2026-10-12** — توحيد شامل (DOC-UNIFY): 24 ملف قديم → 5 ملفات canonical.

---

## 📖 ترتيب القراءة الإلزامي

أي وكيل (Kilo / Grok / Gemini / Z.ai / بشري) يبدأ عمله في المشروع **لازم يقرأ الـ 5 ملفات بالترتيب ده** قبل لمس أي سطر كود:

| # | الملف | المحتوى | الأسطر |
|---|---|---|---:|
| 0 | [`00-CONSTITUTION.md`](./00-CONSTITUTION.md) | 📜 **الدستور**: القواعد الـ 76 + الحوكمة + KPIs + Personas + عهد الوكيل | 2,392 |
| 1 | [`01-ARCHITECTURE_AND_API.md`](./01-ARCHITECTURE_AND_API.md) | 🏗️ **المعمارية**: DBs + Engines + 411 API + Deployment + Flutter + 5 Runbooks | 4,984 |
| 2 | [`02-SCREENS_AND_COMPONENTS.md`](./02-SCREENS_AND_COMPONENTS.md) | 🖥️ **الشاشات**: 53 view + 71 orphan + Pine Script + Marketing + Expert Engine | 2,213 |
| 3 | [`03-HOW_IT_THINKS.md`](./03-HOW_IT_THINKS.md) | 🧠 **المنطق**: Pipeline + V34 Engine + Radar + HELI + Canonical + 6 Audit Reports | 6,421 |
| 4 | [`04-CURRENT_STATE.md`](./04-CURRENT_STATE.md) | 📊 **الحالة**: Production Snapshot + 7 Waves + Breach Log + Marketing/Paywall Strategy | 4,002 |
| | **الإجمالي** | | **20,012** |

---

## 🗂️ خريطة سريعة (أين أجد ما أبحث عنه؟)

| تبحث عن... | اذهب إلى |
|---|---|
| قاعدة دستورية (Rule 1-76) | `00 §3` |
| KPIs + Hard Caps (ATR 5-9%, R:R ≥ 1.8) | `00 §4` |
| Personas (gambler/balanced/conservative) | `00 §5` |
| عهد الوكيل (34 بند) | `00 §8` |
| قاعدة بيانات معينة (stocks.db, predictions.db...) | `01 §3` |
| API endpoint محدد | `01 §5` (411 route عبر 26 قسم) |
| Deployment + Caddy + PM2 | `01 §7` |
| Flutter app | `01 §9` |
| شاشة معينة + حالتها (ACTIVE/DEAD) | `02 §5` (53 view) |
| Dead code + orphan components | `02 §11` (71 orphan) |
| كيف يحلل النظام سهمًا (Pipeline 9 stages) | `03 §1` |
| V34 Institutional Engine logic | `03 §2` |
| Canonical Signal thresholds (78/65/55/40/25) | `03 §12` |
| تقارير الـ Audit (6 تقارير) | `03 §14-§19` |
| Production Snapshot الحالي | `04 §1` |
| خروقات موثقة (BREACH-001 → 009) | `04 §16` |
| استراتيجية التسويق + Paywall | `04 §14 + §15` |
| بيانات اختبار Paymob (Test Cards) | `04 Appendix B` ⚠️ |

---

## 📦 الأرشيف التاريخي

كل الملفات القديمة (24 ملف) قبل التوحيد محفوظة في:
[`./_archive_pre_unification_2026-10-12/`](./_archive_pre_unification_2026-10-12/)

> **Rule 1 (VERIFY-BEFORE-DELETE)**: لم تُحذف أي ملفات — كلها مؤرشفة بأمان للرجوع التاريخي.

---

## ⚠️ قواعد التعديل

1. **الدستور (`00`)**: تعديله **اقتراح للمالك فقط** (`enmohsen20111975`).
2. **الملفات الأخرى**: التعديل مسموح للأوكلاء مع توثيق في `worklog.md` + `CHANGELOG.md`.
3. **الروابط الداخلية**: استخدم relative paths (مثال: `[راجع 01 §5](./01-ARCHITECTURE_AND_API.md)`).
4. **التكرار**: ممنوع تكرار محتوى بين الـ 5 ملفات — استخدم إشارة مرجعية.

---

## 🔗 ملفات مرجعية خارج Documentation/

| الملف | الوصف |
|---|---|
| [`../worklog.md`](../worklog.md) | سجل العمل اليومي للأوكلاء (78,000+ سطر) |
| [`../CHANGELOG.md`](../CHANGELOG.md) | سجل التغييرات الإصداري (Keep a Changelog) |
| [`../BACKLOG.md`](../BACKLOG.md) | المهام المعلّقة |
| [`../README.md`](../README.md) | README المشروع الرئيسي |
