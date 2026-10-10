# 03 — API Reference (مرجع الـ APIs الشامل)

> **آخر تحديث:** 2026-10-04 (Task `28-C` — Documentation Secretariat (Wave 8 Update) — تحديث العدّادات: 380→**411 route** (Wave 8 Task `774a208` restored 32 Flutter API endpoints that were archived by mistake in Wave 2 — see `05-CURRENT_STATE.md` §17.2 for the full list of restored endpoints). إضافة §25 Sharia APIs (NEW — Rule 64 — `/api/sharia` GET + `/api/sharia/purification` POST — Task 23-C). إضافة §26 Source Authority admin APIs (NEW — Rule 66 — `/api/admin/sources` for viewing canonical sources per market + toggle banned state + see write_guarded rejections log — Task 27-B identified as P0 missing — backend exists, admin route pending). تحديث §15 admin count — included 4 NEW Wave 8 tabs (Sharia management ✅ `f413bd7` + Source Authority ⏳ + Validation Monitor ⏳ + Cron Health ⏳ — see `02-SCREENS_AND_COMPONENTS.md` §0.7.C). Per Rule 62 (Secretary updates docs) + Rule 63 (commit + push) + README editing rule 1.)
>
> **تحديثات سابقة:** 2026-10-01 (Task `WAVE-2-3-DOCS` — Documentation Secretariat catching up on backlog — تحديث العدّادات: 690→380 route (Wave 2 cleanup archived 313 dead routes) + 159 top-level group unchanged (Wave 2 deleted only dead routes inside existing groups — no group removal). Added Wave 2 cleanup note + Rule 55 auth fixes (6 routes hardened in Batch 7). See `05-CURRENT_STATE.md` §13 for the full Wave 2 dead-route inventory + commit list.) · 2026-10-01 (Task `FIX-WAVE-4-DOCS` — Documentation Secretary + Constitution Keeper — إضافة §24 Reports APIs (3 routes: daily + morning + weekly) + تحديث العدّادات: 687→690 route + 115→117 admin + 158→159 top-level group) · 2026-10-01 (Task `DOC-SYNC-FULL`) · 2026-09-30 (Task `API-DOC`)
>
> هذا الملف هو **المرجع الموحَّد لكل الـ API routes** في المنصة.
> تم بناؤه بفحص آلي لكل ملفات `src/app/api/**/route.ts` (**411 route عبر 159+ top-level group** — verified 2026-10-04 via `find src/app/api -name "route.ts" -type f | wc -l` — was 380 pre-Wave-8; Wave 8 Task `774a208` restored 32 Flutter API endpoints that were archived by mistake in Wave 2).
>
> القواعد:
> - كل route مُوثَّق بـ: HTTP method(s) + الـ path + وصف قصير + الـ auth المطلوب.
> - `[param]` = dynamic segment (مثل `/stocks/[ticker]`).
> - `[...path]` = catch-all segment (مثل `/python/[...path]` proxy).
> - `?` في الـ method معناها إن الـ route مفقود/مش معرّف بوضوح (نادر).
> - الـ auth: `public` = لا شيء، `session` = NextAuth session، `admin` = admin_session cookie أو X-Admin-Token header.

---

## 📑 فهرس سريع

| القسم | الوصف | عدد الـ routes |
|------|------|---------------|
| [§1 الصحة والنظام](#§1-الصحة-والنظام) | health / keepalive / stats / db-stats / version | 6 |
| [§2 المصادقة (Auth)](#§2-المصادقة-auth) | login / register / google / me / profile / logout | 9 |
| [§3 الاشتراكات والمدفوعات](#§3-الاشتراكات-والمدفوعات) | subscription / paymob / instapay / promo / payments | 22 |
| [§4 الأسهم والسوق (EGX)](#§4-الأسهم-والسوق-egx) | stocks / market / sectors / sparkline / depth / orderbook | 60 |
| [§5 الكريبتو](#§5-الكريبتو) | crypto / flow / explosive / crypto-lab / crypto-predictions | 30 |
| [§6 الذهب والمعادن والفوركس](#§6-الذهب-والمعادن-والفوركس) | metals / metals-forex / currency / gold | 9 |
| [§7 رادار السيولة (Maker Radar)](#§7-رادار-السيولة-maker-radar) | maker-radar + radar + multi-market + exit-radar | 20 |
| [§8 التوقعات الذكية](#§8-التوقعات-الذكية) | predictions / v2/pipeline / real-predictions / eid | 38 |
| [§9 المحفظة والمالية](#§9-المحفظة-والمالية) | portfolio / finance / watchlist / risk / zakat | 47 |
| [§10 الذكاء الاصطناعي](#§10-الذكاء-الاصطناعي) | ai / ai-proxy / ai-analysis / ads (مولّد الإعلانات) | 10 |
| [§11 التنبيهات والإشعارات](#§11-التنبيهات-والإشعارات) | alerts / notifications / push / scheduler | 10 |
| [§12 الأخبار](#§12-الأخبار) | news / news-feed / egxpilot/news / stocks/[ticker]/news / admin/news* | 7 |
| [§13 التيليجرام](#§13-التيليجرام) | telegram/post / share / publish-stock / daily-report | 5 |
| [§14 المحاكي والتعلّم](#§14-المحاكي-والتعلّم) | paper-trading-v2 / learning / learning-params / seasonality | 18 |
| [§15 الأدمن (Admin APIs)](#§15-الأدمن-admin-apis) | كل `/admin/*` الـ 117 route | 117 |
| [§16 محركات البيانات (Data Engine)](#§16-محركات-البيانات-data-engine) | data-engine / cron / scraper / sync / metals-forex | 35 |
| [§17 المحمول (Mobile APIs)](#§17-المحمول-mobile-apis) | كل `/mobile/*` (Flutter app) | 48 |
| [§18 الـ Proxies والـ Webhooks](#§18-الـ-proxies-والـ-webhooks) | python / proxy / proxy-prod / telegram/[...path] | 5 |
| [§19 محرّك Maestro](#§19-محرّك-maestro) | maestro / engines-status / engine-control | 12 |
| [§20 الـ v2 / v4 / v82 endpoints](#§20-الـ-v2--v4--v82-endpoints) | الإصدارات القديمة + الموحّدة | 27 |
| [§21 أدوات متنوّعة](#§21-أدوات-متنوّعة) | export / import / community / feedback / user-posts / points / tips / track / chart / scanner | 35 |
| [§22 Devil's Advocate](#§22-devils-advocate) | devil / market-mood / scenario-matrix / calendar | 5 |
| [§23 Hunter & Sniper](#§23-hunter--sniper) | hunter (5) + sniper (6) | 11 |
| [§24 التقارير (Reports)](#§24-التقارير-reports) | daily + morning + weekly reports | 3 |
| [§25 Sharia Compliance APIs (NEW — Wave 8 — Rule 64)](#§25-sharia-compliance-apis-new--wave-8--rule-64) | sharia list/detail + purification calculator | 2 |
| [§26 Source Authority Admin APIs (NEW — Wave 8 — Rule 66)](#§26-source-authority-admin-apis-new--wave-8--rule-66) | admin/sources (canonical + banned + rejections log) | 1 |

**الإجمالي:** **411 route** عبر 159+ top-level group (verified 2026-10-04 via `find src/app/api -name "route.ts" -type f | wc -l` — was 380 pre-Wave-8; Wave 8 Task `774a208` restored **32 Flutter API endpoints** that were archived by mistake in Wave 2 — see `05-CURRENT_STATE.md` §17.2 for the full list + commit `774a208`).

> **Wave 2 cleanup notes (Task 7-B — 2026-10-01):**
> - All 313 archived routes were 6-grep verified (src/ + vps-service/ + crontab.txt + ecosystem.config.js + flutter_app/ empty post-reset + dynamic-import patterns).
> - 6 false positives caught + kept alive (1 frontend caller `/api/egxpilot/news` + 1 admin route restored `/api/market/incremental-sync` + 4 subroute/false-matches).
> - 6 routes auth-hardened in Batch 7 per Rule 55 (5 admin + 1 data-mutating) — see §25 (NEW) below for the auth-fix table.
> - All archived routes are RECOVERABLE from git history + `archive/wave-2-cleanup-2026-10-01/src/app/api/` (owner directive — NOT deleted).
>
> **Group count unchanged (159):** Wave 2 deleted only dead routes INSIDE existing groups — no top-level group was entirely removed (the empty group folders were auto-cleaned by `find src/app/api -type d -empty -delete` but that doesn't change the documented top-level group count).

---

## §1 الصحة والنظام

| Method | Path | الوصف | Auth |
|--------|------|------|------|
| `GET` | `/health` | فحص صحة الخادم (liveness probe) | public |
| `GET` | `/keepalive` | keepalive endpoint (تستخدمه PM2/cron) | public |
| `GET` | `/stats` | إحصائيات عامة (مستخدمين / أسهم / توقعات) | session |
| `GET` | `/db-stats` | إحصائيات الـ DBs (row counts لكل جدول) | admin |
| `GET` | `/app/version` | نسخة الـ app (Flutter بيتفحصها للتحديث) | public |
| `GET` | `/system/db-health` | صحة الـ DBs + حجمها + آخر تحديث | admin |

---

## §2 المصادقة (Auth)

| Method | Path | الوصف | Auth |
|--------|------|------|------|
| `*` | `/api/auth/[...nextauth]` | NextAuth.js catch-all (login / callback / signout) | public |
| `GET` | `/auth/config` | إعدادات NextAuth (providers المفعّلة) | public |
| `POST` | `/auth/google` | Google OAuth login (ID token → session) | public |
| `GET/POST` | `/auth/google-signin` | مسار بديل لتسجيل الدخول بـ Google | public |
| `POST` | `/auth/login` | login بـ username/password (form-based) | public |
| `POST` | `/auth/logout` | تسجيل خروج + مسح session | session |
| `GET` | `/auth/me` | بيانات المستخدم الحالي (id / email / tier / is_admin) | session |
| `GET/PUT/POST` | `/auth/profile` | عرض/تعديل الملف الشخصي | session |
| `POST` | `/auth/register` | تسجيل مستخدم جديد | public |

**Admin auth** (في `/admin/auth/*`):
- `POST /admin/auth` — verify credentials + set `admin_session` cookie
- `POST /admin/auth/auto-cookie` — auto-set admin cookie لو المستخدم أدمن مسجل بـ Google
- `GET /admin/auth/token` — جلب X-Admin-Token base64 (للـ API calls من المتصفح)

---

## §3 الاشتراكات والمدفوعات

### Subscription (13 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/subscription/plans` | قائمة الباقات المتاحة (free / premium / pro) |
| `GET` | `/subscription/current` | باقة المستخدم الحالية + تاريخ الانتهاء |
| `GET` | `/subscription/status` | حالة الاشتراك (active / expired / trial) |
| `POST` | `/subscription/subscribe` | الاشتراك في باقة |
| `POST` | `/subscription/start-trial` | بدء فترة تجريبية مجانية |
| `POST` | `/subscription/trial` | بدء/تمديد trial |
| `POST` | `/subscription/checkout` | إنشاء session checkout |
| `POST` | `/subscription/verify` | التحقق من نجاح الدفع |
| `POST` | `/subscription/activate` | تفعيل اشتراك بعد دفع ناجح |
| `POST` | `/subscription/deactivate` | إلغاء اشتراك |
| `POST` | `/subscription/upgrade` | ترقية لباقة أعلى |
| `POST` | `/subscription/check-access` | gate للـ frontend (هل المستخدم يقدر يشوف المحتوى؟) |
| `POST` | `/subscription/developer-request` | طلب حساب developer (للمبرمجين) |
| `GET` | `/subscribe/[plan]` | اختصار اشتراك في باقة معيّنة |

### Paymob (الدفع المصري)
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/paymob/create-payment` | إنشاء payment intent |
| `GET/POST` | `/paymob/callback` | webhook من Paymob بعد الدفع |
| `POST` | `/paymob/process-wallet` | معالجة محفظة Mobily/فودافون كاش |

### Instapay
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/instapay` | طلب/تأكيد دفع Instapay |
| `POST` | `/instapay/approve` | تأكيد تحويل Instapay |
| `POST/GET` | `/instapay/verify` | التحقق من تحويل Instapay |

### مدفوعات متنوّعة
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/payments/result` | صفحة نتيجة الدفع (redirect target) |

### 🆕 Subscription System (NEW — 2026-09-30, Task SUBSCRIPTION-SYSTEM)

نظام اشتراكات كامل: 14 يوم trial مجاني + Paymob checkout + حظر بعد انتهاء الـ trial + B2B + referrals.

**القرارات المعتمدة:**
- كل مستخدم جديد → 14 يوم Premium trial تلقائياً (يُضبط في `/api/auth/register` + `/api/auth/google-signin`)
- بعد انتهاء الـ trial → TrialExpiredModal (block كامل، X صغير مُتعَب)
- AI محلي فقط (Qwen 1.5B) — تكلفة صفر
- Paymob فقط للدفع — المستخدم بيدفع بالجنيه حتى لو السعر معروض بعملة تانية
- B2B API keys: توليد تلقائي بعد الدفع (`sk_live_<random32>`)

#### Subscription APIs (مُحدّثة)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/subscription/plans?market=egx` | الباقات المتاحة بالعملة المحلية (egx/tadawul/kse/qse/us/crypto/all) |
| `GET` | `/subscription/current` | باقة المستخدم + trial status (محدّث: 14 يوم + 0 warning) |
| `GET` | `/subscription/status` | حالة الاشتراك المبسّطة: `{ tier, status, isExpired, daysLeft, isPaid, trialEndsAt }` |
| `POST` | `/subscription/checkout` | إنشاء Paymob order + iframe URL (جديد — يقرأ MarketPricing من DB) |
| `POST` | `/subscription/activate` | تفعيل بعد الدفع + توليد API key تلقائياً للـ B2B (جديد) |
| `POST` | `/subscription/subscribe` | الاشتراك في باقة (قديم) |
| `POST` | `/subscription/upgrade` | ترقية (قديم) |
| `POST` | `/subscription/start-trial` | بدء trial (قديم) |
| `POST` | `/subscription/trial` | تمديد trial (قديم) |
| `POST` | `/subscription/verify` | التحقق من دفع (قديم) |
| `POST` | `/subscription/deactivate` | إلغاء (قديم) |
| `POST` | `/subscription/check-access` | gate (قديم) |

#### Referral APIs (NEW)
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/referral/redeem` | استبدال كود إحالة (+14 يوم trial للجديد) |
| `GET` | `/referral/stats` | إحصائيات الإحالة (code + total + active + credits) |

#### B2B APIs (NEW)
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/b2b/signup` | طلب B2B (pending_approval) — body: `{ tier, company, contactName, email, phone, useCase?, website? }` |
| `GET` | `/b2b/api-keys` | عرض API keys للمستخدم (B2B only) |
| `POST` | `/b2b/api-keys` | rotate/revoke API key — body: `{ action: 'rotate'|'revoke', keyId? }` |

#### Admin Subscription/Referral APIs (NEW)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/admin/subscriptions` | كل الاشتراكات + إحصائيات (MRR + activeTrials + conversionRate + churnRate) |
| `GET` | `/admin/referrals` | كل الإحالات + top referrers + إحصائيات |

#### Prisma Models الجديدة (prisma/auth-schema.prisma)
- `MarketPricing` — التسعير حسب السوق × الباقة × دورة الفوترة (23 سطر مزروع)
- `Referral` — جدول الإحالات (referrer + referred + code + bonus_days)
- `UsageDaily` — تتبّع الاستخدام اليومي (ai_messages + watchlist + portfolio + alerts)
- `B2bApiKey` — مفاتيح API للـ B2B (توليد تلقائي + monthly_limit + revoked_at)

#### التسعير المعتمد (seeded في DB)
| الباقة | مصر | السعودية | عالمي |
|--------|-----|---------|------|
| Premium شهري | 99 ج.م | 19 ريال | $2.99 |
| Premium سنوي | 990 ج.م | 190 ريال | $29.9 |
| Pro شهري | 199 ج.م | 39 ريال | $5.99 |
| Pro سنوي | 1990 ج.م | 390 ريال | $59.9 |
| B2B Starter | — | — | $99/سنة |
| B2B Pro | — | — | $299/سنة |
| B2B Enterprise | — | — | $999/سنة |

#### UI Components (src/modules/subscription/components/)
- `PricingView` — صفحة التسعير مع auto-detect للسوق + monthly/yearly toggle
- `TrialExpiredModal` — overlay ملوش cancel (block كامل بعد انتهاء الـ trial)
- `TrialCountdownBanner` — بانر تنبيهي بالأيام المتبقية (أزرق/أصفر/أحمر حسب الأيام)
- `UpsellToasts` — 3 لحظات upsell (limit_80 / ai_depleted / pro_feature)

#### Helper Functions (src/lib/subscription-gate.ts)
- `getTierLimits(tier)` — حدود كل باقة (Free: 5 watchlist / 5 portfolio / 3 alerts)
- `canUseAI(tier, usedToday)` — فحص الاستخدام اليومي (Free: 3/يوم)
- `getRadarAccess(tier)` — Free → preview متأخر ساعة، Premium+ → لحظي
- `canAccessProFeatures(tier)` — backtest/Devil/Hunter للـ Pro+
- `isB2BTier(tier)` — فحص الـ B2B
| `POST` | `/google-play/verify-receipt` | التحقق من شراء Google Play |
| `POST` | `/redeem-promo` | استبدال كود خصم |
| `POST/GET` | `/seed-experts` | seeding خبراء (admin) |

---

## §4 الأسهم والسوق (EGX)

### Stocks (27 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/stocks` | قائمة كل الأسهم (مع آخر سعر) |
| `GET` | `/stocks/search` | بحث بالرمز/الاسم |
| `GET` | `/stocks/[ticker]` | بيانات سهم واحد |
| `GET` | `/stocks/[ticker]/history` | تاريخ أسعار السهم |
| `GET` | `/stocks/[ticker]/depth` | عمق السوق (order book levels) |
| `GET` | `/stocks/[ticker]/orderbook` | orderbook كامل |
| `GET` | `/stocks/[ticker]/news` | أخبار السهم |
| `GET` | `/stocks/[ticker]/comprehensive` | تحليل شامل (فني + أساسي + سيولة) |
| `GET` | `/stocks/[ticker]/professional-analysis` | تحليل احترافي مفصّل |
| `GET` | `/stocks/[ticker]/expert-analysis` | 🆕 تحليل خبير احترافي شامل (فني + أساسي + مخاطر + تقرير منسق) — 2026-10-09 |
| `GET` | `/stocks/[ticker]/recommendation` | توصية السهم الحالية |
| `GET` | `/stocks/[ticker]/publish-data` | بيانات جاهزة للنشر (تيليجرام/سوشيال) |
| `GET` | `/stocks/[ticker]/dual-persona` | تحليل بزاويتين (مضارب/مستثمر) |
| `GET` | `/stocks/advanced-analysis` | تحليل متقدّم لكل الأسهم |
| `GET` | `/stocks/analysis` | تحليل جماعي |
| `GET` | `/stocks/batch-analysis` | تحليل batch (POST body) |
| `GET` | `/stocks/confluence` | confluence score لكل الأسهم |
| `GET` | `/stocks/data-coverage` | نسبة تغطية البيانات لكل سهم |
| `GET` | `/stocks/delta-volume` | delta volume (شراء-بيع) لكل سهم |
| `GET/POST` | `/stocks/fundamentals` | بيانات أساسية |
| `GET` | `/stocks/movement-classification` | تصنيف حركة السهم (دعم/مقاومة/اختراق) |
| `GET` | `/stocks/presets` | قوائم محفوظة (EGX 30 / S&P) |
| `GET` | `/stocks/recommendations` | توصيات جماعية |
| `GET` | `/stocks/screener` | screener متقدّم |
| `GET` | `/stocks/sparkline` | sparkline data (mini chart) |
| `GET` | `/stocks/technical` | مؤشرات فنية (RSI / MACD / MA) |
| `GET` | `/stocks/top-performers` | الأعلى ارتفاعًا/انخفاضًا |

### Market (32 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/market/overview` | نظرة عامة على السوق (مؤشرات + حركة) |
| `GET` | `/market/summary` | ملخص اليوم (gainers / losers / volume) |
| `GET` | `/market/status` | حالة السوق (مفتوح/مغلق + مدة) |
| `GET` | `/market/indices` | مؤشرات EGX 30/70/100 |
| `GET` | `/market/top-movers` | الأكثر تحركًا |
| `GET` | `/market/sectors` | أداء القطاعات |
| `GET` | `/market/sectors/intelligence` | تحليل ذكي للقطاعات |
| `GET` | `/market/liquidity-flow` | تدفّق السيولة على السوق |
| `GET` | `/market/intraday-pressure` | ضغط الجلسة (buying/selling pressure) |
| `GET` | `/market/morning-bell` | جرس الصباح (توصيات بداية الجلسة) |
| `GET` | `/market/investing` | بيانات investing.com proxy |
| `GET` | `/market/regime` | حالة السوق (DEFENSIVE/NORMAL/AGGRESSIVE) |
| `GET` | `/market/exit-status` | حالة خروج التوقعات |
| `GET` | `/market/continuation/[ticker]` | احتمالية استمرار الاتجاه |
| `GET` | `/market/live-data` | بيانات لحظية |
| `GET` | `/market/connections` | حالة مصادر البيانات |
| `GET` | `/market/gold` | سعر الذهب في السوق |
| `POST` | `/market/publish-status-image` | نشر بطاقة حالة السوق على تيليجرام |
| `GET/POST` | `/market/refresh-data` | تحديث بيانات السوق |
| `POST/GET` | `/market/sync` | مزامنة بيانات السوق |
| `POST` | `/market/sync-historical` | مزامنة تاريخية (5 سنوات) |
| `POST` | `/market/sync-live` | مزامنة لحظية |
| `GET/POST` | `/market/incremental-sync` | مزامنة تدريجية |
| `GET/POST` | `/market/seed-historical` | seeding تاريخي |
| `POST` | `/market/bulk-update` | تحديث جماعي |
| `GET` | `/market/auto-seed` | seeding تلقائي للأسهم |
| `POST/GET` | `/market/scheduled-sync` | مزامنة مجدولة (cron) |
| `GET/POST` | `/market/test-sources` | اختبار مصادر البيانات |
| `GET` | `/market/report/daily` | تقرير يومي |
| `GET` | `/market/report/weekly` | تقرير أسبوعي |
| `GET` | `/market/report/status` | حالة إعداد التقارير |
| `GET` | `/market/recommendations/ai-insights` | رؤى AI للتوصيات |

### Sectors
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/sectors/[sector]/stocks` | أسهم قطاع معيّن |
| `GET` | `/sectors/tracking` | تتبّع أداء القطاعات |

### Chart & Stock-detail
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/chart/[ticker]` | بيانات شارت سهم |
| `GET` | `/stock-detail` | تفاصيل سهم (مختصر) |
| `GET` | `/stock/deep-analysis` | تحليل عميق لسهم |
| `GET` | `/stock-profile/[ticker]` | ملف تعريفي للشركة |

### Dividends & Disclosures
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/dividend-analysis` | تحليل توزيعات الأرباح |
| `GET/POST` | `/dividend-calendar` | تقويم توزيعات الأرباح |
| `GET` | `/disclosures/company/[symbol]` | إفصاحات شركة |

### EGX-specific
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/egx/investors` | حركة المستثمرين (أجانب/عرب/مصريين) |
| `POST/GET` | `/egx/investors/seed` | seeding بيانات المستثمرين |
| `GET/POST` | `/egxpilot/stocks` | بيانات egxpilot.com proxy |
| `GET` | `/egxpilot/news` | أخبار egxpilot |
| `GET/POST` | `/egxpilot/analysis/[ticker]` | تحليل egxpilot لسهم |

---

## §5 الكريبتو

### Crypto (23 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/crypto` | قائمة العملات (مع آخر سعر) |
| `GET` | `/crypto/coins` | قائمة العملات الكاملة (metadata) |
| `GET` | `/crypto/[id]` | بيانات عملة |
| `GET` | `/crypto/[id]/history` | تاريخ أسعار عملة |
| `GET` | `/crypto/live` | أسعار لحظية |
| `GET` | `/crypto/stats` | إحصائيات السوق |
| `GET` | `/crypto/status` | حالة مزامنة الكريبتو |
| `GET/POST` | `/crypto/sync` | مزامنة بيانات الكريبتو |
| `POST` | `/crypto/start` | بدء scraping |
| `POST` | `/crypto/stop` | إيقاف scraping |
| `GET` | `/crypto/analyze` | تحليل عملة |
| `GET` | `/crypto/full-analysis` | تحليل شامل لعملة |
| `GET` | `/crypto/portfolio` | محفظة الكريبتو |
| `GET` | `/crypto/watchlist` | قائمة مراقبة الكريبتو |
| `GET` | `/crypto/recommendations` | توصيات الكريبتو |
| `GET` | `/crypto/events` | أحداث الكريبتو (fork / burn / airdrop) |
| `GET` | `/crypto/explosive` | فرص انفجارية |
| `GET` | `/crypto/explosive/[symbol]` | تفاصيل فرصة انفجارية |
| `GET` | `/crypto/mr-signals` | إشارات mean-reversion |
| `GET` | `/crypto/ohlc` | بيانات OHLC (شمعية) |
| `GET/POST` | `/crypto/simulation` | محاكاة تداول كريبتو |
| `GET` | `/crypto/flow` | تدفّق السيولة على الكريبتو |
| `GET` | `/crypto/flow/[symbol]` | تدفّق سيولة عملة |

### ملحقات الكريبتو
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/crypto-backtesting` | باك-تست للكريبتو |
| `GET` | `/crypto-lab` | مختبر الكريبتو (تجارب) |
| `GET` | `/crypto-lab/predictions` | توقعات الكريبتو |
| `GET` | `/crypto-predictions` | توقعات بسيطة للكريبتو |
| `GET` | `/unified-crypto` | كريبتو موحّد (مع EGX) |

---

## §6 الذهب والمعادن والفوركس

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/metals/gold` | سعر الذهب الحالي |
| `GET` | `/metals/gold/history` | تاريخ أسعار الذهب |
| `POST` | `/metals-forex/start` | بدء scraping معادن/فوركس |
| `GET` | `/metals-forex/status` | حالة scraping |
| `POST` | `/metals-forex/stop` | إيقاف scraping |
| `GET` | `/currency` | قائمة العملات |
| `GET` | `/currency/list` | قائمة عملات للتحويل |
| `GET/POST` | `/currency/convert` | تحويل عملة |
| `POST/GET` | `/multi-market/sync` | مزامنة كل الأسواق |

---

## §7 رادار السيولة (Maker Radar)

### Maker Radar (15 routes) — *قلب المنصة*
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/maker-radar` | الرادار الرئيسي (pre_surge + quiet + explosive + early_break lists) |
| `GET/POST` | `/maker-radar/warmup` | تشغيل سكريبت Python maker_radar.py + caching النتيجة |
| `GET` | `/maker-radar/stock` | رادار لسهم واحد |
| `GET` | `/maker-radar/timeline` | تسلسل زمني للإشارات |
| `GET` | `/maker-radar/entry-timing` | توقيت الدخول الأمثل |
| `GET` | `/maker-radar/fundamentals` | أساسيات الشركات |
| `GET` | `/maker-radar/footprint` | أثر السيولة (footprint analysis) |
| `GET` | `/maker-radar/live-watch` | مراقبة لحظية |
| `GET` | `/maker-radar/multi-market` | رادار متعدد الأسواق (7 أسواق) |
| `GET` | `/maker-radar/net-picks` | صافي الاختيارات (Net Picks) |
| `GET` | `/maker-radar/sector-treemap` | treemap للقطاعات |
| `GET` | `/maker-radar/signal-tracker` | تتبّع الإشارات (verify) |
| `POST` | `/maker-radar/signal-tracker/verify` | تحقق من إشارة |
| `POST/GET/DELETE` | `/maker-radar/track` | تتبّع سهم معيّن |
| `GET/POST` | `/maker-radar/exit-radar` | رادار الخروج (5 مسارات) |

### Radar (4 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/radar/personalized` | رادار شخصي (حسب المحفظة) |
| `GET` | `/radar/accuracy` | دقة الرادار (backtest) |
| `GET/POST` | `/radar/weekly-report` | تقرير أسبوعي للرادار |
| `GET` | `/radar/weekly-report/pdf` | PDF للتقرير الأسبوعي |

### Explosive & Hunter & Sniper
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/explosive` | فرص انفجارية |
| `GET` | `/explosive/[ticker]` | تفاصيل فرصة |
| `GET` | `/explosive/hunt` | بحث عن فرص |
| `GET` | `/flow` | تدفّق سيولة عام |
| `GET` | `/flow/[ticker]` | تدفّق سيولة سهم |

---

## §8 التوقعات الذكية

### Predictions (37 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/predictions` | قائمة/إنشاء توقعات |
| `POST` | `/predictions/generate` | توليد توقع لسهم |
| `POST` | `/predictions/generate-all` | توليد توقعات لكل الأسهم |
| `GET` | `/predictions/live` | توقعات لحظية |
| `GET` | `/predictions/intraday` | توقعات داخل اليوم |
| `GET` | `/predictions/active-management` | إدارة نشطة للتوقعات |
| `GET` | `/predictions/daily-picks` | اختيارات اليوم |
| `GET` | `/predictions/backtest-list` | قائمة باك-تست |
| `GET` | `/predictions/credibility` | مصداقية التوقعات |
| `GET/POST` | `/predictions/eid` | توقعات الأعياد (موسمية) |
| `GET` | `/predictions/expert-consensus` | إجماع الخبراء |
| `GET` | `/predictions/export-pdf` | تصدير PDF للتوقعات |
| `GET` | `/predictions/historical-trades` | صفقات تاريخية |
| `GET/POST` | `/predictions/honest-tracking/*` | تتبّع صادق (6 routes فرعية) |
| `GET` | `/predictions/learned-lessons` | دروس مستفادة |
| `GET` | `/predictions/league-report` | تقرير دوري |
| `GET` | `/predictions/monthly-league` | دوري شهري |
| `GET` | `/predictions/performance` | أداء التوقعات |
| `GET` | `/predictions/performance-dashboard` | لوحة أداء |
| `POST/GET` | `/predictions/price-verify` | تحقق من الأسعار |
| `POST/GET` | `/predictions/refresh-v40` | تحديث بمحرك V40 |
| `GET/POST` | `/predictions/seed` | seeding توقعات |
| `GET/POST` | `/predictions/tracking` | تتبّع التوقعات |
| `GET` | `/predictions/tracking/list` | قائمة التتبّع |
| `GET` | `/predictions/tracking/stats` | إحصائيات التتبّع |
| `POST` | `/predictions/tracking/verify` | تحقق تتبّع |
| `GET` | `/predictions/verify` | تحقق توقع |
| `GET/POST` | `/predictions/dual-track/*` | مسار مزدوج (4 routes) |

### Real predictions & global
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/real-predictions` | توقعات حقيقية (مش تجريبية) |
| `GET` | `/global-predictions` | توقعات عالمية |
| `GET` | `/prediction-performance` | أداء التوقعات |
| `GET` | `/unified/predictions` | توقعات موحّدة |

---

## §9 المحفظة والمالية

### Portfolio (21 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/portfolio` | محفظة المستخدم |
| `GET/POST` | `/portfolio/accounts` | حسابات المحفظة |
| `GET` | `/portfolio/accounts/[id]/state` | حالة حساب |
| `GET` | `/portfolio/accounts/[id]/equity-curve` | منحنى equity لحساب |
| `GET` | `/portfolio/holdings` | حيازات المحفظة |
| `GET` | `/portfolio/assets` | أصول المحفظة |
| `GET` | `/portfolio/equity/curve` | منحنى equity الكلي |
| `GET` | `/portfolio/equity-curve` | منحنى equity (alias) |
| `GET` | `/portfolio/cashflow` | تدفّق نقدي |
| `GET` | `/portfolio/analyze` | تحليل المحفظة |
| `GET` | `/portfolio/intelligence` | ذكاء المحفظة |
| `GET` | `/portfolio/master` | محفظة رئيسية |
| `GET` | `/portfolio/risk-summary` | ملخص المخاطر |
| `GET` | `/portfolio/state` | حالة المحفظة |
| `GET` | `/portfolio/watchlists` | قوائم المراقبة |
| `GET` | `/portfolio/unified-watch` | قائمة مراقبة موحّدة (محفظة + رادار) |
| `GET` | `/portfolio/bag-holder-rescue` | إنقاذ المحفظة الراكدة |
| `GET` | `/portfolio/smart-monitor/signals` | إشارات المراقب الذكي |
| `POST/GET` | `/portfolio/check` | فحص صحة المحفظة |
| `POST/GET` | `/portfolio/import-real` | استيراد محفظة حقيقية |
| `GET` | `/portfolio/priority-sync` | مزامنة أولويات |

### Finance (19 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST/PUT/DELETE` | `/finance/assets` | إدارة الأصول (CRUD) |
| `PUT/DELETE` | `/finance/assets/[id]` | أصل واحد |
| `GET/POST` | `/finance/transactions` | المعاملات المالية |
| `DELETE` | `/finance/transactions/[id]` | معاملة |
| `GET/POST/PUT/DELETE` | `/finance/obligations` | الالتزامات المالية |
| `GET/POST` | `/finance/obligations/payments` | دفعات الالتزامات |
| `GET` | `/finance/calculate-values` | حساب قيم المحفظة |
| `GET` | `/finance/portfolio-analysis` | تحليل المحفظة المالي |
| `GET` | `/finance/projection` | توقعات مالية مستقبلية |
| `GET` | `/finance/real-return` | العائد الحقيقي (بعد التضخم) |
| `GET` | `/finance/reports` | تقارير مالية |
| `POST` | `/finance/schema` | schema قاعدة البيانات |
| `GET/POST` | `/finance/screener` | screener مالي |
| `GET/POST` | `/finance/seed-alert-thresholds` | seeding عتبات التنبيهات |
| `GET` | `/finance/smart-alerts` | تنبيهات ذكية |
| `GET` | `/finance/smart-analysis` | تحليل ذكي |
| `GET/POST` | `/finance/smart-confluence` | confluence مالي |
| `GET/POST` | `/finance/smart-watchlist` | قائمة مراقبة ذكية |
| `POST/GET` | `/finance/inflation` | بيانات التضخم |

### Watchlist & Risk
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/watchlist` | قائمة المراقبة |
| `PUT/DELETE` | `/watchlist/[id]` | عنصر قائمة |
| `GET` | `/watchlist-enhanced` | قائمة مراقبة محسّنة |
| `GET` | `/risk/decision-table` | جدول قرارات المخاطر |
| `GET` | `/risk/position-size` | حجم الصفقة (position sizing) |
| `GET` | `/risk/stock-types` | أنواع الأسهم (مضاربة/استثمارية) |
| `GET` | `/risk/stop-loss` | حساب وقف الخسارة |
| `GET` | `/risk/targets` | أهداف الربح |
| `POST/GET` | `/zakat/calculate` | حاسبة الزكاة |
| `GET` | `/deal-advisor/[ticker]` | مستشار صفقة لسهم |

### Money
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/money` | ملخص أموال |
| `GET` | `/money/wealth` | ثروة المستخدم |
| `GET` | `/money/smart-monitor` | مراقب ذكي للأموال |

---

## §10 الذكاء الاصطناعي

### AI Chat & Analysis
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/ai/chat` | محادثة AI (DeepSeek/Ollama) |
| `POST` | `/ai/analyze-stock` | تحليل AI لسهم |
| `POST` | `/ai/batch-analysis` | تحليل batch |
| `GET` | `/ai/models` | قائمة النماذج المحلية المتاحة (Ollama + Piper TTS) |
| `GET` | `/ai-proxy` | proxy لخدمة AI خارجية |
| `GET/POST` | `/ai-analysis` | تحليل AI مختصر |
| `GET` | `/ai-performance` | أداء الـ AI |

### AI Predictions
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/ai-predictions/evaluate` | تقييم توقعات AI |
| `GET` | `/ai-predictions/extract` | استخراج توقعات AI |

### 🆕 Content Studio + Educational APIs (NEW — 2026-09-30, Task EDUCATION-UPGRADE)

استوديو المحتوى المتحرك + APIs للمحتوى التعليمي والصفقات الناجحة الحقيقية.

#### Content Studio APIs (NEW)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/api/ads/successful-trades?limit=10` | صفقات ناجحة حقيقية من predictions.db (actual_return > 0) — بيستخدمها TradesShowcase |
| `GET` | `/api/ads/educational-lessons?id=01` | دروس تعليمية حقيقية من content/education/*.md — بيستخدمها EducationalCardsStudio |
| `POST` | `/api/ads/capture-screenshot` | التقاط screenshots من المسارات الحية (Playwright) |
| `POST` | `/api/ads/generate-script` | نصوص إعلانية ثابتة من ad-templates.ts (بدون AI) |
| `GET/POST` | `/api/ads/generate-voice` | TTS (متعطّل في الإنتاج — 503 لو TTS مش متاح) |

#### Helper Libraries (src/lib/)
- `text-effects.ts` — 8 تأثيرات نصية (fade/slideUp/zoomIn/typewriter/marquee/bounce/glow) + 4 easing
- `ad-templates.ts` — نصوص ثابتة لـ 8 ميزات (بدون AI/LLM)
- `hashtag-library.ts` — مكتبة هاشتاجات (6 أسواق × 8 ميزات × 4 أنواع محتوى)
- `cta-templates.ts` — 15 CTA جاهز (6 أهداف × 3 جماهير × 3 مستويات urgency)
- `ad-card-generator.ts` — مولّد كروت صور PNG (3 مقاسات: square/story/landscape)
- `targets-validator.ts` — فحص منطقي للأهداف/وقف الخسارة (stop < entry, target1 > entry, target2 > target1)

#### UI Components
- `ContentStudioHub` — استوديو المحتوى (EducationalCards + TradesShowcase)
- `MarketingHub` — محرّك التسويق (Campaign Builder + Image Cards + Content Calendar)
- `AdGeneratorTab` — مولّد الفيديو (Canvas + MediaRecorder — صامت)

#### المحتوى التعليمي العميق (content/education/)
المرحلة 1 مكتملة (4 ملفات اتعاد كتابتها بالعمق المؤسسي):
- `01_saykolojeya_altadawul.md` → Behavioral Finance + SOPs
- `04_mean_reversion.md` → التوزيع الطبيعي + Z-Score + Kurtosis
- `05_risk_management.md` → Kelly Criterion + Sharpe/Sortino + MaxDD
- `06_price_action.md` → Auction Market Theory + Wyckoff 2.0

كل درس يتبع template موحّد: نظرية + فشل + حالة واقعية + كود + checklist.

---

### 🆕 مولّد الإعلانات (Ad Generator) — *Task AD-GENERATOR*
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/ads/generate-script` | توليد سكريبت إعلاني عربي بالعامية المصرية (Ollama LLM) — يرجّع `{ script, caption, hashtags, scenes, featureName }` |
| `GET/POST` | `/ads/generate-voice` | تحويل السكريبت لصوت WAV/MP3 (Piper TTS محلي) |
| `POST` | `/ads/capture-screenshot` | التقاط screenshot حقيقي من شاشة الميزة بـ Playwright headless (mobile 414×896, retina 828×1792) |

**تفاصيل مولّد الإعلانات:**

```http
POST /api/ads/generate-script
Content-Type: application/json

{
  "feature": "radar",           // radar|predictions|portfolio|risk|stockcard|alerts|exit|academy
  "mood": "energetic",          // energetic|professional|friendly
  "extraHint": "",              // ملاحظة إضافية (اختياري)
  "model": ""                   // Ollama model (اختياري — default من /api/ai/models)
}
```

Response:
```json
{
  "success": true,
  "script": "السيولة بتتجمّع قبل ما السهم يرتفع!...",
  "caption": "🚀 رادار السيولة يكتشف الفرص...",
  "hashtags": ["#رادار_السيولة", "#EGX", "#استثمار"],
  "scenes": [{"headline": "رادار السيولة", "subtext": "..."}],
  "featureName": "رادار السيولة",
  "model": "qwen2.5:1.5b",
  "lowConfidence": false
}
```

---

## §11 التنبيهات والإشعارات

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/alerts` | تنبيهات المستخدم |
| `DELETE` | `/alerts/[id]` | حذف تنبيه |
| `POST` | `/alerts/create` | إنشاء تنبيه |
| `GET/POST` | `/alerts/quick-add` | إضافة سريعة |
| `GET/POST/DELETE` | `/alerts/gold` | تنبيهات الذهب |
| `GET/POST` | `/alerts/scheduler` | مجدول التنبيهات (cron-based) |
| `GET/POST` | `/notifications` | إشعارات المستخدم |
| `POST/GET` | `/push/register` | تسجيل device للـ push notifications |
| `GET` | `/scheduler/run` | تشغيل scheduler |
| `GET` | `/tips/random` | نصيحة عشوائية |

---

## §12 الأخبار

> **مراجعة 2026-10-03:** الـ routes الممسوحة من `/news/*` (Wave 2) اتشالت من الجدول.
> المسارات **نسبة لـ `/api`**.

| Method | Path | الوصف | Auth |
|--------|------|------|------|
| `GET` | `/news` | أخبار (`market_news` — المصدر الرسمي). `?market=` `?limit=` (≤100) `?offset=` `?tickers=COMI,EGBE` | public |
| `POST` | `/news` | استقبال من news-agent. **`x-agent-key`** header. **بينضّف HTML من `title`/`content`/`summary_*` قبل الحفظ** | agent |
| `GET` | `/news-feed` | feed موحّد: `market_news` + `predictions.news_signals` + EGX + crypto + fear&greed. `?market=crypto`. limit 50 · cache 300s | public |
| `GET` | `/egxpilot/news` | أخبار egxpilot.com | public |
| `GET` | `/stocks/[ticker]/news` | أخبار سهم واحد | public |
| `GET` | `/admin/news-health` | صحّة محرك الأخبار | admin |
| `GET` | `/admin/news` | إدارة/معاينة أخبار | admin |

**الـ POST من news-agent:** بيرسل `{title, content, summary_ar, summary_en, source,
source_type, url, tickers, importance, sentiment, impact_type, market, image_paths,
ocr_text, raw_analysis, published_at}`. الـ route بيعمل `INSERT OR IGNORE`
على `UNIQUE(title, source)`، وبيعمل non-blocking forward لـ
`{BACKEND_URL}/api/news/agent` (Python) لـ V40.2 scoring — بالـ payload **بعد التنظيف**.

> **الـ Flask counterpart:** `POST /api/news/receive-from-news-agent`
> (blueprint `news_bp` في `news_routes.py` — port 8010) — مش في الجدول ده
> لأنه مش Next.js route.

---

## §13 التيليجرام

| Method | Path | الوصف |
|--------|------|------|
| `POST/GET` | `/telegram/post` | نشر رسالة على تيليجرام |
| `POST/GET` | `/telegram/share` | مشاركة محتوى |
| `POST` | `/telegram/publish-stock` | نشر كارت سهم |
| `POST` | `/telegram/send-daily-report` | إرسال تقرير يومي |
| `*` | `/telegram/[...path]` | catch-all proxy لـ Telegram Bot API |

---

## §14 المحاكي والتعلّم

### Paper Trading
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/paper-trading` | محاكي تداول (قديم) |
| `GET` | `/paper-trading-v2/account` | حساب المحاكي v2 |
| `POST` | `/paper-trading-v2/order` | إنشاء أمر |
| `GET` | `/paper-trading-v2/orders` | قائمة الأوامر |
| `POST` | `/paper-trading-v2/orders/[id]/close` | إغلاق أمر |
| `GET` | `/paper-trading-v2/positions` | المراكز المفتوحة |
| `POST` | `/paper-trading-v2/reset` | إعادة تعيين المحاكي |

### Learning
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/learning/content` | محتوى تعليمي |
| `GET` | `/learning/indicators` | مؤشرات تعليمية |
| `GET` | `/learning/patterns` | أنماط شارت |
| `GET/POST` | `/learning/progress` | تقدّم التعلّم |
| `GET` | `/learning/status` | حالة التعلّم |
| `GET` | `/learning-params` | بارامترات التعلّم |
| `GET` | `/learning-params/active` | البارامترات النشطة |
| `GET` | `/learning-params/init` | init بارامترات |
| `GET` | `/learning-params/save` | حفظ بارامترات |
| `GET` | `/self-learning` | تعلّم ذاتي |
| `GET` | `/iterative-learning` | تعلّم تكراري |
| `GET` | `/unified-learning/*` | تعلّم موحّد (6 routes) |

### Seasonality & Trading Journal
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/seasonality-signals` | إشارات موسمية |
| `GET` | `/stock-seasonality` | موسمية سهم |
| `GET/POST` | `/trading-journal` | يوميات التداول |
| `GET` | `/trading-journal/stats` | إحصائيات اليوميات |
| `GET/POST/DELETE` | `/stock-notebook` | نوتبوك الأسهم (ملاحظات شخصية) |

---

## §15 الأدمن (Admin APIs)

> 117 route تحت `/admin/*`. كلها محمية بـ `admin_session` cookie أو `X-Admin-Token` header.
> بتُقسّم لـ: مصادقة + قواعد بيانات + باك-تست + توقعات + أخبار + مستخدمين + محركات + تيليجرام + تقارير + كروت تعليمية.
>
> **Wave 2 (Task 7-B Batch 7 — 2026-10-01):** 5 admin routes were auth-hardened (upgraded from legacy `verifyAdminRequest`/`verifyAdminToken` → `requireAdminAsync` per Rule 55 §г — defense-in-depth): `/api/admin/data-sources` + `/api/admin/export-data` + `/api/admin/export-vps` + `/api/admin/refresh-historical-data` + `/api/admin/scrape-stocks`. All now return 403 for unauthenticated requests (was 200/405 before). Count unchanged (5 routes hardened in-place, NOT added/removed).

### 15.1 مصادقة الأدمن
| Method | Path | الوصف |
|--------|------|------|
| `POST/DELETE` | `/admin/auth` | verify credentials + set cookie |
| `POST` | `/admin/auth/auto-cookie` | auto-set admin cookie (Google login) |
| `GET` | `/admin/auth/token` | جلب X-Admin-Token base64 |

### 15.2 إدارة قواعد البيانات (DB Manager)
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/admin/db` | قائمة الـ DBs |
| `GET/DELETE` | `/admin/db/[db]` | DB واحد |
| `GET/POST` | `/admin/db/[db]/[table]` | جدول داخل DB |
| `PUT/DELETE` | `/admin/db/[db]/[table]/[row]` | صف داخل جدول |
| `GET` | `/admin/db-explorer` | استكشاف DB |
| `GET` | `/admin/db-health` | صحة الـ DBs |
| `GET/POST/DELETE` | `/admin/db-backup` | نسخ احتياطي |
| `GET/POST` | `/admin/db-manager` | مدير الـ DB الرئيسي |
| `GET` | `/admin/db-manager/schema` | schema الـ DB |
| `GET` | `/admin/db-manager/export` | تصدير DB |
| `POST/GET` | `/admin/db-manager/export-all` | تصدير كل DBs |
| `POST` | `/admin/db-manager/import-all` | استيراد كل DBs |
| `POST` | `/admin/db-manager/import-egx30` | استيراد EGX 30 |
| `POST` | `/admin/db-manager/backup` | إنشاء backup |
| `POST` | `/admin/db-manager/auto-backup` | backup تلقائي |
| `GET/POST/DELETE` | `/admin/db-manager/historical-backups` | backups تاريخية |
| `DELETE/POST` | `/admin/db-manager/delete-backup` | حذف backup |
| `POST` | `/admin/db-manager/restore` | استعادة backup |
| `POST` | `/admin/db-manager/recover` | استعادة طارئة |
| `POST` | `/admin/db-manager/recover-all` | استعادة كل DBs |
| `POST` | `/admin/db-manager/repair` | إصلاح DB |
| `POST` | `/admin/db-manager/repair-all` | إصلاح كل DBs |
| `POST` | `/admin/db-manager/repair-engine` | إصلاح engine DB |
| `POST` | `/admin/db-manager/reindex` | إعادة indexing |
| `POST` | `/admin/db-manager/vacuum` | vacuum (تقليص الحجم) |
| `POST` | `/admin/db-manager/wal-checkpoint` | WAL checkpoint |
| `POST` | `/admin/db-manager/checkpoint-all` | checkpoint لكل DBs |
| `POST` | `/admin/db-manager/cleanup-old-backups` | تنظيف backups قديمة |
| `POST` | `/admin/db-manager/cleanup-symbols` | تنظيف رموز مكررة |
| `POST` | `/admin/db-manager/drop-table` | حذف جدول |
| `POST` | `/admin/db-manager/truncate-table` | تفريغ جدول |
| `POST` | `/admin/db-manager/query` | استعلام SQL مباشر |
| `POST` | `/admin/db-manager/integrity` | فحص سلامة |

### 15.3 الباك-تست والتوقعات
| Method | Path | الوصف |
|--------|------|------|
| `GET/PUT` | `/admin/advanced-analysis/config` | إعدادات التحليل المتقدّم |
| `POST/GET` | `/admin/advanced-analysis/run` | تشغيل تحليل متقدّم |
| `POST` | `/admin/backtest/ab-test` | A/B test |
| `GET` | `/admin/backtest/engine-results` | نتائج engine |
| `POST` | `/admin/backtest/run-engine` | تشغيل engine باك-تست |
| `POST` | `/admin/backtest/v40/run` | باك-تست V40 |
| `GET` | `/admin/backtest/v40/stats` | إحصائيات V40 |
| `GET` | `/admin/backtest/v40/status/[jobId]` | حالة job |
| `GET/POST` | `/admin/clean-predictions` | تنظيف توقعات |
| `POST/GET` | `/admin/clear-junk-data` | مسح بيانات قديمة |
| `POST/GET` | `/admin/clear-predictions` | مسح توقعات |
| `POST/GET` | `/admin/close-predictions` | إغلاق توقعات |
| `GET` | `/admin/learned-lessons` | دروس مستفادة |
| `GET` | `/admin/historical-backfill/results` | نتائج backfill |
| `POST` | `/admin/historical-backfill/run` | تشغيل backfill |
| `GET` | `/admin/historical-backfill/status` | حالة backfill |
| `POST` | `/admin/generate-predictions` | توليد توقعات |
| `POST/GET` | `/admin/generate-historical-predictions` | توقعات تاريخية |
| `POST` | `/admin/retroactive-predictions` | توقعات بأثر رجعي |
| `POST/GET` | `/admin/fix-dates` | إصلاح تواريخ |
| `POST/GET` | `/admin/refresh-historical-data` | تحديث بيانات تاريخية |

### 15.4 استيراد البيانات
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/admin/import-data` | استيراد بيانات |
| `POST/GET` | `/admin/import-egxpilot` | استيراد egxpilot |
| `POST` | `/admin/import-snapshot` | استيراد snapshot |
| `POST/GET` | `/admin/import-stocks` | استيراد أسهم |
| `POST/GET` | `/admin/scrape-stocks` | scrape أسهم |
| `POST/GET` | `/admin/sync-stocks-db` | مزامنة stocks.db |
| `POST` | `/admin/sync-fundamentals` | مزامنة بيانات أساسية |
| `POST/GET` | `/admin/sync-vps` | مزامنة VPS |

### 15.5 إدارة المحركات
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/admin/engine-control/status` | حالة المحركات |
| `POST` | `/admin/engine-control/toggle` | toggle محرك |
| `POST` | `/admin/engine-control/trigger` | تشغيل محرك يدويًا |
| `POST` | `/admin/engine-control/weights` | أوزان المحركات |
| `GET/POST` | `/admin/engine-settings` | إعدادات المحرك |
| `POST` | `/admin/engine-settings/reset` | reset إعدادات |
| `GET` | `/admin/engines-status` | حالة كل المحركات |
| `POST` | `/admin/build-stock-dna` | بناء DNA سهم |

### 15.6 المستخدمين
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/admin/users` | قائمة المستخدمين |
| `GET/PATCH/DELETE` | `/admin/users/[id]` | مستخدم واحد |
| `POST` | `/admin/users/cleanup-expired` | تنظيف حسابات منتهية |
| `GET/POST` | `/admin/v40-control` | تحكم V40 |
| `GET/POST` | `/admin/recommendation-settings` | إعدادات التوصيات |
| `GET/POST` | `/admin/recommendations` | توصيات (admin) |

### 15.7 الاشتراكات والتيليجرام
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/admin/subscription/seed` | seeding باقات |
| `POST` | `/admin/subscription/set-plan` | تعيين باقة لمستخدم |
| `GET/POST` | `/admin/telegram-report` | تقارير تيليجرام |

#### 🤖 بوابة ربط بوت التليجرام (BOT-SUBSCRIPTION-GATE)

ثلاث endpoints بتربط بوت `investusernamebot` بحساب على الموقع، عشان البوت ما
يشتغلش لحد ما المستخدم يكون مسجّل + مشترك (أو داخل فترة الـ 14 يوم trial).

| Method | Path | المصادقة | الوصف |
|--------|------|----------|------|
| `POST` | `/api/bot/link-token` | `X-Bot-Secret` | البوت يولّد توكن ربط لمرة واحدة (TTL 10 دقايق) |
| `GET` | `/api/bot/check-subscription` | `X-Bot-Secret` | هل الـ `chat_id` مربوط؟ والاشتراك مدفوع/-trial نشط؟ |
| `POST` | `/api/bot/link-account` | NextAuth session | المتصفحأكّد الربط بعد ما المستخدم يسجّل دخوله |

**متغيرات البيئة المطلوبة** (نفس القيمة في `.env` الموقع و `.env` البوت):

| المتغير | الاستخدام |
|---------|-----------|
| `BOT_API_SECRET` | السر المشترك. الـ endpoints بتفشل مقفولة (401) وهو فاضي، والبوت بيعمل fail-open (مفيش بوابة) |
| `NEXT_PUBLIC_SITE_URL` | أصل الموقع، لبناء رابط `?bot_link=TOKEN` |
| `NEXT_PUBLIC_API_URL` | أساس الـ API اللي البوت بيناديه (`/api/bot/*`) |

توليد قيمة قوية: `openssl rand -hex 32`

**الجداول:** `user_telegram_links` و `bot_link_tokens` في `db/auth.db`. مفيش
migration step في الإنتاج، فـ `src/lib/bot-link-db.ts` بيعمل
`CREATE TABLE IF NOT EXISTS` مرة واحدة لكل process — يعني مفيش migration لازم
يتشغّل يدوي.

**فرق مهم:** البوت بيفرّق بين "المستخدم مش مربوط" (`{linked:false}`) وبين
"الموقع مش راد" (`{_error:true}`) — التاني بيعرض رسالة مشكلة مؤقتة، مش رسالة
"اربط حسابك". عشان كده أي error في الموقع مش بيقفل المستخدمين المسجّلين.

**فحص سريع:** `npx tsx scripts/verify-bot-link-db.ts` و
`npx tsx scripts/verify-bot-routes.ts` و
`python3 vps-service/telegram/verify_bot_gate.py`

### 15.8 التقارير والكروت التعليمية
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/admin/reports` | تقارير |
| `GET/POST` | `/admin/reports/[id]` | تقرير واحد |
| `GET` | `/admin/reports/[id]/image` | صورة تقرير |
| `GET/POST` | `/admin/educational-cards` | كروت تعليمية |
| `GET/POST/DELETE` | `/admin/educational-cards/[id]` | كرت تعليمي |
| `GET` | `/admin/educational-cards/lessons` | دروس |
| `GET` | `/admin/educational-cards/[id]/image` | صورة كرت |

### 15.9 متنوّع
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/admin/stats` | إحصائيات عامة |
| `GET` | `/admin/analytics` | تحليلات |
| `GET` | `/admin/system-health` | صحة النظام |
| `GET` | `/admin/system-resources` | موارد النظام |
| `GET` | `/admin/system-topology` | طوبولوجيا النظام |
| `GET` | `/admin/monitor` | monitoring |
| `GET` | `/admin/market-status` | حالة السوق |
| `GET/POST` | `/admin/news` | أخبار (admin) |
| `GET/POST/PUT/DELETE` | `/admin/promo-codes` | أكواد خصم |
| `GET/POST` | `/admin/pm2-control` | تحكم PM2 |
| `GET/POST` | `/admin/purge-cache` | مسح الكاش |
| `GET` | `/admin/export-data` | تصدير بيانات |
| `GET` | `/admin/export-vps` | تصدير VPS |
| `GET/POST` | `/admin/currency` | عملات (admin) |
| `GET/POST` | `/admin/gold` | ذهب (admin) |
| `GET` | `/admin/seasonality` | موسمية |
| `GET` | `/admin/platform-performance` | أداء المنصة |
| `GET` | `/admin/phase4-status` | حالة phase 4 |
| `GET` | `/admin/feature-flags` | feature flags |
| `GET` | `/admin/data-sources` | مصادر البيانات |
| `POST` | `/admin/ai-analyze` | تحليل AI (admin) |
| `POST` | `/admin/ai-predictions/generate` | توليد توقعات AI |
| `POST` | `/admin/ai-predictions/evaluate-range` | تقييم مدى توقعات |
| `POST/GET` | `/admin/screener-refresh` | تحديث screener |
| `GET/POST` | `/admin/ab-test` | A/B test |
| `GET/POST/PUT/DELETE` | `/admin/daily-analysis` | تحليل يومي |

---

## §16 محركات البيانات (Data Engine)

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/data-engine/health` | صحة محرك البيانات |
| `GET` | `/data-engine/status` | حالة المحرك |
| `GET` | `/data-engine/stocks` | بيانات الأسهم |
| `GET` | `/data-engine/crypto` | بيانات الكريبتو |
| `GET` | `/data-engine/gold` | بيانات الذهب |
| `GET` | `/data-engine/silver` | بيانات الفضة |
| `GET` | `/data-engine/metals` | بيانات المعادن |
| `GET` | `/data-engine/forex` | بيانات الفوركس |
| `GET` | `/data-engine/new-db-stats` | إحصائيات الـ DB الجديد |
| `GET` | `/data-engine/compare-db` | مقارنة DBs |
| `GET/POST` | `/data-engine/control` | تحكم في المحرك |
| `POST/GET` | `/data-engine/reload` | إعادة تحميل |

### Cron Jobs (10 routes)
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/cron/auto-sync` | مزامنة تلقائية |
| `GET/POST` | `/cron/scheduled` | مهام مجدولة |
| `GET` | `/cron/confluence` | confluence cron |
| `GET` | `/cron/daily-telegram` | تيليجرام يومي |
| `GET` | `/cron/learning` | تعلّم cron |
| `GET` | `/cron/precompute` | precompute |
| `GET` | `/cron/predictions` | توقعات cron |
| `GET` | `/cron/screener` | screener cron |
| `GET/POST` | `/cron/update-cache` | تحديث الكاش |
| `GET` | `/cron/verify-predictions` | تحقق التوقعات |

### Scrapers & Sync
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/scraper/start` | بدء scraper |
| `GET` | `/scraper/status` | حالة scraper |
| `POST` | `/scraper/stop` | إيقاف scraper |
| `GET/POST` | `/sync-prices` | مزامنة الأسعار |
| `GET/POST` | `/sync-historical` | مزامنة تاريخية |
| `GET` | `/sync-names` | مزامنة أسماء الأسهم |
| `POST/GET` | `/mubasher/sync` | مزامنة mubasher |
| `POST/GET` | `/import` | استيراد عام |
| `POST` | `/data-import` | استيراد بيانات |

---

## §17 المحمول (Mobile APIs)

> 48 route تحت `/mobile/*` — مخصّصة لتطبيق Flutter. بتتبع نفس نمط الـ APIs العادية لكن بتردّ بـ format أبسط (مش dashboard data).

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/mobile/dashboard` | لوحة تحكم المحمول |
| `GET` | `/mobile/summary` | ملخص عام |
| `GET` | `/mobile/auth/me` | بيانات المستخدم |
| `GET` | `/mobile/portfolio` | محفظة المحمول |
| `GET/POST/DELETE` | `/mobile/portfolio` | إدارة محفظة |
| `GET` | `/mobile/portfolio/analyze` | تحليل محفظة |
| `GET` | `/mobile/portfolio/intelligence` | ذكاء محفظة |
| `GET` | `/mobile/watchlist` | قائمة مراقبة |
| `GET/POST/DELETE` | `/mobile/watchlist` | إدارة قائمة |
| `GET` | `/mobile/watchlist/intelligence` | ذكاء قائمة مراقبة |
| `GET/POST` | `/mobile/watchlist-enhanced` | قائمة محسّنة |
| `GET` | `/mobile/stocks/[ticker]` | سهم |
| `GET` | `/mobile/stocks/[ticker]/professional-analysis` | تحليل احترافي |
| `GET` | `/mobile/stocks/[ticker]/recommendation` | توصية |
| `GET` | `/mobile/stocks/EGX/professional-analysis` | تحليل EGX |
| `GET` | `/mobile/stocks/EGX/recommendation` | توصية EGX |
| `GET` | `/mobile/analysis/EGX` | تحليل EGX |
| `GET` | `/mobile/analysis/[ticker]` | تحليل سهم |
| `GET` | `/mobile/market/overview` | نظرة عامة سوق |
| `GET` | `/mobile/market/morning-bell` | جرس الصباح |
| `GET` | `/mobile/market/recommendations/ai-insights` | رؤى AI |
| `GET` | `/mobile/predictions` | توقعات |
| `GET` | `/mobile/predictions/continuation` | استمرار توقعات |
| `GET` | `/mobile/predictions/exit-status` | حالة خروج |
| `GET` | `/mobile/recommendations` | توصيات |
| `GET` | `/mobile/expert-recommendations` | توصيات خبراء |
| `GET/POST` | `/mobile/maestro` | Maestro engine |
| `GET` | `/mobile/signals` | إشارات |
| `GET` | `/mobile/alerts/check` | فحص تنبيهات |
| `GET/POST/DELETE` | `/mobile/alerts/settings` | إعدادات تنبيهات |
| `GET` | `/mobile/notifications` | إشعارات |
| `GET/POST` | `/mobile/news` | أخبار |
| `GET` | `/mobile/reports` | تقارير |
| `GET` | `/mobile/seasonality` | موسمية |
| `GET` | `/mobile/risk` | مخاطر |
| `GET/POST` | `/mobile/community` | مجتمع |
| `GET` | `/mobile/learning` | تعلّم |
| `GET` | `/mobile/ai/recommendations` | توصيات AI |
| `GET` | `/mobile/crypto` | كريبتو |
| `GET` | `/mobile/crypto/[id]` | عملة |
| `GET` | `/mobile/crypto/analysis` | تحليل كريبتو |
| `GET` | `/mobile/crypto/learning` | تعلّم كريبتو |
| `GET` | `/mobile/crypto/portfolio` | محفظة كريبتو |
| `GET` | `/mobile/crypto/recommendations` | توصيات كريبتو |
| `GET` | `/mobile/crypto/watchlist` | قائمة مراقبة كريبتو |
| `GET` | `/mobile/gold` | ذهب |
| `GET` | `/mobile/gold/history` | تاريخ الذهب |
| `GET` | `/mobile/currency` | عملات |
| `GET` | `/mobile/subscription` | اشتراك |
| `GET` | `/mobile/zakat-calculator` | حاسبة زكاة |

---

## §18 الـ Proxies والـ Webhooks

| Method | Path | الوصف |
|--------|------|------|
| `GET/POST/PUT/DELETE/PATCH` | `/python/[...path]` | Proxy لـ Python backend (Flask on port 5000) |
| `GET/POST/PUT/DELETE/PATCH` | `/proxy/[...path]` | Proxy عام |
| `GET/POST/PUT/DELETE` | `/proxy-prod/[...path]` | Proxy للـ production VPS |
| `*` | `/telegram/[...path]` | Proxy لـ Telegram Bot API |
| `GET/POST/PUT/PATCH/DELETE` | `/[...slug]` | catch-all (404 handler) |

---

## §19 محرّك Maestro

> Maestro هو الـ orchestrator الموحّد لكل محركات التحليل. بيجمع نتائج V40 + AI + Devil + خبراء + Technical.

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/maestro` | نقطة الدخول الرئيسية |
| `GET` | `/maestro/overview` | نظرة عامة |
| `GET` | `/maestro/command-center` | مركز القيادة |
| `GET` | `/maestro/config` | إعدادات Maestro |
| `GET` | `/maestro/signals` | إشارات Maestro |
| `GET` | `/maestro/news` | أخبار Maestro |
| `GET` | `/maestro/personas` | personas (مضارب/مستثمر) |
| `GET` | `/maestro/stock/[ticker]` | تحليل Maestro لسهم |
| `GET` | `/maestro/logic-panel` | لوحة المنطق |

### v2 Pipeline (محرك موحّد v2)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/v2/pipelines` | قائمة pipelines |
| `POST/PUT` | `/v2/pipeline` | إنشاء/تعديل pipeline |
| `GET` | `/v2/pipeline/[name]/summary` | ملخص pipeline |
| `PUT` | `/v2/pipeline/[name]/engine/[engine]/toggle` | toggle محرك داخل pipeline |
| `PUT` | `/v2/pipeline/[name]/engine/[engine]/weight` | وزن محرك |
| `GET` | `/v2/engines` | قائمة المحركات |
| `GET/POST` | `/v2/admin/config` | إعدادات v2 |
| `POST` | `/v2/analyze` | تحليل v2 |
| `POST` | `/v2/unified/analyze` | تحليل موحّد |
| `POST` | `/v2/unified/scan` | scan موحّد |
| `GET` | `/v2/unified/config` | إعدادات unified |
| `GET` | `/v2/unified/personas` | personas موحّدة |
| `GET` | `/v2/recommend` | توصية v2 |
| `GET` | `/v2/morning-recommendations` | توصيات الصباح |
| `GET` | `/v2/day-trading-opportunities` | فرق day-trading |
| `GET` | `/v2/stock/[symbol]/analysis` | تحليل سهم v2 |
| `GET` | `/v2/chart/full-analysis` | تحليل شامل للشارت |
| `GET` | `/v2/live-analysis` | تحليل لحظي |
| `GET` | `/v2/health` | صحة v2 |
| `GET` | `/v2/presets` | presets |
| `GET` | `/v2/feedback/*` | feedback على backtest/predictions/run/status (4 routes) |

---

## §20 الـ v4 / v82 endpoints

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/v4/stats` | إحصائيات v4 |
| `GET` | `/v82` | محرك v82 (قرارات) |

---

## §21 أدوات متنوّعة

### Export & Import
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/export` | تصدير عام |
| `GET` | `/database-report` | تقرير DB |
| `GET/POST` | `/parse-recommendations` | parse توصيات |

### Community & User Posts
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/community` | مجتمع |
| `GET/POST` | `/community/seed` | seeding مجتمع |
| `GET/POST` | `/community/posts/[post_id]/comments` | تعليقات منشور |
| `GET/POST` | `/user-posts` | منشورات مستخدمين |
| `GET/DELETE` | `/user-posts/[id]` | منشور |
| `POST` | `/user-posts/[id]/like` | إعجاب |

### Feedback & Points
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST` | `/feedback` | ملاحظات مستخدمين |
| `GET` | `/points` | نقاط المستخدم |
| `GET` | `/points/leaderboard` | لوحة الصدارة |

### Scanner & Screener
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/scanner/quick` | scan سريع |
| `GET/POST` | `/scanner/run` | scan كامل |
| `GET` | `/screener/advanced` | screener متقدّم |

### Expert Recommendations
| Method | Path | الوصف |
|--------|------|------|
| `GET/POST/PUT/DELETE` | `/expert-recommendations` | توصيات خبراء (CRUD) |
| `GET` | `/expert-recommendations/active` | توصيات نشطة |
| `GET` | `/expert-recommendations/experts` | قائمة خبراء |
| `GET` | `/expert-recommendations/batch` | batch توصيات |
| `POST` | `/expert-recommendations/import` | استيراد توصيات |
| `GET` | `/recommendations/expert` | alias |

### Recommendations
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/recommendations` | توصيات |
| `GET` | `/recommendations/backtest` | باك-تست توصيات |
| `GET` | `/recommendations/batch` | batch |
| `GET` | `/recommendations/verify` | تحقق |
| `POST` | `/recommendations/publish` | نشر |
| `POST` | `/recommendations/publish/batch` | نشر batch |
| `POST` | `/recommendations/retroactive-evaluate` | تقييم بأثر رجعي |

### Smart Confluence & Unified
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/smart-confluence/tabs` | تبويبات |
| `GET` | `/smart-confluence/analysis/[symbol]` | تحليل |
| `GET` | `/unified-analysis` | تحليل موحّد |
| `GET` | `/unified-analysis/[symbol]` | تحليل سهم |
| `GET` | `/unified-analysis/recommendations` | توصيات |
| `GET` | `/unified-scoring` | scoring موحّد |
| `GET` | `/unified-stocks` | أسهم موحّدة |
| `GET` | `/unified-market-analysis` | تحليل سوق موحّد |
| `GET/POST` | `/unified` | نقطة موحّدة |

### Tracking & Stats
| Method | Path | الوصف |
|--------|------|------|
| `POST` | `/track` | تتبّع page view (analytics) |
| `GET` | `/tab-data` | بيانات تبويب |
| `GET` | `/monthly-performance` | أداء شهري |
| `GET` | `/indicator-trust-scores` | درجة ثقة المؤشرات |
| `GET` | `/fomo/missed-opportunities` | فرص ضائعة (FOMO) |
| `GET` | `/data-status` | حالة البيانات |
| `GET` | `/test-db` | اختبار DB |
| `GET` | `/test-simple` | اختبار بسيط |
| `GET` | `/init-db` | init DB |
| `GET` | `/trading/time` | وقت التداول |
| `GET` | `/system-control` | تحكم في النظام |
| `GET` | `/topology` | طوبولوجيا |
| `POST/GET` | `/run-all` | تشغيل كل المحركات |
| `GET/POST` | `/live-monitor` | مراقب لحظي |
| `GET` | `/live-monitor/ledger` | سجل المراقب |
| `POST` | `/live-monitor/trigger` | تشغيل يدوي |
| `GET/POST` | `/auto-refresh/start` | بدء auto-refresh |
| `GET` | `/auto-refresh/status` | حالة auto-refresh |
| `POST` | `/auto-refresh/stop` | إيقاف |
| `GET/POST` | `/cache` | كاش |
| `POST/GET` | `/cache/clear` | مسح الكاش |
| `GET` | `/features` | ميزات مفعّلة |
| `GET` | `/eodhd/backfill-status` | حالة backfill EODHD |

---

## §22 Devil's Advocate

> محرّك "محامي الشيطان" — تحليل معاكس لكل توصية عشان يحذّر من السلبيات.

| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/devil/market-mood` | مزاج السوق |
| `GET` | `/devil/calendar` | تقويم أحداث |
| `GET` | `/devil/card/[ticker]` | كرت سهم (Devil) |
| `GET` | `/devil/scenario/[ticker]` | سيناريوهات سهم |
| `POST` | `/devil/filter` | فلتر Devil |

---

## §23 Hunter & Sniper

### Hunter (صياد الفرص)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/hunter/daily-picks` | اختيارات اليوم |
| `GET` | `/hunter/screener` | screener |
| `POST` | `/hunter/refresh` | تحديث |
| `POST` | `/hunter/publish-pick` | نشر اختيار |
| `GET` | `/hunter/cache-status` | حالة الكاش |

### Sniper (قنّاص التنبيهات)
| Method | Path | الوصف |
|--------|------|------|
| `GET` | `/sniper/scan` | scan |
| `POST` | `/sniper/track` | تتبّع |
| `GET` | `/sniper/backtest` | باك-تست |
| `GET` | `/sniper/closer/pending` | صفقات قيد الإغلاق |
| `POST` | `/sniper/closer/run` | إغلاق صفقات |
| `GET` | `/sniper/learning/performance` | أداء التعلّم |

---

## §24 التقارير (Reports)

> 3 route تحت `/reports/*` — توفّر تقارير يومية / صباحية / أسبوعية للعميل.
>
> **DOC note (FIX-WAVE-4-DOCS — 2026-10-01):** كان مفقودًا من توثيق AUDIT-DEEP-6 السابق. موثّقة الآن بالكامل بناءً على فحص الـ route files.

| Method | Path | الوصف | Auth | المصدر |
|--------|------|------|------|--------|
| `GET` | `/reports/daily` | تقرير السوق اليومي — proxy للـ Python على `:8010/api/market-pulse`. يمرّر الـ query string كما-is. timeout=30s. | session | `src/app/api/reports/daily/route.ts` |
| `GET` | `/reports/morning` | جلب آخر morning reports من `stocks.db.morning_reports` (default limit=5). يقبل `?date=YYYY-MM-DD` لجلب تقرير يوم محدد + `?limit=N`. | session | `src/app/api/reports/morning/route.ts` |
| `POST` | `/reports/morning` | استقبال morning report جديد من Python backend (يتطلب `Authorization: Bearer <API_KEY>` لو `API_KEY` env set). body: `{ report_date?, report_text (required), report_type?, generated_at? }`. upsert بـ `UNIQUE(report_date, report_type)`. | api-key (when configured) | `src/app/api/reports/morning/route.ts` |
| `DELETE` | `/reports/morning` | حذف morning reports قديمة. accepts `?before=YYYY-MM-DD` لحذف كل التقارير قبل تاريخ محدد. default: حذف كل التقارير الأقدم من 30 يوم. returns `{ success: true, deleted: <count> }`. | api-key (when configured) | `src/app/api/reports/morning/route.ts` |
| `GET` | `/reports/weekly` | تقرير السوق الأسبوعي — proxy للـ Python على `:8010/api/market-pulse`. يمرّر الـ query string كما-is. timeout=30s. | session | `src/app/api/reports/weekly/route.ts` |

### 24.1 Schema — `stocks.db.morning_reports` (NEW table)

```sql
CREATE TABLE IF NOT EXISTS morning_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date  TEXT    NOT NULL,
  report_text  TEXT    NOT NULL,
  report_type  TEXT    DEFAULT 'daily',
  generated_at TEXT,
  received_at  TEXT    DEFAULT (datetime('now')),
  source       TEXT    DEFAULT 'python_engine',
  UNIQUE(report_date, report_type)
);
CREATE INDEX IF NOT EXISTS idx_morning_date ON morning_reports(report_date);
```

### 24.2 الـ flow:

```
Python engine (Kimi/GLM) يولّد morning report
    ↓
POST /api/reports/morning  (with API_KEY)
    ↓
stocks.db.morning_reports  (upsert by report_date + report_type)
    ↓
Flutter/Web client
    ↓
GET /api/reports/morning?limit=5  (latest reports)
    ↓
عرض في MorningBellSection.tsx
```

### 24.3 الحالة الحالية:

- ✅ الـ daily + morning + weekly routes موجودة وشغّالة في `src/app/api/reports/`.
- ✅ morning route بـ يستخدم `better-sqlite3` مباشرة على `stocks.db` (مش Prisma).
- ⚠️ daily + weekly routes proxy للـ Python على `/api/market-pulse` — لو Python backend مش شغّال → 503 + `error: 'internal_error'`.
- ⚠️ POST + DELETE على morning route محميّين فقط لو `API_KEY` env var موجود. لو مش موجود → open. (Recommendation: enforce api-key في كل البيئات production.)

---

## §25 Sharia Compliance APIs (NEW — Wave 8 — Rule 64)

> **المرجع الدستوري:** القاعدة 64 (SHARIA-COMPLIANCE — 2026-10-03 — Task 23-A · **مُحدَّث after as-built execution**).
> **الـ backend:** `data_engine/scrapers/sharia_compliance_scraper.py` (cron `30 15 * * 6` = السبت 15:30 UTC · conditional GET بالـ ETag) → يكتب **6** جداول في `data_engine.db` (sharia_sources + sharia_source_status + sharia_metrics + sharia_purification_rates + **sharia_symbol_map** + sharia_history).
> **الـ calculator:** `vps-service/portfolio/purification_calculator.py` (Python=Brain per Rule 20) — تطهير صفقة واحدة + تطهير محفظة كاملة.
> **الـ frontend:** `src/modules/sharia/components/ShariaView.tsx` (Task 23-C — commits `324a095` + `704aa0c`).
> **المعايير:** S&P Shariah أساسي + Musaffa/Kashif/Osoul تكميلية + AAOIFI مستعدّة + `consensus_min=6`.
> **⚠️ الكشف الثلاثي:** `GET /api/sharia` لو `sharia_metrics` مش موجودة بيرجّع **503 + `error: 'sharia_not_scraped'`** مع الـ hint بالـ command (مش 500).

| Method | Path | الوصف | Auth | المصدر |
|--------|------|------|------|--------|
| `GET` | `/sharia` | قائمة الأسهم مع `is_halal_consensus` + `compliant_sources_count` + `sp_haram_earning_pct` + `raw_symbol` + `alias_method` + `alias_confidence` + `needs_review` + `compliant_sources` (group_concat) + 8-source breakdown. **معاملات الاستعلام:** `?symbol=X` (تفاصيل سهم واحد + تفصيل كل المصادر + `purification_rates[]` + السعر الحالي) · `?search=` (رمز أو اسم عربي) · `?consensus=true` (بس الإجماع ≥6/8) · `?method=S&P` · `?source=musaffa` · `?review=true` (طابور المراجعة اليدوية) · `?limit=&offset=`. الرد كمان بيرجّع `alias_map.totals` + `alias_map.review_queue` من `sharia_symbol_map`. | public | `src/app/api/sharia/route.ts` (Task 23-C · مُحدَّث 2026-10-03) |
| `POST` | `/sharia/purification` | حساب التطهير. **وضعان** — (أ) صفقة واحدة: `{ symbol, quantity, buy_price?, sell_price? }` (ب) محفظة: `{ user_id, portfolio_id?, method?, include_capital_gain? }`. `method` = `'S&P'` (الافتراضي) أو `'musaffa'` \| `'kashif'` \| `'osoul'`. `include_capital_gain: false` = تطهير على التوزيعات بس. الرجوع = `PositionResult` (rate_pct · purification_base · purification_amount · dividends · capital_gain · dps + dps_source · compliant_sources · is_halal_consensus · warnings[] · notes[] · alternative_rates[]) أو `portfolio` (positions[] + skipped[] + risk_summary + totals). Python proxy. | public للسهم المفرد · **session إجباري للـ portfolio** | `src/app/api/sharia/purification/route.ts` (Task 23-C · **IDOR fix 2026-10-03**) |

> **🔴 Auth على portfolio scope:** `user_id` في الـ body بيتقارن بالـ session عبر `getSessionUserId()` من `@/lib/auth-helper`. `auth.userId !== user && !isAdmin` → **403 `forbidden`** · مفيش session → **401 `auth_required`**. من غير الـ gate كان أي حد يقدر يبعت `user_id` حد تاني ويسيب محفظته الشرعية.

### §25.1 — قواعد الحساب المطبَّقة فعلياً

| الحالة | السلوك | السبب |
|--------|--------|-------|
| `sell_price < buy_price` (خسارة غير محققة) | ماتخصمش من الوعاء + note واضح | معيار S&P ملزم على **الأرباح المستلمة** فعلاً |
| الوعاء = 0 أو سالب | `purification_amount` = 0 (مفيش "تطهير سالب") | التطهير التزام مش خصم |
| نسبة S&P غير منشورة | fallback لـ musaffa/kashif/osoul + warning صريح | S&P بتغطي 182 من 253 بس |
| `compliant_sources_count = 0` | warning: «التطهير مش هوالمشكلة، المشكلة في امتلاك السهم نفسه» | السهم غير شرعي أصلاً |
| `needs_review = 1` | warning: «ربط الرمز محتاج مراجعة» + طريقة الربط | `alias_confidence` مش `high` |
| DPS مش موجود | fallback: `tab_dividends.dps_ttm` → `stocks.dps_ttm` → اشتقاق `dividend_yield × current_price` | أعمدة DPS ناقصة في بياناتنا |
| `stock_ticker` تالف في `portfolio_assets` | بيتحط في `skipped[]` مع `reason` | `'FWRYFawry...'` · `'INTEGRATED'` · `'4160'` |
| `method` مش متاح للسهم | fallback لأول rate متاحة + warning | حماية بدل فشل صامت |

### §25.2 — Alias map (طابور المراجعة اليدوية)

`sharia_symbol_map` بيحفظ كل حالة ربط بدرجة ثقتها. **الربط ما بينكتبش صامت لما الرمز مختلف.**

| `match_method` | الثقة | `needs_review` | الحالي |
|----------------|-------|----------------|--------|
| `exact_ticker` | high | 0 | **249** |
| `arabic_prefix_ticker` | high | 0 | (بيستخدم في `KORRA`) |
| `name_exact_code_differs` | medium | 1 | 1 — `LBCT→IBCT` |
| `symbol_in_name` | medium | 1 | (مرفوض بـ collision في حالتين) |
| `collision_with_existing_source_symbol` | conflict | 1 | **مرفوض** — `EFG→HRHO` · `KORRA→KORA` |
| `unresolved` | none | 1 | **3** — `EFG` · `KORRA` · `MBEN` |

> **Collision guard (إلزامي):** لو الرمز المترشّح موجود هو نفسه كـ `symbol` **مستقل في المصدر** → الربط مرفوض. السبب: `KORA` (kashif compliant) و `KORRA` (0/8) عندهم نفس الاسم العربي بالظبط بس هما سهمين مختلفين في المصدر. نفس الفخ موجود عندنا في `VLMR`/`VLMRA` (المالك: «دول شركتين منفصلين مش شركة واحدة»).
>
> **3 unresolved:** `MBEN` (إم بي للهندسة والمقاولات · halal_bourse=compliant · sp%=0.11) غايب عن **كل** جداولنا بصيغ `MBEN` · `ام بي` · `إم بي` · `للهندسة والمقاولات` · `Engineering and Contracting`. `EFG` موجود عندنا تحت `HRHO`. `ANFI` كان هينحسب فاقد لولا إن الـ resolver بيقرأ `market.db` كـ master تاني.
>
> **🔑 عقد الـ frontend:** `ShariaView.tsx` (Task 23-C) بيبعت بالظبط: مفرد `{ symbol, quantity, method, include_capital_gain, buy_price?, sell_price? }` · محفظة `{ user_id, method, include_capital_gain }`. `method` الافتراضي `S&P` مطابق لـ `method_key` في `sharia_purification_rates`.
>
> **🔄 Compat shim (2026-10-03):** الـ UI بيقرأ أسماء مختلفة عن اللي الـ Python بيرجّعه، والـ route بيطلّع **الاسمين** (canonical من البايثون + alias للتوافق) بدل تعديل المكوّن:
>
> | الحقل في الـ UI | الـ alias في الرد | المصدر |
> |----------------|------------------|--------|
> | `purification_rate_pct` | = `rate_pct` | `PositionResult` |
> | `realized_capital_gain` | = `capital_gain` | `PositionResult` |
> | `total_purification` | = `totals.purification_amount` | portfolio |
> | `trades_count` | = `totals.positions_with_sharia_data` | portfolio |
> | `total_dividends` | مجموع `positions[].dividends` | portfolio |
> | `total_realized_capital_gain` | مجموع `positions[].capital_gain` | portfolio |
> | `per_symbol[]` | = `positions[]` بعد إعادة التسمي | portfolio |

---

## §26 Source Authority Admin APIs (NEW — Wave 8 — Rule 66)

> **المرجع الدستوري:** القاعدة 66 (SOURCE-AUTHORITY — 2026-10-03 — Task 23-A).
> **الـ backend:** `vps-service/data/source_authority.py` (237 LOC — `write_guarded()` mandatory guard before any INSERT to `price_history.db`) — wired in 5/8 scrapers per Task 23-B + wired in `master_analyzer.analyze()` per commit `435c16f` (Rule 66 enforced end-to-end).
> **الـ admin UI:** ⏳ PENDING — identified as P0 missing in Task 27-B audit (see `05-CURRENT_STATE.md` §17.6 + `02-SCREENS_AND_COMPONENTS.md` §0.7.C).

| Method | Path | الوصف | Auth | المصدر |
|--------|------|------|------|--------|
| `GET` | `/admin/sources` | ⏳ PENDING (planned). يعرض `CANONICAL_SOURCES` لكل سوق (EGX=`intraday_aggregated` · TADAWUL/KSE/QSE/US=`yahoo_clean` · CRYPTO=`crypto_fetcher` · GOLD=`gold_fetcher`) + `BANNED_SOURCES` (`egxpilot_live` + `yahoo_safetynet` + `yfinance_backfill`) + last write count per source per market + recent `write_guarded()` rejections (skipped writes from non-canonical sources). | admin | ⏳ PENDING (handoff to Fix Battalion — Task 27-B P0 #2) |
| `PATCH` | `/admin/sources/banned` | ⏳ PENDING (planned). Toggle banned state for a source. body: `{ source: 'yahoo_safetynet', banned: true }` → updates `BANNED_SOURCES` list in `source_authority.py` config. | admin | ⏳ PENDING |

> **Implementation status:** Backend (`source_authority.py`) is fully ACTIVE per Rule 66 — `write_guarded()` is wired in 5 scrapers (Task 23-B) + `master_analyzer.analyze()` (commit `435c16f`). The admin route to SURFACE this data is PENDING. See `05-CURRENT_STATE.md` §17.1 + `02-SCREENS_AND_COMPONENTS.md` §0.7.C.

---

## 🆕 الإصلاحات الأمنية + التحقق (NEW — 2026-10-01, Task FIX-P1 to FIX-P6)

### APIs الأمنية المُصحّحة
| API | الإصلاح | قبل | بعد |
|-----|---------|------|------|
| `POST /api/subscription/activate` | verify Paymob إجباري | يقبل tier من body | يقبل paymobOrderId + transactionId فقط |
| `POST /api/admin/auth` | gated بـ ALLOW_FORM_LOGIN | مفتوح دايماً | 403 لو ALLOW_FORM_LOGIN !== 'true' |
| `GET /api/admin/referrals` | requireAdminAsync | مفتوح | محمي بـ admin auth |
| `GET /api/admin/subscriptions` | requireAdminAsync | مفتوح | محمي بـ admin auth |
| `POST /api/telegram/publish-stock` | يكتب published_at | fire-and-forget | يحدّث predictions DB بعد النشر |
| `GET /api/predictions/price-verify` | يستخدم published_at | يبدأ من prediction_date | يبدأ من COALESCE(published_at, prediction_date) |
| `GET /api/predictions/honest-tracking/stats` | يفلتر was_published=1 | يحسب كل التوقعات | يحسب بس المنشورة فعلاً |
| `GET /api/predictions/honest-tracking/missed-opportunities` | يفلتر was_published=1 | يحسب بأثر رجعي | يحسب بس المنشورة فعلاً |
| `GET /api/market/top-movers` | يقبل market parameter | بيتجاهل السوق | بيفلتر بالسوق المختار |
| `GET /api/maker-radar` | trial gate | مفتوح | 403 لو trial منتهي |
| `POST /api/ai/chat` | trial gate + AI daily limit | مفتوح | 403 لو trial منتهي + 3 رسائل/يوم للـ Free |
| `POST /api/watchlist` | enforceWatchlistLimit | مفتوح | 403 لو تجاوز 5 أسهم (Free) |
| `POST /api/finance/assets` | enforcePortfolioLimit | مفتوح | 403 لو تجاوز 5 صفقات (Free) |
| `POST /api/alerts/create` | enforceAlertLimit | مفتوح | 403 لو تجاوز 3 تنبيهات (Free) |

### Prisma Models الجديدة (predictions schema)
```prisma
published_at       DateTime?   // وقت النشر الفعلي على تيليجرام
telegram_message_id String?    // ربط رسالة تيليجرام بالتوقع
was_published      Int @default(0)  // هل اتنشر فعلاً؟
target_hit_at     DateTime?   // وقت تحقق الهدف
stop_hit_at       DateTime?   // وقت ضرب وقف الخسارة
@@index([was_published])        // index للفلترة السريعة
```

### Helper Libraries الجديدة
| المكتبة | الوصف |
|---------|------|
| `src/lib/targets-validator.ts` | signal-aware validator (LONG + SHORT) — 8 تأثيرات |
| `src/lib/visual-templates.ts` | 9 قوالب بصرية (gradient + accent + glow لكل ميزة) |
| `src/lib/text-effects.ts` | 8 تأثيرات نصية + 4 easing + 6 presets |
| `src/lib/hashtag-library.ts` | مكتبة هاشتاجات (6 أسواق × 8 ميزات) |
| `src/lib/cta-templates.ts` | 15 CTA جاهز (6 أهداف × 3 جماهير) |
| `src/lib/ad-card-generator.ts` | كروت صور PNG (3 مقاسات) |
| `src/lib/subscription-enforcement.ts` | 4 دوال enforce server-side (watchlist + portfolio + alerts + AI) |
| `src/lib/ad-templates.ts` | نصوص ثابتة لـ 8 ميزات (بدون AI) |

---

## 📊 إحصائيات سريعة

```
إجمالي الـ routes: 411 (verified 2026-10-04 — was 380 pre-Wave-8; Wave 8 Task 774a208 restored 32 Flutter API endpoints that were archived by mistake in Wave 2)
عدد الـ top-level groups: 159+ (Wave 8 restored 32 endpoints INSIDE existing groups — no new top-level groups created)

أكبر 10 مجموعات (post-Wave-8):
  117+  admin          (إدارة شاملة — was 117 in Wave 2/3; Wave 8 added 4 NEW tabs (Sharia ✅ f413bd7 + Source Authority ⏳ + Validation Monitor ⏳ + Cron Health ⏳) — admin route count unchanged but tabs added)
   ~57  mobile         (was ~25 post-Wave-2; Wave 8 restored 32 Flutter API endpoints — see §17 for full list)
   ~15  predictions    (was 37 — Wave 2 archived ~22 dead predictions routes — see §8 for survivor count)
   ~15  market         (was 32 — Wave 2 archived ~17 dead market routes — see §4 for survivor count)
   ~10  stocks         (was 26 — Wave 2 archived ~16 dead stocks routes — see §4 for survivor count)
    3  v2             (was 24 — Wave 2 archived ~21 dead v2 routes — see §20 for survivor count)
   ~10  crypto         (was 23 — Wave 2 archived ~13 dead crypto routes — see §5 for survivor count)
   ~10  portfolio      (was 21 — Wave 2 archived ~11 dead portfolio routes — see §9 for survivor count)
   ~10  finance         (was 19 — Wave 2 archived ~9 dead finance routes — see §9 for survivor count)
   15  maker-radar    (رادار السيولة — unchanged)
   2  sharia          (NEW — Wave 8 — Rule 64 — Task 23-C — see §25)
```

> **Wave 8 restored routes (Task `774a208` — 2026-10-04):** 32 endpoints under `/api/mobile/*`, `/api/app/*`, `/api/ai/*`, `/api/confluence/*`, `/api/data-engine/*`, `/api/fomo/*`, `/api/google-play/*`, `/api/kimi/*`, `/api/learning/*`, `/api/live/*` — they were all called by the Flutter mobile app's `client.dart` (181 methods) and were archived by mistake in Wave 2 cleanup. Mobile app was silently broken. All 32 restored from git history. Full list in `05-CURRENT_STATE.md` §17.2.
>
> **Wave 8 NEW APIs (Rule 64 + Rule 66):**
> - `/api/sharia` GET + `/api/sharia/purification` POST (Task 23-C — commits `324a095` + `704aa0c`) → see §25.
> - `/api/admin/sources` GET + `/api/admin/sources/banned` PATCH (⏳ PENDING — Task 27-B P0 #2) → see §26.
>

> **Wave 2 dead-route inventory (Task 7-B — 2026-10-01):** 313 routes / 35,996 LOC archived in 7 batches. Top dead groups: `/api/v2/*` (~21 routes), `/api/mobile/*` (~23 routes), `/api/predictions/*` (~22 routes), `/api/market/*` (~17 routes), `/api/stocks/*/[ticker]/*` (~16 routes), `/api/maestro/*` (~6 routes), `/api/news/*` (~5 routes), `/api/cron/*` (~5 routes), `/api/confluence/*` (~4 routes), `/api/backtesting/*` (~4 routes). Full per-route list in `archive/wave-2-cleanup-2026-10-01/src/app/api/` + worklog.md Task 7-B work log.
>
> **DOC-SYNC-FULL verification (2026-10-01):** كل APIs الجديدة موثّقة في الأقسام المناسبة:
> - `/api/ads/successful-trades` + `/api/ads/educational-lessons` → §10 Content Studio APIs ✅
> - `/api/subscription/checkout` (new Paymob version) + `/api/subscription/activate` (fixed) + `/api/subscription/status` → §3 Subscription APIs ✅
> - `/api/referral/redeem` + `/api/referral/stats` → §3 Referral APIs ✅
> - `/api/b2b/signup` + `/api/b2b/api-keys` → §3 B2B APIs ✅
> - `/api/admin/subscriptions` + `/api/admin/referrals` → §3 Admin Subscription APIs ✅
> - `/api/admin/auth` (gated by `ALLOW_FORM_LOGIN`) → §2 + §15.1 + NEW Security Fixes ✅

---

## 🔐 طبقات الحماية (Auth Tiers)

| Tier | الوصف | الـ routes |
|------|------|-----------|
| `public` | مفيش auth | `/health`, `/keepalive`, `/auth/login`, `/auth/register`, `/app/version` |
| `session` | NextAuth session cookie | أغلب routes الـ user-facing |
| `admin` | `admin_session` cookie أو `X-Admin-Token` header | كل `/admin/*` + `/db-stats` + `/system/*` |
| `subscription` | session + فحص باقة (premium/pro) | `/portfolio/*` + `/predictions/advanced` + `/ai/*` |

**Admin auth flow:**
1. POST `/admin/auth` بـ username+password → set `admin_session` cookie (httpOnly, 7d)
2. أو POST `/admin/auth/auto-cookie` لو المستخدم مسجل بـ Google وأدمن
3. كل `/admin/*` requests بتحقّق cookie تلقائياً (middleware)
4. fallback: header `X-Admin-Token: base64(username:password)`

---

## 🌐 المسارات النسبية (Rule 61 — RELATIVE-PATHS-ONLY)

كل الـ routes في الجدول ده بتبدأ بـ `/api/` (relative). **ممنوع** استخدام:
- `http://localhost:3000/api/...`
- `https://invist.m2y.net/api/...`
- أي absolute URL

في الـ frontend: `fetch('/api/...')` فقط.
في الـ services الخارجية: استخدم `process.env.SCREENSHOT_BASE_URL` (لو محتاج origin كامل زي Playwright).

---

## 📝 قواعد إضافة API جديد

1. **أنشئ ملف** `src/app/api/<group>/<name>/route.ts`.
2. **حدّد الـ HTTP methods** بالـ exports: `export async function GET/POST/PUT/DELETE/PATCH`.
3. **وثّق الـ route** في أول الملف بـ JSDoc comment block.
4. **حدّد الـ auth** عبر middleware (`src/middleware.ts`) أو `requireAdminAsync()` / `requireSession()`.
5. **حدّث هذا الملف** بإضافة الـ route للقسم المناسب (أو أنشئ قسم جديد لو group جديد).
6. **لا تستخدم** absolute URLs (Rule 61).
7. **اختبر** بـ `curl -X METHOD http://localhost:3001/api/...`.

---

*تم الإنشاء بواسطة Documentation Secretary — Task ID `API-DOC` — 2026-09-30*
*طريقة البناء: scan آلي لكل `src/app/api/**/route.ts` (679 route) + extraction للـ HTTP methods + JSDoc descriptions + تصنيف يدوي لـ 158 group في 23 قسم منطقي.*
*تم التحديث: Task `DOC-SYNC-FULL` — 2026-10-01 (تحقق شامل من كل APIs الجديدة + تحديث count إلى 687 route)*
*تم التحديث: Task `FIX-WAVE-4-DOCS` — 2026-10-01 (إضافة §24 Reports APIs (3 routes: daily + morning + weekly) + تحديث count إلى 690 route + تحديث admin count 115→117 + تحديث top-level groups 158→159)*
*تم التحديث: Task `WAVE-2-3-DOCS` — 2026-10-01 (Documentation Secretariat catching up on backlog — تحديث العدّادات: 690→380 route (Wave 2 cleanup archived 313 dead routes to `archive/wave-2-cleanup-2026-10-01/src/app/api/`) + تحديث §15 note (5 admin routes auth-hardened in-place per Rule 55 §г) + تحديث §15.1 (no count change — 5 routes hardened, not added/removed) + تحديث الإحصائيات السريعة (Wave 2 dead-route inventory per group) + إضافة Wave 2 cleanup note (6-grep verification + 6 false positives caught + 1 skipped + 1 restored). All counts verified via `find src/app/api -name 'route.ts' -type f | wc -l` = 380. Per Rule 62 (Secretary updates docs after every task) + README editing rule 1 (last-updated + changelog row in-file).)*
*تم التحديث: Task `28-C` — 2026-10-04 (Documentation Secretariat (Wave 8 Update) — تحديث العدّادات: 380→**411 route** (Wave 8 Task `774a208` restored 32 Flutter API endpoints that were archived by mistake in Wave 2 — see `05-CURRENT_STATE.md` §17.2 for the full list of restored endpoints). إضافة §25 Sharia Compliance APIs (NEW — Rule 64 — `/api/sharia` GET + `/api/sharia/purification` POST — Task 23-C — commits `324a095` + `704aa0c`). إضافة §26 Source Authority Admin APIs (NEW — Rule 66 — `/api/admin/sources` GET + `/api/admin/sources/banned` PATCH — ⏳ PENDING — Task 27-B P0 #2). تحديث §15 admin count — included 4 NEW Wave 8 tabs (Sharia management ✅ `f413bd7` + Source Authority ⏳ + Validation Monitor ⏳ + Cron Health ⏳ — see `02-SCREENS_AND_COMPONENTS.md` §0.7.C). تحديث الإحصائيات السريعة (Wave 8 restored routes + Wave 8 NEW APIs). All counts verified via `find src/app/api -name 'route.ts' -type f | wc -l` = 411. Per Rule 62 (Secretary updates docs) + Rule 63 (commit + push) + README editing rule 1.)*
