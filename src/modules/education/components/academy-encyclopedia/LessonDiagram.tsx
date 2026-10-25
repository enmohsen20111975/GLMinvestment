/**
 * academy-encyclopedia/LessonDiagram.tsx
 * ======================================
 * Inline SVG diagram renderer — illustrative, lightweight, no external deps.
 * Renders one of 4 chart types (candle / line / bar / pie) from a LessonSection
 * `diagram` field.
 *
 * Extracted from the original `AcademyEncyclopedia.tsx` (2,054 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 */

import * as React from 'react';
import type { LessonSection } from '../LessonPDFExporter';

export interface LessonDiagramProps {
  diagram: NonNullable<LessonSection['diagram']>;
}

export function LessonDiagram({ diagram }: LessonDiagramProps) {
  const W = 480;
  const H = 200;
  if (diagram.type === 'candle') {
    const candles = [40, 110, 180, 250, 320, 390, 460];
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        className="rounded-md bg-muted/30"
        role="img"
        aria-label="رسم توضيحي لشموع يابانية"
      >
        {candles.map((x, i) => {
          const up = i % 2 === 0;
          const color = up ? '#10b981' : '#ef4444';
          const top = 25 + ((i * 7) % 60);
          const bottom = H - 25 - ((i * 5) % 50);
          const bodyTop = top + 25;
          const bodyH = Math.max(bottom - top - 60, 18);
          return (
            <g key={x}>
              <line x1={x} y1={top} x2={x} y2={bottom} stroke={color} strokeWidth={2} />
              <rect x={x - 12} y={bodyTop} width={24} height={bodyH} fill={color} rx={2} />
            </g>
          );
        })}
      </svg>
    );
  }
  if (diagram.type === 'line') {
    const pts = [40, 70, 55, 95, 60, 130, 80, 110, 120, 60, 160, 90, 140, 50];
    const poly = pts.map((y, i) => `${20 + i * 32},${y}`).join(' ');
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        className="rounded-md bg-muted/30"
        role="img"
        aria-label="رسم توضيحي لخط اتجاه"
      >
        <polyline points={poly} fill="none" stroke="#0d9488" strokeWidth={3} />
        {poly.split(' ').map((p) => {
          const [x, y] = p.split(',').map(Number);
          return <circle key={p} cx={x} cy={y} r={3} fill="#0f766e" />;
        })}
      </svg>
    );
  }
  if (diagram.type === 'bar') {
    const bars = [60, 110, 90, 140, 100, 130, 80];
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        className="rounded-md bg-muted/30"
        role="img"
        aria-label="رسم توضيحي لأعمدة"
      >
        {bars.map((h, i) => (
          <rect
            key={i}
            x={30 + i * 60}
            y={H - 25 - h}
            width={40}
            height={h}
            fill="#0d9488"
            rx={3}
          />
        ))}
      </svg>
    );
  }
  // pie
  const r = 80;
  const cx = W / 2;
  const cy = H / 2;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      className="rounded-md bg-muted/30"
      role="img"
      aria-label="رسم توضيحي دائري"
    >
      <circle cx={cx} cy={cy} r={r} fill="#ccfbf1" />
      <path
        d={`M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z`}
        fill="#0d9488"
      />
      <path
        d={`M ${cx} ${cy} L ${cx + r} ${cy} A ${r} ${r} 0 0 1 ${cx} ${cy + r} Z`}
        fill="#0f766e"
      />
      <path
        d={`M ${cx} ${cy} L ${cx} ${cy + r} A ${r} ${r} 0 0 1 ${cx - r} ${cy} Z`}
        fill="#115e59"
      />
    </svg>
  );
}
