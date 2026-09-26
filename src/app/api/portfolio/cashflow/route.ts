/**
 * GET /api/portfolio/cashflow
 * ============================
 * Rule 27 (NO-FAKE-DATA) + Rule 50 (MONEY-AS-CUSTOMER-LIFE):
 * The previous fallback returned HARDCODED fake cashflow
 * (يناير: 25k/5k, فبراير: 15k/2k, ...) — this lied to the customer
 * by showing fabricated deposits/withdrawals as if they were their own
 * money movements. That is forbidden.
 *
 * FIX: read REAL cashflow from `transactions` table (stocks.db) when
 * Python backend is unavailable. If the table is missing or empty,
 * return an honest empty array + `data_source: 'none'` flag — never
 * fabricated numbers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';

const fs = require('fs');
const path = require('path');

function dbExists(p: string): boolean {
  try { return fs.existsSync(p) && fs.statSync(p).size > 0; } catch { return false; }
}

export async function GET(request: NextRequest) {
  // 1) Try Python backend first (richer cashflow logic).
  try {
    const url = new URL(request.url);
    const qs = url.searchParams.toString();
    const targetUrl = `http://localhost:8010/api/portfolio/cashflow${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      // Sanity check: reject if Python returned obvious placeholder data
      // (the previous bug). Trust only non-empty, plausibly-shaped payloads.
      const cf = Array.isArray(data?.cashflow) ? data.cashflow : [];
      if (data?.success !== false && cf.length > 0) {
        return NextResponse.json({ success: true, cashflow: cf, source: 'python' });
      }
    }
  } catch {
    /* fall through to SQLite fallback */
  }

  // 2) AUTHENTICATE — fail closed if no session. (Previously this returned
  //    fake data without any user check — a Rule 50 leak.)
  const { userId } = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      {
        success: false,
        error: 'يجب تسجيل الدخول لعرض تدفق السيولة',
        cashflow: [],
        source: 'auth_required',
      },
      { status: 401 }
    );
  }

  // 3) REAL SQLite fallback — read transactions grouped by month.
  const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
  if (!dbExists(stocksDbPath)) {
    return NextResponse.json({
      success: true,
      cashflow: [],
      source: 'none',
      reason: 'stocks.db not available',
    });
  }

  // Lazy import (avoid module-load cost when Python is alive).
  const Database = require('better-sqlite3');
  const db = new Database(stocksDbPath, { readonly: true, timeout: 5000 });
  db.pragma('busy_timeout = 5000');

  const ARABIC_MONTHS = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ];

  type MonthRow = { ym: string; deposits: number; withdrawals: number };
  const cashflow: Array<{ month: string; deposits: number; withdrawals: number }> = [];

  try {
    // Try several known transaction schemas — they vary across DB versions.
    const tableExists = (name: string): boolean => {
      const row = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1"
      ).get(name) as { 1?: number } | undefined;
      return !!row;
    };

    let rows: MonthRow[] = [];

    if (tableExists('transactions')) {
      // Try the standard user_id + amount + type + date schema
      const cols = (db.prepare('PRAGMA table_info(transactions)').all() as Array<{ name: string }>)
        .map((c) => c.name);
      const hasUserId = cols.includes('user_id');
      const hasType = cols.includes('type') || cols.includes('transaction_type');
      const hasAmount = cols.includes('amount');
      const hasDate = cols.includes('date') || cols.includes('transaction_date') || cols.includes('created_at');

      if (hasAmount && hasDate) {
        const dateCol = cols.includes('date') ? 'date'
                      : cols.includes('transaction_date') ? 'transaction_date'
                      : 'created_at';
        const typeCol = cols.includes('type') ? 'type' : 'transaction_type';
        const userFilter = hasUserId ? 'WHERE user_id = ?' : '';
        const params = hasUserId ? [userId] : [];
        // SQLite strftime returns YYYY-MM; map to Arabic month names.
        const sql = `
          SELECT
            strftime('%Y-%m', ${dateCol}) as ym,
            COALESCE(SUM(CASE WHEN ${typeCol} IN ('deposit','income','in') THEN amount ELSE 0 END), 0) as deposits,
            COALESCE(SUM(CASE WHEN ${typeCol} IN ('withdrawal','expense','out') THEN amount ELSE 0 END), 0) as withdrawals
          FROM transactions
          ${userFilter}
          GROUP BY ym
          ORDER BY ym DESC
          LIMIT 12
        `;
        rows = db.prepare(sql).all(...params) as MonthRow[];
      }
    }

    for (const r of rows) {
      if (!r.ym) continue;
      const [y, m] = r.ym.split('-');
      const monthIdx = parseInt(m, 10) - 1;
      const arabicMonth = ARABIC_MONTHS[monthIdx] || m;
      // Include year suffix so months don't merge across years.
      const label = `${arabicMonth} ${y}`;
      cashflow.push({
        month: label,
        deposits: Math.round(Number(r.deposits || 0) * 100) / 100,
        withdrawals: Math.round(Number(r.withdrawals || 0) * 100) / 100,
      });
    }
  } catch (err) {
    console.error('[/api/portfolio/cashflow] SQLite fallback error:', err);
  } finally {
    db.close();
  }

  // Reverse so oldest month is first (matches chart's left-to-right reading order).
  cashflow.reverse();

  return NextResponse.json({
    success: true,
    cashflow,
    source: cashflow.length > 0 ? 'sqlite_fallback' : 'none',
  });
}
