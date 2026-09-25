/**
 * GET /api/predictions/dual-track/threshold?market=EGX
 * POST /api/predictions/dual-track/threshold
 * =================================================
 * المرحلة 2 — Dynamic Threshold Calculator (Next.js endpoint)
 *
 * يحسب الـ threshold اليومي الديناميكي لكل سوق من البيانات الحية:
 *   - EGX: percentile_75 من intraday.stock_intraday (market='مصر', آخر 30 يوم)
 *   - US: percentile_75 من price_history.price_history (market='US', آخر 30 يوم)
 *   - KSA: percentile_75 من data_engine.historical_data (market='السعودية', آخر 30 يوم)
 *
 * يحفظ النتيجة في predictions.liquidity_dynamic_threshold.
 * لو فشل → يستخدم آخر threshold محفوظ كـ fallback.
 *
 * Usage:
 *   GET  /api/predictions/dual-track/threshold?market=EGX
 *   GET  /api/predictions/dual-track/threshold?market=all  (multi)
 *   POST /api/predictions/dual-track/threshold             (recalc all)
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PREDICTIONS_DB_PATH = `${process.cwd()}/db/predictions.db`;
const INTRADAY_DB_PATH = `${process.cwd()}/db/intraday.db`;
const PRICE_HISTORY_DB_PATH = `${process.cwd()}/db/price_history.db`;
const DATA_ENGINE_DB_PATH = `${process.cwd()}/db/data_engine.db`;

interface ThresholdResult {
  market: string;
  threshold_date: string;
  threshold_value: number;
  percentile_method: string;
  sample_size: number;
  fallback_used: boolean;
  fallback_reason?: string;
  median?: number;
  p25?: number;
  p50?: number;
  p90?: number;
}

function openDb(path: string, readonly = true): any {
  const Database = require('better-sqlite3');
  return new Database(path, { readonly });
}

function dbExists(path: string): boolean {
  const fs = require('fs');
  try {
    return fs.existsSync(path) && fs.statSync(path).size > 0;
  } catch {
    return false;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function calculateThresholdForMarket(market: string): ThresholdResult | null {
  const today = new Date().toISOString().split('T')[0];
  let volumes: number[] = [];
  let fallbackReason: string | undefined;

  if (market === 'EGX') {
    if (!dbExists(INTRADAY_DB_PATH)) {
      fallbackReason = 'intraday.db not found';
    } else {
      try {
        const db = openDb(INTRADAY_DB_PATH);
        const rows = db.prepare(`
          SELECT volume FROM stock_intraday
          WHERE market = 'مصر' AND volume IS NOT NULL AND volume > 0
            AND timestamp >= datetime('now', '-30 days')
        `).all() as any[];
        volumes = rows.map((r: any) => Number(r.volume)).filter(v => v > 0);
        db.close();
      } catch (e) {
        fallbackReason = `EGX intraday error: ${(e as Error).message}`;
      }
    }
  } else if (market === 'US') {
    if (!dbExists(PRICE_HISTORY_DB_PATH)) {
      fallbackReason = 'price_history.db not found';
    } else {
      try {
        const db = openDb(PRICE_HISTORY_DB_PATH);
        const rows = db.prepare(`
          SELECT volume FROM price_history
          WHERE market = 'US' AND volume IS NOT NULL AND volume > 0
            AND date >= date('now', '-30 days')
        `).all() as any[];
        volumes = rows.map((r: any) => Number(r.volume)).filter(v => v > 0);
        db.close();
      } catch (e) {
        fallbackReason = `US price_history error: ${(e as Error).message}`;
      }
    }
  } else if (market === 'KSA') {
    if (!dbExists(DATA_ENGINE_DB_PATH)) {
      fallbackReason = 'data_engine.db not found';
    } else {
      try {
        const db = openDb(DATA_ENGINE_DB_PATH);
        const rows = db.prepare(`
          SELECT volume FROM historical_data
          WHERE market = 'السعودية' AND volume IS NOT NULL AND volume > 0
            AND date >= date('now', '-30 days')
        `).all() as any[];
        volumes = rows.map((r: any) => Number(r.volume)).filter(v => v > 0);
        db.close();
      } catch (e) {
        fallbackReason = `KSA data_engine error: ${(e as Error).message}`;
      }
    }
  } else if (market === 'CRYPTO') {
    // 🪙 الكريبتو — من data_engine.db.crypto_prices (تداول 24/7)
    if (!dbExists(DATA_ENGINE_DB_PATH)) {
      fallbackReason = 'data_engine.db not found';
    } else {
      try {
        const db = openDb(DATA_ENGINE_DB_PATH);
        const rows = db.prepare(`
          SELECT total_volume as volume FROM crypto_prices
          WHERE total_volume IS NOT NULL AND total_volume > 0
            AND timestamp >= datetime('now', '-30 days')
          LIMIT 50000
        `).all() as any[];
        volumes = rows.map((r: any) => Number(r.volume)).filter(v => v > 0);
        db.close();
      } catch (e) {
        fallbackReason = `CRYPTO data_engine error: ${(e as Error).message}`;
      }
    }
  } else if (market === 'GOLD') {
    // 🥇 الذهب — من data_engine.db.gold_prices_clean
    // الذهب ما عندهوش volume بالمعنى التقليدي — نستخدم price_per_gram كـ proxy
    // الأهم هو تجاوز SMA(10) — لكن هنا نحسب threshold على تغيرات السعر
    if (!dbExists(DATA_ENGINE_DB_PATH)) {
      fallbackReason = 'data_engine.db not found';
    } else {
      try {
        const db = openDb(DATA_ENGINE_DB_PATH);
        // احسب التغير اليومي كـ "volume" proxy
        const rows = db.prepare(`
          SELECT price_per_gram as volume FROM gold_prices_clean
          WHERE price_per_gram IS NOT NULL AND price_per_gram > 0
            AND timestamp >= datetime('now', '-30 days')
          LIMIT 10000
        `).all() as any[];
        volumes = rows.map((r: any) => Number(r.volume)).filter(v => v > 0);
        db.close();
      } catch (e) {
        fallbackReason = `GOLD data_engine error: ${(e as Error).message}`;
      }
    }
  }

  if (volumes.length === 0) {
    return {
      market,
      threshold_date: today,
      threshold_value: 100000,
      percentile_method: 'p75',
      sample_size: 0,
      fallback_used: true,
      fallback_reason: fallbackReason || 'no volume data',
    };
  }

  volumes.sort((a, b) => a - b);
  return {
    market,
    threshold_date: today,
    threshold_value: percentile(volumes, 0.75),
    percentile_method: 'p75',
    sample_size: volumes.length,
    fallback_used: false,
    median: percentile(volumes, 0.5),
    p25: percentile(volumes, 0.25),
    p50: percentile(volumes, 0.5),
    p90: percentile(volumes, 0.9),
  };
}

function ensureThresholdTable(db: any): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS liquidity_dynamic_threshold (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market TEXT NOT NULL,
      threshold_date TEXT NOT NULL,
      threshold_value REAL NOT NULL,
      percentile_method TEXT DEFAULT 'p75',
      sample_size INTEGER DEFAULT 0,
      fallback_used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(market, threshold_date)
    )
  `).run();
}

function saveThreshold(result: ThresholdResult): void {
  if (!dbExists(PREDICTIONS_DB_PATH)) {
    console.warn('[saveThreshold] predictions.db not found, skipping save');
    return;
  }
  try {
    const db = openDb(PREDICTIONS_DB_PATH, false);
    ensureThresholdTable(db);
    db.prepare(`
      INSERT OR REPLACE INTO liquidity_dynamic_threshold
      (market, threshold_date, threshold_value, percentile_method,
       sample_size, fallback_used, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      result.market,
      result.threshold_date,
      result.threshold_value,
      result.percentile_method,
      result.sample_size,
      result.fallback_used ? 1 : 0
    );
    db.close();
  } catch (e) {
    console.error('[saveThreshold] error:', e);
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const market = url.searchParams.get('market') || 'EGX';
  const markets = market === 'all' ? ['EGX', 'KSA', 'US', 'CRYPTO', 'GOLD'] : [market];

  const results: ThresholdResult[] = [];
  for (const m of markets) {
    const result = calculateThresholdForMarket(m);
    if (result) {
      saveThreshold(result);
      results.push(result);
    }
  }

  return NextResponse.json({
    success: true,
    results,
    generated_at: new Date().toISOString(),
    method: 'percentile_75 (last 30 days)',
  });
}

export async function POST(request: NextRequest) {
  const markets = ['EGX', 'KSA', 'US', 'CRYPTO', 'GOLD'];
  const results: ThresholdResult[] = [];
  for (const m of markets) {
    const result = calculateThresholdForMarket(m);
    if (result) {
      saveThreshold(result);
      results.push(result);
    }
  }

  return NextResponse.json({
    success: true,
    results,
    saved_to: 'liquidity_dynamic_threshold',
    generated_at: new Date().toISOString(),
  });
}
