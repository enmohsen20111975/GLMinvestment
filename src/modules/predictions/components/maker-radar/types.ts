// ============================================================================
// types.ts — Maker Radar API contract + UI prop types
// ============================================================================
// Single source of truth for ALL TypeScript types used across the maker-radar/
// folder. Extracted from the original MakerRadarTab.tsx (F-Phase3-Split).
// ============================================================================

export type RadarPath =
 | 'A_pre_surge'
 | 'B_quiet_accumulation_strong'
 | 'C_quiet_accumulation_weak'
 | 'D_explosive_surge'
 | 'E_early_break';

export interface QuietDetails {
 signal_count: number;
 signals_met: string[];
 signals_failed: string[];
 days_high_volume?: number;
 avg_20_vol?: number;
 buy_pressure_days?: number;
 range_10d_pct?: number;
 avg_vol_ratio?: number;
 roc_10d?: number;
 distribution_days?: number;
}

export interface PreSurgeDetails {
 signal_count: number;
 signals_met: string[];
 signals_failed: string[];
 volume_gradient?: number;
 range_10d_pct?: number;
 buy_days_7?: number;
 distance_from_ma10_pct?: number;
}

export interface ExplosiveDetails {
 vol_ratio: number;
 sma20: number;
 price_vs_sma20: number;
 range_pct: number;
 range_compressed: boolean;
}

export interface RadarStock {
 ticker: string;
 current_price: number;
 price_bucket: 'low_price' | 'mid_price' | 'high_price';
 avg_turnover_20d: number;
 avg_volume_20d: number;
 avg_volume_10d: number;
 volume_ratio_10d_vs_20d: number;
 price_stability: number;
 range_10d_pct: number;
 roc_10d: number | null;
 roc_30d?: number | null;
 maker_activity?: string | null;
 buy_pct?: number | null;
 net_flow_egp?: number | null;
 kill_switch?: boolean | null;
 life_cycle?: string | null;
 accumulation?: string | null;
 expected?: string | null;
 path: RadarPath;
 position_size: number;
 reason: string;
 quiet_details?: QuietDetails | null;
 pre_surge_details?: PreSurgeDetails | null;
 explosive_details?: ExplosiveDetails | null;
 break_reason?: string | null;
 isTracked?: boolean;
 trackingEntryDate?: string;
 trackingEntryPrice?: number;
 changeSinceTracking?: number;
 // ─── FRESHNESS GUARD (Task FIX-STALE-DTPP-2026-10-07) ────────────────
 // كل الأسهم تحت الميكروسكوب لازم تبان للعميل بـ freshness metadata
 // عشان يقدر يثق في إن السعر اللي شايفه فعلاً live (مش قديم بـ 10 أيام)
 last_close_date?: string | null; // آخر تاريخ إغلاق في الـ DB
 staleness_days?: number | null; // كم يوم قديم (0=اليوم، 1=أمس، ...)
 // B3 (Task 2-a): extended to include new lowercase values from price_sanity.
 // Legacy values: 'fresh' | 'stale' | 'very_stale' | 'unknown'.
 // New B3 values: 'invalid' (B1 DATA_INVALID) | 'unavailable' (B1 DATA_UNAVAILABLE).
 data_quality?: 'fresh' | 'stale' | 'very_stale' | 'unknown' | 'invalid' | 'unavailable' | null;
 data_stale?: boolean | null; // true لو stale
 live_price?: number | null; // السعر الحي من stocks.current_price
 live_change_percent?: number | null;
 live_last_update?: string | null; // ISO timestamp آخر تحديث لـ stocks
 price_source?: 'live' | 'daily' | null; // مصدر current_price
 data_date?: string | null; // التاريخ الفعلي للسعر المعروض
 // ─── B3 (Task 2-a): additive classification contract ──────────────────
 // canonical mutually-exclusive classification from the radar engine.
 // Consumers MUST treat 'unclassified' | 'INSUFFICIENT_DATA' | 'DATA_INVALID'
 // as "no actionable signal" — NOT as a trade opportunity, NOT as a dead trap.
 classification?: RadarClassification | null;
 // Uppercase enum from B1 price_sanity gate. Mirrors API route's enum.
 data_quality_status?: 'OK' | 'STALE' | 'INVALID' | 'UNAVAILABLE' | null;
 // B1 sanity gate status (separate from data_quality_status — sanity is about
 // price contamination, data_quality_status is about freshness).
 sanity_status?: 'OK' | 'DATA_INVALID' | 'STALE' | 'DATA_UNAVAILABLE' | null;
 sanity_reasons?: string[] | null;
 // B3: human-readable list of reasons (joined into a single string by API for
 // `phase_reason`, but the raw array is also surfaced for transparency).
 reasons?: string[] | null;
 // B3: ISO timestamp when this ticker was scanned by maker_radar.py.
 scan_timestamp?: string | null;
 // B3: identity fields for cross-market display.
 company?: string | null;
 market?: string | null;
 currency?: string | null;
}

// ─── B3 (Task 2-a): canonical classification enum ──────────────────────
// Mirrors the B3 contract from scripts/maker_radar.py::_classify_scanned_result.
// 'unclassified' / 'INSUFFICIENT_DATA' / 'DATA_INVALID' MUST be treated as
// "no actionable signal" — never as a dead-trap or trade opportunity.
export type RadarClassification =
 | 'quiet_accumulation'
 | 'distribution'
 | 'dead_trap'
 | 'liquidity_drought'
 | 'rule80_downtrend'
 | 'unclassified'
 | 'INSUFFICIENT_DATA'
 | 'DATA_INVALID';

export interface MakerRadarResponse {
 success: boolean;
 market?: string;
 market_regime?: {
 regime: string;
 raw_regime: string;
 effective_regime?: string;
 candidate_regime?: string;
 candidate_days?: number;
 breadth_pct?: number;
 turnover_ratio?: number;
 index_daily_change_pct?: number;
 reasons?: string[];
 } | null;
 min_quiet_signals?: number;
 min_price?: number;
 total_scanned?: number;
 under_microscope_count?: number;
 quiet_count?: number;
 pre_surge_count?: number;
 explosive_count?: number;
 early_break_count?: number;
 quiet_list?: RadarStock[];
 pre_surge_list?: RadarStock[];
 explosive_list?: RadarStock[];
 early_break_list?: RadarStock[];
 tracked_count?: number;
 tracked_tickers?: string[];
 generated_at?: string;
 cached?: boolean;
 cache_age_seconds?: number;
 cache_stale?: boolean;
 warmup_running?: boolean;
 cache_generated_at?: string;
 db_source?: string;
 last_warmup_status?: 'idle' | 'running' | 'success' | 'failed';
 last_warmup_finished_at?: string;
 last_warmup_duration_ms?: number;
 last_error?: string | null;
 warming_up?: boolean;
 error?: string;
}

export interface PriceRow {
 date: string;
 open: number;
 high: number;
 low: number;
 close: number;
 volume: number;
 turnover: number;
}

export interface StockStats {
 lastClose: number;
 changePct: number;
 roc10d: number;
 avgVolume20: number;
 avgTurnover20: number;
 max20: number;
 min20: number;
 range20Pct: number;
 dataPoints: number;
}

export interface StockInfoRow {
 ticker: string;
 name?: string;
 name_ar?: string;
 sector?: string | null;
 industry?: string | null;
 market_cap?: number | null;
 pe_ratio?: number | null;
 pb_ratio?: number | null;
 ps_ratio?: number | null;
 eps?: number | null;
 roe?: number | null;
 roa?: number | null;
 dividend_yield?: number | null;
 support?: number | null;
 resistance?: number | null;
 change_percent?: number | null;
 high_52w?: number | null;
 low_52w?: number | null;
}

export interface StockDetail {
 success: boolean;
 ticker: string;
 stock_info?: StockInfoRow | null;
 prices?: PriceRow[];
 stats?: StockStats;
 prediction?: {
 entry_price?: number | null;
 entry_price_min?: number | null;
 entry_price_max?: number | null;
 target_price?: number | null;
 target_price_2?: number | null;
 stop_loss?: number | null;
 support_level?: number | null;
 support_level_2?: number | null;
 resistance_level?: number | null;
 resistance_level_2?: number | null;
 risk_reward?: number | null;
 signal?: string | null;
 } | null;
 entryCard?: any;
 tracking?: {
 isTracked: boolean;
 entryDate?: string;
 entryPrice?: number;
 currentPrice?: number;
 changeSinceTracking?: number;
 daysTracked?: number;
 } | null;
}

export interface StockListItem {
 ticker: string;
 name?: string;
 name_ar?: string;
 sector?: string | null;
 market_cap?: number | null;
 pe_ratio?: number | null;
 pb_ratio?: number | null;
 roe?: number | null;
 eps?: number | null;
 change_percent?: number | null;
 dividend_yield?: number | null;
 support?: number | null;
 resistance?: number | null;
 high_52w?: number | null;
 low_52w?: number | null;
 current_price?: number | null;
 logo_url?: string | null;
}

export interface StocksListResponse {
 success: boolean;
 stocks?: StockListItem[];
 total?: number;
}

export interface SectorAgg {
 sector: string;
 avgChange: number;
 advancers: number;
 decliners: number;
 totalStocks: number;
 totalTurnover: number;
 marketCapSum: number;
}

export type AccentKey = 'amber' | 'rose' | 'emerald' | 'purple';

export interface PathDescription {
 emoji: string;
 /** Recommended position-size tier (display-only — actual size from API). */
 tier: 'top' | 'high' | 'mid' | 'monitor';
}

export interface MakerRadarTabProps {
 market?: string;
}

export type FilterKey = 'all' | 'pre_surge' | 'quiet' | 'explosive' | 'early_break' | 'tracked';

/** Lightweight prediction entry stitched from predictions.db active rows */
export interface PredictionEntry {
 signal: string; // e.g. 'BUY', 'SELL', 'NEUTRAL'
 signal_ar: string; // e.g. 'شراء', 'بيع', 'محايد'
 direction: string | null; // 'up' | 'down' | null
 confidence: number | null; // 0–100
 master_score: number | null;
 entry_price: number | null; // ← FIX: was missing (caused entry column to show '—' / 0)
 target_price: number | null;
 stop_loss: number | null;
}

export interface KpiCardProps {
 icon: React.ReactNode;
 label: string;
 // FIX-UI-AUDIT: widened from `number` to `number | string` so KPI cards
 // can display ticker symbols (e.g. «أقوى زخم حالي» = ticker name).
 value: number | string;
 sub?: string;
 accent: 'blue' | 'amber' | 'rose' | 'emerald' | 'gold';
}

export interface RadarActivityCardProps {
 data: MakerRadarResponse | null;
 lastUpdated: Date | null;
 period?: '7d' | '30d' | '90d';
 onPeriodChange?: (p: '7d' | '30d' | '90d') => void;
}

export interface SectorHeatStripProps {
 sectors: SectorAgg[];
 loading: boolean;
}

export interface RadarSectionProps {
 title: string;
 subtitle: string;
 icon: React.ReactNode;
 accent: AccentKey;
 stocks: RadarStock[];
 market: string;
 sectorForTicker: (ticker: string) => string | null;
 changePercentForTicker: (ticker: string) => number | null;
 stockInfoForTicker: (ticker: string) => StockListItem | null;
 predictionForTicker: (ticker: string) => PredictionEntry | null;
 onSelect: (ticker: string, stock?: RadarStock | null) => void;
 onTrackToggle: (ticker: string, price: number, isTracked: boolean) => void;
}

export interface StockTableProps {
 stocks: RadarStock[];
 accent: AccentKey;
 market: string;
 sectorForTicker: (ticker: string) => string | null;
 changePercentForTicker: (ticker: string) => number | null;
 stockInfoForTicker: (ticker: string) => StockListItem | null;
 predictionForTicker: (ticker: string) => PredictionEntry | null;
 onSelect: (ticker: string, stock?: RadarStock | null) => void;
 onTrackToggle: (ticker: string, price: number, isTracked: boolean) => void;
}

export type RadarStockRow = RadarStock & { _idx: number; [key: string]: unknown };

export interface StockDetailDrawerProps {
 ticker: string;
 /** Parent radar stock — supplies path, position_size, signal_count for the
 * Smart Entry Card header. Optional because the drawer can also be opened
 * from outside the radar table (e.g. deep-link). */
 radarStock?: RadarStock | null;
 sectorForTicker: (ticker: string) => string | null;
 sectorChangeForTicker: (ticker: string) => number | null;
 onClose: () => void;
 onTrackToggle: (ticker: string, price: number, isTracked: boolean) => void;
}

export interface TradingFieldRowProps {
 label: string;
 value: string;
 sub?: string;
 valueClass?: string;
}

export interface StatCardProps {
 label: string;
 value: string;
 sub?: string;
 valueClass?: string;
 icon?: React.ReactNode;
}

export interface ProofMetricCardProps {
 icon: React.ReactNode;
 label: string;
 value: string;
 sub?: string;
 accent: 'blue' | 'amber' | 'rose' | 'emerald';
}
