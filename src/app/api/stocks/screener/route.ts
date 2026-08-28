import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { join } from 'path';

export const dynamic = 'force-dynamic';

interface ScreenerStock {
  ticker: string;
  name: string;
  name_ar: string;
  market: string;
  sector: string;
  current_price: number;
  change_percent: number;
  volume: number;
  market_cap: number;
  pe_ratio: number | null;
  roe: number | null;
  ma_50: number | null;
  ma_200: number | null;
  rsi: number | null;
  trend: string | null;
  signal: number | null;
  beta: number | null;
  high_52w: number | null;
  low_52w: number | null;
  // Computed fields
  above_ma_50?: boolean;
  above_ma_200?: boolean;
  distance_from_52w_high?: number;
  distance_from_52w_low?: number;
  momentum_score?: number;
  correction_status?: string;
  volume_surge?: boolean;
}

/**
 * GET /api/stocks/screener
 *
 * Advanced screener — reads stocks.db directly (no Python backend needed).
 *
 * Query params:
 *  - market: EGX | KSA | KUWAIT | QATAR (default: EGX)
 *  - sector: filter by sector (e.g., "Finance", "Real Estate")
 *  - sort: change_percent | volume | momentum | rsi | distance_52w_high
 *  - order: asc | desc
 *  - limit: max 500 (default: 100)
 *  - min_volume: minimum volume
 *  - min_change: minimum change_percent (absolute)
 *  - trend: up | down | neutral
 *  - above_ma: 50 | 200 | both
 *  - correction_status: oversold | overbought | breakout | in_correction
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const market = searchParams.get('market') || 'EGX';
    const sector = searchParams.get('sector') || '';
    const sort = searchParams.get('sort') || 'change_percent';
    const order = searchParams.get('order') === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(500, parseInt(searchParams.get('limit') || '100', 10));
    const minVolume = parseFloat(searchParams.get('min_volume') || '0');
    const minChange = parseFloat(searchParams.get('min_change') || '0');
    const trendFilter = searchParams.get('trend') || '';
    const aboveMa = searchParams.get('above_ma') || '';
    const correctionStatus = searchParams.get('correction_status') || '';

    const dbPath = join(process.cwd(), 'db', 'stocks.db');
    const db = new Database(dbPath, { readonly: true });

    // Build query
    const whereClauses: string[] = ['is_active = 1'];
    const params: (string | number)[] = [];

    if (market && market !== 'ALL') {
      whereClauses.push('market = ?');
      params.push(market);
    }

    if (sector) {
      whereClauses.push('sector LIKE ?');
      params.push(`%${sector}%`);
    }

    if (minVolume > 0) {
      whereClauses.push('volume >= ?');
      params.push(minVolume);
    }

    if (minChange > 0) {
      whereClauses.push('ABS(change_percent) >= ?');
      params.push(minChange);
    }

    if (trendFilter === 'up') {
      whereClauses.push('change_percent > 0');
    } else if (trendFilter === 'down') {
      whereClauses.push('change_percent < 0');
    }

    // Map sort field to column
    const sortMap: Record<string, string> = {
      change_percent: 'change_percent',
      volume: 'volume',
      momentum: 'change_percent',
      rsi: 'rsi',
      distance_52w_high: 'high_52w',
      market_cap: 'market_cap',
      pe_ratio: 'pe_ratio',
    };
    const sortCol = sortMap[sort] || 'change_percent';

    const whereSQL = whereClauses.join(' AND ');

    const rows = db.prepare(`
      SELECT
        ticker, name, name_ar, market, sector,
        current_price, change_percent, volume, market_cap,
        pe_ratio, roe, ma_50, ma_200, rsi, trend, signal,
        beta, high_52w, low_52w, avg_volume
      FROM stocks
      WHERE ${whereSQL}
      ORDER BY ${sortCol} ${order}
      LIMIT ?
    `).all(...params, limit) as Record<string, unknown>[];

    // Compute derived fields
    const stocks: ScreenerStock[] = rows.map(row => {
      const current = Number(row.current_price) || 0;
      const ma50 = Number(row.ma_50) || null;
      const ma200 = Number(row.ma_200) || null;
      const high52 = Number(row.high_52w) || null;
      const low52 = Number(row.low_52w) || null;
      const rsi = Number(row.rsi) || null;
      const avgVol = Number(row.avg_volume) || 0;
      const vol = Number(row.volume) || 0;
      const change = Number(row.change_percent) || 0;

      // Distance from 52-week high/low
      const distFromHigh = high52 && high52 > 0 ? ((current - high52) / high52 * 100) : null;
      const distFromLow = low52 && low52 > 0 ? ((current - low52) / low52 * 100) : null;

      // Correction status
      let correctionStatus = 'neutral';
      if (distFromHigh !== null) {
        if (distFromHigh < -10) correctionStatus = 'in_correction';
        else if (distFromHigh < -5) correctionStatus = 'pulling_back';
        else if (distFromHigh > 95) correctionStatus = 'near_high';
        else if (distFromHigh > 0) correctionStatus = 'breakout';
      }
      if (rsi !== null) {
        if (rsi > 70) correctionStatus = 'overbought';
        else if (rsi < 30) correctionStatus = 'oversold';
      }

      // Volume surge
      const volSurge = avgVol > 0 && vol > avgVol * 1.5;

      // Momentum score (simple: change_percent + above_ma_50)
      let momentumScore = change;
      if (ma50 && current > ma50) momentumScore += 2;
      if (ma200 && current > ma200) momentumScore += 1;
      if (volSurge) momentumScore += 2;

      return {
        ticker: String(row.ticker || ''),
        name: String(row.name || ''),
        name_ar: String(row.name_ar || row.name || ''),
        market: String(row.market || ''),
        sector: String(row.sector || ''),
        current_price: current,
        change_percent: change,
        volume: vol,
        market_cap: Number(row.market_cap) || 0,
        pe_ratio: row.pe_ratio !== null ? Number(row.pe_ratio) : null,
        roe: row.roe !== null ? Number(row.roe) : null,
        ma_50: ma50,
        ma_200: ma200,
        rsi: rsi,
        trend: row.trend ? String(row.trend) : null,
        signal: row.signal !== null ? Number(row.signal) : null,
        beta: row.beta !== null ? Number(row.beta) : null,
        high_52w: high52,
        low_52w: low52,
        above_ma_50: ma50 ? current > ma50 : false,
        above_ma_200: ma200 ? current > ma200 : false,
        distance_from_52w_high: distFromHigh,
        distance_from_52w_low: distFromLow,
        momentum_score: momentumScore,
        correction_status: correctionStatus,
        volume_surge: volSurge,
      };
    });

    // Apply post-query filters (computed fields)
    let filtered = stocks;
    if (aboveMa === '50') filtered = filtered.filter(s => s.above_ma_50);
    else if (aboveMa === '200') filtered = filtered.filter(s => s.above_ma_200);
    else if (aboveMa === 'both') filtered = filtered.filter(s => s.above_ma_50 && s.above_ma_200);

    if (correctionStatus) {
      filtered = filtered.filter(s => s.correction_status === correctionStatus);
    }

    // Get sector list for filter dropdown
    const sectors = db.prepare(`
      SELECT DISTINCT sector FROM stocks
      WHERE is_active = 1 AND sector IS NOT NULL AND sector != ''
      ORDER BY sector
    `).all() as { sector: string }[];

    db.close();

    return NextResponse.json({
      success: true,
      data: filtered,
      total: filtered.length,
      sectors: sectors.map(s => s.sector),
      filters: { market, sector, sort, order: order.toLowerCase(), limit, min_volume: minVolume, min_change: minChange, trend: trendFilter, above_ma: aboveMa, correction_status: correctionStatus },
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
  }
}
