import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { dropTable } from '@/lib/admin-db-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/admin/db-manager/drop-table — Body: { db, table } */
export async function POST(request: NextRequest) {
  // SEC-06 FIX: Admin auth required for destructive operations
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    const { db, table } = body as { db: string; table: string };
    if (!db) {
      return NextResponse.json({ success: false, error: 'db is required' }, { status: 400 });
    }
    if (!table) {
      return NextResponse.json({ success: false, error: 'table is required' }, { status: 400 });
    }
    const result = dropTable(db, table);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}
