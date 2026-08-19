/**
 * GET /api/sync-names
 *
 * Sync stock names from heavy DB to light DB.
 * This ensures both databases have consistent stock names.
 *
 * OPTIMIZED: Fast, single-query operation
 */

import { NextResponse } from 'next/server';

export async function GET() {
  const startTime = Date.now();
  console.log('[sync-names] Starting name sync...');

  try {
    // Dynamic imports for sql.js
    const sqlJs = await import('sql.js');
    const SQL = await sqlJs.default();
    const fs = await import('fs');
    const path = await import('path');

    const lightDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const heavyDbPath = path.join(process.cwd(), 'db', 'stocks.db');

    // Check both databases exist
    if (!fs.existsSync(lightDbPath) || !fs.existsSync(heavyDbPath)) {
      return NextResponse.json({
        success: false,
        error: 'One or both databases not found'
      }, { status: 500 });
    }

    // Load heavy database (read names from here)
    const heavyBuffer = fs.readFileSync(heavyDbPath);
    const heavyDb = new SQL.Database(heavyBuffer);

    // Get all stock names from heavy DB
    const namesResult = heavyDb.exec('SELECT ticker, name FROM stocks WHERE name IS NOT NULL AND name != ""');
    const namesMap = new Map<string, string>();

    if (namesResult.length > 0) {
      for (const row of namesResult[0].values) {
        namesMap.set(row[0] as string, row[1] as string);
      }
    }
    heavyDb.close();

    console.log(`[sync-names] Found ${namesMap.size} names in heavy DB`);

    // Load light database (update names here)
    const lightBuffer = fs.readFileSync(lightDbPath);
    const lightDb = new SQL.Database(lightBuffer);

    // Update names in light DB
    let updated = 0;
    for (const [ticker, name] of namesMap) {
      try {
        lightDb.run('UPDATE stocks SET name = ?, name_ar = ? WHERE ticker = ?', [name, name, ticker]);
        updated++;
      } catch {
        // Skip errors
      }
    }

    // Save light database
    const lightData = lightDb.export();
    fs.writeFileSync(lightDbPath, Buffer.from(lightData));
    lightDb.close();

    const elapsed = Date.now() - startTime;
    console.log(`[sync-names] Updated ${updated} names in ${elapsed}ms`);

    // Reset caches
    try {
      const { resetAllDbStates } = await import('@/lib/egx-db');
      resetAllDbStates();
    } catch {
      // Ignore
    }

    return NextResponse.json({
      success: true,
      names_synced: updated,
      timing_ms: elapsed
    });

  } catch (error) {
    console.error('[sync-names] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
/**
 * GET /api/sync-names
 *
 * Sync stock names from heavy DB to light DB.
 * This ensures both databases have consistent stock names.
 *
 * OPTIMIZED: Fast, single-query operation
 */

