import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createInstapayPayment } from '@/lib/instapay-db';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول أولاً لإرسال إثبات الدفع' },
        { status: 401 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('receipt') as File | null;
    const tier = (formData.get('tier') as string) || 'premium';
    const market = (formData.get('market') as string) || 'egx';
    const billingCycle = (formData.get('billingCycle') as string) || 'monthly';
    const amountStr = formData.get('amount') as string;
    const currency = (formData.get('currency') as string) || 'EGP';
    const senderPhone = (formData.get('senderPhone') as string) || '';
    const notes = (formData.get('notes') as string) || '';

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'يرجى إرفاق صورة إيصال التحويل (Screenshot / Receipt)' },
        { status: 400 }
      );
    }

    const amount = parseFloat(amountStr) || 0;
    if (amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'المبلغ غير صالح' },
        { status: 400 }
      );
    }

    // Validate file type
    const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!validMimes.includes(file.type.toLowerCase()) && !file.name.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i)) {
      return NextResponse.json(
        { success: false, error: 'صيغة الملف غير مدعومة. يرجى رفع صورة (JPG, PNG, WebP)' },
        { status: 400 }
      );
    }

    // Max 10MB
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, error: 'حجم الصورة كبير جداً (الحد الأقصى 10 ميجابايت)' },
        { status: 400 }
      );
    }

    // Prepare uploads directory
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'receipts');
    await fs.mkdir(uploadDir, { recursive: true });

    // Generate safe filename
    const ext = path.extname(file.name) || '.png';
    const filename = `receipt_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
    const filePath = path.join(uploadDir, filename);

    // Save file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(filePath, buffer);

    const receiptUrl = `/uploads/receipts/${filename}`;

    // Create database record locked to authenticated user's email
    const record = createInstapayPayment({
      userId: (session.user as any)?.id || 'unknown',
      userEmail: session.user.email,
      userName: session.user.name || null,
      tier,
      market,
      billingCycle,
      amount,
      currency,
      senderPhone,
      receiptUrl,
      notes,
    });

    return NextResponse.json({
      success: true,
      message: 'تم استلام إثبات الدفع بنجاح! سيتم مراجعته وتفعيل اشتراكك فوراً خلال دقائق.',
      submissionId: record.id,
      receiptUrl,
    });
  } catch (error: any) {
    console.error('[POST /api/subscription/instapay/submit] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'حدث خطأ أثناء رفع إثبات الدفع' },
      { status: 500 }
    );
  }
}
