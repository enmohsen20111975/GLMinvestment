/**
 * dossier/[ticker]/route.ts — Conviction Dossier Proxy (TASK-BACKEND-BRAVO)
 * =============================================================================
 *
 * Route:  GET /api/recommendations/dossier/[ticker]
 *
 * Thin proxy to the Python Flask blueprint `conviction_dossier_bp` at
 *   http://127.0.0.1:8010/api/recommendations/dossier/<ticker>
 *
 * The Python side computes:
 *   - whale_flow_history (last 5 sessions, net_flow_egp + volume)
 *   - historical_win_rate (from ExpertRecommendation + real_evaluated_predictions
 *     + stored_analysis if present)
 *   - trade_math (entry/stop/target_1/target_2/rr_ratio/signal + risk/reward
 *     per share)
 *   - technical_rationale (2-sentence Arabic string from real DB values)
 *
 * On Python failure (timeout / unreachable / non-200): return 503 with
 *   { success: false, error: 'dossier_unavailable' }.
 *
 * Rule 20 (Python = brain). Rule 27 (NO-FAKE-DATA). Rule 67 (CANONICAL).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PYTHON_TIMEOUT_MS = 5000;
const PYTHON_BASE_URL = 'http://127.0.0.1:8010';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const resolvedParams = await params;
  const ticker = (resolvedParams?.ticker ?? '').toString().toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'missing_ticker' },
      { status: 400 }
    );
  }

  const upstreamUrl = `${PYTHON_BASE_URL}/api/recommendations/dossier/${encodeURIComponent(ticker)}`;
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
          error: 'dossier_unavailable',
          error_ar: 'تعذّر قراءة ملف الإقناع من الخادم.',
          upstream_status: res.status,
        },
        { status: 503 }
      );
    }

    const json = await res.json();
    return NextResponse.json(json, { status: 200 });
  } catch {
    // Python down / timeout / network error — graceful 503.
    return NextResponse.json(
      {
        success: false,
        error: 'dossier_unavailable',
        error_ar: 'خدمة ملف الإقناع غير متاحة حالياً. حاول لاحقاً.',
      },
      { status: 503 }
    );
  } finally {
    clearTimeout(timer);
  }
}
