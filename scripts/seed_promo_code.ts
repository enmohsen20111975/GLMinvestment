/**
 * Seed Promo Code Script (P15-TASK-6)
 * ====================================
 * Creates a test promo code so the admin can immediately verify the
 * redemption flow end-to-end (UI → API → DB → user upgrade).
 *
 * Usage:
 *   bun run scripts/seed_promo_code.ts
 *
 * Default seed (override via CLI flags):
 *   code:         WELCOME90
 *   max_uses:     100
 *   premium_days: 30
 *   expires_at:   (none — never expires)
 *
 * Idempotent: if the code already exists, the script updates its config
 * (resets current_uses to 0, reactivates, refreshes max_uses/premium_days)
 * so you can re-run it during testing without manual DB surgery.
 */

import { PrismaClient } from '@prisma/auth-client';
import path from 'path';

// ---------------------------------------------------------------------------
// CLI parsing (minimal — no external deps)
// ---------------------------------------------------------------------------

function parseArgs(): {
  code: string;
  maxUses: number;
  premiumDays: number;
  expiresAt: Date | null;
} {
  const argv = process.argv.slice(2);
  const get = (key: string, fallback?: string): string | undefined => {
    const idx = argv.indexOf(`--${key}`);
    if (idx === -1 || idx + 1 >= argv.length) return fallback;
    return argv[idx + 1];
  };

  const code = (get('code', 'WELCOME90') || 'WELCOME90').toUpperCase();
  const maxUses = parseInt(get('max-uses', '100') || '100', 10);
  const premiumDays = parseInt(get('premium-days', '30') || '30', 10);
  const expiresAtRaw = get('expires-at'); // ISO string or undefined

  if (!Number.isFinite(maxUses) || maxUses < 1) {
    throw new Error(`--max-uses must be a positive integer (got ${maxUses})`);
  }
  if (!Number.isFinite(premiumDays) || premiumDays < 1) {
    throw new Error(`--premium-days must be a positive integer (got ${premiumDays})`);
  }

  let expiresAt: Date | null = null;
  if (expiresAtRaw) {
    const parsed = new Date(expiresAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`--expires-at must be a valid ISO date (got ${expiresAtRaw})`);
    }
    expiresAt = parsed;
  }

  return { code, maxUses, premiumDays, expiresAt };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { code, maxUses, premiumDays, expiresAt } = parseArgs();

  const dbPath = path.join(process.cwd(), 'db', 'auth.db');
  const db = new PrismaClient({
    datasourceUrl: `file:${dbPath}`,
  });

  try {
    // Idempotent upsert — if the code exists, reset usage + reactivate.
    const promo = await db.promoCode.upsert({
      where: { code },
      update: {
        max_uses: maxUses,
        premium_days: premiumDays,
        expires_at: expiresAt,
        is_active: true,
        current_uses: 0, // reset so re-seeding during testing is clean
        redeemed_by: null,
      },
      create: {
        code,
        max_uses: maxUses,
        premium_days: premiumDays,
        expires_at: expiresAt,
        is_active: true,
        current_uses: 0,
      },
    });

    console.log('============================================================');
    console.log(' ✅  Promo code seeded successfully (P15-TASK-6)');
    console.log('============================================================');
    console.log(`  code:         ${promo.code}`);
    console.log(`  max_uses:     ${promo.max_uses}`);
    console.log(`  current_uses: ${promo.current_uses}`);
    console.log(`  premium_days: ${promo.premium_days}`);
    console.log(`  is_active:    ${promo.is_active}`);
    console.log(`  expires_at:   ${promo.expires_at ? promo.expires_at.toISOString() : '(never)'}`);
    console.log(`  id:           ${promo.id}`);
    console.log('------------------------------------------------------------');
    console.log('  Test it now in the Subscription page → "تفعيل كود الخصم".');
    console.log('============================================================');
  } catch (error) {
    console.error('❌ Failed to seed promo code:', error);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
