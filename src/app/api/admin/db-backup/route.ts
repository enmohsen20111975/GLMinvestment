import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename } from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const execFileAsync = promisify(execFile);

const DB_DIR = join(process.cwd(), 'db');
const DATA_DIR = join(process.cwd(), 'data');
const DEFAULT_MAX_ZIP_MB = 60; // 60MB default per archive

// System PATH injection to prevent spawn ENOENT under PM2 / WSL
const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const EXEC_ENV = {
  ...process.env,
  PATH: `${SYSTEM_PATH}:${process.env.PATH || ''}`,
};

function resolveBinary(name: string, candidates: string[]): string {
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return name;
}

const ZIP_BIN = resolveBinary('zip', ['/usr/bin/zip', '/bin/zip']);
const SPLIT_BIN = resolveBinary('split', ['/usr/bin/split', '/bin/split']);
const GIT_BIN = resolveBinary('git', ['/usr/bin/git', '/bin/git']);
const PYTHON_BIN = resolveBinary('python3', ['/usr/bin/python3', '/bin/python3']);

// Core active databases that require caution when deleting
const CORE_DATABASES = new Set([
  'stocks.db',
  'auth.db',
  'price_history.db',
  'data_engine.db',
  'predictions.db',
  'market.db',
  'intraday.db',
]);

interface DbInfo {
  name: string;
  path: string;
  size_bytes: number;
  size_mb: string;
  modified: string | null;
  is_core: boolean;
}

interface BackupArchive {
  name: string;
  path: string;
  size_bytes: number;
  size_mb: string;
  created: string | null;
  is_part?: boolean;
}

/**
 * Walk the DB directory and collect every *.db file (ignoring -shm / -wal /
 * -journal sidecars).
 */
function listDbFiles(): DbInfo[] {
  if (!existsSync(DB_DIR)) return [];
  const out: DbInfo[] = [];
  for (const entry of readdirSync(DB_DIR)) {
    if (!entry.endsWith('.db')) continue;
    if (entry.endsWith('.db-shm') || entry.endsWith('.db-wal') ||
        entry.endsWith('.db-journal') || entry.endsWith('.db.bak') ||
        entry.endsWith('.db.original')) continue;
    const full = join(DB_DIR, entry);
    try {
      const st = statSync(full);
      if (!st.isFile()) continue;
      out.push({
        name: entry,
        path: full,
        size_bytes: st.size,
        size_mb: (st.size / 1024 / 1024).toFixed(2),
        modified: st.mtime.toISOString(),
        is_core: CORE_DATABASES.has(entry),
      });
    } catch {
      // ignore unreadable entries
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function listArchives(): BackupArchive[] {
  if (!existsSync(DATA_DIR)) return [];
  const out: BackupArchive[] = [];
  for (const entry of readdirSync(DATA_DIR)) {
    if (!entry.endsWith('.zip') && !entry.includes('.zip.part')) continue;
    const full = join(DATA_DIR, entry);
    try {
      const st = statSync(full);
      if (!st.isFile()) continue;
      out.push({
        name: entry,
        path: full,
        size_bytes: st.size,
        size_mb: (st.size / 1024 / 1024).toFixed(2),
        created: st.mtime.toISOString(),
        is_part: entry.includes('.zip.part'),
      });
    } catch {
      // ignore
    }
  }
  return out.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
}

/**
 * Group DB files into batches where each batch's total uncompressed size is
 * under maxBytes.
 */
function chunkDbs(dbs: DbInfo[], maxBytes: number): DbInfo[][] {
  const batches: DbInfo[][] = [];
  let current: DbInfo[] = [];
  let currentSize = 0;
  for (const db of dbs) {
    if (current.length > 0 && currentSize + db.size_bytes > maxBytes) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(db);
    currentSize += db.size_bytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Reliable zip creation with fallback to Python zipfile
 */
async function compressToZip(archivePath: string, filePaths: string[]): Promise<void> {
  try {
    // 1. Try system zip binary with explicit environment
    await execFileAsync(ZIP_BIN, ['-j', '-q', '-y', archivePath, ...filePaths], {
      env: EXEC_ENV,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 180_000,
    });
    if (existsSync(archivePath)) return;
  } catch (err) {
    // If system zip failed or ENOENT, try Python fallback
    const pyCode = `
import zipfile, os, sys
archive = sys.argv[1]
files = sys.argv[2:]
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for f in files:
        if os.path.exists(f):
            z.write(f, os.path.basename(f))
`;
    await execFileAsync(PYTHON_BIN, ['-c', pyCode, archivePath, ...filePaths], {
      env: EXEC_ENV,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 180_000,
    });
    if (!existsSync(archivePath)) {
      throw err;
    }
  }
}

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(GIT_BIN, args, { cwd, env: EXEC_ENV, maxBuffer: 20 * 1024 * 1024, timeout: 60_000 });
}

// ---------------------------------------------------------------------------
// GET /api/admin/db-backup
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const dbs = listDbFiles();
    const archives = listArchives();
    const totalBytes = dbs.reduce((s, d) => s + d.size_bytes, 0);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      db_dir: DB_DIR,
      data_dir: DATA_DIR,
      default_max_zip_mb: DEFAULT_MAX_ZIP_MB,
      databases: dbs,
      archives,
      summary: {
        total_dbs: dbs.length,
        total_size_bytes: totalBytes,
        total_size_mb: (totalBytes / 1024 / 1024).toFixed(2),
        total_archives: archives.length,
      },
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/db-backup
// ---------------------------------------------------------------------------

interface PostBody {
  upload_to_github?: boolean;
  prune_older_than_days?: number;
  selected_dbs?: string[];
  max_part_size_mb?: number;
}

interface BackupResult {
  archive_name: string;
  archive_path: string;
  size_bytes: number;
  size_mb: string;
  included_dbs: string[];
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const uploadToGithub = body.upload_to_github === true;
    const pruneOlderThanDays = Math.max(0, Number(body.prune_older_than_days) || 0);
    const maxPartSizeMb = Math.max(10, Math.min(95, Number(body.max_part_size_mb) || DEFAULT_MAX_ZIP_MB));
    const maxZipBytes = maxPartSizeMb * 1024 * 1024;

    // Ensure data dir exists
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

    let dbs = listDbFiles();
    if (dbs.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'لا توجد قواعد بيانات للنسخ الاحتياطي (مجلد db/ فارغ).',
      }, { status: 400 });
    }

    // Filter by selected_dbs if provided
    if (Array.isArray(body.selected_dbs) && body.selected_dbs.length > 0) {
      const selectedSet = new Set(body.selected_dbs);
      dbs = dbs.filter(d => selectedSet.has(d.name));
      if (dbs.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'لم يتم العثور على أي من قواعد البيانات المحددة في مجلد db/.',
        }, { status: 400 });
      }
    }

    // Optional pruning of old archives
    let prunedCount = 0;
    if (pruneOlderThanDays > 0) {
      const cutoff = Date.now() - pruneOlderThanDays * 24 * 60 * 60 * 1000;
      for (const arc of listArchives()) {
        if (!arc.created) continue;
        if (new Date(arc.created).getTime() < cutoff) {
          try { unlinkSync(arc.path); prunedCount++; } catch { /* ignore */ }
        }
      }
    }

    const batches = chunkDbs(dbs, maxZipBytes);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const createdArchives: BackupResult[] = [];
    const errors: string[] = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const suffix = batches.length > 1 ? `_part${i + 1}` : '';
      const archiveName = `db_backup_${stamp}${suffix}.zip`;
      const archivePath = join(DATA_DIR, archiveName);
      const dbNames = batch.map(b => b.name);
      const dbPaths = batch.map(b => b.path);

      try {
        await compressToZip(archivePath, dbPaths);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`فشل ضغط ${archiveName}: ${msg}`);
        continue;
      }

      let st;
      try { st = statSync(archivePath); } catch {
        errors.push(`الملف ${archiveName} لم يُنشأ`);
        continue;
      }

      // If compressed archive exceeds chosen maxPartSizeMb, split it into chunks
      if (st.size > maxZipBytes) {
        try {
          const chunkPrefix = archivePath.replace(/\.zip$/, '_split_');
          await execFileAsync(SPLIT_BIN, [
            '-b', `${maxZipBytes}`,
            '-d',
            '-a', '2',
            '--additional-suffix=.zip.part',
            archivePath,
            chunkPrefix,
          ], { env: EXEC_ENV, timeout: 120_000 });

          // Remove the oversized parent zip
          unlinkSync(archivePath);

          // Find generated part files
          const prefixBase = basename(chunkPrefix);
          const partFiles = readdirSync(DATA_DIR)
            .filter(f => f.startsWith(prefixBase) && f.endsWith('.zip.part'))
            .sort();

          for (const pFile of partFiles) {
            const pPath = join(DATA_DIR, pFile);
            const pSt = statSync(pPath);
            createdArchives.push({
              archive_name: pFile,
              archive_path: pPath,
              size_bytes: pSt.size,
              size_mb: (pSt.size / 1024 / 1024).toFixed(2),
              included_dbs: dbNames,
            });
          }
        } catch (splitErr) {
          const splitMsg = splitErr instanceof Error ? splitErr.message : String(splitErr);
          errors.push(`فشل تجزئة الأرشيف الكبير ${archiveName}: ${splitMsg}`);
        }
      } else {
        createdArchives.push({
          archive_name: archiveName,
          archive_path: archivePath,
          size_bytes: st.size,
          size_mb: (st.size / 1024 / 1024).toFixed(2),
          included_dbs: dbNames,
        });
      }
    }

    // Optional GitHub upload
    let gitResult: { committed: boolean; pushed: boolean; message: string } = {
      committed: false, pushed: false, message: 'لم يُطلب الرفع',
    };

    if (uploadToGithub && createdArchives.length > 0) {
      try {
        const cwd = process.cwd();
        const addArgs = ['-f', 'add', ...createdArchives.map(a => `data/${a.archive_name}`)];
        await runGit(addArgs, cwd);

        const commitMsg = `chore(backup): DB snapshot ${stamp} (${createdArchives.length} file${createdArchives.length > 1 ? 's' : ''})`;
        try {
          await runGit(['commit', '-m', commitMsg], cwd);
          gitResult.committed = true;
        } catch (e) {
          gitResult.message = `commit: ${e instanceof Error ? e.message.slice(0, 200) : 'no changes'}`;
        }

        try {
          await runGit(['push', 'origin', 'HEAD'], cwd);
          gitResult.pushed = true;
          gitResult.message = `تم رفع ${createdArchives.length} ملف أرشيف إلى GitHub بنجاح.`;
        } catch (e) {
          gitResult.message = `push failed: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}`;
        }
      } catch (e) {
        gitResult.message = `git error: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`;
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      stamp,
      max_part_size_mb: maxPartSizeMb,
      selected_count: dbs.length,
      archives: createdArchives,
      summary: {
        total_archives_created: createdArchives.length,
        total_db_files_backed_up: dbs.length,
        pruned_old_archives: prunedCount,
      },
      git: gitResult,
      errors,
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/db-backup
// ---------------------------------------------------------------------------

interface DeleteBody {
  target_type: 'database' | 'archive';
  file_names: string[];
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const body = (await req.json().catch(() => ({}))) as DeleteBody;
    const { target_type, file_names } = body;

    if (!target_type || !Array.isArray(file_names) || file_names.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'طلب غير صالح. يجب تحديد نوع الهدف وقائمة بأسماء الملفات المراد حذفها.',
      }, { status: 400 });
    }

    const baseDir = target_type === 'database' ? DB_DIR : DATA_DIR;
    const deletedFiles: string[] = [];
    let freedBytes = 0;
    const errors: string[] = [];

    for (const rawName of file_names) {
      const fileName = basename(rawName.trim());
      if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
        errors.push(`اسم ملف غير صالح: ${rawName}`);
        continue;
      }

      const filePath = join(baseDir, fileName);
      if (!existsSync(filePath)) {
        errors.push(`الملف غير موجود: ${fileName}`);
        continue;
      }

      try {
        const st = statSync(filePath);
        if (!st.isFile()) {
          errors.push(`المسار ليس ملفاً عادياً: ${fileName}`);
          continue;
        }

        freedBytes += st.size;
        unlinkSync(filePath);
        deletedFiles.push(fileName);

        // If deleting a SQLite database, also remove sidecar files (-shm, -wal, -journal)
        if (target_type === 'database' && fileName.endsWith('.db')) {
          const sidecars = [`${fileName}-shm`, `${fileName}-wal`, `${fileName}-journal`];
          for (const sc of sidecars) {
            const scPath = join(baseDir, sc);
            if (existsSync(scPath)) {
              try {
                const scSt = statSync(scPath);
                freedBytes += scSt.size;
                unlinkSync(scPath);
              } catch {
                // ignore sidecar cleanup errors
              }
            }
          }
        }
      } catch (err) {
        errors.push(`فشل حذف ${fileName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({
      success: true,
      target_type,
      deleted_count: deletedFiles.length,
      deleted_files: deletedFiles,
      freed_bytes: freedBytes,
      freed_mb: (freedBytes / 1024 / 1024).toFixed(2),
      errors,
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
  }
}
