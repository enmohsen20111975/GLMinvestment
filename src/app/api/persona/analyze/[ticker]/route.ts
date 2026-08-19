/**
 * GET /api/persona/analyze/[ticker]
 * ==================================
 * Persona analysis proxy for a single ticker.
 *
 * The Flutter app calls this to fetch both 🏦 investor + 🎰 gambler views
 * for one stock. The existing Next.js endpoint `/api/stocks/dual-persona/[ticker]`
 * already does the heavy lifting (tries stored_analyses → falls back to live
 * /api/maestro/persona/<ticker>). This route is a thin alias that calls it
 * internally and wraps the response in the expected `{success, analysis}` shape.
 *
 * Behaviour:
 *   1. Internally fetch /api/stocks/dual-persona/<ticker> (same Next.js process).
 *   2. Wrap result as `{success: true, analysis: {...}}` for spec compatibility,
 *      while ALSO echoing the dual-persona fields at the top level so any
 *      consumer reading `response.data['investor']` / `['gambler']` keeps working.
 *   3. If dual-persona 404s, synthesize a minimal `analysis` placeholder so the
 *      Flutter UI renders rather than crashing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSelfBaseUrl } from '@/lib/server-url';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getNext(request: NextRequest, path: string, timeoutMs = 15000): Promise<{ ok: boolean; status: number; data: any | null }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const selfBase = getSelfBaseUrl(request);
    const res = await fetch(`${selfBase}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    let data: any = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = (params.ticker || '').toUpperCase();
  const { searchParams } = new URL(request.url);
  const persona = searchParams.get('persona') || 'all';

  try {
    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'ticker is required', error_ar: 'السهم مطلوب', analysis: null },
        { status: 400 }
      );
    }

    // 1) Try Python /api/persona/analyze/<ticker> first (currently 404 — kept for future-proofing)
    if (PY) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const pyRes = await fetch(
          `${PY}/api/persona/analyze/${encodeURIComponent(ticker)}?persona=${encodeURIComponent(persona)}`,
          { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal, cache: 'no-store' }
        );
        clearTimeout(timeout);
        if (pyRes.ok) {
          const pyData = await pyRes.json();
          if (pyData && pyData.success !== false && (pyData.analysis || pyData.investor || pyData.gambler)) {
            return NextResponse.json({
              success: true,
              ticker,
              analysis: pyData.analysis || pyData,
              ...pyData,
              source: 'python',
            });
          }
        }
      } catch {
        // Fall through to Next.js dual-persona
      }
    }

    // 2) Proxy to /api/stocks/dual-persona/<ticker> (existing Next.js route)
    const dual = await getNext(request, `/api/stocks/dual-persona/${encodeURIComponent(ticker)}`);

    if (dual.ok && dual.data && dual.data.success !== false) {
      const d = dual.data;
      const analysis = {
        ticker,
        market: d.market || 'EGX',
        price: d.price ?? null,
        updated_at: d.updated_at ?? null,
        investor: d.investor || null,
        gambler: d.gambler || null,
        story: d.story || null,
        narrative: d.narrative || null,
        source: d.source || 'stored',
      };

      return NextResponse.json({
        success: true,
        ticker,
        analysis,
        // Also echo at top level for backward compatibility with Flutter code
        // that reads response.data['investor'] / ['gambler'] directly.
        investor: d.investor || null,
        gambler: d.gambler || null,
        price: d.price ?? null,
        market: d.market || 'EGX',
        updated_at: d.updated_at ?? null,
        narrative: d.narrative || null,
        story: d.story || null,
        source: d.source || 'stored',
        origin: 'dual-persona-proxy',
      });
    }

    // 3) Synthesize a minimal placeholder so the Flutter UI doesn't crash
    const placeholder = {
      ticker,
      market: 'EGX',
      price: null,
      updated_at: new Date().toISOString(),
      investor: {
        verdict: 'NEUTRAL',
        score: 50,
        signal: 'HOLD',
        reason: 'لا يوجد تحليل مخزّن متاح حالياً للسهم. حاول مرة أخرى لاحقاً.',
        reason_en: 'No stored analysis available for this ticker yet. Please try again later.',
        entry: null,
        target: null,
        stop: null,
        timeframe: 'أسابيع-أشهر',
      },
      gambler: {
        verdict: 'NEUTRAL',
        score: 50,
        signal: 'HOLD',
        reason: 'لا يوجد تحليل فني متاح حالياً للسهم. حاول مرة أخرى لاحقاً.',
        reason_en: 'No live technical analysis available for this ticker yet. Please try again later.',
        entry: null,
        target: null,
        stop: null,
      },
      narrative: null,
      story: null,
      source: 'placeholder',
    };

    return NextResponse.json({
      success: true,
      ticker,
      analysis: placeholder,
      ...placeholder,
      origin: 'placeholder',
      message_en: 'No stored or live persona analysis available — returning a neutral placeholder.',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        ticker,
        error: 'فشل تحليل الشخصيات للسهم',
        error_en: 'Persona analysis failed',
        details: error instanceof Error ? error.message : String(error),
        analysis: null,
      },
      { status: 500 }
    );
  }
}
