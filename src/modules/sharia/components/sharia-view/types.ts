// ShariaView types (Phase 3)
export type ShariaStatus = 'compliant' | 'non_compliant' | 'pending';
export interface ShariaRow {
  ticker: string;
  name_ar: string;
  sector: string;
  status: ShariaStatus;
  purification_rate: number | null;
  // Runtime fields surfaced by the API/derived shapes:
  symbol?: string;
  compliant_sources_count?: number;
  active_sources_count?: number;
  sp_haram_earning_pct?: number | null;
  is_halal_consensus?: number | null;
  category_ar?: string | null;
}
export interface PurificationResponse {
  success: boolean;
  purification_rate: number;
  purified_amount: number;
  // Extra runtime fields surfaced by the calculator response shape:
  error?: string;
  detail?: string;
  purification_amount?: number;
  purification_rate_pct?: number;
  dividends?: number;
  realized_capital_gain?: number;
  method?: string;
  primary_method?: string;
}

export const STATUS_BADGE_CLASS: Record<string, string> = {
  compliant: 'bg-profit/10 text-profit border-profit/20',
  non_compliant: 'bg-loss/10 text-loss border-loss/20',
  pending: 'bg-warning/10 text-warning border-warning/20',
};

export const STATUS_EMOJI: Record<string, string> = {
  compliant: '✅',
  non_compliant: '❌',
  pending: '⏳',
};

export const STATUS_LABELS_AR: Record<string, string> = {
  compliant: 'متوافق',
  non_compliant: 'غير متوافق',
  pending: 'قيد المراجعة',
};

export const SHARIA_SOURCES: Record<string, string> = {
  sp: 'S&P',
  musaffa: 'Musaffa',
  kashif: 'Kashif',
  osoul: 'Osoul',
};
