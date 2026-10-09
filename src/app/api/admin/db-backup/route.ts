import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { execFile } from 'child_process';
import { promisify } from 'util';
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
  if (await pathExists(archivePath)) {
    await unlink(archivePath).catch(() => {});
  }
  try {
    // 1. Try system zip binary with explicit environment
    await execFileAsync(ZIP_BIN, ['-j', '-q', '-y', archivePath, ...filePaths], {
      env: EXEC_ENV,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 180_000,
    });
    if (await pathExists(archivePath)) return;
  } catch (err: any) {
    // Info-ZIP exit code 18 = "file altered while being read" (common with active SQLite DBs)
    if (err?.code === 18 && (await pathExists(archivePath))) {
      try {
        const st = await stat(archivePath);
        if (st.size > 0) return;
      } catch {}
    }
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

async function runGit(args: string[], cwd: string, timeoutMs = 300_000): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(GIT_BIN, args, { cwd, env: EXEC_ENV, maxBuffer: 50 * 1024 * 1024, timeout: timeoutMs });
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
  // رفع الأرشيفات الموجودة فقط دون ضغط جديد
  only_upload_existing?: boolean;
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
    const uploadToGithub = body.upload_to_github === true;
    const onlyUploadExisting = body.only_upload_existing === true;
    const pruneOlderThanDays = Math.max(0, Number(body.prune_older_than_days) || 0);
    const maxPartSizeMb = Math.max(10, Math.min(95, Number(body.max_part_size_mb) || DEFAULT_MAX_ZIP_MB));
    const maxZipBytes = maxPartSizeMb * 1024 * 1024;

    // Ensure data dir exists
    if (!(await pathExists(DATA_DIR))) await mkdir(DATA_DIR, { recursive: true });

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
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const createdArchives: BackupResult[] = [];
    const errors: string[] = [];
    let dbs: DbInfo[] = [];

    // إذا طُلب رفع الأرشيفات الموجودة فقط دون ضغط جديد
    if (onlyUploadExisting) {
      const existingArchives = await listArchives();
      if (existingArchives.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'لا توجد أي ملفات أرشيف في مجلد data/ لرفعها.',
        }, { status: 400 });
      }

      let toPush = existingArchives;
      if (Array.isArray(body.selected_archives) && body.selected_archives.length > 0) {
        const set = new Set(body.selected_archives);
        toPush = existingArchives.filter(a => set.has(a.name));
      }

      if (toPush.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'لم يتم اختيار أي أرشيف صالح للرفع.',
        }, { status: 400 });
      }

      for (const a of toPush) {
        createdArchives.push({
          archive_name: a.name,
          archive_path: a.path,
          size_bytes: a.size_bytes,
          size_mb: a.size_mb,
          included_dbs: ['existing'],
        });
      }
    } else {
      dbs = await listDbFiles();
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

      const batches = chunkDbs(dbs, maxZipBytes);

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
        try { st = await stat(archivePath); } catch {
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
        await runGit(addArgs, cwd);

        // 5) commit
        const commitMsg = `chore(backup): DB snapshot ${stamp} (${archivesToPush.length} file${archivesToPush.length > 1 ? 's' : ''})`;
        try {
          await runGit(['commit', '-m', commitMsg], cwd);
          gitResult.committed = true;
        } catch (e) {
          gitResult.message = `commit: ${e instanceof Error ? e.message.slice(0, 200) : 'no changes'}`;
        }

        // 6) استراتيجية الرفع (push strategy)
        let currentBranch = 'main';
        try {
          const { stdout: bOut } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, 15_000);
          currentBranch = bOut.trim() || 'main';
        } catch {}

        // فحص حد أمان أقصى حجم لملفات GitHub (100MB)
        for (const arc of archivesToPush) {
          const arcMb = arc.size_bytes / 1024 / 1024;
          if (arcMb >= 98.0) {
            gitResult.message = `⚠️ الملف ${arc.archive_name} بحجم ${arcMb.toFixed(1)} MB يتجاوز حد أمان GitHub (100 MB). تم إلغاء الرفع لتفادي رفض المستودع.`;
            return NextResponse.json({
              success: false,
              error: gitResult.message,
              git: gitResult,
            }, { status: 400 });
          }
        }

        const strategy = body.push_strategy || (body.force_no_rebase ? 'no_pull' : 'fetch_merge');
        gitResult.push_strategy = strategy;

        // نفحص ahead/behind الأول (لو الـ fetch يشتغل)
        try {
          await runGit(['fetch', 'origin', currentBranch], cwd, 120_000);
          const { stdout: abStdout } = await runGit(
            ['rev-list', '--left-right', '--count', `HEAD...origin/${currentBranch}`],
            cwd,
            20_000
          ).catch(() => ({ stdout: '0\t0', stderr: '' }));
          const [ahead, behind] = abStdout.trim().split(/\s+/).map(n => parseInt(n, 10) || 0);
          gitResult.ahead_behind = { ahead, behind };
        } catch (e) {
          gitResult.warnings?.push(`fetch failed: ${e instanceof Error ? e.message.slice(0, 100) : 'unknown'}`);
        }

        try {
          if (strategy === 'force_push') {
            await runGit(['push', '--force', 'origin', `HEAD:${currentBranch}`], cwd, 300_000);
            gitResult.pushed = true;
            gitResult.message = `تم الرفع بالـ force push (${archivesToPush.length} ملف). ⚠️ أي تعديلات على الـ remote اتمسحت.`;
            gitResult.warnings?.push('⚠️ تم استخدام --force — تأكد إن مفيش حد بيرفع على نفس الـ branch');
          } else if (strategy === 'no_pull') {
            await runGit(['push', 'origin', `HEAD:${currentBranch}`], cwd, 300_000);
            gitResult.pushed = true;
            gitResult.message = `تم الرفع بدون مزامنة (${archivesToPush.length} ملف).`;
          } else if (strategy === 'fetch_rebase') {
            try {
              const behind = gitResult.ahead_behind?.behind || 0;
              if (behind > 0) {
                await runGit(['rebase', '--rebase-merges', `origin/${currentBranch}`], cwd, 60_000);
                gitResult.warnings?.push(`✅ تم rebase بنجاح (${behind} commits من الـ remote)`);
              }
            } catch (rebaseErr) {
              await runGit(['rebase', '--abort'], cwd, 15_000).catch(() => {});
              throw new Error(`rebase conflict — حل يدوي مطلوب: ${rebaseErr instanceof Error ? rebaseErr.message.slice(0, 150) : 'unknown'}`);
            }
            await runGit(['push', 'origin', `HEAD:${currentBranch}`], cwd, 300_000);
            gitResult.pushed = true;
            gitResult.message = `تم رفع ${archivesToPush.length} ملف أرشيف إلى GitHub بنجاح (rebase strategy).`;
          } else {
            // default: fetch_merge (safest for repos with merge history)
            try {
              const behind = gitResult.ahead_behind?.behind || 0;
              if (behind > 0) {
                await runGit(['merge', `origin/${currentBranch}`, '--no-edit'], cwd, 60_000);
                gitResult.warnings?.push(`✅ تم merge بنجاح (${behind} commits من الـ remote)`);
              }
            } catch (mergeErr) {
              await runGit(['merge', '--abort'], cwd, 15_000).catch(() => {});
              throw new Error(`merge conflict — حل يدوي مطلوب: ${mergeErr instanceof Error ? mergeErr.message.slice(0, 150) : 'unknown'}`);
            }
            await runGit(['push', 'origin', `HEAD:${currentBranch}`], cwd, 300_000);
            gitResult.pushed = true;
            gitResult.message = `تم رفع ${archivesToPush.length} ملف أرشيف إلى GitHub بنجاح (merge strategy).`;
          }
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
    console.error('[admin:db-backup]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
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
