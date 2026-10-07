import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { readFile, readdir, stat, truncate, unlink } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { collectSnapshot } from '@/lib/metrics-collector';
import { insertSnapshot } from '@/lib/metrics-db';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const PROJECT_ROOT = process.cwd();
interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

async function readProcStat(): Promise<CpuTimes | null> {
  try {
    const content = await readFile('/proc/stat', 'utf8');
    const line = content.split('\n')[0];
    const parts = line.trim().split(/\s+/);
    return {
      user: Number(parts[1]) || 0,
      nice: Number(parts[2]) || 0,
      sys: Number(parts[3]) || 0,
      idle: Number(parts[4]) || 0,
      irq: Number(parts[5] || 0) + Number(parts[6] || 0),
    };
  } catch {
    return null;
  }
}

let _prevCpu: CpuTimes | null = null;
let _prevCpuTime = 0;

async function computeCpuPercent(): Promise<number> {
  const now = Date.now();
  const cur = await readProcStat();
  if (!cur) return -1;
  if (!_prevCpu || _prevCpuTime === 0) {
    _prevCpu = cur;
    _prevCpuTime = now;
    return -1;
  }
  const totalNow = cur.user + cur.nice + cur.sys + cur.idle + cur.irq;
  const totalPrev = _prevCpu.user + _prevCpu.nice + _prevCpu.sys + _prevCpu.idle + _prevCpu.irq;
  const idleNow = cur.idle;
  const idlePrev = _prevCpu.idle;
  const totalDelta = totalNow - totalPrev;
  const idleDelta = idleNow - idlePrev;
  _prevCpu = cur;
  _prevCpuTime = now;
  if (totalDelta <= 0) return 0;
  const busy = totalDelta - idleDelta;
  return Math.max(0, Math.min(100, (busy / totalDelta) * 100));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface DiskInfo {
  fs: string;
  mount: string;
  size_bytes: number;
  used_bytes: number;
  available_bytes: number;
  used_percent: number;
}

async function readDiskInfo(): Promise<DiskInfo[]> {
  try {
    const { stdout } = await execFileAsync('df', ['-P', '-B1'], { timeout: 5000 });
    const lines = stdout.trim().split('\n').slice(1);
    const out: DiskInfo[] = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const [fs, size, used, avail, _usedPct, ...mountParts] = parts;
      const mount = mountParts.join(' ');
      const sizeBytes = Number(size) || 0;
      const usedBytes = Number(used) || 0;
      const availBytes = Number(avail) || 0;
      if (!sizeBytes) continue;
      out.push({
        fs,
        mount,
        size_bytes: sizeBytes,
        used_bytes: usedBytes,
        available_bytes: availBytes,
        used_percent: Math.round((usedBytes / sizeBytes) * 100),
      });
    }
    return out;
  } catch {
    return [];
  }
}

interface ProcessInfo {
  pid: number;
  name: string;
  cpu_percent: number;
  memory_mb: number;
}

async function readTopProcesses(limit = 5): Promise<ProcessInfo[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid,rss,%cpu,comm', '--no-headers', '--sort=-pcpu'], { timeout: 5000 });
    const lines = stdout.trim().split('\n').slice(0, limit);
    return lines.map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: Number(parts[0]) || 0,
        memory_mb: Number((Number(parts[1] || 0) / 1024).toFixed(1)),
        cpu_percent: Number(parts[2] || 0),
        name: parts.slice(3).join(' ') || 'unknown',
      };
    });
  } catch {
    return [];
  }
}

interface Pm2Process {
  id: number;
  name: string;
  status: string;
  pid: number;
  uptime_ms: number;
  restarts: number;
  cpu_percent: number;
  memory_bytes: number;
  memory_formatted: string;
  log_out: string;
  log_err: string;
}

async function readPm2Services(): Promise<Pm2Process[]> {
  try {
    const { stdout } = await execAsync('pm2 jlist', { timeout: 4000 });
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((p: any) => {
      const mem = p?.monit?.memory || 0;
      const cpu = p?.monit?.cpu || 0;
      const uptime = p?.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0;

      return {
        id: p.pm_id ?? -1,
        name: p.name || 'unnamed',
        status: p?.pm2_env?.status || 'stopped',
        pid: p.pid || 0,
        uptime_ms: uptime,
        restarts: p?.pm2_env?.restart_time || 0,
        cpu_percent: Math.round(cpu * 10) / 10,
        memory_bytes: mem,
        memory_formatted: formatBytes(mem),
        log_out: p?.pm2_env?.pm_out_log_path || '',
        log_err: p?.pm2_env?.pm_err_log_path || '',
      };
    });
  } catch {
    return [];
  }
}

interface LargeFile {
  path: string;
  relative_path: string;
  size_bytes: number;
  size_formatted: string;
  modified: string;
}

async function readLargestFiles(limit = 12): Promise<LargeFile[]> {
  try {
    const cmd = `find "${PROJECT_ROOT}" -maxdepth 4 -type f -size +10M -not -path "*/.git/*" -not -path "*/node_modules/*" -exec ls -la {} + 2>/dev/null | sort -k 5 -rn | head -n ${limit}`;
    const { stdout } = await execAsync(cmd, { timeout: 6000 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    const files: LargeFile[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;
      const sizeBytes = Number(parts[4]) || 0;
      const filePath = parts.slice(8).join(' ');
      const relPath = filePath.replace(PROJECT_ROOT, '').replace(/^\//, '');

      files.push({
        path: filePath,
        relative_path: relPath,
        size_bytes: sizeBytes,
        size_formatted: formatBytes(sizeBytes),
        modified: `${parts[5]} ${parts[6]} ${parts[7]}`,
      });
    }
    return files;
  } catch {
    return [];
  }
}

async function getFolderSize(relPath: string, name_ar: string): Promise<{ name_ar: string; path: string; size_bytes: number; size_formatted: string; count: number }> {
  const fullPath = join(PROJECT_ROOT, relPath);
  try {
    const { stdout } = await execAsync(`du -sb "${fullPath}" 2>/dev/null`, { timeout: 3000 });
    const parts = stdout.trim().split(/\s+/);
    const bytes = Number(parts[0]) || 0;

    let count = 0;
    try {
      const files = await readdir(fullPath);
      count = files.length;
    } catch {}

    return {
      name_ar,
      path: relPath,
      size_bytes: bytes,
      size_formatted: formatBytes(bytes),
      count,
    };
  } catch {
    return { name_ar, path: relPath, size_bytes: 0, size_formatted: '0 B', count: 0 };
  }
}

/**
 * GET /api/admin/system-resources
 * Live CPU / Memory / Disk usage + top processes + PM2 services + Storage breakdown.
 */
export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const [cpuPercent, disks, topProcs, pm2Services, largestFiles, dbFolder, logsFolder, reportsFolder, cacheFolder] =
      await Promise.all([
        computeCpuPercent(),
        readDiskInfo(),
        readTopProcesses(5),
        readPm2Services(),
        readLargestFiles(12),
        getFolderSize('db', 'قواعد البيانات (SQLite)'),
        getFolderSize('logs', 'سجلات النظام (Logs)'),
        getFolderSize('public/reports', 'رسومات وتقارير التليجرام'),
        getFolderSize('.next/cache', 'كاش تطبيقات Next.js'),
      ]);

    const cpuCount = os.cpus().length;
    const cpuModel = os.cpus()[0]?.model || 'unknown';
    const loadAvg = os.loadavg();

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const usedMemPercent = Math.round((usedMem / totalMem) * 100);

    const uptimeSec = os.uptime();
    const procUptimeSec = process.uptime();
    const memUsage = process.memoryUsage();

    const rootDisk = disks.find(d => d.mount === '/') || disks[0];
    const threatLevel = !rootDisk
      ? 'safe'
      : rootDisk.used_percent >= 85
      ? 'critical'
      : rootDisk.used_percent >= 70
      ? 'warning'
      : 'safe';

    // Also persist a snapshot to the metrics DB so the admin dashboard has
    // immediate data on first open (TASK-B). Fire-and-forget — never block
    // or fail the API response on metrics-DB write.
    void (async () => {
      try {
        const { snapshot, pm2Processes } = await collectSnapshot();
        insertSnapshot(snapshot, pm2Processes);
      } catch (e) {
        console.error('[admin:system-resources] metrics-db insert failed:', e);
      }
    })();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      threat_level: threatLevel,
      cpu: {
        percent: cpuPercent < 0 ? null : Math.round(cpuPercent * 10) / 10,
        cores: cpuCount,
        model: cpuModel,
        load_avg_1m: Math.round(loadAvg[0] * 100) / 100,
        load_avg_5m: Math.round(loadAvg[1] * 100) / 100,
        load_avg_15m: Math.round(loadAvg[2] * 100) / 100,
      },
      memory: {
        total_bytes: totalMem,
        used_bytes: usedMem,
        free_bytes: freeMem,
        used_percent: usedMemPercent,
        total_formatted: formatBytes(totalMem),
        used_formatted: formatBytes(usedMem),
        free_formatted: formatBytes(freeMem),
      },
      disk: disks.map(d => ({
        ...d,
        size_formatted: formatBytes(d.size_bytes),
        used_formatted: formatBytes(d.used_bytes),
        available_formatted: formatBytes(d.available_bytes),
      })),
      root_disk: rootDisk ? {
        ...rootDisk,
        size_formatted: formatBytes(rootDisk.size_bytes),
        used_formatted: formatBytes(rootDisk.used_bytes),
        available_formatted: formatBytes(rootDisk.available_bytes),
      } : null,
      pm2_services: pm2Services,
      storage_breakdown: [dbFolder, logsFolder, reportsFolder, cacheFolder],
      largest_files: largestFiles,
      uptime: {
        system_seconds: uptimeSec,
        system_formatted: formatUptime(uptimeSec),
        process_seconds: procUptimeSec,
        process_formatted: formatUptime(procUptimeSec),
      },
      node_process: {
        rss_bytes: memUsage.rss,
        rss_mb: Math.round((memUsage.rss / 1024 / 1024) * 10) / 10,
        heap_used_mb: Math.round((memUsage.heapUsed / 1024 / 1024) * 10) / 10,
        heap_total_mb: Math.round((memUsage.heapTotal / 1024 / 1024) * 10) / 10,
        external_mb: Math.round((memUsage.external / 1024 / 1024) * 10) / 10,
      },
      top_processes: topProcs,
    });
  } catch (e) {
    console.error('[admin:system-resources]', e);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}

/**
 * POST /api/admin/system-resources
 * Interactive System Control & Storage Cleanup Actions.
 */
export async function POST(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const { action, target, target_file, command } = body;

    // 1. PM2 Service Control (restart / stop / start / reload)
    if (action === 'service_control') {
      const cmd = String(command || '').trim();
      const serviceName = String(target || '').trim();

      if (!['restart', 'stop', 'start', 'reload'].includes(cmd)) {
        return NextResponse.json({ success: false, error: 'أمر خدمة غير صالح' }, { status: 400 });
      }

      if (!serviceName) {
        return NextResponse.json({ success: false, error: 'اسم الخدمة مطلوب' }, { status: 400 });
      }

      if (!/^[a-zA-Z0-9_\-]+$/.test(serviceName) && serviceName !== 'all') {
        return NextResponse.json({ success: false, error: 'اسم خدمة غير صالح' }, { status: 400 });
      }

      const { stdout, stderr } = await execAsync(`pm2 ${cmd} ${serviceName}`, { timeout: 15000 });
      return NextResponse.json({
        success: true,
        message: `تم تنفيذ ${cmd} للخدمة ${serviceName} بنجاح`,
        output: (stdout || stderr || '').slice(0, 400),
      });
    }

    // 2. Clean PM2 Logs & Truncate local logs
    if (action === 'clean_logs') {
      let pm2Output = '';
      try {
        const res = await execAsync('pm2 flush', { timeout: 8000 });
        pm2Output = res.stdout;
      } catch (e: any) {
        pm2Output = e?.message || '';
      }

      const logsDir = join(PROJECT_ROOT, 'logs');
      let truncatedCount = 0;
      try {
        const files = await readdir(logsDir);
        for (const file of files) {
          if (file.endsWith('.log')) {
            try {
              await truncate(join(logsDir, file), 0);
              truncatedCount++;
            } catch {}
          }
        }
      } catch {}

      return NextResponse.json({
        success: true,
        message: `تم تفريغ سجلات PM2 وتصفير ${truncatedCount} ملف سجل محلي بنجاح`,
        details: pm2Output,
      });
    }

    // 3. Clean Old Report Charts (keeps newest 30)
    if (action === 'clean_reports') {
      const reportsDir = join(PROJECT_ROOT, 'public', 'reports');
      let deletedCount = 0;
      let freedBytes = 0;

      try {
        const files = await readdir(reportsDir);
        const fileStats: { name: string; mtime: number; size: number }[] = [];
        for (const f of files) {
          if (f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.webp')) {
            try {
              const s = await stat(join(reportsDir, f));
              fileStats.push({ name: f, mtime: s.mtimeMs, size: s.size });
            } catch {}
          }
        }

        fileStats.sort((a, b) => b.mtime - a.mtime);
        const toDelete = fileStats.slice(30);

        for (const item of toDelete) {
          try {
            await unlink(join(reportsDir, item.name));
            deletedCount++;
            freedBytes += item.size;
          } catch {}
        }
      } catch (e: any) {
        return NextResponse.json({ success: false, error: e?.message || 'فشل تنظيف التقارير' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `تم حذف ${deletedCount} صورة تقرير قديمة، وتوفير ${formatBytes(freedBytes)}`,
        deleted_count: deletedCount,
        freed_formatted: formatBytes(freedBytes),
      });
    }

    // 4. Vacuum SQLite Databases
    if (action === 'vacuum_databases') {
      const dbDir = join(PROJECT_ROOT, 'db');
      const files = await readdir(dbDir);
      const optimized: string[] = [];
      const errors: string[] = [];

      for (const f of files) {
        if (f.endsWith('.db')) {
          const dbPath = join(dbDir, f);
          try {
            const db = new Database(dbPath, { timeout: 5000 });
            db.pragma('wal_checkpoint(TRUNCATE)');
            db.exec('VACUUM;');
            db.close();
            optimized.push(f);
          } catch (err: any) {
            errors.push(`${f}: ${err?.message || 'خطأ'}`);
          }
        }
      }

      return NextResponse.json({
        success: true,
        message: `تم ضغط وتفريغ WAL بنجاح لـ ${optimized.length} قاعدة بيانات`,
        optimized,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    // 5. Clean Next.js Build Cache
    if (action === 'clean_cache') {
      const cacheDir = join(PROJECT_ROOT, '.next', 'cache');
      try {
        await execAsync(`rm -rf "${cacheDir}"/* 2>/dev/null`, { timeout: 6000 });
        return NextResponse.json({
          success: true,
          message: 'تم تفريغ كاش Next.js بنجاح',
        });
      } catch (e: any) {
        return NextResponse.json({ success: false, error: e?.message || 'فشل حذف الكاش' }, { status: 500 });
      }
    }

    // 6. Delete specific large safe file
    if (action === 'delete_file') {
      const filePath = String(target_file || '').trim();
      if (!filePath) {
        return NextResponse.json({ success: false, error: 'المسار مطلوب' }, { status: 400 });
      }

      if (!filePath.startsWith(PROJECT_ROOT)) {
        return NextResponse.json({ success: false, error: 'غير مسموح بحذف ملف خارج مجلد المشروع' }, { status: 403 });
      }

      const dangerousPatterns = ['/src/', '/.env', '/package.json', '/prisma/'];
      if (dangerousPatterns.some((p) => filePath.includes(p))) {
        return NextResponse.json({ success: false, error: 'ملف نظام محمي لا يمكن حذفه' }, { status: 403 });
      }

      try {
        const s = await stat(filePath);
        await unlink(filePath);
        return NextResponse.json({
          success: true,
          message: `تم حذف الملف بنجاح، وتوفير ${formatBytes(s.size)}`,
        });
      } catch (e: any) {
        return NextResponse.json({ success: false, error: e?.message || 'فشل حذف الملف' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: false, error: 'إجراء غير معروف' }, { status: 400 });
  } catch (e: any) {
    console.error('[system-resources:POST]', e);
    return NextResponse.json({ success: false, error: e?.message || 'internal_error' }, { status: 500 });
  }
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}
