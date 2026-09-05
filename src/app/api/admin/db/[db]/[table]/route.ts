import { NextResponse } from 'next/server'
export const dynamic = "force-dynamic";

import { queryTable, insertRow, listTables } from '@/lib/sqlite-admin'
import { requireAdminAsync } from '@/lib/admin-auth-server'

interface Params {
  params: Promise<{ db: string; table: string }>
}

// GET /api/admin/db/[db]/[table] — استعلام عن جدول مع فلتر/ترتيب/تقسيم
export async function GET(req: Request, { params }: Params) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    const { db, table } = await params
    const { searchParams } = new URL(req.url)

    const page = parseInt(searchParams.get('page') || '1', 10)
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10)
    const sortColumn = searchParams.get('sortColumn') || undefined
    const sortDirection = (searchParams.get('sortDirection') || 'asc') as 'asc' | 'desc'

    // الفلاتر — كل عمود له قيمة
    const filters: Record<string, string> = {}
    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith('filter_') && value) {
        const col = key.replace('filter_', '')
        filters[col] = value
      }
    }

    // لو طلب schema بس
    if (searchParams.get('action') === 'schema') {
      const tables = listTables(db)
      const tbl = tables.find((t) => t.name === table)
      if (!tbl) {
        return NextResponse.json(
          { success: false, error: 'الجدول غير موجود' },
          { status: 404 }
        )
      }
      return NextResponse.json({ success: true, schema: tbl.schema })
    }

    const result = queryTable(db, table, {
      page,
      pageSize,
      filters,
      sortColumn,
      sortDirection,
    })

    // نجيب الـ schema كمان عشان الواجهة تعرف الأعمدة وأنواعها
    const tables = listTables(db)
    const tbl = tables.find((t) => t.name === table)

    return NextResponse.json({
      success: true,
      ...result,
      schema: tbl?.schema || [],
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// POST /api/admin/db/[db]/[table] — إدراج صف جديد
export async function POST(req: Request, { params }: Params) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    const { db, table } = await params
    const body = await req.json()
    const { values } = body as { values: Record<string, unknown> }

    if (!values || typeof values !== 'object') {
      return NextResponse.json(
        { success: false, error: 'مطلوب values' },
        { status: 400 }
      )
    }

    const result = insertRow(db, table, values)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
