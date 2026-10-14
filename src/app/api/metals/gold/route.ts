/**
 * GET /api/metals/gold
 * ====================
 * CANONICAL metals route — pure proxy to Python /api/metals/gold.
 *
 *Directive P1 (API Routes Decoupling): NO direct SQLite access. This route
 * proxies to Python ONLY. If Python is unreachable → honest empty metals
 * payload (Rule 27 NO-FAKE-DATA).
 *
 * Response shape preserved (consumers expect `prices`, `currencies`,
 * `gold_prices` legacy contract + `summary` block).
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA): no fabricated prices.
 */
import { NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';
export const revalidate = 30;

// Honest empty payload — matches the production response shape so Flutter's
// gold screen renders an honest empty state without crashing on undefined.
const EMPTY_PAYLOAD = {
  success: false,
  error: 'metals_unavailable',
  timestamp: new Date().toISOString(),
  last_updated: null,
  source: 'python_proxy_empty',
  is_live: false,
  prices: {
    gold_karats: [] as unknown[],
    gold_pound: null,
    gold_ounce: null,
    silver_karats: [] as unknown[],
    silver_pound: null,
    silver_ounce: null,
  },
  currencies: [] as unknown[],
  gold_prices: {
    karat_24: 0,
    karat_22: 0,
    karat_21: 0,
    karat_18: 0,
    karat_14: 0,
    silver: 0,
    last_updated: null,
  },
  summary: {
    gold_24k: 0,
    gold_21k: 0,
    gold_18k: 0,
    gold_pound: 0,
    silver_999: 0,
    silver_pound: 0,
    total_gold_karats: 0,
    total_silver_karats: 0,
    total_currencies: 0,
  },
};

export async function GET() {
  const targetUrl = `${PYTHON_BACKEND_URL}/api/metals/gold`;
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (
        data &&
        data.success !== false &&
        (data.prices || data.gold_prices || Array.isArray(data.currencies))
      ) {
        // Forward canonical Python response shape (already includes all keys
        // consumed by the Flutter app + the legacy gold_prices contract).
        return NextResponse.json(data);
      }
    }
  } catch {
    // Python unreachable — honest empty (Rule 27).
  }

  return NextResponse.json(EMPTY_PAYLOAD);
}
