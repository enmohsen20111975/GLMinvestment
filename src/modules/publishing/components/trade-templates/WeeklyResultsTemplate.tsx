/**
 * trade-templates/WeeklyResultsTemplate.tsx
 * =========================================
 * Weekly trade-results template — 1200 × 628 px (landscape).
 * Used for Twitter / Facebook / LinkedIn / website banners.
 *
 * Layout: left=logo+title | middle=4 KPI cards (vertical) | right=top 5 trades + CTA.
 *
 * Extracted from TradeResultsTemplates.tsx (1,456 LOC) in Task F-Phase3-FinalPush.
 */

import React from 'react';
import { COLORS, FONT_FAMILY, type ReportData } from './types';
import { fmt, fmtDate, fmtPct } from './helpers';
import { ArrowUp, CandlestickBackground, LogoBox, TrophyIcon } from './SharedSvg';
import { Disclaimer, EmptyState, KpiCard, TradeTable } from './SharedUi';

export interface WeeklyResultsTemplateProps {
  data: ReportData;
}

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
