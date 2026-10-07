'use client';

import React, { forwardRef, useMemo } from 'react';
import { MARKET_NAMES_AR, MarketType } from '@/lib/store';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MarketStatusStock {
  ticker: string;
  name?: string;
  name_ar?: string;
  current_price?: number;
  change_percent?: number;
  volume?: string | number;
  sector?: string;
}

export interface MarketStatusImageCardProps {
  /** رمز السوق الحالي (EGX, TADAWUL, KSE, QSE) */
  market: MarketType;
  /** قائمة الأسهم (نفس بيانات /api/stocks) */
  stocks: MarketStatusStock[];
  /** نص آخر تحديث */
  lastUpdate?: string;
  /** ارتفاع الصورة عند الصدارة (px) — يضبط أيضاً ارتفاع الشعار */
  logoSize?: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MARKET_FLAGS: Record<MarketType, string> = {
  EGX: '🇪🇬',
  TADAWUL: '🇸🇦',
  KSE: '🇰🇼',
  QSE: '🇶🇦',
  US: '🇺🇸',
  CRYPTO: '🪙',
};

const MARKET_CURRENCY: Record<MarketType, string> = {
  EGX: 'ج.م',
  TADAWUL: 'ريال',
  KSE: 'د.ك',
  QSE: 'ر.ق',
  US: '$',
  CRYPTO: '$',
};

const MARKET_INDEX_LABEL: Record<MarketType, string> = {
  EGX: 'مؤشر EGX30',
  TADAWUL: 'مؤشر تاسي',
  KSE: 'مؤشر السوق الكويتي',
  QSE: 'مؤشر بورصة قطر',
  US: 'مؤشر S&P 500 (SPY)',
  CRYPTO: 'العملات الرقمية',
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

/**
 * تحديد حالة السوق (BULL / BEAR / SIDEWAYS) بناءً على:
 * - متوسط التغير
 * - نسبة الرابحين للخاسرين
 *
 * القواعد:
 * - متوسط >= +0.5% و رابحين > خاسرين → BULL 🐂
 * - متوسط <= -0.5% و خاسرين > رابحين → BEAR 🐻
 * - غير ذلك → SIDEWAYS ➡️
 */
function getRegime(avgChange: number, gainers: number, losers: number) {
  if (avgChange >= 0.5 && gainers >= losers) {
    return {
      label: 'صاعد',
      labelEn: 'BULL',
      emoji: '🐂',
      color: '#16a34a',
      bg: '#dcfce7',
    };
  }
  if (avgChange <= -0.5 && losers >= gainers) {
    return {
      label: 'هابط',
      labelEn: 'BEAR',
      emoji: '🐻',
      color: '#dc2626',
      bg: '#fee2e2',
    };
  }
  return {
    label: 'عرضي',
    labelEn: 'SIDEWAYS',
    emoji: '➡️',
    color: '#d97706',
    bg: '#fef3c7',
  };
}

function getMarketStatus() {
  // السوق المصري: الأحد-الخميس، 10:00-14:30 بتوقيت مصر
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=الأحد, 6=السبت
  const isWorkDay = day >= 0 && day <= 4;
  const isMarketHours = hour >= 10 && hour < 15;
  if (isWorkDay && isMarketHours) {
    return { isOpen: true, status: 'مفتوح', color: '#16a34a', dot: '#22c55e' };
  }
  return { isOpen: false, status: 'مغلق', color: '#dc2626', dot: '#ef4444' };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * بطاقة "حالة السوق" مصممة خصيصاً للتصدير كصورة PNG قابلة للمشاركة.
 *
 * - عرض ثابت 800px
 * - خلفية متدرجة برتقالية/كهرمانية (لا أزرق ولا indigo)
 * - شعار + اسم المنصة + التاريخ في الأعلى
 * - حالة السوق + المتوسط + الرابحين + الخاسرين + حالة السوق (BULL/BEAR/SIDEWAYS)
 * - أعلى 5 رابحين (أخضر) + أعلى 5 خاسرين (أحمر)
 * - تذييل: دليل الاستثمار | invist.m2y.net + إخلاء مسؤولية
 *
 * المكوّن "غبي" (pure) — كل البيانات تمر عبر الـ props.
 */
export const MarketStatusImageCard = forwardRef<
  HTMLDivElement,
  MarketStatusImageCardProps
>(function MarketStatusImageCard(
  { market, stocks, lastUpdate, logoSize = 56 },
  ref,
) {
  // حساب الإحصائيات
  const stats = useMemo(() => {
    const getChg = (s: MarketStatusStock) => {
      const v = (s as any).change_percent ?? (s as any).price_change ?? (s as any).change_value ?? 0;
      return typeof v === 'number' ? v : parseFloat(String(v)) || 0;
    };

    const gainers = stocks.filter((s) => getChg(s) > 0);
    const losers = stocks.filter((s) => getChg(s) < 0);
    const unchanged = stocks.filter((s) => getChg(s) === 0);

    const topGainers = [...stocks]
      .filter((s) => getChg(s) > 0)
      .sort((a, b) => getChg(b) - getChg(a))
      .slice(0, 5);

    const topLosers = [...stocks]
      .filter((s) => getChg(s) < 0)
      .sort((a, b) => getChg(a) - getChg(b))
      .slice(0, 5);

    const totalChange = stocks.reduce(
      (sum, s) => sum + getChg(s),
      0,
    );
    const avgChange = stocks.length > 0 ? totalChange / stocks.length : 0;

    const avgPrice =
      stocks.length > 0
        ? stocks.reduce((sum, s) => sum + (s.current_price || 0), 0) /
          stocks.length
        : 0;

    return {
      gainers: gainers.length,
      losers: losers.length,
      unchanged: unchanged.length,
      topGainers,
      topLosers,
      avgChange,
      avgPrice,
      total: stocks.length,
    };
  }, [stocks]);

  const regime = getRegime(stats.avgChange, stats.gainers, stats.losers);
  const marketStatus = getMarketStatus();
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

  // ألوان ثابتة بأسلوب inline styles عشان html-to-image يلتقطها بدقة
  // (Tailwind classes بتتحل لـ CSS variables قد تواجه مشاكل في الـ snapshot)
  const amberDark = '#92400e';
  const warmGrad =
    'linear-gradient(135deg, #fff7ed 0%, #fef3c7 50%, #ffedd5 100%)';

  return (
    <div
      ref={ref}
      dir="rtl"
      lang="ar"
      style={{
        width: 800,
        maxWidth: 800,
        fontFamily:
          "'Cairo', 'Tajawal', 'Segoe UI', 'Arial', sans-serif",
        background: warmGrad,
        color: '#1c1917',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 10px 40px rgba(234, 88, 12, 0.18)',
        border: '1px solid #fed7aa',
      }}
    >
      {/* ============== HEADER ============== */}
      <div
        style={{
          background:
            'linear-gradient(135deg, #9a3412 0%, #c2410c 50%, #ea580c 100%)',
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
            width={logoSize}
            height={logoSize}
            style={{
              width: logoSize,
              height: logoSize,
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
              دليل الاستثمار
            </span>
            <span
              style={{
                fontSize: 12,
                opacity: 0.85,
                marginTop: 2,
              }}
            >
              منصة التحليلات المالية الذكية
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

      {/* ============== MARKET NAME + STATUS BAR ============== */}
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
                color: amberDark,
                lineHeight: 1.1,
              }}
            >
              {MARKET_NAMES_AR[market]}
            </span>
            <span style={{ fontSize: 12, color: '#78716c' }}>
              {MARKET_INDEX_LABEL[market]} · {stats.total} سهم
            </span>
          </div>
        </div>

        {/* حالة السوق + الحالة (Regime) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              background: marketStatus.color,
              color: '#fff',
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: marketStatus.dot,
                boxShadow: '0 0 8px rgba(255,255,255,0.6)',
              }}
            />
            السوق {marketStatus.status}
          </span>
          <span
            style={{
              background: regime.bg,
              color: regime.color,
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 700,
              border: `1px solid ${regime.color}33`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 14 }}>{regime.emoji}</span>
            {regime.label} · {regime.labelEn}
          </span>
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
          label="الأسهم الرابحة"
          value={String(stats.gainers)}
          valueColor="#16a34a"
          bg="#dcfce7"
        />
        <StatBox
          label="الأسهم الخاسرة"
          value={String(stats.losers)}
          valueColor="#dc2626"
          bg="#fee2e2"
        />
        <StatBox
          label="متوسط السعر"
          value={`${formatNumber(stats.avgPrice)} ${MARKET_CURRENCY[market]}`}
          valueColor="#92400e"
          bg="#fef3c7"
        />
      </div>

      {/* ============== TOP GAINERS / LOSERS ============== */}
      <div
        style={{
          padding: '0 28px 18px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
        }}
      >
        {/* الرابحين */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: 14,
            border: '1px solid #d1fae5',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
              color: '#fff',
              padding: '10px 14px',
              fontSize: 14,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>📈</span>
            <span>أعلى الرابحين</span>
          </div>
          <div style={{ padding: '8px 10px' }}>
            {stats.topGainers.length === 0 ? (
              <EmptyRow text="لا توجد أسهم رابحة اليوم" />
            ) : (
              stats.topGainers.map((s, i) => (
                <StockRow
                  key={`g-${s.ticker}-${i}`}
                  rank={i + 1}
                  ticker={s.ticker}
                  name={s.name_ar || s.name || ''}
                  change={s.change_percent || 0}
                  price={s.current_price}
                  currency={MARKET_CURRENCY[market]}
                  tone="up"
                />
              ))
            )}
          </div>
        </div>

        {/* الخاسرين */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: 14,
            border: '1px solid #fecaca',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
              color: '#fff',
              padding: '10px 14px',
              fontSize: 14,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>📉</span>
            <span>أعلى الخاسرين</span>
          </div>
          <div style={{ padding: '8px 10px' }}>
            {stats.topLosers.length === 0 ? (
              <EmptyRow text="لا توجد أسهم خاسرة اليوم" />
            ) : (
              stats.topLosers.map((s, i) => (
                <StockRow
                  key={`l-${s.ticker}-${i}`}
                  rank={i + 1}
                  ticker={s.ticker}
                  name={s.name_ar || s.name || ''}
                  change={s.change_percent || 0}
                  price={s.current_price}
                  currency={MARKET_CURRENCY[market]}
                  tone="down"
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ============== FOOTER ============== */}
      <div
        style={{
          background:
            'linear-gradient(135deg, #1c1917 0%, #292524 100%)',
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
          <span style={{ fontSize: 13, fontWeight: 700 }}>
            دليل الاستثمار
          </span>
          <span style={{ opacity: 0.5 }}>|</span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>
            invist.m2y.net
          </span>
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
          ⚠️ هذه البيانات لأغراض إعلامية فقط ولا تُعد توقع استثمارية. اتخذ
          قراراتك بناءً على بحثك الخاص.
        </span>
      </div>
    </div>
  );
});

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
  ticker,
  name,
  change,
  price,
  currency,
  tone,
}: {
  rank: number;
  ticker: string;
  name: string;
  change: number;
  price?: number;
  currency: string;
  tone: 'up' | 'down';
}) {
  const isUp = tone === 'up';
  const toneColor = isUp ? '#16a34a' : '#dc2626';
  const toneBg = isUp ? '#f0fdf4' : '#fef2f2';
  const sign = isUp ? '+' : '';
  const displayName = name && name.length > 18 ? `${name.slice(0, 18)}…` : name;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '7px 10px',
        borderRadius: 8,
        marginBottom: 4,
        background: toneBg,
        gap: 8,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: toneColor,
            color: '#fff',
            fontSize: 11,
            fontWeight: 800,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {rank}
        </span>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: '#1c1917',
              lineHeight: 1.1,
            }}
          >
            {ticker}
          </span>
          <span
            style={{
              fontSize: 10,
              color: '#78716c',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 140,
            }}
          >
            {displayName || '—'}
          </span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 2,
        }}
      >
        <span
          style={{
            background: toneColor,
            color: '#fff',
            fontSize: 11,
            fontWeight: 800,
            padding: '3px 8px',
            borderRadius: 6,
            fontVariantNumeric: 'tabular-nums',
            minWidth: 56,
            textAlign: 'center',
          }}
        >
          {sign}
          {change.toFixed(2)}%
        </span>
        {price !== undefined && price > 0 ? (
          <span
            style={{
              fontSize: 10,
              color: '#78716c',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatNumber(price)} {currency}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '14px 10px',
        textAlign: 'center',
        color: '#a8a29e',
        fontSize: 12,
      }}
    >
      {text}
    </div>
  );
}
