import { NextRequest, NextResponse } from 'next/server';
import { restoreBackup } from '@/lib/admin-db-manager';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/db-manager/restore
 * Body: { db, backupFile }
 *
 * Restores `db` from `backupFile` in db/backups/. Auto-backs-up the current
 * database first so the operation is reversible.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    const { db, backupFile } = body as { db: string; backupFile: string };
    if (!db) {
      return NextResponse.json({ success: false, error: 'db is required' }, { status: 400 });
    }
    if (!backupFile) {
      return NextResponse.json({ success: false, error: 'backupFile is required' }, { status: 400 });
    }
    const result = restoreBackup(db, backupFile);
    return NextResponse.json({
      success: true,
      message: 'تمت الاستعادة بنجاح',
      autoBackup: result.autoBackup,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}
