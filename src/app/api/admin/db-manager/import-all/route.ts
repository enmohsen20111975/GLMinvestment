import { NextRequest, NextResponse } from 'next/server';
// P0-14-ASYNC fix (2026-09-27): replaced sync fs.writeFileSync with async
// fs/promises writeFile so the import-all POST handler never blocks the
// event loop while saving the uploaded ZIP file.
import { writeFile } from 'fs/promises';
import * as path from 'path';
import { importAllDbs } from '@/lib/admin-db-manager';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/db-manager/import-all
 *
 * Accepts multipart/form-data with a ZIP file.
 * 1. Saves the uploaded ZIP to db/ directory.
 * 2. Auto-backs up current databases.
 * 3. Validates each .db in the ZIP.
 * 4. Replaces databases in db/ with the extracted versions.
 *
 * Returns: { restored: string[], failed: string[], autoBackupZip: string }
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'يرجى اختيار ملف ZIP للتحميل' }, { status: 400 });
    }

    if (!file.name.endsWith('.zip')) {
      return NextResponse.json({ success: false, error: 'يجب أن يكون الملف بامتداد .zip' }, { status: 400 });
    }

    const DB_DIR = path.join(process.cwd(), 'db');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const destFileName = `_uploaded_${ts}_${file.name}`;
    const destPath = path.join(DB_DIR, destFileName);

    // Save uploaded file
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(destPath, buffer);

    // Import
    const result = importAllDbs(destFileName);

    return NextResponse.json({
      success: true,
      ...result,
      message:
        `تم استيراد ${result.restored.length} قواعد بيانات بنجاح` +
        (result.failed.length > 0
          ? ` — ${result.failed.length} قاعدة بيانات فشلت`
          : ''),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}