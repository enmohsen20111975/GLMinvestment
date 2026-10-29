/**
 * POST /api/push/register
 * =======================
 * Register a mobile push-notification token (FCM / APNs).
 *
 * Flutter app sends (lib/api/client.dart:2189):
 *   { push_token: string, device_type?: "android"|"ios", device_id?: string }
 *
 * Auth: Bearer token via `getSessionUserId()` from `@/lib/auth-helper`.
 *
 * NOTE: There is no dedicated `push_tokens` table yet in `prisma/auth-schema.prisma`.
 * For now, this endpoint:
 *   1. Validates auth + payload.
 *   2. Logs the token (server-side) for diagnostics.
 *   3. Stores the token in the `api_tokens` table as a row tagged with
 *      `device_info="push:<device_type>"` and `name="push_token"` so we can
 *      later query / clean it up without a schema migration. If storage fails,
 *      we still return 200 so the Flutter app doesn't retry indefinitely.
 *
 * Returns: { success: true, message: "تم تسجيل التوكن" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      error: 'غير مصرح',
      error_en: 'Unauthorized',
    },
    { status: 401 }
  );
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return unauthorized();
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const pushToken = typeof body.push_token === 'string' ? body.push_token.trim() : '';
    if (!pushToken) {
      return NextResponse.json(
        {
          success: false,
          error: 'push_token مطلوب',
          error_en: 'push_token is required',
        },
        { status: 400 }
      );
    }

    const deviceType =
      typeof body.device_type === 'string' ? body.device_type : 'android';
    const deviceId =
      typeof body.device_id === 'string' ? body.device_id : null;

    // Always log the registration (server-side) for diagnostics.
    console.log(
      `[push/register] user=${userId} device_type=${deviceType} device_id=${deviceId} token=${pushToken.slice(0, 12)}…`
    );

    // Best-effort persistence into api_tokens table. We tag the row so it can
    // be distinguished from auth tokens. If the table / column is unavailable,
    // we still return success so the Flutter client doesn't retry forever.
    try {
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      await db.apiToken.create({
        data: {
          id: randomUUID(),
          user_id: userId,
          token: `push:${pushToken}`,
          name: 'push_token',
          device_info: JSON.stringify({
            type: deviceType,
            device_id: deviceId,
            registered_at: new Date().toISOString(),
          }),
          expires_at: expiresAt as any,
        },
      });
    } catch (persistErr) {
      // Non-fatal — push registration should never fail the client.
      console.warn('[push/register] persistence skipped:', persistErr);
    }

    return NextResponse.json({
      success: true,
      message: 'تم تسجيل التوكن',
      message_en: 'Push token registered',
    });
  } catch (e: unknown) {
    console.error('[push/register] Error:', e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ أثناء تسجيل التوكن',
        error_en: 'Failed to register push token',
        details: message,
      },
      { status: 500 }
    );
  }
}

// Convenience: GET returns a simple health check (no auth needed).
export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Push register endpoint is up. Use POST with { push_token }.',
  });
}
