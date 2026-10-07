export const dynamic = 'force-dynamic';
import { NextResponse, NextRequest } from 'next/server';
// P0-11-AUTH fix (2026-09-27): added admin auth guard — db-stats exposes
// all DB table names + row counts + file size. Was open to anyone
// (information disclosure / reconnaissance vector).
import { requireAdminAsync } from '@/lib/admin-guard';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_ENGINE_VERSION = '2.1.0';

export async function GET(req: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): admin auth guard (DB schema disclosure)
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    // Use db/data_engine.db (the correct path after cleanup)
    const dbPath = path.join(process.cwd(), 'db', 'data_engine.db');

    // Check if file exists
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({
        error: 'data_engine.db not found',
        path: dbPath
      }, { status: 404 });
    }

    // FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #8: pagination params (Rule 56)
    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10), 1), 1000);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

    const db = new Database(dbPath, { readonly: true });

    // Get all tables (paginated)
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name LIMIT ? OFFSET ?
    `).all(limit, offset) as { name: string }[];

    // Total tables count for pagination metadata
    const totalRow = db.prepare(`
      SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'
    `).get() as { c: number } | undefined;
    const total = totalRow?.c ?? 0;

    // Get row counts for each table
    const tableStats: { name: string; count: number }[] = [];

    for (const table of tables) {
      const result = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as { count: number };
      tableStats.push({
        name: table.name,
        count: result.count
      });
    }

    // Get database file size
    const stats = fs.statSync(dbPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    db.close();

    return NextResponse.json({
      success: true,
      fileSizeMB,
      tables: tableStats,
      tableCount: tables.length,
      totalTables: total,
      pagination: { limit, offset, total, returned: tables.length },
      version: DATA_ENGINE_VERSION
    });
  } catch (error) {
    console.error('[GET /api/db-stats] Error:', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
