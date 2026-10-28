'use client';

/**
 * indicators-visuals.tsx — مكونات المؤشرات الفنية التعليمية
 * ====================================================================
 * (ALPHA-FRONTEND-DECOMPOSITION): مستخرج من LearningVisuals.tsx (2,644 LOC)
 * لفصل مسؤوليات المؤشرات الفنية (RSI, MACD, Support/Resistance, MA, Bollinger).
 *
 * كل المكونات render-only — لا يوجد fetch أو state بيانات.
 * كل القيم hardcoded تعليمية (مش API responses).
 */

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/* ── 8. RSI Gauge (مؤشر القوة النسبية) ── */
export function RSIGauge({ value = 65 }: { value?: number }) {
  const angle = (value / 100) * 180 - 90; // -90 to 90 degrees
  const zone = value >= 70 ? { label: 'تشبع شرائي', color: 'text-loss' } :
  value <= 30 ? { label: 'تشبع بيعي', color: 'text-profit' } :
  { label: 'منطقة محايدة', color: 'text-warning' };

  return (
    <div className="my-6 p-4 rounded-xl bg-card border border-border">
      <h4 className="font-bold mb-3 text-center">مؤشر RSI - القوة النسبية</h4>
      <div className="flex flex-col items-center">
        <svg width="200" height="120" viewBox="0 0 200 120">
          {/* Background arc - green zone (0-30) */}
          <path d="M 20 100 A 80 80 0 0 1 80 30" fill="none" stroke="#10b981" strokeWidth="12" />
          {/* Yellow zone (30-70) */}
          <path d="M 80 30 A 80 80 0 0 1 120 30" fill="none" stroke="#f59e0b" strokeWidth="12" />
          {/* Red zone (70-100) */}
          <path d="M 120 30 A 80 80 0 0 1 180 100" fill="none" stroke="#ef4444" strokeWidth="12" />
          {/* Needle */}
          <motion.line
            x1="100" y1="100"
            x2="100" y2="40"
            stroke="#1f2937" strokeWidth="3" strokeLinecap="round"
            initial={{ rotate: -90 }}
            animate={{ rotate: angle }}
            transition={{ duration: 1, ease: 'easeOut' }}
            style={{ transformOrigin: '100px 100px' }}
          />
          <circle cx="100" cy="100" r="6" fill="#1f2937" />
          {/* Value text */}
          <text x="100" y="115" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#1f2937">{value}</text>
        </svg>
        <p className={cn('font-bold text-lg', zone.color)}>{zone.label}</p>
        <div className="flex gap-4 mt-2 text-xs">
          <span className="text-profit">تشبع بيعي (≤30)</span>
          <span className="text-warning">محايد (30-70)</span>
          <span className="text-loss">تشبع شرائي (≥70)</span>
        </div>
      </div>
    </div>
  );
}

/* ── 9. MACD Indicator (مؤشر MACD) ── */
export function MACDVisual() {
  // Simulated MACD data points
  const dataPoints = [
    { macd: -2, signal: -1.5, hist: -0.5 },
    { macd: -1.5, signal: -1.8, hist: 0.3 },
    { macd: -0.5, signal: -1.5, hist: 1 },
    { macd: 0.5, signal: -1, hist: 1.5 },
    { macd: 1.5, signal: -0.2, hist: 1.7 },
    { macd: 2, signal: 0.8, hist: 1.2 },
    { macd: 1.8, signal: 1.5, hist: 0.3 },
    { macd: 1, signal: 1.6, hist: -0.6 },
    { macd: 0.2, signal: 1.3, hist: -1.1 },
  ];

  return (
    <div className="my-6 p-4 rounded-xl bg-card border border-border">
      <h4 className="font-bold mb-3 text-center">مؤشر MACD - تقاطع خط الإشارة</h4>
      <svg width="100%" height="180" viewBox="0 0 360 180">
        {/* Zero line */}
        <line x1="20" y1="90" x2="340" y2="90" stroke="#6b7280" strokeWidth="1" strokeDasharray="4" />
        <text x="345" y="94" fontSize="10" fill="#6b7280">0</text>

        {/* Histogram bars */}
        {dataPoints.map((d, i) => {
          const x = 30 + i * 38;
          const h = Math.abs(d.hist) * 18;
          const y = d.hist >= 0 ? 90 - h : 90;
          return (
            <motion.rect
              key={`h-${i}`}
              x={x} y={y} width="12" height={h}
              fill={d.hist >= 0 ? '#10b98180' : '#ef444480'}
              initial={{ height: 0 }}
              animate={{ height: h }}
              transition={{ delay: i * 0.1 }}
            />
          );
        })}

        {/* MACD line */}
        <motion.path
          d={`M ${dataPoints.map((d, i) => `${30 + i * 38} ${90 - d.macd * 18}`).join(' L ')}`}
          fill="none" stroke="#3b82f6" strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5 }}
        />
        {/* Signal line */}
        <motion.path
          d={`M ${dataPoints.map((d, i) => `${30 + i * 38} ${90 - d.signal * 18}`).join(' L ')}`}
          fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, delay: 0.3 }}
        />

        {/* Crossover annotation */}
        <circle cx="180" cy="54" r="6" fill="none" stroke="#10b981" strokeWidth="2" />
        <text x="165" y="40" fontSize="9" fill="#10b981" fontWeight="bold">تقاطع ذهبي</text>
      </svg>
      <div className="flex justify-center gap-4 mt-2 text-xs">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-whale" /> MACD</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-warning" /> خط الإشارة</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-profit/10" /> الهيستوجرام</span>
      </div>
    </div>
  );
}

/* ── 10. Support/Resistance (الدعم والمقاومة) ── */
export function SupportResistanceVisual() {
  return (
    <div className="my-6 p-4 rounded-xl bg-card border border-border">
      <h4 className="font-bold mb-3 text-center">مستويات الدعم والمقاومة</h4>
      <svg width="100%" height="220" viewBox="0 0 360 220">
        {/* Resistance line */}
        <motion.line
          x1="20" y1="50" x2="340" y2="50"
          stroke="#ef4444" strokeWidth="2" strokeDasharray="6"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }}
        />
        <text x="280" y="45" fontSize="11" fill="#ef4444" fontWeight="bold">مقاومة (Resistance)</text>

        {/* Support line */}
        <motion.line
          x1="20" y1="170" x2="340" y2="170"
          stroke="#10b981" strokeWidth="2" strokeDasharray="6"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.3 }}
        />
        <text x="290" y="185" fontSize="11" fill="#10b981" fontWeight="bold">دعم (Support)</text>

        {/* Price candles bouncing between support/resistance */}
        {[
          { x: 40, y: 150, h: 20 }, { x: 70, y: 140, h: 25 }, { x: 100, y: 130, h: 22 },
          { x: 130, y: 60, h: 25 }, { x: 160, y: 80, h: 30 }, { x: 190, y: 100, h: 25 },
          { x: 220, y: 160, h: 20 }, { x: 250, y: 140, h: 25 }, { x: 280, y: 70, h: 28 },
          { x: 310, y: 55, h: 22 },
        ].map((c, i) => (
          <motion.rect
            key={i}
            x={c.x} y={c.y} width="12" height={c.h}
            fill={c.y < 100 ? '#ef4444' : '#10b981'}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
          />
        ))}

        {/* Labels */}
        <text x="150" y="25" fontSize="10" fill="#6b7280">السعر يرتد من المقاومة لأسفل</text>
        <text x="150" y="205" fontSize="10" fill="#6b7280">السعر يرتد من الدعم لأعلى</text>
      </svg>
      <p className="text-xs text-muted-foreground mt-2 text-center">
        القاعدة: اشترِ قرب الدعم مع وقف خسارة تحته، بعْ قرب المقاومة
      </p>
    </div>
  );
}

/* ── 11. Moving Averages (المتوسطات المتحركة) ── */
export function MovingAveragesVisual() {
  const candles = [
    120, 118, 122, 125, 120, 128, 130, 126, 132, 135, 130, 138, 140, 135, 142
  ];
  // Calculate simple MAs
  const calcSMA = (data: number[], period: number) => {
    return data.map((_, i) => {
      if (i < period - 1) return null;
      const slice = data.slice(i - period + 1, i + 1);
      return slice.reduce((a, b) => a + b, 0) / period;
    });
  };
  const ma5 = calcSMA(candles, 5);
  const ma10 = calcSMA(candles, 10);

  return (
    <div className="my-6 p-4 rounded-xl bg-card border border-border">
      <h4 className="font-bold mb-3 text-center">المتوسطات المتحركة (MA 5 و MA 10)</h4>
      <svg width="100%" height="200" viewBox="0 0 360 200">
        {/* Price candles */}
        {candles.map((c, i) => {
          const x = 20 + i * 22;
          const y = 180 - (c - 115) * 5;
          return (
            <motion.rect
              key={`c-${i}`}
              x={x} y={y} width="6" height="10"
              fill={c >= candles[i-1] ? '#10b981' : '#ef4444'}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
            />
          );
        })}
        {/* MA5 line */}
        <motion.path
          d={`M ${ma5.map((v, i) => v ? `${20 + i * 22} ${180 - (v - 115) * 5}` : '').filter(Boolean).join(' L ')}`}
          fill="none" stroke="#f59e0b" strokeWidth="2"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5 }}
        />
        {/* MA10 line */}
        <motion.path
          d={`M ${ma10.map((v, i) => v ? `${20 + i * 22} ${180 - (v - 115) * 5}` : '').filter(Boolean).join(' L ')}`}
          fill="none" stroke="#3b82f6" strokeWidth="2"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5, delay: 0.3 }}
        />
      </svg>
      <div className="flex justify-center gap-4 mt-2 text-xs">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-warning" /> MA 5 (سريع)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-whale" /> MA 10 (بطيء)</span>
      </div>
      <p className="text-xs text-muted-foreground mt-2 text-center">
        التقاطع الذهبي: MA السريع يقطع البطيء صعوداً = إشارة شراء
      </p>
    </div>
  );
}

/* ── 12. Bollinger Bands (نطاقات بولينجر) ── */
export function BollingerBandsVisual() {
  const prices = [120, 122, 118, 125, 128, 124, 130, 135, 132, 128, 125, 122, 126, 130, 134];
  const sma = prices.reduce((a, b) => a + b, 0) / prices.length;
  const upper = sma + 8;
  const lower = sma - 8;

  return (
    <div className="my-6 p-4 rounded-xl bg-card border border-border">
      <h4 className="font-bold mb-3 text-center">نطاقات بولينجر (Bollinger Bands)</h4>
      <svg width="100%" height="200" viewBox="0 0 360 200">
        {/* Upper band */}
        <motion.path
          d={`M 20 ${180 - (upper - 115) * 5} Q 180 ${180 - (upper - 115) * 4} 340 ${180 - (upper - 115) * 5}`}
          fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }}
        />
        {/* Middle (SMA) */}
        <motion.line
          x1="20" y1={180 - (sma - 115) * 5} x2="340" y2={180 - (sma - 115) * 5}
          stroke="#6b7280" strokeWidth="1.5"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.2 }}
        />
        {/* Lower band */}
        <motion.path
          d={`M 20 ${180 - (lower - 115) * 5} Q 180 ${180 - (lower - 115) * 6} 340 ${180 - (lower - 115) * 5}`}
          fill="none" stroke="#10b981" strokeWidth="1.5" strokeDasharray="4"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.4 }}
        />
        {/* Price line */}
        <motion.path
          d={`M ${prices.map((p, i) => `${20 + i * 22} ${180 - (p - 115) * 5}`).join(' L ')}`}
          fill="none" stroke="#3b82f6" strokeWidth="2"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5, delay: 0.5 }}
        />
        {/* Squeeze annotation */}
        <rect x="140" y="40" width="80" height="20" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3" />
        <text x="150" y="35" fontSize="9" fill="#f59e0b" fontWeight="bold">Squeeze (تضييق)</text>
      </svg>
      <div className="flex justify-center gap-4 mt-2 text-xs flex-wrap">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-whale" /> السعر</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-muted" /> المتوسط (SMA20)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-loss" /> النطاق العلوي</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-profit" /> النطاق السفلي</span>
      </div>
    </div>
  );
}
