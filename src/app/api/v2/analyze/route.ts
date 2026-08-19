import { NextRequest, NextResponse } from 'next/server';
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
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
