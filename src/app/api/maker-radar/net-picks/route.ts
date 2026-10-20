import { NextRequest, NextResponse } from 'next/server';
import { readRadarCache } from '@/modules/radar/lib/radar-cache';
import { applyValidatedTargets } from '@/lib/targets-validator';
import Database from 'better-sqlite3';
import path from 'path';

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
    const cache = readRadarCache();
    if (!cache || !cache.data) {
      return NextResponse.json({ success: false, warming_up: true }, { status: 503 });
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

    // Enrich with prediction data if available
    let predictionsMap: Record<string, any> = {};
    try {
      const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
      const db = new Database(dbPath, { readonly: true });
      const activePreds = db.prepare(
        // LIFECYCLE-MIGRATION: open/active predictions now detected via
        // `lifecycle_status IN ('proven', 'testing')` instead of the
        // legacy `status IN ('active','ACTIVE')`. The `status` column is
        // also SELECTed for outcome display (kept by the API response).
        "SELECT ticker, entry_price, target_price, target_price_2, stop_loss, signal, confidence, risk_reward, prediction_date, status, lifecycle_status FROM predictions WHERE lifecycle_status IN ('proven', 'testing') ORDER BY id DESC"
      ).all() as any[];
      for (const p of activePreds) {
        predictionsMap[p.ticker] = p;
      }
      db.close();
    } catch {}

    // Build enriched picks
    const enrichedPicks = picks.map((p, idx) => {
      const pred = predictionsMap[p.ticker];
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
        // Prediction enrichment (if V40.2 has a prediction for this ticker)
        // TARGETS-VALIDATOR: نتأكد إن الـ targets منطقية قبل ما نرجّعها
        // FIX-P4-TARGETS: signal-aware — pred.signal بيحدد اتجاه الـ validation.
        // FIX-P4-TARGETS: ما بـ نعملش `?? pred.X` fallback للقيمة الأصلية المكسورة.
        //   بنستخدم القيم المُتحقَّق منها مباشرة. لو الـ validator رجّع null، بـ ينتقل
        //   زي ما هو علشان الـ consumer يـ يعرف إن الـ data غير صالحة.
        prediction: pred ? (() => {
          const v = applyValidatedTargets({
            signal: pred.signal || 'BUY',
            entry_price: pred.entry_price,
            current_price: p.current_price || pred.entry_price,
            target1: pred.target_price,
            target2: pred.target_price_2,
            stop_loss: pred.stop_loss,
            risk_reward_ratio: pred.risk_reward,
          });
          return {
            entry_price: v.entry_price,
            target_price: v.target1,
            target_price_2: v.target2,
            stop_loss: v.stop_loss,
            signal: pred.signal,
            confidence: pred.confidence,
            risk_reward: v.risk_reward_ratio,
            prediction_date: pred.prediction_date,
          };
        })() : null,
      };
    });

    // Summary stats
    const stats = {
      total_picks: enrichedPicks.length,
      by_source: Object.entries(PATH_LABELS_AR).map(([path, label]) => ({
        path,
        label,
        count: enrichedPicks.filter(p => p.source_path === path).length,
      })),
      with_predictions: enrichedPicks.filter(p => p.prediction).length,
      high_confidence: enrichedPicks.filter(p => (p.signal_count || 0) >= 5).length,
    };

    return NextResponse.json({
      success: true,
      market,
      picks: enrichedPicks.slice(0, 50), // Top 50
      stats,
      generated_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[maker-radar:net-picks]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
