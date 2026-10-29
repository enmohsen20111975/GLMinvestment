import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/auth-helper';

/**
 * GET /api/trading-journal
 * =========================
 * Rule 50 (MONEY-AS-CUSTOMER-LIFE): journal entries are scoped to the
 * authenticated user. Previously this called `findMany({})` without a
 * `where: { user_id }` filter, leaking ALL trades from ALL users to any
 * logged-in account.
 *
 * Rule 27 (NO-FAKE-DATA): if the Prisma `tradingJournal` table is missing
 * (it currently is, per DB inspection) return an honest empty array +
 * `available: false` flag — never fabricated trades.
 */
export async function GET() {
  // ── Auth: fail closed if no session ─────────────────────────────────────
  const { userId } = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      {
        error: 'يجب تسجيل الدخول لعرض يومية التداول',
        trades: [],
        available: false,
      },
      { status: 401 }
    );
  }

  try {
    // Prisma's `tradingJournal` model is not defined in the current schema
    // (auth-schema.prisma). Calling `.findMany` on `undefined` throws a
    // TypeError. Detect that explicitly and return an honest empty state
    // rather than 500 — per Rule 27 (NO-FAKE-DATA) + Rule 50 (the table
    // being missing is an operational issue, not a customer problem).
    if (!(db as any).tradingJournal) {
      return NextResponse.json({
        trades: [],
        available: false,
        reason: 'trading_journal table not provisioned for this user yet',
      });
    }

    // Try to read user-scoped trades. If the Prisma model/table is missing,
    // this throws — we catch and return empty list (Rule 27).
    const trades = await (db as any).tradingJournal.findMany({
      where: { user_id: userId },
      orderBy: { entry_date: 'desc' },
    });

    return NextResponse.json({ trades, available: true });
  } catch (error: any) {
    console.error('[/api/trading-journal] Error fetching trades:', error?.message || error);
    // P2003 / P2021 = Prisma: table or relation does not exist.
    const isMissingTable =
      error?.code === 'P2021' ||
      error?.code === 'P2003' ||
      /does not exist|no such table|relation|Cannot read prop/i.test(error?.message || '');

    if (isMissingTable) {
      // Honest empty state — do NOT fabricate trades (Rule 27).
      return NextResponse.json({
        trades: [],
        available: false,
        reason: 'trading_journal table not provisioned for this user yet',
      });
    }
    return NextResponse.json(
      { error: 'Failed to fetch trades', trades: [] },
      { status: 500 }
    );
  }
}

// POST - إضافة صفقة جديدة
export async function POST(request: NextRequest) {
  // ── Auth: fail closed if no session ─────────────────────────────────────
  const { userId } = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { error: 'يجب تسجيل الدخول لتسجيل صفقة' },
      { status: 401 }
    );
  }

  try {
    const data = await request.json();

    // Same guard as GET — the Prisma model may not exist.
    if (!(db as any).tradingJournal) {
      return NextResponse.json(
        {
          error: 'يومية التداول غير مفعّلة حالياً. تواصل مع الإدارة لتفعيلها.',
          reason: 'trading_journal table not provisioned',
        },
        { status: 503 }
      );
    }

    // حساب الربح/الخسارة إذا كان سعر الخروج موجود
    let profit_loss: number | null = null;
    let profit_loss_pct: number | null = null;
    let result = 'OPEN';

    if (data.exit_price && data.exit_price > 0) {
      const entryValue = data.quantity * data.entry_price;
      const exitValue = data.quantity * data.exit_price;
      profit_loss = exitValue - entryValue;
      profit_loss_pct = ((data.exit_price - data.entry_price) / data.entry_price) * 100;
      result = profit_loss_pct! >= 0 ? 'WIN' : 'LOSS';
    }

    const trade = await (db as any).tradingJournal.create({
      data: {
        user_id: userId,                // ← always scope to current user
        stock_symbol: data.stock_symbol,
        stock_name: data.stock_name || null,
        trade_type: data.trade_type || 'BUY',
        quantity: data.quantity,
        entry_price: data.entry_price,
        exit_price: data.exit_price || null,
        entry_date: data.entry_date || new Date().toISOString().split('T')[0],
        exit_date: data.exit_date || null,
        profit_loss,
        profit_loss_pct,
        notes: data.notes || null,
        strategy: data.strategy || null,
        result
      }
    });

    return NextResponse.json({ trade });
  } catch (error) {
    console.error('Error creating trade:', error);
    return NextResponse.json({ error: 'Failed to create trade' }, { status: 500 });
  }
}
