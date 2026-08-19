import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';

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

  // Build the signin URL
  const baseUrl = process.env.NEXTAUTH_URL || 
    (request.headers.get('x-forwarded-host') 
      ? `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host')}`
      : 'http://localhost:3000');
  
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
    
    // All valid client IDs (Web + Android)
    const KNOWN_MOBILE_CLIENT_IDS = [
      '642150971767-ga2gohq77mcsgoa385ekciubnmvr0b02.apps.googleusercontent.com',
      '393659426254-n4ngsvhtfie714l0o5h8mlcpm5c58195.apps.googleusercontent.com',
    ];
    const VALID_CLIENT_IDS = Array.from(
      new Set([GOOGLE_CLIENT_ID, ...GOOGLE_ANDROID_CLIENT_IDS, ...KNOWN_MOBILE_CLIENT_IDS].filter(Boolean))
    );
    
    console.log('[Google Signin] Valid Client IDs:', VALID_CLIENT_IDS);
    console.log('[Google Signin] Token audience:', googleUser.aud);

    // Verify the audience matches one of our client IDs
    const audienceMatch = VALID_CLIENT_IDS.includes(googleUser.aud);
    
    if (VALID_CLIENT_IDS.length > 0 && !audienceMatch) {
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

    // Check if user exists
    let user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
    });

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
