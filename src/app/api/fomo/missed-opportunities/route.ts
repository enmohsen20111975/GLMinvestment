/**
 * GET /api/fomo/missed-opportunities — Rule 20 Pure Thin Proxy (paywall-gated)
 * ==============================================================================
 *
 * RULE20-PURE-PROXY (P2-FALLBACK-REMOVAL): Pure thin proxy to Python
 * with a paywall gate (Rule 20 exception — auth/paywall allowed in Node).
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 *   The paywall gate (premium check + ticker obscuring) is the ONLY logic
 *   kept in Node — it's an explicit Rule 20 exception ("auth/subscription/
 *   paywall"). All data fetching + filtering + sorting + FOMO message
 *   construction now lives in the Python endpoint
 *   `/api/fomo/missed-opportunities` (misc_routes.py).
 *
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder empty arrays
 *   returned when Python is unavailable. If Python is down → 503.
 *
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth for
 *   the closed-predictions feed + the FOMO opportunity selection.
 *
 * The previous route had a 117-line SQLite fallback chain that:
 *   - Used `getPredictionsFallback` (Rule 20 violation — direct SQLite reads)
 *   - Filtered + sorted + sliced in Node (computation in Node)
 *   - Returned `source: 'sqlite_fallback'` / `source: 'sqlite_fallback_empty'`
 *     (Rule 27 violation — placeholder data masquerading as a real response)
 *   - Had a `try/catch` returning `source: 'sqlite_fallback_empty'` on ANY
 *     internal error (silent failure — masked real bugs)
 *
 * Flow:
 *   1. Check paywall (premium users see no FOMO — empty array, no Python call)
 *   2. Non-premium → proxy to Python `/api/fomo/missed-opportunities`
 *   3. Non-premium → obscure tickers (🔒 + _locked=true) in the response
 *      (paywall display transformation — Rule 20 exception)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPaywallUser } from '@/lib/paywall';

export const dynamic = 'force-dynamic';

const PY =
  process.env.EGXPY_SERVICE_URL ||
  process.env.PYTHON_BACKEND_URL ||
  'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  // 1. Paywall gate — premium users never see FOMO prompts
  let user: { is_premium: boolean; subscription_tier: string } = {
    is_premium: false,
    subscription_tier: 'free',
  };
  try {
    user = await getPaywallUser(req);
  } catch (e) {
    console.error('[fomo:missed-opportunities] paywall check failed:', e);
    // safe default: treat as free user (will see FOMO prompt)
  }

  if (user.is_premium) {
    return NextResponse.json({
      success: true,
      is_premium: true,
      missed_count: 0,
      missed_opportunities: [],
      message: '',
    });
  }

  // 2. Non-premium → proxy to Python (the canonical missed-opportunities feed)
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/fomo/missed-opportunities${qs ? `?${qs}` : ''}`;

  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `python-returned-${res.status}`,
          message:
            'تعذّر جلب الفرص الفائتة — Python backend أرجع خطأ',
        },
        { status: 502 }
      );
    }

    const data = await res.json();

    // 3. Paywall display transformation: obscure tickers for non-premium users
    //    (Rule 20 exception — auth/paywall display transformation only)
    if (data && Array.isArray(data.missed_opportunities)) {
      data.missed_opportunities = data.missed_opportunities.map(
        (p: Record<string, unknown>) => ({
          ...p,
          ticker: '🔒',
          _locked: true,
        })
      );
    }

    // Mark as non-premium (the Python endpoint defaults is_premium=false,
    // but we override here so the Flutter client trusts the Node-side gate)
    data.is_premium = false;

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source':
          data.source || 'python-canonical-fomo-missed-opportunities',
      },
    });
  } catch (error) {
    console.error(
      '[fomo:missed-opportunities] Python backend unavailable:',
      error
    );
    return NextResponse.json(
      {
        success: false,
        error: 'python-backend-unavailable',
        message:
          'Python backend غير متاح — لا يمكن عرض فرص وهمية (Rule 27)',
        rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
      },
      { status: 503 }
    );
  }
}
