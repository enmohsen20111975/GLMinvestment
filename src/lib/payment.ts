import jwt from 'jsonwebtoken';
import { getPlan } from './plans';

const SHARED_SECRET = (process.env.SHARED_SECRET || '').trim();

// Warn once at module load (not during build time)
if (typeof window === 'undefined' && !SHARED_SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: SHARED_SECRET is not set in production ! — payment tokens cannot be generated safely');
}

export interface PaymentTokenPayload {
  plan: string;
  source: string;
  amount: number;
  currency: string;
  user_id: string;
  payment_type: string;
  billing_period: string;
  return_success: string;
  return_fail: string;
  iat: number;
  exp: number;
}

/**
 * Generate payment token for Paymob via m2y.net
 */
export function generatePaymentToken(params: {
  plan: string;
  user_id: string;
  payment_type: string;
  amount?: number;
  billing_period?: string;
  payment_method?: string;
}): string {
  // Use MAIN_DOMAIN for production, NEXTAUTH_URL for local dev
  const productionDomain = process.env.MAIN_DOMAIN || 'https://invist.m2y.net';
  const devDomain        = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const baseUrl = process.env.NODE_ENV === 'production' || process.env.NEXTAUTH_URL?.includes('.m2y.net')
    ? productionDomain
    : (devDomain.includes('localhost') ? productionDomain : devDomain);

  const planData = getPlan(params.plan);

  if (!planData) {
    throw new Error(`Invalid plan: ${params.plan}`);
  }

  const payload: PaymentTokenPayload = {
    plan: planData.id,
    source: 'glminvestment',
    amount: params.amount ?? planData.price,
    currency: planData.currency,
    user_id: params.user_id,
    payment_type: params.payment_type,
    billing_period: params.billing_period || 'monthly',
    return_success: `${baseUrl}/?payment=success&plan=${planData.id}`,
    return_fail: `${baseUrl}/?payment=failed`,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (30 * 60) // 30 minutes expiry
  };

  return jwt.sign(payload, SHARED_SECRET, { algorithm: 'HS256' });
}

/**
 * Verify payment token (optional, for debugging)
 */
export function verifyPaymentToken(token: string): PaymentTokenPayload | { valid: false; error: string } {
  if (!SHARED_SECRET) {
    return { valid: false, error: 'SHARED_SECRET not configured' };
  }

  try {
    return jwt.verify(token, SHARED_SECRET) as PaymentTokenPayload;
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }
}
