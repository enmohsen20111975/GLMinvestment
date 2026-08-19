'use client';

import React, { useState, useEffect } from 'react';
import { Shield, Star, TrendingUp, TrendingDown, Layers, Search, Eye } from 'lucide-react';

export interface HoldingItem {
  ticker: string;
  name: string;
  sub_portfolio?: string;
  buy_price: number;
  current_price: number;
  quantity?: number;
  pnl_amount?: number;
  pnl_percent: number;
  current_score?: number;
  holding_days?: number;
  in_watchlist?: boolean;
  is_holding?: boolean;
}

export interface WatchlistItem {
  ticker: string;
  name: string;
  current_price: number;
  change_pct: number;
  current_score?: number;
  in_portfolio?: boolean;
}

interface UnifiedHoldingsTableProps {
  onSelectPosition: (ticker: string) => void;
}

export const UnifiedHoldingsTable: React.FC<UnifiedHoldingsTableProps> = ({ onSelectPosition }) => {
  const [activeTab, setActiveTab] = useState<'holdings' | 'watchlist'>('holdings');
  const [holdings, setHoldings] = useState<HoldingItem[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        const [hRes, wRes] = await Promise.allSettled([
          fetch('/api/portfolio/holdings').then((r) => r.json()),
          fetch('/api/portfolio/watchlists').then((r) => r.json()),
        ]);

        if (isMounted) {
          if (hRes.status === 'fulfilled' && hRes.value?.success) {
            setHoldings(hRes.value.holdings || []);
          }
          if (wRes.status === 'fulfilled' && wRes.value?.success) {
            setWatchlist(wRes.value.watchlist || []);
          }
        }
      } catch (err) {
        console.error('Error loading holdings table:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  const toggleStar = (ticker: string) => {
    setHoldings((prev) =>
      prev.map((h) => (h.ticker === ticker ? { ...h, in_watchlist: !h.in_watchlist } : h))
    );
  };

  const filteredHoldings = holdings.filter(
    (h) =>
      h.ticker.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.name.includes(searchQuery)
  );

  const filteredWatchlist = watchlist.filter(
    (w) =>
      w.ticker.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.name.includes(searchQuery)
  );

  return (
    <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl backdrop-blur-md dir-rtl">
      {/* Header & Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">المحافظ والأسهم المتابعة</h3>
            <p className="text-xs text-slate-400">عرض موحد للأسهم المملوكة وقوائم المتابعة</p>
          </div>
        </div>

        {/* Tab Controls & Search */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="بحث بسهم أو رمز..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-3 pr-9 py-1.5 text-xs rounded-xl bg-slate-950/60 border border-slate-800 text-slate-200 focus:outline-none focus:border-purple-500 w-44"
            />
          </div>

          <div className="flex items-center p-1 rounded-xl bg-slate-950/80 border border-slate-800">
            <button
              onClick={() => setActiveTab('holdings')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'holdings'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              💼 أسهم المحفظة ({holdings.length})
            </button>
            <button
              onClick={() => setActiveTab('watchlist')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'watchlist'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ⭐ قائمة المتابعة ({watchlist.length})
            </button>
          </div>
        </div>
      </div>

      {/* Table Section */}
      {loading ? (
        <div className="p-8 text-center text-slate-500 text-sm animate-pulse">
          جارٍ تحميل أسهم المحفظة والمتابعة...
        </div>
      ) : activeTab === 'holdings' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-xs font-semibold">
                <th className="py-3 px-4">السهم</th>
                <th className="py-3 px-4">المحفظة الفرعية</th>
                <th className="py-3 px-4">سعر الشراء</th>
                <th className="py-3 px-4">السعر الحالي</th>
                <th className="py-3 px-4">الربح/الخسارة (EGP & %)</th>
                <th className="py-3 px-4 text-center">Score السهم</th>
                <th className="py-3 px-4 text-center">متابعة</th>
                <th className="py-3 px-4 text-left">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs font-medium">
              {filteredHoldings.map((item) => {
                const isProfitable = item.pnl_percent >= 0;
                return (
                  <tr
                    key={item.ticker}
                    onClick={() => onSelectPosition(item.ticker)}
                    className="hover:bg-slate-800/50 transition-colors cursor-pointer group"
                  >
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-100 group-hover:text-purple-400 transition-colors">
                          {item.ticker}
                        </span>
                        <span className="text-[11px] text-slate-400 font-normal truncate max-w-[120px]">
                          {item.name}
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                          <Shield className="w-3 h-3" /> 🛡️ في محفظتك
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 font-medium border border-slate-700/50 text-[11px]">
                        {item.sub_portfolio || 'محفظة رئيسية'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">{item.buy_price.toFixed(2)} ج.م</td>
                    <td className="py-3.5 px-4 text-slate-100 font-bold">{item.current_price.toFixed(2)} ج.م</td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        {isProfitable ? (
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        )}
                        <span
                          className={`font-bold ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}
                        >
                          {isProfitable ? `+${item.pnl_amount}` : item.pnl_amount} ج.م (
                          {isProfitable ? `+${item.pnl_percent}%` : `${item.pnl_percent}%`})
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 font-bold text-amber-400">
                        {item.current_score || 80}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleStar(item.ticker)}
                        className="p-1 rounded-md hover:bg-slate-700/50 text-amber-400 transition-colors"
                      >
                        <Star className={`w-4 h-4 ${item.in_watchlist ? 'fill-amber-400' : ''}`} />
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-left">
                      <button
                        onClick={() => onSelectPosition(item.ticker)}
                        className="px-3 py-1 text-[11px] font-bold rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600 hover:text-white transition-all flex items-center gap-1 ml-auto"
                      >
                        <Eye className="w-3 h-3" /> التفاصيل
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-xs font-semibold">
                <th className="py-3 px-4">السهم</th>
                <th className="py-3 px-4">السعر الحالي</th>
                <th className="py-3 px-4">التغير اليومي</th>
                <th className="py-3 px-4 text-center">Score السهم</th>
                <th className="py-3 px-4 text-left">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs font-medium">
              {filteredWatchlist.map((item) => {
                const isPos = item.change_pct >= 0;
                return (
                  <tr
                    key={item.ticker}
                    onClick={() => onSelectPosition(item.ticker)}
                    className="hover:bg-slate-800/50 transition-colors cursor-pointer group"
                  >
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-100 group-hover:text-purple-400 transition-colors">
                          {item.ticker}
                        </span>
                        <span className="text-[11px] text-slate-400 font-normal">{item.name}</span>
                        {item.in_portfolio && (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            🛡️ في محفظتك
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-100 font-bold">{item.current_price.toFixed(2)} ج.م</td>
                    <td className="py-3.5 px-4">
                      <span className={`font-bold ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isPos ? `+${item.change_pct}%` : `${item.change_pct}%`}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 font-bold text-amber-400">
                        {item.current_score || 75}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-left">
                      <button
                        onClick={() => onSelectPosition(item.ticker)}
                        className="px-3 py-1 text-[11px] font-bold rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600 hover:text-white transition-all flex items-center gap-1 ml-auto"
                      >
                        <Eye className="w-3 h-3" /> التفاصيل
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
