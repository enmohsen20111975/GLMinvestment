/**
 * Predictions API
 * ===============
 * Phase 1 (P1-PREDICTIONS-CLUSTER): pure Python proxy — NO direct SQLite access.
 *
 * Directive P1: this route previously opened `db/predictions.db` directly
 * (both the ticker-scoped branch and the public SQLite fallback) and ran
 * raw `.prepare()` queries against `predictions` + `stored_analyses`. That
 * violated Rule 4 (Python = brain). Now both branches proxy to Python
 * `${PYTHON_BACKEND_URL}/api/v2/predictions` and pass the response through
 * verbatim. If Python is unreachable → honest empty (Rule 27).
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getSessionUserId } from '@/lib/auth-helper';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { trialExpiredResponse } from '@/lib/subscription-gate';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const revalidate = 30; // Cache for 30s

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get('type') || 'all';
  const requestedLimit = searchParams.get('limit') || '5';
  const market = searchParams.get('market') || '';
  // Task 44-A: optional ticker filter so SpecialistAnalysisView can fetch the
  // per-stock prediction history. The ticker is now forwarded to Python
  // (canonical engine) instead of opening predictions.db at route level.
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();

  // Task 40-C: Maximum 5 predictions per owner directive.
  const HARD_CAP = 5;
  const finalLimit = Math.min(parseInt(requestedLimit, 10) || HARD_CAP, HARD_CAP);

  // Task 13: limit unauthenticated visitors to 3 predictions.
  const { userId } = await getSessionUserId();
  const isAuthenticated = !!userId;
  const limit = isAuthenticated ? String(finalLimit) : String(Math.min(finalLimit, 3));

  // FIX-P3-P5-P6 (Group P3 — Fix 1): server-side trial expiry gate.
  if (isAuthenticated) {
    const trialBlock = await trialExpiredResponse(userId);
    if (trialBlock) {
      return NextResponse.json(trialBlock.body, { status: trialBlock.status });
    }
  }

  // ─── Primary (and only) source: Python canonical engine ───────────────
  // Build query string — forward all filters to Python so it can scope the
  // response (signal type, market, ticker, limit).
  const qs = new URLSearchParams({ limit });
  if (type && type !== 'all') qs.set('signal', type);
  if (market) qs.set('market', market);
  if (ticker) qs.set('ticker', ticker);

  // Python canonical endpoints (primary + direct fallback + mirror path).
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/v2/predictions?${qs.toString()}`,
    `http://127.0.0.1:8010/api/v2/predictions?${qs.toString()}`,
    `${PYTHON_BACKEND_URL}/api/predictions?${qs.toString()}`,
    `http://127.0.0.1:8010/api/predictions?${qs.toString()}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const predictions = data.predictions || data.data || [];
      if (Array.isArray(predictions)) {
        // Pass through Python response verbatim (Rule 4: mirror only).
        // Normalize stats shape so consumers see a stable contract.
        const stats = data.stats || {};
        return NextResponse.json({
          success: true,
          authenticated: isAuthenticated,
          limited: !isAuthenticated,
          ...(ticker ? { ticker } : {}),
          data: predictions,
          stats: {
            total: predictions.length,
            closedCount: stats.closed_count ?? stats.closedCount ?? 0,
            hits: stats.hits ?? 0,
            accuracy: stats.accuracy ?? null,
            avgScore: stats.avg_score || stats.avgScore || 0,
          },
          source: 'python_backend',
        });
      }
    } catch {
      // Try next fallback URL (safe-by-design).
    }
  }

  // Rule 27: honest empty — no fabricated predictions.
  return NextResponse.json({
    success: true,
    authenticated: isAuthenticated,
    limited: !isAuthenticated,
    ...(ticker ? { ticker } : {}),
    data: [],
    stats: {
      total: 0,
      closedCount: 0,
      hits: 0,
      accuracy: null,
      avgScore: 0,
    },
    source: 'python_empty',
    message: 'لا توجد بيانات',
  });
}

export async function POST(request: NextRequest) {
  // Task SECURITY-P0: admin-only — POST proxies to Python which writes
  // predictions.db. The route itself never opens the DB directly.
  const adminError = await requireAdminAsync(request);
  if (adminError) return adminError;

  try {
    const body = await request.json();

    // Forward to Python backend (canonical writer).
    const response = await fetch(`${PYTHON_BACKEND_URL}/api/v2/predictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      return NextResponse.json(await response.json());
    }
  } catch (e) {
    console.warn('[/api/predictions] POST error:', e);
  }

  return NextResponse.json({
    success: false,
    error: 'فشل في توليد التوقعات. حاول مرة أخرى لاحقاً.',
  }, { status: 500 });
}
