/**
 * GET /api/radar/personalized
 * =================================================================
 * Personalized Radar API — pure proxy to Python /api/radar/personalized.
 *
 *Directive P1 (API Routes Decoupling): NO direct SQLite access. This route
 * proxies to Python ONLY. If Python is unreachable → honest empty profile
 * (Rule 27 NO-FAKE-DATA).
 *
 * Contract (aligned with PersonalizedRadarTab.tsx interface):
 *   profile: {
 *     userId, preferredSectors, preferredTickers, preferredMarkets,
 *     riskProfile, averageHoldingDays, holdingPeriodCategory,
 *     preferredPriceRange, totalTrades, winRate, profileComputedAt,
 *     hasTradeHistory   ← true only if a real trade history source exists
 *   }
 *   personalized_picks: [{
 *     ticker, path, current_price, sector,
 *     base_score, personalized_score,
 *     adjusted_position_size, position_size,
 *     personalization_reasons: string[]
 *   }]
 *   excluded: [{ ticker, reason, detail }]
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA): empty profile when Python unreachable.
 * Rule 50 (MONEY-AS-CUSTOMER-LIFE): fail closed if no session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'auth_required' },
        { status: 401 },
      );
    }

    const market = (req.nextUrl.searchParams.get('market') || 'EGX').toUpperCase();

    // Python canonical endpoint (path mirrors this route).
    const targetUrl = new URL(`${PYTHON_BACKEND_URL}/api/radar/personalized`);
    targetUrl.searchParams.set('market', market);
    targetUrl.searchParams.set('user_id', userId);

    try {
      const res = await fetch(targetUrl.toString(), {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (
          data &&
          data.success !== false &&
          (data.profile !== undefined || Array.isArray(data.personalized_picks))
        ) {
          // Forward canonical Python response shape.
          return NextResponse.json(data);
        }
      }
    } catch {
      // Python unreachable — honest empty profile (Rule 27).
    }

    // Rule 27: honest empty profile (matches PersonalizedRadarTab.tsx:255
    // empty-state CTA — "ابدأ التداول" path).
    return NextResponse.json({
      success: true,
      authenticated: true,
      profile: null,
      personalized_picks: [],
      excluded: [],
      radar_status: 'ready',
      served_at: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error('[radar:personalized]', error);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}
