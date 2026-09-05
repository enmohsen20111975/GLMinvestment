import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { pythonFetch } from '@/lib/python-backend';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const market = searchParams.get('market') || 'egx';
    const pipeline = searchParams.get('pipeline') || 'egx_aggressive';
    const min_score = searchParams.get('min_score') || '6.0';
    const force = searchParams.get('force') || 'false';

    const result = await pythonFetch('/api/v2/day-trading-opportunities', {
      method: 'GET',
      params: { market, pipeline, min_score, force },
    });

    return NextResponse.json(result.data, { status: result.success ? 200 : 500 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
