/**
 * radar-db.ts — Portable DB detection for Maker Radar
 * ====================================================
 * يكتشف الـ DB المتاح تلقائياً (sandbox / laptop / production).
 * Fallback chain:
 *   1. db/production_snapshot.db  (sandbox — بيانات مسحوبة)
 *   2. db/vps_real/stocks.db       (sandbox — نسخة VPS)
 *   3. db/stocks.db                 (production)
 *   4. db/data_engine.db (historical_data table) — fallback أخير
 */
import Database from 'better-sqlite3';
import { existsSync, statSync } from 'fs';
import path from 'path';

export interface RadarDbConfig {
  dbPath: string;
  table: string;
  tickerCol: string;
  priceCol: string;
  volumeCol: string;
  turnoverCol: string | null;
  dateCol: string;
  openCol: string;
  highCol: string;
  lowCol: string;
}

const PROJECT_ROOT = process.cwd();

const CANDIDATES: RadarDbConfig[] = [
  {
    dbPath: path.join(PROJECT_ROOT, 'db', 'production_snapshot.db'),
    table: 'stock_daily_prices',
    tickerCol: 'ticker',
    priceCol: 'close',
    volumeCol: 'volume',
    turnoverCol: 'turnover',
    dateCol: 'price_date',
    openCol: 'open',
    highCol: 'high',
    lowCol: 'low',
  },
  {
    dbPath: path.join(PROJECT_ROOT, 'db', 'vps_real', 'stocks.db'),
    table: 'stock_daily_prices',
    tickerCol: 'ticker',
    priceCol: 'close',
    volumeCol: 'volume',
    turnoverCol: 'turnover',
    dateCol: 'price_date',
    openCol: 'open',
    highCol: 'high',
    lowCol: 'low',
  },
  {
    dbPath: path.join(PROJECT_ROOT, 'db', 'stocks.db'),
    table: 'stock_daily_prices',
    tickerCol: 'ticker',
    priceCol: 'close',
    volumeCol: 'volume',
    turnoverCol: 'turnover',
    dateCol: 'price_date',
    openCol: 'open',
    highCol: 'high',
    lowCol: 'low',
  },
  // Production data_engine fallback (historical_data — السعودية + غيرها)
  {
    dbPath: path.join(PROJECT_ROOT, 'db', 'data_engine.db'),
    table: 'historical_data',
    tickerCol: 'symbol',
    priceCol: 'close',
    volumeCol: 'volume',
    turnoverCol: null, // historical_data مفيهاش turnover field
    dateCol: 'date',
    openCol: 'open',
    highCol: 'high',
    lowCol: 'low',
  },
];

let cachedConfig: RadarDbConfig | null = null;

export function getRadarDbConfig(): RadarDbConfig | null {
  if (cachedConfig) return cachedConfig;

  for (const cfg of CANDIDATES) {
    try {
      if (!existsSync(cfg.dbPath)) continue;
      // تحقق إن الـ table موجود
      const db = new Database(cfg.dbPath, { readonly: true, fileMustExist: true });
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(cfg.table);
      db.close();
      if (row) {
        cachedConfig = cfg;
        return cfg;
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

export function getRadarDb(): Database.Database | null {
  const cfg = getRadarDbConfig();
  if (!cfg) return null;
  try {
    return new Database(cfg.dbPath, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.error('[radar-db] open error:', e);
    return null;
  }
}

/** حجم الـ DB الحالي بالـ MB */
export function getRadarDbSize(): number {
  const cfg = getRadarDbConfig();
  if (!cfg) return 0;
  try {
    const stat = statSync(cfg.dbPath);
    return stat.size / (1024 * 1024);
  } catch {
    return 0;
  }
}

/** parse volume من string ('189.72 M') لرقم */
export function parseVolume(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toUpperCase()
    .replace(/\u202f/g, '').replace(/\xa0/g, '').replace(/\s/g, '');
  let mult = 1;
  let num = s;
  if (s.endsWith('K')) { mult = 1e3; num = s.slice(0, -1); }
  else if (s.endsWith('M')) { mult = 1e6; num = s.slice(0, -1); }
  else if (s.endsWith('B')) { mult = 1e9; num = s.slice(0, -1); }
  const parsed = parseFloat(num);
  return isNaN(parsed) ? 0 : parsed * mult;
}

/** احسب turnover من row — portable (turnover field أو close × volume) */
export function computeTurnover(row: any, cfg: RadarDbConfig): number {
  if (cfg.turnoverCol && row[cfg.turnoverCol] != null) {
    const t = parseFloat(row[cfg.turnoverCol]);
    if (!isNaN(t) && t > 0) return t;
  }
  const close = row[cfg.priceCol] || 0;
  const vol = parseVolume(row[cfg.volumeCol]);
  return close * vol;
}
