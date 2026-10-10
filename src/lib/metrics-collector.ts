/**
 * metrics-collector.ts
 * ====================
 * Reads current system metrics and returns a `SnapshotData` object + PM2
 * process list. Designed to be called from the instrumentation hook every
 * 15 seconds and also from the live `/api/admin/system-resources` endpoint.
 *
 * All reads are GRACEFUL — if any single metric fails we set it to null/0
 * and continue, never throwing.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import os from 'os';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SnapshotData {
  ts: string; // ISO8601 UTC
  cpu: number; // 0-100
  mem_pct: number; // 0-100
  mem_used_mb: number;
  mem_total_mb: number;
  disk_pct: number; // root disk %
  disk_used_gb: number;
  disk_total_gb: number;
  load1: number;
  load5: number;
  load15: number;
  pm2_online: number;
  pm2_total: number;
  pm2_total_cpu: number;
  pm2_total_mem_mb: number;
  node_rss_mb: number;
  net_rx_kb: number; // KB/s delta since last reading
  net_tx_kb: number; // KB/s delta since last reading
}

export interface Pm2Process {
  pm_id: number;
  name: string;
  status: string;
  pid: number;
  cpu: number;
  memory_mb: number;
  restarts: number;
  uptime_ms: number;
}

export interface CollectResult {
  snapshot: SnapshotData;
  pm2Processes: Pm2Process[];
}

// ---------------------------------------------------------------------------
// Module-level state for delta metrics (CPU + network)
// ---------------------------------------------------------------------------

interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

let _prevCpu: CpuTimes | null = null;
let _prevCpuTimeMs = 0;

interface NetSnapshot {
  rxBytes: number;
  txBytes: number;
  tsMs: number;
}

let _prevNet: NetSnapshot | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round1(n: number | null | undefined): number {
  if (n === null || n === undefined || Number.isNaN(n)) return 0;
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------

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
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

async function computeCpuPercent(): Promise<number> {
  const now = Date.now();
  const cur = await readProcStat();
  if (!cur) {
    // Fallback: derive from load avg (rough)
    const cpus = os.cpus().length || 1;
    return Math.max(0, Math.min(100, (os.loadavg()[0] / cpus) * 100));
  }
  if (!_prevCpu || _prevCpuTimeMs === 0) {
    _prevCpu = cur;
    _prevCpuTimeMs = now;
    // First call — fallback to load-avg based estimate so we have *some* number
    const cpus = os.cpus().length || 1;
    return Math.max(0, Math.min(100, (os.loadavg()[0] / cpus) * 100));
  }
  const totalNow = cur.user + cur.nice + cur.sys + cur.idle + cur.irq;
  const totalPrev = _prevCpu.user + _prevCpu.nice + _prevCpu.sys + _prevCpu.idle + _prevCpu.irq;
  const idleNow = cur.idle;
  const idlePrev = _prevCpu.idle;
  const totalDelta = totalNow - totalPrev;
  const idleDelta = idleNow - idlePrev;
  _prevCpu = cur;
  _prevCpuTimeMs = now;
  if (totalDelta <= 0) return 0;
  const busy = totalDelta - idleDelta;
  return Math.max(0, Math.min(100, (busy / totalDelta) * 100));
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

function readMemory(): { pct: number; usedMb: number; totalMb: number } {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const pct = total > 0 ? (used / total) * 100 : 0;
  return {
    pct: round1(pct),
    usedMb: round1(used / 1024 / 1024),
    totalMb: round1(total / 1024 / 1024),
  };
}

// ---------------------------------------------------------------------------
// Disk (root)
// ---------------------------------------------------------------------------

interface DiskRoot {
  pct: number;
  usedGb: number;
  totalGb: number;
}

async function readRootDisk(): Promise<DiskRoot> {
  try {
    const { stdout } = await execAsync('df -P -B1 /', { timeout: 5000 });
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) return { pct: 0, usedGb: 0, totalGb: 0 };
    const parts = lines[1].trim().split(/\s+/);
    if (parts.length < 6) return { pct: 0, usedGb: 0, totalGb: 0 };
    const total = Number(parts[1]) || 0;
    const used = Number(parts[2]) || 0;
    if (total <= 0) return { pct: 0, usedGb: 0, totalGb: 0 };
    return {
      pct: round1((used / total) * 100),
      usedGb: round1(used / 1024 / 1024 / 1024),
      totalGb: round1(total / 1024 / 1024 / 1024),
    };
  } catch { // silent fallback (safe-by-design)
    return { pct: 0, usedGb: 0, totalGb: 0 };
  }
}

// ---------------------------------------------------------------------------
// PM2 services
// ---------------------------------------------------------------------------

interface Pm2RawEntry {
  pm_id?: number;
  name?: string;
  pid?: number;
  monit?: { memory?: number; cpu?: number };
  pm2_env?: {
    status?: string;
    restart_time?: number;
    pm_uptime?: number;
  };
}

async function readPm2(): Promise<{ processes: Pm2Process[]; online: number; total: number; totalCpu: number; totalMemMb: number }> {
  const empty = { processes: [] as Pm2Process[], online: 0, total: 0, totalCpu: 0, totalMemMb: 0 };
  try {
    const { stdout } = await execAsync('pm2 jlist', { timeout: 4000 });
    let parsed: Pm2RawEntry[];
    try {
      parsed = JSON.parse(stdout);
    } catch { // silent fallback (safe-by-design)
      return empty;
    }
    if (!Array.isArray(parsed)) return empty;

    const processes: Pm2Process[] = [];
    let online = 0;
    let totalCpu = 0;
    let totalMemMb = 0;

    for (const p of parsed) {
      const status = p?.pm2_env?.status || 'stopped';
      const cpu = Number(p?.monit?.cpu || 0);
      const memBytes = Number(p?.monit?.memory || 0);
      const memMb = memBytes / 1024 / 1024;
      if (status === 'online') online++;
      totalCpu += cpu;
      totalMemMb += memMb;

      const uptimeMs = p?.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0;

      processes.push({
        pm_id: p?.pm_id ?? -1,
        name: p?.name || 'unnamed',
        status,
        pid: p?.pid || 0,
        cpu: round1(cpu),
        memory_mb: round1(memMb),
        restarts: p?.pm2_env?.restart_time || 0,
        uptime_ms: uptimeMs,
      });
    }

    return {
      processes,
      online,
      total: parsed.length,
      totalCpu: round1(totalCpu),
      totalMemMb: round1(totalMemMb),
    };
  } catch { // silent fallback (safe-by-design)
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Network (KB/s delta since last reading)
// ---------------------------------------------------------------------------

async function readNetDev(): Promise<{ rxBytes: number; txBytes: number } | null> {
  try {
    const content = await readFile('/proc/net/dev', 'utf8');
    const lines = content.split('\n').slice(2); // skip header lines
    let rxTotal = 0;
    let txTotal = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 10) continue;
      // Skip loopback to avoid double counting local traffic
      const iface = parts[0].replace(':', '');
      if (iface === 'lo') continue;
      // Skip virtual interfaces (docker, veth, etc.)
      if (iface.startsWith('docker') || iface.startsWith('veth') || iface.startsWith('br-')) continue;
      rxTotal += Number(parts[1]) || 0;
      txTotal += Number(parts[9]) || 0;
    }
    return { rxBytes: rxTotal, txBytes: txTotal };
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

async function computeNetRate(): Promise<{ rxKbS: number; txKbS: number }> {
  const cur = await readNetDev();
  const now = Date.now();
  if (!cur) return { rxKbS: 0, txKbS: 0 };

  if (!_prevNet) {
    _prevNet = { rxBytes: cur.rxBytes, txBytes: cur.txBytes, tsMs: now };
    return { rxKbS: 0, txKbS: 0 };
  }

  const dtSec = Math.max(0.001, (now - _prevNet.tsMs) / 1000);
  const rxDelta = Math.max(0, cur.rxBytes - _prevNet.rxBytes);
  const txDelta = Math.max(0, cur.txBytes - _prevNet.txBytes);

  _prevNet = { rxBytes: cur.rxBytes, txBytes: cur.txBytes, tsMs: now };

  return {
    rxKbS: round1(rxDelta / 1024 / dtSec),
    txKbS: round1(txDelta / 1024 / dtSec),
  };
}

// ---------------------------------------------------------------------------
// Node RSS
// ---------------------------------------------------------------------------

function readNodeRss(): number {
  try {
    return round1(process.memoryUsage().rss / 1024 / 1024);
  } catch { // silent fallback (safe-by-design)
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function collectSnapshot(): Promise<CollectResult> {
  const ts = new Date().toISOString();

  // Run independent reads in parallel for speed
  const [cpu, mem, disk, pm2, net] = await Promise.all([
    computeCpuPercent(),
    Promise.resolve(readMemory()),
    readRootDisk(),
    readPm2(),
    computeNetRate(),
  ]);

  const loadAvg = os.loadavg();

  const snapshot: SnapshotData = {
    ts,
    cpu: round1(cpu),
    mem_pct: mem.pct,
    mem_used_mb: mem.usedMb,
    mem_total_mb: mem.totalMb,
    disk_pct: disk.pct,
    disk_used_gb: disk.usedGb,
    disk_total_gb: disk.totalGb,
    load1: round1(loadAvg[0]),
    load5: round1(loadAvg[1]),
    load15: round1(loadAvg[2]),
    pm2_online: pm2.online,
    pm2_total: pm2.total,
    pm2_total_cpu: pm2.totalCpu,
    pm2_total_mem_mb: pm2.totalMemMb,
    node_rss_mb: readNodeRss(),
    net_rx_kb: net.rxKbS,
    net_tx_kb: net.txKbS,
  };

  return {
    snapshot,
    pm2Processes: pm2.processes,
  };
}
