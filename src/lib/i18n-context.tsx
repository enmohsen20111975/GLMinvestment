'use client';

/**
 * i18n-context.tsx — Cookie-based i18n Context Provider + useTranslation hook.
 *
 * FOCUS-5-TASKS — i18n Phase 2 Full (2026-10-01):
 *   We tried next-intl plugin but it failed with "Couldn't find next-intl config file"
 *   despite the file being correctly placed. Rather than fighting the plugin,
 *   we built a SIMPLER cookie-based approach that:
 *     1. Reads the locale from a cookie set by /api/i18n/set-locale.
 *     2. Loads the messages JSON for that locale from /public/locales/.
 *     3. Exposes useTranslation() hook to all client components.
 *
 *   This works WITHOUT modifying next.config.ts (no plugin needed) and
 *   without restructuring the routing (Rule 4 — NO-NEW-SCREENS).
 *
 * Usage:
 *   // In any client component:
 *   const t = useTranslation();
 *   <button>{t('nav.dashboard')}</button>
 *
 *   // Or scoped:
 *   const t = useTranslation('nav');
 *   <button>{t('dashboard')}</button>
 *
 * Reference: Rule 62 (GIT-PUSH-DISCIPLINE).
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

// ============================================================
// Types
// ============================================================

type Messages = Record<string, any>;

interface I18nContextValue {
  locale: 'ar' | 'en';
  messages: Messages;
  /** Translate a dot-notation key (e.g., 'nav.dashboard'). */
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Switch the active locale (sets cookie + reloads messages). */
  setLocale: (locale: 'ar' | 'en') => Promise<void>;
  /** Whether the messages file is still loading. */
  loading: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// ============================================================
// Helpers
// ============================================================

const VALID_LOCALES = ['ar', 'en'] as const;
type Locale = (typeof VALID_LOCALES)[number];
const DEFAULT_LOCALE: Locale = 'ar';

/** Read the locale cookie on the client side. */
function readCookieLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith('NEXT_LOCALE='));
  const value = match?.split('=')[1] as Locale | undefined;
  return value && VALID_LOCALES.includes(value) ? value : DEFAULT_LOCALE;
}

/** Resolve a dot-notation key in a nested messages object. */
function resolveKey(messages: Messages, key: string): string | undefined {
  const parts = key.split('.');
  let current: any = messages;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

/** Interpolate {param} placeholders in a translation string. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const value = params[name];
    return value !== undefined ? String(value) : `{${name}}`;
  });
}

// ============================================================
// Provider
// ============================================================

// Cache loaded messages so we don't re-fetch on every locale switch.
const messagesCache: Record<Locale, Messages | undefined> = {
  ar: undefined,
  en: undefined,
};

async function loadMessages(locale: Locale): Promise<Messages> {
  if (messagesCache[locale]) return messagesCache[locale]!;
  try {
    // Dynamic import so the bundler code-splits per locale.
    // The messages/*.json files are statically analyzable by Next.js.
    const mod = await import(`../../messages/${locale}.json`);
    messagesCache[locale] = mod.default || mod;
    return messagesCache[locale]!;
  } catch (err) {
    console.error(`[i18n] failed to load messages for locale "${locale}":`, err);
    // Fall back to empty messages — the t() function will return the key itself.
    return {};
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // FOCUS-5-TASKS — i18n Phase 2 Full (2026-10-01):
  // Use lazy initializers so the locale + messages are correct on the
  // very first render (no flash of Arabic when the cookie says 'en').
  // The cookie is read synchronously via `document.cookie` — no async needed.

  const [locale, setLocaleState] = useState<Locale>(() => readCookieLocale());
  const [messages, setMessages] = useState<Messages>({});
  const [loading, setLoading] = useState(true);

  // FOCUS-5-TASKS — i18n Phase 2 Full (2026-10-01):
  // On mount: read the cookie AGAIN on the client (the lazy initializer runs on
  // both server + client, but `document.cookie` is undefined on the server, so
  // the server renders with DEFAULT_LOCALE='ar'. On the client, we need to
  // re-read the cookie + update the locale if it differs. This triggers a
  // re-render with the correct messages.
  useEffect(() => {
    const clientLocale = readCookieLocale();
    if (clientLocale !== locale) {
      setLocaleState(clientLocale);
    } else {
      loadMessages(locale)
        .then((msgs) => setMessages(msgs))
        .catch((err) => {
          console.error('[i18n] load failed for locale', locale, err);
          // Fallback to empty messages so the UI still renders instead of
          // permanently hanging in loading state (which would white-screen
          // the whole app — i18n wraps everything in Providers.tsx).
          setMessages({});
        })
        .finally(() => setLoading(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When locale changes (either from the mount effect above or from setLocale):
  // load the messages for that locale.
  useEffect(() => {
    if (!locale) return;
    loadMessages(locale)
      .then((msgs) => setMessages(msgs))
      .catch((err) => {
        console.error('[i18n] load failed for locale', locale, err);
        // Fallback to empty messages so the UI still renders instead of
        // permanently hanging in loading state.
        setMessages({});
      })
      .finally(() => setLoading(false));
  }, [locale]);

  // Switch locale: POST to /api/i18n/set-locale → update state + load new messages.
  const setLocale = useCallback(async (newLocale: Locale) => {
    if (newLocale === locale) return;
    setLoading(true);
    try {
      const res = await fetch('/api/i18n/set-locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: newLocale }),
      });
      if (res.ok) {
        setLocaleState(newLocale);
        const newMessages = await loadMessages(newLocale);
        setMessages(newMessages);
        // Update <html lang/dir> directly (avoids full page reload).
        if (typeof document !== 'undefined') {
          document.documentElement.lang = newLocale;
          document.documentElement.dir = newLocale === 'ar' ? 'rtl' : 'ltr';
        }
      }
    } catch (err) {
      console.error('[i18n] failed to switch locale:', err);
    } finally {
      setLoading(false);
    }
  }, [locale]);

  // The translator function. Returns the key itself if no translation found.
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const template = resolveKey(messages, key);
      if (template === undefined) {
        // In dev: warn about missing keys so we can spot them in the console.
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[i18n] missing key: "${key}" for locale "${locale}"`);
        }
        return key;
      }
      return interpolate(template, params);
    },
    [messages, locale]
  );

  return (
    <I18nContext.Provider value={{ locale, messages, t, setLocale, loading }}>
      {children}
    </I18nContext.Provider>
  );
}

// ============================================================
// Hooks
// ============================================================

/**
 * useTranslation — access the translator function.
 *
 * Usage:
 *   const t = useTranslation();
 *   <h1>{t('dashboard.title')}</h1>
 *
 *   // Or with params (interpolation):
 *   <p>{t('alerts.count', { count: 5 })}</p>  // "5 تنبيهات" / "5 alerts"
 */
export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Should never happen — provider wraps the whole app via Providers.tsx.
    // But if it does, return a no-op translator that just returns the key.
    return (key: string) => key;
  }
  return ctx.t;
}

/**
 * useLocale — access the current locale + setter.
 *
 * Usage:
 *   const { locale, setLocale } = useLocale();
 *   <span>{locale === 'ar' ? 'عربى' : 'English'}</span>
 */
export function useLocale() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      locale: DEFAULT_LOCALE as Locale,
      setLocale: async () => {},
      loading: false,
    };
  }
  return { locale: ctx.locale, setLocale: ctx.setLocale, loading: ctx.loading };
}
