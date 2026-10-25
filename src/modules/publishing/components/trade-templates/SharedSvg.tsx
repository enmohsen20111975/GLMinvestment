/**
 * trade-templates/SharedSvg.tsx
 * ============================
 * Shared SVG primitives for the TradeResultsTemplates split
 * (Task F-Phase3-FinalPush — split from 1,456 LOC).
 *
 * Exports:
 *   - LogoBox      — text logo box (no external images — Rule 68)
 *   - TrophyIcon   — gold trophy SVG (decorative)
 *   - CandlestickBackground — translucent candlestick row (decorative)
 *   - ArrowUp      — green arrow up (hero decoration)
 *
 * Pure SVG + inline styles — pixel-perfect for html-to-image export.
 */

import React from 'react';
import { COLORS, FONT_FAMILY } from './types';

/** شعار "دليل الاستثمار" — صندوق نصي بدون صور خارجية */
export function LogoBox({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dims =
    size === 'lg' ? { w: 220, h: 56, fs: 18, sub: 11 }
      : size === 'sm' ? { w: 150, h: 38, fs: 13, sub: 9 }
      : { w: 180, h: 46, fs: 15, sub: 10 };

  return (
    <div
      style={{
        width: dims.w,
        height: dims.h,
        borderRadius: 10,
        background: `linear-gradient(135deg, ${COLORS.bgCardAlt} 0%, ${COLORS.bgCard} 100%)`,
        border: `1.5px solid ${COLORS.gold}`,
        boxShadow: `0 0 18px ${COLORS.goldGlow}, inset 0 0 8px rgba(245,158,11,0.08)`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '0 14px',
        gap: 2,
      }}
    >
      <span
        style={{
          color: COLORS.textPrimary,
          fontWeight: 800,
          fontSize: dims.fs,
          letterSpacing: 0.3,
          fontFamily: FONT_FAMILY,
        }}
      >
        دليل الاستثمار
      </span>
      <span
        style={{
          color: COLORS.gold,
          fontSize: dims.sub,
          fontWeight: 600,
          letterSpacing: 0.4,
          fontFamily: 'monospace',
          direction: 'ltr',
        }}
      >
        invest.m2y.net
      </span>
    </div>
  );
}

/** كأس ذهبي SVG (Trophy) — بسيط، يستخدم كأيقونة زخرفية */
export function TrophyIcon({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="trophyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="55%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <filter id="trophyGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#trophyGlow)" fill="url(#trophyGrad)" stroke="#fbbf24" strokeWidth="0.4">
        {/* cup body */}
        <path d="M7 4h10v3.5a5 5 0 0 1-10 0V4z" />
        {/* handles */}
        <path
          d="M7 5H5.5A2 2 0 0 0 4 7v1a3 3 0 0 0 3 3"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="1.6"
        />
        <path
          d="M17 5h1.5A2 2 0 0 1 20 7v1a3 3 0 0 1-3 3"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="1.6"
        />
        {/* stem */}
        <rect x="11" y="12.5" width="2" height="3.2" />
        {/* base */}
        <rect x="8.5" y="15.7" width="7" height="1.8" rx="0.4" />
        <rect x="7" y="17.6" width="10" height="2" rx="0.5" />
      </g>
      {/* star sparkle */}
      <circle cx="12" cy="7.5" r="0.8" fill="#fff7e6" opacity="0.85" />
    </svg>
  );
}

/** خلفية شموع يابانية (Candlestick background) — زخرفة شفافة */
export function CandlestickBackground({ opacity = 0.07 }: { opacity?: number }) {
  // 7 شموع بسيطة في صف واحد — خلفية زخرفية رقيقة
  const candles = [
    { x: 60, o: 70, c: 50, h: 35, l: 80, up: true },
    { x: 130, o: 50, c: 30, h: 20, l: 60, up: true },
    { x: 200, o: 30, c: 45, h: 22, l: 55, up: false },
    { x: 270, o: 45, c: 25, h: 15, l: 52, up: true },
    { x: 340, o: 25, c: 10, h: 5, l: 30, up: true },
    { x: 410, o: 10, c: 20, h: 5, l: 25, up: false },
    { x: 480, o: 20, c: 5, h: 0, l: 25, up: true },
  ];
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 540 100"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      opacity={opacity}
      aria-hidden
    >
      {candles.map((c, i) => {
        const color = c.up ? COLORS.positive : COLORS.negative;
        const bodyTop = Math.min(c.o, c.c);
        const bodyHeight = Math.max(2, Math.abs(c.o - c.c));
        return (
          <g key={i}>
            <line x1={c.x} y1={c.h} x2={c.x} y2={c.l} stroke={color} strokeWidth="1.2" />
            <rect x={c.x - 8} y={bodyTop} width="16" height={bodyHeight} fill={color} rx="1" />
          </g>
        );
      })}
    </svg>
  );
}

/** سهم صاعد (Arrow Up) — زخرفة على الـ Hero */
export function ArrowUp({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id="arrowUpGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>
      <path
        d="M12 3l7 7h-4v9h-6v-9H5l7-7z"
        fill="url(#arrowUpGrad)"
        stroke="#34d399"
        strokeWidth="0.5"
      />
    </svg>
  );
}
