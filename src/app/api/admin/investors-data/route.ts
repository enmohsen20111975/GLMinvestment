/**
 * POST /api/admin/investors-data
 * ===============================================================================
 *
 * Manual entry of EGX investor-flow data (مصريين / عرب / أجانب — buy/sell/net).
 *
 * Owner directive (2026-10-22): "اديـنى امكانية انى احط البيانات دى من لوحة
 * الادمن" — when automated scraping fails or produces wrong values, the admin
 * can manually enter the real numbers from EGX (viewed in a real browser).
 *
 * Body (JSON):
 *   {
 *     "date": "2026-10-22",
 *     "egyptians_buys": 1220000000,
 *     "egyptians_sells": 900000000,
 *     "arab_buys": 0,
 *     "arab_sells": 0,
 *     "foreign_buys": 121000000,
 *     "foreign_sells": 484000000,
 *     "number_of_trades": 1174000,
 *     "session_type": "day"
 *   }
 *
 * The route computes net = buys - sells for each nationality + totals.
 * Upserts to stocks.db.investors_data with source='admin_manual_entry'.
 *
 * Auth: requireAdminAsync (admin token / session / localhost bypass).
 * ===============================================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { openDb, openDbWritable } from '@/lib/db-manager';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();
const DB_PATH = 'stocks.db';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS investors_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  session_type TEXT,
  individuals_buys_value REAL,
  individuals_sells_value REAL,
  individuals_net_value REAL,
  arab_buys_value REAL,
  arab_sells_value REAL,
  arab_net_value REAL,
  foreign_buys_value REAL,
  foreign_sells_value REAL,
  foreign_net_value REAL,
  total_buys_value REAL,
  total_sells_value REAL,
  number_of_trades INTEGER,
  source TEXT DEFAULT 'computed_estimate',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(date)
);
`;

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(request: NextRequest) {
  const adminError = await requireAdminAsync(request);
  if (adminError) return adminError;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const date = (body.date || new Date().toISOString().slice(0, 10)).trim();
  if (!date) {
    return NextResponse.json({ success: false, error: 'date_required' }, { status: 400 });
  }

  const session_type = body.session_type || 'day';
  const egy_buys = toNum(body.egyptians_buys);
  const egy_sells = toNum(body.egyptians_sells);
  const arab_buys = toNum(body.arab_buys);
  const arab_sells = toNum(body.arab_sells);
  const foreign_buys = toNum(body.foreign_buys);
  const foreign_sells = toNum(body.foreign_sells);
  const number_of_trades = body.number_of_trades ? Math.floor(toNum(body.number_of_trades)) : 0;

  const egy_net = egy_buys - egy_sells;
  const arab_net = arab_buys - arab_sells;
  const foreign_net = foreign_buys - foreign_sells;
  const total_buys = egy_buys + arab_buys + foreign_buys;
  const total_sells = egy_sells + arab_sells + foreign_sells;

  try {
    const db = openDbWritable(DB_PATH);
    if (!db) {
      return NextResponse.json(
        { success: false, error: 'db_error', message: 'stocks.db unavailable' },
        { status: 500 }
      );
    }
    db.exec(CREATE_TABLE_SQL);

    const upsert = db.prepare(`
      INSERT OR REPLACE INTO investors_data (
        date, session_type,
        individuals_buys_value, individuals_sells_value, individuals_net_value,
        arab_buys_value, arab_sells_value, arab_net_value,
        foreign_buys_value, foreign_sells_value, foreign_net_value,
        total_buys_value, total_sells_value, number_of_trades,
        source, created_at
      ) VALUES (
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        'admin_manual_entry', datetime('now')
      );
    `);

    const result = upsert.run(
      date, session_type,
      egy_buys, egy_sells, egy_net,
      arab_buys, arab_sells, arab_net,
      foreign_buys, foreign_sells, foreign_net,
      total_buys, total_sells, number_of_trades
    );

    db.close();

    return NextResponse.json({
      success: true,
      message: 'investors_data upserted',
      date,
      source: 'admin_manual_entry',
      row: {
        egy_net, arab_net, foreign_net,
        total_buys, total_sells,
        number_of_trades,
      },
      changes: result.changes,
    });
  } catch (e: any) {
    console.error('[POST /api/admin/investors-data]', e);
    return NextResponse.json(
      { success: false, error: 'db_error', message: e?.message || String(e) },
      { status: 500 }
    );
  }
}

/** GET — return latest investor data rows (for the admin form to preview). */
export async function GET(request: NextRequest) {
  const adminError = await requireAdminAsync(request);
  if (adminError) return adminError;

  try {
    const db = openDb(DB_PATH);
    if (!db) {
      return NextResponse.json(
        { success: false, error: 'db_error', message: 'stocks.db unavailable' },
        { status: 500 }
      );
    }
    const rows = db.prepare(`
      SELECT * FROM investors_data
      WHERE source IS NULL OR source != 'computed_estimate'
      ORDER BY date DESC LIMIT 10
    `).all();
    db.close();
    return NextResponse.json({ success: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: 'db_error', message: e?.message || String(e) },
      { status: 500 }
    );
  }
}
