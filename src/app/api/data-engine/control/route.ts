import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { openDb } from '@/lib/db-manager';

// Database paths
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
  historical_progress: null as unknown as Record<string, unknown>
};

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
  } catch {
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
    return await res.json();
  } catch {
    return null;
  }
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

// Get all database stats
function getAllDbStats() {
  const stats: Record<string, unknown> = {
    data_engine: { stocks: 0, crypto: 0, gold: 0, silver: 0, forex: 0 } as Record<string, number>,
    stocks_db: { stocks: 0, daily_prices: 0 } as Record<string, number>,
    historical: { records: 0, symbols: 0, categories: [] } as Record<string, unknown>,
    news: 0,
    by_market: {} as Record<string, number>
  };

  // Data engine DB
  {
    const db = openDb('data_engine.db');
    if (db) {
      try {
        db.pragma('busy_timeout = 5000');
        try {
          const result = db.prepare('SELECT COUNT(*) as count FROM stocks').get() as { count: number };
          (stats.data_engine as Record<string, number>).stocks = result?.count || 0;
        } catch {}

        try {
          const marketRows = db.prepare('SELECT market, COUNT(*) as count FROM stocks GROUP BY market').all() as { market: string; count: number }[];
          for (const row of marketRows) {
            (stats.by_market as Record<string, number>)[row.market] = row.count;
          }
        } catch {}

        try {
          const result = db.prepare('SELECT COUNT(*) as count FROM crypto_prices').get() as { count: number };
          (stats.data_engine as Record<string, number>).crypto = result?.count || 0;
        } catch {}

        try {
          const result = db.prepare('SELECT COUNT(*) as count FROM gold_prices').get() as { count: number };
          (stats.data_engine as Record<string, number>).gold = result?.count || 0;
        } catch {}

        try {
          const result = db.prepare('SELECT COUNT(*) as count FROM silver_prices').get() as { count: number };
          (stats.data_engine as Record<string, number>).silver = result?.count || 0;
        } catch {}

        try {
          const result = db.prepare('SELECT COUNT(*) as count FROM exchange_rates').get() as { count: number };
          (stats.data_engine as Record<string, number>).forex = result?.count || 0;
        } catch {}
      } catch (e) {
        console.error('Error reading data_engine.db:', e);
      } finally {
        try { db.close(); } catch { /* ignore */ }
      }
    }
  }

  // Stocks DB
  {
    const db = openDb('stocks.db');
    if (db) {
      try {
        db.pragma('busy_timeout = 5000');
        try {
          const result = db.prepare('SELECT COUNT(*) as count FROM stocks').get() as { count: number };
          (stats.stocks_db as Record<string, number>).stocks = result?.count || 0;
        } catch {}

        try {
          const result = db.prepare('SELECT COUNT(*) as count FROM stock_daily_prices').get() as { count: number };
          (stats.stocks_db as Record<string, number>).daily_prices = result?.count || 0;
        } catch {}
      } catch {}
      try { db.close(); } catch { /* ignore */ }
    }
  }

  // Historical DB
  {
    const db = openDb('data_engine.db');
    if (db) {
      try {
        db.pragma('busy_timeout = 5000');
        try {
          const result = db.prepare('SELECT COUNT(*) as count FROM historical_prices').get() as { count: number };
          (stats.historical as Record<string, unknown>).records = result?.count || 0;
        } catch {}

        try {
          const result = db.prepare('SELECT COUNT(DISTINCT symbol) as count FROM historical_prices').get() as { count: number };
          (stats.historical as Record<string, unknown>).symbols = result?.count || 0;
        } catch {}

        try {
          const rows = db.prepare(`
            SELECT category, COUNT(DISTINCT symbol) as symbols, COUNT(*) as records
            FROM historical_prices GROUP BY category
          `).all() as { category: string; symbols: number; records: number }[];
          (stats.historical as Record<string, unknown>).categories = rows;
        } catch {}
      } catch {}
      try { db.close(); } catch { /* ignore */ }
    }
  }

  // News DB
  {
    const db = openDb('news.db');
    if (db) {
      db.pragma('busy_timeout = 5000');
      // FIX-WAVE-2-DATA (AUDIT-DEEP-5 #4): news_articles renamed → market_news per Rule 44.
      const result = db.prepare('SELECT COUNT(*) as count FROM market_news').get() as { count: number };
      stats.news = result?.count || 0;
      db.close();
    }
  }

  return stats;
}

// Run scraper using child_process
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
    }, (error: unknown, stdout: string, stderr: string) => {
      const ts = new Date().toLocaleTimeString('en-GB');
      const errMsg = error instanceof Error ? error.message : String(error);
      if (error) {
        fallbackState.logs.push(`[${ts}] ❌ ${scraperName} error: ${errMsg.slice(0, 100)}`);
        fallbackState.errors.push(`[${ts}] ${scraperName}: ${errMsg.slice(0, 100)}`);
        saveStatus();
        resolve({ success: false, message: `Error: ${errMsg}` });
      } else {
        fallbackState.logs.push(`[${ts}] ✅ ${scraperName} completed successfully`);
        // Update timestamp
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
    }, (error: unknown, stdout: string, stderr: string) => {
      const ts = new Date().toLocaleTimeString('en-GB');
      const errMsg = error instanceof Error ? error.message : String(error);
      if (error) {
        fallbackState.logs.push(`[${ts}] ❌ Sync error: ${errMsg.slice(0, 100)}`);
        saveStatus();
        resolve({ success: false, message: `Error: ${errMsg}` });
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
      // Load from file
      loadStatus();
      engineData = { ...fallbackState };
    }
    
    const dbStats = getAllDbStats();
    const historicalStatus = loadHistoricalStatus();
    const deStats = dbStats.data_engine as Record<string, number>;
    const sdbStats = dbStats.stocks_db as Record<string, number>;
    const histStats = dbStats.historical as Record<string, unknown>;
    
    return NextResponse.json({
      success: true,
      source,
      flask_running: flaskRunning,
      engine: {
        ...engineData,
        historical_progress: (historicalStatus as Record<string, unknown> | null)?.progress || null
      },
      db_stats: dbStats,
      historical_status: historicalStatus,
      counts: {
        stocks: deStats.stocks,
        crypto: deStats.crypto,
        gold: deStats.gold,
        silver: deStats.silver,
        forex: deStats.forex,
        news: dbStats.news,
        historical_records: histStats.records as number,
        historical_symbols: histStats.symbols as number,
        daily_prices: sdbStats.daily_prices
      },
      by_market: dbStats.by_market,
      historical_categories: histStats.categories,
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
    
    // Fallback: Handle locally
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
