import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { getInstapayPayments } from '@/lib/instapay-db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'all';
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const result = getInstapayPayments({ status, limit, offset });

    return NextResponse.json({
      success: true,
      payments: result.payments,
      total: result.total,
      counts: result.counts,
    });
  } catch (error: any) {
    console.error('[GET /api/admin/instapay] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء جلب طلبات الدفع' },
      { status: 500 }
    );
  }
}
