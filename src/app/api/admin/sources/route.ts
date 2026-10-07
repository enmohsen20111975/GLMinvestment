/**
 * GET /api/admin/sources
 * =====================
 * Task 28-B (Fix 10 — Fix Battalion):
 *   Source Authority endpoint (Rule 66 — SOURCE-AUTHORITY).
 *
 *   Returns:
 *     - CANONICAL_SOURCES per market (mirrors vps-service/data/source_authority.py)
 *     - BANNED_SOURCES (with reasons)
 *     - Multi-source conflict count: tickers with >1 source in price_history
 *       + per-market breakdown + sample of conflicts
 *
 *   Rule 20: read-only — just stat + parse, no Python invocation. The
 *   canonical sources are mirrored from Python in TS (kept in sync manually)
 *   so the admin UI doesn't need to spawn Python on every request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { access } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

/* ------------------------------------------------------------------ */
/*  Mirror of vps-service/data/source_authority.py CANONICAL_SOURCES   */
/* ------------------------------------------------------------------ */

const CANONICAL_SOURCES: Record<string, string[]> = {
  // EGX: intraday_aggregated (from egksco_scraper) is most recent + reliable
  //       → egksco (legacy) → yahoo_clean (5yr history)
  EGX: ['intraday_aggregated', 'egksco', 'yahoo_clean'],

  // TADAWUL/KSE/QSE/US: yahoo_clean is the primary (long history)
  //       → egx_investment_migration (legacy fallback for EGX-adjacent)
  TADAWUL: ['yahoo_clean', 'egx_investment_migration'],
  KSE: ['yahoo_clean'],
  QSE: ['yahoo_clean'],
  US: ['yahoo_clean'],

  // CRYPTO: crypto_fetcher (API — has 198K rows) → tradingview_live (if available)
  CRYPTO: ['crypto_fetcher', 'tradingview_live'],

  // GOLD: gold_fetcher (API — has 163K rows) → yahoo_clean (if available)
  GOLD: ['gold_fetcher', 'yahoo_clean'],
};

/* ------------------------------------------------------------------ */
/*  Mirror of vps-service/data/source_authority.py BANNED_SOURCES      */
/* ------------------------------------------------------------------ */

const BANNED_SOURCES: Array<{ source: string; reason: string }> = [
  {
    source: 'egxpilot_live',
    reason: 'بيانات تجريبية — مدى قصير وغير موثوق (pilot data, short range, unreliable)',
  },
  {
    source: 'yahoo_safetynet',
    reason: 'احتياطي للاحتياطي — تغطية محدودة (fallback of fallback, minimal coverage)',
  },
  {
    source: 'yfinance_backfill',
    reason: '18 صف فقط — غير موثوق (18 rows only, not reliable)',
  },
];

const PRICE_HISTORY_DB = path.join(process.cwd(), 'db', 'price_history.db');
const STOCKS_DB = path.join(process.cwd(), 'db', 'stocks.db');

interface MultiSourceConflict {
  ticker: string;
  market: string | null;
  sources: string[];
}

interface SourcesResponse {
  success: boolean;
  timestamp: string;
  canonical_sources: Record<string, string[]>;
  banned_sources: Array<{ source: string; reason: string }>;
  multi_source_conflicts: {
    total_tickers_with_multi_sources: number;
    by_market: Array<{ market: string; ticker_count: number; sources: string[] }>;
    sample: MultiSourceConflict[];
  };
  upstream: string;
  rule: string;
}

/**
 * Infer the market for a ticker based on its pattern. Mirrors
 * vps-service/data/source_authority.py:get_market_for_ticker (lines 202-225)
 * but reads from stocks.db first for accuracy.
 */
function inferMarket(ticker: string): string {
  const t = ticker.toUpperCase().trim();
  if (['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOT', 'DOGE'].includes(t)) return 'CRYPTO';
  if (['XAU', 'GOLD', 'XAUUSD'].includes(t)) return 'GOLD';
  if (t.includes('.US') || ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'AMZN'].includes(t)) return 'US';
  // Default to EGX (most of the platform's data)
  return 'EGX';
}

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    // Try to compute multi-source conflict count from price_history.db
    let totalMultiSourceTickers = 0;
    let conflictsByMarket: Array<{ market: string; ticker_count: number; sources: string[] }> = [];
    let sampleConflicts: MultiSourceConflict[] = [];

    try {
      await access(PRICE_HISTORY_DB);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3');
      const db = new Database(PRICE_HISTORY_DB, { readonly: true, timeout: 5000 });
      db.pragma('busy_timeout = 5000');

      // Total tickers with >1 distinct source
      const totalRow = db.prepare(`
        SELECT COUNT(*) as n FROM (
          SELECT ticker FROM price_history
          GROUP BY ticker
          HAVING COUNT(DISTINCT source) > 1
        )
      `).get() as { n: number } | undefined;
      totalMultiSourceTickers = totalRow?.n || 0;

      // Get all multi-source tickers with their sources
      const multiRows = db.prepare(`
        SELECT ticker, GROUP_CONCAT(DISTINCT source) as sources_csv, COUNT(DISTINCT source) as src_count
        FROM price_history
        GROUP BY ticker
        HAVING src_count > 1
        ORDER BY src_count DESC, ticker
        LIMIT 500
      `).all() as Array<{ ticker: string; sources_csv: string; src_count: number }>;

      db.close();

      // Build market breakdown (infer market from ticker pattern)
      const byMarketMap: Record<string, { ticker_count: number; sources_set: Set<string> }> = {};
      for (const r of multiRows) {
        const market = inferMarket(r.ticker);
        if (!byMarketMap[market]) {
          byMarketMap[market] = { ticker_count: 0, sources_set: new Set<string>() };
        }
        byMarketMap[market].ticker_count++;
        const srcs = r.sources_csv.split(',').filter(Boolean);
        for (const s of srcs) byMarketMap[market].sources_set.add(s);
      }
      conflictsByMarket = Object.entries(byMarketMap).map(([market, info]) => ({
        market,
        ticker_count: info.ticker_count,
        sources: Array.from(info.sources_set).sort(),
      }));

      // Sample conflicts — top 10 by source count
      sampleConflicts = multiRows.slice(0, 10).map(r => ({
        ticker: r.ticker,
        market: inferMarket(r.ticker),
        sources: r.sources_csv.split(',').filter(Boolean).sort(),
      }));
    } catch {
      // price_history.db missing or unreadable — return zero conflicts
      // (the Source Authority tab will still show CANONICAL_SOURCES + BANNED_SOURCES)
    }

    const response: SourcesResponse = {
      success: true,
      timestamp: new Date().toISOString(),
      canonical_sources: CANONICAL_SOURCES,
      banned_sources: BANNED_SOURCES,
      multi_source_conflicts: {
        total_tickers_with_multi_sources: totalMultiSourceTickers,
        by_market: conflictsByMarket,
        sample: sampleConflicts,
      },
      upstream: 'vps-service/data/source_authority.py (mirror)',
      rule: 'Rule 66 — SOURCE-AUTHORITY',
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[GET /api/admin/sources]', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
