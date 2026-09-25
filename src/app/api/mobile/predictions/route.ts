/**
 * GET /api/mobile/predictions
 * ==========================
 * Mobile predictions list — falls back to predictions.db when Python is down.
 * Returns latest 50 predictions: ticker, signal, status, entry/target/stop, etc.
 */

import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') || '50', 10) || 50,
    200
  );

  // 1) Try Python first
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/daily/rebuild-predictions${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
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

    const rows: any[] = pdb
      .prepare(
        `SELECT ticker, signal, signal_type, prediction_date, entry_price,
                target_price, stop_loss, exit_price, actual_return, holding_days,
                master_score, confidence, status, market, persona, risk_reward,
                hit_target, hit_stop, is_correct
         FROM predictions
         WHERE market = ? COLLATE NOCASE
         ORDER BY prediction_date DESC, id DESC
         LIMIT ?`
      )
      .all(market, limit)
      .map((r: any) => ({
        ticker: r.ticker,
        signal: r.signal,
        signal_type: r.signal_type,
        prediction_date: r.prediction_date,
        entry_price: Number(r.entry_price),
        target_price: r.target_price != null ? Number(r.target_price) : null,
        stop_loss: r.stop_loss != null ? Number(r.stop_loss) : null,
        exit_price: r.exit_price != null ? Number(r.exit_price) : null,
        actual_return: r.actual_return != null ? Number(r.actual_return) : null,
        holding_days: r.holding_days || 0,
        master_score: r.master_score != null ? Number(r.master_score) : null,
        confidence: r.confidence != null ? Number(r.confidence) : null,
        status: r.status,
        market: r.market,
        persona: r.persona,
        risk_reward: r.risk_reward != null ? Number(r.risk_reward) : null,
        hit_target: r.hit_target === 1,
        hit_stop: r.hit_stop === 1,
        is_correct: r.is_correct === 1,
      }));

    pdb.close();

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      market,
      predictions: rows,
      count: rows.length,
      generated_at: new Date().toISOString(),
    });
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
