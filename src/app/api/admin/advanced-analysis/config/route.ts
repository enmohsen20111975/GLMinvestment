/**
 * Admin API - Advanced Analysis Config
 * ======================================
 * Manages advanced analysis configuration.
 *
 * Uses a JSON config file (db/advanced-analysis-config.json) instead of
 * a Prisma model, since no advancedAnalysisConfig model exists in the schema.
 */

import { NextRequest, NextResponse } from 'next/server';
// P0-11-AUTH fix (2026-09-27): added admin auth guard (canonical multi-method
// check via requireAdminAsync — accepts X-Admin-Token, admin_session cookie,
// NextAuth session, or localhost bypass in dev). Pre-existing verifyAdminToken
// kept as defense-in-depth for callers that only send X-Admin-Token.
import { requireAdminAsync } from '@/lib/admin-guard';
import { verifyAdminToken } from '@/lib/admin-auth-server';
import path from 'path';
// P0-14-ASYNC fix (2026-09-27): replaced sync existsSync/readFileSync/writeFileSync/
// mkdirSync with async fs/promises equivalents in readConfig / writeConfig so the
// GET/PUT handlers never block the event loop on the config JSON file.
import { access, readFile, writeFile, mkdir } from 'fs/promises';

export const dynamic = 'force-dynamic';

const CONFIG_PATH = path.join(process.cwd(), 'db', 'advanced-analysis-config.json');

const DEFAULT_CONFIG = {
  scan_time: '09:30',
  scan_enabled: true,
  min_volume: 10000,
  min_price_change: 1.5,
  max_volatility: 10,
  min_buy_score: 70,
  min_sell_score: 30,
  min_confidence: 60,
  rsi_oversold: 30,
  rsi_overbought: 70,
  macd_enabled: true,
  bollinger_enabled: true,
  stochastic_enabled: true,
  default_stop_loss: 5,
  default_take_profit: 10,
  risk_reward_min: 1.5,
  include_crypto: false,
  include_egx: true,
  updated_at: null as string | null,
};

// P0-14-ASYNC fix (2026-09-27): readConfig is now async.
async function readConfig(): Promise<Record<string, unknown>> {
  try {
    try {
      await access(CONFIG_PATH);
    } catch {
      return { ...DEFAULT_CONFIG };
    }
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    /* fall through to default */
  }
  return { ...DEFAULT_CONFIG };
}

// P0-14-ASYNC fix (2026-09-27): writeConfig is now async.
async function writeConfig(config: Record<string, unknown>): Promise<void> {
  const dir = path.dirname(CONFIG_PATH);
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * GET: Retrieve current configuration
 */
export async function GET(request: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): admin auth guard
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const authHeader = request.headers.get('X-Admin-Token');
    if (!verifyAdminToken(authHeader || '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await readConfig();
    return NextResponse.json({ success: true, config });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

/**
 * PUT: Update configuration
 */
export async function PUT(request: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): admin auth guard
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const authHeader = request.headers.get('X-Admin-Token');
    if (!verifyAdminToken(authHeader || '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const current = await readConfig();

    // Merge allowed fields
    const allowedKeys = Object.keys(DEFAULT_CONFIG);
    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        (current as Record<string, unknown>)[key] = body[key];
      }
    }
    current.updated_at = new Date().toISOString();

    await writeConfig(current);

    return NextResponse.json({
      success: true,
      message: 'Configuration updated',
      config: current,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
