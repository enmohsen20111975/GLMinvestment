'use client';

import { create } from 'zustand';

/* ============================================================
   P30 TASK 8: Unified Portfolio Store
   ============================================================
   Single source of truth for portfolio data across ALL screens:
   - AssetsTab (EnhancedPortfolioView)
   - MasterPortfolioSummary
   - RealReturnPanel
   - WealthCommandCenter

   When any screen refreshes data (e.g. the 30s silent poll in
   EnhancedPortfolioView), it calls store.updateFromCalcValues() /
   store.updateMaster() / store.updateRealReturn(). Every other
   screen subscribed to the store automatically re-renders with
   fresh numbers — no duplicate API calls, no stale state.
   ============================================================ */

export interface PortfolioAsset {
  id: string | number;
  type: string;
  name: string;
  stock_ticker?: string;
  quantity?: number;
  avg_buy_price?: number;
  total_invested: number;
  current_value: number;
  current_stock_price?: number;
  profit_loss?: number;
  profit_loss_percent?: number;
  [key: string]: unknown;
}

export interface MasterSummary {
  total_value: number;
  cash: number;
  invested_amount: number;
  net_pnl: number;
  net_pnl_pct: number;
}

export interface RealReturnSummary {
  inflation: { rate: number; source: string };
  weighted_yield: number;
  weighted_real_return: number;
  total_real_loss: number;
  has_warnings: boolean;
  warning_count: number;
}

export interface PortfolioStore {
  // ── State ──
  assets: PortfolioAsset[];
  goldPrices: { '24k': number; '21k': number; '18k': number } | null;
  totalInvested: number;
  totalCurrentValue: number;
  totalProfitLoss: number;
  profitLossPercent: number;
  byType: Record<string, { count: number; invested: number; current: number; profit_loss: number }>;

  // B-2: P34 backend net-worth math — persisted so every screen reads the
  // same numbers without re-fetching or recomputing locally.
  grossAssetsEgp: number;
  totalObligationsEgp: number;
  netWorthEgp: number;
  monthlyYieldEgp: number;
  annualYieldEgp: number;
  smartMath: Record<string, unknown> | null;

  masterSummary: MasterSummary | null;
  subPortfolios: any[];

  realReturnSummary: RealReturnSummary | null;
  realReturnAssets: any[];

  lastUpdated: number | null;
  isLoading: boolean;

  // ── Actions ──
  updateFromCalcValues: (data: any) => void;
  updateMaster: (data: any) => void;
  updateRealReturn: (data: any) => void;
  setLoading: (loading: boolean) => void;
  refreshAll: (portfolioId?: string | number) => Promise<void>;
}

export const usePortfolioStore = create<PortfolioStore>((set, get) => ({
  // ── Initial state ──
  assets: [],
  goldPrices: null,
  totalInvested: 0,
  totalCurrentValue: 0,
  totalProfitLoss: 0,
  profitLossPercent: 0,
  byType: {},

  // B-2: P34 net-worth math defaults
  grossAssetsEgp: 0,
  totalObligationsEgp: 0,
  netWorthEgp: 0,
  monthlyYieldEgp: 0,
  annualYieldEgp: 0,
  smartMath: null,

  masterSummary: null,
  subPortfolios: [],

  realReturnSummary: null,
  realReturnAssets: [],

  lastUpdated: null,
  isLoading: false,

  // ── Update from /api/finance/calculate-values ──
  updateFromCalcValues: (data) => {
    if (!data || !data.success) return;
    set({
      assets: data.items || [],
      goldPrices: data.gold_prices || null,
      totalInvested: data.total_invested || 0,
      totalCurrentValue: data.total_current_value || 0,
      totalProfitLoss: data.total_profit_loss || 0,
      profitLossPercent: data.profit_loss_percent || 0,
      byType: data.by_type || {},
      // B-2: P34 backend net-worth math — gross assets, debts, net worth, yields
      grossAssetsEgp: data.gross_assets_egp || data.total_current_value || 0,
      totalObligationsEgp: data.total_obligations_egp || 0,
      netWorthEgp: data.net_worth_egp || 0,
      monthlyYieldEgp: data.smart_math?.monthly_yield_egp || 0,
      annualYieldEgp: data.smart_math?.annual_yield_egp || 0,
      smartMath: data.smart_math || null,
      lastUpdated: Date.now(),
    });
  },

  // ── Update from /api/portfolio/master ──
  updateMaster: (data) => {
    if (!data || !data.success) return;
    set({
      masterSummary: data.aggregated || null,
      subPortfolios: data.sub_portfolios || [],
      // B-2: P34 backend net-worth math — master endpoint also returns these.
      grossAssetsEgp: data.gross_assets_egp || data.aggregated?.total_value || 0,
      totalObligationsEgp: data.total_obligations_egp || 0,
      netWorthEgp: data.net_worth_egp || 0,
      monthlyYieldEgp: data.smart_math?.monthly_yield_egp || 0,
      annualYieldEgp: data.smart_math?.annual_yield_egp || 0,
      smartMath: data.smart_math || null,
      lastUpdated: Date.now(),
    });
  },

  // ── Update from /api/finance/real-return ──
  updateRealReturn: (data) => {
    if (!data || !data.success) return;
    set({
      realReturnSummary: data.summary || null,
      realReturnAssets: data.assets || [],
      lastUpdated: Date.now(),
    });
  },

  setLoading: (loading) => set({ isLoading: loading }),

  // ── Refresh all portfolio data in parallel ──
  refreshAll: async (portfolioId) => {
    const pidQs = portfolioId && portfolioId !== 'master' ? `?portfolio_id=${portfolioId}` : '';
    set({ isLoading: true });
    try {
      const [calcRes, masterRes, realReturnRes] = await Promise.all([
        fetch(`/api/finance/calculate-values${pidQs}`, { cache: 'no-store' }),
        fetch('/api/portfolio/master', { cache: 'no-store' }).catch(() => null),
        fetch('/api/finance/real-return', { cache: 'no-store' }).catch(() => null),
      ]);

      const calcData = await calcRes.json();
      get().updateFromCalcValues(calcData);

      if (masterRes && masterRes.ok) {
        const masterData = await masterRes.json();
        get().updateMaster(masterData);
      }

      if (realReturnRes && realReturnRes.ok) {
        const realReturnData = await realReturnRes.json();
        get().updateRealReturn(realReturnData);
      }
    } catch (e) {
      console.error('[usePortfolioStore] refreshAll error:', e);
    } finally {
      set({ isLoading: false });
    }
  },
}));
