/**
 * GET /api/crypto/portfolio
 * Returns crypto portfolio items for the authenticated user
 */

import { NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

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
      const result = await pythonFetch<any>('/api/crypto/portfolio', { timeout: 5000 });
      
      if (result.success && result.data) {
        return NextResponse.json(result.data);
      }
    } catch (error) {
      console.log('[crypto/portfolio] Python backend not available, returning empty');
    }

    // Return empty list if Python backend not available
    return NextResponse.json({ 
      success: true, 
      items: [], 
      total: 0,
      message: 'Crypto portfolio not available' 
    });
  } catch (error) {
    console.error('[GET /api/crypto/portfolio] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error reading crypto portfolio' },
      { status: 500 }
    );
  }
}
