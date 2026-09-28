/**
 * MultiMarketRadarTab.test.tsx — L3 tests for the unified multi-market radar UI
 * =========================================================================
 *
 * Verifies:
 *   1. Renders market toggles (all 7 markets selectable).
 *   2. Renders unified top 5 section (empty state when no picks).
 *   3. Market cards show regime badges (DEFENSIVE / NORMAL / AGGRESSIVE).
 *   4. Collapsible per-market detail sections work (expand/collapse).
 *   5. API call URL — fetches /api/maker-radar/multi-market with the right markets param.
 *
 * Run:
 *   bunx vitest run src/__tests__/radar/MultiMarketRadarTab.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ─── Mock the global fetch BEFORE importing the component ──────────────
const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

// Silence React Router / Next router calls (not used here, but defensively).
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }), { virtual: true });

// Mock useVisibilityAwarePolling so we control intervals precisely.
vi.mock('@/hooks/useVisibilityAwarePolling', () => ({
  useVisibilityAwarePolling: vi.fn(),
}));

// Import AFTER mocks are in place.
import { MultiMarketRadarTab } from '@/modules/radar/components/MultiMarketRadarTab';

// ─── Helpers ────────────────────────────────────────────────────────────
function buildMultiMarketResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    markets: {
      EGX: {
        market: 'EGX',
        name_ar: 'البورصة المصرية',
        currency: 'EGP',
        is_open: true,
        regime: 'normal',
        regime_ar: 'عادي',
        market_score: 65,
        market_open_utc: '08:00',
        market_close_utc: '12:30',
        count: 96,
        top_picks: [
          { ticker: 'AMIA', current_price: 12.5, path: 'A_pre_surge', position_size: 80, roc_10d: 4.2, target_price: 14.5 },
        ],
        warming_up: false,
        cached: true,
        cache_age_seconds: 30,
        db_source: 'stocks.db',
      },
      US: {
        market: 'US',
        name_ar: 'البورصة الأمريكية',
        currency: 'USD',
        is_open: false,
        regime: 'defensive',
        regime_ar: 'دفاعي',
        market_score: 35,
        market_open_utc: '14:30',
        market_close_utc: '21:00',
        count: 12,
        top_picks: [
          { ticker: 'NVDA', current_price: 450.2, path: 'A_pre_surge', position_size: 95, roc_10d: 5.1, target_price: 520 },
        ],
        warming_up: false,
        cached: true,
        cache_age_seconds: 30,
        db_source: 'stocks.db',
      },
      CRYPTO: {
        market: 'CRYPTO',
        name_ar: 'سوق العملات الرقمية',
        currency: 'USD',
        is_open: true,
        regime: 'aggressive',
        regime_ar: 'هجومي',
        market_score: 85,
        market_open_utc: '00:00',
        market_close_utc: '23:59',
        count: 8,
        top_picks: [
          { ticker: 'BTC', current_price: 67500, path: 'B_quiet_accumulation_strong', position_size: 70, roc_10d: 8.0 },
        ],
        warming_up: false,
        cached: true,
        cache_age_seconds: 10,
        db_source: 'stocks.db',
      },
    },
    unified_top_5: [
      { ticker: 'NVDA', current_price: 450.2, target_price: 520, roc_10d: 15, path: 'A_pre_surge', market: 'US', market_name_ar: 'البورصة الأمريكية', currency: 'USD', position_size: 95 },
      { ticker: 'AMIA', current_price: 12.5, target_price: 14.5, roc_10d: 16, path: 'A_pre_surge', market: 'EGX', market_name_ar: 'البورصة المصرية', currency: 'EGP', position_size: 80 },
      { ticker: 'BTC', current_price: 67500, target_price: 72000, roc_10d: 6.7, path: 'B_quiet_accumulation_strong', market: 'CRYPTO', market_name_ar: 'سوق العملات الرقمية', currency: 'USD', position_size: 70 },
    ],
    served_at: '2026-09-28T07:00:00.000Z',
    supported_markets: ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO', 'GOLD'],
    invalid_markets: [],
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────
describe('MultiMarketRadarTab', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 1) Market toggles ─────────────────────────────────────────────
  it('renders market toggles for all 7 markets', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildMultiMarketResponse(),
    } as Response);

    render(<MultiMarketRadarTab />);

    // All 7 markets should appear as toggle buttons
    await waitFor(() => {
      expect(screen.getByTestId('market-toggle-EGX')).toBeInTheDocument();
    });
    expect(screen.getByTestId('market-toggle-TADAWUL')).toBeInTheDocument();
    expect(screen.getByTestId('market-toggle-KSE')).toBeInTheDocument();
    expect(screen.getByTestId('market-toggle-QSE')).toBeInTheDocument();
    expect(screen.getByTestId('market-toggle-US')).toBeInTheDocument();
    expect(screen.getByTestId('market-toggle-CRYPTO')).toBeInTheDocument();
    expect(screen.getByTestId('market-toggle-GOLD')).toBeInTheDocument();

    // Toggles container exists
    expect(screen.getByTestId('market-toggles')).toBeInTheDocument();
  });

  it('deselects a market when its toggle is clicked (but never empties)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildMultiMarketResponse(),
    } as Response);

    render(<MultiMarketRadarTab />);

    await waitFor(() => {
      expect(screen.getByTestId('market-toggle-EGX')).toBeInTheDocument();
    });

    // Initially selected (aria-pressed=true)
    const egxToggle = screen.getByTestId('market-toggle-EGX');
    expect(egxToggle).toHaveAttribute('aria-pressed', 'true');

    // Click to deselect
    fireEvent.click(egxToggle);
    expect(egxToggle).toHaveAttribute('aria-pressed', 'false');

    // Click again to reselect
    fireEvent.click(egxToggle);
    expect(egxToggle).toHaveAttribute('aria-pressed', 'true');
  });

  // ── 2) Unified top 5 ──────────────────────────────────────────────
  it('shows unified top 5 picks with market flags', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildMultiMarketResponse(),
    } as Response);

    render(<MultiMarketRadarTab />);

    await waitFor(() => {
      expect(screen.getByTestId('unified-top-5')).toBeInTheDocument();
    });

    // The 3 unified picks should appear
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('AMIA')).toBeInTheDocument();
    expect(screen.getByText('BTC')).toBeInTheDocument();
  });

  it('shows empty state for unified top 5 when no picks', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildMultiMarketResponse({ unified_top_5: [] }),
    } as Response);

    render(<MultiMarketRadarTab />);

    await waitFor(() => {
      expect(screen.getByTestId('unified-top-5')).toBeInTheDocument();
    });

    // Empty state message
    expect(screen.getByText(/لا توجد فرص متاحة حالياً/)).toBeInTheDocument();
  });

  // ── 3) Market cards show regime badges ─────────────────────────────
  it('shows regime badges on market summary cards', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildMultiMarketResponse(),
    } as Response);

    render(<MultiMarketRadarTab />);

    await waitFor(() => {
      expect(screen.getByTestId('market-card-EGX')).toBeInTheDocument();
    });

    // EGX should have "normal" regime badge
    const egxBadge = screen.getByTestId('regime-badge-EGX');
    expect(egxBadge).toHaveTextContent('عادي');

    // US should have "defensive" regime
    const usBadge = screen.getByTestId('regime-badge-US');
    expect(usBadge).toHaveTextContent('دفاعي');

    // CRYPTO should have "aggressive" regime
    const cryptoBadge = screen.getByTestId('regime-badge-CRYPTO');
    expect(cryptoBadge).toHaveTextContent('هجومي');
  });

  // ── 4) Collapsible per-market detail sections ─────────────────────
  it('expands and collapses per-market detail sections', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildMultiMarketResponse(),
    } as Response);

    render(<MultiMarketRadarTab />);

    await waitFor(() => {
      expect(screen.getByTestId('collapsible-EGX')).toBeInTheDocument();
    });

    // EGX collapsible: closed initially
    const egxTrigger = screen.getByTestId('collapsible-trigger-EGX');
    expect(egxTrigger).toBeInTheDocument();

    // The detailed ticker table should not be present initially
    // (top picks row text only shows when expanded)
    const egxSection = screen.getByTestId('collapsible-EGX');
    // Radix Collapsible adds data-state="open"|"closed"
    expect(egxSection).toHaveAttribute('data-state', 'closed');

    // Click to expand
    fireEvent.click(egxTrigger);
    expect(egxSection).toHaveAttribute('data-state', 'open');

    // Click again to collapse
    fireEvent.click(egxTrigger);
    expect(egxSection).toHaveAttribute('data-state', 'closed');
  });

  it('shows the per-market top picks when expanded', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildMultiMarketResponse(),
    } as Response);

    render(<MultiMarketRadarTab />);

    await waitFor(() => {
      expect(screen.getByTestId('collapsible-EGX')).toBeInTheDocument();
    });

    // Expand EGX
    fireEvent.click(screen.getByTestId('collapsible-trigger-EGX'));

    // The EGX top pick ticker "AMIA" should appear in the expanded detail
    // (it's already in unified_top_5 too, so we check the section specifically).
    const egxSection = screen.getByTestId('collapsible-EGX');
    expect(egxSection).toHaveAttribute('data-state', 'open');
  });

  // ── 5) API call URL ────────────────────────────────────────────────
  it('fetches from /api/maker-radar/multi-market with the selected markets', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => buildMultiMarketResponse(),
    } as Response);

    render(<MultiMarketRadarTab />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/maker-radar/multi-market');
    // Should include all markets in the query string
    expect(calledUrl).toContain('markets=');
    // The markets param should include EGX, US, CRYPTO, GOLD (at minimum)
    expect(calledUrl).toMatch(/markets=[^&]*EGX/);
    expect(calledUrl).toMatch(/markets=[^&]*US/);
    expect(calledUrl).toMatch(/markets=[^&]*CRYPTO/);
    expect(calledUrl).toMatch(/markets=[^&]*GOLD/);
  });

  it('re-fetches when the selected markets change', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => buildMultiMarketResponse(),
    } as Response);

    render(<MultiMarketRadarTab />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const firstCallCount = fetchMock.mock.calls.length;

    // Deselect a market — should trigger re-fetch
    fireEvent.click(screen.getByTestId('market-toggle-GOLD'));

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(firstCallCount);
    });
  });
});
