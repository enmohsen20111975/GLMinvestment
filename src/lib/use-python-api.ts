/**
 * Python API Hook - THE BRAIN
 * ============================
 * 
 * Hook مخصص للاتصال بـ Python Backend
 * كل المنطق في Python - Node.js للعرض فقط
 * 
 * Architecture: Python = THE BRAIN, Node.js = DISPLAY ONLY
 * المعمارية: بايثون = الدماغ، نود جي إس = العرض فقط
 */

import { useState, useEffect, useCallback } from 'react';

// Base URL for Python backend via proxy
const PYTHON_PROXY_URL = '/api/python';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Hook للاتصال بـ Python Backend
 */
export function usePythonApi<T>(
  endpoint: string,
  options?: {
    autoFetch?: boolean;
    params?: Record<string, string | number | boolean>;
  }
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const url = new URL(`${PYTHON_PROXY_URL}${endpoint}`, window.location.origin);
      
      if (options?.params) {
        Object.entries(options.params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            url.searchParams.append(key, String(value));
          }
        });
      }

      const response = await fetch(url.toString());
      const result: ApiResponse<T> = await response.json();

      if (result.success) {
        setData(result.data || null);
      } else {
        setError(result.error || 'حدث خطأ في جلب البيانات');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [endpoint, options?.params]);

  useEffect(() => {
    if (options?.autoFetch !== false) {
      fetchData();
    }
  }, [fetchData, options?.autoFetch]);

  return { data, loading, error, refetch: fetchData };
}

/**
 * Helper functions للـ Python Backend API
 * Python = THE BRAIN - كل المنطق هنا
 */
export const pythonApi = {
  // ==================== HEALTH ====================
  
  async health() {
    const response = await fetch(`${PYTHON_PROXY_URL}/health`);
    return response.json();
  },

  // ==================== STOCKS ====================
  
  async getStocks(params?: { sector?: string; limit?: number }) {
    const url = new URL(`${PYTHON_PROXY_URL}/stocks`, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.append(key, String(value));
      });
    }
    const response = await fetch(url.toString());
    return response.json();
  },

  async getStock(symbol: string) {
    const response = await fetch(`${PYTHON_PROXY_URL}/stocks/${symbol}`);
    return response.json();
  },

  async getStockHistory(symbol: string, days: number = 365) {
    const response = await fetch(
      `${PYTHON_PROXY_URL}/stocks/${symbol}/history?days=${days}`
    );
    return response.json();
  },

  // ==================== ANALYSIS ====================
  
  async analyzeStock(symbol: string, days: number = 365) {
    const response = await fetch(
      `${PYTHON_PROXY_URL}/analysis/${symbol}?days=${days}`
    );
    return response.json();
  },

  // ==================== RECOMMENDATIONS ====================
  
  async getRecommendations(params?: { limit?: number; action?: string }) {
    const url = new URL(`${PYTHON_PROXY_URL}/recommendations`, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.append(key, String(value));
      });
    }
    const response = await fetch(url.toString());
    return response.json();
  },

  async getRecommendation(symbol: string) {
    const response = await fetch(`${PYTHON_PROXY_URL}/recommendations/${symbol}`);
    return response.json();
  },

  // ==================== MARKET ====================
  
  async getMarketOverview() {
    const response = await fetch(`${PYTHON_PROXY_URL}/market/overview`);
    return response.json();
  },

  async getTopGainers(limit: number = 10) {
    const response = await fetch(`${PYTHON_PROXY_URL}/market/top-gainers?limit=${limit}`);
    return response.json();
  },

  async getTopLosers(limit: number = 10) {
    const response = await fetch(`${PYTHON_PROXY_URL}/market/top-losers?limit=${limit}`);
    return response.json();
  },

  async getMostActive(limit: number = 10) {
    const response = await fetch(`${PYTHON_PROXY_URL}/market/most-active?limit=${limit}`);
    return response.json();
  },

  // ==================== WATCHLIST ====================
  
  async getWatchlist() {
    const response = await fetch(`${PYTHON_PROXY_URL}/watchlist`);
    return response.json();
  },

  async addToWatchlist(ticker: string) {
    const response = await fetch(`${PYTHON_PROXY_URL}/watchlist?ticker=${ticker}`, {
      method: 'POST',
    });
    return response.json();
  },

  async removeFromWatchlist(ticker: string) {
    const response = await fetch(`${PYTHON_PROXY_URL}/watchlist/${ticker}`, {
      method: 'DELETE',
    });
    return response.json();
  },

  // ==================== SEARCH ====================
  
  async searchStocks(q: string, limit: number = 20) {
    const response = await fetch(`${PYTHON_PROXY_URL}/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    return response.json();
  },

  // ==================== SECTORS ====================
  
  async getSectors() {
    const response = await fetch(`${PYTHON_PROXY_URL}/sectors`);
    return response.json();
  },

  // ==================== SCREENER ====================
  
  async screenStocks(params?: {
    min_price?: number;
    max_price?: number;
    min_volume?: number;
    sector?: string;
    limit?: number;
  }) {
    const url = new URL(`${PYTHON_PROXY_URL}/screener`, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.append(key, String(value));
      });
    }
    const response = await fetch(url.toString());
    return response.json();
  },

  // ==================== BACKTEST ====================
  
  async backtest(symbol: string, params?: { days?: number; holding_period?: number }) {
    const url = new URL(`${PYTHON_PROXY_URL}/backtest/${symbol}`, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.append(key, String(value));
      });
    }
    const response = await fetch(url.toString());
    return response.json();
  },

  // ==================== MAESTRO - THE CONDUCTOR ====================
  // المايسترو - القائد (Python = THE BRAIN)
  
  /**
   * حالة نظام المايسترو
   */
  async getMaestroStatus() {
    const response = await fetch(`${PYTHON_PROXY_URL}/maestro/status`);
    return response.json();
  },

  /**
   * تحليل سهم واحد بالمايسترو
   */
  async analyzeStockMaestro(ticker: string, options?: { 
    persona?: string; 
    force_regime?: 'bull' | 'bear' | 'range' 
  }) {
    const url = new URL(`${PYTHON_PROXY_URL}/maestro/stock/${ticker}`, window.location.origin);
    if (options) {
      Object.entries(options).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.append(key, String(value));
      });
    }
    const response = await fetch(url.toString());
    return response.json();
  },

  /**
   * تشغيل تحليل المايسترو على كل الأسهم
   */
  async runMaestroAnalysis(options?: { persona?: string; limit?: number }) {
    const response = await fetch(`${PYTHON_PROXY_URL}/maestro/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    });
    return response.json();
  },

  /**
   * سجل إشارات المايسترو
   */
  async getMaestroSignals(params?: { 
    limit?: number; 
    direction?: string; 
    outcome?: string;
    stats?: boolean;
  }) {
    const url = new URL(`${PYTHON_PROXY_URL}/maestro/signals`, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.append(key, String(value));
      });
    }
    const response = await fetch(url.toString());
    return response.json();
  },

  /**
   * حالة Circuit Breaker
   */
  async getCircuitBreaker() {
    const response = await fetch(`${PYTHON_PROXY_URL}/maestro/circuit-breaker`);
    return response.json();
  },

  /**
   * نظرة عامة على السوق
   */
  async getMaestroOverview() {
    const response = await fetch(`${PYTHON_PROXY_URL}/maestro/overview`);
    return response.json();
  },

  /**
   * فحص سريع للسوق - أفضل 10 فرص
   */
  async quickScan() {
    const response = await fetch(`${PYTHON_PROXY_URL}/maestro/quick-scan`);
    return response.json();
  },

  /**
   * فحص أخبار سهم معين
   */
  async checkStockNews(ticker: string, days: number = 1) {
    const response = await fetch(
      `${PYTHON_PROXY_URL}/maestro/news-check/${ticker}?days=${days}`
    );
    return response.json();
  },

  /**
   * نتائج التحليل الأخيرة
   */
  async getMaestroResults() {
    const response = await fetch(`${PYTHON_PROXY_URL}/maestro/results`);
    return response.json();
  },

  // ==================== UNIFIED LEARNING - THE BRAIN ====================
  // التعلم الموحد - الدماغ (Python = THE BRAIN)
  
  /**
   * حالة نظام التعلم
   */
  async getLearningStatus() {
    const response = await fetch(`${PYTHON_PROXY_URL}/unified-learning/status`);
    return response.json();
  },

  /**
   * تشغيل التعلم التكراري
   */
  async runIterativeLearning(options: {
    persona?: string;
    target_win_rate?: number;
    max_iterations?: number;
  } = {}) {
    const response = await fetch(`${PYTHON_PROXY_URL}/unified-learning/iterative`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    return response.json();
  },

  /**
   * تشغيل التعلم الذكي (Bayesian Optimization)
   */
  async runIntelligentLearning(options: {
    target_win_rate?: number;
    max_iterations?: number;
    custom_params?: Record<string, number>;
  } = {}) {
    const response = await fetch(`${PYTHON_PROXY_URL}/unified-learning/intelligent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    return response.json();
  },

  /**
   * درجات الثقة للمؤشرات
   */
  async getIndicatorScores() {
    const response = await fetch(`${PYTHON_PROXY_URL}/unified-learning/indicators`);
    return response.json();
  },

  /**
   * تحليل المرآة لصفقة
   */
  async runMirrorAnalysis(tradeId: number) {
    const response = await fetch(
      `${PYTHON_PROXY_URL}/unified-learning/mirror/${tradeId}`,
      { method: 'POST' }
    );
    return response.json();
  },

  /**
   * الأنماط المكتشفة
   */
  async getPatterns(monthsBack: number = 1) {
    const response = await fetch(
      `${PYTHON_PROXY_URL}/unified-learning/patterns?months_back=${monthsBack}`
    );
    return response.json();
  },

  /**
   * القيمة المتوقعة للمؤشرات
   */
  async getExpectancy(regime?: string) {
    const url = new URL(`${PYTHON_PROXY_URL}/unified-learning/expectancy`, window.location.origin);
    if (regime) {
      url.searchParams.append('regime', regime);
    }
    const response = await fetch(url.toString());
    return response.json();
  },

  /**
   * تعدين الدروس
   */
  async mineLessons() {
    const response = await fetch(`${PYTHON_PROXY_URL}/unified-learning/mine-lessons`, {
      method: 'POST',
    });
    return response.json();
  },

  /**
   * ملخص شامل لحالة التعلم
   */
  async getLearningSummary() {
    const response = await fetch(`${PYTHON_PROXY_URL}/unified-learning/summary`);
    return response.json();
  },

  /**
   * إيقاف التعلم الجاري
   */
  async stopLearning() {
    const response = await fetch(`${PYTHON_PROXY_URL}/unified-learning/stop`, {
      method: 'POST',
    });
    return response.json();
  },

  /**
   * الشخصيات المتاحة
   */
  async getPersonas() {
    const response = await fetch(`${PYTHON_PROXY_URL}/unified-learning/personas`);
    return response.json();
  },
};

export default pythonApi;
