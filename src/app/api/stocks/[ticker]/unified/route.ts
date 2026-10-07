/**
 * unified/route.ts — CANONICAL unified stock API (SINGLE SOURCE OF TRUTH)
 * ===============================================================================
 *
 * Route:  GET /api/stocks/[ticker]/unified
 *
 * Problem it solves:
 *   5 different UI screens showed 5 different signals for ETEL because each
 *   screen read from a different DB / API / calculation. This route is the
 *   ONE place that merges every data source and returns a canonical signal.
 *
 * Data sources merged in parallel:
 *   1. stocks.db.stocks                  → stock basics + fundamentals + pre-computed RSI/MA
 *   2. predictions.db.predictions        → latest prediction (entry / target / stop / score)
 *   3. scripts/output/maker_radar_EGX_<date>.json → radar (buy_pct, sell_pct, accumulation, path)
 *   4. canonical-signal.ts               → classifySignal / classifyAccumulation /
 *                                           classifyMoneyFlow / classifyStockPhase
 *
 * Rules (per UNIFIED-STOCK-API-1 spec):
 *   - better-sqlite3 synchronous reads (one DB failing must NOT break the response)
 *   - Use canonical-signal.ts for ALL classifications
 *   - DO NOT fabricate data — return null if a field is missing
 *   - Include `cached_at` ISO timestamp
 *   - `force-dynamic` to bypass route-level caching
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
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

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ----------------------------------------------------------------------------
// Type helpers (keep responses strongly typed so screens can rely on shapes)
// ----------------------------------------------------------------------------
type RadarEntry = {
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

// ----------------------------------------------------------------------------
// GET handler
// ----------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params?.ticker ?? '').toString().toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'missing_ticker' },
      { status: 400 }
    );
  }

  const PROJECT_ROOT = process.cwd();

  // ───────────────────────────────────────────────────────────────────────
  // Step 1: stock basics from stocks.db (always required)
  // ───────────────────────────────────────────────────────────────────────
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
      .get(ticker) ?? null) as Record<string, unknown> | null;
    stocksDb.close();
  } catch (e) {
    console.error('[unified] stocks.db read failed:', e);
  }

  if (!stock) {
    return NextResponse.json(
      { success: false, error: 'stock_not_found', ticker },
      { status: 404 }
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // Step 2: latest prediction from predictions.db (best-effort)
  // ───────────────────────────────────────────────────────────────────────
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
    prediction = (predDb
      .prepare(`
        SELECT id, signal, signal_type, entry_price, target_price, target_price_2,
               stop_loss, master_score, risk_reward, confidence, prediction_date,
               atr_at_entry, analysis_json, status
        FROM predictions
        WHERE ticker = ? AND market IN ('EGX', 'مصر')
        ORDER BY prediction_date DESC LIMIT 1
      `)
      .get(ticker) ?? null) as PredictionRow | null;
    predDb.close();
  } catch (e) {
    console.error('[unified] predictions.db read failed:', e);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Step 3: radar cache JSON (maker_radar_EGX_<YYYYMMDD>.json)
  // Try today's cache; if missing, walk back up to 7 days.
  // ───────────────────────────────────────────────────────────────────────
  let radarData: RadarEntry | null = null;
  try {
    const candidates: string[] = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const stamp = d.toISOString().slice(0, 10).replace(/-/g, '');
      candidates.push(
        path.join(PROJECT_ROOT, 'scripts', 'output', `maker_radar_EGX_${stamp}.json`)
      );
    }

    for (const cachePath of candidates) {
      if (!existsSync(cachePath)) continue;
      const cacheContent = readFileSync(cachePath, 'utf-8');
      const cache = JSON.parse(cacheContent) as {
        all_results?: RadarEntry[];
        under_microscope?: RadarEntry[];
      };

      const fromAll = (cache.all_results ?? []).find((r) => r?.ticker === ticker);
      const fromScope = (cache.under_microscope ?? []).find((r) => r?.ticker === ticker);
      radarData = fromAll ?? fromScope ?? null;
      if (radarData) break;
    }
  } catch (e) {
    // Cache miss — not fatal
    console.error('[unified] radar cache read failed:', e);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Step 4: FRESH COMPUTATION LAYER (Task UNIFIED-API-V2, Rule 67 + Rule 72)
  // ───────────────────────────────────────────────────────────────────────
  // ROOT CAUSE (موثّق في audit):
  //   - stocks.db.stocks.signal NULL لكل الأسهم → canonical.signal دائماً HOLD
  //   - predictions.db فارغ لـ 60% من الأسهم → canonical.signal بيوقع على null
  //   - radar cache فيه بس الأسهم under_microscope → buy_pct NULL لأغلب الأسهم
  //
  // SOLUTION: لما المصادر تكون فاضية، نحسب canonical values FRESH من
  // stock_daily_prices (موجود لكل الأسهم):
  //   - RSI (Wilder's) من آخر 15 إغلاق
  //   - MA50 / MA200 من الإغلاقات
  //   - support / resistance من آخر 20 يوم
  //   - buy_pct من candle colors (up days vs down days)
  //   - master_score من technical score (RSI + MA + momentum)
  type PriceRow = { price_date: string; close: number; volume: number; high: number; low: number; };
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
      .all(ticker) as PriceRow[];
    // oldest first for indicator math
    priceHistory = rows.reverse();
    stocksDb2.close();
  } catch (e) {
    console.error('[unified] price history read failed:', e);
  }

  // ─── Helper: Wilder's RSI (period=14) — مطابق Python canonical ────────
  function computeRSI(closes: number[], period = 14): number | null {
    if (closes.length < period + 1) return null;
    const gains: number[] = [0];
    const losses: number[] = [0];
    for (let i = 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;
    for (let i = period + 1; i < closes.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  // ─── Helper: Simple Moving Average ────────────────────────────────────
  function computeSMA(closes: number[], period: number): number | null {
    if (closes.length < period) return null;
    let sum = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      sum += closes[i];
    }
    return sum / period;
  }

  // ─── Helper: buy_pct from candle colors (up days = buy pressure) ─────
  // Fallback لما radar cache مفيش فيه السهم ده.
  // Formula: count of up-close days in last 10 days / 10 * 100
  function computeBuyPctFromCandles(closes: number[]): number | null {
    if (closes.length < 2) return null;
    const recent = closes.slice(-11); // last 10 changes
    let upDays = 0;
    let total = 0;
    for (let i = 1; i < recent.length; i++) {
      total++;
      if (recent[i] > recent[i - 1]) upDays++;
    }
    if (total === 0) return null;
    return (upDays / total) * 100;
  }

  // ─── Helper: support / resistance from last 20 days ──────────────────
  function computeSupportResistance(history: PriceRow[]): {
    support: number | null;
    resistance: number | null;
  } {
    if (history.length < 5) return { support: null, resistance: null };
    const recent = history.slice(-20);
    const lows = recent.map((r) => r.low || r.close).filter((v) => v > 0);
    const highs = recent.map((r) => r.high || r.close).filter((v) => v > 0);
    if (lows.length === 0 || highs.length === 0) return { support: null, resistance: null };
    // support = min of lows (excluding current), resistance = max of highs
    const support = Math.min(...lows.slice(0, -1));
    const resistance = Math.max(...highs.slice(0, -1));
    return { support, resistance };
  }

  // ─── Helper: technical score → master_score (0-100) ──────────────────
  // Build a quick technical score when prediction.master_score is NULL.
  // Factors:
  //   - RSI: <30 → +20 (oversold), >70 → -20 (overbought), 40-60 → +5
  //   - MA alignment: price > MA50 > MA200 → +25 (strong uptrend)
  //   - Momentum (10d ROC): > +5% → +15, < -5% → -15
  //   - Volume ratio (last vs avg 20): > 1.5x → +10
  function computeTechnicalScore(opts: {
    rsi: number | null;
    price: number;
    ma50: number | null;
    ma200: number | null;
    roc10d: number | null;
    volumeRatio: number | null;
  }): number {
    let score = 50; // baseline
    const { rsi, price, ma50, ma200, roc10d, volumeRatio } = opts;
    if (rsi !== null) {
      if (rsi < 30) score += 20;        // oversold → buy signal
      else if (rsi > 70) score -= 20;   // overbought → sell signal
      else if (rsi >= 40 && rsi <= 60) score += 5;  // neutral zone → slight positive
    }
    if (ma50 !== null && ma200 !== null) {
      if (price > ma50 && ma50 > ma200) score += 25;  // strong uptrend
      else if (price < ma50 && ma50 < ma200) score -= 25; // strong downtrend
      else if (price > ma50) score += 10;  // above short-term MA
    }
    if (roc10d !== null) {
      if (roc10d > 5) score += 15;
      else if (roc10d < -5) score -= 15;
    }
    if (volumeRatio !== null && volumeRatio > 1.5) score += 10;
    // Clamp 0-100
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // ─── Compute fresh values ────────────────────────────────────────────
  const closes = priceHistory.map((r) => r.close).filter((c) => typeof c === 'number' && c > 0);
  const volumes = priceHistory.map((r) => r.volume).filter((v) => typeof v === 'number' && v > 0);
  const lastClose = closes.length > 0 ? closes[closes.length - 1] : null;
  const currentPrice = Number(stock.current_price ?? lastClose ?? 0);

  const freshRSI = computeRSI(closes);
  const freshMA50 = computeSMA(closes, Math.min(50, closes.length));
  const freshMA200 = closes.length >= 200 ? computeSMA(closes, 200) : null;
  const freshBuyPct = computeBuyPctFromCandles(closes);
  const freshSR = computeSupportResistance(priceHistory);

  // ROC 10d
  let roc10dFresh: number | null = null;
  if (closes.length >= 11) {
    const past = closes[closes.length - 11];
    if (past > 0) roc10dFresh = ((closes[closes.length - 1] - past) / past) * 100;
  }

  // Volume ratio (last vs avg 20)
  let volumeRatioFresh: number | null = null;
  if (volumes.length >= 20) {
    const lastVol = volumes[volumes.length - 1];
    const avg20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    if (avg20 > 0) volumeRatioFresh = lastVol / avg20;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Step 5: Pick BEST source for each field (canonical > fresh > pre-computed)
  // ───────────────────────────────────────────────────────────────────────
  const buyPct = (radarData?.buy_pct ?? freshBuyPct) as number | null;
  const sellPct = (radarData?.sell_pct ?? (freshBuyPct !== null ? 100 - freshBuyPct : null)) as number | null;
  const roc10d = (radarData?.roc_10d ?? roc10dFresh) as number | null;

  // Canonical master score precedence:
  //   1. predictions.db.master_score (if non-null AND prediction is fresh ≤2 days)
  //   2. fresh technical score (computed from price history)
  //   3. stocks.db.signal (numeric master score column)
  //   4. null → classifySignal falls back to HOLD
  const predMaster = prediction?.master_score ?? null;
  const stockMaster = typeof stock.signal === 'number' ? stock.signal : null;

  // Check prediction freshness — reject if older than 2 days
  let predictionIsFresh = false;
  if (prediction?.prediction_date) {
    try {
      const predDate = new Date(prediction.prediction_date);
      const ageHours = (Date.now() - predDate.getTime()) / (1000 * 60 * 60);
      predictionIsFresh = ageHours <= 48; // 2 days
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

  // Final master score: prefer fresh prediction, then fresh tech score, then stocks.db
  const masterScore =
    predMaster !== null && predMaster !== undefined && predictionIsFresh
      ? Number(predMaster)
      : freshTechScore;

  const canonicalSignal: SignalType = classifySignal(masterScore);
  const canonicalSignalAr: string = signalAr(canonicalSignal);
  const canonicalAccumulation: AccumulationLabel = classifyAccumulation(buyPct);
  const canonicalMoneyFlow: MoneyFlowState = classifyMoneyFlow(buyPct, sellPct);
  const canonicalPhase: StockPhase = classifyStockPhase(buyPct, roc10d);

  // ───────────────────────────────────────────────────────────────────────
  // Step 5: parse analysis_json if present
  // ───────────────────────────────────────────────────────────────────────
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

  // ───────────────────────────────────────────────────────────────────────
  // Step 6: build unified response (ALL 5+ sections, single source of truth)
  // ───────────────────────────────────────────────────────────────────────
  const positionSize = typeof radarData?.position_size === 'number'
    ? radarData.position_size
    : null;
  const positionSizePct = positionSize !== null ? positionSize * 100 : null;

  return NextResponse.json({
    success: true,
    ticker,
    cached_at: new Date().toISOString(),

    // ─── Stock basics ─────────────────────────────────────────────────
    stock: {
      ticker: stock.ticker,
      name: stock.name,
      name_ar: stock.name_ar,
      current_price: stock.current_price,
      previous_close: stock.previous_close,
      change_percent: stock.change_percent,
      volume: stock.volume,
      market_cap: stock.market_cap,
      sector: stock.sector,
      industry: stock.industry,
      last_update: stock.last_update,
    },

    // ─── Fundamentals ─────────────────────────────────────────────────
    fundamentals: {
      pe_ratio: stock.pe_ratio,
      pb_ratio: stock.pb_ratio,
      ps_ratio: stock.ps_ratio,
      roe: stock.roe,
      roa: stock.roa,
      eps: stock.eps,
      dividend_yield: stock.dividend_yield,
      beta: stock.beta,
    },

    // ─── Technical indicators (canonical — fresh computed > stocks.db pre-computed) ──
    // ROOT CAUSE FIX: لما stocks.db.rsi يكون NULL أو قديم، نحسبه FRESH من price history
    technical: {
      rsi: freshRSI ?? stock.rsi ?? null,                    // FRESH if pre-computed is NULL
      rsi_source: freshRSI !== null ? 'fresh_wilder' : (stock.rsi ? 'precomputed' : 'null'),
      ma_50: freshMA50 ?? stock.ma_50 ?? null,
      ma_200: freshMA200 ?? stock.ma_200 ?? null,
      support: freshSR.support ?? stock.support ?? null,
      resistance: freshSR.resistance ?? stock.resistance ?? null,
      high_52w: stock.high_52w,
      low_52w: stock.low_52w,
      avg_volume: stock.avg_volume,
      trend: stock.trend,
      signal_raw: stock.signal,
      atr: prediction?.atr_at_entry ?? null,
      // Fresh indicators (computed from last 30 days of price history)
      fresh: {
        rsi: freshRSI,
        ma_50: freshMA50,
        roc_10d: roc10dFresh,
        volume_ratio: volumeRatioFresh,
        technical_score: freshTechScore,
        price_history_points: closes.length,
      },
    },

    // ─── CANONICAL signal (SINGLE SOURCE OF TRUTH) ──────────────────
    canonical: {
      signal: canonicalSignal,             // STRONG_BUY / BUY / ACCUMULATE / HOLD / REDUCE / SELL / STRONG_SELL
      signal_ar: canonicalSignalAr,        // شراء قوي / شراء / تجميع / انتظار / تخفيض / بيع / بيع قوي
      accumulation: canonicalAccumulation, // تجميع قوي / تجميع / ... / تصريف قوي
      money_flow: canonicalMoneyFlow,      // 🟢 سيولة داخلة قوية / ... / 🔴 خارجة قوية
      phase: canonicalPhase,               // تجميع / تصاعد / توزيع / تخفيض / محايد
      master_score: masterScore,
      // ROOT CAUSE FIX: source transparency — العميل يقدر يعرف منين الـ master_score جاي
      master_score_source:
        predMaster !== null && predMaster !== undefined && predictionIsFresh
          ? 'prediction_db_fresh'
          : 'fresh_technical_score',
      prediction_is_fresh: predictionIsFresh,
      buy_pct_source: radarData?.buy_pct != null ? 'radar_cache' : (freshBuyPct != null ? 'fresh_candle_colors' : 'null'),
    },

    // ─── Prediction (from predictions.db) ─────────────────────────────
    prediction: prediction
      ? {
          id: prediction.id,
          prediction_date: prediction.prediction_date,
          status: prediction.status,
          signal_raw: prediction.signal,          // raw DB signal string
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

    // ─── Radar data (from maker_radar cache) ─────────────────────────
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
  });
}
