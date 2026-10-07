/**
 * GET /api/finance/transactions
 * POST /api/finance/transactions
 * =================================
 * FIX: was proxying to /api/live-monitor (wrong!).
 * Now reads/writes financial_transactions table in stocks.db.
 *
 * GET params: ?month=X&year=Y (filter by month/year)
 * POST body: { type, category, amount, description, transaction_date, is_recurring, recurring_frequency }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';

const TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS financial_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'income',
    category TEXT,
    amount REAL NOT NULL DEFAULT 0,
    description TEXT,
    is_recurring INTEGER DEFAULT 0,
    recurring_frequency TEXT,
    transaction_date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`;

let _tableEnsured = false;
function ensureTable(db: any): void {
  if (_tableEnsured) return;
  db.prepare(TABLE_DDL).run();
  _tableEnsured = true;
}

// ---------------------------------------------------------------------------
// GET — Fetch transactions (optionally filtered by month/year)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: true, items: [], total: 0 });
    }

    const db = await getFinanceDb();
    ensureTable(db);

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const year = searchParams.get('year');

    let query = "SELECT * FROM financial_transactions WHERE user_id = ?";
    const params: any[] = [userId];

    if (month && year) {
      query += " AND strftime('%m', transaction_date) = ? AND strftime('%Y', transaction_date) = ?";
      const monthStr = month.padStart(2, '0');
      params.push(monthStr, year);
    }

    query += " ORDER BY transaction_date DESC, id DESC";

    const items = db.prepare(query).all(...params) as any[];

    // Calculate summary
    let totalIncome = 0;
    let totalExpense = 0;
    for (const item of items) {
      if (item.type === 'income') totalIncome += Number(item.amount || 0);
      else if (item.type === 'expense') totalExpense += Number(item.amount || 0);
    }

    return NextResponse.json({
      success: true,
      items,
      total: items.length,
      summary: {
        total_income: Math.round(totalIncome * 100) / 100,
        total_expense: Math.round(totalExpense * 100) / 100,
        net: Math.round((totalIncome - totalExpense) * 100) / 100,
      },
    });
  } catch (error) {
    console.error('[/api/finance/transactions GET] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'فشل في جلب المعاملات',
      items: [],
      total: 0,
    }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Add new transaction
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const body = await request.json();
    const { type, category, amount, description, transaction_date, is_recurring, recurring_frequency, notes } = body;

    if (!type || amount === undefined) {
      return NextResponse.json({ success: false, error: 'type و amount مطلوبان' }, { status: 400 });
    }

    const db = await getFinanceDb();
    ensureTable(db);

    const result = db.prepare(`
      INSERT INTO financial_transactions
        (user_id, type, category, amount, description, is_recurring, recurring_frequency, transaction_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      type,
      category || null,
      Number(amount),
      description || null,
      is_recurring ? 1 : 0,
      recurring_frequency || null,
      transaction_date || new Date().toISOString().slice(0, 10),
      notes || null
    );

    return NextResponse.json({
      success: true,
      id: result.lastInsertRowid,
      message: 'تمت إضافة المعاملة',
    });
  } catch (error) {
    console.error('[/api/finance/transactions POST] Error:', error);
    return NextResponse.json({ success: false, error: 'فشل في إضافة المعاملة' }, { status: 500 });
  }
}
