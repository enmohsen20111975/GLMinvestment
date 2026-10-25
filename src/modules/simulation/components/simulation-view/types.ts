import type { MarketType } from '@/lib/store';

/* ============================================================
 * SimulationView — Types
 * Shared types for the trading simulation module.
 * ============================================================ */

export interface EGXStock {
  ticker: string;
  name_ar: string;
  sector: string;
  basePrice: number;
  price: number;
  change: number;
  changePercent: number;
  market?: MarketType;
}

export interface Position {
  ticker: string;
  shares: number;
  avgCost: number;
}

export interface Transaction {
  id: string;
  date: string;
  type: 'buy' | 'sell';
  ticker: string;
  shares: number;
  price: number;
  total: number;
  commission: number;
  pnl?: number;
}

export interface PortfolioSnapshot {
  date: string;
  portfolioValue: number;
  timestamp: number;
}

export interface SimState {
  balance: number;
  positions: Position[];
  transactions: Transaction[];
  watchlist: string[];
  history: PortfolioSnapshot[];
  startedAt: string;
}

export interface PendingTrade {
  type: 'buy' | 'sell';
  stock: EGXStock;
  quantity: number;
  total: number;
  commission: number;
}

export interface StockSeed {
  ticker: string;
  name_ar: string;
  sector: string;
  basePrice: number;
}
