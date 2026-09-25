/**
 * GET /api/predictions/daily-picks
 * =================================
 * P0-FIX (API-FALLBACKS-WAVE-2): fallback to SQLite when Python backend is down.
 * Reads from predictions.db.predictions — no mock data (Rule 27).
 *
 * Tries Python /api/predictions/daily-picks first (5s timeout).
 * On failure, returns latest 10 predictions WHERE market = 'EGX' ORDER BY
 * prediction_date DESC.
 *
 * Shape: { success, source: 'sqlite_fallback', picks: [...], count, date }
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

interface DailyPick {
  ticker: string;
  market: string;
  signal: string;
  signal_type: string | null;
  entry_price: number;
  target_price: number;
  target_price_2: number | null;
  stop_loss: number;
  risk_reward: number;
  master_score: number;
  technical_score: number | null;
  confidence: number | null;
  persona: string | null;
  status: string | null;
  prediction_date: string;
  horizon: string | null;
  exit_type: string | null;
  morning_bell: number | null;
  explosive_score: number | null;
  evidence_count: number | null;
  kill_filter_result: string | null;
  name_ar: string | null;
  sector: string | null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // 1) Try Python first (5s timeout)
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/predictions/daily-picks${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2) Fallback — read from predictions.db
  try {
    const path = require('path');
    const fs = require('fs');
    const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json(
        { success: false, error: 'predictions.db not found' },
        { status: 500 }
      );
    }
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });

    const marketRaw = (url.searchParams.get('market') || 'EGX').toUpperCase();
    const market = MARKET_MAP[marketRaw] || 'EGX';
    const date = url.searchParams.get('date'); // optional YYYY-MM-DD
    const persona = url.searchParams.get('persona')?.trim().toLowerCase();
    const minConfidence = url.searchParams.get('min_confidence');
    const limitRaw = Number(url.searchParams.get('limit') || 10);
    const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 10));

    // Optional stock lookup for name_ar + sector
    let stocksLookup: Map<string, { sector: string; name_ar: string }> = new Map();
    try {
      const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
      if (fs.existsSync(stocksDbPath)) {
        const stocksDb = new Database(stocksDbPath, { readonly: true });
        const stockRows = stocksDb
          .prepare(`SELECT ticker, sector, name_ar FROM stocks`)
          .all() as Array<Record<string, unknown>>;
        for (const r of stockRows) {
          stocksLookup.set(String(r.ticker), {
            sector: String(r.sector || ''),
            name_ar: String(r.name_ar || r.ticker || ''),
          });
        }
        stocksDb.close();
      }
    } catch {}

    const where: string[] = ['market = ?'];
    const params: unknown[] = [market];

    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      where.push('prediction_date = ?');
      params.push(date);
    }
    if (persona && persona !== 'all') {
      where.push("LOWER(COALESCE(persona, '')) = ?");
      params.push(persona);
    }
    if (minConfidence && !Number.isNaN(Number(minConfidence))) {
      where.push('COALESCE(confidence, master_score, 0) >= ?');
      params.push(Number(minConfidence));
    }

    const sql = `
      SELECT
        ticker, signal, signal_type, market,
        entry_price, target_price, target_price_2, stop_loss,
        risk_reward, master_score, technical_score, confidence,
        persona, status, prediction_date, horizon,
        exit_type, morning_bell, explosive_score, evidence_count,
        kill_filter_result
      FROM predictions
      WHERE ${where.join(' AND ')}
      ORDER BY prediction_date DESC, master_score DESC
      LIMIT ?
    `;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    const picks: DailyPick[] = rows.map((r) => {
      const lookup = stocksLookup.get(String(r.ticker));
      return {
        ticker: String(r.ticker || ''),
        market: String(r.market || market),
        signal: String(r.signal || ''),
        signal_type: r.signal_type === null ? null : String(r.signal_type),
        entry_price: Number(r.entry_price ?? 0),
        target_price: Number(r.target_price ?? 0),
        target_price_2: r.target_price_2 === null ? null : Number(r.target_price_2),
        stop_loss: Number(r.stop_loss ?? 0),
        risk_reward: Number(r.risk_reward ?? 0),
        master_score: Number(r.master_score ?? 0),
        technical_score: r.technical_score === null ? null : Number(r.technical_score),
        confidence: r.confidence === null ? null : Number(r.confidence),
        persona: r.persona === null ? null : String(r.persona),
        status: r.status === null ? null : String(r.status),
        prediction_date: String(r.prediction_date || ''),
        horizon: r.horizon === null ? null : String(r.horizon),
        exit_type: r.exit_type === null ? null : String(r.exit_type),
        morning_bell: r.morning_bell === null ? null : Number(r.morning_bell),
        explosive_score: r.explosive_score === null ? null : Number(r.explosive_score),
        evidence_count: r.evidence_count === null ? null : Number(r.evidence_count),
        kill_filter_result:
          r.kill_filter_result === null ? null : String(r.kill_filter_result),
        name_ar: lookup?.name_ar || String(r.ticker || ''),
        sector: lookup?.sector || null,
      };
    });

    db.close();

    // Stats summary for the header card
    const buyCount = picks.filter((p) =>
      ['BUY', 'STRONG_BUY'].includes(p.signal.toUpperCase())
    ).length;
    const avgConfidence =
      picks.length > 0
        ? Math.round(
            (picks.reduce((s, p) => s + (p.confidence ?? p.master_score ?? 0), 0) /
              picks.length) *
              100
          ) / 100
        : 0;

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      picks,
      count: picks.length,
      date: date || (picks[0]?.prediction_date ?? new Date().toISOString().slice(0, 10)),
      stats: {
        total: picks.length,
        buy_signals: buyCount,
        avg_confidence: avgConfidence,
        market,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        picks: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}
