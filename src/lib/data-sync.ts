/**
 * data-sync.ts — Shared data sync utilities for EGX investment platform.
 *
 * Provides functions to fetch stock data from Mubasher Egypt and other sources,
 * parse OHLCV data from HTML, normalize dates, and write to the database.
 *
 * IMPORTANT: This module uses z-ai-web-dev-sdk — server-side only!
 */

import ZAI from 'z-ai-web-dev-sdk';
import { createDatabase } from '@/lib/sqlite-wrapper';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedStockPrice {
  ticker: string;
  date: string;           // ISO date string (YYYY-MM-DD)
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
  adjusted_close?: number;
}

export interface StockCurrentData {
  ticker: string;
  current_price: number;
  open_price: number;
  high_price: number;
  low_price: number;
  volume: number;
  change?: number;
  change_percent?: number;
  previous_close?: number;
}

export interface StockDataResult {
  ticker: string;
  success: boolean;
  current_data?: StockCurrentData;
  historical_prices?: ParsedStockPrice[];
  error?: string;
  source?: string;
}

// Arabic month names (for date normalization)
const ARABIC_MONTHS: Record<string, number> = {
  'يناير': 1, 'يناير.': 1, 'يناير،': 1,
  'فبراير': 2, 'فبراير.': 2, 'فبراير،': 2,
  'مارس': 3, 'مارس.': 3, 'مارس،': 3,
  'أبريل': 4, 'أبريل.': 4, 'أبريل،': 4,
  'مايو': 5, 'مايو.': 5, 'مايو،': 5,
  'يونيو': 6, 'يونيو.': 6, 'يونيو،': 6,
  'يوليو': 7, 'يوليو.': 7, 'يوليو،': 7,
  'أغسطس': 8, 'أغسطس.': 8, 'أغسطس،': 8,
  'سبتمبر': 9, 'سبتمبر.': 9, 'سبتمبر،': 9,
  'أكتوبر': 10, 'أكتوبر.': 10, 'أكتوبر،': 10,
  'نوفمبر': 11, 'نوفمبر.': 11, 'نوفمبر،': 11,
  'ديسمبر': 12, 'ديسمبر.': 12, 'ديسمبر،': 12,
};

// Arabic ↔ Western numeral conversion
const ARABIC_NUMERALS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const HINDI_NUMERALS: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

// ---------------------------------------------------------------------------
// Date Normalization Utilities
// ---------------------------------------------------------------------------

/**
 * Convert Arabic/Hindi numerals to Western Arabic numerals.
 */
export function normalizeNumerals(text: string): string {
  let result = text;
  for (const [ar, west] of Object.entries(ARABIC_NUMERALS)) {
    result = result.replace(new RegExp(ar, 'g'), west);
  }
  for (const [hi, west] of Object.entries(HINDI_NUMERALS)) {
    result = result.replace(new RegExp(hi, 'g'), west);
  }
  return result;
}

/**
 * Try to parse a date string that may be in Arabic or various formats.
 * Returns an ISO date string (YYYY-MM-DD) or null if unparseable.
 */
export function normalizeDate(rawDate: string): string | null {
  if (!rawDate) return null;

  let normalized = normalizeNumerals(rawDate.trim());

  // Try ISO format first: 2026-04-15 or 2026/04/15
  const isoMatch = normalized.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Try DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Try Arabic date format: "15 أبريل 2026" or "أبريل 15, 2026"
  const arMatch = normalized.match(/(\d{1,2})\s+([^\d]+)\s+(\d{4})/);
  if (arMatch) {
    const day = parseInt(arMatch[1], 10);
    const monthStr = arMatch[2].trim();
    const year = arMatch[3];
    const month = ARABIC_MONTHS[monthStr];
    if (month) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Try "Month DD, YYYY" English format
  const engMatch = normalized.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (engMatch) {
    const monthStr = engMatch[1];
    const day = parseInt(engMatch[2], 10);
    const year = engMatch[3];
    const months: Record<string, number> = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6,
      jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
      oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
    };
    const month = months[monthStr.toLowerCase()];
    if (month) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Try timestamp string: "2026-04-15T10:29:57.000Z" or similar
  const tsMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (tsMatch) {
    const [, y, m, d] = tsMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

/**
 * Get today's date in Cairo timezone as YYYY-MM-DD.
 */
export function getTodayCairo(): string {
  // Egypt is UTC+2, no DST changes recently
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const cairo = new Date(utc + 2 * 3600000);
  const y = cairo.getFullYear();
  const m = String(cairo.getMonth() + 1).padStart(2, '0');
  const d = String(cairo.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Check if a date string is a valid trading day (Sun-Thu in Egypt).
 */
export function isTradingDay(dateStr: string): boolean {
  const date = new Date(dateStr + 'T00:00:00Z');
  const day = date.getUTCDay();
  // Egyptian stock market: Sunday = 0 through Thursday = 4
  return day >= 0 && day <= 4;
}

// ---------------------------------------------------------------------------
// Number parsing utilities
// ---------------------------------------------------------------------------

/**
 * Parse a number from a string that may contain commas, Arabic/Hindi numerals,
 * currency symbols, or percentage signs.
 */
export function parseNumber(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;

  let cleaned = normalizeNumerals(String(raw).trim());
  // Remove common non-numeric characters
  cleaned = cleaned.replace(/[%,\sجنيهEGPUSDLELE\.]/g, (match) => {
    if (match === '.' || match === ',') return match === '.' ? '.' : '';
    return '';
  });
  // Handle comma as thousand separator (remove commas)
  cleaned = cleaned.replace(/,/g, '');

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parse volume (integer) from a string.
 */
export function parseVolume(raw: string | number | null | undefined): number {
  const num = parseNumber(raw);
  return Math.round(num);
}

// ---------------------------------------------------------------------------
// Database helpers (server-side only)
// ---------------------------------------------------------------------------

/**
 * Get a writable database connection for sync operations.
 */
export function getWritableDatabase() {
  const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db');
  const db = createDatabase(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * Insert a price history record into the database.
 * Returns the inserted row id, or -1 if it already exists for that stock+date.
 */
export function insertPriceHistory(
  db: Record<string, unknown>,
  stockId: number,
  date: string,
  data: {
    open_price: number;
    high_price: number;
    low_price: number;
    close_price: number;
    volume: number;
  }
): number {
  const insertStmt = db.prepare(`
    INSERT INTO stock_price_history (stock_id, date, open_price, high_price, low_price, close_price, volume, adjusted_close, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `) as { run: (...args: unknown[]) => { changes: number; lastInsertRowid: number } };

  try {
    const result = insertStmt.run(
      stockId,
      date,
      data.open_price,
      data.high_price,
      data.low_price,
      data.close_price,
      data.volume,
      data.close_price, // adjusted_close defaults to close_price
      new Date().toISOString()
    );
    return result.lastInsertRowid;
  } catch (err: unknown) {
    // UNIQUE constraint or other DB error — record likely already exists
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return -1;
    }
    throw err;
  }
}

/**
 * Check if a price history record already exists for a stock on a given date.
 */
export function priceHistoryExists(
  db: Record<string, unknown>,
  stockId: number,
  date: string
): boolean {
  const stmt = db.prepare(
    'SELECT 1 FROM stock_price_history WHERE stock_id = ? AND date(date) = ? LIMIT 1'
  ) as { get: (...args: unknown[]) => unknown };
  const row = stmt.get(stockId, date);
  return row !== undefined;
}

/**
 * Upsert (insert or skip) a price history record for a stock on a given date.
 * Uses INSERT OR IGNORE to silently skip duplicates.
 */
export function upsertPriceHistory(
  db: Record<string, unknown>,
  stockId: number,
  date: string,
  data: {
    open_price: number;
    high_price: number;
    low_price: number;
    close_price: number;
    volume: number;
  }
): { inserted: boolean; id: number } {
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO stock_price_history (stock_id, date, open_price, high_price, low_price, close_price, volume, adjusted_close, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `) as { run: (...args: unknown[]) => { changes: number; lastInsertRowid: number } };

  const result = insertStmt.run(
    stockId,
    date,
    data.open_price,
    data.high_price,
    data.low_price,
    data.close_price,
    data.volume,
    data.close_price,
    new Date().toISOString()
  );

  return {
    inserted: result.changes > 0,
    id: result.lastInsertRowid,
  };
}

// ---------------------------------------------------------------------------
// Web fetching utilities
// ---------------------------------------------------------------------------

/**
 * Fetch a stock page from Mubasher Egypt.
 * Returns the HTML content or null if fetching fails.
 */
export async function fetchStockDataFromMubasher(ticker: string): Promise<{
  html: string;
  text: string;
  url: string;
} | null> {
  const zai = await ZAI.create();

  const urls = [
    `https://www.mubasher.info/eg/stocks/${ticker.toUpperCase()}`,
    `https://www.mubasher.info/eg/markets/egx/stocks/${ticker.toUpperCase()}`,
  ];

  for (const url of urls) {
    try {
      const result = await zai.functions.invoke('page_reader', { url }) as Record<string, unknown>;
      const data = result?.data as Record<string, unknown> | undefined;
      const html = String(data?.html || data?.content || result?.html || result?.content || '');
      const text = String(data?.text || data?.textContent || '');

      if (html || text) {
        return { html: html || '', text, url };
      }
    } catch (err) {
      console.error(`[DataSync] Error fetching Mubasher page for ${ticker} from ${url}:`, err);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// HTML Parsing — Extract stock price data from Mubasher pages
// ---------------------------------------------------------------------------

/**
 * Parse HTML content from Mubasher to extract current stock price data (OHLCV).
 */
export function parseStockPriceData(
  htmlContent: string,
  ticker: string
): StockCurrentData | null {
  const html = htmlContent || '';

  let currentPrice = 0;
  let openPrice = 0;
  let highPrice = 0;
  let lowPrice = 0;
  let volume = 0;
  let change = 0;
  let changePercent = 0;
  let previousClose = 0;

  // Strategy 1: Look for embedded JSON / __INITIAL_STATE__
  const jsonPatterns = [
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/,
    /window\.__APP_DATA__\s*=\s*({[\s\S]*?});\s*<\/script>/,
    /"stockData"\s*:\s*({[\s\S]*?})\s*[},]/,
    /"quote"\s*:\s*({[\s\S]*?})\s*[},]/,
  ];

  for (const pattern of jsonPatterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        const jsonStr = match[1];
        const data = JSON.parse(jsonStr) as Record<string, unknown>;
        const quote = extractQuoteFromJson(data, ticker);
        if (quote) return quote;
      } catch {
        // JSON parse failed, try next pattern
      }
    }
  }

  // Strategy 2: Look for structured data attributes
  // Common Mubasher data attributes
  const dataPatterns = [
    /data-last="([^"]+)"/,
    /data-price="([^"]+)"/,
    /data-close="([^"]+)"/,
    /data-open="([^"]+)"/,
    /data-high="([^"]+)"/,
    /data-low="([^"]+)"/,
    /data-volume="([^"]+)"/,
    /data-change="([^"]+)"/,
    /data-change-pct="([^"]+)"/,
    /data-prev="([^"]+)"/,
    /data-previous="([^"]+)"/,
  ];

  const dataMap: Record<string, string> = {};
  for (const p of dataPatterns) {
    const m = html.match(p);
    if (m) {
      const key = p.source.replace(/data-|"|\[\\^"\]+/g, '').replace(/=.*$/, '');
      dataMap[key] = m[1];
    }
  }

  // Strategy 3: Look for table rows with OHLCV data (common in Mubasher stock pages)
  // Often found in tables with labels like "الافتتاح", "الأعلى", "الأدنى", "الحجم"
  const ohlcvLabels = {
    open: ['الافتتاح', 'فتح', 'Open', 'open_price'],
    high: ['الأعلى', 'أعلى سعر', 'High', 'high_price'],
    low: ['الأدنى', 'أدنى سعر', 'Low', 'low_price'],
    volume: ['الحجم', 'الكمية', 'Volume', 'volume'],
    close: ['الإغلاق', 'إغلاق', 'Close', 'last_price', 'close_price'],
    change: ['التغير', 'التغيير', 'Change', 'change_amount'],
    changePct: ['نسبة التغير', 'التغير%', 'Change%', 'change_pct'],
    prevClose: ['الإغلاق السابق', 'الأمس', 'Previous', 'prev_close'],
  };

  // Find text content near Arabic labels
  for (const [field, labels] of Object.entries(ohlcvLabels)) {
    for (const label of labels) {
      // Look for label followed by a value in a table cell or span
      const patterns = [
        new RegExp(`${label}\\s*</(?:td|th|span|div)[^>]*>\\s*<(?:td|span|div)[^>]*>([^<]+)</`, 'i'),
        new RegExp(`>${label}</[^>]+>\\s*<[^>]+>([^<]+)<`, 'i'),
        new RegExp(`${label}[:\\s]+([\\d,.]+)`, 'i'),
        new RegExp(`"label"\\s*:\\s*"${label}".*?"value"\\s*:\\s*"([\\d,.]+)"`, 'is'),
        new RegExp(`"key"\\s*:\\s*"${label}".*?"value"\\s*:\\s*"?([\\d,.]+)"?`, 'is'),
      ];

      for (const p of patterns) {
        const m = html.match(p);
        if (m) {
          const val = parseNumber(m[1]);
          switch (field) {
            case 'open': openPrice = val; break;
            case 'high': highPrice = val; break;
            case 'low': lowPrice = val; break;
            case 'volume': volume = parseVolume(m[1]); break;
            case 'close': currentPrice = val; break;
            case 'change': change = val; break;
            case 'changePct': changePercent = val; break;
            case 'prevClose': previousClose = val; break;
          }
          break;
        }
      }
    }
  }

  // Strategy 4: Try to extract from meta tags or JSON-LD
  const metaPatterns = [
    /<meta[^>]+content="([^"]+)"[^>]+property="og:price:amount"[^>]*>/i,
    /"price"\s*:\s*"?([\d.]+)"?/g,
    /"lastPrice"\s*:\s*"?([\d.]+)"?/i,
    /"closePrice"\s*:\s*"?([\d.]+)"?/i,
  ];

  for (const p of metaPatterns) {
    const m = html.match(p);
    if (m && currentPrice === 0) {
      currentPrice = parseNumber(m[1]);
    }
  }

  // Calculate derived values
  if (currentPrice > 0 && changePercent !== 0 && previousClose === 0) {
    previousClose = currentPrice / (1 + changePercent / 100);
  }
  if (currentPrice > 0 && change !== 0 && previousClose === 0) {
    previousClose = currentPrice - change;
  }
  if (previousClose > 0 && change === 0) {
    change = currentPrice - previousClose;
  }
  if (previousClose > 0 && changePercent === 0) {
    changePercent = (change / previousClose) * 100;
  }

  // Validate: must have at least a current price
  if (currentPrice <= 0) return null;

  return {
    ticker: ticker.toUpperCase(),
    current_price: Math.round(currentPrice * 1000) / 1000,
    open_price: openPrice > 0 ? Math.round(openPrice * 1000) / 1000 : currentPrice,
    high_price: highPrice > 0 ? Math.round(highPrice * 1000) / 1000 : currentPrice,
    low_price: lowPrice > 0 ? Math.round(lowPrice * 1000) / 1000 : currentPrice,
    volume: Math.max(0, volume),
    change: Math.round(change * 1000) / 1000,
    change_percent: Math.round(changePercent * 100) / 100,
    previous_close: previousClose > 0 ? Math.round(previousClose * 1000) / 1000 : undefined,
  };
}

/**
 * Extract quote data from a parsed JSON object (nested search).
 */
function extractQuoteFromJson(
  data: Record<string, unknown>,
  ticker: string
): StockCurrentData | null {
  // Recursively search for stock data
  function find(obj: unknown, depth: number = 0): Record<string, unknown> | null {
    if (depth > 8 || obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return null;

    const record = obj as Record<string, unknown>;

    // Check if this looks like a quote object
    if (
      (record.price || record.close || record.lastPrice || record.last) &&
      typeof (record.price || record.close || record.lastPrice || record.last) === 'number'
    ) {
      return record;
    }

    // Check children
    for (const val of Object.values(record)) {
      if (typeof val === 'object' && val !== null) {
        const found = find(val, depth + 1);
        if (found) return found;
      }
    }

    return null;
  }

  const quote = find(data);
  if (!quote) return null;

  const price = parseNumber(
    quote.price || quote.close || quote.lastPrice || quote.last || quote.current_price
  );
  const open = parseNumber(quote.open || quote.open_price || quote.openPrice);
  const high = parseNumber(quote.high || quote.high_price || quote.highPrice || quote.dayHigh);
  const low = parseNumber(quote.low || quote.low_price || quote.lowPrice || quote.dayLow);
  const vol = parseVolume(quote.volume || quote.vol || quote.turnover);
  const chg = parseNumber(quote.change || quote.changeAmount || quote.diff || quote.priceChange);
  const chgPct = parseNumber(quote.changePercent || quote.changePct || quote.pctChange || quote.perChange);
  const prev = parseNumber(quote.prevClose || quote.previousClose || quote.yesterdayClose);

  if (price <= 0) return null;

  return {
    ticker: ticker.toUpperCase(),
    current_price: Math.round(price * 1000) / 1000,
    open_price: open > 0 ? Math.round(open * 1000) / 1000 : price,
    high_price: high > 0 ? Math.round(high * 1000) / 1000 : price,
    low_price: low > 0 ? Math.round(low * 1000) / 1000 : price,
    volume: Math.max(0, vol),
    change: Math.round(chg * 1000) / 1000,
    change_percent: Math.round(chgPct * 100) / 100,
    previous_close: prev > 0 ? Math.round(prev * 1000) / 1000 : undefined,
  };
}

// ---------------------------------------------------------------------------
// Historical price fetching — multiple sources
// ---------------------------------------------------------------------------

/**
 * Try to fetch historical price data for a stock from multiple sources.
 * Currently supports Mubasher Egypt stock page.
 */
export async function fetchHistoricalPrices(ticker: string): Promise<{
  prices: ParsedStockPrice[];
  source: string;
  error?: string;
}> {
  // Strategy 1: Fetch from Mubasher stock page
  try {
    const mubasherData = await fetchStockDataFromMubasher(ticker);
    if (mubasherData) {
      const currentData = parseStockPriceData(mubasherData.html, ticker);
      if (currentData) {
        // Extract historical data from the page if available (tables, charts)
        const historicalFromPage = parseHistoricalFromHtml(mubasherData.html, ticker);

        return {
          prices: historicalFromPage,
          source: 'mubasher-stock-page',
        };
      }
    }
  } catch (err) {
    console.error(`[DataSync] Mubasher historical fetch failed for ${ticker}:`, err);
  }

  // Strategy 2: Try web search for historical data
  try {
    const zai = await ZAI.create();
    const searchQueries = [
      `${ticker} EGX stock price history ${getTodayCairo()}`,
      `سعر سهم ${ticker} تاريخي البورصة المصرية`,
    ];

    for (const query of searchQueries) {
      try {
        const results = await zai.functions.invoke('web_search', {
          query,
          num: 3,
        }) as Array<{ url: string }>;

        if (Array.isArray(results) && results.length > 0) {
          // Try to read the most promising result
          for (const r of results.slice(0, 2)) {
            if (r.url.includes('mubasher.info')) {
              const pageResult = await zai.functions.invoke('web_reader', { url: r.url }) as Record<string, unknown>;
              const data = pageResult?.data as Record<string, unknown> | undefined;
              const html = String(data?.html || data?.content || pageResult?.html || '');
              if (html) {
                const historicalFromPage = parseHistoricalFromHtml(html, ticker);
                if (historicalFromPage.length > 0) {
                  return { prices: historicalFromPage, source: 'search-result-page' };
                }
              }
            }
          }
        }
      } catch {
        // Search failed, continue
      }
    }
  } catch (err) {
    console.error(`[DataSync] Web search historical fetch failed for ${ticker}:`, err);
  }

  return {
    prices: [],
    source: 'none',
    error: 'لم يتم العثور على بيانات تاريخية من أي مصدر',
  };
}

/**
 * Parse historical price data table from HTML content.
 * Looks for tables with date + price columns commonly found on stock pages.
 */
export function parseHistoricalFromHtml(
  html: string,
  ticker: string
): ParsedStockPrice[] {
  const prices: ParsedStockPrice[] = [];

  if (!html) return prices;

  // Strategy 1: Look for historical data table (date, open, high, low, close, volume)
  // Common patterns in financial sites
  const tablePatterns = [
    // Table with date column
    /<table[^>]*>([\s\S]*?)<\/table>/gi,
  ];

  for (const tablePattern of tablePatterns) {
    let tableMatch: RegExpExecArray | null;
    while ((tableMatch = tablePattern.exec(html)) !== null) {
      const tableHtml = tableMatch[1];

      // Check if this table likely contains price data (look for date-like content)
      if (!/20\d{2}/.test(tableHtml)) continue;

      // Parse rows
      const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch: RegExpExecArray | null;

      while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
        const row = rowMatch[1];
        const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        const cells: string[] = [];
        let cellMatch: RegExpExecArray | null;

        while ((cellMatch = cellPattern.exec(row)) !== null) {
          cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
        }

        // Look for rows with date + price data
        if (cells.length >= 2) {
          const parsed = parsePriceRow(cells, ticker);
          if (parsed) {
            prices.push(parsed);
          }
        }
      }

      if (prices.length > 0) return prices;
    }
  }

  // Strategy 2: Look for JSON-embedded historical data
  const jsonPatterns = [
    /"historicalData"\s*:\s*(\[[\s\S]*?\])/,
    /"priceHistory"\s*:\s*(\[[\s\S]*?\])/,
    /"historical"\s*:\s*(\[[\s\S]*?\])/,
    /"chartData"\s*:\s*(\[[\s\S]*?\])/,
    /"timeSeries"\s*:\s*(\[[\s\S]*?\])/,
  ];

  for (const pattern of jsonPatterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        const arr = JSON.parse(match[1]) as Record<string, unknown>[];
        for (const item of arr) {
          const price = extractHistoricalPoint(item, ticker);
          if (price) prices.push(price);
        }
        if (prices.length > 0) return prices;
      } catch {
        // JSON parse failed
      }
    }
  }

  return prices;
}

/**
 * Try to parse a table row as a price data point.
 */
function parsePriceRow(
  cells: string[],
  ticker: string
): ParsedStockPrice | null {
  if (cells.length < 2) return null;

  // Try to identify which cell is the date
  let dateStr = '';
  let dateIdx = -1;
  const numValues: number[] = [];

  for (let i = 0; i < Math.min(cells.length, 10); i++) {
    const cell = normalizeNumerals(cells[i]);
    const dateParsed = normalizeDate(cell);
    if (dateParsed && !dateStr) {
      dateStr = dateParsed;
      dateIdx = i;
    } else {
      const num = parseFloat(cell.replace(/,/g, ''));
      if (!isNaN(num) && num > 0) {
        numValues.push(num);
      }
    }
  }

  if (!dateStr || numValues.length === 0) return null;

  // Infer what each number represents based on position and count
  let open = 0, high = 0, low = 0, close = 0, volume = 0;

  if (numValues.length >= 5) {
    // Full OHLCV
    [open, high, low, close, volume] = numValues.slice(0, 5);
    volume = Math.round(volume);
  } else if (numValues.length >= 4) {
    // OHLC without volume
    [open, high, low, close] = numValues.slice(0, 4);
  } else if (numValues.length >= 2) {
    // Date + close + change, or Date + close
    close = numValues[0];
    open = close;
    high = close;
    low = close;
  } else if (numValues.length === 1) {
    close = numValues[0];
    open = close;
    high = close;
    low = close;
  }

  // Sanity check
  if (close <= 0) return null;
  if (high < low) { [high, low] = [low, high]; } // swap if inverted
  if (high === 0) high = Math.max(open, close);
  if (low === 0) low = Math.min(open, close);

  return {
    ticker: ticker.toUpperCase(),
    date: dateStr,
    open_price: open,
    high_price: high,
    low_price: low,
    close_price: close,
    volume,
  };
}

/**
 * Extract a historical price point from a JSON object.
 */
function extractHistoricalPoint(
  item: Record<string, unknown>,
  ticker: string
): ParsedStockPrice | null {
  const date = normalizeDate(String(item.date || item.time || item.timestamp || item.x || ''));
  if (!date) return null;

  const close = parseNumber(item.close || item.price || item.y || item.value);
  if (close <= 0) return null;

  const open = parseNumber(item.open || item.open_price || open);
  const high = parseNumber(item.high || item.high_price || item.h);
  const low = parseNumber(item.low || item.low_price || item.l);
  const volume = parseVolume(item.volume || item.vol || item.v);

  return {
    ticker: ticker.toUpperCase(),
    date,
    open_price: open > 0 ? open : close,
    high_price: high > 0 ? high : close,
    low_price: low > 0 ? low : close,
    close_price: close,
    volume,
  };
}

// ---------------------------------------------------------------------------
// Batch sync helpers
// ---------------------------------------------------------------------------

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate limit helper: process items with a delay between each.
 */
export async function processWithRateLimit<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  delayMs: number = 1500,
  maxItems?: number
): Promise<R[]> {
  const subset = maxItems ? items.slice(0, maxItems) : items;
  const results: R[] = [];

  for (let i = 0; i < subset.length; i++) {
    try {
      const result = await processor(subset[i], i);
      results.push(result);
    } catch (err) {
      console.error(`[DataSync] Error processing item ${i}:`, err);
      // Push a null or error indicator — caller handles it
      results.push(null as R);
    }

    // Delay between requests (except after the last one)
    if (i < subset.length - 1) {
      await sleep(delayMs);
    }
  }

  return results;
}
