import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

const MARKET_NAMES: Record<string, string> = {
  EGX: 'البورصة المصرية',
  TADAWUL: 'تداول السعودية',
  KSE: 'بورصة الكويت',
  QSE: 'بورصة قطر',
  US: 'البورصة الأمريكية',
  CRYPTO: 'العملات الرقمية',
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = (url.searchParams.get('market') || 'EGX').toUpperCase();
  // FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #8: pagination params (Rule 56)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10), 1), 1000);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

  // 1) Try Python first
  try {
    const qs = url.searchParams.toString();
    const res = await fetch(`${PY}/api/market/overview${qs ? `?${qs}` : ''}`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2) Fallback — compute from stocks.db dynamically per market
  try {
    const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const db = new Database(dbPath, { readonly: true });

    // Get ALL stocks for this market (not just EGX)
    const marketMap: Record<string, string> = {
      EGX: 'EGX', TADAWUL: 'TADAWUL', KSA: 'TADAWUL', SAUDI: 'TADAWUL',
      KSE: 'KSE', KUWAIT: 'KSE',
      QSE: 'QSE', QATAR: 'QSE',
      US: 'US', NYSE: 'US', NASDAQ: 'US', AMERICA: 'US',
      CRYPTO: 'CRYPTO',
    };
    const dbMarket = marketMap[market] || market;

    // Check if stocks table has market column
    const tableInfo = db.prepare('PRAGMA table_info(stocks)').all() as Array<{ name: string }>;
    const colNames = new Set(tableInfo.map(c => c.name));
    const hasChangePercent = colNames.has('change_percent');
    const hasMarket = colNames.has('market');

    // Query stocks for this market — paginated (FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #8)
    let stocks: any[];
    let totalStocksCount: number;
    if (hasMarket) {
      const selectCols = [
        'ticker', 'name_ar', 'name', 'current_price', 'previous_close', 'volume', 'sector',
        ...(hasChangePercent ? ['change_percent'] : []),
      ].filter(c => colNames.has(c));
      totalStocksCount = (db.prepare(
        `SELECT COUNT(*) AS c FROM stocks WHERE market = ? COLLATE NOCASE`
      ).get(dbMarket) as { c: number }).c;
      stocks = db.prepare(
        `SELECT ${selectCols.join(', ')} FROM stocks WHERE market = ? COLLATE NOCASE ORDER BY volume DESC LIMIT ? OFFSET ?`
      ).all(dbMarket, limit, offset);
    } else {
      // No market column — return all (paginated)
      totalStocksCount = (db.prepare('SELECT COUNT(*) AS c FROM stocks').get() as { c: number }).c;
      stocks = db.prepare('SELECT ticker, name_ar, name, current_price, previous_close, volume, sector FROM stocks LIMIT ? OFFSET ?').all(limit, offset);
    }

    // Compute change_percent for each stock if missing
    const stocksWithChange = stocks.map((s: any) => {
      if (s.change_percent == null) {
        const cur = Number(s.current_price) || 0;
        const prev = Number(s.previous_close) || 0;
        s.change_percent = prev > 0 ? ((cur - prev) / prev) * 100 : 0;
      }
      return s;
    });

    // Market summary
    const advancing = stocksWithChange.filter(s => Number(s.change_percent) > 0).length;
    const declining = stocksWithChange.filter(s => Number(s.change_percent) < 0).length;
    const unchanged = stocksWithChange.length - advancing - declining;
    const totalVolume = stocksWithChange.reduce((sum, s) => sum + Number(s.volume || 0), 0);
    const totalTurnover = stocksWithChange.reduce((sum, s) => sum + (Number(s.current_price || 0) * Number(s.volume || 0)), 0);

    // Compute market index dynamically (average weighted by turnover)
    const validStocks = stocksWithChange.filter(s => Number(s.current_price) > 0 && Number(s.volume) > 0);
    let indexValue = 0;
    let indexChangePct = 0;
    if (validStocks.length > 0) {
      const totalWeight = validStocks.reduce((sum, s) => sum + (Number(s.current_price) * Number(s.volume)), 0);
      const weightedChange = validStocks.reduce((sum, s) => sum + (Number(s.change_percent) * Number(s.current_price) * Number(s.volume)), 0);
      indexChangePct = totalWeight > 0 ? weightedChange / totalWeight : 0;
      // Index value = average price * 100 (simple composite)
      indexValue = validStocks.reduce((sum, s) => sum + Number(s.current_price), 0) / validStocks.length;
    }

    // Try to get stored indices first (only for EGX)
    let indices: any[] = [];
    if (dbMarket === 'EGX') {
      try {
        const storedIndices = db.prepare('SELECT * FROM market_indices ORDER BY id ASC').all();
        indices = storedIndices.map((idx: any) => ({
          symbol: idx.symbol,
          name_ar: idx.name_ar,
          value: idx.current_value,
          previous_close: idx.previous_close,
          change: idx.change,
          change_percent: idx.change_percent,
        })).filter((idx: any) => idx.symbol && idx.symbol.includes('EGX'));
      } catch {}
    }

    // If no stored indices (non-EGX), use computed index
    if (indices.length === 0) {
      indices = [{
        symbol: `${dbMarket}_COMPOSITE`,
        name_ar: `مؤشر ${MARKET_NAMES[dbMarket] || dbMarket} المركّب`,
        value: indexValue,
        previous_close: indexValue / (1 + indexChangePct / 100),
        change: indexValue * indexChangePct / 100,
        change_percent: indexChangePct,
      }];
    }

    db.close();

    return NextResponse.json({
      success: true,
      market: dbMarket,
      market_name_ar: MARKET_NAMES[dbMarket] || dbMarket,
      summary: {
        total_stocks: stocksWithChange.length,
        total_stocks_in_market: totalStocksCount,
        advancing,
        declining,
        unchanged,
        total_volume: totalVolume,
        total_turnover: totalTurnover,
      },
      indices,
      top_stocks: stocksWithChange.slice(0, 10),
      stocks: stocksWithChange,
      pagination: { limit, offset, total: totalStocksCount },
      source: 'sqlite_dynamic',
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/market/overview] Error:', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}
