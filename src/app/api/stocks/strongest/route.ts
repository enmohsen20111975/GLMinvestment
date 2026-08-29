import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { join } from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stocks/strongest
 *
 * Aggregated screener dashboard — top movers, accumulators, breakdowns, sector heat.
 * Reads stocks.db (screener data) + data_engine.db (price history for accumulation detection).
 *
 * Query params:
 *  - market: EGX | KSA | KUWAIT | QATAR (default: EGX)
 *  - top: N (default: 5 — number of stocks per category)
 *
 * Returns:
 *  - strongest_movers: top N by change_percent (gainers)
 *  - weakest_movers: bottom N by change_percent (losers)
 *  - most_active: top N by volume
 *  - volume_surge: top N with volume_surge=true, sorted by change_percent
 *  - strongest_accumulators: top N with gradual volume build-up (3-day vol > 1.25× 20-day avg)
 *  - strongest_breakdowns: top N with volume surge + price drop (distribution)
 *  - sector_heat: per-sector avg change + stock count + leader ticker
 *  - market_summary: total stocks, advancers, decliners, avg change, market breadth
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const market = searchParams.get('market') || 'EGX';
    const topN = Math.min(50, parseInt(searchParams.get('top') || '5', 10));

    const stocksDbPath = join(process.cwd(), 'db', 'stocks.db');
    const dataEngineDbPath = join(process.cwd(), 'db', 'data_engine.db');

    const stocksDb = new Database(stocksDbPath, { readonly: true });

    // === Market summary (breadth) ===
    const breadth = stocksDb.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) as advancers,
        SUM(CASE WHEN change_percent < 0 THEN 1 ELSE 0 END) as decliners,
        SUM(CASE WHEN ABS(change_percent) < 0.5 THEN 1 ELSE 0 END) as unchanged,
        AVG(change_percent) as avg_change,
        SUM(volume) as total_volume
      FROM stocks
      WHERE is_active = 1 AND market = ? AND change_percent IS NOT NULL
    `).get(market) as { total: number; advancers: number; decliners: number; unchanged: number; avg_change: number; total_volume: number };

    // === Strongest movers (top gainers) ===
    const strongestMovers = stocksDb.prepare(`
      SELECT ticker, name, name_ar, sector, current_price, change_percent, volume, rsi
      FROM stocks WHERE is_active = 1 AND market = ? AND change_percent IS NOT NULL
      ORDER BY change_percent DESC LIMIT ?
    `).all(market, topN) as Record<string, unknown>[];

    // === Weakest movers (top losers) ===
    const weakestMovers = stocksDb.prepare(`
      SELECT ticker, name, name_ar, sector, current_price, change_percent, volume, rsi
      FROM stocks WHERE is_active = 1 AND market = ? AND change_percent IS NOT NULL
      ORDER BY change_percent ASC LIMIT ?
    `).all(market, topN) as Record<string, unknown>[];

    // === Most active (top volume) ===
    const mostActive = stocksDb.prepare(`
      SELECT ticker, name, name_ar, sector, current_price, change_percent, volume
      FROM stocks WHERE is_active = 1 AND market = ? AND volume IS NOT NULL AND volume > 0
      ORDER BY volume DESC LIMIT ?
    `).all(market, topN) as Record<string, unknown>[];

    // === Volume surge (vol > 1.5× avg_volume) ===
    const volumeSurge = stocksDb.prepare(`
      SELECT ticker, name, name_ar, sector, current_price, change_percent, volume, avg_volume,
             (volume * 1.0 / NULLIF(avg_volume, 0)) as vol_ratio
      FROM stocks WHERE is_active = 1 AND market = ?
        AND avg_volume IS NOT NULL AND avg_volume > 0
        AND volume > avg_volume * 1.5
      ORDER BY change_percent DESC LIMIT ?
    `).all(market, topN) as Record<string, unknown>[];

    // === Sector heat (per-sector breakdown) ===
    const sectorHeatRows = stocksDb.prepare(`
      SELECT
        sector,
        COUNT(*) as stock_count,
        AVG(change_percent) as avg_change,
        SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) as advancers,
        SUM(CASE WHEN change_percent < 0 THEN 1 ELSE 0 END) as decliners,
        SUM(volume) as total_volume
      FROM stocks
      WHERE is_active = 1 AND market = ? AND sector IS NOT NULL AND sector != '' AND change_percent IS NOT NULL
      GROUP BY sector
      ORDER BY avg_change DESC
    `).all(market) as { sector: string; stock_count: number; avg_change: number; advancers: number; decliners: number; total_volume: number }[];

    // Attach sector leader ticker (top stock in sector)
    const sectorHeat = sectorHeatRows.map(sh => {
      const leader = stocksDb.prepare(`
        SELECT ticker, change_percent FROM stocks
        WHERE is_active = 1 AND market = ? AND sector = ? AND change_percent IS NOT NULL
        ORDER BY change_percent DESC LIMIT 1
      `).get(market, sh.sector) as { ticker: string; change_percent: number } | undefined;
      // Heat level: hot (>+3), warm (0 to +3), neutral (-1 to 0), cool (-3 to -1), cold (<-3)
      let heatLevel = 'neutral';
      if (sh.avg_change > 3) heatLevel = 'hot';
      else if (sh.avg_change > 0) heatLevel = 'warm';
      else if (sh.avg_change > -1) heatLevel = 'neutral';
      else if (sh.avg_change > -3) heatLevel = 'cool';
      else heatLevel = 'cold';
      return {
        sector: sh.sector,
        stock_count: sh.stock_count,
        avg_change: Number(sh.avg_change.toFixed(2)),
        advancers: sh.advancers,
        decliners: sh.decliners,
        breadth: sh.stock_count > 0 ? Number((sh.advancers / sh.stock_count * 100).toFixed(0)) : 0,
        total_volume: sh.total_volume,
        leader_ticker: leader?.ticker || null,
        leader_change: leader ? Number(leader.change_percent.toFixed(2)) : null,
        heat_level: heatLevel,
      };
    });

    // === Strongest accumulators + breakdowns (need data_engine.db for price history) ===
    let strongestAccumulators: Record<string, unknown>[] = [];
    let strongestBreakdowns: Record<string, unknown>[] = [];

    try {
      const dataEngineDb = new Database(dataEngineDbPath, { readonly: true });

      // Get tickers for accumulation scan (top movers + volume surge candidates)
      const candidates = stocksDb.prepare(`
        SELECT ticker, name, name_ar, sector, current_price, change_percent, volume, avg_volume
        FROM stocks WHERE is_active = 1 AND market = ?
          AND volume IS NOT NULL AND volume > 0
        ORDER BY volume DESC LIMIT 100
      `).all(market) as { ticker: string; name: string; name_ar: string; sector: string; current_price: number; change_percent: number; volume: number; avg_volume: number }[];

      const accumulators: Array<Record<string, unknown>> = [];
      const breakdowns: Array<Record<string, unknown>> = [];

      // Check price history table schema first
      const tableInfo = dataEngineDb.prepare(`PRAGMA table_info(egksco_price_history)`).all() as { name: string }[];
      const hasSymbolCol = tableInfo.some(c => c.name === 'symbol');
      const hasVolCol = tableInfo.some(c => c.name === 'volume');

      if (hasSymbolCol && hasVolCol) {
        for (const c of candidates) {
          // Last 25 days of volume for this ticker
          const history = dataEngineDb.prepare(`
            SELECT volume FROM egksco_price_history
            WHERE symbol = ? AND volume IS NOT NULL AND volume > 0
            ORDER BY price_date DESC LIMIT 25
          `).all(c.ticker) as { volume: number }[];

          if (history.length < 20) continue;

          const last3Vol = history.slice(0, 3).map(h => h.volume);
          const last20Vol = history.slice(0, 20).map(h => h.volume);
          const avg3 = last3Vol.reduce((a, b) => a + b, 0) / last3Vol.length;
          const avg20 = last20Vol.reduce((a, b) => a + b, 0) / last20Vol.length;

          if (avg20 <= 0) continue;

          const volBuildupRatio = avg3 / avg20;

          // Accumulator: 3-day vol ≥ 1.25× 20-day avg AND change > 0 (gradual accumulation)
          if (volBuildupRatio >= 1.25 && c.change_percent > 0) {
            accumulators.push({
              ticker: c.ticker,
              name: c.name,
              name_ar: c.name_ar,
              sector: c.sector,
              current_price: c.current_price,
              change_percent: Number(c.change_percent.toFixed(2)),
              volume: c.volume,
              vol_buildup_ratio: Number(volBuildupRatio.toFixed(2)),
              accumulation_score: Number((volBuildupRatio * Math.abs(c.change_percent)).toFixed(2)),
            });
          }
          // Breakdown: volume surge + price drop (distribution / selling pressure)
          else if (volBuildupRatio >= 1.5 && c.change_percent < -2) {
            breakdowns.push({
              ticker: c.ticker,
              name: c.name,
              name_ar: c.name_ar,
              sector: c.sector,
              current_price: c.current_price,
              change_percent: Number(c.change_percent.toFixed(2)),
              volume: c.volume,
              vol_buildup_ratio: Number(volBuildupRatio.toFixed(2)),
              distribution_score: Number((volBuildupRatio * Math.abs(c.change_percent)).toFixed(2)),
            });
          }
        }
        dataEngineDb.close();

        // Sort + trim
        accumulators.sort((a, b) => Number(b.accumulation_score) - Number(a.accumulation_score));
        breakdowns.sort((a, b) => Number(b.distribution_score) - Number(a.distribution_score));
        strongestAccumulators = accumulators.slice(0, topN);
        strongestBreakdowns = breakdowns.slice(0, topN);
      } else {
        dataEngineDb.close();
      }
    } catch (e) {
      // data_engine.db not available — return empty arrays
      console.error('[strongest] data_engine.db read failed:', e instanceof Error ? e.message : 'unknown');
    }

    stocksDb.close();

    return NextResponse.json({
      success: true,
      market,
      market_summary: {
        total_stocks: breadth.total,
        advancers: breadth.advancers,
        decliners: breadth.decliners,
        unchanged: breadth.unchanged,
        breadth: breadth.total > 0 ? Number(((breadth.advancers - breadth.decliners) / breadth.total * 100).toFixed(1)) : 0,
        avg_change: breadth.avg_change ? Number(breadth.avg_change.toFixed(2)) : 0,
        total_volume: breadth.total_volume || 0,
      },
      strongest_movers: strongestMovers.map(r => ({
        ticker: String(r.ticker), name: String(r.name || ''),
        name_ar: String(r.name_ar || r.name || ''), sector: String(r.sector || ''),
        current_price: Number(r.current_price) || 0,
        change_percent: Number(r.change_percent).toFixed(2),
        volume: Number(r.volume) || 0, rsi: r.rsi !== null ? Number(r.rsi) : null,
      })),
      weakest_movers: weakestMovers.map(r => ({
        ticker: String(r.ticker), name: String(r.name || ''),
        name_ar: String(r.name_ar || r.name || ''), sector: String(r.sector || ''),
        current_price: Number(r.current_price) || 0,
        change_percent: Number(r.change_percent).toFixed(2),
        volume: Number(r.volume) || 0, rsi: r.rsi !== null ? Number(r.rsi) : null,
      })),
      most_active: mostActive.map(r => ({
        ticker: String(r.ticker), name: String(r.name || ''),
        name_ar: String(r.name_ar || r.name || ''), sector: String(r.sector || ''),
        current_price: Number(r.current_price) || 0,
        change_percent: Number(r.change_percent).toFixed(2),
        volume: Number(r.volume) || 0,
      })),
      volume_surge: volumeSurge.map(r => ({
        ticker: String(r.ticker), name: String(r.name || ''),
        name_ar: String(r.name_ar || r.name || ''), sector: String(r.sector || ''),
        current_price: Number(r.current_price) || 0,
        change_percent: Number(r.change_percent).toFixed(2),
        volume: Number(r.volume) || 0,
        avg_volume: Number(r.avg_volume) || 0,
        vol_ratio: Number(r.vol_ratio).toFixed(2),
      })),
      strongest_accumulators: strongestAccumulators,
      strongest_breakdowns: strongestBreakdowns,
      sector_heat: sectorHeat,
      top: topN,
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
  }
}
