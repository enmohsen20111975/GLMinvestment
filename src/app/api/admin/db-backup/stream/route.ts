import { NextRequest } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { access, mkdir, readdir, stat, unlink } from 'fs/promises';
import { join, basename } from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max duration for full streaming backup

const execFileAsync = promisify(execFile);

const DB_DIR = join(process.cwd(), 'db');
const DATA_DIR = join(process.cwd(), 'data');
const DEFAULT_MAX_ZIP_MB = 60; // 60MB default per archive to stay safely below GitHub 100MB limit

const SYSTEM_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const EXEC_ENV = {
  ...process.env,
  PATH: `${SYSTEM_PATH}:${process.env.PATH || ''}`,
};

async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

function resolveBinary(name: string, candidates: string[]): string {
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

interface BackupResult {
  archive_name: string;
  archive_path: string;
  size_bytes: number;
  size_mb: string;
  included_dbs: string[];
}

interface StreamBody {
  selected_dbs?: string[];
  max_part_size_mb?: number;
  upload_to_github?: boolean;
  prune_older_than_days?: number;
  selected_archives?: string[];
  only_upload_existing?: boolean;
  push_strategy?: 'fetch_merge' | 'fetch_rebase' | 'force_push' | 'no_pull';
  force_no_rebase?: boolean;
  delete_remote_archives_before_push?: string[];
  rollback_last_commit?: boolean;
}

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
      // ignore unreadable
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

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

async function runGit(args: string[], cwd: string, timeoutMs = 300_000): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(GIT_BIN, args, { cwd, env: EXEC_ENV, maxBuffer: 50 * 1024 * 1024, timeout: timeoutMs });
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  let body: StreamBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let logIndex = 0;

      const emit = (level: 'info' | 'step' | 'success' | 'warn' | 'error' | 'git', step: string, message: string, progress: number, details?: string) => {
        logIndex++;
        const payload = JSON.stringify({
          id: logIndex,
          timestamp: new Date().toLocaleTimeString('ar-EG', { hour12: false }),
          level,
          step,
          message,
          progress: Math.min(100, Math.max(0, Math.round(progress))),
          details: details ? details.trim() : undefined,
        });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      const emitDone = (success: boolean, summary: any) => {
        const payload = JSON.stringify({
          type: 'done',
          success,
          summary,
        });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        controller.close();
      };

      try {
        const cwd = process.cwd();
        const uploadToGithub = body.upload_to_github === true;
        const onlyUploadExisting = body.only_upload_existing === true;
        const pruneOlderThanDays = Math.max(0, Number(body.prune_older_than_days) || 0);
        const maxPartSizeMb = Math.max(10, Math.min(95, Number(body.max_part_size_mb) || DEFAULT_MAX_ZIP_MB));
        const maxZipBytes = maxPartSizeMb * 1024 * 1024;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

        emit('step', 'init', '🚀 بدء تشغيل معالج النسخ الاحتياطي والرفع المباشر...', 5);
        emit('info', 'init', `مسار المشروع: ${cwd} | أقصى حجم للدفعة: ${maxPartSizeMb} MB`, 7);

        // التأكد من وجود مجلد data/
        if (!(await pathExists(DATA_DIR))) {
          await mkdir(DATA_DIR, { recursive: true });
          emit('info', 'init', 'تم إنشاء مجلد data/ بنجاح.', 8);
        }

        // Pruning if requested
        let prunedCount = 0;
        if (pruneOlderThanDays > 0) {
          emit('step', 'prune', `جاري فحص الأرشيفات القديمة الأقدم من ${pruneOlderThanDays} يوماً...`, 10);
          const cutoff = Date.now() - pruneOlderThanDays * 24 * 60 * 60 * 1000;
          const archives = await listArchives();
          for (const arc of archives) {
            if (arc.created && new Date(arc.created).getTime() < cutoff) {
              try {
                await unlink(arc.path);
                prunedCount++;
                emit('info', 'prune', `تم حذف الأرشيف القديم: ${arc.name}`, 12);
              } catch (e) {
                emit('warn', 'prune', `تعذر حذف ${arc.name}: ${e instanceof Error ? e.message : String(e)}`, 12);
              }
            }
          }
          if (prunedCount > 0) {
            emit('success', 'prune', `تم تنظيف ${prunedCount} أرشيف قديم.`, 13);
          }
        }

        let createdArchives: BackupResult[] = [];
        const errors: string[] = [];

        // -------------------------------------------------------------
        // حالة الرفع المباشر للأرشيفات الموجودة فقط (دون ضغط جديد)
        // -------------------------------------------------------------
        if (onlyUploadExisting) {
          emit('step', 'select_existing', 'تم اختيار رفع الأرشيفات الموجودة مسبقاً (تخطي مرحلة الضغط)...', 25);
          const existingArchives = await listArchives();
          if (existingArchives.length === 0) {
            emit('error', 'select_existing', 'لا توجد أي أرشيفات في مجلد data/ لرفعها.', 25);
            emitDone(false, { error: 'لا توجد أرشيفات متاحة للرفع في مجلد data/' });
            return;
          }

          let toPush = existingArchives;
          if (Array.isArray(body.selected_archives) && body.selected_archives.length > 0) {
            const set = new Set(body.selected_archives);
            toPush = existingArchives.filter(a => set.has(a.name));
          }

          if (toPush.length === 0) {
            emit('error', 'select_existing', 'لم يتم اختيار أي أرشيف صالح للرفع.', 25);
            emitDone(false, { error: 'لم يتم اختيار أي أرشيف صالح للرفع.' });
            return;
          }

          createdArchives = toPush.map(a => ({
            archive_name: a.name,
            archive_path: a.path,
            size_bytes: a.size_bytes,
            size_mb: a.size_mb,
            included_dbs: ['existing'],
          }));

          emit('info', 'select_existing', `تم اختيار ${createdArchives.length} أرشيف موجود بحجم إجمالي ${(createdArchives.reduce((s, a) => s + a.size_bytes, 0) / 1024 / 1024).toFixed(1)} MB`, 30);
        } else {
          // -------------------------------------------------------------
          // مرحلة الفحص والضغط
          // -------------------------------------------------------------
          emit('step', 'scan', 'جاري فحص قواعد البيانات المتوفرة في مجلد db/...', 15);
          let dbs = await listDbFiles();
          if (dbs.length === 0) {
            emit('error', 'scan', 'لا توجد قواعد بيانات في مجلد db/.', 15);
            emitDone(false, { error: 'مجلد db/ فارغ من قواعد البيانات.' });
            return;
          }

          // تصفية حسب القواعد المحددة
          if (Array.isArray(body.selected_dbs) && body.selected_dbs.length > 0) {
            const set = new Set(body.selected_dbs);
            dbs = dbs.filter(d => set.has(d.name));
            if (dbs.length === 0) {
              emit('error', 'scan', 'لم يتم العثور على القواعد المحددة في db/.', 15);
              emitDone(false, { error: 'لم يتم العثور على أي من قواعد البيانات المحددة.' });
              return;
            }
          }

          const totalBytes = dbs.reduce((s, d) => s + d.size_bytes, 0);
          const totalMb = (totalBytes / 1024 / 1024).toFixed(1);
          emit('info', 'scan', `تم اختيار ${dbs.length} قاعدة بيانات (الحجم الكلي غير المضغوط: ${totalMb} MB).`, 18);

          if (Number(totalMb) > 350) {
            emit('warn', 'scan', `⚠️ تنبيه: الحجم المحدد كبير (${totalMb} MB). سيتم التقسيم والتجزئة تلقائياً لتفادي حدود GitHub.`, 19);
          }

          const batches = chunkDbs(dbs, maxZipBytes);
          emit('info', 'batch', `تم تقسيم القواعد إلى ${batches.length} دفعة وفقاً لحد التجزئة (${maxPartSizeMb} MB).`, 20);

          // بدء الضغط لكل دفعة
          for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const suffix = batches.length > 1 ? `_part${i + 1}` : '';
            const archiveName = `db_backup_${stamp}${suffix}.zip`;
            const archivePath = join(DATA_DIR, archiveName);
            const dbNames = batch.map(b => b.name);
            const dbPaths = batch.map(b => b.path);

            const batchProgress = 20 + Math.round(((i + 1) / batches.length) * 35);
            emit('step', 'compress', `[دفعة ${i + 1}/${batches.length}] جاري ضغط: ${dbNames.join(', ')}...`, batchProgress - 5);

            // لو الملف موجود من قبل، نحذفه لتفادي الـ append غير المقصود
            if (await pathExists(archivePath)) {
              await unlink(archivePath).catch(() => {});
            }

            let compressSuccess = false;
            let compressErrStr = '';

            // 1. محاولة استخدام أمر zip في النظام
            try {
              emit('info', 'compress', `تنفيذ: ${basename(ZIP_BIN)} -j -q -y ${archiveName} [${dbNames.length} ملفات]`, batchProgress - 4);
              await execFileAsync(ZIP_BIN, ['-j', '-q', '-y', archivePath, ...dbPaths], {
                env: EXEC_ENV,
                maxBuffer: 50 * 1024 * 1024,
                timeout: 180_000,
              });
              if (await pathExists(archivePath)) {
                compressSuccess = true;
              }
            } catch (err: any) {
              // Info-ZIP exit code 18 = "file altered while being read" (شائع مع ملفات SQLite النشطة)
              if (err?.code === 18 && (await pathExists(archivePath))) {
                const stCheck = await stat(archivePath);
                if (stCheck.size > 0) {
                  compressSuccess = true;
                  emit('warn', 'compress', `تنبيه: تم تعديل أحد الملفات أثناء قراءته، ولكن تم إنشاء الأرشيف بنجاح (حجم: ${(stCheck.size / 1024 / 1024).toFixed(1)} MB).`, batchProgress - 3);
                }
              }
              if (!compressSuccess) {
                compressErrStr = err instanceof Error ? err.message : String(err);
                emit('warn', 'compress', `فشل أمر zip في النظام (${compressErrStr}). جاري التحويل للمحرك البديل (Python zipfile)...`, batchProgress - 3);
              }
            }

            // 2. المحرك البديل: Python zipfile
            if (!compressSuccess) {
              try {
                const pyCode = `
import zipfile, os, sys
archive = sys.argv[1]
files = sys.argv[2:]
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for f in files:
        if os.path.exists(f):
            z.write(f, os.path.basename(f))
`;
                await execFileAsync(PYTHON_BIN, ['-c', pyCode, archivePath, ...dbPaths], {
                  env: EXEC_ENV,
                  maxBuffer: 50 * 1024 * 1024,
                  timeout: 180_000,
                });
                if (await pathExists(archivePath)) {
                  compressSuccess = true;
                  emit('info', 'compress', `نجح الضغط باستخدام محرك Python.`, batchProgress - 2);
                }
              } catch (pyErr) {
                const pyMsg = pyErr instanceof Error ? pyErr.message : String(pyErr);
                errors.push(`فشل ضغط ${archiveName}: ${pyMsg}`);
                emit('error', 'compress', `فشل الضغط للدفعة ${i + 1}: ${pyMsg}`, batchProgress);
                continue;
              }
            }

            if (!compressSuccess || !(await pathExists(archivePath))) {
              errors.push(`الملف ${archiveName} لم يتم إنشاؤه.`);
              emit('error', 'compress', `الملف ${archiveName} لم يتم إنشاؤه على القرص.`, batchProgress);
              continue;
            }

            const st = await stat(archivePath);
            const sizeMb = (st.size / 1024 / 1024).toFixed(2);

            // فحص التجزئة لو الحجم أكبر من maxPartSizeMb
            if (st.size > maxZipBytes) {
              emit('step', 'split', `حجم الأرشيف (${sizeMb} MB) أكبر من الحد الأقصى (${maxPartSizeMb} MB). جاري التجزئة التلقائية...`, batchProgress - 1);
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

                await unlink(archivePath);

                const prefixBase = basename(chunkPrefix);
                const allEntries = await readdir(DATA_DIR);
                const partFiles = allEntries
                  .filter(f => f.startsWith(prefixBase) && f.endsWith('.zip.part'))
                  .sort();

                emit('success', 'split', `تم تقسيم الأرشيف بنجاح إلى ${partFiles.length} أجزاء.`, batchProgress);

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
                  emit('info', 'split', `جزء: ${pFile} (${(pSt.size / 1024 / 1024).toFixed(1)} MB)`, batchProgress);
                }
              } catch (splitErr) {
                const sMsg = splitErr instanceof Error ? splitErr.message : String(splitErr);
                errors.push(`فشل تجزئة ${archiveName}: ${sMsg}`);
                emit('error', 'split', `فشل التجزئة للأرشيف: ${sMsg}`, batchProgress);
              }
            } else {
              createdArchives.push({
                archive_name: archiveName,
                archive_path: archivePath,
                size_bytes: st.size,
                size_mb: sizeMb,
                included_dbs: dbNames,
              });
              emit('success', 'compress', `تم إنشاء الأرشيف ${archiveName} بنجاح (${sizeMb} MB).`, batchProgress);
            }
          }
        }

        if (createdArchives.length === 0) {
          emit('error', 'compress', 'لم يتم إنشاء أو تحديد أي أرشيف صالح للمتابعة.', 60);
          emitDone(false, { error: 'فشل إنشاء الأرشيفات، راجع سجل الأخطاء.', errors });
          return;
        }

        const totalCreatedMb = (createdArchives.reduce((s, a) => s + a.size_bytes, 0) / 1024 / 1024).toFixed(1);
        emit('success', 'compress_done', `✅ اكتملت مرحلة تجهيز الأرشيفات: ${createdArchives.length} ملف (الإجمالي: ${totalCreatedMb} MB).`, 60);

        // -------------------------------------------------------------
        // لو لم يُطلب الرفع على GitHub، ننتهي هنا
        // -------------------------------------------------------------
        if (!uploadToGithub) {
          emit('success', 'finish', 'تم حفظ الأرشيفات محلياً في مجلد data/ بنجاح (لم يُطلب الرفع إلى GitHub).', 100);
          emitDone(true, {
            total_archives: createdArchives.length,
            total_mb: totalCreatedMb,
            archives: createdArchives,
            git_pushed: false,
          });
          return;
        }

        // -------------------------------------------------------------
        // مرحلة الرفع إلى GitHub
        // -------------------------------------------------------------
        emit('step', 'git_init', '🐙 بدء مرحلة المزامنة والرفع إلى مستودع GitHub...', 65);

        // 1. فحص الفرع الحالي
        let currentBranch = 'main';
        try {
          const { stdout: bOut } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, 15_000);
          currentBranch = bOut.trim() || 'main';
          emit('info', 'git_init', `الفرع النشط الحالي: ${currentBranch}`, 66);
        } catch (e) {
          emit('warn', 'git_init', `تعذر تحديد اسم الفرع بدقة، سيتم استخدام 'main'`, 66);
        }

        // 2. فحص remote origin
        try {
          const { stdout: remOut } = await runGit(['remote', 'get-url', 'origin'], cwd, 15_000);
          const safeUrl = remOut.trim().replace(/:\/\/[^@]+@/, '://***@');
          emit('info', 'git_init', `المستودع البعيد: ${safeUrl}`, 67);
        } catch {
          emit('warn', 'git_init', 'تعذر قراءة عنوان origin', 67);
        }

        // 3. فحص أمان أحجام الملفات قبل Git (حد أمان GitHub الصارم 100MB)
        for (const arc of createdArchives) {
          const arcMb = arc.size_bytes / 1024 / 1024;
          if (arcMb >= 98.0) {
            emit('error', 'git_safety', `⚠️ الملف ${arc.archive_name} حجمه ${arcMb.toFixed(1)} MB يتجاوز حد أمان GitHub (100 MB). تم إلغاء الرفع لتفادي رفض المستودع.`, 68);
            emitDone(false, { error: `الملف ${arc.archive_name} يتجاوز حد 100MB لـ GitHub. يرجى تقليل حجم التجزئة.` });
            return;
          }
        }

        // 4. Rollback last commit if requested
        if (body.rollback_last_commit === true) {
          emit('step', 'git_rollback', 'جاري التراجع عن آخر commit محلي (soft reset)...', 69);
          try {
            await runGit(['reset', '--soft', 'HEAD~1'], cwd, 20_000);
            emit('success', 'git_rollback', 'تم التراجع عن آخر commit محلي (التعديلات محفوظة في staging).', 70);
          } catch (e: any) {
            emit('warn', 'git_rollback', `فشل التراجع: ${e?.message || e}`, 70);
          }
        }

        // 5. Delete remote archives if requested
        if (Array.isArray(body.delete_remote_archives_before_push) && body.delete_remote_archives_before_push.length > 0) {
          emit('step', 'git_delete_remote', `جاري إزالة ${body.delete_remote_archives_before_push.length} أرشيف قديم من GitHub...`, 71);
          const deletedRemote: string[] = [];
          for (const remoteFile of body.delete_remote_archives_before_push) {
            const safeName = basename(remoteFile.trim());
            if (!safeName || safeName.includes('..')) continue;
            try {
              await runGit(['rm', '--cached', `data/${safeName}`], cwd, 15_000);
              deletedRemote.push(safeName);
              emit('info', 'git_delete_remote', `تمت إزالة: data/${safeName}`, 72);
            } catch (e: any) {
              emit('warn', 'git_delete_remote', `تعذر إزالة data/${safeName}: ${e?.message || e}`, 72);
            }
          }
          if (deletedRemote.length > 0) {
            try {
              await runGit(['commit', '-m', `chore(backup): remove old archives ${stamp} (${deletedRemote.length} files)`], cwd, 20_000);
              emit('success', 'git_delete_remote', 'تم تسجيل commit حذف الأرشيفات القديمة.', 73);
            } catch {}
          }
        }

        // 6. اختيار الأرشيفات التي سترفع
        let archivesToPush = createdArchives;
        if (Array.isArray(body.selected_archives) && body.selected_archives.length > 0) {
          const set = new Set(body.selected_archives);
          archivesToPush = createdArchives.filter(a => set.has(a.archive_name));
        }

        // 7. Git add
        emit('step', 'git_add', `جاري إضافة ${archivesToPush.length} ملف أرشيف إلى Git (git add -f)...`, 75);
        const addFiles = archivesToPush.map(a => `data/${a.archive_name}`);
        try {
          await runGit(['add', '-f', ...addFiles], cwd, 60_000);
          emit('success', 'git_add', `تمت إضافة الملفات إلى الـ Staging Area بنجاح.`, 78);
        } catch (addErr: any) {
          emit('error', 'git_add', `فشل git add: ${addErr?.message || addErr}`, 78);
          emitDone(false, { error: 'فشل إضافة الملفات إلى Git.' });
          return;
        }

        // 8. Git commit
        emit('step', 'git_commit', 'تسجيل التعديلات محلياً (git commit)...', 80);
        const commitMsg = `chore(backup): DB snapshot ${stamp} (${archivesToPush.length} files, ${totalCreatedMb} MB)`;
        try {
          const { stdout: cOut } = await runGit(['commit', '-m', commitMsg], cwd, 30_000);
          emit('success', 'git_commit', `تم إنشاء Commit محلي بنجاح: "${commitMsg}"`, 83, cOut);
        } catch (commitErr: any) {
          const cMsg = commitErr?.message || String(commitErr);
          if (cMsg.includes('nothing to commit') || cMsg.includes('working tree clean')) {
            emit('info', 'git_commit', 'الملفات مسجلة بالفعل في Commit محلي مسبق.', 83);
          } else {
            emit('warn', 'git_commit', `ملاحظة commit: ${cMsg.slice(0, 150)}`, 83);
          }
        }

        // 9. Git fetch & check sync
        emit('step', 'git_fetch', 'جاري فحص حالة المستودع البعيد (git fetch origin)...', 85);
        let ahead = 0;
        let behind = 0;
        try {
          await runGit(['fetch', 'origin', currentBranch], cwd, 120_000);
          const { stdout: abStdout } = await runGit(
            ['rev-list', '--left-right', '--count', `HEAD...origin/${currentBranch}`],
            cwd,
            20_000
          ).catch(() => ({ stdout: '0\t0', stderr: '' }));
          const parts = abStdout.trim().split(/\s+/).map(n => parseInt(n, 10) || 0);
          ahead = parts[0] || 0;
          behind = parts[1] || 0;
          emit('info', 'git_fetch', `حالة التزامن: ${ahead} commits محلياً أمام الـ Remote، و ${behind} commits على الـ Remote.`, 87);
        } catch (fErr: any) {
          emit('warn', 'git_fetch', `تعذر جلب آخر تحديثات origin: ${fErr?.message || fErr}`, 87);
        }

        // 10. استراتيجية المزامنة (Handling Behind)
        const strategy = body.push_strategy || (body.force_no_rebase ? 'no_pull' : 'fetch_merge');
        emit('info', 'git_sync', `استراتيجية الرفع المعتمدة: ${strategy}`, 88);

        if (behind > 0 && strategy !== 'no_pull' && strategy !== 'force_push') {
          if (strategy === 'fetch_merge') {
            emit('step', 'git_merge', `يوجد ${behind} commits على الـ remote؛ جاري الدمج التلقائي (git merge)...`, 89);
            try {
              await runGit(['merge', `origin/${currentBranch}`, '--no-edit'], cwd, 60_000);
              emit('success', 'git_merge', 'تم الدمج مع التعديلات البعيدة بنجاح دون أي تعارض.', 90);
            } catch (mergeErr: any) {
              await runGit(['merge', '--abort'], cwd, 15_000).catch(() => {});
              emit('error', 'git_merge', `تعذر الدمج التلقائي لوجود تعارض في الملفات: ${mergeErr?.message || mergeErr}`, 90);
              emitDone(false, { error: 'تعارض في الدمج (Merge Conflict). جرب استراتيجية الرفع بدون مزامنة أو حل التعارض يدوياً.' });
              return;
            }
          } else if (strategy === 'fetch_rebase') {
            emit('step', 'git_rebase', `يوجد ${behind} commits على الـ remote؛ جاري إعادة الترتيب (git rebase --rebase-merges)...`, 89);
            try {
              await runGit(['rebase', '--rebase-merges', `origin/${currentBranch}`], cwd, 60_000);
              emit('success', 'git_rebase', 'تم الـ rebase بنجاح.', 90);
            } catch (rebaseErr: any) {
              await runGit(['rebase', '--abort'], cwd, 15_000).catch(() => {});
              emit('error', 'git_rebase', `تعذر الـ rebase لوجود تعارض: ${rebaseErr?.message || rebaseErr}`, 90);
              emitDone(false, { error: 'تعارض في الـ rebase. جرب استراتيجية fetch + merge بدلاً منها.' });
              return;
            }
          }
        }

        // 11. الرفع الفعلي (git push)
        emit('step', 'git_push', `🚀 جاري رفع البيانات إلى GitHub (git push origin HEAD:${currentBranch})...`, 92);
        emit('info', 'git_push', 'يرجى عدم إغلاق الصفحة، قد يستغرق الرفع من دقيقة إلى 3 دقائق حسب سرعة الاتصال وحجم الملفات.', 93);

        const pushArgs = ['push'];
        if (strategy === 'force_push') {
          pushArgs.push('--force');
          emit('warn', 'git_push', '⚠️ تنبيه: تم تفعيل force push!', 94);
        }
        pushArgs.push('origin', `HEAD:${currentBranch}`);

        try {
          // مهلة سخية 300 ثانية للرفع على السيرفر
          const { stdout: pOut, stderr: pErr } = await runGit(pushArgs, cwd, 300_000);
          const pushOutput = (pOut || '') + '\n' + (pErr || '');
          emit('git', 'git_push', `مخرجات Git Push:\n${pushOutput.trim()}`, 98);
          emit('success', 'git_push', `🎉 تم رفع ${archivesToPush.length} ملف أرشيف إلى مستودع GitHub بنجاح!`, 100);

          emitDone(true, {
            total_archives: archivesToPush.length,
            total_mb: totalCreatedMb,
            branch: currentBranch,
            strategy,
            message: `تم رفع ${archivesToPush.length} ملف أرشيف بنجاح إلى GitHub (${currentBranch}).`,
          });
        } catch (pushErr: any) {
          const rawErr = pushErr?.message || pushErr?.stderr || String(pushErr);
          emit('error', 'git_push', `❌ فشل الرفع إلى GitHub: ${rawErr.slice(0, 300)}`, 95, rawErr);

          // تشخيص ذكي لسبب الخطأ
          if (rawErr.includes('Authentication failed') || rawErr.includes('Invalid username or password') || rawErr.includes('403')) {
            emit('warn', 'git_push', '💡 التشخيص: توكن GitHub (Personal Access Token) غير صالح أو منتهي الصلاحية أو يفتقر إلى صلاحيات Write/Repo.', 95);
          } else if (rawErr.includes('exceeds GitHub\'s file size limit') || rawErr.includes('this exceeds')) {
            emit('warn', 'git_push', '💡 التشخيص: أحد الملفات المرفوعة تجاوز حد 100MB لـ GitHub. قلل حجم التجزئة إلى 50MB وأعد المحاولة.', 95);
          } else if (rawErr.includes('timed out') || rawErr.includes('SIGTERM')) {
            emit('warn', 'git_push', '💡 التشخيص: انتهت مهلة الرفع بسبب بطء سرعة اتصال الإنترنت. جرب رفع قواعد أقل أو تقليل حجم التجزئة.', 95);
          } else if (rawErr.includes('fetch first') || rawErr.includes('non-fast-forward')) {
            emit('warn', 'git_push', '💡 التشخيص: المستودع يحتوي على تغييرات أحدث. اختر استراتيجية fetch + merge ثم أعد الرفع.', 95);
          }

          emitDone(false, {
            error: 'فشلت عملية الرفع إلى GitHub.',
            details: rawErr,
          });
        }
      } catch (fatalErr: any) {
        emit('error', 'fatal', `خطأ غير متوقع: ${fatalErr?.message || fatalErr}`, 100);
        emitDone(false, { error: fatalErr?.message || 'خطأ داخلي' });
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
