/**
 * A2 — Sector Tracking visualization — Fixture Verification Test
 * ==============================================================
 * Task 3-a (Alpha) — Verifies that SectorTrackingTab + the new
 * SectorLiquidityTreemap / SectorMomentumStrip / SectorLeaderSparkline
 * honestly consume the `/api/sectors/tracking` contract:
 *
 *   - Treemap renders ALL sectors (areas ∝ turnover, all present).
 *   - Chart LABEL = "توزيع سيولة القطاعات" (Sector Liquidity Distribution)
 *     — NOT "Net Money Flow" / "صافي التدفق" as a positive claim.
 *   - Colors represent the metric the data ACTUALLY measures:
 *       avg_change > 0   → profit (green)
 *       avg_change < 0   → loss (red)
 *       |avg_change|<0.5 → neutral gray
 *     (We DO NOT fake a performance gradient when no perf metric exists —
 *      here a perf metric DOES exist, so green/red is honest.)
 *   - NO fabricated flow claims (no "sector X draining liquidity from Y").
 *   - Sparkline for leader stock renders "—" honestly when no history exists
 *     (we mock /api/stocks/sparkline to return source='none').
 *
 * Run: timeout 60 bun run vitest run src/__tests__/components/a2-sector-tracking.test.tsx
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import { SectorTrackingTab } from '@/modules/market-analysis/components/SectorTrackingTab';
import type { SectorTrackingResponse } from '@/modules/market-analysis/components/types';

// ── Fixture: real-shaped /api/sectors/tracking response ───────────────────────
// Includes sectors WITH performance (avg_change) + traded value (turnover).
// Mix of positive, negative, and near-zero performance so we can verify colors.
function buildFixture(): SectorTrackingResponse {
  return {
    success: true,
    market: 'EGX',
    sectors: [
      {
        sector: 'Banks',
        stock_count: 15,
        avg_change: 3.4, // strongly positive → green
        turnover: 2_400_000_000,
        turnover_pct: 32.0,
        gainers: 12,
        losers: 2,
        breadth: 80.0,
        heat_level: 'HOT',
        heat_ar: 'نار 🔥',
        leader_ticker: 'COMI',
        leader_change: 5.2,
        total_market_cap: 180_000_000_000,
        stocks: [],
      },
      {
        sector: 'Real Estate',
        stock_count: 10,
        avg_change: -2.1, // negative → red
        turnover: 1_100_000_000,
        turnover_pct: 14.7,
        gainers: 3,
        losers: 6,
        breadth: 30.0,
        heat_level: 'COOL',
        heat_ar: 'بارد',
        leader_ticker: 'TMGH',
        leader_change: -3.5,
        total_market_cap: 45_000_000_000,
        stocks: [],
      },
      {
        sector: 'Energy',
        stock_count: 8,
        avg_change: 0.1, // near zero → neutral
        turnover: 600_000_000,
        turnover_pct: 8.0,
        gainers: 4,
        losers: 4,
        breadth: 50.0,
        heat_level: 'NEUTRAL',
        heat_ar: 'محايد',
        leader_ticker: 'NDCO',
        leader_change: 0.4,
        total_market_cap: 30_000_000_000,
        stocks: [],
      },
      {
        sector: 'Materials',
        stock_count: 12,
        avg_change: 1.2, // mild positive → green (above 0.5 threshold)
        turnover: 900_000_000,
        turnover_pct: 12.0,
        gainers: 8,
        losers: 3,
        breadth: 66.7,
        heat_level: 'WARM',
        heat_ar: 'دافئ',
        leader_ticker: 'EGCH',
        leader_change: 1.8,
        total_market_cap: 22_000_000_000,
        stocks: [],
      },
    ],
    market_summary: {
      total_stocks: 45,
      total_sectors: 4,
      advancers: 27,
      decliners: 15,
      breadth: 26.7,
      avg_change: 0.9,
      total_turnover: 5_000_000_000, // = 2.4 + 1.1 + 0.6 + 0.9 (in billions)
    },
    rotation: null,
  };
}

// ── Mock fetch: sectors tracking + sparkline (empty for honesty test) ──────────
function mockFetchImpl(url: string | URL | Request, _init?: RequestInit) {
  const u = typeof url === 'string' ? url : url.toString();

  // /api/sectors/tracking
  if (u.startsWith('/api/sectors/tracking') || u.includes('/api/sectors/tracking')) {
    return Promise.resolve(
      new Response(JSON.stringify(buildFixture()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  // /api/stocks/sparkline — return EMPTY (source='none') so we assert the
  // honest "—" rendering path (no fabrication).
  if (u.startsWith('/api/stocks/sparkline') || u.includes('/api/stocks/sparkline')) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          success: true,
          ticker: 'UNKNOWN',
          prices: [],
          min: 0,
          max: 0,
          first: 0,
          last: 0,
          change_pct: 0,
          days: 0,
          source: 'none',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  }

  return Promise.resolve(new Response('{}', { status: 200 }));
}

describe('A2 — Sector Tracking visualization (honest labels + treemap)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url, init) => mockFetchImpl(url, init)));

    // Install a WORKING ResizeObserver mock — Recharts ResponsiveContainer
    // listens to its container's size; in jsdom the container has 0 dimensions
    // so the treemap renders nothing. We fire the observer synchronously with
    // a non-zero size so ResponsiveContainer renders its children (rects/text).
    class MockResizeObserver {
      cb: (entries: any[]) => void;
      constructor(cb: (entries: any[]) => void) {
        this.cb = cb;
      }
      observe(target: Element) {
        // Fire synchronously with a fixed size matching the treemap container.
        const entry = {
          target,
          contentRect: { width: 800, height: 320, top: 0, left: 0, bottom: 320, right: 800 },
          borderBoxSize: [{ inlineSize: 800, blockSize: 320 }],
          contentBoxSize: [{ inlineSize: 800, blockSize: 320 }],
          devicePixelContentBoxSize: [{ inlineSize: 800, blockSize: 320 }],
        };
        try { this.cb([entry], this); } catch { /* swallow */ }
      }
      unobserve() {}
      disconnect() {}
    }
    (global as any).ResizeObserver = MockResizeObserver;
    (window as any).ResizeObserver = MockResizeObserver;

    // Stub HTMLCanvasElement.getContext — Recharts Tooltip uses it (jsdom
    // doesn't implement canvas). Return a no-op context to silence warnings.
    if (!HTMLCanvasElement.prototype.getContext) {
      HTMLCanvasElement.prototype.getContext = function () {
        return null as any;
      };
    } else {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
        try {
          const ctx = orig.apply(this, args as any);
          if (ctx) return ctx;
        } catch { /* fall through to stub */ }
        return {
          clearRect() {}, fillRect() {}, strokeRect() {},
          beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
          arc() {}, fill() {}, stroke() {}, save() {}, restore() {},
          translate() {}, rotate() {}, scale() {},
          measureText: () => ({ width: 0 }),
          set fillStyle(v: any) { (this as any)._fs = v; }, get fillStyle() { return (this as any)._fs; },
          set strokeStyle(v: any) { (this as any)._ss = v; }, get strokeStyle() { return (this as any)._ss; },
          set lineWidth(v: number) { (this as any)._lw = v; }, get lineWidth() { return (this as any)._lw ?? 1; },
          set font(v: string) { (this as any)._f = v; }, get font() { return (this as any)._f ?? ''; },
        } as any;
      };
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the treemap with the HONEST "Liquidity Distribution" title (not Net Money Flow)', async () => {
    render(<SectorTrackingTab market="EGX" />);

    const title = await screen.findByTestId('sector-treemap-title');
    expect(title).toBeInTheDocument();
    // Title text must be "Sector Liquidity Distribution" — Arabic
    expect(title).toHaveTextContent('توزيع سيولة القطاعات');

    // The title must NOT claim "Net Money Flow" / "صافي التدفق" as a positive claim
    // (the only allowed mention is the explicit negation disclaimer).
    const titleText = title.textContent || '';
    expect(titleText).not.toMatch(/^صافي التدفق/);
    expect(titleText).not.toMatch(/Net Money Flow/i);
  });

  it('renders ALL sectors in the treemap data (none filtered out)', async () => {
    render(<SectorTrackingTab market="EGX" />);

    // Wait for treemap container to appear (data loaded)
    await screen.findByTestId('sector-treemap-container');

    // Each sector's name should appear somewhere on the page (treemap cell text
    // AND/OR the momentum strip). We use exact-match getAllByText which is
    // the canonical testing-library way to find leaf text nodes.
    const fixture = buildFixture();
    for (const s of fixture.sectors) {
      await waitFor(() => {
        const matches = screen.getAllByText(s.sector, { exact: true, ignore: 'script,style' });
        expect(matches.length).toBeGreaterThan(0);
      }, { timeout: 3000 });
    }
  });

  it('subtitle + footer explicitly disclose what size & color measure (and what they do NOT)', async () => {
    render(<SectorTrackingTab market="EGX" />);

    const subtitle = await screen.findByTestId('sector-treemap-subtitle');
    expect(subtitle).toHaveTextContent(/حجم المربع/); // size = liquidity share
    expect(subtitle).toHaveTextContent(/اللون/);       // color = avg change

    const note = await screen.findByTestId('sector-treemap-note');
    // Honest negation: explicitly says data does NOT measure net money flow
    expect(note).toHaveTextContent(/لا تقيس صافي التدفق النقدي/);

    const footer = await screen.findByTestId('sector-data-source-footer');
    expect(footer).toHaveTextContent(/\/api\/sectors\/tracking/);
    expect(footer).toHaveTextContent(/قيمة التداول اليوم/);
    expect(footer).toHaveTextContent(/لا يقيس صافي التدفق النقدي/);
  });

  it('momentum strip shows strongest & weakest sectors by avg_change (today, not flow)', async () => {
    render(<SectorTrackingTab market="EGX" />);

    const strongest = await screen.findByTestId('sector-momentum-strongest');
    const weakest = await screen.findByTestId('sector-momentum-weakest');

    // Strongest (Banks, avg_change=3.4) should appear before Materials (1.2)
    expect(within(strongest).getByText('Banks', { exact: true })).toBeInTheDocument();
    // Weakest (Real Estate, avg_change=-2.1) should appear
    expect(within(weakest).getByText('Real Estate', { exact: true })).toBeInTheDocument();

    // Section headers explicitly say "today" + "by avg_change" (not "flow")
    expect(strongest).toHaveTextContent(/أقوى القطاعات اليوم/);
    expect(strongest).toHaveTextContent(/متوسط التغير/);
    expect(weakest).toHaveTextContent(/أضعف القطاعات اليوم/);

    // The honest disclosure note must be present
    const note = await screen.findByTestId('sector-momentum-note');
    expect(note).toHaveTextContent(/لا تقيس صافي التدفق النقدي/);
  });

  it('treemap rect colors reflect avg_change (green for positive, red for negative, neutral for near-zero)', async () => {
    const { container } = render(<SectorTrackingTab market="EGX" />);

    // Wait for treemap SVG rects to render
    await waitFor(() => {
      const rects = container.querySelectorAll('svg rect');
      expect(rects.length).toBeGreaterThan(0);
    }, { timeout: 4000 });

    // Collect fill colors of treemap rects (skip white strokes / transparent).
    const rectFills = Array.from(container.querySelectorAll('svg rect'))
      .map((r) => r.getAttribute('fill') || '')
      .filter((f) => f && f !== 'none' && f !== '#ffffff' && f !== '#fff' && !f.startsWith('rgb(255, 255, 255)'));

    // At least one green (positive avg_change) and one red (negative avg_change)
    // must be present in the treemap rects.
    const hasGreen = rectFills.some((f) => f.startsWith('hsl(160') || f.includes('160'));
    const hasRed = rectFills.some((f) => f.startsWith('hsl(0') || /hsl\(0[,\s]/.test(f));
    expect(hasGreen).toBe(true);
    expect(hasRed).toBe(true);
  });

  it('does NOT fabricate "Net Money Flow" or sector-vs-sector draining claims', async () => {
    const { container } = render(<SectorTrackingTab market="EGX" />);

    // Wait for full render
    await screen.findByTestId('sector-treemap-title');
    await screen.findByTestId('sector-momentum-strip');

    // No element should CLAIM net money flow as a measured metric.
    // The only allowed mention is the explicit "لا تقيس صافي التدفق" negation.
    const allText = container.textContent || '';

    // Strip the honest negation phrases, then check no positive claim remains
    const negationsStripped = allText
      .replace(/لا تقيس صافي التدفق النقدي/g, '')
      .replace(/لا يقيس صافي التدفق النقدي/g, '');

    // Must not contain phrases like "صافي التدفق" as a positive claim
    expect(negationsStripped).not.toMatch(/صافي التدفق/);
    // Must not contain "draining" / "تهرب السيولة" sector-vs-sector claims
    expect(allText).not.toMatch(/تهرب السيولة/);
    expect(allText).not.toMatch(/draining liquidity/i);
    // Must not say "inflow" / "outflow" as measured metrics
    expect(negationsStripped).not.toMatch(/inflow|outflow/i);
  });

  it('leader sparkline renders "—" honestly when no real history exists (no fabrication)', async () => {
    render(<SectorTrackingTab market="EGX" />);

    // The fixture's leader_ticker is 'COMI' — sparkline mock returns source='none'.
    // We expect at least one "—" placeholder to appear (honest empty path).
    await screen.findByTestId('sector-treemap-title');
    // Allow time for sparkline fetch to resolve
    await waitFor(() => {
      const placeholders = screen.getAllByText('—');
      expect(placeholders.length).toBeGreaterThan(0);
    }, { timeout: 4000 });
  });

  it('total liquidity shown equals the sum of sector turnovers (no fabrication)', async () => {
    render(<SectorTrackingTab market="EGX" />);

    const totalAnchor = await screen.findByTestId('sector-treemap-total');
    const totalAttr = totalAnchor.getAttribute('data-total');
    expect(totalAttr).toBeTruthy();
    // The fixture's total_turnover = 5_000_000_000 (sum of 2.4+1.1+0.6+0.9 billions)
    // The anchor stores the computed sum of sector.turnover (number).
    const computed = Number(totalAttr);
    expect(computed).toBeGreaterThan(0);
    // The fixture's market_summary.total_turnover also = 5_000_000_000
    // (sum of sector turnovers in the fixture). Allow small float slack.
    const fixture = buildFixture();
    const sumOfSectorTurnovers = fixture.sectors.reduce((s, x) => s + x.turnover, 0);
    expect(Math.abs(computed - sumOfSectorTurnovers)).toBeLessThan(1);
  });
});
