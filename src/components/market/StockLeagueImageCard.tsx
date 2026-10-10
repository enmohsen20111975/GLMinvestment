'use client';

import React, { forwardRef, useEffect, useState } from 'react';
import { ImageCardExport } from '@/components/market/ImageCardExport';
import {
  TrendingUp,
  ChevronUp,
  Calendar,
  Clock,
} from 'lucide-react';
import { OFFICIAL_LINKS_BLOCK } from '@/modules/publishing/lib/official-links';

/* ============================================================
   MERGE-LIST-CARDS: Premier Stock League + Top Trades
   ============================================================
   كرت موحّد يعرض LIST (ليس سهم واحد) — يستخدم في:
   1) وضع الدوري (mode='league'): أفضل 10 أسهم/صفقات في الفترة
      بناءً على أعلى نسبة أرباح — تصميم يحاكي جداول الدوري الرياضي
      (يجرّب تلقائياً من /api/predictions/league-report أو monthly-league).
   2) وضع الصفقات (mode='trades'): أفضل 5 صفقات شهرية
      (البيانات تُمرّر مباشرة كـ prop — لا fetch).

   - Dark Theme + ألوان ذهبية (1st) / فضية (2nd) / برونزية (3rd)
   - قابل للتصدير كـ PNG + النشر على تيليجرام
   - يعرض رسالة "الدوري لسه ما ابدأش" / "لا توجد صفقات رابحة" لو مفيش بيانات

   TopTradesImageCard.tsx بقي re-export wrapper رفيع لهذا المكوّن
   مع mode='trades' لأغراض الـ backward compatibility.
   ============================================================ */

/* ─── Shared entry type (covers both modes) ─── */
export interface LeagueEntry {
  rank: number;
  ticker: string;
  name_ar: string;
  profit_pct: number;
  current_price: number;
  exit_price?: number;
  entry_price?: number;
  holding_days?: number;
  signal?: string;
  outcome_date?: string;
  // CHART-LEAGUE-FIX (2026-10-10): تواريخ التوقع والتحقق + المدة بينهم
  // سيدي طلب: إضافة وقت التوقع + وقت الانتهاء + الفترة الزمنية بينهم
  prediction_date?: string;
  // لو outcome_date مش متاح، ممكن نستخدم exit_date كـ fallback
  exit_date?: string;
}

/* ─── TopTrade type — re-exported for backward compat with TopTradesImageCard ─── */
export interface TopTrade {
  ticker: string;
  name_ar: string;
  entry_price: number;
  exit_price: number;
  profit_pct: number;
  holding_days: number;
  signal?: string;
  outcome_date?: string;
}

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi_annual' | 'yearly';

export interface StockLeagueImageCardProps {
  /** Card variant — 'league' (auto-fetch ranked table) or 'trades' (caller-provided trades list). Defaults to 'league'. */
  mode?: 'league' | 'trades';
  /** League mode: YYYY-MM format (legacy — default: current month) */
  month?: string;
  /** League mode: dynamic period (REPORTS-HUB-039) */
  period?: ReportPeriod;
  /** Trades mode: list of top trades to render (caller-provided, no fetch). */
  trades?: TopTrade[];
  /** Trades mode: month name to display in the header (defaults to current month). */
  monthName?: string;
}

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const PERIOD_LABELS: Record<ReportPeriod, string> = {
  daily: 'يومي',
  weekly: 'أسبوعي',
  monthly: 'شهري',
  quarterly: 'ربع سنوي',
  semi_annual: 'نص سنوي',
  yearly: 'سنوي',
};

function getMonthName(monthStr?: string): string {
  if (!monthStr) {
    return ARABIC_MONTHS[new Date().getMonth()] || '';
  }
  try {
    const [, mm] = monthStr.split('-');
    const num = parseInt(mm, 10);
    return ARABIC_MONTHS[num - 1] || monthStr;
  } catch { // silent fallback (safe-by-design)
    return monthStr;
  }
}

function getCurrentMonthName(): string {
  const month = new Date().getMonth();
  return ARABIC_MONTHS[month] || '';
}

/* ─── Rank badge (gold/silver/bronze) — used in league mode ─── */
function RankBadge({ rank }: { rank: number }) {
  // CHART-LEAGUE-FIX (2026-10-10): سيدي طلب شيل الكؤوس → أرقام مبهجة بألوان المكاسب.
  // قبل: Crown/Medal/Award (كؤوس رياضية).
  // بعد: أرقام في دوائر بألوان متدرجة (أخضر/زمردي للـ top 3).
  if (rank === 1) {
    return (
      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/30 ring-2 ring-emerald-300/40">
        <span className="text-sm font-black text-white">1</span>
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-400/20">
        <span className="text-sm font-black text-white">2</span>
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
        <span className="text-sm font-black text-slate-900">3</span>
      </div>
    );
  }
  return (
    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-slate-700/60 flex items-center justify-center">
      <span className="text-sm font-bold text-slate-300">{rank}</span>
    </div>
  );
}

/* ─── League card inner (mode='league') — ranked table with crown/medal/award ─── */
const LeagueCardInner = forwardRef<HTMLDivElement, { league: LeagueEntry[]; monthName: string; year: number }>(
  ({ league, monthName, year }, ref) => {
    return (
      <div
        ref={ref}
        dir="rtl"
        className="w-[560px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl border-2 border-amber-500/60 shadow-2xl overflow-hidden"
      >
        {/* Header — مبهج بألوان المكاسب (أخضر ذهبي) + لوجو المنصة */}
        {/* CHART-LEAGUE-FIX (2026-10-10): سيدي طلب:
            - شيل "الدوري الممتاز للسوق" → "أفضل مكاسب {monthName} {year}"
            - شيل الكؤوس (Trophy) → لوجو المنصة
            - شكل مبهج (دي مكاسب مش خسائر) */}
        <div className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 p-5 text-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <TrendingUp className="w-32 h-32 text-white mx-auto" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-center gap-2 mb-1">
              {/* لوجو المنصة بدل الكؤوس */}
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg ring-2 ring-white/40">
                <span className="text-xl font-black text-slate-900">د</span>
              </div>
              <h2 className="text-2xl font-black text-white">
                أفضل مكاسب {monthName} {year}
              </h2>
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg ring-2 ring-white/40">
                <TrendingUp className="w-5 h-5 text-slate-900" />
              </div>
            </div>
            <p className="text-sm font-bold text-emerald-50">
              Top Gainers — {monthName} {year}
            </p>
          </div>
        </div>

        {/* Body — League Table */}
        <div className="p-4 bg-slate-900">
          {league.length === 0 ? (
            /* Empty state */
            <div className="py-16 text-center">
              <TrendingUp className="w-16 h-16 text-emerald-700 mx-auto mb-4" />
              <p className="text-slate-400 text-base font-bold mb-1">
                المكاسب لسه ما بدأتش
              </p>
              <p className="text-slate-600 text-xs">
                استنى الصفقات — الترتيب هيظهر هنا فور إغلاقها
              </p>
            </div>
          ) : (
            /* League entries */
            <div className="space-y-1.5">
              {/* Table header */}
              <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] text-slate-500 font-medium border-b border-slate-700/50">
                <span className="w-9 text-center">المركز</span>
                <span className="flex-1">السهم</span>
                <span className="w-16 text-center">السعر</span>
                <span className="w-14 text-center">المدة</span>
                <span className="flex-1 text-center">التوقع ← التحقق</span>
                <span className="w-16 text-left">الصعود</span>
              </div>

              {league.map((entry) => (
                <div
                  key={`${entry.ticker}-${entry.rank}`}
                  className={`flex items-center gap-2 p-2 rounded-xl transition-colors ${
                    entry.rank === 1
                      ? 'bg-gradient-to-l from-amber-500/10 to-transparent border border-amber-500/30'
                      : entry.rank === 2
                        ? 'bg-gradient-to-l from-slate-300/5 to-transparent border border-slate-400/20'
                        : entry.rank === 3
                          ? 'bg-gradient-to-l from-amber-700/5 to-transparent border border-amber-700/20'
                          : 'bg-slate-800/40 border border-slate-700/30'
                  }`}
                >
                  {/* Rank badge */}
                  <RankBadge rank={entry.rank} />

                  {/* Ticker + Name */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-mono font-bold text-base ${
                        entry.rank <= 3 ? 'text-white' : 'text-slate-200'
                      }`}>
                        {entry.ticker}
                      </span>
                      {entry.signal === 'BUY' && (
                        <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">
                          شراء
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 truncate">
                      {entry.name_ar || entry.ticker}
                    </p>
                  </div>

                  {/* Current price */}
                  <div className="w-16 text-center">
                    <p className="text-xs text-slate-300 font-mono">
                      {(entry.current_price ?? 0).toFixed(2)}
                    </p>
                    <p className="text-[8px] text-slate-600">ج.م</p>
                  </div>

                  {/* Holding days */}
                  <div className="w-14 text-center">
                    <p className="text-xs text-slate-400">
                      {entry.holding_days || 0}
                    </p>
                    <p className="text-[8px] text-slate-600">يوم</p>
                  </div>

                  {/* CHART-LEAGUE-FIX (2026-10-10): تواريخ التوقع ← التحقق + المدة */}
                  {/* سيدي طلب: إضافة وقت التوقع + وقت الانتهاء + الفترة بينهم */}
                  <div className="flex-1 text-center min-w-0">
                    <p className="text-[9px] text-slate-300 font-mono leading-tight">
                      {(entry.prediction_date || '—').slice(5)}
                      <span className="text-slate-600 mx-0.5">←</span>
                      {(entry.outcome_date || entry.exit_date || '—').slice(5)}
                    </p>
                    <p className="text-[8px] text-emerald-500/80">
                      {entry.holding_days ? `خلال ${entry.holding_days} يوم` : '—'}
                    </p>
                  </div>

                  {/* Profit % — the star (أخضر مبهج) */}
                  <div className="w-16 text-left">
                    <div className="flex items-center justify-end gap-0.5">
                      <ChevronUp className="w-3.5 h-3.5 text-emerald-400" />
                      <span className={`font-black ${
                        entry.rank === 1 ? 'text-lg text-emerald-400' : 'text-base text-emerald-400'
                      }`}>
                        {(entry.profit_pct ?? 0).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer — Branding */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 border-t border-amber-500/20 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <TrendingUp className="w-3 h-3 text-slate-900" />
            </div>
            <span className="text-xs font-bold text-amber-400">
              دليل الاستثمار
            </span>
          </div>
          <a
            href="https://invist.m2y.net"
            className="text-[11px] text-slate-400 hover:text-amber-400 transition-colors"
          >
            invist.m2y.net
          </a>
        </div>

        {/* Disclaimer */}
        <div className="bg-slate-950 px-4 py-1.5 text-center">
          <p className="text-[8px] text-slate-600">
            ⚠️ هذه النتائج فعلية من توقعات المنصة — الأداء السابق لا يضمن المستقبل
          </p>
        </div>
      </div>
    );
  },
);

LeagueCardInner.displayName = 'LeagueCardInner';

/* ─── Trades card inner (mode='trades') — list with entry→exit + holding days ─── */
const TradesCardInner = forwardRef<HTMLDivElement, { trades: TopTrade[]; monthName: string; year: number }>(
  ({ trades, monthName, year }, ref) => {
    return (
      <div
        ref={ref}
        dir="rtl"
        className="w-[520px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl border-2 border-amber-500/60 shadow-2xl overflow-hidden"
      >
        {/* Header — مبهج بألوان المكاسب (أخضر ذهبي) + لوجو المنصة */}
        <div className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg ring-2 ring-white/40">
              <span className="text-lg font-black text-slate-900">د</span>
            </div>
            <h2 className="text-xl font-black text-white">
              أفضل صفقات الشهر
            </h2>
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
          <p className="text-sm font-bold text-emerald-50">
            {monthName} {year}
          </p>
        </div>

        {/* Body */}
        <div className="p-4 bg-slate-900">
          {trades.length === 0 ? (
            /* Empty state */
            <div className="py-12 text-center">
              <Calendar className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm font-medium">
                لا توجد صفقات رابحة هذا الشهر بعد
              </p>
              <p className="text-slate-600 text-xs mt-1">
                تابع التوقعات — النتائج هتظهر هنا فور إغلاق الصفقات
              </p>
            </div>
          ) : (
            /* Trades list */
            <div className="space-y-2">
              {trades.map((trade, idx) => (
                <div
                  key={`${trade.ticker}-${idx}`}
                  className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50 hover:border-amber-500/30 transition-colors"
                >
                  {/* Rank badge */}
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-black text-sm ${
                    idx === 0 ? 'bg-amber-500 text-slate-900' :
                    idx === 1 ? 'bg-slate-400 text-slate-900' :
                    idx === 2 ? 'bg-amber-700 text-amber-100' :
                    'bg-slate-700 text-slate-300'
                  }`}>
                    {idx + 1}
                  </div>

                  {/* Ticker + Name */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-white text-base">
                        {trade.ticker}
                      </span>
                      {trade.signal === 'BUY' && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">
                          شراء
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 truncate">
                      {trade.name_ar || trade.ticker}
                    </p>
                  </div>

                  {/* Entry → Exit */}
                  <div className="text-center flex-shrink-0">
                    <p className="text-[9px] text-slate-500">دخول ← خروج</p>
                    <p className="text-[11px] text-slate-300 font-mono">
                      {(trade.entry_price ?? 0).toFixed(2)} ← {(trade.exit_price ?? 0).toFixed(2)}
                    </p>
                  </div>

                  {/* Holding days */}
                  <div className="text-center flex-shrink-0">
                    <div className="flex items-center gap-0.5 text-slate-500">
                      <Clock className="w-2.5 h-2.5" />
                      <span className="text-[9px]">مدة</span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-medium">
                      {trade.holding_days} يوم
                    </p>
                  </div>

                  {/* Profit % — the star */}
                  <div className="flex-shrink-0 text-left">
                    <div className="flex items-center gap-0.5">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-lg font-black text-emerald-400">
                        +{(trade.profit_pct ?? 0).toFixed(1)}%
                      </span>
                    </div>
                    <p className="text-[9px] text-slate-500">ربح</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer — Branding */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 border-t border-amber-500/20 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <TrendingUp className="w-3 h-3 text-slate-900" />
            </div>
            <span className="text-xs font-bold text-amber-400">
              دليل الاستثمار
            </span>
          </div>
          <a
            href="https://invist.m2y.net"
            className="text-[11px] text-slate-400 hover:text-amber-400 transition-colors"
          >
            invist.m2y.net
          </a>
        </div>

        {/* Disclaimer */}
        <div className="bg-slate-950 px-4 py-1.5 text-center">
          <p className="text-[8px] text-slate-600">
            ⚠️ هذه النتائج فعلية من توقعات المنصة — الأداء السابق لا يضمن المستقبل
          </p>
        </div>
      </div>
    );
  },
);

TradesCardInner.displayName = 'TradesCardInner';

/* ─── Outer component — dispatches between league + trades modes ─── */
export function StockLeagueImageCard({
  mode = 'league',
  month,
  period,
  trades,
  monthName,
}: StockLeagueImageCardProps) {
  const [league, setLeague] = useState<LeagueEntry[]>([]);
  const [periodLabel, setPeriodLabel] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const isTradesMode = mode === 'trades';
  const currentMonth = month || new Date().toISOString().substring(0, 7);
  const year = parseInt(currentMonth.split('-')[0], 10) || new Date().getFullYear();
  const usePeriodApi = !!period;

  // Trades-mode derived values (no fetch)
  const tradesList = trades || [];
  const tradesMonthName = monthName || getCurrentMonthName();
  const tradesHasData = tradesList.length > 0;

  useEffect(() => {
    // No fetch in trades mode — data is caller-provided.
    if (isTradesMode) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function fetchLeague() {
      try {
        // REPORTS-HUB-039: لو period موجود → استخدم league-report endpoint
        // غير كده → استخدم monthly-league endpoint (legacy)
        const url = usePeriodApi
          ? `/api/predictions/league-report?period=${period}`
          : `/api/predictions/monthly-league?month=${currentMonth}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!cancelled && data.success) {
          setLeague(data.league || []);
          if (usePeriodApi) {
            setPeriodLabel(data.period_label || PERIOD_LABELS[period!] || '');
          } else {
            setPeriodLabel(data.month_name || getMonthName(currentMonth));
          }
        }
      } catch { // silent fallback (safe-by-design)
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchLeague();
    return () => { cancelled = true; };
  }, [currentMonth, period, usePeriodApi, isTradesMode]);

  /* ─── Trades mode ─── */
  if (isTradesMode) {
    const telegramCaption = tradesHasData
      ? `🏆 أفضل صفقات ${tradesMonthName} ${year}\n\n` +
        tradesList.slice(0, 5).map((t, i) =>
          `${i + 1}. ${t.ticker} — +${(t.profit_pct ?? 0).toFixed(1)}% (${t.holding_days ?? 0} يوم)`
        ).join('\n') +
        `\n\n${OFFICIAL_LINKS_BLOCK.trim()}`
      : `🏆 أفضل صفقات ${tradesMonthName} ${year} — لا توجد صفقات رابحة بعد\n\n${OFFICIAL_LINKS_BLOCK.trim()}`;

    return (
      <ImageCardExport
        title="أفضل صفقات الشهر"
        description="كرت إعلاني قابل للمشاركة — أفضل 5 صفقات بناءً على ROI"
        filename={`top-trades-${new Date().toISOString().split('T')[0]}`}
        telegramCaption={telegramCaption}
        telegramMarket="EGX"
        accentColor="#f59e0b"
        borderClass="border-amber-200"
        bgClass="bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-100/40"
        hasData={true}
        emptyHint=""
      >
        {(ref) => <TradesCardInner ref={ref} trades={tradesList} monthName={tradesMonthName} year={year} />}
      </ImageCardExport>
    );
  }

  /* ─── League mode (default) ─── */
  const displayLabel = periodLabel || (usePeriodApi
    ? PERIOD_LABELS[period!] || ''
    : getMonthName(currentMonth));

  // Build telegram caption
  // CHART-LEAGUE-FIX: شيلنا 🏆 + "الدوري الممتاز" → 📈 + "أفضل مكاسب"
  const telegramCaption = league.length > 0
    ? `📈 أفضل مكاسب ${displayLabel} ${usePeriodApi ? '' : year}\n\n` +
      league.slice(0, 10).map((e) =>
        `${e.rank}. ${e.ticker} — +${(e.profit_pct ?? 0).toFixed(1)}%`
      ).join('\n') +
      `\n\n${OFFICIAL_LINKS_BLOCK.trim()}`
    : `📈 أفضل مكاسب ${displayLabel} ${usePeriodApi ? '' : year}\nالمكاسب لسه ما بدأتش — استنى الصفقات!\n\n${OFFICIAL_LINKS_BLOCK.trim()}`;

  if (loading) {
    return (
      <div className="w-[560px] h-[400px] bg-slate-900 rounded-2xl border-2 border-emerald-500/30 animate-pulse flex items-center justify-center">
        <TrendingUp className="w-12 h-12 text-emerald-500/50" />
      </div>
    );
  }

  // CHART-LEAGUE-FIX: شيل "الدوري الممتاز للسوق" → "أفضل مكاسب"
  const titleText = usePeriodApi
    ? `أفضل مكاسب ${PERIOD_LABELS[period!]}`
    : 'أفضل مكاسب الشهر';

  return (
    <ImageCardExport
      title={titleText}
      description={`أفضل 10 أسهم/صفقات — ${displayLabel} — قابل للنشر على تيليجرام`}
      filename={`stock-league-${usePeriodApi ? period : currentMonth}`}
      telegramCaption={telegramCaption}
      telegramMarket="EGX"
      accentColor="#f59e0b"
      borderClass="border-amber-200"
      bgClass="bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-100/40"
      hasData={true}
      emptyHint=""
    >
      {(ref) => <LeagueCardInner ref={ref} league={league} monthName={displayLabel} year={year} />}
    </ImageCardExport>
  );
}

export default StockLeagueImageCard;
