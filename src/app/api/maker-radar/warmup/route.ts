import { NextRequest, NextResponse } from 'next/server';
import { runWarmupSync, getLiveStatus, readRadarCache } from '@/modules/radar/lib/radar-cache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300; // synchronous warmup can take up to ~90s on big DBs

/**
 * POST /api/maker-radar/warmup?market=EGX
 *
 * Synchronous warmup — blocks until the Python script finishes.
 * Use this from:
 *   - Cron jobs (e.g. every 5 min during market hours)
 *   - Manual "refresh radar" button in the UI
 *
 * Returns the final status (success/failed + timing + counts).
 *
 * GET /api/maker-radar/warmup → returns current status only (no run).
 */
export async function GET() {
  const status = getLiveStatus();
  const cache = readRadarCache();
  return NextResponse.json({
    success: true,
    status,
    cache_present: !!cache,
    cache_generated_at: cache?.data?.generated_at ?? null,
    cache_total_scanned: cache?.data?.total_scanned ?? null,
    cache_under_microscope: cache?.data?.under_microscope_count ?? null,
  });
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  let market = url.searchParams.get('market') || 'EGX';
  if (market.includes('${') || market.length > 20) market = 'EGX';
  const timeoutMs = Math.min(parseInt(url.searchParams.get('timeout') || '120000', 10), 240_000);

  const t0 = Date.now();
  try {
    const status = await runWarmupSync(market, timeoutMs);
    const cache = readRadarCache();
    return NextResponse.json({
      success: status.last_warmup_status === 'success',
      status,
      cache_present: !!cache,
      cache_generated_at: cache?.data?.generated_at ?? null,
      cache_total_scanned: cache?.data?.total_scanned ?? null,
      cache_under_microscope: cache?.data?.under_microscope_count ?? null,
      elapsed_ms: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        success: false,
        error: e?.message || 'warmup failed',
        elapsed_ms: Date.now() - t0,
        status: getLiveStatus(),
      },
      { status: 500 }
    );
  }
}
