<<<<<<< HEAD
/**
 * GET /api/stocks/[ticker]/publish-data
 * ==================================================
 *
 * يجمع كل البيانات المبعثرة المطلوبة لنشر سهم في response واحد
 * (StockPublishData JSON) — جاهزة للـ StockPublisher component.
 *
 * مصادر البيانات:
 *   1. stocks.db.stocks           → basic info + fundamentals (fallback)
 *   2. predictions.db.predictions → آخر توقّع للسهم (recommendation/entry/target/stop)
 *   3. radar cache (maker_radar)  → liquidity + signal_count + path (إن وُجد)
 *   4. price_history (radar-db)   → آخر 60 يوم لحساب RSI/SMA/ATR
 *
 * الـ endpoint يحاول Python backend أولاً ثم يقع على SQLite fallback
 * (نفس النمط المتّبع في باقي /api/stocks/[ticker]/* routes).
 *
 * Response shape:
 *   {
 *     success: true,
 *     source: 'python' | 'sqlite_fallback' | 'sqlite_fallback_basic',
 *     data: StockPublishData,
 *     errors: string[]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import {
  getStockByTickerFallback,
} from '@/lib/flutter-sqlite-fallback';
import {
  getRadarDb,
  getRadarDbConfig,
  parseVolume,
  computeTurnover,
} from '@/modules/radar/lib/radar-db';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const MAX_HISTORY_DAYS = 60; // نقرأ 60 يوم ونحسب منها RSI(14) + SMA(20,50)

// ============================================================================
// Helpers — numerical
// ============================================================================

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safe(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// RSI(14) — Wilder's smoothing
function computeRSI(closes: number[], period = 14): number | undefined {
  if (closes.length < period + 1) return undefined;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function sma(values: number[], period: number): number | undefined {
  if (values.length < period) return undefined;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number | undefined {
  if (closes.length < period + 1) return undefined;
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i] ?? 0;
    const l = lows[i] ?? 0;
    const pc = closes[i - 1] ?? 0;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  return sma(trs, period);
}

// ============================================================================
// Source 1 — Python backend (best quality if available)
// ============================================================================

async function fetchPythonPublishData(
  tickerUpper: string,
  market: string
): Promise<Record<string, unknown> | null> {
  const targetUrl = `${PYTHON_BACKEND_URL}/api/stocks/${tickerUpper}/publish-data?market=${encodeURIComponent(market)}`;
  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json && (json.success === true || json.data)) {
      return (json.data as Record<string, unknown>) || (json as Record<string, unknown>);
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Source 2 — predictions.db → latest prediction row
// ============================================================================

interface PredictionRow {
  ticker: string;
  signal?: string;
  signal_type?: string;
  signal_ar?: string;
  prediction_date?: string;
  entry_price?: number | null;
  target_price?: number | null;
  stop_loss?: number | null;
  master_score?: number | null;
  technical_score?: number | null;
  fundamental_score?: number | null;
  risk_reward?: number | null;
  persona?: string;
  status?: string;
  horizon?: string;
  direction?: string;
  confidence?: number | null;
  [key: string]: unknown;
}

function fetchLatestPrediction(ticker: string): PredictionRow | null {
  const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
  if (!existsSync(dbPath)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, timeout: 3000 });
    const row = db
      .prepare(
        `SELECT ticker, signal, signal_type, signal_ar, prediction_date,
                entry_price, target_price, stop_loss, master_score,
                technical_score, fundamental_score, risk_reward,
                persona, status, horizon, direction, confidence
         FROM predictions
         WHERE ticker = ? COLLATE NOCASE
         ORDER BY prediction_date DESC, created_at DESC
         LIMIT 1`
      )
      .get(ticker.toUpperCase()) as PredictionRow | undefined;
    return row || null;
  } catch {
    return null;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        /* noop */
      }
    }
  }
}

// Map a prediction.signal ('BUY', 'STRONG_BUY', 'SELL', 'HOLD', ...)
// to the StockPublishData.recommendation union.
function mapSignalToRecommendation(
  signal: string | undefined
): 'BUY' | 'STRONG_BUY' | 'SELL' | 'HOLD' | 'INSTITUTIONAL_BUY' | undefined {
  if (!signal) return undefined;
  const s = String(signal).toUpperCase().trim();
  if (s.includes('STRONG') && s.includes('BUY')) return 'STRONG_BUY';
  if (s.includes('INST') && s.includes('BUY')) return 'INSTITUTIONAL_BUY';
  if (s.includes('BUY') || s.includes('ACCUMULATE')) return 'BUY';
  if (s.includes('SELL') || s.includes('REDUCE') || s.includes('AVOID')) return 'SELL';
  if (s.includes('HOLD') || s.includes('WAIT') || s.includes('NEUTRAL')) return 'HOLD';
  return undefined;
}

// ============================================================================
// Source 3 — radar cache (maker_radar list) — find ticker in any path
// ============================================================================

interface RadarStock {
  ticker: string;
  current_price: number;
  volume_ratio_10d_vs_20d?: number;
  buy_pct?: number;
  net_flow_egp?: number;
  maker_activity?: string;
  position_size: number;
  reason: string;
  path?: string;
  pre_surge_details?: { signal_count?: number; signals_met?: string[] } | null;
  quiet_details?: { signal_count?: number; signals_met?: string[] } | null;
  explosive_details?: { vol_ratio?: number } | null;
  [key: string]: unknown;
}

async function fetchRadarEntryAsync(
  tickerUpper: string
): Promise<RadarStock | null> {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.SELF_BASE_URL ||
    'http://localhost:3001';
  try {
    const res = await fetch(`${baseUrl}/api/maker-radar?market=EGX`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      quiet_list?: RadarStock[];
      pre_surge_list?: RadarStock[];
      explosive_list?: RadarStock[];
      early_break_list?: RadarStock[];
    };
    const all = [
      ...(json.quiet_list || []),
      ...(json.pre_surge_list || []),
      ...(json.explosive_list || []),
      ...(json.early_break_list || []),
    ];
    return (
      all.find((s) => s.ticker === tickerUpper) ||
      all.find((s) => s.ticker?.toUpperCase() === tickerUpper) ||
      null
    );
  } catch {
    return null;
  }
}

// ============================================================================
// Source 4 — price history (radar-db fallback) → RSI/SMA/ATR
// ============================================================================

interface PriceRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

function fetchPriceHistory(ticker: string): PriceRow[] {
  const cfg = getRadarDbConfig();
  const db = getRadarDb();
  if (!cfg || !db) return [];
  try {
    const cols = `${cfg.dateCol}, ${cfg.openCol} as open, ${cfg.highCol} as high, ${cfg.lowCol} as low, ${cfg.priceCol} as close, ${cfg.volumeCol} as volume`;
    const turnoverSelect = cfg.turnoverCol
      ? `, ${cfg.turnoverCol} as turnover`
      : ', NULL as turnover';
    const rows = db
      .prepare(
        `SELECT ${cols}${turnoverSelect}
         FROM ${cfg.table}
         WHERE ${cfg.tickerCol} = ? AND ${cfg.priceCol} IS NOT NULL AND ${cfg.priceCol} > 0
         ORDER BY ${cfg.dateCol} DESC
         LIMIT ?`
      )
      .all(ticker.toUpperCase(), MAX_HISTORY_DAYS) as Record<string, unknown>[];

    return rows.reverse().map((r) => ({
      date: String(r[cfg.dateCol] ?? ''),
      open: toNum(r.open),
      high: toNum(r.high),
      low: toNum(r.low),
      close: toNum(r.close),
      volume: parseVolume(r.volume),
      turnover: computeTurnover(r, cfg),
    }));
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      /* noop */
    }
  }
}

// ============================================================================
// Aggregator
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const tickerUpper = ticker.toUpperCase();
  const url = new URL(request.url);
  const market = (url.searchParams.get('market') || 'EGX').toUpperCase();
  const skipPython = url.searchParams.get('skip_python') === '1';

  const errors: string[] = [];

  // ── 1) Try Python first ──
  if (!skipPython) {
    const py = await fetchPythonPublishData(tickerUpper, market);
    if (py && py.ticker) {
      return NextResponse.json({
        success: true,
        source: 'python',
        data: py,
        errors: [],
      });
    }
    errors.push('python: unreachable or empty');
  }

  // ── 2) SQLite fallback — basic stock record ──
  const stockRow = getStockByTickerFallback(tickerUpper);
  if (!stockRow) {
    return NextResponse.json(
      {
        success: false,
        source: 'sqlite_fallback_empty',
        error: `Stock ${tickerUpper} not found`,
        ticker: tickerUpper,
        data: null,
        errors,
      },
      { status: 404 }
    );
  }

  const currentPrice = toNum(stockRow.current_price);
  const previousClose = toNum(stockRow.previous_close);
  const changePct =
    toNum(stockRow.change_percent) !== 0
      ? toNum(stockRow.change_percent)
      : previousClose > 0
        ? ((currentPrice - previousClose) / previousClose) * 100
        : 0;

  // ── 3) Latest prediction (recommendation/entry/target/stop) ──
  const pred = fetchLatestPrediction(tickerUpper);

  // ── 4) Price history → technicals ──
  const history = fetchPriceHistory(tickerUpper);
  const closes = history.map((p) => p.close).filter((c) => c > 0);
  const highs = history.map((p) => p.high).filter((h) => h > 0);
  const lows = history.map((p) => p.low).filter((l) => l > 0);

  const rsi = closes.length >= 15 ? computeRSI(closes, 14) : undefined;
  const sma20 = sma(closes, 20);
  const sma50 = closes.length >= 50 ? sma(closes, 50) : undefined;
  const sma200 = closes.length >= 200 ? sma(closes, 200) : undefined;
  const atrVal = atr(highs, lows, closes, 14);

  // Volume ratio (last 10d avg / last 20d avg)
  const volumes = history.map((p) => p.volume).filter((v) => v > 0);
  let volumeRatio: number | undefined;
  if (volumes.length >= 20) {
    const last10 = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const last20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    volumeRatio = last20 > 0 ? last10 / last20 : undefined;
  }

  // ── 5) Radar entry (liquidity + signal) ──
  const radarEntry = await fetchRadarEntryAsync(tickerUpper);

  // ── 6) Build the unified payload ──
  const recommendation = mapSignalToRecommendation(
    pred?.signal as string | undefined
  );

  const entryPrice = safe(pred?.entry_price) ?? currentPrice;
  const targetPrice1 = safe(pred?.target_price) ?? undefined;
  // Secondary target: derived (+10% on top of T1, or +20% from current)
  const targetPrice2 = targetPrice1
    ? targetPrice1 * 1.1
    : currentPrice
      ? currentPrice * 1.2
      : undefined;
  const stopLoss =
    safe(pred?.stop_loss) ??
    (currentPrice ? currentPrice * 0.94 : undefined); // -6% default
  const riskReward =
    targetPrice1 && entryPrice && stopLoss && entryPrice - stopLoss !== 0
      ? (targetPrice1 - entryPrice) / (entryPrice - stopLoss)
      : safe(pred?.risk_reward);

  const buyPressure =
    radarEntry?.buy_pct != null ? toNum(radarEntry.buy_pct) : undefined;
  const sellPressure = buyPressure != null ? 100 - buyPressure : undefined;
  const netFlow = safe(radarEntry?.net_flow_egp);
  const signalCount =
    radarEntry?.pre_surge_details?.signal_count ??
    radarEntry?.quiet_details?.signal_count ??
    undefined;
  const signalMax = radarEntry?.pre_surge_details
    ? 4
    : radarEntry?.quiet_details
      ? 6
      : undefined;

  const stockMarketRaw = String(stockRow.market || '').toUpperCase();
  const stockMarket = (
    ['EGX', 'TADAWUL', 'KSE', 'QSE', 'CRYPTO', 'GOLD'].includes(stockMarketRaw)
      ? stockMarketRaw
      : 'EGX'
  ) as 'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'CRYPTO' | 'GOLD';

  const data = {
    ticker: tickerUpper,
    nameAr:
      (stockRow.name_ar as string) || (stockRow.name as string) || undefined,
    nameEn: (stockRow.name as string) || undefined,
    sector: (stockRow.sector as string) || undefined,
    currentPrice,
    previousClose: previousClose || undefined,
    changePct: Math.round(changePct * 100) / 100,

    recommendation,
    recommendationAr: pred?.signal_ar as string | undefined,
    confidence:
      safe(pred?.confidence) ??
      (pred?.master_score != null
        ? Math.min(100, toNum(pred.master_score))
        : undefined),
    reason: radarEntry?.reason,

    entryPrice,
    entryZoneLow: entryPrice ? entryPrice * 0.99 : undefined,
    entryZoneHigh: entryPrice ? entryPrice * 1.01 : undefined,
    targetPrice1,
    targetPrice2,
    stopLoss,
    riskReward:
      riskReward != null ? Math.round(riskReward * 100) / 100 : undefined,
    positionSize:
      radarEntry?.position_size != null
        ? toNum(radarEntry.position_size) * 100
        : undefined,

    signalCount,
    maxSignals: signalMax ?? (signalCount != null ? 6 : undefined),
    path: radarEntry?.path,

    buyPressure,
    sellPressure,
    netFlow,
    volumeRatio,
    turnover:
      history.length > 0
        ? history[history.length - 1].turnover
        : undefined,

    rsi: rsi != null ? Math.round(rsi * 100) / 100 : undefined,
    sma20: sma20 != null ? Math.round(sma20 * 100) / 100 : undefined,
    sma50: sma50 != null ? Math.round(sma50 * 100) / 100 : undefined,
    sma200: sma200 != null ? Math.round(sma200 * 100) / 100 : undefined,
    atr: atrVal != null ? Math.round(atrVal * 100) / 100 : undefined,

    peRatio: safe(stockRow.pe_ratio),
    pbRatio: safe(stockRow.pb_ratio),
    roe: safe(stockRow.roe),
    marketCap: safe(stockRow.market_cap),

    market: stockMarket,
    marketRegime: undefined as
      | 'DEFENSIVE'
      | 'NORMAL'
      | 'AGGRESSIVE'
      | undefined,
  };

  if (history.length === 0) errors.push('price_history: no rows');
  if (!pred) errors.push('predictions: no rows');

  return NextResponse.json({
    success: true,
    source: pred || radarEntry ? 'sqlite_fallback' : 'sqlite_fallback_basic',
    data,
    errors,
  });
=======
import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const ticker = (params.ticker || '').toUpperCase();
  if (!ticker) return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });
  
  try {
    const dbPath = require('path').join(process.cwd(), 'db', 'predictions.db');
    const db = new Database(dbPath, { readonly: true });
    
    // Get latest prediction
    const pred = db.prepare("SELECT * FROM predictions WHERE ticker = ? ORDER BY id DESC LIMIT 1").get(ticker) as any;
    db.close();
    
    if (!pred) {
      return NextResponse.json({
        success: false,
        error: 'no_prediction',
        ticker,
      }, { status: 404 });
    }
    
    return NextResponse.json({
      success: true,
      data: {
        ticker: pred.ticker,
        currentPrice: pred.entry_price || 0,
        recommendation: pred.signal || pred.status,
        confidence: pred.confidence || 50,
        entryPrice: pred.entry_price,
        targetPrice1: pred.target_price,
        targetPrice2: pred.target_price_2,
        stopLoss: pred.stop_loss,
        riskReward: pred.risk_reward || 0,
        positionSize: pred.position_size || 0,
        signalCount: 0,
        market: pred.market || 'EGX',
        marketRegime: 'NORMAL',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
>>>>>>> 835c22b (fix: recreate 7 lost API routes + restore predictions.db + Flutter audit)
}
