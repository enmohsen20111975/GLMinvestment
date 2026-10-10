import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { pythonFetch } from '@/lib/python-backend';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;

    const result = await pythonFetch(`/api/v2/pipeline/${name}/summary`);

    return NextResponse.json(result.data, { status: result.success ? 200 : 404 });
  } catch (error: any) {
    console.error('[v2:pipeline:[name]:summary]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
