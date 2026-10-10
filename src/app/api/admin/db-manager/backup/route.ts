import { NextRequest, NextResponse } from 'next/server';
import { backupDatabase, listBackups } from '@/lib/admin-db-manager';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/db-manager/backup
 *   Lists all existing backups in db/backups/.
 *
 * POST /api/admin/db-manager/backup
 *   Body: { db }
 *   Creates a timestamped copy of the .db file (plus -wal/-shm if present)
 *   in db/backups/ and returns the backup filename + size.
 */
export async function GET(_request: NextRequest) {
  const authError = await requireAdminAsync(_request);
  if (authError) return authError;
  try {
    const backups = listBackups();
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
    const { db } = body as { db: string };
    if (!db) {
      return NextResponse.json({ success: false, error: 'db is required' }, { status: 400 });
    }
    const result = backupDatabase(db);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}
