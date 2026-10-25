/**
 * trade-templates/DailyResultsTemplate.tsx
 * ========================================
 * Daily trade-results template — 1080 × 1350 px (vertical).
 * Used for Instagram Stories / Telegram posts.
 *
 * Extracted from TradeResultsTemplates.tsx (1,456 LOC) in Task F-Phase3-FinalPush.
 * Pure React + inline styles (pixel-perfect for html-to-image export — Rule 68).
 */

import React from 'react';
import { COLORS, FONT_FAMILY, type ReportData } from './types';
import { fmt, fmtDate, fmtPct } from './helpers';
import { ArrowUp, CandlestickBackground, TrophyIcon } from './SharedSvg';
import { CTASection, Disclaimer, EmptyState, Header, KpiCard, TradeTable } from './SharedUi';

export interface DailyResultsTemplateProps {
  data: ReportData;
}

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
