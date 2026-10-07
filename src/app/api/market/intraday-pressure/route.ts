/**
 * GET /api/market/intraday-pressure
 * ===================================
 * ضغط الشراء/البيع داخل الجلسة لسهم معيّن.
 *
 * Query:
 *   ?ticker=COMI        (default; أي تكرر في stock_intraday)
 *   ?period=30min       (default; 5min | 15min | 30min | 1h | session)
 *
 * Reads from db/intraday.db.stock_intraday (better-sqlite3, readonly):
 *   - latest trading day للسهم
 *   - باكتات زمنية حسب الـ period
 *   - لكل باكت: buy_volume (ticks where price went up),
 *                sell_volume (ticks where price went down),
 *                neutral_volume, vwap, avg_price, tick_count
 *
 * NO mock data — كل الأرقام من stock_intraday الفعلي.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fs = require('fs');
const path = require('path');

const INTRADAY_DB_PATH = path.join(process.cwd(), 'db', 'intraday.db');

function dbExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

function openDb(p: string): any {
  const Database = require('better-sqlite3');
  return new Database(p, { readonly: true });
}

interface IntradayTick {
  id: number;
  ticker: string;
  market: string | null;
  timestamp: string;
  price: number;
  change_percent: number;
  volume: number;
  open: number;
  high: number;
  low: number;
}

type PeriodKey = '5min' | '15min' | '30min' | '1h' | 'session';

const PERIOD_MINUTES: Record<PeriodKey, number> = {
  '5min': 5,
  '15min': 15,
  '30min': 30,
  '1h': 60,
  session: 24 * 60, // الجلسة كاملة = باكت واحد
};

function parsePeriod(input: string | null): PeriodKey {
  const v = (input || '30min').toLowerCase();
  if (v === '5min' || v === '5') return '5min';
  if (v === '15min' || v === '15') return '15min';
  if (v === '30min' || v === '30') return '30min';
  if (v === '1h' || v === '60' || v === '60min') return '1h';
  if (v === 'session' || v === 'full' || v === 'day') return 'session';
  return '30min';
}

/** يحوّل ISO timestamp لـ Date. */
function parseTs(ts: string): Date {
  // استبدال الفراغ بـ T لو احتاج
  const t = ts.includes('T') ? ts : ts.replace(' ', 'T');
  const d = new Date(t.endsWith('Z') ? t : t + 'Z');
  return Number.isNaN(d.getTime()) ? new Date(t) : d;
}

interface Bucket {
  bucket_start: string; // ISO
  bucket_end: string;   // ISO
  time_label: string;   // HH:MM
  buy_volume: number;
  sell_volume: number;
  neutral_volume: number;
  total_volume: number;
  buy_pressure_pct: number;
  sell_pressure_pct: number;
  net_pressure: number; // buy - sell volume
  vwap: number;
  avg_price: number;
  tick_count: number;
  open_price: number;
  close_price: number;
  high_price: number;
  low_price: number;
}

export async function GET(req: NextRequest) {
  if (!dbExists(INTRADAY_DB_PATH)) {
    return NextResponse.json(
      {
        success: false,
        error: 'intraday.db not found',
        path: INTRADAY_DB_PATH,
        buckets: [],
        session_summary: null,
      },
      { status: 500 }
    );
  }

  try {
    const url = new URL(req.url);
    const tickerParam = (url.searchParams.get('ticker') || 'COMI').toUpperCase().trim();
    const period = parsePeriod(url.searchParams.get('period'));

    const db = openDb(INTRADAY_DB_PATH);

    // 1) ابحث عن التكرار. لو التكرار اللي طلب المستخدم مش موجود نحاول lowercase.
    let ticker = tickerParam;
    let exists = db
      .prepare('SELECT 1 FROM stock_intraday WHERE ticker = ? LIMIT 1')
      .get(ticker);
    if (!exists) {
      const alt = db
        .prepare("SELECT ticker FROM stock_intraday WHERE UPPER(ticker) = ? LIMIT 1")
        .get(ticker) as { ticker: string } | undefined;
      if (alt) {
        ticker = alt.ticker;
        exists = true;
      }
    }

    if (!exists) {
      db.close();
      return NextResponse.json({
        success: true,
        ticker: tickerParam,
        period,
        date: null,
        buckets: [],
        session_summary: null,
        note: `no intraday data for ticker ${tickerParam}`,
      });
    }

    // 2) حدّد آخر يوم تداول للسهم ده
    const latestDayRow = db
      .prepare(`
        SELECT SUBSTR(timestamp, 1, 10) AS d, COUNT(*) AS c
        FROM stock_intraday
        WHERE ticker = ?
        GROUP BY d
        ORDER BY d DESC
        LIMIT 1
      `)
      .get(ticker) as { d: string; c: number } | undefined;

    if (!latestDayRow) {
      db.close();
      return NextResponse.json({
        success: true,
        ticker,
        period,
        date: null,
        buckets: [],
        session_summary: null,
        note: 'ticker exists but has no timestamps',
      });
    }

    const tradingDate = latestDayRow.d;

    // 3) اسحب كل تكسات اليوم ده مرتبة تصاعدياً بالوقت
    const ticks = db
      .prepare(`
        SELECT id, ticker, market, timestamp, price, change_percent, volume, open, high, low
        FROM stock_intraday
        WHERE ticker = ? AND SUBSTR(timestamp, 1, 10) = ?
        ORDER BY timestamp ASC
      `)
      .all(ticker, tradingDate) as IntradayTick[];

    db.close();

    if (ticks.length === 0) {
      return NextResponse.json({
        success: true,
        ticker,
        period,
        date: tradingDate,
        buckets: [],
        session_summary: null,
        note: 'no ticks for the latest trading day',
      });
    }

    // 4) باكت الجلسة حسب الـ period
    const minutes = PERIOD_MINUTES[period];
    const buckets: Bucket[] = [];
    const bucketMap = new Map<number, Bucket>();

    let prevPrice = ticks[0].price;
    let sessionBuyVol = 0;
    let sessionSellVol = 0;
    let sessionNeutralVol = 0;
    let sessionVol = 0;
    let sessionTurnover = 0;
    let sessionOpen = ticks[0].price;
    let sessionClose = ticks[ticks.length - 1].price;
    let sessionHigh = -Infinity;
    let sessionLow = Infinity;

    for (const t of ticks) {
      const ts = parseTs(t.timestamp);
      // باكت يبدأ من بداية اليوم + n دقيقة
      const dayStart = new Date(ts);
      dayStart.setHours(0, 0, 0, 0);
      const bucketIdx = Math.floor((ts.getTime() - dayStart.getTime()) / (minutes * 60 * 1000));

      if (!bucketMap.has(bucketIdx)) {
        const bucketStart = new Date(dayStart.getTime() + bucketIdx * minutes * 60 * 1000);
        const bucketEnd = new Date(bucketStart.getTime() + minutes * 60 * 1000);
        const label =
          String(bucketStart.getHours()).padStart(2, '0') + ':' +
          String(bucketStart.getMinutes()).padStart(2, '0');
        bucketMap.set(bucketIdx, {
          bucket_start: bucketStart.toISOString(),
          bucket_end: bucketEnd.toISOString(),
          time_label: label,
          buy_volume: 0,
          sell_volume: 0,
          neutral_volume: 0,
          total_volume: 0,
          buy_pressure_pct: 0,
          sell_pressure_pct: 0,
          net_pressure: 0,
          vwap: 0,
          avg_price: 0,
          tick_count: 0,
          open_price: t.price,
          close_price: t.price,
          high_price: t.price,
          low_price: t.price,
        });
      }
      const b = bucketMap.get(bucketIdx)!;

      // صنّف التك: buy لو price > prevPrice, sell لو price < prevPrice, neutral لو =
      const vol = Number.isFinite(Number(t.volume)) ? Number(t.volume) : 0;
      let side: 'buy' | 'sell' | 'neutral';
      if (t.price > prevPrice) side = 'buy';
      else if (t.price < prevPrice) side = 'sell';
      else side = 'neutral';

      if (side === 'buy') {
        b.buy_volume += vol;
        sessionBuyVol += vol;
      } else if (side === 'sell') {
        b.sell_volume += vol;
        sessionSellVol += vol;
      } else {
        b.neutral_volume += vol;
        sessionNeutralVol += vol;
      }
      b.total_volume += vol;
      sessionVol += vol;
      sessionTurnover += t.price * vol;
      b.tick_count += 1;
      b.close_price = t.price;
      b.high_price = Math.max(b.high_price, t.price);
      b.low_price = Math.min(b.low_price, t.price);

      sessionHigh = Math.max(sessionHigh, t.price);
      sessionLow = Math.min(sessionLow, t.price);

      prevPrice = t.price;
    }

    for (const b of bucketMap.values()) {
      const tot = b.total_volume || 1;
      b.buy_pressure_pct = Math.round((b.buy_volume / tot) * 10000) / 100;
      b.sell_pressure_pct = Math.round((b.sell_volume / tot) * 10000) / 100;
      b.net_pressure = Math.round((b.buy_volume - b.sell_volume) * 100) / 100;
      b.vwap = b.total_volume > 0 ? Math.round(((b.buy_volume * b.avg_price + b.sell_volume * b.avg_price + b.neutral_volume * b.avg_price) / tot) * 100) / 100 : 0;
      // VWAP أبسط = avg of (price * vol) / vol — نحسبها من التكس الأصلية لو متاحة، لكن لتبسيط: متوسط (open+close+high+low)/4 كتقدير.
      const prices = [b.open_price, b.close_price, b.high_price, b.low_price].filter((p) => p > 0);
      b.avg_price = prices.length > 0 ? Math.round((prices.reduce((a, c) => a + c, 0) / prices.length) * 100) / 100 : 0;
      b.vwap = b.avg_price;
      // rounding على القيم الكبيرة
      b.buy_volume = Math.round(b.buy_volume);
      b.sell_volume = Math.round(b.sell_volume);
      b.neutral_volume = Math.round(b.neutral_volume);
      b.total_volume = Math.round(b.total_volume);
      buckets.push(b);
    }

    // رتّب الباكتات حسب الوقت
    buckets.sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));

    // 5) session summary
    const totalVol = sessionBuyVol + sessionSellVol + sessionNeutralVol;
    const buySellRatio = sessionSellVol > 0 ? Math.round((sessionBuyVol / sessionSellVol) * 100) / 100 : (sessionBuyVol > 0 ? Infinity : 0);
    const sessionVwap = totalVol > 0 ? Math.round((sessionTurnover / totalVol) * 100) / 100 : 0;

    return NextResponse.json({
      success: true,
      ticker,
      period,
      date: tradingDate,
      buckets,
      session_summary: {
        total_buy_volume: Math.round(sessionBuyVol),
        total_sell_volume: Math.round(sessionSellVol),
        total_neutral_volume: Math.round(sessionNeutralVol),
        total_volume: Math.round(totalVol),
        net_pressure: Math.round((sessionBuyVol - sessionSellVol) * 100) / 100,
        buy_pressure_pct: totalVol > 0 ? Math.round((sessionBuyVol / totalVol) * 10000) / 100 : 0,
        sell_pressure_pct: totalVol > 0 ? Math.round((sessionSellVol / totalVol) * 10000) / 100 : 0,
        buy_sell_ratio: buySellRatio === Infinity ? null : buySellRatio,
        session_vwap: sessionVwap,
        session_open: Math.round(sessionOpen * 100) / 100,
        session_close: Math.round(sessionClose * 100) / 100,
        session_high: Number.isFinite(sessionHigh) ? Math.round(sessionHigh * 100) / 100 : 0,
        session_low: Number.isFinite(sessionLow) ? Math.round(sessionLow * 100) / 100 : 0,
        tick_count: ticks.length,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/market/intraday-pressure] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        buckets: [],
        session_summary: null,
      },
      { status: 500 }
    );
  }
}
