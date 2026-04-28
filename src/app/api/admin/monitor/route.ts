import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getLightDb, getHeavyDb } from '@/lib/egx-db';
import { requireAdminRequest } from '@/lib/admin-auth';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// GET /api/admin/monitor
// Return comprehensive monitoring data for admin dashboard
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    // Verify admin access via custom header or cookie
    const authError = requireAdminRequest(request);
    if (authError) return authError;

    await ensureInitialized();

    // ---- User stats from Prisma ----
    let userCount = 0;
    let activeUserCount = 0;
    let premiumUserCount = 0;
    try {
      userCount = await db.user.count();
      activeUserCount = await db.user.count({ where: { is_active: true } });
      premiumUserCount = await db.user.count({
        where: { subscription_tier: 'premium' },
      });
    } catch (err) {
      console.error('[Admin Monitor] Error reading Prisma DB:', err);
    }

    // ---- Light DB stats (stocks, indices, etc.) ----
    let stockCount = 0;
    let activeStockCount = 0;
    let lastDataUpdate: string | null = null;
    let sectorCount = 0;
    let egx30Count = 0;

    try {
      const lightDb = getLightDb();
      const stockStats = lightDb.prepare(`
        SELECT
          COUNT(*) as total_stocks,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_stocks,
          MAX(last_update) as latest_update,
          COUNT(DISTINCT sector) as sector_count,
          SUM(CASE WHEN egx30_member = 1 THEN 1 ELSE 0 END) as egx30_count
        FROM stocks
      `).get() as Record<string, unknown>;

      stockCount = Number(stockStats?.total_stocks) || 0;
      activeStockCount = Number(stockStats?.active_stocks) || 0;
      lastDataUpdate = (stockStats?.latest_update as string) || null;
      sectorCount = Number(stockStats?.sector_count) || 0;
      egx30Count = Number(stockStats?.egx30_count) || 0;
    } catch (err) {
      console.error('[Admin Monitor] Error reading light DB:', err);
    }

    // ---- Heavy DB stats (predictions, history, etc.) ----
    let priceHistoryCount = 0;
    let predictionTotal = 0;
    let predictionValidated = 0;
    let predictionAccuracy = 0;
    let insightCount = 0;
    let goldHistoryCount = 0;
    let recentPredictions: Record<string, unknown>[] = [];
    let recentFeedback: Record<string, unknown>[] = [];

    try {
      const heavyDb = getHeavyDb();

      // Price history count
      const phStats = heavyDb.prepare('SELECT COUNT(*) as cnt FROM stock_price_history').get() as Record<string, unknown>;
      priceHistoryCount = Number(phStats?.cnt) || 0;

      // Deep insight snapshots count
      const diStats = heavyDb.prepare('SELECT COUNT(*) as cnt FROM stock_deep_insight_snapshots').get() as Record<string, unknown>;
      insightCount = Number(diStats?.cnt) || 0;

      // Gold price history
      try {
        const ghStats = heavyDb.prepare('SELECT COUNT(*) as cnt FROM gold_price_history').get() as Record<string, unknown>;
        goldHistoryCount = Number(ghStats?.cnt) || 0;
      } catch {
        // gold_price_history table may not exist
      }

      // Prediction stats
      try {
        const predStats = heavyDb.prepare(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN actual_price IS NOT NULL THEN 1 ELSE 0 END) as validated,
            SUM(CASE WHEN actual_price IS NOT NULL AND 
              ABS(actual_price - predicted_price) / NULLIF(predicted_price, 0) < 0.05 THEN 1 ELSE 0 END) as accurate
          FROM predictions
        `).get() as Record<string, unknown>;

        predictionTotal = Number(predStats?.total) || 0;
        predictionValidated = Number(predStats?.validated) || 0;
        const accurate = Number(predStats?.accurate) || 0;
        predictionAccuracy = predictionValidated > 0 ? Math.round((accurate / predictionValidated) * 100) : 0;
      } catch {
        // predictions table may not exist
      }

      // Recent predictions
      try {
        const rows = heavyDb.prepare(`
          SELECT ticker, predicted_price, actual_price, prediction_date, prediction_type, status
          FROM predictions
          ORDER BY prediction_date DESC
          LIMIT 5
        `).all() as Record<string, unknown>[];
        recentPredictions = rows.map((row) => ({
          ticker: row.ticker,
          predicted_price: Number(row.predicted_price) || 0,
          actual_price: row.actual_price ? Number(row.actual_price) : null,
          prediction_date: row.prediction_date,
          prediction_type: row.prediction_type,
          status: row.status,
        }));
      } catch {
        // predictions table may not exist
      }

      // Recent feedback loop results
      try {
        const fbRows = heavyDb.prepare(`
          SELECT ticker, adjustment_type, old_weight, new_weight, adjusted_at, reason
          FROM prediction_logs
          ORDER BY adjusted_at DESC
          LIMIT 5
        `).all() as Record<string, unknown>[];
        recentFeedback = fbRows.map((row) => ({
          ticker: row.ticker,
          adjustment_type: row.adjustment_type,
          old_weight: Number(row.old_weight) || 0,
          new_weight: Number(row.new_weight) || 0,
          adjusted_at: row.adjusted_at,
          reason: row.reason,
        }));
      } catch {
        // prediction_logs table may not exist
      }
    } catch (err) {
      console.error('[Admin Monitor] Error reading heavy DB:', err);
    }

    // ---- Platform stats ----
    let watchlistCount = 0;
    let portfolioCount = 0;
    try {
      const platformDb = getHeavyDb();
      try {
        const wlStats = platformDb.prepare('SELECT COUNT(*) as cnt FROM watchlist').get() as Record<string, unknown>;
        watchlistCount = Number(wlStats?.cnt) || 0;
      } catch {
        // watchlist table might not exist in heavy DB
      }
      try {
        const pfStats = platformDb.prepare('SELECT COUNT(*) as cnt FROM user_assets').get() as Record<string, unknown>;
        portfolioCount = Number(pfStats?.cnt) || 0;
      } catch {
        // user_assets table might not exist in heavy DB
      }
    } catch {
      // Heavy DB not available
    }

    // ---- Data freshness ----
    const now = new Date();
    const lastUpdate = lastDataUpdate ? new Date(lastDataUpdate) : null;
    const hoursSinceUpdate = lastUpdate ? Math.floor((now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60)) : null;
    const dataFreshness = hoursSinceUpdate !== null
      ? hoursSinceUpdate < 4 ? 'fresh' : hoursSinceUpdate < 24 ? 'stale' : 'outdated'
      : 'unknown';

    // ---- System health ----
    const systemHealth = {
      light_db: 'connected',
      heavy_db: 'connected',
      prisma_db: 'connected',
      data_freshness: dataFreshness,
      hours_since_update: hoursSinceUpdate,
    };

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      database: {
        total_stocks: stockCount,
        active_stocks: activeStockCount,
        sectors: sectorCount,
        egx30_count: egx30Count,
        price_history_points: priceHistoryCount,
        deep_insight_count: insightCount,
        gold_history_points: goldHistoryCount,
        last_update: lastDataUpdate,
      },
      users: {
        total: userCount,
        active: activeUserCount,
        premium: premiumUserCount,
      },
      platform: {
        watchlist_items: watchlistCount,
        portfolio_items: portfolioCount,
      },
      predictions: {
        total: predictionTotal,
        validated: predictionValidated,
        accuracy_percent: predictionAccuracy,
        recent: recentPredictions,
      },
      feedback_loop: {
        recent_adjustments: recentFeedback,
      },
      system_health: systemHealth,
      data_freshness: dataFreshness,
    });
  } catch (error) {
    console.error('[GET /api/admin/monitor] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء جلب بيانات المراقبة' },
      { status: 500 }
    );
  }
}
