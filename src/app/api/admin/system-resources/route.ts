import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import os from 'os';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

// P0-14-ASYNC fix (2026-09-27): replaced blocking readFileSync('/proc/stat') with
// async readFile from fs/promises so the event loop is not blocked per request.
async function readProcStat(): Promise<CpuTimes | null> {
  try {
    // Node.js does not expose per-CPU times in a portable way; rely on
    // /proc/stat on Linux (sandbox runs Linux).
    const content = await readFile('/proc/stat', 'utf8');
    const line = content.split('\n')[0];
    const parts = line.trim().split(/\s+/);
    // parts[0] = 'cpu'
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

// P0-14-ASYNC fix (2026-09-27): computeCpuPercent now async because it awaits readProcStat.
async function computeCpuPercent(): Promise<number> {
  const now = Date.now();
  const cur = await readProcStat();
  if (!cur) return -1;
  if (!_prevCpu || _prevCpuTime === 0) {
    _prevCpu = cur;
    _prevCpuTime = now;
    return -1; // need 2 samples
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
      const [fs, size, used, avail, usedPct, ...mountParts] = parts;
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
    // Use ps to list processes by CPU usage; portable across Linux.
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

/**
 * GET /api/admin/system-resources
 * Returns live CPU / Memory / Disk usage + top processes.
 */
export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    // CPU
    const cpuPercent = await computeCpuPercent();
    const cpuCount = os.cpus().length;
    const cpuModel = os.cpus()[0]?.model || 'unknown';
    const loadAvg = os.loadavg();

    // Memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const usedMemPercent = Math.round((usedMem / totalMem) * 100);

    // Uptime
    const uptimeSec = os.uptime();
    const procUptimeSec = process.uptime();

    // Disk
    const disks = await readDiskInfo();

    // Top processes
    const topProcs = await readTopProcesses(5);

    // Node.js process info
    const memUsage = process.memoryUsage();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
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
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
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
