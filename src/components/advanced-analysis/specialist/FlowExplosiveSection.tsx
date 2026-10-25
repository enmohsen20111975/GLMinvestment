/**
 * specialist/FlowExplosiveSection.tsx — §11 Flow + Explosive (graceful degrade).
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 1515–1632).
 * May be empty if Python 8010 is down — shows EmptyState in that case.
 *
 * Flow Score: institutional flow_score 0-100 + macro/sector/stock flow labels.
 * Explosive Scanner: explosive_score + pattern + action + stop/target.
 */
import { Droplets, Flame } from 'lucide-react';
import type { ExplosiveData, FlowData } from './types';
import { fmtCompact, safeNum, safeStr } from './helpers';
import { EmptyState, SectionCard } from './primitives';

export function FlowExplosiveSection({ flow, explosive }: { flow: FlowData | null; explosive: ExplosiveData | null }) {
  const flowObj = (flow?.flow ?? (flow?.data as Record<string, unknown> | undefined)) as Record<string, unknown> | undefined;
  const explObj = (explosive?.explosive ?? (explosive?.data as Record<string, unknown> | undefined)) as Record<string, unknown> | undefined;

  // If both empty (Python down) — show graceful degrade message.
  const flowEmpty = !flowObj || flow?.message;
  const explEmpty = !explObj || explosive?.message;

  if (flowEmpty && explEmpty) {
    return (
      <SectionCard
        icon={<Flame className="w-4 h-4" />}
        title="نقاط التدفق + ماسح القنابل"
        description="من /api/flow + /api/explosive — قد تكون فارغة إذا كان Python 8010 مطفي"
        accent="amber"
      >
        <EmptyState msg="بيانات التدفق متاحة عند تشغيل محرك البيانات (Python 8010)" />
      </SectionCard>
    );
  }

  const flowScore = safeNum(flowObj?.flow_score);
  const flowLabel = safeStr(flowObj?.label);
  const flowColor = safeStr(flowObj?.color);
  const macroFlow = safeStr(flowObj?.macro_flow);
  const sectorFlow = safeStr(flowObj?.sector_flow);
  const stockFlow = safeStr(flowObj?.stock_flow);

  const explScore = safeNum(explObj?.explosive_score);
  const explLabel = safeStr(explObj?.label);
  const explPattern = safeStr(explObj?.pattern);
  const explColor = safeStr(explObj?.color);
  const explAction = safeStr(explObj?.action);
  const explStop = safeNum(explObj?.stop_loss);
  const explTarget = safeNum(explObj?.target);
  const volRatio = safeNum(explObj?.volume_ratio);
  const range10d = safeNum(explObj?.range_10d_pct);
  const explExcluded = explObj?.excluded === true || explObj?.excluded === 'true';

  function resolveColor(color: string | null, score: number | null): string {
    if (color === 'red') return 'text-loss';
    if (color === 'orange') return 'text-warning';
    if (color === 'amber') return 'text-warning';
    if (color === 'green') return 'text-profit';
    if (score != null) {
      if (score >= 70) return 'text-profit';
      if (score >= 40) return 'text-warning';
      return 'text-loss';
    }
    return 'text-muted-foreground dark:text-muted-foreground';
  }

  return (
    <SectionCard
      icon={<Flame className="w-4 h-4" />}
      title="نقاط التدفق + ماسح القنابل"
      description="من /api/flow + /api/explosive — الزخم المؤسسي + إشارات الانفجار السعري"
      accent="amber"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Flow Score */}
        {flowObj && (
          <div className="p-4 bg-white rounded-lg border border-border">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
              <Droplets className="w-4 h-4 text-profit" /> نقاط التدفق (Flow Score)
            </h4>
            <div className="flex items-center gap-3">
              <span className={`text-4xl font-bold ${resolveColor(flowColor, flowScore)}`}>
                {flowScore != null ? flowScore.toFixed(0) : '—'}
              </span>
              <div className="min-w-0">
                <div className="text-base font-bold text-muted-foreground dark:text-slate-200">{flowLabel ?? '—'}</div>
                <div className="text-xs text-muted-foreground mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <span>Macro: <span className="font-medium">{macroFlow ?? '—'}</span></span>
                  <span>Sector: <span className="font-medium">{sectorFlow ?? '—'}</span></span>
                  <span>Stock: <span className="font-medium">{stockFlow ?? '—'}</span></span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Explosive Scanner */}
        {explObj && !explExcluded && (
          <div className="p-4 bg-white rounded-lg border border-border">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-warning" /> ماسح القنابل (Explosive)
            </h4>
            <div className="flex items-center gap-3">
              <span className={`text-4xl font-bold ${resolveColor(explColor, explScore)}`}>
                {explScore != null ? explScore.toFixed(0) : '—'}
              </span>
              <div className="min-w-0">
                <div className="text-base font-bold text-muted-foreground dark:text-slate-200">
                  {explLabel ?? '—'} <span className="text-xs text-muted-foreground">— {explPattern ?? '—'}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Vol Ratio: <span className="font-medium">{volRatio != null ? `${volRatio.toFixed(2)}x` : '—'}</span>
                  {range10d != null && <> · Range 10d: <span className="font-medium">{range10d.toFixed(1)}%</span></>}
                </div>
                <div className="text-xs mt-1">
                  <span className="text-muted-foreground">الإجراء: </span>
                  <span className="font-medium text-muted-foreground dark:text-slate-200">{explAction ?? '—'}</span>
                  {explStop != null && <span className="text-loss"> · وقف: {explStop.toFixed(1)}%</span>}
                  {explTarget != null && <span className="text-profit"> · هدف: +{explTarget.toFixed(1)}%</span>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
