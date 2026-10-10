import { NextRequest, NextResponse } from 'next/server';
import { getCryptoBySymbolFallback } from '@/lib/flutter-sqlite-fallback';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

// GET /api/mobile/crypto/[coinId]
// -------------------------------
// Primary: Python /api/crypto/live (Flutter passes a coinId or symbol).
// Fallback (FLUTTER-FULL-AUDIT): data_engine.db crypto_prices — lookup by
//   symbol when Python is unreachable. Previously returned 503.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: coinId } = await params;
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/crypto/live${qs ? `?${qs}` : ''}`;

  // 1. Try Python
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
  } catch { // silent fallback (safe-by-design)
    // fall through
  }

  // 2. SQLite fallback — data_engine.db crypto_prices by symbol
  const fb = getCryptoBySymbolFallback(coinId);
  if (fb) {
    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      crypto: fb,
      data: fb,
      coin_id: coinId,
      timestamp: new Date().toISOString(),
    });
  }

  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback_empty',
    crypto: null,
    data: null,
    coin_id: coinId,
    message: `Python backend unreachable and '${coinId}' not found in crypto_prices`,
  });
}
