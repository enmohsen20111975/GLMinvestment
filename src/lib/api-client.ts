import type {
  MarketOverview,
  StockListResponse,
  Stock,
  PriceHistoryResponse,
  DeepAnalysis,
  PortfolioRecommendResponse,
  PortfolioImpactResponse,
  UserAsset,
  WatchlistItem,
  IncomeExpense,
  AuthResponse,
  User,
  AiInsights,
} from '@/types';
import { trackApiError } from '@/lib/analytics';

// API client that talks to our own Next.js API routes (same-origin).
// These routes read directly from the stocks.db SQLite database.
const ENV_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

// If NEXT_PUBLIC_API_URL points at a different origin than the page we are
// served from, the browser fetch is cross-origin and fails unless that host
// sends CORS headers (the production API does not). Fall back to same-origin
// so local dev never hits a CORS wall.
function resolveBaseUrl(): string {
  if (!ENV_BASE_URL) return '';
  if (typeof window === 'undefined') return ENV_BASE_URL;
  try {
    return new URL(ENV_BASE_URL).origin === window.location.origin ? ENV_BASE_URL : '';
  } catch {
    return '';
  }
}

class ApiClient {
  private apiKey: string | null = null;

  setApiKey(key: string | null) {
    this.apiKey = key;
    if (typeof window !== 'undefined') {
      if (key) {
        localStorage.setItem('egx_api_key', key);
      } else {
        localStorage.removeItem('egx_api_key');
      }
    }
  }

  getApiKey(): string | null {
    if (this.apiKey) return this.apiKey;
    if (typeof window !== 'undefined') {
      this.apiKey = localStorage.getItem('egx_api_key');
    }
    return this.apiKey;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    const key = this.getApiKey();
    if (key) {
      headers['X-API-Key'] = key;
    }

    try {
      const url = `${resolveBaseUrl()}${path}`;
      const res = await fetch(url, { ...options, headers, cache: 'no-store' });
      if (!res.ok) {
        // P37-PHASE-4B: لما الـ session تنتهي، الـ API بين返回 401. نُطلق حدث
        // مخصّص على window عشان الـ SessionExpiredModal يعرض للمستخدم بدون
        // ما نقطع الـ throw chain (الـ caller لسه يقدر يعمل catch خاص بيه).
        if (res.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
        const errorData = await res.json().catch(() => ({ detail: res.statusText }));
        // USER-ANALYTICS-EMITTERS: track what problems each user encounters
        // (Rule 55 — fire-and-forget, never throws).
        trackApiError(path, `HTTP ${res.status}: ${errorData.detail || res.statusText}`);
        throw new Error(errorData.detail || `HTTP ${res.status}`);
      }
      return res.json();
    } catch (error) {
      // USER-ANALYTICS-EMITTERS: track network/parse errors too (fire-and-forget).
      // Guard against tracking the same error twice (HTTP errors are already tracked above).
      if (!(error instanceof Error && /^HTTP \d+/.test(error.message))) {
        trackApiError(path, error instanceof Error ? error.message : String(error));
      }
      throw error;
    }
  }

  // ==================== MARKET ====================
  async getGoldPrices(): Promise<Record<string, unknown>> {
    return this.request('/api/market/gold');
  }
  
  async getCurrencyRates(): Promise<Record<string, unknown>> {
    return this.request('/api/market/currency');
  }
  async getMarketOverview(market?: string): Promise<MarketOverview> {
    const params = market ? `?market=${market}` : '';
    return this.request(`/api/market/overview${params}`);
  }
  
  // ==================== EGXPILOT API ====================
  async getEgxPilotNews(limit: number = 10, query?: string): Promise<{ success: boolean; count: number; news: Array<any> }> {
    const params = new URLSearchParams();
    params.append('limit', limit.toString());
    if (query) {
      params.append('q', query);
    }
    return this.request(`/api/egxpilot/news${params.toString() ? `?${params.toString()}` : ''}`);
  }
  
  async getEgxPilotAiAnalysis(ticker: string): Promise<{ success: boolean; symbol: string; analysis: any }> {
    return this.request(`/api/egxpilot/ai/${ticker.toUpperCase()}`);
  }
  
  async getEgxPilotGoldenStocks(limit: number = 10): Promise<{ success: boolean; count: number; opportunities: Array<any> }> {
    const params = new URLSearchParams();
    params.append('limit', limit.toString());
    return this.request(`/api/egxpilot/golden-stocks${params.toString() ? `?${params.toString()}` : ''}`);
  }
  
  async getEgxPilotHealth(): Promise<{ success: boolean; data: any }> {
    return this.request(`/api/egxpilot/health`);
  }

  async getMarketIndices(): Promise<{ indices: MarketOverview['indices']; total: number }> {
    return this.request('/api/market/indices');
  }

  async getMarketStatus() {
    return this.request('/api/market/status');
  }

  async getAiInsights(market?: string): Promise<AiInsights> {
    const params = market ? `?market=${market}` : '';
    return this.request(`/api/market/recommendations/ai-insights${params}`);
  }

  // ==================== STOCKS ====================
  async getStocks(params?: {
    query?: string;
    search_field?: string;
    sector?: string;
    index?: string;
    market?: string;
    page?: number;
    page_size?: number;
  }): Promise<StockListResponse> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') {
          searchParams.set(key, String(val));
        }
      });
    }
    const qs = searchParams.toString();
    return this.request(`/api/stocks${qs ? `?${qs}` : ''}`);
  }

  async getStock(ticker: string): Promise<{ data: Stock }> {
    return this.request(`/api/stocks/${ticker.toUpperCase()}`);
  }

  async getStockHistory(ticker: string, days = 30): Promise<PriceHistoryResponse> {
    return this.request(`/api/stocks/${ticker.toUpperCase()}/history?days=${days}`);
  }

  async getStockRecommendation(ticker: string): Promise<DeepAnalysis> {
    return this.request(`/api/stocks/${ticker.toUpperCase()}/recommendation`);
  }

  async getProfessionalAnalysis(ticker: string): Promise<Record<string, unknown>> {
    // Task PHASE5-SCREENS-P1: /api/stocks/X/professional-analysis is 410 Gone (deprecated).
    // Redirected to canonical unified endpoint (Rule 72 + Rule 73).
    return this.request(`/api/stocks/${ticker.toUpperCase()}/unified`);
  }

  async getStockNews(ticker: string, limit = 10): Promise<Record<string, unknown>> {
    return this.request(`/api/stocks/${ticker.toUpperCase()}/news?limit=${limit}`);
  }

  async searchStocks(query: string): Promise<{ results: Stock[]; total: number }> {
    return this.request(`/api/stocks?query=${encodeURIComponent(query)}&page_size=20`);
  }

  // ==================== PORTFOLIO ====================
  async getPortfolioRecommendation(params: {
    capital: number;
    risk?: string;
    max_stocks?: number;
  }): Promise<PortfolioRecommendResponse> {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null) {
        searchParams.set(key, String(val));
      }
    });
    return this.request(`/api/portfolio/recommend?${searchParams.toString()}`);
  }

  async getAdvancedRecommendation(body: {
    capital: number;
    risk?: string;
    max_stocks?: number;
    sectors?: string[];
    exclude_tickers?: string[];
    investment_horizon?: string;
  }): Promise<PortfolioRecommendResponse> {
    return this.request('/api/portfolio/recommend/advanced', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ==================== USER DATA ====================
  async getWatchlist(): Promise<WatchlistItem[]> {
    return this.request('/api/user/watchlist');
  }

  async addToWatchlist(body: {
    ticker: string;
    alert_price_above?: number;
    alert_price_below?: number;
    alert_change_percent?: number;
    notes?: string;
  }): Promise<WatchlistItem> {
    return this.request('/api/user/watchlist', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async removeFromWatchlist(itemId: number): Promise<void> {
    return this.request(`/api/user/watchlist/${itemId}`, { method: 'DELETE' });
  }

  async getAssets(assetType?: string): Promise<UserAsset[]> {
    const qs = assetType ? `?asset_type=${assetType}` : '';
    return this.request(`/api/user/assets${qs}`);
  }

  async createAsset(body: Partial<UserAsset>): Promise<UserAsset> {
    return this.request('/api/user/assets', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateAsset(assetId: number, body: Partial<UserAsset>): Promise<UserAsset> {
    return this.request(`/api/user/assets/${assetId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async deleteAsset(assetId: number): Promise<void> {
    return this.request(`/api/user/assets/${assetId}`, { method: 'DELETE' });
  }

  async getPortfolioImpact(): Promise<PortfolioImpactResponse> {
    return this.request('/api/user/portfolio-impact');
  }

  async getIncomeExpense(params?: {
    transaction_type?: string;
    category?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<IncomeExpense[]> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          searchParams.set(key, String(val));
        }
      });
    }
    const qs = searchParams.toString();
    return this.request(`/api/user/income-expense${qs ? `?${qs}` : ''}`);
  }

  async createIncomeExpense(body: Partial<IncomeExpense>): Promise<IncomeExpense> {
    return this.request('/api/user/income-expense', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async deleteIncomeExpense(transactionId: number): Promise<void> {
    return this.request(`/api/user/income-expense/${transactionId}`, { method: 'DELETE' });
  }

  // ==================== AUTH ====================
  async register(body: {
    email: string;
    username: string;
    password: string;
    default_risk_tolerance?: string;
  }): Promise<AuthResponse> {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async login(body: {
    username_or_email: string;
    password: string;
  }): Promise<AuthResponse> {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async googleLogin(idToken: string): Promise<AuthResponse> {
    return this.request('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken }),
    });
  }

  async getMe(): Promise<User> {
    return this.request('/api/auth/me');
  }

  async logout(): Promise<void> {
    return this.request('/api/auth/logout', { method: 'POST' });
  }
}

export const apiClient = new ApiClient();
