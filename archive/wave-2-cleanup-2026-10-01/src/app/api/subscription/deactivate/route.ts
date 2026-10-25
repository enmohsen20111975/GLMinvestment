/**
 * دليل الاستثمار — POST /api/subscription/deactivate
 *
 * Cancel a user's subscription or downgrade them.
 * Also syncs the change to m2y.net.
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';
import { syncSubscriptionToM2Y } from '@/lib/m2ySyncClient';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id as string;
    const body   = await request.json().catch(() => ({}));
    const { plan_id, reason } = body; // plan_id = target plan (could be 'free')

    if (!plan_id) {
      return NextResponse.json({ success: false, error: 'plan_id is required' }, { status: 400 });
    }

    const plan = await db.subscriptionPlan.findUnique({ where: { id: plan_id } });
    if (!plan) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 });
    }

    // Update local subscription
    const startedAt = new Date();
    const expiresAt = plan_id === 'free' ? null : new Date(startedAt);
    if (expiresAt && !expiresAt.getTime()) {};
    if (expiresAt) { expiresAt.setMonth(expiresAt.getMonth() + 1); }

    const tier = plan_id === 'free' ? 'free' : plan_id === 'normal' ? 'normal' : plan_id === 'premium' ? 'premium' : 'free';

    await db.userSubscription.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        plan_id,
        status: 'active',
        started_at: startedAt.toISOString(),
        expires_at: expiresAt?.toISOString() ?? null,
        auto_renew: tier !== 'free',
        payment_method: plan_id === 'free' ? 'free' : 'paymob',
      },
      update: {
        plan_id,
        status: 'active',
        started_at: startedAt.toISOString(),
        expires_at: expiresAt?.toISOString() ?? null,
        auto_renew: tier !== 'free',
        payment_method: plan_id === 'free' ? 'free' : 'paymob',
      },
    });

    await db.user.update({
      where: { id: userId },
      data: { subscription_tier: tier },
    });

    // Sync to m2y.net
    await syncSubscriptionToM2Y({
      action: 'downgrade',
      user_id: userId,
      plan_id,
      status: 'active',
      expires_at: expiresAt?.toISOString() ?? null,
      auto_renew: tier !== 'free',
      payment_method: plan_id === 'free' ? 'free' : 'paymob',
      metadata: reason ? JSON.stringify({ reason }) : undefined,
    });

    return NextResponse.json({
      success: true,
      message: 'تم تحديث الاشتراك',
      data: { plan_id, tier, expires_at: expiresAt?.toISOString() ?? null },
    });
  } catch (error) {
    console.error('[subscription/deactivate]', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
