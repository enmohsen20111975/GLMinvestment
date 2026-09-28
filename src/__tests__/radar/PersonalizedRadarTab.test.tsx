/**
 * PersonalizedRadarTab.test.tsx — L3 tests for the Personalized Radar tab
 * =========================================================================
 *
 * Verifies (5 required tests):
 *   1. Requires authentication (shows login CTA when not authenticated)
 *   2. Shows empty state CTA for new users (no profile + no picks)
 *   3. Renders user profile (sectors, price range, holding period, risk, win rate)
 *   4. Shows personalized picks (with personalization reasons)
 *   5. Shows excluded list (stocks already in portfolio + out-of-range)
 *
 * Run:
 *   bunx vitest run src/__tests__/radar/PersonalizedRadarTab.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// ─── Mock fetch BEFORE importing the component ──────────────────────────
const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

// Mock useVisibilityAwarePolling defensively (not used here, but consistent).
vi.mock('@/hooks/useVisibilityAwarePolling', () => ({
  useVisibilityAwarePolling: vi.fn(),
}));

// Mock next/router defensively (not used here).
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }), { virtual: true });

// Import AFTER mocks are in place.
import { PersonalizedRadarTab } from '@/components/predictions/radar/PersonalizedRadarTab';

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildProfile(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-test-123',
    preferredSectors: [
      { sector: 'Technology', count: 12, pct: 45.0 },
      { sector: 'Financials', count: 8, pct: 30.0 },
      { sector: 'Healthcare', count: 4, pct: 15.0 },
    ],
    preferredTickers: [
      { ticker: 'NVDA', count: 5, lastTraded: '2026-09-28T10:00:00.000Z' },
      { ticker: 'COMI', count: 4, lastTraded: '2026-09-25T10:00:00.000Z' },
      { ticker: 'AAPL', count: 3, lastTraded: '2026-09-20T10:00:00.000Z' },
    ],
    riskProfile: 'balanced',
    averageHoldingDays: 12,
    holdingPeriodCategory: 'medium',
    preferredPriceRange: 'mid',
    preferredMarkets: [
      { market: 'EGX', count: 10 },
      { market: 'US', count: 6 },
    ],
    totalTrades: 18,
    winRate: 62.5,
    profileComputedAt: '2026-09-28T07:00:00.000Z',
    ...overrides,
  };
}

function buildPersonalizedPick(overrides: Record<string, unknown> = {}) {
  return {
    ticker: 'NVDA',
    current_price: 450.2,
    path: 'A_pre_surge',
    position_size: 85,
    roc_10d: 5.1,
    reason: 'Pre-surge detected',
    base_score: 85,
    personalized_score: 95, // +10 from preferred sector
    sector: 'Technology',
    personalization_reasons: ['قطاعك المفضل (Technology)'],
    adjusted_position_size: 85,
    ...overrides,
  };
}

function buildResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    authenticated: true,
    profile: buildProfile(),
    personalized_picks: [buildPersonalizedPick()],
    excluded: [
      { ticker: 'ABUK', reason: 'already_in_portfolio', detail: 'موجود في محفظتك' },
      { ticker: 'TSLA', reason: 'out_of_price_range', detail: 'خارج نطاق سعرك المفضل (mid)' },
    ],
    radar_status: 'ready',
    radar_generated_at: '2026-09-28T07:00:00.000Z',
    radar_cache_file: 'maker_radar_20260928.json',
    total_picks_in_cache: 96,
    served_at: '2026-09-28T07:00:00.000Z',
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────
describe('PersonalizedRadarTab', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ── 1) Authentication required ──────────────────────────────────────
  it('shows login CTA when not authenticated (401)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        authenticated: false,
        error: 'Authentication required.',
      }),
    } as Response);

    render(<PersonalizedRadarTab />);

    await waitFor(() => {
      expect(screen.getByTestId('personalized-radar-unauth')).toBeInTheDocument();
    });

    // Login CTA heading + button
    expect(screen.getByText('سجّل دخولك الأول')).toBeInTheDocument();
    expect(screen.getByText('تسجيل الدخول')).toBeInTheDocument();
  });

  // ── 2) Empty state for new users ────────────────────────────────────
  it('shows empty state CTA when user has no trade history (profile=null)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        authenticated: true,
        profile: null,
        personalized_picks: [],
        excluded: [],
        radar_status: 'ready',
        radar_cache_file: 'maker_radar_20260928.json',
        total_picks_in_cache: 96,
        served_at: '2026-09-28T07:00:00.000Z',
      }),
    } as Response);

    render(<PersonalizedRadarTab />);

    await waitFor(() => {
      expect(screen.getByTestId('personalized-radar-empty')).toBeInTheDocument();
    });

    // Empty state CTA heading + "أضف لمحفظتك" button
    expect(screen.getByText(/الرادار المخصّص لسه بيتعلّم منك/)).toBeInTheDocument();
    expect(screen.getByText('أضف لمحفظتك')).toBeInTheDocument();
  });

  // ── 3) Renders user profile ────────────────────────────────────────
  it('renders user profile (sectors, price range, holding period, risk, win rate)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => buildResponse(),
    } as Response);

    render(<PersonalizedRadarTab />);

    await waitFor(() => {
      expect(screen.getByTestId('profile-card')).toBeInTheDocument();
    });

    // Total trades
    expect(screen.getByTestId('stat-total-trades')).toHaveTextContent('18');

    // Win rate (62.5%)
    expect(screen.getByTestId('stat-win-rate')).toHaveTextContent('62.5%');

    // Risk profile (balanced → متوازن)
    expect(screen.getByTestId('stat-risk-profile')).toHaveTextContent('متوازن');

    // Holding period
    expect(screen.getByTestId('stat-holding-period')).toHaveTextContent('12 يوم');

    // Preferred sectors
    const sectors = screen.getByTestId('preferred-sectors');
    expect(sectors).toHaveTextContent('Technology');
    expect(sectors).toHaveTextContent('Financials');

    // Preferred tickers
    expect(screen.getByTestId('preferred-ticker-NVDA')).toBeInTheDocument();
    expect(screen.getByTestId('preferred-ticker-COMI')).toBeInTheDocument();

    // Preferred markets
    const markets = screen.getByTestId('preferred-markets');
    expect(markets).toHaveTextContent('EGX');
    expect(markets).toHaveTextContent('US');
  });

  // ── 4) Shows personalized picks ─────────────────────────────────────
  it('shows personalized picks ranked by personalization score', async () => {
    const picks = [
      buildPersonalizedPick({
        ticker: 'NVDA',
        personalized_score: 95,
        base_score: 85,
        sector: 'Technology',
        personalization_reasons: ['قطاعك المفضل (Technology)'],
      }),
      buildPersonalizedPick({
        ticker: 'COMI',
        current_price: 18.5,
        path: 'B_quiet_accumulation_strong',
        personalized_score: 78,
        base_score: 70,
        sector: 'Financials',
        personalization_reasons: ['قطاعك المفضل (Financials)'],
      }),
      buildPersonalizedPick({
        ticker: 'AMIA',
        current_price: 12.5,
        path: 'A_pre_surge',
        personalized_score: 75,
        base_score: 70,
        sector: null,
        personalization_reasons: ['في نطاق سعرك المفضل (mid)'],
      }),
    ];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => buildResponse({ personalized_picks: picks }),
    } as Response);

    render(<PersonalizedRadarTab />);

    await waitFor(() => {
      expect(screen.getByTestId('personalized-picks-card')).toBeInTheDocument();
    });

    // Each pick row should be present
    expect(screen.getByTestId('personalized-pick-NVDA')).toBeInTheDocument();
    expect(screen.getByTestId('personalized-pick-COMI')).toBeInTheDocument();
    expect(screen.getByTestId('personalized-pick-AMIA')).toBeInTheDocument();

    // Personalization score visible
    expect(screen.getByTestId('pick-score-NVDA')).toHaveTextContent('95');

    // Reason trigger button visible (HelpCircle)
    expect(screen.getByTestId('pick-reason-trigger-NVDA')).toBeInTheDocument();

    // Card title with count (3)
    const picksCard = screen.getByTestId('personalized-picks-card');
    expect(picksCard).toHaveTextContent('توصيات مخصّصة لك');
  });

  // ── 5) Shows excluded list ──────────────────────────────────────────
  it('shows excluded list with reasons (already in portfolio + out of price range)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => buildResponse(),
    } as Response);

    render(<PersonalizedRadarTab />);

    await waitFor(() => {
      expect(screen.getByTestId('excluded-card')).toBeInTheDocument();
    });

    // ABUK — already in portfolio
    const abukRow = screen.getByTestId('excluded-ABUK');
    expect(abukRow).toHaveTextContent('ABUK');
    expect(abukRow).toHaveTextContent('موجود في محفظتك');

    // TSLA — out of price range
    const tslaRow = screen.getByTestId('excluded-TSLA');
    expect(tslaRow).toHaveTextContent('TSLA');
    expect(tslaRow).toHaveTextContent('خارج نطاق سعرك المفضل');

    // Excluded count badge
    const excludedCard = screen.getByTestId('excluded-card');
    expect(excludedCard).toHaveTextContent('تم استبعاد');
  });

  // ── Extra: Refresh button works (bonus smoke test) ─────────────────
  it('re-fetches data when the refresh button is clicked', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => buildResponse(),
    } as Response);

    render(<PersonalizedRadarTab />);

    await waitFor(() => {
      expect(screen.getByTestId('profile-card')).toBeInTheDocument();
    });

    const initialCallCount = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByTestId('refresh-button'));

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });
});
