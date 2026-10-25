'use client';

/**
 * TrackRecordWidget — "شوف كنا صح ولا غلط"
 * ====================================================================
 * FIX (owner directive — أقوى hook للعميل الجديد):
 *
 * العميل الجديد مش بيثق في "عندنا توقعات". لازم يشوف **track record حقيقي**:
 *   - إجمالي التوقعات + الناجحة + نسبة النجاح
 *   - top 3 توقعات (مع الخسائر كمان — ده اللي بيبني الثقة)
 *   - CTA لـ شوف كل التوقعات بالأدلة
 *
 * Rule 27 SAFE — كل الأرقام من /api/predictions/honest-tracking/live-tracking
 * (predictions.db، predictions حقيقية موثقة). مفيش mock.
 * Rule 67 (CLOSED-LOOP): الـ endpoint نفسه بـ يـ filter الـ returns السامة
 * (|eff_return| > 50% استثناها).
 *
 * Rule 20 (Python=Brain): الـ endpoint ده Node بس بـ يـ read من predictions.db
 * (مفيش calculations في الـ frontend — كل الـ stats جاية من الـ SQL).
 *
 * Phase 3 (WidgetCard adoption): الـ 3 branches (loading + empty/error + main)
 * اتدمجوا في WidgetCard واحد مع `loading` prop + badge slot + WidgetStatGrid
 * للأرقام الإجمالية (ناجحة/خاسرة/معدّل مكسب).
 */

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trophy, Target, XCircle, ArrowLeft, CheckCircle2, TrendingUp } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { WidgetStat, WidgetStatGrid } from '@/components/shared/WidgetStat';
import { Label, NumText, ChangeText, PriceValue } from '@/components/shared/ui';

interface TrackRecordSummary {
  closed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
}

interface TrackPrediction {
  id: number;
  ticker: string;
  signal_type: string;
  prediction_date: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  actual_return: number | null;
  pnl_pct: number | null;
  is_correct: number | null;
  exit_type: string | null;
  status: string;
  persona: string;
}

interface TrackRecordResponse {
  summary: TrackRecordSummary;
  predictions: TrackPrediction[];
}

export function TrackRecordWidget() {
  const currentMarket = useAppStore((s) => s.currentMarket);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const [data, setData] = useState<TrackRecordResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/predictions/honest-tracking/live-tracking?market=${encodeURIComponent(currentMarket)}&days=7&limit=3`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        if (json.summary) {
          setData({ summary: json.summary, predictions: json.predictions || [] });
        } else {
          setData(null);
        }
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Unknown error');
        setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentMarket]);

  const goToTracking = () => {
    setCurrentView('prediction-tracking');
    if (typeof window !== 'undefined') window.location.hash = 'prediction-tracking';
  };

  const summary = data?.summary;
  const hasData = !!summary && summary.closed > 0;
  const winRate = summary?.winRate || 0;
  const settled = summary ? summary.wins + summary.losses : 0;
  const top3 = data?.predictions?.slice(0, 3) ?? [];

  return (
    <WidgetCard
      title="توقعاتنا الأسبوع ده"
      icon={Trophy}
      iconColor="text-profit"
      iconBg="bg-profit/10"
      loading={loading}
      skeletonRows={3}
      skeletonHeight="h-16"
      hideRefresh
      className="border-border bg-white shadow-sm"
      headerClassName="pb-3"
      titleClassName="text-base"
      badge={
        hasData ? (
          <Badge
            variant="outline"
            className={cn(
              'gap-1 text-xs font-bold',
              winRate >= 50 ? 'border-profit text-profit' : 'border-loss text-loss'
            )}
          >
            <Target className="h-3 w-3" />
            {winRate.toFixed(1)}%
          </Badge>
        ) : undefined
      }
    >
      {!hasData ? (
        <p className="text-xs text-muted-foreground">
          {error
            ? 'تعذّر تحميل السجل دلوقتي — حاول تاني بعدين.'
            : 'لسه مفيش توقعات موثّقة للأسبوع ده — هتظهر أول ما تخلص الجلسة.'}
        </p>
      ) : (
        <>
          {/* Summary tiles — adopted WidgetStatGrid (Phase 3) */}
          <WidgetStatGrid cols={3}>
            <WidgetStat label="ناجحة" value={summary!.wins} valueClass="text-profit" />
            <WidgetStat label="خاسرة" value={summary!.losses} valueClass="text-loss" />
            <WidgetStat label="معدّل مكسب" value={`+${summary!.avgWinPct.toFixed(1)}%`} />
          </WidgetStatGrid>

          {/* Top 3 predictions — show wins AND losses (honest track record builds trust) */}
          {top3.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground">
                آخر التوقعات الموثّقة ({settled} موثّقة):
              </p>
              {top3.map((p) => {
                const ret = p.actual_return ?? p.pnl_pct;
                const isWin = p.is_correct === 1 || (p.is_correct === null && (ret ?? 0) > 0);
                const retNum = Number(ret ?? 0);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-md border border-border bg-white px-2 py-1.5 dark:bg-slate-900"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isWin ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-profit flex-shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-loss flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-semibold">{p.ticker}</p>
                        <p className="text-[10px] text-muted-foreground">{p.signal_type}</p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        'text-xs font-bold tabular-nums',
                        retNum >= 0 ? 'text-profit' : 'text-loss'
                      )}
                      dir="ltr"
                    >
                      {retNum >= 0 ? '+' : ''}{retNum.toFixed(2)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <Button
            onClick={goToTracking}
            variant="outline"
            className="w-full text-xs h-8 gap-1.5 border-profit/30 text-profit hover:bg-profit/5"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            شوف كل التوقعات بالأدلة
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </WidgetCard>
  );
}
