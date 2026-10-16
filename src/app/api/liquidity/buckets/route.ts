/**
 * liquidity/buckets/route.ts — Liquidity Buckets Proxy (TASK-BACKEND-BRAVO)
 * =============================================================================
 *
 * Route:  GET /api/liquidity/buckets?market=EGX
 *
 * Thin proxy to the Python Flask blueprint `canonical_flow_bp` at
 *   http://127.0.0.1:8010/api/liquidity/buckets?market=<market>
 *
 * The Python side computes the 4 mutually-exclusive bucket lists + neutral:
 *   whale_inflow | whale_outflow | bottom_absorption |
 *   correction_exhaustion | neutral
 * Each bucket is a list of { ticker, name_ar, sector, current_price,
 * change_pct, net_flow_5d, bucket_reason }.
 *
 * On Python failure (timeout / unreachable / non-200): return 503 with
 *   { success: false, buckets: {}, error: 'unavailable' }.
 *
 * Rule 20 (Python = brain). Rule 27 (NO-FAKE-DATA). Rule 67 (CANONICAL).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PYTHON_TIMEOUT_MS = 8000; // buckets is a heavier scan (whole market)
const PYTHON_BASE_URL = 'http://127.0.0.1:8010';
const DEFAULT_MARKET = 'EGX';

export async function GET(req: NextRequest) {
  const market = (req.nextUrl.searchParams.get('market') || DEFAULT_MARKET)
    .trim()
    .toUpperCase() || DEFAULT_MARKET;

  const upstreamUrl = `${PYTHON_BASE_URL}/api/liquidity/buckets?market=${encodeURIComponent(market)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PYTHON_TIMEOUT_MS);

  try {
    const res = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          buckets: {},
          error: 'unavailable',
          error_ar: 'تعذّر قراءة تصنيفات السيولة من الخادم.',
          upstream_status: res.status,
        },
        { status: 503 }
      );
    }

    const json = await res.json();
    return NextResponse.json(json, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        success: false,
        buckets: {},
        error: 'unavailable',
        error_ar: 'خدمة تصنيف السيولة غير متاحة حالياً. حاول لاحقاً.',
      },
      { status: 503 }
    );
  } finally {
    clearTimeout(timer);
  }
}
