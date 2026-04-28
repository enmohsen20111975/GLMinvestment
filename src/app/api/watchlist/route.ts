import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getWritableDb } from '@/lib/egx-db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

// ---------------------------------------------------------------------------
// GET /api/watchlist — Fetch watchlist items for the authenticated user
// POST /api/watchlist — Add a stock to the authenticated user's watchlist
// ---------------------------------------------------------------------------

const ADMIN_EMAILS = ['enmohsen2011975@gmail.com', 'ceo@m2y.net'];

/** Resolve a ticker to stock_id using the stocks table in egx_investment.db */
function resolveStockId(db: ReturnType<typeof getWritableDb>, tickerOrId: string | number): number | null {
  if (typeof tickerOrId === 'number' || /^\d+$/.test(String(tickerOrId))) {
    // It's a numeric stock_id — verify it exists
    const row = db
      .prepare('SELECT id FROM stocks WHERE id = ? LIMIT 1')
      .get(Number(tickerOrId)) as { id: number } | undefined;
    return row ? row.id : null;
  }
  // It's a ticker string
  const row = db
    .prepare('SELECT id FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1')
    .get(String(tickerOrId)) as { id: number } | undefined;
  return row ? row.id : null;
}

/**
 * Get the user ID from the session.
 * Returns null if not authenticated (but does NOT throw).
 * Admin emails bypass user filtering.
 */
async function getSessionUserId(): Promise<{ userId: string | null; isAdmin: boolean }> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return { userId: null, isAdmin: false };
    }
    const isAdmin = ADMIN_EMAILS.includes(session.user.email);
    // token.id is set in JWT callback
    const token = session.user as Record<string, unknown>;
    const userId = (session.user.id || token.id) as string | undefined ?? null;
    return { userId, isAdmin };
  } catch {
    return { userId: null, isAdmin: false };
  }
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const { userId, isAdmin } = await getSessionUserId();

    // Unauthenticated users get an empty watchlist
    if (!userId) {
      return NextResponse.json({ success: true, items: [], total: 0 });
    }

    await ensureInitialized();
    const db = getWritableDb();

    // For normal users, filter by user_id. Admins see all.
    const whereClause = isAdmin ? '' : 'WHERE w.user_id = ?';
    const params: unknown[] = isAdmin ? [] : [userId];

    const rows = db
      .prepare(
        `SELECT
           w.id,
           w.user_id,
           w.stock_id,
           w.alert_price_above,
           w.alert_price_below,
           w.alert_change_percent,
           w.notes,
           w.added_at,
           w.last_viewed,
           w.view_count,
           s.ticker,
           s.name,
           s.name_ar,
           s.current_price,
           s.previous_close,
           s.sector,
           s.volume,
           s.market_cap,
           s.pe_ratio,
           s.pb_ratio,
           s.dividend_yield,
           s.eps,
           s.rsi,
           s.ma_50,
           s.ma_200,
           s.egx30_member,
           s.egx70_member,
           s.egx100_member
         FROM user_stock_watchlists w
         JOIN stocks s ON w.stock_id = s.id
         ${whereClause}
         ORDER BY w.added_at DESC`
      )
      .all(...params) as Record<string, unknown>[];

    // Compute price_change for each stock
    const items = rows.map((row) => {
      const prev = Number(row.previous_close) || 0;
      const curr = Number(row.current_price) || 0;
      return {
        ...row,
        price_change: prev > 0 ? ((curr - prev) / prev) * 100 : 0,
        stock: {
          id: row.stock_id,
          ticker: row.ticker,
          name: row.name,
          name_ar: row.name_ar,
          current_price: Number(row.current_price) || 0,
          previous_close: Number(row.previous_close) || 0,
          sector: row.sector,
          volume: row.volume,
          market_cap: row.market_cap,
          pe_ratio: row.pe_ratio,
          pb_ratio: row.pb_ratio,
          dividend_yield: row.dividend_yield,
          eps: row.eps,
          rsi: row.rsi,
          ma_50: row.ma_50,
          ma_200: row.ma_200,
          egx30_member: row.egx30_member === 1,
          egx70_member: row.egx70_member === 1,
          egx100_member: row.egx100_member === 1,
          price_change: prev > 0 ? ((curr - prev) / prev) * 100 : 0,
        },
      };
    });

    return NextResponse.json({
      success: true,
      items,
      total: items.length,
    });
  } catch (error) {
    console.error('[GET /api/watchlist] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء قراءة قائمة المراقبة' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const { userId, isAdmin } = await getSessionUserId();

    // Must be authenticated to add items
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول لإضافة أسهم إلى قائمة المراقبة' },
        { status: 401 }
      );
    }

    await ensureInitialized();
    const db = getWritableDb();
    const body = await request.json();
    const { stock_id, ticker, alert_price_above, alert_price_below, alert_change_percent, notes } = body;

    // Resolve stock_id from ticker or direct ID
    const identifier = stock_id ?? ticker;
    if (!identifier) {
      return NextResponse.json(
        { success: false, error: 'يجب تحديد السهم برمزه أو معرفه' },
        { status: 400 }
      );
    }

    const resolvedStockId = resolveStockId(db, identifier);
    if (!resolvedStockId) {
      return NextResponse.json(
        { success: false, error: 'السهم المحدد غير موجود' },
        { status: 404 }
      );
    }

    // Check for duplicate for THIS user
    const existing = db
      .prepare('SELECT id FROM user_stock_watchlists WHERE user_id = ? AND stock_id = ? LIMIT 1')
      .get(userId, resolvedStockId) as { id: number } | undefined;

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'هذا السهم موجود بالفعل في قائمة المراقبة', watchlist_id: existing.id },
        { status: 409 }
      );
    }

    // Insert with real user ID
    const result = db
      .prepare(
        `INSERT INTO user_stock_watchlists (user_id, stock_id, alert_price_above, alert_price_below, alert_change_percent, notes, added_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(
        userId,
        resolvedStockId,
        alert_price_above ?? null,
        alert_price_below ?? null,
        alert_change_percent ?? null,
        notes ?? null
      );

    return NextResponse.json({
      success: true,
      message: 'تمت إضافة السهم إلى قائمة المراقبة بنجاح',
      id: result.lastInsertRowid,
      stock_id: resolvedStockId,
    });
  } catch (error) {
    console.error('[POST /api/watchlist] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء إضافة السهم إلى قائمة المراقبة' },
      { status: 500 }
    );
  }
}
