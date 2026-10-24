// Store constants — extracted (Phase 3)

export const MARKET_NAMES_AR: Record<MarketType, string> = {
  EGX: 'البورصة المصرية',
  TADAWUL: 'السوق السعودي',
  KSE: 'بورصة الكويت',
  QSE: 'بورصة قطر',
  US: 'البورصة الأمريكية',
  CRYPTO: 'العملات الرقمية',
};

export const MARKET_CODES: Record<MarketType, string> = {
  EGX: 'EGX',
  TADAWUL: 'KSA',
  KSE: 'KSE',
  QSE: 'QSE',
  US: 'US',
  CRYPTO: 'CRYPTO',
};

export const MARKET_CURRENCY_LABEL: Record<MarketType, string> = {
  EGX: 'ج.م',
  TADAWUL: 'ريال',
  KSE: 'د.ك',
  QSE: 'ر.ق',
  US: '$',
  CRYPTO: '$',
};

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

  assetPreference: hydrateFromStorage<AssetPreference>(ASSET_PREF_KEY, 'all'),
  pinnedWidgets: hydrateFromStorage<string[]>(PINNED_WIDGETS_KEY, []),
  setAssetPreference: (pref) => {
    set({ assetPreference: pref });
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(ASSET_PREF_KEY, JSON.stringify(pref));
      } catch { /* silent */ }
    }
  },
  togglePin: (widgetId) => {
    const current = get().pinnedWidgets;
    const next = current.includes(widgetId)
      ? current.filter((id) => id !== widgetId)
      : [...current, widgetId];
    set({ pinnedWidgets: next });
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(PINNED_WIDGETS_KEY, JSON.stringify(next));
      } catch { /* silent */ }
    }
  },
  isPinned: (widgetId) => get().pinnedWidgets.includes(widgetId),

  // P37-PHASE-2A: Display currency toggle (EGP / USD / SAR)
  // Hydrate from localStorage using the same JSON.stringify pattern as
  // `assetPreference` / `pinnedWidgets` so SSR + hydration stay consistent.
  displayCurrency: hydrateFromStorage<DisplayCurrency>(DISPLAY_CURRENCY_KEY, 'EGP'),
  setDisplayCurrency: (c) => {
    set({ displayCurrency: c });
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(DISPLAY_CURRENCY_KEY, JSON.stringify(c));
      }
    } catch { /* silent */ }
  },
  usdRate: 48.5,
  sarRate: 48.5 * SAR_PER_USD,
  setFxRates: (usd) => set({
    usdRate: usd,
    sarRate: usd * SAR_PER_USD,
  }),

  // P39-PHASE-1: Persona-Scaled Dynamic Analytics — risk profiler score.
  // Default 50 = balanced mid-point. Hydrate from localStorage on init.
  riskToleranceScore: hydrateFromStorage<number>(RISK_SCORE_KEY, 50),
  riskProfilerCompleted: hydrateFromStorage<boolean>(RISK_PROFILER_DONE_KEY, false),
  setRiskToleranceScore: (score) => {
    // Clamp 1..100 and persist. Then derive the active persona from the score
    // and reload v2 recommendations so the whole UI adapts in one shot.
    const clamped = Math.max(1, Math.min(100, Math.round(score)));
    set({ riskToleranceScore: clamped });
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(RISK_SCORE_KEY, JSON.stringify(clamped));
      }
    } catch { /* silent */ }
    // Lazy import to avoid circular dependency on module load.
    import('@/lib/persona-dynamic').then(({ scoreToPersona }) => {
      const derived = scoreToPersona(clamped);
      const current = get().persona;
      if (derived !== current) {
        get().setPersona(derived);
      }
    }).catch(() => { /* silent */ });
  },
  setRiskProfilerCompleted: (done) => {
    set({ riskProfilerCompleted: done });
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(RISK_PROFILER_DONE_KEY, JSON.stringify(done));
      }
    } catch { /* silent */ }
  },
}));
