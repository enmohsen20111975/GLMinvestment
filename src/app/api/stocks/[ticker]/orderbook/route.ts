/**
 * GET /api/stocks/[symbol]/orderbook
 * =================================
 * Flutter compat endpoint — orderbook السهم.
 *
 * - لو فيه بيانات orderbook حقيقية في data_engine.db (مثل order_book table) → رجعها.
 * - غير كده رجع empty OrderBook {bids: [], asks: [], spread: 0, last_price: <current_price>}.
 *
 * مهم: لا يُرجع mock data إطلاقاً. الـ Flutter app بيتعامل مع empty OrderBook
 * بشكل صحيح (عن طريق OrderBook.empty).
 *
 * ممكن ييجي يوم نقدر نجيب orderbook حقيقي من EGX feed — ده الـ structure الجاهز ليه.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDataEngineDb, getStockBySymbol } from '@/lib/data-engine-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface OrderBookEntry {
  price: number;
  volume: number;
  orders?: number;
  side: 'bid' | 'ask';
}

interface OrderBookResponse {
  symbol: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  spread: number;
  last_price: number;
  timestamp: string;
  source: string;
}

function tableExists(db: ReturnType<typeof getDataEngineDb>, tableName: string): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
      .get(tableName) as { name?: string } | undefined;
    return !!row?.name;
  } catch {
    return false;
  }
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ابحث عن orderbook في الجداول المحتملة:
 *   - order_book
 *   - orderbook
 *   - stock_orders
 *   - depth
 */
function tryFetchOrderBook(
  db: ReturnType<typeof getDataEngineDb>,
  symbol: string
): { bids: OrderBookEntry[]; asks: OrderBookEntry[]; source: string } | null {
  const candidateTables = ['order_book', 'orderbook', 'stock_orders', 'depth', 'market_depth'];

  for (const table of candidateTables) {
    if (!tableExists(db, table)) continue;
    try {
      // نمط شائع: ticker/symbol, side, price, volume, orders
      // نجرّب columns مختلفة بـ PRAGMA table_info
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      const colNames = cols.map(c => c.name.toLowerCase());

      const symCol = colNames.includes('ticker') ? 'ticker'
        : colNames.includes('symbol') ? 'symbol'
        : colNames.includes('stock') ? 'stock'
        : null;

      const sideCol = colNames.includes('side') ? 'side'
        : colNames.includes('type') ? 'type'
        : colNames.includes('bid_ask') ? 'bid_ask'
        : null;

      const priceCol = colNames.includes('price') ? 'price'
        : colNames.includes('limit_price') ? 'limit_price'
        : null;

      const volCol = colNames.includes('volume') ? 'volume'
        : colNames.includes('qty') ? 'qty'
        : colNames.includes('quantity') ? 'quantity'
        : colNames.includes('size') ? 'size'
        : null;

      if (!symCol || !sideCol || !priceCol || !volCol) continue;

      const rows = db.prepare(`
        SELECT ${sideCol} AS side, ${priceCol} AS price, ${volCol} AS volume
        FROM ${table}
        WHERE ${symCol} = ?
        ORDER BY ${priceCol} DESC
        LIMIT 100
      `).all(symbol) as Array<{ side: string | number; price: unknown; volume: unknown }>;

      if (rows.length === 0) continue;

      const bids: OrderBookEntry[] = [];
      const asks: OrderBookEntry[] = [];
      for (const r of rows) {
        const sideStr = String(r.side).toLowerCase();
        const price = safeNum(r.price);
        const volume = safeNum(r.volume);
        if (price <= 0 || volume <= 0) continue;
        const entry: OrderBookEntry = { price, volume, side: sideStr === 'bid' || sideStr === 'buy' || sideStr === '0' ? 'bid' : 'ask' };
        if (entry.side === 'bid') bids.push(entry);
        else asks.push(entry);
      }

      if (bids.length === 0 && asks.length === 0) continue;

      // رتّب: bids تنازلي (أعلى سعر أولاً)، asks تصاعدي (أقل سعر أولاً)
      bids.sort((a, b) => b.price - a.price);
      asks.sort((a, b) => a.price - b.price);

      return { bids, asks, source: `data_engine.db.${table}` };
    } catch (e) {
      console.warn(`[orderbook] ${table} query failed:`, e);
      continue;
    }
  }

  return null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ ticker?: string; symbol?: string }> }) {
  const resolved = await params;
  const rawSymbol = resolved.ticker || resolved.symbol || '';
  const symbol = rawSymbol.toUpperCase().trim();

  try {
    // السعر الحالي من stocks table
    let lastPrice = 0;
    try {
      const stock = getStockBySymbol(symbol);
      if (stock?.price != null) lastPrice = safeNum(stock.price);
    } catch {
      /* ignore */
    }

    const emptyBook: OrderBookResponse = {
      symbol,
      bids: [],
      asks: [],
      spread: 0,
      last_price: lastPrice,
      timestamp: new Date().toISOString(),
      source: 'empty',
    };

    // حاول تفتح data_engine.db وتبحث عن جدول orderbook
    let db: ReturnType<typeof getDataEngineDb>;
    try {
      db = getDataEngineDb();
    } catch {
      // مفيش DB → empty book مع السعر لو موجود
      return NextResponse.json({
        success: true,
        ...emptyBook,
        note: 'data_engine.db unavailable — returning empty orderbook',
      });
    }

    const realBook = tryFetchOrderBook(db, symbol);
    if (realBook && (realBook.bids.length > 0 || realBook.asks.length > 0)) {
      const bestBid = realBook.bids[0]?.price ?? 0;
      const bestAsk = realBook.asks[0]?.price ?? 0;
      const spread = bestBid > 0 && bestAsk > 0 ? Math.round((bestAsk - bestBid) * 10000) / 10000 : 0;

      return NextResponse.json({
        success: true,
        symbol,
        bids: realBook.bids,
        asks: realBook.asks,
        spread,
        last_price: lastPrice,
        best_bid: bestBid || null,
        best_ask: bestAsk || null,
        timestamp: new Date().toISOString(),
        source: realBook.source,
      });
    }

    // مفيش orderbook حقيقي → empty
    return NextResponse.json({
      success: true,
      ...emptyBook,
      note: 'No real orderbook data available for this symbol',
    });
  } catch (e) {
    console.error(`[GET /api/stocks/${symbol}/orderbook] Error:`, e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        symbol,
        bids: [],
        asks: [],
        spread: 0,
        last_price: 0,
      },
      { status: 500 }
    );
  }
}
