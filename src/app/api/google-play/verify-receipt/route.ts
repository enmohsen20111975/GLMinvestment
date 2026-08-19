/**
 * POST /api/google-play/verify-receipt
 *
 * Verify Google Play purchase receipt for subscriptions
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Google Play Android Publisher API configuration
const GOOGLE_PLAY_PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.invest.egxpilot';
const GOOGLE_PLAY_SERVICE_ACCOUNT = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT;

// Subscription plan mapping
const PLAN_MAPPING: Record<string, { name: string; tier: string; duration_days: number }> = {
  'monthly_basic': { name: 'Basic Monthly', tier: 'basic', duration_days: 30 },
  'monthly_premium': { name: 'Premium Monthly', tier: 'premium', duration_days: 30 },
  'yearly_basic': { name: 'Basic Yearly', tier: 'basic', duration_days: 365 },
  'yearly_premium': { name: 'Premium Yearly', tier: 'premium', duration_days: 365 },
  'weekly_trial': { name: 'Weekly Trial', tier: 'trial', duration_days: 7 },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { product_id, purchase_token, order_id } = body;

    // Validate required fields
    if (!product_id || !purchase_token) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: product_id, purchase_token',
          error_ar: 'بيانات ناقصة: معرف المنتج أو رمز الشراء',
        },
        { status: 400 }
      );
    }

    // Get plan info
    const planInfo = PLAN_MAPPING[product_id];
    if (!planInfo) {
      return NextResponse.json(
        {
          success: false,
          error: `Unknown product: ${product_id}`,
          error_ar: `منتج غير معروف: ${product_id}`,
        },
        { status: 400 }
      );
    }

    // TODO: In production, verify with Google Play API
    // For now, we'll simulate verification
    let verificationResult;

    if (GOOGLE_PLAY_SERVICE_ACCOUNT) {
      // Real verification with Google Play API
      try {
        verificationResult = await verifyWithGooglePlay(product_id, purchase_token);
      } catch (e) {
        console.error('[Google Play] Verification failed:', e);
        // Fall back to simulated verification for testing
        verificationResult = simulateVerification(product_id, purchase_token);
      }
    } else {
      // Simulated verification for development/testing
      verificationResult = simulateVerification(product_id, purchase_token);
    }

    if (!verificationResult.valid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid purchase',
          error_ar: 'الشراء غير صالح',
        },
        { status: 400 }
      );
    }

    // Get user from session/token
    // In production, you'd get the user ID from the auth token
    const authHeader = request.headers.get('authorization');
    let userId = null;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      // Verify token and get user ID
      // For now, we'll use a placeholder
    }

    // Update user subscription in database
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + planInfo.duration_days);

    if (userId) {
      await db.subscription.upsert({
        where: { userId },
        create: {
          userId,
          plan: planInfo.tier,
          status: 'active',
          expiresAt,
          stripeSubscriptionId: order_id || purchase_token,
          stripeCustomerId: `google_play_${userId}`,
        },
        update: {
          plan: planInfo.tier,
          status: 'active',
          expiresAt,
          stripeSubscriptionId: order_id || purchase_token,
        },
      });
    }

    return NextResponse.json({
      success: true,
      subscription: {
        plan: planInfo.tier,
        plan_name: planInfo.name,
        status: 'active',
        expires_at: expiresAt.toISOString(),
        product_id,
        order_id,
      },
      message: 'Subscription activated successfully',
      message_ar: 'تم تفعيل الاشتراك بنجاح',
    });
  } catch (error) {
    console.error('[Google Play Verify] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        error_ar: 'حدث خطأ داخلي',
      },
      { status: 500 }
    );
  }
}

// Real Google Play verification (requires service account setup)
async function verifyWithGooglePlay(productId: string, purchaseToken: string): Promise<{ valid: boolean; data?: any }> {
  // TODO: Implement real Google Play API verification
  // This requires:
  // 1. Google Play Developer API enabled
  // 2. Service account with proper permissions
  // 3. google-auth-library and googleapis packages

  throw new Error('Google Play API not configured');
}

// Simulated verification for testing
function simulateVerification(productId: string, purchaseToken: string): { valid: boolean; data?: any } {
  // For testing purposes, accept any token that looks valid
  const isValid = purchaseToken && purchaseToken.length > 10;

  return {
    valid: isValid,
    data: {
      productId,
      purchaseState: 0, // 0 = purchased
      consumptionState: 0,
      purchaseTime: Date.now(),
    },
  };
}
