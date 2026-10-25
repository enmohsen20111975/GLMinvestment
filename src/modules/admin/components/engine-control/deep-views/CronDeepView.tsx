/**
 * engine-control/deep-views/CronDeepView.tsx
 * ========================================
 * Cron Jobs — 25 jobs from crontab.txt.
 *
 * Shows 5 summary stats + a scrollable list of all cron jobs with their
 * schedule, last-run time, and age-based status pill.
 */
'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CronHealthResponse } from '@/hooks/useEngineControlRoomData';
import { statusTone } from '../helpers';

/** Cron Jobs — 25 jobs from crontab.txt. */
export function CronDeepView({ cron }: { cron: CronHealthResponse | null }) {
  if (!cron?.success || !cron.jobs) {
    return (
      <div className="text-xs text-muted-foreground italic p-4 border border-dashed rounded-md">
        {cron?.error || 'فشل تحميل بيانات الكرون.'}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center text-xs">
        <div className="rounded-md border p-2">
          <div className="text-muted-foreground">إجمالي</div>
          <div className="font-bold text-base">{cron.summary?.total_jobs ?? 0}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-muted-foreground">شُغّلت</div>
          <div className="font-bold text-base text-profit">{cron.summary?.jobs_ran ?? 0}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-muted-foreground">لم تُشغّل</div>
          <div className="font-bold text-base text-loss">{cron.summary?.jobs_never_run ?? 0}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-muted-foreground">اليوم</div>
          <div className="font-bold text-base text-profit">{cron.summary?.jobs_run_today ?? 0}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-muted-foreground">قديمة</div>
          <div className="font-bold text-base text-warning">{cron.summary?.jobs_stale_7d ?? 0}</div>
        </div>
      </div>
      <div className="max-h-96 overflow-y-auto space-y-1">
        {cron.jobs.map((job) => {
          let tone;
          if (!job.exists_log || !job.last_run) {
            tone = statusTone('stopped');
          } else {
            const ageMs = Date.now() - new Date(job.last_run).getTime();
            if (ageMs < 24 * 60 * 60 * 1000) tone = statusTone('running');
            else if (ageMs < 7 * 24 * 60 * 60 * 1000) tone = statusTone('slow');
            else tone = statusTone('stopped');
          }
          return (
            <div key={job.id} className={cn('p-2 rounded-md border text-xs', tone.bg)}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-xs" dir="ltr">#{job.id}</Badge>
                  <Badge variant="outline" className="text-xs" dir="ltr">{job.schedule}</Badge>
                  <Badge variant="outline" className="text-xs">{job.category}</Badge>
                </div>
                <Badge variant="outline" className={cn('text-xs', tone.badge)}>
                  {job.last_run_human || 'لم يُشغّل'}
                </Badge>
              </div>
              <div className="mt-1">{job.description}</div>
              <code className="text-xs text-muted-foreground block mt-0.5 truncate" dir="ltr">{job.command}</code>
            </div>
          );
        })}
      </div>
    </div>
  );
}
