import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { exportAllDbs } from '@/lib/admin-db-manager';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/db-manager/export-all
 * Creates a ZIP of all databases after WAL checkpoint.
 * Returns the ZIP filename for download.
 *
 * GET /api/admin/db-manager/export-all?file=NAME.zip
 * Streams the ZIP file for download.
 */
export async function POST(request: Request) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const result = exportAllDbs();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const url = new URL(request.url);
    const fileName = url.searchParams.get('file');

    if (!fileName) {
      return NextResponse.json({ success: false, error: 'file parameter is required' }, { status: 400 });
    }

    if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      return NextResponse.json({ success: false, error: 'Invalid file name' }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), 'db', fileName);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath);

    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': String(stat.size),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}