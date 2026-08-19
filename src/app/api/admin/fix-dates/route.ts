/**
 * POST /api/admin/fix-dates
 *
 * Fix all corrupted dates in the database
 * Admin only endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateToken } from '@/lib/token-helper';

export async function POST(request: NextRequest) {
  try {
    // Check admin authorization
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const tokenResult = await validateToken(token);
    
    if (!tokenResult) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Check if user is admin
    const user = await db.user.findUnique({
      where: { id: tokenResult.userId },
      select: { subscription_tier: true },
    });

    if (!user || user.subscription_tier !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const results: Record<string, number> = {};

    // Fix api_tokens table
    try {
      const result1 = await db.$executeRaw`
        UPDATE api_tokens 
        SET expires_at = datetime(CAST(expires_at AS REAL) / 1000, 'unixepoch')
        WHERE typeof(expires_at) = 'text' 
          AND CAST(expires_at AS REAL) > 1000000000000
      `;
      results.api_tokens_expires_at = result1;
    } catch (e) {
      results.api_tokens_expires_at = 0;
    }

    try {
      const result2 = await db.$executeRaw`
        UPDATE api_tokens 
        SET last_used = datetime(CAST(last_used AS REAL) / 1000, 'unixepoch')
        WHERE last_used IS NOT NULL
          AND typeof(last_used) = 'text' 
          AND CAST(last_used AS REAL) > 1000000000000
      `;
      results.api_tokens_last_used = result2;
    } catch (e) {
      results.api_tokens_last_used = 0;
    }

    try {
      const result3 = await db.$executeRaw`
        UPDATE api_tokens 
        SET created_at = datetime(CAST(created_at AS REAL) / 1000, 'unixepoch')
        WHERE typeof(created_at) = 'text' 
          AND CAST(created_at AS REAL) > 1000000000000
      `;
      results.api_tokens_created_at = result3;
    } catch (e) {
      results.api_tokens_created_at = 0;
    }

    // Fix User table
    try {
      const result4 = await db.$executeRaw`
        UPDATE User 
        SET email_verified = datetime(CAST(email_verified AS REAL) / 1000, 'unixepoch')
        WHERE email_verified IS NOT NULL
          AND typeof(email_verified) = 'text' 
          AND CAST(email_verified AS REAL) > 1000000000000
      `;
      results.user_email_verified = result4;
    } catch (e) {
      results.user_email_verified = 0;
    }

    try {
      const result5 = await db.$executeRaw`
        UPDATE User 
        SET last_login = datetime(CAST(last_login AS REAL) / 1000, 'unixepoch')
        WHERE last_login IS NOT NULL
          AND typeof(last_login) = 'text' 
          AND CAST(last_login AS REAL) > 1000000000000
      `;
      results.user_last_login = result5;
    } catch (e) {
      results.user_last_login = 0;
    }

    try {
      const result6 = await db.$executeRaw`
        UPDATE User 
        SET created_at = datetime(CAST(created_at AS REAL) / 1000, 'unixepoch')
        WHERE typeof(created_at) = 'text' 
          AND CAST(created_at AS REAL) > 1000000000000
      `;
      results.user_created_at = result6;
    } catch (e) {
      results.user_created_at = 0;
    }

    const totalFixed = Object.values(results).reduce((a, b) => a + b, 0);

    return NextResponse.json({
      success: true,
      message: `Fixed ${totalFixed} corrupted date fields`,
      details: results,
    });

  } catch (error) {
    console.error('[Fix Dates API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fix dates', details: String(error) },
      { status: 500 }
    );
  }
}

// GET - check for corrupted dates without fixing
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const tokenResult = await validateToken(token);
    
    if (!tokenResult) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Check for corrupted dates
    const corruptedTokens = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM api_tokens 
      WHERE typeof(expires_at) = 'text' 
        AND CAST(expires_at AS REAL) > 1000000000000
    `;

    const corruptedUsers = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM User 
      WHERE typeof(email_verified) = 'text' 
        AND CAST(email_verified AS REAL) > 1000000000000
    `;

    return NextResponse.json({
      success: true,
      corrupted: {
        api_tokens: Number(corruptedTokens[0]?.count || 0),
        users: Number(corruptedUsers[0]?.count || 0),
      },
    });

  } catch (error) {
    console.error('[Fix Dates API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to check dates' },
      { status: 500 }
    );
  }
}
