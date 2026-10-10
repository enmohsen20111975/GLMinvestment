/**
 * GET /api/v2/unified/config
 * ===========================
 * Unified analysis configuration endpoint.
 *
 * Returns the combined configuration that the Flutter app needs to render
 * the Unified Analysis dashboard:
 *   - personas (investor, gambler, swing, scalper, balanced, ...)
 *   - markets  (EGX, TADAWUL, KSE, QSE, US, CRYPTO, ...)
 *   - engines  (technical, fundamental, macro, sentiment, confluence, ...)
 *   - weights  (per-persona engine weighting)
 *   - presets, pipelines (best-effort — pulled from existing v2 endpoints)
 *
 * Behaviour:
 *   1. Try Python `${PY}/api/v2/unified/config` (passes ?market & ?persona through).
 *   2. If Python 404s or fails, fall back to a local static config that is
 *      merged with anything we can fetch from /api/v2/engines, /api/v2/presets,
 *      and /api/v2/pipelines.
 *
 * Always returns HTTP 200 with `{success: true, config: {...}}` so the
 * Flutter app's UI renders even when the Python backend is partially down.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSelfBaseUrl } from '@/lib/server-url';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

// ---------------------------------------------------------------------------
// Static defaults
// ---------------------------------------------------------------------------

const PERSONAS = [
  {
    id: 'investor',
    name: '????????',
    name_en: 'Investor',
    description: '??????? ???? ????? ???? ??? ????????? ??????? ???????',
    description_en: 'Long-term value investing based on fundamentals',
    risk_level: 'low',
    timeframe: 'weeks-months',
    color: '#10b981',
    min_score: 70,
    default_top_n: 15,
    weights: { technical: 0.20, fundamental: 0.45, macro: 0.15, sentiment: 0.10, confluence: 0.10 },
  },
  {
    id: 'gambler',
    name: '???????',
    name_en: 'Gambler',
    description: '?????? ????? ??????? ????? ?? ??? ????????',
    description_en: 'High-risk speculation hunting explosive moves',
    risk_level: 'high',
    timeframe: 'intraday',
    color: '#ef4444',
    min_score: 65,
    default_top_n: 20,
    weights: { technical: 0.55, fundamental: 0.05, macro: 0.05, sentiment: 0.15, confluence: 0.20 },
  },
  {
    id: 'swing',
    name: '????????',
    name_en: 'Swing',
    description: '????? ????? ????? ??? ????? ?????',
    description_en: 'Medium-term swing trading on price waves',
    risk_level: 'medium',
    timeframe: 'days-weeks',
    color: '#3b82f6',
    min_score: 60,
    default_top_n: 20,
    weights: { technical: 0.50, fundamental: 0.20, macro: 0.10, sentiment: 0.10, confluence: 0.10 },
  },
  {
    id: 'scalper',
    name: '??????? ??????',
    name_en: 'Scalper',
    description: '????? ???? ?????? ???? ?????',
    description_en: 'Ultra-fast intraday scalping',
    risk_level: 'very_high',
    timeframe: 'minutes-hours',
    color: '#f59e0b',
    min_score: 75,
    default_top_n: 10,
    weights: { technical: 0.70, fundamental: 0.00, macro: 0.05, sentiment: 0.15, confluence: 0.10 },
  },
  {
    id: 'balanced',
    name: '????????',
    name_en: 'Balanced',
    description: '???? ?????? ?? ?? ????????',
    description_en: 'Balanced blend of all engines',
    risk_level: 'medium',
    timeframe: 'days-weeks',
    color: '#8b5cf6',
    min_score: 65,
    default_top_n: 20,
    weights: { technical: 0.25, fundamental: 0.25, macro: 0.20, sentiment: 0.15, confluence: 0.15 },
  },
];

const MARKETS = [
  { id: 'EGX',     name: '??????? ???????',         name_en: 'Egyptian Exchange',     currency: 'EGP', country: 'Egypt',     default: true },
  { id: 'TADAWUL', name: '????? ???????',           name_en: 'Saudi Exchange',        currency: 'SAR', country: 'Saudi Arabia' },
  { id: 'KSE',     name: '????? ??????',            name_en: 'Kuwait Stock Exchange', currency: 'KWD', country: 'Kuwait' },
  { id: 'QSE',     name: '????? ???',               name_en: 'Qatar Stock Exchange',  currency: 'QAR', country: 'Qatar' },
  { id: 'US',      name: '??????? ?????????',        name_en: 'US Markets',            currency: 'USD', country: 'United States' },
  { id: 'CRYPTO',  name: '??????? ???????',         name_en: 'Crypto Markets',        currency: 'USD', country: 'Global' },
];

const ENGINES = [
  {
    id: 'technical',
    name: '?????? ?????',
    name_en: 'Technical Engine',
    description: '?????? ????? ???????? ??? ???????',
    description_en: 'Technical indicators, trends, support/resistance',
    enabled: true,
    category: 'price_action',
    default_weight: 0.30,
  },
  {
    id: 'fundamental',
    name: '?????? ???????',
    name_en: 'Fundamental Engine',
    description: 'Piotroski, Altman Z, FCF? ??? ?????????',
    description_en: 'Piotroski, Altman Z, FCF, revenue growth',
    enabled: true,
    category: 'valuation',
    default_weight: 0.30,
  },
  {
    id: 'macro',
    name: '?????? ?????',
    name_en: 'Macro Engine',
    description: '???? ???????? ????? ????? ????????',
    description_en: 'Macroeconomic context and sector performance',
    enabled: true,
    category: 'context',
    default_weight: 0.15,
  },
  {
    id: 'sentiment',
    name: '???? ???????',
    name_en: 'Sentiment Engine',
    description: '????? ??????? ???????? ???????',
    description_en: 'News analysis and market sentiment',
    enabled: true,
    category: 'news',
    default_weight: 0.10,
  },
  {
    id: 'confluence',
    name: '???? ??????????',
    name_en: 'Confluence Engine',
    description: '5 ???????? (???/?????/???/?????/?????) ?? ????? ??????',
    description_en: '5 counselors (tech/fund/macro/trend/personality) with consensus',
    enabled: true,
    category: 'aggregate',
    default_weight: 0.15,
  },
];

const PIPELINES = [
  { id: 'default',        name: '???? ?????????',  name_en: 'Default Pipeline',        stages: ['technical', 'fundamental', 'macro', 'sentiment', 'confluence'] },
  { id: 'fast',           name: '?? ????',          name_en: 'Fast Pipeline',            stages: ['technical', 'confluence'] },
  { id: 'fundamentals',   name: '?? ?????????',     name_en: 'Fundamentals Pipeline',    stages: ['fundamental', 'macro'] },
  { id: 'day-trade',      name: '?? ????????',       name_en: 'Day-Trading Pipeline',     stages: ['technical', 'sentiment', 'confluence'] },
];

const PRESETS = [
  { id: 'conservative', name: '?????',  name_en: 'Conservative', persona: 'investor', min_score: 80, top_n: 10 },
  { id: 'balanced',     name: '??????', name_en: 'Balanced',     persona: 'balanced', min_score: 70, top_n: 15 },
  { id: 'aggressive',   name: '?????',  name_en: 'Aggressive',   persona: 'gambler',  min_score: 60, top_n: 25 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function tryPython(pathAndQuery: string, timeoutMs = 6000): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${PY}${pathAndQuery}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return data && (data.success === true || data.config || data.personas || data.engines)
      ? data
      : null;
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

async function tryNext(request: NextRequest, path: string, timeoutMs = 5000): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const selfBase = getSelfBaseUrl(request);
    const res = await fetch(`${selfBase}${path}`, {
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

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const market  = searchParams.get('market')  || 'EGX';
    const persona = searchParams.get('persona') || 'balanced';

    // 1) Try Python unified/config first
    const qs = `?market=${encodeURIComponent(market)}&persona=${encodeURIComponent(persona)}`;
    const pyData = await tryPython(`/api/v2/unified/config${qs}`);
    if (pyData && pyData.config) {
      return NextResponse.json({ success: true, config: pyData.config, source: 'python' });
    }

    // 2) Best-effort: enrich static config with live endpoints that may work
    const [enginesResp, presetsResp, pipelinesResp] = await Promise.all([
      tryNext(request, '/api/v2/engines'),
      tryNext(request, '/api/v2/presets'),
      tryNext(request, '/api/v2/pipelines'),
    ]);

    const engines = enginesResp?.engines && Array.isArray(enginesResp.engines) && enginesResp.engines.length
      ? enginesResp.engines
      : ENGINES;

    const presets = presetsResp?.presets && Array.isArray(presetsResp.presets) && presetsResp.presets.length
      ? presetsResp.presets
      : PRESETS;

    const pipelines = pipelinesResp?.pipelines && Array.isArray(pipelinesResp.pipelines) && pipelinesResp.pipelines.length
      ? pipelinesResp.pipelines
      : PIPELINES;

    // Resolve the active persona block (fall back to 'balanced' if unknown)
    const personaBlock = PERSONAS.find(p => p.id === persona) || PERSONAS.find(p => p.id === 'balanced')!;
    const marketBlock  = MARKETS.find(m => m.id === market)   || MARKETS[0];

    const config = {
      version: '2.0.0',
      generated_at: new Date().toISOString(),
      market,
      persona,
      active_persona: personaBlock,
      active_market: marketBlock,
      personas: PERSONAS,
      markets: MARKETS,
      engines,
      pipelines,
      presets,
      weights: personaBlock.weights,
      defaults: {
        top_n: personaBlock.default_top_n,
        min_score: personaBlock.min_score,
        risk_level: personaBlock.risk_level,
        timeframe: personaBlock.timeframe,
      },
      scoring: {
        min: 0,
        max: 100,
        // RULE-73 UNIFY (2026-10-10): ????? thresholds ??? canonical-signal.ts
        // ??? ???: 80/70/60/50/40 — ???? ???? ?????? ????? ?????? ??????? ?? canonical.
        // ??????: 78/65/55/40/25 = ??? thresholds ???????? ?? canonical-signal.ts
        // (Rule 28: ?? ????? — ???? ???? ?? ??? thresholds).
        thresholds: {
          strong_buy: 78,
          buy: 65,
          hold: 55,
          avoid: 40,
          strong_avoid: 25,
        },
      },
    };

    return NextResponse.json({
      success: true,
      config,
      source: 'next-static',
      message_en: 'Unified config served from Next.js (Python /api/v2/unified/config not available).',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: '??? ????? ??????? ??????? ??????',
        error_en: 'Failed to load unified analysis config',
        details: error instanceof Error ? error.message : String(error),
        config: null,
      },
      { status: 500 }
    );
  }
}
