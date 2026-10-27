/**
 * radar-signal-tracker.ts — Shared DB layer for the radar Signal Tracker (DAL-backed)
 * ====================================================================
 *
 * الجدول `radar_signal_tracking` في db/stocks.db (fallback: db/data_engine.db)
 * يخزّن كل إشارات الرادار اليومية، وبيتم التحقق منها بعد 7/14/30 يوم.
 *
 * (ALPHA-DAL-WAVE1 — owner directive 2026-10-27):
 * «ممنوع نهائياً فتح new Database() داخل أي ملف في src/modules/. استدعِ openDbWritable من db-manager.ts.»
 *
 * يُستخدم من:
 * - /api/maker-radar/signal-tracker/route.ts (GET stats, POST record)
 * - /api/maker-radar/signal-tracker/verify/route.ts (POST verify)
 * - src/lib/schedulers/radar-alerts.ts (recordRadarSignals في الـ warmup)
 */
import type Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { openDbWritable } from '@/lib/db-manager';

const PROJECT_ROOT = process.cwd();

const DB_CANDIDATES = [
 path.join(PROJECT_ROOT, 'db', 'stocks.db'),
 path.join(PROJECT_ROOT, 'db', 'data_engine.db'),
];

/**
 * يرجّع مسار الـ DB اللي موجود فعلاً. لو مفيش، بيخلق stocks.db جديد.
 */
export function pickTrackerDbPath(): string | null {
 for (const p of DB_CANDIDATES) {
 if (existsSync(p)) return p;
 }
 // Create stocks.db fresh
 try {
 const target = path.join(PROJECT_ROOT, 'db', 'stocks.db');
 const dir = path.dirname(target);
 if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
 return target;
 } catch {
 return null;
 }
}

export function openTrackerDb(): Database.Database | null {
 const dbPath = pickTrackerDbPath();
 if (!dbPath) return null;
 // (ALPHA-DAL-WAVE1): استخدم openDbWritable من الـ DAL — ممنوع new Database() هنا.
 // الـ DAL بيـ handle busy_timeout + WAL + auto-recovery.
 const dbFile = dbPath.includes('stocks.db') ? 'stocks.db' : 'data_engine.db';
 const db = openDbWritable(dbFile);
 if (!db) return null;
 ensureSchema(db);
 return db;
}

export function ensureSchema(db: Database.Database): void {
 db.exec(`
 CREATE TABLE IF NOT EXISTS radar_signal_tracking (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 ticker TEXT NOT NULL,
 signal_date TEXT NOT NULL,
 signal_type TEXT NOT NULL,
 entry_price REAL NOT NULL,
 path TEXT,
 reason TEXT,
 status TEXT DEFAULT 'pending',
 outcome_7d REAL,
 outcome_14d REAL,
 outcome_30d REAL,
 max_price_after REAL,
 min_price_after REAL,
 verified_at TEXT,
 created_at TEXT DEFAULT (datetime('now')),
 source TEXT DEFAULT 'maker_radar'
 );
 CREATE INDEX IF NOT EXISTS idx_radar_sig_ticker ON radar_signal_tracking(ticker);
 CREATE INDEX IF NOT EXISTS idx_radar_sig_status ON radar_signal_tracking(status);
 CREATE INDEX IF NOT EXISTS idx_radar_sig_type ON radar_signal_tracking(signal_type);
 CREATE INDEX IF NOT EXISTS idx_radar_sig_date ON radar_signal_tracking(signal_date);
 CREATE INDEX IF NOT EXISTS idx_radar_sig_source ON radar_signal_tracking(source);
 `);
}

export const SIGNAL_LABELS: Record<string, string> = {
 explosive_surge: 'انفجار حجمي',
 quiet_accumulation_strong: 'تجميع قوي هادي',
 pre_surge: 'ما قبل الانفجار',
 early_break: 'اختراق مبكر',
 quiet_accumulation_weak: 'تجميع ضعيف هادي',
};

export const VALID_SIGNAL_TYPES = new Set([
 'explosive_surge',
 'quiet_accumulation_strong',
 'quiet_accumulation_weak',
 'pre_surge',
 'early_break',
]);

export interface RecordSignalInput {
 ticker: string;
 signal_type: string;
 entry_price: number;
 path?: string | null;
 reason?: string | null;
 signal_date?: string; // YYYY-MM-DD; default today
}

export interface RecordSignalResult {
 ok: boolean;
 inserted: boolean;
 id?: number;
 dedup?: boolean;
 error?: string;
}

/**
 * بيُدرج إشارة جديدة مع dedup على (ticker, signal_date, signal_type).
 * لو موجودة → inserted=false, dedup=true.
 */
export function recordSignal(input: RecordSignalInput): RecordSignalResult {
 const ticker = (input.ticker || '').toUpperCase().trim();
 if (!ticker) return { ok: false, inserted: false, error: 'ticker required' };
 if (!VALID_SIGNAL_TYPES.has(input.signal_type)) {
 return { ok: false, inserted: false, error: `invalid signal_type: ${input.signal_type}` };
 }
 if (typeof input.entry_price !== 'number' || input.entry_price <= 0) {
 return { ok: false, inserted: false, error: 'entry_price must be > 0' };
 }

 const signalDate = input.signal_date || new Date().toISOString().slice(0, 10);

 const db = openTrackerDb();
 if (!db) return { ok: false, inserted: false, error: 'cannot open DB' };

 try {
 // dedup
 const existing = db
 .prepare(
 'SELECT id FROM radar_signal_tracking WHERE ticker = ? AND signal_date = ? AND signal_type = ? LIMIT 1',
 )
 .get(ticker, signalDate, input.signal_type) as { id: number } | undefined;
 if (existing) {
 return { ok: true, inserted: false, dedup: true, id: existing.id };
 }

 const result = db
 .prepare(
 `INSERT INTO radar_signal_tracking
 (ticker, signal_date, signal_type, entry_price, path, reason, status, source)
 VALUES (?, ?, ?, ?, ?, ?, 'pending', 'frontend')`,
 )
 .run(ticker, signalDate, input.signal_type, input.entry_price, input.path ?? null, input.reason ?? null);

 return { ok: true, inserted: true, id: Number(result.lastInsertRowid) };
 } catch (err) {
 return {
 ok: false,
 inserted: false,
 error: err instanceof Error ? err.message : String(err),
 };
 } finally {
 try { db.close(); } catch { /* noop */ }
 }
}

/**
 * بيُدرج مجموعة إشارات دفعة واحدة (parallel-safe via separate DB connections).
 * بيُرجع ملخص.
 */
export function recordSignalsBatch(inputs: RecordSignalInput[]): {
 total: number;
 inserted: number;
 deduped: number;
 failed: number;
} {
 let inserted = 0;
 let deduped = 0;
 let failed = 0;
 for (const input of inputs) {
 const res = recordSignal(input);
 if (res.inserted) inserted++;
 else if (res.dedup) deduped++;
 else failed++;
 }
 return { total: inputs.length, inserted, deduped, failed };
}
