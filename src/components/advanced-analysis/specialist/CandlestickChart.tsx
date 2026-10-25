/**
 * specialist/CandlestickChart.tsx — §3 30-Day Candlestick Chart (BEAUTIFUL SVG).
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 294–604).
 * Rule 67: NO fabricated prices. Candles come from real OHLCV in stocks.db.
 *
 * Renders 30 candles + volume bars + support/resistance/MA50/MA200 lines.
 * SVG viewBox 760×320, scales to container width, min-width 600 for readability.
 */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { BarChart3 } from 'lucide-react';
import type { PriceRow } from './types';
import { EmptyState, SectionCard } from './primitives';

export function CandlestickChart({
  prices,
  support,
  resistance,
  ma50,
  ma200,
}: {
  prices: PriceRow[];
  support?: number | null;
  resistance?: number | null;
  ma50?: number | null;
  ma200?: number | null;
}) {
  const slice = useMemo(() => prices.slice(-30), [prices]);

  if (!slice || slice.length === 0) {
    return (
      <SectionCard icon={<BarChart3 className="w-4 h-4" />} title="شارت الشموع اليابانية (30 يوم)" accent="slate">
        <EmptyState msg="لا توجد بيانات تاريخية كافية للرسم البياني" />
      </SectionCard>
    );
  }

  const W = 760; // viewport width
  const H = 320; // viewport height
  const padL = 50; // left padding for y-axis labels
  const padR = 14;
  const padT = 14;
  const padB = 56; // bottom padding for x-axis dates + volume
  const priceH = 200; // price chart height
  const volH = 50; // volume bars height
  const volTop = padT + priceH + 16;
  const chartW = W - padL - padR;

  const candleSlot = chartW / slice.length;
  const candleWidth = Math.max(candleSlot * 0.6, 2);

  // Price range — include support/resistance/MA lines if provided.
  const priceValues: number[] = [];
  slice.forEach((p) => {
    [p.high, p.low, p.open, p.close].forEach((v) => {
      if (Number.isFinite(v)) priceValues.push(v);
    });
  });
  if (support != null && Number.isFinite(support)) priceValues.push(support);
  if (resistance != null && Number.isFinite(resistance)) priceValues.push(resistance);
  if (ma50 != null && Number.isFinite(ma50)) priceValues.push(ma50);
  if (ma200 != null && Number.isFinite(ma200)) priceValues.push(ma200);

  if (priceValues.length === 0) {
    return (
      <SectionCard icon={<BarChart3 className="w-4 h-4" />} title="شارت الشموع اليابانية (30 يوم)" accent="slate">
        <EmptyState msg="بيانات الأسعار غير متاحة" />
      </SectionCard>
    );
  }

  const minPrice = Math.min(...priceValues);
  const maxPrice = Math.max(...priceValues);
  const priceRange = Math.max(maxPrice - minPrice, 0.0001);
  // Pad range by 5% on each side so candles don't touch the chart edges.
  const padPrice = priceRange * 0.05;
  const yMin = minPrice - padPrice;
  const yMax = maxPrice + padPrice;
  const yRange = yMax - yMin;

  const scaleY = (price: number) => padT + priceH - ((price - yMin) / yRange) * priceH;

  // Volume range
  const volumes = slice.map((p) => p.volume ?? 0).filter((v) => v > 0);
  const maxVol = volumes.length > 0 ? Math.max(...volumes) : 0;

  const scaleVol = (vol: number) => (maxVol > 0 ? (vol / maxVol) * volH : 0);

  // Y-axis ticks (4 horizontal grid lines)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => yMin + t * yRange);

  return (
    <SectionCard
      icon={<BarChart3 className="w-4 h-4" />}
      title="شارت الشموع اليابانية (آخر 30 جلسة)"
      description={`مصدر البيانات: /api/maker-radar/stock?prices — ${slice.length} شمعة من stocks.db (Rule 67)`}
      accent="slate"
    >
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">
            <span className="text-profit">▲ أعلى: {(maxPrice ?? 0).toFixed(2)}</span>
          </Badge>
          <Badge variant="outline" className="text-xs">
            <span className="text-loss">▼ أدنى: {(minPrice ?? 0).toFixed(2)}</span>
          </Badge>
          {support != null && (
            <Badge variant="outline" className="text-xs">
              <span className="text-profit">دعم: {(support ?? 0).toFixed(2)}</span>
            </Badge>
          )}
          {resistance != null && (
            <Badge variant="outline" className="text-xs">
              <span className="text-loss">مقاومة: {(resistance ?? 0).toFixed(2)}</span>
            </Badge>
          )}
        </div>
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-profit rounded-sm" />
            <span className="text-muted-foreground">صاعد</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-loss rounded-sm" />
            <span className="text-muted-foreground">هابط</span>
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="block"
          style={{ minWidth: 600 }}
          role="img"
          aria-label="Candlestick chart for last 30 trading days"
        >
          {/* Grid horizontal lines + y-axis labels */}
          {yTicks.map((t, i) => (
            <g key={`y-${i}`}>
              <line
                x1={padL}
                y1={scaleY(t)}
                x2={W - padR}
                y2={scaleY(t)}
                stroke="currentColor"
                strokeWidth={0.5}
                className="text-muted-foreground dark:text-muted-foreground"
              />
              <text
                x={padL - 6}
                y={scaleY(t) + 3}
                textAnchor="end"
                className="fill-slate-500 dark:fill-slate-400 text-xs"
              >
                {(t ?? 0).toFixed(2)}
              </text>
            </g>
          ))}

          {/* Support line (dashed emerald) */}
          {support != null && Number.isFinite(support) && (
            <g>
              <line
                x1={padL}
                y1={scaleY(support)}
                x2={W - padR}
                y2={scaleY(support)}
                stroke="hsl(var(--profit))"
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.7}
              />
              <text x={padL + 4} y={scaleY(support) - 4} className="fill-profit text-xs font-bold">
                دعم {(support ?? 0).toFixed(2)}
              </text>
            </g>
          )}

          {/* Resistance line (dashed red) */}
          {resistance != null && Number.isFinite(resistance) && (
            <g>
              <line
                x1={padL}
                y1={scaleY(resistance)}
                x2={W - padR}
                y2={scaleY(resistance)}
                stroke="hsl(var(--loss))"
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.7}
              />
              <text x={padL + 4} y={scaleY(resistance) - 4} className="fill-loss text-xs font-bold">
                مقاومة {(resistance ?? 0).toFixed(2)}
              </text>
            </g>
          )}

          {/* Candles */}
          {slice.map((candle, i) => {
            const x = padL + i * candleSlot + candleSlot / 2;
            const isGreen = candle.close >= candle.open;
            const color = isGreen ? 'hsl(var(--profit))' : 'hsl(var(--loss))';
            const bodyTop = scaleY(Math.max(candle.open, candle.close));
            const bodyBottom = scaleY(Math.min(candle.open, candle.close));
            const bodyH = Math.max(bodyBottom - bodyTop, 1);
            const wickTop = scaleY(candle.high);
            const wickBottom = scaleY(candle.low);
            return (
              <g key={`c-${i}`}>
                {/* Wick */}
                <line x1={x} y1={wickTop} x2={x} y2={wickBottom} stroke={color} strokeWidth={1} />
                {/* Body */}
                <rect
                  x={x - candleWidth / 2}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyH}
                  fill={color}
                  stroke={color}
                  strokeWidth={0.5}
                  rx={0.5}
                />
              </g>
            );
          })}

          {/* MA50 line (amber dashed) */}
          {ma50 != null && Number.isFinite(ma50) && (
            <g>
              <line
                x1={padL}
                y1={scaleY(ma50)}
                x2={W - padR}
                y2={scaleY(ma50)}
                stroke="#f59e0b"
                strokeWidth={1.5}
                strokeDasharray="6 3"
                opacity={0.85}
              />
              <text x={W - padR - 4} y={scaleY(ma50) - 4} textAnchor="end" className="fill-warning text-xs font-bold">
                MA50 {(ma50 ?? 0).toFixed(2)}
              </text>
            </g>
          )}

          {/* MA200 line (slate dashed) */}
          {ma200 != null && Number.isFinite(ma200) && (
            <g>
              <line
                x1={padL}
                y1={scaleY(ma200)}
                x2={W - padR}
                y2={scaleY(ma200)}
                stroke="#64748b"
                strokeWidth={1.5}
                strokeDasharray="2 4"
                opacity={0.85}
              />
              <text x={W - padR - 4} y={scaleY(ma200) + 12} textAnchor="end" className="fill-slate-500 dark:fill-slate-400 text-xs font-bold">
                MA200 {(ma200 ?? 0).toFixed(2)}
              </text>
            </g>
          )}

          {/* Volume separator */}
          <line
            x1={padL}
            y1={volTop - 6}
            x2={W - padR}
            y2={volTop - 6}
            stroke="currentColor"
            strokeWidth={0.5}
            className="text-muted-foreground dark:text-muted-foreground"
          />

          {/* Volume bars */}
          {slice.map((candle, i) => {
            const x = padL + i * candleSlot + candleSlot / 2;
            const vol = candle.volume ?? 0;
            const h = scaleVol(vol);
            const isGreen = candle.close >= candle.open;
            const color = isGreen ? 'hsl(var(--profit))' : 'hsl(var(--loss))';
            return (
              <rect
                key={`v-${i}`}
                x={x - candleWidth / 2}
                y={volTop + volH - h}
                width={candleWidth}
                height={h}
                fill={color}
                opacity={0.45}
              />
            );
          })}

          {/* X-axis dates (every 5th) */}
          {slice.map((candle, i) => {
            if (i % 5 !== 0 || !candle.date) return null;
            const x = padL + i * candleSlot + candleSlot / 2;
            const dateLabel = candle.date.slice(5); // MM-DD
            return (
              <text
                key={`d-${i}`}
                x={x}
                y={H - 8}
                textAnchor="middle"
                className="fill-slate-500 dark:fill-slate-400 text-xs"
              >
                {dateLabel}
              </text>
            );
          })}
        </svg>
      </div>
    </SectionCard>
  );
}
