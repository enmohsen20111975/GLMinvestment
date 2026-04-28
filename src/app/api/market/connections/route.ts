/**
 * GET /api/market/connections
 * 
 * Diagnose which data sources are available and working.
 * 
 * Architecture:
 *   Hostinger (Node.js only)  → VPS (Python only, 72.61.137.86:8010) → Database fallback
 *   Local dev  (has Python)   → egxpy local (child_process)            → Database fallback
 */
import { NextResponse } from 'next/server';
import { isEgxpyAvailable } from '@/lib/egxpy-bridge';
import { isVpsAvailable, getVpsServiceUrl } from '@/lib/vps-adapter';
import { ensureInitialized, getLightDb, getHeavyDb } from '@/lib/egx-db';

export async function GET() {
  const results: Record<string, {
    available: boolean;
    message: string;
    details?: string;
    latency_ms?: number;
    role?: string;
  }> = {};

  const vpsUrl = getVpsServiceUrl();
  const isProductionHostinger = !!(vpsUrl && !vpsUrl.includes('127.0.0.1') && !vpsUrl.includes('localhost'));

  // ---- 1. Check VPS Python service (PRIMARY on Hostinger) ----
  const t1 = Date.now();
  try {
    if (!vpsUrl) {
      results['vps_python'] = {
        available: false,
        role: 'unavailable',
        message: 'EGXPY_SERVICE_URL not set - no VPS connection configured',
        details: 'Set EGXPY_SERVICE_URL=http://72.61.137.86:8010 in .env',
      };
    } else {
      const vpsOk = await isVpsAvailable();
      results['vps_python'] = {
        available: vpsOk,
        role: vpsOk ? 'PRIMARY' : 'PRIMARY (down)',
        message: vpsOk
          ? `VPS Python service CONNECTED at ${vpsUrl}`
          : `VPS Python service NOT REACHABLE at ${vpsUrl}`,
        details: vpsOk ? vpsUrl : 'Check: Is egxpy-bridge running on VPS? Is port 8010 open in firewall?',
        latency_ms: Date.now() - t1,
      };
    }
  } catch (err) {
    results['vps_python'] = {
      available: false,
      role: 'PRIMARY (error)',
      message: `Connection error: ${String(err)}`,
      latency_ms: Date.now() - t1,
    };
  }

  // ---- 2. Check egxpy local (only relevant in dev, NOT on Hostinger) ----
  if (!isProductionHostinger) {
    const t2 = Date.now();
    try {
      const egxpyOk = await isEgxpyAvailable();
      results['egxpy_local'] = {
        available: egxpyOk,
        role: egxpyOk ? 'PRIMARY (dev)' : 'N/A',
        message: egxpyOk
          ? 'egxpy available locally - live data from TradingView'
          : 'egxpy not available locally (need Python + egxpy installed)',
        latency_ms: Date.now() - t2,
      };
    } catch (err) {
      results['egxpy_local'] = {
        available: false,
        role: 'N/A',
        message: `Error: ${String(err)}`,
        latency_ms: Date.now() - t2,
      };
    }
  } else {
    results['egxpy_local'] = {
      available: false,
      role: 'disabled',
      message: 'Hostinger is Node.js only - egxpy local not applicable (VPS handles Python)',
    };
  }

  // ---- 3. Check local SQLite database (singletons, no file reads) ----
  const t3 = Date.now();
  try {
    await ensureInitialized();
    const lightDb = getLightDb();
    const stats = lightDb.prepare(`
      SELECT 
        COUNT(*) as total_stocks,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_stocks,
        MAX(last_update) as latest_update,
        COUNT(DISTINCT sector) as sector_count
      FROM stocks
    `).get() as { total_stocks: number; active_stocks: number; latest_update: string | null; sector_count: number };

    let priceCount = 0;
    try {
      const heavyDb = getHeavyDb();
      const pc = heavyDb.prepare('SELECT COUNT(*) as cnt FROM stock_price_history').get() as { cnt: number };
      priceCount = pc.cnt;
    } catch {
      // Heavy DB not available
    }

    results['database'] = {
      available: true,
      role: 'FALLBACK',
      message: `Database OK - ${stats.active_stocks} active stocks`,
      details: `Last update: ${stats.latest_update || 'unknown'} | ${priceCount} price points | ${stats.sector_count} sectors`,
      latency_ms: Date.now() - t3,
    };
  } catch (err) {
    results['database'] = {
      available: false,
      role: 'FALLBACK',
      message: `Database error: ${String(err)}`,
      latency_ms: Date.now() - t3,
    };
  }

  // ---- 4. Summary ----
  const primarySource = results['vps_python']?.available ? 'vps_python'
    : (!isProductionHostinger && results['egxpy_local']?.available ? 'egxpy_local' : 'database');
  const anyLiveSource = results['vps_python']?.available || results['egxpy_local']?.available;

  const summary = anyLiveSource
    ? `LIVE data via ${isProductionHostinger ? 'VPS Python service' : (results['vps_python']?.available ? 'VPS' : 'local egxpy')}`
    : 'NO live data source - using stale database data only';

  const priorityList = isProductionHostinger
    ? ['1. VPS Python Service (PRIMARY)', '2. Database (fallback)']
    : (vpsUrl
      ? ['1. VPS Python Service (PRIMARY)', '2. egxpy local (dev)', '3. Database (fallback)']
      : ['1. egxpy local (PRIMARY)', '2. Database (fallback)']);

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    environment: isProductionHostinger ? 'production (Hostinger - Node.js only)' : 'development',
    architecture: {
      hostinger: 'Node.js only (Next.js)',
      vps: 'Python only (egxpy-bridge FastAPI)',
      vps_ip: '72.61.137.86',
      vps_port: 8010,
      connection: vpsUrl || 'not configured',
    },
    summary,
    data_source_priority: priorityList,
    active_source: primarySource,
    sources: results,
    recommendations: anyLiveSource
      ? []
      : isProductionHostinger
        ? [
            'VPS Python service is NOT reachable. To fix:',
            '1. SSH into VPS: ssh root@72.61.137.86',
            '2. Deploy egxpy-bridge: cd /opt/egxpy-bridge && ./deploy.sh',
            '3. Verify: curl http://localhost:8010/health',
            '4. Ensure port 8010 is open in VPS firewall',
          ]
        : [
            'No live data source available. To fix:',
            'Option A (local dev): pip install egxpy',
            'Option B (VPS): Set EGXPY_SERVICE_URL=http://72.61.137.86:8010 in .env',
          ],
  });
}
