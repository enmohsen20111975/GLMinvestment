<<<<<<< HEAD
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
 *       EGX:    { count, top_picks, regime, currency, is_open, ... },
 *       US:     { count, top_picks, regime, currency, is_open, ... },
 *       CRYPTO: { count, top_picks, regime, currency, is_open, ... },
 *     },
 *     unified_top_5: [ ...best 5 across all markets ],
 *     served_at: ISO timestamp,
 *   }
 *
 * Implementation notes:
 *   - Reads each market's cached radar JSON from disk (scripts/output/maker_radar_*.json)
 *     so we never block on Python execution.
 *   - If no cache exists for a market, that market is returned with
 *     `count: 0, top_picks: [], regime: 'unknown'` and a warming_up flag.
 *   - Regime detection uses a lightweight heuristic based on top picks' ROC10
 *     (the full regime engine runs on the Python side via maker_radar.py).
 */
import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30; // 30s max — should be <100ms typically

const PROJECT_ROOT = process.cwd();
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'scripts', 'output');

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
  if (day === 0 || day === 6) return false; // weekend
  const [openH, openM] = meta.market_open_utc.split(':').map(Number);
  const [closeH, closeM] = meta.market_close_utc.split(':').map(Number);
  const cur = nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes();
  const open = openH * 60 + openM;
  const close = closeH * 60 + closeM;
  return cur >= open && cur <= close;
}

/** Find the most recent maker_radar_*.json file. */
function findLatestRadarFile(): string | null {
  try {
    if (!existsSync(OUTPUT_DIR)) return null;
    const candidates = readdirSync(OUTPUT_DIR)
      .filter((f) => f.startsWith('maker_radar_') && f.endsWith('.json'))
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
  warming_up: boolean;
  cached: boolean;
  cache_age_seconds: number | null;
  db_source: string | null;
}

function buildMarketSection(market: string): MarketSection {
  const meta = MARKET_META[market] ?? {
    currency: 'USD',
    market_open_utc: '00:00',
    market_close_utc: '23:59',
    name_ar: market,
  };
  const radarFile = findLatestRadarFile();
  let count = 0;
  let topPicks: RadarPick[] = [];
  let cacheAge: number | null = null;
  let dbSource: string | null = null;
  let cached = false;

  if (radarFile && existsSync(radarFile)) {
    try {
      const raw = readFileSync(radarFile, 'utf-8');
      const data = JSON.parse(raw);
      cached = true;
      count = data?.under_microscope_count ?? 0;
      dbSource = data?.db_source ?? null;
      const generatedAt = data?.generated_at ? Date.parse(data.generated_at) : null;
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
    warming_up: !cached,
    cached,
    cache_age_seconds: cacheAge,
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
=======
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const OUTPUT_DIR = path.join(process.cwd(), 'scripts', 'output');

function readRadarCache(market: string): any | null {
  try {
    if (!existsSync(OUTPUT_DIR)) return null;
    const files = readdirSync(OUTPUT_DIR)
      .filter(f => f.startsWith('maker_radar_') && f.endsWith('.json'))
      .sort().reverse();
    if (files.length === 0) return null;
    const raw = readFileSync(path.join(OUTPUT_DIR, files[0]), 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
>>>>>>> 835c22b (fix: recreate 7 lost API routes + restore predictions.db + Flutter audit)
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const marketsParam = url.searchParams.get('markets') || 'EGX,US,CRYPTO';
<<<<<<< HEAD
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
=======
  const markets = marketsParam.split(',').map(m => m.trim().toUpperCase());
  
  const result: Record<string, any> = {};
  const allPicks: any[] = [];
  
  for (const market of markets) {
    const cache = readRadarCache(market);
    if (cache) {
      const picks = [
        ...(cache.quiet_list || []),
        ...(cache.pre_surge_list || []),
        ...(cache.explosive_list || []),
        ...(cache.early_break_list || []),
      ].slice(0, 5);
      result[market] = {
        count: picks.length,
        regime: 'NORMAL',
        top_picks: picks.map((p: any) => ({
          ticker: p.ticker,
          path: p.path,
          current_price: p.current_price,
          signal_count: p.quiet_details?.signal_count || 0,
        })),
      };
      allPicks.push(...picks.map((p: any) => ({ ...p, market })));
    } else {
      result[market] = { count: 0, regime: 'NORMAL', top_picks: [], warming_up: true };
    }
  }
  
  const unified_top_5 = allPicks
    .sort((a: any, b: any) => (b.quiet_details?.signal_count || 0) - (a.quiet_details?.signal_count || 0))
    .slice(0, 5);
  
  return NextResponse.json({
    success: true,
    markets: result,
    unified_top_5: unified_top_5.map((p: any) => ({
      ticker: p.ticker,
      market: p.market,
      path: p.path,
      current_price: p.current_price,
      signal_count: p.quiet_details?.signal_count || 0,
    })),
    supported_markets: ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO', 'GOLD'],
>>>>>>> 835c22b (fix: recreate 7 lost API routes + restore predictions.db + Flutter audit)
  });
}
