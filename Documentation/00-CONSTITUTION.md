# 📜 دستور مشروع GLMinvestment

> **المصدر الوحيد للحقيقة (Single Source of Truth) لحوكمة المشروع.**
> أي تعارض بين أي ملف في المشروع وبين الدستور ده → الدستور هو الحاكم.
> الدستور ملزم لكل الوكلاء (Owner, Alpha, Bravo, Gemini، وأي AI Agent جديد).

| | |
|---|---|
| **المالك (Owner)** | `enmohsen20111975` |
| **المستودع (Repo)** | https://github.com/enmohsen20111975/GLMinvestment |
| **الإنتاج (Production)** | https://invist.m2y.net |
| **آخر تحديث** | 2026-10-27 |
| **Commit المرجعي** | `ec41f61` (WAVE-3 sealed) |

---

## 1. هيكل التوثيق الجديد (5 ملفات فقط)

القاعدة الذهبية: **التوثيق المبعثر = توثيق ميت.** من تاريخ هذا الدستور،
التوثيق المعتمد رسميًا هو 5 ملفات بس في `Documentation/`:

| # | الملف | المحتوى |
|---|------|---------|
| 0 | `00-CONSTITUTION.md` | هذا الملف — القواعد والحوكمة والملكية |
| 1 | `01-SCREENS-AND-COMPONENTS.md` | الشاشات + المكونات + تجربة المستخدم |
| 2 | `02-HOW-IT-THINKS.md` | كيف يفكر النظام + المحركات + المنطق الاستثماري |
| 2 | `02-API-DICTIONARY.md` | قاموس الـ API routes (466 route في `src/app/api/`) |
| 2 | `02-DATABASES-AND-DATA.md` | قواعد البيانات + مصادر الحقيقة + DAL |

> **ملاحظة:** باقي ملفات `Documentation/` (زي `03-ENGINES-AND-LOGIC.md`,
> `04-API-REFERENCE.md`, `05-DATA-ACCESS-LAYER-PLAN.md`, …) تبقى مراجع
> تاريخية في `Documentation/archive/` ومش ملزمة للحوكمة الجارية.

---

## 2. القواعد الأساسية (Core Rules)

### Rule 1: NO-FAKE-DATA
أي بيانات غير متاحة → `null` أو "غير متاح". **ممنوع نهائيًا** اختلاق أسعار،
مستويات، تواريخ، أو نتائج توقعات. لو الـ DB فاضي → رجّع `source: "fallback"`
مع `200 OK` مش `500`.

### Rule 2: PYTHON = BRAIN
كل الحسابات الاستثمارية (indicators, signals, predictions, scoring) في
**Python backend** (`vps-service/` + `data_engine/`). Next.js = **DISPLAY ONLY**.
الـ API routes في `src/app/api/` بتعمل: (a) proxy للـ Python، أو (b) قراءة
قراءة فقط من الـ DBs عبر DbManager.

### Rule 3: SINGLE-DISPLAY-SOURCE
كل توصية في الواجهة لازم ترجع لنفس مصدر القرار. لو الـ Python قرر "BUY"،
مايصحش الواجهة تعرض "HOLD" من حساب تاني. الـ sparkline، السعر الحالي،
والتوصية كلها لازم تشير لنفس الـ ticker + نفس الـ timestamp.

### Rule 4: NO-DUPLICATION
ممنوع تكرار نفس المنطق في ملفين. استخدم المكونات الموحدة (`unified-stock-data`,
`data-adapter`, `DbManager`).

### Rule 5: CLIENT-FACING-STYLE
كل النصوص للمستخدم بالعربية. الأخطاء الإنجليزية ممنوعة في الـ UI.
الـ API responses ممكن تفضل English keys (للـ backward compat) لكن الـ messages
للـ user لازم تكون عربي.

### Rule 6: GIT-PUSH-DISCIPLINE
كل مهمة منتهية → `commit` + `push`. مفيش شغل بدون تسليم. شوف Section 6.

### Rule 7: NO-DESTRUCTIVE-OPERATIONS
ممنوع `reset --hard` أو `force-push` على `main`. شوف Section 7.

### Rule 8: NO-SILENT-FAILURES
كل خطأ في الـ API لازم يرجع `success: false` مع `error` message واضح.
ممنوع ابتلاع exception وترجيع `[]` فاضية بدون توضيح.

---

## 3. قواعد البيانات (Database Rules)

### Rule 10: SINGLE-PRICE-SOURCE
**`stocks.db.stock_daily_prices` هو المصدر الأساسي الحي للأسعار اليومية.**
أي كويري سعر → تبدا من `stocks.db`. الـ fallback الوحيد المسموح:
`data_engine.db.egksco_price_history` للأساسيات EGX بس.

### Rule 11: PRICE-HISTORY-DB-ISOLATED
**`price_history.db` معزول (WAVE 1-3).** ممنوع قراءته من أي route أو
كومبوننت جديد. اتطهر من `hunting/`, `sniper/`, `jobs/`, `portfolio/`,
`predictions/`, `screener/`, `admin/`. الـ fallback labels في الـ comments
مسموحة، لكن `new Database('price_history.db')` ممنوع.

### Rule 12: DB-OWNERSHIP
كل DB ليها **كاتب واحد (writer)** و**قرّاء متعددون (readers)**:
- `stocks.db` ← data_engine بيكتب فيه، الباقي بقرأ
- `predictions.db` ← Python analyzers بيكتبوا، Next.js بقرأ
- `auth.db` ← NextAuth بيكتب، API routes بقرأ
- `news.db` ← scrapers بيكتبوا، الباقي بقرأ
- `data_engine.db` ← scrapers بيكتبوا، الباقي بقرأ (raw tier)
- `intraday.db` ← intraday scraper بيكتب، الباقي بقرأ (raw tier)

### Rule 13: DB-LIST (المعتمدة رسميًا)
| Tier | DBs | الوصف |
|------|-----|-------|
| Write-Heavy (Raw) | `data_engine.db`, `intraday.db` | بيانات أولية من scrapers |
| Read-Heavy (Synced) | `stocks.db`, *(price_history.db — معزول)* | متزامنة من data_engine |
| Brain Output | `predictions.db` | كل مخرجات المحركات |
| User State | `auth.db`, `news.db`, `bot_link.db` | مستخدمون + أخبار + ربط بوت |

---

## 4. قواعد DAL (Data Access Layer Rules)

### Rule 20: DBMANAGER-IS-THE-ONLY-GATE
> **«ممنوع نهائياً أي صفحة أو كومبوننت أو مسار API يمد إيده على ملف .db
> أو يكتب كويري SQLite مباشرة!»** — Owner directive (2026-10-27, WAVE 1-3)

البوابة الوحيدة المغلقة لأي قراءة أو كاش في الفرونت إند هي
`src/lib/db-manager.ts`. الـ `DbManager` namespace object هو الـ API المعتمد:

```ts
import { DbManager } from '@/lib/db-manager';

const db = DbManager.openDb('stocks.db');        // readonly, returns null لو مش موجود
const wdb = DbManager.openDbWritable('stocks.db'); // writable (VACUUM, UPDATE, …)
const ok = DbManager.columnExists(db, 'stocks', 'logo_url');
const spark = DbManager.getLiveSparkline('COMI'); // priority: stock_daily_prices
```

### Rule 21: NO-NEW-DATABASE-IMPORT
ممنوع `import Database from 'better-sqlite3'` في أي ملف خارج `db-manager.ts`.
الـ `db-manager.ts` نفسه هو الاستثناء الوحيد (هو الـ DAL layer).

### Rule 22: GRACEFUL-NULL
لو `openDb` رجع `null` (DB مش موجود في الـ sandbox/الإنتاج) → الـ route
يرجع `200 OK` مع `success: false, source: "fallback"` بدل `500`. ممنوع
كسر الـ UI بسبب DB مفقود.

### Rule 23: NAMED-EXPORTS-COMPAT
الـ named exports (`openDb`, `openDbWritable`, `columnExists`, …) لسه شغّالة
للـ backward compat مع شغل WAVE 1+2. الكود الجديد لازم يستخدم `DbManager.`
namespace pattern.

---

## 5. قواعد الفريق (Team Rules)

| الفريق | الدور | مسؤول عن | **ليس** مسؤول عن |
|--------|------|----------|------------------|
| **Owner** | المالك النهائي | القرار النهائي، الـ deploy، الـ force-push، الموافقة على migrations | التنفيذ التفصيلي |
| **Alpha (Frontend)** | مهندس الواجهة | عرض البيانات، الشاشات، المكونات الموحدة، الـ UI/UX | حساب المؤشرات، اتخاذ القرار، صحة البيانات |
| **Bravo (Backend)** | مهندس البيانات والمحركات | الـ DBs، المحركات، الحسابات، الـ API routes، DAL | عرض الواجهة، تجربة المستخدم |
| **Gemini (Orchestrator)** | المنسق | التكامل بين Alpha + Bravo، اختبار دورة كاملة، القبول النهائي | التنفيذ التفصيلي |

### Rule 30: ONE-BRANCH-PER-TASK
كل مهمة (task) لها فرع منفصل بالـ naming convention:
- `alpha/<task-id>-<short-desc>` — لألفا
- `bravo/<task-id>-<short-desc>` — لبرافو
- `gemini/<task-id>-<short-desc>` — لجيمي

### Rule 31: NO-COMMIT-ON-MAIN
ممنوع `commit` مباشرة على `main`. الـ merge للـ `main` بيتم بعد موافقة الـ Owner
أو بعد review على PR. الـ `main` لازم يفضل قابل للـ deploy في أي لحظة.

---

## 6. قواعد Git (Git Discipline)

### Rule 40: STARTUP-SEQUENCE
قبل أي سطر كود:
```bash
git status                    # حالة الفرع
git log --oneline -10         # آخر commits
git pull --rebase origin main # آخر تحديثات
```

### Rule 41: COMMIT-MESSAGE-FORMAT
```
<type>(<scope>): <subject in English or Arabic>

<body — optional, explanation>
```
الأنواع: `feat`, `fix`, `refactor`, `docs`, `chore`, `merge`, `test`.

### Rule 42: PUSH-AFTER-COMMIT
كل `commit` لازم يتبعه `push` لنفس الفرع. مفيش commits محلية متراكمة.

### Rule 43: REBASE-BEFORE-MERGE
قبل دمج أي فرع في `main`، اعمل `rebase` على آخر `main` لتجنب merge commits
المكررة (مش لازم يكون عندنا 10 merge commits لكل feature).

---

## 7. قواعد الأمان (Safety Rules)

### Rule 50: NO-FORCE-PUSH-ON-MAIN
ممنوع `git push --force` على `main`. لو فيه conflict، اعمل rebase وحلّه
يدويًا. الـ force-push على فروع الـ feature مسموح بس بحذر شديد.

### Rule 51: NO-DEPLOY-WITHOUT-APPROVAL
الـ deploy للإنتاج (`https://invist.m2y.net`) بيتم **بعد موافقة الـ Owner فقط.**
أي وكيل (Alpha/Bravo/Gemini) يقدر يجهز الـ deploy بس مايقدرش يشغله.

### Rule 52: PROTECTED-FILES
الملفات دي ممنوع التعديل عليها بدون موافقة الـ Owner:
- `maestro_orchestrator.py`
- `prisma/schema.prisma` (بدون migration معتمد)
- `.env` (ممنوع من git أصلاً)
- `db/*.db` (قواعد بيانات الإنتاج — تعديلها بس عبر migrations)
- `Documentation/00-CONSTITUTION.md` (الدستور نفسه — التعديل بموافقة Owner)

### Rule 53: NO-RESET-HARD
ممنوع `git reset --hard` على `main` أو على أي فرع مشترك. على فروع الـ feature
الشخصية مسموح بس بشرط توثيق السبب في الـ commit message.

---

## 8. الملفات المحمية (Protected Files)

بالإضافة للـ Rule 52، الملفات دي محمية لأنها بوابة الدستور:
- `Agent.md` — بوابة الدخول الإلزامية لأي وكيل
- `Documentation/00-CONSTITUTION.md` — الدستور نفسه
- `Documentation/02-DATABASES-AND-DATA.md` — مصدر الحقيقة للـ DBs
- `Documentation/02-API-DICTIONARY.md` — مصدر الحقيقة للـ routes

التعديل فيهم بموافقة الـ Owner + تحديث `آخر تحديث` في الـ header.

---

## 9. معايير القبول (Acceptance Criteria)

| الطرف | الهدف | الملاحظات |
|-------|-------|-----------|
| النظام ككل | 85% | القبول النهائي للاستخدام في الإنتاج |
| Alpha (Frontend) | 85% | شاشات + مكونات موحدة |
| Bravo (Backend) | 85% | DBs + APIs + محركات |

### درجات الحالة:
- **0–49%**: يحتاج إعادة ضبط أساسية
- **50–69%**: موجود، لكن غير مثبت بما يكفي
- **70–84%**: جيد، يحتاج اختبارات وتكامل
- **85–94%**: مقبول للاستخدام
- **95–100%**: ناضج (production-grade)

---

## 10. المراجع (See Also)

| المرجع | المحتوى |
|--------|---------|
| `Agent.md` | بوابة الدخول لأي وكيل جديد |
| `Documentation/01-SCREENS-AND-COMPONENTS.md` | الشاشات والمكونات |
| `Documentation/02-HOW-IT-THINKS.md` | كيف يفكر النظام |
| `Documentation/02-API-DICTIONARY.md` | قاموس الـ 466 API route |
| `Documentation/02-DATABASES-AND-DATA.md` | قواعد البيانات ومصادر الحقيقة |
| `src/lib/db-manager.ts` | الـ DAL layer (البوابة الوحيدة للـ DBs) |
| `worklog.md` | آخر شغل كل الوكلاء |

---

*هذا الدستور ملزم لكل الوكلاء. آخر تحديث: 2026-10-27 (WAVE-3 sealed).*
