# تکلیف: FRONTEND-DATA-INTEGRITY-A-1

> **موجہ لـ:** ألفا (Frontend)
> **من:** جون (المدير التنفيذي)
> **التاريخ:** 2026-10-19
> **الخطورة:** 🟠 HIGH — تضارب بيانات العميل بيشوفه + schema mismatch مخفي
> **القواعد الدستورية:** Rule 4 (NO-NEW-SCREENS), Rule 20 (Python=Brain), Rule 27 (NO-FAKE-DATA), Rule 67 (CALCULATION-CANONICAL), Rule 73 (SINGLE-DISPLAY-SOURCE)

---

```
╔══════════════════════════════════════════════════════════════════╗
║  تکلیف: FRONTEND-DATA-INTEGRITY-A-1                               ║
║  موجہ لمين: ألفا (Frontend)                                       ║
╠══════════════════════════════════════════════════════════════════╣
║  المشكلة المکتشفة (بالإثباتات):                                   ║
║                                                                  ║
║  4 bugs في src/app/api/ — كلهم بيـ cause تضارب بيانات العميل     ║
║  بيشوفه أو يـ hide bugs حقيقية.                                  ║
║                                                                  ║
║  Bug 1 — /api/stocks/search بيرجّع فاضي رغم إن السهم موجود:      ║
║  - الدليل: curl /api/stocks/search?q=comi → HTTP 200,            ║
║    {"success":true,"stocks":[]}                                  ║
║    لكن curl /api/stocks/COMI → HTTP 200, بيرجّع السهم كامل       ║
║    (current_price=124.97, name="البنك التجاري الدولي")           ║
║  - السبب (من src/app/api/stocks/search/route.ts:80-110):         ║
║    * الـ SQL بـ SELECT من `symbol` column (line 80, 104)         ║
║    * بس stocks.db.stocks الجدول اسمه `ticker` مش `symbol`        ║
║      (verify: PRAGMA table_info(stocks) → أول column = ticker)   ║
║    * + الـ MARKET_MAP بـ يحوّل "EGX" → "مصر" (line 63)،          ║
║      بس stocks.db.market = "EGX" مش "مصر"                        ║
║    * → الـ query بـ يقع (no such column: symbol) + الـ market    ║
║      filter بـ يـ filter كل حاجة → safeQuery ترجع null → []      ║
║                                                                  ║
║  Bug 2 — /api/predictions schema mismatch مخفي:                  ║
║  - الدليل: dev.log فيه:                                          ║
║    "SqliteError: no such column: entry_price_min"                ║
║    at GET (src/app/api/predictions/route.ts:386)                 ║
║  - السبب (من src/app/api/predictions/route.ts:142, 351):         ║
║    * SELECT بـ يطلب `entry_price_min` و `entry_price_max`        ║
║    * بس predictions.db.predictions ما عندهاش العمود ده           ║
║      (verify: PRAGMA table_info(predictions) — تأكد:             ║
║       entry_price_min NOT in columns)                            ║
║    * الـ route بـ catch الـ error ويرجّع source:empty → الـ bug  ║
║      متخفي والعميل بيشوف "مفيش توقعات"                           ║
║                                                                  ║
║  Bug 3 — COMI 3 حقول change بقيم مختلفة:                        ║
║  - الدليل: curl /api/stocks/COMI → HTTP 200:                    ║
║    { "change_percent":-0.02,                                     ║
║      "price_change":-0.020000800032005828,                       ║
║      "change_value":-0.025000000000005684 }                      ║
║  - المفروض: price_change = change_value = -0.025                 ║
║    (current_price 124.97 - previous_close 124.995 = -0.025)     ║
║  - السبب: 3 حسابات مختلفة لنفس المفهوم في نفس الـ response.      ║
║    لازم يتوحّد لـ قيمة واحدة (أو يتحذف المكرر).                 ║
║                                                                  ║
║  Bug 4 — COMI recommendation تضارب بين routeين:                  ║
║  - الدليل:                                                      ║
║    curl /api/stocks/COMI/expert-analysis →                       ║
║      {"recommendation":"HOLD","confidence":null}                 ║
║    curl /api/stocks/COMI/recommendation →                        ║
║      {"source":"sqlite_fallback_empty","recommendation":null,    ║
║       "message":"لا توجد توقعات متاحة حالياً"}                   ║
║  - التضارب: route 1 بيقول HOLD، route 2 بيقول مفيش.              ║
║    لو الشاشة بـ swap بين الاتنين، العميل بيشوف توصيتين.         ║
║  - السبب: الـ routeين بـ يقرأوا من sources مختلفة                ║
║    (expert-analysis من stored_analyses / computed،               ║
║     recommendation من predictions.db) — ما فيهوش canonical.      ║
╠══════════════════════════════════════════════════════════════════╣
║  خطة المراحل (overview):                                         ║
║  - المرحلة 1: إصلاح /api/stocks/search (column name + market)   ║
║  - المرحلة 2: إصلاح /api/predictions schema mismatch            ║
║  - المرحلة 3: توحيد COMI change fields (Rule 73)                ║
║  - المرحلة 4: توحيد recommendation source (Rule 73)             ║
║  - المرحلة 5: اختبارات شاملة + Agent Browser verify             ║
╠══════════════════════════════════════════════════════════════════╣
║  تفاصيل كل مرحلة (بالخطوات):                                     ║
║                                                                  ║
║  المرحلة 1 — إصلاح /api/stocks/search:                          ║
║    1.1. افتح src/app/api/stocks/search/route.ts                 ║
║    1.2. الـ SQL الحالي بـ SELECT `symbol` — بس stocks.db.stocks  ║
║         اسم العمود `ticker` مش `symbol`.                         ║
║    1.3. الـ data_engine.db.stocks table فيها `symbol`.           ║
║         فلازم الـ query تـ handle الاتنين:                       ║
║         (a) لو على data_engine.db (lightDb) → استخدم `symbol`   ║
║         (b) لو على stocks.db (stocksDb) → استخدم `ticker`       ║
║         (c) أو: استخدم `COALESCE(symbol, ticker)` كـ canonical  ║
║    1.4. الـ MARKET_MAP بـ يحوّل "EGX" → "مصر" — بس stocks.db     ║
║         market = "EGX". الحل:                                    ║
║         (a) شيل الـ map (استخدم الـ raw value)                   ║
║         (b) أو: خلي الـ clause يدور على الاتنين:                 ║
║             AND (market = ? OR market = ?)                       ║
║             params: [mappedMarket, marketRaw]                   ║
║    1.5. الـ pollution filter (symbol NOT LIKE '% %') OK — خليه  ║
║    1.6. اختبر: curl /api/stocks/search?q=comi → لازم يرجّع COMI ║
║                                                                  ║
║  المرحلة 2 — إصلاح /api/predictions schema mismatch:            ║
║    2.1. افتح src/app/api/predictions/route.ts                   ║
║    2.2. السطر 142: SELECT بـ يطلب `entry_price_min,             ║
║         entry_price_max` — غير موجودين في predictions.db.       ║
║    2.3. الحل (اختر واحد + وثّق القرار):                          ║
║         (a) شيلهم من SELECT (لو مش مستخدمين فعلاً)              ║
║         (b) أو: استخدم `PRAGMA table_info` في runtime +          ║
║             conditionally SELECT (لو العمود موجود)               ║
║         (c) أو: أضف الأعمدة للـ schema (migration) — بس ده      ║
║             تکلیف برافو (predictions.db ملك برافو)              ║
║    2.4. الـ lines 186, 197, 414 بـ يـ read entry_price_min —     ║
║         تأكد إنهم بـ handle null بطريقة safe.                    ║
║    2.5. اختبر: curl /api/predictions?market=EGX&limit=5 →        ║
║         لازم يرجّع predictions حقيقية (مش source:empty)         ║
║                                                                  ║
║  المرحلة 3 — توحيد COMI change fields (Rule 73):                ║
║    3.1. افتح src/app/api/stocks/[ticker]/route.ts               ║
║    3.2. الـ response بيرجّع 3 حقول: change_percent, price_change, ║
║         change_value.                                            ║
║    3.3. القاعدة: price_change = change_value = current_price -   ║
║         previous_close. change_percent = (change / previous)     ║
║         × 100.                                                  ║
║    3.4. الحل:                                                    ║
║         (a) احسبهم من مصدر واحد (current_price + previous_close)║
║         (b) شيل أي حقل مكرر (لو price_change = change_value،    ║
║             احذف واحد)                                           ║
║         (c) خلي canonical واحد: change_value (absolute) +        ║
║             change_percent (relative)                            ║
║    3.5. اختبر: curl /api/stocks/COMI → change_value = -0.025    ║
║         و change_percent = -0.02 (متطابقين رياضياً)              ║
║                                                                  ║
║  المرحلة 4 — توحيد recommendation source (Rule 73):             ║
║    4.1. افتح src/app/api/stocks/[ticker]/expert-analysis/       ║
║         route.ts و src/app/api/stocks/[ticker]/recommendation/   ║
║         route.ts                                                 ║
║    4.2. الـ routeين بـ يرجعوا توصيات مختلفة لنفس السهم.          ║
║    4.3. الحل:                                                    ║
║         (a) حدد canonical source للـ recommendation              ║
║             (stored_analyses؟ predictions.db؟ computed؟)         ║
║         (b) خلي الاتنين يقرأوا من نفس الـ source                 ║
║         (c) لو فيـ فرق في الـ payload shape — وحّده             ║
║    4.4. اختبر:                                                   ║
║         curl /api/stocks/COMI/expert-analysis → recommendation   ║
║         curl /api/stocks/COMI/recommendation → recommendation    ║
║         لازم يكونوا نفس القيمة (HOLD أو مفيش — بس مش متناقضين)  ║
║                                                                  ║
║  المرحلة 5 — اختبارات شاملة + Agent Browser verify:             ║
║    5.1. lint: bun run lint → 0 errors                           ║
║    5.2. tsc: npx tsc --noEmit → 0 errors                        ║
║    5.3. curl tests (كل الـ bugs):                                ║
║         - /api/stocks/search?q=comi → بيرجّع COMI                ║
║         - /api/predictions?market=EGX&limit=5 → predictions      ║
║         - /api/stocks/COMI → change_value = -0.025               ║
║         - /api/stocks/COMI/expert-analysis + /recommendation     ║
║           → نفس recommendation                                   ║
║    5.4. Agent Browser:                                           ║
║         - dashboard Top Movers مفيهوش تكرار (بعد STOCKS-DEDUP)   ║
║         - stock search بيرجّع نتايج                              ║
║         - stock detail التوصية واحدة                             ║
║    5.5. dev.log مفيهوش SqliteError                               ║
╠══════════════════════════════════════════════════════════════════╣
║  الاختبارات الصارمة بعد كل مرحلة (معيار القبول):                  ║
║                                                                  ║
║  بعد المرحلة 1:                                                   ║
║  - curl /api/stocks/search?q=comi → HTTP 200, stocks.length > 0  ║
║  - curl /api/stocks/search?q=lotus → بيرجّع LUTS (مش LUTSL)     ║
║  - curl /api/stocks/search (no q) → stocks.length > 100         ║
║                                                                  ║
║  بعد المرحلة 2:                                                   ║
║  - dev.log مفيهوش "no such column: entry_price_min"             ║
║  - curl /api/predictions?market=EGX&limit=5 → source != empty   ║
║    (لو فيـ predictions في DB)                                    ║
║                                                                  ║
║  بعد المرحلة 3:                                                   ║
║  - curl /api/stocks/COMI → مفيهوش 3 حقول بنفس المفهوم            ║
║  - change_value == current_price - previous_close (precision)    ║
║                                                                  ║
║  بعد المرحلة 4:                                                   ║
║  - curl /api/stocks/COMI/expert-analysis.recommendation ==       ║
║    curl /api/stocks/COMI/recommendation.recommendation           ║
║                                                                  ║
║  الاختبار النهائي (بعد كل المراحل):                              ║
║  - bun run lint → PASS                                           ║
║  - npx tsc --noEmit → PASS                                       ║
║  - Agent Browser: dashboard + stock detail + search كلهم متطابقين║
║  - dev.log نظيف من الـ errors الجديدة                            ║
║  - git status نظيف (مش غير config files)                        ║
╠══════════════════════════════════════════════════════════════════╣
║  المحظورات:                                                      ║
║  - 🚫 ممنوع تعمل أي حساب في الواجهة (Rule 20 — Python=Brain)    ║
║    بس الإصلاحات دي كلها بـ تـ fix الـ API response، مش بـ تحسب  ║
║  - 🚫 ممنوع تـ create ملف/route جديد (Rule 4) — عدّل الموجود    ║
║  - 🚫 ممنوع تـ disable اختبار عشان يعدّي                         ║
║  - 🚫 ممنوع TODO / dead code / console.log debug                ║
║  - 🚫 ممنوع تـ push غير بـ إذن جون (Rule 75 معلّقة)             ║
║  - 🚫 ممنوع تـ ignore الـ schema mismatch بـ try/catch صامت      ║
║  - 🚫 ممنوع تـ invent بيانات (Rule 27)                           ║
║  - 🚫 ممنوع تلمس prisma/schema.prisma أو config files (Rule 2)  ║
╠══════════════════════════════════════════════════════════════════╣
║  القواعد الدستورية المرتبطة:                                     ║
║  - Rule 4 (NO-NEW-SCREENS-FILES — عدّل الموجود)                  ║
║  - Rule 20 (Python=Brain — ما تحسبش في الواجهة)                 ║
║  - Rule 27 (NO-FAKE-DATA — ما تـ inventش)                       ║
║  - Rule 67 (CALCULATION-CANONICAL — توحيد الحساب)               ║
║  - Rule 73 (SINGLE-DISPLAY-SOURCE — مصدر واحد للعرض)            ║
║  - Rule 75 (PUSH-AFTER-EVERY-TASK — معلّقة، جون يـ push)        ║
╠══════════════════════════════════════════════════════════════════╣
║  التسليم:                                                        ║
║  - تقرير في worklog.md (Task ID: FRONTEND-DATA-INTEGRITY-A-1)   ║
║  - diff + lint + tsc + browser proof                             ║
║  - انتظر قرار جون (PASS/FAIL/BLOCKED) قبل أي push                ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## ملاحظات جون لألفا

1. **الترتيب مهم** — المرحلة 1 (search) الأول عشان ده اللي العميل بيشوفه أكتر. بعدها 2 (schema) عشان ده بـ hide bugs. بعدها 3 و 4.

2. **الـ schema mismatch (Bug 2)** — لو لقيت إن `entry_price_min` مفروض يكون موجود (مثلاً برافو كان بـ يـ write فيه بس الـ migration ما اتعملش)، ابلّغ جون. ده ممكن يکون تکلیف لبرافو (migration). ما تـ addش العمود بنفسك — predictions.db ملك برافو.

3. **الـ recommendation unification (Bug 4)** — ده حساس. لو الـ canonical source هو `stored_analyses` (من predictions.db)، برافو لازم يكون بـ يـ write فيه. لو الـ canonical هو `computed` (Python)، برافو لازم يكون online. تأكد من الـ source قبل ما توحّد.

4. **الـ COMI change fields (Bug 3)** — لما تحذف حقل مكرر، اتأكد إن مفيش كومبوننت في الـ frontend بـ يـ read الـ field اللي هتـ shilo. grep على `price_change` في `src/`.

5. **ما تـ swapش بين DBs بالغلط** — الـ `safeQuery` بتـ try lightDb (data_engine.db) الأول. لو الـ data_engine.db فيه `stocks` table بـ `symbol`، الـ query هينجح هناك. بس لو الـ fallback لـ stocksDb (stocks.db بـ `ticker`)، الـ query هيقع. الحل: query منفصلة لكل DB.

---

**جون — الـ 4 bugs دي كلها تضارب العميل بيشوفه. صلّحيهم بالـ rich box. أي تسليم بدون اختبار = FAIL.**
