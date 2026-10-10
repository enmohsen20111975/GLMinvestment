'use client';

import React, { useEffect, useId, useState } from 'react';

type SparklineProps = {
  ticker?: string;
  data?: number[];
  days?: number;
  height?: number;
  width?: number;
  stroke?: string;
  fill?: string;
  className?: string;
  showArea?: boolean;
  curve?: 'linear' | 'smooth';
  positiveColor?: string;
  negativeColor?: string;
};

const W = 120;
const H = 36;

function buildPath(points: { x: number; y: number }[], curve: 'linear' | 'smooth') {
  if (points.length === 0) return '';
  if (curve === 'smooth' && points.length > 2) {
    const d: string[] = [`M ${(points[0].x ?? 0).toFixed(2)} ${(points[0].y ?? 0).toFixed(2)}`];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] ?? points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] ?? p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d.push(`C ${(cp1x ?? 0).toFixed(2)} ${(cp1y ?? 0).toFixed(2)}, ${(cp2x ?? 0).toFixed(2)} ${(cp2y ?? 0).toFixed(2)}, ${(p2.x ?? 0).toFixed(2)} ${(p2.y ?? 0).toFixed(2)}`);
    }
    return d.join(' ');
  }
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x ?? 0).toFixed(2)} ${(p.y ?? 0).toFixed(2)}`).join(' ');
}

function useSparklineData(ticker?: string, days = 30) {
  const [data, setData] = useState<number[]>([]);
  const [changePct, setChangePct] = useState(0);
  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    fetch(`/api/stocks/sparkline?ticker=${encodeURIComponent(ticker)}&days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (cancelled || !res) return;
        setData(Array.isArray(res.prices) ? res.prices : []);
        setChangePct(typeof res.change_pct === 'number' ? res.change_pct : 0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [ticker, days]);
  return { data, changePct };
}

export function MiniSparkline({
  ticker,
  data,
  days = 30,
  height = H,
  width = W,
  stroke,
  fill,
  className = '',
  showArea = true,
  curve = 'linear',
  positiveColor = '#10b981',
  negativeColor = '#ef4444',
}: SparklineProps) {
  const { data: fetched, changePct } = useSparklineData(ticker, days);
  const prices = data ?? fetched;
  const id = useId();

  const viewBoxW = width;
  const viewBoxH = height;
  const padY = 2;
  const padX = 4;
  const color = stroke ?? (changePct >= 0 ? positiveColor : negativeColor);
  const areaFill = fill ?? color;

  let points: { x: number; y: number }[] = [];
  if (prices.length > 1) {
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    points = prices.map((p, i) => ({
      x: padX + (i / (prices.length - 1)) * (viewBoxW - padX * 2),
      y: padY + viewBoxH - padY * 2 - ((p - min) / range) * (viewBoxH - padY * 2),
    }));
  }

  const d = buildPath(points, curve);
  const area = points.length > 1
    ? `${d} L ${(points[points.length - 1].x ?? 0).toFixed(2)} ${viewBoxH} L ${(points[0].x ?? 0).toFixed(2)} ${viewBoxH} Z`
    : '';
  const clipId = `spark-${id.replace(/[:/]/g, '')}`;

  return (
    <svg
      viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: '100%', height, display: 'block' }}
    >
      {showArea && area ? (
        <defs>
          <linearGradient id={`${clipId}-grad`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={areaFill} stopOpacity={0.25} />
            <stop offset="100%" stopColor={areaFill} stopOpacity={0} />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={viewBoxW} height={viewBoxH} />
          </clipPath>
        </defs>
      ) : null}
      {area ? (
        <path d={area} fill={`url(#${clipId}-grad)`} clipPath={`url(#${clipId})`} />
      ) : null}
      {d ? (
        <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}
