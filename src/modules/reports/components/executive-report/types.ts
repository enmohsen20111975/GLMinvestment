/**
 * executive-report/types.ts
 * ========================
 * All TypeScript types + interfaces for the ExecutiveReportView family.
 *
 * Extracted from the original `ExecutiveReportView.tsx` (2,087 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 *
 * Naming + semantics preserved 1:1 with the original file so every existing
 * reference (KpiCard, HighlightCard, PersonaCard, MissedOppCard, etc.) keeps
 * working unchanged.
 */

// RL-FIX-7: 999 = YTD (من أول السنة) — من 1 يناير للسنة الحالية
export type ReportTimeframe = 1 | 2 | 7 | 14 | 30 | 60 | 90 | 180 | 365 | 999 | 0;

export type FilterPersona = 'all' | 'gambler' | 'balanced' | 'conservative';
export type FilterOutcome = 'ALL' | 'WIN' | 'LOSS' | 'PENDING' | 'EXPIRED';
export type FilterSignal = 'all' | 'BUY' | 'SELL';

// RL-FIX-10: وضع الجودة — يتحكم في هل نعرض كل التوقعات ولا أفضلها بس
// 'top_picks' = أفضل 5 توقعات/يوم لكل شخصية (الافتراضي — منطقي للعميل)
// 'all' = كل التوقعات (للتحليل الشامل)
export type QualityMode = 'top_picks' | 'all';

export interface LivePredictionItem {
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
  // FIX-5C: exit_type — لتمييز TRAILING_PROFIT (💰 خرج بربح) عن WIN العادي.
  // الـ backend بـ يـ return exit_type كـ lowercase string (e.g. 'trailing_profit',
  // 'target_hit', 'stop_loss', 'expired'). الـ UI بـ يستخدمه لعرض badge منفصل.
  exitType?: string | null;
  exit_type?: string | null;
  // FIX-5C: highest/lowest + target_price_2 — لعرضها في الـ highlights إن لزم.
  highestPriceReached?: number | null;
  lowestPriceReached?: number | null;
  highest_price_reached?: number | null;
  lowest_price_reached?: number | null;
  targetPrice2?: number | null;
  target_price_2?: number | null;
}

export interface PersonaStatsItem {
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
}

export interface LiveTrackingResponse {
  success: boolean;
  predictions: Record<'gambler' | 'balanced' | 'conservative', LivePredictionItem[]>;
  stats: PersonaStatsItem;
  statsByPersona: Record<'gambler' | 'balanced' | 'conservative', PersonaStatsItem>;
  last_updated: string;
  market?: string;
  daysWindow?: number;
  source?: string;
}

// RL-FIX-8: ناتج الـ endpoint /api/predictions/honest-tracking/list
// ده الـ endpoint اللي بيرجع بيانات تاريخية كاملة (مش محصور في آخر يوم بس).
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
  status: string; // PENDING | TARGET_HIT | STOPPED | PROFIT_TAKEN | EXPIRED | TRAILING_PROFIT
  final_price?: number | null;
  profit_loss_percent?: number | null;
  actual_return?: number | null;
  hit_target?: boolean;
  hit_stop_loss?: boolean;
  holding_days?: number;
  evaluation_date?: string | null; // outcome_date
  persona?: string | null;
  created_at?: string;
  // FIX-5C: highest/lowest + exit_type + target_price_2 — الـ backend بـ يـ returnهم
  // من /api/predictions/honest-tracking/list (FIX-5D).
  highest_price_reached?: number | null;
  lowest_price_reached?: number | null;
  exit_type?: string | null;
  target_price_2?: number | null;
}

export interface HonestListResponse {
  success: boolean;
  predictions: HonestPredictionItem[];
  pagination?: { total: number; limit: number; offset: number; has_more: boolean };
  source?: string;
}

// ── الفرص الضائعة (missed opportunities) ──
// ناتج الـ endpoint: /api/predictions/honest-tracking/missed-opportunities
export interface MissedOpportunityItem {
  id: number;
  ticker: string;
  name: string | null;
  signal: string;
  entry_price: number;
  target_price: number | null;
  stop_loss: number | null;
  prediction_date: string;
  current_price: number;
  pct_change: number;
  persona: string | null;
  master_score: number | null;
}

export interface MissedOpportunitiesResponse {
  success?: boolean;
  missed_bulls?: MissedOpportunityItem[];
  false_positives?: MissedOpportunityItem[];
  correct_buys?: MissedOpportunityItem[];
  correct_sells?: MissedOpportunityItem[];
}

export interface ExecutiveReportViewProps {
  market?: string;
  initialDays?: ReportTimeframe;
  onClose?: () => void;
  className?: string;
}

// ── Sub-component prop types ──

export interface HighlightItem {
  ticker: string;
  nameAr?: string;
  returnPct: number;
  meta: string;
  rightMeta: string;
  accentText: string;
}

export interface PersonaStats {
  winRate: number;
  profitFactor: number;
  avgWinPct: number;
  wins: number;
  losses: number;
}

// Computed stats shape returned by `computeStats()` (helpers.ts).
export interface ComputedStats {
  total: number;
  wins: number;
  losses: number;
  pending: number;
  expired: number;
  settled: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  totalProfit: number;
  closedCount: number;
  statsByPersona: Record<'gambler' | 'balanced' | 'conservative', PersonaStatsItem>;
}
