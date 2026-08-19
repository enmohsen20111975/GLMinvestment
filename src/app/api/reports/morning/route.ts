/**
 * Morning Reports API
 *
 * GET /api/reports/morning - Get latest morning reports
 * POST /api/reports/morning - Push a new morning report from Python backend
 *
 * This endpoint receives morning reports from Kimi's local Python backend
 * and stores them for display on the live website.
 */

import { NextRequest, NextResponse } from 'next/server';
import { initialize, createDatabase } from '@/lib/sqlite-wrapper';

const DB_PATH = 'db/stocks.db';

// Ensure the morning_reports table exists
async function ensureTable() {
  await initialize();
  const db = createDatabase(DB_PATH);

  db.run(`
    CREATE TABLE IF NOT EXISTS morning_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_date TEXT NOT NULL,
      report_text TEXT NOT NULL,
      report_type TEXT DEFAULT 'daily',
      generated_at TEXT,
      received_at TEXT DEFAULT (datetime('now')),
      source TEXT DEFAULT 'python_engine',
      UNIQUE(report_date, report_type)
    )
  `);

  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_morning_date ON morning_reports(report_date)`);
  } catch {
    // Ignore index creation errors
  }

  db.close();
}

// API Key validation
function validateApiKey(request: NextRequest): boolean {
  const expectedKey = process.env.API_KEY;
  if (!expectedKey) {
    return true;
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return false;
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  return token === expectedKey;
}

// GET - Fetch morning reports
export async function GET(request: NextRequest) {
  try {
    await ensureTable();
    await initialize();
    const db = createDatabase(DB_PATH);

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '5');
    const date = searchParams.get('date');

    let query = `SELECT * FROM morning_reports WHERE 1=1`;
    const params: (string | number)[] = [];

    if (date) {
      query += ` AND report_date = ?`;
      params.push(date);
    }

    query += ` ORDER BY report_date DESC, received_at DESC LIMIT ?`;
    params.push(limit);

    const stmt = db.prepare(query);
    const results = stmt.all(...params);

    db.close();

    return NextResponse.json({
      success: true,
      count: results.length,
      reports: results,
    });

  } catch (error) {
    console.error('[reports/morning] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch morning reports' },
      { status: 500 }
    );
  }
}

// POST - Push a new morning report
export async function POST(request: NextRequest) {
  try {
    // Validate API key if configured
    if (!validateApiKey(request)) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Invalid or missing API key' },
        { status: 401 }
      );
    }

    // Parse request body
    let body: {
      report_date?: string;
      report_text?: string;
      report_type?: string;
      generated_at?: string;
    };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!body.report_text) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: report_text' },
        { status: 400 }
      );
    }

    // Set default date to today
    const reportDate = body.report_date || new Date().toISOString().split('T')[0];

    await ensureTable();
    await initialize();
    const db = createDatabase(DB_PATH);

    // Insert or replace
    const stmt = db.prepare(`
      INSERT INTO morning_reports (report_date, report_text, report_type, generated_at, source)
      VALUES (?, ?, ?, ?, 'python_engine')
      ON CONFLICT(report_date, report_type) DO UPDATE SET
        report_text = excluded.report_text,
        generated_at = excluded.generated_at,
        received_at = datetime('now')
    `);

    stmt.run(
      reportDate,
      body.report_text,
      body.report_type || 'daily',
      body.generated_at || new Date().toISOString()
    );

    db.close();

    console.log(`[reports/morning] Saved report for ${reportDate}`);

    return NextResponse.json({
      success: true,
      message: 'Morning report saved successfully',
      report_date: reportDate,
    });

  } catch (error) {
    console.error('[reports/morning] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save morning report' },
      { status: 500 }
    );
  }
}

// DELETE - Remove old reports
export async function DELETE(request: NextRequest) {
  try {
    await initialize();
    const db = createDatabase(DB_PATH);

    const searchParams = request.nextUrl.searchParams;
    const before = searchParams.get('before');

    let query = `DELETE FROM morning_reports WHERE 1=1`;
    const params: string[] = [];

    if (before) {
      query += ` AND report_date < ?`;
      params.push(before);
    } else {
      // Default: delete reports older than 30 days
      query += ` AND report_date < date('now', '-30 days')`;
    }

    const result = db.prepare(query).run(...params);
    db.close();

    return NextResponse.json({
      success: true,
      deleted: result.changes,
    });

  } catch (error) {
    console.error('[reports/morning] DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete reports' },
      { status: 500 }
    );
  }
}
/**
 * Morning Reports API
 *
 * GET /api/reports/morning - Get latest morning reports
 * POST /api/reports/morning - Push a new morning report from Python backend
 *
 * This endpoint receives morning reports from Kimi's local Python backend
 * and stores them for display on the live website.
 */

