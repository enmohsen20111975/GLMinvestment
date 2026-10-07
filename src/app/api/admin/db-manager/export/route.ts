import { NextRequest, NextResponse } from 'next/server';
import { exportTable } from '@/lib/admin-db-manager';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/db-manager/export?db=NAME&table=TBL&format=csv|json
 *
 * Returns the entire table (capped at 100k rows) as a downloadable CSV or JSON
 * file with the appropriate Content-Type and Content-Disposition headers.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const url = new URL(request.url);
    const db = url.searchParams.get('db');
    const table = url.searchParams.get('table');
    const format = (url.searchParams.get('format') || 'csv') as 'csv' | 'json';

    if (!db || !table) {
      return NextResponse.json(
        { success: false, error: 'db and table are required' },
        { status: 400 }
      );
    }
    if (format !== 'csv' && format !== 'json') {
      return NextResponse.json(
        { success: false, error: 'format must be "csv" or "json"' },
        { status: 400 }
      );
    }

    const result = exportTable(db, table, format);
    // Attach a BOM for Excel-friendly CSV in Arabic.
    const body = format === 'csv' ? `\uFEFF${result.content}` : result.content;

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': `${result.mimeType}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}
