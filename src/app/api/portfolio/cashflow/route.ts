/**
 * GET /api/portfolio/cashflow
 * ============================
 * User cashflow history (deposits / withdrawals / dividends) for the Flutter
 * Android app.
 *
 * Tries the `portfolio_transactions` table in `db/stocks.db` first (the schema
 * is created on-demand by other portfolio routes). If the table does not
 * exist OR is empty for this user, we fall back to the legacy
 * `financial_transactions` table. If neither yields rows, we return 200 with
 * `cashflow: []` (per task spec — NEVER 500 just because the table is empty).
 *
 * Auth: required (getSessionUserId). Returns 401 if no userId.
 *
 * Query params:
 *   ?limit=N    — default 100
 *   ?type=deposit|withdrawal|dividend|fee — optional filter
 *
 * Returns:
 *   {
 *     success: true,
 *     source: "stocks.db" | "empty",
 *     cashflow: [{ id, type, amount, currency, description, date }],
 *     totals: { deposits_egp, withdrawals_egp, dividends_egp, fees_egp, net_egp }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { getSessionUserId } from '@/lib/auth-helper';

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      error: 'مطلوب تسجيل الدخول',
      error_en: 'Authentication required',
    },
    { status: 401 }
  );
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    )
    .get(name) as { name: string } | undefined;
  return !!row;
}

interface CashflowRow {
  id: string | number;
  type: string;
  amount: number;
  currency: string;
  description: string | null;
  date: string | null;
}

interface Totals {
  deposits_egp: number;
  withdrawals_egp: number;
  dividends_egp: number;
  fees_egp: number;
  net_egp: number;
}

function emptyTotals(): Totals {
  return {
    deposits_egp: 0,
    withdrawals_egp: 0,
    dividends_egp: 0,
    fees_egp: 0,
    net_egp: 0,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) return unauthorized();

    const { searchParams } = new URL(req.url);
    const reqLimit = parseInt(searchParams.get('limit') || '100', 10);
    const limit = Number.isFinite(reqLimit)
      ? Math.min(Math.max(reqLimit, 1), 500)
      : 100;
    const typeFilter = searchParams.get('type');

    const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({
        success: true,
        source: 'empty',
        cashflow: [],
        totals: emptyTotals(),
        message: 'stocks.db غير متاح',
      });
    }

    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
    } catch { // silent fallback (safe-by-design)
      return NextResponse.json({
        success: true,
        source: 'empty',
        cashflow: [],
        totals: emptyTotals(),
        message: 'تعذّر فتح stocks.db',
      });
    }

    try {
      // 1. Try the canonical portfolio_transactions table.
      if (tableExists(db, 'portfolio_transactions')) {
        const conditions: string[] = ['user_id = ?'];
        const params: unknown[] = [userId];
        if (typeFilter) {
          conditions.push('type = ?');
          params.push(typeFilter);
        }
        const where = 'WHERE ' + conditions.join(' AND ');
        const rows = db
          .prepare(
            `SELECT id, user_id, type, amount, currency, description,
                    transaction_date, created_at
             FROM portfolio_transactions ${where}
             ORDER BY transaction_date DESC, created_at DESC
             LIMIT ?`
          )
          .all(...params, limit) as Array<Record<string, unknown>>;

        const totals = emptyTotals();
        const cashflow: CashflowRow[] = rows.map((r) => {
          const t = String(r.type || 'other').toLowerCase();
          const amt = Number(r.amount) || 0;
          if (t === 'deposit' || t === 'deposit_in') {
            totals.deposits_egp += amt;
            totals.net_egp += amt;
          } else if (t === 'withdrawal' || t === 'withdraw') {
            totals.withdrawals_egp += amt;
            totals.net_egp -= amt;
          } else if (t === 'dividend') {
            totals.dividends_egp += amt;
            totals.net_egp += amt;
          } else if (t === 'fee' || t === 'commission') {
            totals.fees_egp += amt;
            totals.net_egp -= amt;
          }
          return {
            id: r.id as string | number,
            type: t,
            amount: amt,
            currency: (r.currency as string) || 'EGP',
            description: (r.description as string) || null,
            date:
              (r.transaction_date as string) ||
              (r.created_at as string) ||
              null,
          };
        });

        db.close();
        return NextResponse.json({
          success: true,
          source: 'stocks.db.portfolio_transactions',
          cashflow,
          totals: {
            deposits_egp: Number(totals.deposits_egp.toFixed(2)),
            withdrawals_egp: Number(totals.withdrawals_egp.toFixed(2)),
            dividends_egp: Number(totals.dividends_egp.toFixed(2)),
            fees_egp: Number(totals.fees_egp.toFixed(2)),
            net_egp: Number(totals.net_egp.toFixed(2)),
          },
          generated_at: new Date().toISOString(),
        });
      }

      // 2. Fallback to financial_transactions (legacy schema, may not exist).
      if (tableExists(db, 'financial_transactions')) {
        const conditions: string[] = ['user_id = ?'];
        const params: unknown[] = [userId];
        if (typeFilter) {
          conditions.push('type = ?');
          params.push(typeFilter);
        }
        const where = 'WHERE ' + conditions.join(' AND ');
        const rows = db
          .prepare(
            `SELECT id, user_id, type, category, amount, description,
                    transaction_date, created_at
             FROM financial_transactions ${where}
             ORDER BY transaction_date DESC, created_at DESC
             LIMIT ?`
          )
          .all(...params, limit) as Array<Record<string, unknown>>;

        const totals = emptyTotals();
        const cashflow: CashflowRow[] = rows.map((r) => {
          const t = String(r.type || 'other').toLowerCase();
          const amt = Number(r.amount) || 0;
          if (t === 'income' || t === 'deposit') {
            totals.deposits_egp += amt;
            totals.net_egp += amt;
          } else if (t === 'expense' || t === 'withdrawal') {
            totals.withdrawals_egp += amt;
            totals.net_egp -= amt;
          } else if (t === 'dividend') {
            totals.dividends_egp += amt;
            totals.net_egp += amt;
          } else if (t === 'fee') {
            totals.fees_egp += amt;
            totals.net_egp -= amt;
          }
          return {
            id: r.id as string | number,
            type: t,
            amount: amt,
            currency: 'EGP',
            description:
              (r.description as string) || (r.category as string) || null,
            date:
              (r.transaction_date as string) ||
              (r.created_at as string) ||
              null,
          };
        });

        db.close();
        return NextResponse.json({
          success: true,
          source: 'stocks.db.financial_transactions',
          cashflow,
          totals: {
            deposits_egp: Number(totals.deposits_egp.toFixed(2)),
            withdrawals_egp: Number(totals.withdrawals_egp.toFixed(2)),
            dividends_egp: Number(totals.dividends_egp.toFixed(2)),
            fees_egp: Number(totals.fees_egp.toFixed(2)),
            net_egp: Number(totals.net_egp.toFixed(2)),
          },
          generated_at: new Date().toISOString(),
        });
      }

      // 3. Neither table exists — return 200 with empty list (per spec).
      db.close();
      return NextResponse.json({
        success: true,
        source: 'empty',
        cashflow: [],
        totals: emptyTotals(),
        message: 'لا توجد حركة نقدية مسجّلة بعد',
      });
    } catch (queryErr) {
      try {
        db.close();
      } catch { // silent fallback (safe-by-design)
        /* ignore */
      }
      console.error('[portfolio/cashflow] query error:', queryErr);
      // Per task spec: if no cashflow table, return empty list with 200.
      return NextResponse.json({
        success: true,
        source: 'empty',
        cashflow: [],
        totals: emptyTotals(),
        message: 'تعذّر قراءة جدول حركة النقد — قد لا يكون موجوداً',
      });
    }
  } catch (err) {
    console.error('[portfolio/cashflow] fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
      },
      { status: 500 }
    );
  }
}
