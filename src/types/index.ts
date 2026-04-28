// ==================== MARKET TYPES ====================

export interface MarketIndex {
  symbol: string;
  name: string;
  name_ar: string;
  value: number;
  previous_close: number;
  change: number;
  change_percent: number;
  last_updated: string | null;
}

export interface MarketSummary {
  total_stocks: number;
  gainers: number;
  losers: number;
  unchanged: number;
  egx30_stocks: number;
  egx70_stocks: number;
  egx100_stocks: number;
  egx30_value: number;
}

export interface MarketOverview {
  market_status: MarketStatus;
  summary: MarketSummary;
  indices: MarketIndex[];
  top_gainers: StockMini[];
  top_losers: StockMini[];
  most_active: StockMini[];
  last_updated: string;
}

export interface MarketStatus {
  is_open: boolean;
  status: string;
  next_open: string | null;
  next_close: string | null;
  current_session: string | null;
}

// ==================== STOCK TYPES ====================

export interface StockMini {
  ticker: string;
  name: string;
  name_ar: string;
  current_price: number;
  price_change: number | null;
  volume?: number;
}

export interface Stock extends StockMini {
  id?: number;
  previous_close: number;
  open_price: number;
  high_price: number;
  low_price: number;
  volume: number;
  market_cap: number;
  pe_ratio: number;
  pb_ratio: number;
  dividend_yield: number;
  eps: number;
  roe: number;
  debt_to_equity: number;
  support_level: number;
  resistance_level: number;
  ma_50: number;
  ma_200: number;
  rsi: number;
  sector: string;
  industry: string;
  egx30_member: boolean;
  egx70_member: boolean;
  egx100_member: boolean;
  compliance_status?: string;
  is_active: boolean;
  is_egx: boolean;
  last_update: string;
  value_traded?: number;
}

export interface StockListResponse {
  stocks: Stock[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface PriceHistoryPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceHistorySummary {
  highest: number;
  lowest: number;
  avg_price: number;
  total_volume: number;
  start_price: number;
  end_price: number;
  change_percent: number;
}

export interface PriceHistoryResponse {
  success: boolean;
  ticker: string;
  data: PriceHistoryPoint[];
  summary: PriceHistorySummary;
  days: number;
}

export interface DeepAnalysis {
  ticker: string;
  stock_name: string;
  stock_name_ar: string;
  current_price: number;
  overall_score: number;
  technical_score: number;
  fundamental_score: number;
  risk_score: number;
  trend: string;
  trend_ar: string;
  action: string;
  action_ar: string;
  price_targets: {
    support: number;
    resistance: number;
    upside_target: number;
  };
  strengths: string[];
  risks: string[];
  technical_indicators: {
    rsi_signal: string;
    ma_signal: string;
    volume_signal: string;
    momentum: string;
  };
}

// ==================== PORTFOLIO TYPES ====================

export interface PortfolioRecommendation {
  ticker: string;
  name: string;
  current_price: number;
  allocation_amount: number;
  allocation_percent: number;
  recommended_shares: number;
  score: number;
  sector: string;
  pe_ratio?: number;
  dividend_yield?: number;
}

export interface PortfolioRecommendResponse {
  capital: number;
  risk_level: string;
  investment_horizon?: string;
  recommendations: PortfolioRecommendation[];
  portfolio_metrics?: {
    average_pe_ratio: number;
    average_dividend_yield: number;
    total_stocks: number;
  };
  generated_at: string;
}

export interface UserAsset {
  id: number;
  user_id: string;
  asset_type: string;
  asset_name: string;
  asset_ticker: string;
  stock_id: number | null;
  quantity: number;
  purchase_price: number;
  current_price: number;
  current_value: number;
  purchase_date: string;
  target_price: number | null;
  stop_loss_price: number | null;
  currency: string;
  notes: string | null;
  gain_loss: number | null;
  gain_loss_percent: number | null;
  is_active: boolean;
  auto_sync: boolean;
  created_at: string;
  stock?: Stock;
}

export interface PortfolioImpactItem {
  asset_id: number;
  ticker: string;
  name_ar: string;
  quantity: number;
  current_price: number;
  previous_close: number;
  market_value: number;
  day_impact_value: number;
  day_impact_percent: number;
  total_gain_loss_value: number;
  total_gain_loss_percent: number;
  sector: string | null;
  weight_percent: number;
  alerts: string[];
  is_day_loss_alert: boolean;
  is_concentration_alert: boolean;
}

export interface PortfolioImpactResponse {
  summary: {
    assets_count: number;
    total_market_value: number;
    total_invested: number;
    total_gain_loss: number;
    total_gain_loss_percent: number;
    day_impact_value: number;
    day_impact_percent: number;
  };
  thresholds: {
    day_loss_alert_percent: number;
    concentration_alert_percent: number;
  };
  recommendation: {
    action: string;
    action_label_ar: string;
    reason_ar: string;
    confidence: number;
  };
  risk_alerts: PortfolioImpactItem[];
  top_positive: PortfolioImpactItem[];
  top_negative: PortfolioImpactItem[];
  items: PortfolioImpactItem[];
}

// ==================== WATCHLIST TYPES ====================

export interface WatchlistItem {
  id: number;
  user_id: string;
  stock_id: number;
  alert_price_above: number | null;
  alert_price_below: number | null;
  alert_change_percent: number | null;
  notes: string | null;
  added_at: string;
  stock?: Stock;
}

// ==================== INCOME/EXPENSE TYPES ====================

export interface IncomeExpense {
  id: number;
  user_id: string;
  transaction_type: 'income' | 'expense';
  category: string;
  amount: number;
  currency: string;
  description: string | null;
  related_asset_id: number | null;
  related_stock_id: number | null;
  transaction_date: string;
  is_recurring: boolean;
  recurrence_period: string | null;
  created_at: string;
}

// ==================== AUTH TYPES ====================

export interface User {
  id: string;
  email: string;
  username: string;
  is_active: boolean;
  is_admin?: boolean;
  subscription_tier: string;
  default_risk_tolerance: string;
  created_at: string;
  last_login: string | null;
}

export interface AuthResponse {
  message: string;
  user: {
    id: string;
    email: string;
    username: string;
    default_risk_tolerance?: string;
  };
  api_key: string;
}

// ==================== AI INSIGHTS TYPES ====================

export interface AiInsights {
  market_sentiment: 'bullish' | 'bearish' | 'neutral';
  market_score: number;
  market_breadth: number;
  avg_change_percent: number;
  volatility_index: number;
  gainers: number;
  losers: number;
  unchanged: number;
  top_sectors: { name: string; count: number; avg_change_percent: number }[];
  stock_statuses: StockStatusItem[];
  decision: string;
  risk_assessment: 'low' | 'medium' | 'high';
  generated_at: string;
}

export interface StockStatusItem {
  ticker: string;
  name: string;
  name_ar: string;
  sector: string;
  current_price: number;
  price_change: number;
  volume: number;
  value_traded: number;
  score: number;
  status: 'strong' | 'positive' | 'neutral' | 'weak';
  components: {
    momentum: number;
    liquidity: number;
    valuation: number;
    income: number;
    traded_value: number;
  };
  fair_value: number;
  upside_to_fair: number;
  verdict: 'undervalued' | 'fair' | 'overvalued';
  verdict_ar: string;
}

// ==================== NOTIFICATION TYPES ====================

export interface Notification {
  id: string;
  type: 'price_alert' | 'portfolio_update' | 'market_event' | 'system';
  title: string;
  title_ar: string;
  message: string;
  message_ar: string;
  data?: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

// ==================== APP STATE ====================

export type AppView =
  | 'dashboard'
  | 'stocks'
  | 'stock-detail'
  | 'portfolio'
  | 'watchlist'
  | 'finance'
  | 'recommendations'
  | 'reports'
  | 'learning'
  | 'simulation'
  | 'settings'
  | 'auth'
  | 'admin'
  | 'analysis'
  | 'subscription';

export interface AppState {
  currentView: AppView;
  selectedTicker: string | null;
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  user: User | null;
  apiKey: string | null;
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  searchQuery: string;
}

// ===== FINANCIAL TRACKING TYPES =====

// Enhanced Watchlist with purchase price and P&L
export interface EnhancedWatchlistItem extends WatchlistItem {
  purchase_price: number | null;
  quantity: number | null;
  current_price: number;
  price_change: number;
  price_change_percent: number;
  total_invested: number;
  current_value: number;
  gain_loss: number;
  gain_loss_percent: number;
}

// Portfolio Asset Types
export type AssetType = 'stock' | 'gold' | 'bank' | 'certificate' | 'fund' | 'real_estate' | 'other';

export interface PortfolioAsset {
  id?: number;
  user_id: string;
  type: AssetType;
  name: string;
  // Common
  total_invested: number;
  current_value: number;
  notes?: string;
  added_at?: string;
  updated_at?: string;
  // Gold specific
  weight_grams?: number;
  karat?: number;
  purchase_price_per_gram?: number;
  // Bank specific
  bank_name?: string;
  interest_rate?: number;
  // Certificate specific
  certificate_duration_months?: number;
  certificate_return_rate?: number;
  certificate_maturity_date?: string;
  // Fund specific
  fund_name?: string;
  fund_type?: string;
  // Stock specific (references existing stocks)
  stock_id?: number;
  stock_ticker?: string;
  quantity?: number;
  avg_buy_price?: number;
}

// Income & Expense Tracking
export type TransactionType = 'income' | 'expense';
export type IncomeCategory = 'salary' | 'bonus' | 'investment_return' | 'rental' | 'business' | 'freelance' | 'other_income';
export type ExpenseCategory = 'education' | 'housing' | 'transport' | 'food' | 'healthcare' | 'entertainment' | 'travel' | 'clothing' | 'utilities' | 'insurance' | 'debt_payment' | 'other_expense';

export interface FinancialTransaction {
  id?: number;
  user_id: string;
  type: TransactionType;
  category: IncomeCategory | ExpenseCategory;
  amount: number;
  description: string;
  is_recurring: boolean;
  recurring_frequency?: 'monthly' | 'weekly' | 'yearly';
  transaction_date: string;
  notes?: string;
  created_at?: string;
}

// Financial Obligations
export type ObligationType = 'loan' | 'installment' | 'credit_card' | 'mortgage';

export interface FinancialObligation {
  id?: number;
  user_id: string;
  type: ObligationType;
  name: string;
  creditor: string;
  total_amount: number;
  remaining_amount: number;
  monthly_payment: number;
  interest_rate?: number;
  start_date: string;
  end_date?: string;
  next_payment_date?: string;
  status: 'active' | 'paid' | 'overdue';
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

// Payment History for obligations
export interface ObligationPayment {
  id?: number;
  obligation_id: number;
  user_id: string;
  amount: number;
  payment_date: string;
  principal_amount: number;
  interest_amount: number;
  notes?: string;
  created_at?: string;
}

// Reports
export interface PortfolioSummary {
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
  assets_by_type: Record<AssetType, number>;
  monthly_income: number;
  monthly_expenses: number;
  monthly_savings: number;
  savings_rate: number;
  alerts: FinancialAlert[];
}

export interface FinancialAlert {
  type: 'warning' | 'danger' | 'info';
  category: string;
  message: string;
  value?: number;
  threshold?: number;
}

export interface IncomeExpenseSummary {
  total_income: number;
  total_expenses: number;
  net_savings: number;
  income_by_category: Record<string, number>;
  expenses_by_category: Record<string, number>;
  monthly_trend: { month: string; income: number; expenses: number }[];
}
