import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { db } from '@/lib/db';
import { ensureInitialized, getLightDb, isHeavyDbAvailable, getHeavyDbHealth } from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// GET /api/admin/stats
// Return platform-wide statistics: user count, stock count, etc.
//
// NOTE: Write operations (POST/PUT/DELETE) are protected by middleware AND
// by requireAdminRequest inside each handler. GET requests on non-destructive
// admin endpoints are allowed through middleware — we still verify auth here
// so unauthenticated users don't see internal stats, but we gracefully return
// limited data instead of hard 403 (which caused infinite retry loops).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Verify admin access — but return limited stats instead of hard 403
    const authError = await requireAdminAsync(request);
    const isAuthenticated = !authError;

    // ---- User stats from Prisma (stocks.db) ----
    let userCount = 0;
    let activeUserCount = 0;
    let premiumUserCount = 0;
    let recentUsers: Array<Record<string, unknown>> = [];

    try {
      userCount = await db.user.count();
      activeUserCount = await db.user.count({ where: { is_active: true } });
      premiumUserCount = await db.user.count({
        where: { subscription_tier: 'premium' },
      });
      const recentDbUsers = await db.user.findMany({
        orderBy: { created_at: 'desc' },
        take: 5,
        select: { email: true, name: true, created_at: true, subscription_tier: true, last_login: true },
      });
      recentUsers = recentDbUsers.map((u) => ({
        email: u.email,
        name: u.name,
        subscription_tier: u.subscription_tier,
        last_login: u.last_login,
        created_at: u.created_at,
      }));
    } catch (err) {
      console.error('[Admin Stats] Error reading Prisma DB:', err);
    }

    // ---- Stock stats from stocks.db (main database for analysis) ----
    let stockCount = 0;
    let activeStockCount = 0;
    let watchlistCount = 0;
    let portfolioCount = 0;
    let lastDataUpdate: string | null = null;
    let sectorCount = 0;
    let priceHistoryCount = 0;
    let dbAvailable = false;

    try {
      await ensureInitialized();
      dbAvailable = true;
      // Light DB for stocks table (stocks.db - main analysis database)
      const lightDb = getLightDb();
      const stockStats = lightDb.prepare(`
        SELECT
          COUNT(*) as total_stocks,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_stocks,
          MAX(last_update) as latest_update,
          COUNT(DISTINCT sector) as sector_count
        FROM stocks
      `).get() as Record<string, unknown>;

      stockCount = Number(stockStats?.total_stocks) || 0;
      activeStockCount = Number(stockStats?.active_stocks) || 0;
      lastDataUpdate = (stockStats?.latest_update as string) || null;
      sectorCount = Number(stockStats?.sector_count) || 0;

      // DO NOT load Heavy DB - just check if it's available
      // This prevents memory issues on small servers
      const heavyDbHealth = getHeavyDbHealth();
      if (heavyDbHealth.loaded) {
        priceHistoryCount = -1; // Indicate data exists but count not loaded
      } else if (heavyDbHealth.dbFileExists) {
        priceHistoryCount = -1; // File exists but not loaded
      }

      // Count watchlist items from light DB
      try {
        const wlStats = lightDb.prepare('SELECT COUNT(*) as cnt FROM user_stock_watchlists').get() as Record<string, unknown>;
        watchlistCount = Number(wlStats?.cnt) || 0;
      } catch {
        // table might not exist
      }

      // Count portfolio items from light DB
      try {
        const pfStats = lightDb.prepare('SELECT COUNT(*) as cnt FROM portfolio_assets').get() as Record<string, unknown>;
        portfolioCount = Number(pfStats?.cnt) || 0;
      } catch {
        // table might not exist
      }
    } catch (err) {
      console.error('[Admin Stats] Error reading stocks.db:', err);
    }

    // If not authenticated, return public-safe stats (no user details)
    if (!isAuthenticated) {
      return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        db_available: dbAvailable,
        users: { total: userCount, active: activeUserCount, premium: premiumUserCount, recent: [] },
        stocks: {
          total: stockCount,
          active: activeStockCount,
          sectors: sectorCount,
          price_history_points: priceHistoryCount,
          last_update: lastDataUpdate,
        },
        platform: { watchlist_items: watchlistCount, portfolio_items: portfolioCount },
      });
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      db_available: dbAvailable,
      users: {
        total: userCount,
        active: activeUserCount,
        premium: premiumUserCount,
        recent: recentUsers,
      },
      stocks: {
        total: stockCount,
        active: activeStockCount,
        sectors: sectorCount,
        price_history_points: priceHistoryCount,
        last_update: lastDataUpdate,
      },
      platform: {
        watchlist_items: watchlistCount,
        portfolio_items: portfolioCount,
      },
    });
  } catch (error) {
    console.error('[GET /api/admin/stats] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء جلب الإحصائيات' },
      { status: 500 }
    );
  }
}