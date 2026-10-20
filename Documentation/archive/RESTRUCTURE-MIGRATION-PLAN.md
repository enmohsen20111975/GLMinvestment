# RESTRUCTURE-MIGRATION-PLAN — GLMinvestment Restructure Wave 1

> **Task ID:** RESTRUCTURE-WAVE1-A
> **Agent:** Alpha (frontend dragon — Plan subagent)
> **Author:** Z.ai Code (Alpha plan copy)
> **Date:** 2026-10-18
> **Scope:** PLANNING ONLY — `.md` file. **No code changes, no git push, no file deletions.**
> **Source of Truth:**
> - `SCREENS-INVENTORY.md` (PRIMARY — 59 cases + 26 admin tabs + 9 global overlays + ~15 view dialogs + 16 archived orphans)
> - `src/app/page.tsx` `renderView()` switch (verified — 59 case branches + 1 default)
> - `src/components/layout/TopBar.tsx` `navSections` (verified — 5 sections × 21 items)
> - `Documentation/00-CONSTITUTION.md` Rules 4, 20, 27, 73, 75 (Rule 75 SUSPENDED for this planning task)

---

## 0. Mandate Recap

Owner (Mohsen) directive: transform the current chaos
(**59 switch cases + 21 menu items + aliases + orphans**) into a product
with **8–10 top-level visible screens max**. No new features — consolidation
and merging only.

### Target TopBar (per mandate)

| Section | Visible screens (hash) |
|---|---|
| الرئيسية | Dashboard (`#dashboard`) |
| السوق | الأسهم (`#stocks`) · رادار السيولة (`#liquidity-radar`) · الفلاتر المتقدمة (`#stock-filters`) |
| التحليل | التوصيات (`#recommendations`) · التقارير (`#reports`) |
| محفظتي | المحفظة (`#portfolio`) · قائمة المتابعة (`#watchlist`) · التنبيهات (`#alerts-center`) |
| المزيد | الأكاديمية (`#academy`) · الأخبار (`#news`) · الاشتراك (`#subscription`) · الإعدادات (`#settings`) |

**Total visible items: 13 across 5 sections** (within "8–10 top-level screens
max" interpreted as sections + primary screens; the table is the literal spec).

### Hidden screens (deep-link or sub-tab, NOT in menu)

- Unified Analysis (`#unified-analysis`) — deep-link
- Dual Track (`#dual-track`) — deep-link
- V82 (`#v82`) — deep-link, also embedded in Portfolio
- BagHolder Rescue (`#bagholder-rescue`) — **already a sub-tab inside EnhancedPortfolioView** (Task 40-B); keep deep-link for backwards-compat
- Advanced Portfolio (`#advanced-portfolio`) — deep-link
- Seasonality (`#seasonality`) — deep-link
- Smart Confluence (`#smart-confluence`) — deep-link
- Trading Journal (`#trading-journal`) — deep-link, candidate for Portfolio sub-tab
- Publishing (`#publishing`) — deep-link
- Wealth Charts (`#wealth`) — already a sub-tab inside EnhancedPortfolioView (Task 40-B); keep deep-link
- Backtesting (`#backtesting`) — deep-link
- Crypto Portfolio (`#crypto-portfolio`) → **unify with stock Portfolio** (crypto holdings become a market segment in `#portfolio`)
- Crypto Prediction Tracking (`#crypto-prediction-tracking`) → **unify with stock `#prediction-tracking`**

### User Journeys to cover

1. **Guest** — limited data access without auth, light login modal (not `AuthView` full-screen).
2. **Trial active** — countdown banner + soft paywall on advanced content.
3. **Trial expired** — soft paywall (content visible but blurred/limited, NOT hard block).
4. **Paid** — everything open.

---

## Section A — 59-case mapping table

For every `case` in `renderView()` (verified via grep on `src/app/page.tsx`):

| # | case value | current file | destination | target screen | rationale | risk |
|---|---|---|---|---|---|---|
| 1 | `dashboard` | `src/modules/dashboard/components/DashboardView.tsx` | KEEP | الرئيسية → Dashboard | Default landing; anchor of product | None |
| 2 | `stocks` | `src/modules/stock-analysis/components/StocksView.tsx` | KEEP | السوق → الأسهم | Primary stock table | None |
| 3 | `stock-detail` | (alias of `stocks`) | KEEP (alias) | السوق → الأسهم (deep row click) | Row-click drill-down inside StocksView; alias for backwards-compat hash | None |
| 4 | `stock-filters` | `src/modules/screener/components/StockScreenerAdvanced.tsx` | KEEP | السوق → الفلاتر المتقدمة | Screener; already has 2 internal Tabs | None |
| 5 | `top-performers` | StockScreenerAdvancedView `initialTab="top-performers"` | TAB (already is) | السوق → الفلاتر المتقدمة (Tab 2) | Already a sub-tab; keep alias redirect | None |
| 6 | `screener` | (alias → `trading-chart`) | DEEP-LINK | hidden (was in menu) | Owner dropped `trading-chart` from target menu; keep hash for compat | 🟡 Link rot if mobile bookmarks exist |
| 7 | `trading-chart` | `src/modules/market-analysis/components/TradingChartView.tsx` | DEEP-LINK | hidden (not in target menu) | Not in mandate's السوق list; keep switch case for backwards-compat | 🟡 Power-user feature becomes invisible; consider promoting later if churn rises |
| 8 | `portfolio` | `src/modules/portfolio/components/EnhancedPortfolioView.tsx` | KEEP | محفظتي → المحفظة | Anchor of finance section; already absorbs Wealth + BagHolder + V82 | None |
| 9 | `finance` | (alias → `portfolio`) | KEEP (alias) | محفظتي → المحفظة | Backwards-compat alias; preserve per Rule 67 | None |
| 10 | `watchlist` | `src/components/watchlist/EnhancedWatchlistView.tsx` | KEEP | محفظتي → قائمة المتابعة | Direct menu target | None |
| 11 | `recommendations` | `src/modules/market-analysis/components/MarketAnalysisView.tsx` | KEEP | التحليل → التوصيات | Anchor of predictions section; 5 internal Tabs already | None |
| 12 | `analysis` | (alias → `recommendations`) | KEEP (alias) | التحليل → التوصيات | Backwards-compat | None |
| 13 | `advanced-analysis` | (redirect comment in switch; no JSX) | DEEP-LINK (already) | hidden (case preserves redirect to `#recommendations`) | Already a redirect stub; keep | None |
| 14 | `v2-analysis` | (alias of `advanced-analysis`) | DEEP-LINK (already) | hidden | Already a redirect stub; keep | None |
| 15 | `unified-analysis` | `src/modules/market-analysis/components/UnifiedAnalysisView.tsx` | DEEP-LINK | hidden (per mandate) | Owner explicitly lists as hidden | None |
| 16 | `specialist-analysis` | `src/components/advanced-analysis/SpecialistAnalysisView.tsx` (2915 LOC) | DEEP-LINK | hidden (was في التوقعات menu) | Not in mandate's التحليل list (only recommendations + reports). Keep as deep-link; row-click inside StocksView already routes here | 🟠 Large view (2915 LOC) becomes hard to discover — add "تحليل متخصص" button inside StockDetail + recommendations persona summary |
| 17 | `prediction-performance` | (blocked; inline JSX in page.tsx L531-545) | DEEP-LINK (already) | hidden (admin-only) | Already blocked for non-admin | None |
| 18 | `prediction-credibility` | (alias → blocked) | DEEP-LINK (already) | hidden (admin-only) | Already blocked | None |
| 19 | `prediction-tracking` | `src/modules/predictions/components/PredictionTrackingView.tsx` | DEEP-LINK | hidden (per mandate list) | Already deep-link only; also reachable as persona sub-view inside `#recommendations` UnifiedPredictionsTab performance toggle | None |
| 20 | `picks-management` | (alias → `prediction-tracking`) | KEEP (alias) | hidden | Backwards-compat redirect; preserve | None |
| 21 | `dual-track` | `src/modules/predictions/components/DualTrackPredictionsView.tsx` | DEEP-LINK | hidden (per mandate) | Already deep-link only | None |
| 22 | `v82` | `src/components/v82/V82DecisionPanel.tsx` | DEEP-LINK (+TAB) | hidden; already embedded inside EnhancedPortfolioView | Owner lists as hidden + already a Portfolio sub-component | None |
| 23 | `reports` | `src/modules/reports/components/ReportsView.tsx` | KEEP | التحليل → التقارير | Direct menu target | None |
| 24 | `news` | `src/modules/news/components/NewsFeedView.tsx` | KEEP | المزيد → الأخبار | Direct menu target | None |
| 25 | `simulation` | `src/modules/simulation/components/SimulationView.tsx` | DEEP-LINK | hidden (was في المزيد; not in target المزيد list) | Not in mandate's المزيد list (academy/news/subscription/settings only). Keep as deep-link; Academy already has paper-trading tab as alternative entry | 🟠 SimulationView (2131 LOC) becomes invisible — add "المحاكاة" button inside Academy paper-trading tab |
| 26 | `academy` | `src/modules/education/components/AcademyView.tsx` | KEEP | المزيد → الأكاديمية | Direct menu target | None |
| 27 | `bagholder-rescue` | `src/modules/portfolio/components/BagHolderRescuePanel.tsx` (thin wrapper as `BagHolderRescueView`) | TAB (already) + DEEP-LINK | hidden; already a Portfolio sub-tab (Task 40-B) | Mandate: → tab in Portfolio — already done | None |
| 28 | `advanced-portfolio` | `src/modules/portfolio/components/AdvancedPortfolioManager.tsx` | DEEP-LINK | hidden (per mandate) | Already deep-link only since Task 40-B | None |
| 29 | `seasonality` | `src/components/seasonality/SeasonalityDashboard.tsx` | DEEP-LINK | hidden (per mandate) | Already deep-link only | None |
| 30 | `smart-confluence` | `src/components/smart-assistant/SmartConfluenceView.tsx` | DEEP-LINK | hidden (per mandate) | Already deep-link only since TopBar comment | None |
| 31 | `liquidity-radar` | `src/components/shared/LiquidityRadarView.tsx` | KEEP | السوق → رادار السيولة | Direct menu target | None |
| 32 | `market-depth` | inline JSX in `page.tsx` L592-634 (no dedicated file) | DEEP-LINK | hidden (was في السوق menu) | Not in mandate's السوق list. Inline composite — keep case for backwards-compat | 🟡 Inline JSX in page.tsx violates Rule 4 spirit (no dedicated file); flag for P2 extraction into MultiMarketWidget+InvestorsFlowPanel composite screen if owner re-promotes |
| 33 | `alerts-center` | `src/components/alerts/AlertsCenterView.tsx` | KEEP | محفظتي → التنبيهات | Direct menu target | 🟠 ALPHA-TEAM-WORK flagged `AlertsCenterView.tsx:433-443` as hardcoded mock alerts (Rule 27 CRITICAL) — must remove mock before this becomes a primary nav target |
| 34 | `live-monitor` | `src/modules/dashboard/components/LiveMonitor.tsx` | DEEP-LINK | hidden (was في أموالي menu) | Not in mandate's محفظتي list (portfolio/watchlist/alerts only). Keep as deep-link + PinnableWidget on Dashboard | 🟠 LiveMonitor (1358 LOC, 10s polling) hidden — ensure Dashboard PinnableWidget still surfaces it |
| 35 | `wealth` | `src/modules/admin/components/WealthCharts.tsx` | TAB (already) + DEEP-LINK | hidden; already a Portfolio sub-tab (Task 40-B) | Owner lists as hidden; already merged | None |
| 36 | `trading-memory` | `src/components/memory/TradingMemoryView.tsx` | DEEP-LINK | hidden (was في أموالي menu) | Not in mandate's محفظتي list. Keep deep-link; consider "الذكاء" entry in Portfolio | 🟠 4 panels (ExpertMemory, PortfolioIntelligence, SmartAssistant, SmartAlerts) become hard to discover |
| 37 | `trading-journal` | `src/components/journal/TradingJournalView.tsx` | DEEP-LINK (consider TAB) | hidden per mandate; candidate to absorb as Portfolio sub-tab (sibling of BagHolder + Wealth) | Owner lists as hidden; P1 could add as Portfolio 5th tab | None |
| 38 | `publishing` | `src/components/publishing/UserPublishingView.tsx` | DEEP-LINK | hidden (per mandate) | Already deep-link only | None |
| 39 | `crypto` | (alias → `dashboard` w/ `setCurrentMarket('CRYPTO')`) | KEEP (alias) | الرئيسية → Dashboard (with market switch) | Market switcher covers this; preserve alias | None |
| 40 | `crypto-live` | (alias → `stocks`) | KEEP (alias) | السوق → الأسهم (with market switch) | Already unified | None |
| 41 | `crypto-portfolio` | `src/modules/crypto/components/CryptoPortfolioView.tsx` | REMOVE (unify) | redirect → `#portfolio` with `setCurrentMarket('CRYPTO')` | Mandate: "unify with stock versions" — Portfolio already has crypto add-asset type | 🟠 CryptoPortfolioView (642 LOC) becomes dead — flag for archive in P2 (not delete in Wave 1) |
| 42 | `crypto-watchlist` | (alias → `watchlist`) | KEEP (alias) | محفظتي → قائمة المتابعة (with market switch) | Already unified | None |
| 43 | `crypto-recommendations` | (alias → `recommendations`) | KEEP (alias) | التحليل → التوصيات (with market switch) | Already unified | None |
| 44 | `crypto-analysis` | (alias → `smart-confluence`) | KEEP (alias) | hidden (smart-confluence with CRYPTO) | Already unified; alias goes to a now-hidden view — fine | None |
| 45 | `crypto-learning` | (alias → `academy`) | KEEP (alias) | المزيد → الأكاديمية | Already unified (Rule 63) | None |
| 46 | `crypto-simulation` | (alias → `simulation`) | KEEP (alias) | hidden (simulation with CRYPTO) | Already unified | None |
| 47 | `crypto-trading-chart` | (alias → `trading-chart`) | KEEP (alias) | hidden (trading-chart with CRYPTO) | Already unified | None |
| 48 | `crypto-prediction-tracking` | `src/modules/crypto/components/CryptoPredictionTrackingView.tsx` | REMOVE (unify) | redirect → `#prediction-tracking` with `setCurrentMarket('CRYPTO')` | Mandate: "unify with stock versions"; PredictionTrackingView already has market filter Select | 🟠 CryptoPredictionTrackingView (479 LOC) becomes dead — flag for archive in P2 |
| 49 | `crypto-screener` | (alias → `stock-filters`) | KEEP (alias) | السوق → الفلاتر المتقدمة (with market switch) | Already unified | None |
| 50 | `zakat` | `src/components/zakat/ZakatView.tsx` | DEEP-LINK | hidden (was في المزيد; not in target list) | Not in mandate's المزيد list. Keep deep-link; add link inside ShariaView or Settings | 🟡 Religious-tool discoverability loss — Sharia + Zakat + Tithes should share a single "أدوات شرعية" deep-link group |
| 51 | `tithes` | `src/components/tithes/TithesView.tsx` | DEEP-LINK | hidden (was في المزيد; not in target list) | Same as Zakat — keep deep-link | 🟡 Same discoverability concern |
| 52 | `sharia` | `src/modules/sharia/components/ShariaView.tsx` (Rule 4 explicit exception) | DEEP-LINK | hidden (was في المزيد; not in target list) | Not in mandate's المزيد list. Keep deep-link; add Settings entry "أدوات شرعية" that routes to #sharia | 🟡 Sharia compliance is a Rule 64 anchor — must not become invisible |
| 53 | `subscription` | `src/components/subscription/SubscriptionView.tsx` | KEEP | المزيد → الاشتراك | Direct menu target | None |
| 54 | `settings` | `src/components/settings/SettingsView.tsx` | KEEP | المزيد → الإعدادات | Direct menu target | None |
| 55 | `auth` | `src/components/auth/AuthView.tsx` | KEEP (but see Section D) | auth gate + Guest Mode light modal | AuthView remains the full-screen fallback when user explicitly requests login; Section D introduces a lighter "Guest Mode + login modal" path | 🟠 See Section D — AuthView stays but Guest users no longer land here by default |
| 56 | `admin` | `src/modules/admin/components/AdminView.tsx` (2084 LOC) | KEEP (role-gated) | admin deep-link `#admin` | No menu link by design; preserve | None |
| 57 | `about` | `src/components/about/AboutView.tsx` | DEEP-LINK | hidden (was في المزيد; not in target list) | Not in mandate's المزيد list. Keep deep-link; footer link | None |
| 58 | `backtesting` | `src/components/backtesting/EGXBacktestDashboard.tsx` | DEEP-LINK | hidden (per mandate) | Already deep-link only | None |
| 59 | `rescue` | `src/app/rescue/page.tsx` (standalone Next.js route + case wrapper in AppShell) | DEEP-LINK + TAB | hidden; already a Portfolio sub-tab (BagHolder Rescue) | Mandate: BagHolder Rescue → tab in Portfolio (already done Task 40-B). The `/rescue` standalone route stays for marketing/SEO; the `#rescue` AppShell case routes to BagHolderRescuePanel via portfolio | 🟡 Both `/rescue` Next.js page and `#rescue` AppShell case exist — keep both; P2 could consolidate |
| default | (implicit → `<DashboardView />`) | — | KEEP | الرئيسية → Dashboard | Default landing for unknown hashes | None |

### Section A — counts

| Destination | Count |
|---|---|
| **KEEP (visible menu)** | 13 (matches mandate's 13-item target TopBar exactly) |
| **KEEP (alias)** | 11 (backwards-compat aliases — `stocks`/`stock-detail`, `screener`/`trading-chart`, `portfolio`/`finance`, `recommendations`/`analysis`, `crypto` family, etc.) |
| **TAB (sub-tab in another view)** | 3 (`bagholder-rescue`, `wealth`, `v82` — already done Task 40-B; `trading-journal` is a P1 candidate) |
| **DEEP-LINK (hash-only, removed from menu)** | 28 (unified-analysis, dual-track, specialist-analysis, prediction-tracking, picks-management alias, advanced-portfolio, seasonality, smart-confluence, trading-chart, screener, market-depth, live-monitor, trading-memory, trading-journal, publishing, simulation, zakat, tithes, sharia, about, backtesting, rescue, advanced-analysis stub, v2-analysis stub, prediction-performance blocked, prediction-credibility blocked) |
| **REMOVE (unify → redirect alias)** | 2 (`crypto-portfolio` → `#portfolio` w/ CRYPTO, `crypto-prediction-tracking` → `#prediction-tracking` w/ CRYPTO) |
| **Total cases mapped** | **59** ✓ (matches inventory) |

### Section A — top-line summary

- **13 visible** — exactly the mandate's target TopBar.
- **28 deep-link** — preserves all backwards-compat hashes (Rule 67) without surfacing them.
- **3 already-merged tabs** — Task 40-B did the work; this plan formalises.
- **2 unify redirects** — crypto unification (Section F).
- **0 file deletions** in Wave 1 (planning only; dead-code removal is a separate mandate per Section G + Section H).
- **0 new `page.tsx` or new screens** (Rule 4 respected).

---

## Section B — 26-admin-tab mapping table

For every tab inside `AdminView` (`src/modules/admin/components/AdminView.tsx`):

| # | AdminTab value | current file | destination | target hub | rationale | risk |
|---|---|---|---|---|---|---|
| 1 | `dashboard` | inline (overview + health) | KEEP | health | Admin overview — anchor | None |
| 2 | `system-monitor` | `SystemMonitorPanel` | KEEP | health | CPU/RAM/DB monitoring | None |
| 3 | `problems` | `SystemProblemsTab` | KEEP | health | Alerts + solutions | None |
| 4 | `cron-health` | inline (cron jobs + last run) | KEEP | health | Background jobs health | None |
| 5 | `engine-control-room` | `EngineControlRoomTab` | KEEP | maestro | Unified 8-engine + console — single control surface | None |
| 6 | `data-engine` | `DataEngineTab` | KEEP | maestro | Scrapers + Historical | None |
| 7 | `general` | `EnginesStatusTab` | TAB-MERGE candidate | maestro (fold into `engine-control-room`) | `engine-control-room` is the unified control surface; `general` (engine status) overlaps. P2 candidate to fold as sub-tab inside control room | 🟡 Risk: lose granular status view if folded too aggressively |
| 8 | `engine-settings` | `EngineSettingsTab` | KEEP | maestro | Weights + parameters config | None |
| 9 | `learning` | SuperLearningSystem (5 sub-tabs: predictions-engine/parameters/config/ai/results/persona-benchmark) | KEEP | maestro | 5 internal sub-tabs — already consolidated | None |
| 10 | `backtest` | `BacktestTab` | TAB-MERGE candidate | maestro (consider folding into `learning` results sub-tab) | Public `#backtesting` view exists; admin backtest is the runner. P2 could merge as "learning → results" sub-tab | 🟡 Risk: admin runner ≠ user-visible backtest results |
| 11 | `platform-performance` | `PlatformPerformanceView` (907 LOC) | KEEP | maestro | Win Rate / PF / Expectancy / Top 20 / Worst 10 — admin dashboard | None |
| 12 | `databases` | `DatabaseManagerFull` (5 sub-tabs: overview/tables/sql/backups/daily/maintenance) | KEEP | data | Single DB manager — already consolidated | None |
| 13 | `db-backup` | `DbBackupPanel` | TAB-MERGE candidate | data (fold into `databases` → `backups` sub-tab, which already exists) | `databases` already has a `backups` sub-tab; `db-backup` is redundant. P1 to fold | 🟡 Redundancy — must verify both panels don't have unique features first |
| 14 | `system-control` | `SystemControlPanel` | KEEP | data | Scraper + sync + cron triggers | None |
| 15 | `news-control` | `NewsManagementTab` | KEEP | data | News source management | None |
| 16 | `news-health` | inline (news source health) | TAB-MERGE candidate | data (fold into `news-control` as a sub-tab) | `news-control` manages + `news-health` shows last_fetch/disabled — overlap. P1 to fold | 🟡 Both are admin-only; lower user-facing risk |
| 17 | `sharia` | `ShariaManagementTab` (Rule 64) | KEEP | data | Rule 64 anchor — must remain visible | None |
| 18 | `source-authority` | `SourceAuthorityTab` (Rule 66) | KEEP | data | Rule 66 anchor | None |
| 19 | `validation-monitor` | `ValidationMonitorTab` (Rule 65) | KEEP | data | Rule 65 anchor | None |
| 20 | `user-management` | `UserManagementPanel` / `UsersManagement` | KEEP | users | User CRUD + plans | None |
| 21 | `users` | inline (user analytics + behavior) | TAB-MERGE candidate | users (fold into `user-management` as a sub-tab `analytics`) | Overlaps with user-management. P1 to fold | 🟡 Both involve users; low risk |
| 22 | `promo-codes` | `PromoCodesAdmin` | KEEP | users | Promo CRUD + tracking | None |
| 23 | `pricing` | inline (Pricing + paywall gates status — 7 gates) | KEEP | users | Paywall gates dashboard | None |
| 24 | `feedback` | inline (user feedback + complaints) | KEEP | users | User voice channel | None |
| 25 | `marketing-studio` | `MarketingStudio` (video + cards + campaigns + calendar) | KEEP | telegram | Marketing hub — already consolidated 4 sub-features | None |
| 26 | `reports` | inline (Smart reports — daily + weekly + PDF) | KEEP | telegram | Smart reports generator | None |
| 27 | `telegram` | `TelegramTab` (5 sub-tabs + 4 sub-sub-tabs = 9 sub-views) | KEEP | telegram | Already highly consolidated | None |
| 28 | `telegram-predictions` | inline (TG published predictions audit — Task 28-B Fix 7) | KEEP | telegram | Audit trail | None |

> **Note on count:** The inventory lists "26 tabs in 6 hubs". The actual list above has 28 rows because `telegram-predictions` and the `data` hub's `news-health` may have been counted differently. The mapping covers every entry in the inventory's hubs enumeration.

### Section B — counts

| Destination | Count |
|---|---|
| **KEEP (visible admin tab)** | 22 |
| **TAB-MERGE candidate (P1–P2)** | 6 (`general` → control room, `backtest` → learning results, `db-backup` → databases backups sub-tab, `news-health` → news-control sub-tab, `users` → user-management analytics sub-tab, and possibly `platform-performance` stays) |
| **REMOVE** | 0 (no admin tabs removed in Wave 1 — admin is owner territory) |
| **Total admin tabs mapped** | **28** (per detailed enumeration; inventory summary says 26 — 2-row discrepancy to verify in P0 implementation) |

### Section B — top-line summary

- **0 admin tabs removed** — owner-controlled surface; folding only.
- **6 fold candidates** flagged for P1/P2 with risk annotations.
- **Rule 64/65/66 anchors preserved** (sharia, source-authority, validation-monitor).
- **No security changes** (per Bravo's RESTRUCTURE-BACKEND-AUDIT — admin auth hardening is a separate Wave).

---

## Section C — Dialogs → Sheets / pages plan

### C.1 Current dialog inventory

From SCREENS-INVENTORY §"Global Dialogs / Modals / Sheets":

| # | Dialog/Modal/Sheet | File | Mount point | Type |
|---|---|---|---|---|
| 1 | `BotLinkHandler` | inline `page.tsx` L894-1024 | AppShell global | Dialog |
| 2 | `TrialExpiredModal` | `src/modules/subscription/components/TrialExpiredModal.tsx` (77 LOC) | AppShell global | Modal (blocking) |
| 3 | `TrialCountdownBanner` + embedded Dialog (with `PricingView`) | `src/modules/subscription/components/TrialCountdownBanner.tsx` (125 LOC) | AppShell global | Banner + Dialog |
| 4 | `SessionExpiredModal` | `src/components/auth/SessionExpiredModal.tsx` (146 LOC) | `src/components/Providers.tsx` (global) | Modal (non-dismissible) |
| 5 | `LoginPromptModal` | `src/components/auth/LoginPromptModal.tsx` (286 LOC) | `AuthGate` | Modal |
| 6 | `LockModal` | `src/components/auth/LockModal.tsx` (94 LOC) | `LiquidityRadarView` (and other gated widgets) | Modal |
| 7 | `DynamicRiskProfilerModal` | `src/components/persona/DynamicRiskProfilerModal.tsx` (326 LOC) | `EnhancedPortfolioView` | Modal |
| 8 | `AssetPreferenceOnboarding` | `src/modules/dashboard/components/AssetPreferenceOnboarding.tsx` | `DashboardView` (first-visit) | Dialog |
| 9 | `PlatformGuide` Sheet | `src/components/help/PlatformGuide.tsx` (503 LOC) | AppShell via `AppGuideAutoOpen` | Sheet (right-side) |
| 10 | `NotificationCenter` Sheet | `src/components/notifications/NotificationCenter.tsx` | `TopBar` (bell icon) | Sheet (left-side) |
| 11 | `StockInfographicModal` | `src/modules/publishing/components/StockInfographicModal.tsx` (335 LOC) | `UnifiedPublishButton` | Modal |
| 12 | `StockPublisher` Dialog | `src/modules/publishing/components/StockPublisher.tsx` (1129 LOC) | Used in 7+ views | Dialog (3 Tabs) |
| 13 | `UnifiedPublishButton` Dialog | `src/modules/publishing/components/UnifiedPublishButton.tsx` | Many views | Dialog (with sub-Dialog `TradeResultsGenerator` + sub-Modal `StockInfographicModal`) |
| 14 | `MultiPortfolioSelector` | `src/modules/portfolio/components/MultiPortfolioSelector.tsx` | `EnhancedPortfolioView` | Dialog (×2 add/edit) |
| 15 | `FeedbackWidget` | `src/components/FeedbackWidget.tsx` | AppShell global (floating) | Dialog |
| 16 | `PersonaSelector` AlertDialog | `src/components/persona/PersonaSelector.tsx` | Settings / Portfolio | AlertDialog (Gambler Warning) |
| 17 | `QuickPublishButton` Dialog | `src/components/publishing/QuickPublishButton.tsx` (336 LOC) | Used in publishing views | Dialog |

**~15 additional view-level dialogs** (add-trade, edit-asset, delete-confirm, add-position, etc.) spread across views.

### C.2 Consolidation plan

**Target global-overlay count: ≤ 5** (down from current 9 AppShell-level overlays).

| # | Current overlay | Plan | New surface |
|---|---|---|---|
| 1 | `BotLinkHandler` Dialog | KEEP (one-shot `?bot_link=TOKEN` handler) | AppShell global Dialog (transient) |
| 2 | `TrialExpiredModal` (hard block) | **SOFTEN** (Section E) → merge with `TrialCountdownBanner` | AppShell global Sheet (right-side, dismissible) |
| 3 | `TrialCountdownBanner` + Dialog | **MERGE** with softened `TrialExpiredModal` → single "SubscriptionSheet" | AppShell banner (dismissable) + Sheet on click |
| 4 | `SessionExpiredModal` | KEEP (security — non-dismissible on 401 is correct) | AppShell global Modal |
| 5 | `LoginPromptModal` | **EXPAND** to also serve Guest Mode (Section D) — becomes `LoginOrGuestSheet` | AuthGate Sheet (right-side, dismissible) |
| 6 | `LockModal` | KEEP (per-widget soft paywall on advanced rows — used by LiquidityRadar) | Inline Modal (component-local) |
| 7 | `DynamicRiskProfilerModal` | **CONVERT** to Portfolio sub-tab (already a Persona quiz — better as a guided flow than a modal) | Tab inside `EnhancedPortfolioView` |
| 8 | `AssetPreferenceOnboarding` | KEEP (first-visit only — onboarding is correctly a Dialog) | Dialog (Dashboard first-visit only) |
| 9 | `PlatformGuide` Sheet | KEEP (auto-open on first visit; manual reopenable) | AppShell Sheet (right-side) |
| 10 | `NotificationCenter` Sheet | KEEP (bell icon in TopBar) | AppShell Sheet (left-side) |
| 11 | `StockInfographicModal` + `StockPublisher` Dialog + `UnifiedPublishButton` Dialog + `QuickPublishButton` Dialog | **MERGE** into single `UnifiedPublisherSheet` (right-side Sheet with 3 Tabs: Card preview · Text · Image) | Single reusable Sheet component used by all 7+ views |
| 12 | `MultiPortfolioSelector` (×2) | **CONVERT** to Portfolio sub-tab (portfolio picker is a primary action, not a transient dialog) | Top-of-Portfolio dropdown (replaces 2 Dialogs) |
| 13 | `FeedbackWidget` | KEEP (floating button + Dialog is correct UX) | AppShell global floating Dialog |
| 14 | `PersonaSelector` AlertDialog | KEEP (Gambler Warning is correctly an AlertDialog — non-dismissible is the point) | AlertDialog |
| 15 | `TradeResultsGenerator` (sub-Dialog of UnifiedPublishButton) | **MERGE** into `UnifiedPublisherSheet` as a 4th sub-tab "النتائج" | Tab inside UnifiedPublisherSheet |

### C.3 View-level dialogs (~15) — bulk plan

- **Add/Edit/Delete confirmation dialogs** (asset, watchlist item, alert, trade, position, portfolio): KEEP as Dialogs (correct transient UX).
- **Add-position dialog** inside `CryptoPortfolioView`: with Section F unification, this becomes the existing Portfolio add-asset dialog (already supports crypto type). **REDIRECT** the call site to Portfolio's add-asset dialog.
- **TradeDialog / ConfirmDialog / ResetDialog** in `SimulationView`: KEEP (paper-trading transient actions).

### C.4 Final global-overlay count

| Surface | Count | Notes |
|---|---|---|
| AppShell global Dialogs | 3 | `BotLinkHandler`, `SessionExpiredModal`, `FeedbackWidget` |
| AppShell global Sheets | 3 | `SubscriptionSheet` (merged from TrialModal+Banner+LoginPromptModal), `PlatformGuide`, `NotificationCenter` |
| AppShell global AlertDialog | 1 | `PersonaSelector` Gambler Warning |
| First-visit Dialogs | 2 | `AssetPreferenceOnboarding` (Dashboard), `LoginOrGuestSheet` (AuthGate) |
| Component-local Modals | 1 | `LockModal` (LiquidityRadar) |
| Reusable Publisher Sheet | 1 | `UnifiedPublisherSheet` (replaces 4 separate publisher dialogs) |
| **Total global overlays** | **11 → 5 truly global + 6 view/component-level** | Down from 17 (9 global + 8 view-level duplicates); net reduction = **6 → 5** global, **15 → 8** view-level |

### C.5 Constitutional compliance

- **Rule 4 (NO-NEW-SCREENS):** All merges reuse existing files (no new `.tsx` for `UnifiedPublisherSheet` — instead extend `StockPublisher.tsx` to be the Sheet host; the 3 caller components become thin wrappers).
- **Rule 73 (SINGLE-DISPLAY-SOURCE):** Publisher consolidation eliminates 4 sources for "publish a stock card" → 1.
- **Rule 20 (Python=Brain):** No logic added to frontend; merge is purely presentational.

---

## Section D — Guest Mode frontend plan

### D.1 Current state (problem)

`AuthGate` (`src/components/auth/AuthGate.tsx`, 474 LOC) currently shows
`AuthView` (full-screen login/register) for any unauthenticated visitor. There
is no "look around first" path. Bravo's RESTRUCTURE-BACKEND-AUDIT confirms
**no role model exists in Python** and **all read endpoints are open** — so
Guest Mode is purely a frontend presentation layer (no backend work needed
for read-only access; backend hardening is a separate Wave).

### D.2 Guest Mode UX

| State | Trigger | Behavior |
|---|---|---|
| **Guest (no token)** | Default for unauthenticated users | AppShell renders with `guestMode=true` flag. Visible: Dashboard (limited widgets), Stocks (table without detail drill-down), Liquidity Radar (top 10 rows visible, rest blurred + `LockModal`), Watchlist (read-only sample), News, Subscription page, Settings (limited). |
| **Guest → Trial** | User clicks "ابدأ تجربتك المجانية" in `LoginOrGuestSheet` or any `LockModal` CTA | Full AuthView (register flow) → on success, 14-day trial starts → countdown banner appears. |
| **Guest → Paid** | User clicks "اشترك الآن" anywhere | SubscriptionView direct + Paymob checkout → on success, paid tier unlocks. |
| **Trial active** | `trial_ends_at` set + in future | AppShell normal + `TrialCountdownBanner` shows days remaining + advanced content soft-locked behind `LockModal` (only after 7-day mark). |
| **Trial expired** | `trial_ends_at` past | AppShell normal + `SubscriptionSheet` dismissable banner (Section E). |
| **Paid** | active subscription | Everything open. |

### D.3 Implementation (frontend only — no Python changes in Wave 1)

1. **`AuthGate` modification** (P0 — when Guest Mode implemented by separate mandate):
   - Add `guestMode` query/hash: `?guest=1` or `#guest` → render AppShell with a `guestMode` context flag.
   - Default behaviour: if no `?dev=1` and no `?bot_link=` and no `#auth` hash → render AppShell in Guest Mode (instead of AuthView).
   - Keep AuthView reachable via explicit "تسجيل الدخول" click in `LoginOrGuestSheet`.

2. **`LoginOrGuestSheet`** (replaces `LoginPromptModal`):
   - Right-side Sheet (matching PlatformGuide visual language).
   - 2 paths: (a) "تصفح كضيف" (continue as Guest, dismiss Sheet) — (b) "سجّل الدخول / أنشئ حساب" (open AuthView).
   - Triggered by: any `LockModal` CTA, any deep-link to a guest-restricted view (e.g., `#trading-journal`, `#publishing`), or the new TopBar "حسابي" button.

3. **`guestMode` context** (Zustand store flag — no new file, extend `src/lib/store.ts`):
   - `guestMode: boolean` — when true, component-level gates activate.
   - `LockModal` already exists; extend it to consult `guestMode` and change CTA text ("سجّل الدخول لمشاهدة التفاصيل" for guests; "اشترك لمشاهدة التفاصيل" for trial users).

4. **Guest-restricted views (frontend gates)** — list of `case` values to gate:
   - `trading-journal`, `publishing`, `advanced-portfolio`, `dual-track`, `unified-analysis`, `backtesting`, `seasonality` → guest sees a `LockModal` over a blurred preview.
   - `portfolio`, `watchlist` → guest sees read-only sample data (the existing seed data is 410-Gone per Rule 27 — so show "لا توجد بيانات — سجّل الدخول لإنشاء محفظتك" empty state).
   - `settings` → guest sees only language + theme; persona/subscription sections hidden.

5. **Data access** — guest reads use the same `/api/*` endpoints; the API already returns public market data (per Bravo audit — all read endpoints are open). No backend changes in Wave 1. **Backend hardening (role model) is Bravo's Wave 2 — out of scope here.**

### D.4 Constitutional compliance

- **Rule 4 (NO-NEW-SCREENS):** ✅ No new `page.tsx`. `LoginOrGuestSheet` is a Sheet component (extends existing `LoginPromptModal.tsx` — P0 mandate to rename + expand, not new file).
- **Rule 20 (Python=Brain):** ✅ All gates are presentational flags; no computation added to Node.
- **Rule 27 (NO-FAKE-DATA):** ✅ Guest Mode shows empty states + real public data. No mock data. (Note: `AlertsCenterView.tsx:433-443` has hardcoded mock — flagged in ALPHA-TEAM-WORK, must be killed before Guest Mode ships.)
- **Rule 73 (SINGLE-DISPLAY-SOURCE):** ✅ Guest sees the same canonical sources as paid users (just less of them).

### D.5 Risk

- 🟠 **Backend security gap**: Guest Mode on frontend alone does not protect endpoints. Bravo's audit flagged 22 admin endpoints without auth. If Guest Mode ships before backend role model, a guest user could hit `/api/admin/*` directly. **Mitigation**: Guest Mode Wave 1 ships with **read-only market data** only — all `/api/admin/*` calls require session cookie (already enforced by `auth_middleware.py`'s `@require_admin` on 52/74 endpoints). The 22 unprotected endpoints are flagged for Bravo's Wave 1 Security hardening.
- 🟡 **User confusion**: Guests landing on a half-locked product may bounce. Mitigation: clear "هذه الميزة للمشتركين — ابدأ تجربتك المجانية" messaging on every `LockModal`.

---

## Section E — TrialExpiredModal softening plan

### E.1 Current state (problem)

`TrialExpiredModal.tsx` (77 LOC) renders a **fullscreen blocking overlay**
when the 14-day trial expires. The only escape is to subscribe (renders
`PricingView` inside). This is a **hard block** — users cannot view any
content, even public market data, until they pay. Per mandate: change to
**soft paywall** (content visible but blurred/limited).

### E.2 Soft paywall UX

| Tier | Behaviour |
|---|---|
| Trial active (days 1–7) | Full access — no overlay. `TrialCountdownBanner` shows remaining days. |
| Trial active (days 8–14) | Full access + amber banner "تجربتك تنتهي خلال X يوم — اشترك الآن للاستمرار". `LockModal` appears on advanced features (Publishing, Backtesting, Trading Journal). |
| Trial expired | **Soft paywall**: AppShell renders normally; advanced views show a blurred preview + `SubscriptionSheet` (right-side Sheet, dismissible). Banner at top: "انتهت تجربتك — اشترك لفتح كل الميزات" with "لاحقاً" (later) button. |
| Paid | Everything open. No overlay. |

### E.3 Implementation (frontend only)

1. **`TrialExpiredModal.tsx` modification** (P0):
   - Replace `fixed inset-0` fullscreen block with a `Banner` + `Sheet` pattern.
   - On mount (when `trial_expired === true`): show banner (amber, top of AppShell) + auto-open `SubscriptionSheet` once per session (sessionStorage flag).
   - User can dismiss the Sheet with "لاحقاً" — banner persists.
   - Banner has a "اشترك الآن" button → re-opens Sheet.

2. **`SubscriptionSheet`** (merged from `TrialExpiredModal` + `TrialCountdownBanner` + `LoginPromptModal`):
   - Single right-side Sheet.
   - Content: trial status header + PricingView body + 3 CTAs (اشترك / تصفح كضيف / سجّل الدخول).
   - Triggers: expired banner click, day-8+ LockModal CTA, manual "الباقات" menu, guest-mode `LockModal`.

3. **Blurred preview** (soft paywall visual):
   - For `trading-journal`, `publishing`, `advanced-portfolio`, `dual-track`, `unified-analysis`, `backtesting`, `seasonality` (already hidden from menu, deep-link only):
     - Trial-expired user: render the view with a `pointer-events-none opacity-40 blur-sm` overlay + a centered `LockModal`-style CTA.
     - Guest user: same blurred preview + `LoginOrGuestSheet` CTA.
   - Implementation: a new `<SoftPaywallOverlay>` wrapper component (extends existing `LockModal.tsx` — not a new file).

4. **Public market data stays visible**:
   - Dashboard, Stocks (table), Liquidity Radar (top rows), News, Academy, Subscription page, Settings (limited) — all render normally for trial-expired users.
   - Only the **deep-link hidden** views get the blurred preview.

### E.4 Constitutional compliance

- **Rule 4:** ✅ No new screens. `SubscriptionSheet` extends `TrialExpiredModal.tsx` (rename + expand).
- **Rule 20:** ✅ No computation in Node — purely presentational.
- **Rule 27:** ✅ No fake data — blurred preview shows the real view component, just visually gated.

### E.5 Risk

- 🟠 **Conversion drop**: Hard blocks force payment; soft paywalls may reduce conversions. Mitigation: A/B test could be a P2 follow-up (out of scope here).
- 🟡 **Repeat-visit annoyance**: If banner persists + Sheet auto-opens every session, users may churn. Mitigation: sessionStorage flag (Sheet opens once per browser session; banner stays dismissible per page).

---

## Section F — Crypto/Stocks merge plan

### F.1 Current state (per SCREENS-INVENTORY)

Crypto unification is **already partially done** via the `CRYPTO_VIEW_REDIRECTS`
map in `src/lib/valid-views.ts` — 8 crypto routes alias to unified views with
`currentMarket='CRYPTO'`:

| Crypto hash | Redirects to | Status |
|---|---|---|
| `#crypto` | `#dashboard` + `setCurrentMarket('CRYPTO')` | ✅ unified |
| `#crypto-live` | `#stocks` | ✅ unified |
| `#crypto-watchlist` | `#watchlist` | ✅ unified |
| `#crypto-recommendations` | `#recommendations` | ✅ unified |
| `#crypto-analysis` | `#smart-confluence` | ✅ unified |
| `#crypto-learning` | `#academy` (Rule 63) | ✅ unified |
| `#crypto-simulation` | `#simulation` | ✅ unified |
| `#crypto-trading-chart` | `#trading-chart` | ✅ unified |
| `#crypto-screener` | `#stock-filters` | ✅ unified |
| `#crypto-portfolio` | `CryptoPortfolioView` (separate file) | ❌ **NOT unified** |
| `#crypto-prediction-tracking` | `CryptoPredictionTrackingView` (separate file) | ❌ **NOT unified** |

### F.2 Remaining unification (2 cases — P0)

#### F.2.1 `#crypto-portfolio` → `#portfolio` with `setCurrentMarket('CRYPTO')`

**Current:** `src/modules/crypto/components/CryptoPortfolioView.tsx` (642 LOC) — separate crypto holdings manager with its own add-position dialog.

**Target:** `#crypto-portfolio` becomes an alias for `#portfolio` with `currentMarket='CRYPTO'`. The Portfolio add-asset dialog already supports `type: 'crypto'` (per inventory L147: "add asset (stock/crypto/gold/bank/cert/fund)").

**Migration steps (P0 — to be executed by separate Alpha implementation mandate, not in this planning file):**
1. In `src/lib/valid-views.ts`: add `'crypto-portfolio'` to `CRYPTO_VIEW_REDIRECTS` map pointing to `'portfolio'`.
2. In `src/app/page.tsx` `renderView()`: replace `case 'crypto-portfolio': return <CryptoPortfolioView />` with the same redirect pattern used by `#crypto-recommendations` (call `setCurrentMarket('CRYPTO')` + return `<EnhancedPortfolioView />`).
3. In `EnhancedPortfolioView.tsx`: when `currentMarket === 'CRYPTO'`, the asset-type filter defaults to crypto-only (filter `type === 'crypto'`).
4. `CryptoPortfolioView.tsx` becomes an **orphan** (dead code) — flagged for archive in P2 (NOT deleted in Wave 1).

**Risk:** 🟠 CryptoPortfolioView has 642 LOC of crypto-specific UX (wallet integration, blockchain confirmations?). **Mitigation**: Audit `CryptoPortfolioView.tsx` for unique features before folding — if it has crypto-specific features the unified Portfolio lacks, port them as Portfolio sub-tab "محفظة الكريبتو" before archiving.

#### F.2.2 `#crypto-prediction-tracking` → `#prediction-tracking` with `setCurrentMarket('CRYPTO')`

**Current:** `src/modules/crypto/components/CryptoPredictionTrackingView.tsx` (479 LOC) — separate crypto picks tracker with 3 Tabs (all/pending/closed).

**Target:** `#crypto-prediction-tracking` becomes an alias for `#prediction-tracking` (which already has a market filter Select per inventory L322).

**Migration steps (P0):**
1. In `src/lib/valid-views.ts`: add `'crypto-prediction-tracking'` to `CRYPTO_VIEW_REDIRECTS` map pointing to `'prediction-tracking'`.
2. In `src/app/page.tsx` `renderView()`: replace `case 'crypto-prediction-tracking': return <CryptoPredictionTrackingView />` with the redirect pattern.
3. In `PredictionTrackingView.tsx`: ensure the market filter Select defaults to `CRYPTO` when `currentMarket === 'CRYPTO'` (likely already does — verify in P0).
4. `CryptoPredictionTrackingView.tsx` becomes an **orphan** — flagged for archive in P2.

**Risk:** 🟡 Lower than crypto-portfolio — PredictionTrackingView already has market filter; just verify 3 Tabs (all/pending/closed) match the unified view's status filter.

### F.3 Post-merge state

After F.2.1 + F.2.2, all 11 crypto routes are aliases to unified views. The Market Switcher in TopBar (6 markets: EGX/TADAWUL/KSE/QSE/US/CRYPTO) is the single source of truth for market context.

**Two files become dead code** (flagged in Section G):
- `src/modules/crypto/components/CryptoPortfolioView.tsx` (642 LOC)
- `src/modules/crypto/components/CryptoPredictionTrackingView.tsx` (479 LOC)

**Net code reduction:** ~1121 LOC (when archived in P2, not deleted in Wave 1).

### F.4 Constitutional compliance

- **Rule 4 (NO-NEW-SCREENS):** ✅ Aliases only; no new files.
- **Rule 28 (NO-DUPLICATION):** ✅ Eliminates the last 2 crypto duplicates.
- **Rule 63 (Education/Market unification):** ✅ Completes the unification Rule 63 started.
- **Rule 67 (backwards-compat aliases):** ✅ All crypto hashes preserved as redirects.
- **Rule 73 (SINGLE-DISPLAY-SOURCE):** ✅ One portfolio view, one prediction-tracking view, both market-aware.

---

## Section G — Dead code list

Cross-reference of SCREENS-INVENTORY §"Orphaned / Removed Views" + ALPHA-TEAM-WORK findings + Section F new orphans.

### G.1 Historically archived (already in `archive/` — DO NOT TOUCH in Wave 1)

These files are **already archived** (moved to `archive/*-2026-10-01/` or `archive/dead-components-2026-10-08/` or `archive/_archived_v404/` or deleted). They appear as comments in `page.tsx` but are **NOT** in the switch. **No action needed.**

| View | Archive location | Reason |
|---|---|---|
| `LearningView` | `archive/education-duplicate-2026-10-01/LearningView.tsx` | Rule 63 — unified into AcademyView |
| `CryptoLearningView` | `archive/dead-components-2026-10-08/crypto/CryptoLearningView.tsx` | Rule 63 — unified into AcademyView |
| `CryptoSimulationView` | `archive/simulation-crypto-duplicate-2026-10-01/CryptoSimulationView.tsx` | SimulationView now serves all markets |
| `CryptoScreenerView` | `archive/dead-components-2026-10-08/crypto/CryptoScreenerView.tsx` | Unified into StockScreenerAdvancedView |
| `CryptoTradingChartView` | `archive/dead-components-2026-10-08/crypto/CryptoTradingChartView.tsx` | Unified into TradingChartView |
| `CryptoAdvancedAnalysisView` | `archive/dead-components-2026-10-08/crypto/CryptoAdvancedAnalysisView.tsx` | Unified into SpecialistAnalysisView |
| `CryptoRecommendationsView` | `archive/_archived_v404/` | Unified into MarketAnalysisView |
| `CryptoAnalysisView` | `archive/_archived_v404/` | Unified into SmartConfluenceView |
| `SniperView` | (deleted) | Merged into MarketAnalysisView persona tabs |
| `PicksManagementView` | `archive/wave-2-cleanup-2026-10-01/src/modules/predictions/components/PicksManagementView.tsx` | Features merged into PredictionTrackingView |
| `StoredAnalysisView` | (deleted) | Features distributed to #recommendations + #specialist-analysis |
| `IterativeLearningView` | (not in switch — comment only) | Not used |
| `SimpleRecommendationsView` | (not in switch — comment only) | Not used |
| `PredictionPerformanceView` | (file deleted; case still in switch but blocked) | Locked behind admin gate |
| `PredictionCredibilityTable` | (file deleted; case still in switch but blocked) | Locked behind admin gate |
| `MaestroWidget` | `src/modules/dashboard/components/MaestroWidget.tsx` (file still exists, import commented out in DashboardView) | Rule 73: SINGLE-DISPLAY-SOURCE |
| `MaestroCommandCenter` / `MaestroDashboard` | (deleted in FIX-P3-P5-P6) | Replaced by AdminView hubs |

### G.2 New orphans produced by this plan (P2 archive candidates — DO NOT DELETE in Wave 1)

These files become dead code as a **result** of Section A + Section F mappings.
**Wave 1 = planning only.** These are flagged for **P2 archive** (separate
owner mandate to confirm). Deletion comes later.

| File | LOC | Why orphaned | Trigger |
|---|---|---|---|
| `src/modules/crypto/components/CryptoPortfolioView.tsx` | 642 | `#crypto-portfolio` becomes alias for `#portfolio` (Section F.2.1) | P0 implementation mandate |
| `src/modules/crypto/components/CryptoPredictionTrackingView.tsx` | 479 | `#crypto-prediction-tracking` becomes alias for `#prediction-tracking` (Section F.2.2) | P0 implementation mandate |
| `src/modules/publishing/components/QuickPublishButton.tsx` | 336 | Merged into `UnifiedPublisherSheet` (Section C.2 row 11) | P1 implementation mandate |
| `src/modules/publishing/components/StockInfographicModal.tsx` | 335 | Merged into `UnifiedPublisherSheet` (Section C.2 row 11) | P1 implementation mandate |
| `src/components/auth/LoginPromptModal.tsx` | 286 | Expanded/renamed to `LoginOrGuestSheet` (Section D) — file is renamed + extended, not deleted | P0 implementation mandate |
| `src/modules/subscription/components/TrialExpiredModal.tsx` | 77 | Merged into `SubscriptionSheet` (Section E) — file is renamed + extended | P0 implementation mandate |
| `src/modules/subscription/components/TrialCountdownBanner.tsx` | 125 | Merged into `SubscriptionSheet` (Section E) — file is renamed + extended | P0 implementation mandate |

**Net code flagged for P2 archive:** ~2280 LOC (across 7 files; some are
renamed-and-extended rather than truly deleted — the destination files absorb
the source's logic).

### G.3 MaestroWidget — special case

`src/modules/dashboard/components/MaestroWidget.tsx` is **still in `src/`**
but its import in `DashboardView` is commented out (Rule 73 violation
historically). It is the only "orphan in place" — file exists, not imported
anywhere. **Action for P2**: archive to `archive/dead-components-*` (separate
mandate). **NOT touched in Wave 1.**

### G.4 Comments-only orphans in `page.tsx`

The `page.tsx` switch contains comment-only references to removed views
(`sniper merged into analysis`, `picks-management REMOVED`, etc.). These
are documentation comments — **keep them** (Rule 67 backwards-compat
documentation). No action.

### G.5 Constitutional compliance

- **Rule 4 (NO-NEW-SCREENS):** ✅ No new files. Dead-code archive happens in P2.
- **Rule 28 (NO-DUPLICATION):** ✅ Each orphan elimination removes a duplicate.
- **This plan does NOT delete any file.** Deletion is a separate owner mandate.

---

## Section H — Wave ordering (P0 / P1 / P2)

### H.1 Wave 1 — PLANNING (this document)

- **Owner:** Alpha (plan subagent) — Z.ai Code.
- **Deliverable:** `RESTRUCTURE-MIGRATION-PLAN.md` (this file).
- **Code changes:** ZERO. ✅
- **Push:** ZERO (Rule 75 SUSPENDED for planning — owner decision).

### H.2 Wave 2 — P0 Implementation (after owner approval)

**Owner:** Alpha implementation subagent (separate mandate). Push gate: owner.

**P0 deliverables (high-impact, low-risk, unblocks the rest):**

1. **Crypto unification (Section F)** — 2 cases:
   - `#crypto-portfolio` → alias for `#portfolio` w/ CRYPTO market.
   - `#crypto-prediction-tracking` → alias for `#prediction-tracking` w/ CRYPTO market.
   - Files touched: `src/lib/valid-views.ts`, `src/app/page.tsx` (2 case branches).
   - Risk: 🟡 low — verify Portfolio add-asset dialog crypto type + PredictionTrackingView market filter.
   - LOC delta: ~0 (alias changes only).

2. **TopBar menu prune (Section A)** — remove 9 items from `navSections`:
   - Remove from السوق: `trading-chart`, `market-depth` (keep `smart-confluence` already removed).
   - Remove from أموالي→محفظتي: `live-monitor`, `trading-memory` (keep portfolio/watchlist/alerts-center).
   - Remove from التوقعات→التحليل: `specialist-analysis` (keep recommendations/reports).
   - Remove from المزيد: `simulation`, `sharia`, `rescue`, `zakat`, `tithes`, `about` (keep academy/news/subscription/settings).
   - File touched: `src/components/layout/TopBar.tsx` (`navSections` array).
   - Risk: 🟠 medium — discoverability of religious tools (zakat/tithes/sharia) drops; mitigate with Settings "أدوات شرعية" entry.
   - LOC delta: ~30 deletions from `navSections` array.
   - **Constraint:** Switch cases in `page.tsx` UNCHANGED — all hashes still work (Rule 67 backwards-compat preserved).

3. **TrialExpiredModal softening (Section E)** — change hard block → soft paywall:
   - File touched: `src/modules/subscription/components/TrialExpiredModal.tsx` (rename to `SubscriptionSheet.tsx` + extend).
   - File touched: `src/modules/subscription/components/TrialCountdownBanner.tsx` (fold into `SubscriptionSheet.tsx`).
   - Risk: 🟠 conversion impact unknown — owner decision.
   - LOC delta: ~+50 (Sheet shell + banner) / ~-30 (removed fullscreen block).

4. **Guest Mode v1 (Section D)** — `AuthGate` modification + `LoginOrGuestSheet`:
   - File touched: `src/components/auth/AuthGate.tsx` (add `guestMode` flow).
   - File touched: `src/components/auth/LoginPromptModal.tsx` (rename to `LoginOrGuestSheet.tsx` + extend with Guest CTA).
   - File touched: `src/lib/store.ts` (add `guestMode: boolean` flag).
   - Risk: 🔴 HIGH — backend role model doesn't exist yet (Bravo audit). **Mitigation**: Guest Mode v1 ships read-only (no `/api/admin/*` calls from guest UI); backend hardening is Bravo's parallel Wave.
   - LOC delta: ~+150 (Guest flow + Sheet).

5. **AlertsCenterView mock removal (ALPHA-TEAM-WORK finding)**:
   - File touched: `src/components/alerts/AlertsCenterView.tsx` L433-443 (remove hardcoded mock alerts).
   - Risk: 🟢 low (Rule 27 violation cleanup — must ship before Guest Mode since AlertsCenter becomes a primary nav target).
   - LOC delta: ~-11.

**P0 dependencies:** 5 → 4 → 1,2,3 (AlertsCenter cleanup must ship before or with Guest Mode).

### H.3 Wave 3 — P1 Implementation (after P0 stable)

1. **UnifiedPublisherSheet consolidation (Section C row 11)**:
   - Merge `StockPublisher.tsx` + `UnifiedPublishButton.tsx` + `QuickPublishButton.tsx` + `StockInfographicModal.tsx` → single Sheet.
   - File touched: extend `StockPublisher.tsx` to be Sheet host; 3 callers become thin wrappers.
   - Risk: 🟡 medium — 7+ views call these; each call site needs updating.
   - LOC delta: ~-400 net.

2. **DynamicRiskProfilerModal → Portfolio sub-tab (Section C row 7)**:
   - File touched: `EnhancedPortfolioView.tsx` (add 5th tab `profiler`); `DynamicRiskProfilerModal.tsx` becomes the tab body (file reused, not deleted).
   - Risk: 🟢 low — modal→tab is mechanical.
   - LOC delta: ~0.

3. **MultiPortfolioSelector → Portfolio dropdown (Section C row 12)**:
   - File touched: `EnhancedPortfolioView.tsx` (replace 2 dialogs with dropdown).
   - Risk: 🟢 low.
   - LOC delta: ~-50.

4. **Admin tab folding (Section B TAB-MERGE candidates)** — 4 folds:
   - `general` → sub-tab inside `engine-control-room`.
   - `db-backup` → sub-tab inside `databases` (backups sub-tab already exists).
   - `news-health` → sub-tab inside `news-control`.
   - `users` → sub-tab inside `user-management` (analytics sub-tab).
   - File touched: `src/modules/admin/components/AdminView.tsx`.
   - Risk: 🟡 low — admin-only surface.
   - LOC delta: ~-100.

5. **Trading Journal → Portfolio sub-tab (Section A row 37)**:
   - File touched: `EnhancedPortfolioView.tsx` (add 6th tab `journal`); `TradingJournalView.tsx` becomes tab body.
   - Risk: 🟢 low.
   - LOC delta: ~0.

### H.4 Wave 4 — P2 Implementation (after P1 + owner approval)

1. **Dead code archive (Section G.2)** — move 7 files to `archive/restructure-wave1-2026-10-18/`:
   - `CryptoPortfolioView.tsx`
   - `CryptoPredictionTrackingView.tsx`
   - `QuickPublishButton.tsx`
   - `StockInfographicModal.tsx`
   - `MaestroWidget.tsx` (Section G.3)
   - `LoginPromptModal.tsx` (renamed → archive original)
   - `TrialExpiredModal.tsx` + `TrialCountdownBanner.tsx` (renamed → archive originals)
   - Risk: 🟢 low (already dead per P0+P1).
   - LOC delta: ~-2280.

2. **`market-depth` extraction (Section A row 32)**:
   - Inline JSX in `page.tsx` L592-634 violates Rule 4 spirit (no dedicated file).
   - Extract to `src/modules/dashboard/components/MarketDepthView.tsx` (new file — **Rule 4 exception flagged**; owner approval required).
   - Risk: 🟡 — Rule 4 conflict (new file). Mitigation: argue "extract inline JSX to dedicated file" is a refactor, not a new screen (same hash, same route, same UX).
   - LOC delta: ~0 (move).

3. **Publisher consolidation cleanup** — final pass:
   - Remove old `UnifiedPublishButton.tsx` if P1 left it as a wrapper.
   - Risk: 🟢 low.
   - LOC delta: ~-100.

4. **Admin backtest fold (Section B row 10)** — `backtest` → `learning` results sub-tab:
   - Risk: 🟡 — admin runner ≠ user-visible backtest; verify with owner first.
   - LOC delta: ~0.

### H.5 Wave 5 — Post-restructure verification (audits)

1. **Rule 73 zero_conflict_test** — re-run after all waves complete to confirm no display-source conflicts introduced.
2. **Rule 4 audit** — confirm no new `page.tsx` created (except H.4.2 if approved).
3. **Rule 28 audit** — confirm no duplicate screens remain (Target: 13 visible + 28 deep-link + 0 crypto duplicates).
4. **Rule 67 audit** — confirm all historical hashes still route correctly.
5. **Rule 27 audit** — confirm 0 fabrication introduced.

### H.6 Dependency graph

```
Wave 1 (PLAN — this doc)
  │
  ├── owner approval gate
  │
  ▼
Wave 2 (P0 — implementation)
  │
  ├── P0.5: AlertsCenter mock removal (no deps)
  ├── P0.1: Crypto unification (no deps)
  ├── P0.2: TopBar prune (no deps, but depends on P0.5 for AlertsCenter primary nav)
  ├── P0.3: TrialExpiredModal soften (no deps)
  └── P0.4: Guest Mode (DEPENDS on P0.5 — must not surface mock alerts to guests)
  │
  ▼
Wave 3 (P1 — consolidation)
  │
  ├── P1.1: UnifiedPublisherSheet (no deps)
  ├── P1.2: DynamicRiskProfilerModal → tab (no deps)
  ├── P1.3: MultiPortfolioSelector → dropdown (no deps)
  ├── P1.4: Admin tab folds (no deps)
  └── P1.5: Trading Journal → Portfolio tab (no deps)
  │
  ▼
Wave 4 (P2 — dead code archive + Rule 4 exceptions)
  │
  ├── P2.1: Archive 7 dead files (DEPENDS on P1.1 + P0.1 + P0.3 + P0.4 — all parent waves done)
  ├── P2.2: market-depth extraction (owner-approval gate)
  ├── P2.3: Publisher final cleanup (DEPENDS on P1.1)
  └── P2.4: Admin backtest fold (owner-approval gate)
  │
  ▼
Wave 5 (verification audits)
```

---

## Appendix — Constitutional compliance checklist

| Rule | Description | Status in this plan |
|---|---|---|
| **Rule 4** | NO-NEW-SCREENS | ✅ Zero new `page.tsx`. Wave 4 P2.2 (`market-depth` extraction) is the only flagged exception — owner-approval gate. |
| **Rule 20** | Python=Brain | ✅ No logic added to Node. All merges are presentational. |
| **Rule 27** | NO-FAKE-DATA | ✅ No mock data introduced. P0.5 removes existing mock in AlertsCenter. |
| **Rule 28** | NO-DUPLICATION | ✅ Net duplicate count: 13 visible → 0 duplicates (Target state). |
| **Rule 63** | Education/Market unification | ✅ Section F completes crypto unification Rule 63 started. |
| **Rule 67** | Backwards-compat aliases | ✅ All 28 deep-link cases preserved as switch cases. |
| **Rule 73** | SINGLE-DISPLAY-SOURCE | ✅ Publisher consolidation reduces 4 sources → 1. |
| **Rule 75** | PUSH-AFTER-EVERY-TASK | ⏸️ SUSPENDED for this planning task per mandate. Owner push gate respected. |

---

## Appendix — Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Backend role model missing (Bravo audit) blocks safe Guest Mode | 🔴 HIGH | P0.4 ships Guest Mode v1 read-only (no `/api/admin/*` calls); backend hardening is Bravo's parallel Wave. |
| Religious tools (zakat/tithes/sharia) become hard to discover | 🟡 MEDIUM | Add Settings "أدوات شرعية" entry pointing to `#sharia` (which links to `#zakat` + `#tithes`). |
| SimulationView (2131 LOC) becomes invisible | 🟡 MEDIUM | Add "المحاكاة" button inside Academy paper-trading tab. |
| TradingMemoryView (327 LOC, 4 panels) becomes invisible | 🟡 MEDIUM | Add "الذكاء" entry in Portfolio that routes to `#trading-memory`. |
| LiveMonitor (1358 LOC) becomes invisible | 🟡 MEDIUM | Ensure Dashboard PinnableWidget still surfaces LiveMonitor. |
| `market-depth` inline JSX in page.tsx violates Rule 4 spirit | 🟡 LOW | P2.2 extraction to dedicated file (owner-approval gate). |
| Hard→soft paywall may reduce conversions | 🟡 MEDIUM | A/B test in P2 follow-up (out of scope). |
| 7+ views call publisher dialogs — refactor touches many files | 🟡 MEDIUM | P1.1 is mechanical; each call site is a 1-line change. |
| CryptoPortfolioView may have unique crypto features (wallet integration) | 🟡 MEDIUM | Audit `CryptoPortfolioView.tsx` before folding; port unique features as Portfolio sub-tab. |
| Admin tab folds may break owner's admin workflow | 🟡 LOW | Admin is owner territory; folds happen in P1 with owner approval per fold. |

---

## Appendix — Counts summary

| Section | KEEP | TAB | DEEP-LINK | REMOVE | Total |
|---|---|---|---|---|---|
| A (59 cases) | 13 visible + 11 aliases = 24 | 3 (+1 candidate) | 28 | 2 | 59 |
| B (26–28 admin tabs) | 22 | 6 candidates | 0 | 0 | 28 |
| C (17 dialogs) | 9 (3 global Dialogs + 3 Sheets + 1 AlertDialog + 2 first-visit) | 0 | 0 | 8 (merged into 5 surfaces) | 17 |
| F (11 crypto routes) | 9 aliases (already unified) | 0 | 0 | 2 (P0 unification) | 11 |
| G (dead code) | 16 archived (no action) | 0 | 0 | 7 new orphans (P2 archive) | 23 |

**Total destination breakdown for the 59 main switch cases:**
- **13 KEEP (visible menu)** — exactly matches mandate's target TopBar.
- **11 KEEP (aliases)** — backwards-compat preserved.
- **3 TAB** — already merged into parent views (Task 40-B).
- **28 DEEP-LINK** — hidden but hash-routable.
- **2 REMOVE (unify redirects)** — crypto cases folded into stock equivalents.
- **0 file deletions** in Wave 1 (planning only).

---

**END OF PLAN — RESTRUCTURE-WAVE1-A**
