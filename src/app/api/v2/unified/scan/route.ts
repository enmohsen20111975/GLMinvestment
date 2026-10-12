/**
 * POST /api/v2/unified/scan
 * ==========================
 * Unified market scan endpoint.
 *
 * Body:
 *   { market: "EGX", persona: "investor", top_n: 20, min_score: 65 }
 *
 * Returns:
 *   { success: true, results: [...], count: N, market, persona, source }
 *
 * Behaviour:
 *   1. Try Python `${PY}/api/v2/unified/scan` first (POST pass-through).
 *   2. If Python 404s or fails, fall back to combining:
 *        - /api/v2/recommend   (works in Python — returns stored recommendations)
 *        - /api/persona/<persona> when persona is investor/gambler
 *        - /api/scanner/quick  (latest day-trading scanner results)
 *      Then merge, score, filter, sort, and slice to top_n.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiErr } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

// Loose JSON record — Python responses don't have a strict schema (Rule 20).
type LooseRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function postPython(path: string, body: LooseRecord, timeoutMs = 15000): Promise<LooseRecord | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${PY}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.json()) as LooseRecord;
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

async function getPython(path: string, timeoutMs = 10000): Promise<LooseRecord | null> {
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
    return (await res.json()) as LooseRecord;
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

function pickList(data: LooseRecord | null): LooseRecord[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as LooseRecord[];
  for (const key of ['results', 'stocks', 'recommendations', 'data']) {
    const v = data[key];
    if (Array.isArray(v)) return v as LooseRecord[];
  }
  return [];
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function scoreOf(rec: LooseRecord, persona: string): number {
  // Try common score fields
  const candidates = ['score', 'maestro_score', 'unified_score', 'master_score', 'total_score'];
  for (const c of candidates) {
    const v = rec[c];
    if (typeof v === 'number') return v;
  }
  // Derive from confidence
  if (typeof rec.confidence === 'number') return Math.min(100, Math.max(0, rec.confidence));

  // Derive from signal string
  const sig = String(rec.signal || rec.recommendation || rec.verdict || '').toLowerCase();
  if (sig.includes('strong buy') || sig.includes('شراء قوي')) return 90;
  if (sig.includes('buy')        || sig.includes('شراء'))     return 75;
  if (sig.includes('hold')       || sig.includes('انتظار') || sig.includes('متابعة')) return 55;
  if (sig.includes('sell')       || sig.includes('بيع'))     return 30;
  if (sig.includes('strong sell')|| sig.includes('بيع قوي')) return 15;

  // Persona-dependent baseline (gambler rewards volatility, investor rewards fundamentals)
  if (persona === 'gambler' && typeof rec.rsi === 'number') {
    return Math.max(0, 100 - Math.abs(30 - rec.rsi) * 2);
  }
  if (persona === 'investor' && typeof rec.piotroski_f_score === 'number') {
    return Math.min(100, rec.piotroski_f_score * 10);
  }
  return 50;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    let body: LooseRecord = {};
    try {
      body = (await request.json()) as LooseRecord;
    } catch { // silent fallback (safe-by-design)
      // Empty body is OK
    }

    const market    = String(body.market    || 'EGX');
    const persona   = String(body.persona   || 'balanced');
    const topN      = Math.max(1,  Math.min(100, parseInt(String(body.top_n   || '20'), 10) || 20));
    const minScore  = Math.max(0,  Math.min(100, parseInt(String(body.min_score || '60'), 10) || 60));

    // 1) Try Python unified/scan first
    const pyResp = await postPython('/api/v2/unified/scan', { market, persona, top_n: topN, min_score: minScore });
    if (pyResp && pyResp.success !== false && Array.isArray(pyResp.results) && pyResp.results.length > 0) {
      return NextResponse.json({
        success: true,
        results: pyResp.results.slice(0, topN),
        count: Math.min(pyResp.results.length, topN),
        market,
        persona,
        source: 'python',
      });
    }

    // 2) Fallback: aggregate from working Python endpoints
    const [recommend, personaResp, scanner] = await Promise.all([
      getPython(`/api/v2/recommend?market=${encodeURIComponent(market)}&persona=${encodeURIComponent(persona)}&limit=${topN}`),
      ['investor', 'gambler'].includes(persona)
        ? getPython(`/api/persona/${persona}?market=${encodeURIComponent(market)}&limit=${topN}`)
        : Promise.resolve(null),
      getPython(`/api/scanner/quick?limit=${topN}`),
    ]);

    const merged: LooseRecord[] = [];
    const seen = new Set<string>();

    const addAll = (items: LooseRecord[]) => {
      for (const it of items) {
        const ticker = String(it.ticker || it.symbol || it.stock || '').toUpperCase();
        if (!ticker || seen.has(ticker)) continue;
        seen.add(ticker);
        merged.push({
          ticker,
          market: it.market || market,
          name: it.name || it.name_ar || it.stock_name || ticker,
          sector: it.sector || null,
          price: it.price ?? it.current_price ?? it.close_price ?? null,
          change_pct: it.change_pct ?? it.change_percent ?? it.change ?? null,
          volume: it.volume ?? null,
          score: it.score ?? scoreOf(it, persona),
          signal: it.signal || it.recommendation || it.verdict || null,
          confidence: it.confidence ?? null,
          persona_match: persona,
          entry: it.entry ?? it.entry_price ?? null,
          target: it.target ?? it.target_price ?? null,
          stop: it.stop ?? it.stop_loss ?? null,
          source: it.source || 'aggregated',
          raw: it,
        });
      }
    };

    addAll(pickList(recommend));
    addAll(pickList(personaResp));
    addAll(pickList(scanner));

    // Score, filter, sort, slice
    const filtered = merged.filter(r => num(r.score, 0) >= minScore);
    const sorted   = filtered.sort((a, b) => num(b.score, 0) - num(a.score, 0));
    const sliced   = sorted.slice(0, topN);

    return NextResponse.json({
      success: true,
      results: sliced,
      count: sliced.length,
      market,
      persona,
      top_n: topN,
      min_score: minScore,
      source: sliced.length ? 'next-aggregated' : 'next-empty',
      scanned_at: new Date().toISOString(),
      message_en: sliced.length
        ? 'Unified scan aggregated from /api/v2/recommend, /api/persona/*, and /api/scanner/quick.'
        : 'No stocks passed the min_score threshold. Backend data sources may be empty.',
    });
  } catch (error) {
    return apiErr(
      'unified_scan_failed',
      'فشل المسح الموحد للسوق',
      500,
      {
        error_en: 'Unified market scan failed',
        cause: error instanceof Error ? error.message : String(error),
        results: [],
        count: 0,
      }
    );
  }
}
