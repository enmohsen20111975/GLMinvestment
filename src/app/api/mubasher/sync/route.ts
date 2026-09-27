import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
import { randomUUID } from 'crypto';

// API Key validation (simple security)
const API_KEY = process.env.MUBASHER_API_KEY || '';

// Track if tables have been initialized
let tablesInitialized = false;
let initPromise: Promise<void> | null = null;

interface IntradayPrice5mInput {
  symbol: string;
  timestamp: string; // ISO format
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover?: number;
  num_trades?: number;
  vwap?: number;
}

interface DailyPriceInput {
  symbol: string;
  date: string; // YYYY-MM-DD format
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover?: number;
  num_trades?: number;
  vwap?: number;
}

interface StockMetadataInput {
  symbol: string;
  name?: string;
  name_ar?: string;
  sector?: string;
  industry?: string;
  is_egx30?: boolean;
  is_egx50?: boolean;
}

interface MubasherSyncRequest {
  sync_type: 'intraday' | 'history' | 'stocks' | 'full';
  stocks?: StockMetadataInput[];
  intraday?: IntradayPrice5mInput[];
  history?: DailyPriceInput[];
  batch_id?: string;
}

// Validate API key
function validateApiKey(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const apiKey = request.headers.get('x-api-key');

  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7) === API_KEY;
  }

  if (apiKey) {
    return apiKey === API_KEY;
  }

  // Also allow query param for simple testing
  const urlKey = request.nextUrl.searchParams.get('api_key');
  return urlKey === API_KEY;
}

// Check and create tables if they don't exist
async function ensureTablesExist(): Promise<void> {
  // If already initialized, return immediately
  if (tablesInitialized) return;

  // If initialization is in progress, wait for it
  if (initPromise) {
    await initPromise;
    return;
  }

  // Start initialization
  initPromise = (async () => {
    try {
      console.log('[Mubasher] Checking if tables exist...');

      // Check if MubasherStock table exists
      const tableCheck = await db.$queryRaw`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='MubasherStock'
      `;

      if (Array.isArray(tableCheck) && tableCheck.length === 0) {
        console.log('[Mubasher] Tables not found, creating them...');

        // Create MubasherStock table
        await db.$executeRaw`
          CREATE TABLE IF NOT EXISTS "MubasherStock" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "symbol" TEXT NOT NULL UNIQUE,
            "name" TEXT,
            "name_ar" TEXT,
            "sector" TEXT,
            "industry" TEXT,
            "is_active" BOOLEAN NOT NULL DEFAULT 1,
            "is_egx30" BOOLEAN NOT NULL DEFAULT 0,
            "is_egx50" BOOLEAN NOT NULL DEFAULT 0,
            "last_price" REAL,
            "last_update" DATETIME,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" DATETIME NOT NULL
          )
        `;

        // Create index on symbol
        await db.$executeRaw`
          CREATE INDEX IF NOT EXISTS "MubasherStock_symbol_idx" ON "MubasherStock"("symbol")
        `;
        await db.$executeRaw`
          CREATE INDEX IF NOT EXISTS "MubasherStock_sector_idx" ON "MubasherStock"("sector")
        `;
        await db.$executeRaw`
          CREATE INDEX IF NOT EXISTS "MubasherStock_is_egx30_idx" ON "MubasherStock"("is_egx30")
        `;

        // Create IntradayPrice5m table
        await db.$executeRaw`
          CREATE TABLE IF NOT EXISTS "IntradayPrice5m" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "symbol" TEXT NOT NULL,
            "timestamp" DATETIME NOT NULL,
            "open" REAL NOT NULL,
            "high" REAL NOT NULL,
            "low" REAL NOT NULL,
            "close" REAL NOT NULL,
            "volume" REAL NOT NULL,
            "turnover" REAL,
            "num_trades" INTEGER,
            "vwap" REAL,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "IntradayPrice5m_symbol_timestamp_key" UNIQUE ("symbol", "timestamp")
          )
        `;

        // Create indexes
        await db.$executeRaw`
          CREATE INDEX IF NOT EXISTS "IntradayPrice5m_symbol_timestamp_idx" ON "IntradayPrice5m"("symbol", "timestamp")
        `;
        await db.$executeRaw`
          CREATE INDEX IF NOT EXISTS "IntradayPrice5m_symbol_idx" ON "IntradayPrice5m"("symbol")
        `;
        await db.$executeRaw`
          CREATE INDEX IF NOT EXISTS "IntradayPrice5m_timestamp_idx" ON "IntradayPrice5m"("timestamp")
        `;

        // Create DailyPrice table
        await db.$executeRaw`
          CREATE TABLE IF NOT EXISTS "DailyPrice" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "symbol" TEXT NOT NULL,
            "date" DATETIME NOT NULL,
            "open" REAL NOT NULL,
            "high" REAL NOT NULL,
            "low" REAL NOT NULL,
            "close" REAL NOT NULL,
            "volume" REAL NOT NULL,
            "turnover" REAL,
            "num_trades" INTEGER,
            "vwap" REAL,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "DailyPrice_symbol_date_key" UNIQUE ("symbol", "date")
          )
        `;

        // Create indexes
        await db.$executeRaw`
          CREATE INDEX IF NOT EXISTS "DailyPrice_symbol_date_idx" ON "DailyPrice"("symbol", "date")
        `;
        await db.$executeRaw`
          CREATE INDEX IF NOT EXISTS "DailyPrice_symbol_idx" ON "DailyPrice"("symbol")
        `;
        await db.$executeRaw`
          CREATE INDEX IF NOT EXISTS "DailyPrice_date_idx" ON "DailyPrice"("date")
        `;

        // Create DataSyncLog table
        await db.$executeRaw`
          CREATE TABLE IF NOT EXISTS "DataSyncLog" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "sync_type" TEXT NOT NULL,
            "stocks_count" INTEGER NOT NULL,
            "records_count" INTEGER NOT NULL,
            "status" TEXT NOT NULL,
            "error_message" TEXT,
            "sync_duration_ms" INTEGER,
            "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "completed_at" DATETIME
          )
        `;

        // Create indexes
        await db.$executeRaw`
          CREATE INDEX IF NOT EXISTS "DataSyncLog_sync_type_idx" ON "DataSyncLog"("sync_type")
        `;
        await db.$executeRaw`
          CREATE INDEX IF NOT EXISTS "DataSyncLog_started_at_idx" ON "DataSyncLog"("started_at")
        `;

        // Create PriceAlert table
        await db.$executeRaw`
          CREATE TABLE IF NOT EXISTS "PriceAlert" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "symbol" TEXT NOT NULL,
            "alert_type" TEXT NOT NULL,
            "target_value" REAL NOT NULL,
            "current_value" REAL,
            "is_triggered" BOOLEAN NOT NULL DEFAULT 0,
            "triggered_at" DATETIME,
            "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `;

        // Create indexes
        await db.$executeRaw`
          CREATE INDEX IF NOT EXISTS "PriceAlert_symbol_idx" ON "PriceAlert"("symbol")
        `;
        await db.$executeRaw`
          CREATE INDEX IF NOT EXISTS "PriceAlert_is_triggered_idx" ON "PriceAlert"("is_triggered")
        `;

        console.log('[Mubasher] All tables created successfully!');
      } else {
        console.log('[Mubasher] Tables already exist.');
      }

      tablesInitialized = true;
    } catch (error) {
      console.error('[Mubasher] Error creating tables:', error);
      initPromise = null;
      throw error;
    }
  })();

  await initPromise;
}

// POST - Receive data from Mubasher sync application
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Validate API key
  if (!validateApiKey(request)) {
    return NextResponse.json(
      { error: 'Unauthorized - Invalid API key' },
      { status: 401 }
    );
  }

  let body: MubasherSyncRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { sync_type, stocks, intraday, history } = body;

  // Create sync log
  const syncLogId = randomUUID();

  try {
    // Ensure tables exist before processing
    await ensureTablesExist();

    const results = {
      stocks_updated: 0,
      intraday_updated: 0,
      history_updated: 0,
      errors: [] as string[],
    };

    // Process stock metadata
    if (stocks && stocks.length > 0) {
      for (const stock of stocks) {
        try {
          await db.mubasherStock.upsert({
            where: { symbol: stock.symbol },
            update: {
              name: stock.name,
              name_ar: stock.name_ar,
              sector: stock.sector,
              industry: stock.industry,
              is_egx30: stock.is_egx30 ?? false,
              is_egx50: stock.is_egx50 ?? false,
              last_update: new Date(),
              updated_at: new Date(),
            },
            create: {
              id: randomUUID(),
              symbol: stock.symbol,
              name: stock.name,
              name_ar: stock.name_ar,
              sector: stock.sector,
              industry: stock.industry,
              is_egx30: stock.is_egx30 ?? false,
              is_egx50: stock.is_egx50 ?? false,
              last_update: new Date(),
              updated_at: new Date(),
            },
          });
          results.stocks_updated++;
        } catch (error) {
          results.errors.push(`Stock ${stock.symbol}: ${error}`);
        }
      }
    }

    // Process intraday 5-minute data
    if (intraday && intraday.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < intraday.length; i += batchSize) {
        const batch = intraday.slice(i, i + batchSize);

        for (const item of batch) {
          try {
            const timestamp = new Date(item.timestamp);

            await db.intradayPrice5m.upsert({
              where: {
                symbol_timestamp: {
                  symbol: item.symbol,
                  timestamp: timestamp,
                },
              },
              update: {
                open: item.open,
                high: item.high,
                low: item.low,
                close: item.close,
                volume: item.volume,
                turnover: item.turnover,
                num_trades: item.num_trades,
                vwap: item.vwap,
              },
              create: {
                id: randomUUID(),
                symbol: item.symbol,
                timestamp: timestamp,
                open: item.open,
                high: item.high,
                low: item.low,
                close: item.close,
                volume: item.volume,
                turnover: item.turnover,
                num_trades: item.num_trades,
                vwap: item.vwap,
              },
            });
            results.intraday_updated++;
          } catch (error) {
            results.errors.push(`Intraday ${item.symbol}: ${error}`);
          }
        }
      }

      // Update stock last price from most recent intraday
      const latestPrices = new Map<string, { price: number; time: Date }>();
      for (const item of intraday) {
        const timestamp = new Date(item.timestamp);
        const existing = latestPrices.get(item.symbol);
        if (!existing || timestamp > existing.time) {
          latestPrices.set(item.symbol, { price: item.close, time: timestamp });
        }
      }

      for (const [symbol, data] of latestPrices) {
        await db.mubasherStock.update({
          where: { symbol },
          data: {
            last_price: data.price,
            last_update: data.time,
            updated_at: new Date(),
          },
        }).catch(() => {
          // Stock might not exist yet
        });
      }
    }

    // Process historical daily data
    if (history && history.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < history.length; i += batchSize) {
        const batch = history.slice(i, i + batchSize);

        for (const item of batch) {
          try {
            const date = new Date(item.date);

            await db.dailyPrice.upsert({
              where: {
                symbol_date: {
                  symbol: item.symbol,
                  date: date,
                },
              },
              update: {
                open: item.open,
                high: item.high,
                low: item.low,
                close: item.close,
                volume: item.volume,
                turnover: item.turnover,
                num_trades: item.num_trades,
                vwap: item.vwap,
              },
              create: {
                id: randomUUID(),
                symbol: item.symbol,
                date: date,
                open: item.open,
                high: item.high,
                low: item.low,
                close: item.close,
                volume: item.volume,
                turnover: item.turnover,
                num_trades: item.num_trades,
                vwap: item.vwap,
              },
            });
            results.history_updated++;
          } catch (error) {
            results.errors.push(`History ${item.symbol}: ${error}`);
          }
        }
      }
    }

    const duration = Date.now() - startTime;

    // Log sync result
    await db.dataSyncLog.create({
      data: {
        id: syncLogId,
        sync_type: sync_type,
        stocks_count: stocks?.length || 0,
        records_count: results.intraday_updated + results.history_updated,
        status: results.errors.length > 0 ? 'partial' : 'success',
        error_message: results.errors.length > 0 ? results.errors.slice(0, 10).join('; ') : null,
        sync_duration_ms: duration,
        completed_at: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      sync_id: syncLogId,
      duration_ms: duration,
      results: {
        stocks_updated: results.stocks_updated,
        intraday_updated: results.intraday_updated,
        history_updated: results.history_updated,
        errors_count: results.errors.length,
        errors: results.errors.slice(0, 5), // Return first 5 errors only
      },
    });

  } catch (error) {
    const duration = Date.now() - startTime;

    // Log error
    try {
      await db.dataSyncLog.create({
        data: {
          id: syncLogId,
          sync_type: sync_type,
          stocks_count: stocks?.length || 0,
          records_count: 0,
          status: 'failed',
          error_message: String(error),
          sync_duration_ms: duration,
          completed_at: new Date(),
        },
      });
    } catch {
      // Ignore logging errors
    }

    return NextResponse.json(
      {
        error: 'Sync failed',
        details: String(error),
        sync_id: syncLogId,
      },
      { status: 500 }
    );
  }
}

// GET - Get sync status and statistics
export async function GET(request: NextRequest) {
  // Validate API key
  if (!validateApiKey(request)) {
    return NextResponse.json(
      { error: 'Unauthorized - Invalid API key' },
      { status: 401 }
    );
  }

  try {
    // Ensure tables exist before querying
    await ensureTablesExist();

    // Get statistics
    const [
      stocksCount,
      intradayCount,
      historyCount,
      latestIntraday,
      latestHistory,
      recentSyncLogs,
    ] = await Promise.all([
      db.mubasherStock.count(),
      db.intradayPrice5m.count(),
      db.dailyPrice.count(),
      db.intradayPrice5m.findFirst({
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true, symbol: true, close: true },
      }),
      db.dailyPrice.findFirst({
        orderBy: { date: 'desc' },
        select: { date: true, symbol: true, close: true },
      }),
      db.dataSyncLog.findMany({
        take: 10,
        orderBy: { started_at: 'desc' },
      }),
    ]);

    return NextResponse.json({
      success: true,
      statistics: {
        stocks_count: stocksCount,
        intraday_5m_count: intradayCount,
        history_count: historyCount,
        latest_intraday: latestIntraday,
        latest_history: latestHistory,
      },
      recent_syncs: recentSyncLogs,
      api_info: {
        endpoint: '/api/mubasher/sync',
        methods: ['GET', 'POST'],
        required_headers: {
          authorization: 'Bearer <API_KEY>',
          'x-api-key': '<API_KEY>',
        },
        query_param: 'api_key=<API_KEY>',
      },
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get statistics', details: String(error) },
      { status: 500 }
    );
  }
}
