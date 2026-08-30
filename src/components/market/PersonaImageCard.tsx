'use client';

import React, { forwardRef, useMemo } from 'react';
import { MARKET_NAMES_AR, MarketType } from '@/lib/store';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PersonaPick {
  ticker: string;
  name?: string;
  name_ar?: string;
  verdict?: string;
  score?: number;
  reason?: string;
  conditions?: string[];
  entry?: number | null;
  target?: number | null;
  stop?: number | null;
  timeframe?: string;
  fair_value?: number | null;
}

export interface PersonaImageCardProps {
  /** رمز السوق الحالي (EGX, TADAWUL, KSE, QSE) */
  market: MarketType;
  /** نوع البرسونا */
  persona: 'investor' | 'gambler';
  /** قائمة الأسهم المختارة (مرتبة حسب score) */
  picks: PersonaPick[];
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

/** لون الـ verdict بناءً على الكلمة */
function getVerdictStyle(verdict: string | undefined) {
  const v = (verdict || '').toLowerCase();
  if (
    v.includes('فرصة') ||
    v.includes('ادخل') ||
    v.includes('قوي') ||
    v.includes('شراء')
  ) {
    return { color: '#16a34a', bg: '#dcfce7' };
  }
  if (v.includes('انتظر')) {
    return { color: '#d97706', bg: '#fef3c7' };
  }
  if (v.includes('ابعد') || v.includes('بيع') || v.includes('تجنب') || v.includes('اخرج')) {
    return { color: '#dc2626', bg: '#fee2e2' };
  }
  return { color: '#78716c', bg: '#f5f5f4' };
}

function getScoreColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * بطاقة "البرسونا" (المستثمر / الصياد) مصممة خصيصاً للتصدير كصورة PNG قابلة للمشاركة.
 *
 * - عرض ثابت 800px
 * - خلفية متدرجة ملونة حسب البرسونا (أزرق للمستثمر / بنفسجي للصياد)
 * - شعار + اسم المنصة + التاريخ في الأعلى
 * - ملخص البرسونا + عدد الفرص + متوسط السكور
 * - قائمة الفرص (حتى 8) مع verdict + score + entry/target/stop
 * - تذييل: دليل الاستثمار | invist.m2y.net + إخلاء مسؤولية
 *
 * المكوّن "غبي" (pure) — كل البيانات تمر عبر الـ props.
 */
export const PersonaImageCard = forwardRef<
  HTMLDivElement,
  PersonaImageCardProps
>(function PersonaImageCard({ market, persona, picks, lastUpdate }, ref) {
  const isInvestor = persona === 'investor';

  // ثيم البرسونا (لا أزرق indigo، بس أزرق عادي للمستثمر وبنفسجي للصياد)
  const theme = isInvestor
    ? {
        emoji: '🏦',
        label: 'المستثمر',
        subtitle: 'فرص طويلة المدى — محرك التصطاد يختار الأسهم اللي تناسبك (6-12 شهر)',
        headerGrad:
          'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 50%, #2563eb 100%)',
        bodyGrad:
          'linear-gradient(135deg, #eff6ff 0%, #dbeafe 50%, #e0e7ff 100%)',
        accent: '#1d4ed8',
        accentDark: '#1e3a8a',
      }
    : {
        emoji: '🎯',
        label: 'المضارب',
        subtitle: 'فرص قصيرة المدى — محرك التصطاد يصطاد الزخم والسيولة (يومي-أسبوعي)',
        headerGrad:
          'linear-gradient(135deg, #6b21a8 0%, #7e22ce 50%, #9333ea 100%)',
        bodyGrad:
          'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #fae8ff 100%)',
        accent: '#7e22ce',
        accentDark: '#6b21a8',
      };

  // حساب الإحصائيات
  const stats = useMemo(() => {
    if (picks.length === 0) {
      return { avgScore: 0, buyCount: 0, holdCount: 0, sellCount: 0, top: [] as PersonaPick[] };
    }
    const avgScore =
      picks.reduce((sum, p) => sum + (p.score || 0), 0) / picks.length;
    const buyCount = picks.filter((p) => {
      const v = (p.verdict || '').toLowerCase();
      return v.includes('فرصة') || v.includes('ادخل') || v.includes('شراء');
    }).length;
    const holdCount = picks.filter((p) =>
      (p.verdict || '').toLowerCase().includes('انتظر'),
    ).length;
    const sellCount = picks.filter((p) => {
      const v = (p.verdict || '').toLowerCase();
      return v.includes('ابعد') || v.includes('بيع') || v.includes('تجنب') || v.includes('اخرج');
    }).length;
    const top = picks.slice(0, 8);
    return { avgScore, buyCount, holdCount, sellCount, top };
  }, [picks]);

  // حساب تاريخ الجلسة القادمة المستهدفة
  const getTargetSessionDate = () => {
    const target = new Date();
    // إذا كان الوقت الحالي بعد الساعة 3:30 مساءً (15:30)، فالتحليل لجلسة الغد
    if (target.getHours() > 15 || (target.getHours() === 15 && target.getMinutes() >= 30)) {
      target.setDate(target.getDate() + 1);
    }
    // ترحيل عطلات نهاية الأسبوع (الجمعة 5 والسبت 6) للبورصة المصرية
    let day = target.getDay();
    if (day === 5) { // الجمعة -> الأحد
      target.setDate(target.getDate() + 2);
    } else if (day === 6) { // السبت -> الأحد
      target.setDate(target.getDate() + 1);
    }
    return target;
  };

  const targetSessionDate = getTargetSessionDate();
  const dateStr = targetSessionDate.toLocaleDateString('ar-EG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = new Date().toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      ref={ref}
      dir="rtl"
      lang="ar"
      style={{
        width: 800,
        maxWidth: 800,
        fontFamily: "'Cairo', 'Tajawal', 'Segoe UI', 'Arial', sans-serif",
        background: theme.bodyGrad,
        color: '#1c1917',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: `0 10px 40px ${theme.accent}33`,
        border: `1px solid ${theme.accent}33`,
      }}
    >
      {/* ============== HEADER ============== */}
      <div
        style={{
          background: theme.headerGrad,
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
              {theme.emoji} {theme.label}
            </span>
            <span style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
              {theme.subtitle}
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
                color: theme.accentDark,
                lineHeight: 1.1,
              }}
            >
              {MARKET_NAMES_AR[market]}
            </span>
            <span style={{ fontSize: 12, color: '#78716c' }}>
              {picks.length} فرصة · {theme.label}
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
          label="متوسط السكور"
          value={stats.avgScore.toFixed(0)}
          valueColor={getScoreColor(stats.avgScore)}
          bg="#ffffff"
        />
        <StatBox
          label="فرص شراء"
          value={String(stats.buyCount)}
          valueColor="#16a34a"
          bg="#dcfce7"
        />
        <StatBox
          label="انتظر"
          value={String(stats.holdCount)}
          valueColor="#d97706"
          bg="#fef3c7"
        />
        <StatBox
          label="بيع"
          value={String(stats.sellCount)}
          valueColor="#dc2626"
          bg="#fee2e2"
        />
      </div>

      {/* ============== PICKS LIST ============== */}
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
              border: `1px solid ${theme.accent}22`,
            }}
          >
            قيد التحليل — البيانات بتتحدث كل دورة تحليل
          </div>
        ) : (
          stats.top.map((p, i) => (
            <PickRow
              key={`p-${p.ticker}-${i}`}
              rank={i + 1}
              pick={p}
              currency={MARKET_CURRENCY[market]}
              accent={theme.accent}
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
          ⚠️ هذه البيانات لأغراض إعلامية فقط ولا تُعد توقع استثمارية. اتخذ
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

function PickRow({
  rank,
  pick,
  currency,
  accent,
}: {
  rank: number;
  pick: PersonaPick;
  currency: string;
  accent: string;
}) {
  const verdictStyle = getVerdictStyle(pick.verdict);
  const score = pick.score ?? 0;
  const scoreColor = getScoreColor(score);
  const targetPct =
    pick.entry && pick.target && pick.entry > 0
      ? ((pick.target - pick.entry) / pick.entry) * 100
      : null;
  const stopPct =
    pick.entry && pick.stop && pick.entry > 0
      ? ((pick.stop - pick.entry) / pick.entry) * 100
      : null;
  const displayName =
    (pick.name_ar || pick.name || '').slice(0, 22) || '—';

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
          background: accent,
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
          {pick.ticker}
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

      {/* Score bar */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 70 }}>
        <span style={{ fontSize: 10, color: '#78716c', marginBottom: 2 }}>السكور</span>
        <div style={{ width: 60, height: 6, borderRadius: 999, background: '#f5f5f4', overflow: 'hidden' }}>
          <div
            style={{
              width: `${Math.min(100, Math.max(0, score))}%`,
              height: '100%',
              background: scoreColor,
            }}
          />
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: scoreColor, marginTop: 2 }}>
          {score.toFixed(0)}/100
        </span>
      </div>

      {/* Verdict */}
      <span
        style={{
          background: verdictStyle.bg,
          color: verdictStyle.color,
          padding: '4px 10px',
          borderRadius: 8,
          fontSize: 11,
          fontWeight: 800,
          minWidth: 64,
          textAlign: 'center',
        }}
      >
        {pick.verdict || 'قيد التحليل'}
      </span>

      {/* Entry / Target / Stop */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        {pick.entry != null && pick.entry > 0 ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#1c1917', fontVariantNumeric: 'tabular-nums' }}>
            {formatNumber(pick.entry)} {currency}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: '#a8a29e' }}>—</span>
        )}
        {targetPct !== null && (
          <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            🎯 {targetPct > 0 ? '+' : ''}{targetPct.toFixed(1)}%
          </span>
        )}
        {stopPct !== null && (
          <span style={{ fontSize: 10, color: '#dc2626', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            🛑 {stopPct.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}
