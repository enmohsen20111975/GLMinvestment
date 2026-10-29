import * as React from 'react';
import { motion } from 'framer-motion';
import { CHART_W, CHART_H, PAD, makeScales } from './helpers';
import type { Candle, ChartHelpers } from './types';

/* ============================================================
 * P40-ACADEMY PILLAR 3 — Strategy Chart Sandbox
 * Reusable SVG primitives: CandleChart, AnimatedG, Label, Arrow.
 * ============================================================ */

/* ───────────────────────── CandleChart Base ──────────────── */

export function CandleChart({
  candles,
  children,
}: {
  candles: Candle[];
  children?: (helpers: ChartHelpers) => React.ReactNode;
}) {
  const { minP, maxP, slot, xOf, yOf, bodyW } = makeScales(candles);
  const gridVals = [minP, (minP + maxP) / 2, maxP];

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto" dir="ltr" {...({} as any)}>
      {/* grid */}
      {gridVals.map((v, i) => (
        <g key={i}>
          <line
            x1={PAD.left}
            y1={yOf(v)}
            x2={CHART_W - PAD.right}
            y2={yOf(v)}
            stroke="currentColor"
            className="text-border"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
          <text x={6} y={yOf(v) + 4} fontSize="10" className="fill-muted-foreground">
            {(v ?? 0).toFixed(1)}
          </text>
        </g>
      ))}
      {/* x-axis labels */}
      {[0, Math.floor(candles.length / 2), candles.length - 1].map((idx, i) => (
        <text
          key={i}
          x={xOf(idx)}
          y={CHART_H - 8}
          fontSize="10"
          textAnchor="middle"
          className="fill-muted-foreground"
        >
          {idx + 1}
        </text>
      ))}

      {/* candles */}
      {candles.map((c, i) => {
        const isBull = c.c >= c.o;
        const color = isBull ? '#10b981' : '#ef4444';
        const x = xOf(i);
        const bodyTop = yOf(Math.max(c.o, c.c));
        const bodyBot = yOf(Math.min(c.o, c.c));
        return (
          <g key={i}>
            <line x1={x} y1={yOf(c.h)} x2={x} y2={yOf(c.l)} stroke={color} strokeWidth={1.2} />
            <rect
              x={x - bodyW / 2}
              y={bodyTop}
              width={bodyW}
              height={Math.max(1.5, bodyBot - bodyTop)}
              fill={color}
              opacity={isBull ? 0.95 : 0.95}
            />
          </g>
        );
      })}

      {children && children({ minP, maxP, slot, xOf, yOf, bodyW })}
    </svg>
  );
}

/* ───────────────────────── Animated Annotation Wrapper ───── */

export function AnimatedG({
  children,
  delay = 0.2,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.g
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.g>
  );
}

export function Label({
  x,
  y,
  text,
  color,
  size = 11,
  anchor = 'middle',
}: {
  x: number;
  y: number;
  text: string;
  color: string;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
}) {
  return (
    <text x={x} y={y} fontSize={size} fill={color} textAnchor={anchor} fontWeight="700">
      {text}
    </text>
  );
}

export function Arrow({
  from,
  to,
  color,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
}) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLen = 8;
  const a1 = angle + Math.PI - 0.4;
  const a2 = angle + Math.PI + 0.4;
  return (
    <g>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth={2} />
      <polygon
        points={`${to.x},${to.y} ${to.x + headLen * Math.cos(a1)},${to.y + headLen * Math.sin(a1)} ${to.x + headLen * Math.cos(a2)},${to.y + headLen * Math.sin(a2)}`}
        fill={color}
      />
    </g>
  );
}
