/**
 * GET /api/predictions/tracking/list
 * ==================================
 * Tries Python first, falls back to predictions.db (SQLite)
 *
 * Query: market=EGX, status=pending, limit=50
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";
export const runtime = 'nodejs';

const PYTHON_BACKEND_URL = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010')
  .replace('localhost', '127.0.0.1');

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'EGX';
  const status = searchParams.get('status') || '';
  const limit = Math.min(200, parseInt(searchParams.get('limit') || '50', 10) || 50);

  // 1) Try Python first (5s timeout)
  try {
    const url = `${PYTHON_BACKEND_URL}/api/predictions/tracking/list?${searchParams.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2) SQLite fallback — read from predictions.db
  try {
    const path = require('path');
    const fs = require('fs');
    const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ success: true, data: [], source: 'sqlite_fallback', count: 0 });
    }
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });

    let where = ['market = ?'];
    let params: unknown[] = [market];
    if (status) {
      where.push('UPPER(status) = UPPER(?)');
      params.push(status);
    }

    const rows = db.prepare(
      `SELECT id, ticker, signal, signal_type, status, market,
              prediction_date, entry_price, target_price, stop_loss,
              exit_price, actual_return, holding_days, risk_reward,
              master_score, persona, confidence, outcome_date
       FROM predictions
       WHERE ${where.join(' AND ')}
       ORDER BY prediction_date DESC
       LIMIT ?`
    ).all(...params, limit) as Array<Record<string, unknown>>;

    db.close();

    return NextResponse.json({
      success: true,
      data: rows,
      count: rows.length,
      source: 'sqlite_fallback',
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: 'تعذّر تحميل التوقعات',
        details: e instanceof Error ? e.message : 'Unknown',
        data: [],
      },
      { status: 500 }
    );
  }
}
