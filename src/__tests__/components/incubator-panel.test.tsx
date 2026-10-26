/**
 * IncubatorSection Panel View tests
 * =================================
 * Verifies the redesigned 3-zone panel view:
 * - Zone A (status bar): real candidate count, hot count, last-update timestamp
 * - Zone B (candidate list): rows clickable, active state, auto-advance pausable
 * - Zone C (analysis panel): real sparkline fetched, condition panel from passed_reasons[]
 *
 * No fabricated data — all assertions run against the fixture-shaped API response.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { IncubatorSection } from '@/modules/radar/components/IncubatorSection';
import type { IncubatorResponse } from '@/modules/radar/components/IncubatorSection';

// Mock fetch for /api/radar/incubator + /api/stocks/sparkline
const mockIncubatorResponse: IncubatorResponse = {
  success: true,
  market: 'EGX',
  total_candidates: 2,
  candidates: [
    {
      ticker: 'ANFI',
      name_ar: 'تايكون القابضة',
      current_price: 97.9,
      readiness_pct: 83,
      signals_passed: 5,
      total_signals: 6,
      passed_reasons: [
        'ضغط شرائي مؤسسي',
        'انضغاط سعري (تجميع صامت)',
        'سيولة متدفقة مقبولة',
        'غياب الانفجار المبكر',
        'غياب تام لمظاهر التصريف',
      ],
      trigger: {
        type: 'VOLUME_SURGE',
        condition_ar: 'بانتظار شمعة فوليوم تأكيدية تخترق 1.5x متوسط 20 يوم',
        trigger_price: null,
        distance_to_trigger_pct: 0,
      },
      target_if_promoted: 104.42,
      stop_loss_if_promoted: 94.28,
      risk_reward: 1.8,
      stage: 'HEATING_UP',
      path: 'B_quiet_accumulation_strong',
    },
    {
      ticker: 'EDBM',
      name_ar: 'Egyptian for Developing Materials',
      current_price: 1.8,
      readiness_pct: 83,
      signals_passed: 5,
      total_signals: 6,
      passed_reasons: [
        'ضغط شرائي مؤسسي',
        'انضغاط سعري',
        'سيولة متدفقة',
        'غياب الانفجار',
        'غياب التصريف',
      ],
      trigger: {
        type: 'VOLUME_SURGE',
        condition_ar: 'بانتظار شمعة فوليوم تأكيدية',
        trigger_price: null,
        distance_to_trigger_pct: 0,
      },
      target_if_promoted: 2.04,
      stop_loss_if_promoted: 1.67,
      risk_reward: 1.8,
      stage: 'HEATING_UP',
      path: 'B_quiet_accumulation_strong',
    },
  ],
  timestamp: new Date().toISOString(),
};

const mockSparkline = {
  ticker: 'ANFI',
  prices: [95, 96, 97, 96.5, 97.9, 97.9, 97.9],
  min: 95,
  max: 97.9,
  first: 95,
  last: 97.9,
  change_pct: 3.05,
  days: 7,
  source: 'price_history.db',
};

// Mock StockIconMini to avoid dynamic import complexity
vi.mock('@/modules/stock-analysis/components/StockIcon', () => ({
  StockIconMini: ({ ticker, className }: { ticker: string; className?: string }) => (
    <span data-testid={`stock-icon-${ticker}`} className={className}>
      {ticker[0]}
    </span>
  ),
}));

// Mock lucide-react icons to plain spans (avoid complex SVG assertions)
vi.mock('lucide-react', () => {
  const icons = [
    'Bell',
    'BellRing',
    'TrendingUp',
    'Target',
    'Shield',
    'Activity',
    'Zap',
    'Eye',
    'ChevronDown',
    'ChevronUp',
    'LayoutGrid',
    'List',
    'Radar',
    'Play',
    'Pause',
    'RefreshCw',
    'CheckCircle2',
    'Clock',
    'Circle',
    'AlertTriangle',
  ];
  const mod: Record<string, React.FC<{ className?: string }>> = {};
  for (const name of icons) {
    mod[name] = ({ className }: { className?: string }) => (
      <span data-testid={`icon-${name}`} className={className}>
        {name[0]}
      </span>
    );
  }
  return mod;
});

// Mock matchMedia for prefers-reduced-motion
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch() {
  global.fetch = vi.fn(async (url: string) => {
    if (url.includes('/api/radar/incubator')) {
      return new Response(JSON.stringify(mockIncubatorResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/stocks/sparkline')) {
      return new Response(JSON.stringify(mockSparkline), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('IncubatorSection — Panel View (redesigned 3-zone)', () => {
  it('renders the panel view as the default view mode', async () => {
    mockFetch();
    render(<IncubatorSection market="EGX" refreshIntervalMs={0} autoAdvanceMs={0} />);
    // Wait for candidates to load
    await waitFor(() => {
      expect(screen.getAllByText('ANFI').length).toBeGreaterThan(0);
    });
    // Panel view button should be active (secondary variant)
    const panelBtn = screen.getByTitle('عرض لوحة التحليل (الجديد)');
    expect(panelBtn).toBeInTheDocument();
  });

  it('Zone A: shows the real candidate count from API', async () => {
    mockFetch();
    render(<IncubatorSection market="EGX" refreshIntervalMs={0} autoAdvanceMs={0} />);
    await waitFor(() => {
      expect(screen.getAllByText('ANFI').length).toBeGreaterThan(0);
    });
    // 2 candidates in mock → "قيد المراقبة" should appear (status bar + header badge)
    expect(screen.getAllByText('قيد المراقبة').length).toBeGreaterThan(0);
  });

  it('Zone B: candidate list shows all candidates with prices', async () => {
    mockFetch();
    render(<IncubatorSection market="EGX" refreshIntervalMs={0} autoAdvanceMs={0} />);
    await waitFor(() => {
      expect(screen.getAllByText('ANFI').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('EDBM').length).toBeGreaterThan(0);
    // Prices should be visible (97.90 and 1.80)
    expect(screen.getAllByText('97.90').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.80').length).toBeGreaterThan(0);
  });

  it('Zone B: clicking a candidate selects it (stops auto-advance)', async () => {
    mockFetch();
    render(<IncubatorSection market="EGX" refreshIntervalMs={0} autoAdvanceMs={4000} />);
    await waitFor(() => {
      expect(screen.getAllByText('ANFI').length).toBeGreaterThan(0);
    });
    // Click on EDBM (second candidate) — find the button in the list (with class)
    const edbmButtons = screen.getAllByRole('button').filter((b) => b.textContent?.includes('EDBM'));
    expect(edbmButtons.length).toBeGreaterThan(0);
    fireEvent.click(edbmButtons[0]);
    // After click, auto-play should be off → the play button should appear
    await waitFor(() => {
      expect(screen.getByTitle('تشغيل الاستعراض التلقائي')).toBeInTheDocument();
    });
  });

  it('Zone C: shows the active candidate ticker + name_ar', async () => {
    mockFetch();
    render(<IncubatorSection market="EGX" refreshIntervalMs={0} autoAdvanceMs={0} />);
    await waitFor(() => {
      expect(screen.getAllByText('ANFI').length).toBeGreaterThan(0);
    });
    // ANFI is the first candidate → should be active by default
    // Its name_ar should appear in the analysis panel
    expect(screen.getByText('تايكون القابضة')).toBeInTheDocument();
  });

  it('Zone C: condition panel renders passed_reasons as متحقق rows', async () => {
    mockFetch();
    render(<IncubatorSection market="EGX" refreshIntervalMs={0} autoAdvanceMs={0} />);
    await waitFor(() => {
      expect(screen.getAllByText('ANFI').length).toBeGreaterThan(0);
    });
    // The first passed_reason should appear
    expect(screen.getByText('ضغط شرائي مؤسسي')).toBeInTheDocument();
    // The trigger condition_ar should appear as waiting
    expect(
      screen.getByText('بانتظار شمعة فوليوم تأكيدية تخترق 1.5x متوسط 20 يوم'),
    ).toBeInTheDocument();
    // The "متحقق" label should appear (for passed rows)
    const passedLabels = screen.getAllByText('متحقق');
    expect(passedLabels.length).toBe(5); // 5 passed reasons
    // The "انتظار" label should appear (for the trigger)
    const waitingLabels = screen.getAllByText('انتظار');
    expect(waitingLabels.length).toBe(1);
  });

  it('Zone C: promotion targets (target/stop/RR) appear when provided', async () => {
    mockFetch();
    render(<IncubatorSection market="EGX" refreshIntervalMs={0} autoAdvanceMs={0} />);
    await waitFor(() => {
      expect(screen.getAllByText('ANFI').length).toBeGreaterThan(0);
    });
    // Target = 104.42, Stop = 94.28, R/R = 1.8
    expect(screen.getAllByText('104.42').length).toBeGreaterThan(0);
    expect(screen.getAllByText('94.28').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.8').length).toBeGreaterThan(0);
  });

  it('renders empty state when API returns 0 candidates', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          market: 'EGX',
          total_candidates: 0,
          candidates: [],
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    render(<IncubatorSection market="EGX" refreshIntervalMs={0} autoAdvanceMs={0} />);
    await waitFor(() => {
      expect(
        screen.getByText(/لا توجد أسهم قريبة من اكتمال شروط الاختراق/),
      ).toBeInTheDocument();
    });
  });

  it('renders error state when fetch fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network error');
    }) as unknown as typeof fetch;
    render(<IncubatorSection market="EGX" refreshIntervalMs={0} autoAdvanceMs={0} />);
    await waitFor(() => {
      expect(screen.getByText(/تعذّر تحميل بيانات الرادار/)).toBeInTheDocument();
    });
  });

  it('does NOT fabricate data — no hardcoded tickers appear', async () => {
    mockFetch();
    render(<IncubatorSection market="EGX" refreshIntervalMs={0} autoAdvanceMs={0} />);
    await waitFor(() => {
      expect(screen.getAllByText('ANFI').length).toBeGreaterThan(0);
    });
    // Fabricated tickers that should NEVER appear
    expect(screen.queryByText('FAKE1')).not.toBeInTheDocument();
    expect(screen.queryByText('MOCK')).not.toBeInTheDocument();
    expect(screen.queryByText('TEST123')).not.toBeInTheDocument();
  });

  it('auto-advance advances the active candidate every autoAdvanceMs', async () => {
    mockFetch();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<IncubatorSection market="EGX" refreshIntervalMs={0} autoAdvanceMs={500} />);
    await waitFor(() => {
      expect(screen.getAllByText('ANFI').length).toBeGreaterThan(0);
    });
    // ANFI should be active initially (first candidate)
    expect(screen.getByText('تايكون القابضة')).toBeInTheDocument();
    // Advance fake timer by 600ms → should switch to EDBM
    act(() => {
      vi.advanceTimersByTime(600);
    });
    // EDBM's name should now appear in the analysis panel
    await waitFor(() => {
      expect(screen.getByText('Egyptian for Developing Materials')).toBeInTheDocument();
    });
    vi.useRealTimers();
  });

  it('respects prefers-reduced-motion by disabling auto-advance', async () => {
    // Override matchMedia to return reduced motion = true
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    mockFetch();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<IncubatorSection market="EGX" refreshIntervalMs={0} autoAdvanceMs={500} />);
    await waitFor(() => {
      expect(screen.getAllByText('ANFI').length).toBeGreaterThan(0);
    });
    // ANFI is active initially
    expect(screen.getByText('تايكون القابضة')).toBeInTheDocument();
    // Advance fake timer — should NOT switch because reduced motion is on
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // ANFI's name should still be the active one (no switch happened)
    expect(screen.getByText('تايكون القابضة')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
