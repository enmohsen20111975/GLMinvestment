/**
 * WeeklyReportTab.test.tsx — L2-WEEKLY-RADAR-REPORT
 * ============================================================================
 *
 * Tests for the Weekly Report Tab component:
 *
 *   1. Happy path: renders the report with stock of week + top 5 + last week perf + sectors
 *   2. Loading skeleton while fetching
 *   3. Warming-up state (first request — 503)
 *   4. Error state with retry button
 *   5. Download PDF button triggers window.open
 *   6. Subscribe CTA renders with telegram + website + android links
 *   7. Empty data (no top 5, no last week perf) renders friendly messages
 *
 * Run:
 *   bunx vitest run src/__tests__/radar/WeeklyReportTab.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { WeeklyReportTab } from '@/modules/radar/components/WeeklyReportTab';

// ─── Mocks ─────────────────────────────────────────────────────────────────
// Mock global.fetch so the component never makes a real network call.
const fetchMock = vi.fn();
global.fetch = fetchMock as any;

// Mock window.open so the PDF download test doesn't actually open a window.
const openMock = vi.fn();
vi.stubGlobal('open', openMock);

// ─── Fixtures ─────────────────────────────────────────────────────────────
const FULL_RESPONSE = {
  success: true,
  cached: true,
  cache_age_seconds: 120,
  cache_stale: false,
  warmup_running: false,
  cache_generated_at: '2026-09-27T08:00:00.000Z',
  market: 'EGX',
  report: {
    generated_at: '2026-09-27T08:00:00.000Z',
    market: 'EGX',
    week_number: 40,
    year: 2026,
    week_start: '2026-09-27',
    week_end: '2026-10-03',
    week_start_ar: '27 سبتمبر 2026',
    week_end_ar: '3 أكتوبر 2026',
    market_regime: {
      regime: 'DEFENSIVE',
      regime_ar: 'دِفاعي (شد اللجام)',
      last_update: '2026-09-27T02:50:00.000Z',
      confidence: 0.85,
      reasons: ['index below SMA50', 'turnover declining 3 days'],
      source: 'sqlite',
    },
    stock_of_week: {
      ticker: 'AMIA',
      path: 'A_pre_surge',
      path_ar: 'Pre-Surge (تجميع مبكر جداً)',
      current_price: 12.50,
      target_1: 14.50,
      target_2: 16.20,
      stop_loss: 11.90,
      target_1_pct: 16.0,
      stop_loss_pct: -4.8,
      signal_count: 6,
      risk_reward: 3.33,
      reason: 'تجميع قوي + حجم مؤكد + قرب الدعم',
    },
    top_5: [
      { ticker: 'AMIA', path: 'A_pre_surge', path_ar: 'Pre-Surge', current_price: 12.50, signal_count: 6, volume_ratio_10d_vs_20d: 1.85, reason: 'pre-surge' },
      { ticker: 'COMI', path: 'B_quiet_accumulation_strong', path_ar: 'تجميع قوي', current_price: 138.55, signal_count: 5, volume_ratio_10d_vs_20d: 1.42, reason: 'quiet' },
      { ticker: 'ABUK', path: 'A_pre_surge', path_ar: 'Pre-Surge', current_price: 124.00, signal_count: 5, volume_ratio_10d_vs_20d: 1.38, reason: 'pre-surge' },
      { ticker: 'MFPC', path: 'B_quiet_accumulation_strong', path_ar: 'تجميع قوي', current_price: 45.20, signal_count: 5, volume_ratio_10d_vs_20d: 1.30, reason: 'quiet' },
      { ticker: 'SKPC', path: 'B_quiet_accumulation_strong', path_ar: 'تجميع قوي', current_price: 32.10, signal_count: 4, volume_ratio_10d_vs_20d: 1.25, reason: 'quiet' },
    ],
    last_week_performance: {
      stocks: [
        { ticker: 'ATQA', entry_price: 12.70, current_price: 13.90, return_pct: 9.4, status: 'win', status_emoji: '✅' },
        { ticker: 'ACGC', entry_price: 15.45, current_price: 16.80, return_pct: 8.7, status: 'win', status_emoji: '✅' },
        { ticker: 'AREH', entry_price: 1.50, current_price: 1.52, return_pct: 1.3, status: 'flat', status_emoji: '⏳' },
        { ticker: 'ASCM', entry_price: 64.70, current_price: 62.10, return_pct: -4.0, status: 'loss', status_emoji: '❌' },
        { ticker: 'AMPI', entry_price: 2.92, current_price: 3.15, return_pct: 7.9, status: 'win', status_emoji: '✅' },
      ],
      avg_return_pct: 4.7,
      win_count: 3,
      total_count: 5,
      win_rate_pct: 60.0,
    },
    sector_heatmap: [
      { sector: 'Finance', stocks_count: 12, avg_change_pct: 0.5, direction: 'inflow', color: 'emerald', emoji: '🟢' },
      { sector: 'Process Industries', stocks_count: 8, avg_change_pct: -0.3, direction: 'outflow', color: 'rose', emoji: '🔴' },
      { sector: 'Non-Energy Minerals', stocks_count: 5, avg_change_pct: -0.7, direction: 'outflow', color: 'rose', emoji: '🔴' },
    ],
    db_source: 'stocks.db::stock_daily_prices',
    radar_cache_found: true,
    tracking_count: 5,
    official_links: {
      website: 'https://invist.m2y.net',
      telegram: 'https://t.me/Arabian_investment_guide',
      android: 'https://play.google.com/store/apps/details?id=com.egx.investment',
    },
  },
};

const EMPTY_RESPONSE = {
  success: true,
  cached: true,
  cache_age_seconds: 60,
  cache_stale: false,
  warmup_running: false,
  cache_generated_at: '2026-09-27T08:00:00.000Z',
  market: 'EGX',
  report: {
    generated_at: '2026-09-27T08:00:00.000Z',
    market: 'EGX',
    week_number: 40,
    year: 2026,
    week_start: '2026-09-27',
    week_end: '2026-10-03',
    market_regime: { regime: 'NORMAL', regime_ar: 'عادي', source: 'default' },
    stock_of_week: null,
    top_5: [],
    last_week_performance: {
      stocks: [],
      avg_return_pct: 0,
      win_count: 0,
      total_count: 0,
      win_rate_pct: 0,
    },
    sector_heatmap: [],
    radar_cache_found: false,
    tracking_count: 0,
  },
};

// ─── Setup ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  fetchMock.mockReset();
  openMock.mockReset();
});

// Helper: make fetch resolve with a JSON body
function mockFetchResponse(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  } as any);
}

// ─── Tests ─────────────────────────────────────────────────────────────────
describe('<WeeklyReportTab /> — happy path (full report)', () => {
  it('renders the header with week number, year, date range, and regime', async () => {
    mockFetchResponse(FULL_RESPONSE);
    render(<WeeklyReportTab market="EGX" />);

    await waitFor(() => {
      // Title
      expect(screen.getByText('التقرير الأسبوعي للرادار')).toBeInTheDocument();
    });

    // Week + year
    expect(screen.getByText(/الأسبوع 40، 2026/)).toBeInTheDocument();

    // Date range
    expect(screen.getByText(/27 سبتمبر 2026 — 3 أكتوبر 2026/)).toBeInTheDocument();

    // Regime badge — "DEFENSIVE" appears in regime badge
    expect(screen.getAllByText(/DEFENSIVE/).length).toBeGreaterThan(0);
    // Arabic regime label
    expect(screen.getByText(/دِفاعي/)).toBeInTheDocument();
  });

  it('renders the Stock of the Week section with ticker, price, targets, stop, signal strength', async () => {
    mockFetchResponse(FULL_RESPONSE);
    render(<WeeklyReportTab market="EGX" />);

    await waitFor(() => {
      expect(screen.getByText('سهم الأسبوع')).toBeInTheDocument();
    });

    // Ticker — also appears in Top 5, so use getAllByText
    expect(screen.getAllByText('AMIA').length).toBeGreaterThan(0);

    // Current price
    expect(screen.getAllByText(/12\.50/).length).toBeGreaterThan(0);

    // Target 1 + Target 2 + Stop loss labels
    expect(screen.getAllByText(/الهدف 1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/الهدف 2/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/وقف الخسارة/).length).toBeGreaterThan(0);

    // Signal strength (6/6)
    expect(screen.getAllByText(/6\/6/).length).toBeGreaterThan(0);

    // Reason excerpt
    expect(screen.getByText(/تجميع قوي \+ حجم مؤكد/)).toBeInTheDocument();
  });

  it('renders the Top 5 list with all 5 tickers', async () => {
    mockFetchResponse(FULL_RESPONSE);
    render(<WeeklyReportTab market="EGX" />);

    await waitFor(() => {
      expect(screen.getByText('أفضل 5 أسهم للأسبوع القادم')).toBeInTheDocument();
    });

    // All 5 tickers — AMIA also appears in Stock of Week, so use getAllByText
    expect(screen.getAllByText('AMIA').length).toBeGreaterThan(0);
    expect(screen.getByText('COMI')).toBeInTheDocument();
    expect(screen.getByText('ABUK')).toBeInTheDocument();
    expect(screen.getByText('MFPC')).toBeInTheDocument();
    expect(screen.getByText('SKPC')).toBeInTheDocument();
  });

  it('renders the last week performance summary + stocks list', async () => {
    mockFetchResponse(FULL_RESPONSE);
    render(<WeeklyReportTab market="EGX" />);

    await waitFor(() => {
      expect(screen.getByText('أداء أسهم الأسبوع الماضي')).toBeInTheDocument();
    });

    // Summary stats
    expect(screen.getByText(/متوسط العائد/)).toBeInTheDocument();
    expect(screen.getAllByText(/\+4\.7%/).length).toBeGreaterThan(0);
    expect(screen.getByText(/3\/5/)).toBeInTheDocument();

    // All 5 tracked stocks
    expect(screen.getByText('ATQA')).toBeInTheDocument();
    expect(screen.getByText('ACGC')).toBeInTheDocument();
    expect(screen.getByText('AREH')).toBeInTheDocument();
    expect(screen.getByText('ASCM')).toBeInTheDocument();
    expect(screen.getByText('AMPI')).toBeInTheDocument();

    // Returns
    expect(screen.getAllByText(/\+9\.4%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/-4\.0%/).length).toBeGreaterThan(0);
  });

  it('renders the sector heatmap with all 3 sectors', async () => {
    mockFetchResponse(FULL_RESPONSE);
    render(<WeeklyReportTab market="EGX" />);

    await waitFor(() => {
      expect(screen.getByText('خريطة القطاعات')).toBeInTheDocument();
    });

    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(screen.getByText('Process Industries')).toBeInTheDocument();
    expect(screen.getByText('Non-Energy Minerals')).toBeInTheDocument();
  });

  it('renders the Subscribe CTA with Telegram + Website + Android links', async () => {
    mockFetchResponse(FULL_RESPONSE);
    render(<WeeklyReportTab market="EGX" />);

    await waitFor(() => {
      expect(screen.getByText(/التقرير الأسبوعي كل أحد/)).toBeInTheDocument();
    });

    // Subscribe text
    expect(screen.getByText(/اشترك ليصلك التقرير الأسبوعي على تليجرام كل يوم أحد صباحاً/)).toBeInTheDocument();

    // Links (anchors with target=_blank)
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href') || '');
    expect(hrefs).toContain('https://t.me/Arabian_investment_guide');
    expect(hrefs).toContain('https://invist.m2y.net');
    expect(hrefs).toContain('https://play.google.com/store/apps/details?id=com.egx.investment');
  });

  it('renders the disclaimer footer', async () => {
    mockFetchResponse(FULL_RESPONSE);
    render(<WeeklyReportTab market="EGX" />);

    await waitFor(() => {
      expect(screen.getByText(/تحليل تلقائي — ليس نصيحة استثمارية/)).toBeInTheDocument();
    });
  });
});

describe('<WeeklyReportTab /> — interactions', () => {
  it('clicking "تحميل PDF" calls window.open with the PDF endpoint', async () => {
    mockFetchResponse(FULL_RESPONSE);
    render(<WeeklyReportTab market="EGX" />);

    await waitFor(() => {
      expect(screen.getByText('تحميل PDF')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('تحميل PDF'));

    expect(openMock).toHaveBeenCalledTimes(1);
    const calledUrl = openMock.mock.calls[0][0];
    expect(calledUrl).toContain('/api/radar/weekly-report/pdf');
    expect(calledUrl).toContain('market=EGX');
  });

  it('clicking "تجديد" triggers a POST request + refetch', async () => {
    // Initial fetch returns full data
    mockFetchResponse(FULL_RESPONSE);
    // POST returns success
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, duration_ms: 1500, files: {} }),
    } as any);
    // Refetch returns full data again
    mockFetchResponse(FULL_RESPONSE);

    render(<WeeklyReportTab market="EGX" />);

    await waitFor(() => {
      expect(screen.getByText('تجديد')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('تجديد'));

    // Wait for the POST call to happen
    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        ([url, init]) => typeof url === 'string' && url.includes('/api/radar/weekly-report') && init?.method === 'POST'
      );
      expect(postCalls.length).toBe(1);
    });
  });
});

describe('<WeeklyReportTab /> — edge cases', () => {
  it('shows warming-up state when API returns 503 warming_up=true', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({
        success: false,
        warming_up: true,
        error: 'التقرير الأسبوعي قيد التوليد لأول مرة — حاول مرة أخرى خلال دقيقة',
      }),
    } as any);
    // After 15s retry, return full data
    mockFetchResponse(FULL_RESPONSE);

    render(<WeeklyReportTab market="EGX" />);

    await waitFor(() => {
      expect(screen.getByText('التقرير الأسبوعي قيد التوليد')).toBeInTheDocument();
    });
  });

  it('shows error state with retry button when API fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        success: false,
        error: 'فشل داخلي',
      }),
    } as any);

    render(<WeeklyReportTab market="EGX" />);

    await waitFor(() => {
      expect(screen.getByText(/تعذّر تحميل التقرير الأسبوعي/)).toBeInTheDocument();
    });

    expect(screen.getByText('إعادة المحاولة')).toBeInTheDocument();
  });

  it('renders friendly empty messages when report has no top 5 / no tracked stocks', async () => {
    mockFetchResponse(EMPTY_RESPONSE);
    render(<WeeklyReportTab market="EGX" />);

    await waitFor(() => {
      expect(screen.getByText('التقرير الأسبوعي للرادار')).toBeInTheDocument();
    });

    // Stock of week empty message
    expect(screen.getByText(/لا يوجد سهم مميز هذا الأسبوع/)).toBeInTheDocument();

    // Top 5 empty
    expect(screen.getByText(/لا توجد أسهم في الكاش/)).toBeInTheDocument();

    // Last-week performance empty
    expect(screen.getByText(/لا توجد أسهم متابَعة من الأسبوع الماضي/)).toBeInTheDocument();
  });
});
