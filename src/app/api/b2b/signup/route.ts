import { NextRequest, NextResponse } from 'next/server';
import { authDb } from '@/lib/db-auth';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkAuthRateLimit } from '@/lib/rate-limiter'; // FIX-WAVE-1-SECURITY (AUDIT-DEEP-4 #2)

/**
 * POST /api/b2b/signup
 *
 * body: {
 *   tier: 'b2b_starter' | 'b2b_pro' | 'b2b_enterprise',
 *   company: string,
 *   contactName: string,
 *   email: string,
 *   phone: string,
 *   useCase?: string,
 *   website?: string
 * }
 *
 * - بينشئ طلب B2B في الـ DB (pending approval)
 * - الـ admin بيوافق عليه في /admin/subscriptions
 * - بعد الموافقة → Paymob checkout → توليد API key تلقائياً
 */

interface B2bSignupBody {
  tier?: string;
  company?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  useCase?: string;
  website?: string;
}

export async function POST(req: NextRequest) {
  try {
    // FIX-WAVE-1-SECURITY (AUDIT-DEEP-4 #2): rate limit mass B2B signup abuse.
    // 5 attempts per minute per IP. Returns 429 with Retry-After on exceedance.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';
    const rl = checkAuthRateLimit(ip);
    if (!rl.ok) {
      const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { success: false, error: 'rate_limit_exceeded', retry_after_seconds: retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
      );
    }

    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
    }

    const body: B2bSignupBody = await req.json().catch(() => ({}));
    const tier = String(body.tier || '').toLowerCase();
    const company = String(body.company || '').trim();
    const contactName = String(body.contactName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim();
    const useCase = String(body.useCase || '').trim();
    const website = String(body.website || '').trim();

    // تحقق من الـ inputs
    const validTiers = ['b2b_starter', 'b2b_pro', 'b2b_enterprise'];
    if (!validTiers.includes(tier)) {
      return NextResponse.json({ success: false, error: 'باقة B2B غير صالحة' }, { status: 400 });
    }
    if (!company || !contactName || !email || !phone) {
      return NextResponse.json(
        { success: false, error: 'البيانات ناقصة: company + contactName + email + phone مطلوبة' },
        { status: 400 },
      );
    }

    // ملاحظة: بيانات B2B بتتخزّن في حقل UserSubscription المؤقت
    // أو في table منفصلة. هنا نبسّط: نحدّث user.subscription_tier لـ 'pending_b2b' + نحفظ الميتا.
    // الأدمن بيوافق بعدين → activate.
    const user = await authDb.user.findUnique({
      where: { id: userId },
      select: { email: true, username: true },
    });

    if (!user) {
      return NextResponse.json({ success: false, error: 'المستخدم غير موجود' }, { status: 404 });
    }

    // لو فيه UserSubscription موجود بالفعل للـ B2B، نرفض
    const existingSub = await authDb.userSubscription.findFirst({
      where: { user_id: userId, plan_id: { startsWith: 'b2b_' } },
    });
    if (existingSub) {
      return NextResponse.json(
        { success: false, error: 'لديك طلب B2B بالفعل — سنتواصل معك قريباً' },
        { status: 409 },
      );
    }

    // أنشئ UserSubscription بـ status = 'pending_approval'
    const subId = `b2b_pending_${userId.slice(-12)}_${Date.now()}`;
    await authDb.userSubscription.create({
      data: {
        id: subId,
        user_id: userId,
        plan_id: tier,
        status: 'pending_approval',
        payment_method: 'paymob',
        // نحفظ الـ metadata في حقل expires_at بشكل مبدئي (سيتم تنظيفه عند الموافقة)
        expires_at: null,
      },
    });

    // سجّل الطلب للـ admin
    console.log(`[b2b/signup] user=${userId} tier=${tier} company="${company}" contact="${contactName}" email=${email} phone=${phone} useCase="${useCase.slice(0, 100)}"`);

    // إشعار تيليجرام للأدمن (اختياري — لسه Phase 4)
    // TODO: أرسل إشعار للأدمن عبر /api/telegram/post

    return NextResponse.json({
      success: true,
      message: 'تم استلام طلبك بنجاح. سنتواصل معك خلال 48 ساعة لإتمام التفعيل.',
      subscriptionId: subId,
      tier,
      status: 'pending_approval',
      nextSteps: [
        'فريق المبيعات هيتواصل معك على ' + email,
        'بعد الموافقة، هنرسلك رابط الدفع عبر Paymob',
        'بعد نجاح الدفع، هتستلم API key تلقائياً على إيميلك',
      ],
    });
  } catch (err: any) {
    console.error('[b2b/signup] error:', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل إرسال طلب B2B' },
      { status: 500 },
    );
  }
}
