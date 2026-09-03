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
    finally { try { deDb.close(); } catch {} }
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
    finally { try { hDb.close(); } catch {} }
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
    finally { try { phDb.close(); } catch {} }
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
