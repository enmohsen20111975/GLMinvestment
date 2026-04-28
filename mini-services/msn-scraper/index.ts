/**
 * MSN Scraper — Independent EGX Data Collection Module
 * 
 * Architecture:
 *   - Pluggable data sources (Investing.com, MSN, EGX official, etc.)
 *   - Data validation layer before storing
 *   - Random delays between requests (anti-blocking)
 *   - Self-healing: if source fails, tries next
 *   - Resilient to page layout changes (multiple extraction strategies)
 * 
 * Usage:
 *   bun run dev          → Start HTTP API on port 3010
 *   GET /health          → Health check
 *   GET /sources         → List available data sources
 *   GET /scrape/overview → Scrape all stocks overview
 *   GET /scrape/stock?ticker=COME → Scrape single stock detail
 *   POST /scrape/full    → Full scrape (overview + details, with delays)
 *   GET /validate        → Run data validation
 *   GET /stats           → Scraping statistics
 * 
 * Port: 3010
 */

import { Hono } from 'hono';

const app = new Hono();
const PORT = 3010;

// ─── Configuration ───────────────────────────────────────────────
const CONFIG = {
  // Random delay range between requests (milliseconds)
  minDelay: 3000,
  maxDelay: 8000,
  // Max retries per request
  maxRetries: 3,
  // Request timeout (ms)
  requestTimeout: 15000,
  // Max concurrent requests
  maxConcurrency: 2,
  // Validation thresholds
  validation: {
    maxPriceChangePercent: 50,    // Alert if price changed >50% in one day
    minPrice: 0.01,              // Minimum valid price
    maxPrice: 100000,            // Maximum valid price
    minVolume: 0,                // Minimum valid volume
    maxVolume: 1000000000,       // Maximum valid volume
    minMarketCap: 100000,        // Minimum valid market cap
    maxMarketCap: 1000000000000, // Maximum valid market cap
  },
};

// ─── Statistics ──────────────────────────────────────────────────
const stats = {
  totalScrapes: 0,
  successfulScrapes: 0,
  failedScrapes: 0,
  lastScrapeAt: null as string | null,
  lastSource: null as string | null,
  bySource: {} as Record<string, { success: number; fail: number }>,
  byTicker: {} as Record<string, { lastScrape: string | null; source: string | null; price: number | null }>,
};

// ─── Utility Functions ───────────────────────────────────────────

function randomDelay(): Promise<void> {
  const delay = CONFIG.minDelay + Math.random() * (CONFIG.maxDelay - CONFIG.minDelay);
  console.log(`[delay] Waiting ${(delay / 1000).toFixed(1)}s...`);
  return new Promise(resolve => setTimeout(resolve, delay));
}

function updateStats(source: string, ticker: string | null, success: boolean, price?: number) {
  stats.totalScrapes++;
  if (success) stats.successfulScrapes++;
  else stats.failedScrapes++;
  stats.lastScrapeAt = new Date().toISOString();
  stats.lastSource = source;

  if (!stats.bySource[source]) stats.bySource[source] = { success: 0, fail: 0 };
  if (success) stats.bySource[source].success++;
  else stats.bySource[source].fail++;

  if (ticker) {
    stats.byTicker[ticker] = {
      lastScrape: new Date().toISOString(),
      source,
      price: price ?? null,
    };
  }
}

// ─── Data Validation Layer ───────────────────────────────────────

interface StockData {
  ticker: string;
  name?: string;
  nameAr?: string;
  price: number;
  change?: number;
  changePercent?: number;
  volume?: number;
  marketCap?: number;
  pe?: number;
  high52w?: number;
  low52w?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  date?: string;
  source: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitized: StockData;
}

function validateStockData(raw: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const v = CONFIG.validation;

  // Ensure price is a valid number
  let price = parseFloat(raw.price);
  if (isNaN(price)) {
    // Try alternative field names
    price = parseFloat(raw.lastPrice || raw.close_price || raw.currentPrice || raw.last);
  }
  if (isNaN(price) || price === 0) {
    errors.push(`Invalid price: "${raw.price}" for ${raw.ticker}`);
    price = 0;
  }

  // Check price bounds
  if (price > 0) {
    if (price < v.minPrice) {
      errors.push(`Price ${price} below minimum ${v.minPrice}`);
    }
    if (price > v.maxPrice) {
      errors.push(`Price ${price} above maximum ${v.maxPrice}`);
    }
  }

  // Validate change percentage
  let changePercent = parseFloat(raw.changePercent || raw.change_percent || raw.pctChange || 0);
  if (!isNaN(changePercent)) {
    if (Math.abs(changePercent) > v.maxPriceChangePercent) {
      warnings.push(`Large price change: ${changePercent}% for ${raw.ticker} — verify manually`);
    }
  }

  // Validate volume
  let volume = parseInt(raw.volume || 0);
  if (volume < 0) {
    errors.push(`Negative volume: ${volume} for ${raw.ticker}`);
    volume = 0;
  }
  if (volume > v.maxVolume) {
    warnings.push(`Suspicious volume: ${volume} for ${raw.ticker}`);
  }

  // Validate market cap
  let marketCap = parseFloat(raw.marketCap || raw.market_cap || 0);
  if (marketCap > 0 && (marketCap < v.minMarketCap || marketCap > v.maxMarketCap)) {
    warnings.push(`Unusual market cap: ${marketCap} for ${raw.ticker}`);
  }

  // Cross-validation: change should match price vs previous close
  if (raw.prevClose && price > 0) {
    const prevClose = parseFloat(raw.prevClose);
    if (!isNaN(prevClose) && prevClose > 0) {
      const expectedChange = ((price - prevClose) / prevClose) * 100;
      if (Math.abs(expectedChange - changePercent) > 5) {
        warnings.push(`Change mismatch: calculated ${expectedChange.toFixed(2)}% vs reported ${changePercent}%`);
      }
    }
  }

  // Build sanitized result
  const sanitized: StockData = {
    ticker: String(raw.ticker || '').trim(),
    name: raw.name || raw.nameEn || null,
    nameAr: raw.nameAr || null,
    price,
    change: parseFloat(raw.change || raw.change_value || 0) || undefined,
    changePercent: isNaN(changePercent) ? undefined : changePercent,
    volume: volume || undefined,
    marketCap: marketCap || undefined,
    pe: parseFloat(raw.pe || raw.peRatio || 0) || undefined,
    high52w: parseFloat(raw.high52w || raw['52wHigh'] || 0) || undefined,
    low52w: parseFloat(raw.low52w || raw['52wLow'] || 0) || undefined,
    open: parseFloat(raw.open || 0) || undefined,
    high: parseFloat(raw.high || 0) || undefined,
    low: parseFloat(raw.low || 0) || undefined,
    close: price,
    date: raw.date || new Date().toISOString().split('T')[0],
    source: raw.source || 'unknown',
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitized,
  };
}

// ─── Data Source: Investing.com ──────────────────────────────────
// Already proven to work for EGX stocks via page_reader

async function scrapeInvestingOverview(): Promise<{ stocks: StockData[]; errors: string[] }> {
  const stocks: StockData[] = [];
  const errors: string[] = [];
  
  try {
    // Use the z-ai-web-dev-sdk page_reader via subprocess
    const result = await fetchPageContent('https://www.investing.com/equities/egypt');
    if (!result) {
      errors.push('Failed to fetch Investing.com Egypt page');
      return { stocks, errors };
    }

    // Parse the HTML to extract stock data
    // Investing.com embeds stock data in a specific HTML structure
    const html = result;
    
    // Strategy 1: Extract from data attributes and table cells
    const stockRows = extractInvestingStocks(html);
    
    for (const row of stockRows) {
      const validation = validateStockData({ ...row, source: 'investing.com' });
      if (validation.valid || validation.warnings.length > 0) {
        stocks.push(validation.sanitized);
        if (validation.warnings.length > 0) {
          console.log(`[warn] ${validation.sanitized.ticker}:`, validation.warnings);
        }
      } else {
        errors.push(`${row.ticker}: ${validation.errors.join(', ')}`);
      }
    }
    
    updateStats('investing.com', null, stocks.length > 0);
  } catch (err: any) {
    errors.push(`Investing.com overview failed: ${err.message}`);
    updateStats('investing.com', null, false);
  }
  
  return { stocks, errors };
}

async function scrapeInvestingDetail(ticker: string): Promise<{ stock: StockData | null; error: string | null }> {
  try {
    const url = `https://www.investing.com/equities/${ticker.toLowerCase()}`;
    const html = await fetchPageContent(url);
    if (!html) {
      return { stock: null, error: `Failed to fetch ${url}` };
    }

    const data = extractInvestingDetail(html, ticker);
    if (!data) {
      return { stock: null, error: `Could not extract data for ${ticker}` };
    }

    const validation = validateStockData({ ...data, source: 'investing.com' });
    updateStats('investing.com', ticker, validation.valid);
    
    if (!validation.valid) {
      return { stock: null, error: validation.errors.join(', ') };
    }

    return { stock: validation.sanitized, error: null };
  } catch (err: any) {
    updateStats('investing.com', ticker, false);
    return { stock: null, error: err.message };
  }
}

// ─── Data Source: MSN Money (placeholder) ────────────────────────
// MSN loads data client-side via JavaScript, so page_reader can't get it.
// This adapter uses the MSN Money API directly when available.

async function scrapeMsnStock(ticker: string): Promise<{ stock: StockData | null; error: string | null }> {
  try {
    // MSN Money uses REST API: https://finance-services.msn.com/finance/Quote
    // Requires specific symbol format: 126.1.CAI.{TICKER}
    // This is a placeholder — implement when direct API access is available
    
    const msnSymbol = `126.1.CAI.${ticker}`;
    console.log(`[msn] Fetching ${msnSymbol}...`);
    
    // Attempt to use page_reader on MSN stock detail page
    const url = `https://www.msn.com/en-us/money/stockdetails/fi-${msnSymbol}`;
    const html = await fetchPageContent(url);
    
    if (!html) {
      return { stock: null, error: `MSN returned empty page for ${ticker}` };
    }

    // Check if we actually got EGX data (not the generic MSN page)
    if (!html.includes(ticker) && !html.includes('CAI')) {
      return { stock: null, error: `MSN returned generic page (not ${ticker} data). MSN loads EGX data client-side.` };
    }

    const data = extractMsnData(html, ticker);
    if (!data) {
      return { stock: null, error: `Could not extract ${ticker} data from MSN` };
    }

    const validation = validateStockData({ ...data, source: 'msn.com' });
    updateStats('msn.com', ticker, validation.valid);
    
    return { stock: validation.sanitized, error: null };
  } catch (err: any) {
    updateStats('msn.com', ticker, false);
    return { stock: null, error: err.message };
  }
}

// ─── Text Parsing Helpers ───────────────────────────────────────

/** Extract first regex match from string, or null */
function extractText(html: string, regex: RegExp): string | null {
  const match = html.match(regex);
  return match ? match[1] : null;
}

/** Parse a localized number (handles commas, spaces, percentages) */
function parseLocalizedNumber(raw: string | null | undefined): number {
  if (!raw) return 0;
  const cleaned = String(raw)
    .replace(/[,%\s‎]/g, '')   // Remove commas, %, spaces, LTR marks
    .replace(/[^\d.\-]/g, '') // Keep only digits, dots, minus
    .trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/** Clean text: trim, collapse whitespace, remove HTML entities */
function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clean a ticker symbol: uppercase, alphanumeric only */
function cleanNumber(ticker: string | null | undefined): string {
  if (!ticker) return '';
  return String(ticker).toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
}

// ─── HTML Extraction Helpers ─────────────────────────────────────
// These are resilient to layout changes with multiple fallback strategies

function extractInvestingStocks(html: string): any[] {
  const results: any[] = [];
  
  // Strategy 1: Extract from table rows (most reliable for Investing.com)
  const tableRowRegex = /<tr[^>]*class="[^"]*datatable_row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  
  while ((match = tableRowRegex.exec(html)) !== null) {
    const row = match[1];
    try {
      const ticker = extractText(row, /data-ticker="([^"]+)"/i) || 
                     extractText(row, /class="[^"]*symbol[^"]*"[^>]*>([^<]+)/i);
      const name = extractText(row, /class="[^"]*elpName[^"]*"[^>]*>([^<]+)/i) ||
                   extractText(row, /class="[^"]*name[^"]*"[^>]*>([^<]+)/i);
      const price = extractText(row, /class="[^"]*last[^"]*"[^>]*>([^<]+)/i) ||
                   extractText(row, /data-test="instrument-price-last"[^>]*>([^<]+)/i);
      const change = extractText(row, /class="[^"]*change[^\"]*\"[^>]*>([^<]+)/i);
      const changePercent = extractText(row, /class="[^"]*pctChange[^"]*"[^>]*>([^<]+)/i);
      const volume = extractText(row, /data-test="instrument-volume"[^>]*>([^<]+)/i);
      const marketCap = extractText(row, /data-test="instrument-market-cap"[^>]*>([^<]+)/i);

      if (ticker && price) {
        results.push({
          ticker: cleanNumber(ticker),
          name: name ? cleanText(name) : undefined,
          price: parseLocalizedNumber(price),
          change: change ? parseLocalizedNumber(change) : undefined,
          changePercent: changePercent ? parseLocalizedNumber(changePercent) : undefined,
          volume: volume ? parseLocalizedNumber(volume) : undefined,
          marketCap: marketCap ? parseLocalizedNumber(marketCap) : undefined,
        });
      }
    } catch {}
  }

  // Strategy 2: If no table rows found, try JSON embedded data
  if (results.length === 0) {
    const jsonRegex = /"symbol":\s*"([^"]+)"[^}]*"last":\s*([\d.]+)/g;
    while ((match = jsonRegex.exec(html)) !== null) {
      results.push({
        ticker: match[1],
        price: parseFloat(match[2]),
      });
    }
  }

  // Strategy 3: Try extracting from any span/div with price pattern
  if (results.length === 0) {
    const priceSpans = html.matchAll(/<span[^>]*class="[^"]*(?:price|last|value)[^"]*"[^>]*>([\d.,]+)<\/span>/gi);
    for (const m of priceSpans) {
      const price = parseLocalizedNumber(m[1]);
      if (price > 0) {
        results.push({ price });
      }
    }
  }

  return results;
}

function extractInvestingDetail(html: string, ticker: string): any | null {
  // Extract detailed stock data from Investing.com individual stock page
  
  const price = extractText(html, /data-test="instrument-header-current-price"[^>]*>([^<]+)/i) ||
                extractText(html, /class="[^"]*instrument-price[^\"]*\"[^>]*>([^<]+)/i);
  
  if (!price) return null;

  const name = extractText(html, /class="[^"]*instrument-name[^"]*"[^>]*>([^<]+)/i);
  const change = extractText(html, /class="[^"]*instrument-price-change[^\"]*\"[^>]*>([^<]+)/i);
  const changePercent = extractText(html, /data-test="instrument-price-change-percent"[^>]*>([^<]+)/i);
  const open = extractText(html, /data-test="open"[^>]*>([^<]+)/i);
  const high = extractText(html, /data-test="dayHigh"[^>]*>([^<]+)/i);
  const low = extractText(html, /data-test="dayLow"[^>]*>([^<]+)/i);
  const prevClose = extractText(html, /data-test="prevClose"[^>]*>([^<]+)/i);
  const volume = extractText(html, /data-test="volume"[^>]*>([^<]+)/i);
  const pe = extractText(html, /data-test="peRatio"[^>]*>([^<]+)/i);
  const high52w = extractText(html, /data-test="52WeekHigh"[^>]*>([^<]+)/i);
  const low52w = extractText(html, /data-test="52WeekLow"[^>]*>([^<]+)/i);

  return {
    ticker,
    name: name ? cleanText(name) : undefined,
    price: parseLocalizedNumber(price),
    change: change ? parseLocalizedNumber(change) : undefined,
    changePercent: changePercent ? parseLocalizedNumber(changePercent) : undefined,
    open: open ? parseLocalizedNumber(open) : undefined,
    high: high ? parseLocalizedNumber(high) : undefined,
    low: low ? parseLocalizedNumber(low) : undefined,
    prevClose: prevClose ? parseLocalizedNumber(prevClose) : undefined,
    volume: volume ? parseLocalizedNumber(volume) : undefined,
    pe: pe ? parseLocalizedNumber(pe) : undefined,
    high52w: high52w ? parseLocalizedNumber(high52w) : undefined,
    low52w: low52w ? parseLocalizedNumber(low52w) : undefined,
  };
}

function extractMsnData(html: string, ticker: string): any | null {
  // MSN Money data extraction (multiple strategies for resilience)
  
  const price = extractText(html, /quotePrice-DS-EntryPoint1-1"[^>]*title="([^"]+)"/i) ||
                extractText(html, /class="[^"]*price-value[^"]*"[^>]*>([^<]+)/i);
  
  if (!price) return null;

  const change = extractText(html, /class="[^"]*(?:change|change-value)[^"]*"[^>]*>([^<]+)/i);
  const changePercent = extractText(html, /changePcnt-DS-EntryPoint1-1[^>]*>([^<]+)/i);

  return {
    ticker,
    price: parseLocalizedNumber(price),
    change: change ? parseLocalizedNumber(change) : undefined,
    changePercent: changePercent ? parseLocalizedNumber(changePercent) : undefined,
  };
}

// ─── Page Content Fetcher (via z-ai CLI) ────────────────────────
// Uses z-ai-web-dev-sdk page_reader via subprocess

async function fetchPageContent(url: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['z-ai', 'function', '-n', 'page_reader', '-a', JSON.stringify({ url })], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(`[fetch] page_reader failed (exit ${exitCode}):`, stderr.substring(0, 200));
      return null;
    }

    // z-ai outputs text, we need to capture it differently
    // Try to parse as JSON
    try {
      const result = JSON.parse(stdout);
      if (result.data?.html) return result.data.html;
      if (result.html) return result.html;
    } catch {}

    // If not JSON, return raw text (might be useful for simple pages)
    return stdout || null;
  } catch (err: any) {
    console.error(`[fetch] Error fetching ${url}:`, err.message);
    return null;
  }
}

// ─── Unified Scrape Orchestrator ─────────────────────────────────

async function scrapeWithFallback(ticker: string, sources: string[] = ['investing.com', 'msn.com']): Promise<{
  stock: StockData | null;
  source: string;
  error: string | null;
}> {
  const tried: string[] = [];

  for (const source of sources) {
    console.log(`[scrape] Trying ${source} for ${ticker}...`);
    tried.push(source);

    let result: { stock: StockData | null; error: string | null };

    switch (source) {
      case 'investing.com':
        result = await scrapeInvestingDetail(ticker);
        break;
      case 'msn.com':
        result = await scrapeMsnStock(ticker);
        break;
      default:
        result = { stock: null, error: `Unknown source: ${source}` };
    }

    if (result.stock) {
      return { stock: result.stock, source, error: null };
    }

    console.log(`[scrape] ${source} failed for ${ticker}: ${result.error}`);
    
    // Random delay before trying next source
    if (sources.indexOf(source) < sources.length - 1) {
      await randomDelay();
    }
  }

  return { stock: null, source: 'none', error: `All sources failed: ${tried.join(', ')}` };
}

// ─── HTTP API Routes ─────────────────────────────────────────────

app.get('/health', (c) => c.json({
  status: 'ok',
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
  stats: {
    totalScrapes: stats.totalScrapes,
    successRate: stats.totalScrapes > 0 
      ? `${((stats.successfulScrapes / stats.totalScrapes) * 100).toFixed(1)}%` 
      : 'N/A',
    lastScrape: stats.lastScrapeAt,
    lastSource: stats.lastSource,
  },
}));

app.get('/sources', (c) => c.json({
  sources: [
    {
      id: 'investing.com',
      name: 'Investing.com',
      type: 'page_scrape',
      status: 'active',
      coverage: 'EGX30 + individual stocks',
      rateLimit: '3-8s between requests',
      notes: 'Reliable for EGX data. Client-side rendering for historical charts.',
    },
    {
      id: 'msn.com',
      name: 'MSN Money',
      type: 'page_scrape',
      status: 'limited',
      coverage: 'Individual stocks (if accessible)',
      rateLimit: '3-8s between requests',
      notes: 'MSN loads EGX data client-side. page_reader may not capture it. Direct API access needed.',
    },
  ],
  fallbackOrder: ['investing.com', 'msn.com'],
}));

app.get('/scrape/overview', async (c) => {
  console.log('[api] /scrape/overview — fetching EGX stocks from Investing.com');
  const result = await scrapeInvestingOverview();
  return c.json({
    success: result.stocks.length > 0,
    source: 'investing.com',
    stocksFound: result.stocks.length,
    stocks: result.stocks,
    errors: result.errors,
    scrapedAt: new Date().toISOString(),
  });
});

app.get('/scrape/stock', async (c) => {
  const ticker = c.req.query('ticker');
  if (!ticker) return c.json({ error: 'ticker parameter required' }, 400);

  const result = await scrapeWithFallback(ticker);
  return c.json({
    success: !!result.stock,
    ticker,
    source: result.source,
    stock: result.stock,
    error: result.error,
    scrapedAt: new Date().toISOString(),
  });
});

app.post('/scrape/full', async (c) => {
  console.log('[api] /scrape/full — full scrape with delays');
  const body = await c.req.json().catch(() => ({}));
  const tickers: string[] = body.tickers || [];
  const sources: string[] = body.sources || ['investing.com', 'msn.com'];

  // If no tickers provided, scrape EGX30 first to get the list
  let allTickers = tickers;
  if (allTickers.length === 0) {
    console.log('[api] No tickers provided, fetching overview first...');
    const overview = await scrapeInvestingOverview();
    allTickers = overview.stocks.map(s => s.ticker);
    if (allTickers.length === 0) {
      return c.json({ 
        error: 'No tickers found from overview. Provide tickers in request body.',
        overviewErrors: overview.errors,
      }, 500);
    }
  }

  console.log(`[api] Scraping ${allTickers.length} stocks...`);
  
  const results: any[] = [];
  for (let i = 0; i < allTickers.length; i++) {
    const ticker = allTickers[i];
    console.log(`[api] (${i + 1}/${allTickers.length}) ${ticker}`);
    
    const result = await scrapeWithFallback(ticker, sources);
    results.push({
      ticker,
      ...result,
      scrapedAt: new Date().toISOString(),
    });

    // Random delay between stocks (except after the last one)
    if (i < allTickers.length - 1) {
      await randomDelay();
    }
  }

  const successCount = results.filter(r => r.stock).length;
  
  return c.json({
    success: successCount > 0,
    total: allTickers.length,
    successful: successCount,
    failed: allTickers.length - successCount,
    results,
    completedAt: new Date().toISOString(),
  });
});

app.get('/validate/test', async (c) => {
  // Test the validation system with sample data
  const testCases = [
    { ticker: 'COME', price: '1,234.56', changePercent: '2.5', source: 'test' },         // Valid
    { ticker: 'FAKE', price: '0', source: 'test' },                                        // Invalid: zero price
    { ticker: 'SCAM', price: '999999', source: 'test' },                                   // Invalid: extreme price
    { ticker: 'VOL', price: '10.50', volume: '-100', source: 'test' },                     // Invalid: negative volume
    { ticker: 'BIG', price: '5.00', changePercent: '80', source: 'test' },                  // Warning: large change
    { ticker: 'MISMATCH', price: '100', changePercent: '10', prevClose: '120', source: 'test' }, // Warning: change mismatch
  ];

  const results = testCases.map(tc => validateStockData(tc));
  
  return c.json({
    description: 'Data validation system test',
    testCases: results.map((r, i) => ({
      input: testCases[i],
      ...r,
    })),
  });
});

app.get('/stats', (c) => c.json({
  stats,
  bySourceCount: Object.keys(stats.bySource).length,
  byTickerCount: Object.keys(stats.byTicker).length,
}));

// ─── Start Server ────────────────────────────────────────────────
console.log(`[msn-scraper] Starting EGX Data Scraper Module on port ${PORT}`);
console.log(`[msn-scraper] Delay range: ${CONFIG.minDelay / 1000}s - ${CONFIG.maxDelay / 1000}s`);
console.log(`[msn-scraper] Validation thresholds: price ${CONFIG.validation.minPrice}-${CONFIG.validation.maxPrice}, maxChange ${CONFIG.validation.maxPriceChangePercent}%`);

export default {
  port: PORT,
  fetch: app.fetch,
};
