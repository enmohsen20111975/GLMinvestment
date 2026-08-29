/**
 * GET /api/maestro/stock/[ticker]
 *
 * Pure proxy to Python /api/maestro/stock/<ticker>.
 *
 * Rule 20 (Python = brain, Node = display only): removed 482 LOC of Node logic
 * (runMaestroAnalysis + getTickerNewsSentiment + Prisma/data_engine fallbacks +
 * composeConfluenceMaestro). All analysis is in Python maestro_orchestrator.py.
 *
 * Rule 27 (NO-FAKE-DATA): removed Node fallbacks that composed fake maestro-style
 * analysis — no fake data, only Python results.
 *
 * Response shape adaptation (minimal — not business logic):
 * - Python returns: {success, ticker, result, ...}
 * - Frontend expects: {success, data, analysis, ticker, market, persona, source, message}
 * - We map result → data + analysis (one-line mapping)
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const tickerUpper = ticker.toUpperCase();

    const { searchParams } = new URL(request.url);
    const personaType = searchParams.get('persona') || 'balanced';
    const market = searchParams.get('market') || 'EGX';
    const forceRegime = searchParams.get('regime');
    const daysHistory = searchParams.get('days') || '200';

    // Build Python URL with all query params
    const pyParams = new URLSearchParams({
      market,
      persona: personaType,
    });
    if (forceRegime) pyParams.set('force_regime', forceRegime);

    const targetUrl = `${PY}/api/maestro/stock/${encodeURIComponent(tickerUpper)}?${pyParams}`;

    const pyRes = await fetch(targetUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });

    if (!pyRes.ok) {
      return NextResponse.json({
        success: false,
        error: `Python backend returned ${pyRes.status}`,
        ticker: tickerUpper,
        hint: 'تأكد أن Python backend يعمل على ' + PY + '/api/maestro/stock/<ticker>',
      }, { status: pyRes.status === 404 ? 404 : 502 });
    }

    const pyData = await pyRes.json();

    if (pyData.success === false) {
      return NextResponse.json(pyData, { status: 404 });
    }

    // Minimal shape adaptation: map result → data + analysis
    const result = pyData.result || pyData.data || pyData;
    return NextResponse.json({
      success: true,
      data: result,
      analysis: pyData.analysis || result,
      ticker: tickerUpper,
      market,
      persona: personaType,
      source: 'python',
      message: `تم تحليل السهم ${tickerUpper} بنجاح (Python)`,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Unknown error';
    const isTimeout = e instanceof Error && e.name === 'AbortError';
    return NextResponse.json({
      success: false,
      error: isTimeout ? 'انتهت مهلة الطلب' : 'فشل في الاتصال بـ Python Backend',
      details: errMsg,
      hint: 'تأكد أن Python backend يعمل — لا logic في Node (Rule 20)',
    }, { status: isTimeout ? 504 : 502 });
  }
}
