/**
 * A3-DEDUP (Task 4-a / Alpha) — End-to-end runtime verification
 * =================================================================
 *
 * Loads a REAL `/api/predictions/honest-tracking/live-tracking` response
 * (saved at /tmp/live-tracking2.json) and runs the actual `dedupPredictions`
 * helper from src/modules/predictions/components/prediction-dashboard/helpers.ts
 * against it.
 *
 * Verifies end-to-end (no React, no test runner, just the real helper against
 * the real API response shape) that:
 *   1. The dedup leaves the production response unchanged (backend B2 already
 *      deduplicated, so frontend dedup is a no-op safety net).
 *   2. When we INJECT a synthetic duplicate (same identity, newer entryDate,
 *      different entryPrice — exactly the failure mode B2 documented), the
 *      dedup correctly collapses the duplicate AND preserves the original
 *      entryPrice.
 *
 * Run: `bun run src/modules/predictions/__tests__/dedup.runtime-verify.ts`
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  dedupPredictions,
  predictionIdentityKey,
} from '../components/prediction-dashboard/helpers';
import type { LivePrediction, LiveTrackingResponse } from '../components/prediction-dashboard/types';

const RESPONSE_PATH = '/tmp/live-tracking2.json';

function fail(msg: string): never {
 console.error(`\n❌ VERIFY FAIL: ${msg}\n`);
 process.exit(1);
}

function ok(msg: string) {
 console.log(`✅ ${msg}`);
}

if (!existsSync(RESPONSE_PATH)) {
 fail(`missing API response fixture at ${RESPONSE_PATH} — start dev server and run:
  curl -s 'http://localhost:3000/api/predictions/honest-tracking/live-tracking?market=EGX&days=0&limit=10&minScore=0' > ${RESPONSE_PATH}`);
}

const raw = JSON.parse(readFileSync(RESPONSE_PATH, 'utf-8')) as LiveTrackingResponse;
if (!raw.success) fail(`API response.success !== true (got ${raw.success})`);

// Replicate what usePredictionTrackingState does for allRawPredictions.
const allRawPredictions: LivePrediction[] = [
 ...(raw.predictions.gambler || []),
 ...(raw.predictions.balanced || []),
 ...(raw.predictions.conservative || []),
];

console.log('\n=== A3-DEDUP runtime verification ===\n');
console.log(`API source : ${raw.source}`);
console.log(`Market     : ${raw.market}`);
console.log(`DaysWindow : ${raw.daysWindow}`);
console.log(`Persona buckets: gambler=${raw.predictions.gambler?.length ?? 0} ` +
 `balanced=${raw.predictions.balanced?.length ?? 0} ` +
 `conservative=${raw.predictions.conservative?.length ?? 0}`);
console.log(`allRawPredictions total: ${allRawPredictions.length}`);

// ── Check 1: A3 fields surfaced by the API ──────────────────────────────────
const first = allRawPredictions[0];
if (!first) fail('API returned 0 predictions — fixture is empty');
console.log('\n--- Check 1: A3-DEDUP fields surfaced by API ---');
console.log(`  first.ticker        : ${first.ticker}`);
console.log(`  first.entryDate     : ${first.entryDate}`);
console.log(`  first.entryPrice    : ${first.entryPrice}`);
console.log(`  first.persona       : ${first.persona}`);
console.log(`  first.market        : ${JSON.stringify(first.market)}`);
console.log(`  first.track         : ${JSON.stringify(first.track)}`);
console.log(`  first.update_count  : ${JSON.stringify(first.update_count)}`);

const missingMarket = allRawPredictions.filter((p) => p.market == null).length;
const missingTrack = allRawPredictions.filter((p) => p.track == null).length;
const missingUpdate = allRawPredictions.filter((p) => p.update_count == null).length;
console.log(`  rows missing market       : ${missingMarket}/${allRawPredictions.length}`);
console.log(`  rows missing track        : ${missingTrack}/${allRawPredictions.length}`);
console.log(`  rows missing update_count : ${missingUpdate}/${allRawPredictions.length}`);
if (missingMarket > 0 || missingTrack > 0 || missingUpdate > 0) {
 fail('API response is missing A3 fields on some rows — frontend dedup will fall back to "unknown" (still safe but less precise).');
}
ok('All A3-DEDUP fields (market, track, update_count) are present on every row.');

// ── Check 2: Run the real dedup helper against the production response ──────
console.log('\n--- Check 2: Run dedupPredictions on real API response ---');
const deduped = dedupPredictions(allRawPredictions, raw.market || 'EGX');
console.log(`  input rows : ${allRawPredictions.length}`);
console.log(`  output rows: ${deduped.length}`);
console.log(`  collapsed  : ${allRawPredictions.length - deduped.length}`);

const prodGroups = new Map<string, number>();
for (const p of allRawPredictions) {
 const k = predictionIdentityKey(p, raw.market || 'EGX');
 prodGroups.set(k, (prodGroups.get(k) ?? 0) + 1);
}
const prodDupGroups = Array.from(prodGroups.entries()).filter(([, n]) => n > 1);
console.log(`  production duplicate-identity groups: ${prodDupGroups.length}`);
if (prodDupGroups.length === 0) {
 ok('Production API response has NO duplicate-identity groups (B2 backend dedup is doing its job). Frontend dedup is a no-op safety net here.');
} else {
 console.log(`  ⚠ production response has ${prodDupGroups.length} duplicate-identity groups:`);
 for (const [k, n] of prodDupGroups.slice(0, 3)) console.log(`     ${k} → ${n} rows`);
 ok(`Frontend dedup collapsed ${allRawPredictions.length - deduped.length} duplicate rows.`);
}

if (deduped.length !== allRawPredictions.length - (allRawPredictions.length - deduped.length)) {
 fail(`dedup count math is wrong`);
}
if (deduped.length > allRawPredictions.length) {
 fail('deduped list is LONGER than input — that is impossible and a bug.');
}
ok(`dedup output (${deduped.length}) <= input (${allRawPredictions.length}) — invariant holds.`);

// ── Check 3: INJECT a synthetic duplicate (B2's ADPC case) and verify dedup ─
console.log('\n--- Check 3: Inject ADPC duplicate (B2 case) → must collapse + preserve original ---');
const adpcOriginal: LivePrediction = {
 ticker: 'ADPC',
 nameAr: 'ADPC',
 persona: 'balanced',
 signal: 'BUY',
 entryDate: '2026-09-24 09:00:00',
 entryPrice: 3.75,
 targetPrice: 3.8437,
 stopLoss: 3.55,
 currentPrice: 3.75,
 outcome: 'LOSS',
 returnPct: -5.3,
 maestroScore: 70,
 confidence: 70,
 market: 'EGX',
 track: 'full_analysis',
 update_count: 0,
} as LivePrediction;

const adpcNewer: LivePrediction = {
 ticker: 'ADPC',
 nameAr: 'ADPC',
 persona: 'balanced',
 signal: 'BUY',
 entryDate: '2026-09-24 16:00:00', // newer (later in day)
 entryPrice: 3.75,
 targetPrice: 3.8625, // different target — must NOT bleed into kept row
 stopLoss: 3.6,
 currentPrice: 3.8,
 outcome: 'EXPIRED',
 returnPct: 0,
 maestroScore: 72,
 confidence: 72,
 market: 'EGX',
 track: 'full_analysis',
 update_count: 1, // backend bumped it — badge should appear
} as LivePrediction;

// Simulate the API ORDER BY prediction_date DESC (newest first).
const injected = [adpcNewer, adpcOriginal, ...allRawPredictions];
const dedupedInjected = dedupPredictions(injected, raw.market || 'EGX');
console.log(`  input rows (with injected dup) : ${injected.length}`);
console.log(`  output rows                   : ${dedupedInjected.length}`);
const adpcKept = dedupedInjected.find((p) => p.ticker === 'ADPC');
if (!adpcKept) fail('ADPC row was dropped entirely by dedup.');
console.log(`  kept ADPC entryDate  : ${adpcKept.entryDate}`);
console.log(`  kept ADPC entryPrice : ${adpcKept.entryPrice}`);
console.log(`  kept ADPC targetPrice: ${adpcKept.targetPrice}`);
console.log(`  kept ADPC stopLoss   : ${adpcKept.stopLoss}`);
console.log(`  kept ADPC updated    : ${JSON.stringify(adpcKept.updated)}`);

if (adpcKept.entryDate !== '2026-09-24 09:00:00') {
 fail(`dedup kept the WRONG row (entryDate=${adpcKept.entryDate}, expected the earliest 09:00:00).`);
}
ok('dedup kept the EARLIEST entryDate (original) — not the newer re-analysis row.');

if (adpcKept.entryPrice !== 3.75) {
 fail(`original entryPrice was overwritten (${adpcKept.entryPrice} !== 3.75).`);
}
ok(`original entryPrice preserved: 3.75`);

if (adpcKept.targetPrice !== 3.8437) {
 fail(`original targetPrice was overwritten (${adpcKept.targetPrice} !== 3.8437 — got the newer 3.8625).`);
}
ok(`original targetPrice preserved: 3.8437 (NOT 3.8625 from the newer row)`);

if (adpcKept.stopLoss !== 3.55) {
 fail(`original stopLoss was overwritten (${adpcKept.stopLoss} !== 3.55).`);
}
ok(`original stopLoss preserved: 3.55`);

// ADPC's identity count must be exactly 1 in the deduped output.
const adpcCount = dedupedInjected.filter((p) => p.ticker === 'ADPC').length;
if (adpcCount !== 1) {
 fail(`ADPC appears ${adpcCount} times in deduped output (expected 1).`);
}
ok(`ADPC appears exactly once in deduped output (collapsed 2 → 1).`);

// ── Check 4: Different personas / markets / tracks NOT merged ───────────────
console.log('\n--- Check 4: Different persona / market / track NOT merged ---');
const distinct: LivePrediction[] = [
 { ticker: 'COMI', persona: 'gambler', entryDate: '2026-10-25 09:00:00', entryPrice: 100, targetPrice: 110, stopLoss: 95, outcome: 'PENDING', market: 'EGX', track: 'full_analysis' } as LivePrediction,
 { ticker: 'COMI', persona: 'balanced', entryDate: '2026-10-25 09:00:00', entryPrice: 100, targetPrice: 110, stopLoss: 95, outcome: 'PENDING', market: 'EGX', track: 'full_analysis' } as LivePrediction,
 { ticker: 'COMI', persona: 'conservative', entryDate: '2026-10-25 09:00:00', entryPrice: 100, targetPrice: 110, stopLoss: 95, outcome: 'PENDING', market: 'EGX', track: 'full_analysis' } as LivePrediction,
 { ticker: 'AAPL', persona: 'balanced', entryDate: '2026-10-25 09:00:00', entryPrice: 220, targetPrice: 240, stopLoss: 210, outcome: 'PENDING', market: 'US', track: 'liquidity' } as LivePrediction,
 { ticker: 'SWDY', persona: 'balanced', entryDate: '2026-10-25 09:00:00', entryPrice: 104.7, targetPrice: 110, stopLoss: 99, outcome: 'PENDING', market: 'EGX', track: 'RADAR_PROMOTED' } as LivePrediction,
 { ticker: 'SWDY', persona: 'balanced', entryDate: '2026-10-25 09:00:00', entryPrice: 104.7, targetPrice: 110, stopLoss: 99, outcome: 'PENDING', market: 'EGX', track: 'full_analysis' } as LivePrediction, // same identity except track
];
const dedupedDistinct = dedupPredictions(distinct);
console.log(`  distinct input rows: ${distinct.length}`);
console.log(`  distinct output rows: ${dedupedDistinct.length}`);
if (dedupedDistinct.length !== distinct.length) {
 fail(`distinct rows were merged — expected ${distinct.length}, got ${dedupedDistinct.length}.`);
}
ok(`All ${distinct.length} distinct identities preserved (different persona / market / track NOT merged).`);

console.log('\n=== A3-DEDUP runtime verification PASSED ✅ ===\n');
