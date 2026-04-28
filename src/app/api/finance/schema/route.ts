import { NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';

// ---------------------------------------------------------------------------
// POST /api/finance/schema — Create all financial tracking tables
// ---------------------------------------------------------------------------

export async function POST() {
  try {
    const db = await getFinanceDb();

    // 0. Create user_stock_watchlists if it doesn't exist (idempotent)
    db.prepare(`
      CREATE TABLE IF NOT EXISTS user_stock_watchlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT DEFAULT '',
        stock_id INTEGER,
        alert_price_above REAL,
        alert_price_below REAL,
        alert_change_percent REAL,
        notes TEXT,
        added_at TEXT DEFAULT (datetime('now')),
        last_viewed TEXT,
        view_count INTEGER DEFAULT 0
      )
    `).run();

    // 1. Add purchase_price and quantity columns to user_stock_watchlists
    const watchlistColumns = db
      .prepare("PRAGMA table_info(user_stock_watchlists)")
      .all() as { name: string }[];

    const columnNames = watchlistColumns.map((c) => c.name);

    if (!columnNames.includes('purchase_price')) {
      db.prepare('ALTER TABLE user_stock_watchlists ADD COLUMN purchase_price REAL DEFAULT NULL').run();
    }
    if (!columnNames.includes('quantity')) {
      db.prepare('ALTER TABLE user_stock_watchlists ADD COLUMN quantity INTEGER DEFAULT NULL').run();
    }

    // 2. Portfolio Assets table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS portfolio_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'stock',
        name TEXT NOT NULL,
        total_invested REAL NOT NULL DEFAULT 0,
        current_value REAL NOT NULL DEFAULT 0,
        notes TEXT,
        weight_grams REAL,
        karat INTEGER,
        purchase_price_per_gram REAL,
        bank_name TEXT,
        interest_rate REAL,
        certificate_duration_months INTEGER,
        certificate_return_rate REAL,
        certificate_maturity_date TEXT,
        fund_name TEXT,
        fund_type TEXT,
        stock_id INTEGER,
        stock_ticker TEXT,
        quantity REAL,
        avg_buy_price REAL,
        added_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();

    // 3. Financial Transactions (Income & Expenses) table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS financial_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT NOT NULL,
        is_recurring INTEGER DEFAULT 0,
        recurring_frequency TEXT,
        transaction_date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run();

    // 4. Financial Obligations table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS financial_obligations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        creditor TEXT NOT NULL DEFAULT '',
        total_amount REAL NOT NULL DEFAULT 0,
        remaining_amount REAL NOT NULL DEFAULT 0,
        monthly_payment REAL NOT NULL DEFAULT 0,
        interest_rate REAL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        next_payment_date TEXT,
        status TEXT DEFAULT 'active',
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();

    // 5. Obligation Payments table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS obligation_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        obligation_id INTEGER NOT NULL,
        user_id TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL,
        payment_date TEXT NOT NULL,
        principal_amount REAL DEFAULT 0,
        interest_amount REAL DEFAULT 0,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (obligation_id) REFERENCES financial_obligations(id)
      )
    `).run();

    // Force save to disk since CREATE TABLE doesn't trigger getRowsModified
    db.save();

    return NextResponse.json({
      success: true,
      message: 'All financial tracking tables created successfully',
      tables: [
        'user_stock_watchlists (enhanced)',
        'portfolio_assets',
        'financial_transactions',
        'financial_obligations',
        'obligation_payments',
      ],
    });
  } catch (error) {
    console.error('[POST /api/finance/schema] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create financial tracking tables' },
      { status: 500 }
    );
  }
}
