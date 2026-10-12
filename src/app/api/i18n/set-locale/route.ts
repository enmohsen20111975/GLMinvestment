import { NextRequest } from 'next/server';
import { apiOk, apiErr } from '@/lib/api-response';

/**
 * POST /api/i18n/set-locale
 *
 * PKG1-DEV-A (Bilingual): sets the `NEXT_LOCALE` cookie to switch the UI
 * language. The cookie is read by `src/lib/i18n-context.tsx` on the client.
 *
 * PKG2-DEV-A (Engineering): migrated to the Unified Response Schema
 * (`apiOk` / `apiErr` from `@/lib/api-response`). Removes `err: any`.
 *
 * Body: { "locale": "ar" | "en" }
 * Cookie lifetime: 1 year (maxAge: 365 * 24 * 60 * 60).
 * httpOnly: false — so the LanguageToggle client component can read it too.
 * sameSite: 'lax' — allows the cookie to be sent on top-level navigations.
 *
 * Reference: Rule 62 (GIT-PUSH-DISCIPLINE), Rule 67 (SSOT — unified response).
 */

const VALID_LOCALES = ['ar', 'en'] as const;
type Locale = (typeof VALID_LOCALES)[number];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const requestedLocale: unknown = body?.locale;

    // Validate the locale — reject anything other than 'ar' or 'en'.
    if (
      typeof requestedLocale !== 'string' ||
      !VALID_LOCALES.includes(requestedLocale as Locale)
    ) {
      return apiErr(
        'invalid_locale',
        `Invalid locale. Must be one of: ${VALID_LOCALES.join(', ')}`,
        400
      );
    }

    const locale = requestedLocale as Locale;

    // Build the unified success response, then attach the cookie.
    // (apiOk returns a NextResponse, which exposes .cookies.)
    const response = apiOk({
      locale,
      message: `Locale set to ${locale}`,
    });

    response.cookies.set('NEXT_LOCALE', locale, {
      maxAge: 365 * 24 * 60 * 60, // 1 year
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return apiErr('internal_error', message, 500);
  }
}
