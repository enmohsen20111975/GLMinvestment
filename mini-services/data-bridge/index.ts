/**
 * data-bridge — Bun-based EGX data bridge service (port 8010)
 * 
 * This service wraps the Python egxpy library via child_process and exposes
 * the same API as the VPS Python bridge. It runs as a persistent Bun process
 * that stays alive between sessions.
 * 
 * Architecture:
 *   Next.js API → http://localhost:8010 → Bun data-bridge → Python egxpy → TradingView
 * 
 * This eliminates the Mubasher scraping dependency entirely.
 */

import { execFile } from 'child_process';

const PORT = 8010;
const CACHE_TTL_MS = 180_000; // 3 minutes
const cache = new Map<string, { ts: number; data: unknown }>();

// ---- Helpers ----

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data as T;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { ts: Date.now(), data });
  // Prune old entries
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL_MS * 2) cache.delete(k);
    }
  }
}

function pythonScript(script: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      'python3',
      ['-c', script],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Python error: ${stderr || err.message}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

async function pythonJSON<T>(script: string, timeoutMs = 30_000): Promise<T> {
  const raw = await pythonScript(script, timeoutMs);
  return JSON.parse(raw);
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}

function errorResponse(message: string, status = 500) {
  return jsonResponse({ success: false, error: message }, status);
}

// ---- Python Script Templates ----

const QUOTE_SCRIPT = (ticker: string) => `
import json, warnings
warnings.filterwarnings('ignore')
from egxpy.download import get_OHLCV_data
try:
    df = get_OHLCV_data('${ticker}', 'EGX', 'Daily', 2)
    if df is None or df.empty:
        print(json.dumps({"error": "No data"}))
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

const HISTORY_SCRIPT = (ticker: string, days: number) => `
import json, warnings
warnings.filterwarnings('ignore')
from egxpy.download import get_OHLCV_data
try:
    df = get_OHLCV_data('${ticker}', 'EGX', 'Daily', ${days})
    if df is None or df.empty:
        print(json.dumps({"rows": [], "summary": {"points": 0}}))
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
        summary = {"points": len(rows), "change": change, "change_percent": change_pct, "from": rows[0]["date"], "to": rows[-1]["date"]}
        print(json.dumps({"rows": rows, "summary": summary}))
except Exception as e:
    print(json.dumps({"rows": [], "summary": {"points": 0}, "error": str(e)}))
`;

const BATCH_SCRIPT = (tickers: string[]) => `
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

// ---- Request Handler ----

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  try {
    // ---- Health ----
    if (path === '/health') {
      return jsonResponse({
        status: 'healthy',
        service: 'data-bridge',
        timestamp: new Date().toISOString(),
        source: 'egxpy -> tvDatafeed -> TradingView',
        cache_ttl_seconds: CACHE_TTL_MS / 1000,
        architecture: 'Bun + Python egxpy (on-demand)',
      });
    }

    // ---- Root ----
    if (path === '/') {
      return jsonResponse({
        service: 'EGX Data Bridge API',
        docs: '/health',
        source: 'egxpy -> tvDatafeed -> TradingView',
        architecture: 'Bun wrapper calling Python egxpy on-demand',
      });
    }

    // ---- Meta ----
    if (path === '/api/meta') {
      return jsonResponse({
        service: 'EGX Data Bridge API',
        version: '1.0.0',
        source: 'egxpy -> tvDatafeed -> TradingView (on-demand via Bun)',
        capabilities: [
          '/health',
          '/api/stocks/{ticker}',
          '/api/stocks/{ticker}/history?days=30',
          '/api/stocks/quotes?tickers=COMI,ETEL',
          '/api/market/overview?tickers=COMI,ETEL,FWRY',
        ],
      });
    }

    // ---- Single Stock Quote ----
    const stockMatch = path.match(/^\/api\/stocks\/([A-Z]{2,6})$/);
    if (stockMatch && req.method === 'GET') {
      const ticker = stockMatch[1];
      const cacheKey = `quote:${ticker}`;
      const cached = getCached(cacheKey);
      if (cached) return jsonResponse({ success: true, data: cached, cached: true });

      const result = await pythonJSON(QUOTE_SCRIPT(ticker));
      if ((result as any).error) return errorResponse((result as any).error, 502);
      setCache(cacheKey, result);
      return jsonResponse({ success: true, data: result, cached: false });
    }

    // ---- Stock History ----
    const historyMatch = path.match(/^\/api\/stocks\/([A-Z]{2,6})\/history$/);
    if (historyMatch && req.method === 'GET') {
      const ticker = historyMatch[1];
      const days = parseInt(url.searchParams.get('days') || '30', 10);
      const cacheKey = `history:${ticker}:${days}`;
      const cached = getCached(cacheKey);
      if (cached) return jsonResponse({ success: true, data: cached, cached: true });

      const result = await pythonJSON(HISTORY_SCRIPT(ticker, days), 45_000);
      setCache(cacheKey, result);
      return jsonResponse({ success: true, ...result, cached: false });
    }

    // ---- Batch Quotes ----
    if (path === '/api/stocks/quotes' && req.method === 'GET') {
      const tickersRaw = url.searchParams.get('tickers') || '';
      const tickers = tickersRaw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      if (tickers.length === 0) return errorResponse('No tickers provided', 400);
      if (tickers.length > 25) return errorResponse('Max 25 tickers per request', 400);

      const cacheKey = `batch:${tickers.join(',')}`;
      const cached = getCached(cacheKey);
      if (cached) return jsonResponse({ success: true, data: cached, cached: true });

      const result = await pythonJSON<{ results: unknown[]; errors: unknown[] }>(
        BATCH_SCRIPT(tickers),
        Math.max(30_000, tickers.length * 5000)
      );
      setCache(cacheKey, result.results);
      return jsonResponse({
        success: true,
        total_requested: tickers.length,
        count: result.results.length,
        failed: result.errors.length,
        data: result.results,
        errors: result.errors,
        cached: false,
      });
    }

    // ---- Market Overview ----
    if (path === '/api/market/overview' && req.method === 'GET') {
      const tickersRaw = url.searchParams.get('tickers') || 'COMI,ETEL,FWRY,HRHO,TMGH,ABUK,SWDY,ORAS,EAST,JUFO';
      const tickers = tickersRaw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      const cacheKey = `overview:${tickers.join(',')}`;
      const cached = getCached(cacheKey);
      if (cached) return jsonResponse({ success: true, ...cached, cached: true });

      const result = await pythonJSON<{ results: any[]; errors: any[] }>(
        BATCH_SCRIPT(tickers),
        Math.max(45_000, tickers.length * 5000)
      );

      const quotes = result.results;
      const gainers = quotes.filter((q: any) => q.price_change_percent > 0).length;
      const losers = quotes.filter((q: any) => q.price_change_percent < 0).length;
      const unchanged = quotes.length - gainers - losers;

      const topGainers = [...quotes].filter((q: any) => q.price_change_percent > 0)
        .sort((a: any, b: any) => b.price_change_percent - a.price_change_percent).slice(0, 5);
      const topLosers = [...quotes].filter((q: any) => q.price_change_percent < 0)
        .sort((a: any, b: any) => a.price_change_percent - b.price_change_percent).slice(0, 5);
      const mostActive = [...quotes].sort((a: any, b: any) => b.volume - a.volume).slice(0, 5);

      const overview = {
        stocks: quotes,
        market_stats: { gainers, losers, unchanged },
        top_gainers: topGainers,
        top_losers: topLosers,
        most_active: mostActive,
        last_updated: new Date().toISOString(),
      };
      setCache(cacheKey, overview);
      return jsonResponse({ success: true, ...overview, cached: false });
    }

    // ---- Fundamentals (from SQLite DB) ----
    const fundMatch = path.match(/^\/api\/fundamentals\/([A-Z]{2,6})$/);
    if (fundMatch && req.method === 'GET') {
      const ticker = fundMatch[1];
      const script = `
import json, sqlite3
conn = sqlite3.connect('/home/z/my-project/db/egx_investment.db')
conn.row_factory = sqlite3.Row
row = conn.execute("SELECT ticker, name, name_ar, sector, industry, current_price, previous_close, volume, market_cap, pe_ratio, pb_ratio, dividend_yield, eps, roe, debt_to_equity, ma_50, ma_200, rsi FROM stocks WHERE UPPER(ticker) = ? AND is_active = 1 LIMIT 1", ('${ticker}',)).fetchone()
conn.close()
if row:
    print(json.dumps({k: row[k] for k in row.keys()}))
else:
    print(json.dumps({"error": "Not found"}))
`;
      const result = await pythonJSON(script);
      if ((result as any).error) return errorResponse((result as any).error, 404);
      return jsonResponse({ success: true, ticker, data: result });
    }

    // ---- Quote (alias) ----
    const quoteMatch = path.match(/^\/api\/quote\/([A-Z]{2,6})$/);
    if (quoteMatch && req.method === 'GET') {
      const ticker = quoteMatch[1];
      const cacheKey = `quote:${ticker}`;
      const cached = getCached(cacheKey);
      if (cached) return jsonResponse({ success: true, data: cached, cached: true });

      const result = await pythonJSON(QUOTE_SCRIPT(ticker));
      if ((result as any).error) return errorResponse((result as any).error, 502);
      setCache(cacheKey, result);
      return jsonResponse({ success: true, data: result, cached: false });
    }

    return errorResponse('Not found', 404);
  } catch (err: any) {
    console.error(`[data-bridge] Error handling ${path}:`, err.message);
    return errorResponse(err.message, 500);
  }
}

// ---- Start Server ----

console.log(`[data-bridge] Starting EGX Data Bridge on port ${PORT}...`);
console.log(`[data-bridge] Architecture: Bun + Python egxpy (on-demand)`);
console.log(`[data-bridge] Cache TTL: ${CACHE_TTL_MS / 1000}s`);

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`[data-bridge] Ready at http://localhost:${PORT}`);
console.log(`[data-bridge] Health: http://localhost:${PORT}/health`);
