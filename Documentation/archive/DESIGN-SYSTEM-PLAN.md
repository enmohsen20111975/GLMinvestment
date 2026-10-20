# DESIGN-SYSTEM-PLAN — GLMinvestment Frontend Unification

> **Task ID:** DESIGN-SYSTEM-1 (audit + plan — planning only, no code)
> **Owner:** Alpha (Frontend Dragon — Z.ai Code)
> **Report to:** John (CEO)
> **Date:** 2026-10-18
> **Status:** Plan — pending John's approval before implementation
> **Scope:** `src/` only (Rule: 🚫 `vps-service/`, 🚫 `scripts/`, 🚫 `db/`)
>
> **Culture:** إحنا بنبنى هيكل هندسي سليم، مش بنرص طوب. كل مكون بـ يـ build مرة واحدة
> في مكتبة موحدة + كل الشاشات بـ تستورده. زي ما البايثون اـ unified (canonical sources +
> SSOT)، الفرونت لازم يـ unified كمان.

---

## جدول المحتويات

1. [Audit Map (الواقع)](#1-audit-map-الواقع)
2. [Unified Component Library (المقترح)](#2-unified-component-library-المقترح)
3. [Design Tokens](#3-design-tokens)
4. [Refactor Strategy + Phasing](#4-refactor-strategy--phasing)
5. [The Rule (ممنوع breaking)](#5-the-rule-ممنوع-breaking)

---

## 1. Audit Map (الواقع)

### 1.1 الـ duplicated ad-hoc components

| # | Ad-hoc component | Files where duplicated (sample) | Count | Severity |
|---|---|---|---|---|
| 1 | **Loading spinner / "جارٍ التحميل" / `Loader2 animate-spin`** | `modules/admin/components/TelegramTab.tsx`, `modules/market-analysis/components/LiveTrackingTab.tsx`, `modules/market-analysis/components/ProfessionalTradingChart.tsx`, `modules/radar/components/MultiMarketRadarTab.tsx`, `modules/education/components/EntryTimingSimulator.tsx`, `modules/admin/components/AdminView.tsx`, `app/page.tsx`, `components/shared/LazyTabLoader.tsx`, `components/seasonality/SeasonalityDashboard.tsx`, `components/subscription/SubscriptionView.tsx` | **482 occurrences / 147 files** | 🔴 HIGH |
| 2 | **Empty-state ("لا توجد بيانات" / "لا توجد نتائج" / "No data")** | `modules/admin/components/UsersManagement.tsx`, `modules/reports/components/ReportsView.tsx`, `modules/dashboard/components/MyStocksBriefing.tsx`, `modules/stock-analysis/components/StockDetail.tsx`, `modules/predictions/components/MakerRadarTab.tsx`, `modules/market-analysis/components/PersonaTab.tsx`, `modules/radar/components/RadarStatsCards.tsx`, `modules/portfolio/components/RoboAdvisorPanel.tsx`, `modules/education/components/PaperTradingWorkstation.tsx`, `app/error.tsx` | **523 occurrences / 241 files** | 🔴 HIGH |
| 3 | **Inline signal badges (buy/sell/hold/strong-buy)** — each consumer reimplements `SIGNAL_STYLES` map + emoji + classes | `modules/market-analysis/components/{PersonaTab,ExpertRecommendationsPanel,CanonicalWhoIsBuyingBanner,MorningBellSection,SingleStockAnalysisView,PredictionsTab}.tsx`, `modules/predictions/components/{MakerRadarTab,PredictionTrackingDashboard,DualTrackPredictionsView}.tsx`, `modules/radar/components/{MultiMarketRadarTab,ExitRadarTab,SignalTrackingTimeline}.tsx`, `modules/portfolio/components/{BagHolderRescuePanel,TopUpRecommendationsPanel}.tsx`, `components/shared/PredictionCard.tsx` (canonical map), `modules/sharia/components/ShariaBadge.tsx` (canonical map) | **2,278 string occurrences / 250+ files; ad-hoc badge render in ~30+ tsx** | 🔴 HIGH |
| 4 | **Ad-hoc stat / metric cards** (`text-2xl font-bold` + label + tone color, NOT using `StatCard`) | `modules/dashboard/components/{IndexCards,TopMovers,MultiMarketWidget,IntradayPressurePanel,LiquidityFlowPanel,InvestorsFlowPanel,MarketPulseWidget}.tsx`, `modules/radar/components/RadarStatsCards.tsx`, `modules/market-analysis/components/{MarketStatusTab,LiveTrackingTab}.tsx`, `modules/portfolio/components/{MasterPortfolioSummary,RoboAdvisorPanel}.tsx`, `modules/reports/components/{ExecutiveReportView,StockAnalysisReport}.tsx`, `modules/admin/components/{AdminView,SuperLearningSystem,EngineControlRoomTab}.tsx` | ad-hoc in **40+ files**; `StatCard` used in only **2 files** | 🔴 HIGH |
| 5 | **Price/ticker display widget** — each view composes `FlashingPriceCell` (shared, used in 1 file) OR its own `text-lg font-bold tabular-nums` + change% badge | `modules/dashboard/components/{RealtimeTicker,LiveStockTicker,LiveMonitor}.tsx`, `modules/stock-analysis/components/{StockDetail,DeepAnalysis,ComprehensiveStockAnalysis}.tsx`, `modules/market-analysis/components/{SingleStockAnalysisView,PersonaTab,PredictionsTab}.tsx`, `modules/crypto/components/CryptoPortfolioView.tsx`, `components/shared/PredictionCard.tsx` | ad-hoc in **30+ files** | 🟠 MED |
| 6 | **Inline `formatPrice` / `formatPct` / `toLocaleString` reimplementations** despite `src/lib/format.ts` being canonical | `components/shared/PredictionCard.tsx` (own `formatPrice`/`formatPct`), `components/shared/FlashingPriceCell.tsx` (own `defaultFormat`), `modules/sharia/components/ShariaBadge.tsx` (own `formatPct`), `modules/market-analysis/components/helpers.ts` (own helpers), `modules/stock-analysis/components/CalculationBreakdown.tsx`, `modules/portfolio/components/EnhancedPortfolioView.tsx` (99 occurrences of toLocaleString/EGP/formatPrice) | **~10 ad-hoc copies** | 🟠 MED |
| 7 | **Error states / inline error UIs** (alongside shared `ErrorBoundary`) | `modules/admin/components/{UsersManagement,NewsManagementTab,AdminView,SuperLearningSystem}.tsx`, `modules/reports/components/{DataManager,StockAnalysisReport,DailyMarketReport}.tsx`, `modules/dashboard/components/{DashboardView,LiveMonitor,MyStocksBriefing}.tsx`, `modules/stock-analysis/components/{StockDetail,TradingViewChart,ExpertAnalysisPanel,ComprehensiveStockAnalysis}.tsx`, `app/error.tsx`, `app/admin/educational-cards/page.tsx` | **30+ files** have own "تعذّر تحميل..." / "حدث خطأ" inline block | 🟠 MED |
| 8 | **Stock card / ticker row** (icon + ticker + name + price + change% + sparkline) — no shared primitive | `modules/radar/components/{PersonalizedRadarTab,ExitRadarTab,NetPicksTab}.tsx`, `modules/market-analysis/components/{PredictionsTab,ExpertPredictionsTab,LiveTrackingTab}.tsx`, `modules/dashboard/components/{MyStocksBriefing,LiveStockTicker,RealtimeTicker}.tsx`, `components/watchlist/{ProfessionalWatchlistView,EnhancedWatchlistView}.tsx`, `modules/stock-analysis/components/{StocksView,StockDetail}.tsx`, `modules/sharia/components/ShariaStockCard.tsx` | **15+ ad-hoc** | 🟠 MED |
| 9 | **Sector / category badge** | `modules/market-analysis/components/SectorTrackingTab.tsx`, `modules/radar/components/{MultiMarketRadarTab,CompanyFundamentalsCard}.tsx`, `modules/stock-analysis/components/{StockDetail,StocksView}.tsx`, `modules/sharia/components/ShariaView.tsx` — each renders sector as plain `<Badge variant="secondary">` or hardcoded `<span className="bg-emerald-100 text-emerald-700 ...">` | **~10 ad-hoc**, no shared `<SectorBadge>` | 🟡 LOW |
| 10 | **LockModal / paywall overlay** | Already shared: `components/auth/{LockModal,LoginPromptModal,TrialExpiredModal,SessionExpiredModal,PaywallListener,AuthGate}.tsx` + `LockedContent` exported from `LockModal.tsx` | 81 occurrences in 11 files — well-isolated | 🟢 DONE (A-P3) |

### 1.2 الـ visual inconsistencies

| Category | Examples | Count | Severity |
|---|---|---|---|
| **Direct Tailwind palette use (bypasses CSS vars)** | `text-emerald-600`, `text-red-500`, `bg-emerald-500`, `text-green-700`, `text-amber-600`, `text-rose-600`, `text-blue-500` in `PredictionCard.tsx`, `ShariaBadge.tsx`, `LockModal.tsx`, `FlashingPriceCell.tsx`, `SubscriptionView.tsx`, `ZakatView.tsx`, `EnhancedWatchlistView.tsx` | **5,505 occurrences / 231 files** | 🔴 HIGH |
| **Hardcoded hex colors** | `SpecialistAnalysisView.tsx` (195), `lib/visual-templates.ts` (63), `InteractiveChart.tsx` (52), `MarketStatusImageCard.tsx` (46), `PredictionsImageCard.tsx` (51), `ZakatView.tsx` (84), `SimulationView.tsx` (55), `LearningVisuals.tsx` (159), `DailyPicksPoster.tsx` (35) — many in canvas/SVG infographic templates | **1,359 occurrences / 88 files** | 🟠 MED |
| **Border radius inconsistency** | same card surfaces use `rounded-lg` (367/133 files), `rounded-xl` (902/170 files), `rounded-2xl` (310/82 files). No documented rule. | — | 🟠 MED |
| **Spacing gap inconsistency** | `gap-2` vs `gap-3` vs `gap-4` for the same "card header row" pattern across modules | — | 🟡 LOW |
| **Typography inconsistency** | `text-sm` vs `text-base` vs `text-xs` for stat-card labels across modules | — | 🟠 MED |
| **Shadow utility inconsistency** | only 106 `shadow-*` across 33 files vs 5,500+ cards; most rely on `[data-slot="card"]` global shadow from `globals.css` | — | 🟡 LOW |
| **🔴 ROOT CAUSE: `--success` / `--warning` / `--danger` CSS vars exist in `globals.css` but `tailwind.config.ts` does NOT extend them** → `text-success` doesn't work → devs fall back to `text-emerald-600` / `text-red-500` | — | 🔴 HIGH (root-cause) |

### 1.3 الـ existing shared components inventory

#### `src/components/ui/` (53 files — shadcn/ui + 3 custom)
- **Stock shadcn (50):** accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, form, hover-card, input-otp, input, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, switch, table, tabs, textarea, toast, toaster, toggle-group, toggle, tooltip.
- **Custom additions (3):** `stat-card.tsx`, `mini-sparkline.tsx`, `toaster.tsx`.

#### `src/components/shared/` (11 files — domain primitives)
| File | Purpose | Adoption |
|---|---|---|
| `UnifiedTable.tsx` | Standard data table wrapper | moderate |
| `LazyTabLoader.tsx` + `LazyInlineLoader` | Skeleton + spinner for `next/dynamic` lazy chunks | used in dynamic imports |
| `PredictionCard.tsx` | Canonical prediction display (signal + entry/target/stop + R:R + confidence + collapsible technical) | moderate — has `SIGNAL_STYLES` map that should be hoisted |
| `StockSearchSelector.tsx` | Stock picker dropdown | low-moderate |
| `ErrorBoundary.tsx` + `withErrorBoundary` HOC | React error boundary with reset/refresh + ChunkLoadError auto-reload | moderate |
| `ExpertIntelligencePanel.tsx` | Expert analysis panel | low |
| `FlashingPriceCell.tsx` | Price cell with green/red flash on change | **only 1 file** |
| `FlashingChangeCell.tsx` | Change% cell with flash | **only 1 file** |
| `MarketSelector.tsx` | Exchange market picker | low |
| `LiquidityRadarView.tsx` | Liquidity radar panel | low |
| `FormulaEngine.ts` | Formula evaluation utility | low |

#### Domain primitives (not in `shared/` but reused)
- `components/auth/{LockModal,LoginPromptModal,TrialExpiredModal,SessionExpiredModal,PaywallListener,AuthGate}.tsx` — paywall family (A-P3, well-isolated, 11 files, 81 hits)
- `modules/sharia/components/{ShariaBadge,ShariaStockCard}.tsx`
- `components/persona/PersonaSelector.tsx`
- `components/layout/{TopBar,Header,Footer,MobileNav,MobileMoreSheet,ExchangeSelector}.tsx`
- `lib/format.ts` — canonical formatting util (partially bypassed)

---

## 2. Unified Component Library (المقترح)

> **Goal:** كل building block مشترك بـ يـ built مرة واحدة في `src/components/shared/` + كل الشاشات بـ تستورده. ممنوع ad-hoc per screen.

### 2.1 Library structure

```
src/components/shared/
├── primitives/          ← atomic building blocks (1 concern each)
│   ├── SignalBadge.tsx         ← buy/sell/hold/strong_buy/avoid pill
│   ├── SectorBadge.tsx         ← sector/category tag
│   ├── PriceDisplay.tsx        ← price + flash + currency + change%
│   ├── StatCard.tsx            ← (move from ui/stat-card.tsx here) unified metric card
│   └── Sparkline.tsx           ← (alias to ui/mini-sparkline.tsx) inline chart
├── states/              ← loading / empty / error (the 3 async states)
│   ├── LoadingState.tsx        ← spinner + label + size variants
│   ├── EmptyState.tsx          ← icon + title + subtitle + CTA
│   └── ErrorState.tsx          ← message + retry + boundary-friendly
├── cards/               ← composed cards (use primitives)
│   ├── StockCard.tsx           ← ticker + name + price + change + sparkline
│   ├── PredictionCardView.tsx ← (refactor existing PredictionCard to use SignalBadge + PriceDisplay)
│   └── MetricRow.tsx           ← horizontal list of StatCards
└── index.ts             ← barrel export (forced entry point)
```

### 2.2 Component contracts (interface + props)

#### `<SignalBadge>` — `primitives/SignalBadge.tsx`
```typescript
type SignalKind = 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell' | 'avoid';
interface SignalBadgeProps {
  kind: SignalKind | string;        // string fallback for backend values
  label?: string;                    // override Arabic label
  size?: 'sm' | 'md' | 'lg';
  variant?: 'solid' | 'soft';       // solid=bg color, soft=bg/10 (default)
  showIcon?: boolean;               // arrow up/down/neutral
}
// Hoists SIGNAL_STYLES map from PredictionCard.tsx → single source.
// Exports getSignalStyle(kind) helper for tables/cells.
```

#### `<SectorBadge>` — `primitives/SectorBadge.tsx`
```typescript
interface SectorBadgeProps {
  sector: string;                    // e.g. "بنوك", "petrochemical"
  size?: 'sm' | 'md';
  variant?: 'solid' | 'soft';
}
```

#### `<PriceDisplay>` — `primitives/PriceDisplay.tsx`
```typescript
interface PriceDisplayProps {
  value: number | null | undefined;
  currency?: 'EGP' | 'USD' | 'SAR' | 'auto';   // auto = from market context
  change?: number | null;                        // % change
  flash?: boolean;                                // flash on change (uses FlashingPriceCell)
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showCurrency?: boolean;
  format?: 'compact' | 'full';                    // compact = no currency suffix
}
// Wraps existing FlashingPriceCell + FlashingChangeCell + format.ts.
```

#### `<StatCard>` — `primitives/StatCard.tsx` (move + extend)
```typescript
interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'positive' | 'negative' | 'warning' | 'neutral' | 'info';
  subtext?: string;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;                               // shows skeleton
  onClick?: () => void;
}
```

#### `<LoadingState>` — `states/LoadingState.tsx`
```typescript
interface LoadingStateProps {
  size?: 'sm' | 'md' | 'lg' | 'full';              // full = min-h-[60vh]
  label?: string;                                   // default "جارٍ التحميل..."
  icon?: React.ReactNode;                           // default Loader2
  role?: 'status' | 'progressbar';                  // a11y
}
```

#### `<EmptyState>` — `states/EmptyState.tsx`
```typescript
interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;                                   // default "لا توجد بيانات"
  subtitle?: string;
  action?: { label: string; onClick: () => void };
}
```

#### `<ErrorState>` — `states/ErrorState.tsx`
```typescript
interface ErrorStateProps {
  title?: string;                                   // default "حدث خطأ"
  message?: string;
  onRetry?: () => void;                             // shows "إعادة المحاولة" button
  onHome?: () => void;                              // shows "العودة للرئيسية"
}
```

#### `<StockCard>` — `cards/StockCard.tsx`
```typescript
interface StockCardProps {
  ticker: string;
  name?: string;
  price: number | null;
  change?: number | null;                           // %
  volume?: number | null;
  sector?: string;
  sparklineData?: number[];
  onClick?: () => void;
  selected?: boolean;
  variant?: 'default' | 'compact' | 'detailed';
}
// Composes: PriceDisplay + SignalBadge(optional) + SectorBadge(optional) + Sparkline.
```

#### Barrel `index.ts`
```typescript
export { SignalBadge, getSignalStyle, type SignalKind } from './primitives/SignalBadge';
export { SectorBadge } from './primitives/SectorBadge';
export { PriceDisplay } from './primitives/PriceDisplay';
export { StatCard } from './primitives/StatCard';
export { LoadingState } from './states/LoadingState';
export { EmptyState } from './states/EmptyState';
export { ErrorState } from './states/ErrorState';
export { StockCard } from './cards/StockCard';
```

### 2.3 Visual style (fixed per component)

| Component | Radius | Padding | Shadow | Tone colors |
|---|---|---|---|---|
| StatCard | `rounded-xl` | `p-4` | `shadow-sm` | tone→`text-success/danger/warning/foreground` |
| StockCard | `rounded-xl` | `p-3` | `shadow-sm` | change→`text-success/danger` |
| SignalBadge (soft) | `rounded-full` | `px-2 py-0.5` | none | kind→`bg-{tone}/10 text-{tone}` |
| SignalBadge (solid) | `rounded-full` | `px-2 py-0.5` | none | kind→`bg-{tone} text-{tone}-foreground` |
| LoadingState (full) | none | `py-20` | none | `text-muted-foreground` |
| EmptyState | `rounded-lg` | `p-8` | none | `text-muted-foreground` |
| ErrorState | `rounded-lg` | `p-6` | `shadow-sm` | `text-danger` |

---

## 3. Design Tokens

### 3.1 الـ problem الحالي
`globals.css` بـ define `--success`, `--warning`, `--danger` (+foreground) بس `tailwind.config.ts` مش بـ extendهم → `text-success` مش شغّال → devs بـ fallback لـ `text-emerald-600` / `text-red-500`.

### 3.2 الـ fix (extend tailwind config)

**`tailwind.config.ts` — colors.extend (add 3 tokens):**
```typescript
colors: {
  // ... existing ...
  success: {
    DEFAULT: 'hsl(var(--success))',
    foreground: 'hsl(var(--success-foreground))',
  },
  warning: {
    DEFAULT: 'hsl(var(--warning))',
    foreground: 'hsl(var(--warning-foreground))',
  },
  danger: {
    DEFAULT: 'hsl(var(--danger))',
    foreground: 'hsl(var(--danger-foreground))',
  },
},
```

### 3.3 الـ migration mapping (codemod-friendly)

| Before (direct) | After (token) | Notes |
|---|---|---|
| `text-emerald-600` / `text-emerald-700` / `dark:text-emerald-400` | `text-success` | auto dark-mode |
| `bg-emerald-500` / `bg-emerald-600` | `bg-success` | |
| `text-red-500` / `text-red-600` / `dark:text-red-400` | `text-danger` | |
| `bg-red-500` / `bg-red-600` | `bg-danger` | |
| `text-amber-500` / `text-amber-600` / `dark:text-amber-400` | `text-warning` | |
| `bg-amber-500` / `bg-amber-600` | `bg-warning` | |
| `text-blue-500` / `text-blue-600` | `text-info` (add `--info` token) | if we want info tone; else use `text-primary` |
| `text-green-700` / `text-green-800` | `text-success` | legacy green→success |

**Keep `emerald-*` only where it's brand primary** (logo, hero gradients, AuthGateBanner gradient).

### 3.4 Design-tokens file (new — `src/lib/design-tokens.ts`)

```typescript
/**
 * Design Tokens — single source of truth for semantic constants.
 * RESTRUCT DESIGN-SYSTEM-1.
 *
 * Rule: any component that needs a semantic color/spacing/radius/shadow
 * imports from here (or uses the Tailwind token). NO hardcoded hex / direct palette.
 */

export const SEMANTIC_TONES = {
  positive: 'success',
  negative: 'danger',
  warning: 'warning',
  neutral: 'muted',
  info: 'primary',
} as const;

export const RADIUS = {
  sm: 'rounded-md',
  md: 'rounded-lg',
  lg: 'rounded-xl',
  xl: 'rounded-2xl',
  pill: 'rounded-full',
} as const;

export const SPACING = {
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4',
  xl: 'gap-6',
} as const;

export const TYPOGRAPHY = {
  label: { sm: 'text-xs font-medium', md: 'text-sm font-medium', lg: 'text-base font-medium' },
  value: { sm: 'text-sm font-bold', md: 'text-lg font-bold', lg: 'text-2xl font-bold', xl: 'text-3xl font-bold' },
} as const;
```

### 3.5 Hardcoded hex (out of scope — flagged)
الـ 1,359 hex literals في 88 files (غالبيتهم في `lib/visual-templates.ts`, `chart-generator.ts`, `lib/ad-card-generator.ts`, `lib/ad-templates.ts`, `components/market/*ImageCard.tsx`, `modules/education/components/LearningVisuals.tsx`, `modules/simulation/components/SimulationView.tsx`) — دي SVG/canvas template renderers (للـ shareable images). محتاجة palette tokenization منفصلة (phase 2 — مش ضمن الـ phase 1 ده).

---

## 4. Refactor Strategy + Phasing

### 4.1 الـ principle
> **"Build once in the library FIRST, then wire into screens."**
> أي component بـ يتـ used في أكتر من شاشة → يـ built في `src/components/shared/` مرة واحدة + الكل بـ يستورده.

### 4.2 Phasing (5 phases — priority-ordered)

#### Phase 1 — Tokens wire (root-cause fix) 🟢 LOW RISK
- Extend `tailwind.config.ts` with `success/warning/danger` (+ `info`).
- Verify `globals.css` vars are correct (light + dark).
- Add `src/lib/design-tokens.ts`.
- **No component changes yet** — tokens available for new code.
- **Risk:** none (additive).
- **Files touched:** `tailwind.config.ts`, `src/lib/design-tokens.ts` (new).

#### Phase 2 — States primitives (HIGH impact) 🔴 HIGH VALUE
- Build `LoadingState`, `EmptyState`, `ErrorState` in `src/components/shared/states/`.
- Barrel export.
- **Migration target (sample, not exhaustive):** replace `if (loading) return <Loader2 className="animate-spin" />` patterns in:
  - `modules/reports/components/{ReportsView,DailyMarketReport,StockAnalysisReport}.tsx`
  - `modules/dashboard/components/{DashboardView,LiveMonitor,MyStocksBriefing}.tsx`
  - `modules/admin/components/{AdminView,UsersManagement}.tsx`
  - `modules/market-analysis/components/{PersonaTab,PredictionsTab,LiveTrackingTab}.tsx`
- **Acceptance:** grep `Loader2 className.*animate-spin` → ≤20 (from 482).
- **Risk:** MED — each replacement needs visual parity check.

#### Phase 3 — SignalBadge extraction 🔴 HIGH VALUE
- Extract `SIGNAL_STYLES` + `detectSignalKind` from `PredictionCard.tsx` → `src/components/shared/primitives/SignalBadge.tsx`.
- Build `<SignalBadge kind={} />` + export `getSignalStyle()`.
- **Migration target:** replace inline badge rendering in:
  - `modules/market-analysis/components/{PersonaTab,ExpertRecommendationsPanel,CanonicalWhoIsBuyingBanner,MorningBellSection,SingleStockAnalysisView,PredictionsTab}.tsx`
  - `modules/predictions/components/{MakerRadarTab,PredictionTrackingDashboard,DualTrackPredictionsView}.tsx`
  - `modules/radar/components/{MultiMarketRadarTab,ExitRadarTab,SignalTrackingTimeline}.tsx`
  - `modules/portfolio/components/{BagHolderRescuePanel,TopUpRecommendationsPanel}.tsx`
  - `modules/sharia/components/ShariaBadge.tsx` (reuse `getSignalStyle`)
- **Acceptance:** grep `bg-emerald-100 text-emerald-700|bg-red-100 text-red-700` (badge patterns) → ≤30 (from 250+).
- **Risk:** MED — label/emoji mapping must match canonical map.

#### Phase 4 — StatCard adoption + PriceDisplay + StockCard 🟠 MED VALUE
- Move `ui/stat-card.tsx` → `shared/primitives/StatCard.tsx` (keep re-export from old path for back-comat).
- Build `PriceDisplay` (wrap `FlashingPriceCell` + `format.ts`).
- Build `StockCard` (compose `PriceDisplay` + `SignalBadge` + `SectorBadge` + `Sparkline`).
- Build `SectorBadge`.
- **Migration target:** ad-hoc stat cards in 40+ files (see §1.1 row 4) + stock rows in 15+ files (§1.1 row 8).
- **Acceptance:** `<StatCard` import count → ≥30 (from 2).
- **Risk:** MED-HIGH — visual parity across many dashboards.

#### Phase 5 — Codemod: direct colors → tokens 🔴 HIGH VOLUME
- Run codemod (ast-grep or regex) to replace `text-emerald-{500,600,700}` → `text-success`, etc.
- **Migration target:** 5,505 occurrences in 231 files.
- **Batch by module:** dashboard → market-analysis → radar → predictions → portfolio → reports → admin → others.
- **Acceptance:** grep `text-emerald-|text-red-|text-amber-|text-green-|text-blue-` → ≤500 (from 5,505; keep brand-primary emerald in logo/hero).
- **Risk:** LOW per-change but HIGH volume — needs visual smoke-test per module.

### 4.3 Order rationale
1. **Phase 1 (tokens)** First لأن Phases 2-4 بـ تستخدم الـ tokens.
2. **Phase 2 (states)** قبل Phase 3 لأن states بتـ appear في كل شاشة (highest visibility).
3. **Phase 3 (SignalBadge)** قبل Phase 4 لأن StockCard بـ يستخدم SignalBadge.
4. **Phase 4 (cards)** قبل Phase 5 لأن الـ cards بـ compose primitives.
5. **Phase 5 (codemod)** آخر لأنه bulk mechanical + needs the tokens to exist first.

### 4.4 A-P3 alignment
الـ auth/paywall family (`LockModal`, `LoginPromptModal`, `TrialExpiredModal`, `PaywallListener`, `AuthGate`, `LockedContent`) — **already shared + well-isolated** (A-P3 work). الـ rule الجديدة بتفرض إن أي component جديد يـ build في الـ library First. A-P3 satisfied ده (كلهم في `components/auth/` + reusable).

---

## 5. The Rule (ممنوع breaking)

> **ممنوع ad-hoc per screen. كل component بـ يتـ used في أكتر من شاشة → يـ built في `src/components/shared/` مرة واحدة + الكل بـ يستورده.**

### 5.1 Enforcement rules
1. **NEW component rule:** أي component جديد (بعد approval الـ plan ده) لازم يـ built في `src/components/shared/{primitives,states,cards}/` + يـ exported من `index.ts`. ممنوع يـ build ad-hoc جوّه view.
2. **Visual style rule:** كل مكون بـ يستخدم design tokens (`text-success`, `bg-warning`, etc.) — ممنوع `text-emerald-600` / `text-red-500` / hex literals في الكود الجديد.
3. **Migration rule:** أي شاشة بتـ refactor → لازم تـ migrate للـ shared primitives في نفس الـ PR (مش "هنـ migrate بعدين").
4. **Review rule:** lint rule (future) بـ flag direct palette use في `src/components/` + `src/modules/` (AST grep — مش part of phase 1).

### 5.2 Exceptions (documented)
- **Brand primary `emerald-*`:** مسموح في logo, hero gradients, AuthGateBanner (brand identity).
- **SVG/canvas templates:** `lib/visual-templates.ts`, `chart-generator.ts`, `lib/ad-card-generator.ts`, `lib/ad-templates.ts`, `components/market/*ImageCard.tsx`, `modules/education/components/LearningVisuals.tsx`, `modules/simulation/components/SimulationView.tsx` — دي shareable-image renderers محتاجة palette tokenization منفصلة (Phase 2 — future).
- **One-off views:** لو component بـ يتـ used في شاشة واحدة بس → يفضل جوّه الـ view (مش في shared/).

### 5.3 Acceptance criteria (per phase)
كل phase لازم تـحقق:
- `bun run lint` = 0 errors.
- browser proof: الـ screens اللي اتـ refactorت بترندر بنفس الـ visual (parity check).
- grep metrics (per phase §4.2).
- worklog append (Task ID DESIGN-SYSTEM-1, phase N).

---

## 6. الـ next steps (after John's approval)

1. John يوافق على الـ plan (أو يـ edit الـ priorities).
2. Alpha يبدأ Phase 1 (tokens wire — LOW risk).
3. بعد كل phase: diff + lint + browser proof → John verify → push (Rule 75 lifted per owner directive 2026-10-18).
4. الـ A-P3 components اللي اتعملت (LockModal, LoginPromptModal, TrialExpiredModal) — هتـ migrate للـ tokens في Phase 5 (مش قبل — عشان مش نكسر شغل A-P3).

---

**Alpha — بنبنى هيكل سليم، مش بنرص طوب. الـ plan ده الـ blueprint. أي شغل جديد يبدأ من الـ library.**
