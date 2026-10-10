/**
 * GET /api/persona/recommendations
 * =================================
 * Persona-filtered recommendations router.
 *
 * Query: ?persona=investor&market=EGX&limit=20
 *
 * Routing rules:
 *   - persona=investor  → proxy to /api/persona/investor (Python /api/persona/investor)
 *   - persona=gambler   → proxy to /api/persona/gambler  (Python /api/persona/gambler)
 *   - persona=<other>   → proxy to /api/v2/recommend     (works in Python)
 *   - persona omitted   → proxy to /api/v2/recommend
 *
 * Response shape (Flutter reads either `recommendations` or `data`):
 *   { success: true, recommendations: [...], data: [...], count, persona, market, source }
 *
 * Always returns HTTP 200 with arrays (possibly empty) so the Flutter
 * `getPersonaRecommendations()` helper never throws.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getPython(path: string, timeoutMs = 15000): Promise<any | null> {
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

function pickList(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const key of ['recommendations', 'stocks', 'results', 'data']) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const persona = searchParams.get('persona') || '';
    const market  = searchParams.get('market')  || 'EGX';
    const limit   = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '20', 10) || 20));

    const qs = `market=${encodeURIComponent(market)}&limit=${limit}`;

    // 1) Route to the persona-specific Python endpoint
    let upstream: any = null;
    let upstreamPath = '';
    if (persona === 'investor') {
      upstreamPath = `/api/persona/investor?${qs}`;
      upstream = await getPython(upstreamPath);
    } else if (persona === 'gambler') {
      upstreamPath = `/api/persona/gambler?${qs}`;
      upstream = await getPython(upstreamPath);
    } else {
      upstreamPath = `/api/v2/recommend?${qs}${persona ? `&persona=${encodeURIComponent(persona)}` : ''}`;
      upstream = await getPython(upstreamPath);
    }

    const items = pickList(upstream).slice(0, limit);

    return NextResponse.json({
      success: true,
      recommendations: items,
      data: items,                        // alias for Flutter `response.data['data']` fallback
      stocks: items,                      // alias for some Next.js routes that use `stocks`
      count: items.length,
      persona: persona || 'balanced',
      market,
      limit,
      source: items.length ? (upstream?.source || 'python') : 'empty',
      upstream_path: upstreamPath,
      timestamp: new Date().toISOString(),
      message_en: items.length
        ? undefined
        : 'No recommendations available from upstream — backend data sources may be empty.',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'فشل جلب توقعات الشخصية',
        error_en: 'Failed to fetch persona recommendations',
        details: error instanceof Error ? error.message : String(error),
        recommendations: [],
        data: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}
