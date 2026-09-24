/**
 * GET /api/portfolio/watchlists
 * =============================
 * MONEY-TIER1.2: REAL watchlist from user_stock_watchlists.
 *
 * BEFORE: proxied to Python :8010 + returned 5 hardcoded mock stocks
 *         (COMI/ABUK/SWDY/TMGH/ETEL) on failure.
 *
 * AFTER:  reads REAL watchlist from user_stock_watchlists (stocks.db),
 *         enriches each row with live price from stocks.current_price →
 *         data_engine.db.stocks → previous_close → purchase_price.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';
import { getSessionUserId } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fs = require('fs');
const path = require('path');

function dbExists(p: string): boolean {
  try { return fs.existsSync(p) && fs.statSync(p).size > 0; } catch { return false; }
}

async function tryPythonWatchlists(userId: string | undefined): Promise<any | null> {
  const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
  try {
    const url = userId
      ? `${PY}/api/portfolio/watchlists?user_id=${encodeURIComponent(userId)}`
      : `${PY}/api/portfolio/watchlists`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data.watchlist) && data.watchlist.length > 0) return data;
    return null;
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    let userId = url.searchParams.get('user_id');
    if (!userId) {
      try {
        const session = await getSessionUserId();
        userId = session.userId || undefined;
      } catch { /* ignore */ }
    }
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', watchlist: [], total: 0 },
        { status: 401 }
      );
    }

    // 1) Try Python first (optional)
    const py = await tryPythonWatchlists(userId);
    if (py) return NextResponse.json(py);

    // 2) REAL FALLBACK — read from user_stock_watchlists (stocks.db)
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!dbExists(stocksDbPath)) {
      return NextResponse.json({
        success: true,
        watchlist: [],
        total: 0,
        source: 'sqlite_fallback',
        error: 'stocks.db not found',
      });
    }

    const db = await getFinanceDb();

    const rows = db.prepare(`
      SELECT
        w.id, w.user_id, w.stock_id,
        w.alert_price_above, w.alert_price_below, w.alert_change_percent,
        w.notes, w.added_at, w.purchase_price, w.quantity,
        w.last_viewed, w.view_count,
        s.ticker, s.name, s.name_ar, s.current_price, s.previous_close,
        s.change_percent, s.sector
      FROM user_stock_watchlists w
      LEFT JOIN stocks s ON s.id = w.stock_id
      WHERE w.user_id = ?
      ORDER BY w.added_at DESC
    `).all(userId) as any[];

    // Also try data_engine.db for freshest prices
    let deDb: any = null;
    try {
      const { getDataEngineDb } = await import('@/lib/data-engine-db');
      deDb = getDataEngineDb();
    } catch { /* data_engine optional */ }

    // Fetch portfolio tickers to mark in_portfolio
    let portfolioTickers = new Set<string>();
    try {
      const pfTickers = db.prepare(
        "SELECT DISTINCT stock_ticker FROM portfolio_assets WHERE user_id = ? AND stock_ticker IS NOT NULL AND stock_ticker != ''"
      ).all(userId) as any[];
      portfolioTickers = new Set(pfTickers.map(r => String(r.stock_ticker).toUpperCase()));
    } catch { /* ignore */ }

    const watchlist = rows.map((row: any) => {
      const ticker = row.ticker || '';
      let price = Number(row.current_price || 0);
      let changePct = Number(row.change_percent || 0);
      let name = row.name_ar || row.name || ticker;

      if (price <= 0 && ticker && deDb) {
        try {
          const deRow = deDb.prepare(
            "SELECT name, price, change_percent FROM stocks WHERE symbol = ? COLLATE NOCASE LIMIT 1"
          ).get(ticker) as any;
          if (deRow) {
            price = Number(deRow.price || 0);
            changePct = Number(deRow.change_percent || 0);
            if (!name || name === ticker) name = deRow.name || name;
          }
        } catch { /* ignore */ }
      }

      if (price <= 0 && Number(row.previous_close) > 0) {
        price = Number(row.previous_close);
      }
      if (price <= 0 && Number(row.purchase_price) > 0) {
        price = Number(row.purchase_price);
      }

      let currentScore = 50;
      if (changePct !== 0) {
        currentScore = Math.max(1, Math.min(100, Math.round(50 + changePct * 2)));
      }

      return {
        id: row.id,
        ticker,
        name,
        sector: row.sector || '',
        current_price: Math.round(price * 100) / 100,
        change_pct: Math.round(changePct * 100) / 100,
        current_score: currentScore,
        in_portfolio: portfolioTickers.has(ticker.toUpperCase()),
        alert_price_above: row.alert_price_above,
        alert_price_below: row.alert_price_below,
        alert_change_percent: row.alert_change_percent,
        notes: row.notes,
        added_at: row.added_at,
        purchase_price: row.purchase_price,
        quantity: row.quantity,
        last_viewed: row.last_viewed,
        view_count: row.view_count,
      };
    });

    return NextResponse.json({
      success: true,
      watchlist,
      total: watchlist.length,
      summary: {
        with_alerts_above: watchlist.filter(w => w.alert_price_above).length,
        with_alerts_below: watchlist.filter(w => w.alert_price_below).length,
        with_change_alerts: watchlist.filter(w => w.alert_change_percent).length,
        in_portfolio: watchlist.filter(w => w.in_portfolio).length,
      },
      source: 'sqlite_fallback',
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/portfolio/watchlists] Error:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error', watchlist: [], total: 0 },
      { status: 500 }
    );
  }
}
