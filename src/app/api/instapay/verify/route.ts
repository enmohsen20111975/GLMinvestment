/**
 * POST /api/instapay/verify
 * ==========================
 * Stub InstaPay payment verification for the Flutter Android app.
 *
 * Per task spec: InstaPay merchant credentials are NOT available in the
 * sandbox, so this endpoint always returns `valid: false` with a clear
 * explanation. The Android client gets a stable JSON envelope instead of a
 * 404 — it can then fall back to the manual verification flow (admin reviews
 * the receipt).
 *
 * Auth: required (getSessionUserId). 401 if no userId.
 *
 * Body: { phone, reference } — both optional (we don't validate, but accept
 * them so the client doesn't get a 400 when it sends the payload).
 *
 * Returns:
 *   {
 *     success: true,
 *     valid: false,
 *     message: "InstaPay verification not configured",
 *     message_ar: "تحقق InstaPay غير مُهيأ",
 *     fallback_action: "manual_review",
 *     received: { phone: bool, reference: bool }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getSessionUserId } from '@/lib/auth-helper';

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      error: 'مطلوب تسجيل الدخول',
      error_en: 'Authentication required',
    },
    { status: 401 }
  );
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) return unauthorized();

    // Parse the body — but don't fail on missing/invalid JSON (the spec
    // says phone + reference are the expected fields, but we tolerate their
    // absence since this is a stub).
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const reference =
      typeof body.reference === 'string' ? body.reference.trim() : '';

    return NextResponse.json({
      success: true,
      valid: false,
      verified: false,
      message: 'InstaPay verification not configured',
      message_ar: 'تحقق InstaPay غير مُهيأ — يرجى التواصل مع الدعم لمراجعة الإيصال يدوياً',
      fallback_action: 'manual_review',
      received: {
        phone: !!phone,
        reference: !!reference,
      },
      generated_at: new Date().toISOString(),
      source: 'stub',
    });
  } catch (err) {
    console.error('[instapay/verify] fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
      },
      { status: 500 }
    );
  }
}
