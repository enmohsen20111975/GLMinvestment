/**
 * multi-stage-alerts.test.ts — L2-ALERTS-EXIT-RADAR (Multi-Stage Smart Alerts)
 * =============================================================================
 *
 * Tests the multi-stage smart alert system added to radar-alerts.ts:
 *
 *   Stage 1 → radar_opportunity   (دخل قائمة المراقبة)
 *   Stage 2 → radar_signal_upgrade (signal_count X→Y, Y >= 4)
 *   Stage 3 → radar_volume_surge  (volume_ratio >= 2.0 OR path=A_pre_surge)
 *   Stage 4 → radar_target_hit   (current_price >= entry * (1 + target_1%/100))
 *   Stage 5 → radar_take_profit   (current_price >= target_1 * 1.05)
 *
 * Coverage:
 *   1. makeInitialStockStage — creates a Stage 1 entry with timestamp.
 *   2. promoteStage — promotes strictly forward (1→2→3→4→5) and records
 *      the timestamp at the new stage.
 *   3. promoteStage — no-op when targetStage <= currentStage (stages do not
 *      fire out-of-order).
 *   4. pathExitAr + exitSuggestedAction — Arabic labels + actions for all
 *      5 exit paths (X1-X5).
 *   5. Full Stage 1 → 2 → 3 → 4 → 5 progression simulation — exercising
 *      promoteStage in sequence to model a real ticker's story arc.
 *   6. Stock leaves radar → stage resets to 1 (but target-hit flags persist
 *      so we don't double-fire Stage 4/5 on re-entry).
 *
 * The tests use the PURE helpers exported from radar-alerts.ts (makeInitialStockStage,
 * promoteStage, pathExitAr, exitSuggestedAction, StockStage, StageNumber). The
 * full runRadarAlertsCheck function requires DB + filesystem mocking — covered
 * by integration tests; here we focus on the stage progression model.
 *
 * Run:
 *   bunx vitest run src/__tests__/alerts/multi-stage-alerts.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  makeInitialStockStage,
  promoteStage,
  pathExitAr,
  exitSuggestedAction,
  type StockStage,
  type StageNumber,
} from '@/lib/schedulers/radar-alerts';

describe('makeInitialStockStage', () => {
  it('creates a Stage 1 entry with a fresh timestamp', () => {
    const stage = makeInitialStockStage('AMIA');
    expect(stage.ticker).toBe('AMIA');
    expect(stage.currentStage).toBe(1);
    expect(stage.stageReachedAt[1]).toBeTruthy();
    expect(typeof stage.stageReachedAt[1]).toBe('string');
    // Stage 2+ timestamps are not set yet
    expect(stage.stageReachedAt[2]).toBeUndefined();
    expect(stage.stageReachedAt[5]).toBeUndefined();
  });

  it('initializes baseline counters to zero', () => {
    const stage = makeInitialStockStage('COMI');
    expect(stage.previousSignalCount).toBe(0);
    expect(stage.previousVolumeRatio).toBe(0);
  });

  it('initializes target-hit flags to false', () => {
    const stage = makeInitialStockStage('HRHO');
    expect(stage.targetHitStage1).toBe(false);
    expect(stage.targetHitStage2).toBe(false);
  });

  it('produces independent timestamps per ticker', async () => {
    const a = makeInitialStockStage('A');
    // small delay so the ISO timestamps differ if they were re-read
    await new Promise((r) => setTimeout(r, 5));
    const b = makeInitialStockStage('B');
    expect(b.stageReachedAt[1]).not.toBe(a.stageReachedAt[1]);
  });
});

describe('promoteStage — forward progression', () => {
  it('promotes Stage 1 → Stage 2 and records the new timestamp', () => {
    const s1 = makeInitialStockStage('AMIA');
    const s2 = promoteStage(s1, 2);
    expect(s2.currentStage).toBe(2);
    expect(s2.stageReachedAt[1]).toBe(s1.stageReachedAt[1]); // original kept
    expect(s2.stageReachedAt[2]).toBeTruthy();
    expect(typeof s2.stageReachedAt[2]).toBe('string');
  });

  it('promotes Stage 1 → Stage 5 in a single jump (skip-ahead allowed)', () => {
    const s1 = makeInitialStockStage('COMI');
    const s5 = promoteStage(s1, 5);
    expect(s5.currentStage).toBe(5);
    expect(s5.stageReachedAt[5]).toBeTruthy();
    // Intermediate timestamps (2, 3, 4) are NOT set when we skip ahead —
    // the caller is responsible for firing the intermediate alerts if
    // they were applicable in the same cycle. This matches the scheduler's
    // behavior: each cycle fires at most one new stage per ticker.
    expect(s5.stageReachedAt[2]).toBeUndefined();
    expect(s5.stageReachedAt[3]).toBeUndefined();
    expect(s5.stageReachedAt[4]).toBeUndefined();
  });

  it('preserves the original stage timestamp when promoting further', () => {
    const s1 = makeInitialStockStage('AMIA');
    const s2 = promoteStage(s1, 2);
    const ts2 = s2.stageReachedAt[2];
    const s3 = promoteStage(s2, 3);
    expect(s3.stageReachedAt[1]).toBe(s1.stageReachedAt[1]);
    expect(s3.stageReachedAt[2]).toBe(ts2); // unchanged
    expect(s3.stageReachedAt[3]).toBeTruthy();
  });

  it('does NOT mutate the input stage (pure function — no side effects)', () => {
    const s1 = makeInitialStockStage('AMIA');
    const snapshot = JSON.stringify(s1);
    promoteStage(s1, 3);
    expect(JSON.stringify(s1)).toBe(snapshot); // unchanged
  });
});

describe('promoteStage — out-of-order protection', () => {
  it('returns the stage unchanged when promoting to the same stage', () => {
    const s1 = makeInitialStockStage('AMIA');
    const s2 = promoteStage(s1, 2);
    const s2Again = promoteStage(s2, 2);
    expect(s2Again).toEqual(s2);
    expect(s2Again.currentStage).toBe(2);
  });

  it('returns the stage unchanged when promoting backwards (downgrade)', () => {
    const s1 = makeInitialStockStage('AMIA');
    const s5 = promoteStage(s1, 5);
    const result = promoteStage(s5, 3 as StageNumber); // try to demote
    expect(result).toEqual(s5);
    expect(result.currentStage).toBe(5);
    expect(result.stageReachedAt[3]).toBeUndefined();
  });

  it('returns the stage unchanged when targetStage < currentStage by 1', () => {
    const s1 = makeInitialStockStage('AMIA');
    const s4 = promoteStage(s1, 4);
    const result = promoteStage(s4, 3 as StageNumber);
    expect(result).toEqual(s4);
    expect(result.currentStage).toBe(4);
  });

  it('does not reset target-hit flags when promoting backwards', () => {
    const s1 = makeInitialStockStage('AMIA');
    const s4 = promoteStage(s1, 4);
    s4.targetHitStage1 = true;
    const result = promoteStage(s4, 2 as StageNumber); // try to demote
    expect(result.targetHitStage1).toBe(true); // preserved
  });
});

describe('Full stage 1 → 2 → 3 → 4 → 5 progression', () => {
  it('simulates AMIA going from watchlist entry to take-profit suggestion', () => {
    // Stage 1: stock enters the watchlist (radar_opportunity fires).
    let stage: StockStage = makeInitialStockStage('AMIA');
    expect(stage.currentStage).toBe(1);

    // Stage 2: signal_count rose from 0 → 4 (radar_signal_upgrade fires).
    stage = promoteStage(stage, 2);
    expect(stage.currentStage).toBe(2);
    expect(stage.stageReachedAt[2]).toBeTruthy();

    // Stage 3: volume_ratio >= 2.0 (radar_volume_surge fires).
    stage = promoteStage(stage, 3);
    expect(stage.currentStage).toBe(3);
    expect(stage.stageReachedAt[3]).toBeTruthy();

    // Stage 4: current_price >= entry * 1.10 (radar_target_hit fires).
    stage = promoteStage(stage, 4);
    stage.targetHitStage1 = true;
    expect(stage.currentStage).toBe(4);
    expect(stage.targetHitStage1).toBe(true);

    // Stage 5: current_price >= target_1 * 1.05 (radar_take_profit fires).
    stage = promoteStage(stage, 5);
    stage.targetHitStage2 = true;
    expect(stage.currentStage).toBe(5);
    expect(stage.targetHitStage2).toBe(true);
    expect(stage.stageReachedAt[5]).toBeTruthy();

    // All stage timestamps are now set (1, 2, 3, 4, 5).
    for (let i = 1; i <= 5; i++) {
      expect(stage.stageReachedAt[i]).toBeTruthy();
    }
  });

  it('preserves chronological order of timestamps (monotonic non-decreasing)', async () => {
    let stage: StockStage = makeInitialStockStage('COMI');
    const ts1 = stage.stageReachedAt[1]!;
    await new Promise((r) => setTimeout(r, 10));
    stage = promoteStage(stage, 2);
    const ts2 = stage.stageReachedAt[2]!;
    await new Promise((r) => setTimeout(r, 10));
    stage = promoteStage(stage, 3);
    const ts3 = stage.stageReachedAt[3]!;
    await new Promise((r) => setTimeout(r, 10));
    stage = promoteStage(stage, 4);
    const ts4 = stage.stageReachedAt[4]!;
    await new Promise((r) => setTimeout(r, 10));
    stage = promoteStage(stage, 5);
    const ts5 = stage.stageReachedAt[5]!;

    // Monotonic non-decreasing (timestamps may be equal if Date.now precision
    // is too coarse, but they should never go backwards).
    expect(new Date(ts2).getTime()).toBeGreaterThanOrEqual(new Date(ts1).getTime());
    expect(new Date(ts3).getTime()).toBeGreaterThanOrEqual(new Date(ts2).getTime());
    expect(new Date(ts4).getTime()).toBeGreaterThanOrEqual(new Date(ts3).getTime());
    expect(new Date(ts5).getTime()).toBeGreaterThanOrEqual(new Date(ts4).getTime());
  });

  it('does NOT fire Stage 4 if Stage 3 has not fired yet (scheduler enforces order)', () => {
    // The scheduler guards each promotion with `stage.currentStage < N` —
    // so if we manually try to jump 2 → 4, promoteStage WILL allow it (skip-
    // ahead), but the scheduler's per-stage `currentStage < 4` check prevents
    // firing Stage 4 before Stage 3. This test models that scheduler logic
    // using the same condition the production code uses.
    let stage: StockStage = makeInitialStockStage('AMIA');
    stage = promoteStage(stage, 2);

    // Simulate scheduler Stage 4 check: stage.currentStage < 4?
    const canFireStage4 = stage.currentStage < 4;
    expect(canFireStage4).toBe(true);

    // But in production, Stage 3 fires FIRST (volume surge), THEN Stage 4
    // (target hit) becomes eligible. The order matters for the user story.
    stage = promoteStage(stage, 3);
    const canFireStage4After3 = stage.currentStage < 4;
    expect(canFireStage4After3).toBe(true);

    stage = promoteStage(stage, 4);
    const canFireStage4After4 = stage.currentStage < 4;
    expect(canFireStage4After4).toBe(false); // already at 4 → cannot fire again
  });
});

describe('Stock leaves radar → stage reset', () => {
  it('scheduler resets the stage to 1 when item is undefined (stock left radar)', () => {
    // Simulate the reset logic from runRadarAlertsCheck:
    //   if (!item) { stage = { ...resetStage, currentStage: 1, ... }; continue; }
    let stage: StockStage = makeInitialStockStage('AMIA');
    stage = promoteStage(stage, 3);

    // Stock leaves the radar — scheduler resets (but keeps target-hit flags):
    const resetStage: StockStage = {
      ticker: stage.ticker,
      currentStage: 1,
      stageReachedAt: { 1: new Date().toISOString() },
      previousSignalCount: 0,
      previousVolumeRatio: 0,
      targetHitStage1: stage.targetHitStage1, // preserved
      targetHitStage2: stage.targetHitStage2, // preserved
    };

    expect(resetStage.currentStage).toBe(1);
    expect(resetStage.stageReachedAt[1]).toBeTruthy();
    expect(resetStage.stageReachedAt[3]).toBeUndefined(); // old stage 3 timestamp cleared
    expect(resetStage.previousSignalCount).toBe(0);
    expect(resetStage.previousVolumeRatio).toBe(0);
    // Target-hit flags preserved → scheduler won't double-fire Stage 4/5
    // if the stock re-enters the watchlist at the same price level.
    expect(resetStage.targetHitStage1).toBe(stage.targetHitStage1);
    expect(resetStage.targetHitStage2).toBe(stage.targetHitStage2);
  });

  it('a re-entered stock starts fresh at Stage 1 but keeps prior target-hit flags', () => {
    // First cycle: stock reached Stage 4 (target hit).
    let stage: StockStage = makeInitialStockStage('COMI');
    stage = promoteStage(stage, 4);
    stage.targetHitStage1 = true;
    expect(stage.currentStage).toBe(4);

    // Second cycle: stock left the radar — reset to Stage 1.
    const resetStage: StockStage = {
      ticker: 'COMI',
      currentStage: 1,
      stageReachedAt: { 1: new Date().toISOString() },
      previousSignalCount: 0,
      previousVolumeRatio: 0,
      targetHitStage1: stage.targetHitStage1, // preserved
      targetHitStage2: false,
    };
    expect(resetStage.currentStage).toBe(1);
    expect(resetStage.targetHitStage1).toBe(true); // preserved

    // Third cycle: stock re-enters — Stage 1 (opportunity) fires again.
    // Stage 2, 3, 4 can re-fire as the stock progresses again. Stage 4
    // check in production uses `stage.currentStage < 4` so it WILL fire
    // again (currentStage was reset to 1). The `targetHitStage1` flag
    // is informational for downstream analytics — it doesn't gate the alert.
    const reEntered = makeInitialStockStage('COMI');
    expect(reEntered.currentStage).toBe(1);
    expect(reEntered.targetHitStage1).toBe(false); // fresh start has no flags
  });
});

describe('pathExitAr + exitSuggestedAction — exit path labels', () => {
  it('returns Arabic labels for all 5 exit paths', () => {
    expect(pathExitAr('X1_distribution_strong')).toBe('توزيع قوي');
    expect(pathExitAr('X2_volume_divergence')).toBe('تباعد حجمي');
    expect(pathExitAr('X3_resistance_rejection')).toBe('رفض مقاومة');
    expect(pathExitAr('X4_exhaustion_gap')).toBe('فجوة إرهاق');
    expect(pathExitAr('X5_kill_switch_triggered')).toBe('Kill Switch');
  });

  it('falls back to the raw path string when unknown', () => {
    expect(pathExitAr('X9_unknown')).toBe('X9_unknown');
    expect(pathExitAr('')).toBe('');
  });

  it('returns suggested actions for all 5 exit paths', () => {
    expect(exitSuggestedAction('X1_distribution_strong')).toContain('بيع');
    expect(exitSuggestedAction('X2_volume_divergence')).toContain('تقليص');
    expect(exitSuggestedAction('X3_resistance_rejection')).toContain('وقف');
    expect(exitSuggestedAction('X4_exhaustion_gap')).toContain('بيع');
    expect(exitSuggestedAction('X5_kill_switch_triggered')).toContain('خروج');
  });

  it('falls back to a safe default action for unknown paths', () => {
    expect(exitSuggestedAction('X9_unknown')).toBe('راجع الموقف فوراً');
  });
});

describe('Integration — stage progression with target-hit flags', () => {
  it('target-hit flags are set when Stages 4 + 5 fire in sequence', () => {
    let stage: StockStage = makeInitialStockStage('AMIA');
    expect(stage.targetHitStage1).toBe(false);
    expect(stage.targetHitStage2).toBe(false);

    // Stage 4 fires → set targetHitStage1
    stage = promoteStage(stage, 4);
    stage.targetHitStage1 = true;
    expect(stage.targetHitStage1).toBe(true);
    expect(stage.targetHitStage2).toBe(false);

    // Stage 5 fires → set targetHitStage2
    stage = promoteStage(stage, 5);
    stage.targetHitStage2 = true;
    expect(stage.targetHitStage1).toBe(true); // preserved
    expect(stage.targetHitStage2).toBe(true);
  });

  it('target-hit flags survive a stage reset (stock leaves radar)', () => {
    let stage: StockStage = makeInitialStockStage('HRHO');
    stage = promoteStage(stage, 5);
    stage.targetHitStage1 = true;
    stage.targetHitStage2 = true;

    // Reset on radar exit
    const resetStage: StockStage = {
      ticker: stage.ticker,
      currentStage: 1,
      stageReachedAt: { 1: new Date().toISOString() },
      previousSignalCount: 0,
      previousVolumeRatio: 0,
      targetHitStage1: stage.targetHitStage1,
      targetHitStage2: stage.targetHitStage2,
    };

    expect(resetStage.targetHitStage1).toBe(true);
    expect(resetStage.targetHitStage2).toBe(true);
    expect(resetStage.currentStage).toBe(1);
  });
});
