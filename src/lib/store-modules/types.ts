// Store types — extracted (Phase 3)

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
import { trackStockView, trackFeature } from '@/lib/analytics';
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
      high_52w: null,
      low_52w: null,
    };
  }
  // Helper: parse number-or-null safely (don't coerce null/undefined to 0 for optional stats)
