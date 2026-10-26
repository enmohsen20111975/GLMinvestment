/**
 * A3-DEDUP (Task 4-a / Alpha) — Frontend prediction-dedup tests
 * =============================================================
 *
 * Verifies the SECONDARY frontend defense against duplicate daily predictions
 * implemented in `helpers.ts::dedupPredictions()`. The PRIMARY defense is B2's
 * backend UNIQUE INDEX `(ticker, substr(prediction_date,1,10), persona, market,
 * track)` + `record_prediction()` UPDATE-not-INSERT behavior (see worklog Task
 * 1-b / Bravo). These tests assert the frontend correctly mirrors the same
 * identity model AND preserves the ORIGINAL (earliest) prediction's details
 * when the API returns near-duplicates.
 *
 * Coverage (matches owner acceptance criteria):
 *   1. One duplicated ticker from API → renders once.
 *   2. One ticker with multiple updates → renders once (original), `updated`
 *      badge optional but set when `update_count > 0`.
 *   3. One ticker with different personas → renders as separate rows (NOT
 *      merged).
 *   4. Different ticker / different day / different market / different track
 *      → distinct rows (sanity check the key is composite).
 *   5. Identity key uses ONLY the date portion of `entryDate` — full
 *      timestamps with different seconds collapse to the same key.
 *   6. The ADP/ADPC case B2 documented: original entry_price PRESERVED even
 *      when the API sends a newer row with a different target_price.
 *   7. Original entryPrice / stopLoss / targetPrice / entryDate / persona /
 *      market / track are NOT mutated by the dedup (no field merging).
 *   8. Missing `market` / `track` falls back gracefully without crashing.
 *
 * Run: `bun run test -- src/modules/predictions/__tests__/dedup.test.ts`
 */

import { describe, it, expect } from 'vitest';
import {
  dedupPredictions,
  predictionIdentityKey,
  parsePredictionDateMs,
} from '../components/prediction-dashboard/helpers';
import type { LivePrediction } from '../components/prediction-dashboard/types';

// Helper: build a minimal LivePrediction with sensible defaults so each test
// only specifies the fields it cares about. Optional identity fields
// (`market`, `track`, `update_count`) default to "absent" to exercise the
// fallback branches.
function mk(over: Partial<LivePrediction>): LivePrediction {
  return {
   ticker: 'SWDY',
   persona: 'balanced',
   signal: 'BUY',
   entryDate: '2026-10-25 09:00:00',
   entryPrice: 100,
   targetPrice: 110,
   stopLoss: 95,
   outcome: 'PENDING',
   ...over,
  } as LivePrediction;
}

describe('A3-DEDUP — predictionIdentityKey', () => {
 it('uses only the YYYY-MM-DD portion of entryDate (NOT the full timestamp)', () => {
  const a = mk({ ticker: 'SWDY', entryDate: '2026-10-25 09:00:00' });
  const b = mk({ ticker: 'SWDY', entryDate: '2026-10-25 14:35:11' });
  expect(predictionIdentityKey(a, 'EGX')).toBe(predictionIdentityKey(b, 'EGX'));
 });

 it('distinguishes by ticker', () => {
  const a = mk({ ticker: 'SWDY' });
  const b = mk({ ticker: 'COMI' });
  expect(predictionIdentityKey(a, 'EGX')).not.toBe(predictionIdentityKey(b, 'EGX'));
 });

 it('distinguishes by persona (NOT merged)', () => {
  const a = mk({ persona: 'balanced' });
  const b = mk({ persona: 'gambler' });
  expect(predictionIdentityKey(a, 'EGX')).not.toBe(predictionIdentityKey(b, 'EGX'));
 });

 it('distinguishes by market', () => {
  const a = mk({ market: 'EGX' });
  const b = mk({ market: 'US' });
  expect(predictionIdentityKey(a)).not.toBe(predictionIdentityKey(b));
 });

 it('distinguishes by track', () => {
  const a = mk({ track: 'full_analysis' });
  const b = mk({ track: 'RADAR_PROMOTED' });
  expect(predictionIdentityKey(a, 'EGX')).not.toBe(predictionIdentityKey(b, 'EGX'));
 });

 it('falls back to marketFallback when p.market is missing', () => {
  const a = mk({ market: undefined });
  expect(predictionIdentityKey(a, 'EGX')).toContain('|EGX|');
 });

 it('falls back to "unknown" when neither p.market nor marketFallback is given', () => {
  const a = mk({ market: undefined });
  expect(predictionIdentityKey(a)).toContain('|UNKNOWN|');
 });

 it('falls back to "unknown" track when p.track is missing', () => {
  const a = mk({ track: undefined });
  expect(predictionIdentityKey(a, 'EGX')).toMatch(/\|unknown$/);
 });

 it('is case-insensitive on ticker / persona / market / track', () => {
  const a = mk({ ticker: 'swdy', persona: 'BALANCED', market: 'egx', track: 'Full_Analysis' });
  const b = mk({ ticker: 'SWDY', persona: 'balanced', market: 'EGX', track: 'full_analysis' });
  expect(predictionIdentityKey(a)).toBe(predictionIdentityKey(b));
 });
});

describe('A3-DEDUP — parsePredictionDateMs', () => {
 it('parses "YYYY-MM-DD"', () => {
  expect(parsePredictionDateMs('2026-10-25')).toBeGreaterThan(0);
 });

 it('parses "YYYY-MM-DD HH:MM:SS"', () => {
  expect(parsePredictionDateMs('2026-10-25 14:35:11')).toBeGreaterThan(0);
 });

 it('returns null for empty / null / undefined', () => {
  expect(parsePredictionDateMs('')).toBeNull();
  expect(parsePredictionDateMs(null)).toBeNull();
  expect(parsePredictionDateMs(undefined)).toBeNull();
 });

 it('returns null for unparseable strings', () => {
  expect(parsePredictionDateMs('not-a-date')).toBeNull();
 });
});

describe('A3-DEDUP — dedupPredictions (acceptance criteria)', () => {
 // ─── AC #1: One duplicated ticker from API → renders once ──────────────────
 it('AC#1 — collapses exact duplicate rows to one', () => {
  const rows = [
   mk({ ticker: 'SWDY', entryDate: '2026-10-25 09:00:00', entryPrice: 100 }),
   mk({ ticker: 'SWDY', entryDate: '2026-10-25 14:35:11', entryPrice: 100.5 }),
  ];
  const out = dedupPredictions(rows, 'EGX');
  expect(out).toHaveLength(1);
  expect(out[0].ticker).toBe('SWDY');
 });

 // ─── AC #2: One ticker with multiple updates → renders once (original) ─────
 it('AC#2 — multiple updates for the same identity render as ONE row (original kept)', () => {
  // B2 documented SWDY on 2026-10-25 RADAR_PROMOTED: original entry_price=104.7
  // bumped to 100.56 across 35 5-min scans. We must keep the ORIGINAL.
  const rows = [
   // API returns newest first (prediction_date DESC). Newer scan, lower price.
   mk({
    ticker: 'SWDY',
    entryDate: '2026-10-25 14:35:11',
    entryPrice: 100.56,
    targetPrice: 108,
    track: 'RADAR_PROMOTED',
    update_count: 0,
   }),
   // Older scan, original entry_price.
   mk({
    ticker: 'SWDY',
    entryDate: '2026-10-25 08:10:11',
    entryPrice: 104.7,
    targetPrice: 110,
    track: 'RADAR_PROMOTED',
    update_count: 0,
   }),
  ];
  const out = dedupPredictions(rows, 'EGX');
  expect(out).toHaveLength(1);
  // CRITICAL: original entryPrice preserved (B2 contract).
  expect(out[0].entryPrice).toBe(104.7);
  // CRITICAL: original prediction_date preserved (NOT the latest re-analysis).
  expect(out[0].entryDate).toBe('2026-10-25 08:10:11');
 });

 it('AC#2 — `updated` badge is set when the kept (original) row has update_count > 0', () => {
  // Simulate B2's contract: the original row was UPDATED by the backend, so
  // its own update_count is bumped. The badge surfaces that fact.
  const rows = [
   mk({
    ticker: 'SWDY',
    entryDate: '2026-10-25 08:10:11',
    entryPrice: 104.7,
    update_count: 2,
    track: 'RADAR_PROMOTED',
   }),
   mk({
    ticker: 'SWDY',
    entryDate: '2026-10-25 14:35:11',
    entryPrice: 100.56,
    update_count: 0,
    track: 'RADAR_PROMOTED',
   }),
  ];
  const out = dedupPredictions(rows, 'EGX');
  expect(out).toHaveLength(1);
  expect(out[0].entryPrice).toBe(104.7); // original kept
  expect(out[0].updated).toBe(true); // badge surfaced from ORIGINAL's update_count
 });

 it('AC#2 — `updated` badge is NOT set when update_count is 0 or missing', () => {
  const rows = [
   mk({ ticker: 'SWDY', entryDate: '2026-10-25 08:10:11', entryPrice: 104.7, update_count: 0 }),
   mk({ ticker: 'SWDY', entryDate: '2026-10-25 14:35:11', entryPrice: 100.56 }),
  ];
  const out = dedupPredictions(rows, 'EGX');
  expect(out).toHaveLength(1);
  expect(out[0].updated).toBeUndefined();
 });

 // ─── AC #3: One ticker with different personas → separate rows ─────────────
 it('AC#3 — different personas are NOT merged', () => {
  const rows = [
   mk({ ticker: 'COMI', persona: 'gambler', entryDate: '2026-10-25 09:00:00', entryPrice: 100 }),
   mk({ ticker: 'COMI', persona: 'balanced', entryDate: '2026-10-25 09:00:00', entryPrice: 100 }),
   mk({ ticker: 'COMI', persona: 'conservative', entryDate: '2026-10-25 09:00:00', entryPrice: 100 }),
  ];
  const out = dedupPredictions(rows, 'EGX');
  expect(out).toHaveLength(3);
  const personas = out.map((p) => p.persona).sort();
  expect(personas).toEqual(['balanced', 'conservative', 'gambler']);
 });

 // ─── AC #4: Different ticker / day / market / track → distinct ─────────────
 it('AC#4 — different tickers stay separate', () => {
  const rows = [
   mk({ ticker: 'SWDY', entryDate: '2026-10-25' }),
   mk({ ticker: 'COMI', entryDate: '2026-10-25' }),
  ];
  expect(dedupPredictions(rows, 'EGX')).toHaveLength(2);
 });

 it('AC#4 — same ticker different day stays separate', () => {
  const rows = [
   mk({ ticker: 'SWDY', entryDate: '2026-10-24 09:00:00' }),
   mk({ ticker: 'SWDY', entryDate: '2026-10-25 09:00:00' }),
  ];
  expect(dedupPredictions(rows, 'EGX')).toHaveLength(2);
 });

 it('AC#4 — same ticker same day different market stays separate', () => {
  const rows = [
   mk({ ticker: 'ADP', market: 'EGX', entryDate: '2026-09-24' }),
   mk({ ticker: 'ADP', market: 'US', entryDate: '2026-09-24' }),
  ];
  expect(dedupPredictions(rows)).toHaveLength(2);
 });

 it('AC#4 — same ticker same day different track stays separate (full_analysis vs RADAR_PROMOTED)', () => {
  // B2 identity treats full_analysis (daily EGX) ≠ RADAR_PROMOTED (intraday EGX)
  // as distinct predictions. They must NOT collapse.
  const rows = [
   mk({ ticker: 'HCFI', track: 'full_analysis', entryDate: '2026-10-25 09:00:00' }),
   mk({ ticker: 'HCFI', track: 'RADAR_PROMOTED', entryDate: '2026-10-25 10:00:00' }),
  ];
  expect(dedupPredictions(rows, 'EGX')).toHaveLength(2);
 });

 // ─── AC #5: Identity key uses ONLY date (no seconds) ───────────────────────
 it('AC#5 — same identity, different seconds → collapsed to one row (original kept)', () => {
  // B2 root cause: prediction_date was stored as 'YYYY-MM-DD HH:MM:SS' for
  // RADAR_PROMOTED rows. The dedup MUST use the date slice, NOT the seconds.
  const rows = [
   mk({ ticker: 'HCFI', entryDate: '2026-10-25 10:35:11', entryPrice: 3.12 }),
   mk({ ticker: 'HCFI', entryDate: '2026-10-25 08:00:14', entryPrice: 3.09 }),
   mk({ ticker: 'HCFI', entryDate: '2026-10-25 14:55:00', entryPrice: 3.15 }),
  ];
  const out = dedupPredictions(rows, 'EGX');
  expect(out).toHaveLength(1);
  // Original (earliest) preserved.
  expect(out[0].entryPrice).toBe(3.09);
  expect(out[0].entryDate).toBe('2026-10-25 08:00:14');
 });

 // ─── AC #6: ADP/ADPC case B2 documented ────────────────────────────────────
 it('AC#6 — ADPC case: original entry_price PRESERVED even when newer row has different target', () => {
  // B2 worklog documented: ADPC on 2026-09-24 had 2 rows — original
  // entry_price=3.75 with target_price=3.8437 (status=STOPPED) vs newer
  // entry_price=3.75 with target_price=3.8625 (status=EXPIRED). The newer
  // row was archived. Here we simulate both rows arriving from the API.
  const rows = [
   mk({
    ticker: 'ADPC',
    market: 'EGX',
    track: 'full_analysis',
    persona: 'balanced',
    entryDate: '2026-09-24 16:00:00', // newer
    entryPrice: 3.75,
    targetPrice: 3.8625,
    outcome: 'EXPIRED',
    stopLoss: 3.55,
   }),
   mk({
    ticker: 'ADPC',
    market: 'EGX',
    track: 'full_analysis',
    persona: 'balanced',
    entryDate: '2026-09-24 09:00:00', // earliest = original
    entryPrice: 3.75,
    targetPrice: 3.8437,
    outcome: 'LOSS',
    stopLoss: 3.55,
   }),
  ];
  const out = dedupPredictions(rows);
  expect(out).toHaveLength(1);
  // Original (earliest) details preserved.
  expect(out[0].entryDate).toBe('2026-09-24 09:00:00');
  expect(out[0].targetPrice).toBe(3.8437); // original target, NOT 3.8625
  expect(out[0].stopLoss).toBe(3.55);
 });

 it('AC#6 — ADP (contaminated USD row) vs ADPC (real EGX row) stay SEPARATE (different market)', () => {
  // B1 isolated ADP (id=882, currency=USD on market=EGX = contaminated) from
  // ADPC (id=167, currency=EGP, market=EGX = real). They are DIFFERENT tickers
  // so they MUST stay separate, but even if they shared a ticker name they'd
  // be separated by market in the identity key. This test asserts the market
  // dimension is honored.
  const rows = [
   mk({
    ticker: 'ADP',
    market: 'US',
    entryDate: '2026-09-24 09:00:00',
    entryPrice: 264.0,
    track: 'liquidity',
   }),
   mk({
    ticker: 'ADPC',
    market: 'EGX',
    entryDate: '2026-09-24 09:00:00',
    entryPrice: 3.75,
    track: 'full_analysis',
   }),
  ];
  const out = dedupPredictions(rows);
  expect(out).toHaveLength(2);
 });

 // ─── AC #7: Original fields NOT mutated ────────────────────────────────────
 it('AC#7 — dedup does NOT mutate original fields (no field merging)', () => {
  const original = mk({
   ticker: 'COMI',
   entryDate: '2026-10-25 09:00:00',
   entryPrice: 100,
   targetPrice: 110,
   stopLoss: 95,
   persona: 'balanced',
   market: 'EGX',
   track: 'full_analysis',
  });
  const newer = mk({
   ticker: 'COMI',
   entryDate: '2026-10-25 14:00:00',
   entryPrice: 105, // different — must NOT bleed into the kept row
   targetPrice: 115,
   stopLoss: 99,
   persona: 'balanced',
   market: 'EGX',
   track: 'full_analysis',
  });
  const out = dedupPredictions([newer, original], 'EGX');
  expect(out).toHaveLength(1);
  const kept = out[0];
  expect(kept.entryPrice).toBe(100); // original
  expect(kept.targetPrice).toBe(110); // original
  expect(kept.stopLoss).toBe(95); // original
  expect(kept.entryDate).toBe('2026-10-25 09:00:00'); // original
  expect(kept.persona).toBe('balanced'); // original
  expect(kept.market).toBe('EGX'); // original
  expect(kept.track).toBe('full_analysis'); // original
 });

 // ─── AC #8: Graceful fallback when market/track missing ─────────────────────
 it('AC#8 — missing market falls back to marketFallback (hook prop)', () => {
  // Older API responses (pre-A3) don't include `market` on items. The hook
  // passes its `market` prop as fallback so dedup still works.
  const rows = [
   mk({ ticker: 'SWDY', entryDate: '2026-10-25 09:00:00', market: undefined }),
   mk({ ticker: 'SWDY', entryDate: '2026-10-25 14:00:00', market: undefined }),
  ];
  const out = dedupPredictions(rows, 'EGX');
  expect(out).toHaveLength(1);
 });

 it('AC#8 — missing track falls back to "unknown" (still dedups same-identity rows)', () => {
  const rows = [
   mk({ ticker: 'SWDY', entryDate: '2026-10-25 09:00:00', track: undefined }),
   mk({ ticker: 'SWDY', entryDate: '2026-10-25 14:00:00', track: undefined }),
  ];
  const out = dedupPredictions(rows, 'EGX');
  expect(out).toHaveLength(1);
 });

 it('AC#8 — empty list returns empty list', () => {
  expect(dedupPredictions([], 'EGX')).toEqual([]);
 });

 it('AC#8 — rows with empty ticker are dropped (malformed input)', () => {
  const rows = [
   mk({ ticker: '' }),
   mk({ ticker: 'SWDY' }),
  ];
  const out = dedupPredictions(rows, 'EGX');
  expect(out).toHaveLength(1);
  expect(out[0].ticker).toBe('SWDY');
 });
});

describe('A3-DEDUP — integration with realistic API response', () => {
 // Simulates a real `data.predictions` shape from the live-tracking API:
 // 3 personas, mix of full_analysis + RADAR_PROMOTED, including the SWDY
 // intraday duplicate documented in B2.
 it('dedupes a realistic merged allRawPredictions list (gambler + balanced + conservative)', () => {
  const merged: LivePrediction[] = [
   // balanced bucket
   mk({ ticker: 'SWDY', persona: 'balanced', entryDate: '2026-10-25 14:35:11', entryPrice: 100.56, track: 'RADAR_PROMOTED', market: 'EGX' }),
   mk({ ticker: 'SWDY', persona: 'balanced', entryDate: '2026-10-25 08:10:11', entryPrice: 104.7, track: 'RADAR_PROMOTED', market: 'EGX' }),
   mk({ ticker: 'COMI', persona: 'balanced', entryDate: '2026-10-25 09:00:00', entryPrice: 100, track: 'full_analysis', market: 'EGX' }),
   mk({ ticker: 'HCFI', persona: 'balanced', entryDate: '2026-10-25 10:35:11', entryPrice: 3.12, track: 'RADAR_PROMOTED', market: 'EGX' }),
   mk({ ticker: 'HCFI', persona: 'balanced', entryDate: '2026-10-25 08:00:14', entryPrice: 3.09, track: 'RADAR_PROMOTED', market: 'EGX' }),
   // gambler bucket — same ticker different persona = KEEP
   mk({ ticker: 'SWDY', persona: 'gambler', entryDate: '2026-10-25 09:00:00', entryPrice: 104.7, track: 'full_analysis', market: 'EGX' }),
   // conservative bucket
   mk({ ticker: 'COMI', persona: 'conservative', entryDate: '2026-10-25 09:00:00', entryPrice: 100, track: 'full_analysis', market: 'EGX' }),
   // US market liquidity (different market = KEEP)
   mk({ ticker: 'AAPL', persona: 'balanced', entryDate: '2026-10-25 09:00:00', entryPrice: 220, track: 'liquidity', market: 'US' }),
  ];
  const out = dedupPredictions(merged, 'EGX');
  // Expected unique identities:
  //   SWDY|2026-10-25|balanced|EGX|RADAR_PROMOTED  → 1 (original 104.7)
  //   COMI|2026-10-25|balanced|EGX|full_analysis   → 1
  //   HCFI|2026-10-25|balanced|EGX|RADAR_PROMOTED  → 1 (original 3.09)
  //   SWDY|2026-10-25|gambler|EGX|full_analysis    → 1
  //   COMI|2026-10-25|conservative|EGX|full_analysis → 1
  //   AAPL|2026-10-25|balanced|US|liquidity       → 1
  //   Total: 6
  expect(out).toHaveLength(6);
  // Originals preserved
  const swdyBal = out.find((p) => p.ticker === 'SWDY' && p.persona === 'balanced');
  expect(swdyBal?.entryPrice).toBe(104.7);
  expect(swdyBal?.entryDate).toBe('2026-10-25 08:10:11');
  const hcfiBal = out.find((p) => p.ticker === 'HCFI' && p.persona === 'balanced');
  expect(hcfiBal?.entryPrice).toBe(3.09);
  expect(hcfiBal?.entryDate).toBe('2026-10-25 08:00:14');
  // Different personas on same ticker kept separate
  const swdyRows = out.filter((p) => p.ticker === 'SWDY');
  expect(swdyRows).toHaveLength(2); // balanced + gambler
  // Different markets kept separate
  const aapl = out.find((p) => p.ticker === 'AAPL');
  expect(aapl?.market).toBe('US');
 });
});
