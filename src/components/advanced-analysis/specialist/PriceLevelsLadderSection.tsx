/**
 * specialist/PriceLevelsLadderSection.tsx — §14 Price Levels Ladder.
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 1897–1948).
 * Visual ladder: 52w high → resistance → current → support → 52w low.
 */
import { Layers } from 'lucide-react';
import type { StockInfo } from './types';
import { safeNum } from './helpers';
import { SectionCard } from './primitives';

export function PriceLevelsLadderSection({ info }: { info: StockInfo }) {
  const current = safeNum(info.current_price);
  const high52w = safeNum(info.high_52w);
  const low52w = safeNum(info.low_52w);
  const support = safeNum(info.support);
  const resistance = safeNum(info.resistance);

  if (current == null && high52w == null && low52w == null && support == null && resistance == null) {
    return null;
  }

  const rows: Array<{ label: string; value: number | null; color: string; bg: string }> = [
    { label: 'أعلى 52 أسبوع', value: high52w, color: 'text-loss', bg: 'bg-loss/10 border-loss/20' },
    { label: 'المقاومة', value: resistance, color: 'text-warning', bg: 'bg-warning/10 border-warning/20' },
    { label: 'السعر الحالي', value: current, color: 'text-profit', bg: 'bg-profit/10 border-profit ' },
    { label: 'الدعم', value: support, color: 'text-profit', bg: 'bg-profit/10 border-profit/20' },
    { label: 'أدنى 52 أسبوع', value: low52w, color: 'text-loss', bg: 'bg-loss/10 border-loss/20' },
  ].filter((r) => r.value != null) as Array<{ label: string; value: number | null; color: string; bg: string }>;

  return (
    <SectionCard
      icon={<Layers className="w-4 h-4" />}
      title="سُلَّم مستويات السعر"
      description="من stock_info: high_52w → resistance → current → support → low_52w"
      accent="slate"
    >
      <div className="space-y-2">
        {rows.map((r, i) => {
          const isCurrent = r.label === 'السعر الحالي';
          return (
            <div
              key={i}
              className={`flex items-center justify-between p-3 rounded-lg border ${r.bg} ${isCurrent ? 'shadow-md ring-2 ring-profit ' : ''}`}
            >
              <div className="flex items-center gap-2">
                {isCurrent && <span className="w-2 h-2 rounded-full bg-profit animate-pulse" />}
                <span className="text-sm font-medium">{r.label}</span>
              </div>
              <span className={`text-lg font-bold ${r.color}`}>
                {r.value != null ? r.value.toFixed(2) : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
