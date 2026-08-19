import { NextRequest, NextResponse } from 'next/server';
import { reindexAll } from '@/lib/admin-db-manager';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/admin/db-manager/reindex — Body: { db } */
export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    const { db } = body as { db: string };
    if (!db) {
      return NextResponse.json({ success: false, error: 'db is required' }, { status: 400 });
    }
    const result = reindexAll(db);
    return NextResponse.json({ success: result.success, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}
