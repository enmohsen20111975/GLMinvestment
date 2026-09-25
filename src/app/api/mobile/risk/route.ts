/**
 * GET /api/mobile/risk
 * ===================
 * Risk overview — falls back to predictions.db when Python is down.
 * For each active BUY prediction: entry vs stop_loss distance, R:R ratio,
 * master_score, holding_days, risk_reward.
 */

import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';

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

    // Active BUY predictions for risk analysis
    const rows: any[] = pdb
      .prepare(
        `SELECT ticker, signal, prediction_date, entry_price, target_price,
                stop_loss, master_score, status, holding_days, risk_reward,
                market, persona
         FROM predictions
         WHERE (signal LIKE '%BUY%')
           AND market = ? COLLATE NOCASE
         ORDER BY master_score DESC, prediction_date DESC
         LIMIT 50`
      )
      .all(market);

    const risks = rows.map((r: any) => {
      const entry = Number(r.entry_price);
      const target = r.target_price != null ? Number(r.target_price) : null;
      const stop = r.stop_loss != null ? Number(r.stop_loss) : null;
      const rewardPerUnit = target ? target - entry : 0;
      const riskPerUnit = stop ? entry - stop : 0;
      const rr =
        riskPerUnit > 0 && rewardPerUnit > 0
          ? rewardPerUnit / riskPerUnit
          : Number(r.risk_reward) || 0;
      const riskPercent = entry > 0 && stop ? (riskPerUnit / entry) * 100 : 0;
      const rewardPercent =
        entry > 0 && target ? (rewardPerUnit / entry) * 100 : 0;

      return {
        ticker: r.ticker,
        signal: r.signal,
        prediction_date: r.prediction_date,
        entry_price: entry,
        target_price: target,
        stop_loss: stop,
        risk_per_share: Number(riskPerUnit.toFixed(4)),
        reward_per_share: Number(rewardPerUnit.toFixed(4)),
        risk_percent: Number(riskPercent.toFixed(2)),
        reward_percent: Number(rewardPercent.toFixed(2)),
        risk_reward: Number(rr.toFixed(2)),
        risk_reward_stored:
          r.risk_reward != null ? Number(r.risk_reward) : null,
        master_score: r.master_score != null ? Number(r.master_score) : null,
        holding_days: r.holding_days || 0,
        status: r.status,
        persona: r.persona,
        // Risk flag derived from data
        risk_flag:
          riskPercent >= 10
            ? 'EXTREME'
            : riskPercent >= 5
            ? 'ELEVATED'
            : 'NORMAL',
      };
    });

    // Aggregate risk metrics
    const total = risks.length;
    const avgRR =
      total > 0 ? risks.reduce((s, r) => s + r.risk_reward, 0) / total : 0;
    const avgRiskPct =
      total > 0 ? risks.reduce((s, r) => s + r.risk_percent, 0) / total : 0;
    const avgRewardPct =
      total > 0 ? risks.reduce((s, r) => s + r.reward_percent, 0) / total : 0;
    const extremeCount = risks.filter((r) => r.risk_flag === 'EXTREME').length;
    const elevatedCount = risks.filter((r) => r.risk_flag === 'ELEVATED').length;

    pdb.close();

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      market,
      risks,
      count: total,
      summary: {
        total_positions: total,
        avg_risk_reward: Number(avgRR.toFixed(2)),
        avg_risk_percent: Number(avgRiskPct.toFixed(2)),
        avg_reward_percent: Number(avgRewardPct.toFixed(2)),
        extreme_risk_count: extremeCount,
        elevated_risk_count: elevatedCount,
        normal_risk_count: total - extremeCount - elevatedCount,
      },
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
