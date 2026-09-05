import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import {
  readRadarCache,
  triggerBackgroundWarmup,
  getLiveStatus,
  isCacheStale,
  isWarmupRunning,
} from '@/lib/radar-cache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300; // generous — but we should never need it (cache reads are <50ms)

// Tracking file — same as before
const PROJECT_ROOT = process.cwd();
const TRACKING_FILE = path.join(PROJECT_ROOT, 'db', 'maker_radar_tracking.json');

interface TrackedStock {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  addedAt: string;
  notes?: string;
}

function loadTracking(): Record<string, TrackedStock> {
  try {
    if (existsSync(TRACKING_FILE)) {
      const data = readFileSync(TRACKING_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[maker-radar] loadTracking error:', e);
  }
  return {};
}

/**
 * GET /api/maker-radar?market=EGX
 *
 * Production-safe: ALWAYS reads from cached JSON (instant <50ms).
 * Never blocks on Python script execution. If the cache is stale, a
 * background warmup is triggered (fire-and-forget) — but the current
 * cache is returned immediately so the user never waits.
 *
 * To force a synchronous refresh, POST /api/maker-radar/warmup instead.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';

  const cache = readRadarCache();

  // Cache miss — no JSON file exists yet. Trigger synchronous warmup ONCE
  // (first ever request). Subsequent requests use the cache.
  if (!cache) {
    const status = getLiveStatus();
    if (!isWarmupRunning()) {
      // First-ever request: do a synchronous warmup with a reasonable timeout
      // so the user gets data on the first load instead of an empty screen.
      // The warmup function is in radar-cache but for the first-request path
      // we use the background trigger and return a "warming up" response.
      triggerBackgroundWarmup(market);
    }
    return NextResponse.json({
      success: false,
      warming_up: true,
      error: 'الرادار بيتسخن لأول مرة — حاول تاني خلال دقيقة',
      status,
      retry_after_seconds: 30,
    }, { status: 503 });
  }

  // ─── Cache hit — enrich + return instantly ───────────────────────────
  const tracking = loadTracking();

  const enrichStock = (stock: any) => {
    const tracked = tracking[stock.ticker];
    if (tracked) {
      const currentPrice = stock.current_price || 0;
      const changeSinceTracking = tracked.entryPrice > 0
        ? ((currentPrice - tracked.entryPrice) / tracked.entryPrice) * 100
        : 0;
      return {
        ...stock,
        isTracked: true,
        trackingEntryDate: tracked.entryDate,
        trackingEntryPrice: tracked.entryPrice,
        changeSinceTracking: Math.round(changeSinceTracking * 100) / 100,
      };
    }
    return { ...stock, isTracked: false };
  };

  const radarData = cache.data;
  const enriched = {
    ...radarData,
    quiet_list: (radarData.quiet_list || []).map(enrichStock),
    explosive_list: (radarData.explosive_list || []).map(enrichStock),
    early_break_list: (radarData.early_break_list || []).map(enrichStock),
    pre_surge_list: (radarData.pre_surge_list || []).map(enrichStock),
    tracked_count: Object.keys(tracking).length,
    tracked_tickers: Object.keys(tracking),
    served_at: new Date().toISOString(),
  };

  // Attach live status (freshness, db_source, last warmup info)
  const status = getLiveStatus();
  const cacheAgeSec = status.cache_age_seconds ?? 0;
  const stale = cacheAgeSec > 15 * 60;

  // If cache is stale AND no warmup is running → trigger background warmup.
  // Fire-and-forget — do NOT block the response.
  if (stale && !isWarmupRunning()) {
    triggerBackgroundWarmup(market);
  }

  return NextResponse.json({
    success: true,
    ...enriched,
    cached: true,
    cache_age_seconds: cacheAgeSec,
    cache_stale: stale,
    warmup_running: isWarmupRunning(),
    cache_generated_at: status.cache_generated_at,
    db_source: status.db_source,
    last_warmup_status: status.last_warmup_status,
    last_warmup_finished_at: status.last_warmup_finished_at,
    last_warmup_duration_ms: status.last_warmup_duration_ms,
    last_error: status.last_error,
  });
}
