import { NextRequest, NextResponse } from 'next/server';
import { listDatabases, getDatabaseOverview, listTables, getTableRows } from '@/lib/admin-db-manager';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/db-manager
 *   Query params:
 *     - (none)             → list all DBs with WAL/integrity overview
 *     - db=NAME            → list tables in NAME
 *     - db=NAME&table=TBL&page=N&limit=L&sortBy=COL&sortDir=asc|desc → paginated rows
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const url = new URL(request.url);
    const db = url.searchParams.get('db');
    const table = url.searchParams.get('table');
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const sortBy = url.searchParams.get('sortBy') || undefined;
    const sortDir = (url.searchParams.get('sortDir') as 'asc' | 'desc' | null) || undefined;

    if (!db) {
      const databases = listDatabases();
      return NextResponse.json({ success: true, databases });
    }

    if (!table) {
      const overview = getDatabaseOverview(db);
      const tables = listTables(db);
      return NextResponse.json({ success: true, database: db, overview, tables });
    }

    const rows = getTableRows(db, table, page, limit, sortBy, sortDir);
    return NextResponse.json({ success: true, database: db, table: rows });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}
