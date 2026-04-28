import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getWritableDb } from '@/lib/egx-db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

// ---------------------------------------------------------------------------
// PUT  /api/watchlist/[id] — Update alert prices / notes on a watchlist item
// DELETE /api/watchlist/[id] — Remove a watchlist item
// ---------------------------------------------------------------------------

const ADMIN_EMAILS = ['enmohsen2011975@gmail.com', 'ceo@m2y.net'];

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Get the user ID from the session.
 * Returns null if not authenticated.
 * Admin emails bypass ownership checks.
 */
async function getSessionUserId(): Promise<{ userId: string | null; isAdmin: boolean }> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return { userId: null, isAdmin: false };
    }
    const isAdmin = ADMIN_EMAILS.includes(session.user.email);
    const token = session.user as Record<string, unknown>;
    const userId = (session.user.id || token.id) as string | undefined ?? null;
    return { userId, isAdmin };
  } catch {
    return { userId: null, isAdmin: false };
  }
}

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { userId, isAdmin } = await getSessionUserId();

    // Must be authenticated to update
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول لتحديث قائمة المراقبة' },
        { status: 401 }
      );
    }

    await ensureInitialized();
    const db = getWritableDb();
    const { id } = await context.params;
    const watchlistId = Number(id);

    if (isNaN(watchlistId) || watchlistId <= 0) {
      return NextResponse.json(
        { success: false, error: 'معرف عنصر المراقبة غير صالح' },
        { status: 400 }
      );
    }

    // Verify the item exists and user owns it (admin bypasses ownership check)
    const existing = db
      .prepare(
        isAdmin
          ? 'SELECT id, user_id FROM user_stock_watchlists WHERE id = ?'
          : 'SELECT id, user_id FROM user_stock_watchlists WHERE id = ? AND user_id = ?'
      )
      .get(...(isAdmin ? [watchlistId] : [watchlistId, userId])) as { id: number; user_id: string } | undefined;

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'عنصر المراقبة غير موجود' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { alert_price_above, alert_price_below, alert_change_percent, notes } = body;

    // Build dynamic SET clause for only provided fields
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (alert_price_above !== undefined) {
      setClauses.push('alert_price_above = ?');
      params.push(alert_price_above === null ? null : Number(alert_price_above));
    }
    if (alert_price_below !== undefined) {
      setClauses.push('alert_price_below = ?');
      params.push(alert_price_below === null ? null : Number(alert_price_below));
    }
    if (alert_change_percent !== undefined) {
      setClauses.push('alert_change_percent = ?');
      params.push(alert_change_percent === null ? null : Number(alert_change_percent));
    }
    if (notes !== undefined) {
      setClauses.push('notes = ?');
      params.push(notes === null ? null : String(notes));
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { success: false, error: 'لم يتم تقديم بيانات للتحديث' },
        { status: 400 }
      );
    }

    params.push(watchlistId);

    db.prepare(
      `UPDATE user_stock_watchlists SET ${setClauses.join(', ')} WHERE id = ?`
    ).run(...params);

    return NextResponse.json({
      success: true,
      message: 'تم تحديث عنصر المراقبة بنجاح',
    });
  } catch (error) {
    console.error(`[PUT /api/watchlist] Error:`, error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تحديث عنصر المراقبة' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { userId, isAdmin } = await getSessionUserId();

    // Must be authenticated to delete
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول لحذف عنصر من قائمة المراقبة' },
        { status: 401 }
      );
    }

    await ensureInitialized();
    const db = getWritableDb();
    const { id } = await context.params;
    const watchlistId = Number(id);

    if (isNaN(watchlistId) || watchlistId <= 0) {
      return NextResponse.json(
        { success: false, error: 'معرف عنصر المراقبة غير صالح' },
        { status: 400 }
      );
    }

    // Verify it exists and user owns it (admin bypasses ownership check)
    const existing = db
      .prepare(
        isAdmin
          ? 'SELECT id, user_id FROM user_stock_watchlists WHERE id = ?'
          : 'SELECT id, user_id FROM user_stock_watchlists WHERE id = ? AND user_id = ?'
      )
      .get(...(isAdmin ? [watchlistId] : [watchlistId, userId])) as { id: number; user_id: string } | undefined;

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'عنصر المراقبة غير موجود' },
        { status: 404 }
      );
    }

    const result = db
      .prepare('DELETE FROM user_stock_watchlists WHERE id = ?')
      .run(watchlistId);

    if (result.changes === 0) {
      return NextResponse.json(
        { success: false, error: 'فشل في حذف عنصر المراقبة' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'تم حذف السهم من قائمة المراقبة بنجاح',
      deleted_id: watchlistId,
    });
  } catch (error) {
    console.error(`[DELETE /api/watchlist] Error:`, error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء حذف السهم من قائمة المراقبة' },
      { status: 500 }
    );
  }
}
