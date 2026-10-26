'use client';

/**
 * SectorMomentumStrip — A2 (Alpha, Task 3-a)
 * =================================================
 * Compact "Sector Momentum / Rotation" readout.
 *
 * DATA CONTRACT (from /api/sectors/tracking):
 *   - sector.avg_change (%) — TODAY's average price change across the sector.
 *     This is a PERFORMANCE metric (today's session). It is NOT a multi-day
 *     momentum / rate-of-change. There is no day-over-day delta field in the
 *     response. We therefore label honestly: "أقوى/أضعف القطاعات اليوم" (today's
 *     strongest/weakest) and NEVER claim "rotation" or "net flow".
 *   - sector.turnover (EGP) — TODAY's traded value (liquidity).
 *   - sector.leader_ticker / leader_change — top stock by change_percent today.
 *
 * The optional `rotation` field (when with_rotation=1) describes 5-day lookback
 * turnover-trend signals. We surface those SEPARATELY in the parent (already
 * exists in SectorTrackingTab). This strip sticks to today's data only.
 *
 * HONESTY (Rule 27 NO-FAKE-DATA):
 *   - We do NOT invent a momentum score.
 *   - We do NOT show "net money flow" or "inflow/outflow".
 *   - We DO show: strongest/weakest by avg_change today, liquidity ranking, the
 *     data timestamp, and a clear note about what the data measures.
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Layers, Clock, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SectorTrackingEntry, SectorTrackingResponse } from './types';
import { formatEGPShort } from './helpers';

interface SectorMomentumStripProps {
  sectors: SectorTrackingEntry[];
  marketSummary: SectorTrackingResponse['market_summary'];
  marketCode: string;
  fetchedAt?: string;
}

interface RankItemProps {
  sector: SectorTrackingEntry;
  rank: number;
  onLeaderClick?: (ticker: string) => void;
}

function RankItem({ sector, rank, onLeaderClick }: RankItemProps) {
  const positive = sector.avg_change >= 0;
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs',
        positive ? 'border-profit/20 bg-profit/5' : 'border-loss/20 bg-loss/5',
      )}
    >
      <span className="font-bold text-muted-foreground w-4 text-center">{rank}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate" title={sector.sector}>{sector.sector}</div>
        <div className="text-muted-foreground text-[10px] flex items-center gap-1.5">
          <span>سيولة: <span className="font-mono">{formatEGPShort(sector.turnover)}</span></span>
          {sector.leader_ticker && (
            <button
              type="button"
              onClick={() => onLeaderClick?.(sector.leader_ticker!)}
              className="hover:underline cursor-pointer"
              title={`عرض ${sector.leader_ticker}`}
            >
              • القائد: <span className="font-mono">{sector.leader_ticker}</span>
            </button>
          )}
        </div>
      </div>
      <span
        className={cn(
          'font-mono font-bold text-xs shrink-0',
          positive ? 'text-profit' : 'text-loss',
        )}
      >
        {sector.avg_change >= 0 ? '+' : ''}{sector.avg_change}%
      </span>
    </div>
  );
}

export function SectorMomentumStrip({
  sectors,
  marketSummary,
  marketCode,
  fetchedAt,
}: SectorMomentumStripProps) {
  // Strongest by avg_change (desc), Weakest by avg_change (asc). Today's session only.
  const strongest = React.useMemo(
    () => [...sectors].sort((a, b) => b.avg_change - a.avg_change).slice(0, 3),
    [sectors],
  );
  const weakest = React.useMemo(
    () => [...sectors].sort((a, b) => a.avg_change - b.avg_change).slice(0, 3),
    [sectors],
  );
  // Liquidity ranking (top 3 by turnover)
  const topLiquidity = React.useMemo(
    () => [...sectors].sort((a, b) => b.turnover - a.turnover).slice(0, 3),
    [sectors],
  );

  if (sectors.length === 0) return null;

  return (
    <Card className="border-border" data-testid="sector-momentum-strip">
      <CardContent className="p-3 sm:p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
          {/* Strongest today */}
          <div data-testid="sector-momentum-strongest">
            <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-profit">
              <TrendingUp className="w-3.5 h-3.5" />
              أقوى القطاعات اليوم
              <span className="text-muted-foreground font-normal">(حسب متوسط التغير %)</span>
            </div>
            <div className="space-y-1.5">
              {strongest.map((s, i) => (
                <RankItem key={s.sector} sector={s} rank={i + 1} />
              ))}
            </div>
          </div>

          {/* Weakest today */}
          <div data-testid="sector-momentum-weakest">
            <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-loss">
              <TrendingDown className="w-3.5 h-3.5" />
              أضعف القطاعات اليوم
              <span className="text-muted-foreground font-normal">(حسب متوسط التغير %)</span>
            </div>
            <div className="space-y-1.5">
              {weakest.map((s, i) => (
                <RankItem key={s.sector} sector={s} rank={i + 1} />
              ))}
            </div>
          </div>

          {/* Liquidity ranking + honest disclosure */}
          <div data-testid="sector-momentum-liquidity">
            <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-whale">
              <Layers className="w-3.5 h-3.5" />
              أعلى القطاعات سيولة اليوم
              <span className="text-muted-foreground font-normal">(قيمة التداول)</span>
            </div>
            <div className="space-y-1.5">
              {topLiquidity.map((s, i) => (
                <div
                  key={s.sector}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-whale/20 bg-whale/5 text-xs"
                >
                  <span className="font-bold text-muted-foreground w-4 text-center">{i + 1}</span>
                  <span className="font-semibold truncate flex-1" title={s.sector}>{s.sector}</span>
                  <span className="font-mono font-bold text-whale">{formatEGPShort(s.turnover)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Honest disclosure footer */}
        <div className="mt-3 pt-3 border-t border-border flex items-start gap-2 flex-wrap text-xs text-muted-foreground" data-testid="sector-momentum-note">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            البيانات الحالية تقيس <span className="font-medium text-foreground">قيمة التداول اليوم</span> و
            <span className="font-medium text-foreground"> متوسط التغير % اليوم</span> — لا تقيس صافي التدفق النقدي
            ولا دوران السيولة بين القطاعات (يتطلب ذلك بيانات شراء/بيع أو مقارنة يومية غير متوفرة).
            {' '}السوق: <span className="font-mono">{marketCode}</span>
            {' '}• عدد القطاعات: <span className="font-mono">{marketSummary.total_sectors}</span>
            {' '}• الأسهم: <span className="font-mono">{marketSummary.total_stocks}</span>
            {fetchedAt && (
              <span className="inline-flex items-center gap-1 ms-2">
                <Clock className="w-3 h-3" />
                <span className="font-mono">{new Date(fetchedAt).toLocaleString('ar-EG')}</span>
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
