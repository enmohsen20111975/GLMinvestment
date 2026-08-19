import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { backupDatabase, listDatabases, humanSize } from '@/lib/admin-db-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/db-manager/auto-backup
 *
 * Triggers a full backup of ALL databases:
 *   1. better-sqlite3 DBs in db/ → uses backupDatabase()
 *   2. auth.db (Prisma) → ensures good state then copies via fs.copyFileSync
 *
 * All files land in db/backups/auto/<YYYY-MM-DD_HHmmss>/
 * Returns a summary with file names and sizes.
 */
export async function POST(request: NextRequest) {
  // ── Auth gate ──────────────────────────────────────────────────────────
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const projectRoot = process.cwd();
    const dbDir = path.join(projectRoot, 'db');
    const autoBackupRoot = path.join(dbDir, 'backups', 'auto');

    // Create timestamped directory: YYYY-MM-DD_HHmmss
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const folderName = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
    const backupDir = path.join(autoBackupRoot, folderName);
    fs.mkdirSync(backupDir, { recursive: true });

    const results: Array<{
      source: string;
      fileName: string;
      sizeBytes: number;
      sizeHuman: string;
      type: 'better-sqlite3' | 'prisma-auth';
    }> = [];

    let totalBytes = 0;
    let errors: string[] = [];

    // ── Step 1: Backup all better-sqlite3 databases ────────────────────────
    const databases = listDatabases();

    for (const db of databases) {
      try {
        const backupResult = backupDatabase(db.name);

        // Move the backup from backups/ into our timestamped auto/ folder
        const srcPath = path.join(dbDir, 'backups', backupResult.fileName);
        const destPath = path.join(backupDir, backupResult.fileName);

        if (fs.existsSync(srcPath)) {
          fs.renameSync(srcPath, destPath);

          // Also move -wal/-shm if present
          for (const ext of ['-wal', '-shm']) {
            const walSrc = `${srcPath}${ext}`;
            const walDest = `${destPath}${ext}`;
            if (fs.existsSync(walSrc)) {
              fs.renameSync(walSrc, walDest);
            }
          }

          results.push({
            source: db.name,
            fileName: backupResult.fileName,
            sizeBytes: backupResult.sizeBytes,
            sizeHuman: backupResult.sizeHuman,
            type: 'better-sqlite3',
          });
          totalBytes += backupResult.sizeBytes;
        } else {
          errors.push(`Backup file not found after backupDatabase: ${backupResult.fileName}`);
        }
      } catch (err) {
        errors.push(`${db.name}: ${String((err as Error)?.message || err)}`);
      }
    }

    // ── Step 2: Backup auth.db (Prisma-managed) ───────────────────────────
    // Locate auth.db — could be in prisma/ or db/ depending on DATABASE_URL
    const possibleAuthPaths = [
      path.join(projectRoot, 'prisma', 'auth.db'),
      path.join(dbDir, 'auth.db'),
    ];

    // Also check DATABASE_URL env for the actual path
    const dbUrl = process.env.DATABASE_URL || '';
    if (dbUrl.startsWith('file:')) {
      const urlPath = dbUrl.replace(/^file:/, '');
      // Resolve relative to prisma/ if not absolute
      const absUrlPath = path.isAbsolute(urlPath)
        ? urlPath
        : path.join(projectRoot, 'prisma', urlPath);
      possibleAuthPaths.unshift(absUrlPath);
    }

    let authDbPath: string | null = null;
    for (const p of possibleAuthPaths) {
      if (fs.existsSync(p)) {
        authDbPath = p;
        break;
      }
    }

    if (authDbPath) {
      try {
        // Ensure Prisma is in a good state by running a simple query
        // This forces any pending writes to flush
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();
        try {
          await prisma.$queryRaw`SELECT 1`;
        } finally {
          await prisma.$disconnect();
        }

        // Copy auth.db (+ wal/shm) to the backup directory
        const authBaseName = path.basename(authDbPath);
        const destPath = path.join(backupDir, authBaseName);
        fs.copyFileSync(authDbPath, destPath);

        // Copy WAL/SHM if present
        for (const ext of ['-wal', '-shm']) {
          const src = `${authDbPath}${ext}`;
          const dest = `${destPath}${ext}`;
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
          }
        }

        const stat = fs.statSync(destPath);
        results.push({
          source: authBaseName,
          fileName: authBaseName,
          sizeBytes: stat.size,
          sizeHuman: humanSize(stat.size),
          type: 'prisma-auth',
        });
        totalBytes += stat.size;
      } catch (err) {
        errors.push(`auth.db: ${String((err as Error)?.message || err)}`);
      }
    } else {
      // auth.db not found — not an error, it may not be created yet
      errors.push('auth.db: not found (may not be created yet)');
    }

    return NextResponse.json({
      success: true,
      backupDir: `db/backups/auto/${folderName}`,
      folderName,
      timestamp: now.toISOString(),
      totalDatabases: results.length,
      totalSizeBytes: totalBytes,
      totalSizeHuman: humanSize(totalBytes),
      databases: results,
      errors: errors.length > 0 ? errors : undefined,
      message: `تم نسخ ${results.length} قاعدة بيانات احتياطياً في ${folderName}/`,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String((error as Error)?.message || error) },
      { status: 500 }
    );
  }
}