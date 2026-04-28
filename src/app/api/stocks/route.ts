import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getStocks } from '@/lib/egx-db';

export async function GET(request: NextRequest) {
  try {
    await ensureInitialized();
    const { searchParams } = new URL(request.url);

    const query = searchParams.get('query') || undefined;
    const sector = searchParams.get('sector') || undefined;
    const index = searchParams.get('index') || undefined;
    const page = searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : undefined;
    const page_size = searchParams.get('page_size') ? parseInt(searchParams.get('page_size')!, 10) : undefined;

    const result = getStocks({
      query,
      sector,
      index,
      is_active: true,
      page,
      page_size,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[GET /api/stocks] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stocks', detail: String(error) },
      { status: 500 }
    );
  }
}
