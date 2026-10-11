import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * DEPRECATED (Phase 4 — canonical_signal migration, API-AUDIT-2):
 * ===============================================================
 * This route duplicates /api/maestro/overview (both proxy the Python
 * `/api/market-pulse` endpoint). The canonical route is
 *   /api/maestro/overview
 *
 * Rule 4 (NO-NEW-FILES / NO-DELETION): file intentionally kept so
 * existing callers don't 404. Rule 27 (NO-FAKE-DATA): returns a
 * proper HTTP 410 Gone with a clear `deprecated: true` flag — no
 * mock data, no silent pass-through.
 *
 * Old clients → 410 + JSON deprecation notice pointing to canonical.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const canonicalUrl = `/api/maestro/overview${url.search ? `?${url.searchParams.toString()}` : ''}`;
  return NextResponse.json(
    {
      success: false,
      deprecated: true,
      error: 'endpoint_deprecated',
      error_ar:
        'تم إيقاف هذا الـ endpoint — استخدم /api/maestro/overview بدلاً منه.',
      deprecated_at: '2026-10-15',
      canonical_route: '/api/maestro/overview',
      canonical_url: canonicalUrl,
      message: 'Use /api/maestro/overview instead',
    },
    { status: 410 }
  );
}
