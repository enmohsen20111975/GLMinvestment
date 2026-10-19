# Task: PHASE-4-FRONTEND
## Agent: Z.ai Code (frontend-developer)

## Goal
Phase 4 of EMERGENCY_REMEDIATION_PLAN.md — Create a shared `<PredictionCard>` primitive and migrate the top 5 prediction-card components to use it. Addresses the "22 prediction card components with no shared primitive" finding from the engineering audit.

## What Was Done

### 1. NEW FILE: `src/components/shared/PredictionCard.tsx` (524 LOC)
A reusable card primitive implementing `PredictionCardProps`:
- `ticker`, `name?`, `nameAr?`, `signal`, `signalAr?`
- `entryPrice`, `targetPrice`, `stopLoss`
- `riskReward?`, `confidence?`, `masterScore?`, `evidenceCount?`
- `technicalExplanation?` (summary/candlestick/smc/volume/patterns/proofs[]/riskNote)
- `onClick?`, `showTechnical?` (default true), `compact?` (no expand button)
- `actionSlot?` (right-aligned share buttons etc.)
- `footer?` (extra row under price section)
- `signalKind?` (override auto-detect: buy/sell/hold/strong_buy)
- `rankBadge?` (#1, #2, …), `className?` passthrough

Features:
- Signal badge with 4 styles (BUY=green, SELL=red, HOLD=amber, STRONG_BUY=emerald)
- Price grid: entry / target (emerald) / stop (rose)
- Metrics row: confidence (color-graded), master_score, R/R badge, evidence count, upside %, risk %
- Collapsible technical section (radix Collapsible): summary + candlestick + SMC + volume + patterns + proofs list + riskNote
- Risk note always visible as a warning banner (high-priority)
- Compact mode hint when tech exists but `compact=true`
- RTL Arabic, responsive (mobile-first), keyboard-accessible (`role="button"` + `tabIndex`)
- Neutral professional tone (Rule 31 — no hype)
- Built on shadcn/ui `Card`, `Badge`, `Collapsible` + `lucide-react` icons + `cn()` from `@/lib/utils`

### 2. Migration #1: `src/components/market/PredictionsImageCard.tsx`
- Replaced inline `<table>` per-stock rendering (each row had logo, ticker, prices, pnl, status) with `<PredictionCard compact />` in a 2-column grid.
- Branded PNG export wrapper (teal gradient header + stats bar + footer with official links) preserved unchanged.
- Status outcome (TARGET_HIT / STOPPED / PENDING) and current-price + pnl% passed via `footer` slot.
- `PredictionPick` interface kept stable for callers; signal auto-derived from status when `pick.signal` is missing.
- Stats strip (total / hits / winRate / avgPnl) kept page-specific.

### 3. Migration #2: `src/components/predictions/PredictionTrackingView.tsx`
- Replaced inline 10-column `<Table>` (السهم / تاريخ / دخول / وقف / هدف / R:R / حالى / فرق / عائد / حالة) with a responsive grid of `<PredictionCard compact />`.
- Status badge (pending / target_hit / stop_hit / expired), pick date, current price, diff%, pnl% preserved via `footer` slot.
- Page-level filter (status `<Select>`) kept outside card per migration rules.
- Removed unused imports: `Table*`, `Tooltip*`, `Sparkles`.
- StatCard summary (total / pending / successRate / failureRate) kept as-is (separate component).
- Signal kind auto-detected from geometry: BUY if target > entry, else SELL.

### 4. Migration #3: `src/components/recommendations/AiRecommendations.tsx` (V2BestOpportunities section only)
- Replaced inline 4-row card layout (header row / price row / stop+time+risk+liquidity row / confidence+share row) inside `V2BestOpportunities` with `<PredictionCard compact />`.
- V2 `recommendation` enum (Strong Buy / Buy / Hold / Avoid / Strong Avoid) → `signalKind` (strong_buy/buy/hold/sell).
- Preserved:
  - `ShareButton` → passed via `actionSlot` (with click-stop propagation)
  - Time horizon + fair value + cap badge + risk badge + liquidity badge + confidence breakdown tooltip + data-reliability warning → all passed via `footer`
  - `onClick={() => loadStockDetail(stock.ticker)}` preserved
- Other sections (V2StocksTable, V2QuickSummary, V2ConfidenceDetail, V2DiversificationWarning, fallback OldApiComponents) untouched — out of Phase 4 scope.

### 5. Migration #4: `src/components/recommendations/PublishedPredictions.tsx`
- Replaced inline `<Card><CardContent>` per prediction with `<PredictionCard compact />` in a 2-column grid.
- Score, market emoji, prediction date, and `reasons` array passed via `footer` slot.
- Signal badge, entry/target/stop, confidence handled by shared component.
- Stats grid (total / avg_score / avg_confidence / buy_count) kept as page-level summary.

### 6. Migration #5: `src/components/predictions/PicksManagementView.tsx` (DailyPickCard sub-component)
- Replaced inline 6-section DailyPickCard (rank badge / header w/ tier / confidence bar / price grid / potential-risk footer / explosive badge) with `<PredictionCard compact />`.
- Tier badge (TOP_PICK / STRONG / WATCH / SKIP) passed via `actionSlot` (preserves Crown/Star/Eye/XCircle icons + colors).
- Persona, potential %, risk %, `target_price_2`, explosive label preserved via `footer`.
- `ManagementRow` (open positions advice) kept as-is — different concept (action/urgency row, not a prediction card).
- StatCard summary + Section 2 management card kept untouched.

## Verification
- ✅ `bun run lint` — clean after each of the 6 commits (component creation + 5 migrations)
- ✅ `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` — 200 after each step
- ✅ `grep -rln "PredictionCard" src/` shows:
  - `src/components/shared/PredictionCard.tsx` (new shared component)
  - `src/components/market/PredictionsImageCard.tsx` (migrated)
  - `src/components/predictions/PredictionTrackingView.tsx` (migrated)
  - `src/components/recommendations/AiRecommendations.tsx` (migrated)
  - `src/components/recommendations/PublishedPredictions.tsx` (migrated)
  - `src/components/predictions/PicksManagementView.tsx` (migrated)
  - `src/components/analysis/market-analysis/CryptoPredictionsTab.tsx` (unrelated — local `CryptoPredictionCard` function, not an import of the shared component)

## Rules Compliance
- ✅ Rule 4 (no new screens) — only added one shared component + extended existing cards
- ✅ Rule 28 (NO-DUPLICATION) — one canonical shape for ticker + signal + entry/target/stop + R/R
- ✅ Rule 31 (NO-HYPE-LANGUAGE) — neutral, professional Arabic tone (e.g. "العائد المتوقع", "المخاطرة", "احتفاظ")
- ✅ Rule 32 (CLIENT-VS-SYSTEM) — frontend-only changes, no backend touched
- ✅ Rule 52 (UNIFIED-REUSABLE-COMPONENTS) — extended shared primitives, replaced 5 inline card patterns
- ✅ shadcn/ui components used (Card, Badge, Collapsible)
- ✅ `cn()` from `@/lib/utils` for conditional classes
- ✅ `lucide-react` icons (Target, Shield, TrendingUp/Down, ArrowUp/DownCircle, Gauge, Activity, Layers, ShieldAlert, ChevronDown, etc.)
- ✅ RTL Arabic layout (dir="rtl" + Arabic labels)
- ✅ Responsive (grid breakpoints sm/md/lg/xl)
- ✅ Keyboard-accessible (interactive card has role="button" + tabIndex + Enter/Space handlers)
- ✅ No hype language — uses neutral terms like "العائد المتوقع", "المخاطرة", "احتفاظ"

## Commits Pushed to `origin/main`
1. `5b77434` feat: create shared PredictionCard primitive (Phase 4, Rule 52)
2. `78f3b7b` refactor: migrate PredictionsImageCard to use shared PredictionCard (Rule 52)
3. `bc6a65c` refactor: migrate PredictionTrackingView to use shared PredictionCard (Rule 52)
4. `331efa2` refactor: migrate AiRecommendations (V2BestOpportunities) to shared PredictionCard (Rule 52)
5. `c2f91f9` refactor: migrate PublishedPredictions to shared PredictionCard (Rule 52)
6. `3f01834` refactor: migrate PicksManagementView (DailyPickCard) to shared PredictionCard (Rule 52)

Each commit was preceded by `git stash && git pull --rebase origin main && git stash pop` per the rules.

## Stage Summary
- ✅ 1 new shared component created (`PredictionCard.tsx`)
- ✅ 5 prediction card components migrated to use it (5 of the top 5 from the audit)
- ✅ All lint clean, HTTP 200, no broken callers
- ✅ Page-level logic kept outside the card (filters, stats, sorts all untouched)
- ✅ Special features preserved via optional props (actionSlot, footer, rankBadge, signalKind)
- ⏳ Next: Phase 4 continues with remaining ~17 prediction card components + CandlestickChart + ShareableImageCard consolidation
