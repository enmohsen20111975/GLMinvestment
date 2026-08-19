/**
 * DELETE /api/finance/transactions/[id]
 * ====================================
 * Delete a transaction by ID.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const { id } = await params;
    const db = await getFinanceDb();

    const result = db.prepare(
      "DELETE FROM financial_transactions WHERE id = ? AND user_id = ?"
    ).run(Number(id), userId);

    if (result.changes === 0) {
      return NextResponse.json({ success: false, error: 'المعاملة غير موجودة' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'تم حذف المعاملة',
    });
  } catch (error) {
    console.error('[/api/finance/transactions/[id] DELETE] Error:', error);
    return NextResponse.json({ success: false, error: 'فشل في حذف المعاملة' }, { status: 500 });
  }
}
