/**
 * POST /api/market/sync-indices
 * ============================================================================
 * يحّدث مؤشرات كل الأسواق لحظياً (EGX30/70/100/33, TADAWUL_TASI,
 * KSE_COMPOSITE, QSE_QE_INDEX, US_COMPOSITE) عن طريق تشغيل السكريبت
 * `scripts/sync_market_indices_live.py` في الـ background.
 *
 * الـ script بيقرا آخر الأسعار من stocks.db + intraday.db ويحسب المؤشرات
 * ويـ upsert في market_indices + index_daily_prices.
 *
 * ليه الـ endpoint ده موجود؟
 * - الـ cron (cron_radar.sh) بيشتغل كل فترة، بس أحياناً محتاج تحديث فوري
 *   (مثلاً بعد sync-live للأسعار، أو قبل ما الـ dashboard يعرض).
 * - ده endpoint عام مش محتاج market param — بيحدّث كل المؤشرات.
 *
 * Auth: admin-only (السكريبت بيكتب في DB).
 *
 * Response:
 *   { success, message, indices_count, last_updated, source }
 *   or
 *   { success: false, error }
 *
 * Rule 27 (NO-FAKE-DATA): الـ script بيحسب من أسعار حقيقية، مش بيفبرك قيم.
 * ============================================================================
 */
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { requireAdminAsync } from '@/lib/admin-guard';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // 1 دقيقة كحد أقصى

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'sync_market_indices_live.py');

export async function POST(req: NextRequest) {
  // P0-11-AUTH: admin only — script writes to stocks.db
  const auth = await requireAdminAsync(req);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: 'unauthorized', message: auth.error || 'Admin access required' },
      { status: 401 }
    );
  }

  try {
    logger.info('[sync-indices] starting indices sync...');

    // Read current state before sync
    const before = await readIndicesState();

    // Run the sync script synchronously (it takes ~2 seconds)
    const result = await runSyncScript();

    if (!result.success) {
      logger.error('[sync-indices] sync failed', { stderr: result.stderr });
      return NextResponse.json(
        { success: false, error: 'sync_failed', message: result.stderr.slice(-500), script: SCRIPT_PATH },
        { status: 500 }
      );
    }

    // Read state after sync
    const after = await readIndicesState();

    const updated = after.filter((a, i) => {
      const b = before[i];
      return b && (a.last_update !== b.last_update || a.current_value !== b.current_value);
    });

    logger.info('[sync-indices] sync completed', {
      total: after.length,
      updated: updated.length,
    });

    return NextResponse.json({
      success: true,
      message: `Synced ${after.length} indices (${updated.length} changed)`,
      indices: after,
      indices_count: after.length,
      updated_count: updated.length,
      last_updated: new Date().toISOString(),
      source: 'sync_market_indices_live.py',
      stdout_tail: result.stdout.slice(-300),
    });
  } catch (e) {
    logger.error('[sync-indices] unexpected error', { error: String(e) });
    return NextResponse.json(
      { success: false, error: 'internal_error', message: String(e) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/market/sync-indices
 * Returns the current state of all market indices (no sync, just read).
 * Useful for verifying when the last sync happened.
 */
export async function GET(req: NextRequest) {
  const indices = await readIndicesState();
  return NextResponse.json({
    success: true,
    indices,
    indices_count: indices.length,
    generated_at: new Date().toISOString(),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface IndexRow {
  symbol: string;
  name_ar: string | null;
  current_value: number;
  change_percent: number;
  last_update: string | null;
}

async function readIndicesState(): Promise<IndexRow[]> {
  try {
    const { getStocksDb } = await import('@/lib/egx-db');
    const db = getStocksDb();
    const rows = db.prepare(`
      SELECT symbol, name_ar, current_value, change_percent, last_update
      FROM market_indices
      ORDER BY CASE
        WHEN symbol LIKE 'EGX%' THEN 1
        WHEN symbol LIKE 'TADAWUL%' THEN 2
        WHEN symbol LIKE 'KSE%' THEN 3
        WHEN symbol LIKE 'QSE%' THEN 4
        WHEN symbol LIKE 'US%' THEN 5
        ELSE 9 END, symbol
    `).all() as any[];
    return rows.map((r) => ({
      symbol: r.symbol,
      name_ar: r.name_ar,
      current_value: Number(r.current_value) || 0,
      change_percent: Number(r.change_percent) || 0,
      last_update: r.last_update,
    }));
  } catch (e) {
    logger.error('[sync-indices] readIndicesState failed', { error: String(e) });
    return [];
  }
}

function runSyncScript(): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const py = spawn('python3', [SCRIPT_PATH], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      timeout: 45_000,
    });
    let stdout = '';
    let stderr = '';
    py.stdout.on('data', (d) => (stdout += d.toString()));
    py.stderr.on('data', (d) => (stderr += d.toString()));
    py.on('error', (err) => {
      resolve({ success: false, stdout, stderr: stderr + '\n' + String(err) });
    });
    py.on('close', (code) => {
      resolve({ success: code === 0, stdout, stderr });
    });
  });
}
