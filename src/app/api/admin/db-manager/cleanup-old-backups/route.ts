import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { humanSize } from '@/lib/admin-db-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

      if (!fs.existsSync(scanDir)) continue;

      const entries = fs.readdirSync(scanDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const entryPath = path.join(scanDir, entry.name);
        let entryMtimeMs: number;

        try {
          const stat = fs.statSync(entryPath);
          entryMtimeMs = stat.mtimeMs;
        } catch {
          continue;
        }

        if (entryMtimeMs < cutoffMs) {
          try {
            // Calculate total size before deletion
            const dirSize = getDirSize(entryPath);

            // Recursively delete
            fs.rmSync(entryPath, { recursive: true, force: true });

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
function getDirSize(dirPath: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSize(full);
      } else {
        try {
          total += fs.statSync(full).size;
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