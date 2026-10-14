/**
 * Token Helper - Robust token validation with corrupted date handling
 * 
 * SQLite can store dates in different formats:
 * - ISO format: "2026-06-01T21:00:00.000Z" (correct)
 * - Unix timestamp: "1782942632733" (corrupted - milliseconds)
 * 
 * This helper handles both cases and auto-fixes corrupted data.
 */

import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

// P1-CRIT FIX (2026-10-14): Bearer tokens are now SHA-256 hashed in DB.
// This module supports both hashed (new) and plaintext (legacy) tokens for
// graceful migration. See src/lib/token-hash.ts for hashing utilities.
import { hashToken, isHashedToken } from '@/lib/token-hash';

interface TokenData {
  id: string;
  user_id: string;
  token: string;
  device_info?: string | null;
  ip_address?: string | null;
  expires_at: Date;
  last_used?: Date | null;
  created_at: Date;
}

interface UserInfo {
  id: string;
  email: string;
  username?: string | null;
  name?: string | null;
  image?: string | null;
  subscription_tier?: string;
  is_active?: number | boolean;
}

/**
 * Validate a Bearer token and return user ID
 * Handles corrupted date fields automatically
 */
export async function validateToken(token: string): Promise<{ userId: string } | null> {
  if (!token) return null;

  // P1-CRIT FIX: Never log raw tokens — only log hash for debugging.
  const tokenHash = hashToken(token);
  console.log('[Token Helper] Validating token hash:', tokenHash.substring(0, 16) + '...');

  try {
    // P1-CRIT FIX: Look up by SHA-256 hash (canonical) first.
    // New tokens are stored as hashes. Legacy tokens (pre-P1) are plaintext —
    // we try the raw token as a fallback for backward compatibility (30-day expiry).
    const apiToken = await db.apiToken.findUnique({
      where: { token: tokenHash },
      select: { user_id: true, expires_at: true },
    });

    // Backward compatibility: if hashed lookup failed, try plaintext (legacy token).
    // This path will be hit for tokens created before P1 migration. Once all such
    // tokens expire (30 days), this fallback can be removed.
    const legacyToken = !apiToken ? await db.apiToken.findUnique({
      where: { token },
      select: { id: true, user_id: true, expires_at: true },
    }) : null;

    // If we found a legacy plaintext token, migrate it to hashed in the background.
    if (legacyToken && !isHashedToken(legacyToken.token || '')) {
      console.log('[Token Helper] Migrating legacy plaintext token to hashed:', legacyToken.id);
      migrateLegacyTokenToHashed(legacyToken.id, token, tokenHash).catch(() => {});
    }

    const effectiveToken = apiToken || (legacyToken ? {
      user_id: legacyToken.user_id,
      expires_at: legacyToken.expires_at,
    } : null);
    
    console.log('[Token Helper] Prisma query result:', effectiveToken ? 'FOUND' : 'NOT FOUND');

    if (effectiveToken && effectiveToken.expires_at > new Date()) {
      console.log('[Token Helper] Token valid, userId:', effectiveToken.user_id);
      return { userId: effectiveToken.user_id };
    }

    if (effectiveToken) {
      console.log('[Token Helper] Token expired, expires_at:', effectiveToken.expires_at);
    }
    
    return null;
  } catch (prismaError) {
    // Handle corrupted date fields
    console.log('[Token Helper] Prisma error:', prismaError instanceof Error ? prismaError.message : String(prismaError));
    
    if (prismaError instanceof Prisma.PrismaClientKnownRequestError && 
        prismaError.message.includes('DateTime')) {
      
      console.log('[Token Helper] Corrupted date detected, using raw query...');
      
      try {
        // Use raw query to bypass Prisma type conversion
        const rawTokens = await db.$queryRaw<Array<{
          id: string;
          user_id: string;
          expires_at: string;
        }>>`
          SELECT id, user_id, expires_at
          FROM api_tokens
          WHERE token = ${tokenHash} OR token = ${token}
          LIMIT 1
        `;
        
        console.log('[Token Helper] Raw query result:', rawTokens.length, 'rows');
        
        if (rawTokens.length > 0) {
          const raw = rawTokens[0];
          const expiresAt = parseDateField(raw.expires_at);
          
          console.log('[Token Helper] Raw expires_at:', raw.expires_at, '-> Parsed:', expiresAt?.toISOString() || 'NULL');
          
          if (expiresAt && expiresAt > new Date()) {
            // Fix corrupted data in background
            fixTokenDates(raw.id, raw.expires_at).catch(() => {});
            console.log('[Token Helper] Token valid via raw query, userId:', raw.user_id);
            return { userId: raw.user_id };
          }
        }
      } catch (rawError) {
        console.error('[Token Helper] Raw query error:', rawError);
      }
    } else {
      console.error('[Token Helper] Prisma error:', prismaError);
    }
    return null;
  }
}

/**
 * Validate a token and return full token data with user info
 */
export async function validateTokenWithUser(token: string): Promise<{
  token: TokenData;
  user: UserInfo;
} | null> {
  if (!token) return null;

  try {
    // P1-CRIT FIX: Look up by SHA-256 hash (canonical) first.
    const apiToken = await db.apiToken.findUnique({
      where: { token: tokenHash },
      include: { User: true },
    });

    // Backward compatibility: legacy plaintext fallback.
    const legacyApiToken = !apiToken ? await db.apiToken.findUnique({
      where: { token },
      include: { User: true },
    }) : null;

    // Migrate legacy token in background if found.
    if (legacyApiToken && !isHashedToken(legacyApiToken.token || '')) {
      console.log('[Token Helper] Migrating legacy plaintext token (validateTokenWithUser):', legacyApiToken.id);
      migrateLegacyTokenToHashed(legacyApiToken.id, token, tokenHash).catch(() => {});
    }

    const effectiveApiToken = apiToken || legacyApiToken;
    
    if (!effectiveApiToken) return null;
    if (effectiveApiToken.expires_at < new Date()) return null;
    if (!effectiveApiToken.User?.is_active) return null;
    
    return {
      token: effectiveApiToken,
      user: {
        id: effectiveApiToken.User.id,
        email: effectiveApiToken.User.email,
        username: effectiveApiToken.User.username,
        name: effectiveApiToken.User.name,
        image: effectiveApiToken.User.image,
        subscription_tier: effectiveApiToken.User.subscription_tier || 'free',
        is_active: effectiveApiToken.User.is_active,
      },
    };
  } catch (prismaError) {
    // Handle corrupted date fields
    if (prismaError instanceof Prisma.PrismaClientKnownRequestError && 
        prismaError.message.includes('DateTime')) {
      
      console.log('[Token Helper] Corrupted date detected, using raw query...');
      
      try {
        const rawTokens = await db.$queryRaw<Array<{
          id: string;
          user_id: string;
          token: string;
          device_info: string | null;
          ip_address: string | null;
          expires_at: string;
          last_used: string | null;
          created_at: string;
          // User fields
          email: string;
          username: string | null;
          name: string | null;
          image: string | null;
          subscription_tier: string | null;
          is_active: number | null;
        }>>`
          SELECT t.*,
                 u.email, u.username, u.name as user_name, u.image,
                 u.subscription_tier, u.is_active
          FROM api_tokens t
          LEFT JOIN User u ON t.user_id = u.id
          WHERE t.token = ${tokenHash} OR t.token = ${token}
          LIMIT 1
        `;
        
        if (rawTokens.length === 0) return null;
        
        const raw = rawTokens[0];
        const expiresAt = parseDateField(raw.expires_at);
        
        if (!expiresAt || expiresAt < new Date()) return null;
        if (!raw.is_active) return null;
        
        // Fix corrupted data in background
        fixTokenDates(raw.id, raw.expires_at, raw.last_used).catch(() => {});
        
        return {
          token: {
            id: raw.id,
            user_id: raw.user_id,
            token: raw.token,
            device_info: raw.device_info,
            ip_address: raw.ip_address,
            expires_at: expiresAt,
            last_used: parseDateField(raw.last_used),
            created_at: parseDateField(raw.created_at) || new Date(),
          },
          user: {
            id: raw.user_id,
            email: raw.email,
            username: raw.username,
            name: raw.name,
            image: raw.image,
            subscription_tier: raw.subscription_tier || 'free',
            is_active: raw.is_active ?? 1,
          },
        };
      } catch (rawError) {
        console.error('[Token Helper] Raw query error:', rawError);
      }
    }
    return null;
  }
}

/**
 * Update last_used timestamp for a token
 */
export async function updateTokenLastUsed(tokenId: string): Promise<void> {
  try {
    const now = new Date().toISOString();
    await db.$executeRaw`
      UPDATE api_tokens 
      SET last_used = ${now}
      WHERE id = ${tokenId}
    `;
  } catch (error) {
    // Don't fail if update fails
    console.log('[Token Helper] Could not update last_used:', error);
  }
}

/**
 * Parse a date field that might be ISO format or Unix timestamp
 */
function parseDateField(value: string | null | undefined): Date | null {
  if (!value) return null;
  
  // Check if it's a Unix timestamp (13 digits = milliseconds)
  if (/^\d{13}$/.test(value)) {
    return new Date(parseInt(value));
  }
  
  // Try parsing as ISO format
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Fix corrupted date fields in the database
 */
async function fixTokenDates(
  tokenId: string, 
  expiresAt: string, 
  lastUsed?: string | null
): Promise<void> {
  const updates: string[] = [];
  const params: string[] = [];
  
  // Fix expires_at if corrupted
  if (/^\d{13}$/.test(expiresAt)) {
    const fixed = new Date(parseInt(expiresAt)).toISOString();
    updates.push('expires_at = ?');
    params.push(fixed);
  }
  
  // Fix last_used if corrupted
  if (lastUsed && /^\d{13}$/.test(lastUsed)) {
    const fixed = new Date(parseInt(lastUsed)).toISOString();
    updates.push('last_used = ?');
    params.push(fixed);
  }
  
  if (updates.length === 0) return;
  
  try {
    const query = `UPDATE api_tokens SET ${updates.join(', ')} WHERE id = ?`;
    params.push(tokenId);
    
    await db.$executeRawUnsafe(query, ...params);
    console.log('[Token Helper] Fixed corrupted dates for token:', tokenId);
  } catch (error) {
    console.log('[Token Helper] Could not fix dates:', error);
  }
}

/**
 * Fix ALL corrupted dates in api_tokens table (admin use)
 */
export async function fixAllCorruptedDates(): Promise<{ fixed: number }> {
  try {
    // Fix expires_at
    await db.$executeRaw`
      UPDATE api_tokens 
      SET expires_at = datetime(CAST(expires_at AS REAL) / 1000, 'unixepoch')
      WHERE typeof(expires_at) = 'text' 
        AND length(expires_at) = 13
    `;
    
    // Fix last_used
    await db.$executeRaw`
      UPDATE api_tokens 
      SET last_used = datetime(CAST(last_used AS REAL) / 1000, 'unixepoch')
      WHERE last_used IS NOT NULL
        AND typeof(last_used) = 'text' 
        AND length(last_used) = 13
    `;
    
    // Fix created_at
    await db.$executeRaw`
      UPDATE api_tokens 
      SET created_at = datetime(CAST(created_at AS REAL) / 1000, 'unixepoch')
      WHERE typeof(created_at) = 'text' 
        AND length(created_at) = 13
    `;
    
    console.log('[Token Helper] Fixed all corrupted dates');
    return { fixed: 1 };
  } catch (error) {
    console.error('[Token Helper] Error fixing dates:', error);
    return { fixed: 0 };
  }
}


/**
 * P1-CRIT FIX (2026-10-14): Migrate a legacy plaintext token to hashed form.
 * Called in the background when validateToken() finds a plaintext token.
 * Idempotent: if the token was already migrated, this is a no-op.
 *
 * @param tokenId - The api_tokens.id
 * @param rawToken - The plaintext token (from client)
 * @param tokenHash - The SHA-256 hash of the token
 */
async function migrateLegacyTokenToHashed(
  tokenId: string,
  rawToken: string,
  tokenHash: string
): Promise<void> {
  try {
    // Only migrate if the stored value is NOT already hashed.
    // Use a raw query to avoid Prisma's unique constraint error on the token column.
    await db.$executeRaw`
      UPDATE api_tokens
      SET token = ${tokenHash}
      WHERE id = ${tokenId}
        AND token = ${rawToken}
    `;
    console.log('[Token Helper] Migrated legacy token to hashed:', tokenId);
  } catch (error) {
    console.error('[Token Helper] Migration error for token', tokenId, ':', error);
  }
}
