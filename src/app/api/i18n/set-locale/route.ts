import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/i18n/set-locale
 *
 * FOCUS-5-TASKS — i18n Phase 2 (2026-10-01):
 *   Sets the `NEXT_LOCALE` cookie to switch the UI language.
 *   The cookie is read by `src/i18n/i18n.ts` (next-intl getRequestConfig).
 *
 * Body: { "locale": "ar" | "en" }
 * Cookie lifetime: 1 year (maxAge: 365 * 24 * 60 * 60).
 * httpOnly: false — so the LanguageToggle client component can read it too.
 * sameSite: 'lax' — allows the cookie to be sent on top-level navigations.
 *
 * Reference: Rule 62 (GIT-PUSH-DISCIPLINE).
 */

const VALID_LOCALES = ['ar', 'en'] as const;
type Locale = (typeof VALID_LOCALES)[number];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const requestedLocale = body?.locale;

    // Validate the locale — reject anything other than 'ar' or 'en'.
    if (!requestedLocale || !VALID_LOCALES.includes(requestedLocale)) {
      return NextResponse.json(
        { success: false, error: `Invalid locale. Must be one of: ${VALID_LOCALES.join(', ')}` },
        { status: 400 }
      );
    }

    const locale = requestedLocale as Locale;

    // Set the cookie on the response. The browser stores it + sends it on
    // every subsequent request, where next-intl reads it via `cookies()`.
    const response = NextResponse.json({
      success: true,
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
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Internal error' },
      { status: 500 }
    );
  }
}
