import { NextRequest, NextResponse } from 'next/server';
import { readFile, access } from 'fs/promises';
import path from 'path';

// ============================================================================
// GET /api/radar/incubator — The Incubator & Stalking Engine
// ============================================================================
// Per Mohsen's directive 2026-10-20 (BRAVO task):
// Returns stocks that have achieved 4/6 or 5/6 quiet accumulation signals
// + are waiting for a "trigger" (volume surge / resistance break / support
// confirm) to be promoted to a live BUY recommendation.
//
// Source: scripts/output/maker_radar_{MARKET}_{date}.json
// → 'incubator_candidates' array (built by _build_incubator_candidates()
//   in scripts/maker_radar.py)
//
// Response contract (per owner directive):
// {
//   "success": true,
//   "market": "EGX",
//   "total_candidates": N,
//   "candidates": [{ ticker, name_ar, current_price, readiness_pct,
//     signals_passed, total_signals, passed_reasons, trigger,
//     target_if_promoted, stop_loss_if_promoted, risk_reward, stage }],
//   "timestamp": "ISO-8601"
// }
// ============================================================================

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30; // generous — JSON file read is <50ms

const PROJECT_ROOT = process.cwd();
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'scripts', 'output');

/** Find the most recent maker_radar_{MARKET}_*.json file */
async function findLatestRadarJson(market: string): Promise<string | null> {
  const { readdir } = await import('fs/promises');
  try {
    const files = await readdir(OUTPUT_DIR);
    const prefix = `maker_radar_${market}_`;
    const candidates = files
      .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
      .sort()
      .reverse(); // latest first
    if (candidates.length === 0) return null;
    return path.join(OUTPUT_DIR, candidates[0]);
  } catch {
    return null;
  }
}

/** Today's date in YYYY-MM-DD format (Cairo timezone — EGX market) */
function todayDateString(): string {
  const now = new Date();
  // Cairo = UTC+2 (winter) / UTC+3 (summer DST, months 4-10)
  const isDst = 4 <= now.getUTCMonth() + 1 && now.getUTCMonth() + 1 <= 10;
  const cairoOffset = isDst ? 3 : 2;
  const cairoTime = new Date(now.getTime() + cairoOffset * 60 * 60 * 1000);
  return cairoTime.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const market = (req.nextUrl.searchParams.get('market') || 'EGX').toUpperCase();

  // (1) Try today's radar file first
  const today = todayDateString();
  const todayPath = path.join(OUTPUT_DIR, `maker_radar_${market}_${today}.json`);

  let jsonPath = todayPath;
  let usingLatest = false;

  try {
    await access(todayPath);
  } catch {
    // (2) Fall back to the latest available radar file for this market
    const latest = await findLatestRadarJson(market);
    if (!latest) {
      return NextResponse.json({
        success: true,
        market,
        total_candidates: 0,
        candidates: [],
        timestamp: new Date().toISOString(),
        source: 'no_radar_output',
        message: 'الرادار لسه ما اشتغلش للسوق ده — مفيش مخرج JSON متاح.',
      });
    }
    jsonPath = latest;
    usingLatest = true;
  }

  try {
    const raw = await readFile(jsonPath, 'utf-8');
    const data = JSON.parse(raw);

    // Extract incubator_candidates array (built by maker_radar.py)
    const candidates = Array.isArray(data.incubator_candidates)
      ? data.incubator_candidates
      : [];

    return NextResponse.json({
      success: true,
      market,
      total_candidates: candidates.length,
      candidates,
      timestamp: data.generated_at || new Date().toISOString(),
      source: usingLatest ? 'latest_radar' : 'today_radar',
      radar_file: path.basename(jsonPath),
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (e) {
    console.error('[/api/radar/incubator] read error:', e);
    return NextResponse.json({
      success: false,
      market,
      total_candidates: 0,
      candidates: [],
      timestamp: new Date().toISOString(),
      source: 'read_error',
      error: 'failed_to_read_radar_json',
      message: 'فشل قراءة مخرج الرادار — حاول تاني بعد ما الرادار يشتغل.',
    }, { status: 200 }); // 200 with empty candidates (not 500 — graceful)
  }
}
