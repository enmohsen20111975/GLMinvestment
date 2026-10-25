import type { MarketType } from '@/lib/store';
import type { EGXStock } from './types';
import {
  STORAGE_KEY_BY_MARKET,
  INITIAL_BALANCE,
  getDefaultState,
} from './constants';
import type { SimState } from './types';

/* ============================================================
 * SimulationView — Helpers
 * Stock adaptation, formatting, market timing, and localStorage
 * load/save routines for the per-market simulation state.
 * ============================================================ */

// Adapt a raw stock returned by /api/stocks (backend shape mirrors the
// stocks.db schema — see src/app/api/stocks/route.ts) into the EGXStock shape
// the simulator consumes. Accepts both stock + crypto row variants.
export function adaptApiStock(raw: Record<string, unknown>, market: MarketType): EGXStock | null {
  const ticker = (raw.ticker as string) || (raw.symbol as string) || '';
  if (!ticker) return null;
  const nameAr = (raw.name_ar as string) || (raw.name as string) || ticker;
  const sector = (raw.sector as string) || (raw.industry as string) || (market === 'CRYPTO' ? 'العملات الرقمية' : 'أخرى');
  const basePrice = Number(raw.current_price ?? raw.price ?? raw.price_usd ?? 0) || Number(raw.last_price ?? 0) || 0;
  // For crypto especially, some coins return current_price = 0 from the fallback
  // path — skip those rows so the user doesn't see "BTC at 0".
  if (!basePrice || basePrice <= 0) return null;
  const price = Number(basePrice.toFixed(basePrice < 1 ? 4 : 2));
  return {
    ticker,
    name_ar: nameAr,
    sector,
    basePrice: price,
    price,
    change: 0,
    changePercent: 0,
    market,
  };
}

/* ─── Formatting ─── */

export function formatNumber(n: number, decimals = 2): string {
  return n.toLocaleString('ar-EG', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatCurrency(n: number, currencyLabel = 'ج.م'): string {
  return `${formatNumber(n)} ${currencyLabel}`;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/* ─── Market timing (Cairo time) ─── */

export function isMarketOpen(): boolean {
  const now = new Date();
  // Use UTC+2 for Cairo time
  const cairoHour = now.getUTCHours() + 2;
  const day = now.getUTCDay();
  if (day === 5 || day === 6) return false; // Friday/Saturday off
  return cairoHour >= 9 && cairoHour < 15; // 9:30 AM - 2:30 PM approx
}

export function getCairoTime(): string {
  const now = new Date();
  const cairoHour = (now.getUTCHours() + 2) % 24;
  const cairoMin = now.getUTCMinutes();
  return `${String(cairoHour).padStart(2, '0')}:${String(cairoMin).padStart(2, '0')}`;
}

/* ─── Persistence (per-market localStorage) ─── */

export function loadState(market: MarketType): SimState {
  if (typeof window === 'undefined') return getDefaultState();
  try {
    const key = STORAGE_KEY_BY_MARKET[market] || STORAGE_KEY_BY_MARKET.EGX;
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored) as SimState;
      return parsed;
    }
  } catch {
    // ignore
  }
  return getDefaultState();
}

export function saveState(state: SimState, market: MarketType): void {
  if (typeof window === 'undefined') return;
  try {
    const key = STORAGE_KEY_BY_MARKET[market] || STORAGE_KEY_BY_MARKET.EGX;
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore
  }
}

/* ─── Portfolio math ─── */

export function calcPortfolioValue(
  positions: SimState['positions'],
  currentStocks: EGXStock[],
): number {
  return positions.reduce((sum, pos) => {
    const stock = currentStocks.find((s) => s.ticker === pos.ticker);
    if (!stock) return sum;
    return sum + pos.shares * stock.price;
  }, 0);
}

/* Re-export the constants that callers frequently need alongside helpers */
export { INITIAL_BALANCE };
