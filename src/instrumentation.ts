/**
 * instrumentation.ts — Next.js server instrumentation hook.
 *
 * NOTE: In Next.js 16 with Turbopack, this runs in Edge Runtime.
 * We CANNOT import sqlite-wrapper here because it uses Node.js fs/path.
 * Instead, sql.js is lazily initialized on first API request via
 * `ensureInitialized()` in egx-db.ts.
 *
 * @see https://nextjs.org/docs/app/building-your-application/configuring/instrumentation
 */

export async function register() {
  // sql.js initialization is handled lazily by egx-db.ts ensureInitialized()
  // on first API request. We cannot do it here because Edge Runtime
  // does not support Node.js 'fs' and 'path' modules used by sqlite-wrapper.
  console.log('[instrumentation] Server instrumentation registered (DB init deferred to first API request)');
}
