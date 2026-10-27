import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { openDb } from '@/lib/db-manager';

export const dynamic = 'force-dynamic';

interface PredictionRow {
  ticker: string;
  actual_return: number;
  signal: string;
  morning_bell: number;
  prediction_date: string;
  persona: string;
}

function computeStats(rows: PredictionRow[]) {
  if (!rows.length) return null;
  const total = rows.length;
  const wins = rows.filter(r => r.actual_return > 0).length;
  const losses = rows.filter(r => r.actual_return < 0).length;
  const gp = rows.filter(r => r.actual_return > 0).reduce((s, r) => s + r.actual_return, 0);
  const gl = Math.abs(rows.filter(r => r.actual_return < 0).reduce((s, r) => s + r.actual_return, 0));
  const net = rows.reduce((s, r) => s + r.actual_return, 0);
  const avgWin = wins > 0 ? gp / wins : 0;
  const avgLoss = losses > 0 ? gl / losses : 0;
  return {
    total,
    wins,
    losses,
    wr: parseFloat((wins / total * 100).toFixed(1)),
    pf: parseFloat((gp / gl || 0).toFixed(2)),
    net: parseFloat(net.toFixed(2)),
    avg_win: parseFloat(avgWin.toFixed(2)),
    avg_loss: parseFloat(avgLoss.toFixed(2)),
    expectancy: parseFloat((net / total).toFixed(2)),
    rr_ratio: avgLoss > 0 ? parseFloat((avgWin / avgLoss).toFixed(2)) : 0,
  };
}

function computeSubsetStats(rows: PredictionRow[]) {
  if (!rows.length) return null;
  const s = computeStats(rows);
  if (!s) return null;
  return {
    trades: s.total,
    wins: s.wins,
    wr: s.wr,
    pf: s.pf,
    net: s.net,
  };
}

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const db = openDb('predictions.db');
    if (!db) {
      return NextResponse.json({
        success: true,
        data: {
          summary: { total: 0, message: 'predictions.db unavailable. Run the backtest first.' },
          by_month: [], by_ticker: [], explosive_stocks: [], out_of_sample: {},
        },
      });
    }

    // Check if predictions table exists
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='predictions'"
    ).get();

    if (!tableExists) {
      db.close();
      return NextResponse.json({
        success: true,
        data: {
          summary: { total: 0, message: 'predictions table not found. Run the backtest first.' },
          by_month: [], by_ticker: [], explosive_stocks: [], out_of_sample: {},
        },
      });
    }

    const rows = db.prepare(`
      SELECT ticker, actual_return, signal, morning_bell, prediction_date, persona
      FROM predictions
      WHERE actual_return IS NOT NULL
      ORDER BY prediction_date
    `).all() as PredictionRow[];

    db.close();

    if (!rows.length) {
      return NextResponse.json({
        success: true,
        data: {
          summary: { total: 0, message: 'No predictions with actual_return found. Run the backtest first.' },
          by_month: [], by_ticker: [], explosive_stocks: [], out_of_sample: {},
        },
      });
    }

    const summary = computeStats(rows);

    // Morning Bell
    const mbRows = rows.filter(r => r.morning_bell);
    const morning_bell = mbRows.length ? computeSubsetStats(mbRows) : null;

    // By month
    const byMonthMap = new Map<string, PredictionRow[]>();
    for (const r of rows) {
      const m = (r.prediction_date || '').slice(0, 7);
      if (!byMonthMap.has(m)) byMonthMap.set(m, []);
      byMonthMap.get(m)!.push(r);
    }
    const by_month = Array.from(byMonthMap.entries())
      .map(([month, mRows]) => {
        const s = computeSubsetStats(mRows)!;
        return { month, trades: s.trades, wins: s.wins, wr: parseFloat(s.wr.toFixed(1)), net: parseFloat(s.net.toFixed(1)) };
      })
      .sort((a, b) => a.month.localeCompare(b.month));

    // By ticker (top 15 by net)
    const byTickerMap = new Map<string, PredictionRow[]>();
    for (const r of rows) {
      if (!byTickerMap.has(r.ticker)) byTickerMap.set(r.ticker, []);
      byTickerMap.get(r.ticker)!.push(r);
    }
    const by_ticker = Array.from(byTickerMap.entries())
      .map(([ticker, tRows]) => {
        const s = computeSubsetStats(tRows)!;
        return { ticker, trades: s.trades, wins: s.wins, wr: parseFloat(s.wr.toFixed(1)), net: parseFloat(s.net.toFixed(1)) };
      })
      .sort((a, b) => b.net - a.net)
      .slice(0, 15);

    // Explosive stocks
    const explosiveList = ['BIOC', 'NIPH', 'AMES', 'GPIM', 'CRST', 'AFMC', 'GTWL',
                          'TMGH', 'OCDI', 'COMI', 'SWDY', 'ESRS', 'EGAL', 'EFID', 'EAST'];
    const explosive_stocks = explosiveList
      .map(t => {
        const tRows = rows.filter(r => r.ticker === t);
        if (!tRows.length) return null;
        const s = computeSubsetStats(tRows)!;
        return { ticker: t, trades: s.trades, wins: s.wins, wr: parseFloat(s.wr.toFixed(1)), net: parseFloat(s.net.toFixed(1)) };
      })
      .filter(Boolean);

    // Out-of-sample
    const oos30 = rows.filter(r => (r.prediction_date || '') >= '2026-07-28');
    const oos45 = rows.filter(r => (r.prediction_date || '') >= '2026-07-13');

    return NextResponse.json({
      success: true,
      data: {
        summary,
        morning_bell,
        by_month,
        by_ticker,
        explosive_stocks,
        out_of_sample: {
          last_30d: computeSubsetStats(oos30),
          last_45d: computeSubsetStats(oos45),
        },
      },
    });
  } catch (e) {
    console.error('[admin:backtest:v40:stats]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}
