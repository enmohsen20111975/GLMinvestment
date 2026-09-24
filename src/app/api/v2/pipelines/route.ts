export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';

export async function GET() {
  try {
    const result = await pythonFetch('/api/v2/pipelines');
    return NextResponse.json(result.data, { status: result.success ? 200 : 500 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
