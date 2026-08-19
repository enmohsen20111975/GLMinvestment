'use client';

import React, { forwardRef, useMemo } from 'react';
import { MARKET_NAMES_AR, MarketType } from '@/lib/store';
import { OFFICIAL_LINKS_BLOCK } from '@/lib/official-links';

export interface DailyReportImageCardProps {
  market: MarketType;
  summary?: {
    total_stocks?: number;
    gainers?: number;
    losers?: number;
    unchanged?: number;
    egx30_stocks?: number;
    egx70_stocks?: number;
    egx100_stocks?: number;
    egx30_value?: number;
  };
  indices?: Array<{
    name_ar?: string;
    name?: string;
    value?: number;
    change_percent?: number;
    change?: number;
  }>;
  top_gainers?: Array<{
    ticker?: string;
    name_ar?: string;
    name?: string;
    current_price?: number;
    change_percent?: number;
    price_change?: number;
    volume?: string | number;
  }>;
  top_losers?: Array<{
    ticker?: string;
    name_ar?: string;
    name?: string;
    current_price?: number;
    change_percent?: number;
    price_change?: number;
    volume?: string | number;
  }>;
  insights?: {
    market_sentiment?: string;
    market_score?: number;
    market_breadth?: number;
    avg_change_percent?: number;
    volatility_index?: number;
    gainers_count?: number;
    losers_count?: number;
    unchanged_count?: number;
    decision?: string;
    risk_assessment?: string;
  };
  lastUpdate?: string;
}

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

function getChg(s: any): number {
  const v = s.change_percent ?? s.price_change ?? s.change_value ?? 0;
  return typeof v === 'number' ? v : parseFloat(String(v)) || 0;
}

export const DailyReportImageCard = forwardRef<
  HTMLDivElement,
  DailyReportImageCardProps
>(function DailyReportImageCard(
  { market, summary, indices, top_gainers, top_losers, insights, lastUpdate },
  ref,
) {
  const stats = useMemo(() => {
    const gainers = [...(top_gainers || [])].filter((s) => getChg(s) > 0);
    const losers = [...(top_losers || [])].filter((s) => getChg(s) < 0);
    const topGainers = [...(top_gainers || [])]
      .filter((s) => getChg(s) > 0)
      .sort((a, b) => getChg(b) - getChg(a))
      .slice(0, 5);
    const topLosers = [...(top_losers || [])]
      .filter((s) => getChg(s) < 0)
      .sort((a, b) => getChg(a) - getChg(b))
      .slice(0, 5);

    const total = summary?.total_stocks || 0;
    const gainersCount = summary?.gainers ?? gainers.length;
    const losersCount = summary?.losers ?? losers.length;
    const unchanged = summary?.unchanged || 0;

    const changes = [...(top_gainers || []), ...(top_losers || [])]
      .map((s) => getChg(s));
    const avgChange = changes.length > 0
      ? changes.reduce((sum, c) => sum + c, 0) / changes.length
      : 0;

    return {
      total,
      gainers: gainersCount,
      losers: losersCount,
      unchanged,
      topGainers,
      topLosers,
      avgChange,
    };
  }, [summary, top_gainers, top_losers]);

  const regime = useMemo(() => {
    const avg = stats.avgChange;
    if (avg >= 0.5 && stats.gainers >= stats.losers) {
      return { label: 'صاعد', labelEn: 'BULL', emoji: '🐂', color: '#16a34a', bg: '#dcfce7' };
    }
    if (avg <= -0.5 && stats.losers >= stats.gainers) {
      return { label: 'هابط', labelEn: 'BEAR', emoji: '🐻', color: '#dc2626', bg: '#fee2e2' };
    }
    return { label: 'عرضي', labelEn: 'SIDEWAYS', emoji: '➡️', color: '#d97706', bg: '#fef3c7' };
  }, [stats]);

  const sentiment = insights?.market_sentiment || 'neutral';
  const sentimentLabel =
    sentiment === 'bullish' ? 'إيجابي' : sentiment === 'bearish' ? 'سلبي' : 'محايد';
  const sentimentColor =
    sentiment === 'bullish' ? '#16a34a' : sentiment === 'bearish' ? '#dc2626' : '#d97706';

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

  return (
    <div
      ref={ref}
      dir="rtl"
      lang="ar"
      style={{
        width: 820,
        maxWidth: 820,
        fontFamily: "'Cairo', 'Tajawal', 'Segoe UI', 'Arial', sans-serif",
        background: 'linear-gradient(135deg, #f0fdf4 0%, #e6fffa 50%, #ccfbf1 100%)',
        color: '#1c1917',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 10px 40px rgba(13, 148, 136, 0.18)',
        border: '1px solid #99f6e4',
      }}
    >
      {/* ============== HEADER ============== */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #115e59 100%)',
          padding: '20px 28px',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
            <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1, letterSpacing: 0.2 }}>
              📊 تقرير السوق اليومي
            </span>
            <span style={{ fontSize: 12, opacity: 0.9, marginTop: 3 }}>
              {MARKET_NAMES_AR[market]} · {stats.total} سهم
            </span>
          </div>
        </div>

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
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            📅 {dateStr}
          </span>
          <span style={{ fontSize: 11, opacity: 0.85 }}>
            🕐 {timeStr}
            {lastUpdate ? ` · آخر تحديث: ${lastUpdate}` : ''}
          </span>
        </div>
      </div>

      {/* ============== STATS BAR ============== */}
      <div
        style={{
          padding: '16px 28px',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
        }}
      >
        <StatBox
          label="إجمالي الأسهم"
          value={String(stats.total)}
          valueColor="#0f766e"
          bg="#ffffff"
        />
        <StatBox
          label="الرابحة"
          value={String(stats.gainers)}
          valueColor="#16a34a"
          bg="#f0fdf4"
        />
        <StatBox
          label="الخاسرة"
          value={String(stats.losers)}
          valueColor="#dc2626"
          bg="#fef2f2"
        />
        <StatBox
          label="بدون تغيير"
          value={String(stats.unchanged)}
          valueColor="#d97706"
          bg="#fffbeb"
        />
      </div>

      {/* ============== MARKET SENTIMENT ============== */}
      {insights && (
        <div
          style={{
            padding: '0 28px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 12,
              background: sentimentColor + '15',
              border: `1px solid ${sentimentColor}33`,
            }}
          >
            <span style={{ fontSize: 16 }}>🧠</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: sentimentColor }}>
              مشاعر السوق: {sentimentLabel}
            </span>
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 12,
              background: regime.bg,
              border: `1px solid ${regime.color}33`,
            }}
          >
            <span style={{ fontSize: 16 }}>{regime.emoji}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: regime.color }}>
              {regime.label} · {regime.labelEn}
            </span>
          </div>
        </div>
      )}

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
                  ticker={s.ticker || '—'}
                  name={s.name_ar || s.name || '—'}
                  change={getChg(s)}
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
                  ticker={s.ticker || '—'}
                  name={s.name_ar || s.name || '—'}
                  change={getChg(s)}
                  price={s.current_price}
                  currency={MARKET_CURRENCY[market]}
                  tone="down"
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ============== INDICES ============== */}
      {indices && indices.length > 0 && (
        <div
          style={{
            padding: '0 28px 18px',
            background: '#ffffff',
            margin: '0 28px 18px',
            borderRadius: 14,
            border: '1px solid #e5e7eb',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
              color: '#fff',
              padding: '10px 14px',
              fontSize: 14,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>📊</span>
            <span>أداء المؤشرات</span>
          </div>
          <div style={{ padding: '10px 12px' }}>
            {indices.slice(0, 6).map((idx, i) => {
              const chg = idx.change_percent ?? idx.change ?? 0;
              const isUp = chg >= 0;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    borderRadius: 8,
                    marginBottom: 4,
                    background: '#f8fafc',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', flex: 1 }}>
                    {idx.name_ar || idx.name || '—'}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: isUp ? '#16a34a' : '#dc2626',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatNumber(idx.value)} {MARKET_CURRENCY[market]}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: 6,
                      background: isUp ? '#dcfce7' : '#fee2e2',
                      color: isUp ? '#16a34a' : '#dc2626',
                      minWidth: 64,
                      textAlign: 'center',
                    }}
                  >
                    {isUp ? '+' : ''}{formatPercent(chg)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============== FOOTER ============== */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1c1917 0%, #292524 100%)',
          color: '#fef3c7',
          padding: '18px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
              maxWidth: 480,
              textAlign: 'left',
              lineHeight: 1.5,
            }}
          >
            ⚠️ هذه البيانات لأغراض إعلامية فقط ولا تُعد توصية استثمارية. اتخذ قراراتك بناءً على بحثك الخاص.
          </span>
        </div>
        <div
          style={{
            fontSize: 10,
            opacity: 0.85,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            textAlign: 'left',
          }}
        >
          {OFFICIAL_LINKS_BLOCK.trim()}
        </div>
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

  const changeStr = change > 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;

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
          {changeStr}
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
