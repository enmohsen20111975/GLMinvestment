import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


const Database = require('better-sqlite3');
const path = require('path');

function getDataEngineDb() {
  const dbPath = path.join(process.cwd(), 'db', 'data_engine.db');
  return new Database(dbPath);
}

// Parse percentage values
function parsePercent(value: string | null): number {
  if (!value) return 0;
  const cleaned = value.replace('%', '').replace('−', '-').replace(',', '');
  return parseFloat(cleaned) || 0;
}

// Parse ratio values
function parseRatio(value: string | null): number {
  if (!value) return 0;
  const cleaned = value.replace(',', '').replace('−', '-');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  // Filter parameters
  const market = searchParams.get('market') || 'all';
  const peLt = searchParams.get('pe_lt') ? parseFloat(searchParams.get('pe_lt')!) : null;
  const peGt = searchParams.get('pe_gt') ? parseFloat(searchParams.get('pe_gt')!) : null;
  const roeGt = searchParams.get('roe_gt') ? parseFloat(searchParams.get('roe_gt')!) : null;
  const divYieldGt = searchParams.get('div_yield_gt') ? parseFloat(searchParams.get('div_yield_gt')!) : null;
  const technicalRating = searchParams.get('technical_rating') || null;
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    const db = getDataEngineDb();

    // Build query with filters
    let whereConditions: string[] = [];
    whereConditions.push(`ta.symbol NOT IN ('السعودية', 'مصر', 'الكويت', 'قطر', 'بيع', 'بيع قوي', 'حيادية', 'شراء', 'شراء قوي')`);

    // Market filter
    if (market !== 'all') {
      const marketMap: Record<string, string> = {
        'eg': 'مصر',
        'sa': 'السعودية',
        'kw': 'الكويت',
        'qa': 'قطر'
      };
      whereConditions.push(`ta.market = '${marketMap[market] || market}'`);
    }

    // Technical rating filter
    if (technicalRating) {
      if (technicalRating === 'شراء_قوي') {
        whereConditions.push(`ta.technical_rating LIKE '%شراء قوي%'`);
      } else if (technicalRating === 'شراء') {
        whereConditions.push(`ta.technical_rating LIKE '%شراء%'`);
      } else if (technicalRating === 'بيع_قوي') {
        whereConditions.push(`ta.technical_rating LIKE '%بيع قوي%'`);
      } else if (technicalRating === 'بيع') {
        whereConditions.push(`ta.technical_rating LIKE '%بيع%'`);
      }
    }

    const whereClause = whereConditions.join(' AND ');

    // Main query
    const query = `
      SELECT 
        ta.symbol,
        ta.market,
        ta.technical_rating,
        ta.ma_rating,
        v.pe_ratio,
        v.pb_ratio,
        v.ps_ratio,
        v.market_cap,
        p.roe,
        p.roa,
        p.net_margin,
        p.operating_margin,
        perf.price,
        perf.perf_1w,
        perf.perf_1m,
        perf.perf_3m,
        perf.perf_6m,
        perf.perf_1y,
        d.div_yield,
        d.dps_ttm
      FROM tab_technical_analysis ta
      LEFT JOIN tab_valuation v ON ta.symbol = v.symbol AND ta.market = v.market
      LEFT JOIN tab_profitability p ON ta.symbol = p.symbol AND ta.market = p.market
      LEFT JOIN tab_performance perf ON ta.symbol = perf.symbol AND ta.market = perf.market
      LEFT JOIN tab_dividends d ON ta.symbol = d.symbol AND ta.market = d.market
      WHERE ${whereClause}
      ORDER BY ta.market, ta.symbol
      LIMIT ? OFFSET ?
    `;

    let stocks = db.prepare(query).all(limit, offset);

    // Apply numeric filters in JavaScript (since data is stored as strings)
    stocks = stocks.filter((stock: any) => {
      const peRatio = parseRatio(stock.pe_ratio);
      const roe = parsePercent(stock.roe);
      const divYield = parsePercent(stock.div_yield);

      // P/E filter
      if (peLt !== null && (peRatio <= 0 || peRatio >= peLt)) return false;
      if (peGt !== null && (peRatio <= 0 || peRatio <= peGt)) return false;

      // ROE filter
      if (roeGt !== null && roe < roeGt) return false;

      // Dividend yield filter
      if (divYieldGt !== null && divYield < divYieldGt) return false;

      return true;
    });

    // Process and format results
    const results = stocks.map((stock: any) => ({
      symbol: stock.symbol,
      market: stock.market,
      price: stock.price,
      technicalRating: stock.technical_rating,
      maRating: stock.ma_rating,
      valuation: {
        peRatio: parseRatio(stock.pe_ratio) || null,
        pbRatio: parseRatio(stock.pb_ratio) || null,
        psRatio: parseRatio(stock.ps_ratio) || null,
        marketCap: stock.market_cap
      },
      profitability: {
        roe: parsePercent(stock.roe) || null,
        roa: parsePercent(stock.roa) || null,
        netMargin: parsePercent(stock.net_margin) || null,
        operatingMargin: parsePercent(stock.operating_margin) || null
      },
      performance: {
        perf1w: stock.perf_1w,
        perf1m: stock.perf_1m,
        perf3m: stock.perf_3m,
        perf6m: stock.perf_6m,
        perf1y: stock.perf_1y
      },
      dividend: {
        yield: parsePercent(stock.div_yield) || null,
        dps: stock.dps_ttm
      }
    }));

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM tab_technical_analysis ta
      WHERE ${whereClause}
    `;
    const totalCount = db.prepare(countQuery).get() as { total: number };

    db.close();

    return NextResponse.json({
      success: true,
      data: results,
      pagination: {
        total: totalCount.total,
        limit,
        offset,
        hasMore: totalCount.total > offset + limit
      },
      filters: {
        market,
        peLt,
        peGt,
        roeGt,
        divYieldGt,
        technicalRating
      }
    });

  } catch (error) {
    console.error('Screener Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to screen stocks',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Get available filter options
export async function POST(request: NextRequest) {
  try {
    const db = getDataEngineDb();

    // Get distinct markets
    const markets = db.prepare(`
      SELECT DISTINCT market, COUNT(*) as count
      FROM tab_technical_analysis
      WHERE symbol NOT IN ('السعودية', 'مصر', 'الكويت', 'قطر', 'بيع', 'بيع قوي', 'حيادية', 'شراء', 'شراء قوي')
      GROUP BY market
    `).all();

    // Get distinct technical ratings
    const ratings = db.prepare(`
      SELECT DISTINCT technical_rating, COUNT(*) as count
      FROM tab_technical_analysis
      WHERE symbol NOT IN ('السعودية', 'مصر', 'الكويت', 'قطر', 'بيع', 'بيع قوي', 'حيادية', 'شراء', 'شراء قوي')
      GROUP BY technical_rating
      ORDER BY count DESC
    `).all();

    // Get P/E range
    const peRange = db.prepare(`
      SELECT 
        MIN(CAST(REPLACE(pe_ratio, ',', '.') AS REAL)) as min_pe,
        MAX(CAST(REPLACE(pe_ratio, ',', '.') AS REAL)) as max_pe
      FROM tab_valuation
      WHERE pe_ratio IS NOT NULL AND pe_ratio != ''
    `).get() as { min_pe: number; max_pe: number };

    // Get ROE range
    const roeRange = db.prepare(`
      SELECT 
        MIN(CAST(REPLACE(REPLACE(roe, '%', ''), '−', '-') AS REAL)) as min_roe,
        MAX(CAST(REPLACE(REPLACE(roe, '%', ''), '−', '-') AS REAL)) as max_roe
      FROM tab_profitability
      WHERE roe IS NOT NULL AND roe != ''
    `).get() as { min_roe: number; max_roe: number };

    db.close();

    return NextResponse.json({
      success: true,
      filterOptions: {
        markets,
        ratings,
        ranges: {
          peRatio: {
            min: Math.round(peRange.min_pe * 10) / 10,
            max: Math.round(peRange.max_pe * 10) / 10
          },
          roe: {
            min: Math.round(roeRange.min_roe * 10) / 10,
            max: Math.round(roeRange.max_roe * 10) / 10
          }
        }
      }
    });

  } catch (error) {
    console.error('Screener Options Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to get filter options'
    }, { status: 500 });
  }
}
