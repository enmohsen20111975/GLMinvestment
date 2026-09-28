'use client';

import React, { forwardRef, useEffect, useState } from 'react';
import { ImageCardExport } from '@/components/market/ImageCardExport';
import { Trophy, Medal, Award, TrendingUp, Crown, ChevronUp } from 'lucide-react';
import { OFFICIAL_LINKS_BLOCK } from '@/modules/publishing/lib/official-links';

/* ============================================================
   STOCK-LEAGUE-038: Premier Stock League Image Card
   ============================================================
   كرت "الدوري الممتاز للسوق" — يعرض أفضل 10 أسهم/صفقات في الشهر
   بناءً على أعلى نسبة أرباح. تصميم يحاكي جداول الدوري الرياضي.

   - Dark Theme + ألوان ذهبية (1st) / فضية (2nd) / برونزية (3rd)
   - قابل للتصدير كـ PNG + النشر على تيليجرام
   - يعرض رسالة "الدوري لسه ما ابدأش" لو مفيش بيانات
   ============================================================ */

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
}

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi_annual' | 'yearly';

interface StockLeagueImageCardProps {
  month?: string; // YYYY-MM format (legacy — default: current month)
  period?: ReportPeriod; // REPORTS-HUB-039: dynamic period
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
  } catch {
    return monthStr;
  }
}

/* ─── Rank badge (gold/silver/bronze) ─── */
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
        <Crown className="w-5 h-5 text-slate-900" />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-slate-200 to-slate-400 flex items-center justify-center shadow-lg shadow-slate-400/20">
        <Medal className="w-5 h-5 text-slate-800" />
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-amber-700 to-amber-900 flex items-center justify-center shadow-lg shadow-amber-800/20">
        <Award className="w-5 h-5 text-amber-100" />
      </div>
    );
  }
  return (
    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-slate-700/60 flex items-center justify-center">
      <span className="text-sm font-bold text-slate-300">{rank}</span>
    </div>
  );
}

const LeagueCardInner = forwardRef<HTMLDivElement, { league: LeagueEntry[]; monthName: string; year: number }>(
  ({ league, monthName, year }, ref) => {
    return (
      <div
        ref={ref}
        dir="rtl"
        className="w-[560px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl border-2 border-amber-500/60 shadow-2xl overflow-hidden"
      >
        {/* Header — Golden gradient with trophy */}
        <div className="bg-gradient-to-r from-amber-600 via-yellow-500 to-amber-600 p-5 text-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <Trophy className="w-32 h-32 text-slate-900 mx-auto" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Trophy className="w-7 h-7 text-slate-900" />
              <h2 className="text-2xl font-black text-slate-900">
                الدوري الممتاز للسوق
              </h2>
              <Trophy className="w-7 h-7 text-slate-900" />
            </div>
            <p className="text-sm font-bold text-slate-800">
              Premier Stock League — {monthName} {year}
            </p>
          </div>
        </div>

        {/* Body — League Table */}
        <div className="p-4 bg-slate-900">
          {league.length === 0 ? (
            /* Empty state */
            <div className="py-16 text-center">
              <Trophy className="w-16 h-16 text-slate-700 mx-auto mb-4" />
              <p className="text-slate-400 text-base font-bold mb-1">
                الدوري لسه ما ابدأش
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
                <span className="w-20 text-center">السعر</span>
                <span className="w-16 text-center">المدة</span>
                <span className="w-20 text-left">الصعود</span>
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
                  <div className="w-20 text-center">
                    <p className="text-xs text-slate-300 font-mono">
                      {entry.current_price.toFixed(2)}
                    </p>
                    <p className="text-[8px] text-slate-600">ج.م</p>
                  </div>

                  {/* Holding days */}
                  <div className="w-16 text-center">
                    <p className="text-xs text-slate-400">
                      {entry.holding_days || 0}
                    </p>
                    <p className="text-[8px] text-slate-600">يوم</p>
                  </div>

                  {/* Profit % — the star */}
                  <div className="w-20 text-left">
                    <div className="flex items-center justify-end gap-0.5">
                      <ChevronUp className="w-3.5 h-3.5 text-emerald-400" />
                      <span className={`font-black ${
                        entry.rank === 1 ? 'text-lg text-emerald-400' : 'text-base text-emerald-400'
                      }`}>
                        {entry.profit_pct.toFixed(1)}%
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

export function StockLeagueImageCard({ month, period }: StockLeagueImageCardProps) {
  const [league, setLeague] = useState<LeagueEntry[]>([]);
  const [periodLabel, setPeriodLabel] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const currentMonth = month || new Date().toISOString().substring(0, 7);
  const year = parseInt(currentMonth.split('-')[0], 10) || new Date().getFullYear();
  const usePeriodApi = !!period;

  useEffect(() => {
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
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchLeague();
    return () => { cancelled = true; };
  }, [currentMonth, period, usePeriodApi]);

  const displayLabel = periodLabel || (usePeriodApi
    ? PERIOD_LABELS[period!] || ''
    : getMonthName(currentMonth));

  // Build telegram caption
  const telegramCaption = league.length > 0
    ? `🏆 الدوري ${usePeriodApi ? PERIOD_LABELS[period!] : 'الممتاز'} للسوق — ${displayLabel} ${usePeriodApi ? '' : year}\n\n` +
      league.slice(0, 10).map((e) =>
        `${e.rank}. ${e.ticker} — +${e.profit_pct.toFixed(1)}%`
      ).join('\n') +
      `\n\n${OFFICIAL_LINKS_BLOCK.trim()}`
    : `🏆 الدوري ${usePeriodApi ? PERIOD_LABELS[period!] : 'الممتاز'} للسوق — ${displayLabel} ${usePeriodApi ? '' : year}\nالدوري لسه ما ابدأش — استنى الصفقات!\n\n${OFFICIAL_LINKS_BLOCK.trim()}`;

  if (loading) {
    return (
      <div className="w-[560px] h-[400px] bg-slate-900 rounded-2xl border-2 border-amber-500/30 animate-pulse flex items-center justify-center">
        <Trophy className="w-12 h-12 text-amber-500/50" />
      </div>
    );
  }

  const titleText = usePeriodApi
    ? `الدوري ${PERIOD_LABELS[period!]} للسوق`
    : 'الدوري الممتاز للسوق';

  return (
    <ImageCardExport
      title={titleText}
      description={`أفضل 10 أسهم/صفقات — ${displayLabel} — قابل للنشر على تليجرام`}
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
