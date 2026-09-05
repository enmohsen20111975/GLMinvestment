import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { initialize, isInitialized, createDatabase } from '@/lib/sqlite-wrapper';
import { join } from 'path';
import { existsSync } from 'fs';

export async function GET(request: NextRequest) {
  try {
    // Initialize SQLite
    if (!isInitialized()) {
      await initialize();
    }

    // Read from local database
    const dbPath = join(process.cwd(), 'db', 'stocks.db');
    
    if (!existsSync(dbPath)) {
      return NextResponse.json({
        success: false,
        error: 'قاعدة البيانات غير موجودة'
      }, { status: 503 });
    }

    const db = createDatabase(dbPath, { readonly: true });
    
    // Get count of stocks
    const result = db.prepare("SELECT COUNT(*) as count FROM stocks WHERE is_active = 1").get();
    
    return NextResponse.json({
      success: true,
      dbPath,
      count: result?.count || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
