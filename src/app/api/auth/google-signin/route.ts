import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
import { randomUUID } from 'crypto';
import { checkAuthRateLimit } from '@/lib/rate-limiter'; // FIX-WAVE-1-SECURITY (AUDIT-DEEP-4 #2)
import { repairLastActiveAt } from '@/lib/last-active-helper';

/**
 * GET /api/auth/google-signin
 * Initiates Google OAuth flow by redirecting to the NextAuth Google signin endpoint
 * This endpoint handles the OAuth initiation server-side to avoid client-side issues
 */
export async function GET(request: NextRequest) {
  const callbackUrl = request.nextUrl.searchParams.get('callbackUrl') || '/';
  
  // Check if Google OAuth is configured
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json(
      { error: 'Google OAuth is not configured' },
      { status: 500 }
    );
  }

  // Build the signin URL.
  // Bug FIX-B-FRONTEND / DATA-H12 (security): previously fell back to a
  // hardcoded `http://localhost:3000` when both NEXTAUTH_URL and the
  // x-forwarded-host header were missing — in prod that breaks the OAuth
  // callback AND leaks an internal URL. We now resolve the host from the
  // request itself (x-forwarded-host → host header) and only fall back to
  // localhost in true local development. If none of those resolve in a
  // non-dev environment we return a 500 with a clear message instead of
  // silently redirecting to localhost.
  const xfProto = request.headers.get('x-forwarded-proto') || 'https';
  const xfHost = request.headers.get('x-forwarded-host');
  const hostHeader = request.headers.get('host');
  const isDev = process.env.NODE_ENV === 'development';

  let baseUrl: string | null = null;
  if (process.env.NEXTAUTH_URL) {
    baseUrl = process.env.NEXTAUTH_URL;
  } else if (xfHost) {
    baseUrl = `${xfProto}://${xfHost}`;
  } else if (hostHeader) {
    baseUrl = `${xfProto}://${hostHeader}`;
  } else if (isDev) {
    baseUrl = 'http://localhost:3000';
  }

  if (!baseUrl) {
    console.error(
      '[Google Signin] Cannot determine OAuth callback URL: NEXTAUTH_URL is not configured ' +
      'and no host header was present on the request.',
    );
    return NextResponse.json(
      {
        success: false,
        error: 'OAuth callback URL is not configured (NEXTAUTH_URL missing)',
        error_en: 'OAuth callback URL is not configured (NEXTAUTH_URL missing)',
      },
      { status: 500 },
    );
  }

  // Redirect to NextAuth's Google signin endpoint
  const signinUrl = new URL('/api/auth/signin/google', baseUrl);
  signinUrl.searchParams.set('callbackUrl', callbackUrl);

  console.log('[Google Signin] Redirecting to:', signinUrl.toString());

  return NextResponse.redirect(signinUrl.toString());
}

/**
 * POST /api/auth/google-signin
 * Mobile authentication with Google ID token
 * Used by mobile apps to authenticate users via Google OAuth
 * 
 * Accepts ID tokens from:
 * - Web Client ID (GOOGLE_CLIENT_ID)
 * - Android Client IDs (GOOGLE_ANDROID_CLIENT_IDS)
 */
export async function POST(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  
  try {
    // FIX-WAVE-1-SECURITY (AUDIT-DEEP-4 #2): rate limit Google-signin abuse.
    // 5 attempts per minute per IP. Returns 429 with Retry-After on exceedance.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const rl = checkAuthRateLimit(ip);
    if (!rl.ok) {
      const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { success: false, error: 'rate_limit_exceeded', retry_after_seconds: retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
      );
    }

    console.log('[Google Signin] ========== NEW REQUEST ==========');
    
    const body = await request.json();
    const { id_token } = body;

    if (!id_token || typeof id_token !== 'string') {
      console.error('[Google Signin] No ID token provided');
      return NextResponse.json(
        { 
          success: false, 
          error: 'id_token مطلوب',
          error_en: 'id_token is required',
        },
        { status: 400 }
      );
    }

    console.log('[Google Signin] ID token received, length:', id_token.length);

    // Verify the Google ID token
    const googleResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${id_token}`
    );

    if (!googleResponse.ok) {
      const errorText = await googleResponse.text();
      console.error('[Google Signin] Invalid ID token:', googleResponse.status, errorText);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid Google ID token',
          error_en: `Google verification failed: ${googleResponse.status}`,
        },
        { status: 401 }
      );
    }

    const googleUser = await googleResponse.json();
    
    // Log token details for debugging
    console.log('[Google Signin] Token audience:', googleUser.aud);
    console.log('[Google Signin] Token email:', googleUser.email);

    // Get all valid client IDs
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const GOOGLE_ANDROID_CLIENT_IDS = (process.env.GOOGLE_ANDROID_CLIENT_IDS || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    
    // All valid client IDs (Web + Android).
    // SECURITY (2026-08-19): previously had two hardcoded production client IDs here.
    // They are now read from the GOOGLE_KNOWN_MOBILE_CLIENT_IDS env var (comma-separated).
    // In the sandbox this env var is unset → KNOWN_MOBILE_CLIENT_IDS is empty → only
    // GOOGLE_CLIENT_ID from env is accepted (which is also empty in sandbox → endpoint
    // returns "not configured" as expected). Production sets the env var to the real IDs.
    const KNOWN_MOBILE_CLIENT_IDS = (process.env.GOOGLE_KNOWN_MOBILE_CLIENT_IDS || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    const VALID_CLIENT_IDS = Array.from(
      new Set([GOOGLE_CLIENT_ID, ...GOOGLE_ANDROID_CLIENT_IDS, ...KNOWN_MOBILE_CLIENT_IDS].filter(Boolean))
    );
    
    console.log('[Google Signin] Valid Client IDs:', VALID_CLIENT_IDS);
    console.log('[Google Signin] Token audience:', googleUser.aud);

    // P0-CRIT-5 FIX (2026-10-14): Fail-closed audience verification.
    // If VALID_CLIENT_IDS is empty (env vars unset), reject ALL tokens instead of allowing all.
    // This prevents OAuth bypass when env vars are misconfigured.
    if (VALID_CLIENT_IDS.length === 0) {
      console.error('[Google Signin] ❌ NO VALID_CLIENT_IDS configured — rejecting all tokens (fail-closed)');
      return NextResponse.json(
        {
          success: false,
          error: 'OAuth not configured',
          error_en: 'Server OAuth client IDs are not configured. Set GOOGLE_CLIENT_ID env var.',
        },
        { status: 500 }
      );
    }

    // Verify the audience matches one of our client IDs
    const audienceMatch = VALID_CLIENT_IDS.includes(googleUser.aud);

    if (!audienceMatch) {
      console.error('[Google Signin] ❌ INVALID AUDIENCE');
      console.error('[Google Signin] Token aud:', googleUser.aud);
      console.error('[Google Signin] Expected one of:', VALID_CLIENT_IDS);
      
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid audience',
          error_en: `Invalid audience. Token has "${googleUser.aud}" but expected one of: ${VALID_CLIENT_IDS.join(', ')}`,
          debug: isDev ? {
            token_audience: googleUser.aud,
            valid_client_ids: VALID_CLIENT_IDS,
          } : undefined,
        },
        { status: 401 }
      );
    }

    const email = googleUser.email;
    const name = googleUser.name || googleUser.given_name || '';
    const image = googleUser.picture || '';

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email not provided by Google', error_en: 'Email not provided by Google' },
        { status: 400 }
      );
    }

    console.log('[Google Signin] ✅ Token verified for:', email);

    // Ensure corrupted DateTime strings in SQLite are repaired before Prisma reads them
    try {
      repairLastActiveAt();
    } catch {
      // safe-by-design
    }

    // Check if user exists (with retry fallback if Prisma hits un-repaired column)
    let user = null;
    try {
      user = await db.user.findUnique({
        where: { email: email.toLowerCase() },
      });
    } catch (findErr: any) {
      console.warn('[Google Signin] Prisma findUnique failed, running emergency repair:', findErr?.message);
      repairLastActiveAt();
      user = await db.user.findUnique({
        where: { email: email.toLowerCase() },
      });
    }

    let isNewUser = false;

    // Create user if not exists
    if (!user) {
      isNewUser = true;
      
      // Generate username from email
      const baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
      let username = baseUsername;
      let counter = 1;
      
      // Ensure unique username
      while (await db.user.findUnique({ where: { username } })) {
        username = `${baseUsername}_${counter}`;
        counter++;
      }

      // SUBSCRIPTION-SYSTEM: 7 أيام Premium trial تلقائياً لكل مستخدم جديد.
      const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      user = await db.user.create({
        data: {
          id: randomUUID(),
          email: email.toLowerCase(),
          username,
          name,
          image,
          email_verified: googleUser.email_verified ? new Date() : null,
          subscription_tier: 'free',
          is_active: true,
          last_login: new Date(),
          updated_at: new Date(),
          trial_ends_at: trialEndsAt,
        },
      });

      // Create Google account link
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
        console.log('[Google Signin] Account link error (non-critical):', accountError);
      }
    } else {
      // Update existing user
      if (!user.is_active) {
        return NextResponse.json(
          { success: false, error: 'الحساب غير مفعل', error_en: 'Account is deactivated' },
          { status: 403 }
        );
      }

      // Update last login
      await db.user.update({
        where: { id: user.id },
        data: { 
          last_login: new Date(),
          image: user.image || image,
          name: user.name || name,
        },
      });
    }

    // Check for admin
    const adminEmails = ['enmohsen20111975@gmail.com', 'ceo@m2y.net'];
    const isAdmin = adminEmails.includes(email.toLowerCase());

    // Generate API token
    const token = `egx_${user.id}_${randomUUID()}_${Date.now()}`;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days
    
    // Use ISO string to ensure proper date format in SQLite
    const expiresAtISO = expiresAt.toISOString();

    // Get device info
    const userAgent = request.headers.get('user-agent') || undefined;
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                      request.headers.get('x-real-ip') || undefined;

    // Create token in database using raw query to ensure ISO format
    try {
      await db.$executeRaw`
        INSERT INTO api_tokens (id, user_id, token, device_info, ip_address, expires_at, created_at)
        VALUES (
          ${randomUUID()},
          ${user.id},
          ${token},
          ${userAgent || null},
          ${ipAddress || null},
          ${expiresAtISO},
          ${new Date().toISOString()}
        )
      `;
      console.log('[Google Signin] Token created with ISO date format');
    } catch (tokenError) {
      console.error('[Google Signin] Token creation error:', tokenError);
      // Fallback: try Prisma create
      try {
        await db.apiToken.create({
          data: {
            id: randomUUID(),
            user_id: user.id,
            token,
            expires_at: expiresAt,
          },
        });
        console.log('[Google Signin] Fallback token creation successful');
      } catch (fallbackError) {
        console.error('[Google Signin] Fallback token creation also failed:', fallbackError);
      }
    }

    console.log('[Google Signin] ✅ Mobile auth successful for:', email);

    return NextResponse.json({
      success: true,
      message: 'Google login successful',
      message_ar: 'تم تسجيل الدخول عبر جوجل بنجاح',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        username: user.username,
        subscription_tier: isAdmin ? 'premium' : user.subscription_tier,
        is_admin: isAdmin,
        is_active: user.is_active,
      },
      token,
      token_type: 'Bearer',
      expires_in: 30 * 24 * 60 * 60, // 30 days in seconds
      is_new_user: isNewUser,
    });
  } catch (error) {
    console.error('[Google Signin] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'حدث خطأ أثناء تسجيل الدخول',
        error_en: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
