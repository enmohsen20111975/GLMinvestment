import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkTrialNotExpired } from '@/lib/subscription-gate';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30; // Python scan takes ~5s for 416 EGX tickers

/**
 * GET /api/maker-radar/wyckoff-screener?market=EGX&phase_filter=C_SPRING&limit=20
 *
 * Thin proxy to the Python backend's `/api/wyckoff-screener` (Flask blueprint
 * `wyckoff_screener_bp` on port 8010). All computation happens in Python
 * (`utils.shared_liquidity.detect_wyckoff_accumulation`) per Rule 20.
 *
 * Response shape (Python):
 *   {
 *     success: true,
 *     market: string,
 *     phase_filter: string,
 *     limit: number,
 *     stocks: Array<{
 *       ticker: string;
 *       name_ar: string;
 *       phase: string;             // 'A_SC' | 'B_CAUSE' | 'C_SPRING' | 'D_SOS' | ...
 *       phase_label_ar: string;
 *       confidence: number;        // 0-100
 *       whale_flow_egp: number;
 *       support, resistance, range_pct, midpoint, lower_third;
 *       in_support_zone: boolean;
 *       vsa_confirmed: boolean;
 *       wash_trade_detected: boolean;
 *       signal_count: number;
 *       is_signal: boolean;
 *       reason: string;
 *       avg_up_volume, avg_down_volume, avg_20d_volume;
 *     }>,
 *     phase_distribution: Record<string, number>,
 *     scanned_count: number,
 *     skipped_count: number,
 *     returned_count: number,
 *     truncated: boolean,
 *     computed_at: string
 *   }
 *
 * Rule 27 (NO-FAKE-DATA): if Python is unreachable, surface an empty list
 * with `success:false` — the UI shows an empty state. Never invent phases.
 */

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = (url.searchParams.get('market') || 'EGX').toUpperCase();
  const phaseFilter = (url.searchParams.get('phase_filter') || 'ALL').toUpperCase();
  const limitRaw = Number(url.searchParams.get('limit') || '20');
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20;

  // PAYWALL: Maker Radar tier — same gate as the exit radar (paid + trial).
  // Wyckoff screener is a Pro-grade feature; anonymous + free-trial-expired
  // users are blocked from server-side enforcement.
  const { userId } = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'WYCKOFF_SCREENER_LOCKED', upgradeUrl: '/pricing' },
      { status: 403 },
    );
  }
  const trial = await checkTrialNotExpired(userId);
  if (!trial.ok) {
    return NextResponse.json(
      { success: false, error: 'WYCKOFF_SCREENER_LOCKED', upgradeUrl: '/pricing' },
      { status: 403 },
    );
  }

  // ─── Proxy to Python (Rule 20 — Node is just a proxy) ────────────────────
  const pyUrl = `${PY}/api/wyckoff-screener?market=${encodeURIComponent(market)}&phase_filter=${encodeURIComponent(phaseFilter)}&limit=${limit}`;
  try {
    const r = await fetch(pyUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json' },
    });

    if (!r.ok) {
      // Forward Python's error envelope if possible.
      let errBody: Record<string, unknown> = {
        success: false,
        error: `python_${r.status}`,
        error_ar: 'تعذّر تشغيل مُفرّز وايكوف من Python. حاول لاحقاً.',
        market,
        phase_filter: phaseFilter,
        stocks: [],
      };
      try {
        const txt = await r.text();
        if (txt) {
          const j = JSON.parse(txt) as Record<string, unknown>;
          errBody = { ...errBody, ...j, success: false };
        }
      } catch {
        // ignore JSON parse failure — keep default error envelope
      }
      return NextResponse.json(errBody, { status: r.status });
    }

    const payload = (await r.json()) as Record<string, unknown>;
    // Pass through as-is (Rule 20 — Node is just a proxy).
    return NextResponse.json(payload, { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[wyckoff-screener] proxy failed:', msg);
    // Rule 27: surface a clear empty-state response — never fabricate.
    return NextResponse.json(
      {
        success: false,
        error: 'backend_unreachable',
        error_ar: 'تعذّر الوصول لخدمة وايكوف. حاول لاحقاً.',
        detail: msg,
        market,
        phase_filter: phaseFilter,
        stocks: [],
        scanned_count: 0,
        returned_count: 0,
      },
      { status: 503 },
    );
  }
}
