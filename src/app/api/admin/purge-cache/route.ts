import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

/**
 * Measure the on-disk size of the SQLite database (main file + WAL file
 * if present). Used to compute how many bytes were freed by a purge.
 */
function getDbSizeBytes(dbPath: string): number {
  try {
    let total = 0;
    if (fs.existsSync(dbPath)) {
      total += fs.statSync(dbPath).size;
    }
    const walPath = `${dbPath}-wal`;
    if (fs.existsSync(walPath)) {
      total += fs.statSync(walPath).size;
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * POST /api/admin/purge-cache
 * Phase 9: مسح الكاش القديم + إعادة بناء التوقعات بالمحرك الجديد
 *
 * P37-PHASE-4B: بعد المسح، بيحسب حجم الـ bytes اللي اتحررت (DB size قبل/بعد
 * مع VACUUM + WAL checkpoint) وبيُرجعها في `freedBytes` + `freedMB`.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope') || 'all';

    const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const results = {
      cached_analysis: 0,
      stored_analyses: 0,
      prediction_logs: 0,
      signal_logs: 0,
    };

    // قِس حجم الـ DB قبل المسح (main + WAL).
    const sizeBefore = getDbSizeBytes(dbPath);

    try {
      const db = new Database(dbPath, { timeout: 5000 });
      db.pragma('busy_timeout = 5000');

      if (scope === 'all' || scope === 'cache_only') {
        const tableExists = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='cached_analysis'"
        ).get();
        if (tableExists) {
          const r = db.prepare('DELETE FROM cached_analysis').run();
          results.cached_analysis = r.changes || 0;
        }

        const storedExists = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='stored_analyses'"
        ).get();
        if (storedExists) {
          const r = db.prepare('DELETE FROM stored_analyses').run();
          results.stored_analyses = r.changes || 0;
        }
      }

      if (scope === 'all' || scope === 'predictions_only') {
        const predExists = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='prediction_logs'"
        ).get();
        if (predExists) {
          const r = db.prepare(
            "DELETE FROM prediction_logs WHERE DATE(created_at) < DATE('now', '-7 days')"
          ).run();
          results.prediction_logs = r.changes || 0;
        }

        const sigExists = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='signal_logs'"
        ).get();
        if (sigExists) {
          const r = db.prepare(
            "DELETE FROM signal_logs WHERE DATE(created_at) < DATE('now', '-7 days')"
          ).run();
          results.signal_logs = r.changes || 0;
        }
      }

      // Inline VACUUM + WAL checkpoint to compact the file so the freed
      // bytes reflect real on-disk savings (not just free pages).
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        /* ignore checkpoint errors */
      }
      try {
        db.exec('VACUUM');
      } catch {
        /* VACUUM may fail if there are open transactions or attached DBs;
           the deletes still succeeded, we just can't report compacted size. */
      }

      db.close();
    } catch (dbError: any) {
      return NextResponse.json({
        success: false,
        error: `DB error: ${dbError?.message}`,
      }, { status: 500 });
    }

    // قِس حجم الـ DB بعد المسح + VACUUM.
    const sizeAfter = getDbSizeBytes(dbPath);
    const freedBytes = Math.max(0, sizeBefore - sizeAfter);
    const freedMB = Number((freedBytes / (1024 * 1024)).toFixed(2));

    const total = Object.values(results).reduce((a, b) => a + b, 0);

    return NextResponse.json({
      success: true,
      message: `تم مسح ${total} صف من الكاش`,
      details: results,
      scope,
      freedBytes,
      freedMB,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const db = new Database(dbPath, { readonly: true, timeout: 5000 });
    const stats: Record<string, any> = {};

    try {
      const c = db.prepare('SELECT COUNT(*) as count FROM cached_analysis').get() as any;
      stats.cached_analysis = c?.count || 0;
      if (stats.cached_analysis > 0) {
        const l = db.prepare('SELECT MAX(created_at) as latest FROM cached_analysis').get() as any;
        stats.latest_cache_date = l?.latest || 'unknown';
      }
    } catch { stats.cached_analysis = -1; }

    try {
      const c = db.prepare('SELECT COUNT(*) as count FROM prediction_logs').get() as any;
      stats.prediction_logs = c?.count || 0;
    } catch { stats.prediction_logs = -1; }

    db.close();

    return NextResponse.json({
      success: true,
      stats,
      needs_purge: stats.cached_analysis > 0,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}
