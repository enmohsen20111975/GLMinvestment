import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import type { ObligationType } from '@/types';
import { getSessionUserId } from '@/lib/auth-helper';

// ---------------------------------------------------------------------------
// GET    /api/finance/obligations  — Fetch obligations
// POST   /api/finance/obligations  — Add obligation
// PUT    /api/finance/obligations  — Update obligation
// DELETE /api/finance/obligations  — Delete obligation
// ---------------------------------------------------------------------------

const VALID_OBLIGATION_TYPES: ObligationType[] = ['loan', 'installment', 'credit_card', 'mortgage'];
const VALID_STATUSES = ['active', 'paid', 'overdue'];

// ---------------------------------------------------------------------------
// GET — Fetch obligations with optional status filter
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: true, items: [], total: 0 });
    }

    const db = await getFinanceDb();

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status');

    let rows: Record<string, unknown>[];

    if (statusFilter && VALID_STATUSES.includes(statusFilter)) {
      rows = db
        .prepare(
          `SELECT * FROM financial_obligations
           WHERE user_id = ? AND status = ?
           ORDER BY next_payment_date ASC, start_date DESC`
        )
        .all(userId!, statusFilter) as Record<string, unknown>[];
    } else {
      rows = db
        .prepare(
          `SELECT * FROM financial_obligations
           WHERE user_id = ?
           ORDER BY status ASC, next_payment_date ASC, start_date DESC`
        )
        .all(userId!) as Record<string, unknown>[];
    }

    const totalRemaining = rows
      .filter((r) => r.status === 'active')
      .reduce((sum, r) => sum + (Number(r.remaining_amount) || 0), 0);

    const totalMonthlyPayments = rows
      .filter((r) => r.status === 'active')
      .reduce((sum, r) => sum + (Number(r.monthly_payment) || 0), 0);

    return NextResponse.json({
      success: true,
      items: rows,
      total: rows.length,
      summary: {
        total_remaining: Number(totalRemaining.toFixed(2)),
        total_monthly_payments: Number(totalMonthlyPayments.toFixed(2)),
        active_count: rows.filter((r) => r.status === 'active').length,
        overdue_count: rows.filter((r) => r.status === 'overdue').length,
        paid_count: rows.filter((r) => r.status === 'paid').length,
      },
    });
  } catch (error) {
    console.error('[GET /api/finance/obligations] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error reading obligations' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — Add obligation
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const db = await getFinanceDb();

    const body = await request.json();
    const { type, name, creditor, total_amount, remaining_amount, monthly_payment, start_date } = body;

    if (!type || !VALID_OBLIGATION_TYPES.includes(type)) {
      return NextResponse.json(
        { success: false, error: `Valid obligation type is required (${VALID_OBLIGATION_TYPES.join(', ')})` },
        { status: 400 }
      );
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Obligation name is required' },
        { status: 400 }
      );
    }

    if (total_amount === undefined || total_amount === null || Number(total_amount) <= 0) {
      return NextResponse.json(
        { success: false, error: 'Total amount must be greater than zero' },
        { status: 400 }
      );
    }

    if (!start_date || typeof start_date !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Start date is required' },
        { status: 400 }
      );
    }

    const result = db
      .prepare(
        `INSERT INTO financial_obligations (
           user_id, type, name, creditor, total_amount, remaining_amount,
           monthly_payment, interest_rate, start_date, end_date,
           next_payment_date, status, notes, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(
        userId!,
        type,
        name.trim(),
        (creditor || '').trim(),
        Number(total_amount),
        Number(remaining_amount ?? total_amount),
        Number(monthly_payment ?? 0),
        body.interest_rate ?? null,
        start_date,
        body.end_date ?? null,
        body.next_payment_date ?? null,
        body.status || 'active',
        body.notes ?? null
      );

    return NextResponse.json({
      success: true,
      message: 'Obligation added successfully',
      id: result.lastInsertRowid,
    });
  } catch (error) {
    console.error('[POST /api/finance/obligations] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error adding obligation' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT — Update obligation
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
        { success: false, error: 'Valid obligation ID is required' },
        { status: 400 }
      );
    }

    // Verify exists
    const existing = db
      .prepare('SELECT id FROM financial_obligations WHERE id = ? AND user_id = ?')
      .get(Number(id), userId!) as { id: number } | undefined;

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Obligation not found' },
        { status: 404 }
      );
    }

    const allowedFields = [
      'type', 'name', 'creditor', 'total_amount', 'remaining_amount',
      'monthly_payment', 'interest_rate', 'start_date', 'end_date',
      'next_payment_date', 'status', 'notes',
    ];

    const setClauses: string[] = [];
    const params: unknown[] = [];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        params.push(body[field] === null ? null : body[field]);
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No fields provided for update' },
        { status: 400 }
      );
    }

    setClauses.push("updated_at = datetime('now')");
    params.push(Number(id));

    db.prepare(
      `UPDATE financial_obligations SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`
    ).run(...params, userId!);

    return NextResponse.json({
      success: true,
      message: 'Obligation updated successfully',
    });
  } catch (error) {
    console.error('[PUT /api/finance/obligations] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error updating obligation' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — Delete obligation
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

    let obligationId: number | null = null;

    if (queryId) {
      obligationId = Number(queryId);
    } else {
      try {
        const body = await request.json();
        obligationId = body.id ? Number(body.id) : null;
      } catch {
        // No body
      }
    }

    if (!obligationId || isNaN(obligationId) || obligationId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid obligation ID is required' },
        { status: 400 }
      );
    }

    // Verify exists
    const existing = db
      .prepare('SELECT id FROM financial_obligations WHERE id = ? AND user_id = ?')
      .get(obligationId, userId!) as { id: number } | undefined;

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Obligation not found' },
        { status: 404 }
      );
    }

    // Delete associated payments first
    db.prepare('DELETE FROM obligation_payments WHERE obligation_id = ? AND user_id = ?')
      .run(obligationId, userId!);

    const result = db
      .prepare('DELETE FROM financial_obligations WHERE id = ? AND user_id = ?')
      .run(obligationId, userId!);

    if (result.changes === 0) {
      return NextResponse.json(
        { success: false, error: 'Failed to delete obligation' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Obligation and associated payments deleted successfully',
      deleted_id: obligationId,
    });
  } catch (error) {
    console.error('[DELETE /api/finance/obligations] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error deleting obligation' },
      { status: 500 }
    );
  }
}
