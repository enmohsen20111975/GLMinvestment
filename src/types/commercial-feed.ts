/**
 * Commercial Feed Types — CANONICAL TypeScript SSOT
 * ===================================================
 *
 * Directive A-P2 (Phase 2 — TypeScript Interfaces SSOT):
 * هذه الأنواع تطابق مخرجات `scripts/commercial_feed.py` بدقة مطلقة.
 * أي تعديل في البايثون يجب أن ينعكس هنا (Rule 4: Python = brain).
 *
 * Rule 27 (NO-FAKE-DATA): كل الـ default fallbacks ترجع قيم فارغة صادقة.
 * Rule 72 (UNIFIED-DATA-CONTRACT): كل المستهلكين يستوردون من هنا فقط.
 */

// ============================================================================
// Market + Currency
// ============================================================================

/**
 * Matches Python commercial_feed.py output shape.
 * Rule 27: NO-FAKE-DATA — all defaults are honest empty.
 */

export type MarketCode = 'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'US' | 'CRYPTO';

export const MARKET_CURRENCY: Record<MarketCode, { symbol: string; label: string; code: string }> = {
  EGX: { symbol: 'ج.م', label: 'الجنيه المصري', code: 'EGP' },
  TADAWUL: { symbol: 'ر.س', label: 'الريال السعودي', code: 'SAR' },
  KSE: { symbol: 'د.ك', label: 'الدينار الكويتي', code: 'KWD' },
  QSE: { symbol: 'ر.ق', label: 'الريال القطري', code: 'QAR' },
  US: { symbol: '$', label: 'الدولار الأمريكي', code: 'USD' },
  CRYPTO: { symbol: '$', label: 'الدولار الأمريكي', code: 'USD' },
};


// ============================================================================
// Audited Performance — matches Python summary.audited_performance
// ============================================================================

export interface LiveSignal {
  ticker: string;
  name: string | null;
  market: string | null;
  sector: string | null;
  signal: string | null;
  signal_ar: string | null;
  signal_type: string | null;
  entry_price: number | null;
  target_1: number | null;
  target_1_pct: number | null;
  target_2: number | null;
  target_2_pct: number | null;
  stop_loss: number | null;
  stop_loss_pct: number | null;
  risk_reward: number | null;
  confidence: number | null;
  horizon: string | null;
  horizon_icon: string | null;
  catalyst: string | null;
  catalyst_ar: string | null;
  prediction_date: string | null;
  current_price: number | null;
  source: string | null;
}

export interface AuditedPerformance {
  total_closed: number;
  wins: number;
  losses: number;
  expired: number;
  win_rate: number | null;
  avg_return: number | null;
  best_return: number | null;
  worst_return: number | null;
  profit_factor: number | null;
}

export interface ActiveSignalsSummary {
  count: number;
  avg_rr: number | null;
  avg_confidence: number | null;
}

export interface FeedSummary {
  win_rate: number | null;
  total_closed: number;
  avg_return: number | null;
  active_count: number;
  active_signals: ActiveSignalsSummary;
  audited_performance: AuditedPerformance;
  generated_at: string | null;
  top_5_count: number;
}

// ============================================================================
// Closed Trade (audited_performance_history) — matches Python output
// ============================================================================

export interface ClosedTrade {
  ticker: string;
  signal: string | null;
  signal_ar?: string | null;
  entry_date: string | null;
  exit_date: string | null;
  entry_price: number | null;
  target_price?: number | null;
  stop_loss?: number | null;
  exit_price: number | null;
  actual_return: number | null;
  pnl_pct?: number | null;
  hit_target?: number | null;
  hit_stop?: number | null;
  holding_days?: number | null;
  status: string | null; // 'target_hit' | 'stop_hit' | 'expired'
  market: string | null;
  prediction_date?: string | null;
  closed_at?: string | null;
}

// ============================================================================
// Full Feed Response — matches Python commercial_feed.py top-level shape
// ============================================================================
export interface MarketRegimeInfo {
  regime: string | null;
  index_symbol: string | null;
  change_pct: number | null;
  reason: string | null;
}

export interface CommercialFeedResponse {
  success: boolean;
  summary: FeedSummary;
  market_regime: MarketRegimeInfo | null;
  top_5_signals: LiveSignal[];
  extra_signals: LiveSignal[];
  active_live_signals: LiveSignal[];
  audited_performance_history: ClosedTrade[];
  error?: string;
  message?: string;
}

// ============================================================================
// Market Regime — defensive (Python may return null)
// ============================================================================

export const EMPTY_AUDITED_PERFORMANCE: AuditedPerformance = {
  total_closed: 0,
  wins: 0,
  losses: 0,
  expired: 0,
  win_rate: null,
  avg_return: null,
  best_return: null,
  worst_return: null,
  profit_factor: null,
};

export const EMPTY_ACTIVE_SIGNALS: ActiveSignalsSummary = {
  count: 0,
  avg_rr: null,
  avg_confidence: null,
};

export const EMPTY_FEED_SUMMARY: FeedSummary = {
  win_rate: null,
  total_closed: 0,
  avg_return: null,
  active_count: 0,
  active_signals: EMPTY_ACTIVE_SIGNALS,
  audited_performance: EMPTY_AUDITED_PERFORMANCE,
  generated_at: null,
  top_5_count: 0,
};

export const EMPTY_FEED_RESPONSE: CommercialFeedResponse = {
  success: false,
  summary: EMPTY_FEED_SUMMARY,
  market_regime: null,
  top_5_signals: [],
  extra_signals: [],
  active_live_signals: [],
  audited_performance_history: [],
  error: 'feed_unavailable',
};

// ============================================================================
// Safe accessor helpers — guard against undefined/null at runtime
// ============================================================================

/**
 * Safely extract a feed response from an unknown API payload.
 * Returns EMPTY_FEED_RESPONSE if the payload is malformed.
 * (Defensive — prevents "cannot read properties of undefined".)
 */
export function safeFeedResponse(raw: unknown): CommercialFeedResponse {
  if (!raw || typeof raw !== 'object') return EMPTY_FEED_RESPONSE;
  const r = raw as Partial<CommercialFeedResponse>;
  return {
    success: Boolean(r.success),
    summary: r.summary ?? EMPTY_FEED_SUMMARY,
    market_regime: r.market_regime ?? null,
    top_5_signals: Array.isArray(r.top_5_signals) ? r.top_5_signals : [],
    extra_signals: Array.isArray(r.extra_signals) ? r.extra_signals : [],
    active_live_signals: Array.isArray(r.active_live_signals) ? r.active_live_signals : [],
    audited_performance_history: Array.isArray(r.audited_performance_history)
      ? r.audited_performance_history
      : [],
    error: r.error,
    message: r.message,
  };
}

/**
 * Safely extract the top 5 signals from a feed response.
 * (Rule 4: no sort/filter/slice in frontend — reads Python order as-is.)
 */

export function safeTop5Signals(feed: CommercialFeedResponse | null | undefined): LiveSignal[] {
  if (!feed) return [];
  return feed.top_5_signals?.length > 0
    ? feed.top_5_signals
    : feed.active_live_signals?.slice(0, 5) ?? [];
}

/**
 * Safely extract audited performance stats.
 */
export function safeAuditedPerformance(
  feed: CommercialFeedResponse | null | undefined,
): AuditedPerformance {
  if (!feed?.summary?.audited_performance) return EMPTY_AUDITED_PERFORMANCE;
  return feed.summary.audited_performance;
}

/**
 * Get currency symbol for a market code.
 */
export function marketCurrencySymbol(market: string | null | undefined): string {
  if (!market) return 'ج.م';
  const upper = market.toUpperCase() as MarketCode;
  return MARKET_CURRENCY[upper]?.symbol ?? 'ج.م';
}
