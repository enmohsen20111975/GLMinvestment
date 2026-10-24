import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { executeQuery } from '@/lib/admin-db-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/db-manager/query
 * Body: { db: string, sql: string, dryRun?: boolean }
 *
 * Execute raw SQL against a SQLite database. For SELECTs the result rows are
 * returned (capped at 1000). For writes (INSERT/UPDATE/DELETE/CREATE/ALTER/DROP)
 * the `changes` count is returned. `dryRun: true` returns the EXPLAIN plan.
 */
export async function POST(request: NextRequest) {
  // SEC-06 FIX: Admin auth required for raw SQL execution
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    const { db, sql, dryRun } = body as { db: string; sql: string; dryRun?: boolean };

    if (!db) {
      return NextResponse.json(
        { success: false, error: 'db (database name) is required' },
        { status: 400 }
      );
    }
    if (!sql || typeof sql !== 'string') {
      return NextResponse.json(
        { success: false, error: 'sql (SQL statement) is required' },
        { status: 400 }
      );
    }

    const result = executeQuery(db, sql, !!dryRun);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = String((error as Error)?.message || error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
