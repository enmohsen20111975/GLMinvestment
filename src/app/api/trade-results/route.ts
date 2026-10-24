/**
 * GET /api/trade-results — Task 38-A
 * ==================================
 * بيانات نتائج الصفقات لـ "بومية احترافية لنتائج الصفقات الناجحة".
 *
 * Owner directive (EXACT QUOTE — 32-section spec):
 *   «نريد إنشاء نظام تلقائي داخل منصة دليل الاستثمار يقوم بتوليد بوستات
 *    احترافية لنتائج الصفقات الناجحة، اعتمادًا على بيانات الصفقات الفعلية
 *    الموجودة في قاعدة البيانات فقط.»
 *
 * Translation: Build an automatic system that generates professional social
 * media posts for SUCCESSFUL trade results, using ONLY real data from the DB.
 *
 * ─── ENDPOINT CONTRACT ───
 *   GET /api/trade-results?period=daily|weekly|monthly&market=EGX
 *
 *   Headers: Authorization: Bearer <token>  (or NextAuth session cookie)
 *
 *   Response (200 — has qualified trades):
 *     {
 *       "success": true,
 *       "period": "daily",
 *       "period_start": "2026-10-04",
 *       "period_end": "2026-10-04",
 *       "has_qualified_trades": true,
 *       "stats": { ... ReportStats ... },
 *       "trades": [ ... TradeResult[] ... ],
 *       "validation": { "valid": true, "errors": [] },
 *       "generated_at": "2026-10-04T..."
 *     }
 *
 *   Response (200 — no qualified trades, Rule 67 §2):
 *     {
 *       "success": true,
 *       "period": "daily",
 *       "period_start": "2026-10-04",
 *       "period_end": "2026-10-04",
 *       "has_qualified_trades": false,
 *       "message": "لا توجد نتائج مؤهلة لهذه الفترة",
 *       "stats": null,
 *       "trades": [],
 *       "validation": { "valid": true, "errors": [] },
 *       "generated_at": "2026-10-04T..."
 *     }
 *
 *   Response (400 — bad request):
 *     { "success": false, "error": "Invalid period. Must be daily|weekly|monthly" }
 *
 *   Response (401 — unauthenticated):
 *     { "error": "Authentication required" }
 *
 *   Response (500 — DB open failure, Rule 67 — no fabricated data):
 *     { "success": false, "error": "Database unavailable" }
 *
 * Per Rule 67 §2 (Synthetic Approximation Ban): if no qualified closed
 * trades exist for the requested period, the endpoint returns
 * `has_qualified_trades: false` + `stats: null` + Arabic message
 * "لا توجد نتائج مؤهلة لهذه الفترة". The caller (post generator) MUST
 * NOT generate a post in this case.
 *
 * Per Rule 67 §4 (No claim "تم الحل" without proof): the validation
 * block is always included in the response — the caller can inspect
 * `validation.errors` even on success.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import {
  fetchClosedTrades,
  calculateReportStats,
  validateReport,
  getPeriodRange,
  type Period,
} from '@/lib/trade-results-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_PERIODS: Period[] = ['daily', 'weekly', 'monthly'];
const NO_QUALIFIED_TRADES_MESSAGE = 'لا توجد نتائج مؤهلة لهذه الفترة';

/**
 * GET handler — see file header for contract.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────
  // Per spec section "Auth: required (getSessionUserId)". Any authenticated
  // user can call — this is not admin-only (the post generator can be
  // triggered by editors/admins but the route itself just checks login).
  const { userId } = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 },
    );
  }

  // ── Parse query params ──────────────────────────────────────────────────
  const url = new URL(request.url);
  const periodParam = (url.searchParams.get('period') || 'daily').toLowerCase();
  const marketParam = url.searchParams.get('market') || undefined;

  if (!VALID_PERIODS.includes(periodParam as Period)) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid period "${periodParam}". Must be one of: daily, weekly, monthly`,
      },
      { status: 400 },
    );
  }
  const period = periodParam as Period;

  // ── Compute period bounds (Cairo TZ-aware) ───────────────────────────────
  const now = new Date();
  const range = getPeriodRange(period, now);

  // ── Fetch closed trades from DB ──────────────────────────────────────────
  // Per Rule 67 §2: if the DB is unavailable, return 500 with a clear error.
  // We do NOT fall back to mock data — fabricated data is forbidden.
  let trades;
  try {
    trades = fetchClosedTrades(period, marketParam, now);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        error: 'Database unavailable',
        detail: process.env.NODE_ENV === 'development' ? msg : undefined,
        period,
        period_start: range.period_start,
        period_end: range.period_end,
        generated_at: now.toISOString(),
      },
      { status: 500 },
    );
  }

  // ── Compute stats (null if no qualified trades — Rule 67 §2) ─────────────
  const stats = calculateReportStats(trades);

  // ── Validate (11-point checklist — spec section 25) ──────────────────────
  // Per spec section 25: "Validation before generation — if validation fails,
  // the API must NOT generate the post."
  // The API returns the validation result so the caller can decide.
  // We still return 200 (with validation.valid=false) so the caller can show
  // a helpful error message — generation is blocked by the caller, not by
  // HTTP status.
  const validation = validateReport(stats, trades, period, now);

  // ── Build response ───────────────────────────────────────────────────────
  if (stats === null) {
    // Rule 67 §2 + §4 — no fabricated data. Honest empty response.
    return NextResponse.json({
      success: true,
      period,
      period_start: range.period_start,
      period_end: range.period_end,
      has_qualified_trades: false,
      message: NO_QUALIFIED_TRADES_MESSAGE,
      stats: null,
      trades: [],
      validation,
      generated_at: now.toISOString(),
    });
  }

  return NextResponse.json({
    success: true,
    period,
    period_start: range.period_start,
    period_end: range.period_end,
    has_qualified_trades: true,
    stats,
    trades,
    validation,
    generated_at: now.toISOString(),
  });
}
