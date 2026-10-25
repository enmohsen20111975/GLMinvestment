/**
 * engine-control/deep-views/PredictionsEngineDeepView.tsx
 * ======================================================
 * Predictions Engine — by-file performance + manual-regenerate trigger.
 *
 * PHASE2-ADMIN-PANEL: owner request — "زر إعادة توليد التوقعات لسوق معين
 * عند الطلب". Since /api/admin/generate-predictions is 410 Gone and
 * /api/daily/rebuild does NOT exist in this codebase, we cannot trigger
 * Python regeneration from the UI. Instead, the button shows a clear
 * message that predictions are auto-generated via cron (daily_predictor.py).
 * Rule 27: no fabricated endpoint call.
 */
'use client';

import React, { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Brain, AlertTriangle, RotateCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { EngineLogsResponse } from '@/hooks/useEngineControlRoomData';
import { statusTone, looksLikeError, timeAgoBrief } from '../helpers';

/** Predictions Engine — by-model performance. */
export function PredictionsEngineDeepView({ logs }: { logs: EngineLogsResponse | null }) {
  const files = logs?.engines?.predictions?.files || [];
  // PHASE2-ADMIN-PANEL: owner request — "زر إعادة توليد التوقعات لسوق معين
  // عند الطلب". Since /api/admin/generate-predictions is 410 Gone and
  // /api/daily/rebuild does NOT exist in this codebase, we cannot trigger
  // Python regeneration from the UI. Instead, the button shows a clear
  // message that predictions are auto-generated via cron (daily_predictor.py).
  // Rule 27: no fabricated endpoint call.
  const [market, setMarket] = useState<string>('EGX');
  const [regenLoading, setRegenLoading] = useState(false);

  const handleRegenerate = useCallback(() => {
    setRegenLoading(true);
    // No live endpoint to call — just inform the admin clearly.
    setTimeout(() => {
      setRegenLoading(false);
      toast.info(
        `التوقعات لسوق ${market} تُولّد تلقائيًا عبر cron (daily_predictor.py)`,
        {
          description:
            'مسار /api/admin/generate-predictions معطّل (410 Gone). ' +
            'مسار /api/daily/rebuild غير موجود. ' +
            'يتم التوليد آليًا في 05:00 و15:30 بتوقيت القاهرة.',
          duration: 6000,
        },
      );
    }, 400);
  }, [market]);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-warning bg-warning/20 p-3 text-xs">
        <AlertTriangle className="w-4 h-4 inline ml-1 text-warning" />
        الأداء لكل نموذج (technical / fundamental / master_score) بيتحسب من predictions.db.
        هنا بنعرض السجلات الحية لمحرك V40.2 + آخر تشغيل لكل job.
      </div>

      {/* PHASE2-ADMIN-PANEL: regenerate predictions for a specific market */}
      <Card className="border-profit/20">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Brain className="w-4 h-4 text-profit" />
            <span className="text-xs font-semibold">إعادة توليد التوقعات لسوق معين</span>
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="EGX">🇪🇬 EGX (مصر)</option>
              <option value="TADAWUL">🇸🇦 TADAWUL (السعودية)</option>
              <option value="KSE">🇰🇼 KSE (الكويت)</option>
              <option value="QSE">🇶🇦 QSE (قطر)</option>
              <option value="US">🇺🇸 US (أمريكا)</option>
              <option value="CRYPTO">₿ CRYPTO (عملات رقمية)</option>
            </select>
            <Button
              size="sm"
              onClick={handleRegenerate}
              disabled={regenLoading}
              className="gap-1.5 h-8 bg-profit hover:bg-profit text-white text-xs"
            >
              {regenLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              إعادة التوليد
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              ⚙️ تلقائي عبر cron — لا يدعم التشغيل اليدوي
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {files.map((f) => {
          const running = f.exists && f.mtime
            ? Date.now() - new Date(f.mtime).getTime() < 60 * 60 * 1000
            : false;
          const tone = running
            ? statusTone('running')
            : f.exists
            ? statusTone('slow')
            : statusTone('stopped');
          const errCount = f.lines.filter(looksLikeError).length;
          return (
            <Card key={f.path} className={cn('border', tone.bg)}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-xs truncate" dir="ltr">{f.path}</code>
                  <Badge variant="outline" className={cn('text-xs shrink-0', tone.badge)}>
                    <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
                    {tone.label}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  آخر تشغيل: {f.mtime ? timeAgoBrief(f.mtime) : 'لم يُشغّل'}
                </div>
                {errCount > 0 && (
                  <div className="text-xs text-loss">{errCount} خطأ</div>
                )}
                {f.exists && f.lines.length > 0 && (
                  <div className="rounded bg-slate-950 text-slate-200 p-1.5 font-mono text-xs max-h-24 overflow-y-auto" dir="ltr">
                    {f.lines.slice(-5).map((l, i) => (
                      <div key={i} className={cn('whitespace-pre-wrap break-all truncate', looksLikeError(l) ? 'text-loss' : 'text-muted-foreground')}>
                        {l || ' '}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
