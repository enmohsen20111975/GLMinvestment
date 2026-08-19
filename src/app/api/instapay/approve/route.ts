import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST - الموافقة على دفع (للأدمن)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { payment_id, admin_id, approve, notes } = body;

    if (!payment_id || !admin_id) {
      return NextResponse.json({ error: 'البيانات غير مكتملة' }, { status: 400 });
    }

    // التحقق من صلاحيات الأدمن
    const admin = await db.user.findUnique({ where: { id: admin_id } });
    if (!admin || admin.subscription_tier !== 'admin') {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const payment = await db.instaPayPayment.findUnique({
      where: { id: payment_id }
    });

    if (!payment) {
      return NextResponse.json({ error: 'طلب الدفع غير موجود' }, { status: 404 });
    }

    if (payment.status !== 'pending') {
      return NextResponse.json({ error: 'تم معالجة هذا الطلب بالفعل' }, { status: 400 });
    }

    if (approve) {
      // إضافة النقاط للمستخدم
      let userPoints = await db.userPoints.findUnique({
        where: { user_id: payment.user_id }
      });

      if (!userPoints) {
        userPoints = await db.userPoints.create({
          data: { user_id: payment.user_id }
        });
      }

      const newBalance = userPoints.available_points + payment.points_amount;
      const newTotal = userPoints.total_points + payment.points_amount;

      // حساب المستوى الجديد
      const settings = await db.pointsSettings.findFirst();
      let newLevel = 1;
      if (settings) {
        if (newTotal >= settings.level_5_threshold) newLevel = 5;
        else if (newTotal >= settings.level_4_threshold) newLevel = 4;
        else if (newTotal >= settings.level_3_threshold) newLevel = 3;
        else if (newTotal >= settings.level_2_threshold) newLevel = 2;
      }

      // تحديث النقاط
      await db.userPoints.update({
        where: { user_id: payment.user_id },
        data: {
          available_points: newBalance,
          total_points: newTotal,
          level: newLevel,
          purchase_points: userPoints.purchase_points + payment.points_amount,
          updated_at: new Date().toISOString(),
        }
      });

      // تسجيل المعاملة
      await db.pointsTransaction.create({
        data: {
          user_id: payment.user_id,
          amount: payment.points_amount,
          balance_after: newBalance,
          type: 'purchase',
          source: 'instapay',
          reference_id: payment_id,
          description: `شراء ${payment.points_amount} نقطة عبر InstaPay`,
        }
      });

      // تحديث حالة الدفع
      await db.instaPayPayment.update({
        where: { id: payment_id },
        data: {
          status: 'verified',
          verified_by: admin_id,
          verified_at: new Date().toISOString(),
          notes: notes || 'تم التحقق والإضافة',
        }
      });

      return NextResponse.json({
        message: 'تم إضافة النقاط بنجاح',
        points_added: payment.points_amount,
        new_balance: newBalance
      });
    } else {
      // رفض الدفع
      await db.instaPayPayment.update({
        where: { id: payment_id },
        data: {
          status: 'rejected',
          verified_by: admin_id,
          verified_at: new Date().toISOString(),
          notes: notes || 'مرفوض',
        }
      });

      return NextResponse.json({ message: 'تم رفض الدفع' });
    }
  } catch (error) {
    console.error('[InstaPay Approve API] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  }
}
