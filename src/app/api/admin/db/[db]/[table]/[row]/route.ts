import { NextResponse } from 'next/server'
import { updateRow, deleteRow, listTables } from '@/lib/sqlite-admin'
import { requireAdminAsync } from '@/lib/admin-auth-server'

interface Params {
  params: Promise<{ db: string; table: string; row: string }>
}

// PUT /api/admin/db/[db]/[table]/[row] — تحديث صف
// row هنا هو قيمة الـ primary key
export async function PUT(req: Request, { params }: Params) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    const { db, table, row } = await params
    const body = await req.json()
    const { values, primaryKeyColumn } = body as {
      values: Record<string, unknown>
      primaryKeyColumn?: string
    }

    if (!values || typeof values !== 'object') {
      return NextResponse.json(
        { success: false, error: 'مطلوب values' },
        { status: 400 }
      )
    }

    // لو الـ PK مش متحدد، نجيبه من الـ schema
    let pkCol = primaryKeyColumn
    if (!pkCol) {
      const tables = listTables(db)
      const tbl = tables.find((t) => t.name === table)
      const pk = tbl?.schema.find((s) => s.primaryKey)
      pkCol = pk?.name || 'id'
    }

    // حاول نحوّل row للنوع المناسب
    let pkValue: unknown = row
    if (/^-?\d+$/.test(row)) {
      pkValue = Number(row)
    }

    const result = updateRow(db, table, pkCol, pkValue, values)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// DELETE /api/admin/db/[db]/[table]/[row] — مسح صف
export async function DELETE(req: Request, { params }: Params) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    const { db, table, row } = await params
    const { searchParams } = new URL(req.url)
    let pkCol = searchParams.get('pk') || 'id'

    // لو الـ PK مش متحدد، نجيبه من الـ schema
    if (!searchParams.get('pk')) {
      const tables = listTables(db)
      const tbl = tables.find((t) => t.name === table)
      const pk = tbl?.schema.find((s) => s.primaryKey)
      pkCol = pk?.name || 'id'
    }

    // حاول نحوّل row للنوع المناسب
    let pkValue: unknown = row
    if (/^-?\d+$/.test(row)) {
      pkValue = Number(row)
    }

    const result = deleteRow(db, table, pkCol, pkValue)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
