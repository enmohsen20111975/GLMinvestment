/**
 * GET /api/market/morning-bell
 *
 * P17 Morning Bell — جرس الصباح.
 * Proxy route: يمرر الطلب للـ Python backend (/api/market/morning-bell)
 * اللي بيرجّع أعلى 3 فرص EGX من stored_analyses مع تعويض التأخير (P16)
 * وكشف ATH Breakout (P15).
 *
 * المعمارية: Python = الدماغ، Node.js = العرض فقط
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND =
  process.env.PYTHON_BACKEND_URL ||
  process.env.VPS_API_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://localhost:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') || '3';
  // FIX (FIX-API-MARKET #8): read `market` and forward to Python so callers
  // can scope the morning bell to a non-EGX market. Python endpoint currently
  // EGX-only — param forwarded for future use.
  const marketParam = searchParams.get('market') || 'EGX';

  const backendUrl =
    `${PYTHON_BACKEND.replace(/\/$/, '')}/api/market/morning-bell?limit=${encodeURIComponent(limit)}&market=${encodeURIComponent(marketParam)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: `Backend responded with ${response.status}`, stocks: [] },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/market/morning-bell] proxy error:', msg);
    // Backend unavailable → return empty gracefully so the UI hides the section
    // instead of crashing (the morning bell is a bonus, not a blocker).
    return NextResponse.json(
      { success: false, error: msg, stocks: [], market_status: 'closed', label_ar: '🔔 جرس الصباح' },
      { status: 200 }
    );
  }
}
