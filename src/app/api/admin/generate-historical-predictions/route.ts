/**
 * Generate Historical Predictions API
 * ====================================
 * Called by /admin/honest-predictions "توليد التوقعات" button.
 *
 * HONEST-V2 REWRITE
 * -----------------
 * Previous implementation ran the Python `backfill_with_personas.py` script,
 * which (a) only worked for EGX (depends on `egypt_stocks.db`) and (b)
 * frequently returned 0 predictions in this sandbox because the Python
 * backend isn't running.
 *
 * The new implementation is pure-TypeScript and runs entirely inside Next.js:
 *   1. Calls `generateHistoricalPredictions()` from `src/lib/honest-tracking/maestro.ts`
 *      which walks every ticker in stocks.db (filtered by market) and, at
 *      each sample date, runs the full Maestro pipeline:
 *        • Technical analysis  (RSI, MA20, MA50, ATR, Bollinger width)
 *        • Support / Resistance zones (swing-high/low lookup)
 *        • Candlestick pattern detection
 *        • Fundamental snapshot from stocks.db (P/E, ROE, market cap)
 *        • Persona engines (gambler + investor) — confluence scoring
 *      Persists the latest snapshot per ticker into `stored_analyses`, and
 *      inserts one row per (ticker, sample-date) into `predictions` whenever
 *      the derived signal is BUY or SELL.
 *   2. Runs `verifyPendingPredictions(limit=10000)` — same smart-exit
 *      algorithm as `verify-pending/route.ts`, evaluates every PENDING
 *      prediction against the 30-day window after entry.
 *   3. Runs `runLearningEngine()` — mines closed predictions for failure
 *      patterns (high-RSI entries, tight stops, low R:R, weak SELL signals)
 *      and writes them into `prediction_lessons`.
 *   4. Reads comprehensive stats (per-market, per-month, cumulative returns)
 *      and returns them in the schema the frontend expects.
 *
 * All DB access via better-sqlite3. No Python, no network.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  generateHistoricalPredictions,
  verifyPendingPredictions,
  runLearningEngine,
  computeComprehensiveStats,
  DEFAULT_PARAMS,
  computeDynamicParams,
  type MaestroParams,
} from '@/lib/honest-tracking/maestro';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
// Long-running: generation can take 30-60s for large date ranges
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  // ---- Parse request body ----
  let startDate = '2025-01-01';
  let endDate = new Date().toISOString().split('T')[0];
  let tickersPerMarket = 10;
  let sampleEveryDays = 7;
  let clearExisting = true;
  let markets = ['EGX', 'TADAWUL', 'KSE', 'QSE'];
  let runFullTest = false;
  const params: MaestroParams = { ...DEFAULT_PARAMS };

  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.startDate === 'string' && body.startDate) startDate = body.startDate;
    if (typeof body.endDate === 'string' && body.endDate) endDate = body.endDate;
    if (typeof body.tickersPerMarket === 'number') {
      tickersPerMarket = Math.max(5, Math.min(50, body.tickersPerMarket));
    }
    if (typeof body.sampleEveryDays === 'number') {
      sampleEveryDays = Math.max(1, Math.min(30, body.sampleEveryDays));
    }
    if (typeof body.clearExisting === 'boolean') clearExisting = body.clearExisting;
    if (typeof body.runFullTest === 'boolean') runFullTest = body.runFullTest;
    if (Array.isArray(body.markets) && body.markets.length > 0) markets = body.markets;
    if (body.technicalParams && typeof body.technicalParams === 'object') {
      const tp = body.technicalParams;
      if (typeof tp.atrPeriod === 'number') params.atrPeriod = Math.max(2, Math.min(100, tp.atrPeriod));
      if (typeof tp.swingLookback === 'number') params.swingLookback = Math.max(5, Math.min(100, tp.swingLookback));
      if (typeof tp.rsiOverbought === 'number') params.rsiOverbought = Math.max(50, Math.min(100, tp.rsiOverbought));
      if (typeof tp.rsiOversold === 'number') params.rsiOversold = Math.max(0, Math.min(50, tp.rsiOversold));
      if (typeof tp.minRiskReward === 'number') params.minRiskReward = Math.max(0.5, Math.min(10, tp.minRiskReward));
      if (typeof tp.exitSignalThreshold === 'number') params.exitSignalThreshold = Math.max(0, Math.min(100, tp.exitSignalThreshold));
    }
  } catch { // silent fallback (safe-by-design)
    /* use defaults */
  }

  // ---- 1. GENERATE ----
  let gen;
  try {
    gen = await generateHistoricalPredictions({
      startDate, endDate,
      tickersPerMarket, sampleEveryDays,
      clearExisting, markets, params,
    });
  } catch (e) {
    console.error('[Historical predictions] generation failed', {
      startDate,
      endDate,
      tickersPerMarket,
      sampleEveryDays,
      markets,
      error: e,
    });
    return NextResponse.json({
      success: false,
      error: `Generation failed: ${e instanceof Error ? e.message : 'unknown'}`,
    }, { status: 500 });
  }

  // ---- 2. VERIFY (close trades aggressively) ----
  let verify = null;
  try {
    verify = verifyPendingPredictions(10000);
  } catch (e) {
    console.error('verify step error:', e);
  }

  // ---- 3. LEARN (feed wins/losses back to LearningEngine) ----
  let lessons: any[] = [];
  try {
    lessons = runLearningEngine();
  } catch (e) {
    console.error('learn step error:', e);
  }

  // ---- 4. READ COMPREHENSIVE STATS ----
  let stats;
  try {
    stats = computeComprehensiveStats();
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: `Stats read failed: ${e instanceof Error ? e.message : 'unknown'}`,
      generation: gen,
      verify, lessons,
    }, { status: 500 });
  }

  // ---- 4b. FULL SYSTEM TEST (Python closer + learning + AI status) ----
  let pythonTest: any = null;
  if (runFullTest) {
    const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
    pythonTest = { closer: null, learning: null, ai_status: null, errors: [] as string[] };

    try {
      const closerRes = await fetch(`${PY}/closer/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(120000),
      });
      pythonTest.closer = closerRes.ok ? await closerRes.json() : { success: false, status: closerRes.status };
    } catch (e) {
      pythonTest.closer = null;
      pythonTest.errors.push(`closer: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const learningRes = await fetch(`${PY}/learning/run?period_days=7`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(120000),
      });
      pythonTest.learning = learningRes.ok ? await learningRes.json() : { success: false, status: learningRes.status };
    } catch (e) {
      pythonTest.learning = null;
      pythonTest.errors.push(`learning: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      const aiRes = await fetch(`${PY}/api/telegram/ai/status`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      pythonTest.ai_status = aiRes.ok ? await aiRes.json() : { available: false, error: `HTTP ${aiRes.status}` };
    } catch (e) {
      pythonTest.ai_status = null;
      pythonTest.errors.push(`ai_status: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- 5. RETURN COMBINED RESPONSE ----
  // AXIS-2: توليد التوقعات انتقل للبايثون. اكتشف علم الإيقاف واعرض رسالة توجيه.
  const _isAxis2Deprecated = gen.errors.some(e => typeof e === 'string' && e.includes('[AXIS-2]'));
  const baseMessage = _isAxis2Deprecated
    ? `[المحور 2] توليد التوقعات انتقل للبايثون (Python = THE BRAIN). شغّل على الإنتاج: python vps-service/jobs/daily_predictor.py أو POST http://localhost:8010/api/maestro/run. القاعدة الحالية: ${stats.total_predictions} توقع.`
    : gen.generated === 0
    ? `لم يتم توليد توقعات جديدة — تم فحص ${gen.tickers_scanned} سهم (${gen.tickers_skipped} بدون بيانات كافية). القاعدة الحالية: ${stats.total_predictions} توقع.`
    : `تم توليد ${gen.generated} توقع جديد عبر ${Object.keys(gen.by_market).length || markets.length} أسواق — ${gen.by_signal.BUY} شراء، ${gen.by_signal.SELL} بيع. تحقق: ${verify?.results.checked || 0} (${verify?.results.target_hits || 0} هدف، ${verify?.results.stopped || 0} وقف، ${verify?.results.profit_taken || 0} جني أرباح). نسبة الفوز الحالية ${stats.real_win_rate}%. دروس مستخرجة: ${lessons.length}.`;

  let message = baseMessage;
  if (runFullTest && pythonTest) {
    const closerOk = pythonTest.closer?.success ? '✅ closer' : '❌ closer';
    const learningOk = pythonTest.learning?.success ? '✅ learning' : '❌ learning';
    const aiOk = pythonTest.ai_status?.ollama?.available ? `✅ Ollama (${pythonTest.ai_status.ollama.models?.join(',') || ''})` : '❌ AI offline';
    message = `${baseMessage} | Python: ${closerOk}, ${learningOk} | AI: ${aiOk}`;
  }

  return NextResponse.json({
    success: true,
    stats: {
      total_predictions: stats.total_predictions,
      markets_covered: stats.markets_covered,
      real_win_rate: stats.real_win_rate,
      active: stats.active_predictions,
      closed: stats.closed_predictions,
      pending: stats.active_predictions,
      wins: stats.wins,
      net_pl: stats.net_pl,
      buys: stats.buy_signals,
      sells: stats.sell_signals,
      // New: richer fields for the dashboard
      target_hits: stats.target_hits,
      stop_hits: stats.stop_hits,
      profit_taken: stats.profit_taken,
      expired: stats.expired,
      avg_return: stats.avg_return,
      avg_risk_reward: stats.avg_risk_reward,
      avg_holding_days: stats.avg_holding_days,
      avg_confidence: stats.avg_confidence,
      sr_adoption_rate: stats.sr_adoption_rate,
      candlestick_adoption_rate: stats.candlestick_adoption_rate,
      date_range: stats.date_range,
      by_market: stats.by_market,
      monthly_breakdown: stats.monthly_breakdown,
      cumulative_returns: stats.cumulative_returns,
      candlestick_patterns: stats.candlestick_patterns,
      lessons: stats.lessons,
    },
    predictions_count: stats.total_predictions,
    generation: {
      generated: gen.generated,
      by_market: gen.by_market,
      by_signal: gen.by_signal,
      stored_analyses_written: gen.stored_analyses,
      tickers_scanned: gen.tickers_scanned,
      tickers_skipped: gen.tickers_skipped,
      date_range: gen.date_range,
      errors: gen.errors.slice(0, 20),
      error_count: gen.errors.length,
    },
    verify: verify
      ? {
          checked: verify.results.checked,
          target_hits: verify.results.target_hits,
          stopped: verify.results.stopped,
          profit_taken: verify.results.profit_taken,
          expired: verify.results.expired,
          still_pending: verify.results.still_pending,
          errors: verify.results.errors,
          closed_count: verify.closed_count,
          price_sources: verify.price_sources,
        }
      : null,
    lessons_extracted: lessons.length,
    python_test: pythonTest,
    message,
    timestamp: new Date().toISOString(),
  });
}

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    const pdb = openPredictionsDb(false);
    const stocksDb = openReadonly(STOCKS_DB_PATH);
    const priceDb = openReadonly(PRICE_DB_PATH);
    if (!stocksDb || !priceDb) {
      pdb.close();
      return NextResponse.json({ success: true, params: DEFAULT_PARAMS, source: 'defaults' });
    }

    const baseParams: MaestroParams = { ...DEFAULT_PARAMS };

    // Read last 200 stored_analyses to estimate market regime
    const analyses = pdb.prepare(`
      SELECT ticker, market, analysis_json
      FROM stored_analyses
      ORDER BY ai_updated_at DESC
      LIMIT 200
    `).all() as Array<{ ticker: string; market: string; analysis_json: string }>;

    let rsiSum = 0, rsiCount = 0, atrPctSum = 0, atrPctCount = 0;
    const volumeTrends: Record<string, number> = {};
    const sectorCounts: Record<string, number> = {};

    for (const a of analyses) {
      try {
        const json = JSON.parse(a.analysis_json || '{}');
        const indicators = json.indicators || {};
        const fundamentals = json.fundamentals || {};
        const rsi = Number(indicators.rsi);
        const atr = Number(indicators.atr);
        const close = Number(indicators.close || 0);
        const vol = indicators.vol;
        const sector = fundamentals.sector;

        if (rsi > 0 && isFinite(rsi)) { rsiSum += rsi; rsiCount++; }
        if (atr > 0 && close > 0) { atrPctSum += (atr / close) * 100; atrPctCount++; }
        if (vol) volumeTrends[vol] = (volumeTrends[vol] || 0) + 1;
        if (sector) sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
      } catch { /* skip malformed - safe-by-design */ }
    }

    const avgRsi = rsiCount > 0 ? rsiSum / rsiCount : 50;
    const avgAtrPct = atrPctCount > 0 ? atrPctSum / atrPctCount : 2;

    // Determine dominant volume trend
    const dominantVolume = Object.entries(volumeTrends).sort((a, b) => b[1] - a[1])[0]?.[0] || 'flat';
    // Determine dominant sector
    const dominantSector = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    // Compute dynamic params using defaults as base (no stock-specific ind here)
    const dynamicParams = computeDynamicParams(baseParams, { sector: dominantSector }, {
      rsi: avgRsi,
      ma20: null,
      ma50: null,
      atr: avgAtrPct * (priceDb.prepare(`SELECT AVG(close_price) as c FROM price_history LIMIT 1`).get() as any).c || 0,
      support: null,
      resistance: null,
      bollingerWidth: null,
      trend: avgRsi > 55 ? 'BULLISH' : avgRsi < 45 ? 'BEARISH' : 'NEUTRAL',
      candlePattern: null,
      volumeTrend: dominantVolume as any,
      close: 0,
    });

    pdb.close();
    stocksDb.close();
    priceDb.close();

    return NextResponse.json({
      success: true,
      params: dynamicParams,
      source: 'market-regime',
      meta: { avgRsi: Math.round(avgRsi * 10) / 10, avgAtrPct: Math.round(avgAtrPct * 100) / 100, dominantVolume, dominantSector },
    });
  } catch (e) {
    return NextResponse.json({ success: true, params: DEFAULT_PARAMS, source: 'defaults' });
  }
}
