import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { access, mkdir, readdir, stat, unlink } from 'fs/promises';
import { join, basename } from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const execFileAsync = promisify(execFile);
const DATA_DIR = join(process.cwd(), 'data');

const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const EXEC_ENV = {
  ...process.env,
  PATH: `${SYSTEM_PATH}:${process.env.PATH || ''}`,
};

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    await mkdir(DATA_DIR, { recursive: true });
    const files = await readdir(DATA_DIR);
    const codeBackups: any[] = [];

    for (const file of files) {
      if (file.startsWith('code_backup_') && file.endsWith('.zip')) {
        const filePath = join(DATA_DIR, file);
        const s = await stat(filePath);
        codeBackups.push({
          name: file,
          size_bytes: s.size,
          size_mb: (s.size / (1024 * 1024)).toFixed(2),
          created: s.mtime.toISOString(),
          download_url: `/api/admin/code-backup/download?file=${encodeURIComponent(file)}`,
        });
      }
    }

    codeBackups.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

    return NextResponse.json({
      success: true,
      backups: codeBackups,
      count: codeBackups.length,
    });
  } catch (e) {
    console.error('[code-backup:GET]', e);
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    await mkdir(DATA_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archiveName = `code_backup_${stamp}.zip`;
    const archivePath = join(DATA_DIR, archiveName);

    // قائمة الاستثناءات الصارمة لمنع ملفات التشغيل والـ GBs الزائدة (كود فقط)
    const excludePatterns = [
      'node_modules/*',
      '*/node_modules/*',
      '.next/*',
      '*/.next/*',
      'venv/*',
      '*/venv/*',
      '.venv/*',
      '*/.venv/*',
      'db/*',
      'logs/*',
      '*/logs/*',
      '.git/*',
      'data/*',
      '*.pyc',
      '*__pycache__*',
      '*.corrupt*',
      '*.bak*',
      'scratch/*',
      '.bun/*',
      '.cache/*',
      'voices/*',
      '*/voices/*',
      '*.onnx',
      '.kilo/*',
      '*/.kilo/*',
      '.qodo/*',
      '*/.qodo/*',
      '*.log',
      '*/agent.log',
      '*.db*',
      '*.sqlite*',
      'archive/*',
      'scripts/output/*',
      'vps-service/backtest_results/*',
      'news-agent/data/*',
      'news-agent/_disabled_dbs/*',
      'public/reports/*',
      '*.pdf',
    ];

    const zipArgs = ['-r', archivePath, '.', '-x', ...excludePatterns];

    await execFileAsync('/usr/bin/zip', zipArgs, {
      cwd: process.cwd(),
      env: EXEC_ENV,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120_000,
    });

    const s = await stat(archivePath);

    return NextResponse.json({
      success: true,
      archive_name: archiveName,
      size_mb: (s.size / (1024 * 1024)).toFixed(2),
      created: s.mtime.toISOString(),
      download_url: `/api/admin/code-backup/download?file=${encodeURIComponent(archiveName)}`,
      message: 'تم إنشاء نسخة احتياطية نظيفة للكود المصدري بنجاح بدون ملفات التشغيل والداتابيز.',
    });
  } catch (e) {
    console.error('[code-backup:POST]', e);
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const { fileName } = await req.json();
    if (!fileName || !fileName.startsWith('code_backup_') || !fileName.endsWith('.zip')) {
      return NextResponse.json({ success: false, error: 'اسم الملف غير صالح' }, { status: 400 });
    }
    const safeName = basename(fileName);
    const filePath = join(DATA_DIR, safeName);
    await unlink(filePath);
    return NextResponse.json({ success: true, message: 'تم حذف نسخة الكود بنجاح' });
  } catch (e) {
    console.error('[code-backup:DELETE]', e);
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
