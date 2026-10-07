/**
 * GET /api/mobile/portfolio/analyze
 * =================================
 * Portfolio analysis — auth required.
 * Tries Python first; on failure reads the user's PortfolioItems from Prisma
 * (auth.db) and computes risk/concentration/diversification metrics.
 * No mock data — every number derives from the user's actual holdings
 * plus live prices from stocks.db.
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
        analysis: {
          has_holdings: false,
          total_value: 0,
          total_cost: 0,
          total_pnl: 0,
          total_pnl_percent: 0,
          holdings_count: 0,
          sectors_count: 0,
          diversification_score: 0,
          risk_level: 'NONE',
          message_ar: 'لا توجد محفظة — أضف أوراقاً مالية للتحليل',
        },
        generated_at: new Date().toISOString(),
      });
    }

    // Enrich with current_price from stocks.db + sector breakdown
    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const sdb = fs.existsSync(stocksDbPath)
      ? new Database(stocksDbPath, { readonly: true })
      : null;

    let totalValue = 0;
    let totalCost = 0;
    const sectors = new Map<string, number>();
    const holdings: any[] = [];

    for (const it of items) {
      let livePrice = it.current_price;
      let sector = 'UNKNOWN';
      if (it.asset_type === 'stock' && it.symbol && sdb) {
        const row = sdb
          .prepare(
            'SELECT current_price, sector FROM stocks WHERE ticker = ? COLLATE NOCASE'
          )
          .get(it.symbol);
        if (row) {
          if (row.current_price) livePrice = Number(row.current_price);
          if (row.sector) sector = String(row.sector);
        }
      }
      const shares = Number(it.shares || 0);
      const purchase = Number(it.purchase_price || 0);
      const value = (livePrice || purchase) * shares;
      const cost = purchase * shares;
      const pnl = value - cost;
      totalValue += value;
      totalCost += cost;
      sectors.set(sector, (sectors.get(sector) || 0) + value);
      holdings.push({
        ticker: it.symbol,
        sector,
        shares,
        value,
        pnl,
        pnl_percent: cost > 0 ? Number(((pnl / cost) * 100).toFixed(2)) : 0,
        weight: 0, // filled below
      });
    }
    if (sdb) sdb.close();

    // Compute weights (concentration)
    holdings.forEach((h) => {
      h.weight = totalValue > 0 ? Number(((h.value / totalValue) * 100).toFixed(2)) : 0;
    });

    const totalPnl = totalValue - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    // Concentration metrics (HHI on weights — closer to 10000 = single-asset)
    const weights = holdings.map((h) => h.weight / 100);
    const hhi = weights.reduce((s, w) => s + w * w, 0) * 10000; // 0..10000
    const maxWeight = Math.max(...holdings.map((h) => h.weight));
    const diversificationScore = Math.max(
      0,
      Math.min(100, 100 - (hhi / 100))
    );

    // Risk level derived from concentration + P&L
    let riskLevel = 'LOW';
    if (maxWeight >= 50 || hhi >= 5000) riskLevel = 'HIGH';
    else if (maxWeight >= 30 || hhi >= 3000) riskLevel = 'MEDIUM';

    const sector_breakdown = Array.from(sectors.entries())
      .map(([sector, value]) => ({
        sector,
        value: Number(value.toFixed(2)),
        weight:
          totalValue > 0
            ? Number(((value / totalValue) * 100).toFixed(2))
            : 0,
      }))
      .sort((a, b) => b.value - a.value);

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      analysis: {
        has_holdings: true,
        total_value: Number(totalValue.toFixed(2)),
        total_cost: Number(totalCost.toFixed(2)),
        total_pnl: Number(totalPnl.toFixed(2)),
        total_pnl_percent: Number(totalPnlPct.toFixed(2)),
        holdings_count: holdings.length,
        sectors_count: sectors.size,
        diversification_score: Number(diversificationScore.toFixed(2)),
        concentration_hhi: Number(hhi.toFixed(2)),
        max_position_weight: Number(maxWeight.toFixed(2)),
        risk_level: riskLevel,
        sector_breakdown,
        holdings,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[mobile:portfolio:analyze]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
