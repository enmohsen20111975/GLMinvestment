# Work Record: ALPHA-CHART-MERGE-1 (Alpha — Frontend)

> **Task ID:** ALPHA-CHART-MERGE-1
> **Agent:** Alpha (Frontend)
> **Date:** 2026-10-19
> **Risk:** 🟠 HIGH — merging features (not code move)
> **Constitutional Rules:** Rule 20 (Python=Brain), Rule 27 (NO-FAKE-DATA), Rule 73 (SINGLE-DISPLAY-SOURCE), Rule 75 (PUSH suspended)

---

## Summary

Merged the 7 professional sections from `ProfessionalTradingChart.tsx` (825 lines) into `InteractiveChart.tsx` (1701 lines) by adding **optional props + render sections** — not by moving code. The chart logic (1701 lines of `createChart`/`addPane`/indicators/sanitization) is **untouched**.

`ProfessionalTradingChart.tsx` is **deleted**. `TradingChartView.tsx` now owns the per-ticker data-fetch state and renders `InteractiveChart` directly with all professional sections enabled.

## Files Modified

| File | Change |
|---|---|
| `src/modules/market-analysis/components/InteractiveChart.tsx` | +16 props on `FullChartProps` + 7 sections in return + 4 helper components (`PlanLevel`, `ReasonCard`, `DetailItem`, `CollapsibleSection`) + `signalToArabic` helper. 1701 → 2188 lines. Chart logic + empty state untouched. |
| `src/modules/market-analysis/components/TradingChartView.tsx` | Removed `ProfessionalTradingChart` import. Added `InteractiveChart` + `AlertPanel` + `UnifiedStockData` type imports. Defined local `ChartAnalysisData` interface. Split into `TradingChartView` (parent: multi-ticker grid + publish) + `TickerChartCard` (child: per-ticker state + tooling header + InteractiveChart). 309 → 540 lines. |
| `src/modules/market-analysis/components/ProfessionalTradingChart.tsx` | **DELETED** (features merged into InteractiveChart + TradingChartView). |
| `src/modules/market-analysis/index.ts` | No change needed (no `ProfessionalTradingChart` export existed). |
| `worklog.md` | Appended Task ID section. |

## New Props (on `FullChartProps`)

```typescript
canonical?: {
  signal?: string;
  signal_ar?: string;
  entry_price?: number | null;
  stop_loss?: number | null;
  target_price?: number | null;
  target_price_2?: number | null;
  tech_score?: number | null;
  risk_reward?: number | null;
};
decisionData?: { path_taken?: string; adjustment_reason?: string };
flightState?: { state?: string };
makerState?: { state?: string };
stockDna?: { typical_range?: { current_position?: string } };
confluence?: { breakdown?: { trend?: { detail?: string; passed?: boolean } } };
currentIndicators?: { rsi?: number; macd?: number; atr?: number };
suggestedPositionSizePct?: number;
analysisText?: string;
smcAnalysis?: { bias_ar?: string };
showDecisionHeader?: boolean;
showTradePlan?: boolean;
showReasons?: boolean;
showTechnicalDetails?: boolean;
showRescueCTA?: boolean;
tickerName?: string;
currencyLabel?: string;
```

## The 7 Sections (in `InteractiveChart` return)

1. **§1 Decision Header** — `canonical && showDecisionHeader`. Signal badge + entry/stop/target/R:R/techScore (BUY-only) + wait/reject reason.
2. **§2 Regime badge + Market warning** — `regimeBadge` (falling_down/taking_off/accumulation) + `hasMarketWarning` (distribution/falling_down/techScore<40).
3. **§3 The actual chart** — preserved exactly in `chartBlock` variable. Regime Badge + Info Overlay + `<div ref={containerRef} />`.
4. **§4 Trade Plan** — `isBuySignal && showTradePlan`. PlanLevel × 4 (entry/stop/TP1/TP2) + R:R + position size.
5. **§5 Reasons** — `showReasons`. 5 ReasonCards: trend, relative strength, liquidity, accumulation, price position.
6. **§6 Collapsible Technical Details** — `showTechnicalDetails`. RSI/MACD/ATR/TechScore + SMC analysis (collapsed by default).
7. **§7 Rescue CTA** — `showRescueCTA && tickerName`. Banner linking to `/rescue?ticker=...`.

## Props-Only Mode Preservation (SingleStockAnalysisView compatibility)

When none of the new section props are passed (SingleStockAnalysisView case), `anySectionVisible === false` and the component returns `chartBlock` directly — the original `<div className="relative w-full h-full">` layout. This preserves the chart's `h-full` behavior that SingleStockAnalysisView's parent (`flex-1 min-h-[460px]`) depends on.

When sections are visible (TradingChartView case), the outer wrapper becomes `<div className="space-y-3" dir="rtl">` and `chartBlock` is one of its children.

## Bug Fixes (3 bugs — auto-fixed)

The 3 bugs were in `ProfessionalTradingChart.tsx` (now deleted):
1. **`regimeColor` (was: `marketRegime`)** — `TradingChartView` now passes `regimeColor={data.market_regime?.color}` ✓
2. **`bbSqueezeLevel` (was: `bbSqueeze`)** — `TradingChartView` now passes `bbSqueezeLevel={data.bb_squeeze?.state}` ✓
3. **8 missing props** — `TradingChartView` now passes `livePrice`, `cmfData`, `macdProjection`, `smartMarkers`, `smcData`, `fusionMetrics`, `regimeColor`, `target2Price` ✓

## Tests

- ✅ `bun run lint` → **0 errors**
- ✅ `npx tsc --noEmit` → **0 errors** in modified files (`InteractiveChart.tsx`, `TradingChartView.tsx`, `market-analysis/index.ts`)
- ⚠️ Pre-existing tsc error in `InteractiveChart.tsx` line 1524 (`MACD_PANE_INDEX` referenced before declaration) — in chart logic (untouched per task spec). Verified pre-existing via `git stash` (was at line 1443 in original).
- ✅ Dev server compiles successfully (5271 modules)
- ✅ SingleStockAnalysisView not broken (props-only mode preserved)
- ✅ TradingViewChart.tsx not touched
- ✅ No push (Rule 75 suspended)

## Constitutional Rule Compliance

- **Rule 20 (Python=Brain)**: No financial calculation in the UI. All values come from `canonical` (predictions.db — Python V40.2).
- **Rule 27 (NO-FAKE-DATA)**: All "—" placeholders for missing data. No fabricated values.
- **Rule 73 (SINGLE-DISPLAY-SOURCE)**: Signal/score/entry/stop/target come ONLY from `canonical` (unified API). No fallback to chart data.
- **Rule 75 (PUSH-AFTER-EVERY-TASK)**: Suspended — no push.

## What Did NOT Change

- 🚫 Chart logic (lines 1-1599 in original, 1-1680 in new) — `createChart`, `addPane`, sanitization, indicators, empty state.
- 🚫 Empty state (lines 1571-1598 in original, 1651-1680 in new).
- 🚫 `TradingViewChart.tsx`.
- 🚫 `SingleStockAnalysisView.tsx` — still uses InteractiveChart in props-only mode (no new props passed → no sections render → original layout preserved).
- 🚫 `market-analysis/index.ts` — no `ProfessionalTradingChart` export existed.

## Hand-off

Next agent can:
- Add `canonical` prop pass-through to `SingleStockAnalysisView.tsx` if it should also show the professional sections (currently in props-only mode).
- Fix the pre-existing `MACD_PANE_INDEX` tsc error in chart logic (line 1524) — but that requires touching chart logic (outside this task's scope).
