import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { pythonFetch } from '@/lib/python-backend';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const result = await pythonFetch('/api/v2/analyze', {
      method: 'POST',
      body,
    });

    return NextResponse.json(result.data, { status: result.success ? 200 : 500 });
  } catch (error: any) {
    console.error('[v2:analyze]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
