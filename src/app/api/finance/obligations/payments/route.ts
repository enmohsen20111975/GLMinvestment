import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';

// ---------------------------------------------------------------------------
// GET  /api/finance/obligations/payments — Fetch payments for an obligation
// POST /api/finance/obligations/payments — Record a payment
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET — Return payments for an obligation
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: true, items: [], total: 0 });
    }

    const db = await getFinanceDb();

    const { searchParams } = new URL(request.url);
    const obligationId = searchParams.get('obligation_id');

    if (!obligationId || isNaN(Number(obligationId)) || Number(obligationId) <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid obligation_id is required' },
        { status: 400 }
      );
    }

    const rows = db
      .prepare(
        `SELECT * FROM obligation_payments
         WHERE obligation_id = ? AND user_id = ?
         ORDER BY payment_date DESC`
      )
      .all(Number(obligationId), userId!) as Record<string, unknown>[];

    const totalPaid = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const totalPrincipal = rows.reduce((sum, r) => sum + (Number(r.principal_amount) || 0), 0);
    const totalInterest = rows.reduce((sum, r) => sum + (Number(r.interest_amount) || 0), 0);

    return NextResponse.json({
      success: true,
      items: rows,
      total: rows.length,
      summary: {
        total_paid: Number(totalPaid.toFixed(2)),
        total_principal: Number(totalPrincipal.toFixed(2)),
        total_interest: Number(totalInterest.toFixed(2)),
      },
    });
  } catch (error) {
    console.error('[GET /api/finance/obligations/payments] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error reading obligation payments' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — Record a payment and update remaining_amount
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const db = await getFinanceDb();

    const body = await request.json();
    const { obligation_id, amount, payment_date, principal_amount, interest_amount, notes } = body;

    if (!obligation_id || isNaN(Number(obligation_id)) || Number(obligation_id) <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid obligation_id is required' },
        { status: 400 }
      );
    }

    if (amount === undefined || amount === null || Number(amount) <= 0) {
      return NextResponse.json(
        { success: false, error: 'Payment amount must be greater than zero' },
        { status: 400 }
      );
    }

    // Verify obligation exists
    const obligation = db
      .prepare('SELECT id, remaining_amount, status FROM financial_obligations WHERE id = ? AND user_id = ?')
      .get(Number(obligation_id), userId!) as { id: number; remaining_amount: number; status: string } | undefined;

    if (!obligation) {
      return NextResponse.json(
        { success: false, error: 'Obligation not found' },
        { status: 404 }
      );
    }

    if (obligation.status === 'paid') {
      return NextResponse.json(
        { success: false, error: 'Cannot make payment on a fully paid obligation' },
        { status: 400 }
      );
    }

    const paymentAmount = Number(amount);
    const principal = Number(principal_amount ?? amount);
    const interest = Number(interest_amount ?? 0);
    const payDate = payment_date || new Date().toISOString().split('T')[0];

    // Use a transaction for atomicity
    const makePayment = db.transaction(() => {
      // Insert payment record
      const paymentResult = db
        .prepare(
          `INSERT INTO obligation_payments (
             obligation_id, user_id, amount, payment_date,
             principal_amount, interest_amount, notes, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        )
        .run(
          Number(obligation_id),
          userId!,
          paymentAmount,
          payDate,
          principal,
          interest,
          notes ?? null
        );

      // Update remaining_amount on the obligation
      const newRemaining = Math.max(0, Number(obligation.remaining_amount) - principal);
      const newStatus = newRemaining <= 0 ? 'paid' : obligation.status;

      db.prepare(
        `UPDATE financial_obligations
         SET remaining_amount = ?, status = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`
      ).run(newRemaining, newStatus, Number(obligation_id), userId!);

      return { paymentId: paymentResult.lastInsertRowid, newRemaining, newStatus };
    });

    const result = makePayment();

    return NextResponse.json({
      success: true,
      message: 'Payment recorded successfully',
      id: result.paymentId,
      new_remaining_amount: Number(result.newRemaining.toFixed(2)),
      new_status: result.newStatus,
    });
  } catch (error) {
    console.error('[POST /api/finance/obligations/payments] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error recording payment' },
      { status: 500 }
    );
  }
}
