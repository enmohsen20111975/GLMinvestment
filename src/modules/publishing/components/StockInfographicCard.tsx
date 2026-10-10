'use client';

/**
 * StockInfographicCard — بطاقة إنفوجرافيك السهم (للنشر على السوشيال ميديا)
 * ============================================================================
 *
 * بطاقة عمودية (portrait) 800px × 1200px+ تحوّل بيانات السهم الكاملة إلى
 * إنفوجرافيك واحد قابل للنشر على تيليجرام/تويتر/فيسبوك كصورة PNG عالية الدقة.
 *
 * المكوّن SELF-CONTAINED: مفيش أي CSS خارجي. كل الألوان مكتوبة inline
 * أو كـ Tailwind classes في الـ className props.
 *
 * الأقسام السبعة (RTL):
 *   1. ترويسة: شعار + اسم الشركة + السعر اللحظي + التغير
 *   2. رسم بياني لحظي + ملخص الجلسة
 *   3. مقياس فني شعاعي + المؤشرات الأساسية
 *   4. السيناريوهات (صعودي/هبوطي) + مستويات الدعم/المقاومة
 *   5. الرؤية الفنية + التقييم بالنجوم
 *   6. إخلاء المسؤولية
 *   7. تذييل
 *
 * PROPS: انظر StockInfographicCardProps في أسفل الملف.
 */

import React, { useMemo } from 'react';
import { OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';
// PHASE2-PUBLISHING-CARDS: منصة + شعار + سوق + تواريخ (توقع / تحقق / أيام)
import { MARKET_NAMES_AR, type MarketType } from '@/lib/store';

// ============================================================================
// Types
// ============================================================================

export interface StockInfographicCardProps {
  data: {
    ticker: string;
    name_ar: string;
    sector: string;
    logo_url?: string;
    current_price: number;
    change_value: number;
    change_pct: number;
    currency?: string;
    session: {
      high: number;
      low: number;
      prev_close: number;
      volume: string;
      turnover: string;
      trades_count?: number | string;
    };
    chart_data: Array<{ time: string; price: number }>;
    technical_indicators: {
      timeframe: string;
      buy_signals: number;
      neutral_signals: number;
      sell_signals: number;
      sentiment_label: string;
      gauge_score: number; // 0 to 100
    };
    fundamentals: {
      market_cap: string;
      eps: number | string;
      p_e: number | string;
      dividend_yield?: string;
      yearly_high: number;
      yearly_low: number;
      book_value?: string;
    };
    levels: {
      resistance_2: string;
      resistance_1: string;
      support_1: string;
      support_2: string;
    };
    scenarios: {
      bullish_target: string;
      bullish_text: string;
      bearish_target: string;
      bearish_text: string;
    };
    vision_bullet_points: string[];
    rating: {
      score: number;
      label: string;
      stars_count: number;
    };
    liquidity?: {
      poc_price?: number;
      vah_price?: number;
      val_price?: number;
      buy_volume?: number;
      sell_volume?: number;
      delta_volume?: number;
      buy_sell_ratio?: number;
      accumulation_label?: string;
      levels?: Array<{
        price_mid: number;
        volume: number;
        buy_volume: number;
        sell_volume: number;
        is_poc: boolean;
        is_value_area: boolean;
      }>;
    };
    // ─── PHASE2-PUBLISHING-CARDS (owner directive) ──────────────────────────
    // منصة + سوق + تواريخ (توقّع / تحقق / أيام) — كلها اختيارية، null → "—" (Rule 27).
    market?: MarketType;
    prediction_date?: string | null;
    verification_date?: string | null;
    days_taken?: number | null;
    platform_name?: string;
    platform_logo_url?: string;
  };
  cardRef?: React.RefObject<HTMLDivElement>;
}

// ============================================================================
// Color palette (EXACT hex values — do not change)
// ============================================================================

const COLORS = {
  bg: '#070b13',
  card: '#0e1726',
  cardAlt: '#131d31',
  gold: '#eab308',
  goldAmber: '#d97706',
  goldBright: '#facc15',
  emerald: '#10b981',
  red: '#ef4444',
  white: '#ffffff',
  gray: '#94a3b8',
} as const;

// ============================================================================
// Helpers
// ============================================================================

function fmtNum(n: number | string | undefined, digits = 2): string {
  if (n == null || n === '') return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (!isFinite(num)) return String(n);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// ─── PHASE2-PUBLISHING-CARDS ──────────────────────────────────────────────
// صياغة احترافية للتاريخ بالعربية (Rule 27: null/undefined/invalid → "—").
function fmtDateAr(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

// صياغة اسم السوق بالعربية مع رمزه (مع null-safety).
function fmtMarketAr(market?: MarketType | null): { label: string; code: string } {
  if (!market) return { label: '—', code: '—' };
  return {
    label: MARKET_NAMES_AR[market] || '—',
    code: market,
  };
}

// ============================================================================
// SVG: Area Chart (Section 2)
// ============================================================================

interface AreaChartProps {
  data: Array<{ time: string; price: number }>;
  isUp: boolean;
  high: number;
  low: number;
  current: number;
}

function IntradayAreaChart({ data, isUp, high, low, current }: AreaChartProps) {
  // Layout — viewBox 480×180 (fits 65% column at 800px width)
  const W = 480;
  const H = 180;
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_T = 20;
  const PAD_B = 24;

  const prices = data.map((d) => d.price);
  const minP = Math.min(...prices, low);
  const maxP = Math.max(...prices, high);
  const range = maxP - minP || 1;

  const n = data.length;
  const stepX = (W - PAD_L - PAD_R) / Math.max(1, n - 1);

  const points = data.map((d, i) => {
    const x = PAD_L + i * stepX;
    const y = PAD_T + (H - PAD_T - PAD_B) * (1 - (d.price - minP) / range);
    return { x, y, time: d.time, price: d.price };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x ?? 0).toFixed(2)},${(p.y ?? 0).toFixed(2)}`)
    .join(' ');
  const areaPath =
    `M${(points[0].x ?? 0).toFixed(2)},${(H - PAD_B).toFixed(2)} ` +
    points.map((p) => `L${(p.x ?? 0).toFixed(2)},${(p.y ?? 0).toFixed(2)}`).join(' ') +
    ` L${(points[n - 1].x ?? 0).toFixed(2)},${(H - PAD_B).toFixed(2)} Z`;

  const stroke = isUp ? COLORS.emerald : COLORS.red;
  const gradId = isUp ? 'areaGradUp' : 'areaGradDown';
  const gradStop1 = isUp ? '#10b98155' : '#ef444455';
  const gradStop2 = isUp ? '#10b98100' : '#ef444400';

  // Y-axis markers: high / low / current
  const yHigh = PAD_T + (H - PAD_T - PAD_B) * (1 - (high - minP) / range);
  const yLow = PAD_T + (H - PAD_T - PAD_B) * (1 - (low - minP) / range);
  const yCurrent = PAD_T + (H - PAD_T - PAD_B) * (1 - (current - minP) / range);

  // X-axis labels: 6 time points
  const labelIdx = [0, Math.floor((n - 1) / 5), Math.floor((2 * (n - 1)) / 5), Math.floor((3 * (n - 1)) / 5), Math.floor((4 * (n - 1)) / 5), n - 1];
  const xLabels = labelIdx.map((i) => ({ x: points[i].x, label: data[i].time }));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={gradStop1} />
          <stop offset="100%" stopColor={gradStop2} />
        </linearGradient>
      </defs>

      {/* horizontal gridlines */}
      <line x1={PAD_L} y1={yHigh} x2={W - PAD_R} y2={yHigh} stroke={COLORS.emerald} strokeWidth="0.5" strokeDasharray="3,3" opacity="0.35" />
      <line x1={PAD_L} y1={yLow} x2={W - PAD_R} y2={yLow} stroke={COLORS.red} strokeWidth="0.5" strokeDasharray="3,3" opacity="0.35" />
      <line x1={PAD_L} y1={yCurrent} x2={W - PAD_R} y2={yCurrent} stroke={COLORS.goldBright} strokeWidth="0.7" strokeDasharray="4,4" opacity="0.6" />

      {/* area + line */}
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      {/* current price dot */}
      <circle cx={points[n - 1].x} cy={points[n - 1].y} r="3.5" fill={stroke} stroke={COLORS.bg} strokeWidth="1" />

      {/* y-axis labels */}
      <text x={W - PAD_R - 2} y={yHigh - 3} fill={COLORS.emerald} fontSize="9" textAnchor="end" fontFamily="JetBrains Mono, monospace">
        {fmtNum(high)}
      </text>
      <text x={W - PAD_R - 2} y={yLow + 9} fill={COLORS.red} fontSize="9" textAnchor="end" fontFamily="JetBrains Mono, monospace">
        {fmtNum(low)}
      </text>
      <text x={PAD_L + 2} y={yCurrent - 3} fill={COLORS.goldBright} fontSize="9" fontFamily="JetBrains Mono, monospace">
        {fmtNum(current)}
      </text>

      {/* x-axis labels */}
      {xLabels.map((lbl, i) => (
        <text
          key={i}
          x={lbl.x}
          y={H - 6}
          fill={COLORS.gray}
          fontSize="8.5"
          textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
          fontFamily="JetBrains Mono, monospace"
        >
          {lbl.label}
        </text>
      ))}
    </svg>
  );
}

// ============================================================================
// SVG: Radial Gauge (Section 3)
// ============================================================================

interface GaugeProps {
  score: number; // 0..100
  label: string;
  buy: number;
  neutral: number;
  sell: number;
}

function TechnicalGauge({ score, label, buy, neutral, sell }: GaugeProps) {
  // Semicircle gauge: 5 segments + needle
  // viewBox: 0 0 200 120
  const cx = 100;
  const cy = 100;
  const r = 80;

  // 5 segments: strong-sell (0-20) | sell (20-40) | neutral (40-60) | buy (60-80) | strong-buy (80-100)
  // Each segment spans 36° (180° / 5). Angles measured from 180° (left) to 0° (right).
  const segments = [
    { from: 0, to: 20, color: '#dc2626' }, // strong sell
    { from: 20, to: 40, color: '#f97316' }, // sell
    { from: 40, to: 60, color: '#eab308' }, // neutral
    { from: 60, to: 80, color: '#22c55e' }, // buy
    { from: 80, to: 100, color: '#10b981' }, // strong buy
  ];

  // Convert score (0..100) → angle (180°..0°)
  function scoreToAngle(s: number): number {
    const clamped = Math.max(0, Math.min(100, s));
    return 180 - (clamped / 100) * 180;
  }
  function polar(cx: number, cy: number, r: number, angleDeg: number) {
    const a = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  }

  function arcPath(fromScore: number, toScore: number, innerR: number, outerR: number): string {
    const a1 = scoreToAngle(fromScore);
    const a2 = scoreToAngle(toScore);
    const p1 = polar(cx, cy, outerR, a1);
    const p2 = polar(cx, cy, outerR, a2);
    const p3 = polar(cx, cy, innerR, a2);
    const p4 = polar(cx, cy, innerR, a1);
    const largeArc = Math.abs(a2 - a1) > 180 ? 1 : 0;
    return `M${p1.x},${p1.y} A${outerR},${outerR} 0 ${largeArc} 1 ${p2.x},${p2.y} L${p3.x},${p3.y} A${innerR},${innerR} 0 ${largeArc} 0 ${p4.x},${p4.y} Z`;
  }

  const needleAngle = scoreToAngle(score);
  const needleEnd = polar(cx, cy, r - 10, needleAngle);

  // Score color lookup
  const scoreColor = segments.find((s) => score >= s.from && score <= s.to)?.color || COLORS.goldBright;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" width="100%" height="120" style={{ display: 'block' }}>
        {/* 5 colored segments */}
        {segments.map((seg, i) => (
          <path key={i} d={arcPath(seg.from, seg.to, r - 14, r)} fill={seg.color} opacity="0.9" />
        ))}

        {/* needle */}
        <line
          x1={cx}
          y1={cy}
          x2={needleEnd.x}
          y2={needleEnd.y}
          stroke={COLORS.white}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="6" fill={COLORS.white} />
        <circle cx={cx} cy={cy} r="3" fill={scoreColor} />

        {/* score number */}
        <text x={cx} y={cy - 18} fill={scoreColor} fontSize="22" fontWeight="800" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
          {Math.round(score)}
        </text>
        <text x={cx} y={cy - 4} fill={COLORS.gray} fontSize="8" textAnchor="middle" fontFamily="Cairo, sans-serif">
          / 100
        </text>

        {/* segment labels */}
        <text x={20} y={110} fill={COLORS.red} fontSize="7" textAnchor="middle" fontFamily="JetBrains Mono">بيع قوي</text>
        <text x={60} y={110} fill="#f97316" fontSize="7" textAnchor="middle" fontFamily="JetBrains Mono">بيع</text>
        <text x={100} y={110} fill={COLORS.gold} fontSize="7" textAnchor="middle" fontFamily="JetBrains Mono">محايد</text>
        <text x={140} y={110} fill="#22c55e" fontSize="7" textAnchor="middle" fontFamily="JetBrains Mono">شراء</text>
        <text x={180} y={110} fill={COLORS.emerald} fontSize="7" textAnchor="middle" fontFamily="JetBrains Mono">شراء قوي</text>
      </svg>

      {/* sentiment label */}
      <div
        className="mt-1 px-3 py-1 rounded-full text-xs font-bold"
        style={{
          background: `${scoreColor}22`,
          color: scoreColor,
          border: `1px solid ${scoreColor}66`,
        }}
      >
        {label}
      </div>

      {/* signal counts table */}
      <div className="mt-3 w-full grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-md py-1.5 px-1" style={{ background: '#10b9811a', border: '1px solid #10b98155' }}>
          <div className="text-[10px] text-emerald-400">شراء</div>
          <div className="text-base font-bold text-emerald-400" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{buy}</div>
        </div>
        <div className="rounded-md py-1.5 px-1" style={{ background: '#eab3081a', border: '1px solid #eab30855' }}>
          <div className="text-[10px]" style={{ color: COLORS.gold }}>محايد</div>
          <div className="text-base font-bold" style={{ color: COLORS.gold, fontFamily: 'JetBrains Mono, monospace' }}>{neutral}</div>
        </div>
        <div className="rounded-md py-1.5 px-1" style={{ background: '#ef44441a', border: '1px solid #ef444455' }}>
          <div className="text-[10px] text-rose-400">بيع</div>
          <div className="text-base font-bold text-rose-400" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{sell}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components for each section
// ============================================================================

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-3 flex items-center gap-2"
      style={{ borderBottom: `1px solid ${COLORS.gold}40`, paddingBottom: '6px' }}
    >
      <div
        style={{
          width: 4,
          height: 18,
          background: `linear-gradient(180deg, ${COLORS.gold}, ${COLORS.goldAmber})`,
          borderRadius: 2,
        }}
      />
      <h3 className="text-base font-bold" style={{ color: COLORS.goldBright }}>
        {children}
      </h3>
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function StockInfographicCard({ data, cardRef }: StockInfographicCardProps) {
  const isUp = data.change_pct >= 0;
  const changeColor = isUp ? COLORS.emerald : COLORS.red;
  const currency = data.currency || 'ج.م';

  // PHASE2-PUBLISHING-CARDS: منصة + سوق + تواريخ
  const platformName = data.platform_name || 'دليل الاستثمار';
  const marketInfo = fmtMarketAr(data.market ?? null);
  const predictionDateStr = fmtDateAr(data.prediction_date ?? null);
  const verificationDateStr = fmtDateAr(data.verification_date ?? null);
  const daysTaken =
    data.days_taken != null && Number.isFinite(data.days_taken)
      ? `${data.days_taken} يوم`
      : '—';

  // Chart session up/down
  const sessionUp = useMemo(() => {
    if (!data.chart_data || data.chart_data.length < 2) return data.change_pct >= 0;
    const first = data.chart_data[0].price;
    const last = data.chart_data[data.chart_data.length - 1].price;
    return last >= first;
  }, [data.chart_data, data.change_pct]);

  const stars = '⭐'.repeat(Math.max(0, Math.min(5, data.rating.stars_count))) +
    '☆'.repeat(Math.max(0, 5 - data.rating.stars_count));

  const sessionRows: Array<{ icon: string; label: string; value: string; color?: string }> = [
    { icon: '🏷️', label: 'آخر سعر', value: fmtNum(data.current_price), color: COLORS.white },
    { icon: data.change_value >= 0 ? '📈' : '📉', label: 'التغير اليومي', value: `${data.change_value >= 0 ? '+' : ''}${fmtNum(data.change_value)} (${data.change_pct >= 0 ? '+' : ''}${fmtNum(data.change_pct)}%)`, color: changeColor },
    { icon: '⬆️', label: 'أعلى سعر', value: fmtNum(data.session.high), color: COLORS.emerald },
    { icon: '⬇️', label: 'أدنى سعر', value: fmtNum(data.session.low), color: COLORS.red },
    { icon: '🕒', label: 'إغلاق سابق', value: fmtNum(data.session.prev_close), color: COLORS.gray },
    { icon: '📊', label: 'حجم التداول', value: data.session.volume, color: COLORS.white },
    { icon: '💰', label: 'قيمة التداول', value: data.session.turnover, color: COLORS.white },
    { icon: '🤝', label: 'عدد الصفقات', value: String(data.session.trades_count ?? '—'), color: COLORS.white },
  ];

  const fundamentalsRows: Array<{ left: { label: string; value: string }; right: { label: string; value: string } }> = [
    { left: { label: 'القيمة السوقية', value: data.fundamentals.market_cap }, right: { label: 'EPS', value: fmtNum(data.fundamentals.eps) } },
    { left: { label: 'قيمة التداول', value: data.session.turnover }, right: { label: 'P/E', value: fmtNum(data.fundamentals.p_e) } },
    { left: { label: 'حجم التداول', value: data.session.volume }, right: { label: 'عائد التوزيعات', value: data.fundamentals.dividend_yield || '—' } },
    { left: { label: 'أعلى سنوياً', value: fmtNum(data.fundamentals.yearly_high) }, right: { label: 'العائد', value: fmtNum(data.fundamentals.yearly_low) } },
    { left: { label: 'أدنى سنوياً', value: fmtNum(data.fundamentals.yearly_low) }, right: { label: 'القيمة الدفترية', value: data.fundamentals.book_value || '—' } },
  ];

  const levelsList: Array<{ label: string; value: string; color: string }> = [
    { label: 'مقاومة 2', value: data.levels.resistance_2, color: COLORS.red },
    { label: 'مقاومة 1', value: data.levels.resistance_1, color: '#f87171' },
    { label: 'دعم 1', value: data.levels.support_1, color: '#34d399' },
    { label: 'دعم 2', value: data.levels.support_2, color: COLORS.emerald },
  ];

  return (
    <div
      ref={cardRef}
      dir="rtl"
      className="w-[800px] mx-auto overflow-hidden rounded-2xl"
      style={{
        background: `linear-gradient(180deg, ${COLORS.bg} 0%, #0a0f1a 100%)`,
        minHeight: 1200,
        fontFamily: 'Cairo, Tajawal, sans-serif',
        border: `1px solid ${COLORS.gold}40`,
        boxShadow: `0 0 60px ${COLORS.gold}15`,
      }}
    >
      {/* ============================================================ */}
      {/* Section 0 — Platform Branding Header / ترويسة المنصة           */}
      {/* (PHASE2-PUBLISHING-CARDS — اسم المنصة + شعار + سوق + تواريخ)  */}
      {/* ============================================================ */}
      <section
        className="px-6 pt-4 pb-3 flex items-center justify-between gap-3"
        style={{
          background: `linear-gradient(90deg, #050810 0%, #0c1320 50%, #050810 100%)`,
          borderBottom: `1px solid ${COLORS.gold}30`,
        }}
      >
        {/* Right (RTL): platform logo + name */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden"
            style={{
              background: `linear-gradient(135deg, ${COLORS.gold} 0%, ${COLORS.goldAmber} 100%)`,
              border: `1.5px solid ${COLORS.goldBright}`,
              boxShadow: `0 0 10px ${COLORS.gold}40`,
            }}
          >
            {data.platform_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.platform_logo_url}
                alt={platformName}
                className="w-full h-full object-cover"
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span
                className="text-lg font-extrabold"
                style={{ color: COLORS.bg, fontFamily: 'Cairo, sans-serif' }}
              >
                د
              </span>
            )}
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-extrabold" style={{ color: COLORS.goldBright }}>
              {platformName}
            </span>
            <span className="text-[10px]" style={{ color: COLORS.gray }}>
              تحليل كمي بالذكاء الاصطناعي
            </span>
          </div>
        </div>

        {/* Center: market badge */}
        <div className="flex flex-col items-center gap-1 flex-1">
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full"
            style={{
              background: `${COLORS.gold}18`,
              border: `1px solid ${COLORS.gold}55`,
            }}
          >
            <span className="text-[11px] font-bold" style={{ color: COLORS.goldBright }}>
              {marketInfo.label}
            </span>
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: COLORS.bg,
                color: COLORS.gold,
                border: `1px solid ${COLORS.gold}40`,
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {marketInfo.code}
            </span>
          </div>
          <span className="text-[9px]" style={{ color: COLORS.gray }}>
            السوق المسجَّل عليه التحليل
          </span>
        </div>

        {/* Left: dates row — توقّع / تحقق / أيام */}
        <div className="shrink-0 flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5 text-[10px]" style={{ color: COLORS.gray }}>
            <span>توقّع:</span>
            <span className="font-bold font-mono" dir="ltr" style={{ color: COLORS.white }}>
              {predictionDateStr}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]" style={{ color: COLORS.gray }}>
            <span>تحقق:</span>
            <span className="font-bold font-mono" dir="ltr" style={{ color: COLORS.emerald }}>
              {verificationDateStr}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]" style={{ color: COLORS.gray }}>
            <span>المدة:</span>
            <span className="font-bold font-mono" dir="ltr" style={{ color: COLORS.goldBright }}>
              {daysTaken}
            </span>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* Section 1 — Header / ترويسة                                  */}
      {/* ============================================================ */}
      <section
        className="px-6 pt-6 pb-5 flex items-center justify-between gap-4"
        style={{
          background: `linear-gradient(90deg, ${COLORS.card} 0%, ${COLORS.cardAlt} 100%)`,
          borderBottom: `2px solid ${COLORS.gold}60`,
        }}
      >
        {/* Right (RTL): logo + ticker */}
        <div className="flex flex-col items-center gap-1.5 shrink-0">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden"
            style={{
              border: `2px solid ${COLORS.gold}`,
              background: COLORS.bg,
              boxShadow: `0 0 12px ${COLORS.gold}40`,
            }}
          >
            {data.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.logo_url}
                alt={data.ticker}
                className="w-full h-full object-cover"
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="text-2xl font-bold" style={{ color: COLORS.goldBright }}>
                {data.ticker.slice(0, 2)}
              </span>
            )}
          </div>
          <span
            className="text-xs font-bold tracking-wider"
            style={{ color: COLORS.goldBright, fontFamily: 'JetBrains Mono, monospace' }}
          >
            {data.ticker}
          </span>
        </div>

        {/* Center: name + sector */}
        <div className="flex-1 text-center">
          <div className="text-sm font-medium" style={{ color: COLORS.gray }}>
            تحليل فني لسهم
          </div>
          <div className="text-2xl font-extrabold mt-0.5" style={{ color: COLORS.white }}>
            {data.name_ar}
          </div>
          <div className="text-sm font-bold mt-1" style={{ color: COLORS.goldBright }}>
            {data.ticker}
          </div>
          <div
            className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 rounded-full text-[11px]"
            style={{
              background: `${COLORS.gold}1a`,
              border: `1px solid ${COLORS.gold}40`,
              color: COLORS.gold,
            }}
          >
            <span>🏭</span>
            <span>{data.sector || 'عام'}</span>
          </div>
        </div>

        {/* Left: price box */}
        <div
          className="shrink-0 rounded-xl px-4 py-3 text-center min-w-[160px]"
          style={{
            background: COLORS.bg,
            border: `1.5px solid ${COLORS.gold}80`,
            boxShadow: `inset 0 0 12px ${COLORS.gold}10`,
          }}
        >
          <div className="text-[10px] font-medium" style={{ color: COLORS.gray }}>
            آخر سعر
          </div>
          <div
            className="text-2xl font-extrabold mt-0.5"
            style={{ color: COLORS.white, fontFamily: 'JetBrains Mono, monospace' }}
          >
            {fmtNum(data.current_price)}
          </div>
          <div
            className="inline-block mt-1 px-2 py-0.5 rounded-md text-xs font-bold"
            style={{
              background: `${changeColor}22`,
              color: changeColor,
              border: `1px solid ${changeColor}66`,
            }}
          >
            {data.change_pct >= 0 ? '▲' : '▼'} {fmtNum(Math.abs(data.change_pct))}%
          </div>
          <div className="text-[9px] mt-1" style={{ color: COLORS.gray }}>
            البيانات متأخرة 15 دقيقة
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* Section 2 — Intraday chart + session summary                  */}
      {/* ============================================================ */}
      <section className="px-6 py-4">
        <SectionHeader>الرسم البياني اللحظي للسهم (جلسة تداول واحدة)</SectionHeader>
        <div className="flex gap-3">
          {/* Left (65%) — area chart */}
          <div
            className="rounded-xl p-3"
            style={{ width: '65%', background: COLORS.card, border: `1px solid ${COLORS.gold}30` }}
          >
            <div className="text-xs mb-1.5" style={{ color: COLORS.gray }}>
              {sessionUp ? '🟢 الجلسة صاعدة' : '🔴 الجلسة هابطة'}
            </div>
            <div style={{ height: 200 }}>
              <IntradayAreaChart
                data={data.chart_data}
                isUp={sessionUp}
                high={data.session.high}
                low={data.session.low}
                current={data.current_price}
              />
            </div>
            <div className="flex justify-between mt-1 text-[10px]" style={{ color: COLORS.gray }}>
              <span>10:00</span><span>11:00</span><span>12:00</span><span>01:00</span><span>02:00</span><span>03:00</span>
            </div>
          </div>

          {/* Right (35%) — session summary */}
          <div
            className="rounded-xl p-3"
            style={{ width: '35%', background: COLORS.cardAlt, border: `1px solid ${COLORS.gold}30` }}
          >
            <div className="text-xs mb-2 font-bold" style={{ color: COLORS.goldBright }}>
              ملخص الجلسة
            </div>
            <div className="space-y-1">
              {sessionRows.map((row, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] py-0.5">
                  <span style={{ color: COLORS.gray }}>
                    <span className="ml-1">{row.icon}</span>
                    {row.label}
                  </span>
                  <span className="font-bold" dir="ltr" style={{ color: row.color || COLORS.white, fontFamily: 'JetBrains Mono, monospace' }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* Section 3 — Technical Gauge + Fundamentals                    */}
      {/* ============================================================ */}
      <section className="px-6 py-4">
        <SectionHeader>المؤشرات الفنية والأرقام الأساسية</SectionHeader>
        <div className="flex gap-3">
          {/* Right (50%) — gauge */}
          <div
            className="rounded-xl p-3"
            style={{ width: '50%', background: COLORS.card, border: `1px solid ${COLORS.gold}30` }}
          >
            <div className="text-xs mb-1 font-bold text-center" style={{ color: COLORS.goldBright }}>
              مقياس التحليل الفني ({data.technical_indicators.timeframe})
            </div>
            <TechnicalGauge
              score={data.technical_indicators.gauge_score}
              label={data.technical_indicators.sentiment_label}
              buy={data.technical_indicators.buy_signals}
              neutral={data.technical_indicators.neutral_signals}
              sell={data.technical_indicators.sell_signals}
            />
          </div>

          {/* Left (50%) — fundamentals */}
          <div
            className="rounded-xl p-3"
            style={{ width: '50%', background: COLORS.cardAlt, border: `1px solid ${COLORS.gold}30` }}
          >
            <div className="text-xs mb-2 font-bold" style={{ color: COLORS.goldBright }}>
              المؤشرات الأساسية
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {fundamentalsRows.map((row, i) => (
                <React.Fragment key={i}>
                  <div className="text-[11px]">
                    <div style={{ color: COLORS.gray }}>{row.left.label}</div>
                    <div className="font-bold" dir="ltr" style={{ color: COLORS.white, fontFamily: 'JetBrains Mono, monospace' }}>
                      {row.left.value}
                    </div>
                  </div>
                  <div className="text-[11px]">
                    <div style={{ color: COLORS.gray }}>{row.right.label}</div>
                    <div className="font-bold" dir="ltr" style={{ color: COLORS.white, fontFamily: 'JetBrains Mono, monospace' }}>
                      {row.right.value}
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* Section 4 — Scenarios + Levels                               */}
      {/* ============================================================ */}
      <section className="px-6 py-4">
        <SectionHeader>السيناريوهات ومستويات الدعم/المقاومة</SectionHeader>
        <div className="grid grid-cols-3 gap-3">
          {/* Bullish */}
          <div
            className="rounded-xl p-3"
            style={{
              background: '#10b98114',
              border: `1.5px solid ${COLORS.emerald}66`,
            }}
          >
            <div className="text-xs font-bold mb-1" style={{ color: COLORS.emerald }}>
              🐂 السيناريو الصعودي
            </div>
            <div className="text-[11px] mb-1" style={{ color: COLORS.gray }}>
              الهدف الصعودي
            </div>
            <div className="text-lg font-extrabold" dir="ltr" style={{ color: COLORS.emerald, fontFamily: 'JetBrains Mono, monospace' }}>
              {data.scenarios.bullish_target}
            </div>
            <div className="text-[10px] mt-1 leading-snug" style={{ color: COLORS.gray }}>
              {data.scenarios.bullish_text}
            </div>
          </div>

          {/* Bearish */}
          <div
            className="rounded-xl p-3"
            style={{
              background: '#ef444414',
              border: `1.5px solid ${COLORS.red}66`,
            }}
          >
            <div className="text-xs font-bold mb-1" style={{ color: COLORS.red }}>
              🐻 السيناريو الهبوطي
            </div>
            <div className="text-[11px] mb-1" style={{ color: COLORS.gray }}>
              الهدف الهبوطي
            </div>
            <div className="text-lg font-extrabold" dir="ltr" style={{ color: COLORS.red, fontFamily: 'JetBrains Mono, monospace' }}>
              {data.scenarios.bearish_target}
            </div>
            <div className="text-[10px] mt-1 leading-snug" style={{ color: COLORS.gray }}>
              {data.scenarios.bearish_text}
            </div>
          </div>

          {/* Support / Resistance levels */}
          <div
            className="rounded-xl p-3"
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.gold}40`,
            }}
          >
            <div className="text-xs font-bold mb-2" style={{ color: COLORS.goldBright }}>
              📐 مستويات الدعم/المقاومة
            </div>
            <div className="space-y-1.5">
              {levelsList.map((lvl, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div
                    className="flex-1 h-0.5"
                    style={{
                      background: lvl.color,
                      borderTop: `1px dashed ${lvl.color}`,
                      opacity: 0.7,
                    }}
                  />
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[10px]" style={{ color: COLORS.gray }}>{lvl.label}</span>
                    <span className="text-[11px] font-bold" dir="ltr" style={{ color: lvl.color, fontFamily: 'JetBrains Mono, monospace' }}>
                      {lvl.value}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* Section 4.5 — Liquidity Footprint & Maker Flow (بصمة السيولة) */}
      {/* ============================================================ */}
      {data.liquidity && (
        <section className="px-6 py-3">
          <SectionHeader>بصمة السيولة التراكمية (30 جلسة) ورادار صُنّاع السوق</SectionHeader>
          <div
            className="rounded-xl p-4"
            style={{
              background: `linear-gradient(135deg, ${COLORS.cardAlt} 0%, ${COLORS.card} 100%)`,
              border: `1.5px solid ${COLORS.gold}50`,
              boxShadow: `0 4px 20px ${COLORS.bg}`,
            }}
          >
            {/* Top KPIs: POC, VAH, VAL, Accumulation */}
            <div className="grid grid-cols-4 gap-3 mb-3 text-center">
              <div
                className="p-2.5 rounded-lg"
                style={{ background: '#a855f718', border: '1px solid #a855f755' }}
              >
                <div className="text-[10px]" style={{ color: '#c084fc' }}>نقطة التحكم (POC)</div>
                <div className="text-base font-extrabold font-mono mt-0.5" style={{ color: '#e9d5ff' }}>
                  {data.liquidity.poc_price ? fmtNum(data.liquidity.poc_price) : '—'}
                </div>
                <div className="text-[9px]" style={{ color: COLORS.gray }}>أعلى تركّز للسيولة</div>
              </div>

              <div
                className="p-2.5 rounded-lg"
                style={{ background: '#10b98118', border: '1px solid #10b98155' }}
              >
                <div className="text-[10px]" style={{ color: '#34d399' }}>قمة القيمة (VAH)</div>
                <div className="text-base font-extrabold font-mono mt-0.5" style={{ color: '#a7f3d0' }}>
                  {data.liquidity.vah_price ? fmtNum(data.liquidity.vah_price) : '—'}
                </div>
                <div className="text-[9px]" style={{ color: COLORS.gray }}>سقف منطقة القيمة</div>
              </div>

              <div
                className="p-2.5 rounded-lg"
                style={{ background: '#ef444418', border: '1px solid #ef444455' }}
              >
                <div className="text-[10px]" style={{ color: '#f87171' }}>قاع القيمة (VAL)</div>
                <div className="text-base font-extrabold font-mono mt-0.5" style={{ color: '#fecaca' }}>
                  {data.liquidity.val_price ? fmtNum(data.liquidity.val_price) : '—'}
                </div>
                <div className="text-[9px]" style={{ color: COLORS.gray }}>أرضية منطقة القيمة</div>
              </div>

              <div
                className="p-2.5 rounded-lg flex flex-col justify-center items-center"
                style={{ background: `${COLORS.gold}18`, border: `1px solid ${COLORS.gold}55` }}
              >
                <div className="text-[10px]" style={{ color: COLORS.goldBright }}>حركة السيولة (30ي)</div>
                <div className="text-xs font-bold mt-1 px-2 py-0.5 rounded" style={{ background: `${COLORS.gold}30`, color: COLORS.goldBright }}>
                  {data.liquidity.accumulation_label || 'توازن سيولة'}
                </div>
                <div className="text-[9px] mt-0.5" style={{ color: COLORS.gray }}>
                  نسبة ش/ب: {data.liquidity.buy_sell_ratio ? (data.liquidity.buy_sell_ratio ?? 0).toFixed(2) : '1.00'}x
                </div>
              </div>
            </div>

            {/* Buy / Sell Pressure Bar */}
            {data.liquidity.buy_volume != null && data.liquidity.sell_volume != null && (
              <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${COLORS.gold}20` }}>
                <div className="flex items-center justify-between text-[11px] mb-1 font-bold">
                  <span style={{ color: COLORS.emerald }}>
                    🟢 شراء: {fmtNum(data.liquidity.buy_volume, 0)}
                  </span>
                  <span style={{ color: COLORS.goldBright }}>
                    Delta: {data.liquidity.delta_volume && data.liquidity.delta_volume >= 0 ? '+' : ''}
                    {data.liquidity.delta_volume ? fmtNum(data.liquidity.delta_volume, 0) : '0'}
                  </span>
                  <span style={{ color: COLORS.red }}>
                    🔴 بيع: {fmtNum(data.liquidity.sell_volume, 0)}
                  </span>
                </div>
                {(() => {
                  const buy = data.liquidity.buy_volume || 0;
                  const sell = data.liquidity.sell_volume || 0;
                  const total = buy + sell || 1;
                  const buyPct = (buy / total) * 100;
                  return (
                    <div className="flex h-3 rounded-full overflow-hidden" style={{ background: '#1e293b' }}>
                      <div
                        style={{
                          width: `${buyPct}%`,
                          background: 'linear-gradient(90deg, #059669, #10b981)',
                        }}
                      />
                      <div
                        style={{
                          width: `${100 - buyPct}%`,
                          background: 'linear-gradient(90deg, #ef4444, #dc2626)',
                        }}
                      />
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ============================================================ */}
      {/* Section 5 — Technical Vision + Rating                        */}
      {/* ============================================================ */}
      <section className="px-6 py-4">
        <SectionHeader>الرؤية الفنية والتقييم</SectionHeader>
        <div className="flex gap-3">
          {/* Left (75%) — vision bullet points */}
          <div
            className="rounded-xl p-3"
            style={{ width: '75%', background: COLORS.card, border: `1px solid ${COLORS.gold}30` }}
          >
            <div className="text-xs font-bold mb-2" style={{ color: COLORS.goldBright }}>
              💡 الرؤية الفنية للسهم
            </div>
            <ul className="space-y-1.5">
              {data.vision_bullet_points.map((bp, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
                  <span className="mt-0.5 shrink-0" style={{ color: COLORS.gold }}>▸</span>
                  <span style={{ color: COLORS.white }}>{bp}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right (25%) — rating */}
          <div
            className="rounded-xl p-3 text-center flex flex-col justify-center"
            style={{
              width: '25%',
              background: COLORS.cardAlt,
              border: `1px solid ${COLORS.gold}40`,
            }}
          >
            <div className="text-xs font-bold mb-1" style={{ color: COLORS.goldBright }}>
              التقييم الفني
            </div>
            <div className="text-2xl my-1" style={{ letterSpacing: '2px' }}>
              {stars}
            </div>
            <div
              className="text-lg font-extrabold mt-1"
              style={{ color: COLORS.goldBright, fontFamily: 'JetBrains Mono, monospace' }}
            >
              {data.rating.score}/100
            </div>
            <div
              className="text-[11px] mt-1 px-2 py-0.5 rounded-md inline-block"
              style={{
                background: `${COLORS.gold}22`,
                color: COLORS.goldBright,
                border: `1px solid ${COLORS.gold}40`,
              }}
            >
              {data.rating.label}
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* Section 6 — Disclaimer                                       */}
      {/* ============================================================ */}
      <section className="px-6 py-3">
        <div
          className="rounded-xl p-3 flex items-start gap-2"
          style={{
            background: `${COLORS.gold}10`,
            border: `1px solid ${COLORS.gold}50`,
          }}
        >
          <span className="text-base shrink-0">⚠️</span>
          <p className="text-[10px] leading-relaxed" style={{ color: COLORS.gray }}>
            <span style={{ color: COLORS.goldBright, fontWeight: 700 }}>إخلاء مسؤولية: </span>
            تحليل كمي بالذكاء الاصطناعي — ليس نصيحة استثمارية. قرارات الاستثمار مسؤوليتك الكاملة.
            <br />
            <span style={{ color: COLORS.gray, opacity: 0.85 }}>
              هذا التحليل لأغراض تعليمية وإعلامية فقط ولا يُعدّ إشارة مباشرة للشراء أو البيع.
              تداول الأسهم ينطوي على مخاطر، والبيانات السوقية قد تتأخر 15 دقيقة. يُرجى الرجوع
              لمستشار مالي مرخّص قبل اتخاذ أي قرار.
            </span>
          </p>
        </div>
      </section>

      {/* ============================================================ */}
      {/* Section 7 — Footer                                           */}
      {/* ============================================================ */}
      <section
        className="px-6 py-4 flex items-center justify-between gap-3"
        style={{
          background: `linear-gradient(90deg, ${COLORS.card} 0%, ${COLORS.cardAlt} 100%)`,
          borderTop: `2px solid ${COLORS.gold}60`,
        }}
      >
        {/* Right: logo + URL */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${COLORS.gold}, ${COLORS.goldAmber})`,
              border: `1px solid ${COLORS.gold}`,
            }}
          >
            <span className="text-base font-extrabold" style={{ color: COLORS.bg }}>i</span>
          </div>
          <div>
            <div className="text-xs font-bold" style={{ color: COLORS.white }}>دليل الاستثمار</div>
            <div className="text-[10px]" style={{ color: COLORS.goldBright, fontFamily: 'JetBrains Mono, monospace' }}>
              invist.m2y.net
            </div>
          </div>
        </div>

        {/* Center: features */}
        <div className="flex flex-wrap items-center justify-center gap-2 flex-1">
          {[
            { icon: '📈', label: 'تحليل فني لحظي' },
            { icon: '🎯', label: 'أهداف واضحة' },
            { icon: '🛡️', label: 'إدارة مخاطر' },
            { icon: '⚙️', label: 'تحليل آلي' },
          ].map((feat, i) => (
            <div
              key={i}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px]"
              style={{
                background: COLORS.bg,
                border: `1px solid ${COLORS.gold}40`,
                color: COLORS.gray,
              }}
            >
              <span>{feat.icon}</span>
              <span>{feat.label}</span>
            </div>
          ))}
        </div>

        {/* Left: Bot link + Google Play badge */}
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={OFFICIAL_LINKS.bot}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg no-underline"
            style={{
              background: COLORS.bg,
              border: `1px solid ${COLORS.gold}60`,
            }}
          >
            <span className="text-lg">⚙️</span>
            <div className="text-[9px] leading-tight">
              <div style={{ color: COLORS.gray }}>SMART BOT</div>
              <div className="font-bold" style={{ color: COLORS.white }}>بوت التحليل</div>
            </div>
          </a>
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
            style={{
              background: COLORS.bg,
              border: `1px solid ${COLORS.gold}60`,
            }}
          >
            <span className="text-lg">📱</span>
            <div className="text-[9px] leading-tight">
              <div style={{ color: COLORS.gray }}>GET IT ON</div>
              <div className="font-bold" style={{ color: COLORS.white }}>Google Play</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default StockInfographicCard;
