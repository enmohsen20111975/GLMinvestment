export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';

export async function GET() {
  try {
    const result = await pythonFetch('/api/v2/presets');
    return NextResponse.json(result.data, { status: result.success ? 200 : 500 });
  } catch (error: any) {
    console.error('[v2:presets]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
