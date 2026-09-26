'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Shield, Star, TrendingUp, TrendingDown, Layers, Search, Eye } from 'lucide-react';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';

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

  // ─── UnifiedTable columns ────────────────────────────────────────────────
  type HoldingRow = Record<string, unknown>;

  const holdingsColumns: Column<HoldingRow>[] = useMemo(
    () => [
      {
        key: 'ticker',
        header: 'السهم',
        align: 'right',
        sortable: true,
        render: (row) => (
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-100 group-hover:text-purple-400 transition-colors">
              {String(row.ticker ?? '')}
            </span>
            <span className="text-[11px] text-slate-400 font-normal truncate max-w-[120px]">
              {String(row.name ?? '')}
            </span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
              <Shield className="w-3 h-3" /> 🛡️ في محفظتك
            </span>
          </div>
        ),
      },
      {
        key: 'sub_portfolio',
        header: 'المحفظة الفرعية',
        align: 'right',
        sortable: true,
        render: (row) => (
          <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 font-medium border border-slate-700/50 text-[11px]">
            {String(row.sub_portfolio ?? '') || 'محفظة رئيسية'}
          </span>
        ),
      },
      {
        key: 'buy_price',
        header: 'سعر الشراء',
        align: 'left',
        sortable: true,
        render: (row) => (
          <span className="text-slate-300">{Number(row.buy_price ?? 0).toFixed(2)} ج.م</span>
        ),
      },
      {
        key: 'current_price',
        header: 'السعر الحالي',
        align: 'left',
        sortable: true,
        render: (row) => (
          <span className="text-slate-100 font-bold">{Number(row.current_price ?? 0).toFixed(2)} ج.م</span>
        ),
      },
      {
        key: 'pnl_percent',
        header: 'الربح/الخسارة (EGP & %)',
        align: 'left',
        sortable: true,
        render: (row) => {
          const pnlPercent = Number(row.pnl_percent ?? 0);
          const pnlAmount = row.pnl_amount as number | string | undefined;
          const isProfitable = pnlPercent >= 0;
          return (
            <div className="flex items-center gap-1.5">
              {isProfitable ? (
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0" />
              )}
              <span
                className={`font-bold ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {isProfitable ? `+${pnlAmount}` : pnlAmount} ج.م (
                {isProfitable ? `+${pnlPercent}%` : `${pnlPercent}%`})
              </span>
            </div>
          );
        },
      },
      {
        key: 'current_score',
        header: 'Score السهم',
        align: 'center',
        sortable: true,
        render: (row) => (
          <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 font-bold text-amber-400">
            {Number(row.current_score ?? 80)}
          </span>
        ),
      },
      {
        key: 'watchlist',
        header: 'متابعة',
        align: 'center',
        render: (row) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleStar(String(row.ticker ?? ''));
            }}
            className="p-1 rounded-md hover:bg-slate-700/50 text-amber-400 transition-colors"
            aria-label="تبديل المتابعة"
          >
            <Star className={`w-4 h-4 ${row.in_watchlist ? 'fill-amber-400' : ''}`} />
          </button>
        ),
      },
      {
        key: 'action',
        header: 'إجراء',
        align: 'left',
        render: (row) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelectPosition(String(row.ticker ?? ''));
            }}
            className="px-3 py-1 text-[11px] font-bold rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600 hover:text-white transition-all flex items-center gap-1 ml-auto"
          >
            <Eye className="w-3 h-3" /> التفاصيل
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const watchlistColumns: Column<HoldingRow>[] = useMemo(
    () => [
      {
        key: 'ticker',
        header: 'السهم',
        align: 'right',
        sortable: true,
        render: (row) => (
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-100 group-hover:text-purple-400 transition-colors">
              {String(row.ticker ?? '')}
            </span>
            <span className="text-[11px] text-slate-400 font-normal">{String(row.name ?? '')}</span>
            {row.in_portfolio && (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                🛡️ في محفظتك
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'current_price',
        header: 'السعر الحالي',
        align: 'left',
        sortable: true,
        render: (row) => (
          <span className="text-slate-100 font-bold">{Number(row.current_price ?? 0).toFixed(2)} ج.م</span>
        ),
      },
      {
        key: 'change_pct',
        header: 'التغير اليومي',
        align: 'left',
        sortable: true,
        render: (row) => {
          const changePct = Number(row.change_pct ?? 0);
          const isPos = changePct >= 0;
          return (
            <span className={`font-bold ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
              {isPos ? `+${changePct}%` : `${changePct}%`}
            </span>
          );
        },
      },
      {
        key: 'current_score',
        header: 'Score السهم',
        align: 'center',
        sortable: true,
        render: (row) => (
          <span className="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 font-bold text-amber-400">
            {Number(row.current_score ?? 75)}
          </span>
        ),
      },
      {
        key: 'action',
        header: 'إجراء',
        align: 'left',
        render: (row) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelectPosition(String(row.ticker ?? ''));
            }}
            className="px-3 py-1 text-[11px] font-bold rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600 hover:text-white transition-all flex items-center gap-1 ml-auto"
          >
            <Eye className="w-3 h-3" /> التفاصيل
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSelectPosition]
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
        <UnifiedTable<HoldingRow>
          columns={activeTab === 'holdings' ? holdingsColumns : watchlistColumns}
          data={[]}
          loading
          loadingRows={6}
          emptyTextAr="جارٍ تحميل أسهم المحفظة والمتابعة..."
        />
      ) : activeTab === 'holdings' ? (
        <UnifiedTable<HoldingRow>
          columns={holdingsColumns}
          data={filteredHoldings as unknown as HoldingRow[]}
          keyField="ticker"
          onRowClick={(row) => onSelectPosition(String(row.ticker ?? ''))}
          emptyTextAr="لا توجد أسهم مملوكة"
          rowClassName={(row) =>
            Number(row.pnl_percent ?? 0) >= 0 ? 'bg-emerald-500/5' : 'bg-red-500/5'
          }
        />
      ) : (
        <UnifiedTable<HoldingRow>
          columns={watchlistColumns}
          data={filteredWatchlist as unknown as HoldingRow[]}
          keyField="ticker"
          onRowClick={(row) => onSelectPosition(String(row.ticker ?? ''))}
          emptyTextAr="لا توجد أسهم في قائمة المتابعة"
          rowClassName={(row) =>
            Number(row.change_pct ?? 0) >= 0 ? 'bg-emerald-500/5' : 'bg-red-500/5'
          }
        />
      )}
    </div>
  );
};
