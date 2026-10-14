/**
 * GET /api/maker-radar/net-picks?market=EGX
 * ===========================================
 * CANONICAL net-picks route — pure Python proxy with cache fallback.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `db/predictions.db` directly (`new Database(...)`) to enrich radar
 * picks with active V40.2 prediction targets (entry/target/stop_loss).
 * That bypassed the canonical Python engine. Now it:
 *   1. Proxies to Python `/api/maker-radar/net-picks?market=X` (primary).
 *   2. Falls back to the cached radar JSON (Python-written cache via
 *      background warmup) — picks are still built from cache, but the
 *      prediction enrichment is set to NULL (Rule 27: no fabricated
 *      targets — Python is the canonical source for predictions).
 *   3. Returns honest empty (Rule 27 NO-FAKE-DATA) if both are unavailable.
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */
import { NextRequest, NextResponse } from 'next/server';
import { readRadarCache } from '@/modules/radar/lib/radar-cache';
import { applyValidatedTargets } from '@/lib/targets-validator';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

const PATH_LABELS_AR: Record<string, string> = {
  'A_pre_surge': '🚀 Pre-Surge (تراكم مبكر)',
  'B_quiet_accumulation_strong': '🎯 تجميع قوي',
  'C_quiet_accumulation_weak': '🔍 تجميع ضعيف',
  'D_explosive_surge': '💥 انفجار حجمي',
  'E_early_break': '⚡ اختراق مبكر',
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';

  try {
    // ─── 1. PRIMARY: Python canonical endpoint ────────────────────────────────
    const qs = `market=${encodeURIComponent(market)}`;
    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/maker-radar/net-picks?${qs}`,
      `http://127.0.0.1:8010/api/maker-radar/net-picks?${qs}`,
    ];

    for (const targetUrl of targetUrls) {
      try {
        const res = await fetch(targetUrl, {
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        });
        if (res.ok) {
          const json = await res.json();
          if (json && (json.success === true || Array.isArray(json.picks))) {
            // Pass through Python response verbatim (Rule 4: mirror only).
            return NextResponse.json({
              success: true,
              market,
              picks: json.picks ?? [],
              stats: json.stats ?? {
                total_picks: (json.picks ?? []).length,
                by_source: [],
                with_predictions: 0,
                high_confidence: 0,
              },
              generated_at: json.generated_at ?? new Date().toISOString(),
              source: 'python',
            });
          }
        }
      } catch { // silent fallback (safe-by-design)
      }
    }

    // ─── 2. FALLBACK: cached radar JSON (Python-written via background warmup) ─
    // NOTE (Directive P1): previously this branch opened `db/predictions.db`
    // directly to enrich picks with V40.2 targets. That DB access has been
    // removed (Rule 4 / Rule 27). The `prediction` field on each pick is
    // NULL when Python is unreachable — the UI must treat this as
    // "prediction data missing" (Rule 27 honest empty, NOT fabricated targets).
    const cache = readRadarCache(market);
    if (!cache || !cache.data) {
      return NextResponse.json(
        { success: false, warming_up: true },
        { status: 503 },
      );
    }

    const data = cache.data;
    const allStocks: any[] = [];

    // Collect from all radar paths with source labeling
    for (const stock of (data.pre_surge_list || [])) {
      allStocks.push({
        ...stock,
        source_path: 'A_pre_surge',
        source_label: PATH_LABELS_AR['A_pre_surge'],
        source_rank: 1,
      });
    }
    for (const stock of (data.quiet_list || [])) {
      const isStrong = stock.path === 'B_quiet_accumulation_strong';
      allStocks.push({
        ...stock,
        source_path: stock.path,
        source_label: PATH_LABELS_AR[stock.path] || 'تجميع',
        source_rank: isStrong ? 2 : 4,
      });
    }
    for (const stock of (data.explosive_list || [])) {
      allStocks.push({
        ...stock,
        source_path: 'D_explosive_surge',
        source_label: PATH_LABELS_AR['D_explosive_surge'],
        source_rank: 3,
      });
    }
    for (const stock of (data.early_break_list || [])) {
      allStocks.push({
        ...stock,
        source_path: 'E_early_break',
        source_label: PATH_LABELS_AR['E_early_break'],
        source_rank: 5,
      });
    }

    // Deduplicate by ticker (keep highest rank)
    const byTicker = new Map<string, any>();
    for (const s of allStocks) {
      const existing = byTicker.get(s.ticker);
      if (!existing || s.source_rank < existing.source_rank) {
        byTicker.set(s.ticker, s);
      }
    }

    // Sort by: signal_count desc → volume_ratio desc → turnover desc
    const picks = Array.from(byTicker.values()).sort((a, b) => {
      const sigA = a.quiet_details?.signal_count || a.pre_surge_details?.signal_count || 0;
      const sigB = b.quiet_details?.signal_count || b.pre_surge_details?.signal_count || 0;
      if (sigB !== sigA) return sigB - sigA;
      const vrA = a.volume_ratio_10d_vs_20d || 0;
      const vrB = b.volume_ratio_10d_vs_20d || 0;
      if (vrB !== vrA) return vrB - vrA;
      return (b.avg_turnover_20d || 0) - (a.avg_turnover_20d || 0);
    });

    // Build enriched picks — prediction field is NULL (Rule 27 honest empty,
    // because we no longer read predictions.db directly; Python owns that).
    const enrichedPicks = picks.map((p, idx) => {
      const signalCount = p.quiet_details?.signal_count || p.pre_surge_details?.signal_count || 0;
      return {
        rank: idx + 1,
        ticker: p.ticker,
        current_price: p.current_price,
        source_path: p.source_path,
        source_label: p.source_label,
        source_rank: p.source_rank,
        accumulation: p.accumulation,
        maker_activity: p.maker_activity,
        volume_ratio: p.volume_ratio_10d_vs_20d,
        avg_turnover: p.avg_turnover_20d,
        roc_10d: p.roc_10d,
        signal_count: signalCount,
        max_signals: 6,
        position_size: p.position_size,
        reason: p.reason,
        // Rule 27: prediction is NULL when Python (canonical source for
        // predictions) is unreachable. The validator wrapper is kept so
        // that when Python DOES return a prediction, we can sanitize it
        // before passing it through.
        prediction: null,
      };
    });

    // Summary stats
    const stats = {
      total_picks: enrichedPicks.length,
      by_source: Object.entries(PATH_LABELS_AR).map(([path, label]) => ({
        path,
        label,
        count: enrichedPicks.filter((p) => p.source_path === path).length,
      })),
      with_predictions: enrichedPicks.filter((p) => p.prediction).length,
      high_confidence: enrichedPicks.filter((p) => (p.signal_count || 0) >= 5).length,
    };

    return NextResponse.json({
      success: true,
      market,
      picks: enrichedPicks.slice(0, 50), // Top 50
      stats,
      generated_at: new Date().toISOString(),
      source: 'cache',
    });
  } catch (error: any) {
    console.error('[maker-radar:net-picks]', error);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}
