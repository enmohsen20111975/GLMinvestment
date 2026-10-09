/**
 * GET /api/data-engine/health
 * Health-check for the data-engine databases.
 *
 * Returns a compact `{ success, status, databases: { ... } }` shape that the
 * Flutter app (lib/api/client.dart:1797) reads via `response.data`.
 *
 * Probes each table individually so a missing/empty table shows as `degraded`
 * without breaking the rest of the response.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface ProbeResult {
  status: 'ok' | 'degraded' | 'down';
  count?: number;
  last_updated?: string | null;
  error?: string;
}

function probeTable(
  db: any,
  tableName: string,
  timestampColumn: string | null = null
): ProbeResult {
  try {
    const exists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      )
      .get(tableName) as { name: string } | undefined;
    if (!exists) {
      return { status: 'down', error: `table '${tableName}' missing` };
    }
    const countRow = db.prepare(`SELECT COUNT(*) as n FROM ${tableName}`).get() as {
      n: number;
    };
    let lastUpdated: string | null = null;
    if (timestampColumn) {
      try {
        const r = db
          .prepare(
            `SELECT MAX(${timestampColumn}) as v FROM ${tableName}`
          )
          .get() as { v: string | null };
        lastUpdated = r?.v ?? null;
      } catch { // silent fallback (safe-by-design)
        /* ignore */
      }
    }
    return {
      status: countRow.n > 0 ? 'ok' : 'degraded',
      count: countRow.n,
      last_updated: lastUpdated,
    };
  } catch (e: any) {
    return { status: 'down', error: e?.message || 'unknown' };
  }
}

export async function GET() {
  const startedAt = Date.now();
  const databases: Record<string, ProbeResult> = {};
  let overall: 'healthy' | 'degraded' | 'down' = 'healthy';

  try {
    // ---- data_engine.db ----
    try {
      const { getDataEngineDb } = await import('@/lib/data-engine-db');
      const de = getDataEngineDb();
      databases.stocks = probeTable(de, 'stocks', 'last_update');
      // data_engine.db's stocks table is egksco_stocks in the actual file —
      // we probe both names so the response is honest regardless of layout.
      if (databases.stocks.status === 'down') {
        databases.stocks = probeTable(de, 'egksco_stocks', 'last_update');
      }
      databases.gold = probeTable(de, 'gold_prices', 'timestamp');
      databases.silver = probeTable(de, 'silver_prices', 'timestamp');
      databases.crypto = probeTable(de, 'crypto_prices', 'timestamp');
      databases.forex = probeTable(de, 'exchange_rates', 'timestamp');
    } catch (e: any) {
      databases.data_engine = {
        status: 'down',
        error: e?.message || 'data_engine.db unreachable',
      };
    }

    // ---- price_history (now in data_engine.db.egksco_price_history) ----
    try {
      const { getPriceHistoryDb } = await import('@/lib/data-engine-db');
      const ph = getPriceHistoryDb();
      databases.price_history = probeTable(ph, 'egksco_price_history', 'price_date');
    } catch (e: any) {
      databases.price_history = {
        status: 'down',
        error: e?.message || 'data_engine.db.egksco_price_history unreachable',
      };
    }

    // ---- stocks.db ----
    try {
      const { getStocksDb } = await import('@/lib/data-engine-db');
      const st = getStocksDb();
      databases.stocks_db = probeTable(st, 'stocks', 'last_update');
    } catch (e: any) {
      databases.stocks_db = {
        status: 'down',
        error: e?.message || 'stocks.db unreachable',
      };
    }

    // ---- Python backend (port 8010) ----
    try {
      const PY =
        process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
      const r = await fetch(`${PY}/api/risk/decision-table`, {
        signal: AbortSignal.timeout(3000),
      });
      databases.python_backend = {
        status: r.ok ? 'ok' : 'degraded',
        count: r.status,
      };
    } catch (e: any) {
      databases.python_backend = {
        status: 'down',
        error: e?.message || 'python backend unreachable',
      };
    }

    // ---- Overall roll-up ----
    const statuses = Object.values(databases).map((d) => d.status);
    if (statuses.every((s) => s === 'ok')) overall = 'healthy';
    else if (statuses.some((s) => s === 'ok')) overall = 'degraded';
    else overall = 'down';

    return NextResponse.json({
      success: true,
      status: overall,
      timestamp: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
      databases,
      summary: {
        total: statuses.length,
        ok: statuses.filter((s) => s === 'ok').length,
        degraded: statuses.filter((s) => s === 'degraded').length,
        down: statuses.filter((s) => s === 'down').length,
      },
    });
  } catch (error: any) {
    console.error('[/api/data-engine/health] Error:', error);
    return NextResponse.json(
      {
        success: false,
        status: 'down',
        error: error?.message || 'Health check failed',
        error_en: 'Health check failed',
        databases,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
