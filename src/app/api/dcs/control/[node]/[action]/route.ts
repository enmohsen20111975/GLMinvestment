import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest, { params }: { params: { node: string; action: string } }) {
  const { node, action } = params;
  const pyBase = (process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010').replace('localhost', '127.0.0.1');
  try {
    const res = await fetch(`${pyBase}/api/dcs/control/${node}/${action}`, { method: 'POST', cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ success: false, error: 'dcs_control_failed' }, { status: 502 });
  }
}
