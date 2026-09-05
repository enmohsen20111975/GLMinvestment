import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { pythonFetch } from '@/lib/python-backend';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; engine: string }> }
) {
  try {
    const { name, engine } = await params;
    const body = await request.json();

    const result = await pythonFetch(`/api/v2/pipeline/${name}/engine/${engine}/toggle`, {
      method: 'PUT',
      body,
    });

    return NextResponse.json(result.data, { status: result.success ? 200 : 404 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
