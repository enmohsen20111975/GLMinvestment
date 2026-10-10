/**
 * GET /api/maker-radar/live-watch
 * ================================
 * Live maker-radar feed for the Flutter Android app.
 *
 * Mirrors the shape consumed by MakerRadarTab.tsx (the desktop component at
 * src/modules/predictions/components/MakerRadarTab.tsx). It reuses the
 * existing radar cache (`@/modules/radar/lib/radar-cache`) — never blocks on
 * Python script execution.
 *
 * Auth: required (getSessionUserId). Returns 401 if no userId. (The Flutter
 * client uses Bearer tokens; even though the underlying /api/maker-radar is
 * public-ish, we keep this mobile entry-point authenticated so the Android
 * app's session is exercised and a 401 here proves the route exists vs. 404.)
 *
 * Query params:
 *   ?market=EGX  — default EGX
 *
 * Returns:
 *   {
 *     success, market, cached, cache_age_seconds, cache_stale,
 *     warmup_running, generated_at,
 *     quiet_list: [...], explosive_list: [...],
 *     early_break_list: [...], pre_surge_list: [...],
 *     tracked_count, tracked_tickers: [...]
 *   }
 *
 * On cache miss (first-ever warmup) we return 503 with `warming_up: true` so
 * the Android client can show a "warming up — retry in 30s" message.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getSessionUserId } from '@/lib/auth-helper';
import {
  readRadarCache,
  triggerBackgroundWarmup,
  getLiveStatus,
  isCacheStale,
  isWarmupRunning,
} from '@/modules/radar/lib/radar-cache';

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      error: 'مطلوب تسجيل الدخول',
      error_en: 'Authentication required',
    },
    { status: 401 }
  );
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) return unauthorized();

    const { searchParams } = new URL(req.url);
    const market = searchParams.get('market') || 'EGX';

    const cache = readRadarCache(market);

    if (!cache) {
      const status = getLiveStatus(market);
      if (!isWarmupRunning()) {
        triggerBackgroundWarmup(market);
      }
      return NextResponse.json(
        {
          success: false,
          warming_up: true,
          error: 'الرادار بيتسخن لأول مرة — حاول تاني خلال دقيقة',
          error_en: 'Radar warming up — retry in 30s',
          market,
          status,
          retry_after_seconds: 30,
        },
        { status: 503 }
      );
    }

    const radarData = cache.data as Record<string, unknown>;

    // Tracked tickers (from the cache's enrichment if present, else empty).
    const trackedTickers = Array.isArray(radarData.tracked_tickers)
      ? (radarData.tracked_tickers as string[])
      : [];

    const status = getLiveStatus(market);
    const cacheAgeSec = status.cache_age_seconds ?? 0;
    const stale = cacheAgeSec > 15 * 60;
    if (stale && !isWarmupRunning()) {
      triggerBackgroundWarmup(market);
    }

    // Slim each radar entry to a consistent mobile shape.
    const slimStock = (s: unknown): Record<string, unknown> => {
      if (!s || typeof s !== 'object') return {};
      const r = s as Record<string, unknown>;
      return {
        ticker: r.ticker || r.symbol || '',
        name: r.name || r.name_ar || r.ticker || '',
        current_price: r.current_price ?? null,
        change_percent: r.change_percent ?? r.change_pct ?? null,
        volume: r.volume ?? null,
        radar_path: r.radar_path || r.path || null,
        score: r.score ?? r.master_score ?? null,
        sector: r.sector || null,
        is_tracked: r.isTracked === true || r.is_tracked === true,
      };
    };

    return NextResponse.json({
      success: true,
      market,
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
      quiet_list: (Array.isArray(radarData.quiet_list) ? radarData.quiet_list : []).map(slimStock),
      explosive_list: (Array.isArray(radarData.explosive_list) ? radarData.explosive_list : []).map(slimStock),
      early_break_list: (Array.isArray(radarData.early_break_list) ? radarData.early_break_list : []).map(slimStock),
      pre_surge_list: (Array.isArray(radarData.pre_surge_list) ? radarData.pre_surge_list : []).map(slimStock),
      tracked_count: trackedTickers.length,
      tracked_tickers: trackedTickers,
      served_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[maker-radar/live-watch] fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
      },
      { status: 500 }
    );
  }
}
