import { NextRequest, NextResponse } from 'next/server';

// P0-11-AUTH fix (2026-09-27): added user auth guard — financial data
// (portfolio wealth/PnL) was previously callable by anonymous users.
import { requireAuthAsync } from '@/lib/admin-guard';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): user auth guard (financial data)
  const auth = await requireAuthAsync(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/live-monitor${qs ? `?${qs}` : ''}`;

    const options: RequestInit = { signal: AbortSignal.timeout(30000) };
    if (req.method !== 'GET') {
      options.method = req.method;
      options.headers = { 'Content-Type': 'application/json' };
      options.body = await req.text();
    }

    const res = await fetch(targetUrl, options);
    const data = await res.json();

    if (!data.success || !data.data) {
      return NextResponse.json({
        success: true,
        data: {
          history: [],
          stats: {
            latest_invested: 0,
            latest_current: 0,
            latest_pnl: 0,
            latest_pnl_pct: 0,
            allocation: {},
          },
        },
      });
    }

    const portfolio = data.data.portfolio || {};
    const items = portfolio.items || [];
    const totalInvested = portfolio.total_invested || 0;
    const totalCurrent = portfolio.total_current_value || 0;
    const totalPnl = portfolio.total_gain_loss || 0;
    const totalPnlPct = portfolio.total_gain_loss_pct || 0;

    const byType: Record<string, { invested: number; current: number }> = {};
    for (const item of items) {
      const type = item.type || 'other';
      if (!byType[type]) byType[type] = { invested: 0, current: 0 };
      byType[type].invested += Number(item.total_invested || 0);
      byType[type].current += Number(item.current_value || 0);
    }

    const allocation: Record<string, number> = {};
    for (const [type, vals] of Object.entries(byType)) {
      allocation[type] = totalCurrent > 0 ? Math.round((vals.current / totalCurrent) * 1000) / 10 : 0;
    }

    const today = new Date().toISOString().split('T')[0];
    const transformed = {
      success: true,
      data: {
        history: [
          {
            date: today,
            invested: totalInvested,
            current_value: totalCurrent,
            net_wealth: totalCurrent,
            pnl: totalPnl,
          },
        ],
        stats: {
          latest_invested: totalInvested,
          latest_current: totalCurrent,
          latest_pnl: totalPnl,
          latest_pnl_pct: totalPnlPct,
          allocation,
        },
      },
    };

    return NextResponse.json(transformed);
  } catch (e) {
    return NextResponse.json({
      success: true,
      data: {
        history: [],
        stats: {
          latest_invested: 0,
          latest_current: 0,
          latest_pnl: 0,
          latest_pnl_pct: 0,
          allocation: {},
        },
      },
    });
  }
}
