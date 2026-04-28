/**
 * seed-historical-data.ts
 *
 * Generates ~90 trading days of realistic OHLCV historical price data for each
 * stock found in db/investing_egx_snapshot.json and inserts them into the
 * stock_price_history table of egx_investment.db.
 *
 * Model: geometric Brownian motion (random walk) calibrated per-stock.
 *
 * Usage (standalone):
 *   npx tsx src/lib/seed-historical-data.ts
 *
 * Usage (API route):
 *   import { seedHistoricalData } from '@/lib/seed-historical-data';
 *   const result = await seedHistoricalData();
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createDatabase, initialize } from './sqlite-wrapper';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InvestingStock {
  symbol: string;
  name: string;
  lastPrice: number;
  peRatio: number | null;
  marketCap: number | null;
  changeOneMonth: number | null;
  changeOneYear: number | null;
  volumeThreeMonths: number | null;
  beta: number | null;
}

interface SeedResult {
  stocks_processed: number;
  total_rows_inserted: number;
  total_rows_skipped: number;
  errors: string[];
  stocks_updated_in_custom: number;
}

// ---------------------------------------------------------------------------
// Seeded PRNG (Mulberry32)
// ---------------------------------------------------------------------------

function hashTicker(ticker: string): number {
  let h = 0;
  for (let i = 0; i < ticker.length; i++) {
    h = (Math.imul(31, h) + ticker.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller transform for normal distribution
function normalRandom(rng: () => number): number {
  const u1 = Math.max(1e-10, rng());
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

// ---------------------------------------------------------------------------
// Date helpers (EGX trading calendar: Sun-Thu, skip Fri/Sat)
// ---------------------------------------------------------------------------

/** Returns true if d is a trading day (Sun–Thu in Egypt). */
function isTradingDay(d: Date): boolean {
  const day = d.getDay(); // 0=Sun, 5=Fri, 6=Sat
  return day !== 5 && day !== 6; // Skip Friday and Saturday
}

/** Get the previous trading day. */
function prevTradingDay(d: Date): Date {
  const p = new Date(d);
  p.setDate(p.getDate() - 1);
  while (!isTradingDay(p)) {
    p.setDate(p.getDate() - 1);
  }
  return p;
}

/** Format date as YYYY-MM-DD. */
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Generate price history for one stock
// ---------------------------------------------------------------------------

interface OHLCVRow {
  date: string;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
  adjusted_close: number;
}

function generateStockHistory(
  stock: InvestingStock,
  tradingDays: number = 365
): OHLCVRow[] {
  const rng = mulberry32(hashTicker(stock.symbol));

  const currentPrice = stock.lastPrice;
  const beta = stock.beta ?? 0.5;
  const changeOneMonth = stock.changeOneMonth ?? 0;
  const volumeThreeMonths = stock.volumeThreeMonths ?? 1_000_000;

  // Calibrate model
  const dailyVol = 0.015 + Math.abs(beta) * 0.01;
  // Daily drift over the last 30 trading days matches changeOneMonth
  const recentDrift = changeOneMonth / 100 / 30;
  // For older days, use gradually decreasing drift with more randomness
  const midDrift = recentDrift * 0.7;
  const olderDrift = recentDrift * 0.4;

  // Start price: work backwards from current price over 30 trading days
  const startPrice = currentPrice / (1 + changeOneMonth / 100);

  // Base daily volume
  const baseVolume = Math.max(100, Math.round(volumeThreeMonths / 90));

  // Generate prices going backwards (oldest to newest)
  // We'll generate from startPrice forward for 90 days
  const rows: OHLCVRow[] = [];

  // Start date: go back ~130 calendar days to get ~90 trading days
  const today = new Date();
  // Find today or most recent trading day
  let endDate = new Date(today);
  if (!isTradingDay(endDate)) {
    endDate = prevTradingDay(endDate);
  }

  // Generate all trading day dates backwards
  const dates: string[] = [];
  const dateObjs: Date[] = [];
  let cursor = new Date(endDate);
  for (let i = 0; i < tradingDays; i++) {
    dates.unshift(fmtDate(cursor));
    dateObjs.unshift(new Date(cursor));
    cursor = prevTradingDay(cursor);
  }

  // Generate prices from startPrice using GBM
  let prevClose = startPrice;

  for (let i = 0; i < tradingDays; i++) {
    // Use different drift regimes for different periods
    const isRecent = i >= tradingDays - 30;  // Last 30 days: match recent performance
    const isMid = i >= tradingDays - 120 && i < tradingDays - 30;  // 30-120 days ago: medium drift
    const isOld = i < tradingDays - 120;  // Beyond 120 days: lower drift

    let mu: number;
    if (isRecent) {
      mu = recentDrift;
    } else if (isMid) {
      mu = midDrift;
    } else {
      mu = olderDrift;
    }

    // Add drift noise for older periods to create realistic variation
    const muNoise = isRecent ? 0 : (rng() - 0.5) * 0.004;
    const effectiveMu = mu + muNoise;

    // Increase volatility slightly for older data (less certain)
    const volMultiplier = isOld ? 1.15 : isMid ? 1.05 : 1.0;

    // GBM step: S(t+1) = S(t) * exp((mu - sigma^2/2) + sigma * Z)
    const z = normalRandom(rng);
    const sigma = dailyVol * volMultiplier;
    const logReturn = (effectiveMu - (sigma * sigma) / 2) + sigma * z;
    const closePrice = Math.max(0.01, prevClose * Math.exp(logReturn));

    // Open: near previous close with small gap
    const openGap = 1 + (rng() - 0.5) * 0.01; // ±0.5% gap
    const openPrice = Math.max(0.01, prevClose * openGap);

    // High/Low — slightly wider range for older data
    const dayHigh = Math.max(openPrice, closePrice);
    const dayLow = Math.min(openPrice, closePrice);
    const rangeMultiplier = isOld ? 1.3 : isMid ? 1.15 : 1.0;
    const highPrice = dayHigh * (1 + rng() * 0.02 * rangeMultiplier);
    const lowPrice = dayLow * (1 - rng() * 0.02 * rangeMultiplier);

    // Volume: base with ±30% daily variation
    const volumeFactor = 0.7 + rng() * 0.6; // 0.7 to 1.3
    const volume = Math.round(baseVolume * volumeFactor);

    rows.push({
      date: dates[i],
      open_price: Math.round(openPrice * 1000) / 1000,
      high_price: Math.round(highPrice * 1000) / 1000,
      low_price: Math.round(Math.max(0.01, lowPrice) * 1000) / 1000,
      close_price: Math.round(closePrice * 1000) / 1000,
      volume,
      adjusted_close: Math.round(closePrice * 1000) / 1000,
    });

    prevClose = closePrice;
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Global flag لمنع التشغيل المتزامن للبذرة (idempotent seeding)
// ---------------------------------------------------------------------------

let _isSeeding = false;
let _seededSuccessfully = false; // ← تم البذر مسبقاً بنجاح

// ---------------------------------------------------------------------------
// Main seeding function
// ---------------------------------------------------------------------------

export async function seedHistoricalData(): Promise<SeedResult> {
  const startTime = Date.now();

  // Initialize sql.js
  await initialize();

  // 1. Read snapshot data (investing_egx_snapshot.json)
  const snapshotPath = join(process.cwd(), 'db', 'investing_egx_snapshot.json');
  const snapshotMap = new Map<string, InvestingStock>();

  if (existsSync(snapshotPath)) {
    try {
      const snapshotRaw = readFileSync(snapshotPath, 'utf-8');
      const snapshot = JSON.parse(snapshotRaw);
      const snapshotStocks: InvestingStock[] = snapshot.stocks || [];
      for (const s of snapshotStocks) {
        snapshotMap.set(s.symbol.toUpperCase(), s);
      }
      console.log(`[seed-historical] Loaded ${snapshotStocks.length} stocks from snapshot`);
    } catch (err) {
      console.warn('[seed-historical] Failed to read snapshot file:', err);
    }
  }

  // 2. Open light DB to get ALL stocks with current prices
  const lightDbPath = join(process.cwd(), 'db', 'custom.db');
  const lightDb = createDatabase(lightDbPath);
  lightDb.pragma('journal_mode = WAL');
  lightDb.pragma('foreign_keys = ON');

  const allStockRows = lightDb.prepare(
    'SELECT id, ticker, current_price, previous_close, volume FROM stocks WHERE is_active = 1 AND current_price > 0'
  ).all() as Array<{ id: number; ticker: string; current_price: number; previous_close: number; volume: number }>;

  // 3. Build merged stock list: snapshot data enriched with light DB data, plus light DB-only stocks
  const stocks: InvestingStock[] = [];
  for (const row of allStockRows) {
    const snap = snapshotMap.get(row.ticker.toUpperCase());
    if (snap) {
      // Use snapshot data (has beta, marketCap, etc.) but ensure currentPrice is from DB
      stocks.push({
        ...snap,
        symbol: row.ticker,
        lastPrice: row.current_price,
        volumeThreeMonths: snap.volumeThreeMonths || row.volume * 60,
        changeOneMonth: snap.changeOneMonth ?? (row.previous_close > 0
          ? ((row.current_price - row.previous_close) / row.previous_close) * 100 * 20 // approximate
          : 0),
      });
    } else {
      // Stock not in snapshot — create synthetic data from light DB
      const priceChange = row.previous_close > 0
        ? ((row.current_price - row.previous_close) / row.previous_close) * 100
        : 0;
      stocks.push({
        symbol: row.ticker,
        name: '',
        lastPrice: row.current_price,
        peRatio: null,
        marketCap: null,
        changeOneMonth: priceChange * 20, // approximate monthly change
        changeOneYear: priceChange * 200,
        volumeThreeMonths: row.volume * 60,
        beta: 0.5 + Math.random() * 0.5,
        instrumentId: '',
        exchangeId: '',
      });
    }
  }

  lightDb.close();

  if (stocks.length === 0) {
    return {
      stocks_processed: 0,
      total_rows_inserted: 0,
      total_rows_skipped: 0,
      errors: ['No stocks found in database'],
      stocks_updated_in_custom: 0,
    };
  }

  console.log(`[seed-historical] Found ${stocks.length} stocks to process (${snapshotMap.size} from snapshot, ${stocks.length - snapshotMap.size} from DB)`);

  // Open writable heavy DB
  const heavyDbPath = join(process.cwd(), 'db', 'egx_investment.db');
  const heavyDb = createDatabase(heavyDbPath);
  heavyDb.pragma('journal_mode = WAL');
  heavyDb.pragma('foreign_keys = ON');

  // إنشاء جدول stock_price_history إذا لم يكن موجوداً
  heavyDb.prepare(`
    CREATE TABLE IF NOT EXISTS stock_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      open_price REAL DEFAULT 0,
      high_price REAL DEFAULT 0,
      low_price REAL DEFAULT 0,
      close_price REAL DEFAULT 0,
      volume INTEGER DEFAULT 0,
      adjusted_close REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(stock_id, date)
    )
  `).run();

  // إنشاء الفهرس إذا لم يكن موجوداً
  try {
    heavyDb.prepare(`
      CREATE INDEX IF NOT EXISTS idx_sph_stock_date ON stock_price_history(stock_id, date)
    `).run();
  } catch {
    // الفهرس قد يكون موجوداً مسبقاً — تجاهل الخطأ
  }

  console.log('[seed-historical] Ensured stock_price_history table exists');

  // Re-open writable light DB for stock price updates
  const writableLightDbPath = join(process.cwd(), 'db', 'custom.db');
  const writableLightDb = createDatabase(writableLightDbPath);
  writableLightDb.pragma('journal_mode = WAL');
  writableLightDb.pragma('foreign_keys = ON');

  const result: SeedResult = {
    stocks_processed: 0,
    total_rows_inserted: 0,
    total_rows_skipped: 0,
    errors: [],
    stocks_updated_in_custom: 0,
  };

  for (const stock of stocks) {
    const ticker = stock.symbol;
    try {
      // Look up stock_id in custom.db (fresh statement each time)
      const stockRow = writableLightDb.prepare(
        'SELECT id, ticker FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1'
      ).get(ticker) as { id: number; ticker: string } | undefined;

      if (!stockRow) {
        console.warn(`[seed-historical] Stock not found in custom.db: ${ticker}`);
        result.errors.push(`Stock not found in DB: ${ticker}`);
        continue;
      }

      const stockId = stockRow.id;

      // Check if we already have data for this stock
      const existingCount = heavyDb.prepare(
        'SELECT COUNT(*) as cnt FROM stock_price_history WHERE stock_id = ?'
      ).get(stockId) as { cnt: number };

      if (existingCount && existingCount.cnt >= 350) {
        console.log(
          `[seed-historical] Skipping ${ticker} (stock_id=${stockId}) — already has ${existingCount.cnt} rows`
        );
        result.total_rows_skipped += existingCount.cnt;
        result.stocks_processed++;
        continue;
      }

      // Generate historical data (365 trading days ≈ 1.5 calendar years)
      const history = generateStockHistory(stock, 365);

      // Prepare a fresh insert statement for this batch
      // (the wrapper's saveToDisk after transaction can invalidate statements)
      const insertStmt = heavyDb.prepare(`
        INSERT OR REPLACE INTO stock_price_history
          (stock_id, date, open_price, high_price, low_price, close_price, volume, adjusted_close, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      // Batch insert using transaction
      const insertMany = heavyDb.transaction(() => {
        let inserted = 0;
        for (const row of history) {
          try {
            insertStmt.run(
              stockId,
              row.date,
              row.open_price,
              row.high_price,
              row.low_price,
              row.close_price,
              row.volume,
              row.adjusted_close
            );
            inserted++;
          } catch {
            // UNIQUE constraint — skip
          }
        }
        return inserted;
      });

      const inserted = insertMany() as number;
      result.total_rows_inserted += inserted;
      result.stocks_processed++;

      // Update stock in custom.db with current price (fresh statement)
      if (stock.lastPrice != null) {
        writableLightDb.prepare(`
          UPDATE stocks SET
            current_price = ?,
            pe_ratio = ?,
            market_cap = ?,
            last_update = datetime('now')
          WHERE ticker = ? COLLATE NOCASE
        `).run(
          stock.lastPrice,
          stock.peRatio ?? null,
          stock.marketCap ?? null,
          ticker
        );
        result.stocks_updated_in_custom++;
      }

      const lastRow = history[history.length - 1];
      const firstRow = history[0];
      console.log(
        `[seed-historical] ${ticker} (id=${stockId}): ${inserted} rows, ` +
          `${firstRow.date} → ${lastRow.date}, ` +
          `price ${firstRow.open_price.toFixed(2)} → ${lastRow.close_price.toFixed(2)} ` +
          `(actual=${stock.lastPrice})`
      );
    } catch (err) {
      const msg = `Error processing ${ticker}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[seed-historical] ${msg}`);
      result.errors.push(msg);
    }
  }

  // Cleanup
  try {
    heavyDb.close();
  } catch {
    // ignore
  }
  try {
    writableLightDb.close();
  } catch {
    // ignore
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[seed-historical] Done in ${elapsed}s — ` +
      `${result.stocks_processed} stocks, ` +
      `${result.total_rows_inserted} rows inserted, ` +
      `${result.stocks_updated_in_custom} stocks updated in custom.db` +
      (result.errors.length > 0 ? `, ${result.errors.length} errors` : '')
  );

  // تم البذر بنجاح إذا تم إدراج صفوف
  if (result.total_rows_inserted > 0 || result.total_rows_skipped >= 100) {
    _seededSuccessfully = true;
  }

  return result;
}

// ---------------------------------------------------------------------------
// checkAndAutoSeed — فحص تلقائي وبذر عند الحاجة
// ---------------------------------------------------------------------------
// يفحص إذا كان الجدول فارغاً (< 100 صف) ويقوم بالبذر تلقائياً
// يستخدم علامة عامة لمنع التشغيل المتزامن
// آمن للاستدعاء المتعدد (idempotent)
// ---------------------------------------------------------------------------

export interface AutoSeedResult {
  seeded: boolean;
  rows: number;
  message?: string;
}

export async function checkAndAutoSeed(): Promise<AutoSeedResult> {
  // إذا تم البذر مسبقاً بنجاح — تخطي
  if (_seededSuccessfully) {
    return { seeded: false, rows: 0, message: 'Already seeded previously' };
  }

  // إذا كان البذر جارياً بالفعل — انتظر ثم أعد الفحص
  if (_isSeeding) {
    console.log('[auto-seed] Seed already in progress, skipping');
    return { seeded: false, rows: 0, message: 'Seed already in progress' };
  }

  try {
    // تهيئة sql.js
    await initialize();

    // فحص عدد الصفوف في stock_price_history
    const heavyDbPath = join(process.cwd(), 'db', 'egx_investment.db');
    if (!existsSync(heavyDbPath)) {
      console.warn('[auto-seed] Heavy DB file not found, cannot check rows');
      return { seeded: false, rows: 0, message: 'Heavy DB not found' };
    }

    const heavyDb = createDatabase(heavyDbPath);

    let rowCount = 0;
    try {
      // فحص وجود الجدول أولاً
      const tableExists = heavyDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='stock_price_history'"
      ).get();

      if (tableExists) {
        const row = heavyDb.prepare('SELECT COUNT(*) as cnt FROM stock_price_history').get() as { cnt: number } | undefined;
        rowCount = row?.cnt ?? 0;
      }
    } catch {
      // الجدول غير موجود — rowCount = 0
    }

    heavyDb.close();

    console.log(`[auto-seed] Current stock_price_history rows: ${rowCount}`);

    // إذا كان هناك بيانات كافية — لا داعي للبذر
    // We need data for ~295 stocks × 365 days = ~107,675 rows minimum
    // But also check distinct stock count
    if (rowCount >= 100000) {
      _seededSuccessfully = true;
      return { seeded: false, rows: rowCount, message: 'Sufficient data already exists' };
    }

    // بدء البذر
    _isSeeding = true;
    console.log('[auto-seed] Insufficient data, triggering seed...');
    const result = await seedHistoricalData();
    _isSeeding = false;

    return {
      seeded: result.total_rows_inserted > 0,
      rows: result.total_rows_inserted,
      message: result.total_rows_inserted > 0
        ? `Seeded ${result.total_rows_inserted} rows for ${result.stocks_processed} stocks`
        : `No new rows inserted (already had ${rowCount} rows)`,
    };
  } catch (err) {
    _isSeeding = false;
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[auto-seed] Error:', msg);
    return { seeded: false, rows: 0, message: `Auto-seed failed: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  seedHistoricalData()
    .then((result) => {
      console.log('\n=== Seeding Summary ===');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}
