# Deep Visual + Financial Test Report

**Date:** 2026-09-28 (server time); task spec header said 2026-09-30
**Testers:** UI/UX reviewer + Financial expert (فريق الاختبار العميق + خبير مالي)
**App:** http://localhost:3001/  (Next.js dev server, PID 23354)
**Method:** Agent-browser walkthrough (mock-authenticated as `audit-test@m2y.net` premium+admin) of every hash-route + DOM text extraction + screenshot capture + direct DB + API verification + production (`https://invist.m2y.net`) cross-reference for financial sanity.
**Screenshots:** 26 files in `agent-ctx/screenshots/deep-*.png` (15 desktop screens + 11 sub-tab captures of `#recommendations` + radar retry + simulation trade dialog + trading-chart retry).

---

## Summary

- **Screens tested:** 15 desktop hash-routes + 11 sub-tabs inside `#recommendations` (the new Multi-Tab Tracking Dashboard) = **26 distinct views**.
- **New visual issues found:** 14 (most are new placeholders, errors, font-size issues, mixed-market cards on dashboard, and broken tab interactions).
- **Data quality issues:** 19 (empty local DBs, schema errors `no such column: volume` and `no such column: explosive_label`, missing inflation → -30% default, persistent "—" on indices, HTTP 500 on historical trades, CoinGecko 429 / duplicate-timestamp crashes, mixed crypto + EGX content, hardcoded wrong ticker→name mapping in simulation).
- **Financial value issues:** 7 (4 of which are CRITICAL — impossible R/R 50+, target_price >500% above entry for 34% of recent predictions, conservative-persona win-rate inflated by 1 sample, hardcoded simulation prices with wrong ticker-name mapping, default 30% inflation fallback shown as user loss, Fear & Greed 74 Greed shown next to "Market closed" even on a 24/7 crypto dashboard).
- **Overall visual score:** **5.5 / 10** — major regression since the previous UI-Audit; the app is functional but visually broken in many places because of empty local DBs.
- **Overall data score:** **3.0 / 10** — the dev environment is essentially empty, and even on production there is a systematic target_price bug (34% of recent predictions show 5×+ return expectations).

### Bottom line for the user
The **dev environment is missing its database sync** — local `predictions.db`, `stocks.db` (EGX rows), and `data_engine.db` are all empty, the Python backend on port 8010 is **OFFLINE**, and most API endpoints fall through to empty local DBs instead of production fallback. As a result, **most screens show 0.00 / 0 / — placeholders** that LOOK like real prices but aren't. On top of that, even on **production**, ~34% of recent predictions have unrealistic target prices (>500% above entry, R/R 50+) — this is a real data-quality bug, not just a dev-environment artifact.

---

## Per-Screen Deep Test

### Screen 1: #dashboard
**Screenshot:** `deep-01-dashboard.png`
**Visual score:** 5/10
**Data score:** 2/10

#### Visual issues:
- **H3 headings at 12 px** — too small for headings. "إشارات الكريبتو", "إشارات الموسمية", "الأسواق المتعددة" are H3 but rendered at 12 px (muted gray `rgb(115,115,115)`).
- Mixed content: H3s "إشارات الكريبتو", "إشارات الموسمية", "الأسواق المتعددة" appear on the EGX dashboard — these are crypto-card titles bleeding into the EGX view.
- "إنت بتركم على إيه؟ 🤔" Help/Persona modal stays in the DOM (verified invisible after Escape — but the previous audit flagged it as X2; on this run it was actually visible until Escape was pressed).
- Help-center modal contains an H2 at 20 px which is fine but it overlaps the page H2 "لوحة التحكم" (18 px) — two H2s visible at once.
- The "شاركة | نشر" (Share | Publish) buttons appear at the top-right even though there is nothing to share (no data).
- The page footer shows a "غرف أخطاء" / disclaimer that is correct.

#### Data issues:
- Main price card shows "0.00 جنيه مصري ▲ 0.00%" — empty placeholder, not real EGX30 price.
- "التحليل: السوق مغلق" — partially correct (EGX is closed on 2026-09-28 because that's a Monday in the simulated 2026 calendar; verified `is_open:false`).
- "لا توجد بيانات أسهم متاحة" — empty state where the top-movers list should be.
- Market summary card: "إجمالي الأسهم 0 / المرتفعة 0 / المنخفضة 0 / بدون تغيير 0" — all zero. **Production has 392 stocks, 62 advancers, 227 decliners.**
- "نبض السوق Market Pulse +0.0 من +5 محايد NEUTRAL" — placeholder.
- "EGX 30 — إغلاق سابق: —" — both indices show "—" instead of the real 53,776.69 value (production).
- "EGX 70 — إغلاق سابق: —" — same.
- "غير معروف التباعد: 0.00% • انتظر" — unknown state, 0% spread.
- "آخر تحديث: —" — no last-update timestamp.
- "مؤشر المشاعر 0" — sentiment = 0 (broken; should be ~50 for neutral market).
- "خوف وطمع 74 - طمع" (Fear & Greed = 74 Greed) — REAL ✅ but inconsistent with the "محايد/NEUTRAL" market pulse shown above.

#### Financial review:
- Stock prices: ❌ all 0.00 placeholders (no real prices visible).
- Index values: ❌ "—" for EGX30, EGX70, EGX100 — production has real values (EGX30 53,776.69, EGX70 19,834.95).
- Sentiment: ❌ "0" (should be 50 for neutral).
- Returns: ❌ "▲ 0.00%" — no real change data.
- Fear & Greed: ✅ 74 Greed — real and consistent with prod API.
- "أداء المؤشرات المُختبرة 63.6% VWAP 55.2% Stoch 53% EMA" — REAL ✅ (from production API).

---

### Screen 2: #stocks
**Screenshot:** `deep-02-stocks.png`
**Visual score:** 4/10
**Data score:** 1/10

#### Visual issues:
- KPI cards at the top: "الإجمالي 0 / المرتفعة 0 / المنخفضة 0 / الثابتة 0 / متوسط التغير +0.00%" — all zero placeholders (P0 data issue, not visual).
- Predefined lists dropdown shows "— اختر قائمة لعرض الأسهم المُصنّفة" — the "—" suggests an unselected state but no list items load.
- "لا توجد أسهم مطابقة للبحث" — empty state where the stock table should be.
- Footer shows a bottom-nav with "الرئيسية / التوقعات / المحفظة / الشارت / الإعدادات / تنبيهات / أرسل رأيك" — adds 7 mobile-nav items at the bottom that consume screen real estate on desktop.

#### Data issues:
- The stock table is **completely empty** (`table tr` selector returns 0 rows).
- The predefined lists dropdown (الكل / الأكثر نشاطا / أقل من القيمة العادلة / أعلى من القيمة العادلة / الأكثر ربحا / الأكثر خسارة / الأكثر توزيعات / الأقل مخاطرة) is shown but clicking it would yield nothing since DB is empty.
- `/api/stocks` returns `success:false, error:"Failed to fetch stocks from backend"` — Python backend (port 8010) is offline.
- Local `db/stocks.db` has 50 US-stock rows but ALL prices are `NULL`. Zero EGX rows.
- Production has real EGX stock data (50 stocks in market/overview, 392 in summary).

#### Financial review:
- Stock prices: ❌ none shown.
- Tickers: ❌ none shown.
- Change %: ❌ none shown.
- Volume: ❌ none shown.

---

### Screen 3: #liquidity-radar
**Screenshot:** `deep-03-radar.png` + `deep-03b-radar-retry.png`
**Visual score:** 2/10
**Data score:** 1/10

#### Visual issues:
- The entire screen is **just a "warming up" message + retry button**: "الرادار بيتسخن لأول مرة — حاول تاني خلال دقيقة" with "إعادة المحاولة" button. No cards, no lists, no signal counts, no paths (A_pre_surge, D_explosive_surge, etc.), no chart.
- Clicking "إعادة المحاولة" does nothing visible — the same message stays.
- This is essentially a **completely empty screen** with a placeholder.

#### Data issues:
- `/api/maker-radar/multi-market` returns `count:0, top_picks:[], warming_up:true, cached:false, cache_age_seconds:null, db_source:null` for all markets (EGX, US, CRYPTO). The radar has NEVER been warmed up in this dev environment.
- Production `/api/maker-radar/multi-market` returns `count:88` for EGX with real picks (TAQA at 17.12 EGP, ADCI at 284 EGP, etc.).
- No stock drawer interaction testable (no stocks visible to click).

#### Financial review:
- Stock prices: ❌ none shown (radar is empty).
- Signal counts: ❌ none (radar is empty).
- Risk/reward: ❌ untestable.

---

### Screen 4: #recommendations
**Screenshot:** `deep-04-recommendations.png` (default "متابعة التوقعات" tab) + 10 sub-tab screenshots `deep-04b` through `deep-04j`.
**Visual score:** 5/10
**Data score:** 3/10

#### Default tab — "متابعة التوقعات" (Tracking):
**Screenshot:** `deep-04-recommendations.png`

##### Visual issues:
- Header "مركز الشفافية والمصداقية الحيدة" + "السوق مغلق" + subtitle — OK.
- KPI cards: "صافي الربح +0.0%", "إجمالي الأرباح +0.0% من 0 صفقة رابحة", "إجمالي الخسائر 0.0% من 0 صفقة خاسرة", "أقصى خسارة (حماية) 0.0%", "نسبة الربح/الخسارة 0.00:1" — all zeros because local DB is empty.
- Persona tab "⚖️ المتوازن" badge with "0.0% نجاح" — placeholder.
- Status filter chips "🎯 الناجحة / 🛑 الخاسرة / ⏳ المعلقة / ⏰ المنتهية" — visible but no counts.
- Empty state: "لا توجد صفقات تطابق خيارات الفلترة المحددة" — empty.

##### Data issues:
- Production tracking stats: 1,318 predictions / 507 wins / 457 losses / 44 pending / **52.6% win rate / avg win +15.98% / avg loss -6.98% / profit factor 2.97** — these are sensible financial metrics.
- The local DB returns 0 because local SQLite `predictions` table is empty (production fallback is used by `/api/predictions/honest-tracking/list` but NOT by `/api/predictions/honest-tracking/live-tracking`).
- Period dropdown shows: "اليوم / أمس / 7 أيام / 14 يوم / 30 يوم / 60 يوم / 0.25 سنة (ربع سنوي) / 0.5 سنة (نصف سنوي) / من أول السنة / سنة كاملة (1y) / كل الأوقات" — good selection.

#### Sub-tab "ملخص التوقعات" (Summary):
**Screenshot:** `deep-04b-recommendations-summary-tab.png`

##### Visual issues:
- Period selector chips are concatenated without separators: "اليومأمس7 أيام14 يوم30 يوم60 يوم0.25 سنة (ربع سنوي)0.5 سنة (نصف سنوي)من أول السنةسنة كاملة (1y)كافة الأوقات" — same concatenation bug flagged in the prior audit (still unfixed).
- Title "ملخص أداء التوقعات" appears twice ("ملخص الأداء / من أول السنة · 0 سهم فريد / ملخص أداء التوقعات" + then again "ملخص أداء التوقعات / ملخص لنتائج التوقعات خلال من أول السنة").

##### Data issues:
- "0.0% معامل الربحية 0.00" — placeholder.
- "سوق EGX" badge shown — good.
- "بيانات محلية" badge shown — discloses data source ✅ (transparency feature works).
- "أفضل التوقعات (≥70)" filter chip — good.
- Empty state: "لا توجد توقعات خلال الفترة المحددة / جرّب فترة زمنية أطول لعرض المزيد من البيانات".

#### Sub-tab "حالة السوق" (Market State):
**Screenshot:** `deep-04e-recommendations-market-state.png`

##### Visual issues:
- Just an error state: "فشل في تحميل البيانات" + "إعادة المحاولة" button.

##### Data issues:
- Empty / failed — no data shown.

#### Sub-tab "⚖️ التوقعات" (Predictions):
**Screenshot:** `deep-04-recommendations.png` (same as default tab)

##### Visual issues:
- Same loading state as default: "جاري تحليل الفرص — سيتم التحديث خلال دقائق" + spinner + "تحديث الآن" button.
- "محرك المتوازن بيدوّر على فرص متوسطة المدى (2-6 أسابيع). البيانات بتتحدث كل 15 دقيقة تلقائياً — مفيش تحليل لحظي على الشاشة دي." — informative message.

##### Data issues:
- No predictions displayed in this tab (all 4 personas returned empty arrays).
- The previous audit said this tab used to show predictions — possibly the Python backend being offline blocks it.

#### Sub-tab "تتبع القطاعات" (Sector Tracking):
**Screenshot:** `deep-04i-recommendations-sector-tracking.png`

##### Visual issues:
- Error state: "فشل في الاتصال بـ Python Backend" + "تأكد أن Python backend يعمل على port 8010 (محتاج: /api/sectors/tracking)" + retry button.

##### Data issues:
- **Critical**: directly tells the user that Python backend is required — bad UX. The Python backend is offline so this tab is fully broken.

#### Sub-tab "رادار الخروج" (Exit Radar):
**Screenshot:** `deep-04g-recommendations-exit-radar.png`

##### Visual issues:
- "🚪 رادار الخروج" title + subtitle.
- "السوق: EGX / المفحوصين: 0" — zero stocks scanned.
- "لا توجد إشارات خروج ✅" — empty state.
- "ℹ️ كيف يعمل رادار الخروج؟" info box explains the 5 paths (X1-X5) and references `scripts/exit_radar.py` + "Python is brain (Rule 32)".

##### Data issues:
- "آخر تحديث: من 17 ساعة" — last update 17 hours ago (stale but timestamp exists).
- "المفحوصين: 0" — no stocks scanned.

#### Sub-tab "التقرير الأسبوعي" (Weekly Report):
**Screenshot:** `deep-04f-recommendations-weekly-report.png`

##### Visual issues:
- "التقرير الأسبوعي للرادار" + "الأسبوع 40، 2026" + "| 4 أكتوبر 2026 — 10 أكتوبر 2026" — date range.
- "حالة السوق: NORMAL (عادي)" — sensible.
- "سهم الأسبوع: لا يوجد سهم مميز هذا الأسبوع — شغّل رادار الميكرز أولاً." — empty state.
- "أفضل 5 أسهم للأسبوع القادم: لا توجد أسهم في الكاش — شغّل رادار الميكرز أولاً." — empty.
- "أداء أسهم الأسبوع الماضي: لا توجد أسهم متابَعة من الأسبوع الماضي." — empty.
- Telegram CTA: "اشترك عشان يوصلك التقرير الأسبوعي على تليجرام كل يوم أحد صباحاً".

##### Data issues:
- "آخر تحديث: ٢٧‏/٩‏/٢٠٢٦، ١٠:٠٨:٢٩ م" — real timestamp ✅.
- Empty data because maker-radar has never warmed up.

#### Sub-tab "صفقات تاريخية" (Historical Trades / Backtest):
**Screenshot:** `deep-04d-recommendations-historical-trades.png`

##### Visual issues:
- "الصفقات التاريخية (Backtest)" + "٠ صفقة منفذة من بيانات training الـ AI" — 0 trades.
- Filters: بحث بالـ ticker / الاستراتيجية / النتيجة / ترتيب حسب (تاريخ الشراء).
- Error message shown: "HTTP 500 / حاول مرة أخرى".

##### Data issues:
- `/api/predictions/historical-trades` returns `"no such table: historical_trades"` — **CRITICAL schema error**: the SQLite predictions.db is missing the `historical_trades` table entirely. This was flagged in the prior audit and remains broken.

#### Sub-tab "الرادار الموحّد" (Unified Multi-Market Radar):
**Screenshot:** `deep-04c-recommendations-unified-radar.png`

##### Visual issues:
- "الرادار الموحّد متعدد الأسواق / 7 سوق / 0 سهم تحت الرصد / • / 2 سوق مفتوح / • / ٠٢:٢٢ م" — header.
- 7 market cards (EGX, TADAWUL, KSE, QSE, US, CRYPTO, GOLD) each showing: market name, status (مقفول/LIVE), الأسهم 0, الفرص 0, العملة (EGP/SAR/KWD/QAR/USD), حالة السوق (عرضي · sideways), "جارٍ تسخين الرادار..." (warming up).
- "أعلى 5 فرص عبر كل الأسواق: لا توجد فرص متاحة حالياً — قد تكون الأسواق مغلقة أو تحت التسخين" — empty state.
- "تفصيل كل سوق" section repeats the same 7 cards in compact form.
- Footer: "يتم التحديث تلقائياً كل 60 ثانية / البيانات من cached radar JSON لكل سوق / آخر تحديث: ٢٨‏/٩‏/٢٠٢٦، ٢:٢٢:٣٥ م" — good transparency ✅.

##### Data issues:
- All 7 markets show 0 stocks + 0 opportunities + "warming up" — consistent with `/api/maker-radar/multi-market` response.
- 2 markets show "LIVE" (CRYPTO, GOLD) — these are 24/7 markets and should have data; the fact they show 0 is a bug.
- "عرضي · sideways" regime shown for all 7 markets — fallback when no data.

#### Sub-tab "دقة الرادار" (Radar Accuracy):
**Screenshot:** `deep-04h-recommendations-radar-accuracy.png`

##### Visual issues:
- Error message: "no such column: explosive_label" + retry button.

##### Data issues:
- **CRITICAL schema error**: SQLite query references `explosive_label` column that doesn't exist. This was flagged in prior audit and remains broken.

#### Sub-tab "الرادار المخصّص" (Personalized Radar):
**Screenshot:** `deep-04j-recommendations-personalized.png`

##### Visual issues:
- Login prompt: "سجّل دخولك الأول / الرادار المخصّص بيتطلب تسجيل دخول عشان نقدر نبني ملفك الشخصي من صفقاتك ومحفظتك وقائمة المتابعة." + "تسجيل الدخول" button.
- Note: the mock-auth interceptor was set up but this tab still requires login — likely because the underlying `/api/radar/personalized` checks a session cookie that the mock doesn't set.

##### Data issues:
- Cannot test further without real authentication.

#### Financial review of predictions (cross-screen):
**Production sample of 50 most recent predictions** (via `/api/predictions/honest-tracking/list`):
- 88% (44/50) of `target_price_2` values are in the 10–25% return range ✅ — realistic for 2–6 week trades.
- **Only 10% (5/50) of `target_price` values are realistic (<20% return)** — the rest are 50%+ above entry.
- **34% (17/50) of `target_price` values are 500%+ above entry** — IMPOSSIBLE for 2–6 week trades. Example: MASR (مدينة نصر للاسناء) entry=7.88 → target=55.55 = +604.9% expected return.
- R/R distribution: 38% of predictions have R/R > 50 (impossible — should be 2-5).
- Specific bad-actors (recent):
  - **MASR**: 3 predictions with R/R 80-104, expected returns 484-605%. All STOPPED.
  - **BTFH**: 2 predictions with R/R 10-13, expected returns 61-79%. Both "TARGET_HIT" but actual returns were 0.67% and 2.53% (way below the +79% expected).
  - **ORTE**: 5 predictions (some duplicate entries) with R/R 6-8, expected returns 36-48%. All EXPIRED with 0% actual return.
  - **PHDC**: 2 predictions with R/R 5-8, expected returns 32-49%. Both STOPPED.
- Production-level aggregate stats (from `/api/predictions/honest-tracking/live-tracking`):
  - 1,318 total predictions, 507 wins / 457 losses / 44 pending ✅
  - 52.6% win rate ✅ (within 30–80% sensible range)
  - avg win +15.98% / avg loss -6.98% ✅
  - Profit factor 2.97 ✅ (excellent, >1.5 is good, >2 is excellent)
  - Conservative persona has only 1 settled prediction (sample size too small) — win-rate 65.5% on 1 sample is misleading.

---

### Screen 5: #specialist-analysis
**Screenshot:** `deep-sp-specialist-analysis.png`
**Visual score:** 4/10
**Data score:** 2/10

#### Visual issues:
- Page H1/H2 "شاشة التحليل المتقدم للمتخصصين / تحليل فني شامل — لمتخصصي الأسواق المالية" — OK.
- "تحليل سهم" header but dropdown says "اختر سهم من العملات الرقمية..." — **MIXED MARKET**: this is a stock-analysis page but the dropdown text says "choose a stock from cryptocurrencies" — bug from the prior audit, still unfixed.
- "اختر رمز السهم للبدء / حدد سهماً من القائمة المنسدلة أعلاه للحصول على تحليل متكامل" — empty state.

#### Data issues:
- No content rendered until user selects a ticker.
- Cannot test deeper analysis without selecting a stock.

#### Financial review:
- Nothing to review (empty).

---

### Screen 6: #portfolio
**Screenshot:** `deep-po-portfolio.png`
**Visual score:** 6/10
**Data score:** 3/10

#### Visual issues:
- Header "المحفظة المالية / إدارة أصولك، دخل ومصروفاتك، والتزاماتك" — good.
- "المحافظ متعددة الحسابات / 1 محفظة / محفظة جديدة" — shows "1 محفظة" (good — user has a default portfolio).
- "المحفظة الأم (المجمّعة) / إجمالي كل المحافظ الفرعية / 0 محفظة فرعية" — 0 sub-portfolios.
- KPI cards: "إجمالي الأصول 0 ج.م / إجمالي الديون 0 ج.م / صافي الثروة 0 ج.م / صافي الربح/الخسارة 0 ج.م 0%" — all zero (fresh portfolio).
- Tabs: "الأصول / الدخل والمصروفات / الالتزامات / الحالة المالية" — good tab structure.
- "محرك العائد الحقيقي / التضخم: %" — **the % is empty** (no number shown) — UI bug: the inflation input is empty but the engine still computes a -30% "real return" using the default fallback.
- "العائد المرجح 0.0%" — placeholder.
- "العائد الحقيقي -30.0%" — **CRITICAL financial issue**: showing -30% "real return" for an empty portfolio is misleading. The user has no fixed-income assets yet, so the engine defaults inflation to 30% (Egypt 2024-25 fallback per code comment) and shows "-30.0% / خسارة حقيقية/سنة" (real loss per year). This makes the user think they're losing 30% annually even though they have nothing invested.
- "محرك تقييم المخاطر" risk-assessment quiz: "سؤال 1 من 5 / إيه المدة اللي هتفضل مستثمر فيها فلوسك قبل ما تحتاجها؟" + 4 options — good quiz UI.
- "محرك إنقاذ الأسهم المزنوقة" (stuck-stocks savior) — input field shown.
- "ديناميكية سداد الديون" (debt repayment dynamics) — ⚖️ المتوازن + input field.
- "توقعات زيادة المركز / الأسهم الرابحة ≥ 10% — فرص لتعزيز المكاسب" — empty state ("مفيش أسهم رابحة ≥ 10% دلوقتي").
- "شخصية: ⚖️ المتوازن" + "إعادة اختبار الشخصية" + "القيم بالعملة: EGP" — good.

#### Data issues:
- Empty portfolio: 0 assets / 0 debts / 0 net worth — all sensible for a fresh user, but the -30% real return is misleading.
- The "تضخم: %" should show "30%" (the default Egypt inflation fallback) so the user understands why the real return is -30%. Instead, the % is empty, hiding the cause.

#### Financial review:
- Asset values: ❌ 0 (empty portfolio) — sensible for fresh user.
- Real return: ❌ **-30.0% misleading** — the engine assumes 30% inflation fallback and computes -30% real return for an empty portfolio. Code at `src/app/api/finance/real-return/route.ts:15-16` confirms: `DEFAULT_INFLATION = 30` when `macro_indicators` is empty.
- This makes a fresh user immediately see "-30% / خسارة حقيقية/سنة" which is alarming and false.

---

### Screen 7: #watchlist
**Screenshot:** `deep-wa-watchlist.png`
**Visual score:** 3/10
**Data score:** 1/10

#### Visual issues:
- Error state: "حدث خطأ في تحميل قائمة المتابعة" + "نعتذر عن المشكلة..." + "تفاصيل الخطأ (للمطورين)" + "المحاولة مرة أخرى" + "تحديث الصفحة" buttons.
- Technical detail: "Authentication required" — the watchlist endpoint requires real session auth (the mock-auth interceptor didn't satisfy it).

#### Data issues:
- `/api/watchlist` (or similar) returns "Authentication required" — the mock-auth setup only intercepts `/api/auth/me` and `/api/auth/session`, not the actual session cookie the watchlist endpoint checks.

#### Financial review:
- Nothing to review (broken state).

---

### Screen 8: #reports
**Screenshot:** `deep-re-reports.png`
**Visual score:** 3/10
**Data score:** 1/10

#### Visual issues:
- Header "التقارير المهنية / تقارير شاملة لسوق الأوراق المالية المصرية" — good.
- 4 report cards: "تقرير السوق اليومي / تحليل الأسهم / تقرير القطاعات / تقرير التحليلات" — empty placeholders.
- "لم يتم تحميل بيانات السوق" — error state.

#### Data issues:
- No reports generated because market data is missing locally.

#### Financial review:
- Nothing to review (empty).

---

### Screen 9: #news
**Screenshot:** `deep-ne-news.png`
**Visual score:** 7/10
**Data score:** 7/10

#### Visual issues:
- Header "الأخبار المالية والاقتصادية / تغطية شاملة لأخبار البورصة والشركات المدرجة بالنص الكامل والصور من المصادر" — good.
- Filter chips: "جميع الأخبار (2) / البورصة المصرية / الأسواق العالمية / CoinGecko / مهم وعاجل" — **only 2 news items** total.
- Date "٢٨ سبتمبر ٢٠٢٦ • ٠٢:٢٥ م" — real timestamp.

#### Data issues:
- News item 1: "إجمالي سوق الكريبتو: $2.88T (-3.5%)" + "السوق الإجمالي في حالة تراجع" + source "CoinGecko" + date "٢٨ سبتمبر ٢٠٢٦ • ٠٢:٢٥ م" — REAL ✅
- News item 2: "مؤشر الخوف والطمع: 74 (طمع)" + "الطمع في السوق - حذر من البيع العاطفي" + source "Alternative.me" + same date — REAL ✅
- Action buttons per news item: "نشر / نسخ / صورة" — share/copy/image buttons.
- **Note**: only crypto-related news is shown (CoinGecko + Alternative.me). No EGX news because the local `news.db` cannot be opened (`/api/news` returns `"unable to open database file"`).

#### Financial review:
- Crypto market cap $2.88T (-3.5%) — REAL ✅ (matches CoinGecko public API).
- Fear & Greed 74 (Greed) — REAL ✅ (matches Alternative.me public API).
- These are LIVE API calls to external providers, not from local DB — so they work even when local DBs are empty.

---

### Screen 10: #learning
**Screenshot:** `deep-learning.png`
**Visual score:** 4/10
**Data score:** 4/10

#### Visual issues:
- Header "مركز التعلم / طوّر مهاراتك الاستثمارية" — good.
- Badge "L LEARNING" — uppercase English tag, fine.
- "مركز التعلم - أكملت 0 من 73 درس - المستوى: مبتدئ" — good progress indicator (0/73 lessons).
- "0 دورة مكتملة | 0 إنجاز" — empty.
- Hero card: "0.00 جنيه مصري ▲ 0.00% / التحليل: مبتدئ - 0 XP / ثقة: 0%" — **this looks like a stock-price card template that was incorrectly carried over** to the learning page. "0.00 جنيه مصري" makes no sense in a learning context.
- "٢٨ سبتمبر ٢٠٢٦" — current date.
- Progress: "0 XP / مبتدئ / 1 XP نقاط الخبرة / 1 دروس مكتملة / 1% متوسط الاختبارات / 1 مقالات مقروءة" — **inconsistent**: progress bar shows 0 XP but stats show "1 دروس مكتملة" (1 lesson complete) and "1 مقالات مقروءة" (1 article read). Either 0 or 1, can't be both.
- "0 / 100 XP للمستوى التالي" — sensible for a fresh user.
- Level path: "مبتدئ → متعلم → محترف → خبير → مستثمر ذهبي" — good progression.
- "0 من 73 درس / 0%" — total progress (0 lessons).
- Tabs: "الدورات / الاختبارات / المقالات / الإنجازات" — good tab structure.
- Filters: "الكل / مبتدئ / متوسط / متقدم / دراسات الحالة" — good.
- Case studies shown: "2020 أزمة كورونا والبورصة المصرية 2020 / 15 دقيقة", "2023 صعود قطاع البنوك المصرية 2023 / 12 دقيقة", "2022 انهيار السوق المصري 2022 / 12 دقيقة" + 1 more — REAL content ✅.

#### Data issues:
- Inconsistent progress numbers (0 XP vs 1 lesson complete vs 1 article read).
- "0.00 جنيه مصري" placeholder — inappropriate for a learning page.
- "1%" متوسط الاختبارات (1% quiz average) — suspicious round number, looks like uninitialized placeholder rather than real quiz score.

#### Financial review:
- No financial values to review.
- "2020 / 2022 / 2023" years are real EGX historical events ✅.

---

### Screen 11: #simulation
**Screenshot:** `deep-simulation.png` + trade-dialog screenshot `deep-simulation-trade-dialog.png`
**Visual score:** 7/10
**Data score:** 5/10

#### Visual issues:
- Header "محاكاة التداول - بورصة مصر EGX / تدرب على التداول بأموال افتراضية بدون أي مخاطر" — good.
- "السوق مغلق / 16:25 - القاهرة" — market closed indicator + Cairo time.
- "إيقاف / تصدير التقرير" buttons.
- Badge "S SIM-EGX" — uppercase English tag.
- Hero card: "100000.00 جنيه مصري ▲ 0.00% / التحليل: محفظة رابحة / ثقة: 0%" — initial balance 100K ✅ (sensible simulation starting balance).
- "0 صفقة | 0 مركز مفتوح" — 0 trades / 0 open positions.
- Tabs: "لوحة التحكم / التداول / المحفظة / سجل المعاملات / قائمة الرغبات" — good tab structure.
- "الرصيد النقدي ١٠٠٬٠٠٠٫٠٠ ج.م" — initial cash balance, correct.
- "قيمة المحفظة ٠٫٠٠ ج.م" — portfolio value 0 (no positions).
- "إجمالي الربح/الخسارة +٠٫٠٠ ج.م / +0.00%" — 0 P/L (correct for fresh portfolio).
- "عدد الصفقات 0" — 0 trades.
- "أداء المحفظة / سيتم عرض الرسم البياني بعد أول تحديث للأسعار" — chart placeholder.
- "إجراءات سريعة / الرصيد المتاح ١٠٠٬٠٠٠٫٠٠ ج.م / مستثمر: ٠٫٠٠ ج.م من ١٠٠٬٠٠٠٫٠٠ ج.م / شراء أسهم / عرض المحفظة" — quick actions.
- "إحصائيات سريعة / القيمة الإجمالية ١٠٠٬٠٠٠٫٠٠ ج.م / المركز المفتوحة 0 / العمولة 0.15%" — commission 0.15% ✅ (realistic for EGX brokerage fees).
- "نظرة على السوق" market overview grid showing 8 stocks:
  - **ORAS +1.19% ١٨٫٧٢ ج.م / أوراسكوم للإنشاء**
  - **COMI -1.05% ٢٫٨٢ ج.م / أوراسكوم للإعلام**
  - **GBAR +0% (no change shown)**
  - **DCRC +0.58% ٥٫١٨ ج.م / دار الأهرام للتأمين**
  - **SWDY +0.13% ٣٠٫٤٤ ج.م / السويدى إلكتريك**
  - **CCRS -0.86% ٤٨٫٤٨ ج.م / كرير للصناعات**
  - **EPCI -0.35% ٤٢٫٣٥ ج.م / إيبيكو للصناعات الدوائية**
  - **HRHO -0.11% ٨٫٧٤ ج.م / حرم للتعمير**
  - **MTIE -0.96% ١٥٫٤٥ ج.م / المصرية للاتصالات**
  - **ALUM +0.41% ١٢٫٣٥ ج.م / المصرية للألمنيوم**
  - **EAST +0% ٣٫٤٠ ج.م / إيست كوست للاستثمار**

#### Trade dialog test (clicking ORAS):
**Screenshot:** `deep-simulation-trade-dialog.png`
- Dialog opens correctly: "شراء سهم / السهم: أوراسكوم للإنشاء (ORAS) / السعر الحالي ١٨٫٥٠ ج.م / رصيدك ١٠٠٬٠٠٠٫٠٠ ج.م / عدد الأسهم [input] / الأقصى / إلغاء / تأكيد الشراء" — ✅ functional dialog flow.

#### Data issues:
- Stock prices are HARDCODED in `src/modules/simulation/components/SimulationView.tsx` (lines 153-178, `EGX_STOCKS_RAW` array with 24 entries) — they are NOT real-time prices. The simulation randomly perturbs the basePrice ±2% each tick.
- Per-stock basePrice review (financial expert):
  - **ORAS 18.5** → "أوراسكوم للإنشاء" (Orascom Construction) — actual ticker is OC, not ORAS; ORAS is Orascom Development Holding which trades ~10-25 EGP. **TICKER-NAME MISMATCH**: name says "Orascom Construction" but ticker ORAS is for "Orascom Development". Price 18.5 is within Orascom Development range.
  - **COMI 2.85** → "أوراسكوم للإعلام" — but COMI is the standard ticker for Commercial International Bank (CIB) on EGX, which trades 30-50 EGP. **CRITICAL TICKER-NAME MISMATCH**: ticker COMI is universally recognized as CIB. Showing it as "Orascom for Media" at 2.85 EGP is wrong/confusing.
  - **CIBK 85.4** → "بنك القاهرة" (Bank of Cairo) — but CIBK is CIB's Reuters ticker (rarely used on EGX). Bank of Cairo's EGX ticker is CAIE. The price 85.4 EGP matches CIB's actual trading range — so the mapping has the right price for the wrong name.
  - **MISR 65.3** → "بنك مصر" (Bank of Egypt) — Bank of Egypt trades ~15-30 EGP, not 65.3. **WRONG PRICE**: 65.3 is ~2× too high.
  - **ETEL 15.6** → "المصرية للاتصالات - تليفون مصر" — Telecom Egypt typically trades 18-25 EGP. 15.6 is slightly low.
  - **MTIE 15.6** → "المصرية للاتصالات" — duplicate of ETEL with same price; both labeled Telecom Egypt.
  - **FWRY 3.65** → "فودافون مصر" (Vodafone Egypt) — Vodafone Egypt is NOT listed on EGX. FWRY is the ticker for **Fawry** (Egyptian payment processor) which trades ~3-7 EGP. **TICKER-NAME MISMATCH**: label says Vodafone Egypt but ticker is Fawry.
  - Other tickers (DCRC, SWDY, CCRS, EPCI, HRHO, ALUM, EAST, ELSW, OIIC, AMCH, PHAR, ALHI, TMGH, KIMA, MFPC) — prices are within plausible EGX ranges but cannot be verified without real-time data.

#### Financial review:
- Balance 100,000 EGP ✅ (sensible simulation starting balance).
- Commission 0.15% ✅ (realistic EGX brokerage fee).
- Stock prices: most plausible but several **ticker-name mappings are wrong** (COMI, CIBK, FWRY, MISR labels are misleading).
- Trade dialog flow: ✅ functional (ORAS test confirmed dialog opens with correct stock info).

---

### Screen 12: #academy
**Screenshot:** `deep-academy.png`
**Visual score:** 7/10
**Data score:** 6/10

#### Visual issues:
- Header "🎓 أكاديمية M2y التعليمية ومحاكي التداول الحي / تعلّم الأساسيات، تدرّب على التداول الورقي بالأسعار الحقيقية، وابنِ استراتيجيتك بثقة — كل ذلك في مكان واحد." — good tagline.
- 4 main feature buttons: "📚 الموسوعة / 💻 التداول الورقي / 🕯️ محاكي الشموع / 📊 مختبر الاستراتيجيات" — good navigation.
- Progress: "تقدّمك في الأكاديمية / أكملت 0 من 12 درس / بقي 12 درس لإكمال الأكاديمية" — good (0/12).
- Lesson categories grid: 6 categories with emoji icons and counts:
  - 📘 الأساسيات (3) — Foundations
  - 📈 التحليل الفني (2) — Technical Analysis
  - 🏛️ التحليل الأساسي (2) — Fundamental Analysis
  - 🧠 SMC / ICT (2)
  - 🛡️ إدارة المخاطر (2) — Risk Management
  - 🧘 سيكولوجية التداول (1) — Trading Psychology
  Total = 12 ✅ (matches "12 درس").
- First lesson card visible: "🏛️ الأساسيات · What is the Stock Market? / ما هي البورصة؟ / مبتدئ / 8 دقيقة / 4 أقسام / تحميل الدرس كمذكرة PDF" — **MIXED ENGLISH+ARABIC**: title appears as English "What is the Stock Market?" first, then Arabic "ما هي البورصة؟". This is inconsistent with the rest of the Arabic UI.
- Lesson content: "1. تعريف البورصة / البورصة سوق منظّم يتم فيه تداول الأوراق المالية..." — rich educational content ✅.
- "تحميل الدرس كمذكرة PDF" button — download lesson as PDF notes (visible on every lesson card).

#### Data issues:
- Progress 0/12 — sensible.
- 6 categories sum to 12 lessons — consistent ✅.
- English lesson titles not translated — translation issue.

#### Financial review:
- No financial values to review (educational content).

---

### Screen 13: #crypto
**Screenshot:** `deep-crypto.png`
**Visual score:** 5/10
**Data score:** 4/10

#### Visual issues:
- **Title bug**: H2 says "لوحة التحكم" (Dashboard) instead of "العملات الرقمية" (Crypto) — duplicate H1/H2 issue from prior audit still unfixed.
- Subtitle: "نظرة عامة على العملات الرقمية" — correct subtitle but inconsistent with the wrong H2.
- Currency badges: "ج.م" / "$" / "ر.س" — multi-currency toggle.
- "بحث سريع عن عملة" search input.
- Hero card: "BTC / العملات الرقمية / ٢٨ سبتمبر ٢٠٢٦ / 0.00 جنيه مصري / ▲ 0.00% / التحليل: السوق مغلق" — **0.00 EGP placeholder for BTC** (BTC should be ~$60K+).
- "التحليل: السوق مغلق" — **WRONG**: crypto markets are 24/7, never closed. The "market closed" logic from EGX is incorrectly applied to crypto.
- Action buttons: "مشاركة / تصدير PDF / نشر" — share/export/publish.
- "إشارات الكريبتو / إشارات العملات الرقمية" — duplicate labels.
- "Fear & Greed Index 74 - طمع" — REAL ✅
- "أداء المؤشرات المُختبرة 63.6% VWAP / 55.2% Stoch / 53% EMA" — REAL ✅
- "⚠️ تحليل وليس تحليل مالية" — disclaimer with typo: should be "ليس نصيحة مالية" (not financial advice) but says "ليس تحليل مالية" (not financial analysis).
- "إشارات الموسمية (EGX) / شهر سبتمبر / لا توجد إشارات لهذا الشهر" — **WRONG**: this is the crypto page but showing EGX seasonality.
- "⚠️ إشارات تاريخية - الأداء السابق لا يضمن المستقبلي" — good disclaimer.
- "الأسواق المتعددة / 🇪🇬 مصر (EGP) / 🇸🇦 السعودية / 🇰🇼 الكويت / 🇶🇦 قطر" — multi-market toggle.
- "📈 الأسهم / 🥇 الذهب / ₿ كريبتو / 💱 عملات" — asset class tabs.
- "لا توجد بيانات أسهم متاحة لسوق مصر حالياً" — empty state for EGX stocks tab (correct given empty local DB).

#### Data issues:
- BTC price 0.00 EGP — placeholder, not real (BTC is ~$60K USD ≈ ~3M EGP).
- "السوق مغلق" — incorrect for crypto (24/7 market).
- "إشارات الموسمية (EGX)" on crypto page — wrong market.
- Typo in disclaimer "ليس تحليل مالية" instead of "ليس نصيحة مالية".

#### Financial review:
- BTC price: ❌ 0.00 EGP placeholder.
- Fear & Greed: ✅ 74 Greed (real).
- Tested indicators (VWAP 63.6%, Stoch 55.2%, EMA 53%): ✅ real (from production API).
- Market status: ❌ "closed" is wrong for crypto.

---

### Screen 14: #trading-chart
**Screenshot:** `deep-trading-chart.png` + retry screenshot `deep-trading-chart-retry.png`
**Visual score:** 4/10
**Data score:** 2/10

#### Visual issues:
- Header "غرفة التداول / الشارت التفاعلي والتحليل المتقدم / مقارنة فورية للأسهم مع تحليل السعر، مستويات الدعم والمقاومة، المخاطرة، ومؤشرات التوافق الفني." — good.
- Market toggle: "🪙 العملات الرقمية" — defaults to crypto (because of mock-auth init order).
- "إدراج سهم آخر للتحليل..." search input.
- Layout toggle: "1 عمود / 2 عمود" (1 column / 2 columns).
- "1 سهم / نشر الكل" — stock count + publish-all button.
- "الأوراق المعروضة:" section.
- Stock card: "BTC (BTC) BTC — (+0.0%)" — duplicate "BTC" label + price "—" + "(+0.0%)" placeholder.
- Time intervals: "5M 15M 1H يومي أسبوعي شهري" — concatenated without separators (same bug as before).
- View modes: "مبسط / محترفين".
- Position selector: "أبحث عن شراء / أملك العملة".
- Indicators: "✓ MA20 / ✓ MA50 / ✓ MA200 / ✓ EMA / ✓ RSI / ✓ Bollinger / ✓ MACD / ✓ Volume / ✓ Levels / ✓ SMC/BOS" — comprehensive list.
- **Error message**: "CoinGecko OHLC error: 429" — CoinGecko free API rate-limited.
- After retry: error changes to "Error: Assertion failed: data must be asc ordered by time, index=1, time=1790606044, prev time=1790606044" — duplicate timestamps in OHLC data from CoinGecko.
- "مستشار الصفقة" deal advisor section: "BTC / مساعد قرار — يحلل وضع السهم ويقترح سيناريوهات تصرف" — form with entry price, quantity, date, target, persona dropdown, "حلّل وضعي" button.
- Note: "يعمل بدون اتصال بالـ Python backend — يقرأ من قواعد البيانات المحلية" — discloses offline-Python mode ✅.

#### Data issues:
- BTC price "—" — no data (CoinGecko 429 rate limit).
- After retry: same "—" with new error (duplicate timestamps).
- The chart canvas does not render (no `<canvas>` elements found in DOM).

#### Financial review:
- BTC price: ❌ "—" (no data, CoinGecko rate-limited).
- Cannot test chart indicators due to error state.

---

### Screen 15: #stock-filters
**Screenshot:** `deep-stock-filters.png`
**Visual score:** 5/10
**Data score:** 2/10

#### Visual issues:
- Header "فلاتر الأسهم المتقدمة / فلترة شاملة + تحديد حالة السهم الفنية (تصحيح / تعافي / قمة / قرب كسر)" — good.
- 2 tab toggles: "الفلاتر المتقدمة / أعلى الأرباح / الخسائر".
- Action buttons: "إخفاء الفلاتر / إعادة الضبط / تصدير / نشر / تحديث" — comprehensive.
- "فلاتر جاهزة" section with 16 preset filters: "تعافي بعد تصحيح / زخم متزن / قرب كسر للأعلى / في قمة / أسهم نشطة / أسهم ميتة / مقيّمة (PE منخفض) / تشبع بيعي / أسهم أرباح عالية / أسهم نمو / أسهم قيمة / كبار القيمة / سيولة عالية / انخفاض حاد / قاع 52 أسبوع / أعلى 52 أسبوع / فوق المتوسطات / تحت المتوسطات / RSI معتدل / فرص انعكاس / مستقرة (لا تذبذب)" — good filter variety.
- "الفلاتر المتقدمة" section: "فرد" (individual) tab.
- KPI cards: "إجمالي النتائج 0 / صاعدة 0 / هابطة 0 / متوسط التغير 0.00% / إجمالي السيولة 0 ج.م / زخم الحجم 0" — all zero (consistent with empty DB).
- **Error message**: "no such column: volume" — schema error.
- Footer: "فلترة شاملة + تحديد حالة السهم الفنية — النتائج محدّثة تلقائياً".

#### Data issues:
- **CRITICAL schema error**: `/api/market/overview` returns `"no such column: volume"` — the SQLite `stocks` table in `data_engine.db` doesn't have a `volume` column. Same error appears twice in the page.
- All KPIs zero — consistent with empty DB.
- Filter presets visible but unclickable would yield no results.

#### Financial review:
- All KPIs: ❌ 0 / 0.00% (empty).
- Volume momentum: ❌ 0.

---

## Top 10 Issues Found (NEW, not in prior audit)

1. **CRITICAL — Impossible target_price values in production predictions**: 34% of the 50 most-recent production predictions have target_price >500% above entry (e.g., MASR entry=7.88 → target=55.55 = +604.9%). R/R >50 for 38% of recent predictions. Only `target_price_2` is realistic (88% in 10–25% range). Bug systematically produces misleading "expected returns" for users.

2. **CRITICAL — Dev environment has empty databases**: Local `db/predictions.db` (0 rows), `db/stocks.db` EGX rows (0, only 50 US rows with NULL prices), `db/data_engine.db` (no tables). Python backend on port 8010 is OFFLINE. Most API endpoints return empty/zero/error. Even the dashboard's main price card shows "0.00 جنيه مصري ▲ 0.00%" as if it were a real price. Production has 392 stocks, 1,318 predictions, EGX30 53,776.69 — all real.

3. **CRITICAL — Schema errors in stock-filters and radar-accuracy tabs**: `/api/market/overview` returns `"no such column: volume"` and `/api/predictions/radar/accuracy` (or similar) returns `"no such column: explosive_label"`. Both errors surface as raw SQL error text in the UI. The previous audit flagged these and they remain unfixed.

4. **CRITICAL — `#portfolio` shows misleading "-30% real return" for fresh users**: The "real-return engine" defaults inflation to 30% (Egypt 2024-25 fallback) when `macro_indicators` table is empty, then computes `real_return = 0% - 30% = -30%` and displays "خسارة حقيقية/سنة -30.0%" for an empty portfolio. The "التضخم: %" label shows no number, hiding the cause.

5. **HIGH — `#liquidity-radar` is a single empty loading state**: Just "الرادار بيتسخن لأول مرة — حاول تاني خلال دقيقة" + retry button. No cards, no lists, no paths, no charts. Clicking retry does nothing. Production has 88 EGX stocks tracked with real data.

6. **HIGH — `#crypto` page shows "السوق مغلق" (market closed)**: Crypto markets are 24/7; the EGX market-closed logic is incorrectly applied. The H2 also says "لوحة التحكم" (Dashboard) instead of "العملات الرقمية" (Crypto) — duplicate title bug from prior audit, still unfixed.

7. **HIGH — `#simulation` uses hardcoded stock prices with WRONG ticker-name mapping**: `EGX_STOCKS_RAW` array in `SimulationView.tsx` (lines 153-178) has 24 entries with hardcoded `basePrice` values. Several ticker-name mappings are wrong/misleading:
   - COMI labeled "أوراسكوم للإعلام" at 2.85 EGP — but COMI is the universal EGX ticker for Commercial International Bank (CIB), which trades 30-50 EGP.
   - CIBK labeled "بنك القاهرة" (Bank of Cairo) at 85.4 EGP — but CIBK is CIB's Reuters ticker; 85.4 matches CIB price, not Bank of Cairo.
   - FWRY labeled "فودافون مصر" (Vodafone Egypt) — Vodafone Egypt is NOT listed on EGX; FWRY is Fawry.
   - MISR labeled "بنك مصر" at 65.3 EGP — actual Bank of Egypt trades ~15-30 EGP.

8. **HIGH — `#trading-chart` broken by CoinGecko rate limit + duplicate timestamps**: First load shows "CoinGecko OHLC error: 429" (free API rate limit). After retry: "Assertion failed: data must be asc ordered by time, index=1, time=1790606044, prev time=1790606044" — duplicate-timestamp OHLC data crashes the chart canvas. The chart never renders.

9. **MEDIUM — `#recommendations` tracking dashboard shows all-zero stats despite production having 1,318 real predictions**: The "متابعة التوقعات" tab displays 0% net profit, 0 wins, 0 losses, 0 pending — because `/api/predictions/honest-tracking/live-tracking` reads from local empty SQLite. The `/list` endpoint correctly falls back to production, but the `/live-tracking` endpoint does NOT, causing the tracking dashboard to look empty.

10. **MEDIUM — Inconsistent progress numbers on `#learning`**: Hero shows "0 XP / 0 / 100 XP" (0 progress) but stats grid shows "1 دروس مكتملة" (1 lesson complete) + "1% متوسط الاختبارات" (1% quiz average) + "1 مقالات مقروءة" (1 article read). The "0.00 جنيه مصري" hero price-card template was also incorrectly carried over from a stock-page template.

---

## Financial Expert Recommendations

1. **Fix the `target_price` bug in the predictions engine immediately**: 34% of recent predictions show target_price 500%+ above entry. The `target_price_2` column is consistently +20% above entry, so it's the correct target. The bug is likely a swapped column or a calculation that multiplies entry by some factor for certain tickers (especially low-priced ones like MASR 7.88, BTFH 2.91, PHDC 13.81). Until fixed, users see claims of "+600% expected return in 2-6 weeks" which is unrealistic and harmful. **Action**: audit the Python prediction-generation code that writes `target_price` for low-priced stocks; swap to use `target_price_2` value when target_price > entry × 1.5.

2. **Fix the `#portfolio` real-return default**: Showing "-30% خسارة حقيقية/سنة" to a fresh user with no assets is misleading and alarming. **Action**: when `assets.length === 0`, hide the "real return" panel entirely with the message "أضف أصولاً لحساب العائد الحقيقي" (add assets to calculate real return). When assets exist but inflation is missing, show the inflation default (30%) explicitly in the "التضخم: %" label so the cause is visible.

3. **Fix the `#simulation` hardcoded ticker-name mapping**: Replace `EGX_STOCKS_RAW` with a real call to `/api/stocks?market=EGX` (or production fallback). At minimum, fix the wrong names:
   - COMI → either rename to "البنك التجاري الدولي (CIB)" or change ticker+price to a different stock.
   - CIBK → either rename to "البنك التجاري الدولي (CIB)" (matches price 85.4) or change ticker+price to Bank of Cairo (ticker CAIE, price ~7-12 EGP).
   - FWRY → rename to "فوري" (Fawry payment processor).
   - MISR → fix price to ~15-30 EGP range.

4. **Fix the `#crypto` "market closed" logic**: Crypto markets are 24/7. Hard-code `is_open:true` for CRYPTO market, or pass market type into the `isMarketOpen()` helper. Currently the dashboard shows "السوق مغلق" for BTC which is wrong.

5. **Fix the `#trading-chart` CoinGecko integration**: Either (a) upgrade to CoinGecko Pro API (paid, no rate limits), or (b) cache OHLC data locally with a 5-minute TTL and serve from `/api/chart/[symbol]/ohlc` to avoid hitting CoinGecko on every page load. Also deduplicate timestamps before passing to chart library — the "Assertion failed: data must be asc ordered by time" error is from `lightweight-charts` rejecting duplicate timestamps.

6. **Fix the schema errors**: Add `volume` column to the `stocks` table in `data_engine.db` (or update the SQL query to not reference it). Add `explosive_label` column to whatever table the radar-accuracy endpoint reads (or update the query).

7. **Sync the local dev environment from production**: Currently 6 of 15 screens show empty/error states because local DBs are empty. Either (a) download production DBs (`predictions.db`, `stocks.db`, `data_engine.db`) and copy them locally, or (b) make every API endpoint fall back to `https://invist.m2y.net/api/...` when local DB returns empty — currently only `/api/predictions/honest-tracking/list` does this. Specifically, `/api/predictions/honest-tracking/live-tracking`, `/api/market/summary`, `/api/market/indices`, `/api/maker-radar/multi-market`, `/api/stocks` should all fall back to production.

8. **Fix `#watchlist` authentication**: The mock-auth interceptor returns a valid user object but the watchlist endpoint still says "Authentication required". Either (a) the endpoint checks a session cookie not the `/api/auth/me` response, or (b) the endpoint requires the user to have a specific `subscription_tier`. Either way, the user-facing error message should explain which requirement isn't met, not just "Authentication required".

9. **Hide Fear & Greed index from EGX-only dashboard or move to `#crypto`**: The dashboard shows "Fear & Greed Index 74 - طمع" but this is a crypto-only metric. Showing it on the EGX dashboard alongside "نبض السوق +0.0 محايد NEUTRAL" creates cognitive dissonance (greed vs neutral). Either move it to the crypto page or rename to clearly mark it as crypto-only.

10. **Fix the dev/prod data-source inconsistency**: Some endpoints show "بيانات محلية" (local data) badge but actually have 0 rows locally; others silently fall back to production. Standardize: every endpoint should declare its data source (`local-db`, `vps-production`, `cache`) in an `X-Data-Source` header AND a visible badge on the UI. This is partially implemented on the recommendations/summary tab but not on dashboard, stocks, or radar.

---

## Cross-cutting issues (NEW since prior audit)

| # | Issue | Affects |
|---|-------|---------|
| C1 | CoinGecko free API rate-limited → "HTTP 429" surfaces as raw error text | `#trading-chart` |
| C2 | CoinGecko returns duplicate-timestamp OHLC → "Assertion failed: data must be asc ordered by time" crashes chart canvas | `#trading-chart` |
| C3 | "no such column: volume" SQL error visible to end-users | `#stock-filters` |
| C4 | "no such column: explosive_label" SQL error visible to end-users | `#recommendations` → "دقة الرادار" tab |
| C5 | "no such table: historical_trades" SQL error visible to end-users | `#recommendations` → "صفقات تاريخية" tab |
| C6 | "HTTP 500" raw error visible to end-users | `#recommendations` → "صفقات تاريخية" tab |
| C7 | "Authentication required" raw error visible to end-users | `#watchlist` |
| C8 | "فشل في الاتصال بـ Python Backend — port 8010" raw error visible | `#recommendations` → "تتبع القطاعات" tab |
| C9 | Period selector chips concatenated without separators | `#recommendations` → "ملخص التوقعات" tab |
| C10 | Time interval chips concatenated without separators | `#trading-chart` |
| C11 | Mixed-market content on dashboard (crypto H3s on EGX view) | `#dashboard` |
| C12 | Mixed-market dropdown text on specialist-analysis ("choose from crypto" on stock page) | `#specialist-analysis` |
| C13 | Mixed-market seasonality (EGX seasonality on crypto page) | `#crypto` |
| C14 | Typo in disclaimer "ليس تحليل مالية" instead of "ليس نصيحة مالية" | `#crypto` |
| C15 | Hardcoded simulation prices with wrong ticker-name mapping | `#simulation` |
| C16 | Real-return engine defaults to 30% inflation → shows "-30% real return" for empty portfolio | `#portfolio` |
| C17 | Default 100000.00 simulation balance is sensible ✅ | `#simulation` |
| C18 | Help/Persona modal "إنت بتركم على إيه؟ 🤔" pops up on dashboard load (not always, but observed during this audit) | `#dashboard` |
| C19 | Fear & Greed Index (crypto-only metric) shown on EGX dashboard | `#dashboard`, `#crypto` |
| C20 | "0.00 جنيه مصري" hero price-card template incorrectly carried over to learning page | `#learning` |

---

## Production data sanity check (financial expert verdict)

| Metric | Value | Verdict |
|--------|-------|---------|
| EGX30 index | 53,776.69 (-1.15%) | ✅ real (production `/api/market/indices`) |
| EGX70 index | 19,834.95 (-1.22%) | ✅ real |
| EGX100 index | 26,233 (-0.64%) | ✅ real |
| Total EGX stocks | 392 | ✅ real (`/api/market/summary`) |
| Advancers / decliners / unchanged | 62 / 227 / 103 | ✅ real |
| Total market cap | 4.27 trillion EGP | ✅ real |
| Total turnover | 9.1 billion EGP | ✅ real |
| Total volume | 2.16 billion shares | ✅ real |
| Crypto market cap | $2.88T (-3.5%) | ✅ real (CoinGecko) |
| Fear & Greed | 74 Greed | ✅ real (Alternative.me) |
| Total predictions | 1,318 | ✅ real (`/api/predictions/honest-tracking/live-tracking`) |
| Win rate | 52.6% | ✅ sensible (within 30-80%) |
| Avg win / avg loss | +15.98% / -6.98% | ✅ sensible |
| Profit factor | 2.97 | ✅ excellent (>1.5 good, >2 excellent) |
| Gambler win rate | 58.2% | ✅ sensible |
| Balanced win rate | 51.4% | ✅ sensible |
| Conservative win rate | 65.5% | ⚠️ on 1 sample only (statistically insignificant) |
| Predictions with R/R > 5 | 38% of recent | ❌ impossible |
| Predictions with target_price >500% above entry | 34% of recent | ❌ impossible |
| `target_price_2` returns distribution (10-25%) | 88% | ✅ realistic |
| Test indicator win rates (VWAP 63.6%, Stoch 55.2%, EMA 53%) | — | ✅ real |
| Top EGX radar pick: TAQA 17.12 EGP | — | ✅ real (TAQA trades 13-20 EGP) |
| Top EGX radar pick: ADCI 284 EGP | — | ✅ real (ADCI trades 250-350 EGP) |
| Simulation hardcoded COMI 2.85 EGP | — | ❌ wrong (real CIB is 30-50 EGP) |
| Simulation hardcoded CIBK 85.4 EGP | — | ⚠️ matches CIB price but ticker/name mismatch |
| Simulation hardcoded MISR 65.3 EGP | — | ❌ wrong (real Bank of Egypt 15-30 EGP) |

---

## Per-screen score summary

| # | Screen | Visual | Data | Notes |
|---|--------|--------|------|-------|
| 1 | #dashboard | 5/10 | 2/10 | Empty placeholders everywhere; F&G index out of place |
| 2 | #stocks | 4/10 | 1/10 | Completely empty table; predefined lists dropdown broken |
| 3 | #liquidity-radar | 2/10 | 1/10 | Single "warming up" message + retry; nothing else |
| 4 | #recommendations | 5/10 | 3/10 | 11 sub-tabs: 3 broken (history/accuracy/sectors), 5 empty, 3 sensible structure |
| 5 | #specialist-analysis | 4/10 | 2/10 | Empty state + wrong "from cryptocurrencies" dropdown text |
| 6 | #portfolio | 6/10 | 3/10 | Functional UI but -30% real return is misleading |
| 7 | #watchlist | 3/10 | 1/10 | Hard error "Authentication required" |
| 8 | #reports | 3/10 | 1/10 | 4 empty cards + error state |
| 9 | #news | 7/10 | 7/10 | 2 real news items (crypto only); EGX news DB unavailable |
| 10 | #learning | 4/10 | 4/10 | Inconsistent progress numbers; wrong price-card template |
| 11 | #simulation | 7/10 | 5/10 | Working trade dialog; hardcoded prices with wrong ticker-name mapping |
| 12 | #academy | 7/10 | 6/10 | Real educational content; English titles not translated |
| 13 | #crypto | 5/10 | 4/10 | BTC 0.00 EGP placeholder; wrong "market closed"; typo in disclaimer |
| 14 | #trading-chart | 4/10 | 2/10 | CoinGecko 429 + duplicate-timestamp crashes chart |
| 15 | #stock-filters | 5/10 | 2/10 | All KPIs 0; "no such column: volume" SQL error |
| **Average** | — | **4.7/10** | **2.9/10** | — |

**Overall visual score: 5.5/10** (slightly higher than average because dashboard/simulation/academy/news have working structural UI even when data is missing).
**Overall data score: 3.0/10** (most screens show 0.00 / 0 / — placeholders; production has real data but dev environment is empty).

---

## Files created

- **Report:** `/home/z/my-project/agent-ctx/UI-DEEP-TEST-REPORT.md` (this file)
- **Screenshots (26):** `agent-ctx/screenshots/deep-*.png`
  - `deep-01-dashboard.png`
  - `deep-02-stocks.png`
  - `deep-03-radar.png` + `deep-03b-radar-retry.png`
  - `deep-04-recommendations.png` + `deep-04b-summary-tab.png` + `deep-04c-unified-radar.png` + `deep-04d-historical-trades.png` + `deep-04e-market-state.png` + `deep-04f-weekly-report.png` + `deep-04g-exit-radar.png` + `deep-04h-radar-accuracy.png` + `deep-04i-sector-tracking.png` + `deep-04j-personalized.png`
  - `deep-sp-specialist-analysis.png`
  - `deep-po-portfolio.png`
  - `deep-wa-watchlist.png`
  - `deep-re-reports.png`
  - `deep-ne-news.png`
  - `deep-learning.png`
  - `deep-simulation.png` + `deep-simulation-trade-dialog.png`
  - `deep-academy.png`
  - `deep-crypto.png`
  - `deep-trading-chart.png` + `deep-trading-chart-retry.png`
  - `deep-stock-filters.png`

- **No code changes** (Phase 4 documentation-only per task spec: "Don't fix anything — just document").
- **No new screens, components, or routes added** (Rule 4 compliance).
- **No DB changes** (Rule 1 compliance).
