/**
 * GET /api/global-predictions
 * =============================
 * Global market predictions for the Flutter Android app.
 *
 * Directive P1 (API Routes Decoupling): NO direct SQLite access in Next.js
 * routes. This route proxies to Python `/api/global-predictions` ONLY. If
 * Python is unreachable → honest empty (Rule 27 NO-FAKE-DATA).
 *
 * Previously this route opened `db/predictions.db` (US/global predictions),
 * `db/crypto.db` (crypto predictions), and `db/gold_prices.db` (gold signal)
 * directly. All three reads have been removed — Python is the canonical
 * source for all of them (Rule 4: Python = brain).
 *
 * Response shape is preserved for the Flutter Android app consumer:
 *   {
 *     success, source, generated_at,
 *     us_predictions:       [{ ticker, signal, entry_price, target_price, stop_loss, ... }],
 *     crypto_predictions:   [{ symbol, signal, entry_price, target_price, ... }],
 *     gold_signal:          { price_per_gram, change, signal } | null,
 *     summary:              { us_count, crypto_count, us_last_date, crypto_last_date, gold_signal_present }
 *   }
 *
 * Rule 4  (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA) — empty arrays + null when Python is unreachable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/global-predictions`,
    `http://127.0.0.1:8010/api/global-predictions`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.success) {
          return NextResponse.json(data);
        }
      }
    } catch { // silent fallback (safe-by-design) → try next URL
      // Try next fallback URL.
    }
  }

  // Rule 27: honest empty — never 500, never fabricate predictions/signals.
  return NextResponse.json({
    success: true,
    source: 'python_proxy_empty',
    generated_at: new Date().toISOString(),
    us_predictions: [],
    crypto_predictions: [],
    gold_signal: null,
    summary: {
      us_count: 0,
      crypto_count: 0,
      us_last_date: null,
      crypto_last_date: null,
      gold_signal_present: false,
    },
  });
}
