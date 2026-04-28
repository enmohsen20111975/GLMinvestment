import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-auth';
import { db } from '@/lib/db';
import { ensureInitialized, getLightDb, getHeavyDb } from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// GET /api/admin/stats
// Return platform-wide statistics: user count, stock count, etc.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    // Verify admin access via custom header or cookie
    const authError = requireAdminRequest(request);
    if (authError) return authError;

    // ---- User stats from Prisma (custom.db) ----
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

    // ---- Stock stats from SQLite singletons (no per-request file reads) ----
    let stockCount = 0;
    let activeStockCount = 0;
    let watchlistCount = 0;
    let portfolioCount = 0;
    let lastDataUpdate: string | null = null;
    let sectorCount = 0;
    let priceHistoryCount = 0;

    try {
      await ensureInitialized();
      // Light DB for stocks table (~200KB, cached)
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

      // Heavy DB for price_history count (only if available)
      try {
        const heavyDb = getHeavyDb();
        const priceStats = heavyDb.prepare('SELECT COUNT(*) as cnt FROM stock_price_history').get() as Record<string, unknown>;
        priceHistoryCount = Number(priceStats?.cnt) || 0;
      } catch {
        // Heavy DB not available — skip price history count
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
      console.error('[Admin Stats] Error reading egx_investment.db:', err);
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
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
