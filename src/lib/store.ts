'use client';

import { create } from 'zustand';
import type {
  AppView,
  User,
  Notification,
  Stock,
  MarketOverview,
  DeepAnalysis,
  PriceHistoryResponse,
  PortfolioImpactResponse,
  AiInsights,
  WatchlistItem,
  StockListResponse,
} from '@/types';
import type { RecommendResponse } from '@/types/v2';
import {
  generateMockMarketOverview,
  generateMockStocks,
  generateMockDeepAnalysis,
  generateMockPriceHistory,
  generateMockPortfolioImpact,
  generateMockAiInsights,
  generateMockNotifications,
} from '@/lib/mock-data';
import { apiClient } from '@/lib/api-client';
import type { Session } from 'next-auth';

// ==================== USE_REAL_API FLAG ====================
// Set to true to use the real backend via Next.js proxy.
// Set to false to fall back to mock data.
const USE_REAL_API = true;

// ==================== DATA ADAPTERS ====================
// These functions transform backend API responses to match frontend types.

/**
 * Transform a raw stock object from the backend to match the Stock type.
 */
function adaptStock(raw: Record<string, unknown>): Stock {
  return {
    id: raw.id as number | undefined,
    ticker: (raw.ticker as string) || '',
    name: (raw.name as string) || '',
    name_ar: (raw.name_ar as string) || '',
    current_price: (raw.current_price as number) || 0,
    previous_close: (raw.previous_close as number) || 0,
    open_price: (raw.open_price as number) || 0,
    high_price: (raw.high_price as number) || 0,
    low_price: (raw.low_price as number) || 0,
    volume: (raw.volume as number) || 0,
    market_cap: (raw.market_cap as number) || 0,
    pe_ratio: (raw.pe_ratio as number) || 0,
    pb_ratio: (raw.pb_ratio as number) || 0,
    dividend_yield: (raw.dividend_yield as number) || 0,
    eps: (raw.eps as number) || 0,
    roe: (raw.roe as number) || 0,
    debt_to_equity: (raw.debt_to_equity as number) || 0,
    support_level: (raw.support_level as number) || 0,
    resistance_level: (raw.resistance_level as number) || 0,
    ma_50: (raw.ma_50 as number) || 0,
    ma_200: (raw.ma_200 as number) || 0,
    rsi: (raw.rsi as number) || 0,
    sector: (raw.sector as string) || '',
    industry: (raw.industry as string) || (raw.sector as string) || '',
    egx30_member: (raw.egx30_member as boolean) || false,
    egx70_member: (raw.egx70_member as boolean) || false,
    egx100_member: (raw.egx100_member as boolean) || false,
    compliance_status: (raw.compliance_status as string) || undefined,
    is_active: (raw.is_active as boolean) ?? true,
    is_egx: (raw.is_egx as boolean) ?? true,
    last_update: (raw.last_update as string) || new Date().toISOString(),
    value_traded: (raw.value_traded as number) || 0,
    price_change: (raw.price_change as number) || null,
  };
}

/**
 * Transform backend market overview to match frontend MarketOverview type.
 */
function adaptMarketOverview(raw: Record<string, unknown>): MarketOverview {
  const summary = raw.summary as Record<string, unknown> || {};
  const indices = (raw.indices as Array<Record<string, unknown>>) || [];
  const topGainers = (raw.top_gainers as Array<Record<string, unknown>>) || [];
  const topLosers = (raw.top_losers as Array<Record<string, unknown>>) || [];
  const mostActive = (raw.most_active as Array<Record<string, unknown>>) || [];
  const marketStatus = raw.market_status as Record<string, unknown> || {};

  return {
    market_status: {
      is_open: (marketStatus.is_market_hours as boolean) ?? true,
      status: (marketStatus.is_market_hours as boolean) ? 'open' : 'closed',
      next_open: marketStatus.next_trading_window
        ? ((marketStatus.next_trading_window as Record<string, unknown>).message as string) || null
        : null,
      next_close: null,
      current_session: (marketStatus.is_market_hours as boolean) ? 'trading' : 'closed',
    },
    summary: {
      total_stocks: (summary.total_stocks as number) || 100,
      gainers: (summary.gainers as number) || 0,
      losers: (summary.losers as number) || 0,
      unchanged: (summary.unchanged as number) || 0,
      egx30_stocks: (summary.egx30_stocks as number) || 30,
      egx70_stocks: (summary.egx70_stocks as number) || 20,
      egx100_stocks: (summary.egx100_stocks as number) || 100,
      egx30_value: (summary.egx30_value as number) || 0,
    },
    indices: indices.map((idx) => ({
      symbol: (idx.symbol as string) || '',
      name: (idx.name as string) || '',
      name_ar: (idx.name_ar as string) || '',
      value: (idx.value as number) || 0,
      previous_close: (idx.previous_close as number) || 0,
      change: (idx.change as number) || 0,
      change_percent: (idx.change_percent as number) || 0,
      last_updated: (idx.last_updated as string) || null,
    })),
    top_gainers: topGainers.map((s) => ({
      ticker: (s.ticker as string) || '',
      name: (s.name as string) || '',
      name_ar: (s.name_ar as string) || '',
      current_price: (s.current_price as number) || 0,
      price_change: (s.price_change as number) ?? null,
      volume: s.volume as number | undefined,
    })),
    top_losers: topLosers.map((s) => ({
      ticker: (s.ticker as string) || '',
      name: (s.name as string) || '',
      name_ar: (s.name_ar as string) || '',
      current_price: (s.current_price as number) || 0,
      price_change: (s.price_change as number) ?? null,
      volume: s.volume as number | undefined,
    })),
    most_active: mostActive.map((s) => ({
      ticker: (s.ticker as string) || '',
      name: (s.name as string) || '',
      name_ar: (s.name_ar as string) || '',
      current_price: (s.current_price as number) || 0,
      price_change: (s.price_change as number) ?? null,
      volume: (s.volume as number) ?? 0,
    })),
    last_updated: (raw.last_updated as string) || new Date().toISOString(),
  };
}

/**
 * Transform backend price history to match frontend PriceHistoryResponse type.
 */
function adaptPriceHistory(raw: Record<string, unknown>): PriceHistoryResponse {
  const data = (raw.data as Array<Record<string, unknown>>) || [];
  const summary = (raw.summary as Record<string, unknown>) || {};
  const prices = data.map((d) => d.close as number).filter(Boolean);

  return {
    success: (raw.success as boolean) ?? true,
    ticker: (raw.ticker as string) || '',
    data: data.map((d) => ({
      date: (d.date as string).split('T')[0],
      open: (d.open as number) || 0,
      high: (d.high as number) || 0,
      low: (d.low as number) || 0,
      close: (d.close as number) || 0,
      volume: (d.volume as number) || 0,
    })),
    summary: {
      highest: (summary.high_price as number) || Math.max(...prices, 0),
      lowest: (summary.low_price as number) || Math.min(...prices, 0),
      avg_price: (summary.avg_price as number) || (prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0),
      total_volume: data.reduce((sum, d) => sum + ((d.volume as number) || 0), 0),
      start_price: prices.length > 0 ? prices[0] : 0,
      end_price: prices.length > 0 ? prices[prices.length - 1] : 0,
      change_percent: (summary.price_change_percent as number) || 0,
    },
    days: (raw.days as number) || 30,
  };
}

/**
 * Transform backend recommendation response to match frontend DeepAnalysis type.
 */
function adaptDeepAnalysis(raw: Record<string, unknown>, stock: Stock): DeepAnalysis {
  const rec = (raw.recommendation as Record<string, unknown>) || {};
  const scores = (raw.scores as Record<string, unknown>) || {};
  const trend = (raw.trend as Record<string, unknown>) || {};
  const priceRange = (raw.price_range as Record<string, unknown>) || {};
  const strengths = (raw.key_strengths as Array<Record<string, unknown>>) || [];
  const risks = (raw.key_risks as Array<Record<string, unknown>>) || [];

  const action = (rec.action as string) || 'hold';
  const actionArMap: Record<string, string> = {
    strong_buy: 'شراء قوي',
    buy: 'شراء',
    hold: 'احتفاظ',
    sell: 'بيع',
    strong_sell: 'بيع قوي',
    accumulate: 'تراكم',
  };

  const trendDir = (trend.direction as string) || 'sideways';
  const trendArMap: Record<string, string> = {
    bullish: 'صعودي',
    uptrend: 'اتجاه صاعد',
    sideways: 'عرضي',
    bearish: 'هبوطي',
    downtrend: 'اتجاه هابط',
  };

  return {
    ticker: stock.ticker,
    stock_name: stock.name,
    stock_name_ar: stock.name_ar,
    current_price: stock.current_price,
    overall_score: ((scores.total_score as number) || (rec.confidence_score as number) || 50) as number,
    technical_score: ((scores.technical_score as number) || 50) as number,
    fundamental_score: ((scores.fundamental_score as number) || 50) as number,
    risk_score: ((scores.risk_score as number) || 50) as number,
    trend: trendDir,
    trend_ar: trendArMap[trendDir] || (trend.direction_ar as string) || 'عرضي',
    action: action,
    action_ar: (rec.action_ar as string) || actionArMap[action] || 'احتفاظ',
    price_targets: {
      support: (priceRange.support as number) || stock.support_level,
      resistance: (priceRange.resistance as number) || stock.resistance_level,
      upside_target: (raw.target_price as number) || stock.current_price * 1.1,
    },
    strengths: strengths.map((s) => (s.title_ar as string) || (s.title as string) || ''),
    risks: risks.map((r) => (r.title_ar as string) || (r.title as string) || ''),
    technical_indicators: {
      rsi_signal: stock.rsi > 65 ? 'overbought' : stock.rsi < 35 ? 'oversold' : 'neutral',
      ma_signal: stock.ma_50 > stock.ma_200 ? 'golden_cross' : 'death_cross',
      volume_signal: stock.volume > 1000000 ? 'high' : 'normal',
      momentum: (scores.technical_score as number) > 60 ? 'positive' : ((scores.technical_score as number) || 40) < 40 ? 'negative' : 'neutral',
    },
  };
}

// ==================== STORE ====================

interface AppStore {
  // Navigation
  currentView: AppView;
  previousView: AppView | null;
  selectedTicker: string | null;
  sidebarOpen: boolean;
  setCurrentView: (view: AppView) => void;
  setSelectedTicker: (ticker: string | null) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  goBack: () => void;

  // Auth
  user: User | null;
  apiKey: string | null;
  setUser: (user: User | null) => void;
  setApiKey: (key: string | null) => void;
  syncFromSession: (session: Session | null) => void;
  logout: () => void;

  // Data
  marketOverview: MarketOverview | null;
  stocks: Stock[];
  stocksTotal: number;
  stocksPage: number;
  searchQuery: string;
  selectedStock: Stock | null;
  stockHistory: PriceHistoryResponse | null;
  deepAnalysis: DeepAnalysis | null;
  professionalAnalysis: Record<string, unknown> | null;
  portfolioImpact: PortfolioImpactResponse | null;
  aiInsights: AiInsights | null;
  watchlist: WatchlistItem[];
  notifications: Notification[];
  stockNews: Record<string, unknown> | null;
  stockNewsLoading: boolean;
  v2Data: RecommendResponse | null;
  v2Loading: boolean;
  v2Error: string | null;
  v2RetryCount: number;

  // Actions
  setSearchQuery: (query: string) => void;
  loadDashboard: () => void;
  loadStocks: (query?: string, page?: number) => void;
  loadStockDetail: (ticker: string) => void;
  loadProfessionalAnalysis: (ticker: string) => void;
  loadPortfolio: () => void;
  loadAiInsights: () => void;
  loadWatchlist: () => void;
  loadStockNews: (ticker: string, limit?: number) => void;
  loadV2Recommendations: () => void;

  // CRUD Actions
  addToWatchlist: (stockIdOrTicker: number | string, extras?: { alert_price_above?: number | null; alert_price_below?: number | null; alert_change_percent?: number | null; notes?: string | null }) => Promise<{ success: boolean; error: string | null }>;
  updateWatchlistItem: (id: number, updates: { alert_price_above?: number | null; alert_price_below?: number | null; alert_change_percent?: number | null; notes?: string | null }) => Promise<{ success: boolean; error: string | null }>;
  removeFromWatchlist: (id: number) => Promise<{ success: boolean; error: string | null }>;
  addToPortfolio: (stockIdOrTicker: number | string, quantity: number, avgBuyPrice: number) => Promise<{ success: boolean; error: string | null }>;
  updatePortfolioItem: (id: number | string, updates: Record<string, unknown>) => Promise<{ success: boolean; error: string | null }>;
  removeFromPortfolio: (id: number | string) => Promise<{ success: boolean; error: string | null }>;

  // UI State
  isLoading: boolean;
  activeMobileTab: string;
  setActiveMobileTab: (tab: string) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // Navigation
  currentView: 'dashboard',
  previousView: null,
  selectedTicker: null,
  sidebarOpen: true,
  setCurrentView: (view) => {
    set({ currentView: view, previousView: get().currentView });
    // Track page view (fire-and-forget, no await)
    try {
      if (typeof window !== 'undefined') {
        fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'page_view',
            view,
            user_agent: typeof navigator !== 'undefined' ? navigator.userAgent?.slice(0, 120) : null,
            screen_width: typeof window !== 'undefined' ? window.innerWidth : null,
          }),
        }).catch(() => { /* silent */ });
      }
    } catch { /* silent */ }
  },
  setSelectedTicker: (ticker) => set({ selectedTicker: ticker }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  goBack: () => {
    const prev = get().previousView;
    if (prev) set({ currentView: prev, previousView: null });
  },

  // Auth
  user: null,
  apiKey: null,
  setUser: (user) => set({ user }),
  setApiKey: (key) => {
    set({ apiKey: key });
    if (typeof window !== 'undefined') {
      if (key) localStorage.setItem('egx_api_key', key);
      else localStorage.removeItem('egx_api_key');
    }
  },
  syncFromSession: (session: Session | null) => {
    if (session?.user) {
      const sessionUser = session.user as Record<string, unknown>;
      set({
        user: {
          id: session.user.id || '',
          email: session.user.email || '',
          username: (sessionUser.username as string) || session.user.name || '',
          is_active: (sessionUser.is_active as boolean) ?? true,
          is_admin: (sessionUser.is_admin as boolean) ?? false,
          subscription_tier: (sessionUser.subscription_tier as string) || 'free',
          default_risk_tolerance: (sessionUser.default_risk_tolerance as string) || 'medium',
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString(),
        },
      });
    } else {
      set({ user: null, apiKey: null });
      if (typeof window !== 'undefined') localStorage.removeItem('egx_api_key');
    }
  },
  logout: () => {
    // Sign out from NextAuth (handles session cleanup)
    // The component calling logout should also call signOut() from next-auth/react
    set({ user: null, apiKey: null, currentView: 'dashboard' });
    if (typeof window !== 'undefined') localStorage.removeItem('egx_api_key');
  },

  // Data - initialized empty, loaded on demand
  marketOverview: null,
  stocks: [],
  stocksTotal: 0,
  stocksPage: 1,
  searchQuery: '',
  selectedStock: null,
  stockHistory: null,
  deepAnalysis: null,
  professionalAnalysis: null,
  portfolioImpact: null,
  aiInsights: null,
  watchlist: [],
  notifications: generateMockNotifications(),
  stockNews: null,
  stockNewsLoading: false,
  v2Data: null,
  v2Loading: false,
  v2Error: null,
  v2RetryCount: 0,

  // Actions
  setSearchQuery: (query) => set({ searchQuery: query }),

  loadDashboard: () => {
    set({ isLoading: true });

    if (USE_REAL_API) {
      Promise.all([
        apiClient.getMarketOverview().catch(() => null),
        apiClient.getAiInsights().catch(() => null),
      ])
        .then(([overviewRaw, insightsRaw]) => {
          const overview = overviewRaw ? adaptMarketOverview(overviewRaw as unknown as Record<string, unknown>) : generateMockMarketOverview();
          const insights = insightsRaw || generateMockAiInsights();
          set({
            marketOverview: overview,
            aiInsights: insights,
            isLoading: false,
          });
        })
        .catch(() => {
          // Fallback to mock data on any error
          set({
            marketOverview: generateMockMarketOverview(),
            aiInsights: generateMockAiInsights(),
            isLoading: false,
          });
        });
    } else {
      // Mock data path
      setTimeout(() => {
        set({
          marketOverview: generateMockMarketOverview(),
          aiInsights: generateMockAiInsights(),
          isLoading: false,
        });
      }, 300);
    }
  },

  loadStocks: (query, page = 1) => {
    set({ isLoading: true, searchQuery: query || '' });

    if (USE_REAL_API) {
      const params: Record<string, unknown> = {
        page,
        page_size: 500,
      };
      if (query) {
        params.query = query;
      }

      apiClient.getStocks(params as Parameters<typeof apiClient.getStocks>[0])
        .then((response: StockListResponse) => {
          const stocks = response.stocks.map((s) => adaptStock(s as unknown as Record<string, unknown>));
          set({
            stocks,
            stocksTotal: response.total,
            stocksPage: page,
            isLoading: false,
          });
        })
        .catch(() => {
          // On API failure, show empty list with error indicator
          // NO fake mock data fallback — show real DB data only
          console.error('[Store] Failed to load stocks from API');
          set({
            stocks: [],
            stocksTotal: 0,
            stocksPage: page,
            isLoading: false,
          });
        });
    } else {
      // Mock data path (development only)
      setTimeout(() => {
        let stocks = generateMockStocks();
        if (query) {
          const q = query.toLowerCase();
          stocks = stocks.filter(
            (s) =>
              s.ticker.toLowerCase().includes(q) ||
              s.name.toLowerCase().includes(q) ||
              s.name_ar.includes(q)
          );
        }
        set({
          stocks,
          stocksTotal: stocks.length,
          stocksPage: page,
          isLoading: false,
        });
      }, 300);
    }
  },

  loadProfessionalAnalysis: (ticker) => {
    const upperTicker = ticker.toUpperCase();
    apiClient.getProfessionalAnalysis(upperTicker)
      .then((data) => {
        set({ professionalAnalysis: data });
      })
      .catch(() => {
        // Silent fail — deepAnalysis will be used as fallback
      });
  },

  loadStockDetail: (ticker) => {
    set({ isLoading: true, selectedTicker: ticker, professionalAnalysis: null });

    if (USE_REAL_API) {
      const upperTicker = ticker.toUpperCase();

      // Fire professional analysis in parallel (non-blocking)
      get().loadProfessionalAnalysis(upperTicker);

      Promise.all([
        apiClient.getStock(upperTicker).catch(() => null),
        apiClient.getStockHistory(upperTicker, 90).catch(() => null),
        apiClient.getStockRecommendation(upperTicker).catch(() => null),
      ])
        .then(([stockRes, historyRaw, recRaw]) => {
          // Get stock data
          const rawStockData = stockRes
            ? (stockRes as unknown as { data: Record<string, unknown> }).data
            : null;

          const allStocks = get().stocks.length > 0 ? get().stocks : generateMockStocks();
          const stock = rawStockData
            ? adaptStock(rawStockData)
            : allStocks.find((s) => s.ticker === upperTicker) || allStocks[0];

          // Get history
          const history = historyRaw
            ? adaptPriceHistory(historyRaw as unknown as Record<string, unknown>)
            : generateMockPriceHistory(upperTicker, 90);

          // Get analysis/recommendation
          const analysis = recRaw
            ? adaptDeepAnalysis(recRaw as unknown as Record<string, unknown>, stock)
            : generateMockDeepAnalysis(stock);

          set({
            selectedStock: stock,
            stockHistory: history,
            deepAnalysis: analysis,
            isLoading: false,
            currentView: 'stock-detail',
          });
        })
        .catch(() => {
          // Fallback to mock data
          const allStocks = generateMockStocks();
          const stock = allStocks.find((s) => s.ticker === ticker) || allStocks[0];
          const history = generateMockPriceHistory(ticker, 90);
          const analysis = generateMockDeepAnalysis(stock);
          set({
            selectedStock: stock,
            stockHistory: history,
            deepAnalysis: analysis,
            isLoading: false,
            currentView: 'stock-detail',
          });
        });
    } else {
      // Mock data path
      setTimeout(() => {
        const allStocks = generateMockStocks();
        const stock = allStocks.find((s) => s.ticker === ticker) || allStocks[0];
        const history = generateMockPriceHistory(ticker, 90);
        const analysis = generateMockDeepAnalysis(stock);
        set({
          selectedStock: stock,
          stockHistory: history,
          deepAnalysis: analysis,
          isLoading: false,
          currentView: 'stock-detail',
        });
      }, 500);
    }
  },

  loadPortfolio: () => {
    set({ isLoading: true });
    fetch('/api/portfolio', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        // API returns { success, positions, summary }
        const items = data.positions || data.items || [];
        if (data.success && items.length > 0) {
          const summary = data.summary || {};
          // Build PortfolioImpactResponse from real data
          const totalMarketValue = summary.total_market_value || 0;
          const totalInvested = summary.total_cost_basis || 0;
          const totalGainLoss = summary.total_unrealized_pnl || 0;
          const totalGainLossPercent = summary.total_unrealized_pnl_percent || 0;
          const dayImpactValue = 0; // Not available in current API
          const dayImpactPercent = 0;

          const positiveItems = items.filter((i: Record<string, unknown>) => Number(i.unrealized_pnl) > 0).sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(b.unrealized_pnl) - Number(a.unrealized_pnl)).slice(0, 5);
          const negativeItems = items.filter((i: Record<string, unknown>) => Number(i.unrealized_pnl) < 0).sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.unrealized_pnl) - Number(b.unrealized_pnl)).slice(0, 5);

          const impact = {
            summary: {
              total_market_value: totalMarketValue,
              total_invested: totalInvested,
              total_gain_loss: totalGainLoss,
              total_gain_loss_percent: totalGainLossPercent,
              day_impact_value: dayImpactValue,
              day_impact_percent: dayImpactPercent,
              assets_count: items.length,
            },
            recommendation: {
              action: totalGainLossPercent > 5 ? 'buy' : totalGainLossPercent < -5 ? 'sell' : 'hold',
              action_label_ar: totalGainLossPercent > 5 ? 'شراء' : totalGainLossPercent < -5 ? 'بيع' : 'احتفاظ',
              confidence: 0.7,
              reason_ar: 'تم تحليل المحفظة بناءً على بيانات حقيقية',
            },
            risk_alerts: items.filter((i: Record<string, unknown>) => {
              const weight = totalMarketValue > 0 ? (Number(i.market_value) / totalMarketValue) * 100 : 0;
              return weight > 30;
            }).map((i: Record<string, unknown>) => ({
              asset_id: i.id,
              ticker: i.stock_symbol,
              name_ar: i.stock_name,
              weight_percent: totalMarketValue > 0 ? Math.round((Number(i.market_value) / totalMarketValue) * 1000) / 10 : 0,
              is_concentration_alert: true,
              is_day_loss_alert: Number(i.unrealized_pnl) < 0,
            })),
            top_positive: positiveItems.map((i: Record<string, unknown>) => ({
              asset_id: i.id, ticker: i.stock_symbol, name_ar: i.stock_name,
              day_impact_percent: 0,
              day_impact_value: Number(i.unrealized_pnl),
            })),
            top_negative: negativeItems.map((i: Record<string, unknown>) => ({
              asset_id: i.id, ticker: i.stock_symbol, name_ar: i.stock_name,
              day_impact_percent: 0,
              day_impact_value: Number(i.unrealized_pnl),
            })),
            items: items.map((i: Record<string, unknown>) => ({
              asset_id: i.id, ticker: i.stock_symbol, name_ar: i.stock_name,
              quantity: Number(i.shares), market_value: Number(i.market_value || 0),
              total_gain_loss_value: Number(i.unrealized_pnl || 0), total_gain_loss_percent: Number(i.unrealized_pnl_percent || 0),
              day_impact_percent: 0, day_impact_value: 0,
              weight_percent: totalMarketValue > 0 ? Math.round((Number(i.market_value || 0) / totalMarketValue) * 1000) / 10 : 0,
              invested_value: Number(i.cost_basis || 0),
            })),
            thresholds: { concentration_alert_percent: 30, day_loss_alert_percent: 3 },
          };
          set({ portfolioImpact: impact, isLoading: false });
        } else {
          // Empty portfolio - show empty state
          set({ portfolioImpact: null, isLoading: false });
        }
      })
      .catch(() => {
        // Fallback to mock on error
        const impact = generateMockPortfolioImpact();
        set({ portfolioImpact: impact, isLoading: false });
      });
  },

  loadAiInsights: () => {
    set({ isLoading: true });

    if (USE_REAL_API) {
      apiClient.getAiInsights()
        .then((insights) => {
          set({ aiInsights: insights, isLoading: false });
        })
        .catch(() => {
          set({ aiInsights: generateMockAiInsights(), isLoading: false });
        });
    } else {
      setTimeout(() => {
        set({ aiInsights: generateMockAiInsights(), isLoading: false });
      }, 300);
    }
  },

  loadWatchlist: () => {
    set({ isLoading: true });
    fetch('/api/watchlist', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.items) {
          set({ watchlist: data.items, isLoading: false });
        } else {
          set({ watchlist: [], isLoading: false });
        }
      })
      .catch(() => {
        // On error, just set empty watchlist (no mock fallback)
        set({ watchlist: [], isLoading: false });
      });
  },

  // Watchlist CRUD actions
  addToWatchlist: async (stockIdOrTicker: number | string, extras?: { alert_price_above?: number | null; alert_price_below?: number | null; alert_change_percent?: number | null; notes?: string | null }) => {
    try {
      const body = typeof stockIdOrTicker === 'number'
        ? { stock_id: stockIdOrTicker }
        : { ticker: stockIdOrTicker };
      if (extras) {
        if (extras.alert_price_above !== undefined) body.alert_price_above = extras.alert_price_above;
        if (extras.alert_price_below !== undefined) body.alert_price_below = extras.alert_price_below;
        if (extras.alert_change_percent !== undefined) body.alert_change_percent = extras.alert_change_percent;
        if (extras.notes !== undefined) body.notes = extras.notes;
      }
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        get().loadWatchlist(); // Refresh
        return { success: true, error: null };
      }
      return { success: false, error: data.error || 'فشل في إضافة السهم' };
    } catch { return { success: false, error: 'حدث خطأ في الاتصال' }; }
  },

  updateWatchlistItem: async (id: number, updates: { alert_price_above?: number | null; alert_price_below?: number | null; alert_change_percent?: number | null; notes?: string | null }) => {
    try {
      const res = await fetch(`/api/watchlist/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.success) {
        get().loadWatchlist(); // Refresh
        return { success: true, error: null };
      }
      return { success: false, error: data.error || 'فشل في تحديث السهم' };
    } catch { return { success: false, error: 'حدث خطأ في الاتصال' }; }
  },

  removeFromWatchlist: async (id: number) => {
    try {
      const res = await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        set({ watchlist: get().watchlist.filter((item) => item.id !== id) });
        return { success: true, error: null };
      }
      return { success: false, error: data.error || 'فشل في إزالة السهم' };
    } catch { return { success: false, error: 'حدث خطأ في الاتصال' }; }
  },

  // Portfolio CRUD actions
  addToPortfolio: async (stockIdOrTicker: number | string, quantity: number, avgBuyPrice: number) => {
    try {
      // API expects: stock_symbol, shares, avg_cost
      const body = {
        stock_symbol: typeof stockIdOrTicker === 'number' ? String(stockIdOrTicker) : stockIdOrTicker.toUpperCase(),
        shares: quantity,
        avg_cost: avgBuyPrice,
      };
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        get().loadPortfolio(); // Refresh
        return { success: true, error: null };
      }
      return { success: false, error: data.error || 'فشل في إضافة السهم' };
    } catch { return { success: false, error: 'حدث خطأ في الاتصال' }; }
  },

  updatePortfolioItem: async (id: number | string, updates: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/portfolio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      });
      const data = await res.json();
      if (data.success) {
        get().loadPortfolio();
        return { success: true, error: null };
      }
      return { success: false, error: data.error || 'فشل في تحديث السهم' };
    } catch { return { success: false, error: 'حدث خطأ في الاتصال' }; }
  },

  removeFromPortfolio: async (id: number | string) => {
    try {
      const res = await fetch(`/api/portfolio?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        get().loadPortfolio();
        return { success: true, error: null };
      }
      return { success: false, error: data.error || 'فشل في حذف السهم' };
    } catch { return { success: false, error: 'حدث خطأ في الاتصال' }; }
  },

  loadStockNews: (ticker, limit = 10) => {
    set({ stockNewsLoading: true, stockNews: null });

    if (USE_REAL_API) {
      apiClient.getStockNews(ticker.toUpperCase(), limit)
        .then((data) => {
          set({ stockNews: data, stockNewsLoading: false });
        })
        .catch(() => {
          set({ stockNews: null, stockNewsLoading: false });
        });
    } else {
      setTimeout(() => {
        set({ stockNews: null, stockNewsLoading: false });
      }, 500);
    }
  },

  loadV2Recommendations: () => {
    const state = get();
    // Prevent infinite retry loop: max 2 retries
    if (state.v2RetryCount >= 2 && !state.v2Data) {
      return;
    }
    set({ v2Loading: true, v2Error: null });

    if (USE_REAL_API) {
      fetch('/api/v2/recommend', { cache: 'no-store' })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data: RecommendResponse) => {
          set({ v2Data: data, v2Loading: false, v2Error: null, v2RetryCount: 0 });
        })
        .catch((err) => {
          const newRetryCount = state.v2RetryCount + 1;
          set({
            v2Data: null,
            v2Loading: false,
            v2Error: `Failed to load recommendations: ${err.message}`,
            v2RetryCount: newRetryCount,
          });
        });
    } else {
      setTimeout(() => {
        set({ v2Data: null, v2Loading: false, v2Error: null });
      }, 500);
    }
  },

  // UI
  isLoading: false,
  activeMobileTab: 'dashboard',
  setActiveMobileTab: (tab) => set({ activeMobileTab: tab }),
}));
