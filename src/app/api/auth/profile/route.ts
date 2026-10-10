/**
 * PUT /api/auth/profile
 * ======================
 * Profile update endpoint for the Flutter Android app.
 *
 * Body: { name?, username?, image?, default_risk_tolerance? }
 *
 * Auth: required (getSessionUserId). 401 if no userId.
 *
 * Updates the User row in `db/auth.db` via Prisma. Returns the updated user
 * (minus password_hash — that field is never returned).
 *
 * Validation:
 *   - name: must be 1..100 chars if provided
 *   - username: must match /^[a-zA-Z0-9_.-]{3,30}$/ if provided (Prisma unique
 *     constraint still enforced at the DB layer)
 *   - image: must be a URL-like string if provided
 *   - default_risk_tolerance: must be one of low|medium|high if provided
 *
 * On Prisma unique-constraint violation (username clash) we return 409 with
 * Arabic + English error.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getSessionUserId } from '@/lib/auth-helper';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

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

function badRequest(ar: string, en: string) {
  return NextResponse.json(
    {
      success: false,
      error: ar,
      error_en: en,
    },
    { status: 400 }
  );
}

interface UpdateBody {
  name?: unknown;
  username?: unknown;
  image?: unknown;
  default_risk_tolerance?: unknown;
}

const RISK_LEVELS = ['low', 'medium', 'high'];
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;

export async function PUT(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) return unauthorized();

    let body: UpdateBody;
    try {
      body = (await req.json()) as UpdateBody;
    } catch { // silent fallback (safe-by-design)
      return badRequest('جسم الطلب غير صالح', 'Invalid JSON body');
    }

    const data: Prisma.UserUpdateInput = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.length === 0) {
        return badRequest(
          'الاسم يجب أن يكون نصاً غير فارغ',
          'name must be a non-empty string'
        );
      }
      if (body.name.length > 100) {
        return badRequest(
          'الاسم طويل جداً (الحد الأقصى 100 حرف)',
          'name too long (max 100 chars)'
        );
      }
      data.name = body.name.trim();
    }

    if (body.username !== undefined) {
      if (typeof body.username !== 'string') {
        return badRequest(
          'اسم المستخدم يجب أن يكون نصاً',
          'username must be a string'
        );
      }
      const trimmed = body.username.trim();
      if (!USERNAME_RE.test(trimmed)) {
        return badRequest(
          'اسم المستخدم غير صالح (3-30 حرف/رقم/_-.)',
          'Invalid username (3-30 chars: letters, digits, _ . -)'
        );
      }
      data.username = trimmed;
    }

    if (body.image !== undefined) {
      if (body.image === null) {
        data.image = null;
      } else if (typeof body.image === 'string') {
        if (body.image.length > 2048) {
          return badRequest(
            'رابط الصورة طويل جداً',
            'image URL too long'
          );
        }
        data.image = body.image.trim();
      } else {
        return badRequest(
          'رابط الصورة يجب أن يكون نصاً',
          'image must be a string'
        );
      }
    }

    if (body.default_risk_tolerance !== undefined) {
      if (typeof body.default_risk_tolerance !== 'string') {
        return badRequest(
          'مستوى المخاطرة يجب أن يكون نصاً',
          'default_risk_tolerance must be a string'
        );
      }
      const lvl = body.default_risk_tolerance.toLowerCase();
      if (!RISK_LEVELS.includes(lvl)) {
        return badRequest(
          `مستوى المخاطرة يجب أن يكون أحد: ${RISK_LEVELS.join('، ')}`,
          `default_risk_tolerance must be one of: ${RISK_LEVELS.join(', ')}`
        );
      }
      data.default_risk_tolerance = lvl;
    }

    if (Object.keys(data).length === 0) {
      return badRequest(
        'لا توجد حقول لتحديثها',
        'No updatable fields provided'
      );
    }

    // Update the user row.
    let updated;
    try {
      updated = await db.user.update({
        where: { id: userId },
        data,
        select: {
          id: true,
          email: true,
          name: true,
          username: true,
          image: true,
          subscription_tier: true,
          default_risk_tolerance: true,
          is_active: true,
          email_verified: true,
          last_login: true,
          last_active_at: true,
          created_at: true,
          updated_at: true,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Unique constraint violation — username already taken.
        return NextResponse.json(
          {
            success: false,
            error: 'اسم المستخدم مستخدم بالفعل',
            error_en: 'Username already taken',
            field: 'username',
          },
          { status: 409 }
        );
      }
      throw err;
    }

    return NextResponse.json({
      success: true,
      message: 'تم تحديث الملف الشخصي',
      message_en: 'Profile updated',
      user: {
        ...updated,
        email_verified: !!updated.email_verified,
        is_active: updated.is_active ?? true,
        last_login: updated.last_login?.toISOString?.() || null,
        last_active_at: updated.last_active_at?.toISOString?.() || null,
        created_at: updated.created_at?.toISOString?.() || null,
        updated_at: updated.updated_at?.toISOString?.() || null,
      },
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[auth/profile PUT] fatal:', err);
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

/**
 * GET /api/auth/profile — convenience alias for /api/auth/me so the Flutter
 * app can use a single base path for both reading and updating the profile.
 * Delegates to /api/auth/me's GET handler.
 */
export async function GET(req: NextRequest) {
  // Re-use the canonical /api/auth/me handler.
  const { GET: meGET } = await import('@/app/api/auth/me/route');
  return meGET(req);
}
