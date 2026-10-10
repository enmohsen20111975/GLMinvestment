import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { getProcessHistory } from '@/lib/metrics-db';

export const dynamic = 'force-dynamic';

const VALID_RANGES = ['1h', '6h', '24h', '7d'] as const;
type ProcessRange = (typeof VALID_RANGES)[number];

/**
 * GET /api/admin/system-resources/process-history?name=telegram-poster&range=1h
 *
 * Returns per-process history from pm2_process_snapshot (24h raw retention).
 */
export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const name = (url.searchParams.get('name') || '').trim();
    const rangeParam = (url.searchParams.get('range') || '1h') as ProcessRange;
    const range: ProcessRange = VALID_RANGES.includes(rangeParam) ? rangeParam : '1h';

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'name parameter is required' },
        { status: 400 },
      );
    }
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(name)) {
      return NextResponse.json(
        { success: false, error: 'invalid process name' },
        { status: 400 },
      );
    }

    const points = getProcessHistory(name, range);

    return NextResponse.json({
      name,
      range,
      points,
      count: points.length,
    });
  } catch (e) {
    console.error('[admin:system-resources:process-history]', e);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}
