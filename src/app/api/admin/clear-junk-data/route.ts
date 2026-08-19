import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getWritableStocksDb, clearDbCache } from '@/lib/egx-db';
import { requireAdminAsync } from '@/lib/admin-auth-server';

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
    const { tables = ['prediction_logs', 'signal_logs', 'outcome_logs'] } = body;
    
    const results: Record<string, { before: number; after: number; deleted: number }> = {};
    
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
        results[table] = { before: 0, after: 0, deleted: 0, error: String(e) };
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
      error: String(error)
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
    const stats: Record<string, { count: number; exists: boolean }> = {};
    
    for (const table of tables) {
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
        stats[table] = { count: 0, exists: false, error: String(e) };
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
      error: String(error)
    }, { status: 500 });
  } finally {
    if (egxDb) egxDb.close();
  }
}
