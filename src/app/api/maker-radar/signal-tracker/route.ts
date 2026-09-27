import { NextRequest, NextResponse } from 'next/server';
// P0-14-ASYNC fix (2026-09-27): replaced sync existsSync/mkdirSync with async
// fs/promises equivalents in pickTrackerDbPath / openTrackerDb so the
// signal-tracker GET+POST handlers never block the event loop on DB
// candidate checks.
import { access, mkdir } from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Signal Tracker — persistent record of every radar signal emitted, with
 * later outcome verification (7d / 14d / 30d % return).
 *
 * DB location: prefer /home/z/my-project/db/stocks.db. If that file does
 * not exist, fall back to db/data_engine.db. The `radar_signal_tracking`
 * table is created on first request.
 */

const PROJECT_ROOT = process.cwd();

const DB_CANDIDATES = [
  path.join(PROJECT_ROOT, 'db', 'stocks.db'),
  path.join(PROJECT_ROOT, 'db', 'data_engine.db'),
];

// P0-14-ASYNC fix (2026-09-27): pickTrackerDbPath is now async — uses access().
async function pickTrackerDbPath(): Promise<string | null> {
  for (const p of DB_CANDIDATES) {
    try {
      await access(p);
      return p;
    } catch {
      // not present — try next
    }
  }
  return null;
}

// P0-14-ASYNC fix (2026-09-27): openTrackerDb is now async.
async function openTrackerDb(): Promise<Database.Database | null> {
  const dbPath = await pickTrackerDbPath();
  if (!dbPath) {
    // Create the parent dir + a fresh stocks.db so the table can be created.
    const targetPath = DB_CANDIDATES[0];
    try {
      const dir = path.dirname(targetPath);
      try {
        await access(dir);
      } catch {
        await mkdir(dir, { recursive: true });
      }
      const db = new Database(targetPath);
      ensureSchema(db);
      return db;
    } catch (e) {
      console.error('[signal-tracker] cannot create db:', e);
      return null;
    }
  }
  try {
    const db = new Database(dbPath);
    ensureSchema(db);
    return db;
  } catch (e) {
    console.error('[signal-tracker] open db error:', e);
    return null;
  }
}

function ensureSchema(db: Database.Database) {
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
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_radar_sig_ticker ON radar_signal_tracking(ticker);
    CREATE INDEX IF NOT EXISTS idx_radar_sig_status ON radar_signal_tracking(status);
    CREATE INDEX IF NOT EXISTS idx_radar_sig_type ON radar_signal_tracking(signal_type);
    CREATE INDEX IF NOT EXISTS idx_radar_sig_date ON radar_signal_tracking(signal_date);
  `);
}

const SIGNAL_LABELS: Record<string, string> = {
  explosive_surge: 'انفجار حجمي',
  quiet_accumulation_strong: 'تجميع قوي هادي',
  pre_surge: 'ما قبل الانفجار',
  early_break: 'اختراق مبكر',
  quiet_accumulation_weak: 'تجميع ضعيف هادي',
};

interface SignalRow {
  id: number;
  ticker: string;
  signal_date: string;
  signal_type: string;
  entry_price: number;
  path: string | null;
  reason: string | null;
  status: string;
  outcome_7d: number | null;
  outcome_14d: number | null;
  outcome_30d: number | null;
  max_price_after: number | null;
  min_price_after: number | null;
  verified_at: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/maker-radar/signal-tracker?days=30&signal_type=explosive_surge
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = Math.max(1, parseInt(url.searchParams.get('days') || '30', 10));
  const signalTypeFilter = url.searchParams.get('signal_type') || null;

  const db = await openTrackerDb();
  if (!db) {
    return NextResponse.json(
      {
        success: false,
        error: 'Cannot open tracker DB at db/stocks.db or db/data_engine.db',
      },
      { status: 503 }
    );
  }

  try {
    const whereClauses: string[] = [
      `signal_date >= date('now', '-${days} days')`,
    ];
    const params: any[] = [];
    if (signalTypeFilter) {
      whereClauses.push('signal_type = ?');
      params.push(signalTypeFilter);
    }
    const whereSql = whereClauses.join(' AND ');

    // ── Overall stats ───────────────────────────────────────────────────
    const totalRow = db
      .prepare(`SELECT COUNT(*) AS n FROM radar_signal_tracking WHERE ${whereSql}`)
      .get(...params) as any;
    const totalSignals = totalRow?.n || 0;

    const pendingRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM radar_signal_tracking WHERE ${whereSql} AND status = 'pending'`
      )
      .get(...params) as any;
    const pending = pendingRow?.n || 0;

    const verifiedRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM radar_signal_tracking WHERE ${whereSql} AND status LIKE 'verified_%'`
      )
      .get(...params) as any;
    const verified = verifiedRow?.n || 0;

    const winRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM radar_signal_tracking WHERE ${whereSql} AND status = 'verified_win'`
      )
      .get(...params) as any;
    const wins = winRow?.n || 0;

    const winRatePct = verified > 0 ? (wins / verified) * 100 : 0;

    // ── Average outcomes (across ALL rows with non-NULL outcomes) ──────
    // Note: SQLite's AVG() ignores NULLs, so this naturally covers both
    // fully-verified signals and partially-recorded (pending) ones.
    const avgRow = db
      .prepare(
        `SELECT
           AVG(outcome_7d)  AS a7,
           AVG(outcome_14d)  AS a14,
           AVG(outcome_30d)  AS a30
         FROM radar_signal_tracking
         WHERE ${whereSql}`
      )
      .get(...params) as any;

    // ── Per-signal-type breakdown ──────────────────────────────────────
    const typeRows = db
      .prepare(
        `SELECT
           signal_type,
           COUNT(*) AS total,
           SUM(CASE WHEN status LIKE 'verified_%' THEN 1 ELSE 0 END) AS verified,
           SUM(CASE WHEN status = 'verified_win' THEN 1 ELSE 0 END) AS wins,
           AVG(outcome_7d)  AS a7,
           AVG(outcome_14d) AS a14,
           AVG(outcome_30d) AS a30
         FROM radar_signal_tracking
         WHERE ${whereSql}
         GROUP BY signal_type
         ORDER BY total DESC`
      )
      .all(...params) as any[];

    const bySignalType = typeRows.map((r) => ({
      signal_type: r.signal_type,
      label: SIGNAL_LABELS[r.signal_type] || r.signal_type,
      total: r.total || 0,
      verified: r.verified || 0,
      wins: r.wins || 0,
      win_rate_pct: r.verified > 0 ? round2((r.wins / r.verified) * 100) : 0,
      avg_outcome_7d: r.a7 != null ? round2(r.a7) : null,
      avg_outcome_14d: r.a14 != null ? round2(r.a14) : null,
      avg_outcome_30d: r.a30 != null ? round2(r.a30) : null,
    }));

    // ── Recent verified signals (last 5) ──────────────────────────────
    const recentRows = db
      .prepare(
        `SELECT ticker, signal_date, signal_type, entry_price, outcome_30d, status
         FROM radar_signal_tracking
         WHERE ${whereSql} AND status LIKE 'verified_%'
         ORDER BY verified_at DESC, signal_date DESC
         LIMIT 5`
      )
      .all(...params) as any[];

    const recentSignals = recentRows.map((r) => ({
      ticker: r.ticker,
      signal_date: r.signal_date,
      signal_type: r.signal_type,
      label: SIGNAL_LABELS[r.signal_type] || r.signal_type,
      entry_price: round2(r.entry_price),
      outcome_30d: r.outcome_30d != null ? round2(r.outcome_30d) : null,
      status: r.status,
    }));

    db.close();

    return NextResponse.json({
      success: true,
      window_days: days,
      signal_type_filter: signalTypeFilter,
      total_signals: totalSignals,
      pending,
      verified,
      win_rate_pct: round2(winRatePct),
      avg_outcome_7d: avgRow?.a7 != null ? round2(avgRow.a7) : null,
      avg_outcome_14d: avgRow?.a14 != null ? round2(avgRow.a14) : null,
      avg_outcome_30d: avgRow?.a30 != null ? round2(avgRow.a30) : null,
      by_signal_type: bySignalType,
      recent_signals: recentSignals,
      computed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[signal-tracker GET] error:', error);
    try { db.close(); } catch {}
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/maker-radar/signal-tracker
// body: { ticker, signal_type, entry_price, path?, reason? }
// ─────────────────────────────────────────────────────────────────────────────

const VALID_SIGNAL_TYPES = new Set([
  'explosive_surge',
  'quiet_accumulation_strong',
  'pre_surge',
  'early_break',
  'quiet_accumulation_weak',
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ticker = (body?.ticker || '').toString().toUpperCase().trim();
    const signalType = (body?.signal_type || '').toString().trim();
    const entryPrice = Number(body?.entry_price);
    const pathCode = body?.path != null ? String(body.path) : null;
    const reason = body?.reason != null ? String(body.reason) : null;

    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'ticker is required' },
        { status: 400 }
      );
    }
    if (!VALID_SIGNAL_TYPES.has(signalType)) {
      return NextResponse.json(
        {
          success: false,
          error: `signal_type must be one of: ${[...VALID_SIGNAL_TYPES].join(', ')}`,
        },
        { status: 400 }
      );
    }
    if (!isFinite(entryPrice) || entryPrice <= 0) {
      return NextResponse.json(
        { success: false, error: 'entry_price (number > 0) is required' },
        { status: 400 }
      );
    }

    const db = await openTrackerDb();
    if (!db) {
      return NextResponse.json(
        { success: false, error: 'Cannot open tracker DB' },
        { status: 503 }
      );
    }

    try {
      const today = new Date().toISOString().slice(0, 10);

      // Dedup: (ticker, signal_date, signal_type) must be unique.
      const existing = db
        .prepare(
          `SELECT id FROM radar_signal_tracking
           WHERE ticker = ? AND signal_date = ? AND signal_type = ?`
        )
        .get(ticker, today, signalType) as any;

      if (existing) {
        db.close();
        return NextResponse.json({
          success: true,
          dedup: true,
          ticker,
          signal_type: signalType,
          signal_date: today,
          existing_id: existing.id,
        });
      }

      const insert = db.prepare(
        `INSERT INTO radar_signal_tracking
           (ticker, signal_date, signal_type, entry_price, path, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`
      );
      const info = insert.run(ticker, today, signalType, entryPrice, pathCode, reason);
      const newId = info.lastInsertRowid as number;
      db.close();

      return NextResponse.json({
        success: true,
        dedup: false,
        id: newId,
        ticker,
        signal_type: signalType,
        signal_date: today,
        entry_price: round2(entryPrice),
      });
    } catch (error: any) {
      try { db.close(); } catch {}
      throw error;
    }
  } catch (error: any) {
    console.error('[signal-tracker POST] error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 }
    );
  }
}

function round2(v: any): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
