import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getFinanceDb } from '@/lib/finance-db';

// ---------------------------------------------------------------------------
// ROBO-ADVISOR-P3: POST /api/finance/inflation
// تخزين معدل التضخم المصري في finance DB (macro_indicators)
// Body: { "rate": 30.0, "source": "CBE" }
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rate = Number(body.rate);
    const source = String(body.source || 'manual');

    if (isNaN(rate) || rate < 0 || rate > 100) {
      return NextResponse.json({ success: false, error: 'rate must be a number 0-100' }, { status: 400 });
    }

    const db = await getFinanceDb();
    if (!db) {
      return NextResponse.json({ success: false, error: 'DB unavailable' }, { status: 503 });
    }

    // تأكد إن جدول macro_indicators موجود
    try {
      db.prepare(`CREATE TABLE IF NOT EXISTS macro_indicators (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        indicator_name TEXT NOT NULL UNIQUE,
        indicator_value REAL NOT NULL DEFAULT 0,
        unit TEXT DEFAULT '%',
        source TEXT,
        recorded_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`).run();
    } catch { /* exists */ }

    // إدراج أو تحديث
    db.prepare(`
      INSERT INTO macro_indicators (indicator_name, indicator_value, unit, source, recorded_at, updated_at)
      VALUES ('egypt_inflation', ?, '%', ?, datetime('now'), datetime('now'))
      ON CONFLICT(indicator_name) DO UPDATE SET
        indicator_value = excluded.indicator_value,
        source = excluded.source,
        recorded_at = excluded.recorded_at,
        updated_at = excluded.updated_at
    `).run(rate, source);

    return NextResponse.json({ success: true, rate, source, message: 'Inflation rate stored' });
  } catch (e) {
    console.error('[finance:inflation]', e);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}

// GET — جلب معدل التضخم المخزّن
export async function GET() {
  try {
    const db = await getFinanceDb();
    if (!db) return NextResponse.json({ success: false, rate: 0 });
    try {
      const row = db.prepare("SELECT indicator_value, source, recorded_at FROM macro_indicators WHERE indicator_name = 'egypt_inflation' ORDER BY updated_at DESC LIMIT 1").get() as any;
      if (row) {
        return NextResponse.json({ success: true, rate: row.indicator_value, source: row.source, date: row.recorded_at });
      }
    } catch { /* table might not exist */ }
    console.error('[finance:inflation]', e);
    return NextResponse.json({ success: true, rate: 0, source: 'none', date: null });
  } catch (e) {
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
