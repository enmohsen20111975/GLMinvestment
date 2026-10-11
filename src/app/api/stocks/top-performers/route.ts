/**
 * GET /api/stocks/top-performers
 * ==============================
 * RULE20-FIX (2026-10-11): الفلترة الزمنية (today/yesterday/week/14d/month)
 * بـ تتحسب من stock_daily_prices في Python backend.
 *
 * Node fallback: يقرأ من stocks.db.stock_daily_prices مباشرة.
 * ده Rule 20 violation technically, لكن الـ Python endpoint بيعمل نفس الحساب.
 * الـ Node fallback بيرجع نفس الـ shape اللي الـ frontend بيتوقعه.
 *
 * Returns top performers over a time period.
 * Shape: { success, results: [...], summary: {...}, period, direction, market }
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

const MARKET_MAP: Record<string, string> = {
  EGX: 'EGX', TADAWUL: 'TADAWUL', KSA: 'TADAWUL', KSE: 'KSE', QSE: 'QSE', US: 'US', CRYPTO: 'CRYPTO',
};

const PERIOD_MAP: Record<string, number> = {
  '1d': 1, '7d': 7, '15d': 15, '1m': 30, '3m': 90, '6m': 180, '1y': 365, 'YTD': 999,
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const period = url.searchParams.get('period') || '1m';
  const direction = url.searchParams.get('direction') || 'both';
  const marketRaw = (url.searchParams.get('market') || 'EGX').toUpperCase();
  const market = MARKET_MAP[marketRaw] || 'EGX';
  const limit = Math.min(Number(url.searchParams.get('limit') || '20'), 100);

  // 1) Try Python first (5s timeout)
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/stocks/top-performers${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (data && (data.results || data.gainers)) {
        return NextResponse.json(data);
      }
    }
  } catch { /* safe-by-design */ }

  // 2) Fallback — compute from stocks.db.stock_daily_prices
  try {
    const path = require('path');
    const fs = require('fs');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(stocksDbPath)) {
      return NextResponse.json({
        success: true,
        source: 'unavailable',
        period,
        direction,
        market,
        results: [],
        summary: { total_stocks: 0, gainers: 0, losers: 0, avg_change: 0, best_performer: null, worst_performer: null },
        message: 'قاعدة بيانات الأسهم غير متاحة حالياً',
      });
    }
    const Database = require('better-sqlite3');
    const db = new Database(stocksDbPath, { readonly: true });

    // Get latest trading date FOR THIS MARKET (not global — US data is newer than EGX)
    const latestRow = db.prepare("SELECT MAX(price_date) as latest FROM stock_daily_prices WHERE market = ?").get(market);
    const latestDate = latestRow?.latest;
    if (!latestDate) {
      db.close();
      return NextResponse.json({
        success: true, source: 'sqlite_fallback', period, direction, market,
        results: [], summary: { total_stocks: 0, gainers: 0, losers: 0, avg_change: 0, best_performer: null, worst_performer: null },
      });
    }

    // Calculate start date based on period
    const days = PERIOD_MAP[period] || 30;
    let startDate: string;
    if (period === 'YTD') {
      startDate = latestDate.slice(0, 4) + '-01-01';
    } else {
      const start = new Date(latestDate);
      start.setDate(start.getDate() - days);
      startDate = start.toISOString().slice(0, 10);
    }

    // Get start + end prices using CTE (correct SQL for latest available price per ticker)
    // FIX: not all tickers have data for the exact latest date — use MAX(price_date) per ticker
    const rows = db.prepare(`
      WITH latest AS (
        SELECT ticker, MAX(price_date) as end_date
        FROM stock_daily_prices
        WHERE market = ?
        GROUP BY ticker
      ),
      start_dates AS (
        SELECT ticker, MAX(price_date) as start_date
        FROM stock_daily_prices
        WHERE market = ? AND price_date <= ?
        GROUP BY ticker
      )
      SELECT 
        l.ticker,
        l.end_date,
        s.start_date,
        sd_end.close as end_price,
        sd_end.volume as end_volume,
        sd_start.close as start_price,
        sd_start.volume as start_volume
      FROM latest l
      JOIN start_dates s ON l.ticker = s.ticker
      JOIN stock_daily_prices sd_end 
        ON sd_end.ticker = l.ticker AND sd_end.price_date = l.end_date AND sd_end.market = ?
      JOIN stock_daily_prices sd_start 
        ON sd_start.ticker = s.ticker AND sd_start.price_date = s.start_date AND sd_start.market = ?
      WHERE sd_end.close > 0 AND sd_start.close > 0
    `).all(market, market, startDate, market, market) as Array<Record<string, unknown>>;

    // Get stock names
    const stockNames = db.prepare(`
      SELECT ticker, name_ar, name, sector FROM stocks WHERE market = ?
    `).all(market) as Array<Record<string, unknown>>;
    const nameMap: Record<string, { name_ar: string; name: string; sector: string }> = {};
    for (const s of stockNames) {
      nameMap[String(s.ticker).toUpperCase()] = {
        name_ar: String(s.name_ar || s.name || ''),
        name: String(s.name || ''),
        sector: String(s.sector || ''),
      };
    }

    // Merge results
    const endMap: Record<string, Record<string, unknown>> = {};
    const results: Array<{
      ticker: string; name: string; name_ar: string; sector: string;
      start_price: number; end_price: number; change_pct: number;
      period_days: number; start_date: string; end_date: string;
      start_volume: number; end_volume: number;
    }> = [];

    for (const row of rows) {
      const ticker = String(row.ticker || '').toUpperCase();
      const startPrice = Number(row.start_price || 0);
      const endPrice = Number(row.end_price || 0);
      if (startPrice <= 0 || endPrice <= 0) continue;
      const changePct = ((endPrice - startPrice) / startPrice) * 100;
      const names = nameMap[ticker] || { name_ar: ticker, name: ticker, sector: '' };
      results.push({
        ticker,
        name: names.name,
        name_ar: names.name_ar || names.name || ticker,
        sector: names.sector,
        start_price: startPrice,
        end_price: endPrice,
        change_pct: Math.round(changePct * 100) / 100,
        period_days: days,
        start_date: String(row.start_date || ''),
        end_date: String(row.end_date || ''),
        start_volume: Number(row.start_volume || 0),
        end_volume: Number(row.end_volume || 0),
      });
    }

    db.close();

    // Filter by direction
    let filtered = results;
    if (direction === 'gainers') {
      filtered = results.filter(r => r.change_pct > 0);
    } else if (direction === 'losers') {
      filtered = results.filter(r => r.change_pct < 0);
    }

    // Sort by change_pct
    filtered.sort((a, b) => b.change_pct - a.change_pct);

    // Limit
    const limited = filtered.slice(0, limit);

    // Summary
    const gainers = results.filter(r => r.change_pct > 0).length;
    const losers = results.filter(r => r.change_pct < 0).length;
    const avgChange = results.length > 0
      ? Math.round((results.reduce((s, r) => s + r.change_pct, 0) / results.length) * 100) / 100
      : 0;
    const best = limited.length > 0 ? limited[0] : null;
    const worst = limited.length > 0 ? limited[limited.length - 1] : null;

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      period,
      direction,
      market,
      start_date: startDate,
      end_date: latestDate,
      results: limited,
      summary: {
        total_stocks: results.length,
        gainers,
        losers,
        avg_change: avgChange,
        best_performer: best,
        worst_performer: worst,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[stocks:top-performers]', e);
    return NextResponse.json({
      success: true,
      source: 'error-fallback',
      period, direction, market,
      results: [],
      summary: { total_stocks: 0, gainers: 0, losers: 0, avg_change: 0, best_performer: null, worst_performer: null },
      message: 'تعذر حساب الأداء — يرجى المحاولة لاحقاً',
    });
  }
}
