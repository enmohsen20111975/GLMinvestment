# 05 — شاشات ومكونات المنصة (Screens & Components)

> **آخر تحديث:** 2026-10-24 (Phase 3 Modularization Complete)  
> **المراجع:** `00-CONSTITUTION.md`, `01-ARCHITECTURE.md`, `PLAN-COMPONENT-UNIFICATION.md`  
> **الهدف:** خريطة كاملة لكل شاشة، مكون، hook، والـ API اللي بيستخدمه.

---

## 📊 الإحصائيات الحالية

| المقياس | القيمة |
|---|---|
| إجمالي ملفات TS/TSX | **1,301** |
| إجمالي الأسطر | **328,956** |
| متوسط حجم الملف | **252 LOC** (كان 289 قبل التفكيك) |
| ملفات < 300 LOC | **938 (72%)** |
| ملفات > 1000 LOC | **34** (كان 48) |
| Modules | 19 |
| Hooks مخصصة | 12 |
| مكتبة مكونات موحدة | 35 component |
| API routes | 464 |
| Pages (App Router) | 13 |
| WidgetCard adoption | 68 ملف |

---

## 🪝 Hooks المخصصة (src/hooks/)

### Strangler Pattern Hooks (Phase 2 + Phase 3)

كل hook بيفصل الـ data logic (fetch + state + effects) عن الـ render logic:

| Hook | الملف | الـ Widget المستخدم | LOC |
|---|---|---|---|
| `useMarketPulseData` | `useMarketPulseData.ts` | MarketPulseWidget | 179 |
| `useLiveMonitorData` | `useLiveMonitorData.ts` | LiveMonitor | 219 |
| `usePortfolioData` | `usePortfolioData.ts` | EnhancedPortfolioView | 311 |
| `useMakerRadarData` | `useMakerRadarData.ts` | MakerRadarTab | 349 |
| `useSpecialistAnalysisData` | `useSpecialistAnalysisData.ts` | SpecialistAnalysisView | 565 |
| `useDatabaseManagerData` | `useDatabaseManagerData.ts` | DatabaseManagerFull | 405 |
| `useScreenerData` | `useScreenerData.ts` | StockScreenerAdvanced | 427 |
| `usePersonaTabData` | `usePersonaTabData.ts` | PersonaTab | 32KB |
| `useAcademyData` | `useAcademyData.ts` | AcademyView | 368 |
| `useEngineControlRoomData` | `useEngineControlRoomData.ts` | EngineControlRoomTab | 645 |
| `useStocksViewData` | `useStocksViewData.ts` | StocksView | 202 |
| `useSuperLearningData` | `useSuperLearningData.ts` | SuperLearningSystem | — |

### Hooks موجودة

| Hook | المسؤول عن |
|---|---|
| `useApiQuery` | TanStack Query wrapper لـ apiGet (canonical fetch layer) |
| `useVisibilityAwarePolling` | polling بيـ pause لما tab مخفي |
| `useDebounce` | debounce لـ search inputs |
| `usePagination` | pagination state |
| `useToast` | toast notifications |
| `useAuthCheck` | auth status check |
| `useMobile` | responsive breakpoint detection |

---

## 🧩 مكتبة المكونات الموحدة (35 component)

### Phase 3 — مكونات موحدة جديدة (9)

| المكوّن | يحل تكرار | متوقع إزالة |
|---|---|---|
| **WidgetCard** | Card+Header+Title+Refresh+Loading | ~3,935 سطر |
| **WidgetStat + WidgetStatGrid** | stat tiles + grid layout | ~1,500 سطر |
| **WidgetError** | error state UI | ~800 سطر |
| **Label** | `<span className="text-xs text-muted-foreground">` | ~1,676 سطر |
| **NumText** | `<span className="tabular-nums" dir="ltr">{toFixed}>` | ~1,663 سطر |
| **ChangeText** | `>= 0 ? text-profit : text-loss` + sign + % | ~2,779 سطر |
| **PriceValue** | `{value.toFixed(2)} ج.م` | ~308 سطر |
| **DateText** | `toLocaleDateString/Intl.DateTimeFormat` | ~92 سطر |
| **SectionTitle** | `<h3 className="text-xs font-semibold flex items-center gap-1.5">` | ~400 سطر |

**إجمالي التكرار القابل للإزالة: ~13,053 سطر**

### مكونات موجودة (26)

```
src/components/shared/ui/
├── ActionMenu.tsx              ← action menu
├── AsyncBoundary.tsx           ← async boundary
├── ChangePill.tsx              ← change badge
├── ConfidenceMeter.tsx         ← confidence gauge
├── DeltaBadge.tsx              ← delta badges
├── FilterDrawer.tsx            ← filter drawer
├── FinancialBadge.tsx          ← financial badges
├── FlowPhaseTag.tsx            ← flow phase tags
├── LifecycleBadge.tsx          ← lifecycle badges
├── LiquidityFlashCell.tsx      ← flashing price cell
├── MarketTable.tsx             ← market table
├── PersonaEmptyState.tsx       ← persona empty state
├── PriceDisplay.tsx            ← price + change + arrow
├── PriceText.tsx               ← price + currency (canonical)
├── RiskRewardBadge.tsx         ← R:R badges
├── SeverityBadge.tsx           ← severity badges
├── SignalBadge.tsx             ← signal badges
├── Skeleton.tsx                 ← loading skeleton
├── StatusBadge.tsx              ← status badges
├── StockCard.tsx               ← stock card
├── StockDetailDrawer.tsx       ← stock detail drawer
├── StockRescueModal.tsx        ← rescue modal
├── TrendIndicator.tsx          ← trend arrow
├── UnifiedEmptyState.tsx       ← empty state (Rule 27)
├── UnifiedPagination.tsx       ← pagination
├── WickLiquidityBar.tsx        ← liquidity bar
```

---

## 📁 ملفات Mega المقسمة (Phase 3)

### تقسيم كامل لـ folders (22 ملف)

| # | الملف الأصلي | LOC قبل | LOC بعد (shim) | المجلد الجديد | # ملفات |
|---|---|---|---|---|---|
| 1 | MakerRadarTab | 3,763 | 24 | `maker-radar/` | 8 |
| 2 | EnhancedPortfolioView | 3,281 | 52 | `enhanced-portfolio/` | 10 |
| 3 | DatabaseManagerFull | 3,160 | 12 | `db-manager/` | 15 |
| 4 | SpecialistAnalysisView | 2,550 | 22 | `specialist/` | 20 |
| 5 | StockScreenerAdvanced | 2,517 | 17 | `screener-advanced/` | 12 |
| 6 | AcademyView | 2,357 | 7 | `academy/` | 13 |
| 7 | StocksView | 2,287 | 13 | `stocks-view/` | 14 |
| 8 | PersonaTab | 2,228 | 21 | `persona/` | 13 |
| 9 | TelegramTab | 2,200 | 21 | `telegram-tab/` | 12 |
| 10 | StrategySandbox | 2,188 | 12 | `strategy-sandbox/` | 10 |
| 11 | SimulationView | 2,130 | 12 | `simulation-view/` | 9 |
| 12 | AdminView | 2,105 | 28 | `admin-view/` | 12 |
| 13 | PredictionTrackingDashboard | 2,098 | 30 | `prediction-dashboard/` | 14 |
| 14 | ExecutiveReportView | 2,087 | 32 | `executive-report/` | 13 |
| 15 | AcademyEncyclopedia | 2,054 | 25 | `academy-encyclopedia/` | 9 |
| 16 | EngineControlRoomTab | 2,185 | 43 | `engine-control/` | 10 |
| 17 | SuperLearningSystem | 1,856 | 46 | `super-learning/` | 9 |
| 18 | SubscriptionView | 1,790 | 36 | `subscription-view/` | 10 |
| 19 | ShariaView | 1,478 | 20 | `sharia-view/` | 8 |
| 20 | TradeResultsTemplates | 1,456 | 33 | `trade-templates/` | 7 |
| 21 | UsersManagement | 1,543 | 24 | `users-mgmt/` | 11 |
| 22 | SingleStockAnalysisView | 1,548 | 22 | `single-stock/` | 7 |
| 23 | PaperTradingWorkstation | 1,550 | 21 | `paper-trading-ws/` | 7 |
| **Total** | | **43,931** | **610** | **23 folders** | **248 files** |

### استخراج helpers (10+ ملفات)

استخراج types + helpers + indicators + constants من ملفات لسه كبيرة:

| الملف | LOC | استخراج | المجلد |
|---|---|---|---|
| UnifiedTable | 2,942 | types + helpers + filters | `unified-table/` |
| LearningVisuals | 2,644 | constants + data | `learning-visuals/` |
| honest-predictions/page | 1,930 | helpers + state-types | `honest-predictions/components/` |
| TradingViewChart | 1,895 | indicators + constants + config | `trading-view-chart/` |
| maestro.ts | 1,877 | types + helpers + scoring | `honest-tracking/modules/` |
| educational-cards/page | 1,706 | helpers + card-types | `educational-cards/components/` |
| StockDetail | 1,673 | helpers + cards + flow-score | `stock-detail/` |
| ExpertRecommendationsPanel | 1,620 | helpers + columns + render-helpers | `expert-recommendations/` |
| store.ts | 1,594 | types + helpers + constants + actions | `store-modules/` |

---

## 📺 Dashboard Widgets (src/modules/dashboard/components/)

25 widget مسجلين في PinnableWidget registry. كلهم adopted WidgetCard.

| Widget | الحالة | الـ API | Hook |
|---|---|---|---|
| MarketSummary | نشط | /api/market/overview | — |
| IndexCards | نشط (EGX) | marketOverview | — |
| MarketPulseWidget | نشط (EGX) | /api/market-pulse | useMarketPulseData |
| MarketSentiment | نشط (EGX) | /api/market/sentiment | — |
| InvestorsFlowPanel | نشط (EGX) | /api/market/liquidity-flow | — |
| SovereignMetalsDesk | نشط | /api/market/metals-forex | — |
| TopMovers | نشط | marketOverview.gainers/losers | — |
| LiveMonitor | نشط | /api/live-monitor | useLiveMonitorData |
| OpportunityCalculatorWidget | نشط (guest) | /api/market/top-movers (B2) | — |
| TrackRecordWidget | نشط | /api/predictions/honest-tracking | — |
| PriorityNotificationsWidget | نشط | /api/notifications/priority (B3) | — |
| CryptoSignalsWidget | نشط (CRYPTO) | /api/crypto + external F&G | — |
| LiquidityFlowPanel | نشط | /api/market/liquidity-flow | — |
| MultiMarketWidget | نشط | /api/data-engine/* (4 endpoints) | — |
| MyStocksBriefing | نشط (auth) | /api/portfolio/unified-watch | — |
| RealtimeTicker | نشط | /api/stocks + WebSocket | — |
| LiveStockTicker | نشط | /api/market-pulse | — |
| IntradayPressurePanel | نشط | /api/market/intraday-pressure | — |
| SeasonalitySignalsWidget | نشط | /api/seasonality-signals | — |

---

## 📱 Views (الشاشات الرئيسية)

| Module | الشاشات | الـ View الرئيسي | مقسم؟ |
|---|---|---|---|
| dashboard | 25 widget | DashboardView | — |
| portfolio | محفظة + watchlist | EnhancedPortfolioView → `enhanced-portfolio/` | ✅ |
| stock-analysis | تفاصيل سهم | StockDetail → `stock-detail/` | ✅ |
| market-analysis | تحليل سوق | PersonaTab → `persona/` | ✅ |
| predictions | توقعات + tracking | PredictionTrackingDashboard → `prediction-dashboard/` | ✅ |
| radar | رادار + accuracy | — | — |
| screener | فلتر أسهم | StockScreenerAdvanced → `screener-advanced/` | ✅ |
| crypto | كريبتو | — | — |
| reports | تقارير | ExecutiveReportView → `executive-report/` | ✅ |
| news | أخبار | — | — |
| education | أكاديمية | AcademyView → `academy/` | ✅ |
| admin | إدارة | AdminView → `admin-view/` + DatabaseManagerFull → `db-manager/` | ✅ |
| subscription | اشتراكات | SubscriptionView → `subscription-view/` | ✅ |
| simulation | paper trading | SimulationView → `simulation-view/` | ✅ |
| sharia | مطابقة شرعية | ShariaView → `sharia-view/` | ✅ |
| publishing | نشر | TradeResultsTemplates → `trade-templates/` | ✅ |

---

## 🔒 Auth Status (F1.2 — sandbox)

18/26 routes protected بـ `getSessionUserId()` auth guard.

### Protected Routes (sandbox — ممنوع push لـ main)

| Batch | Routes |
|---|---|
| 1 | points, mobile/news, bot/check-subscription, finance/schema, mobile/watchlist |
| 2 | paper-trading-v2/* (5), points/leaderboard |
| 3 | portfolio/accounts/[id]/* (2), subscription/developer-request, user-posts/* (3), v2/chart/full-analysis |

### Public by Design
auth/login, auth/register, auth/google-signin, paymob/callback, google-play/verify-receipt

### Already Safe (getUserIdsWithLegacy)
watchlist, watchlist-enhanced

---

## 📋 Remaining Work

### Frontend Status

- [x] F0.1 — Tailwind v4 syntax fix (Turbopack)
- [x] F1.1 — Audit script (464 routes)
- [x] F1.3 — cleanup 'default' legacy
- [x] F1.4 — formatPrice DRY
- [x] F2.1 — TanStack Query centralized config
- [x] F2.2 — 12/12 dashboard widgets migrated to useApiQuery
- [x] Phase 3 — 23 mega files split into folders
- [x] Phase 3 — 12 hooks extracted (Strangler Pattern)
- [x] Phase 3 — 35 unified components in shared/ui/
- [x] Phase 3 — WidgetCard adoption on 68 files
- [x] Phase 3 — helpers extraction from 10+ files
- [ ] F1.2 — Push 18 auth routes to main (needs owner approval)
- [ ] Remaining 34 mega files > 1000 LOC
- [ ] WidgetCard adoption on remaining ~66 files
- [ ] UnifiedTable migration (manual tables)
