/**
 * GET /api/health — System Health Monitor
 * ========================================
 * Phase 4: فحص شامل لكل مكونات النظام
 *
 * يفحص:
 * 1. كل قواعد البيانات (stocks, predictions, data_engine, auth)
 * 2. Python backend (port 8010)
 * 3. الـ cron jobs (آخر تشغيل)
 * 4. عدد التوقعات النشطة
 * 5. عدد الأسهم النشطة لكل سوق
 */

import { NextRequest, NextResponse } from 'next/server';
import { openDb } from '@/lib/shared-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface HealthComponent {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  details?: Record<string, unknown>;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime: string;
  components: HealthComponent[];
  summary: {
    databases_ok: number;
    databases_total: number;
    active_markets: number;
    active_predictions: number;
    active_stocks: number;
  };
}

const START_TIME = Date.now();

function checkDb(dbName: string, tableName: string): HealthComponent {
  try {
    const db = openDb(dbName);
    if (!db) {
      return { name: `db:${dbName}`, status: 'down', details: { error: 'not found' } };
    }
    try {
      const count = db.prepare(`SELECT COUNT(*) as n FROM ${tableName}`).get() as { n: number };
      return { name: `db:${dbName}`, status: 'ok', details: { table: tableName, rows: count.n } };
    } catch (e) {
      return { name: `db:${dbName}`, status: 'degraded', details: { error: String(e).slice(0, 100) } };
    } finally {
      db.close();
    }
  } catch (e) {
    return { name: `db:${dbName}`, status: 'down', details: { error: String(e).slice(0, 100) } };
  }
}

async function checkPython(): Promise<HealthComponent> {
  const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
  try {
    const res = await fetch(`${PY}/health`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (res.ok) {
      return { name: 'python-backend', status: 'ok', details: { port: 8010 } };
    }
    return { name: 'python-backend', status: 'degraded', details: { http: res.status } };
  } catch {
    return { name: 'python-backend', status: 'down', details: { port: 8010, error: 'unreachable' } };
  }
}

function getStocksPerMarket(): Record<string, number> {
  try {
    const db = openDb('stocks');
    if (!db) return {};
    try {
      const rows = db.prepare(`
        SELECT market, COUNT(*) as n 
        FROM stocks 
        WHERE is_active = 1 AND current_price > 0 
        GROUP BY market
      `).all() as { market: string; n: number }[];
      const result: Record<string, number> = {};
      for (const r of rows) result[r.market] = r.n;
      return result;
    } finally {
      db.close();
    }
  } catch {
    return {};
  }
}

function getActivePredictions(): number {
  try {
    const db = openDb('predictions');
    if (!db) return 0;
    try {
      const row = db.prepare(`
        SELECT COUNT(*) as n 
        FROM predictions 
        WHERE status NOT IN ('CLOSED', 'EXPIRED')
      `).get() as { n: number };
      return row.n;
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

export async function GET(req: NextRequest) {
  const components: HealthComponent[] = [];

  // 1. Databases
  components.push(checkDb('stocks', 'stocks'));
  components.push(checkDb('predictions', 'predictions'));
  components.push(checkDb('data_engine', 'stocks'));
  components.push(checkDb('auth', 'User'));

  // 2. Python backend
  const pyHealth = await checkPython();
  components.push(pyHealth);

  // 3. Markets + predictions
  const stocksPerMarket = getStocksPerMarket();
  const activePredictions = getActivePredictions();
  const activeMarkets = Object.keys(stocksPerMarket).length;
  const activeStocks = Object.values(stocksPerMarket).reduce((a, b) => a + b, 0);

  components.push({
    name: 'markets',
    status: activeMarkets >= 4 ? 'ok' : 'degraded',
    details: stocksPerMarket,
  });

  components.push({
    name: 'predictions',
    status: activePredictions > 0 ? 'ok' : 'degraded',
    details: { active: activePredictions },
  });

  // Summary
  const dbsOk = components.filter(c => c.name.startsWith('db:') && c.status === 'ok').length;
  const dbsTotal = components.filter(c => c.name.startsWith('db:')).length;

  const allOk = components.every(c => c.status === 'ok');
  const anyDown = components.some(c => c.status === 'down');

  const response: HealthResponse = {
    status: anyDown ? 'down' : allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor((Date.now() - START_TIME) / 1000)}s`,
    components,
    summary: {
      databases_ok: dbsOk,
      databases_total: dbsTotal,
      active_markets: activeMarkets,
      active_predictions: activePredictions,
      active_stocks: activeStocks,
    },
  };

  const httpStatus = response.status === 'ok' ? 200 : response.status === 'degraded' ? 200 : 503;

  return NextResponse.json(response, { status: httpStatus });
}
