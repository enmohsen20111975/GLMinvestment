import { NextRequest, NextResponse } from 'next/server';
import { ensureUnifiedDbInitialized, getStocks, getExchangeStats, type Exchange } from '@/lib/unified-db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await ensureUnifiedDbInitialized();
    
    const { searchParams } = new URL(request.url);
    
    const query = searchParams.get('q') || undefined;
    const exchange = (searchParams.get('exchange') || undefined) as Exchange | undefined;
    const sector = searchParams.get('sector') || undefined;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('page_size') || '50', 10);
    
    // If just asking for stats
    if (searchParams.get('stats') === 'true') {
      const stats = getExchangeStats();
      return NextResponse.json({ success: true, stats });
    }
    
    // Get stocks
    const result = getStocks({
      query,
      exchange,
      sector,
      page,
      page_size: pageSize,
    });
    
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[API] unified-stocks error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch stocks' },
      { status: 500 }
    );
  }
}
