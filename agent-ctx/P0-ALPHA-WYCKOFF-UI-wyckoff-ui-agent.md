# Task ID: P0-ALPHA-WYCKOFF-UI
# Agent: Wyckoff UI Agent

## Summary
- Added 2 Wyckoff phase filter buttons (C_SPRING + D_SOS) to the MakerRadarTab filter bar
- Added a `WyckoffPhaseTracker` drawer widget (5-phase horizontal curve) wired to StockDetailDrawer
- Created Node proxy route `/api/maker-radar/wyckoff-screener` that forwards to the Python Flask blueprint (`wyckoff_screener_bp` at port 8010) — Rule 20 compliant

## Files Modified
- `src/modules/predictions/components/MakerRadarTab.tsx` — UI changes:
  - imported `cn` from `@/lib/utils`
  - added `WyckoffPhase` type + `WyckoffStockEntry` interface
  - added state `wyckoffFilter` + `wyckoffData` + `wyckoffError`
  - added `useEffect` that fetches `/api/maker-radar/wyckoff-screener` every 60s while a filter is active
  - added `wyckoffTickers` memo that intersects every radar section with the screener results
  - added 2 filter buttons + clear button (responsive, design tokens only)
  - enhanced empty state with Wyckoff-specific messages (Rule 27 — no fabrication)
  - added `wyckoffData` prop to `StockDetailDrawer`
  - defined `WyckoffPhaseTracker` component (5-phase curve with active highlight + progress bar)
  - integrated `<WyckoffPhaseTracker>` after `<IntradayCvdFlow>` in the drawer

## Files Created
- `src/app/api/maker-radar/wyckoff-screener/route.ts` — Node thin proxy to Python Flask endpoint at port 8010

## Notes
- The Python side (Flask blueprint `wyckoff_screener_bp`) was created by a parallel agent (P0-ALPHA-WYCKOFF-SCREENER-API) and is already registered in `vps-service/lightweight_server.py`. My Node route consumes that endpoint — no duplicate computation (Rule 67 single-source).
- 6 pre-existing TypeScript errors in `TradingPlanSection` are unchanged (same files/lines shifted +160 lines).

## Verification
- `npx tsc --noEmit --skipLibCheck`: 1664 errors before == 1664 after (0 new errors)
- `bun run lint`: PASS (no warnings)
- dev server: HTTP 200 on `/` ✅
- API route: HTTP 403 (correct paywall gate) for anonymous; Python backend at `127.0.0.1:8010/api/wyckoff-screener` returns valid JSON with D_SOS phase stocks
