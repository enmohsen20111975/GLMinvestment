'use client';

import React, { useState } from 'react';
import { RiskManagementBar } from './RiskManagementBar';
import { WealthCharts } from './WealthCharts';
import { UnifiedHoldingsTable } from './UnifiedHoldingsTable';
import { PositionDeepDiveDrawer } from './PositionDeepDiveDrawer';
import { Shield, Sparkles, RefreshCw, BarChart3 } from 'lucide-react';

export const WealthCommandCenter: React.FC = () => {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleSelectPosition = (ticker: string) => {
    setSelectedTicker(ticker);
    setIsDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedTicker(null);
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1000);
  };

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8 dir-rtl space-y-6">
      {/* Top Banner / Command Center Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-gradient-to-r from-purple-950/40 via-slate-900 to-slate-950 border border-purple-500/20 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-600/30">
            <BarChart3 className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                غرفة عمليات إدارة الأموال
              </h1>
              <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-emerald-400" /> Wealth Command Center
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              مراقبة فورية للثروة، المحافظ الفرعية، التوزيع القطاعي وإشارات التحليل المتقدم
            </p>
          </div>
        </div>

        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="self-start sm:self-auto px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white transition-all text-xs font-bold flex items-center gap-2 shadow-md"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-purple-400' : ''}`} />
          <span>تحديث الحسابات</span>
        </button>
      </div>

      {/* 1. Risk Management Bar */}
      <RiskManagementBar />

      {/* 2. Wealth Charts (Equity Curve + Asset Allocation + Cashflow) */}
      <WealthCharts />

      {/* 3. Unified Holdings & Watchlist Table */}
      <UnifiedHoldingsTable onSelectPosition={handleSelectPosition} />

      {/* 4. Position Deep-Dive Drawer */}
      <PositionDeepDiveDrawer
        ticker={selectedTicker}
        isOpen={isDrawerOpen}
        onClose={handleCloseDrawer}
      />
    </div>
  );
};

export default WealthCommandCenter;
