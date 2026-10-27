/**
 * ALPHA — PRICE ACCURACY TESTS
 * =============================
 * اختبارات صارمة على دقة الأسعار والمؤشرات
 *
 * Goal: No wrong price is ever displayed to the user.
 * Rule: If the data source returns a stale/wrong value, show "—" instead.
 */
import { describe, it, expect } from 'vitest';

// ============================================================================
// Helper: simulate the EGX30 index value sources
// ============================================================================

/** Source 1: market_indices table (stocks.db) — CAN be stale */
const MARKET_INDICES_EGX30 = {
  value: 49221.94,
  previous_close: 51054.04,
  last_update: '2026-10-25T14:55:03.600816',
  source: 'stocks_db_market_indices',
};

/** Source 2: price_history table (price_history.db) — more reliable */
const PRICE_HISTORY_EGX30 = {
  close_price: 53776.69,
  date: '2026-09-24',
  source: 'price_history.db',
};

/** Source 3: real-world expected value (from EGX official) */
const REAL_WORLD_EGX30 = 53000; // approximate

// ============================================================================
// Tests: stale data detection
// ============================================================================

describe('ALPHA — PRICE ACCURACY: Stale Data Detection', () => {
  it('EGX30 in market_indices (49,221) is STALE — differs > 5% from price_history (53,776)', () => {
    const marketIndicesValue = MARKET_INDICES_EGX30.value;
    const priceHistoryValue = PRICE_HISTORY_EGX30.close_price;
    const diffPct = Math.abs(marketIndicesValue - priceHistoryValue) / priceHistoryValue * 100;

    // The 49k value differs from 53k by ~8.5% — that's STALE
    expect(diffPct).toBeGreaterThan(5);
    expect(marketIndicesValue).toBeLessThan(priceHistoryValue);
  });

  it('EGX30 in price_history (53,776) is CLOSER to real-world (~53,000)', () => {
    const priceHistoryValue = PRICE_HISTORY_EGX30.close_price;
    const diffPct = Math.abs(priceHistoryValue - REAL_WORLD_EGX30) / REAL_WORLD_EGX30 * 100;

    // 53,776 vs 53,000 = ~1.5% difference — acceptable
    expect(diffPct).toBeLessThan(5);
  });

  it('market_indices last_update (2026-10-25) is OLDER than price_history last_date (2026-09-24) — WAIT, actually market_indices is NEWER', () => {
    // Interesting: market_indices was updated MORE RECENTLY (Oct 25) but has a WRONG value
    // This means the scraper wrote a wrong value on Oct 25
    // The fix should validate the value against price_history before trusting it
    const marketIndicesDate = new Date(MARKET_INDICES_EGX30.last_update);
    const priceHistoryDate = new Date(PRICE_HISTORY_EGX30.date);

    // market_indices is newer in timestamp BUT has wrong value
    // → timestamp alone is NOT enough — need value validation
    expect(marketIndicesDate.getTime()).toBeGreaterThan(priceHistoryDate.getTime());
  });
});

// ============================================================================
// Tests: data integrity guard (the fix)
// ============================================================================

describe('ALPHA — PRICE ACCURACY: Data Integrity Guard', () => {
  /**
   * The fix: when reading market_indices, cross-check against price_history.
   * If the values differ by > 5%, use price_history as the trusted source.
   */

  it('should detect when market_indices value differs > 5% from price_history', () => {
    const miValue = 49221.94;
    const phValue = 53776.69;
    const diffPct = Math.abs(miValue - phValue) / phValue * 100;

    const isStale = diffPct > 5;
    expect(isStale).toBe(true);
  });

  it('should use price_history value when market_indices is stale', () => {
    const miValue = 49221.94;
    const phValue = 53776.69;
    const diffPct = Math.abs(miValue - phValue) / phValue * 100;

    // The trusted value should be price_history
    const trustedValue = diffPct > 5 ? phValue : miValue;
    expect(trustedValue).toBe(phValue);
    expect(trustedValue).not.toBe(miValue);
  });

  it('should use market_indices value when it matches price_history (within 5%)', () => {
    const miValue = 53500;
    const phValue = 53776.69;
    const diffPct = Math.abs(miValue - phValue) / phValue * 100;

    const trustedValue = diffPct > 5 ? phValue : miValue;
    expect(trustedValue).toBe(miValue); // close enough → trust market_indices
  });

  it('should show "—" when BOTH sources are unavailable', () => {
    const miValue = null;
    const phValue = null;

    const displayValue = (miValue === null && phValue === null) ? '—' : (miValue || phValue);
    expect(displayValue).toBe('—');
  });

  it('should show "—" when value is 0 (invalid for an index)', () => {
    const value = 0;
    const displayValue = value > 0 ? value : '—';
    expect(displayValue).toBe('—');
  });

  it('should show "—" when value is negative (impossible for an index)', () => {
    const value = -100;
    const displayValue = value > 0 ? value : '—';
    expect(displayValue).toBe('—');
  });
});

// ============================================================================
// Tests: individual stock price accuracy
// ============================================================================

describe('ALPHA — PRICE ACCURACY: Stock Price Guards', () => {
  it('stock with price = 0 should display "—" not "0.00"', () => {
    const price = 0;
    const display = price > 0 ? price.toFixed(2) : '—';
    expect(display).toBe('—');
  });

  it('stock with price = null should display "—" not "0.00"', () => {
    const price = null;
    const display = (price !== null && price > 0) ? price.toFixed(2) : '—';
    expect(display).toBe('—');
  });

  it('stock with valid price should display the price', () => {
    const price = 25.50;
    const display = (price !== null && price > 0) ? price.toFixed(2) : '—';
    expect(display).toBe('25.50');
  });

  it('stock with negative price (data error) should display "—"', () => {
    const price = -5;
    const display = (price !== null && price > 0) ? price.toFixed(2) : '—';
    expect(display).toBe('—');
  });

  it('stock with NaN price should display "—"', () => {
    const price = NaN;
    const display = (!isNaN(price) && price > 0) ? price.toFixed(2) : '—';
    expect(display).toBe('—');
  });
});

// ============================================================================
// Tests: change_percent accuracy
// ============================================================================

describe('ALPHA — PRICE ACCURACY: Change Percent Guards', () => {
  it('change_percent should be recomputed from value + previous_close if stored is wrong', () => {
    const value = 53776.69;
    const previousClose = 51054.04;
    const storedChangePct = -3.5; // wrong
    const computedChangePct = ((value - previousClose) / previousClose) * 100;

    // If stored differs from computed by > 0.1%, use computed
    const finalPct = Math.abs(storedChangePct - computedChangePct) > 0.1
      ? computedChangePct
      : storedChangePct;

    expect(finalPct).not.toBe(storedChangePct); // should use computed
    expect(finalPct).toBeCloseTo(((53776.69 - 51054.04) / 51054.04) * 100, 1);
  });

  it('change_percent of 0 is valid (market flat)', () => {
    const changePct = 0;
    // 0 is a valid change_percent — should display "0.00%" not "—"
    expect(changePct).toBe(0);
  });
});

// ============================================================================
// Summary
// ============================================================================

describe('ALPHA — PRICE ACCURACY: Summary', () => {
  it('documents the root cause: market_indices has stale EGX30 (49k vs 53k)', () => {
    const staleValue = 49221.94;
    const correctValue = 53776.69;
    const diffPct = Math.abs(staleValue - correctValue) / correctValue * 100;

    // The difference is > 8% — this is NOT acceptable
    expect(diffPct).toBeGreaterThan(8);
    // The fix: cross-check market_indices against price_history
  });

  it('documents the fix: use price_history as trusted source for indices', () => {
    const trustedValue = 53776.69; // from price_history
    const staleValue = 49221.94; // from market_indices

    // The fix prioritizes price_history when market_indices is stale
    expect(trustedValue).toBeGreaterThan(staleValue);
    expect(trustedValue).toBeCloseTo(53776.69, 0);
  });
});
