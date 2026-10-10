/**
 * subscription-enforcement.ts — Server-side Free-tier LIMIT enforcement
 * ====================================================================
 * FIX-P3-P5-P6 (Group P3 — Fix 2)
 *
 * The client-side `subscription-gate.ts` `canAddMore()` helper is for UI
 * hints only — anyone can bypass it by editing the JS bundle. Real limit
 * enforcement MUST happen server-side. This module is the single source
 * of truth for the four server-side gates:
 *
 *   - enforceWatchlistLimit  → POST /api/watchlist
 *   - enforcePortfolioLimit  → POST /api/finance/assets
 *   - enforceAlertLimit      → POST /api/alerts/create
 *   - enforceAILimit         → POST /api/ai/chat  (daily check)
 *
 * Each function:
 *   1. Resolves the user's tier from auth.db (Prisma).
 *   2. Reads the CURRENT count from the relevant SQLite DB
 *      (stocks.db.user_stock_watchlists, finance.db.portfolio_assets,
 *       stocks.db.user_stock_watchlists alerts, or auth.db.usage_daily).
 *   3. Compares against the tier limit from `getTierLimits()` /
 *      `AI_DAILY_LIMITS`.
 *   4. Throws `EnforcementError` if the limit would be exceeded.
 *
 * Paid tiers (premium / pro / b2b_* / developer / admin) always bypass —
 * their limits are 9999 in `subscription-gate.ts`. This means the function
 * is a no-op for paid users (fast path: read tier → return).
 *
 * Non-fatal: any DB error is swallowed to avoid blocking legitimate writes
 * when a DB is temporarily unavailable (logged via `console.warn`).
 * ====================================================================
 */

import { getTierLimits, AI_DAILY_LIMITS, PAID_TIERS } from '@/lib/subscription-gate';

/**
 * Custom error class. Routes can catch it and respond with 403 + a
 * structured JSON body so the client can show a friendly "limit reached"
 * upsell message.
 */
export class EnforcementError extends Error {
  readonly code: 'WATCHLIST_LIMIT' | 'PORTFOLIO_LIMIT' | 'ALERT_LIMIT' | 'AI_DAILY_LIMIT';
  readonly tier: string;
  readonly limit: number;
  readonly currentCount: number;
  readonly upgradeUrl: string;

  constructor(
    code: EnforcementError['code'],
    tier: string,
    limit: number,
    currentCount: number,
  ) {
    const messages: Record<EnforcementError['code'], string> = {
      WATCHLIST_LIMIT: `Watchlist limit reached (${currentCount}/${limit}) for tier "${tier}"`,
      PORTFOLIO_LIMIT: `Portfolio limit reached (${currentCount}/${limit}) for tier "${tier}"`,
      ALERT_LIMIT: `Alert limit reached (${currentCount}/${limit}) for tier "${tier}"`,
      AI_DAILY_LIMIT: `Daily AI message limit reached (${currentCount}/${limit}) for tier "${tier}"`,
    };
    super(messages[code]);
    this.name = 'EnforcementError';
    this.code = code;
    this.tier = tier;
    this.limit = limit;
    this.currentCount = currentCount;
    this.upgradeUrl = '/pricing';
  }

  /** JSON-serialisable payload for the API response. */
  toJSON(): Record<string, unknown> {
    return {
      error: this.code,
      message: this.message,
      tier: this.tier,
      limit: this.limit,
      current_count: this.currentCount,
      upgradeUrl: this.upgradeUrl,
    };
  }
}

// ---------------------------------------------------------------------------
// Tier resolution (lazy Prisma import — keeps edge bundles light)
// ---------------------------------------------------------------------------

// PAID_TIERS is imported from @/lib/subscription-gate (canonical source — see
// P0-5 Fix Battalion: Unify PAID_TIERS). Do NOT redefine inline.

async function resolveTier(userId: string | null): Promise<{ tier: string; isPaid: boolean }> {
  if (!userId) return { tier: 'free', isPaid: false };
  try {
    const { authDb } = await import('@/lib/db-auth');
    const user = await authDb.user.findUnique({
      where: { id: userId },
      select: { subscription_tier: true },
    });
    const tier = (user?.subscription_tier || 'free').toLowerCase();
    return { tier, isPaid: PAID_TIERS.has(tier) };
  } catch (err) {
    // Fail-open: if we can't read the auth DB, we do NOT block the write
    // (would lock paying users out during a DB hiccup). Treat as free +
    // log — but still attempt the limit check below with the free limit.
    console.warn('[subscription-enforcement] resolveTier: auth DB read failed, treating as free:', err);
    return { tier: 'free', isPaid: false };
  }
}

// ---------------------------------------------------------------------------
// better-sqlite3 lazy loader (so this module stays importable from any
// runtime — even ones without better-sqlite3 native bindings installed).
// ---------------------------------------------------------------------------

async function openStocksDbReadonly(): Promise<{
  count: number;
  close: () => void;
} | null> {
  try {
    // dynamic require — avoids bundling the native addon when unused.
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    const path = require('path') as typeof import('path');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const db = new Database(stocksDbPath, { readonly: true, timeout: 3000 });
    return {
      count: 0, // sentinel — actual count returned by caller
      close: () => { try { db.close(); } catch { /* ignore - safe-by-design */ } },
    };
  } catch (err) {
    console.warn('[subscription-enforcement] openStocksDbReadonly: better-sqlite3 unavailable:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// enforceWatchlistLimit
// ---------------------------------------------------------------------------

/**
 * Free: 5 watchlist items. Paid: bypass (limit 9999).
 *
 * Reads the user's current watchlist count from
 * `stocks.db.user_stock_watchlists` (legacy: also counts rows with the
 * same user_id across all legacy Google IDs — but enforcement only uses
 * the primary CUID, which is the correct user-scoped boundary).
 */
export async function enforceWatchlistLimit(userId: string | null): Promise<void> {
  const { tier, isPaid } = await resolveTier(userId);
  if (isPaid) return; // fast path

  const limit = getTierLimits(tier).max_watchlist;
  if (!userId) return; // unauthenticated — the route's 401 handles this

  // Lazy import — same pattern as auth-helper.ts.
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const path = require('path') as typeof import('path');
  const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');

  try {
    const db = new Database(stocksDbPath, { readonly: true, timeout: 3000 });
    try {
      const row = db
        .prepare('SELECT COUNT(*) AS n FROM user_stock_watchlists WHERE user_id = ?')
        .get(userId) as { n: number } | undefined;
      const currentCount = Number(row?.n) || 0;
      if (currentCount >= limit) {
        throw new EnforcementError('WATCHLIST_LIMIT', tier, limit, currentCount);
      }
    } finally {
      try { db.close(); } catch { /* ignore - safe-by-design */ }
    }
  } catch (err) {
    if (err instanceof EnforcementError) throw err;
    console.warn('[subscription-enforcement] enforceWatchlistLimit: DB read failed, failing open:', err);
  }
}

// ---------------------------------------------------------------------------
// enforcePortfolioLimit
// ---------------------------------------------------------------------------

/**
 * Free: 5 portfolio assets. Paid: bypass (limit 9999).
 *
 * Reads the user's current portfolio count from
 * `finance.db.portfolio_assets` (sql.js-backed via @/lib/finance-db).
 */
export async function enforcePortfolioLimit(userId: string | null): Promise<void> {
  const { tier, isPaid } = await resolveTier(userId);
  if (isPaid) return;

  const limit = getTierLimits(tier).max_portfolio;
  if (!userId) return;

  try {
    const { getFinanceDb } = await import('@/lib/finance-db');
    const db = await getFinanceDb();
    // finance.db is sql.js-backed — synchronous prepare().get() works.
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM portfolio_assets WHERE user_id = ?')
      .get(userId) as { n: number } | undefined;
    const currentCount = Number(row?.n) || 0;
    if (currentCount >= limit) {
      throw new EnforcementError('PORTFOLIO_LIMIT', tier, limit, currentCount);
    }
  } catch (err) {
    if (err instanceof EnforcementError) throw err;
    console.warn('[subscription-enforcement] enforcePortfolioLimit: DB read failed, failing open:', err);
  }
}

// ---------------------------------------------------------------------------
// enforceAlertLimit
// ---------------------------------------------------------------------------

/**
 * Free: 3 alerts. Paid: bypass (limit 9999).
 *
 * Alerts are stored in the SAME `user_stock_watchlists` table as watchlist
 * items (a watchlist row with `alert_price_above/below/change_percent` set
 * IS an alert). We count rows where ANY alert column is non-null.
 */
export async function enforceAlertLimit(userId: string | null): Promise<void> {
  const { tier, isPaid } = await resolveTier(userId);
  if (isPaid) return;

  const limit = getTierLimits(tier).max_alerts;
  if (!userId) return;

  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const path = require('path') as typeof import('path');
  const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');

  try {
    const db = new Database(stocksDbPath, { readonly: true, timeout: 3000 });
    try {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n FROM user_stock_watchlists
           WHERE user_id = ?
             AND (alert_price_above IS NOT NULL
               OR alert_price_below IS NOT NULL
               OR alert_change_percent IS NOT NULL)`,
        )
        .get(userId) as { n: number } | undefined;
      const currentCount = Number(row?.n) || 0;
      if (currentCount >= limit) {
        throw new EnforcementError('ALERT_LIMIT', tier, limit, currentCount);
      }
    } finally {
      try { db.close(); } catch { /* ignore - safe-by-design */ }
    }
  } catch (err) {
    if (err instanceof EnforcementError) throw err;
    console.warn('[subscription-enforcement] enforceAlertLimit: DB read failed, failing open:', err);
  }
}

// ---------------------------------------------------------------------------
// enforceAILimit (daily)
// ---------------------------------------------------------------------------

/**
 * Free: 3 AI messages per day. Paid: bypass (limit 9999).
 *
 * Reads the user's `usage_daily` row for today (UTC date) from auth.db.
 * If no row exists yet (first message of the day), the count is 0 — but
 * the route will upsert the row after the message succeeds. We only
 * enforce the limit; the route is responsible for incrementing.
 */
export async function enforceAILimit(userId: string | null): Promise<void> {
  const { tier, isPaid } = await resolveTier(userId);
  if (isPaid) return;

  const limit = AI_DAILY_LIMITS[tier] ?? AI_DAILY_LIMITS.free;
  if (!userId) return;

  try {
    const { authDb } = await import('@/lib/db-auth');
    // Use UTC date so the boundary is deterministic regardless of server TZ.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const row = await authDb.usageDaily.findUnique({
      where: { user_id_date: { user_id: userId, date: today } },
      select: { ai_messages_used: true },
    });
    const currentCount = Number(row?.ai_messages_used) || 0;
    if (currentCount >= limit) {
      throw new EnforcementError('AI_DAILY_LIMIT', tier, limit, currentCount);
    }
  } catch (err) {
    if (err instanceof EnforcementError) throw err;
    console.warn('[subscription-enforcement] enforceAILimit: auth DB read failed, failing open:', err);
  }
}

// ---------------------------------------------------------------------------
// Helpers exported for routes that want to increment usage_daily after a
// successful AI message (best-effort — failure to increment is not fatal).
// ---------------------------------------------------------------------------

/**
 * Increment the user's `usage_daily.ai_messages_used` counter by 1.
 * Called by /api/ai/chat AFTER a successful AI response so that the next
 * call's `enforceAILimit` sees the updated count.
 */
export async function incrementAIDailyUsage(userId: string | null): Promise<void> {
  if (!userId) return;
  try {
    const { authDb } = await import('@/lib/db-auth');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // Upsert — creates the row if it doesn't exist (first message of day).
    await authDb.usageDaily.upsert({
      where: { user_id_date: { user_id: userId, date: today } },
      update: { ai_messages_used: { increment: 1 } },
      create: { user_id: userId, date: today, ai_messages_used: 1 },
    });
  } catch (err) {
    console.warn('[subscription-enforcement] incrementAIDailyUsage: failed (non-fatal):', err);
  }
}

// Avoid an unused-import warning when openStocksDbReadonly isn't called by
// any current consumer (kept for parity / future use).
void openStocksDbReadonly;
