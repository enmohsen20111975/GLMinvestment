import { NextRequest, NextResponse } from 'next/server';
import { ensureUnifiedDbInitialized, getCryptoCoins, getCryptoCoin, getCryptoMovers } from '@/lib/unified-db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await ensureUnifiedDbInitialized();
    
    const { searchParams } = new URL(request.url);
    
    const action = searchParams.get('action');
    const id = searchParams.get('id');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    
    // Get single coin by ID
    if (id) {
      const coin = getCryptoCoin(id);
      if (!coin) {
        return NextResponse.json({ success: false, error: 'Coin not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, coin });
    }
    
    // Get movers
    if (action === 'movers') {
      const movers = getCryptoMovers(limit);
      return NextResponse.json({ success: true, ...movers });
    }
    
    // Get all coins
    const coins = getCryptoCoins(limit, offset);
    return NextResponse.json({ success: true, coins, count: coins.length });
  } catch (error: any) {
    console.error('[API] unified-crypto error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch crypto data' },
      { status: 500 }
    );
  }
}
