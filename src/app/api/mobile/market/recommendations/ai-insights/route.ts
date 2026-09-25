/**
 * GET /api/mobile/market/recommendations/ai-insights
 * =================================================
 * AI Insights — falls back to predictions.db aggregated stats when Python is down.
 * Returns: win_rate, avg_return, total_predictions, by_signal, by_market.
 */

import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';

  // 1) Try Python first
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/market-pulse${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2) Fallback — predictions.db
  try {
    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');
    const predDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!fs.existsSync(predDbPath)) {
      return NextResponse.json(
        { success: false, error: 'predictions.db not found' },
        { status: 500 }
      );
    }
    const pdb = new Database(predDbPath, { readonly: true });

    const marketClause = market === 'ALL' ? '' : 'WHERE market = ? COLLATE NOCASE';
    const params = market === 'ALL' ? [] : [market];

    const stats: any = pdb
      .prepare(
        `SELECT
           COUNT(*) AS total_predictions,
           SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS wins,
           AVG(actual_return) AS avg_return,
           AVG(master_score) AS avg_master_score,
           AVG(holding_days) AS avg_holding_days
         FROM predictions ${marketClause}`
      )
      .get(...params);

    const bySignal: any[] = pdb
      .prepare(
        `SELECT signal,
                COUNT(*) AS count,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS wins,
                AVG(actual_return) AS avg_return
         FROM predictions ${marketClause ? marketClause + ' AND' : 'WHERE'}
                signal IS NOT NULL
         GROUP BY signal
         ORDER BY count DESC`
      )
      .all(...params);

    const byMarket: any[] = pdb
      .prepare(
        `SELECT market,
                COUNT(*) AS count,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS wins,
                AVG(actual_return) AS avg_return
         FROM predictions
         WHERE signal IS NOT NULL
         GROUP BY market
         ORDER BY count DESC`
      )
      .all();

    const byStatus: any[] = pdb
      .prepare(
        `SELECT status, COUNT(*) AS count
         FROM predictions ${marketClause ? 'WHERE market = ? COLLATE NOCASE AND' : 'WHERE'}
                status IS NOT NULL
         GROUP BY status
         ORDER BY count DESC`
      )
      .all(...params);

    pdb.close();

    const total = stats.total_predictions || 0;
    const wins = stats.wins || 0;
    const winRate = total > 0 ? (wins / total) * 100 : 0;

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      market,
      summary: {
        total_predictions: total,
        wins,
        win_rate: Number(winRate.toFixed(2)),
        avg_return: stats.avg_return != null ? Number(stats.avg_return) : null,
        avg_master_score:
          stats.avg_master_score != null
            ? Number(stats.avg_master_score)
            : null,
        avg_holding_days:
          stats.avg_holding_days != null
            ? Number(stats.avg_holding_days)
            : null,
      },
      by_signal: bySignal.map((s: any) => ({
        signal: s.signal,
        count: s.count,
        wins: s.wins || 0,
        win_rate: s.count > 0 ? Number(((s.wins / s.count) * 100).toFixed(2)) : 0,
        avg_return: s.avg_return != null ? Number(s.avg_return) : null,
      })),
      by_market: byMarket.map((m: any) => ({
        market: m.market,
        count: m.count,
        wins: m.wins || 0,
        win_rate: m.count > 0 ? Number(((m.wins / m.count) * 100).toFixed(2)) : 0,
        avg_return: m.avg_return != null ? Number(m.avg_return) : null,
      })),
      by_status: byStatus.map((s: any) => ({
        status: s.status,
        count: s.count,
      })),
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
