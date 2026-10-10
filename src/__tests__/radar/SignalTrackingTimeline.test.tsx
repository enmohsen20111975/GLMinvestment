/**
 * SignalTrackingTimeline.test.tsx — L2-SIGNAL-TIMELINE
 * ============================================================================
 *
 * Tests for the Signal Tracking Timeline component:
 *
 *   1. Header render (ticker + entry date + days tracked)
 *   2. "Add to tracking" CTA shown for untracked stocks (not_tracked)
 *   3. Timeline events render (signal, milestone, alert, current)
 *   4. Target progress bars render with correct color coding
 *   5. Milestones checklist renders reached + pending items
 *   6. Edge cases: no price history, entry price missing, API error
 *
 * Run:
 *   bunx vitest run src/__tests__/radar/SignalTrackingTimeline.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import {
  SignalTrackingTimeline,
  type TimelineData,
} from '@/modules/radar/components/SignalTrackingTimeline';

// ─── Mocks ─────────────────────────────────────────────────────────────────
// Mock global.fetch so the component never makes a real network call.
const fetchMock = vi.fn();
global.fetch = fetchMock as any;

// ─── Fixtures ───────────────────────────────────────────────────────────────
const FULL_DATA: TimelineData = {
  success: true,
  ticker: 'COMI',
  entry: { date: '2026-09-01', price: 12.5 },
  current: { date: '2026-09-27', price: 14.2, change_pct: 13.6, days_tracked: 26 },
  target_1: { price: 14.5, pct: 16, status: 'approaching', progress_pct: 94 },
  target_2: { price: 16.2, pct: 29.6, status: 'pending', progress_pct: 46 },
  stop_loss: { price: 11.9, pct: -4.8, status: 'safe', progress_pct: 12 },
  timeline: [
    { date: '2026-09-01', price: 12.5,  event: 'signal',    label: 'دخل الرادار',   note: 'بداية المتابعة' },
    { date: '2026-09-04', price: 12.8,  event: 'milestone', label: '+2.4%',         note: null },
    { date: '2026-09-08', price: 13.5,  event: 'milestone', label: '+8.0%',         note: 'اقترب من الهدف الأول' },
    { date: '2026-09-15', price: 13.2,  event: 'alert',     label: '-2.2%',         note: 'تصحيح طفيف' },
    { date: '2026-09-27', price: 14.2,  event: 'current',   label: '+13.6%',       note: 'الآن' },
  ],
  milestones: [
    { label: 'دخل الرادار',          date: '2026-09-01', price: 12.5, reached: true },
    { label: 'قوة الإشارة ارتفعت',    date: '2026-09-05', price: 12.9, reached: true },
    { label: 'حجم انفجاري',           date: '2026-09-08', price: 13.5, reached: true },
    { label: 'وصل الهدف الأول',       date: null,         price: null, reached: false },
    { label: 'وصل الهدف الثاني',      date: null,         price: null, reached: false },
  ],
};

// ─── Setup ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  fetchMock.mockReset();
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
describe('<SignalTrackingTimeline /> — happy path (full data)', () => {
  it('renders the header with ticker, entry date, days tracked, and price → price', async () => {
    mockFetchResponse(FULL_DATA);
    render(<SignalTrackingTimeline ticker="COMI" />);

    // Header: ticker + "رحلة الإشارة"
    await waitFor(() => {
      expect(screen.getByText(/COMI/)).toBeInTheDocument();
      expect(screen.getByText(/رحلة الإشارة/)).toBeInTheDocument();
    });

    // Entry date
    expect(screen.getByText(/بدأ المتابعة: 2026-09-01/)).toBeInTheDocument();

    // Days tracked badge
    expect(screen.getByText(/26 يوم/)).toBeInTheDocument();

    // Price transition: 12.5 → 14.2 + +13.6%
    expect(screen.getAllByText(/\+13\.6%/).length).toBeGreaterThan(0);
  });

  it('renders the timeline events (signal / milestone / alert / current)', async () => {
    mockFetchResponse(FULL_DATA);
    render(<SignalTrackingTimeline ticker="COMI" />);

    await waitFor(() => {
      // "دخل الرادار" appears in timeline events + milestones checklist
      expect(screen.getAllByText('دخل الرادار').length).toBeGreaterThan(0);
    });

    // Milestone note about approaching target_1
    expect(screen.getByText('اقترب من الهدف الأول')).toBeInTheDocument();
    // Alert note
    expect(screen.getByText('تصحيح طفيف')).toBeInTheDocument();
    // Current note "الآن"
    expect(screen.getAllByText('الآن').length).toBeGreaterThan(0);
  });

  it('renders 3 target progress bars (target_1, target_2, stop_loss)', async () => {
    mockFetchResponse(FULL_DATA);
    render(<SignalTrackingTimeline ticker="COMI" />);

    await waitFor(() => {
      expect(screen.getAllByText('الهدف 1').length).toBeGreaterThan(0);
      expect(screen.getAllByText('الهدف 2').length).toBeGreaterThan(0);
      expect(screen.getByText('وقف الخسارة')).toBeInTheDocument();
    });

    // Status labels (Arabic)
    expect(screen.getByText('اقتراب')).toBeInTheDocument();       // target_1 = approaching
    expect(screen.getByText('بانتظار')).toBeInTheDocument();       // target_2 = pending
    expect(screen.getByText(/آمن/)).toBeInTheDocument();           // stop_loss = safe
  });

  it('renders the milestones checklist with reached + pending items', async () => {
    mockFetchResponse(FULL_DATA);
    render(<SignalTrackingTimeline ticker="COMI" />);

    await waitFor(() => {
      expect(screen.getByText('محطات الإنجاز')).toBeInTheDocument();
    });

    // Reached milestone labels (3 reached, 2 pending)
    expect(screen.getByText('قوة الإشارة ارتفعت')).toBeInTheDocument();
    expect(screen.getByText('حجم انفجاري')).toBeInTheDocument();
    // Pending: "وصل الهدف الأول" / "وصل الهدف الثاني"
    expect(screen.getByText('وصل الهدف الأول')).toBeInTheDocument();
    expect(screen.getByText('وصل الهدف الثاني')).toBeInTheDocument();

    // "لم يصل بعد" appears at least once (for unreached milestones)
    const notYetLabels = screen.getAllByText('لم يصل بعد');
    expect(notYetLabels.length).toBeGreaterThanOrEqual(2);
  });
});

describe('<SignalTrackingTimeline /> — edge cases', () => {
  it('shows "add to tracking" CTA when stock is not tracked', async () => {
    mockFetchResponse({
      success: false,
      not_tracked: true,
      ticker: 'COMI',
      error: 'السهم غير متابَع — أضِفه إلى قائمة المتابعة لعرض الخط الزمني',
    });
    render(<SignalTrackingTimeline ticker="COMI" />);

    await waitFor(() => {
      expect(screen.getByText('رحلة الإشارة غير متاحة')).toBeInTheDocument();
    });
    // CTA copy
    expect(screen.getByText(/أضِف السهم إلى قائمة المتابعة/)).toBeInTheDocument();
  });

  it('shows "no price history" message when no_price_history is true', async () => {
    mockFetchResponse({
      success: false,
      no_price_history: true,
      ticker: 'COMI',
      error: 'لا توجد بيانات أسعار كافية بعد',
      entry: { date: '2026-09-01', price: 12.5 },
    });
    render(<SignalTrackingTimeline ticker="COMI" />);

    await waitFor(() => {
      expect(screen.getByText('لا توجد بيانات أسعار كافية بعد')).toBeInTheDocument();
    });
  });

  it('shows "entry price missing" message when entry_price_missing is true', async () => {
    mockFetchResponse({
      success: false,
      entry_price_missing: true,
      ticker: 'COMI',
      error: 'سعر الدخول غير مُسجَّل',
      entry: { date: '2026-09-01', price: 0 },
    });
    render(<SignalTrackingTimeline ticker="COMI" />);

    await waitFor(() => {
      expect(screen.getByText('سعر الدخول غير مُسجَّل')).toBeInTheDocument();
    });
  });

  it('renders graceful error card with retry button on API error', async () => {
    mockFetchResponse({
      success: false,
      error: 'Internal server error',
    });
    render(<SignalTrackingTimeline ticker="COMI" />);

    await waitFor(() => {
      expect(screen.getByText('تعذّر تحميل الخط الزمني')).toBeInTheDocument();
      expect(screen.getByText('Internal server error')).toBeInTheDocument();
    });

    // Retry button is rendered
    expect(screen.getByText('إعادة المحاولة')).toBeInTheDocument();
  });

  it('renders graceful error card on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network down'));
    render(<SignalTrackingTimeline ticker="COMI" />);

    await waitFor(() => {
      expect(screen.getByText('تعذّر تحميل الخط الزمني')).toBeInTheDocument();
      expect(screen.getByText('Network down')).toBeInTheDocument();
    });
  });

  it('re-fetches when the retry button is clicked', async () => {
    mockFetchResponse({ success: false, error: 'first fail' });
    render(<SignalTrackingTimeline ticker="COMI" />);

    await waitFor(() => {
      expect(screen.getByText('إعادة المحاولة')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second fetch: success
    mockFetchResponse(FULL_DATA);
    fireEvent.click(screen.getByText('إعادة المحاولة'));

    await waitFor(() => {
      expect(screen.getByText(/بدأ المتابعة: 2026-09-01/)).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('<SignalTrackingTimeline /> — color coding of progress bars', () => {
  it('uses the amber color for target_1 when status=approaching', async () => {
    mockFetchResponse(FULL_DATA);
    const { container } = render(<SignalTrackingTimeline ticker="COMI" />);

    await waitFor(() => {
      expect(screen.getByText('اقتراب')).toBeInTheDocument();
    });

    // Find progress bar fills (the inner div with width style)
    const fills = container.querySelectorAll('[class*="h-full"][style*="width"]');
    expect(fills.length).toBeGreaterThanOrEqual(3);

    // target_1 (approaching) → amber
    // target_2 (pending)    → blue
    // stop_loss (safe)      → emerald
    const hasAmber = Array.from(fills).some((el) =>
      el.className.includes('bg-amber-500')
    );
    const hasBlue = Array.from(fills).some((el) =>
      el.className.includes('bg-primary')
    );
    const hasEmerald = Array.from(fills).some((el) =>
      el.className.includes('bg-emerald-500')
    );
    expect(hasAmber).toBe(true);
    expect(hasBlue).toBe(true);
    expect(hasEmerald).toBe(true);
  });

  it('uses danger color for stop_loss when status=danger', async () => {
    const dangerData: TimelineData = {
      ...FULL_DATA,
      stop_loss: { price: 11.9, pct: -4.8, status: 'danger', progress_pct: 95 },
    };
    mockFetchResponse(dangerData);
    const { container } = render(<SignalTrackingTimeline ticker="COMI" />);

    await waitFor(() => {
      expect(screen.getByText(/خطر/)).toBeInTheDocument();
    });

    const fills = container.querySelectorAll('[class*="h-full"][style*="width"]');
    const hasRose = Array.from(fills).some((el) =>
      el.className.includes('bg-rose-500')
    );
    expect(hasRose).toBe(true);
  });
});

describe('<SignalTrackingTimeline /> — fetch URL', () => {
  it('fetches the timeline endpoint with the ticker + days=60', async () => {
    mockFetchResponse(FULL_DATA);
    render(<SignalTrackingTimeline ticker="comi" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/maker-radar/timeline');
    expect(url).toContain('ticker=comi');
    expect(url).toContain('days=60');
  });
});
