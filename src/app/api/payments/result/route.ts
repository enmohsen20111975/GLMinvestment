import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/payments/result
 * Paymob payment return URL handler.
 * Evaluates payment status and redirects user to success or failure page.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const success = searchParams.get('success') === 'true' || searchParams.get('success') === 'True' || searchParams.get('success') === '1';
    const merchantOrderId = searchParams.get('merchant_order_id') || searchParams.get('order') || '';

    let planId = 'normal';
    let userId: string | null = null;

    if (merchantOrderId && merchantOrderId.startsWith('GLM-')) {
      const parts = merchantOrderId.split('-');
      if (parts.length >= 3) {
        userId = parts[1];
        planId = parts[2];
      }
    }

    if (success && userId) {
      try {
        await db.user.update({
          where: { id: userId },
          data: { subscription_tier: planId },
        });

        await db.userSubscription.upsert({
          where: { user_id: userId },
          update: {
            plan_id: planId,
            status: 'active',
            payment_method: 'paymob',
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          },
          create: {
            id: `sub_${userId}_${Date.now()}`,
            user_id: userId,
            plan_id: planId,
            status: 'active',
            payment_method: 'paymob',
            started_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        });
      } catch (err) {
        console.error('[Payments Result] Error updating user subscription:', err);
      }

      return NextResponse.redirect(new URL(`/payment/success?plan=${planId}`, req.url));
    } else {
      return NextResponse.redirect(new URL('/subscription?payment=failed', req.url));
    }
  } catch (error) {
    console.error('[Payments Result GET] Error:', error);
    return NextResponse.redirect(new URL('/subscription?payment=error', req.url));
  }
}
