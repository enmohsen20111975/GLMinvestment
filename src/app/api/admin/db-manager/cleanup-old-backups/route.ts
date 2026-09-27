import { NextRequest, NextResponse } from 'next/server';
// P0-14-ASYNC fix (2026-09-27): replaced sync fs.* calls with async fs/promises
// equivalents so the cleanup-old-backups POST handler never blocks the event
// loop while scanning directories and removing old backups.
import {
  access,
  readdir,
  stat as statAsync,
  rm,
} from 'fs/promises';
import * as path from 'path';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { humanSize } from '@/lib/admin-db-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// P0-14-ASYNC fix (2026-09-27): async helper to check file existence.
async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

/** Directories to scan for old backups. */
const BACKUP_SUBDIRS = ['daily', 'auto'] as const;
const RETENTION_DAYS = 7;

/**
 * POST /api/admin/db-manager/cleanup-old-backups
 *
 * Deletes backup directories older than 7 days from:
 *   - db/backups/daily/
 *   - db/backups/auto/
 *
 * Returns count of deleted backups and freed disk space.
 */
export async function POST(request: NextRequest) {
  // ── Auth gate ──────────────────────────────────────────────────────────
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const projectRoot = process.cwd();
    const backupRoot = path.join(projectRoot, 'db', 'backups');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffMs = cutoff.getTime();

    let deletedCount = 0;
    let freedBytes = 0;
    const deleted: Array<{ dir: string; subDir: string; sizeHuman: string }> = [];
    const errors: string[] = [];

    for (const subDir of BACKUP_SUBDIRS) {
      const scanDir = path.join(backupRoot, subDir);

      if (!(await pathExists(scanDir))) continue;

      let entries;
      try {
        entries = await readdir(scanDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const entryPath = path.join(scanDir, entry.name);
        let entryMtimeMs: number;

        try {
          const stat = await statAsync(entryPath);
          entryMtimeMs = stat.mtimeMs;
        } catch {
          continue;
        }

        if (entryMtimeMs < cutoffMs) {
          try {
            // Calculate total size before deletion
            const dirSize = await getDirSize(entryPath);

            // Recursively delete (async)
            await rm(entryPath, { recursive: true, force: true });

            deletedCount++;
            freedBytes += dirSize;
            deleted.push({
              dir: entry.name,
              subDir,
              sizeHuman: humanSize(dirSize),
            });
          } catch (err) {
            errors.push(`${subDir}/${entry.name}: ${String((err as Error)?.message || err)}`);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      retentionDays: RETENTION_DAYS,
      cutoffDate: cutoff.toISOString(),
      deletedCount,
      deleted,
      totalFreedBytes: freedBytes,
      totalFreedHuman: humanSize(freedBytes),
      errors: errors.length > 0 ? errors : undefined,
      message:
        deletedCount > 0
          ? `تم حذف ${deletedCount} نسخة احتياطية قديمة وتحرير ${humanSize(freedBytes)}`
          : 'لا توجد نسخ احتياطية قديمة للحذف',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Recursively calculate the total byte size of a directory. */
// P0-14-ASYNC fix (2026-09-27): getDirSize is now async.
async function getDirSize(dirPath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await getDirSize(full);
      } else {
        try {
          const st = await statAsync(full);
          total += st.size;
        } catch {
          // skip unreadable files
        }
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return total;
}