import { NextRequest, NextResponse } from 'next/server';
// P0-14-ASYNC fix (2026-09-27): replaced sync readFileSync/existsSync with async
// fs/promises equivalents in loadTracking so the maker-radar GET handler never
// blocks the event loop on the tracking JSON file.
import { readFile, access } from 'fs/promises';
import path from 'path';
import {
  readRadarCache,
  triggerBackgroundWarmup,
  getLiveStatus,
  isCacheStale,
  isWarmupRunning,
} from '@/modules/radar/lib/radar-cache';
import Database from 'better-sqlite3';
import { getSessionUserId } from '@/lib/auth-helper';
import { trialExpiredResponse } from '@/lib/subscription-gate';

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

// P0-14-ASYNC fix (2026-09-27): loadTracking is now async — uses fs/promises.
async function loadTracking(): Promise<Record<string, TrackedStock>> {
  try {
    try {
      await access(TRACKING_FILE);
    } catch {
      return {};
    }
    const data = await readFile(TRACKING_FILE, 'utf-8');
    return JSON.parse(data);
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

  // FIX-P3-P5-P6 (Group P3 — Fix 1): server-side trial expiry gate.
  // Maker Radar is a paid-tier preview for free users (delayed 60 min via
  // getRadarAccess) — but if the user's 14-day free trial has fully expired
  // we block the request entirely with 403 TRIAL_EXPIRED so they have to
  // upgrade before continuing to use the radar.
  const { userId } = await getSessionUserId();
  if (userId) {
    const trialBlock = await trialExpiredResponse(userId);
    if (trialBlock) {
      return NextResponse.json(trialBlock.body, { status: trialBlock.status });
    }
  }

  const cache = readRadarCache(market);

  // Cache miss — no JSON file exists yet. Trigger synchronous warmup ONCE
  // (first ever request). Subsequent requests use the cache.
  if (!cache) {
    const status = getLiveStatus(market);
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
  const tracking = await loadTracking();

  // Load live prices from stocks.db so radar items ALWAYS reflect the active session
  // FIX (Task DEEP-MARKET-SEPARATION): فلترة بـ market عشان ميبقاش في تداخل بين أسواق
  const liveMap = new Map<string, { current_price: number; change_percent: number; volume?: number; name_ar?: string }>();
  try {
    const dbPath = path.join(PROJECT_ROOT, 'db', 'stocks.db');
    const db = new Database(dbPath, { readonly: true });
    // SECURITY-FIX + DEEP-MARKET-SEPARATION: parameterized query بدل interpolation
    const selectCols = `ticker, current_price, change_percent, volume, name_ar, support, resistance, ma_50, ma_200, rsi, change_value, high_price, low_price, open_price, previous_close`;
    let liveRows: any[];
    if (market === 'EGX') {
      liveRows = db.prepare(`SELECT ${selectCols} FROM stocks WHERE current_price > 0 AND market IN ('EGX','مصر')`).all() as any[];
    } else if (market) {
      liveRows = db.prepare(`SELECT ${selectCols} FROM stocks WHERE current_price > 0 AND market = ?`).all(market) as any[];
    } else {
      liveRows = db.prepare(`SELECT ${selectCols} FROM stocks WHERE current_price > 0`).all() as any[];
    }
    for (const r of liveRows) {
      if (r.ticker) {
        liveMap.set(String(r.ticker).toUpperCase(), r);
      }
    }
    db.close();
  } catch (e) {
    console.error('[maker-radar] failed to read live prices from stocks.db:', e);
  }

  const enrichStock = (stock: any) => {
    let s = { ...stock };
    const tickerKey = String(s.ticker || '').toUpperCase();
    const live = liveMap.get(tickerKey);
    if (live && live.current_price > 0) {
      s.current_price = live.current_price;
      s.change_1d = live.change_percent;
      s.change_percent = live.change_percent;
      if (live.volume) s.volume = live.volume;
      if (live.name_ar && !s.name_ar) s.name_ar = live.name_ar;
      // Task DEEP-DIRECTIVE: إمداد الرادار بمستويات الدعم والمقاومة + RSI + MA
      s.support = live.support ?? null;
      s.resistance = live.resistance ?? null;
      s.ma_50 = live.ma_50 ?? null;
      s.ma_200 = live.ma_200 ?? null;
      s.rsi = live.rsi ?? null;
      s.high_price = live.high_price ?? null;
      s.low_price = live.low_price ?? null;
      s.open_price = live.open_price ?? null;
      s.previous_close = live.previous_close ?? null;
      // حساب turnover_egp رياضياً لو NULL (نفس إصلاح الـ screener)
      if (!s.turnover_egp || s.turnover_egp === 0) {
        s.turnover_egp = (live.current_price > 0 && live.volume > 0)
          ? Math.round(live.current_price * live.volume)
          : 0;
      }
    }
    const tracked = tracking[s.ticker];
    if (tracked) {
      const currentPrice = s.current_price || 0;
      const changeSinceTracking = tracked.entryPrice > 0
        ? ((currentPrice - tracked.entryPrice) / tracked.entryPrice) * 100
        : 0;
      return {
        ...s,
        isTracked: true,
        trackingEntryDate: tracked.entryDate,
        trackingEntryPrice: tracked.entryPrice,
        changeSinceTracking: Math.round(changeSinceTracking * 100) / 100,
      };
    }
    return { ...s, isTracked: false };
  };

  const radarData = cache.data;
  const enriched = {
    ...radarData,
    quiet_list: (radarData.quiet_list || []).map(enrichStock),
    explosive_list: (radarData.explosive_list || []).map(enrichStock),
    early_break_list: (radarData.early_break_list || []).map(enrichStock),
    pre_surge_list: (radarData.pre_surge_list || []).map(enrichStock),
    under_microscope: (radarData.under_microscope || []).map(enrichStock),
    all_results: (radarData.all_results || []).map(enrichStock),
    tracked_count: Object.keys(tracking).length,
    tracked_tickers: Object.keys(tracking),
    served_at: new Date().toISOString(),
  };

  // Attach live status (freshness, db_source, last warmup info)
  const status = getLiveStatus(market);
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
