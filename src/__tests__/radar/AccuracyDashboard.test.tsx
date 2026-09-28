/**
 * AccuracyDashboard.test.tsx — L3 tests for the historical accuracy dashboard
 * =========================================================================
 *
 * Verifies:
 *   1. Renders overall stats (total signals, verified, win rate).
 *   2. Shows signal type table (each radar path row).
 *   3. Color coding: green for >60%, amber for 40-60%, rose for <40%.
 *   4. Monthly trend chart + table render.
 *   5. API call URL — fetches /api/radar/accuracy with market + days params.
 *
 * Run:
 *   bunx vitest run src/__tests__/radar/AccuracyDashboard.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ─── Mock fetch BEFORE importing the component ──────────────────────────
const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

// Mock recharts (avoid jsdom + d3 issues in unit tests).
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    // Replace ResponsiveContainer with a no-op div (avoids ResizeObserver issues).
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="mock-responsive-container" style={{ height: '100%', width: '100%' }}>
        {children}
      </div>
    ),
    BarChart: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="mock-bar-chart">{children}</div>
    ),
    Bar: () => <div data-testid="mock-bar" />,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    CartesianGrid: () => null,
    Cell: () => null,
  };
});

// Mock useVisibilityAwarePolling defensively (not used by AccuracyDashboard).
vi.mock('@/hooks/useVisibilityAwarePolling', () => ({
  useVisibilityAwarePolling: vi.fn(),
}));

import { AccuracyDashboard } from '@/components/predictions/radar/AccuracyDashboard';

// ─── Helpers ────────────────────────────────────────────────────────────
function buildAccuracyResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    source: 'predictions_db',
    market: 'EGX',
    days: 90,
    total_signals: 245,
    verified: 207,
    pending: 38,
    wins: 130,
    losses: 77,
    win_rate_pct: 62.5,
    by_signal_type: [
      {
        signal_type: 'pre_surge',
        label: '🚀 Pre-Surge',
        total: 45,
        verified: 38,
        wins: 26,
        losses: 12,
        win_rate_pct: 68.4,
        avg_outcome_7d: 4.1,
        avg_outcome_14d: 6.2,
        avg_outcome_30d: 10.3,
        avg_time_to_target_days: 12.5,
      },
      {
        signal_type: 'quiet_accumulation_strong',
        label: '🎯 تجميع قوي',
        total: 33,
        verified: 33,
        wins: 20,
        losses: 13,
        win_rate_pct: 61.2,
        avg_outcome_7d: 3.0,
        avg_outcome_14d: 5.5,
        avg_outcome_30d: 8.1,
        avg_time_to_target_days: 15.0,
      },
      {
        signal_type: 'explosive_surge',
        label: '💥 انفجار حجمي',
        total: 20,
        verified: 20,
        wins: 11,
        losses: 9,
        win_rate_pct: 55.0,
        avg_outcome_7d: 2.5,
        avg_outcome_14d: 4.0,
        avg_outcome_30d: 6.5,
        avg_time_to_target_days: 8.0,
      },
      {
        signal_type: 'early_break',
        label: '⚡ اختراق مبكر',
        total: 14,
        verified: 14,
        wins: 8,
        losses: 6,
        win_rate_pct: 58.0,
        avg_outcome_7d: 3.0,
        avg_outcome_14d: 5.0,
        avg_outcome_30d: 7.2,
        avg_time_to_target_days: 10.0,
      },
      {
        signal_type: 'quiet_accumulation_weak',
        label: '🔍 تجميع ضعيف',
        total: 20,
        verified: 20,
        wins: 9,
        losses: 11,
        win_rate_pct: 45.0,
        avg_outcome_7d: 1.0,
        avg_outcome_14d: 2.0,
        avg_outcome_30d: 3.1,
        avg_time_to_target_days: 20.0,
      },
    ],
    by_market: [
      { market: 'EGX', total: 180, verified: 150, wins: 98, win_rate_pct: 65.0 },
      { market: 'US', total: 45, verified: 40, wins: 23, win_rate_pct: 57.5 },
      { market: 'CRYPTO', total: 20, verified: 17, wins: 12, win_rate_pct: 70.0 },
    ],
    monthly_trend: [
      { month: '2026-07', total: 30, verified: 28, wins: 17, win_rate_pct: 60.0 },
      { month: '2026-08', total: 45, verified: 40, wins: 26, win_rate_pct: 65.0 },
      { month: '2026-09', total: 50, verified: 45, wins: 32, win_rate_pct: 70.0 },
    ],
    served_at: '2026-09-28T07:00:00.000Z',
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────
describe('AccuracyDashboard', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 1) Overall stats ──────────────────────────────────────────────
  it('renders overall stats: total signals, verified, win rate', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildAccuracyResponse(),
    } as Response);

    render(<AccuracyDashboard market="EGX" />);

    await waitFor(() => {
      expect(screen.getByTestId('accuracy-dashboard')).toBeInTheDocument();
    });

    // Total signals should appear (245)
    expect(screen.getByText('245')).toBeInTheDocument();

    // Verified count (207)
    expect(screen.getByText('207')).toBeInTheDocument();

    // Win rate percentage (62.5%) — appears in multiple places (header + progress)
    const allWinRateNodes = screen.getAllByText('62.5%');
    expect(allWinRateNodes.length).toBeGreaterThan(0);

    // Wins/Losses (130 / 77)
    expect(screen.getByText('130 / 77')).toBeInTheDocument();
  });

  it('shows pending count as subtitle of verified stat', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildAccuracyResponse(),
    } as Response);

    render(<AccuracyDashboard market="EGX" />);

    await waitFor(() => {
      expect(screen.getByText('245')).toBeInTheDocument();
    });

    // +38 قيد الانتظار
    expect(screen.getByText(/\+38 قيد الانتظار/)).toBeInTheDocument();
  });

  // ── 2) Signal type table ──────────────────────────────────────────
  it('shows signal type table with all radar paths', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildAccuracyResponse(),
    } as Response);

    render(<AccuracyDashboard market="EGX" />);

    await waitFor(() => {
      expect(screen.getByTestId('by-signal-type-card')).toBeInTheDocument();
    });

    // Each radar path row
    expect(screen.getByTestId('signal-type-row-pre_surge')).toBeInTheDocument();
    expect(screen.getByTestId('signal-type-row-quiet_accumulation_strong')).toBeInTheDocument();
    expect(screen.getByTestId('signal-type-row-explosive_surge')).toBeInTheDocument();
    expect(screen.getByTestId('signal-type-row-early_break')).toBeInTheDocument();
    expect(screen.getByTestId('signal-type-row-quiet_accumulation_weak')).toBeInTheDocument();

    // Label appears
    expect(screen.getByText('🚀 Pre-Surge')).toBeInTheDocument();
    expect(screen.getByText('🎯 تجميع قوي')).toBeInTheDocument();
  });

  it('shows win/loss counts per signal type', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildAccuracyResponse(),
    } as Response);

    render(<AccuracyDashboard market="EGX" />);

    await waitFor(() => {
      expect(screen.getByTestId('signal-type-row-pre_surge')).toBeInTheDocument();
    });

    // Pre-Surge row: 45 total, 38 verified, 26 wins, 12 losses
    const preSurgeRow = screen.getByTestId('signal-type-row-pre_surge');
    expect(preSurgeRow).toHaveTextContent('45');   // total
    expect(preSurgeRow).toHaveTextContent('38');   // verified
    expect(preSurgeRow).toHaveTextContent('26');   // wins
    expect(preSurgeRow).toHaveTextContent('12');   // losses
  });

  // ── 3) Color coding ───────────────────────────────────────────────
  it('color-codes win rates: green for >60%, amber for 40-60%, rose for <40%', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildAccuracyResponse(),
    } as Response);

    render(<AccuracyDashboard market="EGX" />);

    await waitFor(() => {
      expect(screen.getByTestId('signal-type-row-pre_surge')).toBeInTheDocument();
    });

    // Pre-Surge: 68.4% → emerald (≥60%)
    const preSurgeBadge = screen.getByTestId('signal-type-winrate-pre_surge');
    expect(preSurgeBadge.className).toMatch(/emerald/);

    // Explosive: 55.0% → amber (40-60%)
    const explosiveBadge = screen.getByTestId('signal-type-winrate-explosive_surge');
    expect(explosiveBadge.className).toMatch(/amber/);

    // Quiet weak: 45.0% → amber (40-60%)
    const weakBadge = screen.getByTestId('signal-type-winrate-quiet_accumulation_weak');
    expect(weakBadge.className).toMatch(/amber/);
  });

  it('uses rose color for win rate below 40%', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildAccuracyResponse({
        by_signal_type: [
          {
            signal_type: 'pre_surge',
            label: '🚀 Pre-Surge',
            total: 10, verified: 10, wins: 2, losses: 8,
            win_rate_pct: 20.0,
            avg_outcome_7d: -1.0,
            avg_outcome_14d: -2.0,
            avg_outcome_30d: -3.5,
            avg_time_to_target_days: 25.0,
          },
        ],
      }),
    } as Response);

    render(<AccuracyDashboard market="EGX" />);

    await waitFor(() => {
      expect(screen.getByTestId('signal-type-winrate-pre_surge')).toBeInTheDocument();
    });

    const badge = screen.getByTestId('signal-type-winrate-pre_surge');
    expect(badge.className).toMatch(/rose/);
  });

  it('overall win rate progress bar uses emerald color for ≥60%', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildAccuracyResponse({ win_rate_pct: 75.0 }),
    } as Response);

    render(<AccuracyDashboard market="EGX" />);

    await waitFor(() => {
      expect(screen.getByTestId('win-rate-progress-bar')).toBeInTheDocument();
    });

    const bar = screen.getByTestId('win-rate-progress-bar');
    expect(bar.className).toMatch(/emerald/);
    expect((bar as HTMLElement).style.width).toBe('75%');
  });

  // ── 4) Monthly trend ──────────────────────────────────────────────
  it('renders monthly trend chart and table', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildAccuracyResponse(),
    } as Response);

    render(<AccuracyDashboard market="EGX" />);

    await waitFor(() => {
      expect(screen.getByTestId('monthly-trend-card')).toBeInTheDocument();
    });

    // The mock ResponsiveContainer should render
    expect(screen.getByTestId('mock-responsive-container')).toBeInTheDocument();

    // Monthly rows — last month first (since reversed)
    expect(screen.getByTestId('monthly-row-2026-09')).toBeInTheDocument();
    expect(screen.getByTestId('monthly-row-2026-08')).toBeInTheDocument();
    expect(screen.getByTestId('monthly-row-2026-07')).toBeInTheDocument();
  });

  it('shows empty state for monthly trend when no data', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildAccuracyResponse({ monthly_trend: [] }),
    } as Response);

    render(<AccuracyDashboard market="EGX" />);

    await waitFor(() => {
      expect(screen.getByTestId('monthly-trend-card')).toBeInTheDocument();
    });

    expect(screen.getByText(/لا توجد بيانات اتجاه شهري متاحة/)).toBeInTheDocument();
  });

  // ── 5) API call ───────────────────────────────────────────────────
  it('fetches from /api/radar/accuracy with market and days params', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildAccuracyResponse(),
    } as Response);

    render(<AccuracyDashboard market="EGX" days={90} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/radar/accuracy');
    expect(calledUrl).toContain('market=EGX');
    expect(calledUrl).toContain('days=90');
  });

  it('omits market param when not provided', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildAccuracyResponse({ market: null }),
    } as Response);

    render(<AccuracyDashboard days={30} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/radar/accuracy');
    expect(calledUrl).not.toContain('market=');
    expect(calledUrl).toContain('days=30');
  });

  it('renders by-market table with flag + win rate', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => buildAccuracyResponse(),
    } as Response);

    render(<AccuracyDashboard market="EGX" />);

    await waitFor(() => {
      expect(screen.getByTestId('by-market-card')).toBeInTheDocument();
    });

    expect(screen.getByTestId('market-row-EGX')).toBeInTheDocument();
    expect(screen.getByTestId('market-row-US')).toBeInTheDocument();
    expect(screen.getByTestId('market-row-CRYPTO')).toBeInTheDocument();

    // EGX should show 65.0%
    expect(screen.getByTestId('market-row-EGX')).toHaveTextContent('65.0%');
  });
});
