'use client';

import React, { forwardRef, useMemo } from 'react';
import { MARKET_NAMES_AR, MarketType } from '@/lib/store';

export interface PredictionPick {
  ticker: string;
  name?: string;
  name_ar?: string;
  current_price?: number;
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  profit_loss_percent?: number;
  status?: string;
  hit_target?: boolean;
  hit_stop_loss?: boolean;
  prediction_date?: string;
  signal?: string | number;
  signal_ar?: string;
  confidence?: number;
  master_score?: number;
  logo_url?: string;
}

export interface PredictionsImageCardProps {
  market: MarketType;
  stocks: PredictionPick[];
  lastUpdate?: string;
  winRate?: number;
  avgPnl?: number;
}

const MARKET_FLAGS: Record<MarketType, string> = {
  EGX: '🇪🇬',
  TADAWUL: '🇸🇦',
  KSE: '🇰🇼',
  QSE: '🇶🇦',
  CRYPTO: '🪙',
};

function formatNumber(n: number | undefined | null, digits = 2): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export const PredictionsImageCard = forwardRef<
  HTMLDivElement,
  PredictionsImageCardProps
>(function PredictionsImageCard({ market, stocks, lastUpdate, winRate, avgPnl, hits: hitsProp }, ref) {
  const stats = useMemo(() => {
    if (stocks.length === 0) {
      return { total: 0, hits: 0, winRate: 0, avgPnl: 0, top: [] as PredictionPick[] };
    }
    const computedHits = hitsProp !== undefined ? hitsProp : stocks.filter((s) => s.status === 'TARGET_HIT' || s.status === 'CLOSED_PROFIT' || s.hit_target || (s.profit_loss_percent != null && s.profit_loss_percent > 0)).length;
    const total = stocks.length;
    const computedWinRate = total > 0 ? (computedHits / total) * 100 : 0;
    
    let pnlSum = 0;
    stocks.forEach((s) => {
      if (s.profit_loss_percent != null) {
        pnlSum += s.profit_loss_percent;
      } else if (s.entry_price && s.current_price && s.entry_price > 0) {
        pnlSum += ((s.current_price - s.entry_price) / s.entry_price) * 100;
      }
    });
    const computedAvgPnl = avgPnl !== undefined ? avgPnl : (total > 0 ? pnlSum / total : 0);
    const top = stocks.slice(0, 50);
    return { total, hits: computedHits, winRate: computedWinRate, avgPnl: computedAvgPnl, top };
  }, [stocks, winRate, avgPnl, hitsProp]);

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

  const accentDark = '#0f766e'; // Teal/emerald theme

  return (
    <div
      ref={ref}
      dir="rtl"
      lang="ar"
      style={{
        width: 850,
        maxWidth: 850,
        fontFamily: "'Cairo', 'Tajawal', 'Segoe UI', 'Arial', sans-serif",
        background:
          'linear-gradient(135deg, #f0fdf4 0%, #e6fffa 50%, #ccfbf1 100%)',
        color: '#1c1917',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 10px 40px rgba(13, 148, 136, 0.18)',
        border: '1px solid #99f6e4',
      }}
    >
      {/* HEADER */}
      <div
        style={{
          background:
            'linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #115e59 100%)',
          padding: '20px 28px',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
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
              🏆 نتائج وتوثيق دقة التحليلات الفنية والمالية
            </span>
            <span style={{ fontSize: 12, opacity: 0.9, marginTop: 3 }}>
              إثبات وتوثيق مباشر لنسب الربح والصفقات المكتملة — {MARKET_NAMES_AR[market]} {MARKET_FLAGS[market]}
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
              background: 'rgba(255,255,255,0.2)',
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: 13,
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

      {/* STATS OVERALL BAR */}
      <div
        style={{
          padding: '16px 28px',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
        }}
      >
        <div
          style={{
            background: '#ffffff',
            borderRadius: 12,
            padding: '12px 14px',
            textAlign: 'center',
            border: '1px solid #ccfbf1',
            boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ fontSize: 11, color: '#57534e', marginBottom: 2, fontWeight: 600 }}>إجمالي الصفقات</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0f766e', lineHeight: 1.1 }}>{stats.total}</div>
        </div>
        <div
          style={{
            background: '#ffffff',
            borderRadius: 12,
            padding: '12px 14px',
            textAlign: 'center',
            border: '1px solid #bbf7d0',
            boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ fontSize: 11, color: '#57534e', marginBottom: 2, fontWeight: 600 }}>حققت الهدف 🎯</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#16a34a', lineHeight: 1.1 }}>{stats.hits}</div>
        </div>
        <div
          style={{
            background: '#ffffff',
            borderRadius: 12,
            padding: '12px 14px',
            textAlign: 'center',
            border: '1px solid #bbf7d0',
            boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ fontSize: 11, color: '#57534e', marginBottom: 2, fontWeight: 600 }}>نسبة الدقة والنجاح</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#15803d', lineHeight: 1.1 }}>
            {stats.winRate.toFixed(0)}%
          </div>
        </div>
        <div
          style={{
            background: stats.avgPnl >= 0 ? '#f0fdf4' : '#fef2f2',
            borderRadius: 12,
            padding: '12px 14px',
            textAlign: 'center',
            border: stats.avgPnl >= 0 ? '1px solid #86efac' : '1px solid #fca5a5',
            boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ fontSize: 11, color: '#57534e', marginBottom: 2, fontWeight: 600 }}>متوسط الربح المحقق</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: stats.avgPnl >= 0 ? '#15803d' : '#b91c1c', lineHeight: 1.1 }}>
            {stats.avgPnl >= 0 ? `+${stats.avgPnl.toFixed(2)}%` : `${stats.avgPnl.toFixed(2)}%`}
          </div>
        </div>
      </div>

      {/* TABLE STOCKS DISPLAY */}
      <div style={{ padding: '0 28px 20px' }}>
        {stats.top.length === 0 ? (
          <div
            style={{
              padding: '24px 10px',
              textAlign: 'center',
              color: '#a8a29e',
              fontSize: 14,
              background: '#ffffff',
              borderRadius: 14,
              border: '1px solid #ccfbf1',
            }}
          >
            لا توجد صفقات متاحة حالياً
          </div>
        ) : (
          <div
            style={{
              background: '#ffffff',
              borderRadius: 14,
              border: '1px solid #ccfbf1',
              overflow: 'hidden',
              boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f0fdf4', color: '#0f766e', borderBottom: '1px solid #ccfbf1', fontWeight: 700 }}>
                  <th style={{ padding: '10px 8px', textAlign: 'center', width: 30 }}>#</th>
                  <th style={{ padding: '10px 10px', textAlign: 'right' }}>السهم</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center' }}>سعر الدخول</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center' }}>الهدف والوقف</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center' }}>السعر الحالي</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center' }}>نسبة الربح / الخسارة</th>
                  <th style={{ padding: '10px 10px', textAlign: 'center' }}>نتيجة الصفقة</th>
                </tr>
              </thead>
              <tbody>
                {stats.top.map((s, i) => {
                  const entryPrice = s.entry_price || s.current_price || 0;
                  const currentPrice = s.current_price || entryPrice;
                  const pnl = s.profit_loss_percent !== undefined && s.profit_loss_percent !== null
                    ? s.profit_loss_percent
                    : entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
                  
                  const isHit = s.status === 'TARGET_HIT' || s.status === 'CLOSED_PROFIT' || s.hit_target || (s.target_price && currentPrice >= s.target_price);
                  const isStopped = s.status === 'STOPPED' || s.status === 'CLOSED_LOSS' || s.hit_stop_loss || (s.stop_loss && currentPrice <= s.stop_loss);

                  return (
                    <tr
                      key={`img-pick-${s.ticker}-${i}`}
                      style={{
                        borderBottom: i < stats.top.length - 1 ? '1px solid #f0fdf4' : 'none',
                        background: isHit ? '#f0fdf4' : '#ffffff',
                      }}
                    >
                      <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700, color: '#78716c' }}>{i + 1}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {s.logo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={s.logo_url} alt={s.ticker} width={22} height={22} style={{ borderRadius: '50%', objectFit: 'contain' }} crossOrigin="anonymous" />
                          ) : null}
                          <div>
                            <div style={{ fontWeight: 800, color: '#1c1917', lineHeight: 1.1 }}>{s.name_ar || s.name || s.ticker}</div>
                            <div style={{ fontSize: 10, color: '#78716c', fontFamily: 'monospace' }}>{s.ticker}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 700 }}>
                        {entryPrice ? `${formatNumber(entryPrice)}` : '—'}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', fontFamily: 'monospace', fontSize: 11 }}>
                        <div style={{ color: '#16a34a', fontWeight: 700 }}>🎯 {s.target_price ? formatNumber(s.target_price) : '—'}</div>
                        <div style={{ color: '#dc2626', fontSize: 10 }}>🛑 {s.stop_loss ? formatNumber(s.stop_loss) : '—'}</div>
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 700 }}>
                        {currentPrice ? `${formatNumber(currentPrice)}` : '—'}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center', fontFamily: 'monospace' }}>
                        <span
                          style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            fontWeight: 800,
                            fontSize: 11,
                            background: pnl > 0 ? '#dcfce7' : pnl < 0 ? '#fee2e2' : '#f5f5f4',
                            color: pnl > 0 ? '#15803d' : pnl < 0 ? '#b91c1c' : '#78716c',
                            border: pnl > 0 ? '1px solid #86efac' : pnl < 0 ? '1px solid #fca5a5' : '1px solid #e7e5e4',
                          }}
                        >
                          {pnl > 0 ? `+${pnl.toFixed(2)}%` : `${pnl.toFixed(2)}%`}
                        </span>
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                        {isHit ? (
                          <span style={{ background: '#16a34a', color: '#ffffff', padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800 }}>
                            🎯 صفقة مكتملة
                          </span>
                        ) : isStopped ? (
                          <span style={{ background: '#dc2626', color: '#ffffff', padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800 }}>
                            🛑 ضربت الوقف
                          </span>
                        ) : (
                          <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800, border: '1px solid #bae6fd' }}>
                            ⏳ صفقة مستمرة
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div
        style={{
          background: 'linear-gradient(135deg, #134e4a 0%, #0f766e 100%)',
          color: '#e6fffa',
          padding: '14px 28px 10px',
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
          <span style={{ fontSize: 13, fontWeight: 700 }}>منصة دليل الاستثمار</span>
          <span style={{ opacity: 0.5 }}>|</span>
          <span style={{ fontSize: 12, opacity: 0.9 }}>invist.m2y.net</span>
        </div>
        <span
          style={{
            fontSize: 10,
            opacity: 0.8,
            maxWidth: 460,
            textAlign: 'left',
            lineHeight: 1.4,
          }}
        >
          ⚠️ نتائج وتوقعات صادرة عن المحرك التحليلي المالي لأغراض الاسترشاد والتتبع التلقائي للنتائج.
        </span>
      </div>

      {/* OFFICIAL LINKS FOOTER */}
      <div
        style={{
          background: 'linear-gradient(135deg, #064e3b 0%, #0f766e 100%)',
          color: '#ffffff',
          padding: '10px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: 11,
          borderTop: '1px solid rgba(255,255,255,0.15)',
          fontWeight: 600,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>🌐 invist.m2y.net</span>
          <span>📱 تطبيق أندرويد: com.egx.investment</span>
          <span>✈️ t.me/Arabian_investment_guide</span>
        </div>
        <span style={{ fontSize: 10, opacity: 0.9, background: 'rgba(255,255,255,0.18)', padding: '2px 8px', borderRadius: 4 }}>
          التقرير الرسمي المعتمد 🌐
        </span>
      </div>
    </div>
  );
});
