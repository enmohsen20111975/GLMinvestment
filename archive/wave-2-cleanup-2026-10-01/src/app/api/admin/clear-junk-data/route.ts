import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { ensureInitialized, getWritableStocksDb, clearDbCache } from '@/lib/egx-db';
import { requireAdminAsync } from '@/lib/admin-auth-server';

// P0-12-SQLI fix (2026-09-27): whitelist tables that are safe to clear.
// Previously `body.tables` was passed straight into `DELETE FROM ${table}` —
// an admin user could inject e.g. tables:['stocks'] and wipe the stocks table,
// or tables:['stocks; DROP TABLE predictions; --'] for arbitrary SQL.
// Now any table name not in this Set is rejected with 400 (per-table error).
const ALLOWED_CLEAR_TABLES = new Set([
  'prediction_logs',
  'signal_logs',
  'outcome_logs',
  'ExpertRecommendation',
  'cached_analysis',
]);

/**
 * API لمسح البيانات الليفة من قاعدة البيانات
 * - prediction_logs: سجلات التجارب والتعلم التكراري (538K record was cleared)
 * - signal_logs: سجلات التجارب (table may not exist)
 * - outcome_logs: نتائج التجارب (table may not exist)
 * 
 * Also runs VACUUM to reclaim disk space and clears the cache.
 */

export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  let egxDb: ReturnType<typeof getWritableStocksDb> | null = null;
  
  try {
    await ensureInitialized();
    egxDb = getWritableStocksDb();
    
    const body = await request.json().catch(() => ({}));
    const requestedTables: unknown = body.tables;
    const defaultTables = ['prediction_logs', 'signal_logs', 'outcome_logs'];
    // P0-12-SQLI fix (2026-09-27): validate every requested table against the
    // ALLOWED_CLEAR_TABLES whitelist before using it in any SQL.
    const tables: string[] = Array.isArray(requestedTables) && requestedTables.length > 0
      ? requestedTables.filter((t): t is string => typeof t === 'string' && ALLOWED_CLEAR_TABLES.has(t))
      : defaultTables;
    const rejectedTables = Array.isArray(requestedTables)
      ? requestedTables.filter((t) => typeof t !== 'string' || !ALLOWED_CLEAR_TABLES.has(t as string))
      : [];
    
    const results: Record<string, { before: number; after: number; deleted: number; error?: string }> = {};
    // P0-12-SQLI fix (2026-09-27): surface rejected tables in the response so
    // admins can see if their request was partially blocked for safety.
    if (rejectedTables.length > 0) {
      for (const rejected of rejectedTables) {
        results[String(rejected)] = {
          before: 0,
          after: 0,
          deleted: 0,
          error: `Table '${String(rejected)}' is not in the safe-to-clear whitelist`,
        };
      }
    }
    
    for (const table of tables) {
      try {
        // Check if table exists
        const tableCheck = egxDb.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        ).get(table);
        
        if (!tableCheck) {
          results[table] = { before: 0, after: 0, deleted: 0 };
          continue;
        }
        
        // Count before
        const countBefore = egxDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
        const before = countBefore.count;
        
        // Delete all
        egxDb.prepare(`DELETE FROM ${table}`).run();
        
        // Count after
        const countAfter = egxDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
        const after = countAfter.count;
        
        results[table] = {
          before,
          after,
          deleted: before - after
        };
        
        console.log(`[Clear Junk Data] Cleared ${table}: ${before} -> ${after}`);
      } catch (e) {
        results[table] = { before: 0, after: 0, deleted: 0, error: 'internal_error' };
      }
    }
    
    // Run VACUUM to reclaim disk space
    try {
      egxDb.prepare('VACUUM').run();
      console.log('[Clear Junk Data] VACUUM completed');
    } catch (e) {
      console.warn('[Clear Junk Data] VACUUM failed:', e);
    }
    
    // Clear the cache to ensure fresh data is fetched
    clearDbCache();
    console.log('[Clear Junk Data] Cache cleared');
    
    return NextResponse.json({
      success: true,
      message: 'تم مسح البيانات الليفة بنجاح',
      results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Clear Junk Data API] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error'
    }, { status: 500 });
  } finally {
    if (egxDb) egxDb.close();
  }
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  let egxDb: ReturnType<typeof getWritableStocksDb> | null = null;
  
  try {
    await ensureInitialized();
    egxDb = getWritableStocksDb();
    
    const tables = ['prediction_logs', 'signal_logs', 'outcome_logs', 'ExpertRecommendation', 'cached_analysis'];
    // P0-12-SQLI fix (2026-09-27): the GET path uses a hardcoded list (already
    // safe), but we filter against ALLOWED_CLEAR_TABLES for defence-in-depth.
    const safeTables = tables.filter((t) => ALLOWED_CLEAR_TABLES.has(t));
    const stats: Record<string, { count: number; exists: boolean; error?: string }> = {};
    
    for (const table of safeTables) {
      try {
        const tableCheck = egxDb.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        ).get(table);
        
        if (!tableCheck) {
          stats[table] = { count: 0, exists: false };
          continue;
        }
        
        const count = egxDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
        stats[table] = { count: count.count, exists: true };
      } catch (e) {
        stats[table] = { count: 0, exists: false, error: 'internal_error' };
      }
    }
    
    return NextResponse.json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Clear Junk Data API] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error'
    }, { status: 500 });
  } finally {
    if (egxDb) egxDb.close();
  }
}
