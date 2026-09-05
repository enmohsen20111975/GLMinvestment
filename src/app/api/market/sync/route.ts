import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { ensureInitialized, getSharedCustomDb, resetLightDbState, resetHeavyDbState } from '@/lib/egx-db';
import {
  fetchGoldPrices,
  fetchCurrencyRates,
  getSourceHealth,
  clearCache,
} from '@/lib/multi-source-adapter';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const maxDuration = 60;

const PYTHON_BACKEND_URL = process.env.VPS_API_URL || 'http://127.0.0.1:8010';
const PROJECT_ROOT = process.cwd();

interface SyncResult {
  success: boolean;
  count: number;
  error?: string;
  source?: string;
}

/**
 * Call Python backend to update stock prices from EGXPilot
 */
async function updateStockPricesFromPython(): Promise<SyncResult> {
  try {
    // Try to call Python backend API first
    const pythonHealthUrl = `${PYTHON_BACKEND_URL}/health`;
    const healthResponse = await fetch(pythonHealthUrl, {
      signal: AbortSignal.timeout(5000),
    });

    if (!healthResponse.ok) {
      throw new Error('Python backend not responding');
    }

    // Call the internal Python function via API
    // We'll use a special endpoint that triggers the update
    const updateUrl = `${PYTHON_BACKEND_URL}/api/admin/sync-stocks`;
    const updateResponse = await fetch(updateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'egxpilot' }),
      signal: AbortSignal.timeout(30000),
    });

    if (updateResponse.ok) {
      const data = await updateResponse.json();
      return {
        success: true,
        count: data.updated || 0,
        source: 'EGXPilot (via Python)',
      };
    }

    throw new Error('Python backend update failed');
  } catch (apiError) {
    console.log('[Sync] Python API not available, using direct Python call...');

    // Fallback: Execute Python script directly
    try {
      const { stdout, stderr } = await execAsync(
        `cd ${PROJECT_ROOT}/vps-service && python3 -c "
from data.egx_fetcher import update_egx_prices
result = update_egx_prices('${PROJECT_ROOT}/db/stocks.db')
print('RESULT:', result)
"`,
        { timeout: 45000 }
      );

      console.log('[Sync] Python stdout:', stdout);
      if (stderr) console.error('[Sync] Python stderr:', stderr);

      // Parse result from output
      const match = stdout.match(/تم تحديث (\d+) سهم/);
      const count = match ? parseInt(match[1], 10) : 0;

      if (stdout.includes('True') || count > 0) {
        return {
          success: true,
          count,
          source: 'EGXPilot (direct)',
        };
      }

      throw new Error('Update returned no results');
    } catch (execError) {
      console.error('[Sync] Direct Python call failed:', execError);
      return {
        success: false,
        count: 0,
        error: String(execError),
      };
    }
  }
}

/**
 * Sync light database from heavy database
 */
async function syncLightDatabase(): Promise<SyncResult> {
  try {
    const { stdout, stderr } = await execAsync(
      `cd ${PROJECT_ROOT} && bun scripts/sync-light-db-bun.ts`,
      { timeout: 30000 }
    );

    console.log('[Sync] Light DB stdout:', stdout);
    if (stderr) console.error('[Sync] Light DB stderr:', stderr);

    // Parse count from output
    const match = stdout.match(/stocks: (\d+) rows/);
    const count = match ? parseInt(match[1], 10) : 0;

    if (stdout.includes('✅')) {
      // Reset DB states to force re-read
      resetLightDbState();
      resetHeavyDbState();

      return {
        success: true,
        count,
        source: 'sync-light-db-bun.ts',
      };
    }

    throw new Error('Light DB sync failed');
  } catch (error) {
    console.error('[Sync] Light DB sync error:', error);
    return {
      success: false,
      count: 0,
      error: String(error),
    };
  }
}

/**
 * POST /api/market/sync
 * Sync stock prices, gold prices, and currency rates from external APIs to the database.
 *
 * Body:
 *   - type: 'stocks' | 'gold' | 'currency' | 'all' | 'sync_light' (default: 'all')
 *   - clear_cache: boolean (default: false)
 *   - sync_light: boolean (default: true when type is 'stocks' or 'all')
 */
export async function POST(request: NextRequest) {
  try {
    await ensureInitialized();
    const body = await request.json().catch(() => ({}));
    const type = body.type || 'all';
    const clearCacheFlag = body.clear_cache === true;
    const syncLight = body.sync_light !== false; // Default to true

    if (clearCacheFlag) {
      clearCache();
    }

    const results: {
      stocks?: SyncResult;
      gold?: SyncResult;
      currency?: SyncResult;
      sync_light?: SyncResult;
    } = {};

    // Sync stock prices from Python backend
    if (type === 'all' || type === 'stocks') {
      console.log('[Sync] Updating stock prices from EGXPilot...');
      results.stocks = await updateStockPricesFromPython();

      // Auto-sync light DB after stock update
      if (results.stocks.success && syncLight) {
        console.log('[Sync] Syncing light database...');
        results.sync_light = await syncLightDatabase();
      }
    }

    // Sync gold prices
    // v3.65.1: gold_prices writer DISABLED — data_engine.db.gold_prices is now the
    // single canonical source, written live by data_engine/scrapers/metals_forex_fetcher.py
    // every 5 minutes. The old writer here was INSERTing into stocks.db.gold_prices
    // (via the deprecated getSharedCustomDb() stub which now returns stocks.db) using
    // a schema with columns (name_ar, change, updated_at, updated_by) that DON'T MATCH
    // the actual stocks.db.gold_prices schema — so the INSERT was silently failing anyway.
    // See Documentation/DB_CLEANUP_PLAN_v3.65.1.md P0-2.
    if (type === 'all' || type === 'gold') {
      console.log('[Sync] Gold sync: SKIPPED — data_engine.db.gold_prices is canonical (written by metals_forex_fetcher.py)');
      results.gold = {
        success: true,
        count: 0,
        source: 'data_engine.db (metals_forex_fetcher.py)',
        note: 'Writer disabled in v3.65.1 — gold_prices is now read-only via getLiveEgyptGoldPrices()'
      };
    }

    // Sync currency rates
    if (type === 'all' || type === 'currency') {
      try {
        const currencyRates = await fetchCurrencyRates();

        if (currencyRates.length > 0) {
          const db = await getSharedCustomDb();

          // Update currency_rates table
          for (const rate of currencyRates) {
            const code = rate.code || `${rate.from}/${rate.to}`;
            db.run(`
              INSERT INTO currency_rates (code, name_ar, buy_rate, sell_rate, change, is_major, updated_at, updated_by)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
              ON CONFLICT(code) DO UPDATE SET
                name_ar = excluded.name_ar,
                buy_rate = excluded.buy_rate,
                sell_rate = excluded.sell_rate,
                change = excluded.change,
                is_major = excluded.is_major,
                updated_at = datetime('now'),
                updated_by = excluded.updated_by
            `, [code, rate.name_ar, rate.buy_rate || rate.rate, rate.sell_rate || rate.rate, rate.change, rate.is_major ? 1 : 0, rate.source || 'api']);
          }

          results.currency = { success: true, count: currencyRates.length, source: currencyRates[0]?.source || 'api' };
          console.log(`[Sync] Updated ${currencyRates.length} currency rates`);
        } else {
          results.currency = { success: false, count: 0, error: 'No currency rates returned from API' };
        }
      } catch (currencyError) {
        console.error('[Sync] Currency sync error:', currencyError);
        results.currency = { success: false, count: 0, error: String(currencyError) };
      }
    }

    // Just sync light DB (without updating prices)
    if (type === 'sync_light') {
      console.log('[Sync] Syncing light database only...');
      results.sync_light = await syncLightDatabase();
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
      source_health: getSourceHealth(),
    });
  } catch (error) {
    console.error('[Sync] Error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/market/sync
 * Get sync status and source health.
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    source_health: getSourceHealth(),
    message: 'Use POST to sync data with body: { "type": "stocks"|"gold"|"currency"|"all"|"sync_light", "clear_cache": false, "sync_light": true }',
  });
}
