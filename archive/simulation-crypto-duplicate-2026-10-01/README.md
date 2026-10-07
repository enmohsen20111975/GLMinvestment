# Archived: CryptoSimulationView (duplicate of SimulationView)

> **Archived:** 2026-10-01 (Wave 5 — Simulation Globalization, Task 13 Step 4)
> **Reason:** `SimulationView` now serves ALL markets (EGX/TADAWUL/KSE/QSE/US/CRYPTO)
> via the unified `MarketSelector` (Rule 53 CRYPTO-IN-MARKETS + Rule 51
> MULTI-MARKET-DUAL-TRACK). The dedicated `CryptoSimulationView` was a duplicate
> simulation screen — the owner directive was:
>
> > "فى قائمة المزيد يوجد العديد من صفحات الكريبتو فى حين انى امرتك تدمج الكريبتو داخل الأسواق"
>
> Per Rule 63.2 (NO-NEW-SCREENS-FILES + ARCHIVE-not-delete) and Rule 4 (no
> duplicate screens), this file is archived, not deleted. The canonical screen
> is `src/modules/simulation/components/SimulationView.tsx` — switch to the
> CRYPTO market via the in-header market selector (or the `#crypto-simulation`
> deep link which now also routes to `SimulationView` + `setCurrentMarket('CRYPTO')`).

## Where it used to live

- File path: `src/modules/crypto/components/CryptoSimulationView.tsx`
- Re-exported from: `src/modules/crypto/components/CryptoAdditionalViews.tsx`
- Re-exported from: `src/modules/crypto/index.ts`

## What replaced it

`src/modules/simulation/components/SimulationView.tsx` — when the user selects
`CRYPTO` in the `MarketSelector` (or navigates to `#crypto-simulation`), the
same `SimulationView` component loads the crypto asset list (BTC/ETH/BNB/...)
via `/api/stocks?market=CRYPTO` (with offline fallback seeds) and runs the
identical live price random-walk simulation.
