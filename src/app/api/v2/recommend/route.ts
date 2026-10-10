import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { normalizeMarket } from '@/lib/market-utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v2/recommend
 * =====================
 * واجهة التوصيات الموحدة — بيستخدمها:
 *   - Flutter app (lib/api/client.dart → getHunterScreener + getRecommendations)
 *   - Web app dashboard
 *
 * ARCH-OPTION-2 + FILTERS-2 (2026-10-10):
 *   - لو Python معطّل، الـ fallback كان بيرجع market='EGX' hardcoded.
 *     ده غلط — كان بيخلي TADAWUL/US/CRYPTO/KSE/QSE كلها ترجع كأنها EGX.
 *   - دلوقتي الـ fallback بيرجع الـ market الحقيقي من query params.
 *   - بردو بنطبّق normalizeMarket() عشان نحوّل الـ aliases (KSA → TADAWUL).
 *
 * Rule 27 (NO-FAKE-DATA): fallback بيرجع recommendations: [] فارغة
 * (مش fabricate توصيات وهمية)، بس بيرجع الـ market الحقيقي.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PYTHON_BACKEND_URL}/api/v2/recommend${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
    // Python returned error → honest fallback with REAL market (not 'EGX')
    const marketRaw = url.searchParams.get('market') || 'EGX';
    const canonicalMarket = normalizeMarket(marketRaw) || 'EGX';
    return NextResponse.json({
      success: true,
      recommendations: [],
      market: canonicalMarket,
      source: 'next-fallback',
      message: 'Python backend unavailable — returning empty recommendations (NO-FAKE-DATA).',
    });
  } catch (e) {
    // Network error / timeout → honest fallback with REAL market
    const url = new URL(req.url);
    const marketRaw = url.searchParams.get('market') || 'EGX';
    const canonicalMarket = normalizeMarket(marketRaw) || 'EGX';
    return NextResponse.json({
      success: true,
      recommendations: [],
      market: canonicalMarket,
      source: 'next-fallback',
      message: 'Python backend unreachable — returning empty recommendations (NO-FAKE-DATA).',
    });
  }
}
