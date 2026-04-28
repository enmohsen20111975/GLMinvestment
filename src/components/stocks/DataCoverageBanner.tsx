'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, BarChart3, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

/* ------------------------------------------------------------------ */
/*  Types for the /api/stocks/data-coverage response                   */
/* ------------------------------------------------------------------ */
interface DataCoverageStock {
  ticker: string;
  name_ar: string;
  sector: string;
}

interface DataCoverageResponse {
  total_stocks: number;
  stocks_with_data: number;
  coverage_percent: number;
  stocks_without_data: number;
  no_data_stocks: DataCoverageStock[];
  last_updated: string;
}

/* ------------------------------------------------------------------ */
/*  Helper: coverage color scheme                                      */
/* ------------------------------------------------------------------ */
function coverageColor(percent: number) {
  if (percent > 70) return { border: 'border-emerald-300 dark:border-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-300', progress: '[&>div]:bg-emerald-500' };
  if (percent >= 40) return { border: 'border-amber-300 dark:border-amber-700', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-300', progress: '[&>div]:bg-amber-500' };
  return { border: 'border-red-300 dark:border-red-700', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-300', progress: '[&>div]:bg-red-500' };
}

/* ------------------------------------------------------------------ */
/*  Skeleton for loading state                                         */
/* ------------------------------------------------------------------ */
function DataCoverageSkeleton() {
  return (
    <Card className="mx-4 md:mx-6 mt-4">
      <CardContent className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-64" />
        </div>
        <Skeleton className="h-2.5 w-full rounded-full mb-3" />
        <Skeleton className="h-8 w-40 rounded-lg" />
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export function DataCoverageBanner() {
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  const [data, setData] = useState<DataCoverageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  /* Fetch data */
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/stocks/data-coverage', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DataCoverageResponse = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      console.error('[DataCoverageBanner] Failed to fetch:', err);
      setError('فشل في تحميل بيانات التغطية');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 minutes (reduced from 5 min to save resources)
    const interval = setInterval(fetchData, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  /* Loading skeleton */
  if (loading) return <DataCoverageSkeleton />;

  /* Error state */
  if (error || !data) return null;

  const colors = coverageColor(data.coverage_percent);

  /* Group stocks without data by sector */
  const groupedBySector: Record<string, DataCoverageStock[]> = {};
  for (const stock of (data.no_data_stocks || [])) {
    const sector = stock.sector || 'قطاعات أخرى';
    if (!groupedBySector[sector]) groupedBySector[sector] = [];
    groupedBySector[sector].push(stock);
  }

  const hasStocksWithoutData = (data.no_data_stocks || []).length > 0;

  return (
    <div className="mx-4 md:mx-6 mt-4" dir="rtl">
      <Card className={`${colors.border} ${colors.bg}`}>
        <CardContent className="p-4 space-y-3">
          {/* Summary row */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              {data.coverage_percent > 70 ? (
                <CheckCircle className={`w-5 h-5 ${colors.text}`} />
              ) : (
                <AlertTriangle className={`w-5 h-5 ${colors.text}`} />
              )}
              <span className={`text-sm font-semibold ${colors.text}`}>
                {data.stocks_with_data} من {data.total_stocks} سهم لديهم بيانات كافية للتحليل ({data.coverage_percent}%)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchData}
                className="h-8 px-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                onClick={() => setCurrentView('analysis')}
                className="h-8 gap-1.5"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                عرض التحليل الشامل
              </Button>
            </div>
          </div>

          {/* Progress bar */}
          <Progress
            value={data.coverage_percent}
            className={`h-2.5 ${colors.progress}`}
          />

          {/* Expandable section: stocks without data */}
          {hasStocksWithoutData && (
            <div>
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                <span>
                  عرض الأسهم بدون بيانات ({(data.no_data_stocks || []).length} سهم)
                </span>
              </button>

              {expanded && (
                <div className="mt-3 space-y-3 max-h-72 overflow-y-auto rounded-lg border border-border p-3 bg-background/60">
                  {Object.entries(groupedBySector).map(([sector, stocks]) => (
                    <div key={sector}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {sector}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          ({stocks.length})
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {stocks.map((s) => (
                          <Badge
                            key={s.ticker}
                            variant="secondary"
                            className="text-[11px] px-2 py-0.5 bg-muted/80 hover:bg-muted cursor-default"
                          >
                            {s.ticker} – {s.name_ar}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Timestamp */}
          {data.last_updated && (
            <p className="text-[10px] text-muted-foreground text-left" dir="ltr">
              آخر تحديث: {new Date(data.last_updated).toLocaleString('ar-EG')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
