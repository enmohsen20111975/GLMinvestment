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

// API client that talks to our local Next.js API routes.
// These routes read directly from the egx_investment.db SQLite database.
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

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
      const url = `${BASE_URL}${path}`;
      const res = await fetch(url, { ...options, headers, cache: 'no-store' });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(errorData.detail || `HTTP ${res.status}`);
      }
      return res.json();
    } catch (error) {
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
  async getMarketOverview(): Promise<MarketOverview> {
    return this.request('/api/market/overview');
  }

  async getMarketIndices(): Promise<{ indices: MarketOverview['indices']; total: number }> {
    return this.request('/api/market/indices');
  }

  async getMarketStatus() {
    return this.request('/api/market/status');
  }

  async getAiInsights(): Promise<AiInsights> {
    return this.request('/api/market/recommendations/ai-insights');
  }

  // ==================== STOCKS ====================
  async getStocks(params?: {
    query?: string;
    search_field?: string;
    sector?: string;
    index?: string;
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
    return this.request(`/api/stocks/${ticker.toUpperCase()}/professional-analysis`);
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
