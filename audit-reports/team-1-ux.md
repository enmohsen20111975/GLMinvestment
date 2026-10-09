# Team 1: UX Audit — Multi-Persona

> **Audit Date**: 2026-10-09
> **Auditor Method**: agent-browser + direct API curl + source-code inspection
> **Base URL**: `http://localhost:3000/` (Next.js dev via proxy on `:3001`)
> **Auth State at Audit Time**: ❌ `NEXTAUTH_SECRET` missing in env → next-auth credentials callback returns HTTP 500 → **NO USER CAN LOG IN VIA WEB UI** (Google OAuth also broken: `GOOGLE_CLIENT_ID/SECRET` empty → `?error=OAuthSignin`). The audit had to inspect each persona's UI via source-code reading + API endpoint testing with a manually-minted Bearer token (mobile-style `/api/auth/login` works fine — only the NextAuth web flow is broken).
> **Test Account**: `uxaudit_x@test.com` / `TestPass123` (created via `/api/auth/register`).
> **Screenshots**: `/home/z/my-project/audit-reports/screenshots/` (4 PNGs).

---

## Persona 1: مبتدئ تمام (Complete Beginner — first time on a trading platform)

### Frustrations
1. **منصة مسدودة تماماً** (CRITICAL BLOCKER): فتحت `localhost:3000/` لأول مرة، شفت صفحة تسجيل دخول. سجّلت حساب جديد `uxaudit1@test.com`. حسّيت إن الموافقت نجحت (toast "تم إنشاء الحساب بنجاح! يرجى تسجيل الدخول"). جرّبت أدخل البيانات → toast أحمر "حدث خطأ أثناء تسجيل الدخول". مفيش أي توضيح ليه. جرّبت تاني ونفس النتيجة. أهملت وخرجت. (السبب التقني: `NEXTAUTH_SECRET` missing → `/api/auth/callback/credentials` يرجع 500. السكرتيرة التقنية رصدت في logs: `[next-auth][warn][NO_SECRET]` + `getDerivedEncryptionKey` stack trace. أنا كمبتدئ مش هشوف الـ logs دي — أنا بس أشوف إن المشروع معطّل.)
2. **زر Google OAuth ميشتغلش كمان**: ضغطت "الدخول بحساب Google"، الصفحة رجعتني على `/?callbackUrl=...&error=OAuthSignin`. مفيش أي رسالة تقول "فشل الاتصال بـ Google" — الصفحة سكتت كأن مفيش حاجة حصلت. أنا كمبتدئ ممكن أضغط الزر 5 مرات وأفتكر الموقع باظ.
3. **مفيش "نسيت كلمة المرور"**: لو حسّيت إني نسيت، مش هلاقي أي رابط. الـ UX الافتراضي لكل منصة استثمار في الدنيا فيه "نسيت كلمة المرور؟" — هنا مفيش. هضطر أسجل حساب جديد.
4. **"مستوى تحمل المخاطر" في التسجيل**: أنا مبتدئ، مين يقولّي يعني إيه "منخفض - محافظ" vs "متوسط - متوازن" vs "مرتفع - جريء"؟ مفيش tooltip، مفيش شرح، مفيش نصيحة "اختار متوسط لو مش متأكد". أنا هختار عشوائي.
5. **شعار "دليل الاستثمار" عام جداً**: الاسم ميوصفّش المنصة. الصفحة بتقول "البورصة المصرية - استثمر بذكاء" — طب هو الموقع مصري؟ سعودي؟ عالمي؟ شفت في الـ TopBar إنه يدعم 6 أسواق (EGX/TADAWUL/KSE/QSE/US/CRYPTO)، بس الـ tagline بتقول "البورصة المصرية" بس. تناقض بين الاسم والواقع.

### Missing Features
1. **Onboarding flow / Welcome tour**: مفيش شرح مرئي لأول مرة. (في PlatformGuide.tsx فيه Sheet من 5 أقسام، بس بيتفتح بعد 3s من دخول الـ dashboard — وأنا أصلاً مش قادر أوصل للـ dashboard.)
2. **Forgot password / Reset via email**: مفيش طريق أرجّع حسابي لو نسيت كلمة المرور.
3. **Demo/Guest mode**: مفيش زر "تجربة بدون حساب". المبتدئ عايز يشوف المنصة قبل ما يسجّل.

### Confusing Elements
1. **زر بلا اسم** (`button [ref=e21]` في snapshot): جنب خانة كلمة المرور. اكتشفت إنه "إظهار/إخفاء كلمة المرور" لما ضغطت عليه — بس مفيش `aria-label` ولا tooltip واضح. أيقونة Eye/EyeOff كافية بس للمبتدئ قد تكون غامضة.
2. **3 أزرار عملة في الـ Header (ج.م / $ / ر.س)**: ليه USD و SAR بس؟ ليه ما فيش KWD ولا QAR رغم إن المنصة بتدعم الكويت وقطر؟ والإعداد ده مبيخزّنش في localStorage (اتعمل اختبار: localStorage.getItem('display-currency') رجع `null` بعد ما ضغطت كل الأزرار) — فالاختيار بيضيع بعد كل refresh.
3. **خانة البحث "ابحث عن سهم..." في الـ Header على شاشة تسجيل الدخول**: ليه فيه search box قبل ما أسجّل؟ أنا مبتدئ، لو كتبت "COMI" ودوست Enter — مفيش dropdown اقتراحات، مفيش result، الصفحة بتفضل كما هي. (الكود في `Header.tsx:35-40` بيقول `setCurrentView('stocks')` بس الـ AuthGate بيمنع الـ navigation لأن المستخدم مش مسجّل.)

### Score: 1/10
**Reason**: المبتدئ فعلياً مش قادر يدخل المنصة خالص. لو افترضنا إن الـ auth اتصلح، الـ onboarding ناقص ولو تحسّن هيرفع الـ score لـ 5/10. لكن في الحالة الحالية = 1/10.

---

## Persona 2: مستخدم متوسط (Intermediate retail trader — knows basics)

### Frustrations
1. **لازم Google OAuth ولا مفيش دخول** (محدودية قاسية): حتى لو عرفت إن النظام بيطلب Google، الـ Google OAuth نفسه broken في السيرفر التجريبي ده. لو فتحت في production وماعندكش Google account = مش هتقدر تدخل.
2. **خانات البحث مفيهاش Autocomplete**: كتبت "COMI" في الـ Header search، مفيش dropdown بيظهر اقتراحات. لازم أدوس Enter → ينقلني لصفحة الأسهم. لو مش متذكر الـ ticker بالظبط (مثلاً كتبت "commercial" أو "تجاري")، البحث مش هيطلع حاجة. في `/api/stocks/search` endpoint موجود بس الـ UI مش بيستخدمه live.
3. **Watchlist after add مش بيتحدّث live**: أضفت COMI للـ watchlist عبر `POST /api/watchlist`، رجع 200 OK. لكن لما فتحت `GET /api/watchlist`، شفت إن `price: 132.39` و `change_percent: -0.08` — بس في نفس اللحظة `/api/stocks/COMI/unified` بيقول `current_price: 132.5` و `change_percent: 0.3`. **الأسعار مختلفة بين الـ watchlist والـ stock detail!** (الـ watchlist بتقرأ من stocks.db مرة واحدة، الـ unified بيرجع من API مختلف). ده تناقض بيانات مرعب للمتوسط.
4. **الـ rate limit message بالإنجليزي**: بعد 1 محاولة login غلط، الـ API بيرجع `{"error":"rate_limit_exceeded","retry_after_seconds":47}`. مفيش `error_ar`. لو الـ toast اللي بيتعرض للمستخدم بيقول "rate_limit_exceeded" حرفياً → المستخدم العربي مش هيفهم. (الـ UI بيقول "حدث خطأ أثناء تسجيل الدخول" generic، بس لو الـ error_raw اتعرض للمستخدم هيكون فيه فجوة.)
5. **"توقعات اليوم" فاضية**: `/api/predictions/daily-picks` رجّع `"picks":[]` مع رسالة "لا توجد توقعات متاحة لهذا السوق حالياً. يتم توليد التوقعات للسوق المصري أولاً". أنا في السوق المصري (default) — ليه مفيش توقعات لليوم؟ الـ Python backend معطّل (`python-backend: down` من /api/health)، فالـ predictions مش بتتولّد. المتوسط عايز يفتح الصبح يشوف "توقعات اليوم" — مش هيلاقي حاجة.

### Missing Features
1. **Forgot password flow** (نفس مشكلة المبتدئ).
2. **Email verification**: سجّلت بـ `uxaudit1@test.com` — الإيميل مش محتاج verification. ممكن أي حد يسجّل بإيميل وهمي ويستخدم الـ trial 7 أيام. (لاحظت من `email_verified: false` في /api/auth/me — المفروض أعرف إن إيميلي مش متأكد منه.)
3. **Price alerts via email/push**: `/api/alerts` شغّال بس الـ notifications فاضية. مفيش set up واضح لـ "أبعتلي إيميل لما السعر يوصل X". فيه `/api/notifications` و `/api/push/register` في الـ API list، بس الـ UI مش واضح.

### Confusing Elements
1. **"تسجيل الدخول" tab vs "حساب جديد" tab**: الـ tabs بتوع shadcn فيها animation خفيف، بس لما بتبدّل بينهم، الحقول بتتنظّف. لو كتبت email في الـ login tab، بدّلت ل register، رجعت ل login — الحقول فاضية. السلوك ده ممكن يخسّر بيانات المستخدم.
2. **"الدخول بحساب Google" button**: عند الضغط، الصفحة بتعمل redirect كامل (مش modal). لو الـ OAuth فشل، الصفحة بترجع بـ `?error=OAuthSignin` في URL. مفيش toast يقول "فشل الاتصال بـ Google". المتوسط ممكن يحسب إن الموقع وقع.
3. **Header subtitle "مرحباً بك في دليل الاستثمار"** على كل الصفحات (حتى في الـ dashboard). الـ subtitle ده مش بيتبدّل حسب الـ current view — مثلاً لو فاتح "المحفظة"، الـ Header لسه بيقول "مرحباً بك". ده رسالة ترحيب مش page title. (ملاحظة: في `page.tsx` فيه `<Header title={t('auth.loginTitle')} subtitle={t('auth.welcome')} />` hardcoded — يعني لو أنت في الـ stocks view، الـ Header لسه بيقول "تسجيل الدخول / مرحباً بك".)

### Score: 3/10
**Reason**: لو اتصلح الـ auth، الـ platform نقدر نوصل للـ dashboard ونستخدم watchlist. لكن فيه فجوات بيانات خطيرة (price mismatch between watchlist و stock detail)، والـ daily predictions مفقودة. المتوسط هيحتاج يشتغل حوالي الـ Python backend بنفسه عشان يقدر يستفيد. = 3/10.

---

## Persona 3: محترف (Pro trader — daily trader, wants precision)

### Frustrations
1. **`/api/stocks/COMI/history` يرجع 404 "Failed to fetch history"**: ده الـ endpoint اللي بيجيب candlestick data للشارت. من `/tmp/next.log`: `SqliteError: no such column: open_price` — DB schema mismatch. الـ charts مش هتشتغل. أنا كمحترف، الشارت هو أهم حاجة. = المنصة بلا قيمة.
2. **Market Depth بيانات synthetic/wrong**: `/api/stocks/COMI/depth` بيرجع bids/asks. لكن:
   - `bids[0].price = 132.5 = asks[0].price = 132.5 = current_price` — البيد والأسك عند نفس السعر؟ مستحيل في سوق حقيقي.
   - `asks[0].volume = 4` (أسهم؟) مقابل `bids[0].volume = 2,284,054`. الأرقام مش منطقية.
   - `/api/stocks/COMI/orderbook` بيرجع `{"bids":[],"asks":[],"source":"empty","note":"No real orderbook data available for this symbol"}` — اعتراف صريح إنه مفيش orderbook حقيقي. كمحترف، لو شفت "no real orderbook" = هقفل التبويب.
3. **Money flow / Liquidity flow كلها null**: `/api/flow/COMI` بيرجع:
   ```
   volume: 0, value_traded: 0,
   buy_pressure: null, sell_pressure: null, net_flow: null
   ```
   والـ message: `"Python backend unreachable — using stocks.db data (no order-flow breakdown)"`. كمحترف، أنا محتاج أعرف مين بيشتري ومين بيبيع (أجنبي/عربي/إفرادي) — المنصة بتقول صراحة إنها مفيشاهاش.
4. **`/api/market/liquidity-flow` يرجع 500 "internal_error"**:Sector flow + top inflow + top outflow كله فاضي. كمحترف، أنا بستنى الـ morning session أتفرّج على تدفّق السيولة — المنصة مش بتوفرها.
5. **RSI/ATR/MA200 كلها null**: من `/api/stocks/COMI/unified`:
   ```
   rsi: null, ma_200: null, atr: null,
   signal_raw: 0, technical_score: null
   ```
   يعني مفيش لا RSI ولا ATR ولا moving average 200. الـ "signal" = 0 (محايد). أنا كمحترف ببنى قراراتي على المؤشرات دي — كلها null = المنصة مش قادرة تديني signal.

### Missing Features
1. **Real-time price feed**: الأسعار `last_update: 2026-07-10` = بيانات من 3 شهور فوّت! كمحترف، أنا محتاج أسعار live أو at least end-of-day. الـ WS service على port 3005 معطّل (من /api/health: `ws-service: down`).
2. **Level 2 / Order book depth (5 levels)**: مفيش بيانات حقيقية. الـ "depth" اللي بيرجع synthetic.
3. **Hotkeys / Keyboard shortcuts**: محترف بيستخدم `J/K` للتنقل بين الأسهم، `B` لـ buy، `S` لـ sell. مفيش حاجة من دي.

### Confusing Elements
1. **"توقعات اليوم" widget vs "متابعة التوقعات" tab**: الاتنين بيتسمّوا توقعات. الـ widget على الـ dashboard بياخد من `/api/predictions/daily-picks` (فاضي)، والـ tab بياخد من `/api/predictions/honest-tracking/list` (فيه predictions قديمة من 2026-06-25 — 4 شهور قديمة). الأسماء بتشتت.
2. **`signal: 0` و `trend: "neutral"`**: كل الأسهم اللي فحصتها بترجع neutral/0. مفيش شرح ليه — هل ده لأن البيانات قديمة؟ ولا لأن الـ signal engine معطّل؟ لما بفتح `/api/market/regime` بيرجع `"regime":"NORMAL"` مع `"confidence":0` — confidence = صفر = مفيش ثقة في الـ regime.
3. **"Professional analysis" endpoint deprecated بـ 410**: `/api/stocks/COMI/professional-analysis` بيرجع:
   ```
   {"deprecated":true,"error_ar":"تم إيقاف هذا الـ endpoint — استخدم /api/stocks/COMI/recommendation بدلاً منه."}
   ```
   لو الـ UI لسه بيستدعي الـ endpoint ده، المستخدم هيشوف error. لاحظت إن الـ route اسمه لسه موجود في `/api/stocks/[ticker]/professional-analysis/route.ts` — مين اللي بيتصل بيه؟ لو في component لسه بيتصل بيه، هيتكسّر.

### Score: 2/10
**Reason**: كل اللي بياخد قرار تداول (RSI, orderbook, money flow, live prices, charts) معطّل أو null. البيانات قديمة 3 شهور. محتاج Python backend شغّال + WS service + scraper daily. المحترف هيخرج بعد 30 ثانية. = 2/10.

---

## Persona 4: مستثمر طويل الأجل (Long-term investor — fundamentals + dividends)

### Frustrations
1. **الأساسيات ناقصة**: `/api/stocks/COMI/unified` الـ fundamentals:
   ```
   pe_ratio: null, ps_ratio: null, roa: null, beta: null
   ```
   COMI هو أكبر بنك في EGX بـ market cap = 449 مليار جنيه — ومع ذلك مفيش P/E ratio. المستثمر طويل الأجل بيقارن بين البنوك بناءً على P/E و ROE و ROA — و ROA = null.
2. **`/api/sectors/tracking` يرجع 502**: "فشل في الاتصال بـ Python Backend". المستثمر طويل الأجل بيدرسي القطاعات قبل ما يختار سهم — تتبّع القطاعات معطّل.
3. **`/api/seasonality-signals` يرجع 503 "internal_error"**: المستثمر طويل الأجل عايز يعرف "هل سهم COMI بيرتفع في يناير عادةً؟ هل بيتوزّع أرباح في مارس؟" — الـ seasonality معطّل.
4. **التوزيعات (dividend_yield) متاحة لكن مش مفصّلة**: `dividend_yield: 6.37` لـ COMI. لكن مفيش history: آخر 5 سنين توزيعات كام؟ هل التوزيعة نقد ولا أسهم؟ مفيش `/api/stocks/COMI/dividends` endpoint. (بحثت في `src/app/api/stocks/[ticker]/` — مفيش ملف dividends.)
5. **آخر تحديث للبيانات من 3 شهور**: `last_update: 2026-07-10`. أنا في 2026-10-09. القيمة السوقية، السعر، الأساسيات كلها قديمة. لو فتحت أي سهم، أنا بصرافة بأرقام قديمة. لا يمكن أخذ قرار استثماري طويل الأجل على بيانات عمرها 3 شهور.

### Missing Features
1. **Dividend history chart**: كل سهم بيتداول ليه history of dividends (آخر 5-10 سنين) — مفيش.
2. **Financial statements (income/balance/cashflow)**: مفيش `/api/stocks/COMI/financials` endpoint. المستثمر طويل الأجل محتاج يدرس القوائم المالية.
3. **ESG / Corporate governance ratings**: غير موجودة. المستثمر المؤسسي بيدور عليها.
4. **Comparison tool**: "قارن COMI مع HDBK و ADIB" — مفيش feature للقياس المتوازي لأكثر من سهم.
5. **Analyst estimates / price targets**: مفيش.

### Confusing Elements
1. **`profit_margin: 0` و `debt_to_equity: 0`**: في `/api/stocks` endpoint (the list view)، كل الأسهم بترجع `profit_margin: 0` و `debt_to_equity: 0`. هل ده يعني إن الشركات مفيهاش ديون وربحها صفر؟ أو هل `0` تعني "مفيش بيانات"؟ لازم القيمة `null` لو مفيش، مش `0` (لأن `0` معناها مختلف تماماً في المالية).
2. **Sector name `"القطاع المالي"` لـ COMI** بس `industry: null`: القطاع موجود بس الـ industry (Banking) فاضي. لو بتصفّي بـ industry = "Banking"، COMI مش هيظهر.
3. **`roe: 18` بدون وحدة**: 18%؟ 18 مرة؟ 18 Basis point؟ لازم unit واضحة. (في الواقع 18 تعني 18% لكن ده مش موثّق.)

### Score: 3/10
**Reason**: فيه بيانات أساسية (sector, ROE, EPS, dividend_yield) لكنها ناقصة وفيها nulls كتير. البيانات قديمة 3 شهور. مفيش dividend history ولا financial statements. المستثمر طويل الأجل ممكن يشوف الـ overview بس مش هيقدر يبني قرار استثماري مبنى على المنصة بس. = 3/10.

---

## Persona 5: صايع معلم (Cynical expert — looks for every mistake, tests every corner)

### Frustrations
1. **CRITICAL SECURITY: `NEXTAUTH_SECRET` مفقود** = كل محاولات الـ web login فاشلة. أي حد يفتح الموقع في السيرفر ده مش هيقدر يدخل. السكّرتيرة التقنية اللي عملت audit قبل كده كانت بتشتكي من "login prompt keeps appearing" — السبب الحقيقي هو إن `NEXTAUTH_SECRET` مش متعرّف. (مصدر: `/proc/11054/environ` ما فيهوش NEXTAUTH_SECRET؛ `next-auth/jwt/index.js:100` بيرمي `getDerivedEncryptionKey` error.)
2. **CRITICAL: Google OAuth مكسور**: `GOOGLE_CLIENT_ID=""`, `GOOGLE_CLIENT_SECRET=""` (fallback empty strings في `[...nextauth]/route.ts:45-46`). ضغطت "الدخول بـ Google" → URL بيرجع `?error=OAuthSignin` → مفيش أي user feedback. السكريبت بيتعامل مع الـ error كأنه مش ليه لازمة — مع إن ده الـ primary auth path للمستخدم العادي.
3. **CRITICAL: مخالفات SQL injection محتملة**:
   - `register/route.ts` يستخدم `db.user.findUnique({ where: { email: email.toLowerCase().trim() }})` — Prisma-parametrized ✓ آمن.
   - بس `db.user.findFirst({ where: { OR: [{ email: identifier }, { username: identifier }] }})` في `[...nextauth]/route.ts:161-168` كمان Prisma-parametrized ✓ آمن.
   - لكن في `token-helper.ts:280` بيستخدم `db.$executeRawUnsafe(query, ...params)` مع `query` string concatenation. لو الـ `tokenId` جاي من مستخدم (مثلاً من header)، ممكن يكون SQL injection. (لم أتأكد، لكن `executeRawUnsafe` دايماً أحمر flag.)
4. **CRITICAL DATA QUALITY: سهم ticker = "TWSATAWASOA FOR FACTORINGD"**: في `/api/stocks?market=EGX&page_size=2`، الـ stock رقم 956 ليه:
   ```
   ticker: "TWSATAWASOA FOR FACTORINGD"
   name: "TWSATAWASOA FOR FACTORINGD"
   name_ar: "TWSATAWASOA FOR FACTORINGD"
   sector: "—"
   ```
   ده اسم سهم مشوه — كأن الـ ticker والاسم اتدمجوا مع بعض، أو الـ scraper كتب في خانة غلط. أي مستخدم هيشوف ده = هيخرج فوراً. (الاسم الصحيح للسهم ده على الأرجح "Tasa Workforce" أو "Tawasoa for Factoring".)
5. **CRITICAL: `support` (125.81) > `current_price` (60.31) في ASCM**:
   ```
   ASCM (اسيك للتعدين):
   current_price: 60.31
   support: 125.81  ← أعلى من السعر الحالي بمرة ونص!
   resistance: 144.75
   low_52w: 56.13
   high_52w: 60.31  ← = current_price (يعني آخر تحديث كان عند الـ high)
   close: 0  ← سعر الإغلاق = 0؟!
   ```
   ده منطقياً مستحيل: support لازم تحت السعر، resistance فوق. القيم دي synthetic/generated من algo مكسور. أي تاجر هيلاحظ ويعتبر المنصة بتفبرك أرقام.

### Missing Features (from cynical expert perspective)
1. **Bug report / feedback mechanism visible**: فيه "أرسل رأيك أو أبلغ عن مشكلة" button — جربته، بيفتح modal. لكن هل بيوصل لـ DB؟ `POST /api/feedback` موجود. كويس. لكن المستخدم مش بيشوف status.
2. **Error tracking visible to user**: مفيش. الـ errors بتظهر بس في server logs. المستخدم مش بيشوف "حدث خطأ X — تم إبلاغ المطورين".
3. **Rate limit feedback واضح**: `rate_limit_exceeded` بالإنجليزي، مفيش عربي.

### Confusing Elements
1. **Two parallel auth systems**: `/api/auth/login` (mobile-style, works ✓) vs `/api/auth/callback/credentials` (NextAuth, broken ✗). الـ AuthView component بيستخدم الـ NextAuth path → مكسور. الـ mobile app بيستخدم الـ direct login path → شغّال. ليه فيه systemين؟ ده red flag للـ code quality.
2. **`MOHSENY_HASH` backdoor removed but comments لسه موجودة**: `[...nextauth]/route.ts:201-211` فيه تعليق بيشرح إن الـ hardcoded bcrypt hash اتشال. كويس إنه اتشال. بس وجود التعليق بـ "FIX-P1-SECURITY (CRIT-6)" بيدل على إن فيه تاريخ مشاكل أمنية. (Cynical expert بيدوّر على patterns زي دي.)
3. **`admin_session` cookie name = "dev-session-token-2026"**: الـ ADMIN_SESSION_TOKEN في `.env` = `dev-session-token-2026`. لو الـ env file ده يعتبر secret، ده ضعيف جداً (string predictable). لو حد عرف الـ env file، يقدر يدخل كأدمن بدون كلمة مرور (set cookie + verifyAdminRequest بيقبل الـ cookie ده).
4. **`/api/auth/login` مبيرجّعش SameSite/HttpOnly cookie**: الـ response بيرجع `token` في JSON body، والمفروض الـ client يخزّنه في localStorage. ده vulnerable لـ XSS. (Mobile apps بتعمل كده عادي بس الـ web المفروض يستخدم HttpOnly cookies.)
5. **Proactive tier upgrade في `/api/auth/me` line 59-63**: لو المستخدم admin بالـ email، الـ API تلقائياً بيعمل `db.user.update` لـ tier='admin'. ده race condition محتمل (لو user اثنينين في نفس اللحظة). + الـ `db.user.update(...).catch(...)` مش `await`-ed — يعني الـ response ممكن يرجع قبل ما الـ DB update يخلص. (موجود في line 59, 113 — في 3 أماكن.)

### Score: 2/10
**Reason**: ممتاز في الأشياء البادية احترافية (rate limit, bcrypt, error boundary, 404 page, i18n) — لكن البيانات فيها قمامة (ASCM support 125 vs price 60، stock ticker اسمه garbage)، فيه dual auth systems، admin_session cookie ضعيف، وكل الخدمات اللي بتعتمد على Python معطّلة. الصايع هيلاقي 50 مشكلة في 5 دقايق. = 2/10.

---

## Summary

### Common Issues Across All Personas
1. **AUTH BLOCKER (CRITICAL)**: `NEXTAUTH_SECRET` missing → المستخدم العادي اللي بيستخدم web UI مش قادر يدخل. / Google OAuth env vars فاضية → حتى Google ما يشتغلش. → **NO PERSONA CAN ACCESS THE PLATFORM via web UI** in current sandbox state. (Mobile-style `/api/auth/login` works but the AuthView component uses the broken NextAuth path.)
2. **Python backend down**: `/api/health` بيقول `python-backend: down, port:8010`. ده بيفصل: sectors tracking (502), AI chat (503), explosive stocks (503), market status (503), seasonality (503), money flow (500), daily-picks (empty), confluence analyze (degraded).
3. **WebSocket service down**: `ws-service: down, port:3005`. لا real-time prices, لا live notifications.
4. **Stale data**: كل الأسعار بـ `last_update: 2026-07-10` = 3 شهور قديمة.
5. **DB schema mismatch**: `/api/stocks/COMI/history` بيرجع 404 بسبب `no such column: open_price`.
6. **Data quality issues**: سهم اسمه `"TWSATAWASOA FOR FACTORINGD"`، ASCM support (125.81) > current price (60.31)، `close: 0`، `profit_margin: 0` بدل null.
7. **Generic error messages**: كل الـ catch blocks بترجع "حدث خطأ أثناء تسجيل الدخول" / "حدث خطأ أثناء إنشاء الحساب" — مفيش context للمستخدم.

### Critical UX Gaps
| Gap | Severity | Affected Personas |
|---|---|---|
| NEXTAUTH_SECRET missing → Web login impossible | 🔴 P0 | ALL |
| Google OAuth env vars empty | 🔴 P0 | ALL |
| Python backend down (sectors, AI, predictions) | 🔴 P0 | P3, P4 |
| `/api/stocks/[ticker]/history` 404 (no charts) | 🔴 P0 | P3 |
| Stock data 3 months stale | 🔴 P0 | ALL |
| Garbage data: `TWSATAWASOA FOR FACTORINGD` stock name | 🔴 P0 | ALL |
| Wrong support/resistance (ASCM support > price) | 🟠 P1 | P3, P5 |
| Watchlist price vs unified price mismatch | 🟠 P1 | P2 |
| Orderbook empty (`source: "empty"`) | 🟠 P1 | P3 |
| Money flow all null | 🟠 P1 | P3 |
| RSI/ATR/MA200/PE/Beta all null | 🟠 P1 | P3, P4 |
| Subscription plans list empty | 🟠 P1 | ALL (can't upgrade) |
| Currency preference not persisted to localStorage | 🟡 P2 | ALL |
| Search box has no autocomplete dropdown | 🟡 P2 | P2, P3 |
| No "Forgot password" flow | 🟡 P2 | ALL |
| No email verification | 🟡 P2 | ALL |
| Header subtitle hardcoded as "مرحباً بك" on all views | 🟡 P2 | ALL |
| Rate limit error in English only | 🟡 P2 | ALL |
| Tagline inconsistency: AR="البورصة المصرية" vs EN="Smart Investing" | 🟡 P2 | ALL |
| PersonaSelector disabled (commented out) | 🟡 P2 | ALL |
| Deprecated `/api/stocks/[ticker]/professional-analysis` still exposed | 🟢 P3 | P5 |

### Priority Recommendations
1. **P0 — Fix auth immediately**: Set `NEXTAUTH_SECRET` (32+ random chars) in `.env` AND configure real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (or temporary dev OAuth credentials). Without this, no persona can use the platform.
2. **P0 — Restart Python backend**: `cd /home/z/my-project && python3 daily_predictor.py` (or whatever entrypoint). Without this, sectors/AI/predictions/money-flow all return 5xx.
3. **P0 — Fix DB schema**: Run `prisma migrate` for `open_price` column on price_history.db. Without this, charts return 404.
4. **P0 — Run data scraper**: Stock prices are 3 months stale. Re-run the daily scraper to refresh `last_update` to today.
5. **P0 — Audit + clean stock list**: Remove `TWSATAWASOA FOR FACTORINGD` and any other garbage stock rows. Validate ticker/name/sector fields.
6. **P0 — Re-check support/resistance logic**: For ASCM, `support: 125.81` while `current_price: 60.31` is wrong. The computation engine is buggy.
7. **P1 — Show user-friendly errors**: When `/api/auth/callback/credentials` returns 500, the AuthView should show "تعذّر تسجيل الدخول بسبب مشكلة فنية. يرجى المحاولة لاحقاً." instead of generic "حدث خطأ".
8. **P1 — Add forgot password flow**: Standard for any platform handling user accounts.
9. **P1 — Persist currency preference**: 3 lines of code in `Header.tsx` — `localStorage.setItem('display-currency', code)` on click.
10. **P1 — Add autocomplete to search box**: Use `/api/stocks/search` endpoint with debounced input. Show dropdown with 5 matches.
11. **P2 — Sync watchlist prices with stock detail prices**: Both should call the same data source, or watchlist should poll every 30s.
12. **P2 — Hide deprecated endpoints**: Remove or 301-redirect `/api/stocks/[ticker]/professional-analysis` → `/api/stocks/[ticker]/recommendation`.
13. **P2 — Add Arabic translations for rate limit errors**: Add `error_ar: "تجاوزت الحد المسموح. حاول بعد X ثانية"` to `/api/auth/login` rate-limit response.
14. **P2 — Make Header subtitle dynamic**: Use the current view's name (e.g., "المحفظة" when in #portfolio) instead of hardcoded welcome message.

### Methodology Note (Honest Disclosure)
Due to the auth blocker, this audit was performed via:
- Source-code reading of: `page.tsx`, `AuthView.tsx`, `AuthGate.tsx`, `Header.tsx`, `TopBar.tsx`, `MobileNav.tsx`, `DashboardView.tsx`, `valid-views.ts`, `[...nextauth]/route.ts`, `register/route.ts`, `token-helper.ts`, `admin-auth-server.ts`, `useAuthCheck.ts`, `me/route.ts`, `not-found.tsx`, `error.tsx`, `DisclaimerBanner.tsx`, `PlatformGuide.tsx`, `db.ts`, `db-auth.ts`, `i18n messages/ar.json + en.json`.
- API endpoint testing with a manually-minted Bearer token (created directly in `auth.db` via better-sqlite3) for endpoints requiring authentication.
- Browser inspection via agent-browser for the unauthenticated login page (UX, mobile responsiveness, dark mode, 404 page).
- Direct curl testing of 25+ API endpoints to map data quality and error handling.

I could NOT visually inspect the dashboard, watchlist, portfolio, recommendations, market-depth, or any authenticated view in a browser. The UX findings for personas 2-5 are inferred from source code + API responses, not from actual rendered UI. **Recommend re-running this audit after fixing the `NEXTAUTH_SECRET` env issue** to validate the UI/UX of authenticated views.
