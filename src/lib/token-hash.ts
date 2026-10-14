/**
 * Token Hash Helper — SHA-256 hashing for Bearer tokens
 * ============================================================================
 * P1-CRIT FIX (2026-10-14): Bearer tokens must be hashed in DB.
 *
 * Before P1: tokens were stored as plaintext in api_tokens.token column.
 *   Risk: if DB is leaked, all 30-day tokens are immediately valid.
 *
 * After P1: tokens are stored as SHA-256 hashes. The raw token is returned
 *   to the client ONCE at creation time (login response). The DB only keeps
 *   the hash. Verification: hash(incoming_token) === stored_hash.
 *
 * Backward compatibility: validateToken() first tries hash lookup. If not
 *   found, falls back to plaintext lookup (for tokens created before P1).
 *   This allows a graceful migration without invalidating all active sessions.
 *   Once all old tokens expire (30 days), the plaintext fallback can be removed.
 *
 * Rule 27 (NO-FAKE-DATA): No fake hashing — uses Node.js built-in crypto.
 * Rule 50 (MONEY-AS-CUSTOMER-LIFE): Real crypto, no shortcuts.
 * Rule 81 (NO --force): N/A here.
 * ============================================================================
 */

import { createHash } from 'crypto';

/**
 * Hash a raw token using SHA-256.
 * Returns a 64-char hex string.
 *
 * @param rawToken - The plaintext token (e.g., 'egx_userId_uuid_timestamp')
 * @returns SHA-256 hex hash
 */
export function hashToken(rawToken: string): string {
  if (!rawToken) {
    throw new Error('hashToken: rawToken is required');
  }
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/**
 * Verify whether a raw token matches a stored hash.
 *
 * @param rawToken - The plaintext token from client
 * @param storedHash - The SHA-256 hash from DB
 * @returns true if match
 */
export function verifyTokenHash(rawToken: string, storedHash: string): boolean {
  if (!rawToken || !storedHash) return false;
  try {
    const computedHash = hashToken(rawToken);
    // Constant-time comparison to prevent timing attacks
    if (computedHash.length !== storedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < computedHash.length; i++) {
      diff |= computedHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

/**
 * Check if a stored token value is already hashed (vs plaintext).
 * Hashed tokens are 64-char hex strings. Plaintext tokens have the 'egx_' prefix.
 *
 * @param storedValue - The token value from DB
 * @returns true if already hashed
 */
export function isHashedToken(storedValue: string): boolean {
  if (!storedValue) return false;
  // SHA-256 hex = 64 chars, all lowercase hex
  return /^[a-f0-9]{64}$/.test(storedValue);
}

/**
 * Migration helper: hash all plaintext tokens in the DB (idempotent).
 * This is a one-time admin operation to migrate existing tokens.
 * Tokens already hashed are skipped.
 */
export async function migratePlaintextTokensToHashed(): Promise<{
  migrated: number;
  skipped: number;
  errors: number;
}> {
  // Lazy import to avoid circular dependencies in non-admin contexts
  const { db } = await import('@/lib/db');

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // Fetch all tokens (only token column to minimize memory)
    const allTokens = await db.apiToken.findMany({
      select: { id: true, token: true },
    });

    for (const record of allTokens) {
      try {
        if (isHashedToken(record.token)) {
          skipped++;
          continue;
        }
        // Hash the plaintext token
        const hashed = hashToken(record.token);
        await db.$executeRaw`
          UPDATE api_tokens
          SET token = ${hashed}
          WHERE id = ${record.id}
        `;
        migrated++;
      } catch (err) {
        console.error(`[token-hash] Migration error for token ${record.id}:`, err);
        errors++;
      }
    }

    console.log(`[token-hash] Migration complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);
    return { migrated, skipped, errors };
  } catch (error) {
    console.error('[token-hash] Migration failed:', error);
    return { migrated, skipped, errors: errors + 1 };
  }
}
