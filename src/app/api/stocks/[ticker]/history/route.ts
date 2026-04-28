import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getStockByTicker, getPriceHistory } from '@/lib/egx-db';
import { checkAndAutoSeed } from '@/lib/seed-historical-data';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    await ensureInitialized();
    const { ticker } = await params;
    const { searchParams } = new URL(request.url);
    const days = searchParams.get('days') ? parseInt(searchParams.get('days')!, 10) : 90;

    // Get stock first to obtain stock_id
    const stock = getStockByTicker(ticker);
    if (!stock) {
      return NextResponse.json(
        { error: 'Stock not found', detail: `No stock found with ticker: ${ticker}` },
        { status: 404 }
      );
    }

    // Get price history for the stock
    let history = getPriceHistory(Number(stock.id), days);

    // إذا كانت البيانات التاريخية فارغة — حاول البذر التلقائي
    if (history.length === 0) {
      console.log(`[GET /api/stocks/:ticker/history] No history for ${ticker}, attempting auto-seed...`);
      try {
        const seedResult = await checkAndAutoSeed();
        if (seedResult.seeded) {
          console.log(`[GET /api/stocks/:ticker/history] Auto-seed completed: ${seedResult.rows} rows inserted`);
          // إعادة محاولة جلب البيانات بعد البذر
          history = getPriceHistory(Number(stock.id), days);
        }
      } catch (seedErr) {
        console.warn('[GET /api/stocks/:ticker/history] Auto-seed failed:', seedErr);
      }
    }

    // Calculate summary statistics
    const closes = history.map((h: Record<string, unknown>) => Number(h.close_price));
    const volumes = history.map((h: Record<string, unknown>) => Number(h.volume));
    const highs = history.map((h: Record<string, unknown>) => Number(h.high_price));
    const lows = history.map((h: Record<string, unknown>) => Number(h.low_price));

    const highest = closes.length > 0 ? Math.max(...highs) : 0;
    const lowest = closes.length > 0 ? Math.min(...lows) : 0;
    const avgPrice = closes.length > 0
      ? closes.reduce((sum, c) => sum + c, 0) / closes.length
      : 0;
    const totalVolume = volumes.length > 0
      ? volumes.reduce((sum, v) => sum + v, 0)
      : 0;
    const startPrice = closes.length > 0 ? closes[0] : 0;
    const endPrice = closes.length > 0 ? closes[closes.length - 1] : 0;
    const changePercent = startPrice > 0
      ? ((endPrice - startPrice) / startPrice) * 100
      : 0;

     // Format price history data points - use close_price, open_price etc from DB
     const data = history.map((h: Record<string, unknown>) => {
       const dateStr = String(h.date || '');
       // Extract just the date part (YYYY-MM-DD) from the datetime string
       const dateOnly = dateStr.split('T')[0].split(' ')[0];
       return {
         date: dateOnly,
         open: Number(h.open_price),
         high: Number(h.high_price),
         low: Number(h.low_price),
         close: Number(h.close_price),
         volume: Number(h.volume),
       };
     });

     // Calculate RSI(14) for investment analysis
     const calculateRSI = (prices: number[], period: number = 14): (number | null)[] => {
       if (prices.length < period + 1) return Array(prices.length).fill(null);
       const gains: number[] = [];
       const losses: number[] = [];
       for (let i = 1; i < prices.length; i++) {
         const change = prices[i] - prices[i-1];
         gains.push(change > 0 ? change : 0);
         losses.push(change < 0 ? Math.abs(change) : 0);
       }
       const rsiValues: (number | null)[] = Array(prices.length).fill(null);
       for (let i = period - 1; i < prices.length; i++) {
         const avgGain = gains.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
         const avgLoss = losses.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
         const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
         rsiValues[i] = 100 - (100 / (1 + rs));
       }
       return rsiValues;
     };

     const closePrices = data.map(d => d.close);
     const rsiValues = calculateRSI(closePrices, 14);

     // Attach RSI to data points for tooltip
     data.forEach((d, idx) => {
       (d as any).rsi = rsiValues[idx];
     });

     return NextResponse.json(
      {
        success: true,
        ticker: stock.ticker,
        data,
        summary: {
          highest: Number(highest.toFixed(2)),
          lowest: Number(lowest.toFixed(2)),
          avg_price: Number(avgPrice.toFixed(2)),
          total_volume: Number(totalVolume),
          start_price: Number(startPrice.toFixed(2)),
          end_price: Number(endPrice.toFixed(2)),
          change_percent: Number(changePercent.toFixed(2)),
        },
        days,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, s-maxage=0',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      }
    );
  } catch (error) {
    console.error(`[GET /api/stocks/:ticker/history] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch price history', detail: String(error) },
      { status: 500 }
    );
  }
}
