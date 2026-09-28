import { NextRequest, NextResponse } from 'next/server';
import {
  getRadarDb,
  getRadarDbConfig,
  parseVolume,
  computeTurnover,
  type RadarDbConfig,
} from '@/modules/radar/lib/radar-db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/maker-radar/footprint?ticker=COMI&days=30
 *
 * Liquidity Footprint — Volume Profile by Price Level (Market Profile).
 *
 * Algorithm:
 *   1. Fetch last N OHLCV bars for ticker from radar DB.
 *   2. Bin the [min_low, max_high] price range into ~15-20 evenly spaced levels.
 *   3. For each bar, distribute its volume across the price levels it overlaps
 *      using proportional split (overlap / bar_range). If bar_range == 0,
 *      attribute all volume to the close-price level.
 *   4. Per bar: classify as bullish (close>open), bearish (close<open) or flat,
 *      attribute 70/30 (or 50/50 if flat) to buy / sell volume on each touched level.
 *   5. Compute POC (highest-volume level), VAH & VAL (value-area boundaries
 *      that contain 70% of total volume, expanding outward from POC).
 *   6. Sort levels descending by price.
 */

const MIN_BINS = 15;
const MAX_BINS = 20;
const MIN_DATA_POINTS = 5;
const VALUE_AREA_PCT = 0.70;

interface PriceRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

interface FootprintLevel {
  price_low: number;
  price_high: number;
  price_mid: number;
  volume: number;
  buy_volume: number;
  sell_volume: number;
  delta: number;
  volume_pct: number;
  is_poc: boolean;
  is_value_area: boolean;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase().trim();
  const daysParam = parseInt(url.searchParams.get('days') || '30', 10);
  const days = isNaN(daysParam) || daysParam < 1 ? 30 : Math.min(daysParam, 365);

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker query param is required' },
      { status: 400 }
    );
  }

  const cfg = getRadarDbConfig();
  const db = getRadarDb();
  if (!cfg || !db) {
    return NextResponse.json(
      {
        success: false,
        error:
          'لا تتوفر قاعدة بيانات الرادار — تأكد من وجود db/data_engine.db أو db/stocks.db',
      },
      { status: 503 }
    );
  }

  try {
    const bars = fetchBars(db, cfg, ticker, days);

    if (bars.length < MIN_DATA_POINTS) {
      db.close();
      return NextResponse.json({
        success: false,
        error: `بيانات غير كافية للسهم ${ticker} — تم العثور على ${bars.length} جلسة فقط (المطلوب ${MIN_DATA_POINTS} على الأقل)`,
        ticker,
        days,
        data_points: bars.length,
      });
    }

    const result = computeFootprint(bars, ticker, days);
    db.close();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[maker-radar/footprint] error:', error);
    try { db.close(); } catch {}
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fetchBars(
  db: any,
  cfg: RadarDbConfig,
  ticker: string,
  days: number
): PriceRow[] {
  const cols = `${cfg.dateCol}, ${cfg.openCol} AS open, ${cfg.highCol} AS high, ${cfg.lowCol} AS low, ${cfg.priceCol} AS close, ${cfg.volumeCol} AS volume`;
  const turnoverSelect = cfg.turnoverCol
    ? `, ${cfg.turnoverCol} AS turnover`
    : `, NULL AS turnover`;
  const rows = db
    .prepare(
      `SELECT ${cols}${turnoverSelect}
       FROM ${cfg.table}
       WHERE ${cfg.tickerCol} = ?
         AND ${cfg.priceCol} IS NOT NULL
         AND ${cfg.priceCol} > 0
       ORDER BY ${cfg.dateCol} DESC
       LIMIT ?`
    )
    .all(ticker, days) as any[];

  return rows.reverse().map((r) => ({
    date: String(r[cfg.dateCol]),
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    close: num(r.close),
    volume: parseVolume(r.volume),
    turnover: computeTurnover(r, cfg),
  }));
}

function computeFootprint(bars: PriceRow[], ticker: string, days: number) {
  // ── 1. Determine price range ───────────────────────────────────────────
  const allLows = bars.map((b) => b.low).filter((v) => v > 0);
  const allHighs = bars.map((b) => b.high).filter((v) => v > 0);
  const priceMin = allLows.length > 0 ? Math.min(...allLows) : 0;
  const priceMax = allHighs.length > 0 ? Math.max(...allHighs) : 0;

  // Edge: zero range (all prices equal)
  if (priceMax <= priceMin) {
    // Single-bin degenerate case
    const totalVol = bars.reduce((s, b) => s + b.volume, 0);
    const buyVol = bars.reduce(
      (s, b) =>
        s +
        (b.close > b.open ? 0.7 : b.close < b.open ? 0.3 : 0.5) * b.volume,
      0
    );
    const sellVol = totalVol - buyVol;
    const mid = round2(priceMin);
    return {
      success: true,
      ticker,
      days,
      bin_count: 1,
      price_min: mid,
      price_max: mid,
      poc_price: mid,
      poc_volume: Math.round(totalVol),
      vah_price: mid,
      val_price: mid,
      value_area_volume_pct: 100,
      total_volume: Math.round(totalVol),
      buy_volume: Math.round(buyVol),
      sell_volume: Math.round(sellVol),
      delta_volume: Math.round(buyVol - sellVol),
      buy_sell_ratio: round2(sellVol > 0 ? buyVol / sellVol : 0),
      levels: [
        {
          price_low: mid,
          price_high: mid,
          price_mid: mid,
          volume: Math.round(totalVol),
          buy_volume: Math.round(buyVol),
          sell_volume: Math.round(sellVol),
          delta: Math.round(buyVol - sellVol),
          volume_pct: 100,
          is_poc: true,
          is_value_area: true,
        },
      ],
      computed_at: new Date().toISOString(),
    };
  }

  // ── 2. Build bins ─────────────────────────────────────────────────────
  const range = priceMax - priceMin;
  // Target 15-20 bins. Default to 18 — clamp to [MIN_BINS, MAX_BINS].
  let binCount = Math.max(MIN_BINS, Math.min(MAX_BINS, 18));
  if (binCount > MAX_BINS) binCount = MAX_BINS;
  if (binCount < MIN_BINS) binCount = MIN_BINS;

  const binStep = range / binCount;
  const bins: {
    price_low: number;
    price_high: number;
    price_mid: number;
    volume: number;
    buy_volume: number;
    sell_volume: number;
  }[] = [];
  for (let i = 0; i < binCount; i++) {
    const lo = priceMin + i * binStep;
    const hi = i === binCount - 1 ? priceMax : priceMin + (i + 1) * binStep;
    bins.push({
      price_low: lo,
      price_high: hi,
      price_mid: (lo + hi) / 2,
      volume: 0,
      buy_volume: 0,
      sell_volume: 0,
    });
  }

  // Helper: which bin index does a price fall into?
  const binIndexForPrice = (p: number): number => {
    if (p <= priceMin) return 0;
    if (p >= priceMax) return binCount - 1;
    return Math.min(binCount - 1, Math.floor((p - priceMin) / binStep));
  };

  // ── 3. Distribute each bar's volume across bins ──────────────────────
  for (const bar of bars) {
    const v = bar.volume;
    if (v <= 0) continue;
    // Determine buy/sell split based on bar direction
    let buyShare: number;
    let sellShare: number;
    if (bar.close > bar.open) {
      buyShare = 0.7;
      sellShare = 0.3;
    } else if (bar.close < bar.open) {
      buyShare = 0.3;
      sellShare = 0.7;
    } else {
      buyShare = 0.5;
      sellShare = 0.5;
    }
    const barLow = Math.min(bar.low, bar.high);
    const barHigh = Math.max(bar.low, bar.high);
    const barRange = barHigh - barLow;

    if (barRange <= 0) {
      // Degenerate bar — attribute all volume to the close-price bin
      const idx = binIndexForPrice(bar.close);
      bins[idx].volume += v;
      bins[idx].buy_volume += v * buyShare;
      bins[idx].sell_volume += v * sellShare;
      continue;
    }

    // Iterate over every bin that overlaps [barLow, barHigh]
    const firstIdx = binIndexForPrice(barLow);
    const lastIdx = binIndexForPrice(barHigh);
    for (let i = firstIdx; i <= lastIdx; i++) {
      const binLo = bins[i].price_low;
      const binHi = bins[i].price_high;
      // Overlap of [barLow, barHigh] with [binLo, binHi]
      const overlapLow = Math.max(barLow, binLo);
      const overlapHigh = Math.min(barHigh, binHi);
      const overlap = Math.max(0, overlapHigh - overlapLow);
      if (overlap <= 0) continue;
      const share = overlap / barRange;
      const distributedVol = v * share;
      bins[i].volume += distributedVol;
      bins[i].buy_volume += distributedVol * buyShare;
      bins[i].sell_volume += distributedVol * sellShare;
    }
  }

  // ── 4. Compute POC (max-volume bin) ──────────────────────────────────
  let pocIdx = 0;
  let maxVol = -1;
  for (let i = 0; i < bins.length; i++) {
    if (bins[i].volume > maxVol) {
      maxVol = bins[i].volume;
      pocIdx = i;
    }
  }

  const totalVolume = bins.reduce((s, b) => s + b.volume, 0);
  const totalBuy = bins.reduce((s, b) => s + b.buy_volume, 0);
  const totalSell = bins.reduce((s, b) => s + b.sell_volume, 0);

  // ── 5. Compute Value Area (70% of total volume around POC) ──────────
  // Expand outward from POC, picking the side with the higher adjacent volume
  // (standard market profile technique), until 70% of total volume is enclosed.
  const valueAreaTarget = totalVolume * VALUE_AREA_PCT;
  let valueAreaVol = bins[pocIdx].volume;
  let valIdx = pocIdx;
  let vahIdx = pocIdx;
  let lowCanExpand = pocIdx > 0;
  let highCanExpand = pocIdx < bins.length - 1;
  let safety = bins.length * 2;
  while (
    valueAreaVol < valueAreaTarget &&
    (lowCanExpand || highCanExpand) &&
    safety-- > 0
  ) {
    const lowVol = lowCanExpand ? bins[valIdx - 1].volume : -1;
    const highVol = highCanExpand ? bins[vahIdx + 1].volume : -1;
    if (highVol >= lowVol && highCanExpand) {
      vahIdx++;
      valueAreaVol += bins[vahIdx].volume;
      if (vahIdx >= bins.length - 1) highCanExpand = false;
    } else if (lowCanExpand) {
      valIdx--;
      valueAreaVol += bins[valIdx].volume;
      if (valIdx <= 0) lowCanExpand = false;
    } else {
      break;
    }
  }

  // ── 6. Build level objects (descending by price) ─────────────────────
  const levels: FootprintLevel[] = bins
    .map((b, i) => {
      const volPct = totalVolume > 0 ? (b.volume / totalVolume) * 100 : 0;
      const inValueArea = i >= valIdx && i <= vahIdx;
      return {
        price_low: round2(b.price_low),
        price_high: round2(b.price_high),
        price_mid: round2(b.price_mid),
        volume: Math.round(b.volume),
        buy_volume: Math.round(b.buy_volume),
        sell_volume: Math.round(b.sell_volume),
        delta: Math.round(b.buy_volume - b.sell_volume),
        volume_pct: round1(volPct),
        is_poc: i === pocIdx,
        is_value_area: inValueArea,
      };
    })
    .reverse(); // descending by price (highest first)

  const valueAreaVolumePct =
    totalVolume > 0 ? round1((valueAreaVol / totalVolume) * 100) : 0;

  return {
    success: true,
    ticker,
    days,
    bin_count: binCount,
    price_min: round2(priceMin),
    price_max: round2(priceMax),
    poc_price: round2(bins[pocIdx].price_mid),
    poc_volume: Math.round(bins[pocIdx].volume),
    vah_price: round2(bins[vahIdx].price_mid),
    val_price: round2(bins[valIdx].price_mid),
    value_area_volume_pct: valueAreaVolumePct,
    total_volume: Math.round(totalVolume),
    buy_volume: Math.round(totalBuy),
    sell_volume: Math.round(totalSell),
    delta_volume: Math.round(totalBuy - totalSell),
    buy_sell_ratio: round2(totalSell > 0 ? totalBuy / totalSell : 0),
    levels,
    computed_at: new Date().toISOString(),
  };
}

function num(v: any): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
