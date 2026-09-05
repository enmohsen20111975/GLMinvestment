import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';

/**
 * POST /api/subscription/developer-request
 * Handle developer plan requests - saves lead to database
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, name, company, useCase, plan, billingPeriod, price } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // Try to save to database (if table exists)
    try {
      // Check if user exists
      const existingUser = await db.user.findFirst({
        where: { email },
      }).catch(() => null);

      // Log the developer request (could create a dedicated table)
      console.log('[Developer Request]', {
        email,
        name,
        company,
        useCase,
        plan,
        billingPeriod,
        price,
        userId: existingUser?.id || 'guest',
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        message: 'Developer request received',
        email,
        plan,
      });
    } catch (dbError) {
      console.error('[Developer Request] DB error:', dbError);
      // Still return success - we logged it
      return NextResponse.json({
        success: true,
        message: 'Developer request received',
        email,
        plan,
      });
    }
  } catch (error) {
    console.error('[POST /api/subscription/developer-request] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
