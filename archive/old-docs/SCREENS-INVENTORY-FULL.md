# فهرس الشاشات الكامل — GLMinvestment

> **Task:** SCREENS-INVENTORY-FULL
> **Scope:** DETAILED inventory of EVERY screen/view in the platform — LIVE + ARCHIVED.
> **Source of truth:** `src/app/page.tsx` `renderView()` switch (lines 548-804) + `src/lib/valid-views.ts` + `archive/garage/INDEX.md` + `archive/dead-components-2026-10-08/` + `archive/wave-2-cleanup-2026-10-01/` + `archive/education-duplicate-2026-10-01/` + `archive/simulation-crypto-duplicate-2026-10-01/` + `archive/chatbot-popup-2026-10-01/` + `archive/devil-feature-2026-10-01/`.
> **5-portal structure** is defined in `src/components/layout/TopBar.tsx` (sections `home` / `market` / `predictions` / `finance` / `more`) and mirrored by the mobile bottom nav (`src/components/layout/MobileNav.tsx`: dashboard / stocks / recommendations / portfolio / liquidity-radar).
> **Status legend:** ✅ LIVE = a `case` in `renderView()`; 📦 ARCHIVED = moved under `archive/`; 🔁 REDIRECT = route still in `VALID_VIEWS` but renders another view (UI-Mirror Protocol / Rule 63 unification).

---

## الباب 1: الشاشات الحية (Live Screens)

Total distinct `case` branches in `renderView()`: **55** (including aliased routes that share a component).
Total distinct **rendered components**: **40** (after deduplication — many hash routes alias to the same component, e.g. `crypto-live` → `StocksView`).

### 🏠 البوابة الأولى: الرئيسية (Dashboard)

| # | الاسم | المسار | المكون | LOC | الوصف | sub-views | Library |
|---|---|---|---|---|---|---|---|
| 1 | الرئيسية / Dashboard | `#dashboard` | `DashboardView` | 590 | لوحة نظرة عامة على السوق — index cards, market pulse widget, top movers, multi-market widget. | widgets: MarketPulse, TopMovers, MultiMarket, InvestorsFlow, LiquidityFlow, IntradayPressure, SeasonalitySignals, MyStocksBriefing, IndexCards | ad-hoc (`@/components/ui/*`, `@/modules/dashboard/components/*` widgets) |

### 📊 البوابة الثانية: السوق (Market)

| # | الاسم | المسار | المكون | LOC | الوصف | sub-views | Library |
|---|---|---|---|---|---|---|---|
| 2 | الأسهم / Stocks | `#stocks`, `#stock-detail` | `StocksView` | 2319 | شاشة الأسهم الرئيسية — جدول أسعار لحظي بـ flashing cells + detail drawer. | ad-hoc patterns + `FlashingPriceCell`, `FlashingChangeCell`, `UnifiedTable`, `StockDetailDrawer` |
| 3 | فلاتر الأسهم / Stock Screener | `#stock-filters` | `StockScreenerAdvanced` | 2723 | فلاتر متقدمة + أعلى الأرباح/الخسائر — Python screener via proxy. | 2 Tabs: `advanced`, `top-performers` | `UnifiedTable`, `FilterDrawer` |
| 4 | أعلى الأرباح/الخسائر / Top Performers | `#top-performers` | `StockScreenerAdvanced` (initialTab=`top-performers`) | 2723 | Redirect للتاب الثاني من StockScreenerAdvanced (merged — see Rule 67 comment in page.tsx line 566). | (sub-view of #3) | shared/ui via StockScreenerAdvanced |
| 5 | الشارت التفاعلي / Trading Chart | `#screener`, `#trading-chart` | `TradingChartView` | 309 | تقرير مالي احترافي لسهم واحد (8 أقسام منظمة) — wraps `ProfessionalTradingChart`. | (none — passes through to ProfessionalTradingChart) | shared (FlashingPriceCell, UnifiedTable) via sub-component |
| 6 | رادار السيولة / Liquidity Radar | `#liquidity-radar` | `LiquidityRadarView` | 657 | جدول تدفقات السيولة المؤسسية (10 أعمدة + MiniSparkline + UnifiedPublishButton). onRowClick → StockDetailSheet. | (single table view) | ✅ **shared/ui** (`UnifiedTable`, `UnifiedPublishButton`, `StockDetailSheet`) |
| 7 | عمق السوق / Market Depth | `#market-depth` | (inline composite in `page.tsx`) | inline | شاشة منفصلة تجمع MultiMarketWidget (عملات/ذهب) + InvestorsFlowPanel (EGX فقط). | 2 sections: `MarketDepthMultiMarket` (610 LOC), `MarketDepthInvestorsFlow` (557 LOC) | shared (SafeWidget wrappers) |

### 🎯 البوابة الثالثة: التوصيات / التحليل (Recommendations)

| # | الاسم | المسار | المكون | LOC | الوصف | sub-views | Library |
|---|---|---|---|---|---|---|---|
| 8 | التوصيات / Recommendations | `#recommendations`, `#analysis` | `MarketAnalysisView` | 332 | لوحة التوصيات الرئيسية — تابات: توقعات، حالة السوق، تتبّع القطاعات، تداولات تاريخية، net-picks، تقارير. | 6 Tabs: `predictions`, `status`, `sectors-tracking`, `historical-trades`, `net-picks`, `reports` | ✅ **shared/ui** (`UnifiedPredictionsTab`, `UnifiedEmptyState`, etc.) |
| 9 | التوقعات المزدوجة / Dual Track | `#dual-track` | `DualTrackPredictionsView` | 633 | شاشة نظام التوقعات المزدوج (DUAL-TRACK-PHASE-5) — combined_efficiency stats + tabs تحليل كامل / سيولة / الكل. | 3 Tabs (combined analysis view variants) | shared (UnifiedTable) |
| 10 | تتبّع التوقعات / Prediction Tracking | `#prediction-tracking`, `#picks-management` | `PredictionTrackingView` | 718 | تتبّع التوقعات — كروت إحصائية + جدول قابل للفلترة + زر "تحقق الآن". `picks-management` merged here (Task 7-A, 2026-09-28). | (single view, no TabsTrigger) | shared (UnifiedTable) |
| 11 | التحليل الموحّد / Unified Analysis | `#unified-analysis` | `UnifiedAnalysisView` | 562 | تحليل موحّد لسهم واحد (multiple data sources merged). | (none visible) | ad-hoc |
| 12 | تحليل المتخصصين / Specialist Analysis | `#specialist-analysis` | `SpecialistAnalysisView` | 2916 | التقرير المالي الاحترافي العميق لسهم واحد (Task 44-A rebuild with real data — momentum + institutions + price action). | (no TabsTrigger — sections within single scroll) | ad-hoc |
| 13 | تحليل متقدّم (محذوف → redirect) / Advanced Analysis | `#advanced-analysis`, `#v2-analysis` | `MarketAnalysisView` (redirect) | 332 | REMOVED — features distributed to #recommendations + #specialist-analysis. Hash preserved for backward-compat (Rule 67). | (alias of #8) | (same as #8) |
| 14 | تحليلات فنية (محذوف → admin-only placeholder) / Prediction Performance | `#prediction-performance`, `#prediction-credibility` | inline placeholder (page.tsx) | ~13 | admin-only الآن — direct access يعرض "متاحة في لوحة التحكم للمشرفين فقط" + زر العودة. | (single placeholder) | ad-hoc |
| 15 | القرار المؤسسي V82 / V82 Decision | `#v82` | `V82DecisionPanel` (initialTicker=`COMI`) | 294 | لوحة قرار V82 — BUY/SELL/WAIT/AVOID + 9-Condition Gate + Entry/SL/TP1/TP2 + Money Flow. | (single panel) | ad-hoc |
| 16 | التقارير / Reports | `#reports` | `ReportsView` | 955 | الشاشة الرئيسية للتقارير — Task 42 redesign، جودة PDF + print احترافية. | (report sub-sections) | ad-hoc |
| 17 | المساعد الذكي / Smart Confluence | `#smart-confluence` | `SmartConfluenceView` | 276 | لوحة المساعد المالي الذكي — confluence signal for symbol. | (single view) | ad-hoc |
| 18 | الموسمية / Seasonality | `#seasonality` | `SeasonalityDashboard` | 300 | لوحة الموسمية — seasonal patterns dashboard. | (single dashboard) | ad-hoc |

### 💼 البوابة الرابعة: محفظتي (Portfolio)

| # | الاسم | المسار | المكون | LOC | الوصف | sub-views | Library |
|---|---|---|---|---|---|---|---|
| 19 | المحفظة / Portfolio | `#portfolio`, `#finance` | `EnhancedPortfolioView` | 3369 | لوحة المحفظة المالية الشاملة — Task 40-B merged wealth + rescue + advanced-portfolio as sub-tabs. | 5 Tabs: `assets`, `income-expense`, `obligations`, `reports`, `alerts` | ad-hoc + shared (UnifiedTable) |
| 20 | قائمة المتابعة / Watchlist | `#watchlist` | `EnhancedWatchlistView` | 1356 | قائمة مراقبة الأسهم المحسّنة — flashing prices + alerts. | (single view) | shared (FlashingPriceCell, FlashingChangeCell, UnifiedTable, StockDetailDrawer) |
| 21 | إنقاذ سهم خسران / Bag Holder Rescue | `#bagholder-rescue` | `BagHolderRescuePanel` (via `BagHolderRescueView`) | 1124 | TASK 31-C — Dynamic Rescue & Debt Engine — persona-scaled rescue advice + debt paydown. Loss Summary + 5 tabs. | 5 Tabs: Technical, Fundamentals, Scenarios, Rescue Plan, Decision Journal | ad-hoc |
| 22 | المحفظة المتقدمة / Advanced Portfolio | `#advanced-portfolio` | `AdvancedPortfolioManager` | 578 | لوحة إدارة المحفظة المتقدمة — risk metrics + multi-portfolio. | (single view) | ad-hoc |
| 23 | مركز التنبيهات / Alerts Center | `#alerts-center` | `AlertsCenterView` | 689 | مركز التنبيهات الذكية — multi-stage alerts + scheduler. | (single view) | ad-hoc |
| 24 | المراقبة الحية / Live Monitor | `#live-monitor` | `LiveMonitor` | 1357 | لوحة المراقبة الحية لسوق EGX — جلب كل 10 ثوانٍ + حالة السوق + EGX30 + صحة النظام + محفظة مباشرة + متحركات. | (single dashboard) | ad-hoc |
| 25 | رسوم الثروة / Wealth Charts | `#wealth` | `WealthCharts` | 465 | رسوم بيانية لإدارة الأموال — Line Chart (timeline), Pie (توزيع أصول), Area (ربح/خسارة يومي), Bar (مصاريف). | 4 chart panels | ad-hoc (Recharts) |
| 26 | ذاكرة التداول / Trading Memory | `#trading-memory` | `TradingMemoryView` | 326 | لوحة ذاكرة التداول — includes ProfessionalWatchlistView sub-component. | (renders ProfessionalWatchlistView inside) | ad-hoc |
| 27 | يوميات التداول / Trading Journal | `#trading-journal` | `TradingJournalView` | 586 | يوميات التداول — trade log + stats. | (single journal view) | ad-hoc |
| 28 | منصة النشر / Publishing | `#publishing` | `UserPublishingView` | 739 | منصة نشر التوقعات + نقاط المستخدمين. | (single view) | ad-hoc |

### ☰ البوابة الخامسة: المزيد (More)

| # | الاسم | المسار | المكون | LOC | الوصف | sub-views | Library |
|---|---|---|---|---|---|---|---|
| 29 | الأخبار / News Feed | `#news` | `NewsFeedView` | 890 | الأخبار المالية والاقتصادية — 2-column layout + investment insights + social sharing. | (single feed) | ad-hoc |
| 30 | المحاكاة / Simulation | `#simulation` | `SimulationView` | 2130 | محاكاة تداول لحظية لكل الأسواق (EGX/TADAWUL/KSE/QSE/US/CRYPTO) — Wave 5 unified. | (single simulator) | ad-hoc |
| 31 | الأكاديمية / Academy | `#academy` | `AcademyView` | 2483 | الأكاديمية الموحّدة — Rule 63 unifies `learning` + `crypto-learning` routes here. | 5+ Tabs: 📚 encyclopedia, 💻 paper-trading, 🕯️ candle-sim, 📊 strategy-lab, 🎓 advanced-lessons, 🏛️ trading-floor, 🛠️ practical-tools, 🧪 advanced-lab | ad-hoc |
| 32 | الزكاة / Zakat | `#zakat` | `ZakatView` | 1143 | حاسبة الزكاة الإسلامية — gold/silver/cash/stocks calculation. | (single calculator) | ad-hoc |
| 33 | العشور / Tithes | `#tithes` | `TithesView` | 757 | حاسبة العشور المسيحية — Christian symbol components. | (single calculator) | ad-hoc |
| 34 | التوافق الشرعي / Sharia Compliance | `#sharia` | `ShariaView` | 1490 | Task 23-C — شاشة احترافية بطراز مالي إسلامي (emerald+gold) — 253 سهماً + حاسبة تطهير + 8 مصادر. | (list + calculator) | ad-hoc |
| 35 | الاشتراك / Subscription | `#subscription` | `SubscriptionView` | 1791 | خطط الاشتراك + trial + payment (Paymob + Instapay). | (single view) | ad-hoc |
| 36 | الإعدادات / Settings | `#settings` | `SettingsView` | 232 | إعدادات المستخدم + التطبيق. | (single view) | ad-hoc |
| 37 | تسجيل الدخول / Auth | `#auth` | `AuthView` | 650 | تسجيل الدخول / التسجيل — OAuth + email + bot-link. | (single view) | ad-hoc |
| 38 | من نحن / About | `#about` | `AboutView` | 384 | صفحة تعريفية مهنية بالمنصة + الأسواق + المنهجية (PHASE1-CRITICAL-FIXES rewrite). | (single view) | ad-hoc |
| 39 | لوحة الأدمن / Admin | `#admin` | `AdminView` | 2083 | لوحة تحكم شاملة للمشرف — many tabs (dashboard, system-monitor, problems, cron-health, engine-control-room, data-engine, learning, backtest, platform-performance, databases, db-backup, system-control, news-control, news-health, sharia, source-authority, validation-monitor, user-management, users, promo-codes, marketing-studio, content-studio, etc.). | 30+ sub-tabs grouped into 5+ sections (health / maestro / data / users / etc.) | ad-hoc |
| 40 | لوحة الـ Backtest / EGX Backtest | `#backtesting` | `EGXBacktestDashboard` | 443 | لوحة اختبار الاستراتيجيات (backtest) على بيانات EGX التاريخية. | (single view) | ad-hoc |
| 41 | عيادة الإنقاذ / Rescue Page | `#rescue` | `RescuePage` (`@/app/rescue/page`) | 407 | ALPHA-P0 — عيادة إنقاذ الصفقات المتعثرة (separate Next.js route `/rescue` wrapped inside hash view). | (single rescue analyzer) | ad-hoc |

### 🪙 الكريبتو — المسارات الموحّدة (UI-Mirror Protocol)

> كل routes الـ `crypto-*` بترسم نفس الـ components اللي بيستعملها السوق العادي + `setCurrentMarket('CRYPTO')` بيشتغل تلقائياً من shell effect في `page.tsx`. الفرق الوحيد = قيمة `currentMarket` في الـ store. (see `valid-views.ts` lines 55-95)

| # | الاسم | المسار | المكون المعاد استخدامه | LOC | ملاحظات |
|---|---|---|---|---|---|
| 42 | كريبتو / Crypto | `#crypto` | `DashboardView` | (590) | 🔁 redirect — نفس #1 + CRYPTO market |
| 43 | أسهم الكريبتو / Crypto Live | `#crypto-live` | `StocksView` | (2319) | 🔁 redirect — نفس #2 + CRYPTO market |
| 44 | محفظة الكريبتو / Crypto Portfolio | `#crypto-portfolio` | `CryptoPortfolioView` | 641 | ✅ unique component — crypto-specific holdings UI |
| 45 | قائمة متابعة الكريبتو / Crypto Watchlist | `#crypto-watchlist` | `EnhancedWatchlistView` | (1356) | 🔁 redirect — نفس #20 + CRYPTO market |
| 46 | توصيات الكريبتو / Crypto Recommendations | `#crypto-recommendations` | `MarketAnalysisView` | (332) | 🔁 redirect — نفس #8 + CRYPTO market |
| 47 | تحليل الكريبتو / Crypto Analysis | `#crypto-analysis` | `SmartConfluenceView` | (276) | 🔁 redirect — نفس #17 + CRYPTO market |
| 48 | تعليم الكريبتو / Crypto Learning | `#crypto-learning` | `AcademyView` | (2483) | 🔁 redirect — Rule 63: same canonical education screen |
| 49 | محاكاة الكريبتو / Crypto Simulation | `#crypto-simulation` | `SimulationView` | (2130) | 🔁 redirect — Wave 5: SimulationView now serves all markets |
| 50 | شارت الكريبتو / Crypto Trading Chart | `#crypto-trading-chart` | `TradingChartView` | (309) | 🔁 redirect — نفس #5 + CRYPTO market |
| 51 | تتبّع توقعات الكريبتو / Crypto Prediction Tracking | `#crypto-prediction-tracking` | `CryptoPredictionTrackingView` | 478 | ✅ unique component — crypto-specific prediction tracker |
| 52 | فلاتر الكريبتو / Crypto Screener | `#crypto-screener` | `StockScreenerAdvanced` | (2723) | 🔁 redirect — نفس #3 + CRYPTO market |

---

## الباب 2: الشاشات المؤرشفة (Archived / Garage)

### 2.1 شاشات مفلترة (top-level views مؤرشفة بالكامل)

| # | الاسم الأصلي | المسار الأصلي | مكان الأرشفة | LOC | السبب |
|---|---|---|---|---|---|
| A1 | `LearningView` (education screen) | `src/modules/education/components/LearningView.tsx` | `archive/education-duplicate-2026-10-01/LearningView.tsx` | 1063 | Rule 63 (Education Unification 2026-10-01) — كانت duplicate education screen. الـ canonical الآن `AcademyView` (`#academy`). الـ `learning` route + dynamic import اتمسحوا من `page.tsx`. |
| A2 | `CryptoSimulationView` | `src/modules/crypto/components/CryptoSimulationView.tsx` (also re-exported from `CryptoAdditionalViews.tsx` + `crypto/index.ts`) | `archive/simulation-crypto-duplicate-2026-10-01/CryptoSimulationView.tsx` | 1955 | Wave 5 — Simulation Globalization (Task 13 Step 4). `SimulationView` now serves ALL markets via unified `MarketSelector`. الـ `crypto-simulation` route دلوقتي بيرجّع `<SimulationView />` + `setCurrentMarket('CRYPTO')`. |
| A3 | `AIView` (standalone AI chatbot view) | `src/components/ai/AIView.tsx` | `archive/wave-2-cleanup-2026-10-01/src/components/ai/AIView.tsx` | 325 | Wave-2 cleanup — replaced by embedded `AIAnalysisWidget` + popup chatbot (which itself was later archived — see A4). |
| A4 | `FloatingAssistant` + `AIAssistantChat` (popup chatbot) | `src/components/ai/FloatingAssistant.tsx` + `AIAssistantChat.tsx` | `archive/chatbot-popup-2026-10-01/{FloatingAssistant.tsx,AIAssistantChat.tsx,index.ts}` | 304 + 332 | Popup chatbot removed — feature distributed to `SmartConfluenceView` (`#smart-confluence`) + admin AI tools. |
| A5 | `PicksManagementView` | `src/modules/predictions/components/PicksManagementView.tsx` | `archive/wave-2-cleanup-2026-10-01/src/modules/predictions/components/PicksManagementView.tsx` | 774 | Task 7-A (2026-09-28) — file deleted; features merged into `PredictionTrackingView`. الـ `picks-management` route دلوقتي بيرجّع `<PredictionTrackingView />` (Rule 67 backward-compat). |
| A6 | `DevilsAdvocatePanel` | `src/components/devil/DevilsAdvocatePanel.tsx` | `archive/wave-2-cleanup-2026-10-01/src/components/devil/DevilsAdvocatePanel.tsx` | 240 | Devil feature removed — never reached production-grade quality (per audit). |
| A7 | `MarketMood` + `DevilsCard` + `DevilsCalendar` + `ScenarioMatrix` (devil-feature screens) | `src/components/devil/{MarketMood,DevilsCard,DevilsCalendar}.tsx` + `ScenarioMatrix.tsx` (alongside engines + API routes) | `archive/devil-feature-2026-10-01/` | 186 + 314 + 193 + 182 | Devil feature (Devil's Advocate / Market Mood) — full feature archived. Complementary to A6. |
| A8 | `CryptoScreenerView` (independent) | `src/modules/crypto/components/CryptoScreenerView.tsx` | `archive/dead-components-2026-10-08/crypto/CryptoScreenerView.tsx` | 677 | Task P1-CLEANUP (2026-10-08) — imported as dynamic-import variable but never rendered in any JSX (dead code). Unified `StockScreenerAdvancedView` now serves `#crypto-screener`. |
| A9 | `CryptoTradingChartView` | `src/modules/crypto/components/CryptoTradingChartView.tsx` | `archive/dead-components-2026-10-08/crypto/CryptoTradingChartView.tsx` | 275 | Task P1-CLEANUP — dead code (never rendered). Unified `TradingChartView` now serves `#crypto-trading-chart`. |
| A10 | `CryptoAdvancedAnalysisView` | `src/modules/crypto/components/CryptoAdvancedAnalysisView.tsx` | `archive/dead-components-2026-10-08/crypto/CryptoAdvancedAnalysisView.tsx` | 688 | Task P1-CLEANUP — dead code. Features distributed to `SpecialistAnalysisView` + `SmartConfluenceView`. |
| A11 | `CryptoLearningView` | `src/modules/crypto/components/CryptoLearningView.tsx` | `archive/dead-components-2026-10-08/crypto/CryptoLearningView.tsx` | 1106 | Task P1-CLEANUP — dead code. Rule 63: unified `AcademyView` now serves `#crypto-learning`. |
| A12 | `CryptoAdditionalViews` (re-export aggregator) | `src/modules/crypto/components/CryptoAdditionalViews.tsx` | `archive/dead-components-2026-10-08/crypto/CryptoAdditionalViews.tsx` | 34 | Re-export barrel for A8-A11 — archived together. |

### 2.2 شاشات فرعية مفلترة (sub-components / sub-tabs within AdminView + DashboardView)

| # | الاسم الأصلي | المسار الأصلي | مكان الأرشفة | LOC | السبب |
|---|---|---|---|---|---|
| A13 | `IndicesCSVUploader` (admin sub-tab) | `src/modules/admin/components/IndicesCSVUploader.tsx` | `archive/dead-components-2026-10-01/admin/IndicesCSVUploader.tsx` | 278 | Dead admin tab — CSV uploader never wired into AdminView tab list. |
| A14 | `HumanRecommendationsAdmin` (admin sub-tab) | `src/modules/admin/components/HumanRecommendationsAdmin.tsx` | `archive/dead-components-2026-10-01/admin/HumanRecommendationsAdmin.tsx` | 1028 | Dead admin tab — replaced by unified `RecommendationTrackingView` user-facing screen. |
| A15 | `AnalysisFlowDiagram` (market-analysis widget) | `src/modules/market-analysis/components/AnalysisFlowDiagram.tsx` | `archive/dead-components-2026-10-01/market-analysis/AnalysisFlowDiagram.tsx` | 326 | Dead visualization widget — replaced by simpler flow tags inside UnifiedPredictionsTab. |
| A16 | `DataCoverageBanner` (stock-analysis widget) | `src/modules/stock-analysis/components/DataCoverageBanner.tsx` | `archive/dead-components-2026-10-01/stock-analysis/DataCoverageBanner.tsx` | 209 | Dead banner — coverage info merged into StockDetail header. |
| A17 | `PredictionsBacktestTable` (dashboard widget) | `src/modules/dashboard/components/PredictionsBacktestTable.tsx` | `archive/dead-components-2026-10-01/dashboard/PredictionsBacktestTable.tsx` | 533 | Dead dashboard widget — backtest moved to `EGXBacktestDashboard` (`#backtesting`) + admin `BacktestTab`. |
| A18 | `SectorTrackingTab` (market-analysis tab) | `src/components/analysis/market-analysis/SectorTrackingTab.tsx` | `archive/wave-2-cleanup-2026-10-01/src/components/analysis/market-analysis/SectorTrackingTab.tsx` | (n/a) | Wave-2 cleanup — superseded by `src/modules/market-analysis/components/SectorTrackingTab.tsx` (relocated + refactored). |
| A19 | `NotificationBell` (notification component) | `src/components/notifications/NotificationBell.tsx` | `archive/wave-2-cleanup-2026-10-01/src/components/notifications/NotificationBell.tsx` | (n/a) | Wave-2 cleanup — replaced by `NotificationCenter.tsx` (live at `src/components/notifications/NotificationCenter.tsx`). |
| A20 | `FibonacciWidget` + `CandlestickWidget` (advanced-analysis widgets) | `src/components/advanced-analysis/{FibonacciWidget,CandlestickWidget}.tsx` | `archive/wave-2-cleanup-2026-10-01/src/components/advanced-analysis/` | (n/a) | Wave-2 cleanup — features merged into `SpecialistAnalysisView` section. |
| A21 | `RecommendationMonitoring` + `SocialPostView` + `PublishedPredictions` + `RecommendationHistory` | `src/components/recommendations/*.tsx` | `archive/wave-2-cleanup-2026-10-01/src/components/recommendations/` | (n/a) | Wave-2 cleanup — features merged into `UnifiedPublishButton` + `UserPublishingView` + `PredictionTrackingView`. |
| A22 | `Sniper/PerformanceTracker` + `Sniper/OpportunityCard` | `src/components/sniper/*.tsx` | `archive/wave-2-cleanup-2026-10-01/src/components/sniper/` | (n/a) | Wave-2 cleanup — Sniper merged into MarketAnalysisView persona tabs (see page.tsx line 237). |
| A23 | `SectorTreemapCard` + `SectorPieChart` (radar) | `src/modules/radar/components/{SectorTreemapCard,SectorPieChart}.tsx` | `archive/wave-2-cleanup-2026-10-01/src/modules/radar/components/` | (n/a) | Wave-2 cleanup — replaced by `MultiMarketRadarTab` unified visualization. |
| A24 | `UnifiedHoldingsTable` + `RiskManagementBar` + `PositionDeepDiveDrawer` (portfolio) | `src/modules/portfolio/components/{UnifiedHoldingsTable,RiskManagementBar,PositionDeepDiveDrawer}.tsx` | `archive/wave-2-cleanup-2026-10-01/src/modules/portfolio/components/` | (n/a) | Wave-2 cleanup — superseded by `EnhancedPortfolioView` internal tables + `StockDetailDrawer` (shared/ui). |
| A25 | 14× Admin sub-tabs (SectorClassificationAdmin, RowEditorModal, DataEngineTab, ForexTab, live-chart/index, CryptoPredictionGenerator, OptimizerParamsPanel, CryptoAdminPanel, SystemTopologyGraph, NotebookAdminTab, SystemTopologyTab, GoldSilverTab, AdGeneratorTab, MultiMarketTab) | `src/modules/admin/components/*.tsx` | `archive/wave-2-cleanup-2026-10-01/src/modules/admin/components/` | (n/a each) | Wave-2 cleanup — admin tab consolidation. Live AdminView now hosts consolidated tabs (`MarketingHub`, `MarketingStudio`, `ContentStudioHub`, `DatabaseManagerFull`, `SystemControlPanel`, `EngineControlRoomTab`, etc.). |
| A26 | `UpsellToasts` (subscription) | `src/modules/subscription/components/UpsellToasts.tsx` | `archive/wave-2-cleanup-2026-10-01/src/modules/subscription/components/UpsellToasts.tsx` | (n/a) | Wave-2 cleanup — superseded by `TrialCountdownBanner` + `TrialExpiredModal`. |
| A27 | `portfolio/WealthCharts.tsx` (duplicate of admin/WealthCharts.tsx) | `src/modules/portfolio/components/WealthCharts.tsx` (renamed to `.DEPRECATED.tsx` then archived) | `archive/wave-2-cleanup-2026-10-01/src/modules/portfolio/components/...` (per `SKIPPED_NOT_DEDUPLICATED.md`) | 346 | Phase 5 §5.3 — duplicate of `src/modules/admin/components/WealthCharts.tsx` (465 LOC). admin version is the live one imported by `page.tsx` `#wealth`. |

### 2.3 Garage (per `archive/garage/INDEX.md`)

> **الـ Garage مخصص للـ ORPHAN library/hook files (مش شاشات).** كل ملف هنا هو library / hook / data module (مش view component بـ case في `renderView()`). Per Rule 16 (VERIFY-BEFORE-DELETE) — archived, NOT deleted.

| # | الملف الأصلي | مكان الأرشفة | LOC | السبب |
|---|---|---|---|---|
| G1 | `vps-service/scripts/seed_official_stocks.py` | `archive/garage/seed_official_stocks.py` | — | BUG: ticker = Arabic name (مخالف لـ canonical = English uppercase). DATA-ENGINE-UNIFY-1 Stage 1.1. (2026-10-19) |
| G2 | `vps-service/scripts/seed_egx_stocks.py` | `archive/garage/seed_egx_stocks.py` | — | Direct write to stocks.db (مخالف لـ canonical flow). DATA-ENGINE-UNIFY-1 Stage 1.1. (2026-10-19) |
| G3 | `vps-service/scripts/seed_multi_market_stocks.py` | `archive/garage/seed_multi_market_stocks.py` | — | Same as G2 — multi-market variant. DATA-ENGINE-UNIFY-1 Stage 1.1. (2026-10-19) |
| G4 | `data_engine/scrapers/egxpilot_scraper.py` | `archive/garage/egxpilot_scraper.py` | — | DEPRECATED in `fallback_chain.py`. Data source dead. DATA-ENGINE-UNIFY-1 Stage 1.2. (2026-10-19) |
| G5 | `data_engine/scrapers/yahoo_scraper.py` | `archive/garage/yahoo_scraper.py` | — | DEPRECATED in `fallback_chain.py`. Returns stale data. DATA-ENGINE-UNIFY-1 Stage 1.2. (2026-10-19) |
| G6 | `src/hooks/useSmartChart.ts` | `archive/garage/src-hooks/useSmartChart.ts` | 280 | ORPHAN — chart hook, 0 live imports. ENGINEERING-CLEANUP. (2026-10-19) |
| G7 | `src/hooks/use-previous-value.ts` | `archive/garage/src-hooks/use-previous-value.ts` | 51 | ORPHAN — experimental hook. (2026-10-19) |
| G8 | `src/hooks/use-persona-results.ts` | `archive/garage/src-hooks/use-persona-results.ts` | 118 | ORPHAN — old persona results hook. (2026-10-19) |
| G9 | `src/hooks/useSignalNotifications.ts` | `archive/garage/src-hooks/useSignalNotifications.ts` | 182 | ORPHAN — old signal notifications hook. (2026-10-19) |
| G10 | `src/data/crypto-learning-content.ts` | `archive/garage/src-data/crypto-learning-content.ts` | 612 | ORPHAN — old crypto learning content. (2026-10-19) |
| G11 | `src/lib/unified-db.ts` | `archive/garage/src-lib/unified-db.ts` | 487 | ORPHAN — superseded by `api-client`. (2026-10-19) |
| G12 | `src/lib/external-data-fetcher.ts` | `archive/garage/src-lib/external-data-fetcher.ts` | 329 | ORPHAN. (2026-10-19) |
| G13 | `src/lib/community-db.ts` | `archive/garage/src-lib/community-db.ts` | 90 | ORPHAN. (2026-10-19) |
| G14 | `src/lib/crypto-learning-store.ts` | `archive/garage/src-lib/crypto-learning-store.ts` | 385 | ORPHAN. (2026-10-19) |
| G15 | `src/lib/new-db-queries.ts` | `archive/garage/src-lib/new-db-queries.ts` | 346 | ORPHAN. (2026-10-19) |
| G16 | `src/lib/vps-client.ts` | `archive/garage/src-lib/vps-client.ts` | 656 | ORPHAN. (2026-10-19) |
| G17 | `src/lib/m2ySyncClient.ts` | `archive/garage/src-lib/m2ySyncClient.ts` | 80 | ORPHAN. (2026-10-19) |
| G18 | `src/lib/chart-generator.ts` | `archive/garage/src-lib/chart-generator.ts` | 360 | ORPHAN. (2026-10-19) |
| G19 | `src/lib/engine-control-store.ts` | `archive/garage/src-lib/engine-control-store.ts` | 300 | ORPHAN. (2026-10-19) |
| — | ~~`src/modules/personalized/lib/personalized-radar.ts`~~ | ~~`archive/garage/src-modules/personalized-radar.ts`~~ | — | **REVIVED** (2026-10-19) — had 4 live imports. Returned to `src/modules/personalized/lib/`. |

### 2.4 Engines archived (per `archive/engines/`)

| # | الملف الأصلي | مكان الأرشفة | السبب |
|---|---|---|---|
| E1 | `vps-service/analyzers/v4_predictive_detector.py` | `archive/engines/v4_predictive_detector.py` | 1 legacy backtest importer (no cron). ✅ ARCHIVED. |
| E2 | `vps-service/analyzers/unified_analyzer.py` | `archive/engines/unified_analyzer.py` | 0 importers (only path-string refs). ✅ ARCHIVED. |
| E3 | `_legacy_stage2_final_report.py` + `_legacy_stage2_v4_maestro_integration.py` | `archive/engines/` | Legacy stage-2 maestro integration reports. ✅ ARCHIVED. |
| E4 | `cache_orphaned.py` | `archive/engines/cache_orphaned.py` | Orphaned cache utility. ✅ ARCHIVED. |
| — | `v73_sniper.py`, `v76_golden_hunter.py`, `fusion_engine.py` | (NOT archived) | ⏭️ SKIPPED per `SKIPPED_NOT_ARCHIVED.md` — V40.2 (canonical) actively imports them. (Rule 21) |

---

## الباب 3: شاشات بدون route (Hidden / Admin / Composed)

| # | الاسم | المسار | الملف | LOC | ملاحظات |
|---|---|---|---|---|---|
| H1 | `MarketDepthMultiMarket` (sub-widget of `#market-depth`) | rendered inline in `page.tsx` line 669 | `src/modules/dashboard/components/MultiMarketWidget.tsx` | 610 | Composed inline — not its own case in switch. |
| H2 | `MarketDepthInvestorsFlow` (sub-widget of `#market-depth`) | rendered inline in `page.tsx` line 677 | `src/modules/dashboard/components/InvestorsFlowPanel.tsx` | 557 | Composed inline — EGX only. |
| H3 | `DevLoginForm` (developer-only auth) | `?dev=1` URL param | `src/modules/auth/components/DevLoginForm.tsx` | (n/a) | Triggered by URL param `?dev=1` (page.tsx line 814-818). Not a hash route. |
| H4 | `GuestLockedView` (placeholder for guest users) | rendered when `isGuest && !isViewAllowedForGuest(currentView)` (page.tsx line 555) | (in-page component) | ~5 | Guest Mode placeholder (RESTRUCT-A-P3). |
| H5 | `AuthGate` route guard wrapper | wraps `renderView()` (page.tsx line 846+ comment) | `src/components/auth/AuthGate.tsx` | (n/a) | Route guard, not a view. |
| H6 | `PaywallListener` | mounted in AppShell | `src/components/auth/PaywallListener.tsx` | (n/a) | Subscription enforcement listener. |
| H7 | `RealtimeTicker` (top scrolling ticker) | mounted in AppShell | `src/modules/dashboard/components/RealtimeTicker.tsx` | (n/a) | Always-visible ticker, not a view. |
| H8 | `CentralAlertMonitor` + `RoboNotifierToggle` + `DesktopNotificationPrompt` | mounted in AppShell | `src/components/notifications/*` | (n/a) | Background notification components. |
| H9 | `TrialExpiredModal` + `TrialCountdownBanner` | mounted in AppShell | `src/modules/subscription/components/*` | (n/a) | Subscription trial UI overlays. |
| H10 | `PlatformGuide` (onboarding overlay) | mounted in AppShell via `usePlatformGuide()` | `src/components/help/PlatformGuide.tsx` | (n/a) | Onboarding guide overlay. |
| H11 | `Footer` | mounted in AppShell + standalone market-depth view | `src/components/layout/Footer.tsx` | (n/a) | Layout chrome. |
| H12 | `Header` | mounted standalone for `#market-depth` (page.tsx line 661) | `src/components/layout/Header.tsx` | (n/a) | Page header for composed view. |
| H13 | `MobileNav` (bottom 5-icon bar) | always mounted in AppShell | `src/components/layout/MobileNav.tsx` | 86 | 5 items: dashboard / stocks / recommendations / portfolio / liquidity-radar. |
| H14 | `TopBar` (5-portal top nav) | always mounted in AppShell | `src/components/layout/TopBar.tsx` | 537 | Desktop top nav with 5 sections + market switcher + theme + language + notifications + user menu. |
| H15 | `MobileMoreSheet` ("More" sheet on mobile) | triggered from mobile header | `src/components/layout/MobileMoreSheet.tsx` | 242 | 6 extra items: bagholder-rescue, watchlist, sharia, simulation, academy, about + search + notifications + settings + account. |
| H16 | `ErrorBoundary` (wraps every dynamic view) | wraps every view via `withErrorBoundary()` | `src/components/shared/ErrorBoundary.tsx` | (n/a) | Per-view isolated error boundaries (Phase 4 Task 3). |
| H17 | `LazyTabLoader` (loading skeleton) | shown while dynamic chunks download | `src/components/shared/LazyTabLoader.tsx` | (n/a) | Skeleton for view chunk load (Phase 3). |
| H18 | `SafeWidget` (per-widget error isolation) | wraps dashboard widgets + market-depth widgets | `src/modules/dashboard/components/SafeWidget.tsx` | (n/a) | Per-widget error isolation. |

### 3.1 Next.js routes outside the hash router (separate physical pages)

| # | Route | الملف | LOC | ملاحظات |
|---|---|---|---|---|
| P1 | `/rescue` | `src/app/rescue/page.tsx` | 407 | ALPHA-P0 standalone rescue clinic page (also accessible via `#rescue` hash inside AppShell — see #41). |
| P2 | `/admin` | `src/app/admin/page.tsx` | (n/a) | Separate Next.js admin route (legacy / unauthenticated path). |
| P3 | `/admin/reports` | `src/app/admin/reports/page.tsx` | (n/a) | Separate admin reports page. |
| P4 | `/admin/educational-cards` | `src/app/admin/educational-cards/page.tsx` | (n/a) | Educational cards admin. |
| P5 | `/admin/honest-predictions` | `src/app/admin/honest-predictions/page.tsx` | (n/a) | Honest predictions admin. |
| P6 | `/backtest` | `src/app/backtest/page.tsx` | (n/a) | Standalone backtest runner page (separate from `#backtesting` view). |
| P7 | `/payment/success` | `src/app/payment/success/page.tsx` | (n/a) | Paymob payment success redirect target. |
| P8 | `/legal/privacy` | `src/app/legal/privacy/page.tsx` | (n/a) | Privacy policy page. |
| P9 | `/legal/terms` | `src/app/legal/terms/page.tsx` | (n/a) | Terms of service page. |
| P10 | `/legal/disclaimer` | `src/app/legal/disclaimer/page.tsx` | (n/a) | Disclaimer page. |

---

## الباب 4: إحصائيات

### 4.1 Live views (in `renderView()` switch)

| Metric | Value |
|---|---|
| **Total `case` branches in `renderView()`** | 55 (incl. aliased/redirect cases) |
| **Distinct rendered components** | 40 (after deduplication — many aliases share one component) |
| **Unique top-level user-facing views** (canonical, non-redirect) | 28 unique screens |
| **Crypto redirects (UI-Mirror Protocol)** | 11 (`#crypto`, `#crypto-live`, `#crypto-watchlist`, `#crypto-recommendations`, `#crypto-analysis`, `#crypto-learning`, `#crypto-simulation`, `#crypto-trading-chart`, `#crypto-screener`, `#crypto-portfolio` (unique), `#crypto-prediction-tracking` (unique)) |
| **Backward-compat hash redirects** | 4 (`#top-performers`→tab, `#advanced-analysis`→recommendations, `#v2-analysis`→recommendations, `#picks-management`→prediction-tracking) |
| **Admin-only placeholders** | 2 (`#prediction-performance`, `#prediction-credibility`) |
| **Total LOC of all 40 live view components** | 41,342 |

### 4.2 Distribution by portal

| Portal | Live views | LOC sum |
|---|---|---|
| 🏠 الرئيسية (Dashboard) | 1 (DashboardView) | 590 |
| 📊 السوق (Market) | 6 (#stocks, #stock-filters, #top-performers, #screener/#trading-chart, #liquidity-radar, #market-depth) | 590 + 2319 + 2723 + 309 + 657 + (inline ~1167) = 7,765 |
| 🎯 التوصيات (Recommendations/Analysis) | 11 (#recommendations, #dual-track, #prediction-tracking, #unified-analysis, #specialist-analysis, #advanced-analysis, #prediction-performance, #v82, #reports, #smart-confluence, #seasonality) | 9,056 |
| 💼 محفظتي (Portfolio) | 10 (#portfolio, #watchlist, #bagholder-rescue, #advanced-portfolio, #alerts-center, #live-monitor, #wealth, #trading-memory, #trading-journal, #publishing) | 9,957 |
| ☰ المزيد (More) | 13 (#news, #simulation, #academy, #zakat, #tithes, #sharia, #subscription, #settings, #auth, #admin, #about, #backtesting, #rescue) | 11,527 |
| 🪙 Crypto (mostly redirects to other portals' components + 2 unique) | 11 | (mostly aliases — only CryptoPortfolioView 641 + CryptoPredictionTrackingView 478 = 1,119 unique) |

### 4.3 Archived inventory

| Bucket | Files | LOC (top-level screens only) |
|---|---|---|
| `archive/dead-components-2026-10-08/` (P1-CLEANUP) | 10 files (5 crypto + 2 admin + 1 market-analysis + 1 stock-analysis + 1 dashboard) | 3,393 |
| `archive/wave-2-cleanup-2026-10-01/src/{components,modules}/` | 25+ component files (admin tabs, portfolio widgets, sniper components, devil panel, AI view, advanced-analysis widgets, notifications bell, recommendation components, radar treemap/pie, PicksManagementView, UpsellToasts) | (mixed — total ~5,000+) |
| `archive/education-duplicate-2026-10-01/` | 3 files (LearningView + learning-content.ts + learning-store.ts) | 1,063 + (content/store n/a) |
| `archive/simulation-crypto-duplicate-2026-10-01/` | 2 files (CryptoSimulationView + README) | 1,955 |
| `archive/chatbot-popup-2026-10-01/` | 3 files (FloatingAssistant + AIAssistantChat + index) | 636 |
| `archive/devil-feature-2026-10-01/` | 18 files (4 view components + 8 TS engines + 4 API routes + types + filter) | 875 (view components only) |
| `archive/garage/` (per INDEX.md) | 19 library/hook/data files | ~3,500 (sum of LOC noted in INDEX) |
| `archive/engines/` | 5 Python engine files (2 archived + 2 legacy stage2 + 1 orphan cache) | 1,447 (per SKIPPED_NOT_ARCHIVED.md) |
| **TOTAL ARCHIVED SCREENS** | **12 top-level screen views + 1 admin aggregate + ~25 sub-views/widgets** | **~13,000+ LOC removed from active code path** |

### 4.4 Unified component library adoption (BLUEPRINT Phase 1)

The unified library is at `src/components/shared/ui/index.ts` and exports **10 components**:
`PriceDisplay`, `SignalBadge`, `RiskRewardBadge`, `FlowPhaseTag`, `UnifiedEmptyState`, `FilterDrawer`, `StockDetailDrawer`, `ActionMenu`, `DeltaBadge`, `LiquidityFlashCell`.

| Metric | Value |
|---|---|
| Views importing from `@/components/shared/ui/*` | **2 of 40** — `LiquidityRadarView` + `MarketAnalysisView` only |
| Views importing from `@/components/shared/*` (broader shared: `UnifiedTable`, `FlashingPriceCell`, `FlashingChangeCell`, `PredictionCard`, `StockSearchSelector`, `MarketSelector`, `LazyTabLoader`, `ErrorBoundary`, `LiquidityRadarView`) | **~17 of 40** (StocksView, StockScreenerAdvanced, TradingChartView, EnhancedWatchlistView, MarketAnalysisView, PredictionTrackingView, DualTrackPredictionsView, SimulationView, AdminView, EnhancedPortfolioView, LiquidityRadarView, LiveMonitor, InvestorsFlowPanel, LiquidityFlowPanel, CryptoPredictionTrackingView, MakerRadarTab, etc.) |
| Views with **ad-hoc patterns** (no shared/ui + no shared/* imports) | **~21 of 40** — DashboardView, UnifiedAnalysisView, SpecialistAnalysisView, V82DecisionPanel, ReportsView, NewsFeedView, AcademyView, BagHolderRescuePanel, AdvancedPortfolioManager, SeasonalityDashboard, SmartConfluenceView, AlertsCenterView, WealthCharts, TradingMemoryView, TradingJournalView, UserPublishingView, CryptoPortfolioView, ZakatView, TithesView, ShariaView, SubscriptionView, SettingsView, AuthView, AboutView, EGXBacktestDashboard, RescuePage |

### 4.5 Heavy views (top 10 by LOC)

| Rank | View | LOC |
|---|---|---|
| 1 | `EnhancedPortfolioView` (#portfolio) | 3,369 |
| 2 | `StockScreenerAdvanced` (#stock-filters + #crypto-screener) | 2,723 |
| 3 | `SpecialistAnalysisView` (#specialist-analysis) | 2,916 |
| 4 | `AcademyView` (#academy + #crypto-learning) | 2,483 |
| 5 | `StocksView` (#stocks + #crypto-live) | 2,319 |
| 6 | `SimulationView` (#simulation + #crypto-simulation) | 2,130 |
| 7 | `AdminView` (#admin) | 2,083 |
| 8 | `SubscriptionView` (#subscription) | 1,791 |
| 9 | `ShariaView` (#sharia) | 1,490 |
| 10 | `LiveMonitor` (#live-monitor) | 1,357 |

---

## ملاحظات ختامية

1. **UI-Mirror Protocol**: الـ 11 route للكريبتو بـ reuse نفس الـ components بتاعة السوق العادي — الفرق الوحيد هو `currentMarket='CRYPTO'` في الـ store. ده بيخلّي الـ LOC للـ crypto = 1,119 (unique) بدل تكرار كامل.

2. **Rule 67 (backward-compat)**: 4 hash routes قديمة (`#top-performers`, `#advanced-analysis`, `#v2-analysis`, `#picks-management`) لسه شغّالة كـ redirects — متسجّلة في `VALID_VIEWS` وبتـ render الـ canonical component.

3. **Rule 4 (NO-NEW-SCREENS)**: الـ `market-depth` view بـ render شاشة composed inline في `page.tsx` (lines 656-698) بدل ما يتعمل ملف جديد — بتـ reuse `MultiMarketWidget` + `InvestorsFlowPanel` جوّه `SafeWidget` wrappers.

4. **Phase 4 Task 3 (per-view ErrorBoundary)**: كل dynamic-import view معمّى بـ `withErrorBoundary()` — عشان أي runtime error في view واحد ميبوظش الباقي. الـ `SafeWidget` بيعمل نفس الحاجة على مستوى الـ widget (داخل DashboardView + market-depth).

5. **Phase 3 (LazyTabLoader)**: كل heavy views بـ loading skeleton `بيتحمّل...` بدل blank screen أثناء تحميل الـ chunk (200-800ms).

6. **Unified library adoption ضعيف**: من 40 live views، **2 بس** بيستوردوا من `@/components/shared/ui/*` (الـ BLUEPRINT Phase 1 unified library). ده يعني الـ migration لـ unified components لسه في بدايته. باقي الـ views بتستعمل ad-hoc patterns أو `@/components/ui/*` (shadcn primitives).

7. **Sub-views غنية**: `AdminView` فيه 30+ sub-tab (أكبر تجمّع)، يليه `AcademyView` (8 tabs)، `StockScreenerAdvanced` (2 tabs)، `EnhancedPortfolioView` (5 tabs)، `MarketAnalysisView` (6 tabs)، `DualTrackPredictionsView` (3 tabs)، `BagHolderRescuePanel` (5 tabs).

8. **التغطية**: الفهرس ده بـ يغطّي كل `case` في الـ `renderView()` switch (55 case → 40 components → 28 unique canonical screens) + كل archived screens في `archive/` (12 top-level + ~25 sub-views + 19 garage library files + 5 engines).
