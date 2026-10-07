import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { getStockByTickerFallback } from '@/lib/flutter-sqlite-fallback';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkTrialNotExpired } from '@/lib/subscription-gate';

export const dynamic = 'force-dynamic';

// GET /api/stocks/[ticker]
// ------------------------
// Primary: Python backend (rich data — fair_value, change_1w/1m, etc.)
// Fallback (FLUTTER-FULL-AUDIT): stocks.db via better-sqlite3 (readonly).
//   Without this fallback the Flutter app's stock-detail screen shows
//   "connection error" whenever the Python service is down — but the
//   underlying stock record IS available in stocks.db. We return it with
//   `source: 'sqlite_fallback'` so the Flutter client can degrade cleanly.
//
// PAYWALL Phase 2 — Gate 1 (P0-4, killer feature):
//   `fair_value` (القيمة العادلة) is the killer feature per
//   PAYWALL-STRATEGY-FINAL.md §5.2 row 1. Server-side enforcement here
//   means the client-side paywall can no longer be bypassed with `curl`.
//   - Anonymous users (no session) → full data (taste hook per §4).
//   - Authenticated + paid OR within 14-day trial → full data.
//   - Authenticated + free + trial expired → `fair_value = null` +
//     `fair_value_locked: true` (we keep `upside_percent` as the
//     marketing teaser "🔒 +29% فرصة — اشترك").
//   Per Rule 50 — NEVER lock safety fields. fair_value is an insight,
//   not safety (stop loss / portfolio risk remain untouched).

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const { ticker } = params;
  const url = new URL(req.url);
  const qs = url.searchParams.toString();

  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/stocks/${ticker.toUpperCase()}${qs ? `?${qs}` : ''}`,
    `http://127.0.0.1:8010/api/stocks/${ticker.toUpperCase()}${qs ? `?${qs}` : ''}`,
  ];

  // ── Resolve paywall state once, before proxying ─────────────────────
  // Anonymous (no session) → not locked (marketing taste hook).
  // Authenticated → check trial expiry via canonical server-side helper.
  const { userId } = await getSessionUserId();
  let fairValueLocked = false;
  if (userId) {
    const trial = await checkTrialNotExpired(userId);
    if (!trial.ok) {
      // Trial expired AND user is on a non-paid tier → gate applies.
      fairValueLocked = true;
    }
  }

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(applyFairValueGate(data, fairValueLocked));
      }
    } catch (_err) {
      // Try next fallback
    }
  }

  // ── FLUTTER-FULL-AUDIT: stocks.db fallback (Python unreachable) ──
  const fallback = getStockByTickerFallback(ticker);
  if (fallback) {
    return NextResponse.json(applyFairValueGate(fallback, fairValueLocked));
  }

  return NextResponse.json({
    success: false,
    error: `Failed to fetch ticker ${ticker}`,
    ticker: ticker.toUpperCase(),
    source: 'sqlite_fallback_empty',
  }, { status: 200 });
}

/**
 * Apply the fair_value paywall to the stock response.
 *
 * When `locked` is true, we strip `fair_value` (and any derived fair-value
 * carrier fields that would let a curious user reverse-compute it from
 * sibling fields). We KEEP `upside_percent` as the marketing teaser
 * ("🔒 +29% فرصة — اشترك") per PAYWALL-STRATEGY-FINAL.md §1 row 1.
 *
 * The function is defensive: it handles both object and array responses
 * (the Python backend sometimes returns `{ stock: {...} }`, sometimes a
 * bare object, sometimes a list).
 */
function applyFairValueGate(data: unknown, locked: boolean): unknown {
  if (!locked) return data;

  // Helper to gate a single stock-shaped record.
  const gateRecord = (rec: Record<string, unknown>): Record<string, unknown> => {
    const next = { ...rec };
    next.fair_value = null;
    next.fair_value_locked = true;
    // Some Python responses nest fair_value under `fundamentals` or
    // `analysis` — gate those too. Keep `upside_percent` for the teaser.
    if (next.fundamentals && typeof next.fundamentals === 'object') {
      next.fundamentals = {
        ...(next.fundamentals as Record<string, unknown>),
        fair_value: null,
      };
    }
    if (next.analysis && typeof next.analysis === 'object') {
      next.analysis = {
        ...(next.analysis as Record<string, unknown>),
        fair_value: null,
      };
    }
    return next;
  };

  if (Array.isArray(data)) {
    return data.map((r) => (r && typeof r === 'object' ? gateRecord(r as Record<string, unknown>) : r));
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    // Common Python shapes: { stock: {...} } or bare { ticker, fair_value, ... }
    if (obj.stock && typeof obj.stock === 'object') {
      return { ...obj, stock: gateRecord(obj.stock as Record<string, unknown>) };
    }
    return gateRecord(obj);
  }
  return data;
}
