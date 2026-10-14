/**
 * Learned Lessons API (P1-GEMS-WIRING → P1-PREDICTIONS-CLUSTER)
 * =============================================================
 * Phase 1 (P1-PREDICTIONS-CLUSTER): pure Python proxy — NO direct SQLite
 * access. This route previously opened `db/predictions.db` directly
 * (`new Database(...)`) and ran multiple `.prepare()` queries against the
 * `learned_lessons` table. That violated Rule 4. Now it proxies to
 * `${PYTHON_BACKEND_URL}/api/predictions/learned-lessons` and passes the
 * response through verbatim. If Python is unreachable → honest empty
 * (Rule 27 NO-FAKE-DATA).
 *
 * Response shape is preserved (success, total, returned, filters,
 * conditions, lessons).
 *
 * GET /api/predictions/learned-lessons?limit=50&condition=X
 *   → { success, total, returned, filters, conditions, lessons }
 *
 * Query params:
 *   - limit     (default 50, max 500)
 *   - condition (LIKE substring filter, optional)
 *   - outcome   (success|failure, optional)
 *   - sort      (occurrences|failure_rate|avg_return|updated_at — default occurrences DESC)
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

const SORTABLE = new Set(['occurrences', 'failure_rate', 'avg_return', 'updated_at']);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  const condition = url.searchParams.get('condition');
  const outcome = url.searchParams.get('outcome');
  const sortParam = url.searchParams.get('sort') || 'occurrences';

  // Clamp limit to [1, 500], default 50
  let limit = 50;
  if (limitParam) {
    const n = parseInt(limitParam, 10);
    if (Number.isFinite(n)) limit = Math.min(500, Math.max(1, n));
  }
  const sort = SORTABLE.has(sortParam) ? sortParam : 'occurrences';

  // Build query string for Python — forward all filters.
  const qs = new URLSearchParams({
    limit: String(limit),
    sort,
  });
  if (condition) qs.set('condition', condition);
  if (outcome) qs.set('outcome', outcome);

  // Python canonical endpoints (primary + direct fallback).
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/predictions/learned-lessons?${qs.toString()}`,
    `http://127.0.0.1:8010/api/predictions/learned-lessons?${qs.toString()}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data || data.success === false) continue;

      const lessons = Array.isArray(data.lessons) ? data.lessons : [];
      const conditions = Array.isArray(data.conditions) ? data.conditions : [];

      return NextResponse.json({
        success: true,
        total: data.total ?? lessons.length,
        returned: lessons.length,
        filters: { limit, condition: condition || null, outcome: outcome || null, sort },
        conditions,
        lessons,
        source: data.source || 'python_backend',
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      // Try next fallback URL (safe-by-design).
    }
  }

  // Rule 27: honest empty — no fabricated lesson rows.
  return NextResponse.json({
    success: true,
    total: 0,
    returned: 0,
    filters: { limit, condition: condition || null, outcome: outcome || null, sort },
    conditions: [],
    lessons: [],
    source: 'python_empty',
    message: 'لا توجد بيانات',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
