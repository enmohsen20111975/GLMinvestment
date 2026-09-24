export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';

export async function GET() {
  try {
    const result = await pythonFetch('/api/v2/health');
    return NextResponse.json(result.data, { status: result.success ? 200 : 503 });
  } catch (error: any) {
    return NextResponse.json({ success: false, status: 'unhealthy', error: error.message }, { status: 503 });
  }
}
