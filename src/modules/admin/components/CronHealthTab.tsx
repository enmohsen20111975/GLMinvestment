'use client';

/**
 * CronHealthTab
 * =============
 * Task 28-B (Fix 4 — Fix Battalion):
 *   Admin dashboard for all 25 cron jobs declared in crontab.txt.
 *
 *   Shows:
 *     - Summary stats: total jobs, ran before, never run, run today, stale (>7d)
 *     - Per-job table: schedule (cron expr + human), days, last_run timestamp
 *       (from /tmp/*.log mtime), category
 *     - Color-coded: green (run today), amber (run this week), red (never/stale)
 *
 *   Was P0 missing (Task 27-B audit): crontab.txt lists 25 jobs but no admin
 *   panel surfaced their last_run/exit status — admin had no way to know
 *   which crons were silently failing.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Clock, RefreshCw, Activity, AlertTriangle, CheckCircle2,
  XCircle, Calendar, FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CronJob {
  id: number;
  schedule: string;
  schedule_human: string;
  days_ar: string;
  command: string;
  full_command: string;
  log_file: string | null;
  last_run: string | null;
  last_run_human: string | null;
  exists_log: boolean;
  description: string;
  category: string;
}

interface CronHealthResponse {
  success: boolean;
  error?: string;
  timestamp?: string;
  source?: string;
  summary?: {
    total_jobs: number;
    jobs_ran: number;
    jobs_never_run: number;
    jobs_run_today: number;
    jobs_stale_7d: number;
  };
  jobs?: CronJob[];
}

function jobStatusColor(job: CronJob): {
  border: string;
  badge: string;
  dot: string;
  label: string;
} {
  if (!job.exists_log || !job.last_run) {
    return {
      border: 'border-loss bg-loss dark:bg-loss/20 dark:border-loss/40',
      badge: 'border-loss text-loss',
      dot: 'bg-loss',
      label: 'لم يُشغّل',
    };
  }
  const ageMs = Date.now() - new Date(job.last_run).getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  const sevenDays = 7 * oneDay;
  if (ageMs < oneDay) {
    return {
      border: 'border-profit bg-profit dark:bg-profit/20 dark:border-profit/40',
      badge: 'border-profit text-profit',
      dot: 'bg-profit',
      label: 'طازج (<24س)',
    };
  }
  if (ageMs < sevenDays) {
    return {
      border: 'border-warning bg-warning dark:bg-warning/20 dark:border-warning/40',
      badge: 'border-warning text-warning',
      dot: 'bg-warning',
      label: 'هذا الأسبوع',
    };
  }
  return {
    border: 'border-loss bg-loss dark:bg-loss/20 dark:border-loss/40',
    badge: 'border-loss text-loss',
    dot: 'bg-loss',
    label: 'قديم (>7أيام)',
  };
}

export function CronHealthTab() {
  const [data, setData] = useState<CronHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const fetchCron = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/cron-health', { credentials: 'same-origin', cache: 'no-store' });
      const json: CronHealthResponse = await res.json();
      setData(json);
      if (!json.success) {
        toast.error(json.error || 'فشل تحميل بيانات الكرون');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCron();
  }, [fetchCron]);

  const summary = data?.summary;
  const jobs = data?.jobs ?? [];
  const categories = Array.from(new Set(jobs.map(j => j.category)));
  const filteredJobs = categoryFilter === 'all'
    ? jobs
    : jobs.filter(j => j.category === categoryFilter);

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <Card className="border-profit dark:border-profit/40">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="w-5 h-5 text-profit" />
                حالة المهام — Cron Health
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                جميع مهام crontab.txt (25 مهمة) + آخر تشغيل لكل مهمة (من mtime لملفات اللوج).
              </CardDescription>
            </div>
            <Button onClick={fetchCron} disabled={loading} variant="ghost" size="sm" className="gap-2">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              تحديث
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatBox
          label="إجمالي المهام"
          value={summary?.total_jobs ?? '—'}
          icon={<Activity className="w-4 h-4 text-sky-500" />}
        />
        <StatBox
          label="شُغّلت من قبل"
          value={summary?.jobs_ran ?? '—'}
          icon={<CheckCircle2 className="w-4 h-4 text-profit" />}
        />
        <StatBox
          label="لم تُشغّل"
          value={summary?.jobs_never_run ?? '—'}
          icon={<XCircle className="w-4 h-4 text-loss" />}
        />
        <StatBox
          label="شُغّلت اليوم"
          value={summary?.jobs_run_today ?? '—'}
          icon={<Calendar className="w-4 h-4 text-profit" />}
        />
        <StatBox
          label="قديمة (>7 أيام)"
          value={summary?.jobs_stale_7d ?? '—'}
          icon={<AlertTriangle className="w-4 h-4 text-warning" />}
        />
      </div>

      {/* Loading */}
      {loading && !data && (
        <Card>
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {!loading && data && !data.success && (
        <Card className="border-loss bg-loss dark:bg-loss/20 dark:border-loss/40">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-loss shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-loss dark:text-loss">فشل تحميل بيانات الكرون</p>
              <p className="text-xs text-muted-foreground mt-1">{data.error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Category filter */}
      {data?.success && jobs.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-muted-foreground">تصفية حسب الفئة:</span>
          <Button
            variant={categoryFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setCategoryFilter('all')}
          >
            الكل ({jobs.length})
          </Button>
          {categories.map(cat => {
            const count = jobs.filter(j => j.category === cat).length;
            return (
              <Button
                key={cat}
                variant={categoryFilter === cat ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setCategoryFilter(cat)}
              >
                {cat} ({count})
              </Button>
            );
          })}
        </div>
      )}

      {/* Jobs table */}
      {data?.success && filteredJobs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-profit" />
              مهام الكرون ({filteredJobs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[40rem] overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
              <div className="space-y-2">
                {filteredJobs.map((job) => {
                  const status = jobStatusColor(job);
                  return (
                    <div
                      key={job.id}
                      className={cn('p-3 rounded-lg border', status.border)}
                    >
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <Badge variant="outline" className="text-[10px] font-mono" dir="ltr">
                              #{job.id}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]" dir="ltr">
                              {job.schedule}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {job.category}
                            </Badge>
                            <Badge variant="outline" className={cn('text-[10px]', status.badge)}>
                              <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', status.dot)} />
                              {status.label}
                            </Badge>
                          </div>
                          <p className="text-xs font-medium mb-1">{job.description}</p>
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {job.days_ar}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {job.schedule_human}
                            </span>
                          </div>
                          <code className="text-[10px] text-muted-foreground block mt-1 truncate" dir="ltr">
                            {job.command}
                          </code>
                        </div>
                        <div className="text-left shrink-0">
                          {job.last_run_human ? (
                            <>
                              <div className="text-xs font-bold">{job.last_run_human}</div>
                              <div className="text-[10px] text-muted-foreground" dir="ltr">
                                {new Date(job.last_run!).toLocaleString('ar-EG')}
                              </div>
                              <code className="text-[9px] text-muted-foreground block mt-0.5" dir="ltr">
                                {job.log_file}
                              </code>
                            </>
                          ) : (
                            <div className="text-xs text-loss font-bold">لا يوجد لوج</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {data?.success && jobs.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>لا توجد مهام كرون في crontab.txt</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small presentational helper                                       */
/* ------------------------------------------------------------------ */

function StatBox({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
