/**
 * GET /api/mobile/portfolio/intelligence
 * =====================================
 * Portfolio intelligence — auth required.
 * Tries Python first; on failure returns intelligence metrics derived from
 * the user's holdings + market predictions (risk-reward from predictions.db).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { db } from '@/lib/db';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function unauthorized() {
  return NextResponse.json(
    {
      success: false,
      error: 'غير مصرح',
      error_en: 'Unauthorized',
    },
    { status: 401 }
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/live-monitor${qs ? `?${qs}` : ''}`;

  // 1) Try Python first
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2) Fallback — auth required
  const { userId } = await getSessionUserId();
  if (!userId) {
    return unauthorized();
  }

  try {
    const items = await db.portfolioItem.findMany({
      where: { user_id: userId },
    });

    if (!items.length) {
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        intelligence: {
          has_holdings: false,
          holdings_count: 0,
          avg_risk_reward: 0,
          active_signals: 0,
          bullish_holdings: 0,
          bearish_holdings: 0,
          message_ar: 'لا توجد محفظة',
        },
        generated_at: new Date().toISOString(),
      });
    }

    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const predDbPath = path.join(process.cwd(), 'db', 'predictions.db');

    const sdb = fs.existsSync(stocksDbPath)
      ? new Database(stocksDbPath, { readonly: true })
      : null;
    const pdb = fs.existsSync(predDbPath)
      ? new Database(predDbPath, { readonly: true })
      : null;

    let totalRR = 0;
    let rrCount = 0;
    let activeSignals = 0;
    let bullish = 0;
    let bearish = 0;

    for (const it of items) {
      if (it.asset_type !== 'stock' || !it.symbol) continue;
      // Latest prediction for the holding
      if (pdb) {
        try {
          const pred: any = pdb
            .prepare(
              `SELECT signal, status, entry_price, target_price, stop_loss,
                      risk_reward, master_score
               FROM predictions
               WHERE ticker = ? COLLATE NOCASE
               ORDER BY prediction_date DESC
               LIMIT 1`
            )
            .get(it.symbol);
          if (pred) {
            if (pred.signal && String(pred.signal).includes('BUY')) bullish++;
            if (pred.signal && String(pred.signal).includes('SELL'))
              bearish++;
            if (pred.status === 'ACTIVE') activeSignals++;
            if (pred.risk_reward && Number(pred.risk_reward) > 0) {
              totalRR += Number(pred.risk_reward);
              rrCount++;
            } else if (
              pred.entry_price &&
              pred.target_price &&
              pred.stop_loss
            ) {
              const rr =
                (Number(pred.target_price) - Number(pred.entry_price)) /
                (Number(pred.entry_price) - Number(pred.stop_loss));
              if (rr > 0) {
                totalRR += rr;
                rrCount++;
              }
            }
          }
        } catch {}
      }
      // Fallback signal: trend direction from stocks.db
      if (sdb && !bearish && !bullish) {
        try {
          const row: any = sdb
            .prepare(
              'SELECT change_percent, trend FROM stocks WHERE ticker = ? COLLATE NOCASE'
            )
            .get(it.symbol);
          if (row && Number(row.change_percent) > 0) bullish++;
          else if (row && Number(row.change_percent) < 0) bearish++;
        } catch {}
      }
    }

    if (sdb) sdb.close();
    if (pdb) pdb.close();

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      intelligence: {
        has_holdings: true,
        holdings_count: items.length,
        avg_risk_reward: rrCount > 0 ? Number((totalRR / rrCount).toFixed(2)) : 0,
        active_signals: activeSignals,
        bullish_holdings: bullish,
        bearish_holdings: bearish,
        neutral_holdings: Math.max(0, items.length - bullish - bearish),
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
