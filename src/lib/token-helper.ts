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

  console.log('[Token Helper] Validating token:', token.substring(0, 20) + '...');

  try {
    // Try normal Prisma query first
    const apiToken = await db.apiToken.findUnique({
      where: { token },
      select: { user_id: true, expires_at: true },
    });
    
    console.log('[Token Helper] Prisma query result:', apiToken ? 'FOUND' : 'NOT FOUND');
    
    if (apiToken && new Date(apiToken.expires_at) > new Date()) {
      console.log('[Token Helper] Token valid, userId:', apiToken.user_id);
      return { userId: apiToken.user_id };
    }
    
    if (apiToken) {
      console.log('[Token Helper] Token expired, expires_at:', apiToken.expires_at);
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
          WHERE token = ${token}
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
    // Try normal Prisma query first
    const apiToken = await db.apiToken.findUnique({
      where: { token },
      include: { User: true },
    });
    
    if (!apiToken) return null;
    if (apiToken && new Date(apiToken.expires_at) < new Date()) return null;
    if (!apiToken.User?.is_active) return null;
    
    return {
      token: apiToken,
      user: {
        id: apiToken.User.id,
        email: apiToken.User.email,
        username: apiToken.User.username,
        name: apiToken.User.name,
        image: apiToken.User.image,
        subscription_tier: apiToken.User.subscription_tier || 'free',
        is_active: apiToken.User.is_active,
      },
    } as any;
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
          WHERE t.token = ${token}
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
