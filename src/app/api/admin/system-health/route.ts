import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import net from 'net';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

interface ServiceCheck {
  id: string;
  name_ar: string;
  type: 'http' | 'tcp' | 'process' | 'file';
  status: 'online' | 'offline' | 'degraded' | 'unknown';
  latency_ms?: number;
  message: string;
  details?: Record<string, unknown>;
}

/** Quick TCP connect check — resolves true if the port is open. */
function checkTcpPort(host: string, port: number, timeoutMs = 2000): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = new net.Socket();
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => {
      const latency = Date.now() - start;
      sock.destroy();
      resolve({ ok: true, latencyMs: latency });
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    sock.once('error', (err) => {
      sock.destroy();
      resolve({ ok: false, error: err.message });
    });
    sock.connect(port, host);
  });
}

async function checkHttp(url: string, timeoutMs = 3000): Promise<{ ok: boolean; latencyMs?: number; status?: number; error?: string }> {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    return { ok: res.ok, latencyMs: Date.now() - start, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function findProcess(pattern: string): Promise<{ found: boolean; pids: number[]; count: number }> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-f', pattern], { timeout: 3000 });
    const pids = stdout.trim().split('\n').filter(Boolean).map(s => Number(s)).filter(n => Number.isFinite(n) && n > 0);
    return { found: pids.length > 0, pids, count: pids.length };
  } catch {
    return { found: false, pids: [], count: 0 };
  }
}

function dbFileMeta(name: string): { exists: boolean; sizeMb: string | null; modified: string | null } {
  const path = join(process.cwd(), 'db', name);
  if (!existsSync(path)) return { exists: false, sizeMb: null, modified: null };
  try {
    const st = statSync(path);
    return {
      exists: true,
      sizeMb: (st.size / 1024 / 1024).toFixed(2),
      modified: st.mtime.toISOString(),
    };
  } catch {
    return { exists: false, sizeMb: null, modified: null };
  }
}

/**
 * GET /api/admin/system-health
 * Checks the health of every long-running service the platform depends on:
 *   - Next.js (port 3000)
 *   - Python data engine (port 8010)
 *   - Data Engine (port 3010 / 3011)
 *   - News Agent (port 3002)
 *   - WebSocket relay (port 3005)
 *   - Telegram bot (process check)
 *   - Database files (existence + freshness)
 */
export async function GET(req: NextRequest) {
  const authError = await requireAdminAsync(req);
  if (authError) return authError;

  try {
    const services: ServiceCheck[] = [];

    // 1) Next.js
    {
      const r = await checkHttp('http://127.0.0.1:3000/api/health', 3000);
      services.push({
        id: 'nextjs',
        name_ar: 'Next.js (المنصة الرئيسية)',
        type: 'http',
        status: r.ok ? 'online' : 'offline',
        latency_ms: r.latencyMs,
        message: r.ok
          ? `يعمل (${r.status})`
          : `غير متاح — ${r.error || r.status || 'unknown'}`,
      });
    }

    // 2) Python data engine (port 8010)
    {
      const r = await checkTcpPort('127.0.0.1', 8010, 2000);
      services.push({
        id: 'python_engine',
        name_ar: 'Python Data Engine (8010)',
        type: 'tcp',
        status: r.ok ? 'online' : 'offline',
        latency_ms: r.latencyMs,
        message: r.ok ? 'يعمل' : `غير متصل — ${r.error || 'unknown'}`,
      });
    }

    // 3) Data Engine (port 3010)
    {
      const r = await checkTcpPort('127.0.0.1', 3010, 2000);
      services.push({
        id: 'data_engine',
        name_ar: 'Data Engine (3010)',
        type: 'tcp',
        status: r.ok ? 'online' : 'offline',
        latency_ms: r.latencyMs,
        message: r.ok ? 'يعمل' : `غير متصل — ${r.error || 'unknown'}`,
      });
    }

    // 4) News Agent (port 3002)
    {
      const r = await checkTcpPort('127.0.0.1', 3002, 2000);
      services.push({
        id: 'news_agent',
        name_ar: 'News Agent (3002)',
        type: 'tcp',
        status: r.ok ? 'online' : 'offline',
        latency_ms: r.latencyMs,
        message: r.ok ? 'يعمل' : `غير متصل — ${r.error || 'unknown'}`,
      });
    }

    // 5) WebSocket relay (port 3005)
    {
      const r = await checkTcpPort('127.0.0.1', 3005, 2000);
      services.push({
        id: 'websocket',
        name_ar: 'WebSocket Relay (3005)',
        type: 'tcp',
        status: r.ok ? 'online' : 'offline',
        latency_ms: r.latencyMs,
        message: r.ok ? 'يعمل' : `غير متصل — ${r.error || 'unknown'}`,
      });
    }

    // 6) Telegram bot (process check)
    {
      const r = await findProcess('telegram');
      services.push({
        id: 'telegram_bot',
        name_ar: 'Telegram Bot',
        type: 'process',
        status: r.found ? 'online' : 'offline',
        message: r.found
          ? `يعمل (${r.count} عملية)`
          : 'غير مشغّل',
        details: { pids: r.pids.slice(0, 5) },
      });
    }

    // 7) Critical DB files
    const criticalDbs = ['auth.db', 'stocks.db', 'predictions.db', 'data_engine.db', 'news.db'];
    for (const dbName of criticalDbs) {
      const meta = dbFileMeta(dbName);
      services.push({
        id: `db_${dbName}`,
        name_ar: `قاعدة البيانات: ${dbName}`,
        type: 'file',
        status: meta.exists ? 'online' : 'offline',
        message: meta.exists
          ? `متاحة — ${meta.sizeMb} MB`
          : 'الملف غير موجود',
        details: { size_mb: meta.sizeMb, modified: meta.modified },
      });
    }

    const online = services.filter(s => s.status === 'online').length;
    const offline = services.filter(s => s.status === 'offline').length;
    const degraded = services.filter(s => s.status === 'degraded').length;
    const total = services.length;
    const healthScore = total > 0 ? Math.round((online / total) * 100) : 0;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        total,
        online,
        offline,
        degraded,
        health_score: healthScore,
      },
      services,
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
  }
}
