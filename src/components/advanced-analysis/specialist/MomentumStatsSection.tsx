/**
 * specialist/MomentumStatsSection.tsx — §7 Momentum Stats (radarData.stats).
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 1118–1189).
 * ROC 10d + avgVol20 + avgTurnover20 + 20d max/min + range + lastClose + change%.
 */
import { Activity } from 'lucide-react';
import type { RadarStats, StockInfo } from './types';
import { fmtCompact, fmtInt, fmtNum, safeNum } from './helpers';
import { PriceTile, SectionCard } from './primitives';

export function MomentumStatsSection({ stats, info }: { stats: RadarStats | null; info: StockInfo }) {
  if (!stats) return null;

  const roc10d = safeNum(stats.roc10d);
  const avgVol20 = safeNum(stats.avgVolume20);
  const avgTurnover20 = safeNum(stats.avgTurnover20);
  const max20 = safeNum(stats.max20);
  const min20 = safeNum(stats.min20);
  const range20Pct = safeNum(stats.range20Pct);
  const dataPoints = safeNum(stats.dataPoints);
  const lastClose = safeNum(stats.lastClose);
  const changePct = safeNum(stats.changePct);

  if (roc10d == null && avgVol20 == null && max20 == null && min20 == null) {
    return null;
  }

  // Volume ratio: latest volume vs avg20
  const currentVol = safeNum(info.volume);
  const volRatio = currentVol != null && avgVol20 != null && avgVol20 > 0 ? currentVol / avgVol20 : null;

  return (
    <SectionCard
      icon={<Activity className="w-4 h-4" />}
      title="مؤشرات الزخم (Momentum Stats)"
      description={`من radarData.stats — مدى 20 يوم (${dataPoints != null ? `${dataPoints.toFixed(0)} نقطة بيانات` : 'بيانات محدودة'})`}
      accent="amber"
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <PriceTile
          label="ROC 10 أيام (معدل التغير)"
          value={roc10d != null ? `${roc10d >= 0 ? '+' : ''}${roc10d.toFixed(2)}%` : '—'}
          color={roc10d == null ? 'text-muted-foreground dark:text-muted-foreground' : roc10d >= 0 ? 'text-profit' : 'text-loss'}
          sub="زخم 10 جلسات"
        />
        <PriceTile label="متوسط حجم 20 يوم" value={fmtInt(avgVol20)} color="text-warning" />
        <PriceTile
          label="متوسط تداول 20 يوم"
          value={avgTurnover20 != null ? fmtCompact(avgTurnover20, ' ج.م') : '—'}
          color="text-warning"
        />
        <PriceTile
          label="نسبة الحجم (يومي/20ي)"
          value={volRatio != null ? `${volRatio.toFixed(2)}x` : '—'}
          color={volRatio == null ? 'text-muted-foreground dark:text-muted-foreground' : volRatio >= 1.5 ? 'text-profit' : volRatio < 0.7 ? 'text-loss' : 'text-warning'}
          sub={currentVol != null ? `اليوم: ${fmtCompact(currentVol)}` : undefined}
        />
        <PriceTile label="أعلى 20 يوم" value={fmtNum(max20)} color="text-profit" />
        <PriceTile label="أدنى 20 يوم" value={fmtNum(min20)} color="text-loss" />
        <PriceTile
          label="مدى 20 يوم %"
          value={range20Pct != null ? `${range20Pct.toFixed(2)}%` : '—'}
          color="text-warning"
          sub={max20 != null && min20 != null ? `(${min20.toFixed(2)} — ${max20.toFixed(2)})` : undefined}
        />
        <PriceTile label="آخر إغلاق" value={fmtNum(lastClose)} color="text-muted-foreground dark:text-slate-200" />
      </div>
      {changePct != null && (
        <div className="mt-3 p-2 bg-slate-50/60 rounded-lg flex items-center justify-between">
          <span className="text-xs text-muted-foreground">تغير آخر جلسة:</span>
          <span className={`text-sm font-bold ${changePct >= 0 ? 'text-profit' : 'text-loss'}`}>
            {changePct >= 0 ? '+' : ''}{(changePct ?? 0).toFixed(2)}%
          </span>
        </div>
      )}
    </SectionCard>
  );
}
