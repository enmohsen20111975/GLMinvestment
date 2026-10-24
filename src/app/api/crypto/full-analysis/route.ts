import { NextRequest, NextResponse } from 'next/server';
// CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing.
// TS canonical source: src/lib/unified-stock-data.ts::computeRSI.
import { computeRSI } from '@/lib/unified-stock-data';

/**
 * /api/crypto/full-analysis?ticker=BTC&timeframe=DAY&limit=365
 *
 * Unified crypto chart endpoint (UI-mirror protocol).
 *
 * Fetches OHLC from CoinGecko and adapts the response to the EXACT same
 * FullAnalysisResponse shape that the stocks `/api/v2/chart/full-analysis`
 * returns. This lets <SingleStockAnalysisView market="CRYPTO"> reuse the
 * identical chart component (InteractiveChart + V20 Fusion + SMC panels)
 * that stocks use — the only difference is the data source.
 */

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

export const dynamic = 'force-dynamic';

// Symbol -> CoinGecko coin_id map for the most-traded coins.
// Unknown symbols fall back to the lowercase symbol itself (works for many).
const SYMBOL_TO_COIN_ID: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', BNB: 'binancecoin',
  SOL: 'solana', XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin',
  DOT: 'polkadot', LTC: 'litecoin', AVAX: 'avalanche-2', LINK: 'chainlink',
  MATIC: 'matic-network', UNI: 'uniswap', XLM: 'stellar', ATOM: 'cosmos',
  TRX: 'tron', ETC: 'ethereum-classic', XMR: 'monero', ALGO: 'algorand',
  NEAR: 'near', APT: 'aptos', FIL: 'filecoin', ICP: 'internet-computer',
  VET: 'vechain', FTM: 'fantom', GRT: 'the-graph', EGLD: 'elrond-erd-2',
  SAND: 'the-sandbox', MANA: 'decentraland', AXS: 'axie-infinity', THETA: 'theta-token',
  SHIB: 'shiba-inu', PEPE: 'pepe', FLOKI: 'floki', BONK: 'bonk',
  ARB: 'arbitrum', OP: 'optimism', INJ: 'injective-protocol', SUI: 'sui',
  SEI: 'sei-network', TIA: 'celestia', RUNE: 'thorchain', FET: 'fetch-ai',
  RNDR: 'render-token', IMX: 'immutable-x', GALA: 'gala', AAVE: 'aave',
  MKR: 'maker', COMP: 'compound-governance-token', SNX: 'havven', CRV: 'curve-dao-token',
};

interface OHLCVCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── Indicator helpers ─────────────────────────────────────────────────
function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

function rsi(closes: number[], period = 14): number | null {
  // CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing.
  // قبل كده: كان SMA-based على آخر `period` شمعة فقط — غلط رياضيًا.
  return computeRSI(closes, period);
}

function atr(candles: OHLCVCandle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return sma(trs, period);
}

function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  if (mid == null || closes.length < period) return null;
  const slice = closes.slice(-period);
  const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mid + mult * sd, middle: mid, lower: mid - mult * sd, bandwidth: (4 * sd) / mid };
}

/** Detect swing highs/lows for support/resistance. */
function swingLevels(candles: OHLCVCandle[], lookback = 20) {
  const recent = candles.slice(-lookback);
  const highs = recent.map(c => c.high).sort((a, b) => b - a);
  const lows = recent.map(c => c.low).sort((a, b) => a - b);
  const resistance = highs[0] ?? null;
  const support = lows[0] ?? null;
  const allResistance = highs.slice(0, 3);
  const allSupport = lows.slice(0, 3);
  return { resistance, support, allResistance, allSupport };
}

/** Simple BOS (Break of Structure) detection. */
function detectBOS(candles: OHLCVCandle[], lookback = 30) {
  const events: Array<{ index: number; type: 'bullish' | 'bearish'; price: number }> = [];
  const recent = candles.slice(-lookback);
  if (recent.length < 5) return events;
  let lastHigh = recent[0].high, lastLow = recent[0].low;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].close > lastHigh) {
      events.push({ index: i, type: 'bullish', price: lastHigh });
      lastHigh = recent[i].high;
    } else if (recent[i].close < lastLow) {
      events.push({ index: i, type: 'bearish', price: lastLow });
      lastLow = recent[i].low;
    } else {
      lastHigh = Math.max(lastHigh, recent[i].high);
      lastLow = Math.min(lastLow, recent[i].low);
    }
  }
  return events;
}

// ── Symbol → coin_id resolution (with live-list fallback) ─────────────
async function resolveCoinId(symbol: string): Promise<string | null> {
  const sym = symbol.toUpperCase();
  if (SYMBOL_TO_COIN_ID[sym]) return SYMBOL_TO_COIN_ID[sym];
  try {
    const res = await fetch(`${COINGECKO_API}/coins/list`, {});
    if (!res.ok) return null;
    const list = (await res.json()) as Array<{ id: string; symbol: string; name: string }>;
    const match = list.find(c => c.symbol.toUpperCase() === sym);
    return match?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || 'BTC').toUpperCase();
  const timeframe = searchParams.get('timeframe') || 'DAY';
  // Map timeframe to CoinGecko days. Crypto is 24/7 so "DAY" = 365 daily candles.
  const DAYS_MAP: Record<string, number> = {
    DAY: 365, WEEK: 730, MONTH: 1825, TODAY: 90, '5M': 1, '15M': 1, '1H': 7,
  };
  const days = DAYS_MAP[timeframe] ?? 365;

  try {
    const coinId = await resolveCoinId(ticker);
    if (!coinId) {
      return NextResponse.json(
        { success: false, error: `Coin symbol '${ticker}' not found`, ticker },
        { status: 404 }
      );
    }

    // Fetch OHLC from CoinGecko (returns [timestamp, open, high, low, close])
    const ohlcRes = await fetch(
      `${COINGECKO_API}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!ohlcRes.ok) {
      // fallback لـ crypto_prices DB لو CoinGecko rate-limited
      try {
        const { getCryptoBySymbol } = await import('@/lib/data-engine-db');
        const coin = getCryptoBySymbol(ticker);
        if (coin && coin.price_usd) {
          return NextResponse.json({
            success: true,
            ticker,
            coin_id: coinId,
            timeframe,
            fallback: 'crypto_prices_db',
            candles: [{
              date: new Date().toISOString().slice(0, 10),
              open: coin.price_usd, high: coin.price_usd,
              low: coin.price_usd, close: coin.price_usd,
              volume: coin.total_volume || 0,
            }],
            currentPrice: coin.price_usd,
            indicators: { sma20: null, sma50: null, sma200: null, rsi: null, atr: null },
            signal: 'NEUTRAL',
            message: 'CoinGecko OHLC unavailable — using latest crypto_prices snapshot',
          });
        }
      } catch (e) {
        console.error('[crypto/full-analysis] fallback error:', e);
      }
      return NextResponse.json(
        { success: false, error: `CoinGecko OHLC error: ${ohlcRes.status}`, ticker },
        { status: 502 }
      );
    }
    const raw = (await ohlcRes.json()) as Array<[number, number, number, number, number]>;

    // FIX (Aug 2026): Fetch volume from CoinGecko market_chart (OHLC endpoint مابيرجعش volume)
    let volumesByDate: Record<string, number> = {};
    try {
      const volRes = await fetch(
        `${COINGECKO_API}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`,
        { headers: { Accept: 'application/json' } }
      );
      if (volRes.ok) {
        const volData = await volRes.json() as { total_volumes?: Array<[number, number]> };
        if (volData.total_volumes) {
          for (const [ts, vol] of volData.total_volumes) {
            const dateKey = new Date(ts).toISOString().slice(0, 10);
            volumesByDate[dateKey] = vol;
          }
        }
      }
    } catch (e) {
      console.warn('[crypto/full-analysis] volume fetch failed:', e);
    }

    // Build OHLCV candles (الـ volume من market_chart)
    const candles: OHLCVCandle[] = raw
      .filter(r => Array.isArray(r) && r.length >= 5)
      .map(r => {
        const date = new Date(r[0]).toISOString().slice(0, 10);
        return {
          date,
          open: r[1], high: r[2], low: r[3], close: r[4],
          volume: volumesByDate[date] || 0,
        };
      });

    if (candles.length < 30) {
      return NextResponse.json(
        { success: false, error: `Insufficient data for ${ticker} (${candles.length} candles)`, ticker },
        { status: 422 }
      );
    }

    const closes = candles.map(c => c.close);
    const currentPrice = closes[closes.length - 1];

    // ── Indicators ──
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);
    const rsiVal = rsi(closes, 14);
    const atrVal = atr(candles, 14);
    const bb = bollinger(closes, 20, 2);
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const macdLine = ema12 != null && ema26 != null ? ema12 - ema26 : null;
    const levels = swingLevels(candles, 30);
    const bosEvents = detectBOS(candles, 40);

    // ── Confluence score (0-10) from available signals ──
    // NOTE (Task REAPPLY-CRITICAL-FIXES): the canonical crypto signal/score
    // comes from vps-service/jobs/daily_predictor.py (V40.2 — Rule 20 Python=Brain).
    // This local score is a TS-side derived indicator view (computed from real
    // candle data: RSI/SMA/Bollinger), NOT a fabricated value. Trade-plan fields
    // (target/stop/target_2) are null'd below when real swing levels are missing
    // (Rule 27 — NO-FAKE-DATA).
    let score = 5;
    const breakdown: string[] = [];
    if (rsiVal != null) {
      if (rsiVal < 30) { score += 2; breakdown.push(`RSI مفرط البيع (${rsiVal.toFixed(0)})`); }
      else if (rsiVal > 70) { score -= 2; breakdown.push(`RSI مفرط الشراء (${rsiVal.toFixed(0)})`); }
      else if (rsiVal > 50) { score += 1; breakdown.push(`RSI صاعد (${rsiVal.toFixed(0)})`); }
      else { score -= 1; breakdown.push(`RSI هابط (${rsiVal.toFixed(0)})`); }
    }
    if (sma20 != null && sma50 != null) {
      if (sma20 > sma50) { score += 1.5; breakdown.push('تقاطع ذهبي SMA20>SMA50'); }
      else { score -= 1.5; breakdown.push('تقاطع موت SMA20<SMA50'); }
    }
    if (currentPrice > (sma200 ?? 0)) { score += 1; breakdown.push('السعر فوق SMA200 (اتجاه صاعد)'); }
    else if (sma200 != null) { score -= 1; breakdown.push('السعر تحت SMA200 (اتجاه هابط)'); }
    if (bb && bb.bandwidth < 0.05) { score += 0.5; breakdown.push('ضغط بولنجر (انفجار وشيك)'); }
    score = Math.max(0, Math.min(10, score));

    const signal = score >= 7 ? 'شراء' : score <= 3 ? 'بيع' : 'حيادي';
    const signalColor = score >= 7 ? '#10b981' : score <= 3 ? '#ef4444' : '#f59e0b';

    // ── Risk / trade plan ──
    // Task REAPPLY-CRITICAL-FIXES — fabrication fallbacks removed (Rule 27).
    // Was: target = currentPrice * 1.1, stopLoss = currentPrice * 0.95,
    // target_2 = target * 1.05 — all fabricated when no swing level found.
    // Now: return null when real support/resistance is unavailable (Rule 27).
    // Rule 20 (Python=Brain): the canonical crypto signals are produced by
    // vps-service/jobs/daily_predictor.py (CRYPTO market). This route is a
    // read-only TS-side view for indicators only — trade-plan fields should
    // come from predictions.db (canonical writer = V40.2).
    const entry = currentPrice;
    const target = levels.resistance ?? null;
    const stopLoss = levels.support ?? null;
    const rrRatio = entry - stopLoss > 0 && target != null ? (target - entry) / (entry - stopLoss) : null;

    // ── Market regime ──
    let regime = 'RANGING', regimeAr = 'متذبذب', regimeColor = '#64748b';
    if (sma200 != null) {
      if (currentPrice > sma200 * 1.05) { regime = 'BULL'; regimeAr = 'صاعد قوي'; regimeColor = '#10b981'; }
      else if (currentPrice > sma200) { regime = 'BULL'; regimeAr = 'صاعد'; regimeColor = '#22c55e'; }
      else if (currentPrice < sma200 * 0.95) { regime = 'BEAR'; regimeAr = 'هابط قوي'; regimeColor = '#ef4444'; }
      else if (currentPrice < sma200) { regime = 'BEAR'; regimeAr = 'هابط'; regimeColor = '#f87171'; }
    }

    // ── Build FullAnalysisResponse-compatible shape ──
    const response = {
      success: true,
      ticker,
      name: coinId,
      name_ar: ticker,
      market: 'CRYPTO',
      timeframe,
      data_points: candles.length,
      ohlcv: candles,
      indicators: {
        sma20, sma50, sma200,
        rsi: rsiVal,
        atr: atrVal,
        atr_pct: atrVal != null && currentPrice > 0 ? (atrVal / currentPrice) * 100 : null,
        bb_upper: bb?.upper ?? null,
        bb_middle: bb?.middle ?? null,
        bb_lower: bb?.lower ?? null,
        macd: macdLine,
        macd_signal: ema(closes, 9),
      },
      levels: {
        support: levels.support,
        resistance: levels.resistance,
        pivot: currentPrice,
        all_support: levels.allSupport,
        all_resistance: levels.allResistance,
      },
      confluence: {
        score,
        breakdown,
        signal,
        signal_color: signalColor,
      },
      risk: {
        entry,
        target,
        target_2: null, // Task REAPPLY-CRITICAL-FIXES — was target * 1.05 (fabricated, Rule 27)
        stop_loss: stopLoss,
        rr_ratio: rrRatio,
        atr: atrVal,
        atr_pct: atrVal != null && currentPrice > 0 ? (atrVal / currentPrice) * 100 : null,
      },
      market_regime: {
        regime,
        regime_ar: regimeAr,
        confidence: 70,
        color: regimeColor,
      },
      bos_events: bosEvents.map(e => ({ index: e.index, type: e.type, price: e.price, level: e.price })),
      bb_squeeze: bb
        ? {
            state: bb.bandwidth < 0.05 ? 'extreme_squeeze' : bb.bandwidth < 0.1 ? 'squeeze' : 'normal',
            color: bb.bandwidth < 0.05 ? '#f97316' : '#94a3b8',
            text: bb.bandwidth < 0.05 ? 'ضغط شديد' : bb.bandwidth < 0.1 ? 'ضغط' : 'طبيعي',
          }
        : null,
      current_indicators: {
        rsi: rsiVal,
        macd: macdLine,
        macd_trend_ar: macdLine != null ? (macdLine > 0 ? 'صاعد' : 'هابط') : null,
        macd_color: macdLine != null ? (macdLine > 0 ? '#10b981' : '#ef4444') : '#94a3b8',
        atr: atrVal,
      },
      // SMC + Fusion not computed client-side for crypto (panels hidden gracefully)
      smc_analysis: null,
      fusion_metrics: null,
      candlestick_patterns: null,
      analysis_text: breakdown.length
        ? `تحليل ${ticker}: ${breakdown.join('، ')}. درجة التوافق ${score.toFixed(1)}/10`
        : `تحليل ${ticker}: درجة التوافق ${score.toFixed(1)}/10`,
      currency: 'USD',
      _source: 'crypto_coingecko_adapter',
    };

    return NextResponse.json(response);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: `فشل تحليل ${ticker}: ${msg}`, ticker },
      { status: 500 }
    );
  }
}
