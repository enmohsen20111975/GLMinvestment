/**
 * GET /api/market/defensive-stocks
 * =================================
 * ALPHA-2-DEFENSIVE-STOCKS (2026-10-12)
 *
 * Thin proxy → Python backend `/api/market/defensive-stocks` (Rule 20:
 * Python = brain, Node = proxy). The actual filter logic lives in
 * `analyzers.market_regime_engine.MarketRegimeEngine.get_defensive_stocks`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before: when the persisted market regime was DEFENSIVE, the PersonaTab
 * screen showed "السوق دفاعي — لا توجد فرص آمنة حالياً" and stopped
 * showing any stocks. This was wrong — the engine should *filter* defensive
 * stocks (low-beta + dividend + active) instead of halting the UI.
 *
 * After: the PersonaTab can call this endpoint when `regime === 'DEFENSIVE'`
 * to get a list of safe-haven stocks to display instead of the dead-end
 * message.
 *
 * QUERY PARAMS
 * ------------
 *   ?market=EGX   (default) — EGX | TADAWUL | KSE | QSE  (CRYPTO/GOLD → [])
 *   ?limit=10     (default, capped 1..50)
 *
 * RESPONSE SHAPE
 * --------------
 *   {
 *     success: true,
 *     market: 'EGX',
 *     regime: 'DEFENSIVE' | 'NORMAL' | 'AGGRESSIVE' | null,
 *     stocks: Array<{
 *       ticker: string,
 *       name_ar: string | null,
 *       sector: string | null,
 *       beta: number | null,          // null لو beta_source='missing'
 *       dividend_yield: number,
 *       market_cap: number | null,
 *       current_price: number | null,
 *       turnover_egp: number | null,
 *       market: string,
 *       beta_source: 'cached' | 'missing'
 *     }>,
 *     count: number,
 *     beta_source: 'cached' | 'missing' | 'n/a',
 *     source: 'market_regime_engine',
 *     note_ar: string
 *   }
 *
 * Rule 27 (NO-FAKE-DATA): لو مفيش أسهم دفاعية → empty array (مش اختلاق).
 * Rule 20 (Python=brain): this file is a proxy — no business logic here.
 * Rule 75 (commit per file): file 3 of 4 in ALPHA-2.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const PYTHON_BACKEND =
  process.env.PYTHON_BACKEND_URL ||
  process.env.VPS_API_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://localhost:8010';

const SUPPORTED_MARKETS = new Set(['EGX', 'TADAWUL', 'KSE', 'QSE', 'CRYPTO', 'GOLD']);
const MARKET_ALIAS: Record<string, string> = {
  KSA: 'TADAWUL',
  SA: 'TADAWUL',
  SAUDI: 'TADAWUL',
  QATAR: 'QSE',
  PAK: 'KSE',
  BTC: 'CRYPTO',
  XAU: 'GOLD',
  XAUUSD: 'GOLD',
};

type DefensiveStock = {
  ticker: string;
  name_ar: string | null;
  sector: string | null;
  beta: number | null;
  dividend_yield: number;
  market_cap: number | null;
  current_price: number | null;
  turnover_egp: number | null;
  market: string;
  beta_source: 'cached' | 'missing';
};

type DefensiveStocksResponse = {
  success: boolean;
  market: string;
  regime?: string | null;
  stocks: DefensiveStock[];
  count: number;
  beta_source: 'cached' | 'missing' | 'n/a';
  source: string;
  note_ar?: string;
  error?: string;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Normalize market — accept aliases (same set as /api/market/regime)
  const marketRaw = (searchParams.get('market') || 'EGX').toUpperCase();
  const market = MARKET_ALIAS[marketRaw] || (SUPPORTED_MARKETS.has(marketRaw) ? marketRaw : 'EGX');

  // Normalize limit — clamp to [1, 50]
  const limitParam = parseInt(searchParams.get('limit') || '10', 10);
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(50, limitParam)) : 10;

  const backendUrl =
    `${PYTHON_BACKEND.replace(/\/$/, '')}` +
    `/api/market/defensive-stocks?market=${encodeURIComponent(market)}&limit=${limit}`;

  // Generous timeout — the Python endpoint reads stocks.db (fast <100ms)
  // but we leave headroom for first-call imports + cold cache.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (!response.ok) {
      // Forward the backend's error payload if it's JSON, else generic.
      let errorPayload: { success: false; error: string; stocks: never[] } = {
        success: false,
        error: `Backend responded with ${response.status}`,
        stocks: [],
      };
      try {
        const body = (await response.json()) as Partial<DefensiveStocksResponse>;
        if (body && typeof body === 'object') {
          errorPayload = {
            success: false,
            error: body.error || `Backend responded with ${response.status}`,
            stocks: [],
          };
        }
      } catch {
        // not JSON — keep the generic error
      }
      return NextResponse.json(errorPayload, { status: response.status });
    }

    const data = (await response.json()) as DefensiveStocksResponse;
    return NextResponse.json(data);
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/market/defensive-stocks] proxy error:', msg);

    // Backend unavailable → return empty stocks gracefully so the UI can
    // show a fallback message instead of crashing the PersonaTab.
    // (The PersonaTab already handles `stocks: []` with a friendly note.)
    const fallback: DefensiveStocksResponse = {
      success: false,
      market,
      regime: null,
      stocks: [],
      count: 0,
      beta_source: 'n/a',
      source: 'proxy-fallback',
      note_ar:
        'تعذّر الاتصال بمحرك الأسهم الدفاعية. حاول مرة أخرى — لو استمرت المشكلة ' +
        'فالسوق قد يكون في وضع دفاعي شديد. راجع /api/market/regime للتأكد.',
      error: msg,
    };
    return NextResponse.json(fallback, { status: 200 });
  }
}
