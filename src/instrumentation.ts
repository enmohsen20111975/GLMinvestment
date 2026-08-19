/**
 * instrumentation.ts — Next.js server instrumentation hook.
 *
 * Features:
 * - Initializes sql.js WASM lazily on first API request
 * - Background sync DISABLED by default to prevent server overload
 * - Use external cron service or manual API calls instead
 *
 * @see https://nextjs.org/docs/app/building-your-application/configuring/instrumentation
 */

export async function register() {
  // sql.js initialization is handled lazily by egx-db.ts ensureInitialized()
  // on first API request. We cannot do it here because Edge Runtime
  // does not support Node.js 'fs' and 'path' modules used by sqlite-wrapper.
  console.log('[instrumentation] Server started - DB init deferred to first API request');
  console.log('[instrumentation] Background sync DISABLED - use external cron or manual API calls');

  // Background sync disabled to prevent server overload on shared hosting
  // To enable, set ENABLE_BACKGROUND_SYNC=true in environment variables
  // Then call /api/cron/auto-sync manually or via external cron service
}
