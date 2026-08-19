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
// GET — keep existing behavior (proxy to Python live-monitor)
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/live-monitor${qs ? `?${qs}` : ''}`;

    const options: RequestInit = { signal: AbortSignal.timeout(30000) };
    const res = await fetch(targetUrl, options);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 503 }
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
