/**
 * prediction-dashboard/types.ts
 * =============================
 * All TypeScript types for the PredictionTrackingDashboard split
 * (Task F-Phase3-Split-Admin+Predictions).
 *
 * Originally inlined at the top of PredictionTrackingDashboard.tsx
 * (lines 33-159, ~127 LOC). Pure type module — no runtime exports.
 */

export type PersonaId = 'all' | 'gambler' | 'balanced' | 'conservative';
export type OutcomeFilter = 'ALL' | 'WIN' | 'LOSS' | 'PENDING' | 'EXPIRED';
export type DaysWindow = 1 | 2 | 7 | 14 | 30 | 60 | 90 | 180 | 365 | 999 | 0;

// HONEST-TRACKING-FIX: ناتج الـ endpoint /api/predictions/honest-tracking/list
// ده الـ endpoint اللي بيرجع بيانات تاريخية كاملة من SQLite مباشرةً بدون الحاجة لـ Python.
export interface HonestPredictionItem {
 id: string;
 stock_symbol: string;
 stock_name_ar?: string;
 signal_type: string;
 market: string;
 entry_price: number;
 target_price: number;
 stop_loss: number;
 confidence?: number | null;
 maestro_score?: number | null;
 prediction_date: string;
 status: string;
 final_price?: number | null;
 profit_loss_percent?: number | null;
 actual_return?: number | null;
 hit_target?: boolean;
 hit_stop_loss?: boolean;
 holding_days?: number;
 evaluation_date?: string | null;
 persona?: string | null;
 created_at?: string;
 highest_price_reached?: number | null;
 lowest_price_reached?: number | null;
 exit_type?: string | null;
 target_price_2?: number | null;
 // V40.1: Evidence-based fields
 evidence_count?: number;
 morning_bell?: boolean;
 kill_filter_result?: string | null;
}

export interface HonestListResponse {
 success: boolean;
 predictions: HonestPredictionItem[];
 pagination?: { total: number; limit: number; offset: number; has_more: boolean };
 source?: string;
}

export interface LivePrediction {
 ticker: string;
 nameAr?: string;
 persona: 'gambler' | 'balanced' | 'conservative';
 signal?: string;
 entryDate?: string;
 entryPrice: number;
 targetPrice: number;
 stopLoss: number;
 currentPrice?: number;
 outcome: 'WIN' | 'LOSS' | 'EXPIRED' | 'PENDING';
 returnPct?: number | null;
 daysSinceEntry?: number | null;
 closedAt?: string | null;
 exitPrice?: number | null;
 maestroScore?: number;
 confidence?: number;
 reason?: string;
 // V40.1: Evidence-based fields
 evidence_count?: number;
 morning_bell?: boolean;
 kill_filter_result?: string | null;
 // RL-FIX-6: new fields from backend
 targetPrice2?: number;
 liveOutcome?: 'WIN' | 'LOSS' | 'PENDING';
 executionDate?: string | null;
 // FIX-5B: highest/lowest price reached + exit_type — لعرض أقصى ربح/خسارة + تمييز
 // TRAILING_PROFIT (💰 خرج بربح) عن WIN العادي.
 highestPriceReached?: number | null;
 lowestPriceReached?: number | null;
 highest_price_reached?: number | null;
 lowest_price_reached?: number | null;
 exit_type?: string | null;
 exitType?: string | null;
 target_price_2?: number | null;
 // Task IMPROVEMENT-05/06/07/09-2026-10-06: New fields from V40.2 enhancements
 target_price_3?: number | null; // DNA PROJECTION target_3
 who_is_buying_state?: string | null; // 🏦 شراء مؤسساتي / 👤 شراء أفراد
 hmm_regime_ar?: string | null; // 🧠 HMM: 🟢 تجميع / 🔴 توزيع
 analysis_reason?: string | null; // 📝 نص عربي شارح للقرار
 ml_confidence_pct?: number | null; // 🤖 ML confidence (لو ML مفعّل)
}

export interface PersonaStats {
 total: number;
 wins: number;
 losses: number;
 pending: number;
 settled: number;
 winRate: number;
 avgWinPct: number;
 avgLossPct: number;
 profitFactor: number;
 closedCount: number;
 expired?: number;
 // ما يهم العميل: الفلوس + الحماية
 netReturn: number; // صافي الربح/الخسارة = sum(actual_return)
 grossProfit: number; // إجمالي الأرباح = sum(positive returns)
 grossLoss: number; // إجمالي الخسائر = sum(negative returns, سالب)
 maxLoss: number; // أقصى خسارة في صفقة واحدة (سالب)
 rrRatio: number; // متوسط الربح ÷ متوسط الخسارة
}

export interface LiveTrackingResponse {
 success: boolean;
 predictions: Record<'gambler' | 'balanced' | 'conservative', LivePrediction[]>;
 stats: PersonaStats;
 statsByPersona: Record<'gambler' | 'balanced' | 'conservative', PersonaStats>;
 market_session: {
 is_open: boolean;
 server_time: string;
 next_refresh_seconds: number;
 session_name: string;
 };
 last_updated: string;
 source?: string;
 market?: string;
 daysWindow?: number;
 error?: string;
}

export type PersonaKey = 'gambler' | 'balanced' | 'conservative';
export type OutcomeKey = 'WIN' | 'LOSS' | 'EXPIRED' | 'PENDING';
export type QualityMode = 'top_picks' | 'all';

export interface CumulativeProfitPoint {
 date: string;
 label: string;
 cumulative: number;
 trade: number;
 ticker: string;
}

export interface FocusTickerInfo {
 count: number;
 personas: string[];
}

export type SortBy = 'return' | 'date' | 'target' | 'days';
export type EntryPeriod = 'all' | '7d' | '30d' | '90d';

export interface PredictionTrackingDashboardProps {
 market?: string;
 className?: string;
}
