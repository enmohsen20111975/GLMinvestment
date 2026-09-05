import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { pythonFetch } from '@/lib/python-backend';

// POST /api/v2/pipeline/save-preset
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const result = await pythonFetch('/api/v2/pipeline/save-preset', {
      method: 'POST',
      body,
    });

    return NextResponse.json(result.data, { status: result.success ? 200 : 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/v2/pipeline/load
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    const result = await pythonFetch('/api/v2/pipeline/load', {
      method: 'POST',
      body,
    });

    return NextResponse.json(result.data, { status: result.success ? 200 : 404 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
