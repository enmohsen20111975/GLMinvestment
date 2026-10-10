import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { approveInstapayPayment, rejectInstapayPayment, getInstapayPaymentById } from '@/lib/instapay-db';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { action, reason, adminNotes } = body;

    // Get admin email from session or token
    const adminEmail = (request as any).adminEmail || 'admin@investor-guide.com';

    if (action === 'approve') {
      const result = await approveInstapayPayment(id, adminEmail, adminNotes);
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error || 'فشل تفعيل الاشتراك' },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'تم تأكيد الدفع وتفعيل الاشتراك للمستخدم بنجاح ✅',
        payment: result.payment,
      });
    }

    if (action === 'reject') {
      const result = rejectInstapayPayment(id, adminEmail, reason || adminNotes || 'لم يصل التحويل');
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error || 'فشل رفض الطلب' },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'تم رفض طلب الدفع ❌',
        payment: result.payment,
      });
    }

    return NextResponse.json(
      { success: false, error: 'إجراء غير صالح. المتاح: approve أو reject' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('[POST /api/admin/instapay/[id]/action] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'حدث خطأ أثناء معالجة الطلب' },
      { status: 500 }
    );
  }
}
