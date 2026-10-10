/**
 * GET /api/mobile/ai/recommendations
 * =================================
 * AI recommendations — falls back to predictions.db when Python is down.
 * Returns the top BUY predictions ranked by master_score.
 */

import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') || '20', 10) || 20,
    100
  );

  // 1) Try Python first
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/market-pulse${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2) Fallback — predictions.db top BUY by master_score
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
                target_price, target_price_2, stop_loss, master_score,
                confidence, status, market, persona, risk_reward,
                holding_days, evidence_count
         FROM predictions
         WHERE (signal LIKE '%BUY%')
           AND market = ? COLLATE NOCASE
         ORDER BY master_score DESC, prediction_date DESC
         LIMIT ?`
      )
      .all(market, limit)
      .map((r: any) => {
        const entry = Number(r.entry_price);
        const target = r.target_price != null ? Number(r.target_price) : null;
        const stop = r.stop_loss != null ? Number(r.stop_loss) : null;
        const rr =
          r.risk_reward && Number(r.risk_reward) > 0
            ? Number(r.risk_reward)
            : entry && target && stop
            ? Number(((target - entry) / (entry - stop)).toFixed(2))
            : null;
        // Confidence label derived from master_score (no mock)
        const score = r.master_score != null ? Number(r.master_score) : 0;
        const confidence_label =
          score >= 80 ? 'HIGH' : score >= 60 ? 'MEDIUM' : 'LOW';
        return {
          ticker: r.ticker,
          signal: r.signal,
          signal_type: r.signal_type,
          prediction_date: r.prediction_date,
          entry_price: entry,
          target_price: target,
          target_price_2:
            r.target_price_2 != null ? Number(r.target_price_2) : null,
          stop_loss: stop,
          master_score: score,
          confidence: r.confidence != null ? Number(r.confidence) : null,
          confidence_label,
          status: r.status,
          market: r.market,
          persona: r.persona,
          risk_reward: rr,
          holding_days: r.holding_days || 0,
          evidence_count: r.evidence_count || 0,
        };
      });

    pdb.close();

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      market,
      recommendations: rows,
      count: rows.length,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[mobile:ai:recommendations]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
