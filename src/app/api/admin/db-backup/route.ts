import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { execFile } from 'child_process';
import { promisify } from 'util';
// ALPHA-LIVE-CONSOLE: job tracking for live log streaming
import {
  createJob, appendLog, updatePhase, addWarning, addError,
  addArchiveCreated, addArchivePushed, finishJob, generateJobId,
} from '@/lib/db-backup-jobs';
// P0-14-ASYNC fix (2026-09-27): replaced sync existsSync/mkdirSync/readdirSync/
// statSync/unlinkSync with async fs/promises equivalents so the GET/POST/DELETE
// handlers never block the event loop on DB / archive enumeration, prune, or
// delete operations.
import { access, mkdir, readdir, stat, unlink } from 'fs/promises';
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

// P0-14-ASYNC fix (2026-09-27): async helper to check file existence.
async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

function resolveBinary(name: string, candidates: string[]): string {
  // Module-load time check — OK to be sync (runs once, not per request).
  // Using existsSync keeps startup fast; path is only consulted at boot.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs');
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
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
// P0-14-ASYNC fix (2026-09-27): listDbFiles is now async.
async function listDbFiles(): Promise<DbInfo[]> {
  if (!(await pathExists(DB_DIR))) return [];
  const out: DbInfo[] = [];
  let entries: string[];
  try {
    entries = await readdir(DB_DIR);
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.endsWith('.db')) continue;
    if (entry.endsWith('.db-shm') || entry.endsWith('.db-wal') ||
        entry.endsWith('.db-journal') || entry.endsWith('.db.bak') ||
        entry.endsWith('.db.original')) continue;
    const full = join(DB_DIR, entry);
    try {
      const st = await stat(full);
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

// P0-14-ASYNC fix (2026-09-27): listArchives is now async.
async function listArchives(): Promise<BackupArchive[]> {
  if (!(await pathExists(DATA_DIR))) return [];
  const out: BackupArchive[] = [];
  let entries: string[];
  try {
    entries = await readdir(DATA_DIR);
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.endsWith('.zip') && !entry.includes('.zip.part')) continue;
    const full = join(DATA_DIR, entry);
    try {
      const st = await stat(full);
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
    if (await pathExists(archivePath)) return;
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
    if (!(await pathExists(archivePath))) {
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
    const dbs = await listDbFiles();
    const archives = await listArchives();
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
    console.error('[admin:db-backup]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
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
  // NEW (Task PUSH-STRATEGY-2026-10-06): خيارات الرفع الذكية
  // حدد ملفات أرشيف محددة للرفع (بدل رفع كل اللي اتضغطوا) — لو فاضي، يرفع الكل
  selected_archives?: string[];
  // استراتيجية التعامل مع تعارض الـ remote
  push_strategy?: 'fetch_rebase' | 'fetch_merge' | 'force_push' | 'no_pull';
  // لو true، بيعمل push فقط بدون rebase/merge (في حالات الـ conflict المستمر)
  force_no_rebase?: boolean;
  // لو true، بيمسح الأرشيفات القديمة من GitHub قبل الرفع (دعم DELETE من GitHub)
  delete_remote_archives_before_push?: string[];
  // لو true، بيعمل rollback للـ commit الأخير قبل الـ push
  rollback_last_commit?: boolean;
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

    // ALPHA-LIVE-CONSOLE: إنشاء job_id فوراً وبدء الشغل في الـ background
    const jobId = generateJobId();
    createJob(jobId);
    await appendLog(jobId, `[init] بدء عملية النسخ الاحتياطي (job_id=${jobId})`);
    await appendLog(jobId, `[init] upload_to_github=${body.upload_to_github === true}, max_part_size_mb=${body.max_part_size_mb || DEFAULT_MAX_ZIP_MB}`);
    if (body.selected_dbs?.length) {
      await appendLog(jobId, `[init] قواعد محددة: ${body.selected_dbs.join(', ')}`);
    }
    updatePhase(jobId, 'init', 5);

    // بدء الشغل كـ fire-and-forget promise (بدون await)
    runBackupJob(jobId, body).catch(err => {
      console.error(`[admin:db-backup] job ${jobId} crashed:`, err);
      addError(jobId, `Job crashed: ${err instanceof Error ? err.message : String(err)}`);
      finishJob(jobId, 1, { error: 'job crashed' });
    });

    return NextResponse.json({
      success: true,
      job_id: jobId,
      status: 'running',
      message: 'بدأت العملية في الخلفية — افتح الكونسول الحي لمتابعة التقدّم',
      logs_url: `/api/admin/db-backup/logs?job=${jobId}`,
      status_url: `/api/admin/db-backup/status?job=${jobId}`,
    });
  } catch (e) {
    console.error('[admin:db-backup]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// runBackupJob — الشغل الفعلي (fire-and-forget)
// ---------------------------------------------------------------------------

async function runBackupJob(jobId: string, body: PostBody) {
  const uploadToGithub = body.upload_to_github === true;
  const pruneOlderThanDays = Math.max(0, Number(body.prune_older_than_days) || 0);
  const maxPartSizeMb = Math.max(10, Math.min(95, Number(body.max_part_size_mb) || DEFAULT_MAX_ZIP_MB));
  const maxZipBytes = maxPartSizeMb * 1024 * 1024;

  // Ensure data dir exists
  if (!(await pathExists(DATA_DIR))) await mkdir(DATA_DIR, { recursive: true });

  let dbs = await listDbFiles();
    if (dbs.length === 0) {
      await appendLog(jobId, `[error] لا توجد قواعد بيانات للنسخ الاحتياطي (مجلد db/ فارغ)`);
      addError(jobId, 'لا توجد قواعد بيانات للنسخ الاحتياطي (مجلد db/ فارغ).');
      finishJob(jobId, 1, { error: 'no databases found' });
      return;
    }

    // Filter by selected_dbs if provided
    if (Array.isArray(body.selected_dbs) && body.selected_dbs.length > 0) {
      const selectedSet = new Set(body.selected_dbs);
      dbs = dbs.filter(d => selectedSet.has(d.name));
      if (dbs.length === 0) {
        await appendLog(jobId, `[error] لم يتم العثور على أي من قواعد البيانات المحددة`);
        addError(jobId, 'لم يتم العثور على أي من قواعد البيانات المحددة في مجلد db/.');
        finishJob(jobId, 1, { error: 'selected databases not found' });
        return;
      }
    }

    await appendLog(jobId, `[init] تم العثور على ${dbs.length} قاعدة بيانات`);

    // Optional pruning of old archives
    let prunedCount = 0;
    if (pruneOlderThanDays > 0) {
      const cutoff = Date.now() - pruneOlderThanDays * 24 * 60 * 60 * 1000;
      const archives = await listArchives();
      for (const arc of archives) {
        if (!arc.created) continue;
        if (new Date(arc.created).getTime() < cutoff) {
          try { await unlink(arc.path); prunedCount++; } catch { /* ignore */ }
        }
      }
      if (prunedCount > 0) {
        await appendLog(jobId, `[prune] تم مسح ${prunedCount} أرشيف قديم (أقدم من ${pruneOlderThanDays} يوم)`);
      }
    }

    const batches = chunkDbs(dbs, maxZipBytes);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const createdArchives: BackupResult[] = [];
    const errors: string[] = [];

    await appendLog(jobId, `[compress] تم تقسيم ${dbs.length} قاعدة إلى ${batches.length} دفعة (max ${maxPartSizeMb}MB لكل أرشيف)`);
    updatePhase(jobId, 'compress', 10);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const suffix = batches.length > 1 ? `_part${i + 1}` : '';
      const archiveName = `db_backup_${stamp}${suffix}.zip`;
      const archivePath = join(DATA_DIR, archiveName);
      const dbNames = batch.map(b => b.name);
      const dbPaths = batch.map(b => b.path);

      const batchPct = 10 + Math.round((i / batches.length) * 40);
      updatePhase(jobId, 'compress', batchPct);
      await appendLog(jobId, `[compress] دفعة ${i + 1}/${batches.length}: ${dbNames.join(', ')} → ${archiveName}`);

      try {
        await compressToZip(archivePath, dbPaths);
        await appendLog(jobId, `[compress] ✅ تم ضغط ${archiveName} (${dbNames.length} قاعدة)`);
        addArchiveCreated(jobId, archiveName);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`فشل ضغط ${archiveName}: ${msg}`);
        continue;
      }

      let st;
      try { st = await stat(archivePath); } catch {
        errors.push(`الملف ${archiveName} لم يُنشأ`);
        continue;
      }

      // If compressed archive exceeds chosen maxPartSizeMb, split it into chunks
      if (st.size > maxZipBytes) {
        updatePhase(jobId, 'split', batchPct + 5);
        await appendLog(jobId, `[split] ${archiveName} حجمه ${(st.size / 1024 / 1024).toFixed(2)}MB > ${maxPartSizeMb}MB — جاري التجزئة...`);
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
          await unlink(archivePath);

          // Find generated part files
          const prefixBase = basename(chunkPrefix);
          const allEntries = await readdir(DATA_DIR);
          const partFiles = allEntries
            .filter(f => f.startsWith(prefixBase) && f.endsWith('.zip.part'))
            .sort();

          for (const pFile of partFiles) {
            const pPath = join(DATA_DIR, pFile);
            const pSt = await stat(pPath);
            createdArchives.push({
              archive_name: pFile,
              archive_path: pPath,
              size_bytes: pSt.size,
              size_mb: (pSt.size / 1024 / 1024).toFixed(2),
              included_dbs: dbNames,
            });
            addArchiveCreated(jobId, pFile);
            await appendLog(jobId, `[split] ✅ تم إنشاء جزء: ${pFile} (${(pSt.size / 1024 / 1024).toFixed(2)}MB)`);
          }
        } catch (splitErr) {
          const splitMsg = splitErr instanceof Error ? splitErr.message : String(splitErr);
          errors.push(`فشل تجزئة الأرشيف الكبير ${archiveName}: ${splitMsg}`);
          addError(jobId, `فشل تجزئة ${archiveName}: ${splitMsg.slice(0, 150)}`);
          await appendLog(jobId, `[split] ❌ فشل تجزئة ${archiveName}: ${splitMsg.slice(0, 100)}`);
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

    // Optional GitHub upload — خيارات متعددة للرفع (Task PUSH-STRATEGY-2026-10-06)
    let gitResult: {
      committed: boolean;
      pushed: boolean;
      message: string;
      push_strategy?: string;
      archived_to_push?: string[];
      remote_archives_deleted?: string[];
      rollback_performed?: boolean;
      ahead_behind?: { ahead: number; behind: number };
      warnings?: string[];
    } = {
      committed: false,
      pushed: false,
      message: 'لم يُطلب الرفع',
      warnings: [],
    };

    if (uploadToGithub && createdArchives.length > 0) {
      try {
        const cwd = process.cwd();

        // 1) اختيار الملفات اللي هتترفع (selection support)
        let archivesToPush = createdArchives;
        if (Array.isArray(body.selected_archives) && body.selected_archives.length > 0) {
          const selectedSet = new Set(body.selected_archives);
          archivesToPush = createdArchives.filter(a => selectedSet.has(a.archive_name));
          if (archivesToPush.length === 0) {
            gitResult.message = `لم يتم اختيار أي أرشيف صالح للرفع. المتاح: ${createdArchives.map(a => a.archive_name).join(', ')}`;
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
          }
          gitResult.archived_to_push = archivesToPush.map(a => a.archive_name);
        }

        // 2) rollback الـ commit الأخير لو طُلب (قبل ما نعمل أي حاجة)
        if (body.rollback_last_commit === true) {
          try {
            await runGit(['reset', '--soft', 'HEAD~1'], cwd);
            gitResult.rollback_performed = true;
            gitResult.warnings?.push('⚠️ تم التراجع عن آخر commit محلي (soft reset) — التغييرات لسه في الـ staging area');
          } catch (e) {
            gitResult.warnings?.push(`rollback failed: ${e instanceof Error ? e.message.slice(0, 150) : 'unknown'}`);
          }
        }

        // 3) مسح أرشيفات قديمة من GitHub لو طُلب
        if (Array.isArray(body.delete_remote_archives_before_push) && body.delete_remote_archives_before_push.length > 0) {
          const deletedRemote: string[] = [];
          for (const remoteFile of body.delete_remote_archives_before_push) {
            const safeName = basename(remoteFile.trim());
            if (!safeName || safeName.includes('..')) continue;
            try {
              // نحذف من git index بس (مش من القرص) ثم نعمل commit
              await runGit(['rm', '--cached', `data/${safeName}`], cwd);
              deletedRemote.push(safeName);
            } catch (e) {
              gitResult.warnings?.push(`delete_remote ${safeName}: ${e instanceof Error ? e.message.slice(0, 100) : 'failed'}`);
            }
          }
          gitResult.remote_archives_deleted = deletedRemote;
          if (deletedRemote.length > 0) {
            try {
              await runGit(['commit', '-m', `chore(backup): remove old archives ${stamp} (${deletedRemote.length} files)`], cwd);
            } catch (e) {
              gitResult.warnings?.push(`commit delete: ${e instanceof Error ? e.message.slice(0, 100) : 'failed'}`);
            }
          }
        }

        // 4) git add للأرشيفات المختارة
        const addArgs = ['add', '-f', ...archivesToPush.map(a => `data/${a.archive_name}`)];
        updatePhase(jobId, 'commit', 60);
        await appendLog(jobId, `[commit] git add ${archivesToPush.length} ملف أرشيف`);
        await runGit(addArgs, cwd);

        // 5) commit
        const commitMsg = `chore(backup): DB snapshot ${stamp} (${archivesToPush.length} file${archivesToPush.length > 1 ? 's' : ''})`;
        try {
          await runGit(['commit', '-m', commitMsg], cwd);
          gitResult.committed = true;
          await appendLog(jobId, `[commit] ✅ تم commit: ${commitMsg}`);
        } catch (e) {
          gitResult.message = `commit: ${e instanceof Error ? e.message.slice(0, 200) : 'no changes'}`;
          await appendLog(jobId, `[commit] ⚠️ ${gitResult.message}`);
        }

        // 6) استراتيجية الرفع (push strategy)
        const strategy = body.push_strategy || (body.force_no_rebase ? 'no_pull' : 'fetch_rebase');
        gitResult.push_strategy = strategy;
        await appendLog(jobId, `[fetch] استراتيجية الرفع: ${strategy}`);

        // نفحص ahead/behind الأول (لو الـ fetch يشتغل)
        updatePhase(jobId, 'fetch', 70);
        try {
          await runGit(['fetch', 'origin'], cwd);
          await appendLog(jobId, `[fetch] ✅ تم fetch من origin`);
          const { stdout: abStdout } = await runGit(
            ['rev-list', '--left-right', '--count', 'HEAD...origin/HEAD'],
            cwd
          ).catch(() => ({ stdout: '0\t0', stderr: '' }));
          const [ahead, behind] = abStdout.trim().split(/\s+/).map(n => parseInt(n, 10) || 0);
          gitResult.ahead_behind = { ahead, behind };
          await appendLog(jobId, `[fetch] ahead=${ahead}, behind=${behind}`);
        } catch (e) {
          gitResult.warnings?.push(`fetch failed (network?): ${e instanceof Error ? e.message.slice(0, 100) : 'unknown'}`);
        }

        try {
          if (strategy === 'force_push') {
            // ⚠️ Force push — خطير لكنه الحل الأخير
            await appendLog(jobId, `[push] ⚠️ جاري force push (${archivesToPush.length} ملف) — قد يمسح تعديلات الـ remote`);
            await runGit(['push', '--force', 'origin', 'HEAD'], cwd);
            gitResult.pushed = true;
            gitResult.message = `تم الرفع بالـ force push (${archivesToPush.length} ملف). ⚠️ أي تعديلات على الـ remote اتمسحت.`;
            gitResult.warnings?.push('⚠️ تم استخدام --force — تأكد إن مفيش حد بيرفع على نفس الـ branch');
            await appendLog(jobId, `[push] ✅ تم force push بنجاح`);
            addWarning(jobId, '⚠️ تم استخدام --force — تأكد إن مفيش حد بيرفع على نفس الـ branch');
          } else if (strategy === 'no_pull') {
            // رفع مباشر بدون أي محاولة لمزامنة (لو الـ fetch فشل)
            await appendLog(jobId, `[push] جاري رفع مباشر بدون مزامنة (${archivesToPush.length} ملف)`);
            await runGit(['push', 'origin', 'HEAD'], cwd);
            gitResult.pushed = true;
            gitResult.message = `تم الرفع بدون مزامنة (${archivesToPush.length} ملف).`;
            await appendLog(jobId, `[push] ✅ تم الرفع بنجاح`);
          } else if (strategy === 'fetch_merge') {
            // fetch + merge (بدل rebase — بيحافظ على التاريخ)
            await appendLog(jobId, `[merge] جاري merge مع origin/HEAD`);
            try {
              await runGit(['merge', 'origin/HEAD', '--no-edit'], cwd);
              await appendLog(jobId, `[merge] ✅ تم merge بنجاح`);
            } catch (mergeErr) {
              // abort merge لو فيه conflict
              await runGit(['merge', '--abort'], cwd).catch(() => {});
              const errMsg = `merge conflict — حل يدوي مطلوب: ${mergeErr instanceof Error ? mergeErr.message.slice(0, 150) : 'unknown'}`;
              addError(jobId, errMsg);
              await appendLog(jobId, `[merge] ❌ ${errMsg}`);
              throw new Error(errMsg);
            }
            await appendLog(jobId, `[push] جاري الرفع بعد merge (${archivesToPush.length} ملف)`);
            await runGit(['push', 'origin', 'HEAD'], cwd);
            gitResult.pushed = true;
            gitResult.message = `تم الرفع بعد merge (${archivesToPush.length} ملف).`;
            await appendLog(jobId, `[push] ✅ تم الرفع بنجاح`);
          } else {
            // default: fetch_rebase
            try {
              const behind = gitResult.ahead_behind?.behind || 0;
              if (behind > 0) {
                await appendLog(jobId, `[rebase] جاري rebase مع origin/HEAD (${behind} commits خلف)`);
                await runGit(['rebase', 'origin/HEAD'], cwd);
                gitResult.warnings?.push(`✅ تم rebase بنجاح (${behind} commits من الـ remote)`);
                await appendLog(jobId, `[rebase] ✅ تم rebase بنجاح (${behind} commits)`);
              }
            } catch (rebaseErr) {
              // abort rebase لو فيه conflict
              await runGit(['rebase', '--abort'], cwd).catch(() => {});
              const errMsg = `rebase conflict — حل يدوي مطلوب: ${rebaseErr instanceof Error ? rebaseErr.message.slice(0, 150) : 'unknown'}`;
              addError(jobId, errMsg);
              await appendLog(jobId, `[rebase] ❌ ${errMsg}`);
              throw new Error(errMsg);
            }
            await appendLog(jobId, `[push] جاري الرفع بعد rebase (${archivesToPush.length} ملف)`);
            await runGit(['push', 'origin', 'HEAD'], cwd);
            gitResult.pushed = true;
            gitResult.message = `تم رفع ${archivesToPush.length} ملف أرشيف إلى GitHub بنجاح (rebase strategy).`;
            await appendLog(jobId, `[push] ✅ تم الرفع بنجاح`);
          }
          // سجّل كل archive اترفع
          if (gitResult.pushed) {
            for (const arch of archivesToPush) {
              addArchivePushed(jobId, arch.archive_name);
            }
          }
        } catch (e) {
          const errMsg = `push failed: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}`;
          gitResult.message = errMsg;
          addError(jobId, errMsg);
          await appendLog(jobId, `[push] ❌ ${errMsg}`);
        }
      } catch (e) {
        const errMsg = `git error: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`;
        gitResult.message = errMsg;
        addError(jobId, errMsg);
        await appendLog(jobId, `[git] ❌ ${errMsg}`);
      }
    }

    // ALPHA-LIVE-CONSOLE: إنهاء الـ job بتسجيل النتيجة النهائية
    const finalResult = {
      success: errors.length === 0,
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
    };

    if (errors.length > 0) {
      for (const e of errors) {
        addError(jobId, e);
        await appendLog(jobId, `[error] ${e}`);
      }
    }

    const exitCode = errors.length === 0 && (!gitResult || gitResult.pushed !== false) ? 0 : 1;
    await appendLog(jobId, `[done] ✅ اكتملت العملية — ${createdArchives.length} أرشيف، ${errors.length} خطأ، ${gitResult?.pushed ? 'تم الرفع' : 'لم يُرفع'}`);
    finishJob(jobId, exitCode, finalResult);
  } catch (e) {
    console.error(`[admin:db-backup] job ${jobId} failed:`, e);
    const errMsg = e instanceof Error ? e.message : String(e);
    addError(jobId, errMsg);
    await appendLog(jobId, `[error] ❌ ${errMsg}`);
    finishJob(jobId, 1, { error: errMsg });
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
      if (!(await pathExists(filePath))) {
        errors.push(`الملف غير موجود: ${fileName}`);
        continue;
      }

      try {
        const st = await stat(filePath);
        if (!st.isFile()) {
          errors.push(`المسار ليس ملفاً عادياً: ${fileName}`);
          continue;
        }

        freedBytes += st.size;
        await unlink(filePath);
        deletedFiles.push(fileName);

        // If deleting a SQLite database, also remove sidecar files (-shm, -wal, -journal)
        if (target_type === 'database' && fileName.endsWith('.db')) {
          const sidecars = [`${fileName}-shm`, `${fileName}-wal`, `${fileName}-journal`];
          for (const sc of sidecars) {
            const scPath = join(baseDir, sc);
            if (await pathExists(scPath)) {
              try {
                const scSt = await stat(scPath);
                freedBytes += scSt.size;
                await unlink(scPath);
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
    console.error('[admin:db-backup]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/db-backup — عمليات الطوارئ (abort / rollback / list-remote)
// Task PUSH-STRATEGY-2026-10-06
// ---------------------------------------------------------------------------

interface PatchBody {
  action: 'abort' | 'rollback' | 'list_remote' | 'status';
}

export async function PATCH(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const body = (await req.json().catch(() => ({}))) as PatchBody;
    const action = body.action;
    const cwd = process.cwd();

    if (action === 'abort') {
      // الإيقاف الاجباري — abort أي rebase/merge في progress
      const results: string[] = [];
      try {
        await runGit(['rebase', '--abort'], cwd);
        results.push('✅ rebase aborted');
      } catch (e) {
        results.push(`rebase abort: ${e instanceof Error ? e.message.slice(0, 100) : 'no rebase in progress'}`);
      }
      try {
        await runGit(['merge', '--abort'], cwd);
        results.push('✅ merge aborted');
      } catch (e) {
        results.push(`merge abort: ${e instanceof Error ? e.message.slice(0, 100) : 'no merge in progress'}`);
      }
      return NextResponse.json({
        success: true,
        action,
        results,
        message: 'تم الإيقاف الاجباري. لو فيه rebase/merge في progress، تم إلغاؤه. الحالة الحالية = HEAD قبل العملية.',
      });
    }

    if (action === 'rollback') {
      // rollback آخر commit (soft reset — التغييرات ترجع للـ staging)
      const results: string[] = [];
      try {
        // نفحص الأول لو فيه unpushed commit
        const { stdout: logStdout } = await runGit(['log', '@{u}..HEAD', '--oneline'], cwd).catch(() => ({ stdout: '', stderr: '' }));
        const unpushedCount = logStdout.trim().split('\n').filter(Boolean).length;
        if (unpushedCount === 0) {
          results.push('ℹ️ مفيش unpushed commits للتراجع عنها');
        } else {
          await runGit(['reset', '--soft', 'HEAD~1'], cwd);
          results.push(`✅ تم التراجع عن آخر commit (soft reset) — التغييرات في staging area`);
          results.push(`📝 للتراجع عن التغييرات نهائياً: git reset --hard HEAD~1`);
          results.push(`📝 لإعادة الـ commit: git commit -m "..."`);
        }
      } catch (e) {
        results.push(`rollback failed: ${e instanceof Error ? e.message.slice(0, 150) : 'unknown'}`);
      }
      return NextResponse.json({
        success: true,
        action,
        results,
      });
    }

    if (action === 'list_remote') {
      // جلب قائمة الأرشيفات الموجودة على GitHub (في data/ directory)
      const results: { name: string; commit: string; date: string }[] = [];
      try {
        await runGit(['fetch', 'origin'], cwd);
        // نفحص آخر 50 commit فيها تعديلات على data/
        const { stdout } = await runGit(
          ['log', 'origin/HEAD', '--oneline', '-n', '50', '--name-only', '--pretty=format:COMMIT:%H|%ad|%s', '--date=short', '--', 'data/'],
          cwd
        );
        const lines = stdout.split('\n');
        for (const line of lines) {
          if (line.startsWith('COMMIT:')) {
            const [, hash, date, msg] = line.match(/^COMMIT:([^|]+)\|([^|]+)\|(.*)$/) || [];
            if (hash) results.push({ name: msg, commit: hash.slice(0, 8), date });
          } else if (line.trim().startsWith('data/') && line.endsWith('.zip')) {
            // الأرشيف الفعلي
          }
        }
      } catch (e) {
        return NextResponse.json({
          success: false,
          error: `fetch failed: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}`,
        }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        action,
        commits: results,
        count: results.length,
      });
    }

    if (action === 'status') {
      // حالة الـ git الحالية
      let status: {
        ahead: number;
        behind: number;
        current_branch: string;
        last_commit: string;
        unpushed_commits: string[];
        rebase_in_progress: boolean;
        merge_in_progress: boolean;
      };
      try {
        const { stdout: branchStdout } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
        const current_branch = branchStdout.trim();

        const { stdout: lastStdout } = await runGit(['log', '-1', '--pretty=format:%H|%ad|%s', '--date=short'], cwd);
        const last_commit = lastStdout.trim();

        let ahead = 0, behind = 0;
        try {
          await runGit(['fetch', 'origin'], cwd);
          const { stdout: abStdout } = await runGit(
            ['rev-list', '--left-right', '--count', 'HEAD...origin/HEAD'],
            cwd
          );
          [ahead, behind] = abStdout.trim().split(/\s+/).map(n => parseInt(n, 10) || 0);
        } catch { /* network */ }

        const unpushed_commits: string[] = [];
        if (ahead > 0) {
          try {
            const { stdout: logStdout } = await runGit(['log', '@{u}..HEAD', '--oneline'], cwd);
            unpushed_commits.push(...logStdout.trim().split('\n').filter(Boolean));
          } catch { /* */ }
        }

        // check rebase/merge in progress
        const rebase_in_progress = await pathExists(`${cwd}/.git/rebase-merge`) || await pathExists(`${cwd}/.git/rebase-apply`);
        const merge_in_progress = await pathExists(`${cwd}/.git/MERGE_HEAD`);

        status = {
          ahead,
          behind,
          current_branch,
          last_commit,
          unpushed_commits,
          rebase_in_progress,
          merge_in_progress,
        };
      } catch (e) {
        return NextResponse.json({
          success: false,
          error: `git status failed: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}`,
        }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        action,
        status,
      });
    }

    return NextResponse.json({
      success: false,
      error: `unknown action: ${action}. Valid: abort | rollback | list_remote | status`,
    }, { status: 400 });
  } catch (e) {
    console.error('[admin:db-backup PATCH]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}
