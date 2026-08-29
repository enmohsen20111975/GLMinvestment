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
  avg_volume: number | null;
  // Computed fields (existing)
  above_ma_50?: boolean;
  above_ma_200?: boolean;
  distance_from_52w_high?: number | null;
  distance_from_52w_low?: number | null;
  momentum_score?: number;
  correction_status?: string;
  volume_surge?: boolean;
  // New computed fields (Phase 2-3 enhancement)
  relative_strength?: number;      // RS = stock change - market avg change
  stock_class?: string;             // above_sector / below_sector / sector_leader / sector_weak / breakout_candidate / correction_candidate / exhausted / advancing / lagging / stable / dangerous
  sector_change?: number | null;    // avg change of stock's sector
  sector_rank?: number | null;      // rank within sector (1 = best)
  market_role?: string;             // leader / lagger / neutral (vs market)
  state_label?: string;             // human-readable Arabic state label
  state_color?: string;             // tailwind color class for badge
}

/**
 * GET /api/stocks/screener
 *
 * Advanced screener — reads stocks.db directly (no Python backend needed).
 * Phase 2-3 enhancement: relative_strength + stock_class + sector_rank + state_label.
 *
 * Query params:
 *  - market: EGX | KSA | KUWAIT | QATAR (default: EGX)
 *  - sector: filter by sector (e.g., "Finance", "Real Estate")
 *  - sort: change_percent | volume | momentum | rsi | distance_52w_high | relative_strength | sector_rank
 *  - order: asc | desc
 *  - limit: max 500 (default: 100)
 *  - min_volume: minimum volume
 *  - min_change: minimum change_percent (absolute)
 *  - trend: up | down | neutral
 *  - above_ma: 50 | 200 | both
 *  - correction_status: oversold | overbought | breakout | in_correction | recovery | consolidation | distribution | advancing | lagging | stable | dangerous
 *  - stock_class: above_sector | below_sector | sector_leader | sector_weak | breakout_candidate | correction_candidate | exhausted | advancing | lagging | stable | dangerous
 *  - volume_surge_only: 1 (filter to volume_surge=true only)
 *  - min_relative_strength: minimum RS value
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
    const stockClass = searchParams.get('stock_class') || '';
    const volumeSurgeOnly = searchParams.get('volume_surge_only') === '1';
    const minRS = parseFloat(searchParams.get('min_relative_strength') || '0');

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
    } else if (trendFilter === 'neutral') {
      whereClauses.push('ABS(change_percent) < 0.5');
    }

    // SQL-sortable columns (others handled post-query)
    const sqlSortMap: Record<string, string> = {
      change_percent: 'change_percent',
      volume: 'volume',
      rsi: 'rsi',
      distance_52w_high: 'high_52w',
      market_cap: 'market_cap',
      pe_ratio: 'pe_ratio',
      momentum: 'change_percent', // fallback; real momentum is computed
      relative_strength: 'change_percent', // fallback; real RS is computed
      sector_rank: 'change_percent', // fallback; rank is computed
    };
    const sqlSortCol = sqlSortMap[sort] || 'change_percent';

    const whereSQL = whereClauses.join(' AND ');

    // Fetch up to limit*3 rows to allow post-query filtering + computed sorting
    const fetchLimit = Math.min(1500, limit * 3);

    const rows = db.prepare(`
      SELECT
        ticker, name, name_ar, market, sector,
        current_price, change_percent, volume, market_cap,
        pe_ratio, roe, ma_50, ma_200, rsi, trend, signal,
        beta, high_52w, low_52w, avg_volume
      FROM stocks
      WHERE ${whereSQL}
      ORDER BY ${sqlSortCol} ${order}
      LIMIT ?
    `).all(...params, fetchLimit) as Record<string, unknown>[];

    // Compute market average change (for relative_strength)
    const marketAvgRow = db.prepare(`
      SELECT AVG(change_percent) as avg_change, COUNT(*) as total
      FROM stocks
      WHERE is_active = 1 AND market = ? AND change_percent IS NOT NULL
    `).get(market) as { avg_change: number | null; total: number } | undefined;
    const marketAvgChange = marketAvgRow?.avg_change ?? 0;

    // Compute sector averages (for sector_change + sector_rank)
    const sectorAvgRows = db.prepare(`
      SELECT sector, AVG(change_percent) as avg_change, COUNT(*) as total
      FROM stocks
      WHERE is_active = 1 AND market = ? AND sector IS NOT NULL AND sector != '' AND change_percent IS NOT NULL
      GROUP BY sector
    `).all(market) as { sector: string; avg_change: number; total: number }[];
    const sectorAvgMap = new Map<string, number>();
    for (const r of sectorAvgRows) {
      sectorAvgMap.set(r.sector, r.avg_change);
    }

    db.close();

    // Compute derived fields + stock_class + state_label
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
      const sectorName = String(row.sector || '');

      // Distance from 52-week high/low (always ≤ 0 for high, ≥ 0 for low)
      const distFromHigh = high52 && high52 > 0 ? ((current - high52) / high52 * 100) : null;
      const distFromLow = low52 && low52 > 0 ? ((current - low52) / low52 * 100) : null;

      // Volume surge
      const volSurge = avgVol > 0 && vol > avgVol * 1.5;
      const volRatio = avgVol > 0 ? vol / avgVol : 1;

      // Momentum score (change% + above MAs + volume surge)
      let momentumScore = change;
      if (ma50 && current > ma50) momentumScore += 2;
      if (ma200 && current > ma200) momentumScore += 1;
      if (volSurge) momentumScore += 2;

      // Relative strength vs market
      const relativeStrength = change - marketAvgChange;

      // Sector change + rank (computed below in second pass)
      const sectorChange = sectorAvgMap.get(sectorName) ?? null;

      // === Correction status (FIXED logic — no more dead near_high/breakout) ===
      let correctionStatus = 'neutral';
      // Priority: oversold/overbought combined with distance, then correction stages
      if (rsi !== null && rsi < 30 && distFromHigh !== null && distFromHigh < -10) {
        correctionStatus = 'oversold'; // RSI<30 AND in deep correction
      } else if (rsi !== null && rsi > 70 && distFromHigh !== null && distFromHigh >= -3) {
        correctionStatus = 'overbought'; // RSI>70 AND near highs
      } else if (distFromHigh !== null && distFromHigh >= -2) {
        correctionStatus = 'breakout'; // within 2% of 52w high
      } else if (distFromHigh !== null && distFromHigh >= -5 && distFromHigh < -2) {
        correctionStatus = 'near_high'; // 2-5% below high
      } else if (distFromHigh !== null && distFromHigh < -15) {
        correctionStatus = 'in_correction'; // >15% below high
      } else if (distFromHigh !== null && distFromHigh < -10) {
        correctionStatus = 'pulling_back'; // 10-15% below high
      }

      // Override: recovery if was in correction but now rallying (change > +5% AND still below high)
      if (distFromHigh !== null && distFromHigh < -5 && change > 5) {
        correctionStatus = 'recovery';
      }
      // Consolidation: low volatility (|change| < 1) AND within 10% of high
      if (distFromHigh !== null && distFromHigh > -10 && Math.abs(change) < 1 && (rsi === null || (rsi >= 40 && rsi <= 60))) {
        correctionStatus = 'consolidation';
      }
      // Distribution: volume surge + price drop (sign of selling pressure)
      if (volSurge && change < -2) {
        correctionStatus = 'distribution';
      }
      // Advancing: strong change > +3% with volume
      if (change > 3 && volSurge) {
        correctionStatus = 'advancing';
      }
      // Lagging: change < market avg - 3% (underperforming)
      if (change < marketAvgChange - 3) {
        correctionStatus = 'lagging';
      }
      // Stable: |change| < 0.5 AND |distFromHigh| < 5
      if (Math.abs(change) < 0.5 && distFromHigh !== null && Math.abs(distFromHigh) < 5) {
        correctionStatus = 'stable';
      }
      // Dangerous: deep correction + distribution + volume surge (falling knife)
      if (distFromHigh !== null && distFromHigh < -15 && change < -3 && volSurge) {
        correctionStatus = 'dangerous';
      }

      // === Stock class (priority-ordered — first match wins) ===
      // Priority: dangerous > breakout > correction > exhausted > sector_leader > sector_weak > advancing > lagging > stable > above/below_sector > neutral
      let stockClass = 'neutral';
      if (correctionStatus === 'dangerous') stockClass = 'dangerous';
      else if (correctionStatus === 'breakout') stockClass = 'breakout_candidate';
      else if (correctionStatus === 'in_correction' || correctionStatus === 'recovery') stockClass = 'correction_candidate';
      else if (correctionStatus === 'overbought') stockClass = 'exhausted';
      else if (sectorChange !== null) {
        const sectorDelta = change - sectorChange;
        if (sectorDelta > 3 && change > 0) stockClass = 'sector_leader';
        else if (sectorDelta < -3 && change < 0) stockClass = 'sector_weak';
        else if (correctionStatus === 'advancing') stockClass = 'advancing';
        else if (correctionStatus === 'lagging') stockClass = 'lagging';
        else if (correctionStatus === 'stable') stockClass = 'stable';
        else if (sectorDelta > 0 && change > 0) stockClass = 'above_sector';
        else if (sectorDelta < 0 && change < 0) stockClass = 'below_sector';
      } else {
        // No sector data — use stage only
        if (correctionStatus === 'advancing') stockClass = 'advancing';
        else if (correctionStatus === 'lagging') stockClass = 'lagging';
        else if (correctionStatus === 'stable') stockClass = 'stable';
      }

      // === Market role (vs market avg) ===
      let marketRole = 'neutral';
      if (change > marketAvgChange + 2) marketRole = 'leader';
      else if (change < marketAvgChange - 2) marketRole = 'lagger';

      // === State label (Arabic) + color ===
      const stateMap: Record<string, { label: string; color: string }> = {
        breakout:           { label: 'اختراق جديد',       color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
        near_high:          { label: 'قرب القمة',          color: 'bg-green-100 text-green-700 border-green-300' },
        advancing:          { label: 'صعود قوي',          color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
        recovery:           { label: 'تعافي من تصحيح',    color: 'bg-teal-100 text-teal-700 border-teal-300' },
        consolidation:      { label: 'تجميع عرضي',        color: 'bg-slate-100 text-slate-700 border-slate-300' },
        stable:             { label: 'مستقر',              color: 'bg-slate-100 text-slate-700 border-slate-300' },
        pulling_back:       { label: 'تصحيح بسيط',         color: 'bg-amber-100 text-amber-700 border-amber-300' },
        in_correction:      { label: 'في تصحيح',           color: 'bg-orange-100 text-orange-700 border-orange-300' },
        distribution:       { label: 'توزيع (تصريف)',     color: 'bg-rose-100 text-rose-700 border-rose-300' },
        overbought:         { label: 'تشبع شرائي',         color: 'bg-rose-100 text-rose-700 border-rose-300' },
        oversold:           { label: 'تشبع بيعي',          color: 'bg-blue-100 text-blue-700 border-blue-300' },
        lagging:            { label: 'متأخر عن السوق',    color: 'bg-zinc-100 text-zinc-700 border-zinc-300' },
        dangerous:          { label: 'خطر (سقوط)',         color: 'bg-red-100 text-red-700 border-red-300' },
        neutral:            { label: 'محايد',              color: 'bg-gray-100 text-gray-700 border-gray-300' },
      };
      const stateInfo = stateMap[correctionStatus] || stateMap.neutral;

      return {
        ticker: String(row.ticker || ''),
        name: String(row.name || ''),
        name_ar: String(row.name_ar || row.name || ''),
        market: String(row.market || ''),
        sector: sectorName,
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
        avg_volume: avgVol,
        above_ma_50: ma50 ? current > ma50 : false,
        above_ma_200: ma200 ? current > ma200 : false,
        distance_from_52w_high: distFromHigh,
        distance_from_52w_low: distFromLow,
        momentum_score: Number(momentumScore.toFixed(2)),
        correction_status: correctionStatus,
        volume_surge: volSurge,
        // New fields
        relative_strength: Number(relativeStrength.toFixed(2)),
        stock_class: stockClass,
        sector_change: sectorChange !== null ? Number(sectorChange.toFixed(2)) : null,
        sector_rank: null, // filled in second pass
        market_role: marketRole,
        state_label: stateInfo.label,
        state_color: stateInfo.color,
      };
    });

    // Second pass: compute sector_rank (1 = best in sector)
    const bySector = new Map<string, ScreenerStock[]>();
    for (const s of stocks) {
      if (!s.sector) continue;
      if (!bySector.has(s.sector)) bySector.set(s.sector, []);
      bySector.get(s.sector)!.push(s);
    }
    for (const [sectorName, sectorStocks] of bySector) {
      // Sort by change_percent desc → rank 1 = best
      sectorStocks.sort((a, b) => (b.change_percent || 0) - (a.change_percent || 0));
      sectorStocks.forEach((s, idx) => {
        s.sector_rank = idx + 1;
      });
    }

    // Apply post-query filters (computed fields)
    let filtered = stocks;
    if (aboveMa === '50') filtered = filtered.filter(s => s.above_ma_50);
    else if (aboveMa === '200') filtered = filtered.filter(s => s.above_ma_200);
    else if (aboveMa === 'both') filtered = filtered.filter(s => s.above_ma_50 && s.above_ma_200);

    if (correctionStatus) {
      filtered = filtered.filter(s => s.correction_status === correctionStatus);
    }

    if (stockClass) {
      filtered = filtered.filter(s => s.stock_class === stockClass);
    }

    if (volumeSurgeOnly) {
      filtered = filtered.filter(s => s.volume_surge);
    }

    if (minRS > 0) {
      filtered = filtered.filter(s => (s.relative_strength || 0) >= minRS);
    }

    // Post-query sort for computed fields (momentum, relative_strength, sector_rank)
    if (sort === 'momentum') {
      filtered.sort((a, b) => order === 'DESC'
        ? (b.momentum_score || 0) - (a.momentum_score || 0)
        : (a.momentum_score || 0) - (b.momentum_score || 0));
    } else if (sort === 'relative_strength') {
      filtered.sort((a, b) => order === 'DESC'
        ? (b.relative_strength || 0) - (a.relative_strength || 0)
        : (a.relative_strength || 0) - (b.relative_strength || 0));
    } else if (sort === 'sector_rank') {
      filtered.sort((a, b) => order === 'DESC'
        ? (b.sector_rank || 999) - (a.sector_rank || 999)
        : (a.sector_rank || 999) - (b.sector_rank || 999));
    }

    // Trim to requested limit
    filtered = filtered.slice(0, limit);

    // Get sector list for filter dropdown
    const sectors = Array.from(sectorAvgMap.keys()).sort();

    return NextResponse.json({
      success: true,
      data: filtered,
      total: filtered.length,
      sectors,
      market_avg_change: Number(marketAvgChange.toFixed(2)),
      sector_averages: Object.fromEntries(
        Array.from(sectorAvgMap.entries()).map(([k, v]) => [k, Number(v.toFixed(2))])
      ),
      filters: {
        market, sector, sort, order: order.toLowerCase(), limit,
        min_volume: minVolume, min_change: minChange, trend: trendFilter,
        above_ma: aboveMa, correction_status: correctionStatus,
        stock_class: stockClass, volume_surge_only: volumeSurgeOnly,
        min_relative_strength: minRS,
      },
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
  }
}
