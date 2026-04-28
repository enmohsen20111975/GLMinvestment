import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-auth';
import { getFinanceDb } from '@/lib/finance-db';

// ---------------------------------------------------------------------------
// GET /api/admin/analytics
// Return analytics data for the admin dashboard.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const authError = requireAdminRequest(request);
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
    const weekStart = "datetime('now', '+2 hours', '-7 days')";
    const pageViewsBySection = db.prepare(`
      SELECT view, COUNT(*) as count FROM analytics_events
      WHERE type = 'page_view' AND view IS NOT NULL AND created_at >= ${weekStart}
      GROUP BY view ORDER BY count DESC LIMIT 20
    `).all() as Array<Record<string, unknown>>;

    // ---- Daily traffic (last 30 days) ----
    const monthStart = "datetime('now', '+2 hours', '-30 days')";
    const dailyTraffic = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as total,
        SUM(CASE WHEN type = 'page_view' THEN 1 ELSE 0 END) as page_views,
        SUM(CASE WHEN type = 'api_error' THEN 1 ELSE 0 END) as errors,
        COUNT(DISTINCT user_id) as unique_users
      FROM analytics_events
      WHERE created_at >= ${monthStart}
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
    const activeUsersWeekly = db.prepare(`
      SELECT user_id, COUNT(*) as visits,
        MAX(created_at) as last_seen
      FROM analytics_events
      WHERE type = 'page_view' AND user_id IS NOT NULL AND created_at >= ${weekStart}
      GROUP BY user_id ORDER BY visits DESC LIMIT 20
    `).all() as Array<Record<string, unknown>>;

    // ---- Feature usage (last 7 days) ----
    const featureUsage = db.prepare(`
      SELECT action, COUNT(*) as count FROM analytics_events
      WHERE type = 'feature_use' AND action IS NOT NULL AND created_at >= ${weekStart}
      GROUP BY action ORDER BY count DESC LIMIT 15
    `).all() as Array<Record<string, unknown>>;

    // ---- Peak hours (last 7 days) ----
    const peakHours = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM analytics_events
      WHERE type = 'page_view' AND created_at >= ${weekStart}
      GROUP BY hour ORDER BY hour ASC
    `).all() as Array<Record<string, unknown>>;

    // ---- Error count by view (last 7 days) ----
    const errorsByView = db.prepare(`
      SELECT view, COUNT(*) as count FROM analytics_events
      WHERE type = 'api_error' AND created_at >= ${weekStart}
      GROUP BY view ORDER BY count DESC LIMIT 10
    `).all() as Array<Record<string, unknown>>;

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
    });
  } catch (error) {
    console.error('[Admin Analytics] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load analytics' },
      { status: 500 }
    );
  }
}
