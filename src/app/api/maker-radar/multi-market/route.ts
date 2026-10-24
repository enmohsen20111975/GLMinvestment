/**
 * GET /api/maker-radar/multi-market?markets=EGX,US,CRYPTO
 * ===============================================
 * Unified multi-market radar endpoint.
 *
 * Returns the maker radar + regime + top picks for multiple markets in a
 * single response. Designed for a unified dashboard view that compares
 * opportunities across markets.
 *
 * Query params:
 *   - markets: comma-separated list of market codes (default: EGX,US,CRYPTO)
 *               supported: EGX, TADAWUL, KSE, QSE, US, CRYPTO, GOLD
 *
 * Response shape:
 *   {
 *     success: true,
 *     markets: {
 *       EGX:    { count, top_picks, regime, currency, is_open,
 *                 warming_up, first_generation, last_generated_at, ... },
 *       US:     { ... },
 *       CRYPTO: { ... },
 *     },
 *     unified_top_5: [ ...best 5 across all markets ],
 *     served_at: ISO timestamp,
 *   }
 *
 * Implementation notes (Rule 67 — root-cause-first, Task 35-A):
 *   - Reads each market's cached radar JSON from disk (scripts/output/maker_radar_*.json)
 *     so we never block on Python execution.
 *   - If no cache exists for a market, this is the FIRST generation:
 *       * spawn `python3 scripts/maker_radar.py --market=X --json-only` in the
 *         background (fire-and-forget, mutex per market to prevent races).
 *       * return `warming_up: true, first_generation: true, generated_at: null`
 *         so the UI can show a HONEST "first time warming up" message.
 *       * subsequent requests will find the cache (after cron/this warmup
 *         completes) and `warming_up` becomes `false`.
 *   - Per Rule 67: `warming_up: true` is ONLY acceptable for first generation
 *     (cache miss + background warmup triggered). Once a cache exists, the API
 *     NEVER lies with `warming_up: true` — it returns real (possibly stale)
 *     data + `cache_age_seconds` so the admin can see freshness.
 *   - `last_generated_at` exposes when each market was last refreshed (for
 *     admin observability).
 *   - Regime detection uses a lightweight heuristic based on top picks' ROC10
 *     (the full regime engine runs on the Python side via maker_radar.py).
 */
import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30; // 30s max — should be <100ms typically

const PROJECT_ROOT = process.cwd();
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'scripts', 'output');
const MAKER_RADAR_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'maker_radar.py');

// Markets we know how to handle — mirrors MARKET_CONFIG in the Python engine
const SUPPORTED_MARKETS = new Set([
  'EGX',
  'TADAWUL',
  'KSE',
  'QSE',
  'US',
  'CRYPTO',
  'GOLD',
]);

// Per-market background warmup mutex — prevents concurrent spawns of the same
// market (Task 35-A, Rule 67: don't lie about warmup, but don't fork-bomb
// the host either). Cleared on child exit (success or failure).
const runningWarmups = new Map<string, number>(); // market -> startMs
const WARMUP_MIN_GAP_MS = 30 * 1000; // at most 1 spawn per market per 30s

/**
 * Trigger a fire-and-forget background warmup for a market. Returns true if a
 * warmup was actually started, false if one is already running or the script
 * doesn't exist on disk. Mirrors the pattern in
 * src/modules/radar/lib/radar-cache.ts:triggerBackgroundWarmup (kept
 * duplicated here so the multi-market endpoint stays self-contained).
 */
function triggerMarketWarmup(market: string): boolean {
  const now = Date.now();
  const startedAt = runningWarmups.get(market);
  if (startedAt !== undefined && now - startedAt < WARMUP_MIN_GAP_MS) {
    return false; // already warming up recently — let the previous run finish
  }
  if (!existsSync(MAKER_RADAR_SCRIPT)) return false;

  const python = resolvePython();
  runningWarmups.set(market, now);

  const child = spawn(
    python,
    [MAKER_RADAR_SCRIPT, '--market', market, '--json-only'],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );

  // Drain stdout/stderr to avoid blocking the child on a full pipe buffer
  // (the script writes a few KB of progress logs).
  child.stdout?.on('data', () => { /* drain */ });
  child.stderr?.on('data', () => { /* drain */ });

  child.on('error', () => { runningWarmups.delete(market); });
  child.on('exit', () => { runningWarmups.delete(market); });

  // Detach so the child can outlive the API request handler.
  child.unref();
  return true;
}

/**
 * Resolve python binary — 100% portable, NO absolute paths.
 * Mirrors src/modules/radar/lib/radar-cache.ts:resolvePython.
 */
function resolvePython(): string {
  if (process.env.PYTHON && existsSync(process.env.PYTHON)) {
    return process.env.PYTHON;
  }
  if (process.env.VIRTUAL_ENV) {
    const venvPython = path.join(process.env.VIRTUAL_ENV, 'bin', 'python3');
    if (existsSync(venvPython)) return venvPython;
    const venvPythonAlt = path.join(process.env.VIRTUAL_ENV, 'bin', 'python');
    if (existsSync(venvPythonAlt)) return venvPythonAlt;
  }
  const projectVenvs = [
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python3'),
    path.join(PROJECT_ROOT, '.venv', 'bin', 'python'),
    path.join(PROJECT_ROOT, 'venv', 'bin', 'python3'),
    path.join(PROJECT_ROOT, 'venv', 'bin', 'python'),
  ];
  for (const c of projectVenvs) {
    if (existsSync(c)) return c;
  }
  return 'python3';
}

// Per-market currency + UTC trading hours + Arabic name (mirrors Python engine)
const MARKET_META: Record<
  string,
  { currency: string; market_open_utc: string; market_close_utc: string; name_ar: string }
> = {
  EGX: { currency: 'EGP', market_open_utc: '08:00', market_close_utc: '12:30', name_ar: 'البورصة المصرية' },
  TADAWUL: { currency: 'SAR', market_open_utc: '07:00', market_close_utc: '12:00', name_ar: 'تداول السعودية' },
  KSE: { currency: 'KWD', market_open_utc: '06:00', market_close_utc: '10:30', name_ar: 'بورصة الكويت' },
  QSE: { currency: 'QAR', market_open_utc: '06:00', market_close_utc: '10:00', name_ar: 'بورصة قطر' },
  US: { currency: 'USD', market_open_utc: '14:30', market_close_utc: '21:00', name_ar: 'البورصة الأمريكية' },
  CRYPTO: { currency: 'USD', market_open_utc: '00:00', market_close_utc: '23:59', name_ar: 'سوق العملات الرقمية' },
  GOLD: { currency: 'EGP', market_open_utc: '00:00', market_close_utc: '23:59', name_ar: 'سوق الذهب' },
};

function isMarketOpenUtc(market: string, nowUtc: Date = new Date()): boolean {
  if (market === 'CRYPTO' || market === 'GOLD') return true;
  const meta = MARKET_META[market];
  if (!meta) return false;
  // Get day of week in UTC (0=Sun .. 6=Sat). Mon-Fri = 1..5.
  const day = nowUtc.getUTCDay();
  // FIX-WAVE-2-DATA (AUDIT-DEEP-3 #8): weekend is market-aware.
  // US markets close Sat (6) + Sun (0). Arabic markets (EGX/TADAWUL/KSE/QSE)
  // close Fri (5) + Sat (6) per local exchange calendars.
  const arabicMarkets = ['EGX', 'TADAWUL', 'KSE', 'QSE'];
  const isArabicMarket = arabicMarkets.includes(market);
  const isWeekend = isArabicMarket ? (day === 5 || day === 6) : (day === 0 || day === 6);
  if (isWeekend) return false;
  const [openH, openM] = meta.market_open_utc.split(':').map(Number);
  const [closeH, closeM] = meta.market_close_utc.split(':').map(Number);
  const cur = nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes();
  const open = openH * 60 + openM;
  const close = closeH * 60 + closeM;
  return cur >= open && cur <= close;
}

/**
 * Find the most recent maker_radar_{MARKET}_*.json file.
 * FIX-WAVE-2-DATA (AUDIT-DEEP-3 #7): previously this scanned for any
 * `maker_radar_*.json` file and reused the first match for ALL markets,
 * silently serving EGX data to TADAWUL/KSE/QSE consumers.
 *
 * Behavior:
 *   - If `market` is provided, look ONLY for `maker_radar_{MARKET}_*.json`.
 *     If none exists, return null (do NOT fall back to another market's file).
 *   - If `market` is undefined (legacy callers), preserve old behavior of
 *     returning the most recent maker_radar_*.json (used for unified views).
 */
function findLatestRadarFile(market?: string): string | null {
  try {
    if (!existsSync(OUTPUT_DIR)) return null;
    const prefix = market ? `maker_radar_${market}_` : 'maker_radar_';
    const candidates = readdirSync(OUTPUT_DIR)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
      .sort()
      .reverse();
    if (candidates.length === 0) return null;
    return path.join(OUTPUT_DIR, candidates[0]);
  } catch {
    return null;
  }
}

interface RadarPick {
  ticker: string;
  current_price?: number;
  path?: string;
  position_size?: number;
  roc_10d?: number | null;
  [key: string]: unknown;
}

interface MarketSection {
  market: string;
  name_ar: string;
  currency: string;
  is_open: boolean;
  regime: string;
  regime_ar: string;
  market_score: number;
  market_open_utc: string;
  market_close_utc: string;
  count: number;
  top_picks: RadarPick[];
  /**
   * Rule 67 (Task 35-A): `warming_up` is ONLY true on the very first
   * generation (cache miss + background warmup triggered). Once a cache
   * file exists (no matter how stale), `warming_up` becomes `false` and
   * the API returns real (possibly stale) data + `cache_age_seconds`.
   *
   * The pre-fix bug: this field was `!cached`, so it stayed `true` forever
   * for non-EGX markets (because their cache never existed). The owner
   * saw "الرادار تحت التسخين" forever for 6 markets — a Rule 67 lie.
   */
  warming_up: boolean;
  /**
   * `first_generation` distinguishes "first time warming up (honest)" from
   * "we have stale data + a background refresh is running". This lets the
   * UI show the right message ("جاري التسخين لأول مرة" vs "تحديث البيانات").
   */
  first_generation: boolean;
  cached: boolean;
  cache_age_seconds: number | null;
  /** ISO timestamp when the cache file was generated (from the JSON's `generated_at`). */
  last_generated_at: string | null;
  db_source: string | null;
}

function buildMarketSection(market: string): MarketSection {
  const meta = MARKET_META[market] ?? {
    currency: 'USD',
    market_open_utc: '00:00',
    market_close_utc: '23:59',
    name_ar: market,
  };
  const radarFile = findLatestRadarFile(market);
  let count = 0;
  let topPicks: RadarPick[] = [];
  let cacheAge: number | null = null;
  let dbSource: string | null = null;
  let cached = false;
  let lastGeneratedAt: string | null = null;

  if (radarFile && existsSync(radarFile)) {
    try {
      const raw = readFileSync(radarFile, 'utf-8');
      const data = JSON.parse(raw);
      cached = true;
      count = data?.under_microscope_count ?? 0;
      dbSource = data?.db_source ?? null;
      const generatedAtStr: string | null = data?.generated_at ?? null;
      lastGeneratedAt = generatedAtStr;
      const generatedAt = generatedAtStr ? Date.parse(generatedAtStr) : null;
      if (generatedAt) {
        cacheAge = Math.max(0, Math.round((Date.now() - generatedAt) / 1000));
      }
      // Combine the four pick lists — top 4 per list = max 16 per market
      const combined: RadarPick[] = [];
      for (const key of ['pre_surge_list', 'quiet_list', 'explosive_list', 'early_break_list']) {
        const arr = Array.isArray(data?.[key]) ? data[key] : [];
        combined.push(...arr.slice(0, 4));
      }
      // Sort by position_size descending
      combined.sort((a, b) => (Number(b.position_size) || 0) - (Number(a.position_size) || 0));
      topPicks = combined.slice(0, 8);
    } catch (e) {
      console.error(`[multi-market] failed to parse ${radarFile}:`, e);
    }
  }

  // Rule 67 (Task 35-A): If no cache exists, this is the FIRST generation.
  // Trigger a background warmup (fire-and-forget) and report an HONEST
  // `warming_up: true, first_generation: true, generated_at: null`. Once
  // the cache exists (cron/this warmup completes), subsequent requests
  // return real data with `warming_up: false`.
  let firstGeneration = false;
  if (!cached) {
    firstGeneration = true;
    triggerMarketWarmup(market);
  }

  // Regime detection — derive from top picks' avg roc_10d if cache exists
  // (full regime engine is invoked on the Python side; here we approximate).
  let regime = 'sideways';
  let regimeAr = 'عرضي';
  let score = 50;
  if (topPicks.length > 0) {
    const rocs = topPicks
      .map((p) => Number(p.roc_10d))
      .filter((r): r is number => typeof r === 'number' && !Number.isNaN(r));
    if (rocs.length > 0) {
      const avgRoc = rocs.reduce((a, b) => a + b, 0) / rocs.length;
      if (avgRoc > 5) {
        regime = 'bull';
        regimeAr = 'صاعد';
        score = 72;
      } else if (avgRoc < -3) {
        regime = 'bear';
        regimeAr = 'هابط';
        score = 32;
      } else {
        regime = 'sideways';
        regimeAr = 'عرضي';
        score = 50;
      }
    }
  }

  return {
    market,
    name_ar: meta.name_ar,
    currency: meta.currency,
    is_open: isMarketOpenUtc(market),
    regime,
    regime_ar: regimeAr,
    market_score: score,
    market_open_utc: meta.market_open_utc,
    market_close_utc: meta.market_close_utc,
    count,
    top_picks: topPicks,
    // warming_up is TRUE only on the very first generation (cache miss).
    // Once the cache exists (even if stale), warming_up is FALSE — the
    // owner can see `cache_age_seconds` to judge freshness.
    warming_up: firstGeneration,
    first_generation: firstGeneration,
    cached,
    cache_age_seconds: cacheAge,
    last_generated_at: lastGeneratedAt,
    db_source: dbSource,
  };
}

function buildUnifiedTop5(sections: MarketSection[]): RadarPick[] {
  const all: RadarPick[] = [];
  for (const sec of sections) {
    for (const pick of sec.top_picks) {
      all.push({
        ...pick,
        market: sec.market,
        market_name_ar: sec.name_ar,
        currency: sec.currency,
      });
    }
  }
  all.sort((a, b) => (Number(b.position_size) || 0) - (Number(a.position_size) || 0));
  return all.slice(0, 5);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const marketsParam = url.searchParams.get('markets') || 'EGX,US,CRYPTO';
  const requested = marketsParam
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter((m) => m.length > 0);

  // Validate
  const validMarkets: string[] = [];
  const invalid: string[] = [];
  for (const m of requested) {
    if (SUPPORTED_MARKETS.has(m)) {
      validMarkets.push(m);
    } else {
      invalid.push(m);
    }
  }

  // Dedupe preserving order
  const seen = new Set<string>();
  const markets = validMarkets.filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });

  if (markets.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'No valid markets requested',
        supported_markets: Array.from(SUPPORTED_MARKETS).sort(),
        invalid_markets: invalid,
      },
      { status: 400 }
    );
  }

  const sections: Record<string, MarketSection> = {};
  for (const market of markets) {
    sections[market] = buildMarketSection(market);
  }

  const unifiedTop5 = buildUnifiedTop5(Object.values(sections));

  return NextResponse.json({
    success: true,
    markets: sections,
    unified_top_5: unifiedTop5,
    served_at: new Date().toISOString(),
    invalid_markets: invalid,
    supported_markets: Array.from(SUPPORTED_MARKETS).sort(),
  });
}
