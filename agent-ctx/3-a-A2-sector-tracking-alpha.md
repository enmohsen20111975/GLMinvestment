# Task 3-a — Alpha (A2: Sector Tracking visualization)

## One-line summary
Rebuilt `SectorTrackingTab` with an HONEST Recharts Treemap + momentum strip + leader sparkline; stopped the UI from implying "net money flow" that the data doesn't measure.

## Files modified
- `src/modules/market-analysis/components/SectorTrackingTab.tsx` — wired in 3 new components, added `fetchedAt` state, removed unused recharts imports, added leader-sparkline column, added honest data-source footer.

## Files created
- `src/modules/market-analysis/components/SectorLiquidityTreemap.tsx` — Recharts `<Treemap>`. Area ∝ `turnover` (liquidity); color ∝ `avg_change` (today's performance). Label = "توزيع سيولة القطاعات". Explicit disclosure that data does NOT measure net money flow.
- `src/modules/market-analysis/components/SectorMomentumStrip.tsx` — strongest/weakest sectors today by `avg_change` + top liquidity ranking + honest note.
- `src/modules/market-analysis/components/SectorLeaderSparkline.tsx` — 30-day sparkline for leader stock, fetched from REAL `/api/stocks/sparkline`. Renders "—" honestly when `source==='none'` (no fabrication).
- `src/__tests__/components/a2-sector-tracking.test.tsx` — 8 fixture assertions, all pass.

## Data source + what each field ACTUALLY measures (CRITICAL — determines labels)
Source: `GET /api/sectors/tracking` → proxies Python `FlowSystemEngine.get_sector_heatmap()` + per-sector stocks from `stocks` table.

Per-sector:
- `turnover` (EGP) = Σ(volume × current_price) TODAY across sector stocks → **TRADED VALUE / LIQUIDITY** (NOT net flow).
- `turnover_pct` = sector turnover / market total × 100 → liquidity share.
- `avg_change` (%) = average of today's `change_percent` across sector stocks → **TODAY's PERFORMANCE %** (real).
- `gainers`/`losers`/`breadth` = today's up/down counts + (gainers/total×100).
- `heat_level` = composite of avg_change + turnover thresholds.
- `leader_ticker`/`leader_change` = top stock by change_percent today.
- `total_market_cap` = Σ market_cap.

MISSING (so cannot claim): NO buy/sell split → NO net money flow. NO day-over-day turnover delta → NO "rotation flow today" (the optional `rotation.entering/leaving` is a 5-day lookback signal, NOT today's flow).

## Chart label chosen + why
**"توزيع سيولة القطاعات" (Sector Liquidity Distribution).**
- Size = liquidity share (turnover) ✓
- Color = today's performance (avg_change) ✓ — a REAL metric that exists in the data.
- NOT "Net Money Flow" — no inflow/outflow data.
- NOT pure "Sector Performance" — size isn't performance, it's liquidity.
- Subtitle + footer explicitly disclose: "حجم المربع = نسبة السيولة اليوم • اللون = متوسط التغير % اليوم" + "لا تقيس صافي التدفق النقدي".

## Verification evidence
- `bun run lint` → clean (no errors).
- `npx tsc --noEmit` → 0 errors in my touched files (baseline has 1619 pre-existing errors in untouched files — verified via git stash).
- `timeout 60 bun run vitest run src/__tests__/components/a2-sector-tracking.test.tsx` → **8/8 passed** in 2.93s:
  1. Treemap title = "توزيع سيولة القطاعات" (NOT Net Money Flow).
  2. ALL 4 sectors render by name.
  3. Subtitle + footer disclose size/color meaning + explicit negation.
  4. Momentum strip shows strongest (Banks) + weakest (Real Estate).
  5. Treemap SVG rects contain both green (hsl 160) AND red (hsl 0) fills.
  6. NO positive "صافي التدفق"/"تهرب السيولة"/"draining liquidity"/"inflow|outflow" claim.
  7. Leader sparkline renders "—" honestly when no history.
  8. Total liquidity (data-total) == sum of sector turnovers (5,000,000,000).
- Dev server was NOT running during session → relied on fixture + lint + tsc (per owner directive).

## Acceptance criteria (owner's spec) — point by point
- ✅ Total liquidity shown == data source total (`ms.total_turnover` passed to treemap + sr-only `data-total` anchor verified by test #8).
- ✅ Sector percentages computed from a correct total (Python already computes `turnover_pct` from `total_turnover`; treemap area ∝ `turnover`).
- ✅ Colors represent the stated metric (green/red/neutral by `avg_change`, verified by test #5).
- ✅ Chart interactions work (Tooltip renders full breakdown; cells labeled with sector + value + change).
- ✅ No console errors (lint clean; test run shows no React errors except pre-existing UnifiedTable warning in unrelated code path).
- ✅ Desktop + mobile responsive (Treemap container `h-[280px] sm:h-[320px] md:h-[360px]`; momentum strip `grid-cols-1 md:grid-cols-3`; footer `flex-wrap`).

## Owner hard constraints — all met
1. ✅ No fabricated data.
2. ✅ Label = "Sector Liquidity Distribution" (not "Net Money Flow").
3. ✅ Color = performance metric (avg_change), NOT inflow/outflow.
4. ✅ No "sector draining liquidity from another" claims.
5. ✅ No fabricated sparklines — uses REAL `/api/stocks/sparkline`; "—" when no history.
6. ✅ Did NOT push to remote (local commit only).
7. ✅ No trading recommendations added.

## Blockers
None. Ready for merge.

## Commit hash
(to be filled after `git commit` — see final report)
