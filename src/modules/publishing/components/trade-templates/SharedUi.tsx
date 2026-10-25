/**
 * trade-templates/SharedUi.tsx
 * ============================
 * Shared UI building blocks for the TradeResultsTemplates split
 * (Task F-Phase3-FinalPush — split from 1,456 LOC).
 *
 * Exports:
 *   - KpiCard          — stat tile with accent stripe + glow
 *   - BadgeExceededTarget / BadgeProfit — small inline badges
 *   - TradeRow         — single trade table row
 *   - TradeTable       — full trades table (with empty-state)
 *   - EmptyState       — Rule 67 §4: no fabricated numbers
 *   - CTASection       — gold CTA card / button variants
 *   - Disclaimer       — risk disclaimer footer
 *   - Header           — top header (logo + brand)
 *
 * Pure inline-styles (pixel-perfect for html-to-image export — Rule 68).
 */

import React from 'react';
import { COLORS, FONT_FAMILY, type TradeResult } from './types';
import { fmt, fmtPct, isTradeExceedingTarget, isTradeProfitable } from './helpers';
import { LogoBox } from './SharedSvg';

interface KpiCardProps {
  icon: string;
  label: string;
  value: string;
  sublabel?: string;
  accent?: 'emerald' | 'gold' | 'cyan' | 'white';
  size?: 'sm' | 'md' | 'lg';
}

export function KpiCard({ icon, label, value, sublabel, accent = 'emerald', size = 'md' }: KpiCardProps) {
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
export function BadgeExceededTarget() {
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
export function BadgeProfit() {
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

export function TradeRow({ trade, index, compact = false }: TradeRowProps) {
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

export function TradeTable({ trades, compact = false }: { trades: TradeResult[]; compact?: boolean }) {
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
export function EmptyState({ message }: { message: string }) {
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

export function CTASection({ variant = 'card' }: { variant?: 'card' | 'button' }) {
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

export function Disclaimer({ fontSize = 11 }: { fontSize?: number }) {
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

export function Header() {
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
