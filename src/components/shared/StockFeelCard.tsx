'use client';

/**
 * StockFeelCard — ALPHA-STOCK-FEEL-1
 * ====================================================================
 * بطاقة "الإحساس بالسهم" — تعرض تحليل برافو الجديد (STOCK-FEEL API)
 * بشكل بسيط يفهمه المبتدئ + تفاصيل للخبير.
 *
 * Data source: GET /api/stock-screener/analyze?ticker=X
 * → correction_status, feel, action_hint, risk_level, layers_simple,
 *   correction_detail
 *
 * Token colors (متوازن light/dark):
 * - تصحيح حاد → loss (أحمر)
 * - صعود/انفجار → profit (أخضر)
 * - ثبات → warning (أصفر)
 */
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StockFeelCardProps {
  analysis: Record<string, unknown> | null | undefined;
}

function statusColor(status?: string): string {
  if (!status) return 'bg-muted text-muted-foreground border-border';
  if (status.includes('تصحيح حاد')) return 'bg-loss/15 text-loss border-loss/30';
  if (status.includes('انفجار') || status.includes('صعود')) return 'bg-profit/15 text-profit border-profit/30';
  if (status.includes('ثبات')) return 'bg-warning/15 text-warning border-warning/30';
  return 'bg-muted text-muted-foreground border-border';
}

function riskColor(risk?: string): string {
  if (risk === 'high') return 'text-loss';
  if (risk === 'medium') return 'text-warning';
  if (risk === 'low') return 'text-profit';
  return 'text-muted-foreground';
}

function riskLabelAr(risk?: string): string {
  if (risk === 'high') return 'عالية';
  if (risk === 'medium') return 'متوسطة';
  if (risk === 'low') return 'منخفضة';
  return '—';
}

export function StockFeelCard({ analysis }: StockFeelCardProps) {
  if (!analysis) return null;

  const feel = analysis.feel as string | undefined;
  const correctionStatus = analysis.correction_status as string | undefined;
  const actionHint = analysis.action_hint as string | undefined;
  const riskLevel = analysis.risk_level as string | undefined;
  const correctionDetail = analysis.correction_detail as string | undefined;
  const layersSimple = analysis.layers_simple as
    | Record<string, { label_ar?: string; state?: string; phase?: string; stage?: string; position?: string; confidence?: number }>
    | undefined;

  // لو مفيش أي حاجة جديدة → مفيش كارت
  if (!feel && !correctionStatus && !actionHint) return null;

  return (
    <Card className="border-primary/30 bg-primary/5" dir="rtl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          الإحساس بالسهم
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* feel — جملة كبيرة واضحة للمبتدئ */}
        {feel && (
          <p className="text-sm font-medium text-foreground leading-relaxed">{feel}</p>
        )}

        {/* correction_status + risk_level badges */}
        <div className="flex flex-wrap items-center gap-2">
          {correctionStatus && (
            <Badge className={cn('text-xs', statusColor(correctionStatus))}>{correctionStatus}</Badge>
          )}
          {riskLevel && (
            <Badge variant="outline" className={cn('text-xs', riskColor(riskLevel))}>
              مخاطر: {riskLabelAr(riskLevel)}
            </Badge>
          )}
        </div>

        {/* action_hint — نصيحة عملية في box مميز */}
        {actionHint && (
          <div className="rounded-lg bg-muted/60 border border-border p-2.5">
            <p className="text-xs font-semibold text-foreground">{actionHint}</p>
          </div>
        )}

        {/* layers_simple — 4 layers بـ label_ar */}
        {layersSimple && (
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(layersSimple).map(([key, val]) => (
              <div key={key} className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1.5">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">{key}</span>
                <span className="text-[10px] text-foreground">
                  {val?.label_ar || val?.state || val?.phase || val?.stage || val?.position || '—'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* correction_detail — للخبير (collapsible) */}
        {correctionDetail && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">تفاصيل للخبير</summary>
            <p className="mt-1 text-muted-foreground leading-relaxed">{correctionDetail}</p>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export default StockFeelCard;
