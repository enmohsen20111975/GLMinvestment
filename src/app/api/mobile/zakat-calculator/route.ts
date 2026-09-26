import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

// GET /api/mobile/zakat-calculator
// --------------------------------
// Primary: Python /api/market-pulse.
// Fallback (FLUTTER-FULL-AUDIT): return 200 with a clean "calculator ready"
// payload — Zakat calculation is a pure client-side operation in the Flutter
// app (the user inputs their assets). Without this fallback the calculator
// screen showed "connection error" even though all it needed was a 200.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/market-pulse${qs ? `?${qs}` : ''}`;

  // 1. Try Python (for optional live prices used in net-worth calc)
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success !== false) {
        return NextResponse.json(data);
      }
    }
  } catch {
    // fall through
  }

  // 2. SQLite fallback — return calculator-ready payload (no live prices)
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    calculator_ready: true,
    zakat_rate: 0.025, // 2.5% — standard Islamic Zakat rate on wealth
    nisab_threshold_usd: null, // requires live gold price — unavailable
    nisab_threshold_egp: null,
    message: 'Python backend unreachable — calculator runs client-side. Live gold price for nisab threshold not available.',
    timestamp: new Date().toISOString(),
  });
}
