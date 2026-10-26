/**
 * A1 — Liquidity Radar UI — Fixture Verification Test
 * =====================================================================
 * Task 2-b (Alpha A1) — Verifies that LiquidityRadarView consumes the B3
 * (Task 2-a) contract correctly:
 *
 *   - reads `response.results` (the FULL scanned set — no vanishing).
 *   - reads `response.summary` for total / classified / unclassified /
 *     data-error counts.
 *   - filter counts come from REAL API data — NO hardcoded numbers.
 *   - DATA_INVALID / INSUFFICIENT_DATA render as their OWN group
 *     (the `data_invalid` chip) — NOT under `dead_trap`.
 *   - a stock in multiple legacy lists does NOT inflate the total
 *     (the canonical `classification` field is the single source of truth).
 *
 * The dev server in this sandbox gets OOM-killed repeatedly (4 GB RAM
 * limit — see dmesg `oom-killer: next-server (v1)`). The owner's directive
 * explicitly allows fixture verification in this case.
 *
 * Run: npx vitest run src/__tests__/components/a1-liquidity-radar.test.tsx
 *
 * Two test layers:
 *   1. PURE HELPER TESTS — verify `filterStocksByClassification`,
 *      `buildRadarFilterCounts`, `isDataInvalidStock` against a sample
 *      B3 stock array (5 stocks: quiet_accumulation, dead_trap,
 *      unclassified, DATA_INVALID, INSUFFICIENT_DATA).
 *   2. RENDER TEST — render `<LiquidityRadarView market="EGX" />` with
 *      mocked `fetch` + mocked heavy dependencies, then assert:
 *        - all 5 tickers appear in the DOM
 *        - clicking the dead_trap chip hides the DATA_INVALID ticker
 *        - the data_invalid chip shows the right count
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// jsdom doesn't implement HTMLCanvasElement.prototype.getContext — UnifiedTable
// uses a canvas for the column-resize handle. Stub it so the test doesn't spew.
beforeEach(() => {
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = HTMLCanvasElement.prototype.getContext || (() => null);
  }
});

// ─── PURE HELPERS UNDER TEST ────────────────────────────────────────────
import {
  RADAR_FILTERS,
  filterStocksByClassification,
  buildRadarFilterCounts,
  getRadarFilterCount,
  isDataInvalidStock,
  classifyStock,
  describeRadarStatus,
  getRadarStatusReasons,
  filterKeyForStock,
  type RadarStockLike,
  type RadarSummaryLike,
} from '@/components/shared/radar-filters';

// ─── FIXtures — sample B3 response (5 stocks, one per classification) ──

interface FixtureStock extends RadarStockLike {
  ticker: string;
  classification: string;
  reasons?: string[] | null;
  sanity_reasons?: string[] | null;
  sanity_status?: string | null;
  data_quality_status?: string | null;
}

const NOW_ISO = new Date().toISOString();

const STOCK_QUIET: FixtureStock = {
  ticker: 'COMI',
  classification: 'quiet_accumulation',
  reasons: ['avg_volume_10d > avg_volume_20d × 1.4', 'price_stability < 3%'],
  data_quality_status: 'OK',
  sanity_status: 'OK',
};

const STOCK_DEAD: FixtureStock = {
  ticker: 'ADPC',
  classification: 'dead_trap',
  reasons: ['kill_switch=true', 'limit_up_trap detected'],
  data_quality_status: 'OK',
  sanity_status: 'OK',
};

const STOCK_UNCLASSIFIED: FixtureStock = {
  ticker: 'EZZD',
  classification: 'unclassified',
  reasons: ['no rule matched'],
  data_quality_status: 'OK',
  sanity_status: 'OK',
};

const STOCK_DATA_INVALID: FixtureStock = {
  ticker: 'DATA_BAD_001',
  classification: 'DATA_INVALID',
  reasons: ['currency_market_mismatch', 'history_current_mismatch ratio=73.7x'],
  sanity_status: 'DATA_INVALID',
  sanity_reasons: ['price_data_invalid'],
  data_quality_status: 'INVALID',
};

const STOCK_INSUFFICIENT: FixtureStock = {
  ticker: 'DATA_SHORT_002',
  classification: 'INSUFFICIENT_DATA',
  reasons: ['less than 15 days of price history'],
  sanity_status: 'DATA_UNAVAILABLE',
  data_quality_status: 'UNAVAILABLE',
};

const SAMPLE_STOCKS: FixtureStock[] = [
  STOCK_QUIET,
  STOCK_DEAD,
  STOCK_UNCLASSIFIED,
  STOCK_DATA_INVALID,
  STOCK_INSUFFICIENT,
];

const SAMPLE_SUMMARY: RadarSummaryLike = {
  source_count: 5,
  scanned_count: 5,
  valid_data_count: 3,
  classified_count: 2,
  unclassified_count: 1,
  data_error_count: 2,
  scan_timestamp: NOW_ISO,
};

// ============================================================================
// 1. PURE HELPER TESTS
// ============================================================================

describe('A1 — Pure helpers: classifyStock', () => {
  it('returns the classification verbatim when it matches the enum', () => {
    expect(classifyStock(STOCK_QUIET)).toBe('quiet_accumulation');
    expect(classifyStock(STOCK_DEAD)).toBe('dead_trap');
    expect(classifyStock(STOCK_UNCLASSIFIED)).toBe('unclassified');
    expect(classifyStock(STOCK_DATA_INVALID)).toBe('DATA_INVALID');
    expect(classifyStock(STOCK_INSUFFICIENT)).toBe('INSUFFICIENT_DATA');
  });

  it('falls back to "unclassified" when classification is missing or unknown (NOT "dead_trap")', () => {
    // HARD CONSTRAINT #6: don't treat absence from a list as evidence a stock is dead.
    expect(classifyStock({ ticker: 'X', classification: null })).toBe('unclassified');
    expect(classifyStock({ ticker: 'X', classification: undefined })).toBe('unclassified');
    expect(classifyStock({ ticker: 'X', classification: '' })).toBe('unclassified');
    expect(classifyStock({ ticker: 'X', classification: 'unknown_thing' })).toBe('unclassified');
  });
});

describe('A1 — Pure helpers: isDataInvalidStock', () => {
  it('returns true for DATA_INVALID and INSUFFICIENT_DATA (NOT for dead_trap)', () => {
    // HARD CONSTRAINT #5: DATA_INVALID / INSUFFICIENT_DATA are a SEPARATE state.
    expect(isDataInvalidStock(STOCK_DATA_INVALID)).toBe(true);
    expect(isDataInvalidStock(STOCK_INSUFFICIENT)).toBe(true);
    expect(isDataInvalidStock(STOCK_DEAD)).toBe(false);
    expect(isDataInvalidStock(STOCK_QUIET)).toBe(false);
    expect(isDataInvalidStock(STOCK_UNCLASSIFIED)).toBe(false);
  });
});

describe('A1 — Pure helpers: filterKeyForStock', () => {
  it('maps DATA_INVALID + INSUFFICIENT_DATA to the same chip (data_invalid)', () => {
    expect(filterKeyForStock(STOCK_DATA_INVALID)).toBe('data_invalid');
    expect(filterKeyForStock(STOCK_INSUFFICIENT)).toBe('data_invalid');
  });

  it('maps other classifications 1:1 to their chip key', () => {
    expect(filterKeyForStock(STOCK_QUIET)).toBe('quiet_accumulation');
    expect(filterKeyForStock(STOCK_DEAD)).toBe('dead_trap');
    expect(filterKeyForStock(STOCK_UNCLASSIFIED)).toBe('unclassified');
  });
});

describe('A1 — Pure helpers: filterStocksByClassification', () => {
  it('returns the FULL set for the "all" filter (no vanishing)', () => {
    // HARD CONSTRAINT #1: Show ALL stocks the API sends.
    const out = filterStocksByClassification(SAMPLE_STOCKS, 'all');
    expect(out).toHaveLength(5);
    expect(out.map((s) => s.ticker).sort()).toEqual(
      ['COMI', 'ADPC', 'EZZD', 'DATA_BAD_001', 'DATA_SHORT_002'].sort(),
    );
  });

  it('returns ONLY the dead_trap stock for the "dead_trap" filter', () => {
    const out = filterStocksByClassification(SAMPLE_STOCKS, 'dead_trap');
    expect(out).toHaveLength(1);
    expect(out[0].ticker).toBe('ADPC');
    // HARD CONSTRAINT #5: DATA_INVALID MUST NOT appear under dead_trap.
    expect(out.find((s) => s.ticker === 'DATA_BAD_001')).toBeUndefined();
    expect(out.find((s) => s.ticker === 'DATA_SHORT_002')).toBeUndefined();
  });

  it('returns BOTH bad-data stocks under the "data_invalid" filter (combined)', () => {
    const out = filterStocksByClassification(SAMPLE_STOCKS, 'data_invalid');
    expect(out).toHaveLength(2);
    const tickers = out.map((s) => s.ticker).sort();
    expect(tickers).toEqual(['DATA_BAD_001', 'DATA_SHORT_002'].sort());
  });

  it('returns ONLY the unclassified stock for the "unclassified" filter', () => {
    const out = filterStocksByClassification(SAMPLE_STOCKS, 'unclassified');
    expect(out).toHaveLength(1);
    expect(out[0].ticker).toBe('EZZD');
  });

  it('returns ONLY the quiet_accumulation stock for the "quiet_accumulation" filter', () => {
    const out = filterStocksByClassification(SAMPLE_STOCKS, 'quiet_accumulation');
    expect(out).toHaveLength(1);
    expect(out[0].ticker).toBe('COMI');
  });

  it('returns an empty array for a filter with no matching stocks', () => {
    expect(filterStocksByClassification(SAMPLE_STOCKS, 'distribution')).toHaveLength(0);
    expect(filterStocksByClassification(SAMPLE_STOCKS, 'liquidity_drought')).toHaveLength(0);
    expect(filterStocksByClassification(SAMPLE_STOCKS, 'rule80_downtrend')).toHaveLength(0);
  });
});

describe('A1 — Pure helpers: buildRadarFilterCounts', () => {
  const counts = buildRadarFilterCounts(SAMPLE_STOCKS, SAMPLE_SUMMARY);

  it('uses summary.scanned_count for the "all" count (canonical total)', () => {
    // HARD CONSTRAINT #2: total scanned == summary.scanned_count.
    expect(counts.all).toBe(5);
  });

  it('computes 1 for each chip that has exactly one matching stock', () => {
    // HARD CONSTRAINT #3: counts come from REAL API data — NO hardcoding.
    expect(counts.quiet_accumulation).toBe(1);
    expect(counts.dead_trap).toBe(1);
    expect(counts.unclassified).toBe(1);
  });

  it('computes 2 for the data_invalid chip (DATA_INVALID + INSUFFICIENT_DATA combined)', () => {
    expect(counts.data_invalid).toBe(2);
  });

  it('computes 0 for chips with no matching stocks', () => {
    expect(counts.distribution).toBe(0);
    expect(counts.liquidity_drought).toBe(0);
    expect(counts.rule80_downtrend).toBe(0);
  });

  it('sums to scanned_count (NO double-counting — HARD CONSTRAINT #4)', () => {
    // Each stock contributes to EXACTLY ONE chip (except `all` which is the
    // canonical total). Sum of all non-all chips == total stocks.
    const sum =
      counts.quiet_accumulation +
      counts.distribution +
      counts.dead_trap +
      counts.liquidity_drought +
      counts.rule80_downtrend +
      counts.unclassified +
      counts.data_invalid;
    expect(sum).toBe(5);
    expect(sum).toBe(counts.all);
  });

  it('falls back to stocks.length when summary is missing (no fabrication)', () => {
    const counts2 = buildRadarFilterCounts(SAMPLE_STOCKS, null);
    expect(counts2.all).toBe(5); // == SAMPLE_STOCKS.length
  });

  it('falls back to stocks.length when summary has no scanned_count', () => {
    const counts3 = buildRadarFilterCounts(SAMPLE_STOCKS, { source_count: 5 });
    expect(counts3.all).toBe(5);
  });
});

describe('A1 — Pure helpers: getRadarFilterCount', () => {
  it('returns the same value as buildRadarFilterCounts for each filter', () => {
    for (const f of RADAR_FILTERS) {
      const a = getRadarFilterCount(SAMPLE_STOCKS, f.key, SAMPLE_SUMMARY);
      const b = buildRadarFilterCounts(SAMPLE_STOCKS, SAMPLE_SUMMARY)[f.key];
      expect(a, `for filter ${f.key}`).toBe(b);
    }
  });
});

describe('A1 — Pure helpers: describeRadarStatus', () => {
  it('returns Arabic label for each classification', () => {
    expect(describeRadarStatus(STOCK_DATA_INVALID)).toBe('بيانات غير صالحة');
    expect(describeRadarStatus(STOCK_INSUFFICIENT)).toBe('بيانات غير مكتملة');
    expect(describeRadarStatus(STOCK_QUIET)).toBe('تجميع هادئ');
    expect(describeRadarStatus(STOCK_DEAD)).toBe('مصيدة');
    expect(describeRadarStatus(STOCK_UNCLASSIFIED)).toBe('غير مصنف');
  });
});

describe('A1 — Pure helpers: getRadarStatusReasons', () => {
  it('joins `reasons` + `sanity_reasons` (dedup, preserve order)', () => {
    expect(getRadarStatusReasons(STOCK_DATA_INVALID)).toEqual([
      'currency_market_mismatch',
      'history_current_mismatch ratio=73.7x',
      'price_data_invalid',
    ]);
  });

  it('returns [] when no reasons present', () => {
    expect(getRadarStatusReasons({ ticker: 'X' })).toEqual([]);
  });
});

// ============================================================================
// 2. RENDER TEST — verify the full component consumes the B3 contract
// ============================================================================
//
// We mock `fetch` to return the sample B3 response, plus mock the heavy
// dependencies the component pulls in (MiniSparkline, UnifiedPublishButton,
// StockDetailDrawer, useAppStore, useSession, useTranslation,
// useVisibilityAwarePolling, FlashingPriceCell, LiquidityFlashCell,
// SectorTrackingTab, LockModal).

// Mock heavy UI dependencies so the test renders fast + doesn't pull in
// the full Next.js auth / publishing stack.
vi.mock('@/components/ui/mini-sparkline', () => ({
  MiniSparkline: ({ ticker }: { ticker: string }) =>
    React.createElement('span', { 'data-testid': 'sparkline', 'data-ticker': ticker }, '📊'),
}));

vi.mock('@/modules/publishing/components/UnifiedPublishButton', () => ({
  UnifiedPublishButton: ({ title }: { title?: string }) =>
    React.createElement('button', { 'data-testid': 'publish-btn' }, title || 'publish'),
}));

vi.mock('@/modules/publishing/lib/official-links', () => ({
  OFFICIAL_LINKS_BLOCK: '',
}));

vi.mock('@/components/auth/LockModal', () => ({
  LockModal: () => null,
}));

vi.mock('@/modules/predictions/components/MakerRadarTab', () => ({
  StockDetailDrawer: () => null,
}));

vi.mock('@/components/auth/GuestLimitCta', () => ({
  GuestLimitCta: () => null,
}));

vi.mock('@/modules/market-analysis/components/SectorTrackingTab', () => ({
  SectorTrackingTab: () => null,
}));

vi.mock('@/components/shared/FlashingPriceCell', () => ({
  FlashingPriceCell: ({ price }: { price: number | null }) =>
    React.createElement('span', null, price == null ? '—' : String(price)),
}));

vi.mock('@/components/shared/ui', () => ({
  FlowPhaseTag: () => null,
  UnifiedEmptyState: ({ title, description }: { title?: string; description?: string }) =>
    React.createElement('div', { 'data-testid': 'empty-state' }, `${title} — ${description}`),
  LiquidityFlashCell: ({ value }: { value: number | null }) =>
    React.createElement('span', null, value == null ? '—' : String(value)),
  UnifiedPagination: () => null,
}));

vi.mock('@/hooks/useVisibilityAwarePolling', () => ({
  useVisibilityAwarePolling: () => {},
}));

vi.mock('@/lib/store', () => ({
  useAppStore: () => 'EGX',
}));

vi.mock('@/lib/next-auth-shim', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' as const, update: async () => null }),
}));

vi.mock('@/lib/i18n-context', () => ({
  useTranslation: () => (key: string) => key,
}));

// Import the component AFTER all mocks are in place so they apply.
const { LiquidityRadarView } = await import('@/components/shared/LiquidityRadarView');

// Helper: build a full RadarResponse (with results + summary + stocks alias)
// that mirrors what /api/v2/liquidity-radar returns post-B3.
function buildB3Response(stocks: FixtureStock[]): unknown {
  // Each stock is wrapped with the fields the API route adds (whale,
  // market_regime, phase, entry_defense, etc.).
  const wrapped = stocks.map((s) => ({
    ticker: s.ticker,
    name: s.ticker,
    classification: s.classification,
    reasons: s.reasons ?? null,
    sanity_status: s.sanity_status ?? null,
    sanity_reasons: s.sanity_reasons ?? null,
    data_quality_status: s.data_quality_status ?? null,
    data_quality: null,
    scan_timestamp: NOW_ISO,
    company: s.ticker,
    market: 'EGX',
    currency: 'EGP',
    current_price: 100,
    change_percent: 1.5,
    whale: { net_flow_egp: 1000, whale_present: true, flow_strength: 'ضعيف', buy_pct: 50, sell_pct: 50 },
    market_regime: { regime: 'NORMAL', change_pct: 0.5, is_bear: false, is_bull: false },
    phase: s.classification,
    phase_reason: (s.reasons ?? []).join(' | '),
    entry_defense: { entry_level: 100, defense_level: 95, resistance_level: 110 },
    reason: (s.reasons ?? []).join(' | '),
    liquidity_bucket: null,
    liquidity_bucket_ar: null,
    net_flow_5d: 1000,
    volume: 1000,
    correction_status: null,
    drop_from_peak: null,
    accumulation: null,
    expected: null,
    roc_10d: null,
    turnover_egp: 2_000_000,
  }));
  return {
    success: true,
    market: 'EGX',
    market_regime: { regime: 'NORMAL', change_pct: 0.5, is_bear: false, is_bull: false },
    scanned_count: stocks.length,
    source_count: stocks.length,
    summary: SAMPLE_SUMMARY,
    phases_breakdown: null,
    stocks: wrapped,
    results: wrapped,
    error: null,
    message: null,
  };
}

describe('A1 — LiquidityRadarView render test', () => {
  beforeEach(() => {
    cleanup();
    // Default mock: returns the sample B3 response for any fetch call.
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => buildB3Response(SAMPLE_STOCKS),
    }));
  });

  it('renders ALL 5 stocks from response.results (no vanishing)', async () => {
    render(React.createElement(LiquidityRadarView, { market: 'EGX' }));
    // Wait for at least the first stock to appear.
    await waitFor(() => {
      expect(screen.getAllByText('COMI').length).toBeGreaterThan(0);
    });
    // All 5 tickers must render — HARD CONSTRAINT #1. Each ticker may appear
    // multiple times (column header + row cell + filter), so use getAllByText.
    for (const ticker of ['COMI', 'ADPC', 'EZZD', 'DATA_BAD_001', 'DATA_SHORT_002']) {
      expect(screen.getAllByText(ticker).length, `ticker ${ticker} should render`).toBeGreaterThan(0);
    }
  });

  it('renders the canonical scanned count from summary (== 5)', async () => {
    render(React.createElement(LiquidityRadarView, { market: 'EGX' }));
    await waitFor(() => {
      expect(screen.getAllByText('COMI').length).toBeGreaterThan(0);
    });
    // The PulseRibbon shows "مرقوب: N سهم" where N comes from summary.scanned_count.
    // HARD CONSTRAINT #2: total count == API's summary.scanned_count.
    const ribbon = screen.getByText(/مرقوب:/);
    expect(ribbon.textContent).toMatch(/5/);
  });

  it('shows the correct filter counts on each chip (NO hardcoding)', async () => {
    render(React.createElement(LiquidityRadarView, { market: 'EGX' }));
    await waitFor(() => {
      expect(screen.getAllByText('COMI').length).toBeGreaterThan(0);
    });
    // HARD CONSTRAINT #3: counts come from REAL API data.
    // The "الكل" (all) chip shows (5).
    const allChip = screen.getByLabelText(/الكل \(5\)/i);
    expect(allChip).toBeInTheDocument();
    // The "مصيدة" (dead_trap) chip shows (1).
    const deadChip = screen.getByLabelText(/مصيدة \(1\)/i);
    expect(deadChip).toBeInTheDocument();
    // The "بيانات غير مكتملة" (data_invalid) chip shows (2) — DATA_INVALID +
    // INSUFFICIENT_DATA combined. HARD CONSTRAINT #5.
    const dataInvalidChip = screen.getByLabelText(/بيانات غير مكتملة \(2\)/i);
    expect(dataInvalidChip).toBeInTheDocument();
  });

  it('DATA_INVALID stock does NOT appear when dead_trap filter is active', async () => {
    render(React.createElement(LiquidityRadarView, { market: 'EGX' }));
    await waitFor(() => {
      expect(screen.getAllByText('COMI').length).toBeGreaterThan(0);
    });
    // Click the "مصيدة" (dead_trap) chip.
    const deadChip = screen.getByLabelText(/مصيدة \(1\)/i);
    fireEvent.click(deadChip);
    // After filtering, only ADPC should be visible.
    await waitFor(() => {
      expect(screen.getAllByText('ADPC').length).toBeGreaterThan(0);
    });
    // HARD CONSTRAINT #5: DATA_INVALID MUST NOT appear under dead_trap.
    expect(screen.queryByText('DATA_BAD_001')).not.toBeInTheDocument();
    expect(screen.queryByText('DATA_SHORT_002')).not.toBeInTheDocument();
    // Also other classifications should be hidden.
    expect(screen.queryByText('COMI')).not.toBeInTheDocument();
    expect(screen.queryByText('EZZD')).not.toBeInTheDocument();
  });

  it('DATA_INVALID + INSUFFICIENT_DATA stocks appear under the data_invalid filter', async () => {
    render(React.createElement(LiquidityRadarView, { market: 'EGX' }));
    await waitFor(() => {
      expect(screen.getAllByText('COMI').length).toBeGreaterThan(0);
    });
    const dataInvalidChip = screen.getByLabelText(/بيانات غير مكتملة \(2\)/i);
    fireEvent.click(dataInvalidChip);
    await waitFor(() => {
      expect(screen.getAllByText('DATA_BAD_001').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('DATA_BAD_001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DATA_SHORT_002').length).toBeGreaterThan(0);
    // Trade-signal stocks should NOT appear under the data_invalid filter.
    expect(screen.queryByText('COMI')).not.toBeInTheDocument();
    expect(screen.queryByText('ADPC')).not.toBeInTheDocument();
  });

  it('shows honest "scanned but no classifications" message when results empty but summary.scanned_count > 0', async () => {
    // Edge case: backend bug — summary says scanned > 0 but results is empty.
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        market: 'EGX',
        market_regime: { regime: 'NORMAL', change_pct: 0.5, is_bear: false, is_bull: false },
        scanned_count: 7,
        source_count: 7,
        summary: { ...SAMPLE_SUMMARY, scanned_count: 7, source_count: 7 },
        phases_breakdown: null,
        stocks: [],
        results: [],
        error: null,
        message: null,
      }),
    }));
    render(React.createElement(LiquidityRadarView, { market: 'EGX' }));
    // HARD CONSTRAINT: if results is empty but summary says scanned > 0,
    // show "تم الفحص لكن لا توجد تصنيفات" (honest), NOT a dead-trap list.
    await waitFor(() => {
      expect(screen.getByText(/تم الفحص لكن لا توجد تصنيفات/i)).toBeInTheDocument();
    });
  });
});
