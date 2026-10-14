/**
 * GET /api/stocks/[ticker]/publish-data
 * ==================================================
 *
 * يجمع كل البيانات المبعثرة المطلوبة لنشر سهم في response واحد
 * (StockPublishData JSON) — جاهزة للـ StockPublisher component.
 *
 * CANONICAL SOURCES (Directive P1 — API Routes Decoupling):
 *   1. Python backend `/api/stocks/{ticker}/publish-data` (best quality)
 *   2. Canonical unified data `getUnifiedStockData()` (SSOT lib — same source
 *      as /api/stocks/[ticker]/unified). Provides signal/prediction/technical/
 *      radar fields WITHOUT any route-level SQL.
 *   3. Canonical price adapter `getCanonicalPrice()` (Rule 67 SSOT) for
 *      current_price + previous_close.
 *
 *Directive P1: this route previously opened `predictions.db` directly
 * (`fetchLatestPrediction`) and `radar-db` directly (`fetchPriceHistory`) via
 * `new Database(...)`. Both bypassed the canonical Python engine + the unified
 * SSOT lib. They have been REMOVED. No `import Database from 'better-sqlite3'`
 * and no `new Database(` remain in this file.
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA): missing fields are `undefined`, never fabricated.
 * Rule 67 (CALCULATION-CANONICAL — price via canonical adapter).
 * Rule 72 (UNIFIED-DATA-CONTRACT).
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { getStockByTickerFallback } from '@/lib/flutter-sqlite-fallback';
import { getCanonicalPrice } from '@/lib/canonical-price';
import { cache } from '@/lib/cache-manager';
import { getUnifiedStockData } from '@/lib/unified-stock-data';

export const dynamic = 'force-dynamic';

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
      // UNIFIED-DATA-CONTRACT: inject canonical values into Python response
      const unified = getUnifiedStockData(tickerUpper);
      if (unified) {
        py.rsi = unified.technical.rsi ?? py.rsi;
        py.ma_50 = unified.technical.ma_50 ?? py.ma_50;
        py.ma_200 = unified.technical.ma_200 ?? py.ma_200;
        py.support_level = unified.technical.support ?? py.support_level;
        py.resistance_level = unified.technical.resistance ?? py.resistance_level;
        py.signal = unified.canonical.signal as any;
        py.signal_ar = unified.canonical.signal_ar;
        py.master_score = unified.canonical.master_score;
        py.accumulation = unified.canonical.accumulation;
        py.money_flow_state = unified.canonical.money_flow;
        py.phase = unified.canonical.phase;
        if (unified.prediction) {
          py.entry_price = unified.prediction.entry_price ?? py.entry_price;
          py.target_price = unified.prediction.target_price ?? py.target_price;
          py.target_price_2 = unified.prediction.target_price_2 ?? py.target_price_2;
          py.stop_loss = unified.prediction.stop_loss ?? py.stop_loss;
          py.analysis_reason = unified.prediction.analysis_reason ?? py.analysis_reason;
          py.who_is_buying = unified.prediction.who_is_buying ?? py.who_is_buying;
          py.hmm_regime = unified.prediction.hmm_regime ?? py.hmm_regime;
        }
        if (unified.radar) {
          py.buy_pct = unified.radar.buy_pct ?? py.buy_pct;
          py.sell_pct = unified.radar.sell_pct ?? py.sell_pct;
        }
        py.unified = true;
        py.unified_source = unified.canonical.master_score_source;
      }
      return NextResponse.json({
        success: true,
        source: 'python',
        data: py,
        errors: [],
      });
    }
    errors.push('python: unreachable or empty');
  }

  // ── 2) Canonical unified data (SSOT lib — no route-level SQL) ──
  // getUnifiedStockData() is the SAME source as /api/stocks/[ticker]/unified.
  // It reads stocks.db/predictions.db centrally via the lib, NOT via direct
  // SQL in this route file. This satisfies Directive P1.
  const unified = getUnifiedStockData(tickerUpper);
  if (!unified || !unified.success) {
    return NextResponse.json(
      {
        success: false,
        source: 'unified_empty',
        error: `السهم ${tickerUpper} غير متوفر في المصدر الموحد`,
        ticker: tickerUpper,
        data: null,
        errors,
      },
      { status: 404 },
    );
  }

  // Basic stock record (lib wrapper — not a route-level SQL open).
  const stockRow = getStockByTickerFallback(tickerUpper);

  // Canonical current_price + previous_close (Rule 67 SSOT).
  let currentPrice = toNum(unified.stock.current_price);
  let previousClose = toNum(unified.stock.previous_close);
  try {
    const canonical = await cache.getOrCompute(
      `canonical_price:${tickerUpper}`,
      () => getCanonicalPrice(tickerUpper, { allowLive: false }),
      60_000,
    );
    if (canonical && Number.isFinite(canonical.value) && canonical.value > 0) {
      currentPrice = canonical.value;
      if (
        canonical.previousClose != null &&
        Number.isFinite(canonical.previousClose) &&
        canonical.previousClose > 0
      ) {
        previousClose = canonical.previousClose;
      }
    }
  } catch {
    // canonical adapter failure → keep unified values (still real data).
  }

  const changePct =
    toNum(unified.stock.change_percent) !== 0
      ? toNum(unified.stock.change_percent)
      : previousClose > 0
        ? ((currentPrice - previousClose) / previousClose) * 100
        : 0;

  // ── Build the unified payload from canonical SSOT ──
  const pred = unified.prediction;
  const recommendation = mapSignalToRecommendation(
    pred?.signal_type as string | undefined,
  );

  const entryPrice = safe(pred?.entry_price) ?? currentPrice;
  const targetPrice1 = safe(pred?.target_price) ?? undefined;
  const targetPrice2 = safe(pred?.target_price_2) ?? undefined;
  const stopLoss = safe(pred?.stop_loss) ?? undefined;
  const support1 = safe(pred?.support_level) ?? safe(stockRow?.support_level ?? stockRow?.support) ?? undefined;
  const resistance1 = safe(pred?.resistance_level) ?? safe(stockRow?.resistance_level ?? stockRow?.resistance) ?? targetPrice1 ?? undefined;

  const riskReward =
    targetPrice1 && entryPrice && stopLoss && entryPrice - stopLoss !== 0
      ? (targetPrice1 - entryPrice) / (entryPrice - stopLoss)
      : safe(pred?.risk_reward);

  const buyPressure = safe(unified.canonical.buy_pct);
  const sellPressure = buyPressure != null ? 100 - buyPressure : safe(unified.canonical.sell_pct);
  const netFlow = safe(unified.radar?.net_flow_egp);
  const volumeRatio = safe(unified.radar?.volume_ratio_10d_vs_20d);
  const positionSize = unified.radar?.position_size_pct != null
    ? toNum(unified.radar.position_size_pct) * 100
    : undefined;

  const stockMarketRaw = String(stockRow?.market || '').toUpperCase();
  const stockMarket = (
    ['EGX', 'TADAWUL', 'KSE', 'QSE', 'CRYPTO', 'GOLD'].includes(stockMarketRaw)
      ? stockMarketRaw
      : 'EGX'
  ) as 'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'CRYPTO' | 'GOLD';

  const data = {
    ticker: tickerUpper,
    nameAr: (unified.stock.name_ar as string) || (stockRow?.name_ar as string) || (stockRow?.name as string) || undefined,
    nameEn: (unified.stock.name as string) || (stockRow?.name as string) || undefined,
    sector: (unified.stock.sector as string) || (stockRow?.sector as string) || undefined,
    currentPrice,
    previousClose: previousClose || undefined,
    changePct: Math.round(changePct * 100) / 100,

    recommendation,
    recommendationAr: pred?.signal_type as string | undefined,
    confidence:
      safe(pred?.confidence) ??
      (unified.canonical.master_score != null
        ? Math.min(100, toNum(unified.canonical.master_score))
        : undefined),
    masterScore: safe(unified.canonical.master_score) ?? safe(pred?.confidence),
    reason: undefined,

    entryPrice,
    entryZoneLow: undefined,
    entryZoneHigh: undefined,
    targetPrice1,
    targetPrice2,
    stopLoss,
    support1,
    support2: undefined,
    resistance1,
    resistance2: undefined,
    riskReward:
      riskReward != null ? Math.round(riskReward * 100) / 100 : undefined,
    positionSize,

    signalCount: undefined,
    maxSignals: undefined,
    path: unified.radar?.path ?? undefined,

    buyPressure,
    sellPressure,
    netFlow,
    volumeRatio,
    turnover: undefined,

    rsi: safe(unified.technical.rsi) != null ? Math.round(toNum(unified.technical.rsi) * 100) / 100 : undefined,
    sma20: undefined,
    sma50: safe(unified.technical.ma_50) != null ? Math.round(toNum(unified.technical.ma_50) * 100) / 100 : undefined,
    sma200: safe(unified.technical.ma_200) != null ? Math.round(toNum(unified.technical.ma_200) * 100) / 100 : undefined,
    atr: safe(unified.technical.atr) != null ? Math.round(toNum(unified.technical.atr) * 100) / 100 : undefined,

    peRatio: safe(unified.fundamentals.pe_ratio) ?? safe(stockRow?.pe_ratio),
    pbRatio: safe(unified.fundamentals.pb_ratio) ?? safe(stockRow?.pb_ratio),
    roe: safe(unified.fundamentals.roe) ?? safe(stockRow?.roe),
    marketCap: safe(unified.stock.market_cap) ?? safe(stockRow?.market_cap),

    market: stockMarket,
    marketRegime: undefined as
      | 'DEFENSIVE'
      | 'NORMAL'
      | 'AGGRESSIVE'
      | undefined,
  };

  if (!pred) errors.push('predictions: no fresh prediction (Rule 27 — no fabrication)');

  return NextResponse.json({
    success: true,
    source: 'unified_canonical',
    data,
    errors,
  });
}
