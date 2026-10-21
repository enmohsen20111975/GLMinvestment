<<<<<<< HEAD
import { NextRequest, NextResponse } from 'next/server';

// ALPHA-PIPE-FIX: Proxy route — investor-flows → Python backend
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const qs = new URL(request.url).searchParams.toString();
  try {
    const res = await fetch(`${PY}/api/market/investor-flows${qs ? `?${qs}` : ''}`, {
=======
/**
 * GET /api/market/investor-flows
 * =================================
 * Proxy مباشر للـ Python Backend (port 8010).
 * تدفقات المستثمرين الرسمية (EGX فقط — باقي الأسواق available=false).
 * يدعم Query Params (?market=EGX).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY_BACKEND = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const queryString = searchParams.toString();
  const targetUrl = `${PY_BACKEND}/api/market/investor-flows${queryString ? `?${queryString}` : ''}`;

  try {
    const res = await fetch(targetUrl, {
>>>>>>> b29961f357b3b8f8d6a344b52996ccaff318ece8
      signal: AbortSignal.timeout(10000),
      cache: 'no-store' as RequestCache,
      headers: { 'Cache-Control': 'no-store' },
    });
<<<<<<< HEAD
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
      });
    }
    return NextResponse.json({ success: true, available: false, message: 'Python backend unavailable' });
  } catch {
    return NextResponse.json({ success: true, available: false, message: 'Python backend timeout' });
=======

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
        },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Python backend unavailable', code: res.status },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'Backend connection failed', detail: String(error) },
      { status: 200 }
    );
>>>>>>> b29961f357b3b8f8d6a344b52996ccaff318ece8
  }
}
