'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Activity } from 'lucide-react';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ConfluenceGaugesProps {
  technical_score: number;       // 0-100
  fundamental_score: number;     // 0-100
  volume_seasonal_score: number; // 0-100
  confluence_score: number;      // 0-100
  signal?: string;               // STRONG BUY, BUY, HOLD, SELL, etc.
  loading?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getScoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 50) return 'text-amber-600 dark:text-amber-400';
  if (score >= 30) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

function getProgressColor(score: number): string {
  if (score >= 70) return '[&>div]:bg-emerald-500';
  if (score >= 50) return '[&>div]:bg-amber-500';
  if (score >= 30) return '[&>div]:bg-orange-500';
  return '[&>div]:bg-red-500';
}

function getBadgeColor(score: number): string {
  if (score >= 70) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0';
  if (score >= 50) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-0';
  if (score >= 30) return 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 border-0';
  return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-0';
}

/** Translate English signal to Arabic */
function signalToArabic(signal: string): string {
  const map: Record<string, string> = {
    'STRONG BUY': 'شراء قوي',
    'BUY': 'شراء',
    'HOLD': 'محافظة',
    'SELL': 'بيع',
    'STRONG SELL': 'بيع قوي',
  };
  return map[signal.toUpperCase()] || signal;
}

function signalToRatingScore(signal: string): number {
  const map: Record<string, number> = {
    'STRONG BUY': 90,
    'BUY': 70,
    'HOLD': 50,
    'SELL': 30,
    'STRONG SELL': 10,
  };
  return map[signal.toUpperCase()] || 50;
}

// ─── Gauge Item ─────────────────────────────────────────────────────────────

interface GaugeItemProps {
  label: string;
  score: number;
  maxScore?: number;
}

function GaugeItem({ label, score, maxScore = 100 }: GaugeItemProps) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className={cn('text-sm font-bold tabular-nums', getScoreColor(pct))}>
          {Math.round(pct)}
        </span>
      </div>
      <Progress
        value={pct}
        className={cn('h-3', getProgressColor(pct))}
      />
    </div>
  );
}

// ─── Loading Skeleton ───────────────────────────────────────────────────────

function ConfluenceGaugesSkeleton() {
  return (
    <Card className="border-border/50" dir="rtl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-10 w-16" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-8" />
            </div>
            <Skeleton className="h-3 w-full rounded-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ConfluenceGauges({
  technical_score,
  fundamental_score,
  volume_seasonal_score,
  confluence_score,
  signal,
  loading,
}: ConfluenceGaugesProps) {
  if (loading) return <ConfluenceGaugesSkeleton />;

  const overallScore = Math.max(0, Math.min(100, confluence_score));
  const techRating = signal ? signalToRatingScore(signal) : overallScore;

  const gauges: GaugeItemProps[] = [
    { label: 'الزخم', score: technical_score, maxScore: 100 },
    { label: 'التقنية', score: techRating, maxScore: 100 },
    { label: 'الجودة', score: fundamental_score, maxScore: 100 },
    { label: 'القيمة', score: volume_seasonal_score, maxScore: 100 },
  ];

  return (
    <Card className="border-border/50" dir="rtl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-600" />
            تحليل التوحيد
          </CardTitle>
          <div className="flex items-center gap-2">
            {signal && (
              <Badge className={cn('text-xs', getBadgeColor(overallScore))}>
                {signalToArabic(signal)}
              </Badge>
            )}
            <span className={cn('text-2xl font-bold tabular-nums', getScoreColor(overallScore))}>
              {Math.round(overallScore)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {gauges.map((gauge) => (
          <GaugeItem key={gauge.label} {...gauge} />
        ))}
      </CardContent>
    </Card>
  );
}
