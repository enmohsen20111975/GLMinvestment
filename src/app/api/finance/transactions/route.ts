import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import type { TransactionType } from '@/types';
import { getSessionUserId } from '@/lib/auth-helper';

// ---------------------------------------------------------------------------
// GET    /api/finance/transactions  — Fetch transactions (or summary)
// POST   /api/finance/transactions  — Add transaction
// PUT    /api/finance/transactions  — Update transaction
// DELETE /api/finance/transactions  — Delete transaction
// ---------------------------------------------------------------------------

const VALID_TRANSACTION_TYPES: TransactionType[] = ['income', 'expense'];

// ---------------------------------------------------------------------------
// GET — Fetch transactions with optional filters
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: true, items: [], total: 0 });
    }

    const db = await getFinanceDb();

    const { searchParams } = new URL(request.url);
    const withSummary = searchParams.get('summary') === 'true';
    const typeFilter = searchParams.get('type');
    const yearFilter = searchParams.get('year');
    const monthFilter = searchParams.get('month');

    const whereClauses: string[] = ['user_id = ?'];
    const params: unknown[] = [userId!];

    if (typeFilter && VALID_TRANSACTION_TYPES.includes(typeFilter as TransactionType)) {
      whereClauses.push('type = ?');
      params.push(typeFilter);
    }

    if (yearFilter && /^\d{4}$/.test(yearFilter)) {
      whereClauses.push("strftime('%Y', transaction_date) = ?");
      params.push(yearFilter);
    }

    if (monthFilter && yearFilter && /^\d{1,2}$/.test(monthFilter)) {
      whereClauses.push("strftime('%m', transaction_date) = ?");
      params.push(monthFilter.padStart(2, '0'));
    }

    const whereSQL = whereClauses.join(' AND ');

    if (withSummary) {
      // Category breakdowns
      const incomeRows = db
        .prepare(
          `SELECT category, COALESCE(SUM(amount), 0) as total
           FROM financial_transactions
           WHERE user_id = ? AND type = 'income'
           ${yearFilter ? "AND strftime('%Y', transaction_date) = ?" : ''}
           GROUP BY category`
        )
        .all(...(yearFilter ? [userId!, yearFilter] : [userId!])) as { category: string; total: number }[];

      const expenseRows = db
        .prepare(
          `SELECT category, COALESCE(SUM(amount), 0) as total
           FROM financial_transactions
           WHERE user_id = ? AND type = 'expense'
           ${yearFilter ? "AND strftime('%Y', transaction_date) = ?" : ''}
           GROUP BY category`
        )
        .all(...(yearFilter ? [userId!, yearFilter] : [userId!])) as { category: string; total: number }[];

      const incomeByCategory: Record<string, number> = {};
      for (const row of incomeRows) {
        incomeByCategory[row.category] = Number(row.total.toFixed(2));
      }

      const expensesByCategory: Record<string, number> = {};
      for (const row of expenseRows) {
        expensesByCategory[row.category] = Number(row.total.toFixed(2));
      }

      const totalIncome = Object.values(incomeByCategory).reduce((s, v) => s + v, 0);
      const totalExpenses = Object.values(expensesByCategory).reduce((s, v) => s + v, 0);

      // Monthly trend (last 12 months)
      const trendRows = db
        .prepare(
          `SELECT
             strftime('%Y-%m', transaction_date) as month,
             SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
             SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expenses
           FROM financial_transactions
           WHERE user_id = ?
           AND transaction_date >= datetime('now', '-12 months')
           GROUP BY strftime('%Y-%m', transaction_date)
           ORDER BY month ASC`
        )
        .all(userId!) as { month: string; income: number; expenses: number }[];

      const monthlyTrend = trendRows.map((row) => ({
        month: row.month,
        income: Number(row.income.toFixed(2)),
        expenses: Number(row.expenses.toFixed(2)),
      }));

      return NextResponse.json({
        success: true,
        summary: {
          total_income: Number(totalIncome.toFixed(2)),
          total_expenses: Number(totalExpenses.toFixed(2)),
          net_savings: Number((totalIncome - totalExpenses).toFixed(2)),
          income_by_category: incomeByCategory,
          expenses_by_category: expensesByCategory,
          monthly_trend: monthlyTrend,
        },
      });
    }

    // Regular list query
    const rows = db
      .prepare(
        `SELECT * FROM financial_transactions
         WHERE ${whereSQL}
         ORDER BY transaction_date DESC`
      )
      .all(...params) as Record<string, unknown>[];

    return NextResponse.json({
      success: true,
      items: rows.map((row) => ({
        ...row,
        is_recurring: row.is_recurring === 1,
      })),
      total: rows.length,
    });
  } catch (error) {
    console.error('[GET /api/finance/transactions] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error reading transactions' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — Add transaction
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const db = await getFinanceDb();

    const body = await request.json();
    const { type, category, amount, description, transaction_date, is_recurring, recurring_frequency, notes } = body;

    if (!type || !VALID_TRANSACTION_TYPES.includes(type)) {
      return NextResponse.json(
        { success: false, error: `Valid transaction type is required (${VALID_TRANSACTION_TYPES.join(', ')})` },
        { status: 400 }
      );
    }

    if (!category || typeof category !== 'string' || category.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Category is required' },
        { status: 400 }
      );
    }

    if (amount === undefined || amount === null || Number(amount) <= 0) {
      return NextResponse.json(
        { success: false, error: 'Amount must be greater than zero' },
        { status: 400 }
      );
    }

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Description is required' },
        { status: 400 }
      );
    }

    const txDate = transaction_date || new Date().toISOString().split('T')[0];

    const result = db
      .prepare(
        `INSERT INTO financial_transactions (
           user_id, type, category, amount, description,
           is_recurring, recurring_frequency, transaction_date, notes,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(
        userId!,
        type,
        category.trim(),
        Number(amount),
        description.trim(),
        is_recurring ? 1 : 0,
        recurring_frequency ?? null,
        txDate,
        notes ?? null
      );

    return NextResponse.json({
      success: true,
      message: 'Transaction added successfully',
      id: result.lastInsertRowid,
    });
  } catch (error) {
    console.error('[POST /api/finance/transactions] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error adding transaction' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT — Update transaction
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const db = await getFinanceDb();

    const body = await request.json();
    const { id } = body;

    if (!id || Number(id) <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid transaction ID is required' },
        { status: 400 }
      );
    }

    // Verify exists
    const existing = db
      .prepare('SELECT id FROM financial_transactions WHERE id = ? AND user_id = ?')
      .get(Number(id), userId!) as { id: number } | undefined;

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Transaction not found' },
        { status: 404 }
      );
    }

    const allowedFields = [
      'type', 'category', 'amount', 'description',
      'is_recurring', 'recurring_frequency', 'transaction_date', 'notes',
    ];

    const setClauses: string[] = [];
    const params: unknown[] = [];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (field === 'is_recurring') {
          setClauses.push(`${field} = ?`);
          params.push(body[field] ? 1 : 0);
        } else {
          setClauses.push(`${field} = ?`);
          params.push(body[field] === null ? null : body[field]);
        }
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No fields provided for update' },
        { status: 400 }
      );
    }

    params.push(Number(id));

    db.prepare(
      `UPDATE financial_transactions SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`
    ).run(...params, userId!);

    return NextResponse.json({
      success: true,
      message: 'Transaction updated successfully',
    });
  } catch (error) {
    console.error('[PUT /api/finance/transactions] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error updating transaction' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — Delete transaction
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const db = await getFinanceDb();

    const { searchParams } = new URL(request.url);
    const queryId = searchParams.get('id');

    let txId: number | null = null;

    if (queryId) {
      txId = Number(queryId);
    } else {
      try {
        const body = await request.json();
        txId = body.id ? Number(body.id) : null;
      } catch {
        // No body
      }
    }

    if (!txId || isNaN(txId) || txId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid transaction ID is required' },
        { status: 400 }
      );
    }

    // Verify exists
    const existing = db
      .prepare('SELECT id FROM financial_transactions WHERE id = ? AND user_id = ?')
      .get(txId, userId!) as { id: number } | undefined;

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Transaction not found' },
        { status: 404 }
      );
    }

    const result = db
      .prepare('DELETE FROM financial_transactions WHERE id = ? AND user_id = ?')
      .run(txId, userId!);

    if (result.changes === 0) {
      return NextResponse.json(
        { success: false, error: 'Failed to delete transaction' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Transaction deleted successfully',
      deleted_id: txId,
    });
  } catch (error) {
    console.error('[DELETE /api/finance/transactions] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error deleting transaction' },
      { status: 500 }
    );
  }
}
