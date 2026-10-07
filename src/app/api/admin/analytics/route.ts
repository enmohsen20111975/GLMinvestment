import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { getFinanceDb } from '@/lib/finance-db';
import { db as authDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/admin/analytics
// Return analytics data for the admin dashboard.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const db = await getFinanceDb();

    // Ensure table exists
    db.prepare(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        user_id TEXT,
        view TEXT,
        action TEXT,
        detail TEXT,
        ip_hash TEXT,
        user_agent TEXT,
        screen_width INTEGER,
        created_at TEXT DEFAULT (datetime('now', '+2 hours'))
      )
    `).run();

    // ---- Summary stats ----
    const totalEvents = (db.prepare('SELECT COUNT(*) as cnt FROM analytics_events').get() as Record<string, unknown>)?.cnt ?? 0;
    const todayStart = "datetime('now', '+2 hours', 'start of day')";

    const todayEvents = (db.prepare(`SELECT COUNT(*) as cnt FROM analytics_events WHERE created_at >= ${todayStart}`).get() as Record<string, unknown>)?.cnt ?? 0;
    const todayPageViews = (db.prepare(`SELECT COUNT(*) as cnt FROM analytics_events WHERE type = 'page_view' AND created_at >= ${todayStart}`).get() as Record<string, unknown>)?.cnt ?? 0;
    const todayErrors = (db.prepare(`SELECT COUNT(*) as cnt FROM analytics_events WHERE type = 'api_error' AND created_at >= ${todayStart}`).get() as Record<string, unknown>)?.cnt ?? 0;
    const uniqueVisitorsToday = (db.prepare(`SELECT COUNT(DISTINCT user_id) as cnt FROM analytics_events WHERE type = 'page_view' AND created_at >= ${todayStart} AND user_id IS NOT NULL`).get() as Record<string, unknown>)?.cnt ?? 0;
    const uniqueIpsToday = (db.prepare(`SELECT COUNT(DISTINCT ip_hash) as cnt FROM analytics_events WHERE type = 'page_view' AND created_at >= ${todayStart}`).get() as Record<string, unknown>)?.cnt ?? 0;

    // ---- Page views by section (last 7 days) ----
    // ANALYTICS-FIX (2026-10-01): exclude admin:* routes so the public
    // traffic chart reflects real user activity, not admin dashboard clicks.
    const weekStart = "datetime('now', '+2 hours', '-7 days')";
    const pageViewsBySection = db.prepare(`
      SELECT view, COUNT(*) as count FROM analytics_events
      WHERE type = 'page_view' AND view IS NOT NULL
        AND view NOT LIKE 'admin:%'
        AND created_at >= ${weekStart}
      GROUP BY view ORDER BY count DESC LIMIT 20
    `).all() as Array<Record<string, unknown>>;

    // ---- Daily traffic (last 30 days) ----
    // ANALYTICS-FIX: exclude admin:* routes from public traffic stats.
    const monthStart = "datetime('now', '+2 hours', '-30 days')";
    const dailyTraffic = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as total,
        SUM(CASE WHEN type = 'page_view' THEN 1 ELSE 0 END) as page_views,
        SUM(CASE WHEN type = 'api_error' THEN 1 ELSE 0 END) as errors,
        COUNT(DISTINCT user_id) as unique_users
      FROM analytics_events
      WHERE created_at >= ${monthStart}
        AND (view IS NULL OR view NOT LIKE 'admin:%')
      GROUP BY DATE(created_at) ORDER BY date DESC
    `).all() as Array<Record<string, unknown>>;

    // ---- Recent errors (last 24h) ----
    const errorStart = "datetime('now', '+2 hours', '-24 hours')";
    const recentErrors = db.prepare(`
      SELECT id, view, action, detail, ip_hash, user_agent, created_at
      FROM analytics_events
      WHERE type = 'api_error' AND created_at >= ${errorStart}
      ORDER BY created_at DESC LIMIT 50
    `).all() as Array<Record<string, unknown>>;

    // ---- Active users (last 7 days) ----
    // ANALYTICS-FIX: only count real (non-anonymous) user IDs, exclude admin:* routes.
    const activeUsersWeekly = db.prepare(`
      SELECT user_id, COUNT(*) as visits,
        MAX(created_at) as last_seen
      FROM analytics_events
      WHERE type = 'page_view' AND user_id IS NOT NULL
        AND user_id NOT LIKE 'anon_%'
        AND (view IS NULL OR view NOT LIKE 'admin:%')
        AND created_at >= ${weekStart}
      GROUP BY user_id ORDER BY visits DESC LIMIT 20
    `).all() as Array<Record<string, unknown>>;

    // ---- Feature usage (last 7 days) ----
    const featureUsage = db.prepare(`
      SELECT action, COUNT(*) as count FROM analytics_events
      WHERE type = 'feature_use' AND action IS NOT NULL AND created_at >= ${weekStart}
      GROUP BY action ORDER BY count DESC LIMIT 15
    `).all() as Array<Record<string, unknown>>;

    // ---- Peak hours (last 7 days) ----
    // ANALYTICS-FIX: exclude admin:* routes from public peak-hours chart.
    const peakHours = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM analytics_events
      WHERE type = 'page_view'
        AND (view IS NULL OR view NOT LIKE 'admin:%')
        AND created_at >= ${weekStart}
      GROUP BY hour ORDER BY hour ASC
    `).all() as Array<Record<string, unknown>>;

    // ---- Error count by view (last 7 days) ----
    const errorsByView = db.prepare(`
      SELECT view, COUNT(*) as count FROM analytics_events
      WHERE type = 'api_error' AND created_at >= ${weekStart}
      GROUP BY view ORDER BY count DESC LIMIT 10
    `).all() as Array<Record<string, unknown>>;

    // ---- User behavior analysis (last 30 days) ----
    // ANALYTICS-FIX: exclude admin:* routes + anon users so the per-user
    // behavior table reflects public usage only.
    const userBehavior = db.prepare(`
      SELECT user_id,
        COUNT(*) as total_events,
        SUM(CASE WHEN type = 'page_view' THEN 1 ELSE 0 END) as page_views,
        SUM(CASE WHEN type = 'feature_use' THEN 1 ELSE 0 END) as feature_uses,
        SUM(CASE WHEN type = 'api_error' THEN 1 ELSE 0 END) as errors,
        MAX(created_at) as last_seen,
        COUNT(DISTINCT view) as unique_pages,
        COUNT(DISTINCT action) as unique_features
      FROM analytics_events
      WHERE user_id IS NOT NULL
        AND user_id NOT LIKE 'anon_%'
        AND (view IS NULL OR view NOT LIKE 'admin:%')
        AND created_at >= ${monthStart}
      GROUP BY user_id
      ORDER BY page_views DESC, feature_uses DESC
      LIMIT 50
    `).all() as Array<Record<string, unknown>>;

    const userTopPages = db.prepare(`
      SELECT user_id, view as page, COUNT(*) as count
      FROM analytics_events
      WHERE type = 'page_view' AND user_id IS NOT NULL AND view IS NOT NULL
        AND user_id NOT LIKE 'anon_%'
        AND view NOT LIKE 'admin:%'
        AND created_at >= ${monthStart}
      GROUP BY user_id, view
      ORDER BY user_id, count DESC
    `).all() as Array<Record<string, unknown>>;

    const userTopFeatures = db.prepare(`
      SELECT user_id, action as feature, COUNT(*) as count
      FROM analytics_events
      WHERE type = 'feature_use' AND user_id IS NOT NULL AND action IS NOT NULL
        AND user_id NOT LIKE 'anon_%'
        AND created_at >= ${monthStart}
      GROUP BY user_id, action
      ORDER BY user_id, count DESC
    `).all() as Array<Record<string, unknown>>;

    const userTopPagesMap = new Map<string, Array<{ page: string; count: number }>>();
    for (const r of userTopPages) {
      const uid = String(r.user_id || '');
      if (!userTopPagesMap.has(uid)) userTopPagesMap.set(uid, []);
      const arr = userTopPagesMap.get(uid)!;
      if (arr.length < 3) arr.push({ page: String(r.page || ''), count: Number(r.count || 0) });
    }

    const userTopFeaturesMap = new Map<string, Array<{ feature: string; count: number }>>();
    for (const r of userTopFeatures) {
      const uid = String(r.user_id || '');
      if (!userTopFeaturesMap.has(uid)) userTopFeaturesMap.set(uid, []);
      const arr = userTopFeaturesMap.get(uid)!;
      if (arr.length < 3) arr.push({ feature: String(r.feature || ''), count: Number(r.count || 0) });
    }

    const userBehaviorMap = new Map<string, Record<string, unknown>>();
    for (const r of userBehavior) {
      const uid = String(r.user_id || '');
      userBehaviorMap.set(uid, {
        total_events: Number(r.total_events || 0),
        page_views: Number(r.page_views || 0),
        feature_uses: Number(r.feature_uses || 0),
        errors: Number(r.errors || 0),
        last_seen: r.last_seen || null,
        unique_pages: Number(r.unique_pages || 0),
        unique_features: Number(r.unique_features || 0),
        top_page: (userTopPagesMap.get(uid) || [])[0]?.page || null,
        top_page_count: (userTopPagesMap.get(uid) || [])[0]?.count || 0,
        top_feature: (userTopFeaturesMap.get(uid) || [])[0]?.feature || null,
        top_feature_count: (userTopFeaturesMap.get(uid) || [])[0]?.count || 0,
        top_pages: userTopPagesMap.get(uid) || [],
        top_features: userTopFeaturesMap.get(uid) || [],
      });
    }

    // ANALYTICS-FIX (2026-10-01): real active-user counts from auth.db.
    // The old summary used `uniqueVisitorsToday` from analytics_events which
    // only counted admin clicks → always 1. Now we count users whose
    // last_active_at falls within the relevant window, with a separate
    // count for "active right now" (last 15 min).
    let activeUsersToday = 0;
    let activeUsersNow = 0;       // last 15 minutes
    let activeUsersWeek = 0;      // last 7 days
    let activeUsersMonth = 0;     // last 30 days
    let totalRegisteredUsers = 0;
    try {
      totalRegisteredUsers = await authDb.user.count();
      const now = new Date();
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const [t, n, w, m] = await Promise.all([
        authDb.user.count({ where: { last_active_at: { gte: todayStart } } }),
        authDb.user.count({ where: { last_active_at: { gte: fifteenMinAgo } } }),
        authDb.user.count({ where: { last_active_at: { gte: sevenDaysAgo } } }),
        authDb.user.count({ where: { last_active_at: { gte: thirtyDaysAgo } } }),
      ]);
      activeUsersToday = t;
      activeUsersNow = n;
      activeUsersWeek = w;
      activeUsersMonth = m;
    } catch (e) {
      // Non-fatal — fall back to 0 if auth.db is unavailable.
      console.warn('[Admin Analytics] last_active_at count failed (non-fatal):', e);
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        total_events: Number(totalEvents),
        today_events: Number(todayEvents),
        today_page_views: Number(todayPageViews),
        today_errors: Number(todayErrors),
        today_unique_users: Number(uniqueVisitorsToday),
        today_unique_ips: Number(uniqueIpsToday),
        // ANALYTICS-FIX (2026-10-01): real active-user counts driven by
        // User.last_active_at (auth.db) instead of analytics_events which
        // only contained admin clicks. The dashboard "active users" tile
        // should switch to `active_users_today` (or `active_users_now`
        // for a live "who's online right now" tile).
        total_registered_users: totalRegisteredUsers,
        active_users_now: activeUsersNow,      // last 15 min 🟢
        active_users_today: activeUsersToday,   // since midnight
        active_users_week: activeUsersWeek,     // last 7 days
        active_users_month: activeUsersMonth,   // last 30 days
      },
      page_views_by_section: pageViewsBySection.map(r => ({
        view: r.view,
        count: Number(r.count),
      })),
      daily_traffic: dailyTraffic.map(r => ({
        date: r.date,
        total: Number(r.total),
        page_views: Number(r.page_views),
        errors: Number(r.errors),
        unique_users: Number(r.unique_users),
      })),
      recent_errors: recentErrors.map(r => ({
        id: r.id,
        view: r.view,
        action: r.action,
        detail: r.detail,
        ip_hash: r.ip_hash,
        user_agent: r.user_agent,
        created_at: r.created_at,
      })),
      active_users_weekly: activeUsersWeekly.map(r => ({
        user_id: r.user_id,
        visits: Number(r.visits),
        last_seen: r.last_seen,
      })),
      feature_usage: featureUsage.map(r => ({
        action: r.action,
        count: Number(r.count),
      })),
      peak_hours: peakHours.map(r => ({
        hour: Number(r.hour),
        count: Number(r.count),
      })),
      errors_by_view: errorsByView.map(r => ({
        view: r.view,
        count: Number(r.count),
      })),
      user_behavior: Array.from(userBehaviorMap.values()),
    });
  } catch (error) {
    console.error('[Admin Analytics] Database unavailable, operating in degraded mode:', error);
    return NextResponse.json({
      success: true,
      degraded: true,
      timestamp: new Date().toISOString(),
      summary: {
        total_events: 0,
        today_events: 0,
        today_page_views: 0,
        today_errors: 0,
        today_unique_users: 0,
        today_unique_ips: 0,
        total_registered_users: 0,
        active_users_now: 0,
        active_users_today: 0,
        active_users_week: 0,
        active_users_month: 0,
      },
      page_views_by_section: [],
      daily_traffic: [],
      recent_errors: [],
      active_users_weekly: [],
      feature_usage: [],
      peak_hours: [],
      errors_by_view: [],
      user_behavior: [],
    });
  }
}
