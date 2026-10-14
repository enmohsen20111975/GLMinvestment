---
name: Sovereign Terminal
colors:
  surface: '#111413'
  surface-dim: '#111413'
  surface-bright: '#373a38'
  surface-container-lowest: '#0c0f0e'
  surface-container-low: '#191c1b'
  surface-container: '#1d201f'
  surface-container-high: '#282b29'
  surface-container-highest: '#323534'
  on-surface: '#e1e3e1'
  on-surface-variant: '#bbcabf'
  inverse-surface: '#e1e3e1'
  inverse-on-surface: '#2e3130'
  outline: '#86948a'
  outline-variant: '#3c4a42'
  surface-tint: '#4edea3'
  primary: '#4edea3'
  on-primary: '#003824'
  primary-container: '#10b981'
  on-primary-container: '#00422b'
  inverse-primary: '#006c49'
  secondary: '#80d5cb'
  on-secondary: '#003733'
  secondary-container: '#007068'
  on-secondary-container: '#9af0e5'
  tertiary: '#89ceff'
  on-tertiary: '#00344d'
  tertiary-container: '#23acf1'
  on-tertiary-container: '#003d59'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#6ffbbe'
  primary-fixed-dim: '#4edea3'
  on-primary-fixed: '#002113'
  on-primary-fixed-variant: '#005236'
  secondary-fixed: '#9cf2e8'
  secondary-fixed-dim: '#80d5cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#00504a'
  tertiary-fixed: '#c9e6ff'
  tertiary-fixed-dim: '#89ceff'
  on-tertiary-fixed: '#001e2f'
  on-tertiary-fixed-variant: '#004c6e'
  background: '#111413'
  on-background: '#e1e3e1'
  surface-variant: '#323534'
typography:
  display-hero:
    fontFamily: Outfit
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  display-hero-mobile:
    fontFamily: Outfit
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Outfit
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Outfit
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
  headline-md:
    fontFamily: Outfit
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  headline-sm:
    fontFamily: Outfit
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Outfit
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Outfit
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Outfit
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  financial-mono-xl:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.03em
  financial-mono-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.01em
  financial-mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-ticker:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-desktop: 1rem
  margin: 1rem
  margin-desktop: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system delivers an institutional-grade financial intelligence interface tailored for the Egyptian Exchange (EGX), regional Gulf equity markets (Tadawul, ADX, DFM), and digital asset ecosystems. It reconciles high-density analytical instrumentation—reminiscent of professional Bloomberg Terminal workstations—with a dignified, culturally native Arabic-first (RTL) reading hierarchy.

The visual direction rejects generic fintech consumerism in favor of austere, high-contrast, data-dense clarity. The emotional atmosphere is authoritative, precise, and unyielding. Information architecture prioritizes tabular scanning, instantaneous delta recognition, and mathematical legibility over decorative embellishment. The platform operates on a dark-first terminal aesthetic while maintaining an equally calibrated, high-contrast daylight mode for trading desks and institutional compliance offices.

## Colors

The palette establishes an emerald sovereign identity, eliminating corporate blues and indigos to avert visual dilution across regional market displays.

- **Primary (`#10B981`)**: Emerald-600 operates as the primary signature accent, brand beacon, and active system indicator. Used for primary execution CTAs, key focus states, active tab indicators, and real-time execution markers.
- **Secondary (`#0F766E`)**: Deep emerald/pine used for secondary structural accents, segmented chart fill gradients, and high-priority grouping boundaries.
- **Tertiary (`#0EA5E9`)**: Sky-500 reserved strictly for informational indicators, neutral status badges, liquidity notices, and system alerts that must not be conflated with directional profit/loss.
- **Neutral Canvas (`#0C0F0E`)**: An obsidian canvas with an emerald undertone (`hsl(160, 17%, 5%)`). Card and container surfaces sit at `#131817` (`hsl(165, 11%, 8%)`), bordered with deep emerald-slate rules (`#1E2623`).
- **Semantic Financial States**:
  - Gain/Market Up: `#22C55E` (Emerald-Green-500)
  - Loss/Market Down: `#EF4444` (Red-500)
  - Amber Caution/Halt: `#F59E0B` (Amber-500)
  - Info/Notice: `#0EA5E9` (Sky-500)
- **Light Mode Adjustments**: When operating in light mode, background surfaces transition to `#F8FAFC` and `#FFFFFF`, with borders dialed to `#E2E8F0` and muted text to `#64748B`. Market gain/loss values retain rigid contrast rules against both surfaces.

## Typography

The platform utilizes a tri-tier typography hierarchy designed for multi-market density and RTL-native legibility:

1. **Arabic Text Stack (Body, Section Headers, Titles)**: Managed under `'Cairo', 'Tajawal', sans-serif`. Cairo provides geometric stability and open counters, ensuring high legibility for technical Arabic financial terms (e.g., صافي القيمة السوقية، نسبة السيولة، السعر المرجعي) at dense scales (11px–14px).
2. **Latin Alphanumeric Stack**: Driven by `'Outfit'`, delivering modern architectural balance for English market counters, ticker names (e.g., COMI, ARAMCO), and platform branding.
3. **Financial Data Stack**: Driven strictly by `'JetBrains Mono'`. All price streams, percentage deltas, depth ladder volumes, and currency values use this monospace font with forced OpenType `tabular-nums` (`font-feature-settings: "tnum" 1, "zero" 1`). This prevents layout jitter during real-time tick streaming.
4. **Bi-directional Alignment**: In RTL layout modes, text titles, card labels, and table metadata align right, while monospace currency values and percentage shifts maintain uniform tabular column metrics aligned to the opposing edge for rapid visual scanning.

## Layout & Spacing

The layout is built upon an ultra-dense, responsive fluid-grid structure optimized for simultaneous multi-panel market monitoring.

- **Layout Model**: A 12-column fluid grid system across desktop viewports (`>=1280px`), adapting to an 8-column layout on tablets (`768px - 1279px`) and a 4-column column stack on mobile (`<768px`).
- **Density Control**: Default desktop layout incorporates tight gutters (`0.75rem` to `1rem`) and compact padding scales to maximize above-the-fold analytical content. A dedicated Market Monitor workspace can engage a compressed "Density Mode" where vertical row padding drops to `0.375rem`.
- **RTL Directionality**: The visual anchor starts on the top right: Global Navigation > Market Pulse Ticker Bar > Order Book / Watchlist on the right rail > Interactive Chart Canvas in the center > Execution and Technical Matrix on the left rail.
- **Adaptive Reflow**: On viewports below 1024px, the three-column terminal snaps into tabbed viewports: Tab 1 (Chart & Price Action), Tab 2 (Unified Order Book & Depth), Tab 3 (Financial Matrix & Trades).

## Elevation & Depth

This system avoids soft, floating elevation shadows, opting for structural, high-discipline containment:

- **Dual-Layer Boundary Hierarchy ("Wave 8")**: Containers, data cards, and terminal modules use a compound boundary technique consisting of an inner micro-shadow coupled with an explicit, low-contrast structural ring (`box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.45); border: 1px solid rgba(255, 255, 255, 0.08);`). In dark mode, this highlights card geometry without light pollution.
- **Layer 0 (Canvas Base)**: `#0C0F0E` - The global floor for tickers, canvas margins, and dock frames.
- **Layer 1 (Card & Section Containers)**: `#131817` - Houses charts, data tables, and KPI metric clusters with sharp boundary lines (`#1E2623`).
- **Layer 2 (Overlays & Dialogs)**: `#18201E` - Reserved for dropdown filters, buy/sell confirmation modals, context menus, and trade execution tickets. Elevated with `box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(16, 185, 129, 0.2)`.
- **State Highlighting**: Focused or actively updated modules generate an emerald accent perimeter: `ring-1 ring-emerald-500/40`.

## Shapes

The platform balances institutional precision with modern interface comfort.

- **Data Containers & Terminal Panels**: Standardized at `12px` (`rounded-xl` / `0.75rem`). This softens continuous grid clusters without compromising terminal density.
- **Action Controls & Input Fields**: Buttons, text inputs, search selectors, and dropdown toggles adopt an exact `8px` (`0.5rem`) radius.
- **Inline Badges, Status Dots, & Ticker Capsules**: Inline indicators (e.g., market session status "مفتوح / جلسة تداول", live gain/loss capsules) use `4px` or full pill shaping depending on contextual placement.
- **Dividers & Table Borders**: Flat `1px` structural borders with no diagonal cuts or skeuomorphic bevels.

## Components

### 1. UnifiedTable (shadcn/ui-Style Institutional Grid)
- **Structure**: High-density tabular layout with fixed headers, sticky column pins (Symbol/الرمز pinned to the right edge in RTL), zebra-striping via alternate background tints (`#131817` vs `#151B1A`), and subtle border separators (`#1E2623`).
- **Data Alignment**: Arabic metadata and instrument names right-aligned; tabular monospace numbers (`JetBrains Mono`), bid/ask spreads, and volumes left-aligned in RTL to align numerical decimals.
- **Interactions**: Sort indicators on column headers; quick filter capsules; integrated pagination and inline row sparks for intra-day trend previews.

### 2. KPI Stat Cards (Market Overview & Metrics)
- **Structure**: Surface `#131817` with 12px corners and 1px `#1E2623` borders.
- **Hierarchy**: Metric title in Arabic (`Cairo`, 12px, muted slate); main figure in monospace tabular numerals (`JetBrains Mono`, 24px, semibold); footer containing directional badge (`#22C55E` gain or `#EF4444` loss) with accompanying arrow and trading volume.

### 3. Market Pulse Ticker (Real-Time Ribbon)
- **Structure**: Continuous horizontal marquee or scrolling ticker bar across the terminal header.
- **Attributes**: Indices (EGX30, EGX70, TASI, Crypto Top 10) displayed with symbol name, current index level, absolute point change, and percentage shift. Flashes a 300ms emerald or crimson outline tint upon tick event updates.

### 4. Buttons & Action Triggers
- **Primary Execution (Buy / شراء)**: `#10B981` background, `#042F2E` text, 8px radius, medium weight (`Outfit` or `Cairo`), zero shadow, crisp state transition on hover (`#059669`).
- **Destructive Execution (Sell / بيع)**: `#EF4444` background, `#FFFFFF` text, 8px radius.
- **Secondary / Ghost**: Outline `#1E2623`, background transparent, text `#E2E8F0`, hover background `#1E2623`.

### 5. Input Fields & Order Entry
- **Structure**: Input fields feature dark backgrounds (`#0C0F0E`), 8px radius, structural border `#2A3632`. Active focus state triggers an emerald edge ring (`ring-1 ring-emerald-500`).
- **Numeric Steppers**: Embedded increment/decrement controls with monospaced digit display and Arabic currency suffixes (ج.م, ر.س, د.إ, USD) anchored contextually.

### 6. Interactive TradingView-Style Chart Frame
- **Surface**: Background integrated into terminal canvas `#131817`.
- **Canvas Integration**: Crosshair price markers read across the y-axis (pinned to left or right based on user locale preference); time axis markers read across the bottom. Control bars for intervals (1D, 1W, 1M, 1Y) styled as segmented buttons with emerald active states.