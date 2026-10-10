/**
 * instapay-db.ts — low-level SQLite database access for InstaPay submissions and verifications.
 *
 * Persisted in db/auth.db.
 * Creates table idempotently on first use.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { randomUUID } from 'crypto';
import { PAID_TIERS } from './subscription-gate';

let _db: Database.Database | null = null;
let _schemaReady = false;

export interface InstapayRecord {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  tier: string;
  market: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  sender_phone: string | null;
  receipt_url: string;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export function getAuthSqliteDb(): Database.Database {
  if (_db) return _db;
  const dbPath = path.join(process.cwd(), 'db', 'auth.db');
  _db = new Database(dbPath, { timeout: 8000 });
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 8000');
  return _db;
}

export function ensureInstapaySchema(): void {
  if (_schemaReady) return;
  const db = getAuthSqliteDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS instapay_payments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      user_name TEXT,
      tier TEXT NOT NULL,
      market TEXT NOT NULL DEFAULT 'egx',
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EGP',
      sender_phone TEXT,
      receipt_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      admin_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_instapay_user_email ON instapay_payments(user_email);
    CREATE INDEX IF NOT EXISTS idx_instapay_status ON instapay_payments(status);
    CREATE INDEX IF NOT EXISTS idx_instapay_created_at ON instapay_payments(created_at);
  `);

  _schemaReady = true;
}

/**
 * Insert a new InstaPay payment proof submission
 */
export function createInstapayPayment(data: {
  userId: string;
  userEmail: string;
  userName?: string | null;
  tier: string;
  market?: string;
  billingCycle?: string;
  amount: number;
  currency?: string;
  senderPhone?: string | null;
  receiptUrl: string;
  notes?: string | null;
}): InstapayRecord {
  ensureInstapaySchema();
  const db = getAuthSqliteDb();

  const id = randomUUID();
  const now = new Date().toISOString();

  const record: InstapayRecord = {
    id,
    user_id: data.userId,
    user_email: data.userEmail.toLowerCase().trim(),
    user_name: data.userName || null,
    tier: data.tier.toLowerCase().trim(),
    market: (data.market || 'egx').toLowerCase().trim(),
    billing_cycle: (data.billingCycle || 'monthly').toLowerCase().trim(),
    amount: data.amount,
    currency: (data.currency || 'EGP').toUpperCase().trim(),
    sender_phone: data.senderPhone?.trim() || null,
    receipt_url: data.receiptUrl,
    status: 'pending',
    notes: data.notes?.trim() || null,
    admin_notes: null,
    created_at: now,
    updated_at: now,
    reviewed_at: null,
    reviewed_by: null,
  };

  const stmt = db.prepare(`
    INSERT INTO instapay_payments (
      id, user_id, user_email, user_name, tier, market, billing_cycle,
      amount, currency, sender_phone, receipt_url, status, notes,
      admin_notes, created_at, updated_at, reviewed_at, reviewed_by
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    record.id,
    record.user_id,
    record.user_email,
    record.user_name,
    record.tier,
    record.market,
    record.billing_cycle,
    record.amount,
    record.currency,
    record.sender_phone,
    record.receipt_url,
    record.status,
    record.notes,
    record.admin_notes,
    record.created_at,
    record.updated_at,
    record.reviewed_at,
    record.reviewed_by
  );

  return record;
}

/**
 * List InstaPay submissions with optional status filter
 */
export function getInstapayPayments(filter?: { status?: string; limit?: number; offset?: number }): {
  payments: InstapayRecord[];
  total: number;
  counts: { pending: number; approved: number; rejected: number; total: number };
} {
  ensureInstapaySchema();
  const db = getAuthSqliteDb();

  const countsRow = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
    FROM instapay_payments
  `).get() as any;

  const counts = {
    total: countsRow?.total || 0,
    pending: countsRow?.pending || 0,
    approved: countsRow?.approved || 0,
    rejected: countsRow?.rejected || 0,
  };

  const limit = filter?.limit || 50;
  const offset = filter?.offset || 0;

  let query = 'SELECT * FROM instapay_payments';
  const params: any[] = [];

  if (filter?.status && filter.status !== 'all') {
    query += ' WHERE status = ?';
    params.push(filter.status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const payments = db.prepare(query).all(...params) as InstapayRecord[];

  return {
    payments,
    total: counts.total,
    counts,
  };
}

/**
 * Get single InstaPay payment by ID
 */
export function getInstapayPaymentById(id: string): InstapayRecord | null {
  ensureInstapaySchema();
  const db = getAuthSqliteDb();
  return (db.prepare('SELECT * FROM instapay_payments WHERE id = ?').get(id) as InstapayRecord) || null;
}

/**
 * Approve InstaPay payment:
 * 1. Updates payment status to 'approved'
 * 2. Immediately upgrades User.subscription_tier in auth.db
 * 3. Immediately upserts UserSubscription row in auth.db with future expiration
 */
export async function approveInstapayPayment(
  paymentId: string,
  adminEmail: string,
  adminNotes?: string
): Promise<{ success: boolean; error?: string; payment?: InstapayRecord }> {
  ensureInstapaySchema();
  const db = getAuthSqliteDb();

  const payment = getInstapayPaymentById(paymentId);
  if (!payment) {
    return { success: false, error: 'طلب الدفع غير موجود' };
  }

  if (payment.status === 'approved') {
    return { success: false, error: 'الطلب مفعل وموافق عليه بالفعل' };
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // Duration: 1 year for yearly, 30 days for monthly
  const isYearly = payment.billing_cycle === 'yearly';
  const durationDays = isYearly ? 365 : 30;
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  const targetTier = payment.tier || 'premium';

  try {
    // Run all database operations in a transaction
    const updateTx = db.transaction(() => {
      // 1. Mark payment as approved
      db.prepare(`
        UPDATE instapay_payments
        SET status = 'approved',
            admin_notes = ?,
            reviewed_at = ?,
            reviewed_by = ?,
            updated_at = ?
        WHERE id = ?
      `).run(adminNotes || payment.admin_notes || null, nowIso, adminEmail, nowIso, paymentId);

      // Find real user in User table
      const userRow = db.prepare(`
        SELECT id FROM User WHERE id = ? OR LOWER(email) = LOWER(?)
      `).get(payment.user_id, payment.user_email) as any;

      const realUserId = userRow?.id || payment.user_id;

      // 2. Upgrade User in User table
      if (userRow) {
        db.prepare(`
          UPDATE User
          SET subscription_tier = ?,
              trial_ends_at = NULL,
              is_active = 1,
              updated_at = ?
          WHERE id = ?
        `).run(targetTier, nowIso, realUserId);
      }

      // Ensure SubscriptionPlan row exists to satisfy foreign key constraint
      db.prepare(`
        INSERT OR IGNORE INTO SubscriptionPlan (
          id, name, name_ar, price, features, max_watchlist, max_portfolio, max_alerts, is_active
        ) VALUES (?, ?, ?, ?, '[]', 9999, 9999, 9999, 1)
      `).run(targetTier, targetTier, targetTier, payment.amount);

      // 3. Upsert UserSubscription row if real user exists
      if (userRow) {
        const existingSub = db.prepare(`
          SELECT id FROM UserSubscription WHERE user_id = ?
        `).get(realUserId) as any;

        if (existingSub) {
          db.prepare(`
            UPDATE UserSubscription
            SET plan_id = ?,
                status = 'active',
                started_at = ?,
                expires_at = ?,
                payment_method = 'instapay',
                updated_at = ?
            WHERE user_id = ?
          `).run(targetTier, nowIso, expiresAt, nowIso, realUserId);
        } else {
          const subId = randomUUID();
          db.prepare(`
            INSERT INTO UserSubscription (
              id, user_id, plan_id, status, started_at, expires_at,
              trial_started_at, trial_ends_at, auto_renew, payment_method,
              created_at, updated_at
            ) VALUES (
              ?, ?, ?, 'active', ?, ?,
              NULL, NULL, 0, 'instapay',
              ?, ?
            )
          `).run(subId, realUserId, targetTier, nowIso, expiresAt, nowIso, nowIso);
        }
      }
    });

    updateTx();

    // 4. Invalidate memory cache so subscription gate immediately reflects active status
    try {
      const { invalidateSubStatusCache } = await import('./subscription-gate');
      if (typeof invalidateSubStatusCache === 'function') {
        invalidateSubStatusCache(payment.user_id);
      }
    } catch {
      // Non-fatal if cache invalidator not yet loaded
    }

    const updatedPayment = getInstapayPaymentById(paymentId);
    return { success: true, payment: updatedPayment || undefined };
  } catch (err: any) {
    console.error('[instapay-db] approve error:', err);
    return { success: false, error: err?.message || 'حدث خطأ أثناء الموافقة وتفعيل الاشتراك' };
  }
}

/**
 * Reject InstaPay payment
 */
export function rejectInstapayPayment(
  paymentId: string,
  adminEmail: string,
  reason: string
): { success: boolean; error?: string; payment?: InstapayRecord } {
  ensureInstapaySchema();
  const db = getAuthSqliteDb();

  const payment = getInstapayPaymentById(paymentId);
  if (!payment) {
    return { success: false, error: 'طلب الدفع غير موجود' };
  }

  const nowIso = new Date().toISOString();

  try {
    db.prepare(`
      UPDATE instapay_payments
      SET status = 'rejected',
          admin_notes = ?,
          reviewed_at = ?,
          reviewed_by = ?,
          updated_at = ?
      WHERE id = ?
    `).run(reason || 'لم يتم استلام المبلغ أو بيانات غير مطابقة', nowIso, adminEmail, nowIso, paymentId);

    const updatedPayment = getInstapayPaymentById(paymentId);
    return { success: true, payment: updatedPayment || undefined };
  } catch (err: any) {
    console.error('[instapay-db] reject error:', err);
    return { success: false, error: err?.message || 'فشل رفض الطلب' };
  }
}
