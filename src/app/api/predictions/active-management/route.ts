/**
 * GET /api/predictions/active-management
 * =======================================
 * P0-FIX (API-FALLBACKS-WAVE-2): fallback to SQLite when Python backend is down.
 * Reads from predictions.db.predictions + stocks.db.stocks for current price.
 * No mock data (Rule 27).
 *
 * Tries Python /api/predictions/active-management first (5s timeout).
 * On failure, returns predictions WHERE status = 'ACTIVE' with current_price
 * joined from stocks.db.stocks and unrealized_pnl_pct computed.
 *
 * Shape: { success, source: 'sqlite_fallback', positions: [...], count }
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

const MARKET_MAP: Record<string, string> = {
  EGX: 'EGX',
  TADAWUL: 'TADAWUL',
  KSA: 'TADAWUL',
  KSE: 'KSE',
  QSE: 'QSE',
  US: 'US',
  CRYPTO: 'CRYPTO',
};

interface ActivePosition {
  ticker: string;
  market: string;
  signal: string;
  status: string | null;
  persona: string | null;
  entry_price: number;
  target_price: number;
  target_price_2: number | null;
  stop_loss: number;
  current_price: number | null;
  risk_reward: number;
  master_score: number;
  confidence: number | null;
  prediction_date: string;
  unrealized_pnl_pct: number | null;
  unrealized_pnl_egp: number | null;
  distance_to_target_pct: number | null;
  distance_to_stop_pct: number | null;
  holding_days: number | null;
  exit_type: string | null;
  kill_filter_result: string | null;
  name_ar: string | null;
  sector: string | null;
  urgency: 'high' | 'medium' | 'low';
}

function computeUrgency(p: {
  distance_to_target_pct: number | null;
  distance_to_stop_pct: number | null;
}): 'high' | 'medium' | 'low' {
  // Urgency heuristic:
  //   - "high" if within 5% of either stop or target
  //   - "medium" if within 15%
  //   - "low" otherwise
  const dists = [p.distance_to_target_pct, p.distance_to_stop_pct].filter(
    (v): v is number => v !== null && Number.isFinite(v)
  );
  if (dists.length === 0) return 'low';
  const minDist = Math.min(...dists.map((d) => Math.abs(d)));
  if (minDist <= 5) return 'high';
  if (minDist <= 15) return 'medium';
  return 'low';
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // 1) Try Python first (5s timeout)
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/predictions/active-management${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2) Fallback — read from predictions.db + stocks.db
  try {
    const path = require('path');
    const fs = require('fs');

    const predictionsDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(predictionsDbPath)) {
      return NextResponse.json(
        { success: false, error: 'predictions.db not found' },
        { status: 500 }
      );
    }
    const Database = require('better-sqlite3');
    const db = new Database(predictionsDbPath, { readonly: true });

    const marketRaw = (url.searchParams.get('market') || 'EGX').toUpperCase();
    const market = MARKET_MAP[marketRaw] || 'EGX';
    const persona = url.searchParams.get('persona')?.trim().toLowerCase();
    const limitRaw = Number(url.searchParams.get('limit') || 100);
    const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 100));

    const where: string[] = ["status = 'ACTIVE'", 'market = ?'];
    const params: unknown[] = [market];

    if (persona && persona !== 'all') {
      where.push("LOWER(COALESCE(persona, '')) = ?");
      params.push(persona);
    }

    const sql = `
      SELECT
        ticker, signal, status, persona, market,
        entry_price, target_price, target_price_2, stop_loss,
        risk_reward, master_score, confidence,
        prediction_date, holding_days, exit_type, kill_filter_result
      FROM predictions
      WHERE ${where.join(' AND ')}
      ORDER BY master_score DESC, prediction_date DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    db.close();

    // Join current_price + name_ar + sector from stocks.db
    let stocksLookup: Map<string, { current_price: number; sector: string; name_ar: string }> = new Map();
    if (fs.existsSync(stocksDbPath)) {
      try {
        const stocksDb = new Database(stocksDbPath, { readonly: true });
        const stockRows = stocksDb
          .prepare(`SELECT ticker, current_price, sector, name_ar FROM stocks`)
          .all() as Array<Record<string, unknown>>;
        for (const r of stockRows) {
          stocksLookup.set(String(r.ticker), {
            current_price: Number(r.current_price || 0),
            sector: String(r.sector || ''),
            name_ar: String(r.name_ar || r.ticker || ''),
          });
        }
        stocksDb.close();
      } catch {}
    }

    const positions: ActivePosition[] = rows.map((r) => {
      const entry = Number(r.entry_price ?? 0);
      const target = Number(r.target_price ?? 0);
      const stop = Number(r.stop_loss ?? 0);
      const lookup = stocksLookup.get(String(r.ticker));
      const currentPrice = lookup ? lookup.current_price : null;
      const unrealizedPnlPct =
        currentPrice !== null && entry > 0
          ? Math.round(((currentPrice - entry) / entry) * 10000) / 100
          : null;
      const unrealizedPnlEgp =
        currentPrice !== null ? Math.round((currentPrice - entry) * 100) / 100 : null;
      const distanceToTargetPct =
        currentPrice !== null && target > 0
          ? Math.round(((target - currentPrice) / currentPrice) * 10000) / 100
          : null;
      const distanceToStopPct =
        currentPrice !== null && stop > 0
          ? Math.round(((currentPrice - stop) / currentPrice) * 10000) / 100
          : null;

      const partial = {
        distance_to_target_pct: distanceToTargetPct,
        distance_to_stop_pct: distanceToStopPct,
      };

      return {
        ticker: String(r.ticker || ''),
        market: String(r.market || market),
        signal: String(r.signal || ''),
        status: r.status === null ? null : String(r.status),
        persona: r.persona === null ? null : String(r.persona),
        entry_price: entry,
        target_price: target,
        target_price_2: r.target_price_2 === null ? null : Number(r.target_price_2),
        stop_loss: stop,
        current_price: currentPrice,
        risk_reward: Number(r.risk_reward ?? 0),
        master_score: Number(r.master_score ?? 0),
        confidence: r.confidence === null ? null : Number(r.confidence),
        prediction_date: String(r.prediction_date || ''),
        unrealized_pnl_pct: unrealizedPnlPct,
        unrealized_pnl_egp: unrealizedPnlEgp,
        distance_to_target_pct: distanceToTargetPct,
        distance_to_stop_pct: distanceToStopPct,
        holding_days: r.holding_days === null ? null : Number(r.holding_days),
        exit_type: r.exit_type === null ? null : String(r.exit_type),
        kill_filter_result:
          r.kill_filter_result === null ? null : String(r.kill_filter_result),
        name_ar: lookup?.name_ar || String(r.ticker || ''),
        sector: lookup?.sector || null,
        urgency: computeUrgency(partial),
      };
    });

    // Summary for header card
    const summary = {
      total: positions.length,
      high_urgency: positions.filter((p) => p.urgency === 'high').length,
      medium_urgency: positions.filter((p) => p.urgency === 'medium').length,
      low_urgency: positions.filter((p) => p.urgency === 'low').length,
      avg_unrealized_pnl_pct:
        positions.length > 0 && positions.some((p) => p.unrealized_pnl_pct !== null)
          ? Math.round(
              (positions
                .filter((p) => p.unrealized_pnl_pct !== null)
                .reduce((s, p) => s + (p.unrealized_pnl_pct ?? 0), 0) /
                Math.max(1, positions.filter((p) => p.unrealized_pnl_pct !== null).length)) *
                100
            ) / 100
          : 0,
      market,
    };

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      positions,
      count: positions.length,
      summary,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        positions: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}
