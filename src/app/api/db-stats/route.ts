import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_ENGINE_VERSION = '2.1.0';

export async function GET() {
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
    
    const db = new Database(dbPath, { readonly: true });

    // Get all tables
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
    `).all() as { name: string }[];

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
      totalTables: tables.length,
      version: DATA_ENGINE_VERSION
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
