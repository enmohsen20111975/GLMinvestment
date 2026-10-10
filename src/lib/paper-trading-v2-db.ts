/**
 * paper-trading-v2-db.ts — Live Paper Trading Database Helper
 * ============================================================
 * P40-Academy: محرك التداول الورقي الحي للمستخدم.
 *
 * Database: db/paper_trading.db (better-sqlite3, separate from other DBs)
 *
 * Tables (auto-created on first access):
 *   - paper_trading_accounts  (one per user, default 100,000 EGP virtual balance)
 *   - paper_trading_orders    (open + closed orders with stop_loss / take_profit)
 *
 * Uses getSessionUserId() from @/lib/auth-helper for user scoping.
 * Falls back to userId 'guest' when no session (so the simulator works
 * even without login — useful for demos and the academy).
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { getSessionUserId } from '@/lib/auth-helper';

const DB_DIR = path.join(process.cwd(), 'db');
const DB_PATH = path.join(DB_DIR, 'paper_trading.db');

const DEFAULT_VIRTUAL_BALANCE = 100_000.0;

// ==================== SCHEMA ====================

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS paper_trading_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  virtual_balance REAL DEFAULT ${DEFAULT_VIRTUAL_BALANCE},
  total_equity REAL DEFAULT ${DEFAULT_VIRTUAL_BALANCE},
  starting_balance REAL DEFAULT ${DEFAULT_VIRTUAL_BALANCE},
  total_pnl REAL DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS paper_trading_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'stock',  -- 'stock' | 'crypto' | 'gold'
  order_type TEXT NOT NULL,                    -- 'BUY' | 'SELL'
  shares REAL NOT NULL,
  entry_price REAL NOT NULL,
  stop_loss REAL,
  take_profit REAL,
  status TEXT NOT NULL DEFAULT 'OPEN',         -- 'OPEN' | 'CLOSED' | 'CANCELLED'
  pnl REAL DEFAULT 0,
  close_price REAL,
  close_reason TEXT,                            -- 'MANUAL' | 'STOP_LOSS' | 'TAKE_PROFIT'
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_pto_user_status ON paper_trading_orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_pto_user_opened ON paper_trading_orders(user_id, opened_at DESC);
`;

// ==================== CONNECTION ====================

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db && _db.open) return _db;
  // Ensure the db dir exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  const db = new Database(DB_PATH, { timeout: 5000 });
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  _db = db;
  return db;
}

// ==================== TYPES ====================

export interface PaperTradingAccount {
  id: number;
  user_id: string;
  virtual_balance: number;
  total_equity: number;
  starting_balance: number;
  total_pnl: number;
  total_trades: number;
  winning_trades: number;
  created_at: string;
  updated_at: string;
}

export interface PaperTradingOrder {
  id: number;
  user_id: string;
  ticker: string;
  asset_type: string;
  order_type: string;
  shares: number;
  entry_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  status: string;
  pnl: number;
  close_price: number | null;
  close_reason: string | null;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
}

export interface OpenPosition extends PaperTradingOrder {
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  position_value: number;
}

// ==================== USER RESOLUTION ====================

/**
 * Get the current user's ID for paper trading.
 * Falls back to 'guest' if not logged in — so the academy simulator
 * works even without authentication.
 */
export async function getPaperTradingUserId(): Promise<string> {
  try {
    const { userId } = await getSessionUserId();
    if (userId) return userId;
  } catch { // silent fallback (safe-by-design)
    /* fall through to guest */
  }
  return 'guest';
}

// ==================== ACCOUNT OPERATIONS ====================

export function getOrCreateAccount(userId: string): PaperTradingAccount {
  const db = getDb();
  // Try to fetch existing
  const existing = db
    .prepare('SELECT * FROM paper_trading_accounts WHERE user_id = ?')
    .get(userId) as PaperTradingAccount | undefined;
  if (existing) return existing;
  // Create new with default balance
  const stmt = db.prepare(`
    INSERT INTO paper_trading_accounts (user_id, virtual_balance, total_equity, starting_balance)
    VALUES (?, ?, ?, ?)
  `);
  const info = stmt.run(userId, DEFAULT_VIRTUAL_BALANCE, DEFAULT_VIRTUAL_BALANCE, DEFAULT_VIRTUAL_BALANCE);
  return db.prepare('SELECT * FROM paper_trading_accounts WHERE id = ?').get(info.lastInsertRowid) as PaperTradingAccount;
}

export function resetAccount(userId: string): PaperTradingAccount {
  const db = getDb();
  // Close all open orders first (cancel them)
  db.prepare(`
    UPDATE paper_trading_orders
    SET status = 'CANCELLED', closed_at = CURRENT_TIMESTAMP, close_reason = 'RESET'
    WHERE user_id = ? AND status = 'OPEN'
  `).run(userId);
  // Reset account
  db.prepare(`
    UPDATE paper_trading_accounts
    SET virtual_balance = ?, total_equity = ?, starting_balance = ?,
        total_pnl = 0, total_trades = 0, winning_trades = 0, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(DEFAULT_VIRTUAL_BALANCE, DEFAULT_VIRTUAL_BALANCE, DEFAULT_VIRTUAL_BALANCE, userId);
  return getOrCreateAccount(userId);
}

// ==================== ORDER OPERATIONS ====================

export interface PlaceOrderInput {
  ticker: string;
  asset_type: 'stock' | 'crypto' | 'gold';
  order_type: 'BUY' | 'SELL';
  shares: number;
  entry_price: number;
  stop_loss?: number | null;
  take_profit?: number | null;
  notes?: string | null;
}

/**
 * Place a new paper trading order. Validates that the user has enough
 * virtual balance for BUY orders. For SELL orders, validates that the
 * user has an open BUY position with enough shares.
 */
export function placeOrder(userId: string, input: PlaceOrderInput): PaperTradingOrder {
  const db = getDb();
  const account = getOrCreateAccount(userId);

  if (input.shares <= 0 || input.entry_price <= 0) {
    throw new Error('الكمية والسعر يجب أن يكونا أكبر من صفر');
  }

  const orderValue = input.shares * input.entry_price;

  if (input.order_type === 'BUY') {
    if (orderValue > account.virtual_balance) {
      throw new Error(`رصيد وهمي غير كافٍ. المتاح: ${account.virtual_balance.toFixed(2)} ج.م`);
    }
    // Deduct from virtual balance
    db.prepare(`
      UPDATE paper_trading_accounts
      SET virtual_balance = virtual_balance - ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(orderValue, userId);
  } else {
    // SELL: check we have enough open BUY shares for this ticker
    const openPosition = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN order_type = 'BUY' THEN shares ELSE -shares END), 0) AS net_shares
      FROM paper_trading_orders
      WHERE user_id = ? AND ticker = ? AND status = 'OPEN'
    `).get(userId, input.ticker) as { net_shares: number };
    if (openPosition.net_shares < input.shares) {
      throw new Error(`لا توجد كمية كافية للبيع. المتاح: ${openPosition.net_shares} سهم`);
    }
    // Credit virtual balance
    db.prepare(`
      UPDATE paper_trading_accounts
      SET virtual_balance = virtual_balance + ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(orderValue, userId);
  }

  // Insert the order
  const info = db.prepare(`
    INSERT INTO paper_trading_orders
      (user_id, ticker, asset_type, order_type, shares, entry_price, stop_loss, take_profit, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
  `).run(
    userId, input.ticker, input.asset_type, input.order_type,
    input.shares, input.entry_price, input.stop_loss ?? null,
    input.take_profit ?? null, input.notes ?? null,
  );
  return db.prepare('SELECT * FROM paper_trading_orders WHERE id = ?').get(info.lastInsertRowid) as PaperTradingOrder;
}

/**
 * Close an open order at the given current price.
 * Computes realized P&L and credits/debits the virtual balance.
 */
export function closeOrder(
  userId: string,
  orderId: number,
  currentPrice: number,
  reason: 'MANUAL' | 'STOP_LOSS' | 'TAKE_PROFIT' = 'MANUAL',
): PaperTradingOrder {
  const db = getDb();
  const order = db
    .prepare('SELECT * FROM paper_trading_orders WHERE id = ? AND user_id = ? AND status = \'OPEN\'')
    .get(orderId, userId) as PaperTradingOrder | undefined;
  if (!order) {
    throw new Error('الصفقة غير موجودة أو مغلقة بالفعل');
  }
  if (currentPrice <= 0) {
    throw new Error('السعر الحالي غير صالح');
  }

  // Compute P&L
  // For BUY: pnl = (current - entry) * shares
  // For SELL (short): pnl = (entry - current) * shares
  const pnl = order.order_type === 'BUY'
    ? (currentPrice - order.entry_price) * order.shares
    : (order.entry_price - currentPrice) * order.shares;

  // Credit/debit virtual balance (return proceeds)
  const proceeds = order.shares * currentPrice;
  db.prepare(`
    UPDATE paper_trading_accounts
    SET virtual_balance = virtual_balance + ?,
        total_pnl = total_pnl + ?,
        total_trades = total_trades + 1,
        winning_trades = winning_trades + ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(proceeds, pnl, pnl > 0 ? 1 : 0, userId);

  // Update the order
  db.prepare(`
    UPDATE paper_trading_orders
    SET status = 'CLOSED', pnl = ?, close_price = ?, close_reason = ?, closed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(pnl, currentPrice, reason, orderId);

  return db.prepare('SELECT * FROM paper_trading_orders WHERE id = ?').get(orderId) as PaperTradingOrder;
}

/**
 * Get all open orders for a user.
 */
export function getOpenOrders(userId: string): PaperTradingOrder[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM paper_trading_orders WHERE user_id = ? AND status = \'OPEN\' ORDER BY opened_at DESC')
    .all(userId) as PaperTradingOrder[];
}

/**
 * Get recent closed orders (limit 50).
 */
export function getClosedOrders(userId: string, limit = 50): PaperTradingOrder[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM paper_trading_orders WHERE user_id = ? AND status = \'CLOSED\' ORDER BY closed_at DESC LIMIT ?')
    .all(userId, limit) as PaperTradingOrder[];
}

/**
 * Get all orders (open + closed) — used for the trade history.
 */
export function getAllOrders(userId: string, limit = 100): PaperTradingOrder[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM paper_trading_orders WHERE user_id = ? ORDER BY opened_at DESC LIMIT ?')
    .all(userId, limit) as PaperTradingOrder[];
}

/**
 * Recompute total_equity = virtual_balance + sum(market_value of open positions).
 * Called after price updates to keep the equity figure fresh.
 */
export function recomputeEquity(userId: string, livePrices: Record<string, number>): PaperTradingAccount {
  const db = getDb();
  const account = getOrCreateAccount(userId);
  const openOrders = getOpenOrders(userId);
  let openPositionsValue = 0;
  for (const o of openOrders) {
    const price = livePrices[o.ticker] ?? o.entry_price;
    if (o.order_type === 'BUY') {
      openPositionsValue += o.shares * price;
    }
    // For SELL (short) positions, they don't add to equity (they're liabilities)
  }
  const totalEquity = account.virtual_balance + openPositionsValue;
  db.prepare(`
    UPDATE paper_trading_accounts SET total_equity = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?
  `).run(totalEquity, userId);
  return db.prepare('SELECT * FROM paper_trading_accounts WHERE user_id = ?').get(userId) as PaperTradingAccount;
}

// ==================== AUTO STOP-LOSS / TAKE-PROFIT CHECK ====================

/**
 * Check all open orders for a user against current prices.
 * Auto-closes any order whose stop_loss or take_profit has been hit.
 * Returns the list of closed orders (for UI notification).
 */
export function checkAutoCloseTriggers(
  userId: string,
  livePrices: Record<string, number>,
): Array<{ order: PaperTradingOrder; closePrice: number; reason: 'STOP_LOSS' | 'TAKE_PROFIT' }> {
  const openOrders = getOpenOrders(userId);
  const closed: Array<{ order: PaperTradingOrder; closePrice: number; reason: 'STOP_LOSS' | 'TAKE_PROFIT' }> = [];
  for (const order of openOrders) {
    const price = livePrices[order.ticker];
    if (price == null) continue;
    let triggered: { price: number; reason: 'STOP_LOSS' | 'TAKE_PROFIT' } | null = null;
    if (order.order_type === 'BUY') {
      // BUY: stop_loss below entry, take_profit above entry
      if (order.stop_loss != null && price <= order.stop_loss) {
        triggered = { price: order.stop_loss, reason: 'STOP_LOSS' };
      } else if (order.take_profit != null && price >= order.take_profit) {
        triggered = { price: order.take_profit, reason: 'TAKE_PROFIT' };
      }
    } else {
      // SELL (short): stop_loss above entry, take_profit below entry
      if (order.stop_loss != null && price >= order.stop_loss) {
        triggered = { price: order.stop_loss, reason: 'STOP_LOSS' };
      } else if (order.take_profit != null && price <= order.take_profit) {
        triggered = { price: order.take_profit, reason: 'TAKE_PROFIT' };
      }
    }
    if (triggered) {
      try {
        const closedOrder = closeOrder(userId, order.id, triggered.price, triggered.reason);
        closed.push({ order: closedOrder, closePrice: triggered.price, reason: triggered.reason });
      } catch { // silent fallback (safe-by-design)
        /* skip — order might have been closed by a concurrent request */
      }
    }
  }
  return closed;
}
