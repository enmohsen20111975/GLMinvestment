'use client';

/**
 * NewsHealthTab
 * =============
 * Task 28-B (Fix 6 — Fix Battalion):
 *   News source health dashboard.
 *
 *   Shows:
 *     - Per-source last_fetch + article count + success_rate (proxy)
 *     - Broken sources (argaam, amwal, youm7 — returning HTML not RSS)
 *     - Source type breakdown (rss/telegram/web)
 *
 *   Was P0 missing (Task 27-B audit): admin could CRUD news items via
 *   NewsManagementTab but had NO dashboard to see per-source health
 *   or detect broken sources.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Newspaper, RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  Clock, Activity, Bug, Wifi, WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SourceHealth {
  source: string;
  source_type: 'rss' | 'telegram' | 'web' | 'broken';
  article_count: number;
  last_fetch: string | null;
  last_fetch_human: string | null;
  is_broken: boolean;
  broken_reason?: string;
  success_rate: number;
  success_rate_label: 'healthy' | 'degraded' | 'broken';
}

interface NewsHealthResponse {
  success: boolean;
  error?: string;
  detail?: string;
  timestamp?: string;
  total_sources?: number;
  total_articles?: number;
  broken_sources_count?: number;
  sources?: SourceHealth[];
  known_broken_sources?: Array<{ source: string; reason: string }>;
}

const SOURCE_TYPE_LABELS: Record<string, { ar: string; color: string }> = {
  rss: { ar: 'RSS', color: 'border-sky-500 text-sky-700' },
  telegram: { ar: 'تيليجرام', color: 'border-whale text-whale' },
  web: { ar: 'ويب', color: 'border-purple-500 text-purple-700' },
  broken: { ar: 'معطّل', color: 'border-loss text-loss' },
};

const STATUS_LABELS: Record<string, { ar: string; color: string; dot: string }> = {
  healthy: { ar: 'سليم', color: 'border-profit text-profit', dot: 'bg-profit' },
  degraded: { ar: 'متدهور', color: 'border-warning text-warning', dot: 'bg-warning' },
  broken: { ar: 'معطّل', color: 'border-loss text-loss', dot: 'bg-loss' },
};

export function NewsHealthTab() {
  const [data, setData] = useState<NewsHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/news-health', { credentials: 'same-origin', cache: 'no-store' });
      const json: NewsHealthResponse = await res.json();
      setData(json);
      if (!json.success) {
        toast.error(json.error || 'فشل تحميل صحة مصادر الأخبار');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const sources = data?.sources ?? [];
  const totalArticles = data?.total_articles ?? 0;
  const totalSources = data?.total_sources ?? 0;
  const brokenCount = data?.broken_sources_count ?? 0;
  const healthyCount = sources.filter(s => s.success_rate_label === 'healthy').length;
  const degradedCount = sources.filter(s => s.success_rate_label === 'degraded').length;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <Card className="border-profit dark:border-profit/40">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Newspaper className="w-5 h-5 text-profit" />
                صحة مصادر الأخبار
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                لكل مصدر: آخر fetch + عدد المقالات + نسبة النجاح. المصادر المعطّلة تُظهر السبب.
              </CardDescription>
            </div>
            <Button onClick={fetchHealth} disabled={loading} variant="ghost" size="sm" className="gap-2">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              تحديث
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox
          label="إجمالي المصادر"
          value={totalSources}
          icon={<Activity className="w-4 h-4 text-sky-500" />}
        />
        <StatBox
          label="إجمالي المقالات"
          value={totalArticles}
          icon={<Newspaper className="w-4 h-4 text-profit" />}
        />
        <StatBox
          label="مصادر سليمة"
          value={healthyCount}
          icon={<CheckCircle2 className="w-4 h-4 text-profit" />}
        />
        <StatBox
          label="مصادر معطّلة"
          value={brokenCount}
          icon={<WifiOff className="w-4 h-4 text-loss" />}
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
        <Card className="border-loss bg-loss dark:bg-loss/20 dark:border-loss/40">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-loss shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-loss dark:text-loss">فشل تحميل بيانات مصادر الأخبار</p>
              <p className="text-xs text-muted-foreground mt-1">{data.error}</p>
              {data.detail && (
                <p className="text-[11px] text-muted-foreground mt-1" dir="ltr">{data.detail}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Broken sources alert */}
      {data?.success && brokenCount > 0 && (
        <Card className="border-loss bg-loss dark:bg-loss/20 dark:border-loss/40">
          <CardContent className="p-4 flex items-start gap-3">
            <Bug className="w-5 h-5 text-loss shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-loss dark:text-loss">
                {brokenCount} مصدر معطّل — يُرجع HTML بدلاً من RSS
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                هذه المصادر تظهر في كود news-collector لكنها لم تُكتب أي مقالات.
                راجع news collector وحوّلها إلى RSS parser أو احذفها.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sources table */}
      {data?.success && sources.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-profit" />
              المصادر ({sources.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[40rem] overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="text-right border-b">
                    <th className="p-2 font-medium">المصدر</th>
                    <th className="p-2 font-medium">النوع</th>
                    <th className="p-2 font-medium">المقالات</th>
                    <th className="p-2 font-medium">آخر fetch</th>
                    <th className="p-2 font-medium">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s, i) => {
                    const statusInfo = STATUS_LABELS[s.success_rate_label];
                    const typeInfo = SOURCE_TYPE_LABELS[s.source_type] || SOURCE_TYPE_LABELS.web;
                    return (
                      <tr
                        key={i}
                        className={cn(
                          'border-b hover:bg-muted/30',
                          s.is_broken && 'bg-loss dark:bg-loss/10',
                        )}
                      >
                        <td className="p-2">
                          <div className="font-medium">{s.source}</div>
                          {s.broken_reason && (
                            <div className="text-[10px] text-loss mt-0.5 line-clamp-2">{s.broken_reason}</div>
                          )}
                        </td>
                        <td className="p-2">
                          <Badge variant="outline" className={cn('text-[10px]', typeInfo.color)}>
                            {typeInfo.ar}
                          </Badge>
                        </td>
                        <td className="p-2 font-mono" dir="ltr">
                          {s.article_count.toLocaleString()}
                        </td>
                        <td className="p-2">
                          {s.last_fetch_human ? (
                            <div>
                              <div className="flex items-center gap-1 text-[11px]">
                                <Clock className="w-3 h-3" />
                                {s.last_fetch_human}
                              </div>
                              {s.last_fetch && (
                                <div className="text-[9px] text-muted-foreground" dir="ltr">
                                  {new Date(s.last_fetch).toLocaleString('ar-EG')}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-[10px] text-loss">— لا يوجد</span>
                          )}
                        </td>
                        <td className="p-2">
                          <Badge variant="outline" className={cn('text-[10px] gap-1', statusInfo.color)}>
                            <span className={cn('w-1.5 h-1.5 rounded-full inline-block', statusInfo.dot)} />
                            {statusInfo.ar}
                          </Badge>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {Math.round(s.success_rate * 100)}%
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {data?.success && sources.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Newspaper className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>لا توجد مصادر أخبار في news.db بعد.</p>
            <p className="text-xs mt-1">شغّل news-collector مرة واحدة على الأقل.</p>
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
