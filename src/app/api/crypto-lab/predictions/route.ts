import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/crypto-lab/predictions
 *
 * Reads the LATEST crypto predictions (BTC, ETH) directly from the SQLite
 * database populated by the Python CryptoLabScheduler (runs every 15 min).
 *
 * DB table: crypto_predictions_log
 * Columns: id, symbol, signal, confidence, entry_price, target_price,
 *          stop_loss, analysis_json, created_at
 *
 * Response shape:
 * {
 *   success: boolean;
 *   predictions: Array<{ id, symbol, signal, confidence, entry_price,
 *                       target_price, stop_loss, analysis, created_at }>;
 *   last_updated: string | null;
 * }
 */

interface RawRow {
  id: number;
  symbol: string;
  signal: string | null;
  confidence: number | null;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  analysis_json: string | null;
  created_at: string | null;
}

interface PredictionOut {
  id: number;
  symbol: string;
  signal: string;
  confidence: number;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  analysis: Record<string, unknown> | null;
  created_at: string;
}

// Candidate DB paths — first one that exists wins. We prefer the current
// working directory (Next.js process.cwd()), then fall back to the env-configured
// PREDICTIONS_DB_PATH if set. Per Rule 17 + Rule 61, no hardcoded absolute paths.
function resolveDbPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'db', 'predictions.db'),
    process.env.PREDICTIONS_DB_PATH ?? '',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function safeParseAnalysis(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const dbPath = resolveDbPath();
    if (!dbPath) {
      // No DB file found — return empty success (scheduler may not have run yet)
      return NextResponse.json({
        success: true,
        predictions: [],
        last_updated: null,
        note: 'predictions.db not found — crypto lab may not have run yet',
      });
    }

    // Lazy-load better-sqlite3 (native module) so we never crash the route
    // handler on import-time failure.
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });

    // Check whether the table exists — if not, return empty success.
    let tableExists = false;
    try {
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='crypto_predictions_log' LIMIT 1"
        )
        .get() as { name: string } | undefined;
      tableExists = !!row;
    } catch {
      tableExists = false;
    }

    if (!tableExists) {
      db.close();
      return NextResponse.json({
        success: true,
        predictions: [],
        last_updated: null,
      });
    }

    // Pull the most recent 20 rows for BTC/ETH (the scheduler only writes
    // these two, but the filter keeps the result set tight and predictable).
    const rows = db
      .prepare(
        `SELECT id, symbol, signal, confidence, entry_price, target_price,
                stop_loss, analysis_json, created_at
         FROM crypto_predictions_log
         WHERE symbol IN ('BTC', 'ETH')
         ORDER BY created_at DESC
         LIMIT 20`
      )
      .all() as RawRow[];

    db.close();

    // Dedupe by symbol — keep the FIRST occurrence (most recent) of each.
    const seen = new Set<string>();
    const predictions: PredictionOut[] = [];
    for (const r of rows) {
      if (!r.symbol || seen.has(r.symbol)) continue;
      seen.add(r.symbol);
      predictions.push({
        id: r.id,
        symbol: r.symbol,
        signal: r.signal ?? 'UNKNOWN',
        confidence: typeof r.confidence === 'number' ? r.confidence : 0,
        entry_price: typeof r.entry_price === 'number' ? r.entry_price : 0,
        target_price: typeof r.target_price === 'number' ? r.target_price : 0,
        stop_loss: typeof r.stop_loss === 'number' ? r.stop_loss : 0,
        analysis: safeParseAnalysis(r.analysis_json),
        created_at: r.created_at ?? new Date().toISOString(),
      });
    }

    // Sort for deterministic display: BTC first, then ETH.
    const symbolOrder: Record<string, number> = { BTC: 0, ETH: 1 };
    predictions.sort(
      (a, b) =>
        (symbolOrder[a.symbol] ?? 99) - (symbolOrder[b.symbol] ?? 99)
    );

    const last_updated =
      rows.length > 0 && rows[0].created_at ? rows[0].created_at : null;

    return NextResponse.json({
      success: true,
      predictions,
      last_updated,
    });
  } catch (err) {
    console.error('[crypto-lab/predictions] error:', err);
    return NextResponse.json(
      {
        success: false,
        predictions: [],
        last_updated: null,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
