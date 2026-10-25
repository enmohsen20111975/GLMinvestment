/**
 * specialist/Week52AnalysisSection.tsx — §10 52-Week Analysis (visual bar).
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 1433–1513).
 * Visual gradient bar with marker showing where current price sits in 52w range.
 */
import { Layers } from 'lucide-react';
import type { StockInfo } from './types';
import { fmtNum, safeNum } from './helpers';
import { PriceTile, SectionCard } from './primitives';

export function Week52AnalysisSection({ info }: { info: StockInfo }) {
  const current = safeNum(info.current_price);
  const high52w = safeNum(info.high_52w);
  const low52w = safeNum(info.low_52w);

  if (high52w == null && low52w == null) return null;

  const distFromHigh = current != null && high52w != null && high52w > 0
    ? ((current - high52w) / high52w) * 100 : null;
  const distFromLow = current != null && low52w != null && low52w > 0
    ? ((current - low52w) / low52w) * 100 : null;

  const range = high52w != null && low52w != null ? high52w - low52w : null;
  const positionPct = current != null && high52w != null && low52w != null && range != null && range > 0
    ? ((current - low52w) / range) * 100 : null;

  // Interpretation
  const interp = positionPct == null ? null
    : positionPct >= 80 ? { txt: 'قريب من القمة', cls: 'text-loss' }
    : positionPct >= 60 ? { txt: 'في الثلث العلوي', cls: 'text-warning' }
    : positionPct >= 40 ? { txt: 'في المنتصف', cls: 'text-muted-foreground dark:text-muted-foreground' }
    : positionPct >= 20 ? { txt: 'في الثلث السفلي', cls: 'text-warning' }
    : { txt: 'قريب من القاع', cls: 'text-profit' };

  return (
    <SectionCard
      icon={<Layers className="w-4 h-4" />}
      title="تحليل 52 أسبوع"
      description="موقع السعر الحالي بين أعلى وأدنى سعر في 52 أسبوع"
      accent="slate"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <PriceTile label="أعلى 52 أسبوع" value={fmtNum(high52w)} color="text-profit" />
        <PriceTile label="أدنى 52 أسبوع" value={fmtNum(low52w)} color="text-loss" />
        <PriceTile
          label="المسافة من القمة"
          value={distFromHigh != null ? `${distFromHigh >= 0 ? '+' : ''}${distFromHigh.toFixed(1)}%` : '—'}
          color={distFromHigh == null ? 'text-muted-foreground dark:text-muted-foreground' : distFromHigh < 0 ? 'text-loss' : 'text-profit'}
        />
        <PriceTile
          label="المسافة من القاع"
          value={distFromLow != null ? `${distFromLow >= 0 ? '+' : ''}${distFromLow.toFixed(1)}%` : '—'}
          color={distFromLow == null ? 'text-muted-foreground dark:text-muted-foreground' : distFromLow > 0 ? 'text-profit' : 'text-loss'}
        />
      </div>

      {/* Visual range bar */}
      {current != null && high52w != null && low52w != null && range != null && range > 0 && (
        <div className="mt-4">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-loss">قاع: {(low52w ?? 0).toFixed(2)}</span>
            <span className="text-profit">قمة: {(high52w ?? 0).toFixed(2)}</span>
          </div>
          <div className="relative h-4 rounded-full from-loss via-warning to-profit">
            <div
              className="absolute w-1 h-6 -top-1 bg-slate-900 dark:bg-white rounded-sm shadow-md border border-white"
              style={{
                right: `${Math.min(Math.max(positionPct ?? 50, 0), 100)}%`,
                transform: 'translateX(50%)',
              }}
            />
          </div>
          <div className="flex justify-between text-xs mt-1">
            <span className="text-muted-foreground">0%</span>
            <span className="text-muted-foreground">السعر الحالي: {(current ?? 0).toFixed(2)}</span>
            <span className="text-muted-foreground">100%</span>
          </div>
          {interp && (
            <p className={`text-sm font-semibold mt-2 text-center ${interp.cls}`}>
              {interp.txt} — {positionPct?.toFixed(0)}% من المدى
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}
