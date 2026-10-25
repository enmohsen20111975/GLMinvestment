/**
 * radar-db.ts — Portable DB detection for Maker Radar
 * ====================================================
 * يكتشف الـ DB المتاح تلقائياً (sandbox / laptop / production).
 * Fallback chain:
 * 1. db/production_snapshot.db (sandbox — بيانات مسحوبة)
 * 2. db/vps_real/stocks.db (sandbox — نسخة VPS)
 * 3. db/stocks.db (production)
 * 4. db/data_engine.db (historical_data table) — fallback أخير
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
 // 1. stocks.db.stock_daily_prices — الـ source of truth المحدث يومياً في الإنتاج
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
 // 2. data_engine.db.egksco_price_history — أرشيف تاريخي
 {
 dbPath: path.join(PROJECT_ROOT, 'db', 'data_engine.db'),
 table: 'egksco_price_history',
 tickerCol: 'symbol',
 priceCol: 'close_price',
 volumeCol: 'volume',
 turnoverCol: 'turnover',
 dateCol: 'price_date',
 openCol: 'open_price',
 highCol: 'high_price',
 lowCol: 'low_price',
 },
 // 3. data_engine.db.historical_data — fallback للأسواق التانية (سعودي/أمريكي)
 // schema: symbol, date, open, high, low, close, volume (مفيش turnover)
 {
 dbPath: path.join(PROJECT_ROOT, 'db', 'data_engine.db'),
 table: 'historical_data',
 tickerCol: 'symbol',
 priceCol: 'close',
 volumeCol: 'volume',
 turnoverCol: null,
 dateCol: 'date',
 openCol: 'open',
 highCol: 'high',
 lowCol: 'low',
 },
 // 4. sandbox fallbacks
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
];

let cachedConfig: RadarDbConfig | null = null;

export function getRadarDbConfig(): RadarDbConfig | null {
 if (cachedConfig) return cachedConfig;

 for (const cfg of CANDIDATES) {
 try {
 if (!existsSync(cfg.dbPath)) continue;
 const db = new Database(cfg.dbPath, { readonly: true, fileMustExist: true });
 // تحقق إن الـ table موجود
 const row = db.prepare(
 "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
 ).get(cfg.table);
 if (!row) {
 db.close();
 continue;
 }
 // تحقق إن الجدول مش فاضي (عشان egksco_price_history الفاضية ما تفضلش)
 const countRow = db.prepare(`SELECT COUNT(*) as n FROM ${cfg.table}`).get() as any;
 const n = countRow?.n || 0;
 if (n === 0) {
 db.close();
 continue; // جرّب اللي بعده
 }
 db.close();
 cachedConfig = cfg;
 return cfg;
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
