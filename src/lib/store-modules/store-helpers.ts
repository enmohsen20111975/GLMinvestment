// store helper functions — extracted (Phase 3)

  const calibratedScore = Math.round(((pulseScore + 5) / 10) * 100);
  const clampedScore = Math.max(0, Math.min(100, calibratedScore));

  // ALPHA-P0: حساب نسبة الصاعدين الفعلية من gainers/losers
  const totalStocks = gainersCount + losersCount + unchangedCount;
  const advancersPct = totalStocks > 0 ? (gainersCount / totalStocks) * 100 : 50;

  return {
    market_sentiment,
    market_score: clampedScore,
    market_breadth: Math.round(market_breadth * 100) / 100,
    avg_change_percent: avgChange,
    volatility_index: Math.round((1 - (clampedScore / 100)) * 100) / 100,
    gainers: gainersCount,
    losers: losersCount,
    unchanged: unchangedCount,
    top_sectors,
    stock_statuses,
    decision: divergenceAction === 'BUY' ? 'شراء' : divergenceAction === 'SELL' ? 'بيع' : divergenceAction === 'CAUTION' ? 'حذر' : 'محايد',
    risk_assessment,
    generated_at: new Date().toISOString(),
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
      date: String(d.date || '').split('T')[0],
      open: (d.open as number) || 0,
      high: (d.high as number) || 0,
      low: (d.low as number) || 0,
      close: (d.close as number) || 0,
      volume: (d.volume as number) || 0,
    })),
    summary: {
      highest: (summary.highest as number) || (summary.high_price as number) || Math.max(...prices, 0),
      lowest: (summary.lowest as number) || (summary.low_price as number) || Math.min(...prices, 0),
      avg_price: (summary.avg_price as number) || (prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0),
      total_volume: (summary.total_volume as number) || data.reduce((sum, d) => sum + ((d.volume as number) || 0), 0),
      start_price: (summary.start_price as number) || (prices.length > 0 ? prices[0] : 0),
      end_price: (summary.end_price as number) || (prices.length > 0 ? prices[prices.length - 1] : 0),
      change_percent: (summary.change_percent as number) || (summary.price_change_percent as number) || 0,
    },
    days: (raw.days as number) || 30,
  };
}

/**
 * Transform backend recommendation response to match frontend DeepAnalysis type.
 * Supports both legacy flat format and professional-analysis nested format.
 */
function adaptDeepAnalysis(raw: Record<string, unknown>, stock: Stock): DeepAnalysis {
  const analysis = (raw.analysis as Record<string, unknown>) || raw;
  const rec = ((analysis.recommendation as Record<string, unknown>) || (raw.recommendation as Record<string, unknown>) || {}) as Record<string, unknown>;
  const scores = ((analysis.scores as Record<string, unknown>) || (raw.scores as Record<string, unknown>) || {}) as Record<string, unknown>;
  const trend = ((analysis.trend as Record<string, unknown>) || (raw.trend as Record<string, unknown>) || {}) as Record<string, unknown>;
  const priceRange = ((analysis.price_levels as Record<string, unknown>) || (raw.price_range as Record<string, unknown>) || {}) as Record<string, unknown>;
  const indicators = ((analysis.indicators as Record<string, unknown>) || {}) as Record<string, unknown>;
  const rsiInfo = (indicators.rsi as Record<string, unknown>) || {};
  const keyStrengths = (raw.key_strengths as Array<Record<string, unknown>>) || [];
  const keyRisks = (raw.key_risks as Array<Record<string, unknown>>) || [];

  const action = ((rec.action as string) || 'hold').toLowerCase();
  const actionUpper = (rec.action as string) || 'HOLD';
  const actionArMap: Record<string, string> = {
    strong_buy: 'شراء قوي',
    buy: 'شراء',
    hold: 'احتفاظ',
    sell: 'بيع',
    strong_sell: 'بيع قوي',
    accumulate: 'تجميع',
    reduce: 'تخفيض',
    STRONG_BUY: 'شراء قوي',
    BUY: 'شراء',
    HOLD: 'احتفاظ',
    SELL: 'بيع',
    STRONG_SELL: 'بيع قوي',
    ACCUMULATE: 'تجميع',
    REDUCE: 'تخفيض',
  };

  const trendDir = ((trend.direction as string) || 'sideways').toLowerCase();
  const trendUpper = (trend.direction as string) || 'SIDEWAYS';
  const trendArMap: Record<string, string> = {
    bullish: 'صعودي',
    uptrend: 'اتجاه صاعد',
    UPTREND: 'صاعد',
    sideways: 'عرضي',
    SIDEWAYS: 'عرضي',
    bearish: 'هبوطي',
    downtrend: 'اتجاه هابط',
    DOWNTREND: 'هابط',
  };

  const rsiValue = (rsiInfo.value as number) || stock.rsi || 50;
  const techScore = (scores.technical as number) || (scores.composite as number) || 50;

  return {
    ticker: stock.ticker,
    stock_name: stock.name,
    stock_name_ar: stock.name_ar,
    current_price: stock.current_price,
    overall_score: ((scores.composite as number) || (scores.total_score as number) || (rec.confidence as number) || 50) as number,
    technical_score: ((scores.technical as number) || 50) as number,
    fundamental_score: ((scores.value as number) || (scores.fundamental as number) || 50) as number,
    risk_score: ((scores.risk as number) || 50) as number,
    trend: trendDir,
    trend_ar: trendArMap[trendUpper] || trendArMap[trendDir] || (trend.direction_ar as string) || 'عرضي',
    action: action,
    action_ar: (rec.action_ar as string) || actionArMap[actionUpper] || actionArMap[action] || 'احتفاظ',
    price_targets: {
      support: (priceRange.support_1 as number) || (priceRange.support as number) || stock.support_level || 0,
      resistance: (priceRange.resistance_1 as number) || (priceRange.resistance as number) || stock.resistance_level || 0,
      upside_target: (rec.target_price as number) || (raw.target_price as number) || stock.current_price * 1.1,
    },
    strengths: keyStrengths.map((s) => (s.title_ar as string) || (s.title as string) || ''),
    risks: keyRisks.map((r) => (r.title_ar as string) || (r.title as string) || ''),
    technical_indicators: {
      rsi_signal: rsiValue > 65 ? 'overbought' : rsiValue < 35 ? 'oversold' : 'neutral',
      ma_signal: stock.ma_50 > stock.ma_200 ? 'golden_cross' : 'death_cross',
      volume_signal: stock.volume > 1000000 ? 'high' : 'normal',
      momentum: techScore > 60 ? 'positive' : techScore < 40 ? 'negative' : 'neutral',
    },
  };
}

// ==================== EMPTY DATA DEFAULTS ====================

function getEmptyMarketOverview(): MarketOverview {
  return {
    market_status: {
      is_open: false,
      status: 'closed',
      next_open: null,
      next_close: null,
      current_session: 'closed',
    },
    summary: {
      total_stocks: 0,
      gainers: 0,
      losers: 0,
      unchanged: 0,
      egx30_stocks: 0,
      egx70_stocks: 0,
      egx100_stocks: 0,
      egx30_value: 0,
    },
    indices: [],
    top_gainers: [],
    top_losers: [],
    most_active: [],
    last_updated: new Date().toISOString(),
  };
}

function getEmptyAiInsights(): AiInsights {
  return {
    market_sentiment: 'neutral',
    market_score: 50,
    market_breadth: 1,
    avg_change_percent: 0,
    volatility_index: 0.5,
    gainers: 0,
    losers: 0,
    unchanged: 0,
    top_sectors: [],
    stock_statuses: [],
    decision: 'محايد',
    risk_assessment: 'medium',
    generated_at: new Date().toISOString(),
  };
}

// ==================== STORE ====================

// Market/Exchange type - Only markets with actual data
export type MarketType = 'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'US' | 'CRYPTO';

// Market display names in Arabic
export const MARKET_NAMES_AR: Record<MarketType, string> = {
  EGX: 'البورصة المصرية',
  TADAWUL: 'السوق السعودي',
  KSE: 'بورصة الكويت',
  QSE: 'بورصة قطر',
  US: 'البورصة الأمريكية',
  CRYPTO: 'العملات الرقمية',
};

// Market code used in API params (TADAWUL -> KSA on the backend)
export const MARKET_CODES: Record<MarketType, string> = {
  EGX: 'EGX',
