/**
 * GET /api/mobile/dashboard
 * ========================
 * Mobile dashboard — falls back to SQLite summary when Python is down.
 * Combines market summary + indices + top movers + latest predictions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMarketIndices } from '@/lib/egx-db';
import { openDb } from '@/lib/db-manager';
import { normalizeMarket, sqlMarketVariants, type CanonicalMarket } from '@/lib/market-utils';

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

  // 2) Fallback — SQLite
  try {
    const sdb = openDb('stocks.db');
    if (!sdb) {
      return NextResponse.json(
        { success: false, error: 'stocks.db not found' },
        { status: 500 }
      );
    }

    // FIX (FIX-API-MARKET #2): use shared normalizeMarket() so the local map
    // includes US/CRYPTO and all Arabic aliases. Previously the local MARKET_MAP
    // silently dropped US and CRYPTO requests to 'EGX'.
    const canonical: CanonicalMarket = normalizeMarket(market) || 'EGX';
    const marketVariants = sqlMarketVariants(canonical);
    const marketPlaceholders = marketVariants.map(() => '?').join(',');
    const dbMarket = canonical;

    const stocks: any[] = sdb
      .prepare(
        `SELECT ticker, name_ar, name, current_price, previous_close,
                change_percent, volume, value_traded, turnover_egp, sector
         FROM stocks WHERE market IN (${marketPlaceholders})
         AND current_price IS NOT NULL AND current_price > 0`
      )
      .all(...marketVariants);

    const advancing = stocks.filter((s) => Number(s.change_percent) > 0).length;
    const declining = stocks.filter((s) => Number(s.change_percent) < 0).length;
    const unchanged = stocks.length - advancing - declining;
    const totalVolume = stocks.reduce(
      (sum, s) => sum + Number(s.volume || 0),
      0
    );
    const totalTurnover = stocks.reduce(
      (sum, s) => sum + Number(s.value_traded || s.turnover_egp || 0),
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

    const topLosers = [...stocks]
      .sort((a, b) => Number(a.change_percent) - Number(b.change_percent))
      .slice(0, 5)
      .map((s) => ({
        ticker: s.ticker,
        name_ar: s.name_ar || s.name,
        price: Number(s.current_price),
        change_percent: Number(s.change_percent),
      }));

    // Market indices (use the corrected helper from egx-db)
    let indices: any[] = [];
    try {
      const allIndices = getMarketIndices();
      indices = allIndices
        .filter((idx) =>
          String(idx.symbol || '').toUpperCase().includes(dbMarket)
        )
        .slice(0, 5)
        .map((idx) => ({
          symbol: idx.symbol,
          name_ar: idx.name_ar,
          value: idx.current_value,
          previous_close: idx.previous_close,
          change: idx.change,
          change_percent: idx.change_percent,
        }));
    } catch {}

    sdb.close();

    // Latest predictions
    let latestPredictions: any[] = [];
    const pdb = openDb('predictions.db');
    if (pdb) {
      try {
        latestPredictions = pdb
          .prepare(
            `SELECT ticker, signal, prediction_date, entry_price, target_price,
                    stop_loss, master_score, status
             FROM predictions
             WHERE market IN (${marketPlaceholders})
             ORDER BY prediction_date DESC
             LIMIT 10`
          )
          .all(...marketVariants);
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
      indices,
      top_gainers: topGainers,
      top_losers: topLosers,
      latest_predictions: latestPredictions,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[mobile:dashboard]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
