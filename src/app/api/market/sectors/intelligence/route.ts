/**
 * Sector Intelligence — READ-ONLY
 * ================================
 * "نظرة المحلل الخبير" على القطاعات:
 *
 * 1. sector_ranking       → ترتيب القطاعات بالأداء (avg change %, gainers, losers)
 * 2. market_breadth       → كم قطاع طالع vs نازل (صحة السوق)
 * 3. top_outperformers    → أسهم تتفوق على قطاعها (relative strength +ve)
 * 4. top_underperformers  → أسهم أضعف من قطاعها (relative strength -ve)
 *
 * مصدر البيانات: stocks.db (read-only) — sector, change_percent, volume, rsi
 * No new engines, no new screens — uses existing data only.
 *
 * GET /api/market/sectors/intelligence
 *   ?min_stocks=5    // minimum stocks per sector to be ranked (default 5)
 *   ?limit=20        // max items per category (default 20)
 *   ?market=EGX      // reserved for future filter (stocks.db is EGX-only)
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

function openDb(dbPath: string): Database.Database {
  try {
    return new Database(dbPath, { readonly: true, timeout: 5000, fileMustExist: true });
  } catch { // silent fallback (safe-by-design)
    return new Database(`file:${dbPath}?immutable=1`, { readonly: true, timeout: 5000 });
  }
}

// ✅ defensive: يتأكد إن العمود موجود قبل ما يطلبه في SELECT
function getColumnNames(db: Database.Database, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return new Set(rows.map(r => r.name));
  } catch { // silent fallback (safe-by-design)
    return new Set();
  }
}

interface StockRow {
  ticker: string;
  name: string | null;
  name_ar?: string | null;
  sector: string;
  change_percent: number | null;
  volume: number | null;
  market_cap: number | null;
  pe_ratio: number | null;
  rsi: number | null;
  current_price: number | null;
  is_egx30: number | null;
  is_egx100: number | null;
  last_updated: string | null; // ✅ جديد: ema آخر تحديث للسعر (5-min cycle)
}

interface SectorStat {
  sector: string;
  total_stocks: number;
  avg_change_pct: number;
  gainers: number;
  losers: number;
  flat: number;
  breadth: number; // gainers - losers (positive = sector strong)
  total_volume: number;
  avg_rsi: number | null;
  avg_pe: number | null;
  latest_price_update: string | null; // ✅ أحدث تحديث سعر في القطاع
  prices_fresh_count: number; // ✅ كم سعر طازة (<15 min)
  prices_stale_count: number; // ✅ كم سعر مش طازة
  top_gainer: { ticker: string; name: string | null; change_pct: number } | null;
  top_loser: { ticker: string; name: string | null; change_pct: number } | null;
}

interface RelativeStrengthRow {
  ticker: string;
  name: string | null;
  sector: string;
  stock_change_pct: number;
  sector_avg_change_pct: number;
  relative_strength: number;
  volume: number | null;
  rsi: number | null;
  current_price: number | null;
  is_egx30: boolean;
  is_egx100: boolean;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const minStocks = Math.max(1, Math.min(50, Number(searchParams.get('min_stocks') || '5')));
  const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit') || '20')));

  const dbPath = path.join(process.cwd(), 'db', 'stocks.db');

  let db: Database.Database | null = null;
  try {
    db = openDb(dbPath);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `Failed to open stocks.db: ${String(err)}` },
      { status: 503 }
    );
  }

  try {
    // ✅ defensive: نتأكد من الأعمدة الموجودة في stocks قبل ما نطلبها
    const stockCols = getColumnNames(db, 'stocks');
    const optionalCols = ['name_ar', 'volume', 'market_cap', 'pe_ratio', 'rsi', 'current_price', 'is_egx30', 'is_egx100', 'last_updated'];
    const selectCols = ['ticker', 'name', 'sector', 'change_percent']
      .concat(optionalCols.filter(c => stockCols.has(c)))
      .join(', ');

    // ── 1) Load all active EGX stocks with sector ──
    //    ✅ بنجيب last_updated كمان عشان نحسب freshness الأسعار في كل قطاع
    const stocks = db.prepare(`
      SELECT ${selectCols}
      FROM stocks
      WHERE is_active = 1
        AND sector IS NOT NULL AND sector != '' AND sector != '—'
    `).all() as StockRow[];

    // فضّل الاسم العربي لو موجود
    for (const s of stocks) {
      if (s.name_ar && !s.name) s.name = s.name_ar;
    }

    if (stocks.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No active stocks with sector found in stocks.db',
      }, { status: 404 });
    }

    // ── 2) Group by sector + compute stats ──
    const sectorMap = new Map<string, StockRow[]>();
    for (const s of stocks) {
      if (!sectorMap.has(s.sector)) sectorMap.set(s.sector, []);
      sectorMap.get(s.sector)!.push(s);
    }

    const sectorStats: SectorStat[] = [];
    // ✅ helper: حساب عمر آخر تحديث بالدقائق
    const minutesAgo = (ts: string | null): number | null => {
      if (!ts) return null;
      try {
        const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T'));
        if (isNaN(d.getTime())) return null;
        return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60)));
      } catch { /* safe-by-design */ return null; }
    };

    for (const [sector, sectorStocks] of sectorMap.entries()) {
      if (sectorStocks.length < minStocks) continue;

      let gainers = 0, losers = 0, flat = 0;
      let sumChange = 0, sumVolume = 0, sumRsi = 0, sumPe = 0;
      let rsiCount = 0, peCount = 0;
      let topGainer: StockRow | null = null;
      let topLoser: StockRow | null = null;
      let latestUpdate: string | null = null;
      let freshCount = 0, staleCount = 0;

      for (const s of sectorStocks) {
        const chg = s.change_percent ?? 0;
        sumChange += chg;
        if (s.volume) sumVolume += s.volume;
        if (s.rsi != null && s.rsi > 0) { sumRsi += s.rsi; rsiCount++; }
        if (s.pe_ratio != null && s.pe_ratio > 0) { sumPe += s.pe_ratio; peCount++; }

        // ✅ freshness tracking
        const ageMin = minutesAgo(s.last_updated);
        if (ageMin !== null) {
          if (ageMin <= 15) freshCount++;
          else staleCount++;
          if (!latestUpdate || (s.last_updated || '') > latestUpdate) {
            latestUpdate = s.last_updated;
          }
        }

        if (chg > 0.01) {
          gainers++;
          if (!topGainer || chg > (topGainer.change_percent ?? 0)) topGainer = s;
        } else if (chg < -0.01) {
          losers++;
          if (!topLoser || chg < (topLoser.change_percent ?? 0)) topLoser = s;
        } else {
          flat++;
        }
      }

      const n = sectorStocks.length;
      sectorStats.push({
        sector,
        total_stocks: n,
        avg_change_pct: Math.round((sumChange / n) * 100) / 100,
        gainers,
        losers,
        flat,
        breadth: gainers - losers,
        total_volume: sumVolume,
        avg_rsi: rsiCount > 0 ? Math.round((sumRsi / rsiCount) * 10) / 10 : null,
        avg_pe: peCount > 0 ? Math.round((sumPe / peCount) * 100) / 100 : null,
        latest_price_update: latestUpdate,
        prices_fresh_count: freshCount,
        prices_stale_count: staleCount,
        top_gainer: topGainer ? {
          ticker: topGainer.ticker,
          name: topGainer.name,
          change_pct: Math.round((topGainer.change_percent ?? 0) * 100) / 100,
        } : null,
        top_loser: topLoser ? {
          ticker: topLoser.ticker,
          name: topLoser.name,
          change_pct: Math.round((topLoser.change_percent ?? 0) * 100) / 100,
        } : null,
      });
    }

    // Sort sectors by avg_change_pct descending (best first)
    sectorStats.sort((a, b) => b.avg_change_pct - a.avg_change_pct);

    // ── 3) Market breadth (how many sectors up vs down) ──
    const sectorsUp = sectorStats.filter(s => s.avg_change_pct > 0).length;
    const sectorsDown = sectorStats.filter(s => s.avg_change_pct < 0).length;
    const sectorsFlat = sectorStats.length - sectorsUp - sectorsDown;
    const marketBreadth = {
      total_sectors: sectorStats.length,
      sectors_up: sectorsUp,
      sectors_down: sectorsDown,
      sectors_flat: sectorsFlat,
      market_mood: sectorsUp > sectorsDown * 1.5
        ? 'صاعد قوي (Bullish)'
        : sectorsDown > sectorsUp * 1.5
          ? 'هابط قوي (Bearish)'
          : 'عرضي/مختلط (Mixed)',
    };

    // ── 4) Relative Strength: stock vs its sector ──
    const rsRows: RelativeStrengthRow[] = [];
    for (const s of stocks) {
      const sectorStat = sectorStats.find(st => st.sector === s.sector);
      if (!sectorStat) continue;
      if (s.change_percent == null) continue;

      const rs = s.change_percent - sectorStat.avg_change_pct;
      rsRows.push({
        ticker: s.ticker,
        name: s.name,
        sector: s.sector,
        stock_change_pct: Math.round(s.change_percent * 100) / 100,
        sector_avg_change_pct: sectorStat.avg_change_pct,
        relative_strength: Math.round(rs * 100) / 100,
        volume: s.volume,
        rsi: s.rsi,
        current_price: s.current_price,
        is_egx30: (s.is_egx30 ?? 0) === 1,
        is_egx100: (s.is_egx100 ?? 0) === 1,
      });
    }

    // Sort by relative strength
    rsRows.sort((a, b) => b.relative_strength - a.relative_strength);
    const topOutperformers = rsRows.slice(0, limit);
    const topUnderperformers = rsRows.slice(-limit).reverse();

    return NextResponse.json({
      success: true,
      generated_at: new Date().toISOString(),
      params: { min_stocks: minStocks, limit, market: 'EGX' },
      summary: {
        total_stocks_analyzed: stocks.length,
        total_sectors: sectorStats.length,
        market_breadth: marketBreadth,
        best_sector: sectorStats[0] ? {
          sector: sectorStats[0].sector,
          avg_change_pct: sectorStats[0].avg_change_pct,
        } : null,
        worst_sector: sectorStats[sectorStats.length - 1] ? {
          sector: sectorStats[sectorStats.length - 1].sector,
          avg_change_pct: sectorStats[sectorStats.length - 1].avg_change_pct,
        } : null,
      },
      sector_ranking: sectorStats,
      top_outperformers: topOutperformers,
      top_underperformers: topUnderperformers,
      note: '🎯 relative_strength = أداء السهم - متوسط أداء قطاعه. +ve = السهم أقوى من قطاعه (فرصة). -ve = السهم أضعف من قطاعه (تحذير).',
    });
  } catch (err) {
    console.error('[market:sectors:intelligence]', err);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  } finally {
    try { db?.close(); } catch { /* ignore - safe-by-design */ }
  }
}
