'use client';

import React, { forwardRef } from 'react';
import { ImageCardExport } from '@/components/market/ImageCardExport';
import { Trophy, TrendingUp, Calendar, Clock } from 'lucide-react';
import { OFFICIAL_LINKS_BLOCK } from '@/modules/publishing/lib/official-links';

/* ============================================================
   TOP-TRADES-037: Top Monthly Trades Image Card
   ============================================================
   كرت إعلاني احترافي يعرض أفضل 5 صفقات الشهر (بناءً على ROI).
   - Dark Theme + ألوان ذهبية للإطار
   - قابل للتصدير كـ PNG + النشر على تيليجرام
   - يظهر رسالة "لا توجد صفقات رابحة هذا الشهر بعد" لو مفيش بيانات
   ============================================================ */

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

interface TopTradesImageCardProps {
  trades: TopTrade[];
  monthName?: string;
}

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function getCurrentMonthName(): string {
  const month = new Date().getMonth();
  return ARABIC_MONTHS[month] || '';
}

const TopTradesCardInner = forwardRef<HTMLDivElement, { trades: TopTrade[]; monthName: string }>(
  ({ trades, monthName }, ref) => {
    return (
      <div
        ref={ref}
        dir="rtl"
        className="w-[520px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl border-2 border-amber-500/60 shadow-2xl overflow-hidden"
      >
        {/* Header — Golden gradient */}
        <div className="bg-gradient-to-r from-amber-600 via-yellow-500 to-amber-600 p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Trophy className="w-6 h-6 text-slate-900" />
            <h2 className="text-xl font-black text-slate-900">
              أفضل صفقات الشهر
            </h2>
            <Trophy className="w-6 h-6 text-slate-900" />
          </div>
          <p className="text-sm font-bold text-slate-800">
            {monthName} {new Date().getFullYear()}
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
                      {trade.entry_price.toFixed(2)} ← {trade.exit_price.toFixed(2)}
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
                        +{trade.profit_pct.toFixed(1)}%
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

TopTradesCardInner.displayName = 'TopTradesCardInner';

export function TopTradesImageCard({ trades, monthName }: TopTradesImageCardProps) {
  const currentMonth = monthName || getCurrentMonthName();
  const hasData = trades && trades.length > 0;

  // Build telegram caption
  const telegramCaption = hasData
    ? `🏆 أفضل صفقات ${currentMonth} ${new Date().getFullYear()}\n\n` +
      trades.slice(0, 5).map((t, i) =>
        `${i + 1}. ${t.ticker} — +${t.profit_pct.toFixed(1)}% (${t.holding_days} يوم)`
      ).join('\n') +
      `\n\n${OFFICIAL_LINKS_BLOCK.trim()}`
    : `🏆 أفضل صفقات ${currentMonth} — لا توجد صفقات رابحة بعد\n\n${OFFICIAL_LINKS_BLOCK.trim()}`;

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
      {(ref) => <TopTradesCardInner ref={ref} trades={trades || []} monthName={currentMonth} />}
    </ImageCardExport>
  );
}
