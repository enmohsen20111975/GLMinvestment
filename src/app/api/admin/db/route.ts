import { NextResponse } from 'next/server'
export const dynamic = "force-dynamic";

import { listDatabases, integrityCheck } from '@/lib/sqlite-admin'
import { requireAdminAsync } from '@/lib/admin-auth-server'

// GET /api/admin/db — قائمة قواعد البيانات
export async function GET(request: Request) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const dbs = listDatabases()
    return NextResponse.json({ success: true, databases: dbs })
  } catch (e) {
    console.error('[admin:db]', e);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    )
  }
}

// POST /api/admin/db — فحص سلامة قاعدة بيانات
export async function POST(req: Request) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    const body = await req.json()
    const { action, db } = body

    if (action === 'integrity' && db) {
      const result = integrityCheck(db)
      return NextResponse.json(result)
    }

    return NextResponse.json(
      { success: false, error: 'إجراء غير معروف' },
      { status: 400 }
    )
  } catch (e) {
    console.error('[admin:db]', e);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    )
  }
}
