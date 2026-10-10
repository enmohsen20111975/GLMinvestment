/**
 * DEPRECATED (Phase 4 — canonical_signal migration, API-AUDIT-2):
 * ===============================================================
 * This route was a 17-field subset of the canonical
 *   /api/predictions/honest-tracking/list
 * endpoint (which returns 50+ fields: exit_type, persona,
 * target_price_2, target_price_3, master_score, etc.). Per
 * API-AUDIT-2, the duplicate is being retired in favour of the
 * canonical route so all consumers see the same rich schema.
 *
 * Rule 4 (NO-NEW-FILES / NO-DELETION): file intentionally kept so
 * existing callers (Flutter app, old dashboards) don't 404.
 * Rule 27 (NO-FAKE-DATA): returns a proper HTTP 410 Gone with a
 * clear `deprecated: true` flag — no mock data, no silent pass-through.
 *
 * Migration: switch the request URL to
 *   /api/predictions/honest-tracking/list
 * (same query params: market, status, limit) — the canonical response
 * shape is a strict superset of this deprecated route.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const canonicalUrl = `/api/predictions/honest-tracking/list${url.search ? `?${url.searchParams.toString()}` : ''}`;
  return NextResponse.json(
    {
      success: false,
      deprecated: true,
      error: 'endpoint_deprecated',
      error_ar:
        'تم إيقاف هذا الـ endpoint — استخدم /api/predictions/honest-tracking/list بدلاً منه (نفس البارامترات: market, status, limit).',
      deprecated_at: '2026-10-15',
      canonical_route: '/api/predictions/honest-tracking/list',
      canonical_url: canonicalUrl,
      message: 'Use /api/predictions/honest-tracking/list instead',
      dropped_fields_count: 17,
      canonical_fields_count: 50,
    },
    { status: 410 }
  );
}
