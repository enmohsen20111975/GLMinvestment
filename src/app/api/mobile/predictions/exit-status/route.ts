/**
 * GET /api/mobile/predictions/exit-status
 * ======================================
 * P41 Exit Engine (Mobile) — حالة الخروج اللحظي للتوصيات النشطة.
 *
 * Tries Python /api/market/exit-status first.
 * Falls back to predictions.db — SELECT WHERE status IN ('TARGET_HIT', 'STOPPED', 'CLOSED')
 * with exit_price, actual_return, holding_days.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PYTHON_BACKEND =
  process.env.PYTHON_BACKEND_URL ||
  process.env.VPS_API_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://localhost:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '20', 10) || 20;
  const ticker = searchParams.get('ticker') || '';
  const market = searchParams.get('market') || 'EGX';

  const params = new URLSearchParams({ limit: String(limit) });
  if (ticker) params.set('ticker', ticker.toUpperCase());

  const backendUrl = `${PYTHON_BACKEND.replace(/\/$/, '')}/api/market/exit-status?${params.toString()}`;

  // 1) Try Python first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Channel': 'exit_engine',
        },
      });
    }
  } catch {}

  // 2) Fallback — predictions.db
  try {
    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');
    const predDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!fs.existsSync(predDbPath)) {
      return NextResponse.json(
        { success: false, error: 'predictions.db not found' },
        { status: 500 }
      );
    }
    const pdb = new Database(predDbPath, { readonly: true });

    // Build WHERE for ticker / market / status
    const where: string[] = [
      "status IN ('TARGET_HIT','STOPPED','CLOSED')",
      'market = ? COLLATE NOCASE',
    ];
    const sqlParams: any[] = [market];
    if (ticker) {
      where.push('ticker = ? COLLATE NOCASE');
      sqlParams.push(ticker.toUpperCase());
    }

    const rows: any[] = pdb
      .prepare(
        `SELECT ticker, signal, prediction_date, entry_price, target_price,
                stop_loss, exit_price, actual_return, holding_days, status,
                exit_type, exit_reason, market
         FROM predictions
         WHERE ${where.join(' AND ')}
         ORDER BY prediction_date DESC, id DESC
         LIMIT ?`
      )
      .all(...sqlParams, limit)
      .map((r: any) => {
        // action derivation from data, not mock
        const isStop = r.status === 'STOPPED' || r.hit_stop === 1;
        const isTarget = r.status === 'TARGET_HIT' || r.hit_target === 1;
        const action = isStop ? 'EXIT' : isTarget ? 'TAKE_PROFIT' : 'HOLD';
        const current_gain_pct =
          r.exit_price != null && r.entry_price
            ? Number(
                ((Number(r.exit_price) - Number(r.entry_price)) /
                  Number(r.entry_price)) *
                  100
              )
            : null;
        const exit_pct =
          isStop && r.stop_loss && r.entry_price
            ? Math.min(
                1,
                Math.abs(
                  (Number(r.entry_price) - Number(r.stop_loss)) /
                    Number(r.entry_price)
                )
              )
            : isTarget && r.target_price && r.entry_price
            ? Math.min(
                1,
                Math.abs(
                  (Number(r.target_price) - Number(r.entry_price)) /
                    Number(r.entry_price)
                )
              )
            : null;
        return {
          ticker: r.ticker,
          signal: r.signal,
          prediction_date: r.prediction_date,
          entry_price: Number(r.entry_price),
          target_price: r.target_price != null ? Number(r.target_price) : null,
          stop_loss: r.stop_loss != null ? Number(r.stop_loss) : null,
          exit_price: r.exit_price != null ? Number(r.exit_price) : null,
          actual_return: r.actual_return != null ? Number(r.actual_return) : null,
          holding_days: r.holding_days || 0,
          status: r.status,
          exit_type: r.exit_type,
          exit_reason: r.exit_reason,
          market: r.market,
          action,
          reason_code: isStop ? 'STOP_HIT' : isTarget ? 'TARGET_HIT' : 'HOLD',
          current_gain_pct,
          exit_pct,
        };
      });

    // Summary counts by action
    const summary = {
      HOLD: rows.filter((r) => r.action === 'HOLD').length,
      TAKE_PROFIT: rows.filter((r) => r.action === 'TAKE_PROFIT').length,
      REDUCE: 0,
      EXIT: rows.filter((r) => r.action === 'EXIT').length,
    };

    pdb.close();

    return NextResponse.json(
      {
        success: true,
        source: 'sqlite_fallback',
        market,
        ticker: ticker || null,
        exit_statuses: rows,
        count: rows.length,
        summary,
        channel: 'exit_engine',
        generated_at: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Channel': 'exit_engine',
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
