import { NextResponse } from 'next/server';

/**
 * GET /api/auth/config
 * Returns which auth providers are configured (without exposing secrets).
 * Used by the login page to show/hide Google login button gracefully.
 */
export async function GET() {
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const nextAuthSecret = process.env.NEXTAUTH_SECRET || '';

  const isGoogleConfigured =
    googleClientId !== '' &&
    googleClientId !== 'your-google-client-id.apps.googleusercontent.com' &&
    googleClientSecret !== '' &&
    googleClientSecret !== 'your-google-client-secret' &&
    googleClientSecret !== 'your-google-client-secret-here';

  const isNextAuthConfigured =
    nextAuthSecret !== '' &&
    nextAuthSecret !== 'fallback-deploy-secret-change-me-in-production-egx-2024';

  return NextResponse.json({
    google: {
      configured: isGoogleConfigured,
      clientIdSet: googleClientId !== '',
      clientSecretSet: googleClientSecret !== '',
    },
    nextauth: {
      configured: isNextAuthConfigured,
      secretSet: nextAuthSecret !== '',
    },
    environment: process.env.NODE_ENV || 'development',
    siteUrl: process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'not-set',
  });
}
