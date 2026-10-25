// store actions slice — extracted (Phase 3)

  TADAWUL: 'KSA',
  KSE: 'KSE',
  QSE: 'QSE',
  US: 'US',
  CRYPTO: 'CRYPTO',
};

// Currency label per market (used in price displays)
export const MARKET_CURRENCY_LABEL: Record<MarketType, string> = {
  EGX: 'ج.م',
  TADAWUL: 'ريال',
  KSE: 'د.ك',
  QSE: 'ر.ق',
  US: '$',
  CRYPTO: '$',
};

// Asset preference type — what does the user trade?
export type AssetPreference = 'stocks' | 'crypto' | 'gold' | 'all';

// localStorage keys for personalization (P5-MOBILE-UX)
const ASSET_PREF_KEY = 'egx-asset-preference';
const PINNED_WIDGETS_KEY = 'egx-pinned-widgets';
// P37-PHASE-2A: Display currency toggle (EGP / USD / SAR)
const DISPLAY_CURRENCY_KEY = 'display_currency';
// P39-PHASE-1: Risk profiler score + completion flag (persisted locally per user)
const RISK_SCORE_KEY = 'risk_tolerance_score';
const RISK_PROFILER_DONE_KEY = 'risk_profiler_completed';
// Market switching — persist selected market across page refreshes (owner directive)
const CURRENT_MARKET_KEY = 'egx_current_market';

// P37-PHASE-2A: Display currency union type — wealth/portfolio values are always
// computed in EGP; this toggle only changes how the UI *renders* the totals.
export type DisplayCurrency = 'EGP' | 'USD' | 'SAR';
// SAR is pegged to USD at a fixed 3.75 rate, so we only ever need to track
// the USD→EGP rate and derive SAR→EGP from it.
const SAR_PER_USD = 3.75;

/**
 * Hydrate a value from localStorage (safe for SSR / non-browser envs).
 */
function hydrateFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface AppStore {
  // Navigation
  currentView: AppView;
  previousView: AppView | null;
  selectedTicker: string | null;
  sidebarOpen: boolean;
  currentMarket: MarketType;
  // ALPHA-CHART-TOGGLE-1: user chart preference (TradingView iframe vs InteractiveChart)
  chartPreference: 'tradingview' | 'interactive';
  setChartPreference: (pref: 'tradingview' | 'interactive') => void;
  setCurrentView: (view: AppView) => void;
  setCurrentViewFromHash: (view: AppView) => void;
  setSelectedTicker: (ticker: string | null) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  goBack: () => void;
  setCurrentMarket: (market: MarketType) => void;

  // Deal Advisor prefill (from Portfolio / Watchlist → TradingChartView)
  // Allows the user to jump into #trading-chart with a pre-filled entry price
  // and quantity so the Deal Advisor panel can assess their position.
  dealAdvisorPrefill: {
    ticker: string | null;
    entryPrice: number | null;
    entryQty: number | null;
    source: 'portfolio' | 'watchlist' | null;
  };
  setDealAdvisorPrefill: (prefill: {
    ticker: string | null;
    entryPrice?: number | null;
    entryQty?: number | null;
    source?: 'portfolio' | 'watchlist' | null;
  }) => void;
  clearDealAdvisorPrefill: () => void;

  // Auth
  user: User | null;
  apiKey: string | null;
  setUser: (user: User | null) => void;
  setApiKey: (key: string | null) => void;
  syncFromSession: (session: Session | null) => void;
  logout: () => void;

  // Auth Gate (Task 13): track login state and prompt modal
  authChecked: boolean;            // true after first /api/auth/me check completes
  isAuthenticated: boolean;        // derived from user presence
  showLoginPrompt: boolean;        // controls LoginPromptModal visibility
  setShowLoginPrompt: (open: boolean) => void;
  setAuthChecked: (checked: boolean) => void;
  setAuthenticated: (authed: boolean) => void;
  /**
   * If the user is not authenticated, opens the login prompt modal
   * and returns false. Otherwise returns true (caller may proceed).
   */
  requireAuth: () => boolean;

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
  persona: PersonaType;
  egxPilotNews: Array<{ title?: string; summary?: string; timestamp?: number }> | null;
  egxPilotNewsLoading: boolean;

  // Actions
  setSearchQuery: (query: string) => void;
  loadDashboard: () => void;
  loadStocks: (query?: string, page?: number) => void;
  /** Unified crypto loader — fetches /api/crypto/live and adapts coins into the
   *  same `stocks` array so StocksView / analysis tabs render crypto exactly
   *  like EGX stocks (UI-mirror protocol). */
  loadCryptoList: () => void;
  refreshLivePrices: () => void;
  loadStockDetail: (ticker: string) => void;
  loadProfessionalAnalysis: (ticker: string) => void;
  loadPortfolio: () => void;
  loadAiInsights: () => void;
  loadWatchlist: () => void;
  loadStockNews: (ticker: string, limit?: number) => void;
  loadV2Recommendations: (persona?: PersonaType) => void;
  setPersona: (persona: PersonaType) => void;
  loadEgxPilotNews: (limit?: number) => void;

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

  // P5-MOBILE-UX: Personalization (asset preference + pinned widgets)
  assetPreference: AssetPreference;
  pinnedWidgets: string[];
  setAssetPreference: (pref: AssetPreference) => void;
  togglePin: (widgetId: string) => void;
  isPinned: (widgetId: string) => boolean;

  // P37-PHASE-2A: Display currency toggle (EGP / USD / SAR)
  // NOTE: All wealth/portfolio math stays in EGP on the backend. This toggle
  // only controls how the UI *renders* totals. Persistence mirrors the
  // personalization pattern above (JSON.stringify via hydrateFromStorage).
  displayCurrency: DisplayCurrency;
  setDisplayCurrency: (c: DisplayCurrency) => void;
  usdRate: number;          // USD→EGP rate (default 48.5; refreshed by Phase 2-b)
  sarRate: number;          // SAR→EGP rate, derived = usdRate * 3.75 (fixed peg)
  setFxRates: (usd: number) => void;

  // P39-PHASE-1: Persona-Scaled Dynamic Analytics Engine.
  // riskToleranceScore (1..100) is computed by the DynamicRiskProfilerModal
  // questionnaire and persisted alongside the active persona. When the score
  // changes, the active persona is recomputed via scoreToPersona() and the
  // v2 recommendations are reloaded.
  riskToleranceScore: number;
  setRiskToleranceScore: (score: number) => void;
  /** True until the user has completed the profiler at least once. */
  riskProfilerCompleted: boolean;
  setRiskProfilerCompleted: (done: boolean) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // Navigation
  currentView: 'dashboard',
  previousView: null,
  selectedTicker: null,
  sidebarOpen: false,
  currentMarket: hydrateFromStorage<MarketType>(CURRENT_MARKET_KEY, 'EGX'),
  chartPreference: hydrateFromStorage<'tradingview' | 'interactive'>('chart-pref', 'interactive'),
  setChartPreference: (pref) => {
    set({ chartPreference: pref });
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('chart-pref', JSON.stringify(pref));
      }
    } catch { /* silent */ }
  },
  setCurrentMarket: (market) => {
    set({ currentMarket: market });
    // persist to localStorage (survives page refresh)
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(CURRENT_MARKET_KEY, JSON.stringify(market));
      }
    } catch { /* silent */ }
    // FIX (Oct 2026 — owner directive "لا يوجد تغير اتوماتيكى للعملة"):
    // auto-sync displayCurrency to match the selected market so currency labels
    // follow the market automatically. EGX→EGP, TADAWUL→SAR, US/CRYPTO→USD.
    // KSE/QSE fall back to USD (KWD/QAR not in DisplayCurrency union — Rule 4: extend type only if needed).
    const MARKET_DEFAULT_CURRENCY: Record<MarketType, DisplayCurrency> = {
      EGX: 'EGP',
      TADAWUL: 'SAR',
      US: 'USD',
      CRYPTO: 'USD',
      KSE: 'USD',
      QSE: 'USD',
    };
    const newCurrency = MARKET_DEFAULT_CURRENCY[market];
    if (newCurrency && newCurrency !== get().displayCurrency) {
      set({ displayCurrency: newCurrency });
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(DISPLAY_CURRENCY_KEY, JSON.stringify(newCurrency));
        }
      } catch { /* silent */ }
    }
    // FIX (Aug 2026): شيلنا window.__currentMarket — كل الـ components دلوقتي بتستخدم useAppStore مباشرة
    // Crypto uses a unified loader that adapts coins into the stocks array
    if (market === 'CRYPTO') {
      get().loadCryptoList();
      // Reload recommendations for the new market (crypto-aware endpoint)
      get().loadV2Recommendations();
      return;
    }
    // Reload stocks for the new market
    get().loadStocks('', 1);
    // Reload dashboard data
    get().loadDashboard();
    // Reload recommendations for the new market
    get().loadV2Recommendations();
    // FIX (Oct 2026 — owner directive): reload secondary stores too
    // لو الـ views دي مرفوعة (mounted)، هتـ re-fetch تلقائياً
    try {
      get().loadWatchlist?.();
      get().loadPortfolio?.();
      get().loadAiInsights?.();
    } catch { /* silent — لو الـ function مش معرّفة */ }
  },
  setCurrentView: (view) => {
    set({ currentView: view, previousView: get().currentView });
    try {
      if (typeof window !== 'undefined') {
        const newHash = view === 'dashboard' ? '' : `#${view}`;
        if (window.location.hash !== newHash && view !== 'stock-detail') {
          window.history.pushState({ view }, '', newHash || window.location.pathname);
        }
      }
    } catch { /* silent */ }
  },
  setCurrentViewFromHash: (view) => {
    set({ currentView: view, previousView: get().currentView });
  },
  setSelectedTicker: (ticker) => set({ selectedTicker: ticker }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  goBack: () => {
    const prev = get().previousView;
    if (prev) set({ currentView: prev, previousView: null });
  },

  // Deal Advisor prefill (from Portfolio / Watchlist → TradingChartView)
  dealAdvisorPrefill: {
    ticker: null,
    entryPrice: null,
    entryQty: null,
    source: null,
  },
  setDealAdvisorPrefill: (prefill) =>
    set((s) => ({
      dealAdvisorPrefill: {
        ticker: prefill.ticker,
        entryPrice: prefill.entryPrice ?? s.dealAdvisorPrefill.entryPrice,
        entryQty: prefill.entryQty ?? s.dealAdvisorPrefill.entryQty,
        source: prefill.source ?? s.dealAdvisorPrefill.source,
      },
    })),
  clearDealAdvisorPrefill: () =>
    set({ dealAdvisorPrefill: { ticker: null, entryPrice: null, entryQty: null, source: null } }),
