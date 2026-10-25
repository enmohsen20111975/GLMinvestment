import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || '50';
    const redirectUrl = new URL(`/api/crypto/coins?limit=${limit}`, request.url);
    
    // Redirect or fetch internally
    const res = await fetch(redirectUrl.toString(), {
      headers: { Accept: 'application/json' },
    });
    
    if (!res.ok) {
      return NextResponse.json({ success: false, error: 'Failed to fetch crypto coins' }, { status: res.status });
    }
    
    const data = await res.json();
    return NextResponse.json({
      success: true,
      coins: data.all_cryptos || [],
      count: (data.all_cryptos || []).length,
    });
  } catch (error: any) {
    console.error('[unified-crypto]', error);
    return NextResponse.json(
      { success: false, error: 'internal_error' || 'Failed to fetch crypto data' },
      { status: 500 }
    );
  }
}
