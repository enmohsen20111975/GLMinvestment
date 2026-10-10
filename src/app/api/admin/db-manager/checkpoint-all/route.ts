import { NextResponse } from 'next/server';
import { checkpointAllDbs } from '@/lib/admin-db-manager';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/db-manager/checkpoint-all
 * Runs WAL checkpoint (TRUNCATE) on all databases.
 * Essential before downloading or backing up databases.
 */
export async function POST(request: Request) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const result = checkpointAllDbs();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}