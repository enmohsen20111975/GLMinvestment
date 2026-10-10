/**
 * GET /api/confluence/market-scan
 * ================================
 * Confluence market scan endpoint.
 *
 * Query: ?market=EGX&persona=investor&limit=20
 *
 * Returns:
 *   { success: true, results: [...], count: N, market, persona, source }
 *
 * Behaviour:
 *   1. Try Python `${PY}/api/confluence/market-scan` first (currently 404).
 *   2. If unavailable, fall back to aggregating confluence-style signals from:
 *        - /api/flow/summary     (market-pulse style; gives top_stocks + sector heatmap)
 *        - /api/scanner/quick    (latest day-trading scanner results)
 *        - /api/persona/<persona> when persona is investor/gambler
 *      Then merge, score, and slice.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getPython(path: string, timeoutMs = 10000): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${PY}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

function pickList(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const key of ['results', 'stocks', 'top_stocks', 'recommendations', 'data']) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

function num(v: any, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function signalToScore(signal: any): number {
  if (typeof signal === 'number') return Math.min(100, Math.max(0, signal));
  const s = String(signal || '').toLowerCase();
  if (s.includes('strong buy') || s.includes('شراء قوي')) return 90;
  if (s.includes('buy')        || s.includes('شراء'))     return 75;
  if (s.includes('hold')       || s.includes('انتظار') || s.includes('متابعة')) return 55;
  if (s.includes('sell')       || s.includes('بيع'))     return 30;
  if (s.includes('strong sell')|| s.includes('بيع قوي')) return 15;
  return 50;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const market  = searchParams.get('market')  || 'EGX';
    const persona = searchParams.get('persona') || 'balanced';
    const limit   = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '20', 10) || 20));

    // 1) Try Python confluence/market-scan first
    const pyResp = await getPython(
      `/api/confluence/market-scan?market=${encodeURIComponent(market)}&persona=${encodeURIComponent(persona)}&limit=${limit}`
    );
    if (pyResp && pyResp.success !== false && Array.isArray(pyResp.results) && pyResp.results.length > 0) {
      return NextResponse.json({
        success: true,
        results: pyResp.results.slice(0, limit),
        count: Math.min(pyResp.results.length, limit),
        market,
        persona,
        source: 'python',
      });
    }

    // 2) Fallback: aggregate from working Python endpoints
    const [flow, scanner, personaResp] = await Promise.all([
      getPython(`/api/flow/summary?market=${encodeURIComponent(market)}&persona=${encodeURIComponent(persona)}`),
      getPython(`/api/scanner/quick?limit=${limit}`),
      ['investor', 'gambler'].includes(persona)
        ? getPython(`/api/persona/${persona}?market=${encodeURIComponent(market)}&limit=${limit}`)
        : Promise.resolve(null),
    ]);

    const merged: any[] = [];
    const seen = new Set<string>();

    const addAll = (items: any[]) => {
      for (const it of items) {
        const ticker = String(it.ticker || it.symbol || it.stock || '').toUpperCase();
        if (!ticker || seen.has(ticker)) continue;
        seen.add(ticker);
        const sig = it.signal || it.recommendation || it.verdict || null;
        merged.push({
          ticker,
          market: it.market || market,
          name: it.name || it.name_ar || it.stock_name || ticker,
          sector: it.sector || null,
          price: it.price ?? it.current_price ?? it.close_price ?? null,
          change_pct: it.change_pct ?? it.change_percent ?? it.change ?? null,
          volume: it.volume ?? null,
          master_score: it.master_score ?? it.score ?? signalToScore(sig),
          signal: sig,
          confidence: it.confidence ?? null,
          opinions: it.opinions || it.board_consensus || null,
          entry: it.entry ?? it.entry_price ?? null,
          target: it.target ?? it.target_price ?? null,
          stop: it.stop ?? it.stop_loss ?? null,
          persona_match: persona,
          source: it.source || 'aggregated',
        });
      }
    };

    addAll(pickList(flow?.data || flow));
    addAll(pickList(scanner));
    addAll(pickList(personaResp));

    // Sort by master_score desc, slice to limit
    const sorted = merged.sort((a, b) => num(b.master_score, 0) - num(a.master_score, 0));
    const sliced = sorted.slice(0, limit);

    return NextResponse.json({
      success: true,
      results: sliced,
      count: sliced.length,
      market,
      persona,
      limit,
      market_assessment: flow?.data?.market_assessment || flow?.market_assessment || null,
      market_action:     flow?.data?.market_action     || flow?.market_action     || null,
      sector_heatmap:    flow?.data?.sector_heatmap    || flow?.sector_heatmap    || [],
      scanned_at: new Date().toISOString(),
      source: sliced.length ? 'next-aggregated' : 'next-empty',
      message_en: sliced.length
        ? 'Confluence scan aggregated from /api/flow/summary, /api/scanner/quick, and /api/persona/*.'
        : 'No confluence signals available. Backend data sources may be empty.',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'فشل المسح الموحد للإشارات',
        error_en: 'Confluence market scan failed',
        details: error instanceof Error ? error.message : String(error),
        results: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}
