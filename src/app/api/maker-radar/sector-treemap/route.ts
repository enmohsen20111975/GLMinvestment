/**
 * GET /api/maker-radar/sector-treemap
 * ====================================
 * CANONICAL sector-treemap route — pure Python proxy with cache fallback.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `db/stocks.db` directly (`new Database(...)`) to enrich radar cache
 * items with their `sector` + `name_ar` from the `stocks` table. That
 * bypassed the canonical Python engine. Now it:
 *   1. Proxies to Python `/api/maker-radar/sector-treemap` (primary).
 *   2. Falls back to the cached JSON (Python-written cache via background
 *      warmup) — sectors are bucketed as 'غير مُصنّف' since the route no
 *      longer opens SQLite to look up sector info.
 *   3. Returns honest empty (Rule 27 NO-FAKE-DATA) if both are unavailable.
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */
import { NextRequest, NextResponse } from 'next/server';
import { readRadarCache } from '@/modules/radar/lib/radar-cache';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const market = url.searchParams.get('market') || 'EGX';

    // ─── 1. PRIMARY: Python canonical endpoint ────────────────────────────────
    const qs = `market=${encodeURIComponent(market)}`;
    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/maker-radar/sector-treemap?${qs}`,
      `http://127.0.0.1:8010/api/maker-radar/sector-treemap?${qs}`,
    ];

    for (const targetUrl of targetUrls) {
      try {
        const res = await fetch(targetUrl, {
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        });
        if (res.ok) {
          const json = await res.json();
          if (json && (json.success === true || Array.isArray(json.sectors))) {
            // Pass through Python response verbatim (Rule 4: mirror only).
            return NextResponse.json({
              success: true,
              days: json.days ?? 30,
              total_sectors: json.total_sectors ?? (json.sectors?.length || 0),
              total_turnover: json.total_turnover ?? 0,
              sectors: json.sectors ?? [],
              generated_at: json.generated_at ?? new Date().toISOString(),
              source: 'python',
            });
          }
        }
      } catch { // silent fallback (safe-by-design)
      }
    }

    // ─── 2. FALLBACK: cached radar JSON (Python-written via background warmup) ─
    // Reading the JSON cache file is NOT direct SQLite access — it is reading
    // a JSON file that Python wrote. We use the cache's per-stock data only
    // (no sector lookup from SQLite). All stocks bucket under 'غير مُصنّف'.
    const cache = readRadarCache(market);
    if (!cache || !cache.data) {
      return NextResponse.json(
        { success: false, warming_up: true, error: 'الرادار بيتسخن' },
        { status: 503 },
      );
    }

    const data = cache.data;
    const allStocks = [
      ...(data.quiet_list || []),
      ...(data.pre_surge_list || []),
      ...(data.explosive_list || []),
      ...(data.early_break_list || []),
    ];

    // No SQLite lookup — all stocks bucket as 'غير مُصنّف' (Rule 27: honest
    // about not having sector info from a DB we no longer touch directly).
    const sectorMap: Record<string, any[]> = {
      'غير مُصنّف': allStocks.map((s: any) => ({ ...s, sector: 'غير مُصنّف' })),
    };

    const sectors = Object.entries(sectorMap).map(([sector, stocks]) => {
      const totalTurnover = stocks.reduce((s, st) => s + (st.avg_turnover_20d || 0), 0);
      const avgChange = stocks.length > 0
        ? stocks.reduce((s, st) => s + (st.roc_10d || 0), 0) / stocks.length
        : 0;
      const direction = avgChange > 0.5 ? 'inflow' : avgChange < -0.5 ? 'outflow' : 'neutral';
      return {
        sector,
        stocks_count: stocks.length,
        total_turnover: totalTurnover,
        avg_change_pct: avgChange,
        direction,
        color: direction === 'inflow' ? 'emerald' : direction === 'outflow' ? 'rose' : 'amber',
        top_tickers: stocks
          .sort((a, b) => (b.avg_turnover_20d || 0) - (a.avg_turnover_20d || 0))
          .slice(0, 3)
          .map((s) => ({
            ticker: s.ticker,
            name_ar: s.name_ar,
            avg_turnover_20d: s.avg_turnover_20d,
            change_pct: s.roc_10d || 0,
            roc_10d: s.roc_10d || 0,
          })),
      };
    }).sort((a, b) => b.total_turnover - a.total_turnover);

    return NextResponse.json({
      success: true,
      days: 30,
      total_sectors: sectors.length,
      total_turnover: sectors.reduce((s, sec) => s + sec.total_turnover, 0),
      sectors,
      generated_at: new Date().toISOString(),
      source: 'cache',
    });
  } catch (error: any) {
    console.error('[maker-radar:sector-treemap]', error);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}
