/**
 * admin-identities.ts — Central registry of admin emails & usernames.
 *
 * 🔒 SECURITY (P0.1 / SEC-01): previously every route/admin gate hardcoded its
 * own copy of `ADMIN_EMAILS` / `ADMIN_USERNAMES`. That meant:
 *   1. No way to change admin list without a code deploy.
 *   2. Duplicated lists drifted out of sync (some files had 3 emails, others 2).
 *   3. Source code shipped the admin email list to the browser bundle.
 *
 * This module reads the admin list from environment variables with a documented
 * fallback to the historical hardcoded defaults (so the platform keeps working
 * if env vars are not yet configured). Operators are encouraged to set:
 *   - ADMIN_EMAILS="alice@example.com,bob@example.com"
 *   - ADMIN_USERNAMES="alice,bob"
 *   - NEXT_PUBLIC_ADMIN_EMAILS="..." (mirror, for client-side gates)
 *   - NEXT_PUBLIC_ADMIN_USERNAMES="..." (mirror, for client-side gates)
 *
 * Both server-only and `NEXT_PUBLIC_` vars are read here. In Next.js:
 *   - `process.env.NEXT_PUBLIC_*` is inlined at build time → browser-safe.
 *   - `process.env.ADMIN_*` (no prefix) is server-only → not shipped.
 * For client-safe code we use the `NEXT_PUBLIC_*` variant and accept that it is
 * shipped to the browser. For server-side code we prefer the server-only var
 * (so that admins added via env do not need a re-deploy of the client bundle).
 *
 * Constitution Rule 2 forbids editing `.env` directly; this module makes the
 * codebase env-aware WITHOUT touching `.env`.
 */

/** Historical default admin emails (pre-P0.1 baseline). */
const DEFAULT_ADMIN_EMAILS: readonly string[] = Object.freeze([
  'enmohsen20111975@gmail.com', // صاحب المنصة
  'enmohsen2011975@gmail.com', // admin قديم
  'ceo@m2y.net',
  'mohseny@m2y.net',
]);

/** Historical default admin usernames (pre-P0.1 baseline). */
const DEFAULT_ADMIN_USERNAMES: readonly string[] = Object.freeze([
  'mohseny',
  'admin',
]);

/**
 * Parse a comma-separated env var into a normalized lower-cased list.
 * Empty / unset env var → null (caller falls back to defaults).
 */
function parseAdminList(raw: string | undefined): string[] | null {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : null;
}

/**
 * Returns the admin emails for SERVER-side use.
 * Prefers `ADMIN_EMAILS` (server-only), then `NEXT_PUBLIC_ADMIN_EMAILS`
 * (shared with client bundle), then the historical defaults.
 *
 * Server-only callers (API routes) should use this so that admins added via
 * `ADMIN_EMAILS` env var take effect without a client rebuild.
 */
export function getServerAdminEmails(): string[] {
  return (
    parseAdminList(process.env.ADMIN_EMAILS) ??
    parseAdminList(process.env.NEXT_PUBLIC_ADMIN_EMAILS) ??
    [...DEFAULT_ADMIN_EMAILS]
  );
}

/**
 * Returns the admin usernames for SERVER-side use.
 * Prefers `ADMIN_USERNAMES`, then `NEXT_PUBLIC_ADMIN_USERNAMES`,
 * then the historical defaults.
 */
export function getServerAdminUsernames(): string[] {
  return (
    parseAdminList(process.env.ADMIN_USERNAMES) ??
    parseAdminList(process.env.NEXT_PUBLIC_ADMIN_USERNAMES) ??
    [...DEFAULT_ADMIN_USERNAMES]
  );
}

/**
 * Returns the admin emails for CLIENT-side use.
 * Reads ONLY from `NEXT_PUBLIC_ADMIN_EMAILS` (inlined at build time).
 * Falls back to historical defaults if unset — note these defaults WILL be
 * shipped to the browser bundle (same as before P0.1, so no regression).
 *
 * The actual security boundary is server-side: any sensitive operation MUST
 * call `getServerAdminEmails()` (via requireAdminAsync) on the server, not
 * this client-side function.
 */
export function getClientAdminEmails(): string[] {
  return (
    parseAdminList(process.env.NEXT_PUBLIC_ADMIN_EMAILS) ?? [...DEFAULT_ADMIN_EMAILS]
  );
}

/**
 * Returns the admin usernames for CLIENT-side use.
 * Reads ONLY from `NEXT_PUBLIC_ADMIN_USERNAMES` (inlined at build time).
 */
export function getClientAdminUsernames(): string[] {
  return (
    parseAdminList(process.env.NEXT_PUBLIC_ADMIN_USERNAMES) ?? [...DEFAULT_ADMIN_USERNAMES]
  );
}

/**
 * Server-side admin check. Use this in API routes / server components.
 * Performs case-insensitive matching and trims whitespace.
 */
export function isServerAdmin(
  email: string | null | undefined,
  username?: string | null
): boolean {
  if (email) {
    const e = email.toLowerCase().trim();
    if (getServerAdminEmails().includes(e)) return true;
  }
  if (username) {
    const u = username.toLowerCase().trim();
    if (getServerAdminUsernames().includes(u)) return true;
  }
  return false;
}

/**
 * Client-side admin check. Use this only for UI gating (hiding/showing buttons).
 * All sensitive operations MUST re-validate on the server via
 * `requireAdminAsync` from `@/lib/admin-auth-server`.
 */
export function isClientAdmin(
  email: string | null | undefined,
  username?: string | null
): boolean {
  if (email) {
    const e = email.toLowerCase().trim();
    if (getClientAdminEmails().includes(e)) return true;
  }
  if (username) {
    const u = username.toLowerCase().trim();
    if (getClientAdminUsernames().includes(u)) return true;
  }
  return false;
}
