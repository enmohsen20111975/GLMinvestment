/**
 * db-manager.ts — Unified Data Access Layer (DAL)
 * ====================================================================
 * (ALPHA-DAL — owner directive 2026-10-27):
 * «ممنوع نهائياً أي صفحة أو كومبوننت أو مسار API يمد إيده على ملف .db
 *  أو يكتب كويري SQLite مباشرة!»
 *
 * ده البوابة الوحيدة المغلقة لأي قراءة أو كاش في كامل الفرونت إند.
 * كل الـ UI routes/components لازم تستخدم DbManager مش better-sqlite3 مباشرة.
 *
 * الأولويات (per owner directive):
 *   - getLiveSparkline: stocks.db.stock_daily_prices FIRST (live)،
 *     price_history.db آخر خيار طوارئ فقط.
 *   - getIncubatorData: أحدث maker_radar_{market}_*.json + فلترة الأسهم
 *     اللي أسعارها أقدم من جلسة اليوم.
 *   - getUnifiedLogos: كاش الأيقونات يدعم logo_url + logoUrl معاً.
 *   - getActivePredictions: توقعات نظيفة بدون تكرار للـ ticker.
 *
 * لو قررنا بكرة ننقل على PostgreSQL، التعديل هيكون في ملف واحد بس.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SparklineData {
  ticker: string;
  prices: number[];
  min: number;
  max: number;
  first: number;
  last: number;
  change_pct: number;
  days: number;
  source: string;
  /** ISO date of the most recent data point — for freshness checks. */
  latest_date?: string;
}

export interface IncubatorCandidate {
  ticker: string;
  name_ar?: string;
  current_price: number;
  readiness_pct: number;
  signals_passed: number;
  total_signals: number;
  passed_reasons?: string[];
  trigger?: {
    type?: string;
    condition_ar?: string;
    trigger_price?: number;
    distance_to_trigger_pct?: number;
  };
  target_if_promoted?: number;
  stop_loss_if_promoted?: number;
  risk_reward?: number;
  stage?: string;
  path?: string;
  /** ISO date of the price snapshot this candidate was built from. */
  data_date?: string;
}

export interface IncubatorData {
  market: string;
  total_candidates: number;
  candidates: IncubatorCandidate[];
  timestamp: string;
  /** false لو أحدث سهم فيه سعر أقدم من اليوم (radar بـ يحتاج re-run). */
  is_fresh: boolean;
}

export interface ActivePrediction {
  ticker: string;
  name_ar?: string;
  logo_url?: string | null;
  logoUrl?: string | null;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  current_price?: number;
  signal?: string;
  signal_ar?: string;
  score?: number;
  risk_reward?: number;
  prediction_date?: string;
  created_at?: string;
  analysis_methods?: string[];
}

// ─── Path helpers ───────────────────────────────────────────────────────────

const DB_DIR = path.join(process.cwd(), 'db');
const OUTPUT_DIR = path.join(process.cwd(), 'scripts', 'output');

function dbPath(name: string): string {
  return path.join(DB_DIR, name);
}

function openDb(file: string): Database.Database | null {
  const p = dbPath(file);
  if (!existsSync(p)) return null;
  try {
    const db = new Database(p, { readonly: true, timeout: 5000 });
    db.pragma('busy_timeout = 5000');
    return db;
  } catch {
    return null;
  }
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return info.some((c) => c.name === column);
  } catch {
    return false;
  }
}

// ─── Index aliases (for sparkline) ─────────────────────────────────────────

const INDEX_ALIASES: Record<string, string[]> = {
  EGX30: ['EGX30', 'EGX30ETF', '.EGX30', '^CASE30'],
  EGX70: ['EGX70', '.EGX70', 'EGX70EWI'],
  EGX100: ['EGX100', '.EGX100'],
  EGX33: ['EGX33', 'EGX33SHAR'],
  TASI: ['TASI', '^TASI', '.TASI', 'TADAWUL'],
};

function getCandidateTickers(t: string): string[] {
  const upper = t.toUpperCase().trim();
  return INDEX_ALIASES[upper] || [upper, t.trim()];
}

// ─── 1. getLiveSparkline ───────────────────────────────────────────────────
// Owner directive: «يقرأ أولاً وحصرياً من stocks.db.stock_daily_prices، وللمؤشرات
// من index_daily_prices». price_history.db = emergency fallback LAST.

const SPARKLINE_CACHE_TTL_MS = 60_000;
const sparklineCache = new Map<string, { ts: number; data: SparklineData }>();

function sparklineCacheKey(ticker: string, days: number): string {
  return `${ticker.toUpperCase()}|${days}`;
}

function getCachedSparkline(key: string): SparklineData | null {
  const hit = sparklineCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > SPARKLINE_CACHE_TTL_MS) {
    sparklineCache.delete(key);
    return null;
  }
  return hit.data;
}

function setCachedSparkline(key: string, data: SparklineData): void {
  sparklineCache.set(key, { ts: Date.now(), data });
  if (sparklineCache.size > 2000) {
    const first = sparklineCache.keys().next().value;
    if (first) sparklineCache.delete(first);
  }
}

function buildSparklineResult(
  ticker: string,
  rows: { date: string; price: number }[],
  source: string,
): SparklineData {
  const prices = rows.map((r) => Number(r.price));
  const first = prices[0] ?? 0;
  const last = prices[prices.length - 1] ?? 0;
  return {
    ticker,
    prices,
    min: prices.length ? Math.min(...prices) : 0,
    max: prices.length ? Math.max(...prices) : 0,
    first,
    last,
    change_pct: first > 0 ? ((last - first) / first) * 100 : 0,
    days: prices.length,
    source,
    latest_date: rows.length ? rows[rows.length - 1].date : undefined,
  };
}

/**
 * Fetch a live sparkline for a single ticker/index.
 *
 * Priority (per owner directive):
 *   1. stocks.db.stock_daily_prices (LIVE — التشغيل اليومي)
 *   2. stocks.db.index_daily_prices (for INDEX symbols: EGX30/TASI/etc.)
 *   3. price_history.db (EMERGENCY FALLBACK ONLY — آخر خيار طوارئ)
 *
 * Rule 27 (NO-FAKE-DATA): لو مفيش OHLCV حقيقي → empty (source: 'none').
 */
export function getLiveSparkline(ticker: string, days: number = 30): SparklineData {
  const key = sparklineCacheKey(ticker, days);
  const cached = getCachedSparkline(key);
  if (cached) return cached;

  const candidates = getCandidateTickers(ticker);
  const maxDays = Math.min(90, Math.max(7, days));

  // ─── Source 1: stocks.db.stock_daily_prices (LIVE — first priority) ───────
  const stocksDb = openDb('stocks.db');
  if (stocksDb) {
    try {
      if (columnExists(stocksDb, 'stock_daily_prices', 'close_price')) {
        for (const cand of candidates) {
          const rows = stocksDb.prepare(`
            SELECT price_date as date, close_price as price
            FROM stock_daily_prices
            WHERE ticker = ? AND close_price > 0
            ORDER BY price_date DESC
            LIMIT ?
          `).all(cand, maxDays) as { date: string; price: number }[];
          if (rows.length > 0) {
            rows.reverse();
            const result = buildSparklineResult(ticker, rows, 'stocks.db.stock_daily_prices');
            stocksDb.close();
            setCachedSparkline(key, result);
            return result;
          }
        }
      }

      // ─── Source 2: stocks.db.index_daily_prices (for INDEX symbols) ────────
      if (columnExists(stocksDb, 'index_daily_prices', 'close')) {
        for (const cand of candidates) {
          const rows = stocksDb.prepare(`
            SELECT price_date as date, close as price
            FROM index_daily_prices
            WHERE symbol = ? AND close > 0
            ORDER BY price_date DESC
            LIMIT ?
          `).all(cand, maxDays) as { date: string; price: number }[];
          if (rows.length > 0) {
            rows.reverse();
            const result = buildSparklineResult(ticker, rows, 'stocks.db.index_daily_prices');
            stocksDb.close();
            setCachedSparkline(key, result);
            return result;
          }
        }
      }
    } catch {
      // fall through to emergency fallback
    }
    stocksDb.close();
  }

  // ─── Source 3: price_history.db (EMERGENCY FALLBACK ONLY) ────────────────
  // Owner directive: «اجعل price_history.db آخر خيار طوارئ (Fallback) فقط
  // إذا انعدمت البيانات». ده الجثة المتعفنة — آخر خيار.
  const phDb = openDb('price_history.db');
  if (phDb) {
    try {
      for (const cand of candidates) {
        const rows = phDb.prepare(`
          SELECT date, close_price as price
          FROM price_history
          WHERE ticker = ? AND close_price > 0
          ORDER BY date DESC
          LIMIT ?
        `).all(cand, maxDays) as { date: string; price: number }[];
        if (rows.length > 0) {
          rows.reverse();
          const result = buildSparklineResult(ticker, rows, 'price_history.db (fallback)');
          phDb.close();
          setCachedSparkline(key, result);
          return result;
        }
      }
    } catch {
      // silent
    }
    phDb.close();
  }

  // Empty (Rule 27: NO-FAKE-DATA)
  const empty: SparklineData = {
    ticker,
    prices: [],
    min: 0,
    max: 0,
    first: 0,
    last: 0,
    change_pct: 0,
    days: 0,
    source: 'none',
  };
  setCachedSparkline(key, empty);
  return empty;
}

/**
 * Fetch sparklines for multiple tickers at once.
 */
export function getLiveSparklines(tickers: string[], days: number = 30): Record<string, SparklineData> {
  const results: Record<string, SparklineData> = {};
  for (const t of tickers.slice(0, 50)) {
    results[t] = getLiveSparkline(t, days);
  }
  return results;
}

// ─── 2. getIncubatorData ───────────────────────────────────────────────────
// Owner directive: «يقرأ المرشحين من أحدث ملف maker_radar_{market}_*.json
// مع فلترة أي سهم أسعاره أقدم من جلسة اليوم».

/**
 * Find the most recent maker_radar_{MARKET}_*.json file.
 */
function findLatestRadarJson(market: string): string | null {
  try {
    const files = readdirSync(OUTPUT_DIR);
    const prefix = `maker_radar_${market}_`;
    const candidates = files
      .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
      .sort()
      .reverse();
    if (candidates.length === 0) return null;
    return path.join(OUTPUT_DIR, candidates[0]);
  } catch {
    return null;
  }
}

/** Get today's date in YYYY-MM-DD (Cairo timezone aware). */
function todayDateStr(): string {
  const now = new Date();
  // Cairo is UTC+2. Adjust so "today" matches the market session.
  const cairo = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return cairo.toISOString().slice(0, 10);
}

/**
 * Read incubator candidates from the latest radar JSON.
 * Filters out any candidate whose data_date is older than today's session
 * (per owner directive: «فلترة أي سهم أسعاره أقدم من جلسة اليوم»).
 */
export function getIncubatorData(market: string = 'EGX'): IncubatorData {
  const empty: IncubatorData = {
    market,
    total_candidates: 0,
    candidates: [],
    timestamp: new Date().toISOString(),
    is_fresh: false,
  };

  const jsonPath = findLatestRadarJson(market);
  if (!jsonPath) return empty;

  try {
    const raw = readFileSync(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rawCandidates = (parsed.incubator_candidates || parsed.candidates || []) as IncubatorCandidate[];
    const scanTs = parsed.scan_timestamp || parsed.timestamp || parsed.generated_at;
    const today = todayDateStr();

    // Determine freshness: is the radar scan from today?
    const scanDate = scanTs ? String(scanTs).slice(0, 10) : '';
    const isFresh = scanDate === today;

    // Filter: keep only candidates whose data_date is today (per owner directive).
    // If data_date is missing, keep the candidate (don't penalize missing metadata).
    const filtered = rawCandidates.filter((c) => {
      if (!c.data_date) return true; // missing metadata → keep
      return c.data_date === today || c.data_date >= today;
    });

    // (المرحلة 2، التكليف المغلق): «يمرر المرشحين candidates عبر enrichWithLogos
    // قبل إرجاعهم» عشان الأيقونات تظهر في الحاضنة كمان (root casing fix).
    const enrichedCandidates = enrichWithUnifiedLogos(
      filtered as unknown as Record<string, unknown>[],
    ) as unknown as IncubatorCandidate[];

    return {
      market,
      total_candidates: enrichedCandidates.length,
      candidates: enrichedCandidates,
      timestamp: scanTs ? String(scanTs) : new Date().toISOString(),
      is_fresh: isFresh,
    };
  } catch {
    return empty;
  }
}

// ─── 3. getUnifiedLogos ─────────────────────────────────────────────────────
// Owner directive: «يبني كاش الأيقونات ويدعم الخاصيتين معا (logo_url و logoUrl)».

let _logoCache: Map<string, string> | null = null;
let _logoCacheTimestamp = 0;
const LOGO_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Build logo lookup map.
 * Priority: stocks.db.stocks.logo_url (post-merge) → data_engine.db.stocks.logo_url (fallback).
 * Cached for 5 minutes.
 */
export function getUnifiedLogos(): Map<string, string> {
  const now = Date.now();
  if (_logoCache && now - _logoCacheTimestamp < LOGO_CACHE_TTL_MS) {
    return _logoCache;
  }

  const cache = new Map<string, string>();

  // Source 1: stocks.db.stocks.logo_url (official, post-merge)
  const stocksDb = openDb('stocks.db');
  if (stocksDb) {
    try {
      if (columnExists(stocksDb, 'stocks', 'logo_url')) {
        const rows = stocksDb.prepare(
          'SELECT UPPER(ticker) as sym, logo_url FROM stocks WHERE logo_url IS NOT NULL AND logo_url != ?'
        ).all('') as Array<{ sym: string; logo_url: string }>;
        for (const r of rows) {
          if (r.sym && r.logo_url) cache.set(r.sym, String(r.logo_url));
        }
      }
    } catch {
      // silent
    }
    stocksDb.close();
  }

  // Source 2 (fallback): data_engine.db.stocks.logo_url (historical, working now)
  const deDb = openDb('data_engine.db');
  if (deDb) {
    try {
      const rows = deDb.prepare(
        'SELECT UPPER(symbol) as sym, logo_url FROM stocks WHERE logo_url IS NOT NULL AND logo_url != ?'
      ).all('') as Array<{ sym: string; logo_url: string }>;
      for (const r of rows) {
        if (r.sym && r.logo_url && !cache.has(r.sym)) {
          cache.set(r.sym, String(r.logo_url));
        }
      }
    } catch {
      // silent
    }
    deDb.close();
  }

  _logoCache = cache;
  _logoCacheTimestamp = now;
  return cache;
}

/** Get logo_url for a single ticker. */
export function getLogoUrl(ticker: string | null | undefined): string | null {
  if (!ticker) return null;
  return getUnifiedLogos().get(ticker.toUpperCase()) ?? null;
}

/**
 * Enrich an array of items with logos.
 * Owner directive: «احقن الخاصيتين معاً: record['logo_url'] = logo; record['logoUrl'] = logo;»
 * This is the ROOT FIX for the casing mismatch bug.
 */
export function enrichWithUnifiedLogos<T extends Record<string, unknown>>(
  items: T[],
  tickerField: string = 'ticker',
): T[] {
  const lookup = getUnifiedLogos();
  for (const item of items) {
    const record = item as Record<string, unknown>;
    const ticker = String(record[tickerField] || record['symbol'] || '').toUpperCase();
    if (ticker) {
      const logo = lookup.get(ticker);
      if (logo) {
        // ROOT FIX: inject BOTH casing variants so ALL components work.
        record['logo_url'] = logo;
        record['logoUrl'] = logo;
      }
    }
  }
  return items;
}

// ─── 4. getActivePredictions ──────────────────────────────────────────────
// Owner directive (المرحلة 2، التكليف المغلق 2026-10-27):
// «يجلب التوقعات النظيفة بدون تكرار للـ ticker» + فلاتر أمان صارمة:
//   - entry_price > 0 AND entry_price < 100000
//   - stop_loss >= 0
//   - في صفقات الشراء: stop_loss < entry_price
//   - انحراف السعر الحالي عن سعر الدخول لا يتجاوز 15%:
//     Math.abs(current_price - entry_price) / current_price <= 0.15

const ANOMALY_THRESHOLD = 0.15; // 15% deviation → hide (per owner directive)

/**
 * Fetch active predictions from predictions.db.
 * Deduplicates by ticker (keeps most recent per ticker).
 *
 * Safety filters (per owner directive — المرحلة 2، التكليف المغلق):
 *   - entry_price > 0 AND entry_price < 100000
 *   - stop_loss >= 0 (negative stop = invalid, e.g. ADP's -135.94)
 *   - في صفقات الشراء: stop_loss < entry_price
 *   - انحراف السعر الحالي عن الدخول لا يتجاوز 15%:
 *     Math.abs(current_price - entry_price) / current_price <= 0.15
 */
export function getActivePredictions(
  market: string = 'EGX',
  limit: number = 5,
): ActivePrediction[] {
  const predDb = openDb('predictions.db');
  if (!predDb) return [];

  // Also open stocks.db to get live current_price + logo for anomaly check + enrichment.
  const stocksDb = openDb('stocks.db');

  try {
    // Check which columns exist (defensive — schema varies).
    const hasEntry = columnExists(predDb, 'predictions', 'entry_price');
    const hasTarget = columnExists(predDb, 'predictions', 'target_price');
    const hasStop = columnExists(predDb, 'predictions', 'stop_loss');
    const hasSignal = columnExists(predDb, 'predictions', 'signal');
    const hasScore = columnExists(predDb, 'predictions', 'score');
    const hasRiskReward = columnExists(predDb, 'predictions', 'risk_reward');
    const hasSymbol = columnExists(predDb, 'predictions', 'symbol');
    const hasNameAr = columnExists(predDb, 'predictions', 'name_ar');
    const hasDate = columnExists(predDb, 'predictions', 'prediction_date');
    const hasCreated = columnExists(predDb, 'predictions', 'created_at');
    const hasMethods = columnExists(predDb, 'predictions', 'analysis_methods');

    const tickerCol = hasSymbol ? 'symbol' : 'ticker';
    const selectCols = [
      `${tickerCol} as ticker`,
      hasNameAr ? 'name_ar' : 'NULL as name_ar',
      hasEntry ? 'entry_price' : 'NULL as entry_price',
      hasTarget ? 'target_price' : 'NULL as target_price',
      hasStop ? 'stop_loss' : 'NULL as stop_loss',
      hasSignal ? 'signal' : 'NULL as signal',
      hasSignal ? 'signal_ar' : 'NULL as signal_ar',
      hasScore ? 'score' : 'NULL as score',
      hasRiskReward ? 'risk_reward' : 'NULL as risk_reward',
      hasDate ? 'prediction_date' : 'NULL as prediction_date',
      hasCreated ? 'created_at' : 'NULL as created_at',
      hasMethods ? 'analysis_methods' : 'NULL as analysis_methods',
    ].join(', ');

    const rows = predDb.prepare(`
      SELECT ${selectCols}
      FROM predictions
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit * 3) as ActivePrediction[]; // fetch 3x to allow for dedup filtering

    // Build live price + logo lookup from stocks.db.
    const livePrices = new Map<string, number>();
    const liveLogos = new Map<string, string>();
    if (stocksDb) {
      try {
        const stockRows = stocksDb.prepare(
          'SELECT UPPER(ticker) as sym, current_price, logo_url FROM stocks'
        ).all() as Array<{ sym: string; current_price: number; logo_url?: string | null }>;
        for (const r of stockRows) {
          if (r.sym) {
            if (r.current_price > 0) livePrices.set(r.sym, Number(r.current_price));
            if (r.logo_url) liveLogos.set(r.sym, String(r.logo_url));
          }
        }
      } catch {
        // silent
      }
    }

    // Dedup by ticker (keep first/most recent) + safety filters + anomaly filter.
    // Per owner directive (المرحلة 2، التكليف المغلق 2026-10-27):
    //   - entry_price > 0 AND entry_price < 100000
    //   - stop_loss >= 0
    //   - في صفقات الشراء: stop_loss < entry_price (لو signal=BUY/SRCTRS/Entry)
    //   - abs(cur - entry) / cur <= 0.15
    const seen = new Set<string>();
    const result: ActivePrediction[] = [];
    for (const row of rows) {
      const cleanTicker = (row.ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
      if (!cleanTicker || seen.has(cleanTicker)) continue;

      const entryVal = row.entry_price != null ? Number(row.entry_price) : null;
      const stopVal = row.stop_loss != null ? Number(row.stop_loss) : null;
      const curVal = livePrices.get(cleanTicker) ?? null;
      const signal = (row.signal || '').toString().toUpperCase();
      const isBuy = signal.includes('BUY') || signal.includes('LONG') || signal.includes('شراء');

      // Filter 1: entry_price > 0 AND entry_price < 100000 (sanity).
      if (entryVal == null || entryVal <= 0 || entryVal >= 100000) continue;

      // Filter 2: stop_loss >= 0 (negative stop = invalid, e.g. ADP's -135.94 support).
      if (stopVal != null && stopVal < 0) continue;

      // Filter 3: في صفقات الشراء، stop_loss < entry_price (ممنوع وقف فوق الدخول).
      if (isBuy && stopVal != null && stopVal >= entryVal) continue;

      // Filter 4: anomaly — abs(cur - entry) / cur > 15% → skip (per owner directive).
      if (
        curVal != null &&
        curVal > 0 &&
        Math.abs(curVal - entryVal) / curVal > ANOMALY_THRESHOLD
      ) {
        continue;
      }

      seen.add(cleanTicker);
      row.ticker = cleanTicker;
      row.current_price = curVal ?? undefined;
      // Inject BOTH logo variants (root casing fix).
      const logo = liveLogos.get(cleanTicker);
      if (logo) {
        row.logo_url = logo;
        row.logoUrl = logo;
      }
      result.push(row);
      if (result.length >= limit) break;
    }

    return result;
  } catch {
    return [];
  } finally {
    predDb.close();
    if (stocksDb) stocksDb.close();
  }
}

// ─── Default export (barrel) ────────────────────────────────────────────────

export default {
  getLiveSparkline,
  getLiveSparklines,
  getIncubatorData,
  getUnifiedLogos,
  getLogoUrl,
  enrichWithUnifiedLogos,
  getActivePredictions,
};
