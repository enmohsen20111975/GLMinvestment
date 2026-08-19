/**
 * GET /api/crypto/watchlist
 * Returns crypto watchlist items for the authenticated user
 */

import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { pythonFetch } from '@/lib/python-backend';

export async function GET() {
  try {
    const { userId } = await getSessionUserId();
    
    if (!userId) {
      return NextResponse.json({ success: true, items: [], total: 0 });
    }

    // Try to fetch from Python backend
    try {
      const result = await pythonFetch<any>('/api/crypto/watchlist', { timeout: 5000 });
      
      if (result.success && result.data) {
        return NextResponse.json(result.data);
      }
    } catch (error) {
      console.log('[crypto/watchlist] Python backend not available, returning empty');
    }

    // Return empty list if Python backend not available
    return NextResponse.json({ 
      success: true, 
      items: [], 
      total: 0,
      message: 'Crypto watchlist not available' 
    });
  } catch (error) {
    console.error('[GET /api/crypto/watchlist] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error reading crypto watchlist' },
      { status: 500 }
    );
  }
}
