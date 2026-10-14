import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

// Database paths — kept ONLY for size_mb reporting (file stat, no SQL).
// All count queries are delegated to Python (Rule 4: Python = brain).
const DATA_DIR = path.join(process.cwd(), 'db');
const ENGINE_STATUS_FILE = path.join(DATA_DIR, 'engine_status.json');
const HISTORICAL_STATUS_FILE = path.join(DATA_DIR, 'historical_status.json');

// Data Engine URL — Python service on port 5000
// المعمارية: data_engine (5000) يجلب البيانات | vps-service (8010) يحسب | Next.js (3000) يعرض
const FLASK_URL = process.env.DATA_ENGINE_URL || 'http://localhost:5000';


// Fallback engine state
let fallbackState = {
  running: false,
  scheduler_active: false,
  stocks_running: true,
  crypto_running: true,
  metals_running: true,
  forex_running: true,
  news_running: true,
  last_stocks_update: null as string | null,
  last_crypto_update: null as string | null,
  last_metals_update: null as string | null,
  last_forex_update: null as string | null,
  last_news_update: null as string | null,
  last_sync: null as string | null,
  logs: [] as string[],
  errors: [] as string[],
  active_jobs: [] as string[],
  historical_progress: null as Record<string, unknown> | null
};

// Honest empty DB stats — Rule 27 NO-FAKE-DATA. When Python is unreachable
// (Flask + vps-service both down), we return zeros for every count instead of
// opening SQLite directly. Consumers (DataEngineTab.tsx) already render the
// "no data" state for zero counts.
function emptyDbStats() {
  return {
    data_engine: { stocks: 0, crypto: 0, gold: 0, silver: 0, forex: 0 },
    stocks_db: { stocks: 0, daily_prices: 0 },
    historical: { records: 0, symbols: 0, categories: [] as Array<Record<string, unknown>> },
    news: 0,
    by_market: {} as Record<string, number>,
  };
}

// Check if Flask server is running
async function checkFlaskServer(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${FLASK_URL}/health`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return res.ok;
  } catch { // silent fallback (safe-by-design)
    return false;
  }
}

// Call Flask API
async function callFlaskAPI(endpoint: string, method: string = 'GET'): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${FLASK_URL}${endpoint}`, {
      method,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }
    });

    clearTimeout(timeoutId);
    return await res.json() as Record<string, unknown>;
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

/**
 * Fetch DB stats from Python. Tries the main Python backend
 * (PYTHON_BACKEND_URL) first, then the direct 127.0.0.1:8010 fallback.
 * Returns honest empty stats on failure (Rule 27).
 */
async function getDbStatsFromPython(): Promise<ReturnType<typeof emptyDbStats>> {
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/data-engine/db-stats`,
    'http://127.0.0.1:8010/api/data-engine/db-stats',
  ];
  for (const url of targetUrls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        if (data?.success && data?.db_stats) {
          return data.db_stats as ReturnType<typeof emptyDbStats>;
        }
      }
    } catch { // silent fallback (safe-by-design) → try next URL
      // Try next fallback URL.
    }
  }
  return emptyDbStats();
}

// Load status from file
function loadStatus() {
  try {
    if (fs.existsSync(ENGINE_STATUS_FILE)) {
      const content = fs.readFileSync(ENGINE_STATUS_FILE, 'utf-8');
      const saved = JSON.parse(content);
      fallbackState = { ...fallbackState, ...saved };
    }
  } catch (e) {
    console.error('Error loading status:', e);
  }
}

// Save status to file
function saveStatus() {
  try {
    fs.writeFileSync(ENGINE_STATUS_FILE, JSON.stringify(fallbackState, null, 2));
  } catch (e) {
    console.error('Error saving status:', e);
  }
}

// Load historical status
function loadHistoricalStatus() {
  try {
    if (fs.existsSync(HISTORICAL_STATUS_FILE)) {
      const content = fs.readFileSync(HISTORICAL_STATUS_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.error('Error loading historical status:', e);
  }
  return null;
}

// Run scraper using child_process — OS-level execution, not SQLite.
async function runScraper(scraperName: string): Promise<{ success: boolean; message: string }> {
  const scrapersDir = path.join(process.cwd(), 'data_engine', 'scrapers');

  const scripts: Record<string, string> = {
    'stocks': 'tradingview_scraper.py',
    'crypto': 'crypto_fetcher.py',
    'metals': 'metals_forex_fetcher.py',
    'news': 'news_scraper.py',
    'historical': 'historical_fetcher.py'
  };

  const script = scripts[scraperName];
  if (!script) {
    return { success: false, message: `Unknown scraper: ${scraperName}` };
  }

  // Add log entry
  const timestamp = new Date().toLocaleTimeString('en-GB');
  fallbackState.logs.push(`[${timestamp}]  Running ${scraperName} scraper...`);
  if (fallbackState.logs.length > 100) fallbackState.logs = fallbackState.logs.slice(-100);
  saveStatus();

  return new Promise((resolve) => {
    exec(`python3 "${path.join(scrapersDir, script)}"`, {
      cwd: scrapersDir,
      timeout: 600000,
      maxBuffer: 1024 * 1024 * 10
    }, (error: unknown, _stdout: string, _stderr: string) => {
      const ts = new Date().toLocaleTimeString('en-GB');
      if (error) {
        const errMsg = (error instanceof Error ? error.message : String(error)).slice(0, 100);
        fallbackState.logs.push(`[${ts}] ❌ ${scraperName} error: ${errMsg}`);
        fallbackState.errors.push(`[${ts}] ${scraperName}: ${errMsg}`);
        saveStatus();
        resolve({ success: false, message: `Error: ${error instanceof Error ? error.message : String(error)}` });
      } else {
        fallbackState.logs.push(`[${ts}] ✅ ${scraperName} completed successfully`);
        const key = `last_${scraperName}_update` as keyof typeof fallbackState;
        if (key in fallbackState) {
          (fallbackState as Record<string, unknown>)[key] = new Date().toISOString();
        }
        saveStatus();
        resolve({ success: true, message: `${scraperName} completed` });
      }
    });
  });
}

// Run sync
async function runSync(): Promise<{ success: boolean; message: string }> {
  const syncScript = path.join(process.cwd(), 'data_engine', 'sync.py');

  const timestamp = new Date().toLocaleTimeString('en-GB');
  fallbackState.logs.push(`[${timestamp}] 🔄 Running sync...`);
  saveStatus();

  return new Promise((resolve) => {
    exec(`python3 "${syncScript}"`, {
      timeout: 120000
    }, (error: unknown, _stdout: string, _stderr: string) => {
      const ts = new Date().toLocaleTimeString('en-GB');
      if (error) {
        const errMsg = (error instanceof Error ? error.message : String(error)).slice(0, 100);
        fallbackState.logs.push(`[${ts}] ❌ Sync error: ${errMsg}`);
        saveStatus();
        resolve({ success: false, message: `Error: ${error instanceof Error ? error.message : String(error)}` });
      } else {
        fallbackState.logs.push(`[${ts}] ✅ Sync completed`);
        fallbackState.last_sync = new Date().toISOString();
        saveStatus();
        resolve({ success: true, message: 'Sync completed' });
      }
    });
  });
}

// GET - Get engine status
export async function GET(request: NextRequest) {
  try {
    // Check if Flask server is running
    const flaskRunning = await checkFlaskServer();

    let source = 'Database Direct';
    let engineData = { ...fallbackState };

    if (flaskRunning) {
      // Get live data from Flask
      const flaskStatus = await callFlaskAPI('/status');
      if (flaskStatus?.success) {
        source = 'Flask Server (Live)';
        engineData = { ...engineData, ...(flaskStatus.engine as Record<string, unknown>) };
      }
    } else {
      // Load from file — local JSON cache written by the data_engine Python
      // service, NOT a SQLite database (Rule 4-compliant).
      loadStatus();
      engineData = { ...fallbackState };
    }

    // ── DB stats from Python (Rule 4: Python = brain). Honest empty when
    // both Flask AND vps-service are unreachable (Rule 27).
    const dbStats = await getDbStatsFromPython();
    const historicalStatus = loadHistoricalStatus();

    return NextResponse.json({
      success: true,
      source,
      flask_running: flaskRunning,
      engine: {
        ...engineData,
        historical_progress: historicalStatus?.progress || null
      },
      db_stats: dbStats,
      historical_status: historicalStatus,
      counts: {
        stocks: dbStats.data_engine.stocks,
        crypto: dbStats.data_engine.crypto,
        gold: dbStats.data_engine.gold,
        silver: dbStats.data_engine.silver,
        forex: dbStats.data_engine.forex,
        news: dbStats.news,
        historical_records: dbStats.historical.records,
        historical_symbols: dbStats.historical.symbols,
        daily_prices: dbStats.stocks_db.daily_prices
      },
      by_market: dbStats.by_market,
      historical_categories: dbStats.historical.categories,
      timestamp: new Date().toISOString()
    });
  } catch (error: unknown) {
    console.error('[data-engine:control]', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
      engine: fallbackState,
      counts: { stocks: 0, crypto: 0, gold: 0, silver: 0, forex: 0, news: 0, historical_records: 0 }
    });
  }
}

// POST - Control actions
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, scraper } = body;

    // Check Flask server
    const flaskRunning = await checkFlaskServer();

    // If Flask is running, forward the request
    if (flaskRunning && ['start_engine', 'stop_engine', 'trigger_stocks', 'trigger_crypto', 'trigger_metals', 'trigger_news', 'trigger_historical', 'trigger_sync', 'trigger_all'].includes(action)) {
      const endpointMap: Record<string, string> = {
        'start_engine': '/control/start',
        'stop_engine': '/control/stop',
        'trigger_stocks': '/trigger/stocks',
        'trigger_crypto': '/trigger/crypto',
        'trigger_metals': '/trigger/metals',
        'trigger_news': '/trigger/news',
        'trigger_historical': '/trigger/historical',
        'trigger_sync': '/trigger/sync',
        'trigger_all': '/trigger/all'
      };

      const result = await callFlaskAPI(endpointMap[action], 'POST');
      if (result) {
        return NextResponse.json(result);
      }
    }

    // Fallback: Handle locally — local file-based state (engine_status.json)
    // + child_process execution of Python scrapers. No SQLite access here.
    loadStatus();

    switch (action) {
      case 'start_engine':
        fallbackState.running = true;
        fallbackState.scheduler_active = true;
        saveStatus();
        return NextResponse.json({ success: true, message: 'Engine started (local mode). Note: Flask server not running.' });

      case 'stop_engine':
        fallbackState.running = false;
        fallbackState.scheduler_active = false;
        saveStatus();
        return NextResponse.json({ success: true, message: 'Engine stopped' });

      case 'clear_logs':
        fallbackState.logs = [];
        fallbackState.errors = [];
        saveStatus();
        return NextResponse.json({ success: true, message: 'Logs cleared' });

      case 'toggle_scraper':
        if (scraper) {
          const key = `${scraper}_running` as keyof typeof fallbackState;
          if (key in fallbackState) {
            (fallbackState as Record<string, unknown>)[key] = !(fallbackState as Record<string, unknown>)[key];
            saveStatus();
            return NextResponse.json({ success: true, scraper, running: fallbackState[key] });
          }
        }
        return NextResponse.json({ success: false, error: 'Unknown scraper' }, { status: 400 });

      case 'trigger_stocks':
        runScraper('stocks'); // Run async
        return NextResponse.json({ success: true, message: 'Stocks scraper started' });

      case 'trigger_crypto':
        runScraper('crypto');
        return NextResponse.json({ success: true, message: 'Crypto fetcher started' });

      case 'trigger_metals':
        runScraper('metals');
        return NextResponse.json({ success: true, message: 'Metals fetcher started' });

      case 'trigger_news':
        runScraper('news');
        return NextResponse.json({ success: true, message: 'News scraper started' });

      case 'trigger_historical':
        runScraper('historical');
        return NextResponse.json({ success: true, message: 'Historical fetcher started (5 years)' });

      case 'trigger_sync':
        runSync();
        return NextResponse.json({ success: true, message: 'Sync started' });

      case 'trigger_all':
        if (fallbackState.stocks_running) runScraper('stocks');
        if (fallbackState.crypto_running) runScraper('crypto');
        if (fallbackState.metals_running) runScraper('metals');
        return NextResponse.json({ success: true, message: 'All scrapers started' });

      default:
        console.error('[data-engine:control] unknown action:', action);
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
