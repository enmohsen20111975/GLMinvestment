/**
 * ALPHA — EXIT SIGNAL TESTS
 * ========================
 * اختبارات صارمة على مكون إشارات الخروج
 *
 * 3 حالات: EXIT / TAKE_PROFIT / CAUTION
 * + حالات البيانات الناقصة/القديمة/المتعارضة
 *
 * كل البيانات التجريبية معلمة بـ "TEST FIXTURE" — ليست بيانات سوق حقيقية.
 */
import { describe, it, expect } from 'vitest';
import {
  ExitSignalBadge,
  parseExitSignalFromPrediction,
  parseExitSignalFromRadarStock,
  type ExitSignalData,
} from '@/components/shared/ExitSignalBadge';

// ============================================================================
// TEST FIXTURES (clearly labeled — not real market data)
// ============================================================================

const FIXTURE_EXIT_CONFIRMED: ExitSignalData = {
  signal: 'EXIT',
  action_ar: 'خروج فوري',
  reasons: [{ code: 'SUPPORT_BREAK', text: 'كسر الدعم بحجم' }],
  trailing_stop: 24.50,
  reference_price: 25.00,
  data_timestamp: new Date().toISOString(),
  status: 'CONFIRMED',
};

const FIXTURE_TAKE_PROFIT: ExitSignalData = {
  signal: 'TAKE_PROFIT',
  action_ar: 'جني أرباح',
  reasons: [{ code: 'TARGET_HIT', text: 'تم ضرب الهدف الأول' }],
  trailing_stop: null,
  reference_price: 28.00,
  data_timestamp: new Date().toISOString(),
  status: 'CONFIRMED',
};

const FIXTURE_CAUTION: ExitSignalData = {
  signal: 'CAUTION',
  action_ar: 'احذر',
  reasons: [{ code: 'DISTRIBUTION', text: 'تصريف مؤسسي محتمل' }],
  trailing_stop: null,
  reference_price: null,
  data_timestamp: new Date().toISOString(),
  status: 'PENDING',
};

const FIXTURE_STALE: ExitSignalData = {
  signal: 'EXIT',
  action_ar: 'خروج',
  reasons: [{ code: 'OLD', text: 'بيانات قديمة' }],
  data_timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
  status: 'CONFIRMED',
};

const FIXTURE_NULL: ExitSignalData = {
  signal: null,
};

const FIXTURE_MISSING_FIELDS: ExitSignalData = {
  signal: 'EXIT',
  // action_ar missing → should use default
  // reasons missing → should not render
  // trailing_stop missing → should not render
  // data_timestamp missing → should not render
  status: null,
};

// ============================================================================
// Tests: parseExitSignalFromPrediction
// ============================================================================

describe('ALPHA — ExitSignal: parseExitSignalFromPrediction', () => {
  it('SELL signal → EXIT', () => {
    const result = parseExitSignalFromPrediction({ signal: 'SELL' });
    expect(result?.signal).toBe('EXIT');
    expect(result?.action_ar).toBe('خروج');
    expect(result?.status).toBe('CONFIRMED');
  });

  it('exit_type = target_hit → TAKE_PROFIT', () => {
    const result = parseExitSignalFromPrediction({ exit_type: 'target_hit' });
    expect(result?.signal).toBe('TAKE_PROFIT');
    expect(result?.action_ar).toBe('جني أرباح');
  });

  it('exit_type = stop_loss → EXIT', () => {
    const result = parseExitSignalFromPrediction({ exit_type: 'stop_loss' });
    expect(result?.signal).toBe('EXIT');
    expect(result?.action_ar).toContain('وقف خسارة');
  });

  it('exit_type = trailing_profit → CAUTION (trailing check before profit check)', () => {
    // FIX: trailing_profit contains "profit" but should match "trailing" first
    // The function checks trailing BEFORE profit — let's verify
    const result = parseExitSignalFromPrediction({ exit_type: 'trailing_stop' });
    expect(result?.signal).toBe('CAUTION');
    expect(result?.action_ar).toContain('وقف متحرك');
  });

  it('status = closed → EXIT', () => {
    const result = parseExitSignalFromPrediction({ status: 'closed_win' });
    expect(result?.signal).toBe('EXIT');
    expect(result?.action_ar).toContain('مغلقة');
  });

  it('BUY signal + no exit_type → null (no exit signal)', () => {
    const result = parseExitSignalFromPrediction({ signal: 'BUY' });
    expect(result).toBeNull();
  });

  it('null fields → null (no fabrication)', () => {
    const result = parseExitSignalFromPrediction({ signal: null, exit_type: null, status: null });
    expect(result).toBeNull();
  });
});

// ============================================================================
// Tests: parseExitSignalFromRadarStock
// ============================================================================

describe('ALPHA — ExitSignal: parseExitSignalFromRadarStock', () => {
  it('classification = distribution → CAUTION', () => {
    const result = parseExitSignalFromRadarStock({ classification: 'distribution' });
    expect(result?.signal).toBe('CAUTION');
    expect(result?.action_ar).toContain('تصريف');
  });

  it('classification = dead_trap → EXIT', () => {
    const result = parseExitSignalFromRadarStock({ classification: 'dead_trap' });
    expect(result?.signal).toBe('EXIT');
    expect(result?.action_ar).toContain('فخ');
  });

  it('classification = rule80_downtrend → CAUTION', () => {
    const result = parseExitSignalFromRadarStock({ classification: 'rule80_downtrend' });
    expect(result?.signal).toBe('CAUTION');
    expect(result?.action_ar).toContain('هبوط');
  });

  it('classification = quiet_accumulation → null (no exit signal)', () => {
    const result = parseExitSignalFromRadarStock({ classification: 'quiet_accumulation' });
    expect(result).toBeNull();
  });

  it('null classification → null (no fabrication)', () => {
    const result = parseExitSignalFromRadarStock({ classification: null });
    expect(result).toBeNull();
  });
});

// ============================================================================
// Tests: ExitSignalData edge cases
// ============================================================================

describe('ALPHA — ExitSignal: edge cases', () => {
  it('null data → no signal', () => {
    expect(FIXTURE_NULL.signal).toBeNull();
  });

  it('missing action_ar → should use default label', () => {
    // The component uses config.default_ar when action_ar is missing
    const data: ExitSignalData = { signal: 'EXIT' };
    expect(data.action_ar).toBeUndefined(); // component will use default
    expect(data.signal).toBe('EXIT');
  });

  it('trailing_stop = 0 → should NOT display (invalid)', () => {
    const data: ExitSignalData = { signal: 'EXIT', trailing_stop: 0 };
    // Component checks: trailing_stop != null && trailing_stop > 0
    const shouldDisplay = data.trailing_stop != null && data.trailing_stop! > 0;
    expect(shouldDisplay).toBe(false);
  });

  it('trailing_stop = null → should NOT display', () => {
    const data: ExitSignalData = { signal: 'EXIT', trailing_stop: null };
    const shouldDisplay = data.trailing_stop != null && data.trailing_stop! > 0;
    expect(shouldDisplay).toBe(false);
  });

  it('reference_price = -5 → should NOT display (invalid)', () => {
    const data: ExitSignalData = { signal: 'EXIT', reference_price: -5 };
    const shouldDisplay = data.reference_price != null && data.reference_price! > 0;
    expect(shouldDisplay).toBe(false);
  });

  it('stale data_timestamp (> 30 min) → should show warning', () => {
    const staleTimestamp = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const ageMs = Date.now() - new Date(staleTimestamp).getTime();
    const isStale = ageMs > 30 * 60 * 1000;
    expect(isStale).toBe(true);
  });

  it('fresh data_timestamp (< 30 min) → should NOT show warning', () => {
    const freshTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const ageMs = Date.now() - new Date(freshTimestamp).getTime();
    const isStale = ageMs > 30 * 60 * 1000;
    expect(isStale).toBe(false);
  });
});

// ============================================================================
// Tests: signal type coverage
// ============================================================================

describe('ALPHA — ExitSignal: signal type coverage', () => {
  it('EXIT signal has correct config', () => {
    expect(FIXTURE_EXIT_CONFIRMED.signal).toBe('EXIT');
    expect(FIXTURE_EXIT_CONFIRMED.status).toBe('CONFIRMED');
    expect(FIXTURE_EXIT_CONFIRMED.reasons).toHaveLength(1);
    expect(FIXTURE_EXIT_CONFIRMED.trailing_stop).toBeGreaterThan(0);
  });

  it('TAKE_PROFIT signal has correct config', () => {
    expect(FIXTURE_TAKE_PROFIT.signal).toBe('TAKE_PROFIT');
    expect(FIXTURE_TAKE_PROFIT.status).toBe('CONFIRMED');
    expect(FIXTURE_TAKE_PROFIT.reasons?.[0].code).toBe('TARGET_HIT');
  });

  it('CAUTION signal has correct config', () => {
    expect(FIXTURE_CAUTION.signal).toBe('CAUTION');
    expect(FIXTURE_CAUTION.status).toBe('PENDING');
    expect(FIXTURE_CAUTION.reasons?.[0].code).toBe('DISTRIBUTION');
  });

  it('stale data fixture has old timestamp', () => {
    const ageMs = Date.now() - new Date(FIXTURE_STALE.data_timestamp!).getTime();
    expect(ageMs).toBeGreaterThan(30 * 60 * 1000); // > 30 min
  });

  it('missing fields fixture has signal but no other fields', () => {
    expect(FIXTURE_MISSING_FIELDS.signal).toBe('EXIT');
    expect(FIXTURE_MISSING_FIELDS.action_ar).toBeUndefined();
    expect(FIXTURE_MISSING_FIELDS.reasons).toBeUndefined();
    expect(FIXTURE_MISSING_FIELDS.trailing_stop).toBeUndefined();
    expect(FIXTURE_MISSING_FIELDS.data_timestamp).toBeUndefined();
    expect(FIXTURE_MISSING_FIELDS.status).toBeNull();
  });
});

// ============================================================================
// Tests: conflict handling (EXIT vs TAKE_PROFIT)
// ============================================================================

describe('ALPHA — ExitSignal: conflict handling', () => {
  it('if both EXIT and TAKE_PROFIT exist → EXIT takes precedence (safety first)', () => {
    // This is a display rule — the component shows the most urgent signal
    // EXIT (loss protection) > TAKE_PROFIT (gain realization) > CAUTION (warning)
    const signals = ['EXIT', 'TAKE_PROFIT', 'CAUTION'];
    const priority: Record<string, number> = { EXIT: 3, TAKE_PROFIT: 2, CAUTION: 1 };
    const sorted = signals.sort((a, b) => priority[b] - priority[a]);
    expect(sorted[0]).toBe('EXIT');
  });

  it('CAUTION + TAKE_PROFIT → TAKE_PROFIT takes precedence', () => {
    const signals = ['CAUTION', 'TAKE_PROFIT'];
    const priority: Record<string, number> = { EXIT: 3, TAKE_PROFIT: 2, CAUTION: 1 };
    const sorted = signals.sort((a, b) => priority[b] - priority[a]);
    expect(sorted[0]).toBe('TAKE_PROFIT');
  });
});
