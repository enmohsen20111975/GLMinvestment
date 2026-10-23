# 05 — شاشات ومكونات المنصة (Screens & Components)

> **آخر تحديث:** 2026-10-23  
> **المراجع:** `00-CONSTITUTION.md`, `01-ARCHITECTURE.md`, `PLAN-COMPONENT-UNIFICATION.md`  
> **الهدف:** خريطة كاملة لكل شاشة، مكون، hook، والـ API اللي بيستخدمه.

---

## 📊 الإحصائيات الحالية

| المقياس | القيمة |
|---|---|
| إجمالي ملفات TSX | 344 |
| Modules | 19 |
| Hooks مخصصة | 10 (3 جديدة بـ Strangler Pattern) |
| Shared components | 15+ |
| UI primitives (shadcn) | 48 |
| Dashboard widgets | 25 |
| API routes | 464 |
| Pages (App Router) | 13 |

---

## 🪝 Hooks المخصصة (src/hooks/)

### Hooks جديدة (Strangler Pattern — F2.2 + Strangler)

| Hook | الملف | المسؤول عن | Widget المستخدم | commit |
|---|---|---|---|---|
| `useMarketPulseData` | `useMarketPulseData.ts` (179 LOC) | fetch /api/market-pulse + normalize + freshness + lastUpdate | MarketPulseWidget | `3aa4c41` |
| `useLiveMonitorData` | `useLiveMonitorData.ts` (219 LOC) | fetch /api/live-monitor + countdown + clock + handleTrigger | LiveMonitor | `cfabffc` |
| `usePortfolioData` | `usePortfolioData.ts` (311 LOC) | fetch /api/finance/* + session + portfoliosMap | EnhancedPortfolioView | `440fc24` |

### Hooks موجودة

| Hook | الملف | المسؤول عن |
|---|---|---|
| `useApiQuery` | `use-api-query.ts` | TanStack Query wrapper لـ apiGet (canonical fetch layer) |
| `useVisibilityAwarePolling` | `useVisibilityAwarePolling.ts` | polling بيـ pause لما tab مخفي |
| `useDebounce` | `use-debounce.ts` | debounce لـ search inputs |
| `usePagination` | `use-pagination.ts` | pagination state |
| `useToast` | `use-toast.ts` | toast notifications |
| `useAuthCheck` | `useAuthCheck.ts` | auth status check |
| `useMobile` | `use-mobile.ts` | responsive breakpoint detection |

---

## 📺 Dashboard Widgets (src/modules/dashboard/components/)

25 widget مسجلين في `PinnableWidget registry` (Rule 52 — قابل للـ pin/unpin):

| Widget | الحالة | الـ API | Notes |
|---|---|---|---|
| **MarketSummary** | نشط | /api/market/overview | ملخص السوق + المؤشرات |
| **IndexCards** | نشط (EGX) | marketOverview | EGX30/70/100 cards |
| **MarketPulseWidget** | نشط (EGX) | /api/market-pulse | **Strangler** → useMarketPulseData |
| **MarketSentiment** | نشط (EGX) | /api/market/sentiment | مؤشر المشاعر |
| **InvestorsFlowPanel** | نشط (EGX) | /api/market/liquidity-flow + /api/egx/investors | أجانب/عرب/مصريين |
| **SovereignMetalsDesk** | نشط | /api/market/metals-forex/summary | ذهب + عملات |
| **TopMovers** | نشط | marketOverview.gainers/losers | أعلى تحرك |
| **LiveMonitor** | نشط | /api/live-monitor | **Strangler** → useLiveMonitorData |
| **OpportunityCalculatorWidget** | نشط (guest) | /api/market/top-movers (B2) | "لو كنت مالك السهم" |
| **TrackRecordWidget** | نشط | /api/predictions/honest-tracking/live-tracking | track record أسبوعي |
| **PriorityNotificationsWidget** | نشط | /api/notifications/priority (B3) | تنبيهات ذكية |
| **CryptoSignalsWidget** | نشط (CRYPTO) | /api/crypto + external Fear&Greed | إشارات كريبتو |
| **LiquidityFlowPanel** | نشط | /api/market/liquidity-flow | رادار السيولة |
| **MultiMarketWidget** | نشط | /api/data-engine/* (4 endpoints) | أسهم + ذهب + كريبتو + فوركس |
| **MyStocksBriefing** | نشط (auth) | /api/portfolio/unified-watch + /api/news | تنبيهات المحفظة |
| **RealtimeTicker** | نشط | /api/stocks (fallback) + WebSocket | شريط أسعار متحرك |
| **LiveStockTicker** | نشط | /api/market-pulse | شريط رابحين/خاسرين |
| **IntradayPressurePanel** | نشط | /api/market/intraday-pressure | ضغط الجلسة |
| **SeasonalitySignalsWidget** | نشط | /api/seasonality-signals | إشارات موسمية |
| **AssetPreferenceOnboarding** | نشط (first visit) | — | اختيار نوع الأصول |
| **DashboardView** | نشط | — | الـ shell اللي بيجمع كل widgets |
| **PinnableWidget** | نشط | — | wrapper للـ pin/unpin |
| **SafeWidget** | نشط | — | ErrorBoundary wrapper |
| **DevelopmentNotice** | مخفي | — | إشعار تطوير |
| **MaestroWidget** | ميت (deprecated) | — | Rule 73 — بيرجع null |

---

## 🧩 Shared Business Components (src/components/shared/)

| Component | المسؤول عن | Rule |
|---|---|---|
| **UnifiedTable** | جدول موحد (sorting + pagination + skeleton + empty state) | Rule 52 |
| **UnifiedEmptyState** | empty state موحد بـ CTA | Rule 27 SAFE |
| **MarketSelector** | اختيار السوق (EGX/TADAWUL/KSE/QSE/US/CRYPTO) | Rule 52 |
| **ErrorBoundary** | catch errors + fallback UI | — |
| **PredictionCard** | بطاقة توقع موحدة | — |
| **ChartToggle** | تبديل TradingView ↔ Interactive | — |
| **FlashingPriceCell** | خلية سعر بـ flash animation | — |
| **FlashingChangeCell** | خلية تغيّر بـ color animation | — |
| **DataTrustBadge** | شارة مصدر البيانات | — |
| **StockFeelCard** | بطاقة إحساس السوق | — |
| **LazyTabLoader** | lazy load للـ tabs | — |
| **LiquidityRadarView** | عرض رادار السيولة | — |
| **StockSearchSelector** | بحث أسهم موحد | — |

### Shared UI (src/components/shared/ui/)

| Component | المسؤول عن |
|---|---|
| **StockCard** | بطاقة سهم |
| **PriceText** | نص سعر بـ color coding |
| **UnifiedPagination** | pagination موحد |

---

## 🎨 UI Primitives (src/components/ui/)

48 component من shadcn/ui (New York style) + Lucide icons.  
كلها بتـستخدم CSS variables (design tokens) — ممنوع hardcoded colors (Rule 30).

---

## 📱 Views (الشاشات الرئيسية)

| Module | الشاشات | الـ View الرئيسي |
|---|---|---|
| **dashboard** | 25 widget | DashboardView |
| **portfolio** | محفظة + watchlist + reports | EnhancedPortfolioView |
| **stock-analysis** | تفاصيل سهم + chart | StockDetail + StocksView |
| **market-analysis** | تحليل سوق + morning bell | MarketAnalysisView |
| **predictions** | توقعات + tracking | PredictionTrackingView |
| **radar** | رادار + accuracy | RadarStatsCards |
| **screener** | فلتر أسهم | StockScreenerAdvanced |
| **crypto** | كريبتو + simulation | CryptoPortfolioView |
| **reports** | تقارير يومية/أسبوعية | ReportsView |
| **news** | أخبار + feed | NewsFeedView |
| **education** | أكاديمية + lessons | AcademyView |
| **admin** | إدارة + DB manager | DatabaseManagerFull |
| **subscription** | اشتراكات + pricing | PricingView |
| **auth** | login + register | DevLoginForm |
| **simulation** | paper trading | SimulationView |
| **sharia** | مطابقة شرعية | — |
| **publishing** | نشر + share | UnifiedPublishButton |

---

## 🔄 Migration Status (F2.2 — TanStack Query)

### Dashboard Widgets — 12/12 Migrated ✅

كل dashboard widgets اتعملها migration من manual fetch + useState لـ `useApiQuery`:

| Widget | قبل | بعد | Pattern |
|---|---|---|---|
| CryptoSignalsWidget | manual fetch + useState | useApiQuery + useQuery | F2.2 |
| SovereignMetalsDesk | manual fetch + setInterval | useApiQuery (refetchInterval) | F2.2 |
| RealtimeTicker | manual fetch + useEffect | useApiQuery (enabled flag) | F2.2 |
| SeasonalitySignalsWidget | manual fetch + useState | useApiQuery + useMemo | F2.2 |
| IntradayPressurePanel | manual fetch + setInterval | useApiQuery (refetchInterval) | F2.2 |
| LiveStockTicker | manual fetch + polling | useApiQuery + useMemo | F2.2 |
| LiquidityFlowPanel | manual fetch + useCallback | useApiQuery (params) | F2.2 |
| MultiMarketWidget | 4 manual fetches + Promise.allSettled | 4 useApiQuery hooks | F2.2 |
| InvestorsFlowPanel | Promise.all + manual fetch | 2 useApiQuery hooks | F2.2 |
| MyStocksBriefing | sequential manual fetches | 2 useApiQuery (dependent) | F2.2 |
| MarketPulseWidget | manual fetch + freshness | useApiQuery + Strangler hook | F2.2 + Strangler |
| LiveMonitor | manual fetch + countdown | useApiQuery + Strangler hook | F2.2 + Strangler |

### Strangler Pattern Hooks — 3 ✅

| Hook | Widget | LOC before | LOC after | Δ |
|---|---|---|---|---|
| useMarketPulseData | MarketPulseWidget | 912 | 756 | -156 |
| useLiveMonitorData | LiveMonitor | 1,431 | 1,351 | -80 |
| usePortfolioData | EnhancedPortfolioView | 3,375 | 3,281 | -94 |
| **إجمالي** | | | | **-330 LOC** |

---

## 🔒 Auth Status (F1.2 — sandbox)

18/26 routes protected بـ `getSessionUserId()` auth guard.

### Protected Routes (sandbox — ممنوع push لـ main)

| Batch | Routes | commit |
|---|---|---|
| 1 | points, mobile/news, bot/check-subscription, finance/schema, mobile/watchlist | `7bf8f1d` |
| 2 | paper-trading-v2/* (5), points/leaderboard | `48349ec` |
| 3 | portfolio/accounts/[id]/* (2), subscription/developer-request, user-posts/* (3), v2/chart/full-analysis | `78be761` |

### Public by Design (مش محتاجة auth)

- auth/login, auth/register, auth/google-signin, paymob/callback, google-play/verify-receipt

### Already Safe (بتستخدم getUserIdsWithLegacy)

- watchlist, watchlist-enhanced

---

## 📋 Remaining Work

### Frontend Ready for Review ✅

- [x] F0.1 — Tailwind v4 syntax fix (Turbopack شغال)
- [x] F1.1 — Audit سكريبت (464 routes مصنفين)
- [x] F2.1 — TanStack Query centralized config
- [x] F2.2 — 12/12 dashboard widgets migrated
- [x] Strangler — 3 hooks (709 LOC extracted)
- [x] F1.3 — cleanup 'default' legacy
- [x] F1.4 — formatPrice DRY
- [x] F1.2 — 18/26 auth routes protected (sandbox)

### Pending (محتاج موافقة المالك)

- [ ] Push F1.2 auth routes لـ main (الـ 182 مشترك)
- [ ] Strangler على MakerRadarTab (3,918 LOC)
- [ ] Strangler على SpecialistAnalysisView (2,916 LOC)
- [ ] UnifiedTable migration (46 manual <table>)
- [ ] UnifiedEmptyState migration (64 "لا توجد بيانات")
