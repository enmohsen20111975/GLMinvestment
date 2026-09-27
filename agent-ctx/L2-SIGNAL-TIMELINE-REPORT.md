# L2-SIGNAL-TIMELINE — Report

**Task ID:** L2-SIGNAL-TIMELINE
**Agent:** Frontend Engineer (signal tracking timeline)
**Date:** 2026-09-27
**Status:** ✅ Complete

---

## Summary

Built a **Signal Tracking Timeline** feature that visualises the journey of a tracked stock from the moment it entered the radar until now. The timeline shows entry price → current price with target progress bars, milestone events, and a checklist of achieved/pending milestones.

---

## New Files Created

| File | LOC | Purpose |
|------|-----|---------|
| `src/app/api/maker-radar/timeline/route.ts` | 559 | GET endpoint returning the timeline JSON for a tracked ticker |
| `src/components/predictions/radar/SignalTrackingTimeline.tsx` | 770 | React component (header + SVG chart + 3 progress bars + vertical timeline + milestones checklist + edge-case cards) |
| `src/__tests__/radar/SignalTrackingTimeline.test.tsx` | 302 | Vitest + Testing Library suite — 13 tests |
| **Total new LOC** | **1,631** | |

## Modified Files

| File | LOC delta | Change |
|------|-----------|--------|
| `src/components/predictions/MakerRadarTab.tsx` | +9 | Import `SignalTrackingTimeline` + render it inside `StockDetailDrawer` between `TradingPlanSection` and `LiquidityFootprintCard`, gated by `detail.tracking?.isTracked` |

---

## API Endpoint Shape

**`GET /api/maker-radar/timeline?ticker=COMI&days=60`**

### Happy path (success: true)
```jsonc
{
  success: true,
  ticker: "COMI",
  entry:    { date: "2026-09-01", price: 12.50 },
  current:  { date: "2026-09-27", price: 14.20, change_pct: 13.6, days_tracked: 26 },
  target_1: { price: 14.50, pct: 16.0,  status: "approaching", progress_pct: 94 },
  target_2: { price: 16.20, pct: 29.6, status: "pending",     progress_pct: 46 },
  stop_loss:{ price: 11.90, pct: -4.8, status: "safe",       progress_pct: 12 },
  timeline: [
    { date: "2026-09-01", price: 12.50, event: "signal",    label: "دخل الرادار", note: "بداية المتابعة" },
    { date: "2026-09-04", price: 12.80, event: "milestone", label: "+2.4%",       note: null },
    { date: "2026-09-08", price: 13.50, event: "milestone", label: "+8.0%",       note: "اقترب من الهدف الأول" },
    { date: "2026-09-15", price: 13.20, event: "alert",     label: "-2.2%",        note: "تصحيح طفيف" },
    { date: "2026-09-27", price: 14.20, event: "current",   label: "+13.6%",      note: "الآن" },
  ],
  milestones: [
    { label: "دخل الرادار",          date: "2026-09-01", price: 12.50, reached: true },
    { label: "قوة الإشارة ارتفعت",    date: "2026-09-05", price: 12.90, reached: true },
    { label: "حجم انفجاري",           date: "2026-09-08", price: 13.50, reached: true },
    { label: "وصل الهدف الأول",       date: null,         price: null, reached: false },
    { label: "وصل الهدف الثاني",      date: null,         price: null, reached: false },
  ],
  prediction: { target_price: 14.5, stop_loss: 11.9, signal: "BUY", prediction_date: "2026-09-01" },
  signal_events_count: 0,
  price_points: 19,
  computed_at: "2026-09-27T21:34:00.000Z"
}
```

### Edge cases
| Case | HTTP | Body |
|------|------|------|
| `ticker` missing | 400 | `{success:false, error:"ticker query param is required"}` |
| Not tracked | 200 | `{success:false, not_tracked:true, ticker, error:"السهم مش متابع — أضفه للمتابعة عشان تشوف الخط الزمني"}` |
| Entry price missing | 200 | `{success:false, entry_price_missing:true, ticker, entry:{date,price:0}}` |
| No radar DB / insufficient prices | 200 | `{success:false, no_price_history:true, ticker, entry:{date,price}}` |
| Internal error | 500 | `{success:false, error, ticker}` |

### Data sources (graceful degradation)
1. `db/maker_radar_tracking.json` — entry date + entry price (REQUIRED)
2. `getRadarDb()` (egksco_price_history / stock_daily_prices) — daily prices since entry
3. `db/predictions.db.radar_signal_tracking` — signal events (optional, defaults to empty)
4. `db/predictions.db.predictions` — target_price + stop_loss (optional, defaults to ±10% / -5% of entry)

---

## Component Renders

### Header section
```
📡 COMI — رحلة الإشارة                [📅 26 يوم]
📅 بدأ المتابعة: 2026-09-01
💰 من 12.50 → 14.20  [+13.6%]
```

### Price journey SVG (custom inline)
- 320×140 viewBox, single polyline + gradient area
- Horizontal dashed lines for target_1 (emerald), target_2 (emerald), stop_loss (rose), entry (slate)
- Entry marker (blue dot) + current price marker (green/red dot)

### Target progress bars (3 rows)
- `target_1`: amber → emerald (hit)
- `target_2`: blue → emerald (hit)
- `stop_loss`: emerald (safe) → amber (warning) → rose (danger)
- Each row: label + icon + price + pct + colored bar + status badge (Arabic) + progress %

### Timeline events (vertical)
- Vertical line + colored dot per event (blue/emerald/amber/primary)
- Event emoji: 📡 signal · 📈 milestone · ⚠️ alert · 📍 current
- Date + price + label + optional note

### Milestones checklist
- ✅ CheckCircle2 (emerald) for reached milestones with date + price
- ⬜ Circle (muted) for pending milestones with "لم يصل بعد" caption

---

## Edge case cards

| Trigger | Card | Icon |
|---------|------|------|
| Not tracked | "رحلة الإشارة مش متاحة — أضف للمتابعة عشان تشوف الخط الزمني" | StarOff |
| Entry price missing | "سعر الدخول مش متسجل — شيل السهم من المتابعة وأضفه تاني بسعر دخول صحيح" | AlertTriangle |
| No price history | "مفيش بيانات أسعار كافية بعد — الخط الزمني محتاج على الأقل جلستين أسعار من تاريخ الدخول" | Activity |
| API error / network failure | "تعذّر تحميل الخط الزمني" + retry button | AlertTriangle |

---

## Tests Added

**`src/__tests__/radar/SignalTrackingTimeline.test.tsx`** — 13 tests, all passing ✅

| Suite | Tests | Coverage |
|-------|-------|----------|
| Happy path (full data) | 4 | Header render, timeline events, progress bars, milestones checklist |
| Edge cases | 6 | Not-tracked CTA, no-price-history, entry-price-missing, API error, network failure, retry button refetch |
| Color coding | 2 | amber/blue/emerald for approaching/pending/safe; rose for stop_loss=danger |
| Fetch URL | 1 | Verifies `/api/maker-radar/timeline?ticker=...&days=60` URL |

Mocked `global.fetch` so tests run in pure JS — no DB or network needed.

---

## Verification

| Check | Result |
|-------|--------|
| `bun run lint` | exit 0 ✅ |
| `bunx vitest run src/__tests__/radar/` | 4 files / 73 tests passed ✅ (includes new 13 + pre-existing 60 in radar + alerts) |
| `bun run test` (full) | 221 passed / 13 failed (all pre-existing DB-integration tests in `regime/`, `api/predictions/`, `predictions/`, `db/integrity` — unrelated to L2-SIGNAL-TIMELINE work; same failures exist on `main` HEAD before my changes) |
| `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/` | **200** ✅ |
| `curl http://localhost:3001/api/maker-radar/timeline?ticker=UNKNOWN` | Returns `not_tracked:true` correctly ✅ |
| `curl http://localhost:3001/api/maker-radar/timeline?ticker=COMI` (after adding to tracking JSON) | Returns `no_price_history:true` correctly (sandbox has no radar DB) ✅ |
| `curl http://localhost:3001/api/maker-radar/timeline?ticker=` (no ticker) | Returns 400 ✅ |
| MakerRadarTab.tsx integration | Import + conditional render wired between `TradingPlanSection` and `LiquidityFootprintCard` ✅ |
| Agent Browser | Maker radar page renders ("رادار السيولة"). On sandbox, the radar cache warmup fails (no production DB) so no stocks list to click — drawer cannot be opened. Full happy-path component behavior is verified via the mocked test suite instead. |

---

## Critical rules compliance

1. ✅ **READ before EDIT** — read `MakerRadarTab.tsx`, `track/route.ts`, `stock/route.ts`, `signal-tracker/route.ts`, `radar-db.ts`, `progress.tsx`, `mini-sparkline.tsx`, `setup.ts`, `vitest.config.ts` before writing anything.
2. ✅ **Use existing components** — reused shadcn `Card`, `Badge`, `Button`, `Skeleton`, lucide icons, and the same `getRadarDb/getRadarDbConfig` helpers from `radar-db.ts` (same pattern as `stock/route.ts` + `entry-timing/route.ts`).
3. ✅ **RTL Arabic** — all UI strings in Arabic. Numeric values wrapped in `dir="ltr"` spans. Layout uses `flex-row-reverse` style via RTL document direction.
4. ✅ **Don't break the drawer** — only added 9 lines to `MakerRadarTab.tsx` (1 import + 7 lines of JSX + comment). All existing sections preserved.
5. ✅ **Save report** — this file.

---

## Design decisions

- **Custom SVG chart (not `MiniSparkline`)**: The task brief asked for horizontal target/stop lines overlaid on the price journey. `MiniSparkline` doesn't support arbitrary reference lines — so I built a focused 320×140 SVG that overlays 4 dashed lines (target_1, target_2, stop_loss, entry) + the entry marker + the current marker.
- **Progress bars**: Built inline (div with width %) rather than reusing shadcn `Progress` because shadcn's `Progress` uses a `translateX` transform that requires the parent to have `overflow:hidden` + the bar fills from the left, but for the stop_loss progress bar we want to indicate "closeness to danger" (different semantics). A colored div with width:% is more flexible.
- **Timeline event selection algorithm**: Pick a timeline point when (a) a milestone threshold was crossed, (b) a drawdown alert happened (≥3% day drop or ≥4% from entry), (c) a signal event occurred, or (d) every ~3 days. This keeps the timeline readable (~6-12 points for a 30-day window) rather than showing all 22 trading days.
- **Target price fallback**: If `predictions.db.predictions` has no row for the ticker, fall back to `entryPrice * 1.10` (target_1) and `entryPrice * 1.20` (target_2). Stop loss defaults to `entryPrice * 0.95`.
- **Async I/O**: Uses `fs/promises` (matches the P0-14-ASYNC pattern from the worklog). Better-sqlite3 calls are sync (unavoidable).
- **Graceful degradation**: Every external data source (predictions, signal events, radar DB) is wrapped in try/catch — if one is missing, the API still returns success=false with a helpful Arabic error message instead of crashing.

---

## Next actions (recommended)

1. **Production verification**: Once deployed to a server with a real radar DB + tracking data, hit `curl https://invist.m2y.net/api/maker-radar/timeline?ticker=COMI` to verify the full happy-path JSON.
2. **Persist target/stop per tracked stock**: Currently target_1/target_2 default to ±10% from entry. If the user wants custom targets (e.g., 16% / 29.6% like in the task brief example), extend the `TrackedStock` interface in `track/route.ts` to accept optional `target_1_pct` / `target_2_pct` fields.
3. **Add the timeline to other entry points**: The `StockDetail.tsx` full-page view (not the drawer) could also surface the timeline for tracked stocks — the component is fully reusable.
4. **Wire real signal events**: The API already reads `radar_signal_tracking` rows; ensure the radar-alerts scheduler (see L2-ALERTS-EXIT-RADAR worklog) writes to this table whenever a tracked stock's signal strength changes.
