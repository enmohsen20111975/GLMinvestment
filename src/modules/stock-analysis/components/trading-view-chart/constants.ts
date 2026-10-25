// TradingViewChart constants — extracted (Phase 3)

const VOLUME_UP = 'rgba(8, 153, 129, 0.5)';
const VOLUME_DOWN = 'rgba(242, 54, 69, 0.5)';

const SMA20_COLOR = '#FF6B6B'; // Red
const SMA50_COLOR = '#4ECDC4'; // Teal
const SMA200_COLOR = '#FFE66D'; // Yellow
const EMA20_COLOR = '#A855F7'; // Purple
const BB_COLOR = '#8B5CF6'; // Purple for Bollinger
const RSI_COLOR = '#F59E0B'; // Amber
const MACD_COLOR = '#3B82F6'; // Blue
const MACD_SIGNAL_COLOR = '#EF4444'; // Red
const STOCH_K_COLOR = '#10B981'; // Green
const STOCH_D_COLOR = '#F59E0B'; // Amber
const ATR_COLOR = '#6366F1'; // Indigo
const OBV_COLOR = '#14B8A6'; // Teal

export const RESOLUTIONS = [
 { key: 'D', label: 'يومي', isIntraday: false },
 { key: 'W', label: 'أسبوعي', isIntraday: false },
];

export const RANGES = [
 { key: '1d', label: '1D', days: 1 },
 { key: '5d', label: '5D', days: 5 },
 { key: '1m', label: '1M', days: 30 },
 { key: '3m', label: '3M', days: 90 },
 { key: '6m', label: '6M', days: 180 },
 { key: '1y', label: '1Y', days: 365 },
 { key: 'all', label: 'الكل', days: 9999 },
];

const TIMEFRAMES = RESOLUTIONS;

// ─── Helper Functions ────────────────────────────────────────────────────────

