/**
 * POST /api/v2/unified/analyze
 * =============================
 * Unified single-stock analysis endpoint.
 *
 * Body:
 *   { ticker: "COMI", market: "EGX", persona: "investor", support?, resistance? }
 *
 * Returns:
 *   { success: true, analysis: { ticker, persona, market, score, recommendation, ... } }
 *
 * Behaviour:
 *   1. Try Python `${PY}/api/v2/unified/analyze` first (POST pass-through).
 *   2. If Python 404s or fails, compose a unified analysis by combining:
 *        - /api/confluence/analyze/<ticker>   (200 from Python — board consensus)
 *        - /api/stocks/dual-persona/<ticker>  (stored_analysis → live maestro/persona)
 *      Then merge into a single { score, recommendation, signals, opinions, ... } payload.
 *   3. Always returns HTTP 200 with `success: true` so the Flutter UI renders.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function postPython(path: string, body: any, timeoutMs = 15000): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${PY}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getPython(path: string, timeoutMs = 12000): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${PY}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function num(v: any, fallback: number = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function signalToScore(signal: any, baseline = 50): number {
  if (typeof signal === 'number') return Math.min(100, Math.max(0, signal));
  const s = String(signal || '').toLowerCase();
  if (s.includes('strong buy') || s.includes('شراء قوي')) return 90;
  if (s.includes('buy')        || s.includes('شراء'))     return 75;
  if (s.includes('hold')       || s.includes('انتظار') || s.includes('متابعة') || s.includes('حياد')) return 55;
  if (s.includes('sell')       || s.includes('بيع'))     return 30;
  if (s.includes('strong sell')|| s.includes('بيع قوي')) return 15;
  return baseline;
}

function scoreToRecommendation(score: number): { recommendation: string; recommendation_ar: string } {
  if (score >= 75) return { recommendation: 'STRONG_BUY',  recommendation_ar: 'شراء قوي'  };
  if (score >= 70) return { recommendation: 'BUY',         recommendation_ar: 'شراء'      };
  if (score >= 60) return { recommendation: 'HOLD',        recommendation_ar: 'انتظار'    };
  if (score >= 50) return { recommendation: 'REDUCE',      recommendation_ar: 'تقليل'     };
  return { recommendation: 'AVOID', recommendation_ar: 'تجنب' };
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Empty body — fall through to 400-ish path
    }

    const ticker     = String(body.ticker || '').toUpperCase();
    // PHASE3-MARKET-SEGREGATION: قبول أي alias للسوق السعودي (TADAWUL/KSA/السعودية)
    // + تطبيع الـ alias للـ canonical قبل ما نبعت للـ Python. Python unified_config.py
    // بيستخدم 'KSA' كمفتاح MarketProfile، فلو وصلها 'TADAWUL' بـ ترجّع None وبيفشل.
    // pythonMarketCode() بـ يحوّل TADAWUL→KSA، وباقي الأسواق زي ما هي.
    const rawMarket  = String(body.market || 'EGX');
    const { normalizeMarket, pythonMarketCode } = await import('@/lib/market-utils');
    const canonicalMarket = normalizeMarket(rawMarket) ?? 'EGX';
    const market     = pythonMarketCode(canonicalMarket);
    body.market = market;  // overwrite body before forwarding to Python
    const persona    = String(body.persona || 'balanced');
    const support    = body.support    != null ? num(body.support,    0) : null;
    const resistance = body.resistance != null ? num(body.resistance, 0) : null;

    if (!ticker) {
      return NextResponse.json(
        {
          success: false,
          error: 'السهم مطلوب',
          error_en: 'ticker is required',
          analysis: null,
        },
        { status: 400 }
      );
    }

    // 1) Try Python unified/analyze
    const pyResp = await postPython('/api/v2/unified/analyze', body);
    if (pyResp && (pyResp.success !== false) && (pyResp.analysis || pyResp.score != null)) {
      return NextResponse.json({
        success: true,
        analysis: pyResp.analysis || pyResp,
        ticker,
        market,
        persona,
        source: 'python',
      });
    }

    // 2) Compose locally from confluence + dual-persona
    const [confluence, dualPersona] = await Promise.all([
      getPython(`/api/confluence/analyze/${encodeURIComponent(ticker)}`),
      getPython(`/api/maestro/persona/${encodeURIComponent(ticker)}?persona=all`).catch(() => null),
    ]);

    // ---- Build the unified analysis object ----
    const boardConsensus = confluence?.board_consensus || confluence?.consensus || confluence;
    const opinions = boardConsensus?.opinions || {};

    // Master score from confluence (0..100) → use as a baseline
    let score = num(boardConsensus?.master_score, 50);

    // Persona overlay from /api/maestro/persona/<ticker>
    const personaBlock: any = dualPersona?.[persona] || dualPersona?.persona_block || null;
    if (personaBlock) {
      const pScore = signalToScore(personaBlock.signal, score);
      // Blend persona score (60%) with confluence master score (40%)
      score = Math.round(pScore * 0.6 + score * 0.4);
    } else {
      // No persona overlay — nudge score based on persona weights alone
      if (persona === 'gambler')  score = Math.min(100, score + 5);
      if (persona === 'investor') score = Math.max(0,  score - 5);
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const rec = scoreToRecommendation(score);

    // Build signals list from confluence opinions
    const signals: any[] = [];
    for (const [key, opinion] of Object.entries(opinions)) {
      const op = opinion as any;
      signals.push({
        engine: key,
        name: op.name || key,
        name_en: key,
        signal: op.signal || null,
        signal_ar: op.signal_ar || op.signal || null,
        confidence: num(op.confidence, 0),
        reason: op.reason_ar || op.reason || op.details || null,
        score: signalToScore(op.signal, 50),
      });
    }

    const entry  = personaBlock?.entry ?? boardConsensus?.entry_price ?? null;
    const target = personaBlock?.target ?? null;
    const stop   = personaBlock?.stop ?? null;

    const analysis = {
      ticker,
      market,
      persona,
      price: dualPersona?.price ?? dualPersona?.stock_info?.current_price ?? null,
      score,
      recommendation: rec.recommendation,
      recommendation_ar: rec.recommendation_ar,
      confidence: Math.round(score),
      signals,
      opinions,
      entry,
      target,
      stop,
      support,
      resistance,
      gambler:  dualPersona?.gambler  || null,
      investor: dualPersona?.investor || null,
      narrative: dualPersona?.narrative || null,
      story_arc: dualPersona?.story || confluence?.story_arc || null,
      generated_at: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      analysis,
      ticker,
      market,
      persona,
      source: confluence ? 'next-composed' : 'next-placeholder',
      message_en: confluence
        ? 'Unified analysis composed from /api/confluence/analyze and /api/maestro/persona.'
        : 'No live data sources available; returning a minimal placeholder analysis.',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'فشل التحليل الموحد للسهم',
        error_en: 'Unified stock analysis failed',
        details: error instanceof Error ? error.message : String(error),
        analysis: null,
      },
      { status: 500 }
    );
  }
}
