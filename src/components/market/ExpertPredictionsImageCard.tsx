'use client';

import React, { forwardRef, useMemo } from 'react';
import { MARKET_NAMES_AR, MarketType } from '@/lib/store';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ExpertPick {
  ticker: string;
  name?: string;
  name_ar?: string;
  current_price?: number;
  change_percent?: number;
  volume?: string | number;
  sector?: string;
}

export interface ExpertPredictionsImageCardProps {
  /** رمز السوق الحالي */
  market: MarketType;
  /** قائمة الأسهم (مرتبة حسب السعر) */
  stocks: ExpertPick[];
  /** نص آخر تحديث */
  lastUpdate?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MARKET_FLAGS: Record<MarketType, string> = {
  EGX: '🇪🇬',
  TADAWUL: '🇸🇦',
  KSE: '🇰🇼',
  QSE: '🇶🇦',
  CRYPTO: '🪙',
};

const MARKET_CURRENCY: Record<MarketType, string> = {
  EGX: 'ج.م',
  TADAWUL: 'ريال',
  KSE: 'د.ك',
  QSE: 'ر.ق',
  CRYPTO: '$',
};

function formatNumber(n: number | undefined | null, digits = 2): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * بطاقة "توقعات الخبراء" مصممة خصيصاً للتصدير كصورة PNG قابلة للمشاركة.
 *
 * - عرض ثابت 800px
 * - خلفية متدرجة خضراء/زيتونية (لا أزرق ولا indigo)
 * - شعار + اسم المنصة + التاريخ في الأعلى
 * - ملخص: عدد الأسهم + متوسط التغير + الرابحين + الخاسرين
 * - قائمة الأسهم (حتى 8) مع ticker + name + price + change + sector
 * - تذييل: دليل الاستثمار | invist.m2y.net + إخلاء مسؤولية
 *
 * المكوّن "غبي" (pure) — كل البيانات تمر عبر الـ props.
 */
export const ExpertPredictionsImageCard = forwardRef<
  HTMLDivElement,
  ExpertPredictionsImageCardProps
>(function ExpertPredictionsImageCard(
  { market, stocks, lastUpdate },
  ref,
) {
  // حساب الإحصائيات
  const stats = useMemo(() => {
    if (stocks.length === 0) {
      return { gainers: 0, losers: 0, avgChange: 0, top: [] as ExpertPick[] };
    }
    const gainers = stocks.filter((s) => (s.change_percent || 0) > 0).length;
    const losers = stocks.filter((s) => (s.change_percent || 0) < 0).length;
    const totalChange = stocks.reduce(
      (sum, s) => sum + (s.change_percent || 0),
      0,
    );
    const avgChange = totalChange / stocks.length;
    const top = stocks.slice(0, 8);
    return { gainers, losers, avgChange, top };
  }, [stocks]);

  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-EG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // ألوان ثابتة بأسلوب inline styles
  const accent = '#15803d';
  const accentDark = '#14532d';

  return (
    <div
      ref={ref}
      dir="rtl"
      lang="ar"
      style={{
        width: 800,
        maxWidth: 800,
        fontFamily: "'Cairo', 'Tajawal', 'Segoe UI', 'Arial', sans-serif",
        background:
          'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 50%, #d1fae5 100%)',
        color: '#1c1917',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 10px 40px rgba(21, 128, 61, 0.18)',
        border: '1px solid #bbf7d0',
      }}
    >
      {/* ============== HEADER ============== */}
      <div
        style={{
          background:
            'linear-gradient(135deg, #14532d 0%, #15803d 50%, #16a34a 100%)',
          padding: '20px 28px',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        {/* يمين: شعار + اسم المنصة */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-square.png"
            alt="شعار دليل الاستثمار"
            width={56}
            height={56}
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: '#fff',
              objectFit: 'contain',
              border: '2px solid rgba(255,255,255,0.4)',
            }}
            crossOrigin="anonymous"
          />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: 22,
                fontWeight: 800,
                lineHeight: 1.1,
                letterSpacing: 0.2,
              }}
            >
              🎯 توقعات الخبراء
            </span>
            <span style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
              قائمة الأسهم المراقبة — أداء اليوم
            </span>
          </div>
        </div>

        {/* يسار: التاريخ + الوقت */}
        <div
          style={{
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 4,
          }}
        >
          <span
            style={{
              background: 'rgba(255,255,255,0.18)',
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            📅 {dateStr}
          </span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>
            🕐 {timeStr}
            {lastUpdate ? ` · آخر تحديث: ${lastUpdate}` : ''}
          </span>
        </div>
      </div>

      {/* ============== MARKET NAME + SUMMARY ============== */}
      <div
        style={{
          padding: '18px 28px 8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 36, lineHeight: 1 }}>
            {MARKET_FLAGS[market]}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: accentDark,
                lineHeight: 1.1,
              }}
            >
              {MARKET_NAMES_AR[market]}
            </span>
            <span style={{ fontSize: 12, color: '#78716c' }}>
              {stocks.length} سهم · توقعات الخبراء
            </span>
          </div>
        </div>
      </div>

      {/* ============== KEY STATS GRID ============== */}
      <div
        style={{
          padding: '8px 28px 18px',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
        }}
      >
        <StatBox
          label="متوسط التغير"
          value={formatPercent(stats.avgChange)}
          valueColor={
            stats.avgChange > 0
              ? '#16a34a'
              : stats.avgChange < 0
                ? '#dc2626'
                : '#78716c'
          }
          bg="#ffffff"
        />
        <StatBox
          label="الرابحة"
          value={String(stats.gainers)}
          valueColor="#16a34a"
          bg="#dcfce7"
        />
        <StatBox
          label="الخاسرة"
          value={String(stats.losers)}
          valueColor="#dc2626"
          bg="#fee2e2"
        />
        <StatBox
          label="إجمالي الأسهم"
          value={String(stocks.length)}
          valueColor={accent}
          bg="#fef3c7"
        />
      </div>

      {/* ============== STOCKS LIST ============== */}
      <div style={{ padding: '0 28px 18px' }}>
        {stats.top.length === 0 ? (
          <div
            style={{
              padding: '24px 10px',
              textAlign: 'center',
              color: '#a8a29e',
              fontSize: 14,
              background: '#ffffff',
              borderRadius: 14,
              border: `1px solid ${accent}22`,
            }}
          >
            لا توجد بيانات متاحة حالياً
          </div>
        ) : (
          stats.top.map((s, i) => (
            <StockRow
              key={`e-${s.ticker}-${i}`}
              rank={i + 1}
              stock={s}
              currency={MARKET_CURRENCY[market]}
            />
          ))
        )}
      </div>

      {/* ============== FOOTER ============== */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1c1917 0%, #292524 100%)',
          color: '#fef3c7',
          padding: '14px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="شعار"
            width={28}
            height={16}
            style={{ height: 16, width: 'auto', opacity: 0.9 }}
            crossOrigin="anonymous"
          />
          <span style={{ fontSize: 13, fontWeight: 700 }}>دليل الاستثمار</span>
          <span style={{ opacity: 0.5 }}>|</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>invist.m2y.net</span>
        </div>
        <span
          style={{
            fontSize: 10,
            opacity: 0.7,
            maxWidth: 460,
            textAlign: 'left',
            lineHeight: 1.4,
          }}
        >
          ⚠️ هذه البيانات لأغراض إعلامية فقط ولا تُعد توصية استثمارية. اتخذ
          قراراتك بناءً على بحثك الخاص.
        </span>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatBox({
  label,
  value,
  valueColor,
  bg,
}: {
  label: string;
  value: string;
  valueColor: string;
  bg: string;
}) {
  return (
    <div
      style={{
        background: bg,
        borderRadius: 12,
        padding: '12px 14px',
        textAlign: 'center',
        border: '1px solid rgba(0,0,0,0.05)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: '#57534e',
          marginBottom: 4,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 800,
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StockRow({
  rank,
  stock,
  currency,
}: {
  rank: number;
  stock: ExpertPick;
  currency: string;
}) {
  const change = stock.change_percent || 0;
  const isUp = change > 0;
  const isDown = change < 0;
  const toneColor = isUp ? '#16a34a' : isDown ? '#dc2626' : '#78716c';
  const toneBg = isUp ? '#f0fdf4' : isDown ? '#fef2f2' : '#f5f5f4';
  const sign = isUp ? '+' : '';
  const displayName =
    (stock.name_ar || stock.name || '').slice(0, 22) || '—';

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 12,
        border: '1px solid rgba(0,0,0,0.06)',
        padding: '10px 12px',
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {/* الرتبة */}
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: toneColor,
          color: '#fff',
          fontSize: 12,
          fontWeight: 800,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {rank}
      </span>

      {/* Ticker + name */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#1c1917', lineHeight: 1.1 }}>
          {stock.ticker}
        </span>
        <span
          style={{
            fontSize: 10,
            color: '#78716c',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 180,
          }}
        >
          {displayName}
        </span>
      </div>

      {/* Sector */}
      {stock.sector && (
        <span
          style={{
            background: '#f5f5f4',
            color: '#57534e',
            padding: '3px 8px',
            borderRadius: 6,
            fontSize: 10,
            fontWeight: 600,
            maxWidth: 100,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {stock.sector}
        </span>
      )}

      {/* Price */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 80 }}>
        <span style={{ fontSize: 10, color: '#78716c' }}>السعر</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#1c1917', fontVariantNumeric: 'tabular-nums' }}>
          {stock.current_price ? formatNumber(stock.current_price) : '—'} {currency}
        </span>
      </div>

      {/* Change */}
      <span
        style={{
          background: toneBg,
          color: toneColor,
          padding: '4px 10px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 800,
          minWidth: 64,
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {sign}
        {change.toFixed(2)}%
      </span>
    </div>
  );
}
