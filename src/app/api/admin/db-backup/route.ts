import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const execFileAsync = promisify(execFile);

const DB_DIR = join(process.cwd(), 'db');
const DATA_DIR = join(process.cwd(), 'data');
const MAX_ZIP_BYTES = 60 * 1024 * 1024; // 60MB hard cap per archive

interface DbInfo {
  name: string;
  path: string;
  size_bytes: number;
  size_mb: string;
  modified: string | null;
}

interface BackupArchive {
  name: string;
  path: string;
  size_bytes: number;
  size_mb: string;
  created: string | null;
}

/**
 * Walk the DB directory and collect every *.db file (ignoring -shm / -wal /
 * -journal sidecars — those are SQLite write-ahead logs that can be rebuilt).
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
    if (!entry.endsWith('.zip')) continue;
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
      });
    } catch {
      // ignore
    }
  }
  return out.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
}

/**
 * Group DB files into batches where each batch's total uncompressed size is
 * under 60MB. SQLite DBs compress very well (~3-5x), so 60MB raw almost
 * always produces a sub-60MB zip — but we cap raw input to be safe.
 *
 * If a single DB is larger than 60MB raw, it gets its own zip (compression
 * will usually bring the archive under the limit).
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

// ---------------------------------------------------------------------------
// GET /api/admin/db-backup
// Returns: list of DBs + their sizes/modified times + existing archives
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
      max_zip_mb: MAX_ZIP_BYTES / 1024 / 1024,
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
// Body: { upload_to_github?: boolean, prune_older_than_days?: number }
//
// Compresses each batch of DBs into a sub-60MB zip archive inside /data,
// then optionally commits + pushes those archives to GitHub under the
// data/ folder (uses `git add -f` because data/*.zip is gitignored).
// ---------------------------------------------------------------------------

interface PostBody {
  upload_to_github?: boolean;
  prune_older_than_days?: number;
}

interface BackupResult {
  archive_name: string;
  archive_path: string;
  size_bytes: number;
  size_mb: string;
  included_dbs: string[];
}

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 30_000 });
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const uploadToGithub = body.upload_to_github === true;
    const pruneOlderThanDays = Math.max(0, Number(body.prune_older_than_days) || 0);

    // Ensure data dir exists
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

    const dbs = listDbFiles();
    if (dbs.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'لا توجد قواعد بيانات للنسخ الاحتياطي (مجلد db/ فارغ).',
      }, { status: 400 });
    }

    // Optional pruning of old archives before creating new ones
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

    const batches = chunkDbs(dbs, MAX_ZIP_BYTES);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const createdArchives: BackupResult[] = [];
    const errors: string[] = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const suffix = batches.length > 1 ? `_part${i + 1}` : '';
      const archiveName = `db_backup_${stamp}${suffix}.zip`;
      const archivePath = join(DATA_DIR, archiveName);

      const dbNames = batch.map(b => b.name);
      try {
        // -j: junk paths (store just the file basename) so the archive
        // entries are clean (db/foo.db rather than absolute /home/...).
        await execFileAsync('zip', ['-j', '-q', '-y', archivePath, ...batch.map(b => b.path)], {
          maxBuffer: 50 * 1024 * 1024,
          timeout: 60_000,
        });
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
      if (st.size > MAX_ZIP_BYTES) {
        try { unlinkSync(archivePath); } catch { /* ignore */ }
        errors.push(`الأرشيف ${archiveName} تجاوز 60MB (${(st.size / 1024 / 1024).toFixed(1)}MB) وتم حذفه.`);
        continue;
      }

      createdArchives.push({
        archive_name: archiveName,
        archive_path: archivePath,
        size_bytes: st.size,
        size_mb: (st.size / 1024 / 1024).toFixed(2),
        included_dbs: dbNames,
      });
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

        const commitMsg = `chore(backup): DB snapshot ${stamp} (${createdArchives.length} archive${createdArchives.length > 1 ? 's' : ''})`;
        try {
          await runGit(['commit', '-m', commitMsg], cwd);
          gitResult.committed = true;
        } catch (e) {
          gitResult.message = `commit: ${e instanceof Error ? e.message.slice(0, 200) : 'no changes'}`;
        }

        try {
          await runGit(['push', 'origin', 'HEAD'], cwd);
          gitResult.pushed = true;
          gitResult.message = `تم رفع ${createdArchives.length} أرشيف إلى GitHub بنجاح.`;
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
      archives: createdArchives,
      summary: {
        total_archives_created: createdArchives.length,
        total_db_files: dbs.length,
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
