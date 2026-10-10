/**
 * POST /api/ai/analyze-stock
 * ==========================
 * Flutter compat endpoint — تحليل AI للسهم.
 *
 * Body: { ticker: string, market?: string }
 *
 * الاستراتيجية:
 *   1. لو فيه Python maestro على :8010 → proxy له (أفضل تحليل)
 *   2. لو Python مفقود/فشل → اقرأ من predictions.db:
 *      a. stored_analyses (آخر تحليل Maestro مُخزَّن للسهم)
 *      b. predictions (آخر توقعات للسهم + إحصائيات)
 *   3. لو مفيش بيانات إطلاقاً → {success: false, error: 'no analysis available'}
 *
 * مهم: لا يُرجع mock data إطلاقاً.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { getStockBySymbol, marketCodeToArabic } from '@/lib/data-engine-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fs = require('fs');
const path = require('path');

const PREDICTIONS_DB_PATH = path.join(process.cwd(), 'db', 'predictions.db');
const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

function dbExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch { // silent fallback (safe-by-design)
    return false;
  }
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface StoredAnalysisRow {
  ticker: string;
  market: string | null;
  signal: string | null;
  maestro_score: number | null;
  confidence: number | null;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  risk_reward: number | null;
  technical_score: number | null;
  fundamental_score: number | null;
  ai_decision: string | null;
  ai_confidence: number | null;
  ai_reason: string | null;
  ai_narrative: string | null;
  ai_updated_at: string | null;
  analysis_json: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface PredictionRow {
  id: number;
  ticker: string;
  signal: string | null;
  signal_type: string | null;
  prediction_date: string | null;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  master_score: number | null;
  technical_score: number | null;
  fundamental_score: number | null;
  ai_pattern_score: number | null;
  sentiment_score: number | null;
  outcome_date: string | null;
  exit_price: number | null;
  actual_return: number | null;
  status: string | null;
  confidence: number | null;
  market: string | null;
}

function tryPythonProxy(ticker: string, market: string): Promise<any | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  return fetch(`${PY}/api/maestro/stock/${encodeURIComponent(ticker)}?market=${encodeURIComponent(market)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: controller.signal,
    cache: 'no-store',
  }).then(async (res) => {
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  }).catch(() => null);
}

function fetchStoredAnalysis(db: any, ticker: string): StoredAnalysisRow | null {
  try {
    // FRESHNESS-CHECK (Task PHASE-3, Rule 72)
    // TODO: Add `AND updated_at >= datetime('now', '-2 days')` to filter stale analyses.
    //       Currently a row from 2 weeks ago appears "alive" — users see old predictions.
    const row = db.prepare(`
      SELECT * FROM stored_analyses WHERE ticker = ? COLLATE NOCASE LIMIT 1
    `).get(ticker) as StoredAnalysisRow | undefined;
    return row ?? null;
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

function fetchRecentPredictions(db: any, ticker: string, limit: number): PredictionRow[] {
  try {
    return db.prepare(`
      SELECT id, ticker, signal, signal_type, prediction_date, entry_price,
             target_price, stop_loss, master_score, technical_score,
             fundamental_score, ai_pattern_score, sentiment_score,
             outcome_date, exit_price, actual_return, status, confidence, market
      FROM predictions
      WHERE ticker = ? COLLATE NOCASE
      ORDER BY prediction_date DESC
      LIMIT ?
    `).all(ticker, limit) as PredictionRow[];
  } catch { // silent fallback (safe-by-design)
    try {
      return db.prepare(`
        SELECT id, ticker, signal_type, prediction_date, entry_price,
               target_price, stop_loss, master_score, technical_score,
               fundamental_score, ai_pattern_score, sentiment_score,
               outcome_date, exit_price, actual_return, status, confidence, market
        FROM predictions
        WHERE ticker = ? COLLATE NOCASE
        ORDER BY prediction_date DESC
        LIMIT ?
      `).all(ticker, limit) as PredictionRow[];
    } catch { // silent fallback (safe-by-design)
      return [];
    }
  }
}

function computePredictionStats(preds: PredictionRow[]) {
  let wins = 0, losses = 0, expired = 0, pending = 0, total = 0;
  let returnsSum = 0, returnsCount = 0;
  for (const p of preds) {
    total++;
    const status = String(p.status || '').trim();
    const ret = safeNum(p.actual_return);
    if (ret !== 0) {
      returnsSum += ret;
      returnsCount++;
    }
    if (['TARGET_HIT', 'closed_win', 'WIN', 'win'].includes(status)) wins++;
    else if (['closed_stop', 'STOPPED', 'LOSS', 'loss'].includes(status)) losses++;
    else if (['EXPIRED', 'expired', 'CLOSED'].includes(status)) expired++;
    else pending++;
  }
  const resolved = wins + losses;
  return {
    total,
    resolved,
    wins,
    losses,
    expired,
    pending,
    win_rate: resolved > 0 ? Math.round((wins / resolved) * 10000) / 100 : 0,
    avg_return: returnsCount > 0 ? Math.round((returnsSum / returnsCount) * 10000) / 10000 : 0,
  };
}

export async function POST(req: NextRequest) {
  try {
    // Auth مطلوب (نفس سياسة /api/ai/chat)
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body: { ticker?: string; market?: string } = await req.json().catch(() => ({}));
    const ticker = String(body.ticker || '').trim().toUpperCase();
    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'ticker is required' },
        { status: 400 }
      );
    }
    const market = String(body.market || 'EGX').toUpperCase();
    const marketArabic = marketCodeToArabic(market);

    // 1) جرّب Python maestro أولاً
    const pyResult = await tryPythonProxy(ticker, market);
    if (pyResult && (pyResult.success !== false || pyResult.maestro_score || pyResult.signal)) {
      return NextResponse.json({
        success: true,
        ticker,
        market,
        source: 'python_maestro',
        analysis: pyResult,
        generated_at: new Date().toISOString(),
      });
    }

    // 2) fallback إلى predictions.db (stored_analyses + predictions)
    if (!dbExists(PREDICTIONS_DB_PATH)) {
      // FIX (FLUTTER-PROD-4): return 200 + analysis: null بدل 404.
      // السبب: Flutter app بيتعامل مع 4xx/5xx كـ exception ويطلّع error toast.
      // لكن "مفيش تحليل متاح" مش خطأ — دي حالة طبيعية لما السهم جديد.
      // Rule 27 (NO-FAKE-DATA): analysis: null (مش fabricated).
      return NextResponse.json({
        success: true,
        ticker,
        market,
        source: 'unavailable',
        analysis: null,
        message: 'لا يوجد تحليل AI متاح حالياً لهذا السهم — جرّب لاحقاً',
      }, { status: 200 });
    }

    let db: any;
    try {
      const Database = require('better-sqlite3');
      db = new Database(PREDICTIONS_DB_PATH, { readonly: true });
    } catch (e) {
      // FIX (FLUTTER-PROD-4): 200 بدل 500 — نفس المنطق فوق
      return NextResponse.json({
        success: true,
        ticker,
        market,
        source: 'unavailable',
        analysis: null,
        message: 'تعذّر فتح قاعدة بيانات التحليلات',
      }, { status: 200 });
    }

    const stored = fetchStoredAnalysis(db, ticker);
    const recentPreds = fetchRecentPredictions(db, ticker, 20);
    db.close();

    if (!stored && recentPreds.length === 0) {
      // FIX (FLUTTER-PROD-4): 200 بدل 404 — مفيش بيانات مش = خطأ
      return NextResponse.json({
        success: true,
        ticker,
        market,
        source: 'empty',
        analysis: null,
        message: 'لا يوجد تحليل أو توقعات لهذا السهم حالياً',
      }, { status: 200 });
    }

    // قراءة السعر الحالي من data_engine.db.stocks
    let currentPrice = 0;
    let stockName: string | null = null;
    try {
      const stock = getStockBySymbol(ticker);
      if (stock) {
        currentPrice = safeNum(stock.price);
        stockName = stock.name;
      }
    } catch { // silent fallback (safe-by-design)
      /* safe skip */
    }

    const stats = computePredictionStats(recentPreds);

    // لو فيه analysis_json في stored_analyses، رجعه كـ full_analysis
    let fullAnalysis: unknown = null;
    if (stored?.analysis_json) {
      try {
        fullAnalysis = JSON.parse(stored.analysis_json);
      } catch { // silent fallback (safe-by-design)
        fullAnalysis = null;
      }
    }

    return NextResponse.json({
      success: true,
      ticker,
      market,
      market_arabic: marketArabic,
      source: 'predictions.db',
      stock_name: stockName,
      current_price: currentPrice,
      stored_analysis: stored ? {
        ticker: stored.ticker,
        market: stored.market,
        signal: stored.signal,
        maestro_score: stored.maestro_score != null ? safeNum(stored.maestro_score) : null,
        confidence: stored.confidence != null ? safeNum(stored.confidence) : null,
        entry_price: stored.entry_price != null ? safeNum(stored.entry_price) : null,
        target_price: stored.target_price != null ? safeNum(stored.target_price) : null,
        stop_loss: stored.stop_loss != null ? safeNum(stored.stop_loss) : null,
        risk_reward: stored.risk_reward != null ? safeNum(stored.risk_reward) : null,
        technical_score: stored.technical_score != null ? safeNum(stored.technical_score) : null,
        fundamental_score: stored.fundamental_score != null ? safeNum(stored.fundamental_score) : null,
        ai_decision: stored.ai_decision,
        ai_confidence: stored.ai_confidence != null ? safeNum(stored.ai_confidence) : null,
        ai_reason: stored.ai_reason,
        ai_narrative: stored.ai_narrative,
        ai_updated_at: stored.ai_updated_at,
        updated_at: stored.updated_at,
      } : null,
      recent_predictions: recentPreds.slice(0, 5).map(p => ({
        id: p.id,
        signal: p.signal || p.signal_type,
        prediction_date: p.prediction_date,
        entry_price: p.entry_price,
        target_price: p.target_price,
        stop_loss: p.stop_loss,
        status: p.status,
        actual_return: p.actual_return != null ? safeNum(p.actual_return) : null,
        confidence: p.confidence,
      })),
      prediction_stats: stats,
      full_analysis: fullAnalysis,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[POST /api/ai/analyze-stock] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
