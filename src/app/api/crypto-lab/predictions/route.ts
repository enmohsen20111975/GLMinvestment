/**
 * GET /api/crypto-lab/predictions
 * ================================
 *
 * CANONICAL crypto-lab predictions route — pure proxy to Python engine.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `predictions.db` directly via a dynamic `await import('better-sqlite3')`
 * and queried `crypto_predictions_log`. That bypassed the canonical Python
 * engine (Rule 4). Now it calls Python `/api/crypto-lab/predictions` and
 * passes the response through verbatim. If Python is unreachable → honest
 * empty (Rule 27 NO-FAKE-DATA).
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */
import { NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  // Python canonical endpoints (primary + direct fallback).
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/crypto-lab/predictions`,
    `http://127.0.0.1:8010/api/crypto-lab/predictions`,
    `${PYTHON_BACKEND_URL}/api/crypto/predictions`,
    `http://127.0.0.1:8010/api/crypto/predictions`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(6000),
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (json && (json.success === true || Array.isArray(json.predictions))) {
        // Pass through Python response verbatim (Rule 4: mirror only).
        return NextResponse.json({
          success: true,
          predictions: Array.isArray(json.predictions) ? json.predictions : [],
          last_updated: json.last_updated ?? null,
        });
      }
    } catch {
      // try next URL (safe-by-design)
    }
  }

  // Rule 27: honest empty — no fabricated crypto predictions.
  return NextResponse.json({
    success: true,
    predictions: [],
    last_updated: null,
    note: 'لا توجد توقعات كريبتو متاحة حالياً من المحرك الكنسي',
  });
}
