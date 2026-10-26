'use client';

/**
 * SectorLiquidityTreemap — A2 (Alpha, Task 3-a)
 * =================================================
 * Honest Recharts Treemap of sector LIQUIDITY (today's traded value).
 *
 * DATA CONTRACT (from /api/sectors/tracking → Python FlowSystemEngine.get_sector_heatmap):
 *   - sector.turnover (EGP) = Σ(volume × current_price) for stocks in the sector TODAY.
 *     This is a TRADED VALUE / LIQUIDITY measure. It is NOT net money flow
 *     (no buy vs sell breakdown exists in the data source).
 *   - sector.avg_change (%) = average of today's `change_percent` across the sector's
 *     stocks. This IS a real performance metric (today's price change).
 *
 * VISUAL ENCODING (honest — Rule 27 NO-FAKE-DATA):
 *   - Rectangle AREA ∝ sector.turnover (liquidity share of market today).
 *   - Rectangle COLOR ∝ sector.avg_change (today's performance %).
 *       avg_change > +0.5  → green (profit)
 *       avg_change < -0.5  → red   (loss)
 *       |avg_change| ≤ 0.5 → neutral gray
 *   - We DO NOT use color to represent inflow/outflow — the data does not measure flow.
 *   - We DO NOT show "sector draining liquidity from another sector" — no flow data.
 *
 * LABEL: "توزيع سيولة القطاعات" (Sector Liquidity Distribution).
 *   Subtitle explicitly states what size + color measure so the user can't misread it.
 */

import React, { useMemo, useState } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Info } from 'lucide-react';
import type { SectorTrackingEntry } from './types';
import { formatEGPShort } from './helpers';

interface TreemapDatum {
  name: string;
  size: number;
  sector: SectorTrackingEntry;
}

interface SectorLiquidityTreemapProps {
  sectors: SectorTrackingEntry[];
  totalTurnover: number;
  marketCode: string;
  /** fetched-at ISO (client side) — shown in the tooltip as "آخر تحديث" */
  fetchedAt?: string;
}

// ── Color helpers (hsl strings — direct SVG fills, no Tailwind var dependency) ──
// profit: 160 84% 39% (green), loss: 0 84% 60% (red), neutral: 215 16% 47% (slate-500)
function performanceFill(avgChange: number): string {
  if (avgChange >= 0.5) {
    // green — stronger for bigger gains, capped
    const sat = 84;
    const light = Math.max(28, 42 - Math.min(Math.abs(avgChange), 6) * 2);
    return `hsl(160 ${sat}% ${light}%)`;
  }
  if (avgChange <= -0.5) {
    // red — stronger for bigger losses
    const sat = 84;
    const light = Math.max(38, 52 - Math.min(Math.abs(avgChange), 6) * 2);
    return `hsl(0 ${sat}% ${light}%)`;
  }
  // neutral (|avg_change| < 0.5)
  return 'hsl(215 16% 47%)';
}

function performanceLabel(avgChange: number): { label: string; cls: string } {
  if (avgChange >= 0.5) return { label: 'صاعد', cls: 'text-profit' };
  if (avgChange <= -0.5) return { label: 'هابط', cls: 'text-loss' };
  return { label: 'محايد', cls: 'text-muted-foreground' };
}

// ── Custom Treemap cell — renders the rect + sector name + turnover ──────────────
interface CellProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  size?: number;
  sector?: SectorTrackingEntry;
  depth?: number;
  index?: number;
}

function TreemapCell(props: CellProps) {
  const {
    x = 0, y = 0, width = 0, height = 0,
    name = '', size = 0, sector, depth = 1,
  } = props;

  // Hide text on tiny cells to avoid overflow
  const showText = width > 60 && height > 36;
  const showValue = width > 60 && height > 56;
  const showChange = width > 80 && height > 76;

  if (depth === 0) {
    // Root container — transparent
    return <g />;
  }

  const fill = sector ? performanceFill(sector.avg_change) : 'hsl(215 16% 47%)';
  const stroke = 'hsl(0 0% 100%)';

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke={stroke}
        strokeWidth={2}
        rx={3}
        ry={3}
      />
      {showText && (
        <text
          x={x + 6}
          y={y + 16}
          fill="#ffffff"
          fontSize={11}
          fontWeight={700}
          style={{ pointerEvents: 'none' }}
        >
          {name.length > 18 ? name.slice(0, 17) + '…' : name}
        </text>
      )}
      {showValue && size > 0 && (
        <text
          x={x + 6}
          y={y + 32}
          fill="rgba(255,255,255,0.92)"
          fontSize={10}
          fontWeight={600}
          style={{ pointerEvents: 'none' }}
        >
          {formatEGPShort(size)}
        </text>
      )}
      {showChange && sector && (
        <text
          x={x + 6}
          y={y + 48}
          fill="rgba(255,255,255,0.85)"
          fontSize={10}
          fontWeight={600}
          style={{ pointerEvents: 'none' }}
        >
          {sector.avg_change >= 0 ? '+' : ''}{sector.avg_change}%
        </text>
      )}
    </g>
  );
}

// ── Custom tooltip — shows full honest breakdown ───────────────────────────────
function TreemapTooltipContent({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as TreemapDatum | undefined;
  if (!datum || !datum.sector) return null;
  const s = datum.sector;
  const perf = performanceLabel(s.avg_change);
  return (
    <div className="rounded-md border border-border bg-background/95 backdrop-blur p-3 text-xs shadow-md max-w-[260px]" dir="rtl">
      <div className="font-bold text-sm mb-1.5">{datum.name}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
        <span>قيمة التداول:</span>
        <span className="font-mono font-bold text-foreground">{formatEGPShort(s.turnover)}</span>
        <span>نسبة السوق:</span>
        <span className="font-mono text-foreground">{s.turnover_pct}%</span>
        <span>متوسط التغير:</span>
        <span className={`font-mono font-bold ${perf.cls}`}>
          {s.avg_change >= 0 ? '+' : ''}{s.avg_change}%
        </span>
        <span>الحالة:</span>
        <span className={perf.cls}>{perf.label}</span>
        <span>رابحة / خاسرة:</span>
        <span className="font-mono text-foreground">
          <span className="text-profit">{s.gainers}</span>
          {' / '}
          <span className="text-loss">{s.losers}</span>
        </span>
        {s.leader_ticker && (
          <>
            <span>سهم القائد:</span>
            <span className="font-mono text-foreground">{s.leader_ticker}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function SectorLiquidityTreemap({
  sectors,
  totalTurnover,
  marketCode,
  fetchedAt,
}: SectorLiquidityTreemapProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const data: TreemapDatum[] = useMemo(() => {
    // Only include sectors with positive turnover (treemap requires size > 0)
    return sectors
      .filter((s) => s.turnover > 0)
      .map((s) => ({
        name: s.sector,
        size: s.turnover,
        sector: s,
      }));
  }, [sectors]);

  // Sanity: if total is 0 or data is empty, render honest empty state
  const computedTotal = useMemo(
    () => data.reduce((sum, d) => sum + d.size, 0),
    [data],
  );

  if (data.length === 0) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            توزيع سيولة القطاعات
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground py-8 text-center">
            لا توجد بيانات سيولة متاحة — تعذّر رسم خريطة السيولة.
          </div>
        </CardContent>
      </Card>
    );
  }

  void activeIndex;
  void setActiveIndex;

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-sm flex items-center gap-2" data-testid="sector-treemap-title">
              <Info className="w-4 h-4 text-muted-foreground" />
              توزيع سيولة القطاعات
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1" data-testid="sector-treemap-subtitle">
              حجم المربع = نسبة السيولة اليوم • اللون = متوسط التغير % اليوم
            </p>
          </div>
          <div className="text-xs text-muted-foreground text-left">
            <div>
              إجمالي السيولة:{' '}
              <span className="font-mono font-bold text-foreground">{formatEGPShort(totalTurnover)}</span>
            </div>
            {fetchedAt && (
              <div className="mt-0.5">
                آخر تحديث:{' '}
                <span className="font-mono">{new Date(fetchedAt).toLocaleString('ar-EG')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Honest legend — explicit about what color means (and what it does NOT) */}
        <div className="flex items-center gap-3 flex-wrap mt-2 text-xs" data-testid="sector-treemap-legend">
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ background: 'hsl(160 84% 39%)' }} />
            <span className="text-muted-foreground">صاعد اليوم</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ background: 'hsl(215 16% 47%)' }} />
            <span className="text-muted-foreground">محايد</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ background: 'hsl(0 84% 60%)' }} />
            <span className="text-muted-foreground">هابط اليوم</span>
          </span>
        </div>
      </CardHeader>

      <CardContent>
        <div className="w-full h-[280px] sm:h-[320px] md:h-[360px]" data-testid="sector-treemap-container">
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={data}
              dataKey="size"
              nameKey="name"
              stroke="#ffffff"
              content={<TreemapCell />}
              isAnimationActive={false}
            >
              <Tooltip content={<TreemapTooltipContent />} cursor={false} />
            </Treemap>
          </ResponsiveContainer>
        </div>

        {/* Honest disclosure — explicit about what the chart does NOT measure */}
        <div className="text-xs text-muted-foreground mt-2 px-1 leading-relaxed" data-testid="sector-treemap-note">
          ملاحظة: البيانات تقيس قيمة التداول اليوم ومتوسط التغير % — لا تقيس صافي التدفق النقدي
          (لا يوجد فصل بين شراء/بيع). السوق: <span className="font-mono">{marketCode}</span>.
        </div>

        {/* Hidden assertion anchor — total liquidity shown equals sum of sector turnovers */}
        <span data-testid="sector-treemap-total" data-total={computedTotal} className="sr-only">
          {formatEGPShort(computedTotal)}
        </span>
      </CardContent>
    </Card>
  );
}
