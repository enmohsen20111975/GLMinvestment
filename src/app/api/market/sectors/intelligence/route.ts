/**
 * Sector Intelligence — READ-ONLY
 * ================================
 * "نظرة المحلل الخبير" على القطاعات:
 *
 * 1. sector_ranking       → ترتيب القطاعات بالأداء (avg change %, gainers, losers)
 * 2. market_breadth       → كم قطاع طالع vs نازل (صحة السوق)
 * 3. top_outperformers    → أسهم تتفوق على قطاعها (relative strength +ve)
 * 4. top_underperformers  → أسهم أضعف من قطاعها (relative strength -ve)
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `db/stocks.db` directly (`new Database`) and computed all the sector
 * stats in TypeScript. That bypassed the canonical Python engine (Rule 4).
 * Now it proxies to Python `/api/market/sectors/intelligence` and falls
 * back to an honest empty state (Rule 27 NO-FAKE-DATA) when Python is
 * unreachable.
 *
 * Response shape is preserved 1:1 with the legacy version so consumers
 * (ExpertIntelligencePanel.tsx) keep working without changes.
 *
 * GET /api/market/sectors/intelligence
 *   ?min_stocks=5    // minimum stocks per sector to be ranked (default 5)
 *   ?limit=20        // max items per category (default 20)
 *   ?market=EGX      // reserved for future filter
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const minStocks = Math.max(1, Math.min(50, Number(searchParams.get('min_stocks') || '5')));
  const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit') || '20')));

  // Build a clean querystring — only forward well-known params.
  const qs = new URLSearchParams();
  qs.set('min_stocks', String(minStocks));
  qs.set('limit', String(limit));
  const market = searchParams.get('market');
  if (market) qs.set('market', market);

  // Primary: Python /api/market/sectors/intelligence (path-matching).
  // Fallback: Python /api/sectors/tracking (sector_tracking_routes.py).
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/market/sectors/intelligence?${qs.toString()}`,
    `http://127.0.0.1:8010/api/market/sectors/intelligence?${qs.toString()}`,
    `${PYTHON_BACKEND_URL}/api/sectors/tracking?${qs.toString()}`,
    `http://127.0.0.1:8010/api/sectors/tracking?${qs.toString()}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.success !== false) {
        // Forward Python's payload verbatim — it already matches the legacy
        // contract (success, generated_at, params, summary, sector_ranking,
        // top_outperformers, top_underperformers, note).
        return NextResponse.json(data);
      }
    } catch {
      // Try next fallback URL (safe-by-design).
    }
  }

  // Rule 27: honest empty — Python unreachable. Preserve the legacy
  // response shape so ExpertIntelligencePanel.tsx renders an empty state
  // rather than crashing.
  return NextResponse.json({
    success: true,
    generated_at: new Date().toISOString(),
    params: { min_stocks: minStocks, limit, market: market || 'EGX' },
    summary: {
      total_stocks_analyzed: 0,
      total_sectors: 0,
      market_breadth: {
        total_sectors: 0,
        sectors_up: 0,
        sectors_down: 0,
        sectors_flat: 0,
        market_mood: 'عرضي/مختلط (Mixed)',
      },
      best_sector: null,
      worst_sector: null,
    },
    sector_ranking: [],
    top_outperformers: [],
    top_underperformers: [],
    note: '🎯 relative_strength = أداء السهم - متوسط أداء قطاعه. +ve = السهم أقوى من قطاعه (فرصة). -ve = السهم أضعف من قطاعه (تحذير).',
    source: 'python_empty',
  });
}
