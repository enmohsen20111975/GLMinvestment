import { NextRequest, NextResponse } from 'next/server';

// ALPHA-PIPE-FIX: Proxy route — metals-forex/summary → Python backend
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET() {
  try {
    const res = await fetch(`${PY}/api/market/metals-forex/summary`, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store' as RequestCache,
      headers: { 'Cache-Control': 'no-store' },
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
      });
    }
    // FIX (BRAVO-DISASTER 2026-10-28): was returning success:true with null data — Rule 27 NO-FAKE-DATA
    return NextResponse.json({
      success: false,
      error: 'python_backend_unavailable',
      gold: null,
      forex: null,
      message: 'Python backend unavailable — metals/forex summary not available',
    }, { status: 503 });
  } catch {
    return NextResponse.json({
      success: false,
      error: 'python_backend_timeout',
      gold: null,
      forex: null,
      message: 'Python backend timeout — metals/forex summary did not respond',
    }, { status: 504 });
  }
}
