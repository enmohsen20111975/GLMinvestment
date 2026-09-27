import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { readRadarCache } from '@/lib/radar-cache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/maker-radar/sector-treemap?days=30
 *
 * Sector Liquidity Treemap — per-sector aggregates for a treemap visualization.
 *
 * Algorithm:
 *   1. Read cached radar JSON (readRadarCache) to get all radar stocks with
 *      their avg_turnover_20d / avg_volume_20d / roc_10d / path / current_price.
 *   2. For each ticker, fetch sector + name_ar + current_price + previous_close
 *      from /home/z/my-project/db/stocks.db table `stocks`.
 *   3. Group tickers by sector and compute aggregates:
 *        stocks_count, total_turnover, avg_change_pct, avg_roc_10d,
 *        total_volume, direction (inflow/outflow/neutral), top_tickers (top 3).
 *   4. Sort sectors by total_turnover descending.
 *
 * If radar cache is empty → success:false with Arabic "warming up" message.
 */

const PROJECT_ROOT = process.cwd();

interface RadarStockLite {
  ticker: string;
  current_price?: number | null;
  avg_turnover_20d?: number | null;
  avg_volume_20d?: number | null;
  roc_10d?: number | null;
  path?: string | null;
  [k: string]: any;
}

interface StockInfoRow {
  ticker: string;
  sector: string | null;
  name_ar: string | null;
  current_price: number | null;
  previous_close: number | null;
}

interface SectorAgg {
  sector: string;
  stocks_count: number;
  total_turnover: number;
  total_volume: number;
  avg_change_pct: number;
  avg_roc_10d: number;
  direction: 'inflow' | 'outflow' | 'neutral';
  color: string;
  top_tickers: Array<{
    ticker: string;
    name_ar: string;
    avg_turnover_20d: number;
    change_pct: number | null;
    roc_10d: number | null;
  }>;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const daysParam = parseInt(url.searchParams.get('days') || '30', 10);
  const days = isNaN(daysParam) || daysParam < 1 ? 30 : daysParam;

  // ── 1. Read radar cache ─────────────────────────────────────────────
  const cache = readRadarCache();
  if (!cache || !cache.data) {
    return NextResponse.json(
      {
        success: false,
        error: 'الرادار بيتسخن — حاول تاني خلال دقيقة',
        warming_up: true,
        retry_after_seconds: 30,
      },
      { status: 503 }
    );
  }

  // Collect every ticker appearing in the radar lists (dedup by ticker).
  const radarStocks = collectRadarStocks(cache.data);
  if (radarStocks.size === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'الرادار بيتسخن — لا توجد أسهم في الكاش حالياً',
        warming_up: true,
        retry_after_seconds: 30,
      },
      { status: 503 }
    );
  }

  // ── 2. Open stocks.db + fetch sector info for each ticker ───────────
  const stocksDbPath = path.join(PROJECT_ROOT, 'db', 'stocks.db');
  if (!existsSync(stocksDbPath)) {
    return NextResponse.json(
      {
        success: false,
        error: 'قاعدة بيانات الأسهم غير متوفرة (db/stocks.db)',
      },
      { status: 503 }
    );
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(stocksDbPath, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.error('[sector-treemap] open stocks.db error:', e);
    return NextResponse.json(
      { success: false, error: 'تعذّر فتح قاعدة بيانات الأسهم' },
      { status: 503 }
    );
  }

  try {
    const tickers = Array.from(radarStocks.keys());
    const infoByTicker = fetchStocksInfo(db, tickers);
    db.close();
    db = null;

    // ── 3. Group by sector ───────────────────────────────────────────
    const groups = new Map<string, RadarStockLite[]>();
    for (const ticker of tickers) {
      const info = infoByTicker.get(ticker);
      const sectorRaw = info?.sector?.trim();
      // Treat missing/null/empty sector as "غير مُصنّف" so it still shows up
      const sector = sectorRaw && sectorRaw.length > 0 ? sectorRaw : 'غير مُصنّف';
      if (!groups.has(sector)) groups.set(sector, []);
      groups.get(sector)!.push(radarStocks.get(ticker)!);
    }

    // ── 4. Build sector aggregates ───────────────────────────────────
    const sectors: SectorAgg[] = [];
    for (const [sector, stocks] of groups.entries()) {
      // Fetch stock info once per ticker in this sector
      let totalTurnover = 0;
      let totalVolume = 0;
      let sumChangePct = 0;
      let countChangePct = 0;
      let sumRoc10d = 0;
      let countRoc10d = 0;

      const tickerDetails: Array<{
        ticker: string;
        name_ar: string;
        avg_turnover_20d: number;
        change_pct: number | null;
        roc_10d: number | null;
      }> = [];

      for (const s of stocks) {
        const info = infoByTicker.get(s.ticker);
        const turnover = num(s.avg_turnover_20d);
        const volume = num(s.avg_volume_20d);
        totalTurnover += turnover;
        totalVolume += volume;

        // change_pct: prefer explicit computed value if present,
        // else derive from current_price + previous_close
        let changePct: number | null = null;
        if (
          info &&
          info.current_price != null &&
          info.previous_close != null &&
          info.previous_close > 0
        ) {
          changePct =
            ((info.current_price - info.previous_close) / info.previous_close) *
            100;
        }
        if (changePct != null && !isNaN(changePct)) {
          sumChangePct += changePct;
          countChangePct++;
        }

        if (s.roc_10d != null && !isNaN(num(s.roc_10d))) {
          sumRoc10d += num(s.roc_10d);
          countRoc10d++;
        }

        tickerDetails.push({
          ticker: s.ticker,
          name_ar: info?.name_ar || s.ticker,
          avg_turnover_20d: Math.round(turnover),
          change_pct:
            changePct != null && !isNaN(changePct) ? round2(changePct) : null,
          roc_10d:
            s.roc_10d != null && !isNaN(num(s.roc_10d))
              ? round2(num(s.roc_10d))
              : null,
        });
      }

      // Sort tickers by turnover desc, keep top 3
      tickerDetails.sort((a, b) => b.avg_turnover_20d - a.avg_turnover_20d);
      const topTickers = tickerDetails.slice(0, 3);

      const avgChangePct = countChangePct > 0 ? sumChangePct / countChangePct : 0;
      const avgRoc10d = countRoc10d > 0 ? sumRoc10d / countRoc10d : 0;

      let direction: 'inflow' | 'outflow' | 'neutral';
      let color: string;
      if (avgChangePct > 0.5) {
        direction = 'inflow';
        color = 'emerald';
      } else if (avgChangePct < -0.5) {
        direction = 'outflow';
        color = 'rose';
      } else {
        direction = 'neutral';
        color = 'amber';
      }

      sectors.push({
        sector,
        stocks_count: stocks.length,
        total_turnover: Math.round(totalTurnover),
        total_volume: Math.round(totalVolume),
        avg_change_pct: round2(avgChangePct),
        avg_roc_10d: round2(avgRoc10d),
        direction,
        color,
        top_tickers: topTickers,
      });
    }

    // ── 5. Sort by total_turnover desc ───────────────────────────────
    sectors.sort((a, b) => b.total_turnover - a.total_turnover);

    const totalTurnoverAll = sectors.reduce(
      (s, x) => s + x.total_turnover,
      0
    );

    return NextResponse.json({
      success: true,
      days,
      total_sectors: sectors.length,
      total_turnover: Math.round(totalTurnoverAll),
      sectors,
      generated_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[sector-treemap] error:', error);
    try { if (db) db.close(); } catch {}
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Collect every ticker across the 4 radar lists, deduped by ticker. */
function collectRadarStocks(data: any): Map<string, RadarStockLite> {
  const out = new Map<string, RadarStockLite>();
  const listKeys = [
    'quiet_list',
    'pre_surge_list',
    'explosive_list',
    'early_break_list',
  ];
  for (const k of listKeys) {
    const arr = Array.isArray(data?.[k]) ? data[k] : [];
    for (const s of arr) {
      const ticker = String(s?.ticker || '').toUpperCase().trim();
      if (!ticker || out.has(ticker)) continue;
      out.set(ticker, {
        ticker,
        current_price: s.current_price ?? null,
        avg_turnover_20d: s.avg_turnover_20d ?? null,
        avg_volume_20d: s.avg_volume_20d ?? null,
        roc_10d: s.roc_10d ?? null,
        path: s.path ?? null,
      });
    }
  }
  return out;
}

/** Fetch sector + name_ar + current_price + previous_close for the tickers. */
function fetchStocksInfo(
  db: Database.Database,
  tickers: string[]
): Map<string, StockInfoRow> {
  const out = new Map<string, StockInfoRow>();
  if (tickers.length === 0) return out;
  // Use IN (?,?,...) — SQLite supports up to 999 params by default; tickers list
  // is small enough (~300 max).
  const placeholders = tickers.map(() => '?').join(',');
  let rows: any[] = [];
  try {
    rows = db
      .prepare(
        `SELECT ticker, sector, name_ar, current_price, previous_close
         FROM stocks
         WHERE ticker IN (${placeholders})`
      )
      .all(...tickers) as any[];
  } catch (e) {
    // Table may be missing columns or not exist — return empty map gracefully.
    console.error('[sector-treemap] fetchStocksInfo error:', e);
    return out;
  }
  for (const r of rows) {
    const t = String(r.ticker || '').toUpperCase().trim();
    if (!t) continue;
    out.set(t, {
      ticker: t,
      sector: r.sector != null ? String(r.sector) : null,
      name_ar: r.name_ar != null ? String(r.name_ar) : null,
      current_price: numOrNull(r.current_price),
      previous_close: numOrNull(r.previous_close),
    });
  }
  return out;
}

function num(v: any): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function numOrNull(v: any): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
