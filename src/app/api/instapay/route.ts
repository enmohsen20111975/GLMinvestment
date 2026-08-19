import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// InstaPay Configuration
const INSTAPAY_CONFIG = {
  link: 'https://ipn.eg/S/enmohsen20111975/instapay/0JMx6z',
  email: 'enmohsen20111975@instapay',
  accountName: 'Mohsen',
};

// GET - جلب إعدادات InstaPay
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const user_id = searchParams.get('user_id');

    // جلب حزم النقاط
    let packages = await db.pointsPackage.findMany({
      where: { is_active: 1 },
      orderBy: { display_order: 'asc' }
    });

    if (packages.length === 0) {
      packages = [
        { id: 'pkg_1', name: 'Starter', name_ar: 'البداية', points: 100, price_egp: 10, bonus_points: 0 },
        { id: 'pkg_2', name: 'Basic', name_ar: 'الأساسي', points: 500, price_egp: 45, bonus_points: 50 },
        { id: 'pkg_3', name: 'Pro', name_ar: 'المحترف', points: 1000, price_egp: 85, bonus_points: 150 },
        { id: 'pkg_4', name: 'Premium', name_ar: 'المميز', points: 2500, price_egp: 200, bonus_points: 500 },
        { id: 'pkg_5', name: 'Ultimate', name_ar: 'الأقصى', points: 5000, price_egp: 380, bonus_points: 1200 },
      ] as const;
    }

    // جلب مدفوعات المستخدم المعلقة
    let pendingPayments: unknown[] = [];
    if (user_id) {
      pendingPayments = await db.instaPayPayment.findMany({
        where: { user_id, status: 'pending' },
        orderBy: { created_at: 'desc' }
      });
    }

    return NextResponse.json({
      config: INSTAPAY_CONFIG,
      packages,
      pendingPayments,
      instructions: {
        ar: [
          'اختر حزمة النقاط المناسبة',
          'انقر على "الدفع عبر InstaPay"',
          'سيتم فتح تطبيق InstaPay',
          'أكمل عملية التحويل',
          'ارجع للتطبيق وأدخل بيانات التحويل',
          'سيتم إضافة النقاط خلال دقائق'
        ]
      }
    });
  } catch (error) {
    console.error('[InstaPay API] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  }
}

// POST - إنشاء طلب دفع جديد
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, package_id, custom_amount } = body;

    if (!user_id) {
      return NextResponse.json({ error: 'مطلوب تسجيل الدخول' }, { status: 401 });
    }

    // تحديد المبلغ والنقاط
    let amount = 0;
    let points = 0;
    let bonus_points = 0;

    if (package_id) {
      const pkg = await db.pointsPackage.findUnique({ where: { id: package_id } });
      if (pkg) {
        amount = pkg.price_egp;
        points = pkg.points;
        bonus_points = pkg.bonus_points;
      }
    } else if (custom_amount && custom_amount >= 10) {
      // حساب النقاط بناءً على المبلغ
      const settings = await db.pointsSettings.findFirst();
      const rate = settings?.egp_per_100_points || 10; // 100 نقطة = 10 جنيه
      points = Math.floor((custom_amount / rate) * 100);
      amount = custom_amount;
    }

    if (amount <= 0 || points <= 0) {
      return NextResponse.json({ error: 'مبلغ غير صالح' }, { status: 400 });
    }

    // إنشاء طلب الدفع
    const payment = await db.instaPayPayment.create({
      data: {
        user_id,
        amount,
        points_amount: points + bonus_points,
        status: 'pending',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 ساعة
      }
    });

    return NextResponse.json({
      payment,
      instapay_link: INSTAPAY_CONFIG.link,
      instapay_email: INSTAPAY_CONFIG.email,
      instructions: {
        ar: [
          `المبلغ المطلوب: ${amount} جنيه`,
          `النقاط التي ستستلمها: ${points + bonus_points}`,
          'افتح رابط InstaPay وأكمل التحويل',
          'بعد التحويل، أدخل رقم العملية أو صورة الإيصال'
        ]
      }
    });
  } catch (error) {
    console.error('[InstaPay API] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ في إنشاء طلب الدفع' }, { status: 500 });
  }
}
