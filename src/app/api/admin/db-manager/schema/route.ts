import { NextRequest, NextResponse } from 'next/server';
import { getSchema } from '@/lib/admin-db-manager';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/db-manager/schema?db=NAME&table=TBL
 *
 * Returns the CREATE TABLE statement, the column list, and the indexes for the
 * given table.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const url = new URL(request.url);
    const db = url.searchParams.get('db');
    const table = url.searchParams.get('table');

    if (!db || !table) {
      return NextResponse.json(
        { success: false, error: 'db and table are required' },
        { status: 400 }
      );
    }
    const result = getSchema(db, table);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}
