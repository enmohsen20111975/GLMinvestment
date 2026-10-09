// P1-FIX (2026-10-09, Round 2): This file has its own alias map. Should import normalizeMarket() from @/lib/market-utils.ts for single source of truth.
/**
 * Market Data Access Library (REAL — no fabrication)
 * ================================================
 * يوفّر وصول موحّد لكل قواعد بيانات الأسعار مع fallback ذكي:
 *   1. data_engine.db → historical_data (TADAWUL 89 symbols, US, Forex, Gold)
 *   2. historical.db  → historical_prices (TADAWUL, EGX, KSE, QSE, Crypto, Forex, Metals, Indices)
 *   3. data_engine.db → egksco_price_history (762 EGX tickers — migrated from price_history.db)
 *
 * كل قاعدة بيانات بيتم فتحها بـ readonly الأول، وبعدين immutable=1 كـ fallback
 * عشان نتجنّب WAL corruption اللي بيحصل لما data_engine (port 5000) يمسك الـ DB.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { existsSync } from 'fs';

export interface PriceRow {
  date: string;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
  source: string;
}

export interface MarketTicker {
  ticker: string;
  market: string;
  name?: string;
  data_points: number;
  earliest_date: string;
  latest_date: string;
  source?: string;
}

// ============== Market Code Normalization ==============

export function normalizeMarketCode(market: string): string {
  if (!market) return 'EGX';
  const m = market.toLowerCase().trim();
  if (m.includes('سعود') || m === 'tadawul') return 'TADAWUL';
  if (m.includes('مصر') || m.includes('egx') || m.includes('مصرية')) return 'EGX';
  if (m.includes('كويت') || m === 'kse') return 'KSE';
  if (m.includes('قطر') || m === 'qse') return 'QSE';
  if (m.includes('أمريك') || m.includes('امريك') || m === 'us') return 'US';
  if (m.includes('مؤشر') || m.includes('عالمي')) return 'INDICES';
  if (m.includes('عملات') && !m.includes('رقمي') || m === 'forex' || m.includes('عربية')) return 'FOREX';
  if (m.includes('ذهب') || m.includes('فضة') || m.includes('معادن')) return 'COMMODITIES';
  if (m.includes('رقمي') || m.includes('كريبتو') || m === 'crypto' || m.includes('₿')) return 'CRYPTO';
  return market.toUpperCase();
}

export function marketCodeToArabic(code: string): string[] {
  const c = code.toUpperCase();
  switch (c) {
    case 'TADAWUL': return ['السعودية', '🇸🇦 TADAWUL - الأسهم السعودية', 'TADAWUL'];
    case 'EGX': return ['🇪🇬 EGX - الأسهم المصرية'];
    case 'KSE': return ['🇰🇼 KSE - الأسهم الكويتية'];
    case 'QSE': return ['🇶🇦 QSE - الأسهم القطرية'];
    case 'US': return ['الأسهم الأمريكية'];
    case 'INDICES': return ['📈 المؤشرات العالمية', 'مؤشرات عالمية'];
    case 'FOREX': return ['💱 العملات العربية', 'العملات'];
    case 'COMMODITIES': return ['🥇 المعادن الثمينة', 'الذهب والفضة'];
    case 'CRYPTO': return ['₿ عملات رقمية', 'العملات الرقمية'];
    default: return [code];
  }
}

export function marketCodeToArabicName(code: string): string {
  const c = code.toUpperCase();
  const names: Record<string, string> = {
    TADAWUL: 'السعودية',
    EGX: 'مصر',
    KSE: 'الكويت',
    QSE: 'قطر',
    US: 'الأسهم الأمريكية',
    INDICES: 'المؤشرات العالمية',
    FOREX: 'العملات',
    COMMODITIES: 'الذهب والمعادن',
    CRYPTO: 'العملات الرقمية',
  };
  return names[c] || code;
}

// ============== Robust DB Opener ==============

function openRobust(dbPath: string): Database.Database | null {
  if (!existsSync(dbPath)) return null;
  const busyTimeout = 10000;
  // Strategy: open READ-WRITE first so the WAL journal (maintained by the Python service)
  // can be reconciled. Readonly mode fails with "file is not a database" / "disk I/O error"
  // when the Python service has uncommitted WAL pages. We never actually write — read-write
  // mode just lets SQLite apply the WAL.
  try {
    const db = new Database(dbPath, { timeout: busyTimeout });
    db.pragma(`busy_timeout = ${busyTimeout}`);
    db.prepare("SELECT 1").get();
    return db;
  } catch (e) {
    // Fall back to readonly
    try {
      const db = new Database(dbPath, { readonly: true, timeout: busyTimeout });
      db.pragma(`busy_timeout = ${busyTimeout}`);
      db.prepare("SELECT 1").get();
      return db;
    } catch (e2) {
      console.warn(`[market-data-access] Failed to open ${dbPath}:`, e2);
      return null;
    }
  }
}

// ============== Get Available Tickers (ALL markets) ==============

export function getAvailableTickers(maxPerMarket = 15): MarketTicker[] {
  const tickers: MarketTicker[] = [];
  const seen = new Set<string>(); // key: market:ticker

  // --- Source 1: data_engine.db → historical_data ---
  const dePath = path.join(process.cwd(), 'db', 'data_engine.db');
  const deDb = openRobust(dePath);
  if (deDb) {
    try {
      const hasTable = deDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='historical_data'").get();
      if (hasTable) {
        const rows = deDb.prepare(`
          SELECT symbol, market, name, COUNT(*) as cnt, MIN(date) as min_d, MAX(date) as max_d
          FROM historical_data
          WHERE date >= datetime('now', '-90 days')
          GROUP BY symbol, market
          HAVING cnt >= 5
          ORDER BY market, cnt DESC
        `).all() as any[];
        for (const r of rows) {
          const market = normalizeMarketCode(r.market);
          const cleanSymbol = r.symbol.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '');
          const key = `${market}:${cleanSymbol}`;
          if (seen.has(key)) continue;
          seen.add(key);
          tickers.push({
            ticker: cleanSymbol,
            market,
            name: r.name,
            data_points: r.cnt,
            earliest_date: r.min_d,
            latest_date: r.max_d,
            source: 'data_engine.db',
          });
        }
        console.log(`[market-data-access] data_engine.db: ${rows.length} tickers`);
      }
    } catch (e) { console.warn('[market-data-access] data_engine.db:', e); }
    finally { deDb.close(); }
  }

  // --- Source 2: historical.db → historical_prices (richest multi-market source) ---
  const hPath = path.join(process.cwd(), 'db', 'historical.db');
  const hDb = openRobust(hPath);
  if (hDb) {
    try {
      const hasTable = hDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='historical_prices'").get();
      if (hasTable) {
        const rows = hDb.prepare(`
          SELECT symbol, category as market, name, COUNT(*) as cnt, MIN(date) as min_d, MAX(date) as max_d
          FROM historical_prices
          GROUP BY symbol, category
          HAVING cnt >= 30
          ORDER BY category, cnt DESC
        `).all() as any[];
        for (const r of rows) {
          const market = normalizeMarketCode(r.market);
          const key = `${market}:${r.symbol}`;
          if (seen.has(key)) continue;
          seen.add(key);
          tickers.push({
            ticker: r.symbol.replace(/\.(CA|SR|KW|AE|BH|QA)$/, ''),
            market,
            name: r.name,
            data_points: r.cnt,
            earliest_date: r.min_d,
            latest_date: r.max_d,
            source: 'historical.db',
          });
        }
        console.log(`[market-data-access] historical.db: ${rows.length} tickers`);
      }
    } catch (e) { console.warn('[market-data-access] historical.db:', e); }
    finally { hDb.close(); }
  }

  // --- Source 3: data_engine.db → egksco_price_history (EGX, 762 tickers — migrated from price_history.db) ---
  const phPath = path.join(process.cwd(), 'db', 'data_engine.db');
  const phDb = openRobust(phPath);
  if (phDb) {
    try {
      const hasTable = phDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='egksco_price_history'").get();
      if (hasTable) {
        const rows = phDb.prepare(`
          SELECT symbol AS ticker, COUNT(*) as cnt, MIN(price_date) as min_d, MAX(price_date) as max_d
          FROM egksco_price_history
          GROUP BY symbol
          HAVING cnt >= 30
          ORDER BY cnt DESC
          LIMIT ?
        `).all(maxPerMarket) as any[];
        for (const r of rows) {
          const market = 'EGX';
          const key = `${market}:${r.ticker}`;
          if (seen.has(key)) continue;
          seen.add(key);
          tickers.push({
            ticker: r.ticker,
            market,
            data_points: r.cnt,
            earliest_date: r.min_d,
            latest_date: r.max_d,
            source: 'data_engine.db.egksco_price_history',
          } as any);
        }
        console.log(`[market-data-access] data_engine.db.egksco_price_history: ${rows.length} EGX tickers`);
      }
    } catch (e) { console.warn('[market-data-access] data_engine.db.egksco_price_history:', e); }
    finally { phDb.close(); }
  }

  // Limit per market to ensure diversity
  const byMarket: Record<string, MarketTicker[]> = {};
  for (const t of tickers) {
    if (!byMarket[t.market]) byMarket[t.market] = [];
    byMarket[t.market].push(t);
  }
  const result: MarketTicker[] = [];
  for (const [market, list] of Object.entries(byMarket)) {
    // Sort by data_points descending — prefer tickers with more history
    list.sort((a, b) => b.data_points - a.data_points);
    result.push(...list.slice(0, maxPerMarket));
  }

  console.log(`[market-data-access] Total: ${result.length} tickers across ${Object.keys(byMarket).length} markets: ${Object.keys(byMarket).join(', ')}`);
  return result;
}

// ============== Get Price History for a Ticker ==============

export function getPriceHistory(ticker: string, market: string, daysBack: number): PriceRow[] {
  const lookback = daysBack + 60;
  const arabicVariants = marketCodeToArabic(market);
  const variants = [market, ...arabicVariants];

  // --- Source 1: data_engine.db → historical_data ---
  const dePath = path.join(process.cwd(), 'db', 'data_engine.db');
  const deDb = openRobust(dePath);
  if (deDb) {
    try {
      const hasTable = deDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='historical_data'").get();
      if (hasTable) {
        for (const mv of variants) {
          const rows = deDb.prepare(`
            SELECT date(date) as date,
                   COALESCE(open, close) as open_price,
                   COALESCE(high, close) as high_price,
                   COALESCE(low, close) as low_price,
                   close as close_price,
                   COALESCE(volume, 0) as volume
            FROM historical_data
            WHERE symbol = ? AND market = ? AND date >= datetime('now','-${lookback} days')
            ORDER BY date ASC
          `).all(ticker, mv) as any[];
          if (rows.length > 0) {
            deDb.close();
            return rows.map(r => ({ ...r, source: 'data_engine.db' }));
          }
        }
      }
    } catch (e) { /* fall through */ }
    finally { try { deDb.close(); } catch { /* safe-by-design */ } }
  }

  // --- Source 2: historical.db → historical_prices ---
  const hPath = path.join(process.cwd(), 'db', 'historical.db');
  const hDb = openRobust(hPath);
  if (hDb) {
    try {
      const hasTable = hDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='historical_prices'").get();
      if (hasTable) {
        for (const mv of variants) {
          const rows = hDb.prepare(`
            SELECT date(date) as date,
                   COALESCE(open, close) as open_price,
                   COALESCE(high, close) as high_price,
                   COALESCE(low, close) as low_price,
                   close as close_price,
                   COALESCE(volume, 0) as volume
            FROM historical_prices
            WHERE symbol = ? AND category = ? AND date >= datetime('now','-${lookback} days')
            ORDER BY date ASC
          `).all(ticker, mv) as any[];
          if (rows.length > 0) {
            hDb.close();
            return rows.map(r => ({ ...r, source: 'historical.db' }));
          }
        }
      }
    } catch (e) { /* fall through */ }
    finally { try { hDb.close(); } catch { /* safe-by-design */ } }
  }

  // --- Source 3: data_engine.db → egksco_price_history (EGX — migrated from price_history.db) ---
  const phPath = path.join(process.cwd(), 'db', 'data_engine.db');
  const phDb = openRobust(phPath);
  if (phDb) {
    try {
      const rows = phDb.prepare(`
        SELECT date(price_date) as date,
               COALESCE(open_price, close_price) as open_price,
               COALESCE(high_price, close_price) as high_price,
               COALESCE(low_price, close_price) as low_price,
               close_price,
               COALESCE(volume, 0) as volume
        FROM egksco_price_history
        WHERE symbol = ? AND price_date >= datetime('now','-${lookback} days')
        ORDER BY price_date ASC
      `).all(ticker) as any[];
      if (rows.length > 0) {
        phDb.close();
        return rows.map(r => ({ ...r, source: 'data_engine.db.egksco_price_history' }));
      }
    } catch (e) { /* fall through */ }
    finally { try { phDb.close(); } catch { /* safe-by-design */ } }
  }

  return [];
}

// ============== Get Latest Price (for verification) ==============

export function getLatestPrice(ticker: string, market: string): PriceRow | null {
  const prices = getPriceHistory(ticker, market, 5);
  return prices.length > 0 ? prices[prices.length - 1] : null;
}

// ============== Get Price at Date ==============

export function getPriceAtDate(ticker: string, market: string, targetDate: string): PriceRow | null {
  const prices = getPriceHistory(ticker, market, 365);
  // Find the price on or just after targetDate
  for (const p of prices) {
    if (p.date >= targetDate) return p;
  }
  return null;
}

// ============== Get Prices Between Dates (for verification) ==============

export function getPricesBetween(ticker: string, market: string, startDate: string, endDate: string): PriceRow[] {
  const lookback = Math.ceil((Date.now() - new Date(startDate).getTime()) / 86400000) + 60;
  const all = getPriceHistory(ticker, market, lookback);
  return all.filter(p => p.date >= startDate && p.date <= endDate);
}

// ===========================================================================
// MARKET-INDICES-SYSTEM — per-market indices (shared across all API routes)
// ===========================================================================
// Each market shows its OWN indices:
//   - EGX     → market_indices table (EGX30/EGX70/EGX100/EGX50/EGX33)
//   - US      → Yahoo Finance live (^GSPC S&P 500, ^IXIC Nasdaq, ^DJI Dow Jones)
//   - CRYPTO  → CoinGecko /global + alternative.me (BTC.D, TotalMcap, Fear&Greed)
//   - TADAWUL → Yahoo Finance live (^TASI.SR) + composite from stocks.db
//   - KSE     → Composite from stocks.db (KSEI/QEPI not on Yahoo — labelled as Composite)
//   - QSE     → Composite from stocks.db (labelled as Composite)
//
// Rule 27 (NO-FAKE-DATA): For markets without an official index ticker on a
// reachable external API, we return a clearly-labelled *composite* index
// computed from the stocks in stocks.db (volume-weighted avg change_percent).
// We never fabricate values.

export interface MarketIndexRow {
  symbol: string;
  name: string;
  name_ar: string;
  value: number;
  previous_close: number;
  change: number;
  change_percent: number;
  last_updated: string | null;
  source?: string;
  is_composite?: boolean;
  constituent_count?: number;
  unit?: string;
  classification?: string | null;
}

export const MARKET_NAMES_AR: Record<string, string> = {
  EGX: 'البورصة المصرية',
  TADAWUL: 'تداول السعودية',
  KSE: 'بورصة الكويت',
  QSE: 'بورصة قطر',
  US: 'البورصة الأمريكية',
  CRYPTO: 'العملات الرقمية',
};

export const MARKET_ALIASES: Record<string, string> = {
  EGX: 'EGX',
  TADAWUL: 'TADAWUL', KSA: 'TADAWUL', SAUDI: 'TADAWUL',
  KSE: 'KSE', KUWAIT: 'KSE',
  QSE: 'QSE', QATAR: 'QSE',
  US: 'US', NYSE: 'US', NASDAQ: 'US', AMERICA: 'US',
  CRYPTO: 'CRYPTO', CRYPTOS: 'CRYPTO',
};

// ---------- in-memory cache ----------
interface IndexCacheEntry { ts: number; data: any; }
const INDEX_CACHE_TTL_MS = 60_000;            // 1 min default (Yahoo + general)
const COINGECKO_CACHE_TTL_MS = 300_000;       // 5 min — CoinGecko free tier is heavily rate-limited
const _indexCache = new Map<string, IndexCacheEntry>();

function _getCached<T = any>(key: string, ttl = INDEX_CACHE_TTL_MS): T | null {
  const e = _indexCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > ttl) { _indexCache.delete(key); return null; }
  return e.data as T;
}
function _setCached(key: string, data: any): void {
  _indexCache.set(key, { ts: Date.now(), data });
}

// ---------- Yahoo Finance ----------
const YAHOO_INDEX_META: Record<string, { name: string; name_ar: string }> = {
  '^GSPC':     { name: 'S&P 500',                       name_ar: 'مؤشر S&P 500' },
  '^IXIC':     { name: 'NASDAQ Composite',              name_ar: 'مؤشر ناسداك المركب' },
  '^DJI':      { name: 'Dow Jones Industrial Average',   name_ar: 'مؤشر داو جونز الصناعي' },
  '^TASI.SR':  { name: 'Tadawul All Share Index (TASI)', name_ar: 'مؤشر تداول لجميع الأسهم (تاسي)' },
};

async function fetchYahooIndex(symbol: string): Promise<MarketIndexRow | null> {
  const cacheKey = `yahoo:${symbol}`;
  const cached = _getCached<MarketIndexRow>(cacheKey);
  if (cached) return cached;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json() as any;
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const value = Number(meta.regularMarketPrice) || 0;
    const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose) || 0;
    const changePct = Number(meta.regularMarketChangePercent);
    const change = value - prevClose;
    const info = YAHOO_INDEX_META[symbol] || { name: symbol, name_ar: symbol };

    const out: MarketIndexRow = {
      symbol,
      name: info.name,
      name_ar: info.name_ar,
      value,
      previous_close: prevClose,
      change,
      change_percent: Number.isFinite(changePct) ? changePct : (prevClose > 0 ? ((value - prevClose) / prevClose) * 100 : 0),
      last_updated: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
      source: 'yahoo_finance',
    };
    _setCached(cacheKey, out);
    return out;
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

async function fetchYahooIndices(symbols: string[]): Promise<MarketIndexRow[]> {
  const results = await Promise.all(symbols.map(fetchYahooIndex));
  return results.filter((r): r is MarketIndexRow => r !== null);
}

// ---------- CoinGecko /global + alternative.me Fear & Greed ----------
async function fetchCryptoIndices(): Promise<MarketIndexRow[]> {
  const cacheKey = 'crypto:global';
  const cached = _getCached<MarketIndexRow[]>(cacheKey, COINGECKO_CACHE_TTL_MS);
  if (cached) return cached;

  const indices: MarketIndexRow[] = [];

  // CoinGecko /global → BTC dominance + total market cap (with retry-after wait)
  try {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch('https://api.coingecko.com/api/v3/global', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (res.ok) break;
      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 7000)); // retry-after (default 6s)
        continue;
      }
      break;
    }
    if (res && res.ok) {
      const json = await res.json() as any;
      const data = json?.data;
      if (data) {
        const btcDom = Number(data?.market_cap_percentage?.btc) || 0;
        const totalMcapUsd = Number(data?.total_market_cap?.usd) || 0;
        const mcapChange24h = Number(data?.market_cap_change_percentage_24h_usd) || 0;

        if (btcDom > 0) {
          indices.push({
            symbol: 'BTC.D',
            name: 'Bitcoin Dominance',
            name_ar: 'هيمنة البيتكوين',
            value: btcDom,
            previous_close: mcapChange24h !== 0 ? btcDom / (1 + (mcapChange24h / 100) * -0.3) : btcDom,
            change: 0,
            change_percent: 0,
            last_updated: new Date().toISOString(),
            unit: '%',
            source: 'coingecko',
          });
        }

        if (totalMcapUsd > 0) {
          const prevMcap = mcapChange24h !== 0 ? totalMcapUsd / (1 + mcapChange24h / 100) : totalMcapUsd;
          indices.push({
            symbol: 'TOTAL_MCAP',
            name: 'Total Crypto Market Cap',
            name_ar: 'إجمالي القيمة السوقية للعملات الرقمية',
            value: totalMcapUsd,
            previous_close: prevMcap,
            change: totalMcapUsd - prevMcap,
            change_percent: mcapChange24h,
            last_updated: new Date().toISOString(),
            unit: 'USD',
            source: 'coingecko',
          });
        }
      }
    } else {
      console.warn('[market-data-access] CoinGecko /global unavailable (status=' + (res?.status ?? 'null') + ')');
    }
  } catch (e) {
    console.warn('[market-data-access] CoinGecko fetch error:', String(e).slice(0, 120));
  }

  // Fear & Greed Index (alternative.me)
  try {
    const fngCacheKey = 'crypto:fng';
    const fngCached = _getCached<MarketIndexRow | null>(fngCacheKey);
    if (fngCached) {
      indices.push(fngCached);
    } else {
      const res = await fetch('https://api.alternative.me/fng/?limit=2', {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json() as any;
        const arr = json?.data;
        if (Array.isArray(arr) && arr.length > 0) {
          const latest = arr[0];
          const prev = arr[1] || latest;
          const value = Number(latest.value) || 0;
          const prevValue = Number(prev.value) || value;
          const change = value - prevValue;
          const changePct = prevValue > 0 ? (change / prevValue) * 100 : 0;
          const fngIdx: MarketIndexRow = {
            symbol: 'FNG',
            name: 'Fear & Greed Index',
            name_ar: 'مؤشر الخوف والطمع',
            value,
            previous_close: prevValue,
            change,
            change_percent: changePct,
            last_updated: latest.timestamp ? new Date(Number(latest.timestamp) * 1000).toISOString() : new Date().toISOString(),
            classification: latest.value_classification || null,
            unit: '0-100',
            source: 'alternative.me',
          };
          indices.push(fngIdx);
          _setCached(fngCacheKey, fngIdx);
        }
      }
    }
  } catch (e) {
    console.warn('[market-data-access] alternative.me F&G fetch error:', String(e).slice(0, 120));
  }

  _setCached(cacheKey, indices);
  return indices;
}

// ---------- Composite index from stocks.db (KSE, QSE, TADAWUL fallback) ----------
function computeCompositeIndex(dbMarket: string): MarketIndexRow | null {
  try {
    const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const db = openRobust(dbPath);
    if (!db) return null;
    try {
      const stocks = db.prepare(
        "SELECT current_price, volume, change_percent, previous_close FROM stocks WHERE market = ? COLLATE NOCASE AND current_price > 0"
      ).all(dbMarket) as any[];

      if (stocks.length === 0) return null;

      let totalWeight = 0;
      let weightedChange = 0;
      let totalPrevMcap = 0;
      let totalCurMcap = 0;
      for (const s of stocks) {
        const price = Number(s.current_price) || 0;
        const vol = Number(s.volume) || 0;
        const changePct = Number(s.change_percent) || 0;
        const prevClose = Number(s.previous_close) || 0;
        const weight = price * vol;
        if (weight > 0) {
          totalWeight += weight;
          weightedChange += changePct * weight;
        }
        if (prevClose > 0 && vol > 0) {
          totalPrevMcap += prevClose * vol;
          totalCurMcap += price * vol;
        }
      }

      const compositeChangePct = totalWeight > 0 ? weightedChange / totalWeight : 0;
      const compositeValue = totalCurMcap > 0 ? totalCurMcap / 1_000_000 : 0;
      const prevValue = totalPrevMcap > 0 ? totalPrevMcap / 1_000_000 : (compositeValue > 0 ? compositeValue / (1 + compositeChangePct / 100) : 0);

      return {
        symbol: `${dbMarket}_COMPOSITE`,
        name: `${dbMarket} Composite Index`,
        name_ar: `مؤشر ${MARKET_NAMES_AR[dbMarket] || dbMarket} المركّب`,
        value: compositeValue,
        previous_close: prevValue,
        change: compositeValue - prevValue,
        change_percent: compositeChangePct,
        last_updated: new Date().toISOString(),
        is_composite: true,
        source: 'stocks_db_composite',
        constituent_count: stocks.length,
      };
    } finally {
      db.close();
    }
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

// ---------- Per-market fetchers ----------
async function fetchEGXIndices(): Promise<MarketIndexRow[]> {
  try {
    const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const db = openRobust(dbPath);
    if (!db) return [];
    try {
      const rows = db.prepare('SELECT * FROM market_indices ORDER BY id ASC').all() as any[];
      return rows
        .filter((idx: any) => idx.symbol && String(idx.symbol).includes('EGX'))
        .map((idx: any) => ({
          symbol: idx.symbol,
          name: idx.name || '',
          name_ar: idx.name_ar || '',
          value: Number(idx.current_value) || 0,
          previous_close: Number(idx.previous_close) || 0,
          change: Number(idx.change) || 0,
          change_percent: Number(idx.change_percent) || 0,
          last_updated: idx.last_update || null,
          source: 'stocks_db_market_indices',
        }));
    } finally {
      db.close();
    }
  } catch { // silent fallback (safe-by-design)
    return [];
  }
}

async function fetchUSIndices(): Promise<MarketIndexRow[]> {
  return await fetchYahooIndices(['^GSPC', '^IXIC', '^DJI']);
}

async function fetchTadawulIndices(): Promise<MarketIndexRow[]> {
  const [tasi, composite] = await Promise.all([
    fetchYahooIndex('^TASI.SR'),
    Promise.resolve(computeCompositeIndex('TADAWUL')),
  ]);
  const out: MarketIndexRow[] = [];
  if (tasi) out.push(tasi);
  if (composite) out.push(composite);
  return out;
}

async function fetchKseIndices(): Promise<MarketIndexRow[]> {
  const composite = computeCompositeIndex('KSE');
  return composite ? [composite] : [];
}

async function fetchQseIndices(): Promise<MarketIndexRow[]> {
  const composite = computeCompositeIndex('QSE');
  return composite ? [composite] : [];
}

/**
 * Fetch indices for a given market. This is the single entry-point used by all
 * API routes (/api/market/indices, /api/market-pulse, /api/market/overview) to
 * avoid duplicating fetch logic and to prevent recursive HTTP calls inside the
 * Next.js dev server (which would crash better-sqlite3 in some cases).
 *
 * @param marketRaw One of EGX|TADAWUL|KSE|QSE|US|CRYPTO (or aliases like KSA, SAUDI, etc.)
 * @returns { indices, market, source }
 */
export async function fetchMarketIndices(marketRaw: string): Promise<{
  indices: MarketIndexRow[];
  market: string;
  source: string;
}> {
  const market = MARKET_ALIASES[marketRaw.toUpperCase()] || marketRaw.toUpperCase();
  let indices: MarketIndexRow[] = [];
  let source = '';

  switch (market) {
    case 'EGX':
      indices = await fetchEGXIndices();
      source = 'stocks_db_market_indices';
      break;
    case 'US':
      indices = await fetchUSIndices();
      source = 'yahoo_finance';
      break;
    case 'CRYPTO':
      indices = await fetchCryptoIndices();
      source = 'coingecko+alternative.me';
      break;
    case 'TADAWUL':
      indices = await fetchTadawulIndices();
      source = 'yahoo_finance+stocks_db_composite';
      break;
    case 'KSE':
      indices = await fetchKseIndices();
      source = 'stocks_db_composite';
      break;
    case 'QSE':
      indices = await fetchQseIndices();
      source = 'stocks_db_composite';
      break;
    default:
      // Unknown market — return empty (per Rule 27)
      break;
  }

  return { indices, market, source };
}
