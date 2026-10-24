/**
 * Sentry Server-Side Config (Node.js runtime)
 * ===========================================
 * P0 #15 fix (2026-09-27): Project had ZERO error tracking before this.
 *
 * This file is loaded by the Next.js server runtime on cold start.
 * It initialises Sentry's Node SDK for capturing server-side errors
 * (API routes, server components, getServerSideProps, edge functions).
 *
 * Reads DSN from process.env.SENTRY_DSN. If empty/unset, Sentry is
 * NOT initialised — the app keeps running normally (safe no-op).
 *
 * Sampling:
 *   - errors: 100%
 *   - transactions (performance): 10% in production, 100% in dev
 *
 * Doc: https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.SENTRY_DSN;
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

    // Capture 100% of errors server-side (errors are rare + valuable).
    sampleRate: 1.0,

    ignoreErrors: [
      // ECONNRESET / EPIPE / ETIMEDOUT — transient network noise
      'ECONNRESET',
      'EPIPE',
      'ETIMEDOUT',
      'ECONNREFUSED',
      // AbortController cancellation noise (from fetch() aborts in API routes)
      'AbortError',
      'The operation was aborted',
      'This operation was aborted',
      // Static-file 404s
      'ENOENT',
    ],

    beforeSend(event) {
      // Drop noisy static-asset 404 stack frames
      const frames = event.exception?.values?.[0]?.stacktrace?.frames;
      if (frames && frames.some((f) => f.filename?.includes('/_next/static/'))) {
        return null;
      }
      return event;
    },

    // Mark known integrations off to avoid surprises with Next.js bundler
    integrations: [],
  });
}
