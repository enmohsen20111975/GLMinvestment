/**
 * V2 Config Service - Database-driven configuration loader
 * All calculation constants come from the database, not hardcoded.
 * Includes caching with 5-minute TTL.
 */

import type { CalcWeight, MarketRegime, RegimeConfig, SectorAverages } from './types';

// ==================== SINGLETON CACHE ====================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let weightsCache: CacheEntry<Map<string, CalcWeight>> | null = null;
let sectorAvgsCache: CacheEntry<Map<string, SectorAverages>> | null = null;
let regimeCache: CacheEntry<RegimeConfig> | null = null;

function isExpired<T>(entry: CacheEntry<T> | null): boolean {
  return !entry || Date.now() > entry.expiresAt;
}

// ==================== DATABASE ACCESS ====================

import { createDatabase, type SqliteDatabase } from '@/lib/sqlite-wrapper';
import * as path from 'path';

let _heavyDbUnavailable = false;

function getDb(): SqliteDatabase | null {
  if (_heavyDbUnavailable) return null;
  try {
    const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db');
    return createDatabase(dbPath, { readonly: true });
  } catch (err) {
    _heavyDbUnavailable = true;
    console.warn('[config-service] Heavy DB unavailable, using defaults:', err);
    return null;
  }
}

// ==================== WEIGHT LOADING ====================

/**
 * Load all calculation weights from database.
 * Cached for 5 minutes.
 */
export function loadWeights(): Map<string, CalcWeight> {
  if (!isExpired(weightsCache)) return weightsCache.data;

  const db = getDb();
  if (!db) {
    console.warn('[config-service] Using empty weights (heavy DB unavailable)');
    weightsCache = { data: new Map(), expiresAt: Date.now() + CACHE_TTL_MS };
    return weightsCache.data;
  }

  try {
    const rows = db.prepare('SELECT * FROM calculation_weights ORDER BY parameter_group, parameter_name').all() as Array<Record<string, unknown>>;
    const map = new Map<string, CalcWeight>();
    
    for (const row of rows) {
      const w: CalcWeight = {
        parameter_name: String(row.parameter_name),
        parameter_group: String(row.parameter_group),
        current_value: Number(row.current_value),
        min_bound: row.min_bound !== null ? Number(row.min_bound) : null,
        max_bound: row.max_bound !== null ? Number(row.max_bound) : null,
        auto_adjust: Boolean(row.auto_adjust),
        version: String(row.version),
        description: String(row.description || ''),
        updated_at: String(row.updated_at || ''),
        updated_by: String(row.updated_by || ''),
      };
      map.set(w.parameter_name, w);
    }

    weightsCache = { data: map, expiresAt: Date.now() + CACHE_TTL_MS };
    return map;
  } finally {
    db.close();
  }
}

/**
 * Get a single weight value by name. Returns fallback if not found.
 */
export function getWeight(name: string, fallback: number = 0): number {
  const weights = loadWeights();
  const entry = weights.get(name);
  return entry ? entry.current_value : fallback;
}

/**
 * Get a weight entry (full object) by name.
 */
export function getWeightEntry(name: string): CalcWeight | undefined {
  return loadWeights().get(name);
}

/**
 * Get all weights in a group.
 */
export function getWeightsByGroup(group: string): CalcWeight[] {
  const weights = loadWeights();
  return Array.from(weights.values()).filter(w => w.parameter_group === group);
}

/**
 * Get weights as a plain object for quick access.
 */
export function getWeightsAsObject(): Record<string, number> {
  const weights = loadWeights();
  const obj: Record<string, number> = {};
  for (const [key, val] of weights) {
    obj[key] = val.current_value;
  }
  return obj;
}

// ==================== SECTOR AVERAGES ====================

/**
 * Load sector averages from stocks table (computed on the fly, cached).
 */
export function loadSectorAverages(): Map<string, SectorAverages> {
  if (!isExpired(sectorAvgsCache)) return sectorAvgsCache.data;

  const db = getDb();
  if (!db) {
    const defaults = new Map<string, SectorAverages>();
    defaults.set('_global', { sector: '_global', avgPE: 12, avgPB: 1.5, avgROE: 10, avgDebtEquity: 0.8, avgDividendYield: 3, avgNetMargin: 8, stockCount: 0 });
    sectorAvgsCache = { data: defaults, expiresAt: Date.now() + CACHE_TTL_MS };
    return defaults;
  }

  try {
    const rows = db.prepare(`
      SELECT 
        sector,
        COUNT(*) as stock_count,
        AVG(CASE WHEN pe_ratio > 0 AND pe_ratio < 200 THEN pe_ratio END) as avg_pe,
        AVG(CASE WHEN pb_ratio > 0 AND pb_ratio < 50 THEN pb_ratio END) as avg_pb,
        AVG(CASE WHEN roe > -100 AND roe < 200 THEN roe END) as avg_roe,
        AVG(CASE WHEN debt_to_equity IS NOT NULL AND debt_to_equity > -10 AND debt_to_equity < 20 THEN debt_to_equity END) as avg_debt_equity,
        AVG(CASE WHEN dividend_yield IS NOT NULL AND dividend_yield >= 0 AND dividend_yield < 50 THEN dividend_yield END) as avg_dividend_yield,
        8.0 as avg_net_margin
      FROM stocks 
      WHERE is_active = 1 
        AND sector IS NOT NULL 
        AND sector != ''
        AND current_price > 0
      GROUP BY sector
      ORDER BY stock_count DESC
    `).all() as Array<Record<string, unknown>>;

    const map = new Map<string, SectorAverages>();
    for (const row of rows) {
      const sa: SectorAverages = {
        sector: String(row.sector),
        avgPE: Number(row.avg_pe) || 12,
        avgPB: Number(row.avg_pb) || 1.5,
        avgROE: Number(row.avg_roe) || 10,
        avgDebtEquity: Number(row.avg_debt_equity) || 0.8,
        avgDividendYield: Number(row.avg_dividend_yield) || 3,
        avgNetMargin: Number(row.avg_net_margin) || 8,
        stockCount: Number(row.stock_count),
      };
      map.set(sa.sector, sa);
    }

    // Global average as fallback
    if (!map.has('_global')) {
      const allStocks = db.prepare(`
        SELECT 
          COUNT(*) as stock_count,
          AVG(CASE WHEN pe_ratio > 0 AND pe_ratio < 200 THEN pe_ratio END) as avg_pe,
          AVG(CASE WHEN pb_ratio > 0 AND pb_ratio < 50 THEN pb_ratio END) as avg_pb,
          AVG(CASE WHEN roe > -100 AND roe < 200 THEN roe END) as avg_roe,
          AVG(CASE WHEN debt_to_equity IS NOT NULL AND debt_to_equity > -10 AND debt_to_equity < 20 THEN debt_to_equity END) as avg_debt_equity,
          AVG(CASE WHEN dividend_yield IS NOT NULL AND dividend_yield >= 0 AND dividend_yield < 50 THEN dividend_yield END) as avg_dividend_yield
        FROM stocks 
        WHERE is_active = 1 AND current_price > 0
      `).get() as Record<string, unknown>;

      map.set('_global', {
        sector: '_global',
        avgPE: Number(allStocks.avg_pe) || 12,
        avgPB: Number(allStocks.avg_pb) || 1.5,
        avgROE: Number(allStocks.avg_roe) || 10,
        avgDebtEquity: Number(allStocks.avg_debt_equity) || 0.8,
        avgDividendYield: Number(allStocks.avg_dividend_yield) || 3,
        avgNetMargin: 8,
        stockCount: Number(allStocks.stock_count),
      });
    }

    sectorAvgsCache = { data: map, expiresAt: Date.now() + CACHE_TTL_MS };
    return map;
  } finally {
    db.close();
  }
}

/**
 * Get sector average for a specific sector. Falls back to global average.
 */
export function getSectorAverage(sector: string): SectorAverages {
  const avgs = loadSectorAverages();
  return avgs.get(sector) || avgs.get('_global') || {
    sector: '_global',
    avgPE: 12,
    avgPB: 1.5,
    avgROE: 10,
    avgDebtEquity: 0.8,
    avgDividendYield: 3,
    avgNetMargin: 8,
    stockCount: 0,
  };
}

// ==================== MARKET REGIME DETECTION ====================

/**
 * Detect current market regime from EGX30 index performance.
 * Uses 20D/50D/200D moving averages.
 */
export function detectMarketRegime(): RegimeConfig {
  if (!isExpired(regimeCache)) return regimeCache.data;

  // Check if regime is manually set in DB
  const dbManualRegime = getWeight('market_regime', 0);
  if (dbManualRegime === 1) {
    const config: RegimeConfig = {
      regime: 'bull',
      thresholdMultiplier: getWeight('regime_bull_multiplier', 1.3),
      indexYTDChange: 0,
      detectedAt: new Date().toISOString(),
    };
    regimeCache = { data: config, expiresAt: Date.now() + CACHE_TTL_MS };
    return config;
  }
  if (dbManualRegime === -1) {
    const config: RegimeConfig = {
      regime: 'bear',
      thresholdMultiplier: getWeight('regime_bear_multiplier', 0.7),
      indexYTDChange: 0,
      detectedAt: new Date().toISOString(),
    };
    regimeCache = { data: config, expiresAt: Date.now() + CACHE_TTL_MS };
    return config;
  }

  const db = getDb();
  if (!db) {
    const config: RegimeConfig = {
      regime: 'neutral',
      thresholdMultiplier: 1.0,
      indexYTDChange: 0,
      detectedAt: new Date().toISOString(),
    };
    regimeCache = { data: config, expiresAt: Date.now() + CACHE_TTL_MS };
    return config;
  }

  try {
    let indexYTDChange = 0;
    let regime: MarketRegime = 'neutral';

    const marketChange = db.prepare(`
      SELECT 
        AVG(CASE WHEN previous_close > 0 
          THEN ((current_price - previous_close) / previous_close) * 100 
          ELSE 0 END) as avg_change,
        SUM(CASE WHEN previous_close > 0 AND current_price > previous_close THEN 1 ELSE 0 END) as gainers,
        COUNT(*) as total
      FROM stocks WHERE is_active = 1 AND previous_close > 0
    `).get() as Record<string, unknown>;

    if (marketChange) {
      const avgChange = Number(marketChange.avg_change) || 0;
      const gainers = Number(marketChange.gainers) || 0;
      const total = Number(marketChange.total) || 1;
      const breadth = gainers / total;

      const bullThreshold = getWeight('regime_bull_threshold', 20);
      const bearThreshold = getWeight('regime_bear_threshold', -15);

      // Use daily breadth as primary signal, change as secondary
      if (breadth > 0.55 && avgChange > 0.5) regime = 'bull';
      else if (breadth < 0.45 && avgChange < -0.5) regime = 'bear';

      indexYTDChange = avgChange;
    }

    const multiplier = regime === 'bull'
      ? getWeight('regime_bull_multiplier', 1.3)
      : regime === 'bear'
        ? getWeight('regime_bear_multiplier', 0.7)
        : 1.0;

    const config: RegimeConfig = {
      regime,
      thresholdMultiplier: multiplier,
      indexYTDChange: Math.round(indexYTDChange * 100) / 100,
      detectedAt: new Date().toISOString(),
    };

    regimeCache = { data: config, expiresAt: Date.now() + CACHE_TTL_MS };
    return config;
  } finally {
    db.close();
  }
}

/**
 * Get current market regime label.
 */
export function getMarketRegime(): MarketRegime {
  return detectMarketRegime().regime;
}

/**
 * Get the regime threshold multiplier.
 */
export function getRegimeMultiplier(): number {
  return detectMarketRegime().thresholdMultiplier;
}

// ==================== ADMIN OPERATIONS ====================

/**
 * Update a weight value (admin only). Uses writable DB connection.
 */
export function updateWeight(
  parameterName: string,
  newValue: number,
  updatedBy: string = 'admin',
  reason?: string
): boolean {
  try {
    const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db');
    const db = createDatabase(dbPath);
    db.pragma('journal_mode = WAL');

    // Get current value for circuit breaker check
    const current = db.prepare('SELECT current_value, min_bound, max_bound FROM calculation_weights WHERE parameter_name = ?')
      .get(parameterName) as { current_value: number; min_bound: number | null; max_bound: number | null } | undefined;

    if (!current) {
      db.close();
      return false;
    }

    // Circuit breaker: max ±20% change
    const maxChange = 0.20;
    const maxAllowed = current.current_value * (1 + maxChange);
    const minAllowed = current.current_value * (1 - maxChange);

    const clampedValue = Math.max(minAllowed, Math.min(maxAllowed, newValue));

    // Also respect min/max bounds
    const finalValue = clampedValue;
    if (current.min_bound !== null && finalValue < current.min_bound) {
      db.close();
      return false;
    }
    if (current.max_bound !== null && finalValue > current.max_bound) {
      db.close();
      return false;
    }

    db.prepare(`
      UPDATE calculation_weights 
      SET current_value = ?, updated_at = datetime('now'), updated_by = ?
      WHERE parameter_name = ?
    `).run(finalValue, updatedBy, parameterName);

    // Log the change
    db.prepare(`
      INSERT INTO audit_logs (action, details, created_at)
      VALUES (?, ?, datetime('now'))
    `).run('update_weight', JSON.stringify({
      parameter: parameterName,
      old_value: current.current_value,
      new_value: finalValue,
      requested_value: newValue,
      reason: reason || 'manual_update',
      updated_by: updatedBy,
    }));

    db.close();

    // Invalidate cache
    weightsCache = null;
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear all caches.
 */
export function clearCache(): void {
  weightsCache = null;
  sectorAvgsCache = null;
  regimeCache = null;
}
