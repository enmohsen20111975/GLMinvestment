import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import {
  isEgxpyAvailable,
  fetchBatchQuotes,
  fetchAllActiveTickers,
  egxpyQuoteToLiveStock,
} from '@/lib/egxpy-bridge';
import {
  isVpsAvailable,
  fetchMarketOverview,
  vpsQuotesToLiveStocks,
} from '@/lib/vps-adapter';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LiveStock {
  ticker: string;
  name_ar: string;
  current_price: number;
  change: number;
  change_percent: number;
  volume: number;
  last_updated: string;
  source?: string;
}

interface LiveDataResponse {
  success: boolean;
  source: string;
  fetched_at: string;
  data_count: number;
  stocks: LiveStock[];
  message?: string;
}

interface CacheEntry {
  data: LiveDataResponse;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Cache — 3-minute TTL (shorter since we're reading from TradingView directly)
// ---------------------------------------------------------------------------

const liveDataCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 3 * 60 * 1000;

// ---------------------------------------------------------------------------
// Strategy 1: egxpy/TradingView (PRIMARY) — no Mubasher dependency
// ---------------------------------------------------------------------------

async function fetchFromEgxpy(): Promise<{
  stocks: LiveStock[];
  source: string;
  message?: string;
} | null> {
  try {
    const available = await isEgxpyAvailable();
    if (!available) return null;

    const tickers = await fetchAllActiveTickers();
    if (tickers.length === 0) return null;

    // For the live-data GET endpoint, fetch a quick sample of the most important tickers
    // (Full sync is done via POST /api/market/sync-live)
    const priorityTickers = [
      'COMI', 'ETEL', 'FWRY', 'HRHO', 'TMGH', 'ABUK', 'SWDY', 'ORAS', 'EAST', 'JUFO',
      'ALDU', 'TALA', 'CIEB', 'PHAR', 'OBOR', 'JOIN', 'ACGC', 'MFPC', 'ALUM', 'BIMP',
    ].filter(t => tickers.includes(t));

    // Add up to 30 more random tickers for diversity
    const extraTickers = tickers
      .filter(t => !priorityTickers.includes(t))
      .sort(() => Math.random() - 0.5)
      .slice(0, 30);

    const allTickers = [...priorityTickers, ...extraTickers];

    const quotes = await fetchBatchQuotes(allTickers);
    if (quotes.length === 0) return null;

    const stocks = quotes.map(egxpyQuoteToLiveStock);
    return {
      stocks,
      source: 'egxpy',
      message: `Live data from TradingView via egxpy (${stocks.length} stocks)`,
    };
  } catch (err) {
    console.error('[Live Data] egxpy error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 2: VPS Adapter
// ---------------------------------------------------------------------------

async function fetchFromVps(): Promise<{
  stocks: LiveStock[];
  source: string;
  message?: string;
} | null> {
  try {
    const available = await isVpsAvailable();
    if (!available) return null;

    const overview = await fetchMarketOverview();
    if (overview?.data?.stocks && overview.data.stocks.length > 0) {
      const stocks = vpsQuotesToLiveStocks(overview.data.stocks);
      return { stocks: stocks.slice(0, 300), source: 'vps', message: 'Data from VPS' };
    }
    return null;
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 3: Database fallback
// ---------------------------------------------------------------------------

function fetchFromDatabase(limit: number, offset: number): {
  stocks: LiveStock[];
  source: string;
  message?: string;
  total: number;
} {
  try {
    // Use light DB singleton (stocks.db, ~200KB) — cached in memory, no disk I/O
    const db = getLightDb();
    // FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #8: paginated DB fallback (Rule 56 — parameterized)
    const totalRow = db
      .prepare('SELECT COUNT(*) AS c FROM stocks WHERE is_active = 1 AND current_price > 0')
      .get() as { c: number } | undefined;
    const total = totalRow?.c ?? 0;
    const rows = db
      .prepare('SELECT ticker, name_ar, current_price, previous_close, volume, last_update FROM stocks WHERE is_active = 1 AND current_price > 0 LIMIT ? OFFSET ?')
      .all(limit, offset) as Array<{ ticker: string; name_ar: string; current_price: number; previous_close: number; volume: number; last_update: string | null }>;

    const now = new Date().toISOString();
    const stocks: LiveStock[] = rows.map((r) => ({
      ticker: r.ticker.toUpperCase(),
      name_ar: r.name_ar || r.ticker,
      current_price: r.current_price,
      change: r.previous_close ? Math.round((r.current_price - r.previous_close) * 1000) / 1000 : 0,
      change_percent: r.previous_close ? Math.round(((r.current_price - r.previous_close) / r.previous_close) * 10000) / 100 : 0,
      volume: r.volume || 0,
      last_updated: r.last_update || now,
    }));

    return {
      stocks,
      source: 'database',
      message: `Cached data from local database (${stocks.length} of ${total} stocks)`,
      total,
    };
  } catch (err) {
    console.error('[Live Data] Database fallback error:', err);
    return { stocks: [], source: 'database', message: 'Database error', total: 0 };
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const noCache = searchParams.get('no_cache') === 'true';
    // FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #8: pagination params (applied to DB fallback)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10), 1), 1000);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);
    const cacheKey = 'egx-live-data';

    // Check cache (only when default pagination is used — otherwise bypass)
    if (!noCache && offset === 0 && limit === 100) {
      const cached = liveDataCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return NextResponse.json({ ...cached.data, from_cache: true });
      }
    }

    let stocks: LiveStock[] = [];
    let source = 'unknown';
    let message: string | undefined;
    let total = 0;

    // --- Strategy 1: egxpy/TradingView (PRIMARY) ---
    const egxpyResult = await fetchFromEgxpy();
    if (egxpyResult) {
      stocks = egxpyResult.stocks;
      source = egxpyResult.source;
      message = egxpyResult.message;
      total = stocks.length;
    }

    // --- Strategy 2: VPS ---
    if (stocks.length === 0) {
      const vpsResult = await fetchFromVps();
      if (vpsResult) {
        stocks = vpsResult.stocks;
        source = vpsResult.source;
        message = vpsResult.message;
        total = stocks.length;
      }
    }

    // --- Strategy 3: Database ---
    if (stocks.length === 0) {
      const dbResult = fetchFromDatabase(limit, offset);
      stocks = dbResult.stocks;
      source = dbResult.source;
      message = dbResult.message;
      total = dbResult.total;
    } else {
      // External sources already returned a small list; apply client-side pagination
      total = stocks.length;
      stocks = stocks.slice(offset, offset + limit);
    }

    const fetchedAt = new Date().toISOString();

    const response: LiveDataResponse & { pagination: { limit: number; offset: number; total: number } } = {
      success: stocks.length > 0,
      source,
      fetched_at: fetchedAt,
      data_count: stocks.length,
      stocks,
      message: stocks.length > 0 ? message : 'No live data available from any source',
      pagination: { limit, offset, total },
    };

    // Cache successful responses (only when default pagination)
    if (stocks.length > 0 && offset === 0 && limit === 100) {
      liveDataCache.set(cacheKey, { data: response, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/market/live-data] Error:', error);
    return NextResponse.json(
      {
        success: false,
        source: 'error',
        fetched_at: new Date().toISOString(),
        data_count: 0,
        stocks: [],
        message: 'internal_error',
      },
      { status: 500 }
    );
  }
}
