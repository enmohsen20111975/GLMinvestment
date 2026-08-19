/**
 * Data Freshness Check Utility
 * فحص حداثة البيانات
 *
 * Checks if database data is fresh enough to serve to the frontend.
 * If data is stale, triggers a background refresh.
 *
 * This solves the problem of the data engine continuously updating data
 * but the frontend not being aware of new data.
 */

import { openDb } from '@/lib/shared-db';
import { invalidateCachePrefix, invalidateCache } from '@/lib/cache/api-cache';
import { resetLightDbState } from '@/lib/egx-db';

// Freshness thresholds in minutes
const THRESHOLDS = {
  intraday: 15,   // Intraday data should be < 15 minutes old
  daily: 1440,    // Daily data should be < 24 hours old
  historical: 4320, // Historical data should be < 3 days old
};

interface FreshnessResult {
  is_fresh: boolean;
  minutes_old: number | null;
  last_update: string | null;
  category: string;
  action_taken: string;
}

/**
 * Check data freshness for stocks and optionally trigger refresh
 */
export function checkStocksFreshness(market?: string): FreshnessResult {
  try {
    const db = openDb('stocks.db');

    let query = `SELECT MAX(last_update) as last_update FROM stocks WHERE current_price > 0 AND (is_active = 1 OR is_active IS NULL)`;
    const params: string[] = [];

    if (market) {
      query = `SELECT MAX(last_update) as last_update FROM stocks WHERE market = ? AND current_price > 0 AND (is_active = 1 OR is_active IS NULL)`;
      params.push(market);
    }

    const result = db.prepare(query).get(...params) as { last_update: string | null };
    const lastUpdate = result?.last_update || null;

    if (!lastUpdate) {
      return {
        is_fresh: false,
        minutes_old: null,
        last_update: null,
        category: market || 'all_stocks',
        action_taken: 'no_data',
      };
    }

    const minutesOld = Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 60000);
    const isFresh = minutesOld < THRESHOLDS.intraday;

    return {
      is_fresh: isFresh,
      minutes_old: minutesOld,
      last_update: lastUpdate,
      category: market || 'all_stocks',
      action_taken: isFresh ? 'none' : 'stale_detected',
    };

  } catch (error) {
    return {
      is_fresh: false,
      minutes_old: null,
      last_update: null,
      category: market || 'all_stocks',
      action_taken: `error: ${(error as Error).message}`,
    };
  }
}

/**
 * Check price history freshness for a specific ticker
 */
export function checkPriceHistoryFreshness(ticker: string): FreshnessResult {
  try {
    const db = openDb('stocks.db');

    const result = db.prepare(
      `SELECT MAX(date) as last_date FROM stock_price_history WHERE ticker = ?`
    ).get(ticker.toUpperCase()) as { last_date: string | null };

    const lastDate = result?.last_date || null;

    if (!lastDate) {
      return {
        is_fresh: false,
        minutes_old: null,
        last_update: null,
        category: `price_history_${ticker}`,
        action_taken: 'no_data',
      };
    }

    // For daily data, check against daily threshold
    const minutesOld = Math.floor((Date.now() - new Date(lastDate).getTime()) / 60000);
    const isFresh = minutesOld < THRESHOLDS.daily;

    return {
      is_fresh: isFresh,
      minutes_old: minutesOld,
      last_update: lastDate,
      category: `price_history_${ticker}`,
      action_taken: isFresh ? 'none' : 'stale_detected',
    };

  } catch (error) {
    return {
      is_fresh: false,
      minutes_old: null,
      last_update: null,
      category: `price_history_${ticker}`,
      action_taken: `error: ${(error as Error).message}`,
    };
  }
}

/**
 * Check daily prices freshness
 */
export function checkDailyPricesFreshness(): FreshnessResult {
  try {
    const db = openDb('stocks.db');

    const result = db.prepare(
      `SELECT MAX(price_date) as last_date FROM stock_daily_prices`
    ).get() as { last_date: string | null };

    const lastDate = result?.last_date || null;

    if (!lastDate) {
      return {
        is_fresh: false,
        minutes_old: null,
        last_update: null,
        category: 'daily_prices',
        action_taken: 'no_data',
      };
    }

    const minutesOld = Math.floor((Date.now() - new Date(lastDate).getTime()) / 60000);
    const isFresh = minutesOld < THRESHOLDS.daily;

    return {
      is_fresh: isFresh,
      minutes_old: minutesOld,
      last_update: lastDate,
      category: 'daily_prices',
      action_taken: isFresh ? 'none' : 'stale_detected',
    };

  } catch (error) {
    return {
      is_fresh: false,
      minutes_old: null,
      last_update: null,
      category: 'daily_prices',
      action_taken: `error: ${(error as Error).message}`,
    };
  }
}

/**
 * Clear all data caches so next API calls will read fresh data from databases.
 * Should be called after:
 * - Data sync operations
 * - Cron-triggered updates
 * - Manual data refresh
 */
export function clearAllDataCaches(): void {
  try {
    // Clear API response cache
    invalidateCachePrefix('stocks:');
    invalidateCachePrefix('analysis:');
    invalidateCachePrefix('market:');
    invalidateCachePrefix('hunter:');
    invalidateCachePrefix('predictions:');
    invalidateCache('market_overview');
    invalidateCache('top_movers');
    invalidateCache('market_summary');

    // Reset database connection state so fresh data is read
    try {
      resetLightDbState();
    } catch {
      // egx-db may not be initialized yet
    }

    console.log('[data-freshness] All data caches cleared');
  } catch (error) {
    console.error('[data-freshness] Error clearing caches:', error);
  }
}

/**
 * Comprehensive freshness check across all data categories.
 * Returns a summary of data health.
 */
export function getComprehensiveFreshness(): {
  overall_fresh: boolean;
  checks: FreshnessResult[];
  stale_categories: string[];
} {
  const checks: FreshnessResult[] = [];

  // Check EGX stocks
  checks.push(checkStocksFreshness('EGX'));

  // Check TADAWUL stocks
  checks.push(checkStocksFreshness('TADAWUL'));

  // Check daily prices
  checks.push(checkDailyPricesFreshness());

  // Determine stale categories
  const staleCategories = checks
    .filter(c => !c.is_fresh && c.action_taken !== 'error')
    .map(c => c.category);

  return {
    overall_fresh: staleCategories.length === 0,
    checks,
    stale_categories: staleCategories,
  };
}

/**
 * If data is stale, attempt a background refresh by triggering the sync endpoint.
 * This is non-blocking - it just fires off the request.
 */
export async function triggerBackgroundRefreshIfNeeded(): Promise<boolean> {
  try {
    const freshness = checkStocksFreshness();

    // Only trigger if data is > 30 minutes old
    if (freshness.minutes_old !== null && freshness.minutes_old > 30) {
      console.log(`[data-freshness] Data is ${freshness.minutes_old} min old, triggering background sync`);

      // Fire and forget - don't await
      fetch('/api/market/sync-live', {
        method: 'POST',
        headers: { 'x-force-refresh': 'true' },
      }).catch(() => {
        // Silent - best effort
      });

      return true;
    }

    return false;
  } catch {
    return false;
  }
}
