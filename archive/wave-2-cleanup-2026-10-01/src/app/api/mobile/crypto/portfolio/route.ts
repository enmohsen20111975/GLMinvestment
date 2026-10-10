/**
 * GET /api/mobile/crypto/portfolio
 * ===============================
 * Crypto portfolio — auth required.
 * Tries Python first; on failure requires auth, reads the user's PortfolioItem
 * rows where asset_type='crypto' from Prisma, enriches with current_price from
 * data_engine.db crypto_prices. If no holdings, returns an empty portfolio.
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
  const targetUrl = `${PY}/api/crypto/live${qs ? `?${qs}` : ''}`;

  // 1) Try Python first
  try {
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
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
      where: { user_id: userId, asset_type: 'crypto' },
      orderBy: { created_at: 'desc' },
    });

    if (!items.length) {
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        portfolio: {
          holdings: [],
          total_value: 0,
          total_cost: 0,
          total_pnl: 0,
          total_pnl_percent: 0,
          items_count: 0,
        },
        generated_at: new Date().toISOString(),
      });
    }

    // Enrich with current_price from data_engine.db crypto_prices
    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');
    const deDbPath = path.join(process.cwd(), 'db', 'data_engine.db');
    const dedb = fs.existsSync(deDbPath)
      ? new Database(deDbPath, { readonly: true })
      : null;

    let totalValue = 0;
    let totalCost = 0;

    const holdings: any[] = items.map((it: any) => {
      let livePrice = it.current_price;
      if (it.symbol && dedb) {
        try {
          const row: any = dedb
            .prepare(
              `SELECT price_usd FROM crypto_prices
               WHERE symbol = ? COLLATE NOCASE
               ORDER BY timestamp DESC LIMIT 1`
            )
            .get(it.symbol);
          if (row && row.price_usd) livePrice = Number(row.price_usd);
        } catch {}
      }
      const shares = Number(it.shares || 0);
      const purchase = Number(it.purchase_price || 0);
      const value = (livePrice || purchase) * shares;
      const cost = purchase * shares;
      const pnl = value - cost;
      const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
      totalValue += value;
      totalCost += cost;
      return {
        id: it.id,
        asset_type: it.asset_type,
        symbol: it.symbol,
        name: it.name,
        shares,
        avg_price: purchase,
        current_price: livePrice,
        currency: it.currency,
        value,
        cost,
        pnl,
        pnl_percent: Number(pnlPct.toFixed(2)),
        notes: it.notes,
        created_at: it.created_at,
      };
    });

    if (dedb) dedb.close();

    const totalPnl = totalValue - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      portfolio: {
        holdings,
        total_value: Number(totalValue.toFixed(2)),
        total_cost: Number(totalCost.toFixed(2)),
        total_pnl: Number(totalPnl.toFixed(2)),
        total_pnl_percent: Number(totalPnlPct.toFixed(2)),
        items_count: holdings.length,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[mobile:crypto:portfolio]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
