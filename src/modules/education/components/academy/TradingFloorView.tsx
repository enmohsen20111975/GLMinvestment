'use client';

/**
 * academy/TradingFloorView.tsx
 * ============================================================================
 * F-Phase3-Split-Academy: Extracted from AcademyView.tsx (was 2,357 LOC).
 * ----------------------------------------------------------------------------
 * Trading Floor tab container — combines three stacked sections to give the
 * Academy a "real trading desk" feel (owner feedback: too "school-like").
 *
 *   1) LiveMarketScanner — top tickers by activity from /api/stocks
 *      (with graceful fallback to demo data if the API is unreachable).
 *   2) ScenarioDecisionTree — 6 scenario cards with branching decision trees.
 *   3) ActionPlaybooks — 5 predefined action plans for common situations.
 *
 * Also renders the TradingSystemPipeline (الخريطة المنطقية للربط البرمجي/
 * الخوارزمي) at the top — a premium SVG visualising the 8-stage pipeline
 * (Data → Source Guard → Validation → Signal → Risk Gate → Execution →
 * Journal → Review) with a feedback loop, so investors see HOW the system
 * thinks before they act on the live prices below.
 * ============================================================================
 */

import { TradingSystemPipeline } from '../LearningVisuals';
import { LiveMarketScanner } from './LiveMarketScanner';
import { ScenarioDecisionTree } from './ScenarioDecisionTree';
import { ActionPlaybooks } from './ActionPlaybooks';

export function TradingFloorView() {
  return (
    <div className="space-y-6">
      {/* Owner intent banner — sets the tone that this is a desk, not a textbook */}
      <div className="rounded-lg border border-profit/20 bg-profit/20 px-4 py-3 text-xs text-profit sm:px-6">
        <span className="font-semibold">📊 أرض التداول —</span> مكتب عملي للقرارات المباشرة:
        شاشة أسعار حية، شجرة قرارات سيناريوهات، وكتيبات إجراءات جاهزة.
      </div>
      {/* Task ID 30-A §3: The Trading System Pipeline (الخريطة المنطقية للربط البرمجمي/الخوارزمي)
      — owner explicitly requested the algorithmic wiring to become a beautiful logic
      diagram. This premium SVG visualises the 8-stage pipeline (Data → Source Guard →
      Validation → Signal → Risk Gate → Execution → Journal → Review) with a feedback
      loop. Placed at the top of the Trading Floor so investors see HOW the system
      thinks before they act on the live prices below. */}
      <section aria-labelledby="pipeline-heading" className="rounded-xl border border-border bg-white/80 p-4 dark:bg-slate-950/60 sm:p-6">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-lg" role="img" aria-label="خريطة">🗺️</span>
          <h3 id="pipeline-heading" className="text-base font-bold text-slate-800 dark:text-slate-100 sm:text-lg">
            الخريطة المنطقية لنظام التداول
          </h3>
        </div>
        <p className="mb-4 text-xs text-muted-foreground sm:text-sm">
          كيف يتدفّق قرارك من البيانات الخام حتى التنفيذ والمراجعة — فهم هذه الخريطة هو الفرق بين
          المستثمر المنضبط والمقامر العاطفي.
        </p>
        <TradingSystemPipeline />
      </section>
      <LiveMarketScanner />
      <ScenarioDecisionTree />
      <ActionPlaybooks />
    </div>
  );
}
