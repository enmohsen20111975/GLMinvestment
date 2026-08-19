/**
 * POST /api/auth/google
 *
 * Mobile Google login endpoint - Accepts Google ID Token and returns Bearer token
 * Used by the Flutter/Android app (com.egx.investment) and mirrors the website's
 * Google authentication flow so both platforms share the SAME auth token.
 *
 * Request Body:
 *   { "id_token": "google_id_token_from_sdk" }
 *
 * Response (200):
 *   {
 *     "success": true,
 *     "message": "Google login successful",
 *     "message_ar": "تم تسجيل الدخول عبر جوجل بنجاح",
 *     "user": { ... },
 *     "token": "egx_uuid_token_timestamp",
 *     "token_type": "Bearer",
 *     "expires_in": 2592000,
 *     "is_new_user": false
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { isServerAdmin } from '@/lib/admin-identities'; // P0.1 (SEC-01)

// Token expiry: 30 days
const TOKEN_EXPIRY_DAYS = 30;

// Google OAuth client IDs - Web Client ID is primary, Android IDs are for mobile compatibility
const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const GOOGLE_ANDROID_CLIENT_IDS = (process.env.GOOGLE_ANDROID_CLIENT_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

// All valid client IDs (Web + Android)
const KNOWN_MOBILE_CLIENT_IDS = [
  '642150971767-ga2gohq77mcsgoa385ekciubnmvr0b02.apps.googleusercontent.com',
  '393659426254-n4ngsvhtfie714l0o5h8mlcpm5c58195.apps.googleusercontent.com',
];

const VALID_CLIENT_IDS = Array.from(
  new Set([GOOGLE_CLIENT_ID, ...GOOGLE_ANDROID_CLIENT_IDS, ...KNOWN_MOBILE_CLIENT_IDS].filter(Boolean))
) as string[];

// P0.1 (SEC-01): admin emails sourced from env vars via @/lib/admin-identities.

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
  aud?: string;
  iss?: string;
  azp?: string;
}

/**
 * Verify a Google ID token by calling Google's tokeninfo endpoint.
 * Returns the decoded user info if valid, or an error description if not.
 */
async function verifyGoogleIdToken(
  idToken: string
): Promise<
  | { success: true; user: GoogleUserInfo }
  | { success: false; error: string; status: number; debug?: unknown }
> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        '[Google Auth] Token verification failed:',
        response.status,
        errorText
      );
      return {
        success: false,
        error: `Google verification failed: ${response.status}`,
        status: 401,
      };
    }

    const payload = (await response.json()) as GoogleUserInfo;

    // SECURITY: Fail closed if no client IDs are configured
    if (VALID_CLIENT_IDS.length === 0) {
      console.error(
        '[Google Auth] NO VALID CLIENT IDS CONFIGURED — set GOOGLE_CLIENT_ID'
      );
      return {
        success: false,
        error: 'Google auth not configured on server (GOOGLE_CLIENT_ID missing)',
        status: 503,
      };
    }

    // Verify audience (client ID) - accept Web Client ID or Android Client IDs
    const audienceMatch = VALID_CLIENT_IDS.includes(payload.aud || '');

    if (!audienceMatch) {
      console.error('[Google Auth] INVALID AUDIENCE — Token aud:', payload.aud);
      return {
        success: false,
        error: `Invalid audience. Token has "${payload.aud}" but expected one of: ${VALID_CLIENT_IDS.join(', ')}`,
        status: 401,
        debug: {
          token_audience: payload.aud,
          valid_client_ids: VALID_CLIENT_IDS,
        },
      };
    }

    return { success: true, user: payload };
  } catch (error) {
    console.error('[Google Auth] Verification error:', error);
    return {
      success: false,
      error: `Verification error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      status: 500,
    };
  }
}

export async function POST(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';

  try {
    const body = await request.json();
    const { id_token } = body;

    if (!id_token || typeof id_token !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'Google ID token مطلوب',
          error_en: 'id_token is required',
          debug: isDev ? { validClientIds: VALID_CLIENT_IDS } : undefined,
        },
        { status: 400 }
      );
    }

    console.log('[Google Auth] ID token received, length:', id_token.length);

    // ── Step 1: Verify Google ID token ───────────────────────────────────────
    const verificationResult = await verifyGoogleIdToken(id_token);

    if (!verificationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'فشل التحقق من Google token',
          error_en: verificationResult.error,
          debug: isDev ? verificationResult.debug : undefined,
        },
        { status: verificationResult.status }
      );
    }

    const googleUser = verificationResult.user;

    if (!googleUser.email) {
      return NextResponse.json(
        {
          success: false,
          error: 'لم يتم العثور على بريد إلكتروني',
          error_en: 'No email found',
        },
        { status: 400 }
      );
    }

    const email = googleUser.email.toLowerCase();
    const name = googleUser.name || googleUser.given_name || '';
    const image = googleUser.picture || '';

    console.log('[Google Auth] ✅ Token verified for:', email);

    // ── Step 2: Find or create user ──────────────────────────────────────────
    let user: any;
    let isNewUser = false;

    try {
      user = await db.user.findUnique({
        where: { email },
      });
    } catch (findError) {
      // Handle corrupted email_verified data (stored as epoch millis string)
      if (
        findError instanceof Prisma.PrismaClientKnownRequestError &&
        findError.message.includes('email_verified')
      ) {
        console.warn(
          '[Google Auth] Detected corrupted email_verified — attempting repair'
        );
        const rawUsers = await db.$queryRaw<any[]>`
          SELECT id, email, username, name, image, password_hash,
                 subscription_tier, default_risk_tolerance, is_active,
                 email_verified, last_login, created_at, updated_at
          FROM User
          WHERE email = ${email}
        `;

        if (rawUsers.length > 0) {
          user = rawUsers[0];
          // Repair the corrupted email_verified data
          try {
            await db.$executeRaw`
              UPDATE User
              SET email_verified = datetime(CAST(email_verified AS REAL) / 1000, 'unixepoch')
              WHERE id = ${user.id}
                AND typeof(email_verified) = 'text'
                AND length(email_verified) > 10
            `;
            user = await db.user.findUnique({
              where: { id: user.id },
            });
          } catch (fixError) {
            console.error('[Google Auth] Failed to fix email_verified:', fixError);
          }
        }
      } else if (
        findError instanceof Prisma.PrismaClientKnownRequestError &&
        /no such table|relation.*does not exist/i.test(findError.message)
      ) {
        // Auth DB not initialized — return structured 503
        console.error('[Google Auth] Auth DB not initialized:', findError.message);
        return NextResponse.json(
          {
            success: false,
            error: 'خدمة المصادقة غير مهيأة — قاعدة بيانات المستخدمين ناقصة',
            error_en:
              'Auth DB not initialized. Run: npx prisma db push --schema prisma/auth-schema.prisma',
          },
          { status: 503 }
        );
      } else {
        console.error(
          '[Google Auth] Unexpected Prisma error during findUnique:',
          findError
        );
        return NextResponse.json(
          {
            success: false,
            error: 'خطأ في قاعدة بيانات المستخدمين',
            error_en:
              findError instanceof Error ? findError.message : 'Database error',
          },
          { status: 500 }
        );
      }
    }

    // ── Step 3: Create user if not exists ────────────────────────────────────
    if (!user) {
      isNewUser = true;

      // Generate username from email
      const baseUsername = email
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '');
      let username = baseUsername || `user_${Date.now()}`;
      let counter = 1;

      // Ensure unique username
      try {
        while (await db.user.findUnique({ where: { username } })) {
          username = `${baseUsername}_${counter}`;
          counter++;
        }
      } catch (usernameCheckError) {
        console.log(
          '[Google Auth] Username uniqueness check failed (non-critical):',
          usernameCheckError instanceof Error
            ? usernameCheckError.message
            : usernameCheckError
        );
      }

      // Use proper Date objects for Prisma DateTime fields (NOT ISO strings)
      const now = new Date();
      const emailVerified = googleUser.email_verified ? now : null;

      try {
        user = await db.user.create({
          data: {
            id: randomUUID(),
            email,
            username,
            name: name || username,
            image,
            email_verified: emailVerified,
            subscription_tier: 'free',
            is_active: true,
            last_login: now,
            updated_at: now,
          },
        });
        console.log('[Google Auth] ✅ New user created:', user.id);
      } catch (createError) {
        console.error('[Google Auth] User creation failed:', createError);
        return NextResponse.json(
          {
            success: false,
            error: 'فشل في إنشاء حساب المستخدم',
            error_en:
              createError instanceof Error ? createError.message : 'Unknown error',
            debug: isDev
              ? {
                  name: createError instanceof Error ? createError.name : 'Unknown',
                  message:
                    createError instanceof Error
                      ? createError.message
                      : String(createError),
                }
              : undefined,
          },
          { status: 500 }
        );
      }

      // Create Google account link (optional - may not exist on all databases)
      try {
        await db.account.create({
          data: {
            id: randomUUID(),
            userId: user.id,
            type: 'oauth',
            provider: 'google',
            providerAccountId: googleUser.sub,
          },
        });
      } catch (accountError) {
        console.log(
          '[Google Auth] Could not create Account record (non-critical):',
          accountError instanceof Error ? accountError.message : accountError
        );
      }
    } else {
      // ── Update existing user ────────────────────────────────────────────────
      // Handle both Prisma (Boolean) and raw query (0/1/undefined) results
      if (user.is_active === false || user.is_active === 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'الحساب غير مفعل',
            error_en: 'Account is deactivated',
          },
          { status: 403 }
        );
      }

      // Update last login using raw SQL (non-critical if it fails)
      try {
        const nowISO = new Date().toISOString();
        await db.$executeRaw`
          UPDATE User
          SET last_login = ${nowISO},
              image = COALESCE(image, ${image || null}),
              name = COALESCE(name, ${name || null})
          WHERE id = ${user.id}
        `;
      } catch (updateError) {
        console.log(
          '[Google Auth] Could not update last_login (non-critical):',
          updateError instanceof Error ? updateError.message : updateError
        );
      }
    }

    // ── Step 4: Generate and store API token ──────────────────────────────────
    const token = `egx_${user.id}_${randomUUID()}_${Date.now()}`;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + TOKEN_EXPIRY_DAYS);
    const expiresAtISO = expiresAt.toISOString();
    const nowISO = new Date().toISOString();

    // Get device info
    const userAgent = request.headers.get('user-agent') || null;
    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      null;

    // Create token in database using raw query to ensure ISO format
    let tokenCreated = false;
    try {
      await db.$executeRaw`
        INSERT INTO api_tokens (id, user_id, token, device_info, ip_address, expires_at, created_at)
        VALUES (
          ${randomUUID()},
          ${user.id},
          ${token},
          ${userAgent},
          ${ipAddress},
          ${expiresAtISO},
          ${nowISO}
        )
      `;
      tokenCreated = true;
    } catch (tokenError) {
      console.error('[Google Auth] Token creation error (raw):', tokenError);
      // Fallback: try Prisma create
      try {
        await db.apiToken.create({
          data: {
            id: randomUUID(),
            user_id: user.id,
            token,
            expires_at: expiresAtISO,
          },
        });
        tokenCreated = true;
      } catch (fallbackError) {
        console.error('[Google Auth] Fallback token creation failed:', fallbackError);
      }
    }

    if (!tokenCreated) {
      console.warn(
        '[Google Auth] Token could not be persisted — returning in-memory token (session will not survive server restart)'
      );
    }

    // ── Step 5: Get subscription info ─────────────────────────────────────────
    let subscriptionTier = user.subscription_tier || 'free';
    try {
      const subscription = await db.userSubscription.findUnique({
        where: { user_id: user.id },
        include: { SubscriptionPlan: true },
      });
      if (subscription?.SubscriptionPlan?.name) {
        subscriptionTier = subscription.SubscriptionPlan.name;
      }
    } catch (subError) {
      console.log(
        '[Google Auth] Could not fetch subscription (non-critical):',
        subError instanceof Error ? subError.message : subError
      );
    }

    // ── Step 6: Determine admin status (consistent with google-signin) ────────
    const isAdmin = isServerAdmin(email);

    console.log('[Google Auth] ✅ Mobile auth successful for:', email);

    return NextResponse.json({
      success: true,
      message: 'Google login successful',
      message_ar: 'تم تسجيل الدخول عبر جوجل بنجاح',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        image: user.image,
        subscription_tier: isAdmin ? 'admin' : subscriptionTier,
        is_admin: isAdmin,
        is_active: true,
      },
      token,
      token_type: 'Bearer',
      expires_in: TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
      is_new_user: isNewUser,
    });
  } catch (error) {
    console.error('[POST /api/auth/google] Error:', error);
    console.error(
      '[POST /api/auth/google] Error stack:',
      error instanceof Error ? error.stack : 'No stack'
    );

    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ أثناء تسجيل الدخول عبر جوجل',
        error_en: error instanceof Error ? error.message : 'Unknown error',
        error_details: error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack?.split('\n').slice(0, 3),
            }
          : String(error),
      },
      { status: 500 }
    );
  }
}
