/**
 * GET /api/stored-analysis/results
 *
 * Proxy route: يمرر الطلب للـ Python backend (/api/stored-analysis/results)
 * ويرجع النتائج للـ Next.js frontend.
 *
 * هذا الملف موجود عشان Next.js يقدر يوصل للـ Python backend
 * لو الـ CORS blocked أو الـ frontend مش عارف الـ VPS URL مباشرة.
 *
 * المعمارية: Python = الدماغ، Node.js = العرض فقط
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPaywallUser, applyPaywallToResults } from '@/lib/paywall';

const PYTHON_BACKEND =
  process.env.PYTHON_BACKEND_URL ||
  process.env.VPS_API_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://localhost:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'EGX';
  const limit = searchParams.get('limit') || '300';
  const minScore = searchParams.get('min_score') || '0';
  // P16-PERSONA-DIVERGENCE: تمرير persona param للـ Python backend
  // عشان يفلتر ويرتّب الأسهم بمنطق مختلف لكل persona.
  const persona = searchParams.get('persona') || '';
  const recommendation = searchParams.get('recommendation') || '';

  const params = new URLSearchParams({
    market,
    limit,
    min_score: minScore,
  });
  if (persona) params.set('persona', persona);
  if (recommendation) params.set('recommendation', recommendation);

  const backendUrl =
    `${PYTHON_BACKEND.replace(/\/$/, '')}/api/stored-analysis/results?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { error: `Backend responded with ${response.status}`, results: [] },
        { status: response.status }
      );
    }

    const data = await response.json();

    // PAYWALL-043: Freemium — شوف اللقطة.. بس متدعكش على البطاطا
    const user = await getPaywallUser(request);
    if (data.results && Array.isArray(data.results)) {
      data.results = applyPaywallToResults(data.results, user.is_premium);
    }
    if (data.data && Array.isArray(data.data)) {
      data.data = applyPaywallToResults(data.data, user.is_premium);
    }
    data._paywall = { is_premium: user.is_premium };

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/stored-analysis/results] proxy error:', msg);
    return NextResponse.json(
      { error: msg, results: [] },
      { status: 502 }
    );
  }
}
