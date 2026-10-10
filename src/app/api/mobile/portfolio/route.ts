/**
 * /api/mobile/portfolio
 * =====================
 * Mobile portfolio CRUD endpoint used by the Flutter Android app.
 *
 * - GET    : proxies to Python `/api/live-monitor` (legacy, kept as-is for now)
 * - POST   : creates a new PortfolioItem row directly in auth.db (Prisma)
 * - DELETE : deletes a PortfolioItem by `?id=<item_id>` (with user_id ownership check)
 *
 * Auth: Bearer token via `getSessionUserId()` from `@/lib/auth-helper`.
 *
 * Flutter app sends (lib/api/client.dart:422 / 437):
 *   POST   /api/mobile/portfolio        body: {ticker, shares, avg_price, ...}
 *   DELETE /api/mobile/portfolio?id=<item_id>
 *
 * Field mapping (Flutter → Prisma PortfolioItem):
 *   ticker    → symbol
 *   shares    → shares
 *   avg_price → purchase_price
 *   asset_type / name / current_price / currency / notes — passed through if provided
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

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

// ---------------------------------------------------------------------------
// GET — try Python first; on failure require auth and return Prisma portfolio
//       enriched with current_price from stocks.db (SQLite fallback).
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrl = `${PY}/api/live-monitor${qs ? `?${qs}` : ''}`;

  // 1) Try Python first (5s timeout — mobile-friendly)
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch { /* safe-by-design */ }

  // 2) Fallback — auth required
  const { userId } = await getSessionUserId();
  if (!userId) {
    return unauthorized();
  }

  try {
    // Load the user's portfolio items from Prisma (auth.db)
    const items = await db.portfolioItem.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });

    // Enrich stock holdings with current_price from stocks.db
    let holdings: any[] = [];
    let totalValue = 0;
    let totalCost = 0;
    try {
      const path = require('path');
      const fs = require('fs');
      const Database = require('better-sqlite3');
      const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
      let sdb: any = null;
      if (fs.existsSync(stocksDbPath)) {
        sdb = new Database(stocksDbPath, { readonly: true });
      }
      holdings = items.map((it: any) => {
        let livePrice = it.current_price;
        if (it.asset_type === 'stock' && it.symbol && sdb) {
          const row = sdb
            .prepare('SELECT current_price FROM stocks WHERE ticker = ? COLLATE NOCASE')
            .get(it.symbol);
          if (row && row.current_price) livePrice = Number(row.current_price);
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
          ticker: it.symbol,
          symbol: it.symbol,
          name: it.name,
          shares,
          avg_price: purchase,
          purchase_price: purchase,
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
      if (sdb) sdb.close();
    } catch { // silent fallback (safe-by-design)
      // Even if SQLite enrichment fails, return the basic items
      holdings = items.map((it: any) => ({
        id: it.id,
        asset_type: it.asset_type,
        ticker: it.symbol,
        symbol: it.symbol,
        name: it.name,
        shares: Number(it.shares || 0),
        avg_price: Number(it.purchase_price || 0),
        current_price: it.current_price,
        currency: it.currency,
        notes: it.notes,
        created_at: it.created_at,
      }));
    }

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
    console.error('[mobile:portfolio]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — create a PortfolioItem directly in auth.db
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return unauthorized();
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    // Flutter sends `ticker`; map to `symbol`. Allow either.
    const ticker =
      (body.ticker as string) || (body.symbol as string) || '';
    if (!ticker) {
      return NextResponse.json(
        {
          success: false,
          error: 'ticker مطلوب',
          error_en: 'ticker is required',
        },
        { status: 400 }
      );
    }

    const shares = body.shares != null ? Number(body.shares) : null;
    const avgPrice =
      body.avg_price != null
        ? Number(body.avg_price)
        : body.purchase_price != null
        ? Number(body.purchase_price)
        : null;
    const currentPrice =
      body.current_price != null ? Number(body.current_price) : null;

    const item = await db.portfolioItem.create({
      data: {
        user_id: userId,
        asset_type: (body.asset_type as string) || 'stock',
        symbol: String(ticker).toUpperCase(),
        name: (body.name as string) || null,
        shares: shares != null && !Number.isNaN(shares) ? shares : null,
        purchase_price:
          avgPrice != null && !Number.isNaN(avgPrice) ? avgPrice : null,
        current_price:
          currentPrice != null && !Number.isNaN(currentPrice)
            ? currentPrice
            : null,
        currency: (body.currency as string) || 'EGP',
        notes: (body.notes as string) || null,
        // FIX (FLUTTER-PROD-4): explicit updated_at (لو الـ DB schema قديم ومفيهوش @updatedAt)
        updated_at: new Date(),
      },
    });

    return NextResponse.json(
      {
        success: true,
        item,
        message: 'تمت الإضافة',
        message_en: 'Added successfully',
      },
      { status: 201 }
    );
  } catch (e: unknown) {
    console.error('[mobile/portfolio POST] Error:', e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ أثناء إضافة العنصر',
        error_en: 'Failed to add portfolio item',
        details: message,
      },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — delete a PortfolioItem by id with ownership check
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return unauthorized();
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: 'id مطلوب',
          error_en: 'id query parameter is required',
        },
        { status: 400 }
      );
    }

    // Ownership check: only delete if the row belongs to this user
    const existing = await db.portfolioItem.findUnique({
      where: { id },
      select: { user_id: true },
    });

    if (!existing) {
      return NextResponse.json(
        {
          success: false,
          error: 'العنصر غير موجود',
          error_en: 'Item not found',
        },
        { status: 404 }
      );
    }

    if (existing.user_id !== userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'غير مصرح بحذف هذا العنصر',
          error_en: 'Forbidden: item does not belong to user',
        },
        { status: 403 }
      );
    }

    await db.portfolioItem.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: 'تم الحذف',
      message_en: 'Deleted successfully',
    });
  } catch (e: unknown) {
    console.error('[mobile/portfolio DELETE] Error:', e);
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ أثناء الحذف',
        error_en: 'Failed to delete portfolio item',
        details: message,
      },
      { status: 500 }
    );
  }
}
