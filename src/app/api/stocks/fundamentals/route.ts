/**
 * API endpoint to fetch and store fundamental data for stocks
 *
 * GET /api/stocks/fundamentals?tickers=COMI,ETAL
 * POST /api/stocks/fundamentals with { tickers: ['COMI', 'ETAL'] }
 *
 * Fetches fundamental data from VPS and stores it in the database
 * This ensures Fair Value calculations have the data they need
 */

import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized } from '@/lib/egx-db';
import { fetchBatchFundamentals, type FundamentalData } from '@/lib/external-data-fetcher';
import { createDatabase } from '@/lib/sqlite-wrapper';
import { existsSync } from 'fs';
import * as path from 'path';

export const maxDuration = 120; // 2 minutes

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tickersParam = searchParams.get('tickers') || searchParams.get('ticker');

  if (!tickersParam) {
    return NextResponse.json({
      success: false,
      error: 'Please provide ticker or tickers parameter (e.g., ?ticker=COMI or ?tickers=COMI,ETAL)',
      hint: 'Use "ticker" for single stock or "tickers" for multiple stocks'
    }, { status: 400 });
  }

  const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  if (tickers.length === 0) {
    return NextResponse.json({
      success: false,
      error: 'No valid tickers provided'
    }, { status: 400 });
  }

  return handleFundamentalsFetch(tickers);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { tickers?: string[] };

    if (!body.tickers || !Array.isArray(body.tickers) || body.tickers.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Please provide tickers array in request body'
      }, { status: 400 });
    }

    const tickers = body.tickers.map(t => t.trim().toUpperCase()).filter(Boolean);
    return handleFundamentalsFetch(tickers);
  } catch {
    return NextResponse.json({
      success: false,
      error: 'Invalid request body'
    }, { status: 400 });
  }
}

async function handleFundamentalsFetch(tickers: string[]): Promise<NextResponse> {
  try {
    await ensureInitialized();

    console.log(`[Fundamentals] Fetching for ${tickers.length} tickers: ${tickers.slice(0, 5).join(', ')}...`);

    // Fetch fundamentals from VPS
    const result = await fetchBatchFundamentals(tickers, {
      concurrency: 5,
      delayMs: 100,
      onProgress: (done, total) => {
        console.log(`[Fundamentals] Progress: ${done}/${total}`);
      }
    });

    if (result.data.length > 0) {
      // Store in database
      await storeFundamentalsInDb(result.data);
    }

    return NextResponse.json({
      success: true,
      total: result.total,
      fetched: result.success,
      failed: result.failed,
      errors: result.errors.slice(0, 10), // Limit errors in response
      data: result.data
    });
  } catch (error) {
    console.error('[Fundamentals] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}

async function storeFundamentalsInDb(fundamentals: FundamentalData[]): Promise<void> {
  const lightDbPath = path.join(process.cwd(), 'db', 'stocks.db');
  const heavyDbPath = path.join(process.cwd(), 'db', 'stocks.db');

  // Update Light DB
  if (existsSync(lightDbPath)) {
    try {
      const lightDb = createDatabase(lightDbPath);
      lightDb.pragma('journal_mode = WAL');

      for (const fund of fundamentals) {
        try {
          lightDb.run(`
            UPDATE stocks SET
              market_cap = ?,
              pe_ratio = ?,
              pb_ratio = ?,
              ps_ratio = ?,
              dividend_yield = ?,
              roe = ?,
              roa = ?,
              debt_to_equity = ?,
              eps = ?,
              book_value_per_share = ?,
              shares_outstanding = ?,
              sector = ?,
              industry = ?,
              last_update = datetime('now')
            WHERE ticker = ? COLLATE NOCASE
          `, [
            fund.market_cap ?? null,
            fund.pe_ratio ?? null,
            fund.pb_ratio ?? null,
            fund.ps_ratio ?? null,
            fund.dividend_yield ?? null,
            fund.roe ?? null,
            fund.roa ?? null,
            fund.debt_to_equity ?? null,
            fund.eps ?? null,
            fund.book_value_per_share ?? null,
            fund.shares_outstanding ?? null,
            fund.sector ?? null,
            fund.industry ?? null,
            fund.ticker
          ]);
        } catch (err) {
          console.warn(`[Fundamentals] Could not update ${fund.ticker} in Light DB:`, err);
        }
      }

      lightDb.close();
      console.log(`[Fundamentals] Updated ${fundamentals.length} stocks in Light DB`);
    } catch (err) {
      console.warn('[Fundamentals] Could not update Light DB:', err);
    }
  }

  // Update Heavy DB
  if (existsSync(heavyDbPath)) {
    try {
      const heavyDb = createDatabase(heavyDbPath);
      heavyDb.pragma('journal_mode = WAL');

      for (const fund of fundamentals) {
        try {
          heavyDb.run(`
            UPDATE stocks SET
              market_cap = ?,
              pe_ratio = ?,
              pb_ratio = ?,
              eps = ?,
              roe = ?,
              sector = ?,
              industry = ?,
              book_value_per_share = ?,
              last_update = datetime('now')
            WHERE ticker = ? COLLATE NOCASE
          `, [
            fund.market_cap ?? null,
            fund.pe_ratio ?? null,
            fund.pb_ratio ?? null,
            fund.eps ?? null,
            fund.roe ?? null,
            fund.sector ?? null,
            fund.industry ?? null,
            fund.book_value_per_share ?? null,
            fund.ticker
          ]);
        } catch (err) {
          console.warn(`[Fundamentals] Could not update ${fund.ticker} in Heavy DB:`, err);
        }
      }

      heavyDb.close();
      console.log(`[Fundamentals] Updated ${fundamentals.length} stocks in Heavy DB`);
    } catch (err) {
      console.warn('[Fundamentals] Could not update Heavy DB:', err);
    }
  }
}
/**
 * API endpoint to fetch and store fundamental data for stocks
 *
 * GET /api/stocks/fundamentals?tickers=COMI,ETAL
 * POST /api/stocks/fundamentals with { tickers: ['COMI', 'ETAL'] }
 *
 * Fetches fundamental data from VPS and stores it in the database
 * This ensures Fair Value calculations have the data they need
 */

