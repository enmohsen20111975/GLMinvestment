/**
 * API Configuration
 * =================
 * تكوين الاتصال بـ Python Backend
 *
 * Next.js Frontend talks ONLY to Python FastAPI Backend
 * Uses proxy route for CORS-free communication
 */

// Use empty string for relative URLs (direct Next.js API routes)
// The Next.js API routes handle data fetching from database
const getBaseUrl = () => {
  // Use direct Next.js API routes (no Python backend needed)
  return '';
};

// API Endpoints
export const API_ENDPOINTS = {
  // Health
  health: '/health',
  root: '/',
  
  // Stocks
  stocks: '/api/stocks',
  stock: (symbol: string) => `/api/stocks/${symbol}`,
  stockHistory: (symbol: string) => `/api/stocks/${symbol}/history`,
  
  // Analysis
  analysis: (symbol: string) => `/api/analysis/${symbol}`,
  
  // Recommendations
  recommendations: '/api/recommendations',
  recommendation: (symbol: string) => `/api/recommendations/${symbol}`,
  
  // Market
  marketOverview: '/api/market/overview',
  topGainers: '/api/market/top-gainers',
  topLosers: '/api/market/top-losers',
  mostActive: '/api/market/most-active',
  
  // Backtesting
  backtest: (symbol: string) => `/api/backtest/${symbol}`,
  
  // Screener
  screener: '/api/screener',
  
  // Watchlist
  watchlist: '/api/watchlist',
  watchlistItem: (ticker: string) => `/api/watchlist/${ticker}`,
  
  // Search
  search: '/api/search',
  
  // Sectors
  sectors: '/api/sectors',
} as const;

// API Client
class ApiClient {
  private getBaseUrl: () => string;
  
  constructor() {
    this.getBaseUrl = getBaseUrl;
  }
  
  async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const url = new URL(`${baseUrl}${endpoint}`, baseUrl.startsWith('http') ? undefined : window.location.origin);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }
  
  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const url = baseUrl.startsWith('http') 
      ? `${baseUrl}${endpoint}` 
      : `${window.location.origin}${baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }
  
  async delete<T>(endpoint: string): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const url = baseUrl.startsWith('http') 
      ? `${baseUrl}${endpoint}` 
      : `${window.location.origin}${baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Convenience functions
export const api = {
  // Health check
  health: () => apiClient.get(API_ENDPOINTS.health),
  
  // Stocks
  getStocks: (params?: { sector?: string; limit?: number }) => 
    apiClient.get(API_ENDPOINTS.stocks, params),
  
  getStock: (symbol: string) => 
    apiClient.get(API_ENDPOINTS.stock(symbol)),
  
  getStockHistory: (symbol: string, days?: number) => 
    apiClient.get(API_ENDPOINTS.stockHistory(symbol), { days }),
  
  // Analysis
  analyzeStock: (symbol: string, days?: number) => 
    apiClient.get(API_ENDPOINTS.analysis(symbol), { days }),
  
  // Recommendations
  getRecommendations: (params?: { limit?: number; action?: string }) => 
    apiClient.get(API_ENDPOINTS.recommendations, params),
  
  getRecommendation: (symbol: string) => 
    apiClient.get(API_ENDPOINTS.recommendation(symbol)),
  
  // Market
  getMarketOverview: () => 
    apiClient.get(API_ENDPOINTS.marketOverview),
  
  getTopGainers: (limit?: number) => 
    apiClient.get(API_ENDPOINTS.topGainers, { limit }),
  
  getTopLosers: (limit?: number) => 
    apiClient.get(API_ENDPOINTS.topLosers, { limit }),
  
  getMostActive: (limit?: number) => 
    apiClient.get(API_ENDPOINTS.mostActive, { limit }),
  
  // Backtesting
  backtest: (symbol: string, params?: { days?: number; holding_period?: number }) => 
    apiClient.get(API_ENDPOINTS.backtest(symbol), params),
  
  // Screener
  screenStocks: (params?: {
    min_price?: number;
    max_price?: number;
    min_volume?: number;
    min_rsi?: number;
    max_rsi?: number;
    sector?: string;
    limit?: number;
  }) => apiClient.get(API_ENDPOINTS.screener, params),
  
  // Watchlist
  getWatchlist: () => 
    apiClient.get(API_ENDPOINTS.watchlist),
  
  addToWatchlist: (ticker: string) => 
    apiClient.post(`${API_ENDPOINTS.watchlist}?ticker=${ticker}`),
  
  removeFromWatchlist: (ticker: string) => 
    apiClient.delete(API_ENDPOINTS.watchlistItem(ticker)),
  
  // Search
  searchStocks: (q: string, limit?: number) => 
    apiClient.get(API_ENDPOINTS.search, { q, limit }),
  
  // Sectors
  getSectors: () => 
    apiClient.get(API_ENDPOINTS.sectors),
};

export default api;
