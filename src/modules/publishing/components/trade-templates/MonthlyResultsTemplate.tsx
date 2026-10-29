/**
 * trade-templates/MonthlyResultsTemplate.tsx
 * ==========================================
 * Monthly trade-results template — 1080 × 1080 px (square).
 * The flagship monthly report — bigger numbers + gold accents.
 * Used for Instagram posts / LinkedIn / website spotlight.
 *
 * Extracted from TradeResultsTemplates.tsx (1,456 LOC) in Task F-Phase3-FinalPush.
 */

import React from 'react';
import { COLORS, FONT_FAMILY, type ReportData } from './types';
import { fmt, fmtPct } from './helpers';
import { ArrowUp, CandlestickBackground, TrophyIcon } from './SharedSvg';
import { CTASection, Disclaimer, EmptyState, Header, KpiCard, TradeTable } from './SharedUi';

export interface MonthlyResultsTemplateProps {
  data: ReportData;
}

export function MonthlyResultsTemplate({ data }: MonthlyResultsTemplateProps) {
  const { period_start, stats } = data;
  const monthLabel = (() => {
    try {
      const d = new Date(period_start ?? '');
      if (Number.isNaN(d.getTime())) return period_start ?? '';
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
              value={fmt(stats.success_rate ?? 0, 1) + '%'}
              sublabel={(stats.success_rate ?? 0) >= 60 ? 'أداء ممتاز' : 'أداء جيد'}
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
              <TradeTable trades={(stats.top_trades ?? []).slice(0, 5)} />
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

export default MonthlyResultsTemplate;
