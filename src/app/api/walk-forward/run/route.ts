/**
 * POST /api/walk-forward/run — Rule 27 HARD GATE
 * ===============================================
 *
 * RULE27-DISABLED (2026-10-12 — FAKE-DATA-HUNT):
 *
 * This route had a `buildStubPeriods` fallback that returned fabricated
 * periods with return: 0, sharpe: 0, drawdown: 0 + `success: true`.
 *
 * Rule 27 (NO-FAKE-DATA): ممنوع أي بيانات وهمية في production.
 *
 * Now: pure thin proxy to Python /api/walk-forward/run.
 * If Python unavailable → 503 (no stub fallback).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function POST(request: NextRequest) {
  const targetUrl = `${PY}/api/walk-forward/run`;
  try {
    const body = await request.json().catch(() => ({}));
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `python-returned-${res.status}`,
        message: 'تعذّر تشغيل walk-forward — Python backend أرجع خطأ',
      }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[walk-forward:run] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض walk-forward وهمي (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}

// ─── ORIGINAL IMPLEMENTATION REMOVED (Rule 16 VERIFY-BEFORE-DELETE) ────────
// The original buildStubPeriods + fabricated return:0 fallback is preserved
// in git history for reference.
