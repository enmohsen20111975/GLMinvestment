/**
 * unified-stock-data.ts — Shared module for CANONICAL stock data
 * ===============================================================================
 *
 * Task UNIFIED-API-V3 (2026-10-07) — Rule 67 + Rule 72
 *
 * PROBLEM:
 *   Each API route (/api/stocks/[ticker], /comprehensive, /publish-data, etc.)
 *   reads from DIFFERENT DB sources + computes indicators with DIFFERENT formulas.
 *   Result: same stock shows 4 different RSI values + 4 different signals across screens.
 *
 * SOLUTION:
 *   ALL API routes that serve stock data MUST import from this module.
 *   This module is the SINGLE SOURCE OF TRUTH for:
 *     - RSI (Wilder's, period=14)
 *     - MA50 / MA200
 *     - support / resistance
 *     - buy_pct (canonical)
 *     - master_score (canonical)
 *     - signal classification
 *     - accumulation / money_flow / phase
 *
 * Usage:
 *   import { getUnifiedStockData } from '@/lib/unified-stock-data';
 *   const data = await getUnifiedStockData(ticker);
 *   // data.canonical.signal_ar → 'انتظار' (consistent across all screens)
 */

import Database from 'better-sqlite3';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
// CANONICAL-RSI: imported from canonical-rsi.ts (client-safe, no DB imports)
import { computeRSI } from '@/lib/canonical-rsi';
import {
  classifySignal,
  signalAr,
  classifyAccumulation,
  classifyMoneyFlow,
  classifyStockPhase,
  type SignalType,
  type AccumulationLabel,
  type MoneyFlowState,
  type StockPhase,
} from '@/lib/canonical-signal';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
export type PriceRow = {
  price_date: string;
  close: number;
  volume: number;
  high: number;
  low: number;
};

export type RadarEntry = {
  ticker?: string;
  path?: string;
  under_microscope?: boolean;
  position_size?: number;
  buy_pct?: number | null;
  sell_pct?: number | null;
  net_flow_egp?: number | null;
  buy_value_m?: number | null;
  sell_value_m?: number | null;
  roc_10d?: number | null;
  roc_30d?: number | null;
  volume_ratio_10d_vs_20d?: number | null;
  range_10d_pct?: number | null;
  data_quality?: string;
  staleness_days?: number | null;
  live_price?: number | null;
  price_source?: string;
  data_date?: string;
  [k: string]: unknown;
};

export type UnifiedStockData = {
  success: boolean;
  ticker: string;
  cached_at: string;

  stock: {
    ticker: string;
    name: string | null;
    name_ar: string | null;
    current_price: number | null;
    previous_close: number | null;
    change_percent: number | null;
    volume: number | null;
    market_cap: number | null;
    sector: string | null;
    industry: string | null;
    last_update: string | null;
  };

  fundamentals: {
    pe_ratio: number | null;
    pb_ratio: number | null;
    ps_ratio: number | null;
    roe: number | null;
    roa: number | null;
    eps: number | null;
    dividend_yield: number | null;
    beta: number | null;
  };

  technical: {
    rsi: number | null;
    rsi_source: 'fresh_wilder' | 'precomputed' | 'null';
    ma_50: number | null;
    ma_200: number | null;
    support: number | null;
    resistance: number | null;
    high_52w: number | null;
    low_52w: number | null;
    avg_volume: number | null;
    trend: string | null;
    signal_raw: unknown;
    atr: number | null;
    fresh: {
      rsi: number | null;
      ma_50: number | null;
      roc_10d: number | null;
      volume_ratio: number | null;
      technical_score: number;
      price_history_points: number;
    };
  };

  canonical: {
    signal: SignalType;
    signal_ar: string;
    accumulation: AccumulationLabel;
    money_flow: MoneyFlowState;
    phase: StockPhase;
    master_score: number;
    master_score_source: 'prediction_db_fresh' | 'fresh_technical_score';
    prediction_is_fresh: boolean;
    buy_pct_source: 'radar_cache' | 'fresh_candle_colors' | 'null';
    buy_pct: number | null;
    sell_pct: number | null;
  };

  prediction: {
    id: number;
    prediction_date: string;
    status: string;
    signal_raw: string;
    signal_type: string;
    entry_price: number;
    target_price: number | null;
    target_price_2: number | null;
    stop_loss: number | null;
    risk_reward: number | null;
    confidence: number | null;
    master_score: number | null;
    analysis_reason: string | null;
    who_is_buying: string | null;
    hmm_regime: string | null;
    target_price_3: number | null;
    support_level: number | null;
    resistance_level: number | null;
  } | null;

  radar: {
    path: string | null;
    under_microscope: boolean | null;
    position_size: number | null;
    position_size_pct: number | null;
    buy_pct: number | null;
    sell_pct: number | null;
    net_flow_egp: number | null;
    buy_value_m: number | null;
    sell_value_m: number | null;
    roc_10d: number | null;
    roc_30d: number | null;
    volume_ratio_10d_vs_20d: number | null;
    range_10d_pct: number | null;
    data_quality: string | null;
    staleness_days: number | null;
    live_price: number | null;
    price_source: string | null;
    data_date: string | null;
  } | null;
};

// ----------------------------------------------------------------------------
// CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67)
// computeRSI moved to canonical-rsi.ts (client-safe, no DB imports).
// This file (unified-stock-data.ts) imports better-sqlite3 — CANNOT be
// imported from client components. canonical-rsi.ts is pure math, safe for
// client-side use.
//
// API routes: import from here (unified-stock-data.ts)
// Client components: import from canonical-rsi.ts
// ----------------------------------------------------------------------------
export { computeRSI } from '@/lib/canonical-rsi';

// ----------------------------------------------------------------------------
// Helper: Simple Moving Average
// ----------------------------------------------------------------------------
function computeSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    sum += closes[i];
  }
  return sum / period;
}

// ----------------------------------------------------------------------------
// Helper: buy_pct from candle colors (up days = buy pressure)
// ----------------------------------------------------------------------------
function computeBuyPctFromCandles(closes: number[]): number | null {
  if (closes.length < 2) return null;
  const recent = closes.slice(-11);
  let upDays = 0;
  let total = 0;
  for (let i = 1; i < recent.length; i++) {
    total++;
    if (recent[i] > recent[i - 1]) upDays++;
  }
  if (total === 0) return null;
  return (upDays / total) * 100;
}

// ----------------------------------------------------------------------------
// Helper: support / resistance from last 20 days
// ----------------------------------------------------------------------------
function computeSupportResistance(history: PriceRow[]): {
  support: number | null;
  resistance: number | null;
} {
  if (history.length < 5) return { support: null, resistance: null };
  const recent = history.slice(-20);
  const lows = recent.map((r) => r.low || r.close).filter((v) => v > 0);
  const highs = recent.map((r) => r.high || r.close).filter((v) => v > 0);
  if (lows.length === 0 || highs.length === 0) return { support: null, resistance: null };
  const support = Math.min(...lows.slice(0, -1));
  const resistance = Math.max(...highs.slice(0, -1));
  return { support, resistance };
}

// ----------------------------------------------------------------------------
// Helper: technical score → master_score (0-100)
// ----------------------------------------------------------------------------
function computeTechnicalScore(opts: {
  rsi: number | null;
  price: number;
  ma50: number | null;
  ma200: number | null;
  roc10d: number | null;
  volumeRatio: number | null;
}): number {
  let score = 50;
  const { rsi, price, ma50, ma200, roc10d, volumeRatio } = opts;
  if (rsi !== null) {
    if (rsi < 30) score += 20;
    else if (rsi > 70) score -= 20;
    else if (rsi >= 40 && rsi <= 60) score += 5;
  }
  if (ma50 !== null && ma200 !== null) {
    if (price > ma50 && ma50 > ma200) score += 25;
    else if (price < ma50 && ma50 < ma200) score -= 25;
    else if (price > ma50) score += 10;
  }
  if (roc10d !== null) {
    if (roc10d > 5) score += 15;
    else if (roc10d < -5) score -= 15;
  }
  if (volumeRatio !== null && volumeRatio > 1.5) score += 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ----------------------------------------------------------------------------
// MAIN FUNCTION: getUnifiedStockData — single source of truth
// ----------------------------------------------------------------------------
export function getUnifiedStockData(ticker: string): UnifiedStockData | null {
  const tickerUpper = (ticker ?? '').toString().toUpperCase().trim();
  if (!tickerUpper) return null;

  const PROJECT_ROOT = process.cwd();

  // ─── Step 1: stock basics from stocks.db ───────────────────────────────
  let stock: Record<string, unknown> | null = null;
  try {
    const stocksDb = new Database(path.join(PROJECT_ROOT, 'db', 'stocks.db'), {
      readonly: true,
      fileMustExist: true,
    });
    stock = (stocksDb
      .prepare(`
        SELECT ticker, name, name_ar, current_price, previous_close, change_percent, volume,
               market_cap, pe_ratio, pb_ratio, ps_ratio, roe, eps, roa, dividend_yield,
               sector, industry, ma_50, ma_200, rsi, support, resistance, signal, trend,
               high_52w, low_52w, beta, avg_volume, last_update
        FROM stocks WHERE ticker = ?
      `)
      .get(tickerUpper) ?? null) as Record<string, unknown> | null;
    stocksDb.close();
  } catch (e) {
    console.error('[unified-stock-data] stocks.db read failed:', e);
  }

  if (!stock) return null;

  // ─── Step 2: latest prediction from predictions.db ────────────────────
  type PredictionRow = {
    id: number;
    signal: string;
    signal_type: string;
    entry_price: number;
    target_price: number | null;
    target_price_2: number | null;
    stop_loss: number | null;
    master_score: number | null;
    risk_reward: number | null;
    confidence: number | null;
    prediction_date: string;
    atr_at_entry: number | null;
    analysis_json: string | null;
    status: string;
  };

  let prediction: PredictionRow | null = null;
  try {
    const predDb = new Database(
      path.join(PROJECT_ROOT, 'db', 'predictions.db'),
      { readonly: true, fileMustExist: true }
    );
    // DEEP-MARKET-SEPARATION (Task DEEP-MARKET-SEPARATION-AUDIT, Rule 73)
    // قبل كده شيلنا الـ market filter كلياً (كان بـ يرفض non-EGX tickers).
    // بس الـ audit كشف إن في 15 ticker متكررين بين EGX و US في predictions.db
    // (بسبب migration قديم خربان). شيلنا الفلتر كلياً → بترجّع prediction غلط.
    //
    // الحل: نفلتر بـ market بتاع السهم من stocks.db (موثوق) مش من predictions.db
    // (اللي فيه data خربانة). + نـ map العربي لـ English.
    const stockMarket = String(stock?.market || '').trim();
    const marketVariants: string[] = [];
    if (stockMarket === 'EGX' || stockMarket === 'مصر') {
      marketVariants.push('EGX', 'مصر');
    } else if (stockMarket) {
      marketVariants.push(stockMarket);
    }
    // بناء WHERE clause
    const marketFilter = marketVariants.length > 0
      ? `AND market IN (${marketVariants.map(() => '?').join(',')})`
      : '';
    const marketParams = marketVariants.length > 0 ? marketVariants : [];

    prediction = (predDb
      .prepare(`
        SELECT id, signal, signal_type, entry_price, target_price, target_price_2,
               stop_loss, master_score, risk_reward, confidence, prediction_date,
               atr_at_entry, analysis_json, status
        FROM predictions
        WHERE ticker = ? ${marketFilter}
        ORDER BY prediction_date DESC LIMIT 1
      `)
      .get(tickerUpper, ...marketParams) ?? null) as PredictionRow | null;
    predDb.close();
  } catch (e) {
    console.error('[unified-stock-data] predictions.db read failed:', e);
  }

  // ─── Step 3: radar cache JSON ─────────────────────────────────────────
  // MULTI-MARKET-AUDIT (2026-10-07): the previous code hardcoded
  // `maker_radar_EGX_${stamp}.json` — so for any non-EGX ticker the radar
  // block always came back null even when a maker_radar_TADAWUL_*.json
  // (or KSE/QSE/US/CRYPTO/GOLD) cache existed on disk. We now look up the
  // ticker's market from the stocks row we just read and scan the matching
  // per-market cache files first, falling back to EGX for legacy data.
  let radarData: RadarEntry | null = null;
  try {
    const stockMarketRaw = String(stock.market ?? 'EGX').trim().toUpperCase() || 'EGX';
    // Map stocks.db.market values to the cache filename code used by
    // maker_radar.py / radar-cache.ts (e.g. مصر → EGX, السعودية → TADAWUL).
    const MARKET_CODE_MAP: Record<string, string> = {
      'EGX': 'EGX', 'مصر': 'EGX', 'EGYPT': 'EGX',
      'TADAWUL': 'TADAWUL', 'السعودية': 'TADAWUL', 'KSA': 'TADAWUL', 'SA': 'TADAWUL',
      'KSE': 'KSE', 'الكويت': 'KSE', 'KUWAIT': 'KSE',
      'QSE': 'QSE', 'قطر': 'QSE', 'QATAR': 'QSE',
      'US': 'US', 'USA': 'US',
      'CRYPTO': 'CRYPTO', 'كريبتو': 'CRYPTO',
      'GOLD': 'GOLD', 'ذهب': 'GOLD',
    };
    const marketCodes = new Set<string>();
    const primary = MARKET_CODE_MAP[stockMarketRaw] ?? stockMarketRaw;
    marketCodes.add(primary);
    // Always also try EGX as a legacy fallback (older caches had no market suffix).
    marketCodes.add('EGX');

    const today = new Date();
    const candidates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const stamp = d.toISOString().slice(0, 10).replace(/-/g, '');
      for (const code of marketCodes) {
        candidates.push(
          path.join(PROJECT_ROOT, 'scripts', 'output', `maker_radar_${code}_${stamp}.json`)
        );
        // Legacy EGX-only pattern (no market code in filename) — only for EGX.
        if (code === 'EGX') {
          candidates.push(
            path.join(PROJECT_ROOT, 'scripts', 'output', `maker_radar_${stamp}.json`)
          );
        }
      }
    }

    for (const cachePath of candidates) {
      if (!existsSync(cachePath)) continue;
      const cacheContent = readFileSync(cachePath, 'utf-8');
      const cache = JSON.parse(cacheContent) as {
        all_results?: RadarEntry[];
        under_microscope?: RadarEntry[];
      };

      const fromAll = (cache.all_results ?? []).find((r) => r?.ticker === tickerUpper);
      const fromScope = (cache.under_microscope ?? []).find((r) => r?.ticker === tickerUpper);
      radarData = fromAll ?? fromScope ?? null;
      if (radarData) break;
    }
  } catch (e) {
    console.error('[unified-stock-data] radar cache read failed:', e);
  }

  // ─── Step 4: FRESH COMPUTATION from price history ─────────────────────
  let priceHistory: PriceRow[] = [];
  try {
    const stocksDb2 = new Database(path.join(PROJECT_ROOT, 'db', 'stocks.db'), {
      readonly: true,
      fileMustExist: true,
    });
    const rows = stocksDb2
      .prepare(`
        SELECT price_date, close, volume, high, low
        FROM stock_daily_prices
        WHERE ticker = ? AND close IS NOT NULL AND close > 0
        ORDER BY price_date DESC LIMIT 30
      `)
      .all(tickerUpper) as PriceRow[];
    priceHistory = rows.reverse();
    stocksDb2.close();
  } catch (e) {
    console.error('[unified-stock-data] price history read failed:', e);
  }

  const closes = priceHistory.map((r) => r.close).filter((c) => typeof c === 'number' && c > 0);
  const volumes = priceHistory.map((r) => r.volume).filter((v) => typeof v === 'number' && v > 0);
  const lastClose = closes.length > 0 ? closes[closes.length - 1] : null;
  // CANONICAL-PRICE (Task PHASE-3, Rule 72) — `stock.current_price` (from
  // stocks.db.stocks, selected at line ~313) is the canonical LIVE source.
  // `lastClose` (from stocks.db.stock_daily_prices) is the HISTORICAL fallback.
  const currentPrice = Number(stock.current_price ?? lastClose ?? 0);

  const freshRSI = computeRSI(closes);  // from canonical-rsi.ts (re-exported above)
  const freshMA50 = computeSMA(closes, Math.min(50, closes.length));
  const freshMA200 = closes.length >= 200 ? computeSMA(closes, 200) : null;
  const freshBuyPct = computeBuyPctFromCandles(closes);
  const freshSR = computeSupportResistance(priceHistory);

  let roc10dFresh: number | null = null;
  if (closes.length >= 11) {
    const past = closes[closes.length - 11];
    if (past > 0) roc10dFresh = ((closes[closes.length - 1] - past) / past) * 100;
  }

  let volumeRatioFresh: number | null = null;
  if (volumes.length >= 20) {
    const lastVol = volumes[volumes.length - 1];
    const avg20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    if (avg20 > 0) volumeRatioFresh = lastVol / avg20;
  }

  // ─── Step 5: Pick BEST source for each field ──────────────────────────
  const buyPct = (radarData?.buy_pct ?? freshBuyPct) as number | null;
  const sellPct = (radarData?.sell_pct ?? (freshBuyPct !== null ? 100 - freshBuyPct : null)) as number | null;
  const roc10d = (radarData?.roc_10d ?? roc10dFresh) as number | null;

  const predMaster = prediction?.master_score ?? null;
  const stockMaster = typeof stock.signal === 'number' ? stock.signal : null;

  let predictionIsFresh = false;
  if (prediction?.prediction_date) {
    try {
      const predDate = new Date(prediction.prediction_date);
      const ageHours = (Date.now() - predDate.getTime()) / (1000 * 60 * 60);
      predictionIsFresh = ageHours <= 48;
    } catch {
      predictionIsFresh = false;
    }
  }

  const freshTechScore = computeTechnicalScore({
    rsi: freshRSI,
    price: currentPrice,
    ma50: freshMA50,
    ma200: freshMA200,
    roc10d: roc10dFresh,
    volumeRatio: volumeRatioFresh,
  });

  const masterScore =
    predMaster !== null && predMaster !== undefined && predictionIsFresh
      ? Number(predMaster)
      : freshTechScore;

  // ─── Step 6: Compute canonical classifications ────────────────────────
  const canonicalSignal: SignalType = classifySignal(masterScore);
  const canonicalSignalAr: string = signalAr(canonicalSignal);
  const canonicalAccumulation: AccumulationLabel = classifyAccumulation(buyPct);
  const canonicalMoneyFlow: MoneyFlowState = classifyMoneyFlow(buyPct, sellPct);
  const canonicalPhase: StockPhase = classifyStockPhase(buyPct, roc10d);

  // ─── Step 7: Parse analysis_json ──────────────────────────────────────
  type AnalysisDetails = {
    analysis_reason?: string | null;
    who_is_buying?: string | null;
    hmm_regime?: string | null;
    target_price_3?: number | null;
    support_level?: number | null;
    resistance_level?: number | null;
    [k: string]: unknown;
  };

  let analysisDetails: AnalysisDetails | null = null;
  if (prediction?.analysis_json) {
    try {
      analysisDetails = JSON.parse(prediction.analysis_json) as AnalysisDetails;
    } catch {
      analysisDetails = null;
    }
  }

  // ─── Step 8: Build response ───────────────────────────────────────────
  const positionSize = typeof radarData?.position_size === 'number'
    ? radarData.position_size
    : null;
  const positionSizePct = positionSize !== null ? positionSize * 100 : null;

  return {
    success: true,
    ticker: tickerUpper,
    cached_at: new Date().toISOString(),

    stock: {
      ticker: stock.ticker as string,
      name: (stock.name as string) ?? null,
      name_ar: (stock.name_ar as string) ?? null,
      current_price: (stock.current_price as number) ?? null,
      previous_close: (stock.previous_close as number) ?? null,
      change_percent: (stock.change_percent as number) ?? null,
      volume: (stock.volume as number) ?? null,
      market_cap: (stock.market_cap as number) ?? null,
      sector: (stock.sector as string) ?? null,
      industry: (stock.industry as string) ?? null,
      last_update: (stock.last_update as string) ?? null,
    },

    fundamentals: {
      pe_ratio: (stock.pe_ratio as number) ?? null,
      pb_ratio: (stock.pb_ratio as number) ?? null,
      ps_ratio: (stock.ps_ratio as number) ?? null,
      roe: (stock.roe as number) ?? null,
      roa: (stock.roa as number) ?? null,
      eps: (stock.eps as number) ?? null,
      dividend_yield: (stock.dividend_yield as number) ?? null,
      beta: (stock.beta as number) ?? null,
    },

    technical: {
      rsi: freshRSI ?? (stock.rsi as number) ?? null,
      rsi_source: freshRSI !== null ? 'fresh_wilder' : (stock.rsi ? 'precomputed' : 'null'),
      ma_50: freshMA50 ?? (stock.ma_50 as number) ?? null,
      ma_200: freshMA200 ?? (stock.ma_200 as number) ?? null,
      support: freshSR.support ?? (stock.support as number) ?? null,
      resistance: freshSR.resistance ?? (stock.resistance as number) ?? null,
      high_52w: (stock.high_52w as number) ?? null,
      low_52w: (stock.low_52w as number) ?? null,
      avg_volume: (stock.avg_volume as number) ?? null,
      trend: (stock.trend as string) ?? null,
      signal_raw: stock.signal,
      atr: prediction?.atr_at_entry ?? null,
      fresh: {
        rsi: freshRSI,
        ma_50: freshMA50,
        roc_10d: roc10dFresh,
        volume_ratio: volumeRatioFresh,
        technical_score: freshTechScore,
        price_history_points: closes.length,
      },
    },

    canonical: {
      signal: canonicalSignal,
      signal_ar: canonicalSignalAr,
      accumulation: canonicalAccumulation,
      money_flow: canonicalMoneyFlow,
      phase: canonicalPhase,
      master_score: masterScore,
      master_score_source:
        predMaster !== null && predMaster !== undefined && predictionIsFresh
          ? 'prediction_db_fresh'
          : 'fresh_technical_score',
      prediction_is_fresh: predictionIsFresh,
      buy_pct_source: radarData?.buy_pct != null ? 'radar_cache' : (freshBuyPct != null ? 'fresh_candle_colors' : 'null'),
      buy_pct: buyPct,
      sell_pct: sellPct,
    },

    prediction: prediction
      ? {
          id: prediction.id,
          prediction_date: prediction.prediction_date,
          status: prediction.status,
          signal_raw: prediction.signal,
          signal_type: prediction.signal_type,
          entry_price: prediction.entry_price,
          target_price: prediction.target_price,
          target_price_2: prediction.target_price_2,
          stop_loss: prediction.stop_loss,
          risk_reward: prediction.risk_reward,
          confidence: prediction.confidence,
          master_score: prediction.master_score,
          analysis_reason: analysisDetails?.analysis_reason ?? null,
          who_is_buying: analysisDetails?.who_is_buying ?? null,
          hmm_regime: analysisDetails?.hmm_regime ?? null,
          target_price_3: analysisDetails?.target_price_3 ?? null,
          support_level: analysisDetails?.support_level ?? null,
          resistance_level: analysisDetails?.resistance_level ?? null,
        }
      : null,

    radar: radarData
      ? {
          path: radarData.path ?? null,
          under_microscope: radarData.under_microscope ?? null,
          position_size: positionSize,
          position_size_pct: positionSizePct,
          buy_pct: buyPct,
          sell_pct: sellPct,
          net_flow_egp: radarData.net_flow_egp ?? null,
          buy_value_m: radarData.buy_value_m ?? null,
          sell_value_m: radarData.sell_value_m ?? null,
          roc_10d: roc10d,
          roc_30d: radarData.roc_30d ?? null,
          volume_ratio_10d_vs_20d: radarData.volume_ratio_10d_vs_20d ?? null,
          range_10d_pct: radarData.range_10d_pct ?? null,
          data_quality: radarData.data_quality ?? null,
          staleness_days: radarData.staleness_days ?? null,
          live_price: radarData.live_price ?? null,
          price_source: radarData.price_source ?? null,
          data_date: radarData.data_date ?? null,
        }
      : null,
  };
}
