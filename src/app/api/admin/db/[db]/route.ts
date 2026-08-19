import { NextResponse } from 'next/server'
import { listTables, deleteDatabase, vacuumDatabase, executeRawSql } from '@/lib/sqlite-admin'
import { requireAdminAsync } from '@/lib/admin-auth-server'

interface Params {
  params: Promise<{ db: string }>
}

// GET /api/admin/db/[db] — قائمة الجداول في قاعدة البيانات
export async function GET(req: Request, { params }: Params) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    const { db } = await params
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')

    // VACUUM
    if (action === 'vacuum') {
      const result = vacuumDatabase(db)
      return NextResponse.json(result)
    }

    // SQL خام
    if (action === 'sql') {
      const sql = searchParams.get('sql')
      const readOnly = searchParams.get('readOnly') === 'true'
      if (!sql) {
        return NextResponse.json(
          { success: false, error: 'مطلوب SQL' },
          { status: 400 }
        )
      }
      const result = executeRawSql(db, sql, readOnly)
      return NextResponse.json(result)
    }

    // افتراضي: قائمة الجداول
    const tables = listTables(db)
    return NextResponse.json({ success: true, tables })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// DELETE /api/admin/db/[db] — مسح قاعدة بيانات كاملة (مع backup)
export async function DELETE(req: Request, { params }: Params) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    const { db } = await params
    const { searchParams } = new URL(req.url)
    const makeBackup = searchParams.get('backup') !== 'false'

    const result = deleteDatabase(db, makeBackup)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
