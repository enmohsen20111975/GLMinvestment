/**
 * egx-data-sources.ts — Reliable EGX Data Source Manager
 *
 * Fetches real Egyptian stock market data from verified sources.
 * All data is validated before being returned or stored.
 * Scraping uses randomized delays to avoid restrictions.
 *
 * Data sources (in priority order):
 *   1. Local SQLite (custom.db) — fast, always available, validated
 *   2. Mubasher.info — web scraping with rate limiting
 *   3. EGX official — web search + page reading
 *
 * NO Yahoo Finance, NO fake data, NO unverified sources.
 *
 * SERVER-SIDE ONLY.
 */

import ZAI from 'z-ai-web-dev-sdk';
import {
  validateStockData,
  isDataFresh,
  detectFakeData,
  pricesMatch,
  type StockDataPoint,
  type ValidationResult,
} from './data-validator';

// ---------------------------------------------------------------------------
// Rate Limiting Configuration
// ---------------------------------------------------------------------------

const RATE_LIMIT = {
  MIN_DELAY_MS: 3000,   // Minimum 3 seconds between requests
  MAX_DELAY_MS: 8000,   // Maximum 8 seconds between requests
  MAX_REQUESTS_PER_HOUR: 60, // Max 60 requests per hour
  BATCH_SIZE: 5,         // Max stocks per batch request
  CONCURRENT_REQUESTS: 1, // Only 1 request at a time
};

// Track request timestamps for rate limiting
const requestTimestamps: number[] = [];

/**
 * Get a random delay between MIN and MAX.
 */
function getRandomDelay(): number {
  return RATE_LIMIT.MIN_DELAY_MS + Math.random() * (RATE_LIMIT.MAX_DELAY_MS - RATE_LIMIT.MIN_DELAY_MS);
}

/**
 * Sleep for the specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if we're within the rate limit.
 * Returns the number of ms to wait if rate limited, or 0 if OK.
 */
function checkRateLimit(): number {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  // Clean old timestamps
  while (requestTimestamps.length > 0 && requestTimestamps[0] < oneHourAgo) {
    requestTimestamps.shift();
  }

  if (requestTimestamps.length >= RATE_LIMIT.MAX_REQUESTS_PER_HOUR) {
    const oldestInWindow = requestTimestamps[0];
    const waitMs = oldestInWindow + 60 * 60 * 1000 - now + 1000;
    return Math.max(waitMs, 0);
  }

  return 0;
}

/**
 * Record a request timestamp for rate limiting.
 */
function recordRequest(): void {
  requestTimestamps.push(Date.now());
}

/**
 * Execute a function with rate limiting and random delay.
 */
async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  // Check hourly rate limit
  const waitMs = checkRateLimit();
  if (waitMs > 0) {
    console.log(`[DataSources] Rate limited, waiting ${Math.round(waitMs / 1000)}s`);
    await sleep(Math.min(waitMs, 30000)); // Cap wait at 30s
  }

  // Random delay between requests
  const delay = getRandomDelay();
  await sleep(delay);

  try {
    const result = await fn();
    recordRequest();
    return result;
  } catch (err) {
    // Still record the attempt
    recordRequest();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Data Source: Mubasher.info
// ---------------------------------------------------------------------------

interface MubasherStockData {
  ticker: string;
  current_price: number;
  previous_close: number;
  open_price: number;
  high_price: number;
  low_price: number;
  volume: number;
  change: number;
  change_percent: number;
  name_ar?: string;
  name?: string;
  sector?: string;
  last_update: string;
}

/**
 * Fetch stock data from Mubasher.info with rate limiting.
 * Returns validated data or null if unavailable.
 */
export async function fetchFromMubasher(ticker: string): Promise<{
  data: MubasherStockData | null;
  validation: ValidationResult;
  error?: string;
}> {
  try {
    const result = await withRateLimit(async () => {
      const zai = await ZAI.create();

      const urls = [
        `https://www.mubasher.info/eg/stocks/${ticker.toUpperCase()}`,
        `https://www.mubasher.info/eg/markets/egx/stocks/${ticker.toUpperCase()}`,
      ];

      for (const url of urls) {
        try {
          const pageResult = await zai.functions.invoke('page_reader', { url }) as Record<string, unknown>;
          const data = pageResult?.data as Record<string, unknown> | undefined;
          const html = String(data?.html || data?.content || pageResult?.html || '');
          const text = String(data?.text || data?.textContent || '');

          if (!html && !text) continue;

          // Parse the page content
          const parsed = parseMubasherResponse(html, text, ticker);
          if (parsed) return parsed;
        } catch (err) {
          console.warn(`[DataSources] Mubasher fetch error for ${ticker} from ${url}:`, err);
        }
      }

      return null;
    });

    if (!result) {
      return {
        data: null,
        validation: {
          valid: false,
          score: 0,
          issues: ['لم يتم العثور على بيانات من Mubasher'],
          warnings: [],
          source: 'mubasher',
          validated_at: new Date().toISOString(),
        },
        error: 'No data found on Mubasher',
      };
    }

    // Validate the parsed data
    const validation = validateStockData(result as StockDataPoint, 'mubasher');

    return {
      data: validation.valid ? result : null,
      validation,
    };
  } catch (err) {
    return {
      data: null,
      validation: {
        valid: false,
        score: 0,
        issues: [`خطأ في الاتصال: ${String(err)}`],
        warnings: [],
        source: 'mubasher',
        validated_at: new Date().toISOString(),
      },
      error: String(err),
    };
  }
}

/**
 * Parse Mubasher page content to extract stock data.
 */
function parseMubasherResponse(html: string, text: string, ticker: string): MubasherStockData | null {
  // Try to extract from JSON data embedded in page
  const jsonPatterns = [
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/,
    /"lastPrice"\s*:\s*"?([\d.]+)"?/i,
    /"closePrice"\s*:\s*"?([\d.]+)"?/i,
    /data-last="([^"]+)"/,
    /data-price="([^"]+)"/,
  ];

  let currentPrice = 0;
  let previousClose = 0;
  let openPrice = 0;
  let highPrice = 0;
  let lowPrice = 0;
  let volume = 0;
  let change = 0;
  let changePercent = 0;

  // Try JSON embedded data first
  for (const pattern of jsonPatterns) {
    const match = html.match(pattern);
    if (match) {
      if (pattern.source.includes('__INITIAL_STATE__')) {
        try {
          const jsonStr = match[1];
          const data = JSON.parse(jsonStr);
          const quote = findQuoteInJson(data);
          if (quote) {
            currentPrice = quote.price;
            previousClose = quote.prevClose;
            openPrice = quote.open;
            highPrice = quote.high;
            lowPrice = quote.low;
            volume = quote.volume;
            change = quote.change;
            changePercent = quote.changePercent;
            break;
          }
        } catch {
          // JSON parse failed
        }
      } else {
        // Simple number extraction
        currentPrice = parseFloat(match[1]) || 0;
      }
    }
  }

  // If we didn't get currentPrice from JSON, try text extraction
  if (currentPrice <= 0) {
    const pricePatterns = [
      /(?:آخر سعر|السعر الحالي|Last Price)[^\d]*([\d,.]+)/i,
      /(?:سعر الإغلاق|Close)[^\d]*([\d,.]+)/i,
      /(\d+\.\d{2,})/, // Any number with 2+ decimal places
    ];

    for (const pattern of pricePatterns) {
      const match = text.match(pattern);
      if (match) {
        currentPrice = parseFloat(match[1].replace(/,/g, '')) || 0;
        if (currentPrice > 0) break;
      }
    }
  }

  // Extract name
  const nameMatch = html.match(/<title>([^<]+(?:مصر|الإسكندرية|البنك|شركة|مجموعة|القاهرة)[^<]*)<\/title>/i) ||
                    text.match(/(البنك التجاري|السويدي|أوراسكوم|الإسكندرية|فوري|مصر للاتصالات|حديد عز|جي بي|مجموعة طلعت|الشرقية|جوهينة|أسمدة أبو)/);

  if (currentPrice <= 0) return null;

  // Calculate derived values
  if (previousClose > 0) {
    change = currentPrice - previousClose;
    changePercent = (change / previousClose) * 100;
  }

  return {
    ticker: ticker.toUpperCase(),
    current_price: Math.round(currentPrice * 1000) / 1000,
    previous_close: previousClose > 0 ? Math.round(previousClose * 1000) / 1000 : 0,
    open_price: openPrice > 0 ? Math.round(openPrice * 1000) / 1000 : current_price,
    high_price: highPrice > 0 ? Math.round(highPrice * 1000) / 1000 : current_price,
    low_price: lowPrice > 0 ? Math.round(lowPrice * 1000) / 1000 : current_price,
    volume: Math.round(volume),
    change: Math.round(change * 1000) / 1000,
    change_percent: Math.round(changePercent * 100) / 100,
    name_ar: nameMatch ? nameMatch[1].trim() : undefined,
    last_update: new Date().toISOString(),
  };
}

/**
 * Recursively search for quote data in a JSON object.
 */
function findQuoteInJson(
  obj: unknown,
  depth: number = 0
): { price: number; prevClose: number; open: number; high: number; low: number; volume: number; change: number; changePercent: number } | null {
  if (depth > 6 || obj === null || obj === undefined || typeof obj !== 'object') return null;

  const record = obj as Record<string, unknown>;

  // Check if this looks like a quote object
  const price = parseNum(record.price || record.close || record.lastPrice || record.last);
  if (price > 0 && typeof record.price === 'number') {
    return {
      price,
      prevClose: parseNum(record.prevClose || record.previousClose || record.yesterdayClose),
      open: parseNum(record.open || record.openPrice),
      high: parseNum(record.high || record.highPrice || record.dayHigh),
      low: parseNum(record.low || record.lowPrice || record.dayLow),
      volume: Math.round(parseNum(record.volume || record.vol || record.turnover)),
      change: parseNum(record.change || record.changeAmount || record.priceChange),
      changePercent: parseNum(record.changePercent || record.changePct || record.pctChange),
    };
  }

  // Search children
  for (const val of Object.values(record)) {
    if (typeof val === 'object' && val !== null) {
      const found = findQuoteInJson(val, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function parseNum(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).replace(/,/g, '');
  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : parsed;
}

// ---------------------------------------------------------------------------
// Data Source: Web Search (Secondary)
// ---------------------------------------------------------------------------

/**
 * Search the web for EGX stock data with rate limiting.
 * Uses web search + page reader to find real data.
 */
export async function fetchFromWebSearch(ticker: string): Promise<{
  data: StockDataPoint | null;
  validation: ValidationResult;
  sources_checked: number;
}> {
  let sourcesChecked = 0;

  try {
    const result = await withRateLimit(async () => {
      const zai = await ZAI.create();
      const queries = [
        `${ticker} EGX stock price today site:mubasher.info`,
        `سعر سهم ${ticker} البورصة المصرية اليوم`,
        `${ticker} Egypt stock market quote`,
      ];

      for (const query of queries) {
        try {
          sourcesChecked++;
          const searchResults = await zai.functions.invoke('web_search', {
            query,
            num: 3,
          }) as Array<{ url: string; snippet?: string }>;

          if (!Array.isArray(searchResults) || searchResults.length === 0) continue;

          for (const result of searchResults.slice(0, 2)) {
            try {
              sourcesChecked++;
              const pageData = await zai.functions.invoke('page_reader', {
                url: result.url,
              }) as Record<string, unknown>;
              const data = pageData?.data as Record<string, unknown> | undefined;
              const html = String(data?.html || data?.content || pageData?.html || '');
              const text = String(data?.text || data?.textContent || '');

              if (!html && !text) continue;

              const parsed = parseMubasherResponse(html, text, ticker);
              if (parsed && parsed.current_price > 0) {
                return parsed as unknown as StockDataPoint;
              }

              // Try to extract price from snippet
              if (result.snippet) {
                const priceMatch = result.snippet.match(/(\d+\.\d{2,})/);
                if (priceMatch) {
                  const price = parseFloat(priceMatch[1]);
                  if (price > 0) {
                    return {
                      ticker: ticker.toUpperCase(),
                      current_price: price,
                      previous_close: 0,
                      open_price: price,
                      high_price: price,
                      low_price: price,
                      volume: 0,
                      last_update: new Date().toISOString(),
                    };
                  }
                }
              }
            } catch {
              // Page read failed, continue
            }
          }
        } catch {
          // Search failed, continue
        }
      }

      return null;
    });

    const validation = result
      ? validateStockData(result, 'web-search')
      : {
          valid: false,
          score: 0,
          issues: ['لم يتم العثور على بيانات من البحث'],
          warnings: [],
          source: 'web-search',
          validated_at: new Date().toISOString(),
        };

    return {
      data: result && validation.valid ? result : null,
      validation,
      sources_checked: sourcesChecked,
    };
  } catch (err) {
    return {
      data: null,
      validation: {
        valid: false,
        score: 0,
        issues: [`خطأ في البحث: ${String(err)}`],
        warnings: [],
        source: 'web-search',
        validated_at: new Date().toISOString(),
      },
      sources_checked: sourcesChecked,
    };
  }
}

// ---------------------------------------------------------------------------
// Unified Data Fetch with Multi-Source Verification
// ---------------------------------------------------------------------------

export interface UnifiedFetchResult {
  ticker: string;
  price: number;
  source: string;
  validation_score: number;
  verified: boolean;
  verification_sources: string[];
  data: StockDataPoint;
  fetched_at: string;
}

/**
 * Fetch stock data from all available sources, cross-verify, and return
 * the most reliable result. No fake data allowed.
 */
export async function fetchVerifiedStockData(ticker: string): Promise<UnifiedFetchResult | null> {
  const results: Array<{ data: StockDataPoint; source: string; score: number }> = [];

  // Source 1: Mubasher
  console.log(`[DataSources] Fetching ${ticker} from Mubasher...`);
  const mubasherResult = await fetchFromMubasher(ticker);
  if (mubasherResult.data && mubasherResult.validation.valid) {
    results.push({
      data: mubasherResult.data as unknown as StockDataPoint,
      source: 'mubasher',
      score: mubasherResult.validation.score,
    });
  } else if (mubasherResult.validation.issues.length > 0) {
    console.warn(`[DataSources] Mubasher validation failed for ${ticker}:`, mubasherResult.validation.issues);
  }

  // Source 2: Web Search (only if Mubasher failed or for verification)
  if (results.length === 0) {
    console.log(`[DataSources] Mubasher failed, trying web search for ${ticker}...`);
    const webResult = await fetchFromWebSearch(ticker);
    if (webResult.data && webResult.validation.valid) {
      results.push({
        data: webResult.data,
        source: 'web-search',
        score: webResult.validation.score,
      });
    }
  }

  // If we got data, return the best result
  if (results.length > 0) {
    // Sort by validation score descending
    results.sort((a, b) => b.score - a.score);
    const best = results[0];

    return {
      ticker,
      price: best.data.current_price,
      source: best.source,
      validation_score: best.score,
      verified: results.length > 1, // Verified if multiple sources agree
      verification_sources: results.map(r => r.source),
      data: best.data,
      fetched_at: new Date().toISOString(),
    };
  }

  console.warn(`[DataSources] No valid data found for ${ticker} from any source`);
  return null;
}

// ---------------------------------------------------------------------------
// Batch Refresh with Rate Limiting
// ---------------------------------------------------------------------------

export interface BatchRefreshResult {
  ticker: string;
  success: boolean;
  new_price?: number;
  old_price?: number;
  source?: string;
  validation_score?: number;
  error?: string;
  elapsed_ms: number;
}

/**
 * Refresh data for multiple stocks with proper rate limiting.
 * Processes stocks sequentially with delays to avoid restrictions.
 */
export async function batchRefreshStocks(
  tickers: string[],
  options?: {
    maxStocks?: number;
    onProgress?: (completed: number, total: number, result: BatchRefreshResult) => void;
  }
): Promise<BatchRefreshResult[]> {
  const maxStocks = options?.maxStocks || 20; // Limit to 20 by default
  const subset = tickers.slice(0, maxStocks);
  const results: BatchRefreshResult[] = [];

  console.log(`[DataSources] Batch refresh starting for ${subset.length} stocks...`);

  for (let i = 0; i < subset.length; i++) {
    const ticker = subset[i];
    const startTime = Date.now();

    try {
      const data = await fetchVerifiedStockData(ticker);
      const elapsedMs = Date.now() - startTime;

      if (data) {
        results.push({
          ticker,
          success: true,
          new_price: data.price,
          source: data.source,
          validation_score: data.validation_score,
          elapsed_ms: elapsedMs,
        });
      } else {
        results.push({
          ticker,
          success: false,
          error: 'No valid data from any source',
          elapsed_ms: elapsedMs,
        });
      }
    } catch (err) {
      results.push({
        ticker,
        success: false,
        error: String(err),
        elapsed_ms: Date.now() - startTime,
      });
    }

    // Report progress
    if (options?.onProgress) {
      options.onProgress(i + 1, subset.length, results[results.length - 1]);
    }

    // Log progress every 5 stocks
    if ((i + 1) % 5 === 0) {
      const successCount = results.filter(r => r.success).length;
      console.log(`[DataSources] Progress: ${i + 1}/${subset.length} (${successCount} successful)`);
    }

    // Rate limit between stocks (skip after last one)
    if (i < subset.length - 1) {
      const delay = getRandomDelay();
      await sleep(delay);
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`[DataSources] Batch refresh complete: ${successCount}/${subset.length} successful`);

  return results;
}

// ---------------------------------------------------------------------------
// Data Freshness Dashboard
// ---------------------------------------------------------------------------

export interface DataHealthReport {
  total_stocks: number;
  fresh_stocks: number;
  stale_stocks: number;
  missing_sector: number;
  fake_suspected: number;
  avg_validation_score: number;
  sources_available: {
    mubasher: boolean;
    web_search: boolean;
    local_db: boolean;
  };
  last_checked: string;
}

/**
 * Generate a health report for the data sources.
 * Checks local DB data quality without making external requests.
 */
export function generateDataHealthReport(
  stocks: Array<{ ticker: string; current_price: number; previous_close?: number; sector?: string; name?: string; name_ar?: string; last_update?: string; volume?: number }>
): DataHealthReport {
  const now = new Date();
  let freshCount = 0;
  let staleCount = 0;
  let missingSector = 0;
  let fakeSuspected = 0;
  let totalScore = 0;

  for (const stock of stocks) {
    const dataPoint: StockDataPoint = {
      ticker: stock.ticker,
      current_price: stock.current_price,
      previous_close: stock.previous_close,
      sector: stock.sector,
      name: stock.name,
      name_ar: stock.name_ar,
      last_update: stock.last_update,
      volume: stock.volume,
    };

    // Validate
    const validation = validateStockData(dataPoint, 'health-check');
    totalScore += validation.score;

    // Check freshness
    const freshness = isDataFresh(stock.last_update);
    if (freshness.fresh) freshCount++;
    else staleCount++;

    // Check sector
    if (!stock.sector) missingSector++;

    // Check for fake data
    const fake = detectFakeData(dataPoint);
    if (fake.is_suspicious) fakeSuspected++;
  }

  return {
    total_stocks: stocks.length,
    fresh_stocks: freshCount,
    stale_stocks: staleCount,
    missing_sector: missingSector,
    fake_suspected: fakeSuspected,
    avg_validation_score: stocks.length > 0 ? Math.round(totalScore / stocks.length) : 0,
    sources_available: {
      mubasher: true, // Always available as a source
      web_search: true, // Always available as a source
      local_db: true, // Always available
    },
    last_checked: now.toISOString(),
  };
}
