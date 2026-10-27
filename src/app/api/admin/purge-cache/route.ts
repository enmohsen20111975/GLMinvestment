import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { openDb, openDbWritable } from '@/lib/db-manager';

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

    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const predDbPath = path.join(process.cwd(), 'db', 'predictions.db');

    const results = {
      cached_analysis: 0,
      stored_analyses: 0,
      prediction_logs: 0,
      signal_logs: 0,
    };

    let sizeBefore = getDbSizeBytes(stocksDbPath) + getDbSizeBytes(predDbPath);

    // 1. Purge stocks.db
    if (fs.existsSync(stocksDbPath)) {
      const db = openDbWritable('stocks.db');
      if (db) {
        try {
          db.pragma('busy_timeout = 5000');

          if (scope === 'all' || scope === 'cache_only') {
            try {
              const r = db.prepare('DELETE FROM cached_analysis').run();
              results.cached_analysis += r.changes || 0;
            } catch {}
          }

          if (scope === 'all' || scope === 'predictions_only') {
            try {
              const r = db.prepare("DELETE FROM prediction_logs WHERE DATE(created_at) < DATE('now', '-7 days')").run();
              results.prediction_logs += r.changes || 0;
            } catch {}
            try {
              const r = db.prepare("DELETE FROM signal_logs WHERE DATE(created_at) < DATE('now', '-7 days')").run();
              results.signal_logs += r.changes || 0;
            } catch {}
          }

          try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
          try { db.exec('VACUUM'); } catch {}
        } catch (err) {
          console.warn('Error purging stocks.db:', err);
        } finally {
          try { db.close(); } catch { /* ignore */ }
        }
      }
    }

    // 2. Purge predictions.db
    if (fs.existsSync(predDbPath)) {
      const db = openDbWritable('predictions.db');
      if (db) {
        try {
          db.pragma('busy_timeout = 5000');

          if (scope === 'all' || scope === 'cache_only') {
            try {
              const r = db.prepare('DELETE FROM cached_analysis').run();
              results.cached_analysis += r.changes || 0;
            } catch {}
            try {
              const r = db.prepare('DELETE FROM stored_analyses').run();
              results.stored_analyses += r.changes || 0;
            } catch {}
          }

          if (scope === 'all' || scope === 'predictions_only') {
            try {
              const r = db.prepare("DELETE FROM prediction_logs WHERE DATE(created_at) < DATE('now', '-7 days')").run();
              results.prediction_logs += r.changes || 0;
            } catch {}
          }

          try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
          try { db.exec('VACUUM'); } catch {}
        } catch (err) {
          console.warn('Error purging predictions.db:', err);
        } finally {
          try { db.close(); } catch { /* ignore */ }
        }
      }
    }

    const sizeAfter = getDbSizeBytes(stocksDbPath) + getDbSizeBytes(predDbPath);
    const freedBytes = Math.max(0, sizeBefore - sizeAfter);
    const freedMB = Number((freedBytes / (1024 * 1024)).toFixed(2));
    const total = Object.values(results).reduce((a, b) => a + b, 0);

    return NextResponse.json({
      success: true,
      message: `تم مسح ${total} صف من الكاش بنجاح`,
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
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const predDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    const stats: Record<string, any> = {
      cached_analysis: 0,
      stored_analyses: 0,
      prediction_logs: 0,
    };

    let latestDates: string[] = [];

    {
      const db = openDb('stocks.db');
      if (db) {
        try {
          try {
            const c = db.prepare('SELECT COUNT(*) as count, MAX(created_at) as latest FROM cached_analysis').get() as any;
            stats.cached_analysis += c?.count || 0;
            if (c?.latest) latestDates.push(c.latest);
          } catch {}
          try {
            const c = db.prepare('SELECT COUNT(*) as count FROM prediction_logs').get() as any;
            stats.prediction_logs += c?.count || 0;
          } catch {}
        } catch {}
        try { db.close(); } catch { /* ignore */ }
      }
    }

    {
      const db = openDb('predictions.db');
      if (db) {
        try {
          try {
            const c = db.prepare('SELECT COUNT(*) as count, MAX(created_at) as latest FROM cached_analysis').get() as any;
            stats.cached_analysis += c?.count || 0;
            if (c?.latest) latestDates.push(c.latest);
          } catch {}
          try {
            const c = db.prepare('SELECT COUNT(*) as count, MAX(updated_at) as latest FROM stored_analyses').get() as any;
            stats.stored_analyses += c?.count || 0;
            if (c?.latest) latestDates.push(c.latest);
          } catch {}
          try {
            const c = db.prepare('SELECT COUNT(*) as count FROM prediction_logs').get() as any;
            stats.prediction_logs += c?.count || 0;
          } catch {}
        } catch {}
        try { db.close(); } catch { /* ignore */ }
      }
    }

    latestDates.sort();
    const latestDate = latestDates.length > 0 ? latestDates[latestDates.length - 1] : null;
    stats.latest_cache_date = latestDate ? latestDate.substring(0, 10) : 'unknown';

    const todayStr = new Date().toISOString().substring(0, 10);
    // إذا كان الكاش يحتوي على عناصر وتاريخه ليس تاريخ اليوم، يحتاج مسح
    const isOld = latestDate ? !latestDate.startsWith(todayStr) : false;
    const needsPurge = (stats.cached_analysis > 0 || stats.stored_analyses > 0) && isOld;

    return NextResponse.json({
      success: true,
      stats,
      needs_purge: needsPurge,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}
