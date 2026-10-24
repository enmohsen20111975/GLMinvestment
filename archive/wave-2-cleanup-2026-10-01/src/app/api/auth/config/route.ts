import { NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


/**
 * GET /api/auth/config
 * Returns which auth providers are configured (without exposing secrets).
 * Used by the login page to show/hide Google login button gracefully.
 * Also used by mobile apps to verify configuration.
 */
export async function GET() {
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const nextAuthSecret = process.env.NEXTAUTH_SECRET || '';
  const androidClientIds = process.env.GOOGLE_ANDROID_CLIENT_IDS || '';

  // For Web OAuth flow (NextAuth) - requires both Client ID and Secret
  const isGoogleConfigured =
    googleClientId !== '' &&
    googleClientId !== 'your-google-client-id.apps.googleusercontent.com' &&
    googleClientSecret !== '' &&
    googleClientSecret !== 'your-google-client-secret' &&
    googleClientSecret !== 'your-google-client-secret-here';

  const isNextAuthConfigured =
    nextAuthSecret !== '' &&
    nextAuthSecret !== 'fallback-deploy-secret-change-me-in-production-egx-2024';

  // For Mobile Auth (ID Token verification) - only requires Client ID
  const isMobileGoogleConfigured =
    googleClientId !== '' &&
    googleClientId !== 'your-google-client-id.apps.googleusercontent.com';

  return NextResponse.json({
    google: {
      configured: isGoogleConfigured,
      clientIdSet: googleClientId !== '',
      clientSecretSet: googleClientSecret !== '',
      // For mobile apps: the Web Client ID to use as serverClientId
      webClientId: googleClientId || null,
    },
    mobile: {
      googleAuthAvailable: isMobileGoogleConfigured,
      // Android Client IDs for reference
      androidClientIds: androidClientIds ? androidClientIds.split(',').map(id => id.trim()) : [],
    },
    nextauth: {
      configured: isNextAuthConfigured,
      secretSet: nextAuthSecret !== '',
    },
    environment: process.env.NODE_ENV || 'development',
    siteUrl: process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'not-set',
  });
}
