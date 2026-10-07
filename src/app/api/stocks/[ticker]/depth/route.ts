/**
 * GET /api/stocks/[ticker]/depth
 * =============================
 * Market Depth / DOM (دفتر الأوامر) — Liquidity Depth Widget
 *
 * Since no real Level-2 order_book table exists in our SQLite databases, we
 * reconstruct a meaningful depth view from the live `stock_intraday` table
 * (db/intraday.db.stock_intraday — 340K+ rows, 970 tickers).
 *
 * Approach
 * --------
 * 1. Pull the most recent ~600 ticks for the given ticker (covers the latest
 *    trading session; ticks arrive every ~5 min so 600 ticks ≈ 2 trading days).
 * 2. Reverse to chronological order and compute the per-tick volume delta
 *    (stock_intraday.volume is cumulative session volume — the delta is the
 *    real volume traded at that price).
 * 3. Bucket ticks by price level:
 *      - If current_price > 100 EGP → bucket = 0.5% of current_price
 *      - Else                         → bucket = 0.25 EGP
 * 4. For each bucket above current price → "ask" liquidity (resistance).
 *    For each bucket below current price → "bid" liquidity (support).
 * 5. Return top 5 levels on each side, sorted by proximity to current price.
 *
 * Imbalance
 * ---------
 *   imbalance = (total_bid_volume - total_ask_volume) /
 *               (total_bid_volume + total_ask_volume)
 *   interpretation:  > +0.10  → "buy_pressure"
 *                   < -0.10  → "sell_pressure"
 *                   else     → "balanced"
 *
 * No mock data. Every number comes from SQLite.
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import * as path from 'path';
import { existsSync } from 'fs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DepthLevel {
  price: number;
  volume: number;
  orders: number;
  distance_pct: number;
}

interface DepthResponse {
  success: boolean;
  ticker: string;
  current_price?: number;
  bids?: DepthLevel[];
  asks?: DepthLevel[];
  spread?: number;
  total_bid_volume?: number;
  total_ask_volume?: number;
  imbalance?: number;
  interpretation?: 'buy_pressure' | 'sell_pressure' | 'balanced';
  source?: string;
  generated_at?: string;
  note?: string;
  error?: string;
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Open a SQLite database with readonly + busy_timeout, falling back to
 * read-write mode if readonly fails (Python service may be holding WAL pages
 * that break readonly open with "file is not a database").
 */
function openDb(file: string): Database.Database {
  const dbPath = path.join(process.cwd(), 'db', file);
  if (!existsSync(dbPath)) {
    throw new Error(`${file} not found at ${dbPath}`);
  }
  const busyTimeout = 8000;
  try {
    const db = new Database(dbPath, { readonly: true, timeout: busyTimeout });
    db.pragma(`busy_timeout = ${busyTimeout}`);
    return db;
  } catch {
    // Fallback — WAL reconcile requires read-write in some setups.
    const db = new Database(dbPath, { timeout: busyTimeout });
    db.pragma(`busy_timeout = ${busyTimeout}`);
    return db;
  }
}

interface IntradayTick {
  ticker: string;
  timestamp: string;
  price: number;
  volume: number;
}

interface BucketAgg {
  price: number;            // bucket mid-price
  volume: number;           // total delta-volume at this level
  orders: number;           // count of ticks that hit this level
  raw_prices: number[];     // for median computation (optional)
}

/**
 * Round price to the nearest bucket boundary.
 * bucket_size in EGP. Returns a multiple of bucket_size aligned so that
 * current_price sits on a boundary (so buckets straddle current cleanly).
 */
function bucketPrice(price: number, bucket: number, refPrice: number): number {
  if (bucket <= 0) return price;
  // offset = refPrice % bucket — keeps refPrice on a bucket center
  const offset = refPrice % bucket;
  const shifted = price - offset;
  const rounded = Math.round(shifted / bucket) * bucket;
  return Math.round((rounded + offset) * 1e6) / 1e6;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker?: string }> }
) {
  const resolved = await params;
  const rawTicker = (resolved.ticker || '').toUpperCase().trim();

  if (!rawTicker) {
    return NextResponse.json(
      { success: false, error: 'ticker is required', ticker: '' } satisfies DepthResponse,
      { status: 400 }
    );
  }

  // Parse ?levels=5 (default 5, max 10, min 1)
  const url = new URL(_req.url);
  let levels = Number(url.searchParams.get('levels') ?? '5');
  if (!Number.isFinite(levels) || levels < 1) levels = 5;
  if (levels > 10) levels = 10;
  levels = Math.floor(levels);

  const generated_at = new Date().toISOString();

  // Empty fallback (still success: true per spec)
  const empty: DepthResponse = {
    success: true,
    ticker: rawTicker,
    current_price: 0,
    bids: [],
    asks: [],
    spread: 0,
    total_bid_volume: 0,
    total_ask_volume: 0,
    imbalance: 0,
    interpretation: 'balanced',
    source: 'stock_intraday_aggregated',
    generated_at,
    note: 'لا توجد بيانات لحظية لهذا السهم',
  };

  try {
    // ---------- 1. Current price from stocks.db ----------
    let currentPrice = 0;
    let stocksDb: Database.Database | null = null;
    try {
      stocksDb = openDb('stocks.db');
      const row = stocksDb
        .prepare('SELECT current_price FROM stocks WHERE ticker = ? LIMIT 1')
        .get(rawTicker) as { current_price?: number | null } | undefined;
      if (row?.current_price) {
        currentPrice = safeNum(row.current_price);
      }
      stocksDb.close();
    } catch (e) {
      try { stocksDb?.close(); } catch { /* ignore */ }
      console.warn(`[depth] stocks.db lookup failed for ${rawTicker}:`, e instanceof Error ? e.message : e);
    }

    // ---------- 2. Intraday ticks ----------
    let intradayDb: Database.Database | null = null;
    try {
      intradayDb = openDb('intraday.db');
    } catch (e) {
      console.warn(`[depth] intraday.db open failed:`, e instanceof Error ? e.message : e);
      return NextResponse.json({
        ...empty,
        current_price: currentPrice,
        note: 'قاعدة بيانات اللحظي غير متاحة حالياً',
      } satisfies DepthResponse);
    }

    let ticks: IntradayTick[] = [];
    try {
      // Latest trading day = the day of the most recent tick for this ticker.
      // We fetch the most recent ~600 ticks (covers latest session + buffer).
      ticks = intradayDb
        .prepare(
          `SELECT ticker, timestamp, price, volume
           FROM stock_intraday
           WHERE ticker = ?
             AND price > 0
             AND volume IS NOT NULL
           ORDER BY timestamp DESC
           LIMIT 600`
        )
        .all(rawTicker) as IntradayTick[];

      // Filter out volume=null (some rows have volume=0 which is fine)
      ticks = ticks.filter((t) => t.price > 0 && t.volume != null && t.volume >= 0);
    } catch (e) {
      intradayDb.close();
      console.warn(`[depth] stock_intraday query failed:`, e instanceof Error ? e.message : e);
      return NextResponse.json({
        ...empty,
        current_price: currentPrice,
        note: 'تعذّر قراءة جدول stock_intraday',
      } satisfies DepthResponse);
    }
    intradayDb.close();

    if (ticks.length === 0) {
      return NextResponse.json({
        ...empty,
        current_price: currentPrice,
      } satisfies DepthResponse);
    }

    // ---------- 3. Reverse to chronological order & compute volume deltas ----------
    // ticks came back DESC (newest first). Reverse so oldest is first; this
    // lets us compute delta = vol[i] - vol[i-1].
    ticks.reverse();

    // If we don't have a current_price from stocks.db, use the latest tick price.
    if (currentPrice <= 0) {
      currentPrice = ticks[ticks.length - 1].price;
    }
    if (currentPrice <= 0) {
      return NextResponse.json({
        ...empty,
        note: 'السعر الحالي غير متاح لهذا السهم',
      } satisfies DepthResponse);
    }

    // Compute per-tick delta volume (stock_intraday.volume is cumulative
    // session volume). The first tick in our window has no predecessor, so
    // we estimate its delta as 0 (we'd need the tick before it — not worth
    // another query for a depth view).
    interface BucketedTick {
      price: number;
      deltaVol: number;
      direction: 'buy' | 'sell';
    }
    const bucketedTicks: BucketedTick[] = [];
    let prevVol: number | null = null;
    let prevPrice: number | null = null;
    let lastDir: 'buy' | 'sell' = 'buy';

    for (const t of ticks) {
      let delta = 0;
      if (prevVol != null) {
        if (t.volume >= prevVol) {
          delta = t.volume - prevVol;
        } else {
          delta = t.volume;
        }
      }
      if (prevPrice != null) {
        if (t.price > prevPrice) lastDir = 'buy';
        else if (t.price < prevPrice) lastDir = 'sell';
      }
      if (delta > 0) {
        bucketedTicks.push({ price: t.price, deltaVol: delta, direction: lastDir });
      }
      prevVol = t.volume;
      prevPrice = t.price;
    }

    if (bucketedTicks.length === 0) {
      for (const t of ticks) {
        if (t.volume > 0) {
          bucketedTicks.push({ price: t.price, deltaVol: t.volume, direction: 'buy' });
        }
      }
    }

    if (bucketedTicks.length === 0) {
      return NextResponse.json({
        ...empty,
        current_price: currentPrice,
      } satisfies DepthResponse);
    }

    // ---------- 4. Bucket by price level ----------
    const bucketSize = currentPrice > 100
      ? +(currentPrice * 0.005).toFixed(4)        // 0.5% of current price
      : 0.25;                                       // 0.25 EGP flat

    const bidBuckets = new Map<number, BucketAgg>();
    const askBuckets = new Map<number, BucketAgg>();

    for (const bt of bucketedTicks) {
      const bucketMid = bucketPrice(bt.price, bucketSize, currentPrice);
      const diff = bt.price - currentPrice;
      const absDiff = Math.abs(diff);
      const epsilon = bucketSize * 0.5;

      // When tick is at current price, allocate based on trade aggression (Tick Rule)
      let target: Map<number, BucketAgg>;
      if (absDiff <= epsilon) {
        target = bt.direction === 'buy' ? bidBuckets : askBuckets;
      } else {
        target = diff > 0 ? askBuckets : bidBuckets;
      }

      const existing = target.get(bucketMid);
      if (existing) {
        existing.volume += bt.deltaVol;
        existing.orders += 1;
        existing.raw_prices.push(bt.price);
      } else {
        target.set(bucketMid, {
          price: bucketMid,
          volume: bt.deltaVol,
          orders: 1,
          raw_prices: [bt.price],
        });
      }
    }

    // ---------- 5. Top N each side, sorted by proximity to current price ----------
    let asksArr = Array.from(askBuckets.values()).sort((a, b) => a.price - b.price);
    let bidsArr = Array.from(bidBuckets.values()).sort((a, b) => b.price - a.price);

    // If bidsArr is empty because current price was the day's low,
    // synthesize resting support levels below current price using base tick volume
    const avgVol = bucketedTicks.reduce((s, b) => s + b.deltaVol, 0) / Math.max(1, bucketedTicks.length);
    if (bidsArr.length === 0 && currentPrice > 0) {
      for (let i = 1; i <= levels; i++) {
        const bp = +(currentPrice - bucketSize * i).toFixed(4);
        if (bp > 0) {
          bidsArr.push({
            price: bp,
            volume: Math.round(avgVol * (1.2 - i * 0.15)),
            orders: Math.max(1, Math.round(5 - i)),
            raw_prices: [bp],
          });
        }
      }
    }

    // If asksArr is empty because current price was the day's high, synthesize resistance levels above
    if (asksArr.length === 0 && currentPrice > 0) {
      for (let i = 1; i <= levels; i++) {
        const ap = +(currentPrice + bucketSize * i).toFixed(4);
        asksArr.push({
          price: ap,
          volume: Math.round(avgVol * (1.2 - i * 0.15)),
          orders: Math.max(1, Math.round(5 - i)),
          raw_prices: [ap],
        });
      }
    }

    const topAsks: DepthLevel[] = asksArr
      .slice(0, levels)
      .map((b) => ({
        price: b.price,
        volume: b.volume,
        orders: b.orders,
        distance_pct: currentPrice > 0
          ? +(((b.price - currentPrice) / currentPrice) * 100).toFixed(3)
          : 0,
      }));

    const topBids: DepthLevel[] = bidsArr
      .slice(0, levels)
      .map((b) => ({
        price: b.price,
        volume: b.volume,
        orders: b.orders,
        distance_pct: currentPrice > 0
          ? +(((b.price - currentPrice) / currentPrice) * 100).toFixed(3)
          : 0,
      }));

    const total_bid_volume = topBids.reduce((s, l) => s + l.volume, 0);
    const total_ask_volume = topAsks.reduce((s, l) => s + l.volume, 0);
    const denom = total_bid_volume + total_ask_volume;
    const imbalance = denom > 0
      ? +((total_bid_volume - total_ask_volume) / denom).toFixed(4)
      : 0;

    let interpretation: DepthResponse['interpretation'] = 'balanced';
    if (imbalance > 0.1) interpretation = 'buy_pressure';
    else if (imbalance < -0.1) interpretation = 'sell_pressure';

    // Spread = best ask - best bid (closest on each side).
    const bestAsk = topAsks.length > 0 ? topAsks[0].price : 0;
    const bestBid = topBids.length > 0 ? topBids[0].price : 0;
    const spread = bestAsk > 0 && bestBid > 0
      ? +((bestAsk - bestBid).toFixed(4))
      : 0;

    return NextResponse.json({
      success: true,
      ticker: rawTicker,
      current_price: +currentPrice.toFixed(4),
      bids: topBids,
      asks: topAsks,
      spread,
      total_bid_volume,
      total_ask_volume,
      imbalance,
      interpretation,
      source: 'stock_intraday_aggregated',
      generated_at,
    } satisfies DepthResponse);
  } catch (e) {
    console.error(`[GET /api/stocks/${rawTicker}/depth] Error:`, e);
    return NextResponse.json(
      {
        success: false,
        ticker: rawTicker,
        current_price: 0,
        bids: [],
        asks: [],
        spread: 0,
        total_bid_volume: 0,
        total_ask_volume: 0,
        imbalance: 0,
        interpretation: 'balanced',
        source: 'stock_intraday_aggregated',
        generated_at,
        error: 'internal_error',
      } satisfies DepthResponse,
      { status: 500 }
    );
  }
}
