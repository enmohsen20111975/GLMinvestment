# 🚨 سجل الخروقات (Breach Log)

> كل خرق لقواعد الدستور أو الانضباط الهندسي يُسجّل هنا — علناً، بالتاريخ، بالمسؤول، بالإصلاح.
> الهدف: الشفافية الكاملة. مفيش خرق يختفي. مفيش إهمال يتكرر.
>
> **آخر تحديث:** 2026-10-03 (Task `DOC-20` — Documentation Secretariat (Wave 7 — Data + Chart docs): إضافة BREACH-007 + BREACH-008 + BREACH-009 — 3 خروقات اكتُشفت في Task 18-A forensic data audit + Task 19 TV chart quality audit وصُلحت في Wave 7 (Task IDs `FIX-1` + `FIX-2` + `P0-1`..`P0-5` chart). BREACH-007: Rule 24 violation (chart showed fake `session_intraday` data to 20+ customers). BREACH-008: Rule 12 violation (`price_history.db` 26-year data discarded due to 3-day staleness check). BREACH-009: owner directive "DBs from GitHub" impossible — DBs were deleted in Wave 2 cleanup; recovered from git history. كل خرق موثّق بالتاريخ + السبب الجذري + الإصلاح + commit hash. Per Rule 62 + Rule 63 + README editing rule 1.)
>
> **تحديثات سابقة:**
> - 2026-10-02 (Task `DOC-17` — Documentation Secretariat (Final P0 Documentation): إضافة BREACH-003 + BREACH-004 + BREACH-005 + BREACH-006 — 4 خروقات لـ Rule 50 (MONEY-AS-CUSTOMER-LIFE) + Rule 16 (VERIFY with evidence) اكتُشفت في Task 16-A forensic audit (payment + subscription system) وصُلحت في Wave 6 (Task IDs `P0-1` → `P0-5`). كل خرق موثّق بالتاريخ + السبب الجذري + الإصلاح + commit hash. Per Rule 62 + Rule 63 + README editing rule 1.)
> - 2026-10-01 (Task `DOC-CONSOLIDATION` + إضافة Rule 63 — توثيق BREACH-001 + BREACH-002).

---

## BREACH-001 — فقدان شغل الموجة 1 بسبب عدم الـ push

| الحقل | القيمة |
|---|---|
| **التاريخ** | 2026-10-01 (بين 14:00 و 17:00 UTC) |
| **النوع** | خرق Rule 62 (GIT-PUSH-DISCIPLINE) |
| **المسؤول** | المدير العام (Z.ai) |
| **الوصف** | تم تنفيذ الموجة 1 كاملة (4 إصلاحات P0 + 21 اختبار QA + 3 وثائق مرجعية) في commits محلية بدون push. بين رسالتين من المالك، الساندبوكس اتـ reset لـ snapshot من 2026-09-26، فكل شغل الموجة 1 (commit `5ba99c3` + ملفات `AUDIT-2026-10-01-HONEST-REVIEW.md` + `BOARD-OF-DIRECTORS-PLAN-2026-10-01.md` + `RETRACTION-console-error-claim.md` + `scripts/_fix_america_to_us.py` + `vps-service/tools/run_backtest_versions.py` + 3 test suites + ~6,700 سطر worklog) **ضاع تماماً** ومش موجود لا محلياً ولا على GitHub. |
| **السبب الجذري** | كسل إداري — الاعتماد على commits محلية كـ "checkpoint" بدون push فوري. الانفصال بين "عرفت القاعدة" و"طبّقت القاعدة". |
| **التأثير** | ضياع ~3,853 سطر كود/اختبار/توثيق. خسارة الوقت المعاد تنفيذه. اهتزاز ثقة المالك. |
| **الإصلاح** | (1) إنشاء هذا السجل. (2) إضافة Rule 63 (PUSH-AFTER-EVERY-COMMIT) للدستور. (3) إعادة بناء الموجة 1 بـ push بعد كل ملف. (4) مراجعة كل task يخلص بـ `git push` إلزامي قبل اعتباره done. |
| **الحالة** | 🔴 مفتوح — حتى اكتمال إعادة البناء + push كامل |

---

## BREACH-002 — رسائل commit بصيغة UUID

| الحقل | القيمة |
|---|---|
| **التاريخ** | قبل 2026-10-01 |
| **النوع** | خرق Rule 62 (NO UUID commit messages) |
| **المسؤول** | وكلاء سابقون |
| **الوصف** | commit `57614f1` برسالة `f7833016-266e-427f-a7eb-be20df6f21d3` — UUID بدل رسالة وصفية. |
| **الإصلاح** | Rule 62 اتضاف بالفعل (2026-10-01). كل commit لاحق لازم يكون برسالة وصفية. |
| **الحالة** | 🟡 مغلق جزئياً — القاعدة موجودة، بس الـ UUID commits القديمة لسه في الـ history |

---

## BREACH-003 — Paymob callback رفض `m2y-` prefix (مستخدمون دفعوا ولم يتم ترقيتهم)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-02 (Task `16-A` forensic audit — payment + subscription system) — الخرق كان موجوداً من تنفيذ PricingView الجديد. |
| **النوع** | خرق Rule 50 (MONEY-AS-CUSTOMER-LIFE) — خسارة إيرادات مباشرة + خرق Rule 16 (VERIFY with evidence) لأن الخرق لم يُكتشف بدون audit. |
| **المسؤول** | الوكيل الذي نفّذ PricingView الجديد بدون تحديث `/api/paymob/callback/route.ts` ليتعرّف على prefix الطلبات الجديد. |
| **الوصف** | `/api/subscription/checkout/route.ts` يُنشئ `merchant_order_id` بـ prefix `m2y-{tier}-{userIdSuffix8}-{ts}` (flow جديد من PricingView). لكن `/api/paymob/callback/route.ts:88` كان يقبل فقط الـ prefix القديم `GLM-` (legacy SubscriptionView flow). نتيجة: أي مستخدم دفع عبر PricingView الجديد، الـ callback بيرجّع `{success:false, error:'Invalid merchant order ID'}` وبيتم redirect لـ `/subscription?payment=failed` — **مع أن المستخدم دفع بالفعل**. الـ defense-in-depth endpoint `/api/subscription/activate` اللي ممكن يفعّلهم — مش بيُستدعى من الـ frontend. خسارة إيرادات مباشرة لكل عميل دفع عبر flow الجديد. |
| **السبب الجذري** | انفصال prefix بين الـ checkout flow الجديد (PricingView) والـ callback handler — تكامل نصفي. لم يُختبر end-to-end بعد إضافة PricingView. |
| **التأثير** | (1) خسارة إيرادات مباشرة لكل مستخدم دفع عبر PricingView الجديد. (2) فقدان ثقة المستخدم (دفع ولم يحصل على الترقية). (3) أي manual recovery مفيش — الـ activate endpoint مش بيُستدعى. |
| **الإصلاح** | Task `P0-1` (Fix Battalion — 2026-10-02): `processPaymentResult()` في `src/app/api/paymob/callback/route.ts` بيقبل دلوقتي **BOTH** `GLM-` (legacy parse userId + planId مباشرة) و `m2y-` (parse tier + userIdSuffix، بعدها DB lookup بـ suffix مع collision detection — fails safe if ambiguous). Defense-in-depth محفوظ: HMAC verify (fail-closed) + planId allowlist + amount cross-check. **Commits:** `4be0e77` (callback accepts both prefixes — +48/-8 LOC) + `9e1f93e` (hotfix: add missing `authDb` import — 1 LOC runtime crash fix). |
| **التحقق** | (1) PricingView checkout flow بـ يرقّي المستخدمين صح بعد Paymob callback ناجح. (2) legacy `GLM-` flow لسه شغّال (backward-compatible). (3) `bun run lint` EXIT 0. |
| **الحالة** | 🟢 مغلق — Task `P0-1` (Fix Battalion) 2026-10-02 — commits pushed per Rule 63. |

---

## BREACH-004 — لا يوجد آلية لانتهاء الاشتراك (premium للأبد بعد دفعة واحدة)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-02 (Task `16-A` forensic audit — payment + subscription system) — الخرق كان موجوداً منذ إنشاء نظام الاشتراكات. |
| **النوع** | خرق Rule 50 (MONEY-AS-CUSTOMER-LIFE) — خسارة إيرادات هيكلية + خرق Rule 16 (VERIFY with evidence). |
| **المسؤول** | الوكيل الذي نفّذ نظام الاشتراكات بدون آلية expiry enforcement. |
| **الوصف** | `/api/paymob/callback/route.ts` بيـ set `UserSubscription.expires_at = NOW + 30 days` و `User.subscription_tier = planId`. بعد 30 يوم، `UserSubscription.status` بتتحدّث لـ `'expired'` (في `/api/subscription/current`) بس `User.subscription_tier` **مابيتـ downgrade لـ `'free'` أبداً**. `checkTrialNotExpired()` بيفحص فقط `subscription_tier` (paid = bypass) → المستخدمون الـ paid بيمسكوا كل امتيازات الـ premium **للأبد** بعد أول دفعة. مفيش cron job. مفيش reconciliation. خسارة إيرادات هيكلية. |
| **السبب الجذري** | `UserSubscription.expires_at` column موجود بس الـ trial gate ما كانش بيقراه. الفصل بين الـ "data model" والـ "enforcement logic". |
| **التأثير** | (1) خسارة إيرادات متكررة (MRR) لكل مستخدم paid بعد أول شهر. (2) تشويه لـ metrics التحويل (conversion numbers تبدو أقل من الواقع لأن المستخدمين مش بيتـ downgrade). (3) الـ "churn rate" الحقيقي مفيش. |
| **الإصلاح** | Task `P0-2` (Fix Battalion — 2026-10-02): **(Part 1 — runtime gate)** Added `isPaidSubscriptionActive()` helper في `src/lib/subscription-gate.ts:193-261` اللي بيقرا `UserSubscription.expires_at` (60s cache) وبيـ return `false` بعد expiry. `checkTrialNotExpired()` (line 282-352) دلوقتي بـ consult ده وبيعامل الـ paid-expired users كـ free (trial gate بيشتفعل). Fail-open behavior محفوظ per Rule 50 (أحسن من lockout paying customer وقت DB hiccup). **(Part 2 — daily cron)** `scripts/downgrade-expired-subscriptions.ts` بيشتغل يومياً لـ reconcile — بيـ flip `UserSubscription.status` لـ `'expired'` لـ rows مع `expires_at < now` AND بـ downgrade `User.subscription_tier` لـ `'free'` لو مفيش اشتراك نشط تاني. **Commits:** `ada95f5` (gate fix — `src/lib/subscription-gate.ts`) + `fbd01b4` (daily cron script — `scripts/downgrade-expired-subscriptions.ts`). |
| **التحقق** | (1) `isPaidSubscriptionActive()` بيرجّع `false` لـ `expires_at < now`. (2) `checkTrialNotExpired()` بيشتفع trial gate لـ expired paid users. (3) Cache staleness window: 60s (acceptable per Rule 50). (4) `bun run lint` EXIT 0. |
| **الحالة** | 🟢 مغلق — Task `P0-2` (Fix Battalion) 2026-10-02 — commits pushed per Rule 63. |

---

## BREACH-005 — أكواد الـ promo بتمنح premium دائم (مش محددة بمدة)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-02 (Task `16-A` forensic audit — payment + subscription system) — الخرق كان موجوداً منذ إنشاء `/api/redeem-promo/route.ts`. |
| **النوع** | خرق Rule 50 (MONEY-AS-CUSTOMER-LIFE) — خسارة إيرادات مباشرة + خرق Rule 16 (VERIFY with evidence). |
| **المسؤول** | الوكيل الذي نفّذ `/api/redeem-promo/route.ts` بدون كتابة `UserSubscription` row. |
| **الوصف** | `/api/redeem-promo/route.ts:252-258` كان بـ upgrade `subscription_tier` لـ `'premium'` وبيـ set `trial_ends_at = now + premium_days`. لكن `subscription_tier='premium'` موجود في `PAID_TIERS`، فالـ trial check بـ bypass كلياً — الـ `trial_ends_at` extension ما كانش ليه أي تأثير. المستخدم بياخد **premium دائم** من كود promo واحد، مش 30 يوم زي ما الـ comment بيقول. كل كود promo = خسارة إيرادات مدى الحياة. |
| **السبب الجذري** | Promo redemption بـ يـ mutate `User` table بس، ما كانش بـ يكتب `UserSubscription` row اللي `isPaidSubscriptionActive()` بـ consult ده. الفصل بين "tier assignment" و"subscription row creation". |
| **التأثير** | (1) خسارة إيرادات مدى الحياة لكل كود promo مستخدم. (2) الـ promo abuse (ممكن حد يـ create أكواد كتير وياخد premium دائم). (3) تشويه لـ promo ROI metrics. |
| **الإصلاح** | Task `P0-3` (Fix Battalion — 2026-10-02): الـ route دلوقتي بـ upsert `UserSubscription` row مع `status='active'`، `expires_at = now + premium_days` (ممتد من latest active window — بيمنع SHORTENING paid window)، `payment_method='promo_code'`، **داخل نفس الـ transaction** كـ promo usage increment + user tier update. Plan_id FK safety: بيـ fall back لـ `'premium'` لو الـ promo's `plan_tier` مش موجود في `SubscriptionPlan`. مع P0-2 expiry check، premium access دلوقتي بـ ينتهي فعلاً بعد `PromoCode.premium_days` يوم (default 30). **Commit:** `a6425b8` (`src/app/api/redeem-promo/route.ts` +109/-60 LOC). |
| **التحقق** | (1) Promo redemption atomic — لو الـ upsert فشل، الـ promo code ما بيتم استهلاكه (المستخدم يقدر يعيد). (2) Verified بـ code inspection لـ `$transaction` boundary. (3) `bun run lint` EXIT 0. (4) Combined مع P0-2's `isPaidSubscriptionActive()` — premium من promo بـ ينتهي بعد `premium_days`. |
| **الحالة** | 🟢 مغلق — Task `P0-3` (Fix Battalion) 2026-10-02 — commit pushed per Rule 63. |

---

## BREACH-006 — مستخدمو B2B قابلون للحذف بواسطة cleanup cron (PAID_TIERS mismatch)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-02 (Task `16-A` forensic audit — payment + subscription system) — الخرق كان موجوداً منذ تنفيذ `/api/admin/users/cleanup-expired/route.ts`. |
| **النوع** | خرق Rule 50 (MONEY-AS-CUSTOMER-LIFE) — **حذف عملاء B2B يدفعون** + خرق Rule 16 (VERIFY with evidence). هذا أشد أنواع خرق Rule 50 — حذف بيانات العميل المدفوع. |
| **المسؤول** | الوكيل الذي نفّذ `/api/admin/users/cleanup-expired/route.ts` بـ inline `PAID_TIERS` array ناقصة. |
| **الوصف** | 3 divergent inline `PAID_TIERS` arrays كانت موجودة في 3 ملفات: `/api/subscription/status:43` (7 tiers، NO `normal`، NO `enterprise`) + `/api/admin/users:148` + `cleanup-expired:30` (6 tiers، NO `b2b_*`، phantom `enterprise`) + `subscription-gate.ts:364` (9 tiers، superset). النتيجة الكارثية: `b2b_starter` users كانوا PAID في `subscription/status` بس FREE في `admin/users/cleanup-expired` → الـ cleanup cron بيرجّع الـ B2B paying customers كـ deletion candidates و**بيحذف accountsهم + كل dataهم** بعد 30+7 أيام. هذا خرق مباشر لـ Rule 50 — حذف بيانات عملاء B2B المدفوعين. كمان `normal` users كانوا FREE في `subscription/status` بس PAID في `admin/users` (trial check inconsistent). |
| **السبب الجذري** | كل consumer عرّف inline list محلياً — مفيش canonical source. الـ drift بين القوائم سبب تصنيف مختلف لكل tier. |
| **التأثير** | (1) **حذف B2B paying customers** + كل بياناتهم (Rule 50 breach — أشد نوع). (2) `normal` users بـ يحصلوا على inconsistent trial treatment. (3) `enterprise` tier users ما بيتحسبوا كـ paid في Telegram bot (`/api/bot/check-subscription:36`). (4) `normal` + `enterprise` users اللي يكملوا payment ما بيشوفوش الـ success UI (بيقعدوا عالقين على "processing"). |
| **الإصلاح** | Task `P0-5` (Fix Battalion — 2026-10-02): canonical `PAID_TIERS` Set تم تصديره من `src/lib/subscription-gate.ts:162`: `['normal','premium','pro','developer','admin','enterprise','b2b_starter','b2b_pro','b2b_enterprise']` (9 tiers — أضفنا `'enterprise'` الناقص). 8 consumers اتمـ migrate لـ import. الـ 9th consumer هو `subscription-gate.ts` نفسه (مستخدم في lines 222 + 378). **9 commits** (1 export + 8 consumer migrations): `dd8bef5` Step 1 (export) → `ead1a05` Step 2a (subscription-enforcement) → `18d9345` Step 2b (subscription/current) → `b57a81c` Step 2c (subscription/status) → **`a7a0b7b` Step 2d CRITICAL** (`/api/admin/users/cleanup-expired/route.ts:30+42` — الـ CRITICAL hotfix اللي منع حذف B2B paying customers) → `ba1025d` Step 2e (admin/users) → `1085d8d` Step 2f (bot/check-subscription) → `bbbfdaa` Step 2g (payment/success) → `7faa953` Step 2h (getTrialStatus). |
| **التحقق** | (1) `rg "const PAID_TIERS\s*="` بيرجّع فقط canonical definition في `src/lib/subscription-gate.ts:162`. (2) `rg "'normal', 'premium'"` inline arrays = 0. (3) Imports of canonical `PAID_TIERS`: 7 (الـ 8th consumer هو `subscription-gate.ts` نفسه). (4) `bun run lint` EXIT 0. (5) الـ cleanup-expired cron ما بيرجّعش B2B users كـ deletion candidates. |
| **الحالة** | 🟢 مغلق — Task `P0-5` (Fix Battalion) 2026-10-02 — 9 commits pushed per Rule 63. الـ CRITICAL hotfix `a7a0b7b` (Step 2d) منع حذف B2B paying customers في الـ production cron. |

---

## BREACH-007 — شارت وهمي بـ `session_intraday` synthetic generator (90 شمعة مزيفة لكل طلب — Rule 24 + Rule 27)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-03 (Task `19` TV chart quality audit) — الخرق كان موجوداً منذ إضافة `session_intraday` generator في `src/app/api/chart/[ticker]/route.ts` (pre-Wave 2). |
| **النوع** | خرق Rule 24 (NO PLACEHOLDERS — fundamentals real — no fake data) + خرق Rule 27 (NO FAKE DATA) + خرق Rule 16 (VERIFY with evidence). |
| **المسؤول** | الوكيل الذي أضاف `session_intraday` synthetic generator (lines 669-732 في `src/app/api/chart/[ticker]/route.ts`) كـ "safe-by-design" fallback لمسك الـ gap اللي سببه عدم تشغيل egksco_scraper cron. |
| **الوصف** | الـ chart API كان بيـ fabricate 90 fake intraday candles per request من daily OHLC. كل candle fabricated بـ:
  - identical volume (`Math.floor(d.volume / totalBars)`) — mathematically impossible (real intraday volume varies bar-to-bar based on actual trade activity)
  - synthetic OHLC interpolated linearly between daily open/high/low/close using a fixed prog < 0.3 / 0.7 / 1.0 split
  - `source: 'session_intraday'` tag (clearly labeled synthetic, but customers didn't know to look for it)

  20+ عملاء اشتكوا بصراحة إن الشارت "garbage" — لاحظوا إن كل الـ volume bars متطابقة + إن الشارت بيختلف عن TradingView.com. هذا خرق مباشر لـ Rule 24 (no fake data) + Rule 27 (no fake data) + المالكdirective صريحة: *"مانستعملش بيانات وهمية خالص تحت اى ظرف"*. |
| **السبب الجذري** | الـ generator اتعمل كـ "safe-by-design" fallback لمسك الـ gap اللي سببه عدم تشغيل egksco_scraper cron. الـ developer فكّر: "if no intraday exists, fake it so chart doesn't look empty". لكن ده خرق صريح لـ Rule 24 + Rule 27 + owner directive. المفروض يرجّع empty data مع رسالة صريحة بدل ما يـ fabricate. |
| **التأثير** | (1) 20+ customer complaints عن chart quality. (2) فقدان ثقة العملاء في الـ platform. (3) Charts كانت بتظهر بشكل مختلف عن TradingView.com → customers شكّوا في صحة كل الأرقام في الـ platform. (4) خرق صريح لـ Rule 24 + Rule 27. |
| **الإصلاح** | Task `P0-1` (chart) (Fix Battalion — 2026-10-03 — commit `ed56cb2`): Removed entire `session_intraday` synthetic generator (lines 669-732). Now returns honest empty response when no real intraday exists:
  ```ts
  return NextResponse.json({
    success: true,
    ticker, resolvedTicker, interval, period, asset,
    count: 0,
    data: [],
    source: 'no_intraday_data',
    message: 'لا توجد بيانات لحظية حقيقية لهذا الرمز. البيانات اللحظية تتطلب تشغيل egksco_scraper cron. يتم عرض الشارت اليومي فقط.',
  });
  ```
  Real intraday still comes from `intraday.db` (`local_intraday_db` source). Combined with P0-2 (TradingView widget default) + P0-5 (daily timeframe default) — first user impression is now REAL data via TradingView.com embedded chart, not synthetic noise. |
| **التحقق** | (1) Synthetic `source: 'session_intraday'` no longer appears in chart API responses. (2) Real `local_intraday_db` source still works for symbols with intraday data. (3) `bun run lint` EXIT 0. (4) Smoke test: `curl /api/chart/COMI?interval=15m&period=1d` → either real intraday OR empty `data: []` with `source: 'no_intraday_data'` + Arabic message (NO fake candles). |
| **الحالة** | 🟢 مغلق — Task `P0-1` (chart) (Fix Battalion) 2026-10-03 — commit `ed56cb2` pushed per Rule 63. |

---

## BREACH-008 — `price_history.db` (26 سنة بيانات حقيقية) كان بيتم تجاهله بسبب 3-day staleness check (Rule 12 breach)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-03 (Task `19` TV chart quality audit + Task `18-A` forensic data audit) — الخرق كان موجوداً منذ إضافة الـ 3-day staleness check في `src/app/api/chart/[ticker]/route.ts`. |
| **النوع** | خرق Rule 12 (load_merged_history/load_price_history is the SOLE canonical source) + خرق Rule 16 (VERIFY with evidence). |
| **المسؤول** | الوكيل الذي أضاف الـ 3-day staleness check في chart route كـ "freshness guarantee". |
| **الوصف** | الـ chart API كان بـ discard بيانات `price_history.db` بالكامل لما آخر candle يكون 3+ أيام قديم:
  ```ts
  if (!localDaily || localDaily.length < 20 ||
      (Date.now() / 1000 - localDaily[localDaily.length - 1].timestamp) > 3 * 86400) {
    // discard ALL local data → fall back to Yahoo (5-year cap)
    const yfCandles = await fetchYahooChartCandles(resolvedTicker, interval, period, asset);
    ...
  }
  ```
  `price_history.db` فيه **1,205,599 rows** (**26 years** of real EGX daily OHLC from `2000-11-27` إلى `2026-09-03`). تجاهلها لأن آخر candle 3+ أيام قديمة كان بيـ throw away 95% من الـ history لأي سبب. COMI chart كان محدود بـ 5 سنين بدل 26 سنة. |

  كمان الـ chart API كان بيقرا `price_history.db` مباشرة عبر `getLocalDailyData()` — خرق Rule 12 (`load_price_history` / `load_merged_history` هو الـ SOLE canonical source). Split-brain بين Node + Python data readers → APIs مختلفة كانت بترجّع أرقام مختلفة لنفس السهم (audit Task 18-A finding). |
| **السبب الجذري** | (1) الـ 3-day staleness check اتعمل كـ "freshness guarantee" بس ده بـ conflates staleness مع uselessness. البيانات القديمة لسه useful لـ chart rendering — آخر candle stale دي مشكلة منفصلة (بتتحل بـ Yahoo supplement، مش بـ discarding history). (2) الـ chart API اتعمل قبل Rule 12 enforcement. |
| **التأثير** | (1) COMI chart محدود بـ 5 سنين بدل 26 سنة (خسارة 95% من الـ history). (2) Charts مختلفتش عن TradingView.com (اللي بيعرض كل الـ history). (3) خرق Rule 12 (split-brain بين Node + Python). |
| **الإصلاح** | Task `P0-4` (chart) + Task `P0-3` (chart) (Fix Battalion — 2026-10-03):
  - **P0-4 (commit `00d9766`):** MERGE بدل REPLACE:
    - Keep local `price_history.db` for historical depth (26 years).
    - Fetch Yahoo for recent candles (last few days).
    - Merge: append new Yahoo candles, update existing ones with fresher data.
    - Sort by timestamp after merge.
    ```ts
    if (localDaily && localDaily.length >= 20) {
      if (yfCandles && yfCandles.length > 0) {
        const localDates = new Set(localDaily.map((c) => Math.floor(c.timestamp / 86400)));
        for (const yfc of yfCandles) {
          const yfcDay = Math.floor(yfc.timestamp / 86400);
          if (!localDates.has(yfcDay)) {
            localDaily.push(yfc);  // append new
          } else {
            const idx = localDaily.findIndex((c) => Math.floor(c.timestamp / 86400) === yfcDay);
            if (idx >= 0) localDaily[idx] = yfc;  // update existing with fresher Yahoo data
          }
        }
        localDaily.sort((a, b) => a.timestamp - b.timestamp);
      }
    }
    ```
  - **P0-3 (commit `10076a4` + `d4514ee`):** Chart API calls Python `load_price_history` first (Rule 12 + Rule 20). Added `getPythonDailyData()` helper calling `GET /api/prices/<ticker>?limit=N` on Python backend. Falls back to direct SQLite reader (marked `DEFENSIVE-FALLBACK`) only when Python unreachable. New Python route `/api/prices/<ticker>` added to `vps-service/api/public_routes.py` — delegates to `data.prices.load_price_history()` (the SOLE canonical source per Rule 12). |
| **التحقق** | (1) COMI chart now shows 26 years of history (was 5 years max). (2) `SELECT COUNT(*) FROM price_history` → 1,205,599 rows. (3) `SELECT MIN(date), MAX(date) FROM price_history` → `('2000-11-27', '2026-09-03')`. (4) Chart API routes through Python `/api/prices/<ticker>` (Rule 12). (5) `bun run lint` EXIT 0. |
| **الحالة** | 🟢 مغلق — Task `P0-3` + `P0-4` (chart) (Fix Battalion) 2026-10-03 — commits `00d9766` + `10076a4` + `d4514ee` pushed per Rule 63. |

---

## BREACH-009 — قواعد البيانات اتمسحت في Wave 2 cleanup (اتعافت من git history — owner directive "DBs from GitHub" recovered)

| الحقل | القيمة |
|---|---|
| **التاريخ** | اكتُشف 2026-10-03 (Task `18-A` forensic data audit) — الخرق حصل 2026-10-01 (Task `WAVE-2-CLEANUP`). |
| **النوع** | خرق Rule 26 (SANDBOX-RESET-SAVEREGUARD) + خرق owner directive *"تجمع قواعد البيانات من الجت هب"* + خرق Rule 16 (VERIFY with evidence). |
| **المسؤول** | الوكيل الذي نفّذ Wave 2 cleanup (Task `WAVE-2-CLEANUP` — archived 436 dead files) — archived `data/all.zip` (the historical DB snapshot) to `archive/wave-2-cleanup-2026-10-01/` and then later deleted (per owner directive: archived NOT deleted, but the path was unreachable from `db/`). |
| **الوصف** | Wave 2 cleanup (Task `WAVE-2-CLEANUP` — 2026-10-01) archived 436 dead files. ومن ضمنهم `data/all.zip` (the 68MB consolidated DB snapshot) وzip archives تانية من الـ DBs. النتيجة:
  - `.gitignore` was already excluding `*.db` — so production DBs (`data_engine.db` 83 MB, `price_history.db` 279 MB, `intraday.db` 363 MB, `predictions.db` 9.7 MB) were never in the repo's working tree.
  - The only path to recover historical DB state was `data/all.zip` (68MB) — which itself was archived then deleted in Wave 2 cleanup.
  - Sandbox had only `stocks.db` (12KB, only `system_settings` table, 0 rows) + `custom.db` (24KB, only `User` + `Post`, 0 rows) — UNUSABLE for any verification.
  - Owner directive صريحة: *"تجمع قواعد البيانات من الجت هب"* (gather the databases from GitHub) — كانت impossible to fulfill.

  Audit Task 18-A noted: "DBs are gitignored (Layer 7 finding) so this was the only way to verify against real data — but `data/all.zip` (68MB) itself was lost in current sandbox (recovered from older `/tmp/my-project` snapshot — confirms Rule 26 SANDBOX-RESET-SAVEREGUARD failure happened again)." |
| **السبب الجذري** | (1) `.gitignore` excludes `*.db` — production DBs never in repo (justified: they change every few minutes during market hours — would bloat repo). (2) Wave 2 cleanup was over-aggressive — deleted `data/all.zip` historical snapshot (which was the ONLY way to recover DB state). (3) No backup of the historical DB zip files outside git. (4) Rule 26 (SANDBOX-RESET-SAVEREGUARD) failure confirmed: sandbox resets lose data not pushed to git. |
| **التأثير** | (1) Owner directive "DBs from GitHub" impossible to fulfill — sandbox developer can't verify against real data. (2) Audit Task 18-A had to extract DBs from older `/tmp/my-project` snapshot (not even from current repo). (3) Risk of repeating Wave 2's over-aggressive cleanup in future waves. (4) Breach of owner trust — they asked for DBs in GitHub, and we had deleted the historical snapshots. |
| **الإصلاح** | Task `P0-1` (chart) (Fix Battalion — 2026-10-03 — commit `ed56cb2`): Walked git history to recover 4 historical zip archives totaling 222 MB:
  | # | File | Size |
  |---|---|---|
  | 1 | `archive/databases-from-github/active_databases_20260817_full.zip` | 73.4 MB |
  | 2 | `archive/databases-from-github/all.zip` | 28.8 MB |
  | 3 | `archive/databases-from-github/all_databases_2.zip` | 70.9 MB |
  | 4 | `archive/databases-from-github/all_databases_3.zip` | 48.8 MB |
  | **Total** | **4 zip files** | **≈ 222 MB** |

  Committed under `archive/databases-from-github/` (NEW folder). Active DBs remain gitignored in `db/` per `.gitignore` (they change every few minutes — would bloat repo). The historical snapshots under `archive/` are the **frozen reference** for forensic verification.

  `price_history.db` verified: `SELECT COUNT(*) FROM price_history` → **1,205,599 rows** (1.2M real EGX daily OHLC). `SELECT MIN(date), MAX(date)` → `('2000-11-27', '2026-09-03')` — **26 years of data**. |
| **التحقق** | (1) `ls -la archive/databases-from-github/` → 4 zip files totaling 222 MB. (2) `du -sh archive/databases-from-github/` → 222M. (3) `unzip -l archive/databases-from-github/active_databases_20260817_full.zip | head` → lists DB files. (4) `sqlite3 db/price_history.db "SELECT COUNT(*) FROM price_history"` → 1,205,599 rows. (5) `sqlite3 db/price_history.db "SELECT MIN(date), MAX(date) FROM price_history"` → `('2000-11-27', '2026-09-03')`. |
| **الحالة** | 🟢 مغلق — Task `P0-1` (chart) (Fix Battalion) 2026-10-03 — commit `ed56cb2` pushed per Rule 63. 4 historical zip archives (222 MB) recovered under `archive/databases-from-github/`. Owner directive "DBs from GitHub" now fulfilled via `archive/` folder (active DBs remain gitignored per Rule 26 + `.gitignore`). |

---

*هذا السجل تحيّنه بعد كل خرق جديد. أي وكيل يخفي خرق = خرق مضاعف.*
*آخر تحديث: 2026-10-03 (Task `DOC-20` — Documentation Secretariat — 3 خروقات جديدة: BREACH-007 + BREACH-008 + BREACH-009 — كلها مغلوطة بواسطة Wave 7 Fix Battalion.)*
