'use client';

/**
 * ShariaManagementTab
 * ===================
 * Task 28-B (Fix 1 — Fix Battalion):
 *   Admin UI for the Sharia compliance subsystem (Rule 64 — SHARIA-COMPLIANCE).
 *
 *   Shows:
 *     - Summary stats from /api/sharia (consensus_count, total, latest_source_update)
 *     - The 8 sharia sources (sharia_sources table) with active flag
 *     - Review queue (alias_map rows where confidence != 'high' OR needs_review=1)
 *     - "تشغيل السكرابر" button → POST /api/admin/sharia/run
 *
 *   This tab replaces what was previously a missing-P0 admin feature:
 *   the backend existed (sharia_compliance_scraper.py, /api/sharia) but
 *   there was no admin UI to trigger the scraper or review its output.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sparkles, RefreshCw, Loader2, AlertTriangle, CheckCircle2, XCircle,
  Play, Coins, ShieldCheck, Clock, ChevronDown, ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ShariaStats {
  total?: number;
  consensus_count?: number;
  with_sp_rate?: number;
  latest_source_update?: string | null;
}

interface ShariaSource {
  source_key: string;
  name_ar: string;
  methodology?: string | null;
  is_active?: number | boolean;
}

interface ShariaAliasRow {
  source_symbol: string;
  resolved_ticker: string;
  match_method: string | null;
  confidence: string | null;
  needs_review: number | boolean;
  source_name_ar: string | null;
  matched_in: string | null;
  resolved_at: string | null;
}

interface ShariaApiResponse {
  success: boolean;
  error?: string;
  hint?: string;
  stats?: ShariaStats;
  sources?: ShariaSource[];
  alias_map?: {
    totals: Array<{ match_method: string; confidence: string; needs_review: number; n: number }>;
    review_queue: ShariaAliasRow[];
  };
  primary_method?: string;
  consensus_min?: number;
  generated_at?: string;
}

interface RunResponse {
  success: boolean;
  error?: string;
  exit_code?: number | null;
  duration_human?: string;
  timed_out?: boolean;
  stdout_tail?: string;
  stderr_tail?: string;
  hint?: string;
  next_step_hint?: string;
}

export function ShariaManagementTab() {
  const [data, setData] = useState<ShariaApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResponse | null>(null);
  const [showRunLog, setShowRunLog] = useState(false);

  const fetchSharia = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sharia?limit=1', { cache: 'no-store' });
      const json: ShariaApiResponse = await res.json();
      setData(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSharia();
  }, [fetchSharia]);

  const triggerScraper = async (syncStocks = false) => {
    setRunning(true);
    setRunResult(null);
    setShowRunLog(true);
    try {
      const res = await fetch('/api/admin/sharia/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ sync_stocks: syncStocks }),
      });
      const json: RunResponse = await res.json();
      setRunResult(json);
      if (json.success) {
        toast.success(`تم تشغيل السكرابر بنجاح (${json.duration_human || '?'})`);
        // Refresh stats after a short delay so the DB has time to commit
        setTimeout(() => fetchSharia(), 1200);
      } else {
        toast.error(json.error || 'فشل تشغيل السكرابر');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
      setRunResult({ success: false, error: 'network_error' });
    } finally {
      setRunning(false);
    }
  };

  const stats = data?.stats;
  const sources = data?.sources ?? [];
  const reviewQueue = data?.alias_map?.review_queue ?? [];
  const aliasTotals = data?.alias_map?.totals ?? [];
  const totalSources = sources.length;
  const activeSources = sources.filter(s => s.is_active).length;
  const consensusPct = stats?.total && stats.total > 0
    ? Math.round(((stats.consensus_count ?? 0) / stats.total) * 100)
    : 0;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <Card className="border-emerald-200 dark:border-emerald-900/40">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                الفحص الشرعي — إدارة بيانات التوافق
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
               Rule 64 (SHARIA-COMPLIANCE) — السكرابر أسبوعياً يوم السبت 15:00 UTC. هنا تقدر تشغّله يدوياً + مراجعة الرموز المتعارضة.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => triggerScraper(false)}
                disabled={running || loading}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {running ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    جاري التشغيل...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    تشغيل السكرابر
                  </>
                )}
              </Button>
              <Button
                onClick={() => triggerScraper(true)}
                disabled={running || loading}
                variant="outline"
                className="gap-2 border-emerald-500 text-emerald-700 hover:bg-emerald-50"
              >
                <Sparkles className="w-4 h-4" />
                تشغيل + مزامنة stocks.db
              </Button>
              <Button onClick={fetchSharia} disabled={loading} variant="ghost" size="sm" className="gap-2">
                <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
                تحديث
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Run log */}
      {showRunLog && runResult && (
        <Card className={cn(
          'border',
          runResult.success
            ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800/40'
            : 'border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800/40',
        )}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                {runResult.success
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  : <XCircle className="w-4 h-4 text-red-600" />}
                نتيجة تشغيل السكرابر
                {runResult.duration_human && (
                  <Badge variant="outline" className="text-[10px]">{runResult.duration_human}</Badge>
                )}
                {runResult.timed_out && (
                  <Badge variant="destructive" className="text-[10px]">انتهت المهلة</Badge>
                )}
                {typeof runResult.exit_code === 'number' && (
                  <Badge variant="outline" className="text-[10px]">exit={runResult.exit_code}</Badge>
                )}
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowRunLog(false)}
                className="h-7 text-xs"
              >
                إغلاق
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {runResult.next_step_hint && (
              <p className="text-xs text-muted-foreground">{runResult.next_step_hint}</p>
            )}
            {runResult.stderr_tail && (
              <div>
                <p className="text-[11px] font-bold text-red-700 mb-1">stderr (آخر 4KB):</p>
                <pre className="text-[10px] bg-muted/50 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap" dir="ltr">
                  {runResult.stderr_tail}
                </pre>
              </div>
            )}
            {runResult.stdout_tail && (
              <div>
                <p className="text-[11px] font-bold text-emerald-700 mb-1">stdout (آخر 4KB):</p>
                <pre className="text-[10px] bg-muted/50 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap" dir="ltr">
                  {runResult.stdout_tail}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox
          label="إجمالي الأسهم المفحوصة"
          value={stats?.total ?? '—'}
          icon={<ShieldCheck className="w-4 h-4 text-emerald-500" />}
        />
        <StatBox
          label="متوافق (إجماع 6+)"
          value={stats?.consensus_count ?? '—'}
          sub={stats?.total ? `${consensusPct}%` : undefined}
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
        />
        <StatBox
          label="بها نسبة تطهير S&P"
          value={stats?.with_sp_rate ?? '—'}
          icon={<Coins className="w-4 h-4 text-amber-500" />}
        />
        <StatBox
          label="آخر تحديث لمصدر"
          value={stats?.latest_source_update
            ? new Date(stats.latest_source_update).toLocaleDateString('ar-EG')
            : '—'}
          icon={<Clock className="w-4 h-4 text-sky-500" />}
        />
      </div>

      {/* Loading */}
      {loading && !data && (
        <Card>
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {!loading && data && !data.success && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800/40">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-800 dark:text-amber-300">
                {data.error === 'sharia_not_scraped' ? 'لم تُسحب بيانات الشريعة بعد' : 'خطأ في القراءة'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.hint || data.error}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                اضغط «تشغيل السكرابر» لتفريغ الجداول أول مرة.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sources */}
      {data?.success && sources.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-500" />
              المصادر الشرعية ({activeSources}/{totalSources} نشط)
            </CardTitle>
            <CardDescription className="text-xs">
              المنهجية الأساسية: <Badge variant="outline" className="text-[10px]">{data.primary_method ?? 'S&P'}</Badge>
              {' '}· الحد الأدنى للإجماع: <Badge variant="outline" className="text-[10px]">{data.consensus_min ?? 6}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {sources.map((s) => (
                <div
                  key={s.source_key}
                  className={cn(
                    'p-3 rounded-lg border text-xs',
                    s.is_active
                      ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800/40'
                      : 'border-muted bg-muted/20 opacity-60',
                  )}
                >
                  <div className="font-bold truncate">{s.name_ar || s.source_key}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5" dir="ltr">{s.source_key}</div>
                  {s.methodology && (
                    <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{s.methodology}</div>
                  )}
                  <Badge
                    variant={s.is_active ? 'default' : 'outline'}
                    className={cn('mt-1 text-[9px]', s.is_active && 'bg-emerald-600')}
                  >
                    {s.is_active ? 'نشط' : 'متوقف'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Review queue (alias map) */}
      {data?.success && reviewQueue.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              طابور المراجعة — رموز متعارضة ({reviewQueue.length})
            </CardTitle>
            <CardDescription className="text-xs">
              أسهم الرمز فيها مختلف بين المصدر الشرعي و stocks.db — تحتاج مراجعة يدوية.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="text-right border-b">
                    <th className="p-2 font-medium">الرمز بالمصدر</th>
                    <th className="p-2 font-medium">الرمز المحلول</th>
                    <th className="p-2 font-medium">المطابقة</th>
                    <th className="p-2 font-medium">الثقة</th>
                    <th className="p-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewQueue.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="p-2 font-mono" dir="ltr">{r.source_symbol}</td>
                      <td className="p-2 font-mono" dir="ltr">{r.resolved_ticker}</td>
                      <td className="p-2">{r.match_method || '—'}</td>
                      <td className="p-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px]',
                            r.confidence === 'high' && 'border-emerald-500 text-emerald-700',
                            r.confidence === 'medium' && 'border-amber-500 text-amber-700',
                            (!r.confidence || r.confidence === 'low') && 'border-red-500 text-red-700',
                          )}
                        >
                          {r.confidence || '—'}
                        </Badge>
                      </td>
                      <td className="p-2">
                        {r.needs_review ? (
                          <Badge variant="destructive" className="text-[10px]">مراجعة</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-emerald-500 text-emerald-700">تم</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alias totals summary */}
      {data?.success && aliasTotals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              ملخص مطابقات الرموز
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {aliasTotals.map((t, i) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {t.match_method || '—'} · {t.confidence || '—'} · {t.needs_review ? 'مراجعة' : 'تم'}: {t.n}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {data?.success && sources.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>لا توجد بيانات شريعة في data_engine.db بعد.</p>
            <p className="text-xs mt-1">اضغط «تشغيل السكرابر» لجلب البيانات أول مرة.</p>
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
  sub,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-lg font-bold">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
