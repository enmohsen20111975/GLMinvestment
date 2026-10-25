/**
 * specialist/ScoreDashboardSection.tsx — §15 Score Dashboard (3 gauges).
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 1950–1996).
 * fundamental_score + smc_score + signal — 0-100 progress bars each.
 *
 * Color thresholds: ≥70 emerald, 40-70 amber, <40 red.
 */
import { Progress } from '@/components/ui/progress';
import { Activity, Banknote, Gauge, Target } from 'lucide-react';
import type { StockInfo } from './types';
import { safeNum } from './helpers';
import { SectionCard } from './primitives';

export function ScoreDashboardSection({ info }: { info: StockInfo }) {
  const fundScore = safeNum(info.fundamental_score);
  const smcScore = safeNum(info.smc_score);
  const signalScore = safeNum(info.signal);

  if (fundScore == null && smcScore == null && signalScore == null) {
    return null;
  }

  const scoreColor = (s: number | null) => s == null ? 'text-muted-foreground dark:text-muted-foreground'
    : s >= 70 ? 'text-profit'
    : s >= 40 ? 'text-warning'
    : 'text-loss';

  return (
    <SectionCard
      icon={<Gauge className="w-4 h-4" />}
      title="لوحة الدرجات"
      description="من stock_info: fundamental_score + smc_score + signal (0-100 لكل مؤشر)"
      accent="emerald"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { label: 'الدرجة الأساسية', value: fundScore, icon: <Banknote className="w-4 h-4" />, color: 'emerald' as const },
          { label: 'درجة SMC (Smart Money)', value: smcScore, icon: <Activity className="w-4 h-4" />, color: 'amber' as const },
          { label: 'الإشارة الفنية', value: signalScore, icon: <Target className="w-4 h-4" />, color: 'slate' as const },
        ].map((s, i) => (
          <div key={i} className="p-4 bg-white rounded-lg border border-border text-center">
            <div className="flex items-center justify-center gap-1.5 mb-2 text-muted-foreground">
              {s.icon}
              <span className="text-xs">{s.label}</span>
            </div>
            <p className={`text-3xl font-bold ${scoreColor(s.value)}`}>
              {s.value != null ? s.value.toFixed(0) : '—'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">/ 100</p>
            {s.value != null && <Progress value={s.value} className="h-1.5 mt-2" />}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
