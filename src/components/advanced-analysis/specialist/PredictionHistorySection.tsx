/**
 * specialist/PredictionHistorySection.tsx — §8 Prediction History (predictions.db).
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 1191–1317).
 * Table of last 10 predictions with status + return% + hit/miss badge.
 *
 * Rule 67: accuracy stat ONLY shown if ≥5 closed predictions (no fabrication).
 */
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, CheckCircle, Trophy } from 'lucide-react';
import type { PredictionsResponse } from './types';
import { fmtNum, safeNum, safeStr } from './helpers';
import { EmptyState, SectionCard } from './primitives';

export function PredictionHistorySection({ data }: { data: PredictionsResponse | null }) {
  if (!data || !data.success) {
    return (
      <SectionCard
        icon={<Trophy className="w-4 h-4" />}
        title="سجل التوقعات لهذا السهم"
        description="من /api/predictions?ticker=X — predictions.db مباشرة (Rule 67)"
        accent="amber"
      >
        <EmptyState msg="تعذّر تحميل سجل التوقعات — حاول مرة أخرى" />
      </SectionCard>
    );
  }

  const preds = data.data ?? [];
  if (preds.length === 0) {
    return (
      <SectionCard
        icon={<Trophy className="w-4 h-4" />}
        title="سجل التوقعات لهذا السهم"
        description="من /api/predictions?ticker=X — predictions.db مباشرة (Rule 67)"
        accent="amber"
      >
        <EmptyState msg="لا توجد توقعات سابقة لهذا السهم" />
      </SectionCard>
    );
  }

  const stats = data.stats;
  const closedCount = stats?.closedCount ?? 0;
  const hits = stats?.hits ?? 0;
  const accuracy = stats?.accuracy ?? null;
  const showAccuracy = accuracy != null; // Rule 67: only if ≥5 closed

  return (
    <SectionCard
      icon={<Trophy className="w-4 h-4" />}
      title="سجل التوقعات لهذا السهم"
      description={`من /api/predictions?ticker=${data.ticker ?? ''} — ${preds.length} توقع${closedCount > 0 ? ` (${closedCount} مغلق)` : ''}`}
      accent="amber"
    >
      {showAccuracy && (
        <div className="mb-3 p-3 bg-warning/10 border border-warning/20 rounded-lg">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-warning">
              دقة التوقعات المغلقة
            </p>
            <p className="text-2xl font-bold text-warning">{accuracy}%</p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {hits} ناجحة من {closedCount} توقعات مغلقة — Rule 67: لا تُعرض الإحصائية إلا بعد ≥5 توقعات مغلقة
          </p>
          <Progress value={accuracy ?? 0} className="h-1.5 mt-2" />
        </div>
      )}
      {!showAccuracy && closedCount > 0 && (
        <p className="mb-3 text-xs text-muted-foreground italic">
          عدد التوقعات المغلقة ({closedCount}) أقل من 5 — لا تُعرض إحصائية الدقة (Rule 67)
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-right p-2 font-medium">التاريخ</th>
              <th className="text-right p-2 font-medium">الإشارة</th>
              <th className="text-right p-2 font-medium">الدخول</th>
              <th className="text-right p-2 font-medium">الهدف</th>
              <th className="text-right p-2 font-medium">الوقف</th>
              <th className="text-right p-2 font-medium">الحالة</th>
              <th className="text-right p-2 font-medium">العائد %</th>
              <th className="text-right p-2 font-medium">تحقق</th>
            </tr>
          </thead>
          <tbody>
            {preds.slice(0, 10).map((p, i) => {
              const returnPct = safeNum(p.actual_return);
              const status = safeStr(p.status) ?? safeStr(p.signal_type) ?? '—';
              const hitTarget = p.hit_target === 1 || p.hit_target === true || (returnPct != null && returnPct > 0);
              return (
                <tr key={i} className="border-b last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="p-2 whitespace-nowrap">{safeStr(p.prediction_date)?.slice(0, 10) ?? '—'}</td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-xs">
                      {safeStr(p.signal) ?? '—'}
                    </Badge>
                  </td>
                  <td className="p-2">{fmtNum(p.entry_price)}</td>
                  <td className="p-2 text-profit">{fmtNum(p.target_price)}</td>
                  <td className="p-2 text-loss">{fmtNum(p.stop_loss)}</td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-xs">
                      {status}
                    </Badge>
                  </td>
                  <td className={`p-2 font-semibold ${returnPct == null ? '' : returnPct >= 0 ? 'text-profit' : 'text-loss'}`}>
                    {returnPct != null ? `${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="p-2">
                    {returnPct == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : hitTarget ? (
                      <CheckCircle className="w-4 h-4 text-profit inline" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-loss inline" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {preds.length > 10 && (
        <p className="text-xs text-muted-foreground mt-2 text-center">
          عرض أول 10 توقعات من إجمالي {preds.length}
        </p>
      )}
    </SectionCard>
  );
}
