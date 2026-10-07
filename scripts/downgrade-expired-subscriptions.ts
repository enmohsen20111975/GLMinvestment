#!/usr/bin/env bun
/**
 * downgrade-expired-subscriptions.ts  (P0-2 — Fix Battalion)
 * =====================================
 * Daily cron that enforces subscription expiry on the `User` table.
 *
 * BACKGROUND
 *   The forensic audit (worklog.md Task 16-A finding #2) found NO expiry
 *   mechanism: `/api/paymob/callback` set `UserSubscription.expires_at =
 *   NOW + 30d` and `User.subscription_tier = planId`, but after 30 days
 *   only `UserSubscription.status` was flipped to 'expired' (lazily, only
 *   when the user happened to hit `/api/subscription/current`). The
 *   `User.subscription_tier` was NEVER downgraded, and `checkTrialNotExpired`
 *   only checked the tier — so paid users retained premium FOREVER after a
 *   single payment. Direct revenue leak.
 *
 * WHAT THIS SCRIPT DOES
 *   1. Finds every `UserSubscription` row with `status='active'` AND
 *      `expires_at < NOW()`.
 *   2. In a single Prisma transaction per row:
 *        a. Sets `UserSubscription.status = 'expired'`.
 *        b. Sets `User.subscription_tier = 'free'` UNLESS the user's
 *           current tier is `'admin'` (admin is env-set via ADMIN_EMAILS
 *           and is permanent — Rule 50 MONEY-AS-CUSTOMER-LIFE: do NOT
 *           touch admin accounts even if they happen to have a stale
 *           subscription row from before they were promoted).
 *   3. Logs the count of downgraded rows.
 *
 * IDEMPOTENT
 *   Safe to run multiple times. The `status='active'` filter means rows
 *   that have already been downgraded to 'expired' are not touched again.
 *   The `User.subscription_tier='free'` write is a no-op for users who are
 *   already on 'free'.
 *
 * USAGE
 *   bun run scripts/downgrade-expired-subscriptions.ts             # live run
 *   bun run scripts/downgrade-expired-subscriptions.ts --dry-run   # preview only
 *
 * CRONTAB
 *   Daily at 03:00 UTC (05:00 Cairo) — see crontab.txt entry #24.
 *
 * EXIT CODES
 *   0 — success (including "0 expired subscriptions found")
 *   1 — unrecoverable error (auth DB unreachable, Prisma client load fail)
 */

import { PrismaClient } from '@prisma/auth-client';
import path from 'path';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run') || argv.includes('--dry-run=true');

// ---------------------------------------------------------------------------
// Prisma auth client (same datasource as src/lib/db-auth.ts)
// ---------------------------------------------------------------------------
const dbPath = path.join(process.cwd(), 'db', 'auth.db');
const prisma = new PrismaClient({
  log: ['warn', 'error'],
  datasourceUrl: `file:${dbPath}`,
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  console.log(`[downgrade-expired-subscriptions] START ${nowIso}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  // Step 1: find all active UserSubscription rows whose expires_at is in
  // the past. `expires_at` is a String? in the schema (SQLite datetime
  // string), so we filter in JS after fetching to avoid Prisma's string
  // comparison quirks. The active-subscription set is small (one row per
  // user, and only those who ever paid), so this is cheap.
  const activeSubs = await prisma.userSubscription.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      user_id: true,
      expires_at: true,
      plan_id: true,
      started_at: true,
    },
  });

  // Filter to those whose expires_at is parseable AND in the past.
  // Skip rows where expires_at is null (lifetime subscription — never
  // expires) or unparseable (fail-open per Rule 50 — don't downgrade
  // someone because their timestamp is malformed).
  const expiredSubs = activeSubs.filter((s) => {
    if (!s.expires_at) return false;
    const exp = new Date(s.expires_at);
    if (isNaN(exp.getTime())) return false;
    return exp.getTime() <= now.getTime();
  });

  console.log(
    `[downgrade-expired-subscriptions] active=${activeSubs.length} expired=${expiredSubs.length}`
  );

  if (expiredSubs.length === 0) {
    console.log('[downgrade-expired-subscriptions] nothing to do — exiting 0');
    return;
  }

  // Step 2: for each expired subscription, look up the corresponding User
  // so we can: (a) skip admins (env-set, permanent), (b) only downgrade
  // if the user's CURRENT tier is paid (so we don't accidentally clobber a
  // tier that was already changed by some other flow — e.g. user upgraded
  // again and got a fresh UserSubscription row).
  let downgradedSubs = 0;
  let downgradedUsers = 0;
  let skippedAdmin = 0;
  let skippedAlreadyFree = 0;
  let errors = 0;

  for (const sub of expiredSubs) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: sub.user_id },
        select: { id: true, subscription_tier: true, email: true },
      });

      if (!user) {
        // Orphan subscription row — user was deleted. Skip; the FK is not
        // enforced on UserSubscription (no @relation), so this can happen.
        console.warn(
          `[downgrade-expired-subscriptions] SKIP sub ${sub.id}: user ${sub.user_id} not found (orphan row)`
        );
        skippedAlreadyFree++;
        continue;
      }

      const tier = (user.subscription_tier || 'free').toLowerCase();

      // NEVER touch admin accounts (Rule 50 — admin is env-set permanent
      // staff access, not a paying subscription).
      if (tier === 'admin') {
        console.warn(
          `[downgrade-expired-subscriptions] SKIP user ${user.id} (${user.email}): admin tier — permanent access, never downgraded`
        );
        skippedAdmin++;
        // Still mark the subscription row as expired so it's not picked up
        // again next run — but DO NOT touch the user's tier.
        if (!DRY_RUN) {
          await prisma.userSubscription.update({
            where: { id: sub.id },
            data: { status: 'expired' },
          });
        }
        continue;
      }

      // If the user's tier is already 'free' (or non-paid), just expire
      // the subscription row and move on. (This is the idempotent case —
      // the daily cron ran yesterday, tier is already 'free', sub row is
      // somehow still 'active' because a previous run was interrupted.)
      const PAID_TIERS = new Set([
        'normal', 'premium', 'pro', 'developer', 'enterprise',
        'b2b_starter', 'b2b_pro', 'b2b_enterprise',
        // NOTE: 'admin' intentionally omitted — handled above.
      ]);
      const isPaidTier = PAID_TIERS.has(tier);

      if (DRY_RUN) {
        console.log(
          `[downgrade-expired-subscriptions] DRY-RUN would downgrade user ${user.id} (${user.email}) tier=${tier} → free + sub ${sub.id} → expired`
        );
        downgradedSubs++;
        if (isPaidTier) downgradedUsers++;
        continue;
      }

      // Live run: atomic per-row transaction.
      await prisma.$transaction([
        // (a) mark the subscription row expired (idempotent — no-op if already).
        prisma.userSubscription.update({
          where: { id: sub.id },
          data: { status: 'expired' },
        }),
        // (b) downgrade the user's tier — only if currently paid.
        ...(isPaidTier
          ? [
              prisma.user.update({
                where: { id: user.id },
                data: { subscription_tier: 'free' },
              }),
            ]
          : []),
      ]);

      downgradedSubs++;
      if (isPaidTier) downgradedUsers++;
      console.log(
        `[downgrade-expired-subscriptions] DOWNGRADED user ${user.id} (${user.email}) tier=${tier} → free`
      );
    } catch (err) {
      errors++;
      console.error(
        `[downgrade-expired-subscriptions] ERROR processing sub ${sub.id} (user ${sub.user_id}):`,
        err
      );
    }
  }

  console.log(
    `[downgrade-expired-subscriptions] END — downgradedSubs=${downgradedSubs} downgradedUsers=${downgradedUsers} skippedAdmin=${skippedAdmin} skippedAlreadyFree=${skippedAlreadyFree} errors=${errors}`
  );
}

main()
  .catch((err) => {
    console.error('[downgrade-expired-subscriptions] FATAL:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
