/**
 * Auto-seed stocks from VPS when database is empty.
 * This ensures the application works immediately after deployment.
 */

import { ensureInitialized } from './sqlite-wrapper';

const VPS_URL = process.env.VPS_API_URL || process.env.PYTHON_API_URL || process.env.EGXPY_BRIDGE_URL || 'http://127.0.0.1:8010';
const SEED_LOCK_KEY = '__egx_seed_lock';
const SEED_CHECK_KEY = '__egx_seed_checked';

interface VpsStock {
  symbol: string;
  name?: string;
  price?: number;
  previous_close?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  [key: string]: unknown;
}

// Track if we've already checked/seeded in this process
let _seedCheckDone = false;
let _seedInProgress = false;
let _lastSeedTime = 0;

/**
 * Check if stocks table is empty and seed from VPS if needed.
 * This is called automatically from the stocks API.
 */
export async function ensureStocksSeeded(): Promise<{ seeded: boolean; count: number; error?: string }> {
  // Prevent concurrent seeding
  if (_seedInProgress) {
    // Wait for current seed to complete
    let attempts = 0;
    while (_seedInProgress && attempts < 30) {
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    }
    return { seeded: false, count: 0 };
  }

  // Only check once per 5 minutes (reset on server restart)
  if (_seedCheckDone && Date.now() - _lastSeedTime < 300000) {
    return { seeded: false, count: 0 };
  }

  _seedInProgress = true;

  try {
    await ensureInitialized();

    // Dynamic import to avoid circular dependency
    const sqlJs = await import('sql.js');
    const SQL = await sqlJs.default();
    const fs = await import('fs');
    const path = await import('path');

    const dbDir = path.join(process.cwd(), 'db');
    const dbPath = path.join(dbDir, 'stocks.db');

    // Ensure db directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Load or create database
    let db: ReturnType<typeof SQL.Database>;
    let isNewDb = false;

    if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
      console.log('[auto-seed] Loaded existing stocks.db');
    } else {
      db = new SQL.Database();
      isNewDb = true;
      console.log('[auto-seed] Creating new stocks.db');
    }

    // Ensure stocks table exists
    db.run(`
      CREATE TABLE IF NOT EXISTS stocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(255),
        name_ar VARCHAR(255),
        current_price FLOAT,
        previous_close FLOAT,
        open_price FLOAT,
        high_price FLOAT,
        low_price FLOAT,
        volume INTEGER,
        market_cap FLOAT,
        pe_ratio FLOAT,
        pb_ratio FLOAT,
        eps FLOAT,
        roe FLOAT,
        book_value_per_share FLOAT,
        sector VARCHAR(100),
        industry VARCHAR(100),
        investment_type TEXT DEFAULT 'stock',
        is_halal TINYINT DEFAULT NULL,
        egx30_member TINYINT DEFAULT 0,
        egx70_member TINYINT DEFAULT 0,
        egx100_member TINYINT DEFAULT 0,
        is_active TINYINT DEFAULT 1,
        is_egx TINYINT DEFAULT 1,
        last_update DATETIME,
        created_at DATETIME DEFAULT (datetime('now'))
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker)');

    // Check current stock count
    let count = 0;
    try {
      const result = db.exec('SELECT COUNT(*) as cnt FROM stocks WHERE is_active = 1');
      count = result[0]?.values[0]?.[0] as number || 0;
    } catch {
      count = 0;
    }

    console.log(`[auto-seed] Current stocks count: ${count}`);

    // If we have stocks, mark as done and return
    if (count > 50) {
      db.close();
      _seedCheckDone = true;
      _lastSeedTime = Date.now();
      return { seeded: false, count };
    }

    // Database is empty or nearly empty - sync from VPS
    console.log('[auto-seed] Syncing from VPS:', VPS_URL);

    try {
      const response = await fetch(`${VPS_URL}/api/stocks`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        throw new Error(`VPS returned ${response.status}`);
      }

      const data = await response.json() as { data?: VpsStock[]; stocks?: VpsStock[] } | VpsStock[];
      const stocks = Array.isArray(data) ? data : (data.data || data.stocks || []);

      if (!Array.isArray(stocks) || stocks.length === 0) {
        throw new Error('No stocks received from VPS');
      }

      console.log(`[auto-seed] Received ${stocks.length} stocks from VPS`);

      // Insert stocks
      let inserted = 0;

      for (const stock of stocks) {
        const ticker = (stock.symbol || '').toUpperCase();
        if (!ticker) continue;

        try {
          // Check if exists
          const existing = db.exec('SELECT id FROM stocks WHERE ticker = ?', [ticker]);

          if (existing.length > 0 && existing[0].values.length > 0) {
            // Update existing
            db.run(`
              UPDATE stocks SET
                current_price = ?, previous_close = ?, open_price = ?,
                high_price = ?, low_price = ?, volume = ?,
                is_active = 1, last_update = datetime('now')
              WHERE ticker = ?
            `, [
              stock.price || null,
              stock.previous_close || null,
              stock.open || null,
              stock.high || null,
              stock.low || null,
              stock.volume || null,
              ticker
            ]);
          } else {
            // Insert new
            db.run(`
              INSERT INTO stocks (
                ticker, name, current_price, previous_close, open_price,
                high_price, low_price, volume, is_active, is_egx
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
            `, [
              ticker,
              stock.name || ticker,
              stock.price || null,
              stock.previous_close || null,
              stock.open || null,
              stock.high || null,
              stock.low || null,
              stock.volume || null
            ]);
          }
          inserted++;
        } catch {
          // Skip errors
        }
      }

      // Save database
      const dbData = db.export();
      fs.writeFileSync(dbPath, Buffer.from(dbData));
      db.close();

      console.log(`[auto-seed] Successfully inserted ${inserted} stocks`);

      // Reset cache flags in egx-db
      try {
        const { resetLightDbState } = await import('./egx-db');
        resetLightDbState();
      } catch {
        // Ignore
      }

      _seedCheckDone = true;
      _lastSeedTime = Date.now();

      return { seeded: true, count: inserted };

    } catch (syncError) {
      console.error('[auto-seed] VPS sync failed:', syncError);

      // Save whatever we have
      try {
        const dbData = db.export();
        fs.writeFileSync(dbPath, Buffer.from(dbData));
        db.close();
      } catch {
        // Ignore
      }

      return {
        seeded: false,
        count: 0,
        error: syncError instanceof Error ? syncError.message : String(syncError)
      };
    }

  } catch (error) {
    console.error('[auto-seed] Error:', error);
    return {
      seeded: false,
      count: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    _seedInProgress = false;
  }
}

/**
 * Force re-seed from VPS (admin operation).
 */
export async function forceReseedFromVps(): Promise<{ success: boolean; count: number; error?: string }> {
  _seedCheckDone = false;
  _lastSeedTime = 0;

  const result = await ensureStocksSeeded();
  return {
    success: result.seeded,
    count: result.count,
    error: result.error
  };
}
/**
 * Auto-seed stocks from VPS when database is empty.
 * This ensures the application works immediately after deployment.
 */

