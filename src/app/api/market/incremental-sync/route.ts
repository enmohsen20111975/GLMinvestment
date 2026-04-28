/**
 * Incremental Data Sync from Mubasher.info
 * نظام القراءة المتقطعة للبيانات
 *
 * كل 5 دقائق يسحب بيانات مجموعة أسهم (batch)
 * يبدأ بالأسهم الأهم (المحفظة والمتابعة → EGX30 → الباقي)
 *
 * الاستراتيجية:
 * - 5 أسهم كل 5 دقائق = 60 سهم/ساعة
 * - تأخير 3-8 ثواني بين كل طلب
 * - ترتيب حسب الأهمية
 */

import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getLightDb, getWritableDb, isWritableDbAvailable } from '@/lib/egx-db';
import { fetchFromMubasher } from '@/lib/egx-data-sources';
import { getFinanceDb } from '@/lib/finance-db';

export const maxDuration = 60; // 1 minute max

// ==================== TYPES ====================

interface SyncState {
  last_sync: string | null;
  current_batch: number;
  total_batches: number;
  stocks_in_batch: number;
  progress_percent: number;
  is_running: boolean;
  priority_queue: string[];
  completed_today: string[];
  failed_today: string[];
  started_at: string | null;
  estimated_completion: string | null;
}

interface SyncResult {
  success: boolean;
  message: string;
  batch_number: number;
  stocks_processed: number;
  stocks_updated: number;
  stocks_failed: number;
  elapsed_ms: number;
  next_batch_in_seconds: number;
  progress_percent: number;
  priority_queue_remaining: number;
  state: SyncState;
}

// ==================== STATE MANAGEMENT ====================

// In-memory state (resets on server restart)
let syncState: SyncState = {
  last_sync: null,
  current_batch: 0,
  total_batches: 0,
  stocks_in_batch: 0,
  progress_percent: 0,
  is_running: false,
  priority_queue: [],
  completed_today: [],
  failed_today: [],
  started_at: null,
  estimated_completion: null,
};

const BATCH_SIZE = 5; // 5 stocks per batch
const BATCH_INTERVAL_SECONDS = 300; // 5 minutes between batches
const DELAY_BETWEEN_REQUESTS_MS = 4000; // 4 seconds delay

// ==================== PRIORITY QUEUE BUILDER ====================

async function buildPriorityQueue(): Promise<string[]> {
  const queue: Set<string> = new Set();

  try {
    // Priority 1: Stocks in user portfolios
    const financeDb = await getFinanceDb();
    if (financeDb) {
      try {
        const portfolioStocks = financeDb.prepare(`
          SELECT DISTINCT stock_ticker FROM user_assets
          WHERE type = 'stock' AND stock_ticker IS NOT NULL AND stock_ticker != ''
        `).all() as { stock_ticker: string }[];
        portfolioStocks.forEach(s => queue.add(s.stock_ticker.toUpperCase()));
      } catch {
        // Table might not exist
      }
    }
  } catch {
    // Finance DB not available
  }

  try {
    // Priority 2: Stocks in watchlist
    const financeDb = await getFinanceDb();
    if (financeDb) {
      try {
        const watchlistStocks = financeDb.prepare(`
          SELECT DISTINCT ticker FROM watchlist WHERE ticker IS NOT NULL AND ticker != ''
        `).all() as { ticker: string }[];
        watchlistStocks.forEach(s => queue.add(s.ticker.toUpperCase()));
      } catch {
        // Table might not exist
      }
    }
  } catch {
    // Ignore
  }

  try {
    // Priority 3: EGX30 stocks
    const lightDb = getLightDb();
    const egx30Stocks = lightDb.prepare(`
      SELECT ticker FROM stocks
      WHERE egx30_member = 1 AND is_active = 1
      ORDER BY volume DESC
    `).all() as { ticker: string }[];
    egx30Stocks.forEach(s => queue.add(s.ticker.toUpperCase()));
  } catch {
    // Ignore
  }

  try {
    // Priority 4: Most active stocks by volume
    const lightDb = getLightDb();
    const activeStocks = lightDb.prepare(`
      SELECT ticker FROM stocks
      WHERE is_active = 1 AND volume > 0
      ORDER BY volume DESC
      LIMIT 100
    `).all() as { ticker: string }[];
    activeStocks.forEach(s => queue.add(s.ticker.toUpperCase()));
  } catch {
    // Ignore
  }

  try {
    // Priority 5: Remaining active stocks
    const lightDb = getLightDb();
    const remainingStocks = lightDb.prepare(`
      SELECT ticker FROM stocks
      WHERE is_active = 1
      ORDER BY last_update ASC
    `).all() as { ticker: string }[];
    remainingStocks.forEach(s => queue.add(s.ticker.toUpperCase()));
  } catch {
    // Ignore
  }

  return Array.from(queue);
}

// ==================== SYNC EXECUTION ====================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processBatch(tickers: string[]): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;

  const lightDb = getLightDb();
  let heavyDb: ReturnType<typeof getWritableDb> | null = null;

  try {
    if (isWritableDbAvailable()) {
      heavyDb = getWritableDb();
    }
  } catch {
    // Heavy DB not available
  }

  for (const ticker of tickers) {
    try {
      // Fetch from Mubasher
      const result = await fetchFromMubasher(ticker);

      if (result.data && result.validation.valid) {
        const data = result.data;

        // Update light DB
        try {
          lightDb.prepare(`
            UPDATE stocks SET
              current_price = ?,
              previous_close = ?,
              open_price = ?,
              high_price = ?,
              low_price = ?,
              volume = ?,
              last_update = ?
            WHERE ticker = ? COLLATE NOCASE
          `).run(
            data.current_price,
            data.previous_close || data.current_price,
            data.open_price || data.current_price,
            data.high_price || data.current_price,
            data.low_price || data.current_price,
            data.volume || 0,
            new Date().toISOString(),
            ticker
          );
        } catch (e) {
          console.warn(`[IncrementalSync] Light DB update failed for ${ticker}:`, e);
        }

        // Update heavy DB if available
        if (heavyDb) {
          try {
            heavyDb.prepare(`
              UPDATE stocks SET
                current_price = ?,
                previous_close = ?,
                open_price = ?,
                high_price = ?,
                low_price = ?,
                volume = ?,
                last_update = ?
              WHERE ticker = ? COLLATE NOCASE
            `).run(
              data.current_price,
              data.previous_close || data.current_price,
              data.open_price || data.current_price,
              data.high_price || data.current_price,
              data.low_price || data.current_price,
              data.volume || 0,
              new Date().toISOString(),
              ticker
            );
          } catch {
            // Ignore heavy DB errors
          }
        }

        updated++;
        syncState.completed_today.push(ticker);
      } else {
        failed++;
        syncState.failed_today.push(ticker);
      }

      // Delay between requests
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    } catch (err) {
      console.error(`[IncrementalSync] Error processing ${ticker}:`, err);
      failed++;
      syncState.failed_today.push(ticker);
    }
  }

  return { updated, failed };
}

// ==================== GET HANDLER ====================

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action') || 'status';

  await ensureInitialized();

  if (action === 'status') {
    // Calculate progress
    const totalStocks = syncState.priority_queue.length;
    const completed = syncState.completed_today.length;
    const progressPercent = totalStocks > 0 ? Math.round((completed / totalStocks) * 100) : 0;

    return NextResponse.json({
      success: true,
      state: {
        ...syncState,
        progress_percent: progressPercent,
        stocks_in_batch: BATCH_SIZE,
        total_batches: Math.ceil(totalStocks / BATCH_SIZE),
      },
      configuration: {
        batch_size: BATCH_SIZE,
        batch_interval_seconds: BATCH_INTERVAL_SECONDS,
        delay_between_requests_ms: DELAY_BETWEEN_REQUESTS_MS,
      },
      summary: {
        total_stocks: totalStocks,
        completed_today: syncState.completed_today.length,
        failed_today: syncState.failed_today.length,
        remaining: totalStocks - completed,
      },
    });
  }

  if (action === 'reset') {
    // Reset state for new day
    syncState = {
      last_sync: null,
      current_batch: 0,
      total_batches: 0,
      stocks_in_batch: 0,
      progress_percent: 0,
      is_running: false,
      priority_queue: [],
      completed_today: [],
      failed_today: [],
      started_at: null,
      estimated_completion: null,
    };

    return NextResponse.json({
      success: true,
      message: 'State reset successfully',
    });
  }

  return NextResponse.json({
    success: false,
    error: 'Unknown action',
    available_actions: ['status', 'reset'],
  }, { status: 400 });
}

// ==================== POST HANDLER ====================

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  await ensureInitialized();

  // Check if already running
  if (syncState.is_running) {
    return NextResponse.json({
      success: false,
      message: 'Sync already in progress',
      state: syncState,
    }, { status: 429 });
  }

  // Build priority queue if empty
  if (syncState.priority_queue.length === 0) {
    syncState.priority_queue = await buildPriorityQueue();
    syncState.started_at = new Date().toISOString();

    const totalBatches = Math.ceil(syncState.priority_queue.length / BATCH_SIZE);
    const estimatedMinutes = totalBatches * (BATCH_INTERVAL_SECONDS / 60);
    syncState.estimated_completion = new Date(Date.now() + estimatedMinutes * 60 * 1000).toISOString();
  }

  // Get next batch
  const remaining = syncState.priority_queue.filter(
    t => !syncState.completed_today.includes(t) && !syncState.failed_today.includes(t)
  );

  if (remaining.length === 0) {
    // All stocks processed
    return NextResponse.json({
      success: true,
      message: 'All stocks have been processed. Reset to start fresh.',
      state: syncState,
    });
  }

  // Mark as running
  syncState.is_running = true;
  syncState.current_batch++;

  const batch = remaining.slice(0, BATCH_SIZE);

  try {
    const result = await processBatch(batch);

    const elapsedMs = Date.now() - startTime;
    const completed = syncState.completed_today.length;
    const total = syncState.priority_queue.length;
    const progressPercent = Math.round((completed / total) * 100);

    syncState.progress_percent = progressPercent;
    syncState.last_sync = new Date().toISOString();
    syncState.is_running = false;

    const response: SyncResult = {
      success: true,
      message: `Batch ${syncState.current_batch} completed: ${result.updated} updated, ${result.failed} failed`,
      batch_number: syncState.current_batch,
      stocks_processed: batch.length,
      stocks_updated: result.updated,
      stocks_failed: result.failed,
      elapsed_ms: elapsedMs,
      next_batch_in_seconds: BATCH_INTERVAL_SECONDS,
      progress_percent: progressPercent,
      priority_queue_remaining: remaining.length - batch.length,
      state: syncState,
    };

    return NextResponse.json(response);
  } catch (err) {
    syncState.is_running = false;
    return NextResponse.json({
      success: false,
      message: `Batch failed: ${String(err)}`,
      state: syncState,
    }, { status: 500 });
  }
}
