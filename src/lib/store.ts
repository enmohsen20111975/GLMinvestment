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
import type { RecommendResponse, PersonaType } from '@/types/v2';
import { apiClient } from '@/lib/api-client';
import type { Session } from 'next-auth';

// ==================== DATA ADAPTERS ====================
// These functions transform backend API responses to match frontend types.

/**
 * Transform a raw stock object from the backend to match the Stock type.
 */
function adaptStock(raw: Record<string, unknown> | null | undefined): Stock {
  if (!raw) {
    return {
      ticker: '',
      name: '',
      name_ar: '',
      current_price: 0,
      previous_close: 0,
      open_price: 0,
      high_price: 0,
      low_price: 0,
      volume: 0,
      market_cap: 0,
      pe_ratio: 0,
      pb_ratio: 0,
      dividend_yield: 0,
      eps: 0,
      roe: 0,
      debt_to_equity: 0,
      support_level: 0,
      resistance_level: 0,
      ma_50: 0,
      ma_200: 0,
      rsi: 0,
      sector: '',
      industry: '',
      egx30_member: false,
      egx70_member: false,
      egx100_member: false,
      is_active: true,
      is_egx: true,
      market: 'EGX',
      icon_url: undefined,
      last_update: new Date().toISOString(),
      price_change: null,
      fair_value: null,
      upside_percent: null,
      turnover_egp: null,
      change_1d: null,
      change_1w: null,
      change_1m: null,
      volume_week: null,
      volume_month: null,
    };
  }
  // Helper: parse number-or-null safely (don't coerce null/undefined to 0 for optional stats)
  const numOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: raw.id as number | undefined,
    ticker: (raw.ticker as string) || '',
    name: (raw.name as string) || '',
    name_ar: (raw.name_ar as string) || '',
    current_price: Number(raw.current_price) || 0,
    previous_close: Number(raw.previous_close) || 0,
    open_price: Number(raw.open_price) || 0,
    high_price: Number(raw.high_price) || 0,
    low_price: Number(raw.low_price) || 0,
    volume: Number(raw.volume) || 0,
    volume_int: numOrNull(raw.volume_int) ?? undefined,
    volume_week: numOrNull(raw.volume_week),
    volume_month: numOrNull(raw.volume_month),
    market_cap: Number(raw.market_cap) || 0,
    pe_ratio: Number(raw.pe_ratio) || 0,
    pb_ratio: Number(raw.pb_ratio) || 0,
    dividend_yield: Number(raw.dividend_yield) || 0,
    eps: Number(raw.eps) || 0,
    roe: Number(raw.roe) || 0,
    debt_to_equity: Number(raw.debt_to_equity) || 0,
    support_level: Number(raw.support_level) || 0,
    resistance_level: Number(raw.resistance_level) || 0,
    ma_50: Number(raw.ma_50) || 0,
    ma_200: Number(raw.ma_200) || 0,
    rsi: Number(raw.rsi) || 0,
    sector: (raw.sector as string) || '',
    industry: (raw.industry as string) || (raw.sector as string) || '',
    egx30_member: Boolean(raw.egx30_member || raw.is_egx30),
    egx70_member: Boolean(raw.egx70_member || raw.is_egx70),
    egx100_member: Boolean(raw.egx100_member || raw.is_egx100),
    compliance_status: (raw.compliance_status as string) || undefined,
    is_active: (raw.is_active as boolean) ?? true,
    is_egx: (raw.is_egx as boolean) ?? true,
    market: (raw.market as string) || 'EGX',
    icon_url: (raw.icon_url as string) || undefined,
    last_update: (raw.last_update as string) || new Date().toISOString(),
    value_traded: Number(raw.value_traded) || 0,
    price_change: raw.price_change != null ? Number(raw.price_change) : null,
    // Screener fields (STOCKS-SCREEN-020)
    fair_value: numOrNull(raw.fair_value),
    upside_percent: numOrNull(raw.upside_percent),
    book_value_per_share: numOrNull(raw.book_value_per_share),
    turnover_egp: numOrNull(raw.turnover_egp),
    change_1d: numOrNull(raw.change_1d),
    change_1w: numOrNull(raw.change_1w),
    change_1m: numOrNull(raw.change_1m),
  };
}

/**
 * Transform a raw crypto coin object (from /api/crypto/live) into the Stock
 * shape so the unified StocksView / analysis tabs can consume it exactly
 * like an EGX stock. This is the core of the "crypto mirrors stocks" UX.
 */
export function adaptCryptoToStock(raw: Record<string, unknown>): Stock {
  const symbol = String(raw.symbol || '').toUpperCase();
  const price = Number(raw.price_usd ?? raw.current_price ?? 0) || 0;
  const change24h = Number(raw.change_24h ?? raw.change_percent ?? 0) || 0;
  const change7d = Number(raw.change_7d ?? 0) || 0;
  const marketCap = Number(raw.market_cap ?? 0) || 0;
  const volume = Number(raw.volume_24h ?? raw.total_volume ?? 0) || 0;
  const name = String(raw.name || symbol);

  return {
    ticker: symbol,
    name,
    name_ar: name, // crypto has no Arabic names; reuse English
    current_price: price,
    previous_close: price && change24h ? price / (1 + change24h / 100) : price,
    // FIX (Aug 2026): احسب open/high/low تقريبياً من price + change24h
    // عشان الـ price-range bar في StocksView.StockCard يشتغل صح
    open_price: price && change24h ? price / (1 + change24h / 100) : price,
    high_price: price > 0 ? price * 1.005 : price, // تقريب: high = price + 0.5%
    low_price: price > 0 ? price * 0.995 : price,  // تقريب: low = price - 0.5%
    volume,
    volume_int: volume,
    volume_week: volume,
    volume_month: volume,
    market_cap: marketCap,
    pe_ratio: 0,
    pb_ratio: 0,
    dividend_yield: 0,
    eps: 0,
    roe: 0,
    debt_to_equity: 0,
    support_level: 0,
    resistance_level: 0,
    ma_50: 0,
    ma_200: 0,
    rsi: 0,
    sector: 'عملات رقمية',
    industry: 'Cryptocurrency',
    egx30_member: false,
    egx70_member: false,
    egx100_member: false,
    is_active: true,
    is_egx: false,
    market: 'CRYPTO',
    icon_url: (raw.image as string) || undefined,
    last_update: new Date().toISOString(),
    value_traded: volume * price,
    price_change: change24h,
    fair_value: null,
    upside_percent: null,
    book_value_per_share: null,
    turnover_egp: null,
    change_1d: change24h,
    change_1w: change7d,
    change_1m: null,
  };
}

/**
 * Transform backend market overview to match frontend MarketOverview type.
 */
export function adaptMarketOverview(raw: Record<string, unknown>): MarketOverview {
  const data = (raw.data ? raw.data : raw) as Record<string, unknown>;
  const summary = data.summary as Record<string, unknown> || {};
  const indices = ((data.indices as Array<Record<string, unknown> | null>) || []).filter(Boolean) as Array<Record<string, unknown>>;
  const topGainers = ((data.top_gainers as Array<Record<string, unknown> | null>) || []).filter(Boolean) as Array<Record<string, unknown>>;
  const topLosers = ((data.top_losers as Array<Record<string, unknown> | null>) || []).filter(Boolean) as Array<Record<string, unknown>>;
  const mostActive = ((data.most_active as Array<Record<string, unknown> | null>) || []).filter(Boolean) as Array<Record<string, unknown>>;
  const marketStatus = data.market_status as Record<string, unknown> || {};

  return {
    market_status: {
      is_open: (marketStatus.is_open as boolean) ?? (marketStatus.is_market_hours as boolean) ?? false,
      status: (marketStatus.status as string) || ((marketStatus.is_open as boolean) ? 'open' : 'closed'),
      next_open: marketStatus.next_trading_window
        ? ((marketStatus.next_trading_window as Record<string, unknown>).message as string) || null
        : (marketStatus.next_open as string) || null,
      next_close: (marketStatus.next_close as string) || null,
      current_session: (marketStatus.current_session as string) || ((marketStatus.is_open as boolean) ? 'trading' : 'closed'),
    },
    summary: {
      total_stocks: (summary.total_stocks as number) || 0,
      gainers: (summary.gainers as number) || 0,
      losers: (summary.losers as number) || 0,
      unchanged: (summary.unchanged as number) || 0,
      egx30_stocks: (summary.egx30_stocks as number) || 0,
      egx70_stocks: (summary.egx70_stocks as number) || 0,
      egx100_stocks: (summary.egx100_stocks as number) || 0,
      egx30_value: (summary.egx30_value as number) || (summary.total_volume as number) || 0,
    },
    indices: indices.map((idx) => ({
      symbol: (idx.symbol as string) || (idx.name as string) || '',
      name: (idx.name as string) || '',
      name_ar: (idx.name_ar as string) || '',
      value: (idx.value as number) || (idx.current_value as number) || 0,
      previous_close: (idx.previous_close as number) || 0,
      change: (idx.change as number) || 0,
      change_percent: (idx.change_percent as number) || 0,
      last_updated: (idx.last_updated as string) || (idx.last_update as string) || null,
    })),
    top_gainers: topGainers.map((s) => ({
      ticker: (s.ticker as string) || '',
      name: (s.name as string) || '',
      name_ar: (s.name_ar as string) || '',
      current_price: (s.current_price as number) || 0,
      price_change: (s.change_percent as number) ?? (s.price_change as number) ?? null,
      volume: s.volume as number | undefined,
    })),
    top_losers: topLosers.map((s) => ({
      ticker: (s.ticker as string) || '',
      name: (s.name as string) || '',
      name_ar: (s.name_ar as string) || '',
      current_price: (s.current_price as number) || 0,
      price_change: (s.change_percent as number) ?? (s.price_change as number) ?? null,
      volume: s.volume as number | undefined,
    })),
    most_active: mostActive.map((s) => ({
      ticker: (s.ticker as string) || '',
      name: (s.name as string) || '',
      name_ar: (s.name_ar as string) || '',
      current_price: (s.current_price as number) || 0,
      price_change: (s.change_percent as number) ?? (s.price_change as number) ?? null,
      volume: (s.volume as number) ?? 0,
    })),
    last_updated: (raw.last_updated as string) || new Date().toISOString(),
  };
}

/**
 * Transform backend market-pulse response to match frontend AiInsights type.
 */
export function adaptAiInsights(raw: Record<string, unknown>): AiInsights {
  const data = (raw.data ? raw.data : raw) as Record<string, unknown>;
  const sectors = ((data.sectors as Array<Record<string, unknown> | null>) || []).filter(Boolean) as Array<Record<string, unknown>>;
  const breadth = (data.breadth as Record<string, unknown>) || {};
  const pulse = (data.pulse as Record<string, unknown>) || {};
  const gainers = ((data.gainers as Array<Record<string, unknown> | null>) || []).filter(Boolean) as Array<Record<string, unknown>>;
  const losers = ((data.losers as Array<Record<string, unknown> | null>) || []).filter(Boolean) as Array<Record<string, unknown>>;

  const pulseScore = (pulse.score as number) || 0;
  const pulseLabel = ((pulse.label_en as string) || (pulse.label as string) || 'NEUTRAL').toUpperCase();

  let market_sentiment: AiInsights['market_sentiment'] = 'neutral';
  if (pulseLabel.includes('BULLISH') || pulseLabel.includes('STRONG_BULLISH')) market_sentiment = 'bullish';
  else if (pulseLabel.includes('BEARISH') || pulseLabel.includes('STRONG_BEARISH')) market_sentiment = 'bearish';

  const top_sectors = sectors
    .map((s) => ({
      name: (s.sector as string) || (s.name as string) || '',
      count: (s.stock_count as number) || (s.count as number) || 0,
      avg_change_percent: (s.avg_change as number) || 0,
    }))
    .sort((a, b) => Math.abs(b.avg_change_percent) - Math.abs(a.avg_change_percent));

  const advDec = (breadth.adv_dec_ratio as number) || 1;
  const market_breadth = advDec > 1 ? advDec : 1 / (advDec || 1);

  const divergence = (data.divergence as Record<string, unknown>) || {};
  const divergenceAction = ((divergence.action as string) || 'NEUTRAL').toUpperCase();

  let risk_assessment: AiInsights['risk_assessment'] = 'medium';
  if (pulseScore > 0.7) risk_assessment = 'low';
  else if (pulseScore < 0.3) risk_assessment = 'high';

  const parseNum = (v: unknown): number => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return parseFloat(v.replace(/[^0-9.+-]/g, '')) || 0;
    return 0;
  };

  const stock_statuses: StockStatusItem[] = [
    ...gainers.map((s) => {
      const chg = parseNum(s.change_percent || s.price_change || 0);
      const score = Math.min(95, Math.max(5, 50 + chg * 1.5));
      const status: StockStatusItem['status'] = score >= 60 ? 'positive' : score >= 40 ? 'neutral' : 'weak';
      return {
        ticker: (s.ticker as string) || '',
        name: (s.name as string) || '',
        name_ar: (s.name_ar as string) || '',
        sector: (s.sector as string) || '',
        current_price: parseNum(s.current_price || 0),
        price_change: chg,
        volume: parseNum(s.volume),
        value_traded: 0,
        score,
        status,
        components: { momentum: score, liquidity: 50, valuation: 50, income: 50, traded_value: 50 },
        fair_value: parseNum(s.current_price || 0),
        upside_to_fair: 0,
        verdict: 'undervalued' as const,
        verdict_ar: 'مقيم بأقل من قيمته',
      };
    }),
    ...losers.map((s) => {
      const chg = parseNum(s.change_percent || s.price_change || 0);
      const score = Math.min(45, Math.max(5, 50 + chg * 1.5));
      const status: StockStatusItem['status'] = score >= 60 ? 'positive' : score >= 40 ? 'neutral' : 'weak';
      return {
        ticker: (s.ticker as string) || '',
        name: (s.name as string) || '',
        name_ar: (s.name_ar as string) || '',
        sector: (s.sector as string) || '',
        current_price: parseNum(s.current_price || 0),
        price_change: chg,
        volume: parseNum(s.volume),
        value_traded: 0,
        score,
        status,
        components: { momentum: score, liquidity: 50, valuation: 50, income: 50, traded_value: 50 },
        fair_value: parseNum(s.current_price || 0),
        upside_to_fair: 0,
        verdict: 'overvalued' as const,
        verdict_ar: 'مقيم بأعلى من قيمته',
      };
    }),
  ];

  const gainersCount = (breadth.gainers as number) || gainers.length;
  const losersCount = (breadth.losers as number) || losers.length;
  const unchangedCount = (breadth.unchanged as number) || 0;
  const avgChange = sectors.length > 0
    ? sectors.reduce((sum, s) => sum + parseNum(s.avg_change || 0), 0) / sectors.length
    : 0;

  return {
    market_sentiment,
    market_score: Math.round(pulseScore * 100),
    market_breadth: Math.round(market_breadth * 100) / 100,
    avg_change_percent: avgChange,
    volatility_index: Math.round((1 - pulseScore) * 100) / 100,
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
export type MarketType = 'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'CRYPTO';

// Market display names in Arabic
export const MARKET_NAMES_AR: Record<MarketType, string> = {
  EGX: 'البورصة المصرية',
  TADAWUL: 'السوق السعودي',
  KSE: 'بورصة الكويت',
  QSE: 'بورصة قطر',
  CRYPTO: 'العملات الرقمية',
};

// Market code used in API params (TADAWUL -> KSA on the backend)
export const MARKET_CODES: Record<MarketType, string> = {
  EGX: 'EGX',
  TADAWUL: 'KSA',
  KSE: 'KSE',
  QSE: 'QSE',
  CRYPTO: 'CRYPTO',
};

// Currency label per market (used in price displays)
export const MARKET_CURRENCY_LABEL: Record<MarketType, string> = {
  EGX: 'ج.م',
  TADAWUL: 'ريال',
  KSE: 'د.ك',
  QSE: 'ر.ق',
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
  currentMarket: 'EGX' as MarketType,
  setCurrentMarket: (market) => {
    set({ currentMarket: market });
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

  // Auth
  user: null,
  apiKey: null,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
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
        isAuthenticated: true,
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
      set({ user: null, apiKey: null, isAuthenticated: false });
      if (typeof window !== 'undefined') localStorage.removeItem('egx_api_key');
    }
  },
  logout: () => {
    set({ user: null, apiKey: null, currentView: 'dashboard', isAuthenticated: false, showLoginPrompt: false });
    if (typeof window !== 'undefined') localStorage.removeItem('egx_api_key');
  },

  // Auth Gate state (Task 13)
  authChecked: false,
  isAuthenticated: false,
  showLoginPrompt: false,
  setShowLoginPrompt: (open) => set({ showLoginPrompt: open }),
  setAuthChecked: (checked) => set({ authChecked: checked }),
  setAuthenticated: (authed) => set({ isAuthenticated: authed }),
  requireAuth: () => {
    const s = get();
    if (!s.isAuthenticated || !s.user) {
      set({ showLoginPrompt: true });
      return false;
    }
    return true;
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
  notifications: [],
  stockNews: null,
  stockNewsLoading: false,
  v2Data: null,
  v2Loading: false,
  v2Error: null,
  v2RetryCount: 0,
  persona: 'balanced' as PersonaType,
  egxPilotNews: null,
  egxPilotNewsLoading: false,

  // Actions
  setSearchQuery: (query) => set({ searchQuery: query }),
  setPersona: (persona) => {
    set({ persona });
    // Reload recommendations with new persona
    get().loadV2Recommendations(persona);
  },

  loadDashboard: () => {
    set({ isLoading: true });
    const currentMarket = get().currentMarket;

    Promise.all([
      apiClient.getMarketOverview(currentMarket).catch((err) => {
        console.error('[Store] Failed to load market overview:', err);
        return null;
      }),
      apiClient.getAiInsights().catch((err) => {
        console.error('[Store] Failed to load AI insights:', err);
        return null;
      }),
    ])
      .then(([overviewRaw, insightsRaw]) => {
        const overview = overviewRaw ? adaptMarketOverview(overviewRaw as unknown as Record<string, unknown>) : getEmptyMarketOverview();
        const insights = insightsRaw ? adaptAiInsights(insightsRaw as unknown as Record<string, unknown>) : getEmptyAiInsights();
        set({
          marketOverview: overview,
          aiInsights: insights,
          isLoading: false,
        });
      })
      .catch((err) => {
        console.error('[Store] Dashboard load error:', err);
        set({
          marketOverview: getEmptyMarketOverview(),
          aiInsights: getEmptyAiInsights(),
          isLoading: false,
        });
      });
  },

  loadStocks: (query, page = 1) => {
    set({ isLoading: true, searchQuery: query || '' });

    const params: Record<string, unknown> = {
      page,
      page_size: 500,
    };
    if (query) {
      params.query = query;
    }
    // Add market filter
    const currentMarket = get().currentMarket;
    if (currentMarket) {
      params.market = currentMarket;
    }

    apiClient.getStocks(params as Parameters<typeof apiClient.getStocks>[0])
      .then((response: StockListResponse) => {
        // Filter out null/undefined items and items without ticker
        const validStocks = (response.stocks || []).filter((s): s is Record<string, unknown> => s != null && (s as Record<string, unknown>).ticker);
        const stocks = validStocks.map((s) => adaptStock(s as unknown as Record<string, unknown>)).filter(s => s.ticker);
        set({
          stocks,
          stocksTotal: response.total,
          stocksPage: page,
          isLoading: false,
        });
      })
      .catch((err) => {
        console.error('[Store] Failed to load stocks from API:', err);
        set({
          stocks: [],
          stocksTotal: 0,
          stocksPage: page,
          isLoading: false,
        });
      });
  },

  // ── Unified crypto loader (UI-mirror protocol) ──────────────────────────
  // Fetches /api/crypto/live and adapts every coin into the Stock shape via
  // adaptCryptoToStock(), then stores them in the SAME `stocks` array that
  // StocksView consumes. This is what makes the crypto list render inside the
  // exact same stocks table/search/presets UI.
  loadCryptoList: () => {
    set({ isLoading: true, searchQuery: '' });
    fetch('/api/crypto/coins?limit=250', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: Record<string, unknown>) => {
        const all = (data.all_cryptos ?? (data.data as Record<string, unknown> | undefined)?.all_cryptos) as
          | Array<Record<string, unknown>>
          | undefined;
        if (!Array.isArray(all)) {
          set({ stocks: [], stocksTotal: 0, isLoading: false });
          return;
        }
        const coins = all
          .map((c) => adaptCryptoToStock(c))
          .filter((s) => s.ticker);
        set({
          stocks: coins,
          stocksTotal: coins.length,
          stocksPage: 1,
          isLoading: false,
        });
      })
      .catch((err) => {
        console.error('[Store] Failed to load crypto list:', err);
        set({ stocks: [], stocksTotal: 0, isLoading: false });
      });
  },


  refreshLivePrices: () => {
    const existingStocks = get().stocks;
    if (!existingStocks || existingStocks.length === 0) return;

    fetch('/api/market-pulse')
      .then(res => res.json())
      .then(data => {
        if (!data.success || !data.data) return;
        const liveMap = new Map<string, { price?: number; change?: number; volume?: number }>();
        const allMovers = [
          ...(data.data.gainers || []),
          ...(data.data.losers || []),
          ...(data.data.most_active || []),
        ];
        for (const m of allMovers) {
          if (m.ticker) {
            liveMap.set(m.ticker, {
              price: m.current_price,
              change: m.change_percent,
              volume: m.volume,
            });
          }
        }
        const updatedStocks = existingStocks.map(s => {
          const live = liveMap.get(s.ticker);
          if (live) {
            return { ...s, current_price: live.price ?? s.current_price, price_change: live.change ?? s.price_change, volume: live.volume ?? s.volume };
          }
          return s;
        });
        set({ stocks: updatedStocks });
      })
      .catch(() => {});
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

        // Find stock from loaded list or use API response
        const allStocks = get().stocks;
        let stock: Stock | null = rawStockData
          ? adaptStock(rawStockData)
          : allStocks.find((s) => s.ticker === upperTicker) || null;

        if (!stock) {
          // If no stock found, create a minimal one
          stock = {
            ticker: upperTicker,
            name: upperTicker,
            name_ar: upperTicker,
            current_price: 0,
            previous_close: 0,
            open_price: 0,
            high_price: 0,
            low_price: 0,
            volume: 0,
            market_cap: 0,
            sector: '',
            industry: '',
            is_active: true,
            is_egx: true,
            last_update: new Date().toISOString(),
          };
        }

        // Get history
        const history = historyRaw
          ? adaptPriceHistory(historyRaw as unknown as Record<string, unknown>)
          : null;

        // Get analysis/recommendation
        const analysis = recRaw
          ? adaptDeepAnalysis(recRaw as unknown as Record<string, unknown>, stock)
          : null;

        set({
          selectedStock: stock,
          stockHistory: history,
          deepAnalysis: analysis,
          isLoading: false,
          currentView: 'stock-detail',
        });
      })
      .catch((err) => {
        console.error('[Store] Failed to load stock detail:', err);
        set({
          selectedStock: null,
          stockHistory: null,
          deepAnalysis: null,
          isLoading: false,
          currentView: 'stock-detail',
        });
      });
  },

  loadPortfolio: () => {
    set({ isLoading: true });
    fetch('/api/portfolio', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        const items = data.positions || data.items || [];
        if (data.success && items.length > 0) {
          const summary = data.summary || {};
          const totalMarketValue = summary.total_market_value || 0;
          const totalInvested = summary.total_cost_basis || 0;
          const totalGainLoss = summary.total_unrealized_pnl || 0;
          const totalGainLossPercent = summary.total_unrealized_pnl_percent || 0;

          const positiveItems = items.filter((i: Record<string, unknown>) => Number(i.unrealized_pnl) > 0).sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(b.unrealized_pnl) - Number(a.unrealized_pnl)).slice(0, 5);
          const negativeItems = items.filter((i: Record<string, unknown>) => Number(i.unrealized_pnl) < 0).sort((a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.unrealized_pnl) - Number(b.unrealized_pnl)).slice(0, 5);

          const impact: PortfolioImpactResponse = {
            summary: {
              total_market_value: totalMarketValue,
              total_invested: totalInvested,
              total_gain_loss: totalGainLoss,
              total_gain_loss_percent: totalGainLossPercent,
              day_impact_value: 0,
              day_impact_percent: 0,
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
              asset_id: String(i.id),
              ticker: String(i.stock_symbol),
              name_ar: String(i.stock_name),
              weight_percent: totalMarketValue > 0 ? Math.round((Number(i.market_value) / totalMarketValue) * 1000) / 10 : 0,
              is_concentration_alert: true,
              is_day_loss_alert: Number(i.unrealized_pnl) < 0,
            })),
            top_positive: positiveItems.map((i: Record<string, unknown>) => ({
              asset_id: String(i.id), ticker: String(i.stock_symbol), name_ar: String(i.stock_name),
              day_impact_percent: 0,
              day_impact_value: Number(i.unrealized_pnl),
            })),
            top_negative: negativeItems.map((i: Record<string, unknown>) => ({
              asset_id: String(i.id), ticker: String(i.stock_symbol), name_ar: String(i.stock_name),
              day_impact_percent: 0,
              day_impact_value: Number(i.unrealized_pnl),
            })),
            items: items.map((i: Record<string, unknown>) => ({
              asset_id: String(i.id), ticker: String(i.stock_symbol), name_ar: String(i.stock_name),
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
          set({ portfolioImpact: null, isLoading: false });
        }
      })
      .catch((err) => {
        console.error('[Store] Failed to load portfolio:', err);
        set({ portfolioImpact: null, isLoading: false });
      });
  },

  loadAiInsights: () => {
    set({ isLoading: true });

    apiClient.getAiInsights()
      .then((raw) => {
        const insights = raw ? adaptAiInsights(raw as unknown as Record<string, unknown>) : getEmptyAiInsights();
        // Filter out null/undefined stock_statuses without ticker
        if (insights && insights.stock_statuses) {
          insights.stock_statuses = insights.stock_statuses.filter(
            (s): s is NonNullable<typeof s> => s != null && s.ticker
          );
        }
        set({ aiInsights: insights, isLoading: false });
      })
      .catch((err) => {
        console.error('[Store] Failed to load AI insights:', err);
        set({ aiInsights: getEmptyAiInsights(), isLoading: false });
      });
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
      .catch((err) => {
        console.error('[Store] Failed to load watchlist:', err);
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
        get().loadWatchlist();
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
        get().loadWatchlist();
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
        get().loadPortfolio();
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

    apiClient.getStockNews(ticker.toUpperCase(), limit)
      .then((data) => {
        set({ stockNews: data, stockNewsLoading: false });
      })
      .catch((err) => {
        console.error('[Store] Failed to load stock news:', err);
        set({ stockNews: null, stockNewsLoading: false });
      });
  },

  loadV2Recommendations: (personaOverride?: PersonaType) => {
    const state = get();
    // Prevent infinite retry loop: max 2 retries
    if (state.v2RetryCount >= 2 && !state.v2Data) {
      return;
    }
    set({ v2Loading: true, v2Error: null });

    const persona = personaOverride || state.persona;
    const currentMarket = state.currentMarket;
    // Build URL with market parameter
    const url = `/api/v2/recommend?persona=${persona}&market=${currentMarket}`;

    fetch(url, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: RecommendResponse) => {
        // Filter out null/undefined stocks and stocks without ticker
        if (data && data.stocks) {
          data.stocks = data.stocks.filter((s): s is NonNullable<typeof s> => s != null && s.ticker);
        }
        set({ v2Data: data, v2Loading: false, v2Error: null, v2RetryCount: 0, persona });
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
  },

  loadEgxPilotNews: (limit = 10) => {
    set({ egxPilotNewsLoading: true });

    apiClient.getEgxPilotNews(limit)
      .then((data) => {
        if (data.success && data.news) {
          set({ egxPilotNews: data.news, egxPilotNewsLoading: false });
        } else {
          set({ egxPilotNews: [], egxPilotNewsLoading: false });
        }
      })
      .catch((err) => {
        console.error('[Store] Failed to load EGX Pilot news:', err);
        set({ egxPilotNews: null, egxPilotNewsLoading: false });
      });
  },

  // UI
  isLoading: false,
  activeMobileTab: 'dashboard',
  setActiveMobileTab: (tab) => set({ activeMobileTab: tab }),

  // P5-MOBILE-UX: Personalization
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
