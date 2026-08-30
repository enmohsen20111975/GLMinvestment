'use client';

import React, { useState, useEffect } from 'react';
import { X, ShieldAlert, CheckCircle2, AlertOctagon, TrendingUp, TrendingDown, Clock, Sparkles, PieChart, Info, Activity } from 'lucide-react';
import dynamic from 'next/dynamic';

const TradingChartView = dynamic(
  () => import('@/components/analysis/TradingChartView').then((m) => m.TradingChartView),
  {
    loading: () => (
      <div className="h-72 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-center text-slate-500 text-xs animate-pulse">
        جارٍ تحميل الشارت...
      </div>
    ),
    ssr: false,
  }
);

interface PositionSignalData {
  ticker: string;
  signal: 'TAKE_PROFIT' | 'STOP_LOSS' | 'HOLD' | 'ACCUMULATE' | string;
  signal_badge: string;
  signal_color: string;
  pnl_percent: number;
  sub_portfolio: string;
  buy_price: number;
  current_price: number;
  holding_days: number;
  position_warning?: string | null;
  ai_narrative: string;
}

interface PositionDeepDiveDrawerProps {
  ticker: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export const PositionDeepDiveDrawer: React.FC<PositionDeepDiveDrawerProps> = ({
  ticker,
  isOpen,
  onClose,
}) => {
  const [data, setData] = useState<PositionSignalData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticker || !isOpen) {
      setData(null);
      return;
    }

    let isMounted = true;
    setLoading(true);

    // Lazy load signal & deep dive data only when Drawer opens
    fetch(`/api/portfolio/smart-monitor/signals?ticker=${ticker}`)
      .then((r) => r.json())
      .then((res) => {
        if (isMounted && res.success) {
          setData(res);
        }
      })
      .catch((err) => console.error('Error loading smart monitor signals:', err))
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [ticker, isOpen]);

  if (!isOpen || !ticker) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden dir-rtl">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel: 100% on Mobile, 45% on Desktop */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-0 md:pl-10">
        <div className="w-screen max-w-full md:max-w-xl lg:max-w-2xl bg-slate-900 border-l border-slate-800 text-slate-100 shadow-2xl flex flex-col h-full overflow-y-auto transform transition-transform duration-300 ease-in-out">
          
          {/* Drawer Header */}
          <div className="sticky top-0 z-10 p-5 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="px-3 py-1.5 rounded-xl bg-purple-600/20 border border-purple-500/30 text-purple-300 font-bold text-lg">
                {ticker}
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-100">تفاصيل الموقف والغرفة الرقمية</h2>
                <p className="text-xs text-slate-400">تحليل مفصل للمركز</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="p-5 space-y-6 flex-1">
            {loading ? (
              <div className="py-20 text-center text-slate-400 text-sm animate-pulse space-y-3">
                <Sparkles className="w-8 h-8 text-purple-400 mx-auto animate-spin" />
                <p>جارٍ تحليل الموقف واستدعاء الإشارات التحليلية...</p>
              </div>
            ) : data ? (
              <>
                {/* 1. Portfolio Position Section */}
                <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800/80 pb-2">
                    <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                      <PieChart className="w-4 h-4 text-purple-400" /> المحفظة الفرعية:
                    </span>
                    <span className="px-2.5 py-0.5 rounded-md bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">
                      {data.sub_portfolio}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                      <div className="text-[11px] text-slate-400">سعر الشراء</div>
                      <div className="text-sm font-bold text-slate-200 mt-1">{data.buy_price.toFixed(2)} ج.م</div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                      <div className="text-[11px] text-slate-400">السعر اللحظي</div>
                      <div className="text-sm font-bold text-slate-100 mt-1">{data.current_price.toFixed(2)} ج.م</div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                      <div className="text-[11px] text-slate-400">الربح/الخسارة</div>
                      <div
                        className={`text-sm font-bold mt-1 ${
                          data.pnl_percent >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {data.pnl_percent >= 0 ? `+${data.pnl_percent}%` : `${data.pnl_percent}%`}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                      <div className="text-[11px] text-slate-400">مدة الاحتفاظ</div>
                      <div className="text-sm font-bold text-slate-300 mt-1 flex items-center justify-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" /> {data.holding_days} يوم
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. مؤشرات المخاطر */}
                <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-emerald-400" /> إشارة التحليل المتقدم والمخاطر:
                    </span>
                    <span
                      className="px-3 py-1 rounded-xl text-xs font-bold text-white shadow-lg"
                      style={{ backgroundColor: data.signal_color }}
                    >
                      {data.signal_badge}
                    </span>
                  </div>

                  {data.signal === 'TAKE_PROFIT' && (
                    <button className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> ✅ حقق ربح الآن (بيع جزئي/كلي)
                    </button>
                  )}

                  {data.signal === 'STOP_LOSS' && (
                    <button className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm transition-all shadow-lg shadow-red-600/20 flex items-center justify-center gap-2">
                      <AlertOctagon className="w-4 h-4" /> 🚨 تنفيذ إيقاف الخسارة الخروج لحماية رأس المال
                    </button>
                  )}

                  {data.position_warning && (
                    <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs font-medium flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>{data.position_warning}</span>
                    </div>
                  )}
                </div>

                {/* 3. Narrative Explanation Section */}
                <div className="p-4 rounded-2xl bg-purple-950/20 border border-purple-500/20 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-purple-300">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span>تحليل الوضع الحالي:</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed font-medium">
                    {data.ai_narrative}
                  </p>
                </div>

                {/* 4. Embedded Live Dual-Pane Chart Section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                    <span className="font-bold text-slate-200">الرسم البياني اللحظي للسهم (Interactive Chart)</span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-emerald-400 font-mono">
                      state=owner
                    </span>
                  </div>
                  <div className="rounded-2xl overflow-hidden border border-slate-800 bg-slate-950">
                    <TradingChartView symbol={ticker} />
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
