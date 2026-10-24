'use client';

/**
 * persona/TestingCandidatesSection.tsx
 * ============================================================================
 * F-Phase3-Split-PersonaTab — Testing candidates section (extracted).
 * ----------------------------------------------------------------------------
 * Originally lines 2057-2127 of `../PersonaTab.tsx`. Renders stocks currently
 * under testing / live monitoring (lifecycle_status='testing') as an 8-col
 * inline table.
 *
 * P0-4b — BRAVO-TESTING-CANDIDATES:
 * Pattern: mirror لـ EidPredictionsWidget — قسم منفصل للأسهم الـ
 * lifecycle_status='testing'. بتيجي من /api/unified/predictions تحت مفتاح
 * testing_candidates. بتـ refresh مع fetchPrevious كل 300s (لو liveMode) —
 * نفس الـ polling cycle.
 * ============================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';
import type { TestingCandidatesSectionProps } from './types';

export function TestingCandidatesSection({ candidates }: TestingCandidatesSectionProps) {
  if (candidates.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-warning/20 bg-warning/5 p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-warning flex items-center gap-1">
          🔍 أسهم تحت الاختبار والمراقبة اللحظية
          <span className="text-muted-foreground font-normal text-xs">
            (Pending Confirmation — {candidates.length})
          </span>
        </h4>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        فرص جديدة بتتـ validate — لو ثبتت معانا بتنتقل للتوقعات الأساسية. بتتبع حركة الجلسة أولاً بأول.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-right p-2 font-medium">السهم</th>
              <th className="text-center p-2 font-medium">الإشارة</th>
              <th className="text-center p-2 font-medium">الدخول</th>
              <th className="text-center p-2 font-medium">الهدف</th>
              <th className="text-center p-2 font-medium">وقف الخسارة</th>
              <th className="text-center p-2 font-medium">R/R</th>
              <th className="text-center p-2 font-medium">الثقة</th>
              <th className="text-center p-2 font-medium">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c, i) => {
              const sig = String(c.signal || 'HOLD').toUpperCase();
              const sigAr = sig === 'BUY' ? 'شراء' : sig === 'SELL' ? 'بيع' : 'انتظار';
              const sigCls =
                sig === 'BUY'
                  ? 'text-success'
                  : sig === 'SELL'
                    ? 'text-loss'
                    : 'text-muted-foreground';
              const conf =
                c.confidence != null
                  ? Math.round(c.confidence * 100)
                  : c.master_score != null
                    ? Math.round(c.master_score)
                    : null;
              return (
                <tr
                  key={`${c.ticker || '???'}-${i}`}
                  className="border-b border-border/50 hover:bg-muted/30"
                >
                  <td className="p-2 font-bold text-foreground">{c.ticker || '—'}</td>
                  <td className={cn('p-2 text-center font-medium', sigCls)}>{sigAr}</td>
                  <td className="p-2 text-center font-mono text-foreground">
                    {c.entry_price != null ? c.entry_price.toFixed(2) : '—'}
                  </td>
                  <td className="p-2 text-center font-mono text-success">
                    {c.target_price != null ? c.target_price.toFixed(2) : '—'}
                  </td>
                  <td className="p-2 text-center font-mono text-loss">
                    {c.stop_loss != null ? c.stop_loss.toFixed(2) : '—'}
                  </td>
                  <td className="p-2 text-center font-mono font-bold text-foreground">
                    {c.risk_reward != null ? `${c.risk_reward.toFixed(2)}:1` : '—'}
                  </td>
                  <td className="p-2 text-center font-mono text-foreground">
                    {conf != null ? `${conf}%` : '—'}
                  </td>
                  <td className="p-2 text-center text-muted-foreground text-[10px]">
                    {c.prediction_date ||
                      (c.created_at ? c.created_at.split('T')[0] : '—')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
