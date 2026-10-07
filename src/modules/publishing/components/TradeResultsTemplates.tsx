/**
 * TradeResultsTemplates.tsx — قوالب نتائج الصفقات للنشر الاجتماعي
 * ====================================================================
 * Task 38-B (Social Media Report Templates — Daily / Weekly / Monthly).
 *
 * المواصفات (من المالك):
 *   - Daily   : 1080 × 1350 px (vertical)   — "نتائج صفقات اليوم"
 *   - Weekly  : 1200 × 628  px (landscape)  — "نتائج صفقات الأسبوع"
 *   - Monthly : 1080 × 1080 px (square)     — "نتائج صفقات الشهر"
 *
 * الهوية البصرية (Rule 30 — dark navy + emerald + gold + slate + red):
 *   - خلفية:        #0a0e1a (very dark navy)
 *   - بطاقات:        #141b2d (slightly lighter)
 *   - حدود:          #2a3450 (subtle blue-gray)
 *   - نص أساسي:      #ffffff
 *   - نص ثانوي:      #94a3b8 (slate-400)
 *   - إيجابي (أرباح): #10b981 (emerald-500 — Green Neon)
 *   - ذهبي (Trophy):  #f59e0b (amber-500 — Gold)
 *   - سلبي:          #ef4444 (red-500 — losses only)
 *
 * Rule 67 (NO fabricated data):
 *   - لو stats === null → نعرض EmptyState فقط (لا أرقام، لا جدول، لا بطاقات).
 *   - لو stats.top_trades فاضي → نعرض جدول بصف واحد "لا توجد صفقات في هذه الفترة".
 *
 * Rule 68 (Verification):
 *   - المكونات pure React + inline styles (للتصدير بدقة بكسل عبر html-to-image).
 *   - لا صور خارجية — SVG + CSS only.
 *
 * مصدر البيانات: Task 38-A Data Engine
 *   - GET /api/trade-results?period=daily|weekly|monthly
 *   - يعيد ReportData (شكل موثّق في الأسفل).
 */

import React from 'react';

// ─── الأنواع (Types) ────────────────────────────────────────────────────────

/**
 * صفقة رابحة واحدة.
 * الحقول متوافقة مع شكل Task 38-A Data Engine.
 */
export interface TradeResult {
  /** رمز السهم (مثال: COMI, ETEL) */
  ticker: string;
  /** اسم الشركة بالعربية (اختياري) */
  name_ar?: string;
  /** سعر التوقّع (سعر الدخول) */
  recommendation_price: number;
  /** السعر المستهدف */
  target_price: number;
  /** سعر الإغلاق الفعلي (سعر الخروج) — أسماء بديلة شائعة: actual_close_price, exit_price */
  exit_price: number;
  /** العائد المحقق % (realized return) */
  realized_return_pct: number;
  /** تاريخ الإغلاق (اختياري ISO) */
  exit_date?: string;
  /** هل تجاوز الهدف؟ (exit_price >= target_price) — يُحسب تلقائياً لو مش موجود */
  exceeded_target?: boolean;
}

/**
 * ملخص إحصائيات الفترة.
 * `null` لو مفيش صفقات مؤهلة (Rule 67 — Empty state إلزامي).
 */
export interface ReportStats {
  total_closed: number;
  winning_closed: number;
  losing_closed: number;
  /** نسبة النجاح % (0-100) */
  success_rate: number;
  /** متوسط العائد % */
  average_return: number;
  /** إجمالي الحركة السعرية الموجبة % */
  total_price_movement: number;
  top_trades: TradeResult[];
}

export type ReportPeriod = 'daily' | 'weekly' | 'monthly';

export interface ReportData {
  period: ReportPeriod;
  period_start: string;
  period_end: string;
  stats: ReportStats | null;
  validation: { valid: boolean; errors: string[] };
}

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  bg: '#0a0e1a',
  bgCard: '#141b2d',
  bgCardAlt: '#1a2238',
  border: '#2a3450',
  borderGold: '#f59e0b',
  textPrimary: '#ffffff',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  positive: '#10b981',
  positiveGlow: 'rgba(16, 185, 129, 0.25)',
  gold: '#f59e0b',
  goldGlow: 'rgba(245, 158, 11, 0.22)',
  negative: '#ef4444',
  cyan: '#06b6d4',
} as const;

const FONT_FAMILY =
  "'Tajawal', 'Cairo', 'Segoe UI', 'Noto Sans Arabic', system-ui, sans-serif";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtDate(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('ar-EG', opts ?? {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** يحسب exceeded_target لو مش موجود (Rule 67 — لا نخترع قيمة، نحسب من الحقول الحقيقية) */
function isTradeExceedingTarget(t: TradeResult): boolean {
  if (typeof t.exceeded_target === 'boolean') return t.exceeded_target;
  if (!t.target_price || !t.exit_price) return false;
  return t.exit_price >= t.target_price;
}

function isTradeProfitable(t: TradeResult): boolean {
  if (Number.isFinite(t.realized_return_pct)) {
    return t.realized_return_pct > 0;
  }
  if (t.exit_price && t.recommendation_price) {
    return t.exit_price > t.recommendation_price;
  }
  return false;
}

// ─── Shared SVG Components ──────────────────────────────────────────────────

/** شعار "دليل الاستثمار" — صندوق نصي بدون صور خارجية */
function LogoBox({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
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
function TrophyIcon({ size = 36 }: { size?: number }) {
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
function CandlestickBackground({ opacity = 0.07 }: { opacity?: number }) {
  // 7 شموع بسيطة في صف واحد — خلفية زخرفية رقيقة
  const candles = [
    { x: 60, o: 70, c: 50, h: 35, l: 80, up: true },
    { x: 130, o: 50, c: 30, h: 20, l: 60, up: true },
    { x: 200, o: 30, c: 45, h: 22, l: 55, up: false },
    { x: 270, o: 45, c: 25, h: 15, l: 52, up: true },
    { x: 340, o: 25, c: 10, h: 5,  l: 30, up: true },
    { x: 410, o: 10, c: 20, h: 5,  l: 25, up: false },
    { x: 480, o: 20, c: 5,  h: 0,  l: 25, up: true },
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
function ArrowUp({ size = 28 }: { size?: number }) {
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

// ─── Shared UI Components ───────────────────────────────────────────────────

interface KpiCardProps {
  icon: string;
  label: string;
  value: string;
  sublabel?: string;
  accent?: 'emerald' | 'gold' | 'cyan' | 'white';
  size?: 'sm' | 'md' | 'lg';
}

function KpiCard({ icon, label, value, sublabel, accent = 'emerald', size = 'md' }: KpiCardProps) {
  const accentColor =
    accent === 'gold' ? COLORS.gold
    : accent === 'cyan' ? COLORS.cyan
    : accent === 'white' ? COLORS.textPrimary
    : COLORS.positive;

  const padding =
    size === 'lg' ? '24px 22px'
    : size === 'sm' ? '12px 14px'
    : '18px 18px';
  const iconSize = size === 'lg' ? 38 : size === 'sm' ? 22 : 30;
  const labelFs = size === 'lg' ? 16 : size === 'sm' ? 12 : 14;
  const valueFs = size === 'lg' ? 44 : size === 'sm' ? 22 : 32;
  const subFs = size === 'lg' ? 13 : size === 'sm' ? 10 : 11;

  return (
    <div
      style={{
        background: `linear-gradient(160deg, ${COLORS.bgCardAlt} 0%, ${COLORS.bgCard} 100%)`,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding,
        position: 'relative',
        overflow: 'hidden',
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.3)`,
      }}
    >
      {/* accent stripe */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 4,
          height: '100%',
          background: accentColor,
          boxShadow: `0 0 12px ${accentColor}`,
        }}
      />
      <div
        style={{
          fontSize: iconSize,
          lineHeight: 1,
          marginBottom: 8,
          filter: `drop-shadow(0 0 6px ${accentColor}66)`,
        }}
      >
        {icon}
      </div>
      <div
        style={{
          color: COLORS.textSecondary,
          fontSize: labelFs,
          fontWeight: 500,
          marginBottom: 4,
          fontFamily: FONT_FAMILY,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: accentColor,
          fontSize: valueFs,
          fontWeight: 800,
          fontFamily: 'monospace',
          letterSpacing: '-0.5px',
          lineHeight: 1.1,
          direction: 'ltr',
          display: 'inline-block',
          textShadow: `0 0 16px ${accentColor}40`,
        }}
      >
        {value}
      </div>
      {sublabel && (
        <div
          style={{
            color: COLORS.textMuted,
            fontSize: subFs,
            marginTop: 4,
            fontFamily: FONT_FAMILY,
          }}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
}

/** بادج "تجاوز الهدف 🎯" — ذهبي، لصفقات تجاوزت السعر المستهدف */
function BadgeExceededTarget() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 9px',
        background: `linear-gradient(135deg, ${COLORS.gold} 0%, #d97706 100%)`,
        color: '#1a0f00',
        fontSize: 11,
        fontWeight: 800,
        borderRadius: 999,
        fontFamily: FONT_FAMILY,
        boxShadow: `0 0 10px ${COLORS.goldGlow}`,
        whiteSpace: 'nowrap',
      }}
    >
      تجاوز الهدف 🎯
    </span>
  );
}

/** بادج "ربح محقق" — emerald أصغر، لصفقات رابحة لم تتجاوز الهدف */
function BadgeProfit() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        background: `${COLORS.positive}22`,
        color: COLORS.positive,
        border: `1px solid ${COLORS.positive}55`,
        fontSize: 10,
        fontWeight: 700,
        borderRadius: 999,
        fontFamily: FONT_FAMILY,
        whiteSpace: 'nowrap',
      }}
    >
      ربح محقق
    </span>
  );
}

interface TradeRowProps {
  trade: TradeResult;
  index: number;
  compact?: boolean;
}

function TradeRow({ trade, index, compact = false }: TradeRowProps) {
  const exceeded = isTradeExceedingTarget(trade);
  const profitable = isTradeProfitable(trade);
  const ret = trade.realized_return_pct;
  const retColor = ret > 0 ? COLORS.positive : ret < 0 ? COLORS.negative : COLORS.textSecondary;
  const tickerColor = profitable ? COLORS.positive : COLORS.textPrimary;

  const cells = [
    { v: trade.ticker, color: tickerColor, weight: 800 },
    { v: fmt(trade.recommendation_price), color: COLORS.textSecondary, weight: 600 },
    { v: fmt(trade.target_price), color: COLORS.gold, weight: 700 },
    { v: fmt(trade.exit_price), color: COLORS.textPrimary, weight: 700 },
    { v: fmtPct(ret), color: retColor, weight: 800 },
  ];

  return (
    <tr
      style={{
        borderBottom: `1px solid ${COLORS.border}66`,
      }}
    >
      {compact && (
        <td style={{ padding: '10px 6px', textAlign: 'center', color: COLORS.textMuted, fontSize: 12, fontFamily: 'monospace' }}>
          {index + 1}
        </td>
      )}
      {cells.map((c, i) => (
        <td
          key={i}
          style={{
            padding: compact ? '10px 8px' : '12px 10px',
            textAlign: 'center',
            color: c.color,
            fontWeight: c.weight,
            fontSize: compact ? 12 : 13,
            fontFamily: 'monospace',
            direction: 'ltr',
          }}
        >
          {c.v}
        </td>
      ))}
      <td style={{ padding: compact ? '10px 8px' : '12px 10px', textAlign: 'center' }}>
        {exceeded ? <BadgeExceededTarget /> : profitable ? <BadgeProfit /> : null}
      </td>
    </tr>
  );
}

function TradeTable({ trades, compact = false }: { trades: TradeResult[]; compact?: boolean }) {
  if (!trades || trades.length === 0) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: 'center',
          color: COLORS.textMuted,
          fontSize: 13,
          fontFamily: FONT_FAMILY,
          border: `1px dashed ${COLORS.border}`,
          borderRadius: 10,
        }}
      >
        لا توجد صفقات رابحة مؤهلة في هذه الفترة
      </div>
    );
  }

  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontFamily: FONT_FAMILY,
      }}
    >
      <thead>
        <tr style={{ background: COLORS.bgCardAlt }}>
          {compact && (
            <th style={{ padding: '10px 6px', fontSize: 11, color: COLORS.textMuted, fontWeight: 700, textAlign: 'center', borderBottom: `2px solid ${COLORS.gold}` }}>
              #
            </th>
          )}
          {['السهم', 'سعر التوقّع', 'الهدف', 'سعر الإغلاق', 'العائد %', 'الحالة'].map((h, i) => (
            <th
              key={i}
              style={{
                padding: compact ? '10px 8px' : '12px 10px',
                fontSize: compact ? 11 : 12,
                color: i === 0 ? COLORS.textPrimary : COLORS.textSecondary,
                fontWeight: 700,
                textAlign: 'center',
                borderBottom: `2px solid ${COLORS.gold}`,
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {trades.map((t, i) => (
          <TradeRow key={`${t.ticker}-${i}`} trade={t} index={i} compact={compact} />
        ))}
      </tbody>
    </table>
  );
}

/** Empty State — Rule 67 §4: لا نبتكر أرقام، نعرض حالة صريحة */
function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: '50px 30px',
        background: COLORS.bgCard,
        border: `1.5px dashed ${COLORS.border}`,
        borderRadius: 16,
      }}
    >
      <div style={{ fontSize: 56, filter: 'grayscale(0.3)' }}>📭</div>
      <div
        style={{
          color: COLORS.textPrimary,
          fontSize: 18,
          fontWeight: 700,
          fontFamily: FONT_FAMILY,
          textAlign: 'center',
        }}
      >
        {message}
      </div>
      <div
        style={{
          color: COLORS.textMuted,
          fontSize: 13,
          fontFamily: FONT_FAMILY,
          textAlign: 'center',
          maxWidth: 380,
          lineHeight: 1.6,
        }}
      >
        يتم توليد التقارير تلقائياً بعد إغلاق السوق.
        تابع منصة دليل الاستثمار لاستلام النتائج فور توفّرها.
      </div>
    </div>
  );
}

function CTASection({ variant = 'card' }: { variant?: 'card' | 'button' }) {
  if (variant === 'button') {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 32px',
          background: `linear-gradient(135deg, ${COLORS.gold} 0%, #d97706 100%)`,
          color: '#1a0f00',
          fontSize: 18,
          fontWeight: 800,
          borderRadius: 999,
          fontFamily: FONT_FAMILY,
          boxShadow: `0 6px 20px ${COLORS.goldGlow}, 0 0 0 3px ${COLORS.bg}, 0 0 0 4px ${COLORS.gold}66`,
        }}
      >
        <span>تابع النتائج والتوقعات داخل منصة دليل الاستثمار</span>
        <span style={{ fontFamily: 'monospace', fontSize: 16 }}>invest.m2y.net</span>
      </div>
    );
  }
  return (
    <div
      style={{
        padding: '16px 22px',
        background: `linear-gradient(135deg, ${COLORS.bgCardAlt} 0%, ${COLORS.bgCard} 100%)`,
        border: `1.5px solid ${COLORS.gold}`,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        boxShadow: `0 0 22px ${COLORS.goldGlow}`,
      }}
    >
      <div
        style={{
          color: COLORS.textPrimary,
          fontSize: 16,
          fontWeight: 800,
          fontFamily: FONT_FAMILY,
          textAlign: 'center',
        }}
      >
        تابع النتائج والتوقعات داخل منصة دليل الاستثمار
      </div>
      <div
        style={{
          color: COLORS.gold,
          fontSize: 15,
          fontWeight: 700,
          fontFamily: 'monospace',
          direction: 'ltr',
          letterSpacing: 0.5,
        }}
      >
        invest.m2y.net
      </div>
    </div>
  );
}

function Disclaimer({ fontSize = 11 }: { fontSize?: number }) {
  return (
    <div
      style={{
        color: COLORS.textMuted,
        fontSize,
        fontFamily: FONT_FAMILY,
        textAlign: 'center',
        lineHeight: 1.6,
        direction: 'rtl',
        padding: '0 10px',
      }}
    >
      ⚠️ تنبيه: النتائج السابقة لا تضمن نتائج مستقبلية. الاستثمار في البورصة ينطوي على مخاطر، والقرار الاستثماري مسؤولية المستخدم.
    </div>
  );
}

function Header() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 4px',
      }}
    >
      <LogoBox size="md" />
      <div
        style={{
          color: COLORS.textSecondary,
          fontSize: 12,
          fontFamily: FONT_FAMILY,
          textAlign: 'left',
        }}
      >
        <div>منصة دليل الاستثمار</div>
        <div style={{ color: COLORS.gold, fontFamily: 'monospace', direction: 'ltr', fontSize: 11 }}>
          invest.m2y.net
        </div>
      </div>
    </div>
  );
}

// ─── 1. Daily Template (1080 × 1350) ─────────────────────────────────────────

export interface DailyResultsTemplateProps {
  data: ReportData;
}

/**
 * DailyResultsTemplate — 1080 × 1350 px (vertical).
 * يستخدم لـ Instagram Stories / Telegram posts.
 */
export function DailyResultsTemplate({ data }: DailyResultsTemplateProps) {
  const { period_start, stats } = data;

  return (
    <div
      dir="rtl"
      style={{
        width: 1080,
        height: 1350,
        background: `radial-gradient(circle at 80% 0%, #131a2e 0%, ${COLORS.bg} 60%)`,
        fontFamily: FONT_FAMILY,
        color: COLORS.textPrimary,
        padding: 36,
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* خلفية شموع شفافة */}
      <div style={{ position: 'absolute', top: 0, right: 0, width: '100%', height: 320, opacity: 0.5, pointerEvents: 'none' }}>
        <CandlestickBackground opacity={0.08} />
      </div>

      {/* Section 1: Header */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        <Header />
      </div>

      {/* Section 2: Hero (Trophy + Title + date) */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          paddingTop: 8,
        }}
      >
        <TrophyIcon size={56} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ArrowUp size={26} />
          <h1
            style={{
              margin: 0,
              fontSize: 52,
              fontWeight: 800,
              color: COLORS.textPrimary,
              letterSpacing: '-1px',
              fontFamily: FONT_FAMILY,
              textShadow: `0 0 30px ${COLORS.positiveGlow}`,
            }}
          >
            نتائج صفقات اليوم
          </h1>
          <ArrowUp size={26} />
        </div>
        <div
          style={{
            color: COLORS.gold,
            fontSize: 18,
            fontWeight: 600,
            fontFamily: FONT_FAMILY,
          }}
        >
          بعد إغلاق السوق
        </div>
        <div
          style={{
            color: COLORS.textSecondary,
            fontSize: 16,
            fontFamily: FONT_FAMILY,
          }}
        >
          {fmtDate(period_start)}
        </div>
      </div>

      {/* Empty state OR KPI + Table */}
      {!stats ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <EmptyState message="لا توجد نتائج مؤهلة لهذه الفترة" />
        </div>
      ) : (
        <>
          {/* Section 4: KPI Cards (2×2 grid) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 14,
              position: 'relative',
              zIndex: 2,
            }}
          >
            <KpiCard
              icon="🏆"
              label="عدد الصفقات الناجحة"
              value={String(stats.winning_closed)}
              sublabel={`من إجمالي ${stats.total_closed} صفقة مغلقة`}
              accent="gold"
            />
            <KpiCard
              icon="🎯"
              label="نسبة النجاح"
              value={fmt(stats.success_rate, 1) + '%'}
              sublabel={stats.success_rate >= 60 ? 'أداء ممتاز' : 'أداء جيد'}
              accent="emerald"
            />
            <KpiCard
              icon="📈"
              label="متوسط الصعود"
              value={fmtPct(stats.average_return)}
              sublabel="متوسط العائد المحقق"
              accent="emerald"
            />
            <KpiCard
              icon="📊"
              label="إجمالي الحركة السعرية"
              value={fmtPct(stats.total_price_movement)}
              sublabel="مجموع التحركات الموجبة"
              accent="cyan"
            />
          </div>

          {/* Section 5: Top Trades Table */}
          <div
            style={{
              background: COLORS.bgCard,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 14,
              padding: 16,
              position: 'relative',
              zIndex: 2,
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: COLORS.gold,
                fontSize: 16,
                fontWeight: 700,
                fontFamily: FONT_FAMILY,
              }}
            >
              <span>⭐</span>
              <span>الصفقات الرابحة</span>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <TradeTable trades={stats.top_trades.slice(0, 8)} />
            </div>
          </div>
        </>
      )}

      {/* Section 6: CTA */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        <CTASection variant="card" />
      </div>

      {/* Section 7: Footer / Disclaimer */}
      <Disclaimer fontSize={11} />
    </div>
  );
}

// ─── 2. Weekly Template (1200 × 628) ─────────────────────────────────────────

export interface WeeklyResultsTemplateProps {
  data: ReportData;
}

/**
 * WeeklyResultsTemplate — 1200 × 628 px (landscape).
 * يستخدم لـ Twitter / Facebook / LinkedIn / Website banners.
 * تخطيط: left=logo+title | middle=4 KPI cards في صف | right=top 3-5 trades
 */
export function WeeklyResultsTemplate({ data }: WeeklyResultsTemplateProps) {
  const { period_start, period_end, stats } = data;
  const periodRange = `${fmtDate(period_start, { day: 'numeric', month: 'short' })} → ${fmtDate(period_end, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div
      dir="rtl"
      style={{
        width: 1200,
        height: 628,
        background: `linear-gradient(110deg, ${COLORS.bg} 0%, #0d1325 50%, ${COLORS.bg} 100%)`,
        fontFamily: FONT_FAMILY,
        color: COLORS.textPrimary,
        padding: 24,
        display: 'grid',
        gridTemplateColumns: '300px 1fr 360px',
        gap: 18,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* خلفية شموع */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.35, pointerEvents: 'none' }}>
        <CandlestickBackground opacity={0.06} />
      </div>

      {/* LEFT: Logo + Title + Period */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '8px 4px',
        }}
      >
        <LogoBox size="md" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TrophyIcon size={36} />
            <ArrowUp size={22} />
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 36,
              fontWeight: 800,
              color: COLORS.textPrimary,
              letterSpacing: '-0.5px',
              fontFamily: FONT_FAMILY,
              lineHeight: 1.15,
              textShadow: `0 0 24px ${COLORS.positiveGlow}`,
            }}
          >
            نتائج صفقات الأسبوع
          </h1>
          <div style={{ color: COLORS.gold, fontSize: 14, fontWeight: 600, fontFamily: FONT_FAMILY }}>
            بعد إغلاق السوق
          </div>
          <div
            style={{
              display: 'inline-block',
              padding: '5px 12px',
              background: COLORS.bgCard,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              color: COLORS.textSecondary,
              fontSize: 12,
              fontFamily: 'monospace',
              direction: 'ltr',
              alignSelf: 'flex-start',
            }}
          >
            {periodRange}
          </div>
        </div>
        <Disclaimer fontSize={9} />
      </div>

      {/* MIDDLE: KPI Cards (vertical 4 cards) */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'grid',
          gridTemplateRows: '1fr 1fr 1fr 1fr',
          gap: 10,
        }}
      >
        {stats ? (
          <>
            <KpiCard
              icon="🏆"
              label="عدد الصفقات الناجحة"
              value={String(stats.winning_closed)}
              sublabel={`من ${stats.total_closed} مغلقة`}
              accent="gold"
              size="sm"
            />
            <KpiCard
              icon="🎯"
              label="نسبة النجاح"
              value={fmt(stats.success_rate, 1) + '%'}
              accent="emerald"
              size="sm"
            />
            <KpiCard
              icon="📈"
              label="متوسط الصعود"
              value={fmtPct(stats.average_return)}
              accent="emerald"
              size="sm"
            />
            <KpiCard
              icon="📊"
              label="إجمالي الحركة السعرية"
              value={fmtPct(stats.total_price_movement)}
              accent="cyan"
              size="sm"
            />
          </>
        ) : (
          <div style={{ gridColumn: '1 / -1' }}>
            <EmptyState message="لا توجد نتائج مؤهلة لهذا الأسبوع" />
          </div>
        )}
      </div>

      {/* RIGHT: Top 3-5 trades + CTA */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: 14,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              color: COLORS.gold,
              fontSize: 13,
              fontWeight: 700,
              fontFamily: FONT_FAMILY,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>⭐</span>
            <span>أبرز الصفقات الرابحة</span>
          </div>
          {stats ? (
            <TradeTable trades={stats.top_trades.slice(0, 5)} compact />
          ) : (
            <div
              style={{
                color: COLORS.textMuted,
                fontSize: 11,
                textAlign: 'center',
                padding: 30,
                fontFamily: FONT_FAMILY,
              }}
            >
              لا توجد صفقات
            </div>
          )}
        </div>

        {/* CTA — inline compact */}
        <a
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px 16px',
            background: `linear-gradient(135deg, ${COLORS.gold} 0%, #d97706 100%)`,
            color: '#1a0f00',
            fontSize: 13,
            fontWeight: 800,
            borderRadius: 10,
            fontFamily: FONT_FAMILY,
            textDecoration: 'none',
            boxShadow: `0 0 16px ${COLORS.goldGlow}`,
          }}
        >
          تابع النتائج على invest.m2y.net
        </a>
      </div>
    </div>
  );
}

// ─── 3. Monthly Template (1080 × 1080) ──────────────────────────────────────

export interface MonthlyResultsTemplateProps {
  data: ReportData;
}

/**
 * MonthlyResultsTemplate — 1080 × 1080 px (square).
 * التقرير الشهري الأبرز — تtsxكيز أكبر على الأرقام والذهبي.
 * يستخدم لـ Instagram posts / LinkedIn / Website spotlight.
 */
export function MonthlyResultsTemplate({ data }: MonthlyResultsTemplateProps) {
  const { period_start, stats } = data;
  const monthLabel = (() => {
    try {
      const d = new Date(period_start);
      if (Number.isNaN(d.getTime())) return period_start;
      return d.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
    } catch {
      return period_start;
    }
  })();

  return (
    <div
      dir="rtl"
      style={{
        width: 1080,
        height: 1080,
        background: `radial-gradient(circle at 50% 0%, #1a2238 0%, ${COLORS.bg} 65%)`,
        fontFamily: FONT_FAMILY,
        color: COLORS.textPrimary,
        padding: 44,
        display: 'flex',
        flexDirection: 'column',
        gap: 26,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* خلفية شموع على الجانبين */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 280, opacity: 0.4, pointerEvents: 'none' }}>
        <CandlestickBackground opacity={0.07} />
      </div>

      {/* Section 1: Header */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        <Header />
      </div>

      {/* Section 2: Hero — centered, premium feel */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          paddingTop: 6,
        }}
      >
        <TrophyIcon size={64} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <ArrowUp size={30} />
          <h1
            style={{
              margin: 0,
              fontSize: 58,
              fontWeight: 800,
              color: COLORS.textPrimary,
              letterSpacing: '-1px',
              fontFamily: FONT_FAMILY,
              textShadow: `0 0 32px ${COLORS.goldGlow}`,
            }}
          >
            نتائج صفقات الشهر
          </h1>
          <ArrowUp size={30} />
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <div style={{ color: COLORS.gold, fontSize: 18, fontWeight: 700, fontFamily: FONT_FAMILY }}>
            بعد إغلاق السوق — {monthLabel}
          </div>
        </div>
      </div>

      {/* Empty OR KPI + Table */}
      {!stats ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <EmptyState message="لا توجد نتائج مؤهلة لهذا الشهر" />
        </div>
      ) : (
        <>
          {/* Section 4: KPI Cards (2×2 grid — bigger) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
              position: 'relative',
              zIndex: 2,
            }}
          >
            <KpiCard
              icon="🏆"
              label="عدد الصفقات الناجحة"
              value={String(stats.winning_closed)}
              sublabel={`من إجمالي ${stats.total_closed} صفقة مغلقة`}
              accent="gold"
              size="lg"
            />
            <KpiCard
              icon="🎯"
              label="نسبة النجاح"
              value={fmt(stats.success_rate, 1) + '%'}
              sublabel={stats.success_rate >= 60 ? 'أداء ممتاز' : 'أداء جيد'}
              accent="emerald"
              size="lg"
            />
            <KpiCard
              icon="📈"
              label="متوسط الصعود"
              value={fmtPct(stats.average_return)}
              sublabel="متوسط العائد المحقق"
              accent="emerald"
              size="lg"
            />
            <KpiCard
              icon="📊"
              label="إجمالي الحركة السعرية"
              value={fmtPct(stats.total_price_movement)}
              sublabel="مجموع التحركات الموجبة"
              accent="cyan"
              size="lg"
            />
          </div>

          {/* Section 5: Top 5 trades — gold accent */}
          <div
            style={{
              background: `linear-gradient(160deg, ${COLORS.bgCard} 0%, ${COLORS.bgCardAlt} 100%)`,
              border: `1.5px solid ${COLORS.gold}55`,
              borderRadius: 14,
              padding: 18,
              position: 'relative',
              zIndex: 2,
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              boxShadow: `0 0 24px ${COLORS.goldGlow}, inset 0 1px 0 rgba(255,255,255,0.04)`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: `1px solid ${COLORS.gold}33`,
                paddingBottom: 8,
              }}
            >
              <div
                style={{
                  color: COLORS.gold,
                  fontSize: 18,
                  fontWeight: 800,
                  fontFamily: FONT_FAMILY,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>🏆</span>
                <span>أبرز الصفقات الرابحة هذا الشهر</span>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <TradeTable trades={stats.top_trades.slice(0, 5)} />
            </div>
          </div>
        </>
      )}

      {/* Section 6: CTA — gold button */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <CTASection variant="button" />
      </div>

      {/* Section 7: Disclaimer */}
      <Disclaimer fontSize={11} />
    </div>
  );
}

// ─── Normalizer (resilience — accepts raw API JSON shape) ────────────────────

/**
 * يحوّل الـ JSON الخام من `/api/trade-results` إلى ReportData موحّد.
 * يدعم أسماء الحقول البديلة الشائعة من Data Engine (Task 38-A)
 * بحيث لو المحرك استخدم `actual_close_price` بدل `exit_price`، نشتغل صح.
 *
 * Rule 67 — لا نبتكر أرقام: لو حقل ناقص بنعرضه كـ — أو نستبعد الصفقة.
 */
export function normalizeReportData(raw: unknown): ReportData {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const period = (obj.period === 'daily' || obj.period === 'weekly' || obj.period === 'monthly')
    ? obj.period
    : 'daily';

  const period_start = typeof obj.period_start === 'string' ? obj.period_start : '';
  const period_end = typeof obj.period_end === 'string' ? obj.period_end : period_start;

  const validationRaw = (obj.validation ?? {}) as Record<string, unknown>;
  const validation = {
    valid: Boolean(validationRaw.valid ?? true),
    errors: Array.isArray(validationRaw.errors) ? validationRaw.errors.map(String) : [],
  };

  const statsRaw = obj.stats as Record<string, unknown> | null;
  const hasQualified = obj.has_qualified_trades !== false; // default true unless explicitly false
  if (!statsRaw || typeof statsRaw !== 'object' || !hasQualified) {
    return { period, period_start, period_end, stats: null, validation };
  }

  const numOr = (v: unknown, fallback = 0): number => {
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : fallback;
  };

  // Task 38-A's engine may also expose `trades` at the top level of the response
  // (in addition to `stats.top_trades`). We prefer stats.top_trades (already
  // sorted DESC by realized return) but fall back to top-level `trades`.
  const tradesRaw = Array.isArray(statsRaw.top_trades) && statsRaw.top_trades.length > 0
    ? statsRaw.top_trades
    : (Array.isArray(obj.trades) ? obj.trades : []);

  const top_trades: TradeResult[] = tradesRaw
    .map((t: unknown) => {
      const tr = (t ?? {}) as Record<string, unknown>;
      // Task 38-A field names: actual_close_price, realized_return_percent, close_date, stock_name
      const exit_price = numOr(
        tr.exit_price ?? tr.actual_close_price ?? tr.close_price ?? tr.exitPrice ?? tr.actual_close,
        NaN,
      );
      const target_price = numOr(tr.target_price ?? tr.targetPrice ?? tr.target, NaN);
      const recommendation_price = numOr(
        tr.recommendation_price ?? tr.entry_price ?? tr.recommendationPrice ?? tr.entryPrice ?? tr.price,
        NaN,
      );
      const realized_return_pct = numOr(
        tr.realized_return_pct ?? tr.realized_return_percent ?? tr.realized_return ?? tr.return_pct ?? tr.returnPct,
        NaN,
      );
      const ticker = typeof tr.ticker === 'string'
        ? tr.ticker
        : (typeof tr.symbol === 'string' ? tr.symbol : '—');
      return {
        ticker,
        name_ar: typeof tr.name_ar === 'string'
          ? tr.name_ar
          : (typeof tr.stock_name === 'string' ? tr.stock_name : undefined),
        recommendation_price,
        target_price,
        exit_price,
        realized_return_pct,
        exit_date: typeof tr.exit_date === 'string'
          ? tr.exit_date
          : (typeof tr.close_date === 'string' ? tr.close_date : (typeof tr.closed_at === 'string' ? tr.closed_at : undefined)),
        exceeded_target:
          typeof tr.exceeded_target === 'boolean'
            ? tr.exceeded_target
            : (typeof tr.target_hit === 'boolean' ? tr.target_hit : undefined),
      };
    })
    .filter((t) => Number.isFinite(t.recommendation_price) || Number.isFinite(t.exit_price));

  const stats: ReportStats = {
    total_closed: numOr(statsRaw.total_closed, 0),
    winning_closed: numOr(statsRaw.winning_closed, 0),
    losing_closed: numOr(statsRaw.losing_closed, 0),
    success_rate: numOr(statsRaw.success_rate, 0),
    average_return: numOr(statsRaw.average_return ?? statsRaw.avg_return, 0),
    total_price_movement: numOr(statsRaw.total_price_movement ?? statsRaw.total_movement, 0),
    top_trades,
  };

  return { period, period_start, period_end, stats, validation };
}

export default MonthlyResultsTemplate;
