import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { existsSync } from 'fs';

export const revalidate = 0; // No cache - always fresh data
export const dynamic = 'force-dynamic';

interface ChartDataPoint {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

/**
 * Fetch chart data from local databases (stocks.db stock_daily_prices first,
 * then price_history.db as fallback)
 */
function getLocalChartData(ticker: string, period: string): ChartDataPoint[] | null {
  const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
  const priceHistoryPath = path.join(process.cwd(), 'db', 'price_history.db');

  // Determine lookback limit based on period
  const periodLimitMap: Record<string, number> = {
    '1d': 1, '5d': 5, '1w': 7, '2w': 14, '1m': 30, '3m': 90,
    '6m': 180, '1y': 365, '2y': 730, '5y': 1825, 'max': 10000,
  };
  const limit = periodLimitMap[period] || 30;

  // FIX (July 2026): Try stock_daily_prices FIRST (has clean EODHD data).
  // price_history.db has stale/corrupted data from old sources.
  // EODHD backfill writes to stock_daily_prices with clean OHLCV data.

  // 1. Try stock_daily_prices (clean EODHD data — updated by EODHDFetcher)
  if (existsSync(stocksDbPath)) {
    try {
      const db = new Database(stocksDbPath, { readonly: true, timeout: 5000 });
      db.pragma('busy_timeout = 5000');

      const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_daily_prices'").get();
      if (tableInfo) {
        const rows = db.prepare(`
          SELECT price_date, open, high, low, close, volume
          FROM stock_daily_prices
          WHERE ticker = ?
          ORDER BY price_date DESC
          LIMIT ?
        `).all(ticker, limit) as { price_date: string; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null }[];

        db.close();

        if (rows && rows.length > 0) {
          return rows
            .map(r => ({
              date: r.price_date,
              open: r.open,
              high: r.high,
              low: r.low,
              close: r.close,
              volume: r.volume,
            }))
            .reverse();
        }
      }
      db.close();
    } catch (e) {
      console.warn(`[chart] stock_daily_prices query failed for ${ticker}:`, e);
    }
  }

  // 2. Fallback to price_history.db (may have older data)
  if (existsSync(priceHistoryPath)) {
    try {
      const db = new Database(priceHistoryPath, { readonly: true, timeout: 5000 });
      db.pragma('busy_timeout = 5000');

      const rows = db.prepare(`
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history
        WHERE ticker = ?
        ORDER BY date DESC
        LIMIT ?
      `).all(ticker, limit) as { date: string; open_price: number | null; high_price: number | null; low_price: number | null; close_price: number | null; volume: number | null }[];

      db.close();

      if (rows && rows.length > 0) {
        return rows
          .map(r => ({
            date: r.date,
            open: r.open_price,
            high: r.high_price,
            low: r.low_price,
            close: r.close_price,
            volume: r.volume,
          }))
          .reverse(); // chronological order
      }
    } catch (e) {
      console.warn(`[chart] price_history query failed for ${ticker}:`, e);
    }
  }

  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const searchParams = request.nextUrl.searchParams;
  const period = searchParams.get('period') || '1w';
  const asset = searchParams.get('asset') || '';

  // V2.3: للـ period=1d أو 1w أو 1m، نستخدم Python backend مباشرة (intraday 15 دقيقة محدّثة)
  // مش local DB (اللي بياناتها daily و قديمة)
  const isIntradayPeriod = period === '1d' || period === '1w' || period === '1m';

  if (!isIntradayPeriod) {
    // للـ periods الكبيرة (1m, 3m, 1y, ...) — جرّب local DB الأول
    const localData = getLocalChartData(ticker, period);
    if (localData && localData.length > 0) {
      // P35 CHART-FINAL-FIX: normalize ALL timestamps to UNIX int + drop null OHLC.
      // getLocalChartData returns {date: 'yyyy-mm-dd', open, high, low, close, volume}
      // where date is a STRING. lightweight-charts requires numeric time, so we
      // convert every date to UNIX seconds and filter out any null/NaN candle.
      const sanitized = localData
        .map((d) => {
          const rawTs = (d as any).timestamp ?? (d as any).date ?? (d as any).time;
          let unixTs = 0;
          if (typeof rawTs === 'number') {
            unixTs = rawTs > 1e12 ? Math.floor(rawTs / 1000) : Math.floor(rawTs);
          } else if (typeof rawTs === 'string') {
            const s = rawTs.trim();
            const asNum = Number(s);
            if (!isNaN(asNum) && /^\d+(\.\d+)?$/.test(s)) {
              unixTs = asNum > 1e12 ? Math.floor(asNum / 1000) : Math.floor(asNum);
            } else {
              const parsed = Date.parse(s.replace(' ', 'T'));
              unixTs = isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
            }
          }
          return {
            ...d,
            timestamp: unixTs,
            date: unixTs, // AdvancedStockChart reads `date`
          } as ChartDataPoint & { timestamp: number; date: number };
        })
        .filter(
          (d) =>
            d.timestamp > 0 &&
            d.open !== null && d.open !== undefined &&
            d.high !== null && d.high !== undefined &&
            d.low !== null && d.low !== undefined &&
            d.close !== null && d.close !== undefined
        );
      if (sanitized.length > 0) {
        return NextResponse.json({
          success: true,
          ticker,
          period,
          asset: asset || 'stock',
          data: sanitized,
          source: 'local_db',
        });
      }
    }
  }

  // Fallback to Python backend (intraday for 1d/1w, daily for larger periods)
  const pythonUrl = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';
  const qs = new URLSearchParams({ period });
  if (asset) qs.set('asset', asset);

  try {
    const response = await fetch(
      `${pythonUrl}/api/chart/${encodeURIComponent(ticker)}?${qs.toString()}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      // ANTI-SILENT-FALLBACK: For intraday periods (1d/1w), never mask the error
      // by returning daily data. Surface a clear error so the chart shows it.
      if (isIntradayPeriod) {
        return NextResponse.json(
          {
            success: false,
            ticker,
            period,
            asset: asset || 'stock',
            error: `NO_INTRADAY_DATA_AVAILABLE: Python backend returned ${response.status}`,
            source: 'none',
          },
          { status: 502 }
        );
      }
      return NextResponse.json(
        { success: false, error: `Python backend returned ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    // ANTI-SILENT-FALLBACK: For intraday periods, if Python returned success but empty data,
    // return explicit error instead of empty array (so frontend doesn't fall back to daily)
    if (isIntradayPeriod && (!data.data || data.data.length === 0)) {
      return NextResponse.json({
        success: false,
        ticker,
        period,
        asset: asset || 'stock',
        error: data.error || 'NO_INTRADAY_DATA_AVAILABLE',
        message: `محرك البيانات لم يجلب بيانات الـ 15 دقيقة للسهم ${ticker}`,
        source: 'none',
      });
    }
    // ANTI-GAP-056: Normalize all timestamps to UNIX seconds (int) for lightweight-charts.
    // lightweight-charts requires numeric time; if Python sent ISO strings, convert them.
    if (data.data && Array.isArray(data.data)) {
      data.data = data.data.map((d: any) => {
        const rawTs = d.timestamp ?? d.date ?? d.time;
        let unixTs: number;
        if (rawTs === null || rawTs === undefined) {
          unixTs = 0;
        } else if (typeof rawTs === 'number') {
          unixTs = rawTs;
        } else {
          const s = String(rawTs).trim();
          // Already a numeric string?
          const asNum = Number(s);
          if (!isNaN(asNum) && /^\d+(\.\d+)?$/.test(s)) {
            unixTs = Math.floor(asNum);
          } else {
            const parsed = Date.parse(s.replace(' ', 'T'));
            unixTs = isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
          }
        }
        return {
          ...d,
          timestamp: unixTs,
          date: unixTs,  // AdvancedStockChart reads `date`
        };
      });
    }
    return NextResponse.json(data);
  } catch (error: any) {
    // ANTI-SILENT-FALLBACK: For intraday periods, surface the connection error clearly
    // so the chart displays it instead of silently falling back to daily candles.
    if (isIntradayPeriod) {
      return NextResponse.json({
        success: false,
        ticker,
        period,
        asset: asset || 'stock',
        error: `DATA_ENGINE_UNREACHABLE: ${error?.message || 'unknown'}`,
        message: 'تعذر الاتصال بمحرك البيانات (Python backend على المنفذ 8010) لجلب بيانات الـ Intraday',
        source: 'none',
      });
    }
    // For non-intraday periods, return empty with explanation
    return NextResponse.json({
      success: false,
      ticker,
      period,
      asset: asset || 'stock',
      data: [],
      error: 'لا توجد بيانات لهذا الرمز في المصادر المحلية أو الخلفية',
      details: error?.message,
      source: 'none',
    });
  }
}