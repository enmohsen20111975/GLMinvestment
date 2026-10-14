/**
 * GET /api/maker-radar?market=EGX
 * ================================
 * CANONICAL maker-radar route — pure Python proxy with cache fallback.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `db/stocks.db` directly (`new Database(...)`) to enrich radar cache
 * items with live prices. That bypassed the canonical Python engine.
 * Now it:
 *   1. Proxies to Python `/api/maker-radar?market=X` (primary).
 *   2. Falls back to the cached JSON file (Python-written cache via the
 *      background warmup spawn) — still Python's output, NO SQLite.
 *   3. Returns honest empty (Rule 27 NO-FAKE-DATA) if both are unavailable.
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */
import { NextRequest, NextResponse } from 'next/server';
// P0-14-ASYNC fix (2026-09-27): async fs/promises for tracking JSON file.
import { readFile, access } from 'fs/promises';
import path from 'path';
import {
  readRadarCache,
  triggerBackgroundWarmup,
  getLiveStatus,
  isCacheStale,
  isWarmupRunning,
} from '@/modules/radar/lib/radar-cache';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
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
    } catch { // silent fallback (safe-by-design)
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
 * Production-safe: ALWAYS tries Python first, then falls back to the cached
 * JSON (instant <50ms). Never blocks on Python script execution directly.
 * If the cache is stale, a background warmup is triggered (fire-and-forget).
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

  // ─── 1. PRIMARY: Python canonical endpoint ────────────────────────────────
  const qs = `market=${encodeURIComponent(market)}`;
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/maker-radar?${qs}`,
    `http://127.0.0.1:8010/api/maker-radar?${qs}`,
  ];
  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (data && (data.success === true || data.all_results || data.quiet_list || data.explosive_list)) {
          // Pass through Python response verbatim (Rule 4: mirror only).
          return NextResponse.json({ ...data, cached: false, source: 'python' });
        }
      }
    } catch { // silent fallback (safe-by-design) — try next URL or cache fallback
    }
  }

  // ─── 2. FALLBACK: cached JSON (Python-written via background warmup) ──────
  // The cache is Python's output (spawned by radar-cache.ts triggerBackgroundWarmup
  // which runs `python3 scripts/maker_radar.py --json-only`). Reading it is
  // NOT direct SQLite access — it is reading a JSON file that Python wrote.
  const cache = readRadarCache(market);

  // Cache miss — no JSON file exists yet. Trigger background warmup ONCE
  // (first ever request). Subsequent requests use the cache.
  if (!cache) {
    const status = getLiveStatus(market);
    if (!isWarmupRunning()) {
      // First-ever request: trigger background warmup (fire-and-forget).
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

  // ─── Cache hit — return instantly (no SQLite enrichment) ───────────────
  // NOTE (Directive P1): previously this branch opened `db/stocks.db`
  // directly to enrich radar items with live prices + support/resistance +
  // MA/RSI. That direct DB access has been removed (Rule 4 / Rule 27).
  // The cache already contains Python's most recent computed values for
  // these fields. If the consumer needs fresher values, the cache must be
  // warmed up — the frontend never reaches into SQLite directly.
  const tracking = await loadTracking();

  const enrichStock = (stock: any) => {
    const s = { ...stock };
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
    source: 'cache',
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
