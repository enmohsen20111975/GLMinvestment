import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { readFile, stat } from 'fs/promises';
import { join, basename } from 'path';

export const dynamic = 'force-dynamic';

const DATA_DIR = join(process.cwd(), 'data');

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const fileName = url.searchParams.get('file');

  if (!fileName || !fileName.startsWith('code_backup_') || !fileName.endsWith('.zip')) {
    return NextResponse.json({ error: 'invalid_filename' }, { status: 400 });
  }

  const safeName = basename(fileName);
  const filePath = join(DATA_DIR, safeName);

  try {
    const s = await stat(filePath);
    const fileBuffer = await readFile(filePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Content-Length': s.size.toString(),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: 'file_not_found' }, { status: 404 });
  }
}
