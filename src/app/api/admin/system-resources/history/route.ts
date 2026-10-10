import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { getHistory, type RangeKey } from '@/lib/metrics-db';

export const dynamic = 'force-dynamic';

const VALID_RANGES: RangeKey[] = ['15m', '1h', '6h', '24h', '7d', '30d'];

interface Summary {
  cpu_avg: number | null;
  cpu_max: number | null;
  cpu_current: number | null;
  mem_avg: number | null;
  mem_max: number | null;
  mem_current: number | null;
  disk_current: number | null;
  pm2_online_current: number | null;
}

/**
 * GET /api/admin/system-resources/history?range=1h
 *
 * Returns time-series history for charts (CPU / RAM / Disk / PM2 / load).
 * Auto-selects underlying table based on range:
 *   15m, 1h, 6h, 24h → raw
 *   7d               → 5min aggregates
 *   30d              → 1h aggregates
 */
export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const rangeParam = (url.searchParams.get('range') || '1h') as RangeKey;
    const range: RangeKey = VALID_RANGES.includes(rangeParam) ? rangeParam : '1h';

    const points = getHistory(range);

    if (points.length === 0) {
      return NextResponse.json({
        range,
        points: [],
        summary: {
          cpu_avg: null,
          cpu_max: null,
          cpu_current: null,
          mem_avg: null,
          mem_max: null,
          mem_current: null,
          disk_current: null,
          pm2_online_current: null,
        } as Summary,
      });
    }

    const cpuVals = points.map(p => p.cpu).filter((v): v is number => v !== null && !Number.isNaN(v));
    const memVals = points.map(p => p.mem_pct).filter((v): v is number => v !== null && !Number.isNaN(v));
    const last = points[points.length - 1];

    const summary: Summary = {
      cpu_avg: cpuVals.length > 0 ? Math.round((cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length) * 10) / 10 : null,
      cpu_max: cpuVals.length > 0 ? Math.round(Math.max(...cpuVals) * 10) / 10 : null,
      cpu_current: last.cpu ?? null,
      mem_avg: memVals.length > 0 ? Math.round((memVals.reduce((a, b) => a + b, 0) / memVals.length) * 10) / 10 : null,
      mem_max: memVals.length > 0 ? Math.round(Math.max(...memVals) * 10) / 10 : null,
      mem_current: last.mem_pct ?? null,
      disk_current: last.disk_pct ?? null,
      pm2_online_current: last.pm2_online ?? null,
    };

    return NextResponse.json({
      range,
      points,
      summary,
    });
  } catch (e) {
    console.error('[admin:system-resources:history]', e);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}
