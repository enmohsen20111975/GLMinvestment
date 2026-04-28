/**
 * egxpy-bridge.ts — Node.js wrapper for Python egxpy library
 *
 * This module calls Python egxpy on-demand via child_process.execFile to fetch
 * live EGX stock data from TradingView. No separate Python service needed.
 *
 * Architecture:
 *   Next.js API route → egxpy-bridge.ts → python3 -c → egxpy → TradingView
 *
 * This ELIMINATES the Mubasher scraping dependency entirely.
 *
 * IMPORTANT: Server-side only. Never import on the client.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ---- Cache ----

const CACHE_TTL_MS = 180_000; // 3 minutes
const cache = new Map<string, { ts: number; data: unknown }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data as T;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { ts: Date.now(), data });
  // Prune old entries periodically
  if (cache.size > 300) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL_MS * 2) cache.delete(k);
    }
  }
}

function clearCache(pattern?: string) {
  if (!pattern) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key);
  }
}

// ---- Python Execution ----

interface PythonResult {
  success: boolean;
  data?: any;
  error?: string;
  source?: string;
  cached?: boolean;
}

async function runPython(script: string, timeoutMs = 30_000): Promise<string> {
  const { stdout, stderr } = await execFileAsync('python3', ['-c', script], {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
    },
  });
  if (stderr && !stderr.includes('nologin') && !stderr.includes('FutureWarning')) {
    console.warn('[egxpy-bridge] Python stderr:', stderr.slice(0, 200));
  }
  return stdout;
}

async function runPythonJSON<T = unknown>(script: string, timeoutMs = 30_000): Promise<T> {
  const stdout = await runPython(script, timeoutMs);
  return JSON.parse(stdout) as T;
}

// ---- Data Types ----

export interface EgxpyQuote {
  ticker: string;
  exchange: string;
  current_price: number;
  previous_close: number;
  open_price: number;
  high_price: number;
  low_price: number;
  volume: number;
  price_change: number;
  price_change_percent: number;
  last_update: string;
  source: string;
}

export interface EgxpyHistoryPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EgxpyHistoryResult {
  rows: EgxpyHistoryPoint[];
  summary: {
    points: number;
    change: number;
    change_percent: number;
    from: string;
    to: string;
  };
}

// ---- Python Scripts ----

function quoteScript(ticker: string): string {
  return `
import json, warnings
warnings.filterwarnings('ignore')
from egxpy.download import get_OHLCV_data
try:
    df = get_OHLCV_data('${ticker}', 'EGX', 'Daily', 2)
    if df is None or df.empty:
        print(json.dumps({"error": "No data for ${ticker}"}))
    else:
        frame = df.tail(2)
        latest = frame.iloc[-1]
        prev_close = float(frame.iloc[-2].get("close", latest.get("open", latest.get("close"))))
        current = float(latest.get("close", 0))
        change = round(current - prev_close, 6)
        change_pct = round((change / prev_close * 100), 6) if prev_close else 0.0
        result = {
            "ticker": "${ticker}",
            "exchange": "EGX",
            "current_price": round(current, 6),
            "previous_close": round(prev_close, 6),
            "open_price": round(float(latest.get("open", current)), 6),
            "high_price": round(float(latest.get("high", current)), 6),
            "low_price": round(float(latest.get("low", current)), 6),
            "volume": int(float(latest.get("volume", 0))),
            "price_change": change,
            "price_change_percent": change_pct,
            "last_update": str(latest.name) if hasattr(latest.name, 'isoformat') else str(latest.name),
            "source": "egxpy -> tvDatafeed -> TradingView"
        }
        print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
}

function historyScript(ticker: string, days: number): string {
  return `
import json, warnings
warnings.filterwarnings('ignore')
from egxpy.download import get_OHLCV_data
try:
    df = get_OHLCV_data('${ticker}', 'EGX', 'Daily', ${days})
    if df is None or df.empty:
        print(json.dumps({"rows": [], "summary": {"points": 0, "change": 0, "change_percent": 0, "from": "", "to": ""}}))
    else:
        rows = []
        for idx, row in df.iterrows():
            rows.append({
                "date": idx.strftime("%Y-%m-%d") if hasattr(idx, 'strftime') else str(idx).split("T")[0],
                "open": round(float(row.get("open", 0)), 6),
                "high": round(float(row.get("high", 0)), 6),
                "low": round(float(row.get("low", 0)), 6),
                "close": round(float(row.get("close", 0)), 6),
                "volume": int(float(row.get("volume", 0)))
            })
        first = float(df.iloc[0].get("close", 0))
        last = float(df.iloc[-1].get("close", 0))
        change = round(last - first, 6)
        change_pct = round((change / first * 100), 6) if first else 0
        summary = {"points": len(rows), "change": change, "change_percent": change_pct, "from": rows[0]["date"] if rows else "", "to": rows[-1]["date"] if rows else ""}
        print(json.dumps({"rows": rows, "summary": summary}))
except Exception as e:
    print(json.dumps({"rows": [], "summary": {"points": 0, "change": 0, "change_percent": 0, "from": "", "to": ""}, "error": str(e)}))
`;
}

function batchQuotesScript(tickers: string[]): string {
  return `
import json, warnings
warnings.filterwarnings('ignore')
from egxpy.download import get_OHLCV_data
tickers = ${JSON.stringify(tickers)}
results = []
errors = []
for t in tickers:
    try:
        df = get_OHLCV_data(t, 'EGX', 'Daily', 2)
        if df is None or df.empty:
            errors.append({"ticker": t, "detail": "No data"})
            continue
        frame = df.tail(2)
        latest = frame.iloc[-1]
        prev_close = float(frame.iloc[-2].get("close", latest.get("open", latest.get("close"))))
        current = float(latest.get("close", 0))
        change = round(current - prev_close, 6)
        change_pct = round((change / prev_close * 100), 6) if prev_close else 0.0
        results.append({
            "ticker": t, "exchange": "EGX",
            "current_price": round(current, 6), "previous_close": round(prev_close, 6),
            "open_price": round(float(latest.get("open", current)), 6),
            "high_price": round(float(latest.get("high", current)), 6),
            "low_price": round(float(latest.get("low", current)), 6),
            "volume": int(float(latest.get("volume", 0))),
            "price_change": change, "price_change_percent": change_pct,
            "last_update": str(latest.name) if hasattr(latest.name, 'isoformat') else str(latest.name),
            "source": "egxpy -> tvDatafeed -> TradingView"
        })
    except Exception as e:
        errors.append({"ticker": t, "detail": str(e)})
print(json.dumps({"results": results, "errors": errors}))
`;
}

function dbStockScript(ticker: string): string {
  return `
import json, sqlite3
conn = sqlite3.connect('/home/z/my-project/db/egx_investment.db')
conn.row_factory = sqlite3.Row
row = conn.execute(
    "SELECT ticker, name, name_ar, sector, industry, current_price, previous_close, open_price, high_price, low_price, volume, market_cap, pe_ratio, pb_ratio, dividend_yield, eps, roe, debt_to_equity, support_level, resistance_level, ma_50, ma_200, rsi FROM stocks WHERE UPPER(ticker) = ? AND is_active = 1 LIMIT 1",
    ('${ticker}',)
).fetchone()
conn.close()
if row:
    result = {k: row[k] for k in row.keys()}
    print(json.dumps(result))
else:
    print(json.dumps({"error": "Ticker ${ticker} not found in database"}))
`;
}

function allActiveTickersScript(): string {
  return `
import json, sqlite3
conn = sqlite3.connect('/home/z/my-project/db/egx_investment.db')
rows = conn.execute("SELECT ticker FROM stocks WHERE is_active = 1 ORDER BY ticker").fetchall()
conn.close()
print(json.dumps([r[0] for r in rows]))
`;
}

// ---- Public API ----

/**
 * Check if egxpy is available (Python + egxpy installed)
 */
export async function isEgxpyAvailable(): Promise<boolean> {
  try {
    await runPython('import egxpy; print("ok")', 5_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch a single stock quote by ticker from TradingView via egxpy.
 * Returns null on any failure (never throws).
 */
export async function fetchQuote(ticker: string): Promise<EgxpyQuote | null> {
  const symbol = ticker.toUpperCase().trim();
  const cacheKey = `quote:${symbol}`;

  const cached = getCached<EgxpyQuote>(cacheKey);
  if (cached) return cached;

  try {
    const result = await runPythonJSON<any>(quoteScript(symbol), 20_000);
    if (result.error) {
      console.warn(`[egxpy-bridge] No data for ${symbol}:`, result.error);
      return null;
    }
    setCache(cacheKey, result);
    return result as EgxpyQuote;
  } catch (err: any) {
    console.error(`[egxpy-bridge] fetchQuote(${symbol}) failed:`, err.message);
    return null;
  }
}

/**
 * Fetch historical OHLCV data for a stock.
 * Returns null on any failure.
 */
export async function fetchHistory(ticker: string, days: number = 30): Promise<EgxpyHistoryResult | null> {
  const symbol = ticker.toUpperCase().trim();
  const cacheKey = `history:${symbol}:${days}`;

  const cached = getCached<EgxpyHistoryResult>(cacheKey);
  if (cached) return cached;

  try {
    const result = await runPythonJSON<EgxpyHistoryResult>(historyScript(symbol, days), 45_000);
    setCache(cacheKey, result);
    return result;
  } catch (err: any) {
    console.error(`[egxpy-bridge] fetchHistory(${symbol}) failed:`, err.message);
    return null;
  }
}

/**
 * Fetch quotes for multiple tickers at once.
 * Returns array of quotes (empty array on failure).
 */
export async function fetchBatchQuotes(tickers: string[]): Promise<EgxpyQuote[]> {
  if (tickers.length === 0) return [];

  const symbols = tickers.map(t => t.toUpperCase().trim());
  const cacheKey = `batch:${symbols.join(',')}`;

  const cached = getCached<EgxpyQuote[]>(cacheKey);
  if (cached) return cached;

  try {
    const timeout = Math.max(30_000, symbols.length * 5000);
    const result = await runPythonJSON<{ results: EgxpyQuote[]; errors: any[] }>(
      batchQuotesScript(symbols),
      timeout
    );
    if (result.errors?.length) {
      console.warn(`[egxpy-bridge] Batch errors:`, result.errors.map(e => e.ticker).join(', '));
    }
    setCache(cacheKey, result.results);
    return result.results;
  } catch (err: any) {
    console.error(`[egxpy-bridge] fetchBatchQuotes failed:`, err.message);
    return [];
  }
}

/**
 * Fetch stock record from local SQLite database.
 * Returns null on any failure.
 */
export async function fetchDbStock(ticker: string): Promise<any | null> {
  const symbol = ticker.toUpperCase().trim();
  try {
    const result = await runPythonJSON<any>(dbStockScript(symbol), 5_000);
    if (result.error) return null;
    return result;
  } catch {
    return null;
  }
}

/**
 * Get all active tickers from the local database.
 */
export async function fetchAllActiveTickers(): Promise<string[]> {
  const cached = getCached<string[]>('all_tickers');
  if (cached) return cached;

  try {
    const tickers = await runPythonJSON<string[]>(allActiveTickersScript(), 5_000);
    setCache('all_tickers', tickers);
    return tickers;
  } catch {
    return [];
  }
}

/**
 * Convert EgxpyQuote to LiveStock format (compatible with existing sync-live route)
 */
export function egxpyQuoteToLiveStock(quote: EgxpyQuote) {
  return {
    ticker: quote.ticker.toUpperCase(),
    current_price: quote.current_price,
    change: quote.price_change ?? 0,
    change_percent: quote.price_change_percent ?? 0,
    volume: quote.volume ?? 0,
    open: quote.open_price,
    high: quote.high_price,
    low: quote.low_price,
    previous_close: quote.previous_close,
    last_updated: quote.last_update || new Date().toISOString(),
    source: quote.source || 'egxpy',
  };
}

export { clearCache };
