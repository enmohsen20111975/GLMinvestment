/**
 * GET /api/mobile/recommendations
 * ==============================
 * Mobile recommendations — falls back to SQLite when Python is down.
 * Combines market summary + latest BUY signals from predictions.db.
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

  // 2) Fallback — read from stocks.db + predictions.db
  try {
    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');

    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const predDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!fs.existsSync(stocksDbPath)) {
      return NextResponse.json(
        { success: false, error: 'stocks.db not found' },
        { status: 500 }
      );
    }

    const sdb = new Database(stocksDbPath, { readonly: true });
    const marketMap: Record<string, string> = {
      EGX: 'EGX',
      TADAWUL: 'TADAWUL',
      KSA: 'TADAWUL',
      KSE: 'KSE',
      QSE: 'QSE',
    };
    const dbMarket = marketMap[market.toUpperCase()] || 'EGX';

    const stocks: any[] = sdb
      .prepare(
        `SELECT ticker, name_ar, name, current_price, change_percent, volume
         FROM stocks WHERE market = ? COLLATE NOCASE
         AND current_price IS NOT NULL AND current_price > 0`
      )
      .all(dbMarket);

    const advancing = stocks.filter((s) => Number(s.change_percent) > 0).length;
    const declining = stocks.filter((s) => Number(s.change_percent) < 0).length;
    const unchanged = stocks.length - advancing - declining;
    const totalVolume = stocks.reduce(
      (sum, s) => sum + Number(s.volume || 0),
      0
    );
    const totalTurnover = stocks.reduce(
      (sum, s) =>
        sum + Number(s.current_price || 0) * Number(s.volume || 0),
      0
    );

    const topGainers = [...stocks]
      .sort((a, b) => Number(b.change_percent) - Number(a.change_percent))
      .slice(0, 5)
      .map((s) => ({
        ticker: s.ticker,
        name_ar: s.name_ar || s.name,
        price: Number(s.current_price),
        change_percent: Number(s.change_percent),
      }));

    sdb.close();

    // Latest BUY recommendations from predictions.db
    let recommendations: any[] = [];
    if (fs.existsSync(predDbPath)) {
      const pdb = new Database(predDbPath, { readonly: true });
      try {
        recommendations = pdb
          .prepare(
            `SELECT ticker, signal, signal_type, prediction_date, entry_price,
                    target_price, stop_loss, master_score, confidence, status,
                    risk_reward, persona
             FROM predictions
             WHERE (signal LIKE '%BUY%')
               AND market = ? COLLATE NOCASE
             ORDER BY prediction_date DESC, master_score DESC
             LIMIT 20`
          )
          .all(dbMarket)
          .map((r: any) => ({
            ticker: r.ticker,
            signal: r.signal,
            entry_price: Number(r.entry_price),
            target_price: r.target_price != null ? Number(r.target_price) : null,
            stop_loss: r.stop_loss != null ? Number(r.stop_loss) : null,
            master_score: r.master_score != null ? Number(r.master_score) : null,
            confidence: r.confidence != null ? Number(r.confidence) : null,
            status: r.status,
            prediction_date: r.prediction_date,
            risk_reward:
              r.risk_reward != null
                ? Number(r.risk_reward)
                : r.target_price != null && r.stop_loss != null && r.entry_price
                ? Number(
                    (Number(r.target_price) - Number(r.entry_price)) /
                      (Number(r.entry_price) - Number(r.stop_loss))
                  )
                : null,
            persona: r.persona,
          }));
      } catch {}
      pdb.close();
    }

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      market,
      summary: {
        total_stocks: stocks.length,
        advancing,
        declining,
        unchanged,
        total_volume: totalVolume,
        total_turnover: totalTurnover,
      },
      top_gainers: topGainers,
      recommendations,
      count: recommendations.length,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[mobile:recommendations]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
