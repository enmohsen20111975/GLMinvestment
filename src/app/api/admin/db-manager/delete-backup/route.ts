import { NextRequest, NextResponse } from 'next/server';
import { deleteBackup } from '@/lib/admin-db-manager';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * DELETE /api/admin/db-manager/delete-backup
 * Body: { file }
 *
 * Deletes a backup file (and its -wal/-shm sidecars) from db/backups/.
 */
export async function DELETE(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    const { file } = body as { file: string };
    if (!file) {
      return NextResponse.json({ success: false, error: 'file is required' }, { status: 400 });
    }
    deleteBackup(file);
    return NextResponse.json({ success: true, message: 'تم حذف النسخة الاحتياطية' });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}

/** Also accept POST (some clients can't send body with DELETE). */
export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  return DELETE(request);
}
