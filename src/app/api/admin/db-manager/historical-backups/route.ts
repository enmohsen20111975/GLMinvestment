import { NextRequest, NextResponse } from 'next/server';
import { listHistoricalBackups, restoreFromBackup, deleteBackupDirectory } from '@/lib/admin-db-manager';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/db-manager/historical-backups
 * Lists all historical daily backups with integrity status.
 *
 * POST /api/admin/db-manager/historical-backups
 * Body: { backupId }
 * Restores all databases from a specific historical backup.
 *
 * DELETE /api/admin/db-manager/historical-backups
 * Body: { backupId }
 * Deletes a historical backup directory.
 */
export async function GET(request: Request) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const backups = listHistoricalBackups();
    return NextResponse.json({ success: true, backups });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    const { backupId } = body as { backupId: string };

    if (!backupId) {
      return NextResponse.json({ success: false, error: 'backupId is required' }, { status: 400 });
    }

    const result = restoreFromBackup(backupId);
    return NextResponse.json({
      success: true,
      ...result,
      message:
        `تم استعادة ${result.restored.length} قواعد بيانات من النسخة ${backupId}` +
        (result.failed.length > 0 ? ` — ${result.failed.length} فشلت` : ''),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    const { backupId } = body as { backupId: string };

    if (!backupId) {
      return NextResponse.json({ success: false, error: 'backupId is required' }, { status: 400 });
    }

    deleteBackupDirectory(backupId);
    return NextResponse.json({ success: true, message: 'تم حذف النسخة الاحتياطية' });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}