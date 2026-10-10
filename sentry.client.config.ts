/**
 * Sentry Client-Side Config (browser)
 * ===================================
 * P0 #15 fix (2026-09-27): Project had ZERO error tracking before this.
 *
 * Reads DSN from process.env.SENTRY_DSN. If empty/unset, Sentry is
 * NOT initialised — the app keeps running normally (safe no-op).
 *
 * Sampling:
 *   - errors: 100% in production, 100% in dev (let's see everything in dev)
 *   - transactions (performance): 10% in production, 100% in dev
 *
 * Noise filters:
 *   - Hydration mismatches (Next.js/React SSR vs CSR divergence — usually
 *     caused by browser extensions or Date.now() at render time, not real bugs)
 *   - ResizeObserver loop limit exceeded (Chrome harmless warning)
 *
 * Doc: https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
const isProd = process.env.NODE_ENV === 'production';

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    enabled: isProd,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.NEXT_PUBLIC_APP_VERSION || undefined,

    // Sample 10% of transactions for performance monitoring in prod,
    // 100% in dev so we can see what's happening locally.
    tracesSampleRate: isProd ? 0.1 : 1.0,

    // Capture 100% of errors (errors are rare + valuable).
    sampleRate: 1.0,

    // Auto-session replay (Sentry's rrweb-based session replay).
    // Disable in dev to avoid noise; enable 10% in prod for forensics.
    replaysSessionSampleRate: isProd ? 0.1 : 0,
    replaysOnErrorSampleRate: 1.0,

    ignoreErrors: [
      // Hydration mismatches — usually browser-extension or Date.now() noise
      'Hydration failed because the initial UI does not match what was rendered on the server',
      'Text content does not match server-rendered HTML',
      'Hydration failed because the initial UI does not match',
      // ResizeObserver loop warning — Chrome-specific, harmless
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      // Browser-extension noise
      'Non-Error promise rejection captured',
      'cancelled',
      // AbortController cancellation noise
      'AbortError',
      // Network blips — usually transient
      'Network request failed',
      'Failed to fetch',
    ],

    denyUrls: [
      // Browser extensions inject scripts that throw unrelated errors
      /extensions\//i,
      /^chrome:\/\//i,
      /^moz-extension:\/\//i,
      /googletagmanager\.com/i,
      /google-analytics\.com/i,
    ],

    beforeSend(event) {
      // Drop events without a stack trace (low signal-to-noise)
      if (!event.exception?.values?.[0]?.stacktrace) {
        return null;
      }
      return event;
    },
  });
}
