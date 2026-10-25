/**
 * engine-control/deep-views/ShariaEngineDeepView.tsx
 * ================================================
 * Sharia Engine — 8 sources + alias review queue.
 *
 * Shows 4 summary stats (total / consensus / with_sp_rate / review_queue length)
 * + a grid of source cards + a review-queue table (max 30 rows).
 */
'use client';

import React from 'react';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ShariaApiResponse } from '@/hooks/useEngineControlRoomData';

/** Sharia Engine — 8 sources + alias review queue. */
export function ShariaEngineDeepView({ sharia }: { sharia: ShariaApiResponse | null }) {
  if (!sharia?.success) {
    return (
      <div className="text-xs text-muted-foreground italic p-4 border border-dashed rounded-md">
        {sharia?.error || 'فشل تحميل بيانات الفحص الشرعي.'}
      </div>
    );
  }
  const sources = sharia.sources || [];
  const reviewQueue = sharia.alias_map?.review_queue || [];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">إجمالي الأسهم</div>
          <div className="font-bold">{sharia.stats?.total ?? 0}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">إجماع</div>
          <div className="font-bold text-profit">{sharia.stats?.consensus_count ?? 0}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">مع نسبة S&P</div>
          <div className="font-bold">{sharia.stats?.with_sp_rate ?? 0}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">مراجعة مطلوبة</div>
          <div className="font-bold text-warning">{reviewQueue.length}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {sources.map((s) => (
          <Card key={s.source_key}>
            <CardContent className="p-3 flex items-center justify-between gap-2">
              <div>
                <div className="font-bold text-xs">{s.name_ar}</div>
                <div className="text-xs text-muted-foreground">
                  {s.methodology || '—'}
                </div>
              </div>
              <Badge variant="outline" className={cn('text-xs', s.is_active ? 'border-profit text-profit' : 'border-slate-400 text-muted-foreground')}>
                {s.is_active ? 'نشط' : 'موقوف'}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
      {reviewQueue.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              طابور المراجعة ({reviewQueue.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {reviewQueue.slice(0, 30).map((row, i) => (
                <div key={i} className="text-xs grid grid-cols-4 gap-2 border-b border-border pb-1">
                  <code dir="ltr">{row.source_symbol}</code>
                  <code dir="ltr" className="text-profit">{row.resolved_ticker}</code>
                  <span className="text-muted-foreground">{row.confidence || '—'}</span>
                  <span className="text-muted-foreground truncate">{row.source_name_ar || '—'}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
