import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { getFinanceDb } from '@/lib/finance-db';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/admin/users
// Return all registered users - Python handles auth, Node.js just displays
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const authError = await requireAdminAsync(request);
    if (authError) return authError;

    const { db } = await import('@/lib/db');

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const role = searchParams.get('role') || 'all';
    const status = searchParams.get('status') || 'all';
    const page = parseInt(searchParams.get('page') || '1');
    // P15-LIVE-UX-AUTH-FIXES (Task 5): رفعنا الـ default من 50 لـ 500 عشان
    // الـ admin يشوف كل الـ 90 مستخدم مرة واحدة بدون pagination.
    const pageSize = parseInt(searchParams.get('pageSize') || '500');
    const withUsage = searchParams.get('withUsage') === '1';

    // Build where clause
    const where: any = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (role !== 'all') {
      where.subscription_tier = role;
    }

    if (status !== 'all') {
      where.is_active = status === 'active';
    }

    let total = 0;
    let users: Array<Record<string, unknown>> = [];
    try {
      total = await db.user.count({ where });

      users = await db.user.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          name: true,
          username: true,
          image: true,
          is_active: true,
          subscription_tier: true,
          default_risk_tolerance: true,
          last_login: true,
          email_verified: true,
          created_at: true,
          updated_at: true,
          trial_ends_at: true,
          trial_warning_sent_at: true,
          trial_deletion_scheduled_at: true,
        },
      });
    } catch (dbError) {
      console.error('[GET /api/admin/users] Database unavailable, operating in degraded mode:', dbError);
    }

    const transformedUsers = users.map(user => {
      const tier = (user.subscription_tier as string) || 'free';
      const isPaid = ['normal', 'premium', 'developer', 'admin', 'pro', 'enterprise'].includes(tier.toLowerCase());
      let trialStatus: any = null;

      if (!isPaid && user.created_at) {
        const created = new Date(user.created_at as string);
        const now = new Date();
        const diffMs = now.getTime() - created.getTime();
        const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const daysLeft = Math.max(0, 30 - daysPassed);
        const isInTrial = daysLeft > 0;

        const trialEndsAt = user.trial_ends_at ? new Date(user.trial_ends_at as string) : new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
        const warningEndsAt = new Date(trialEndsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        const isTrialExpired = daysLeft <= 0;
        const isInWarning = isTrialExpired && now < warningEndsAt;
        const isExpiredAndDeletionPending = isTrialExpired && now >= warningEndsAt;
        const warningDaysLeft = isInWarning ? Math.max(0, Math.ceil((warningEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;

        trialStatus = {
          isInTrial,
          isInWarning,
          isTrialExpired,
          isExpiredAndDeletionPending,
          daysPassed,
          daysLeft,
          warningDaysLeft,
          trialEndsAt: trialEndsAt.toISOString(),
          warningEndsAt: warningEndsAt.toISOString(),
        };
      }

      return {
        id: user.id,
        email: user.email,
        username: user.username || user.email.split('@')[0],
        name: user.name,
        image: user.image,
        role: user.subscription_tier === 'admin' ? 'admin' :
              user.subscription_tier === 'premium' ? 'premium' : 'user',
        status: user.is_active === 1 ? 'active' : 'inactive',
        emailVerified: user.email_verified,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        lastLoginAt: user.last_login,
        loginCount: 0,
        preferences: {
          notifications: true,
          darkMode: false,
          language: 'ar',
        },
        trialStatus,
        _count: {
          watchlist: 0,
          portfolio: 0,
          alerts: 0,
        },
      };
    });

    const response: any = {
      success: true,
      users: transformedUsers,
      total,
      page,
      pageSize,
    };

    // P15-LIVE-UX-AUTH-FIXES (Task 5): الـ activity-lookup و الـ withUsage blocks
    // الاتنين بيعتمدوا على finance DB (analytics_events table). لو الجدول ناقص
    // أو الـ DB مقفول، كان بيـ throw و يخلي الـ whole request يرجّع 500 —
    // فالـ admin كان بيشوف grid فاضي مع إن total=90. دلوقتي كل block في
    // try-catch مستقل، و الـ users بيرجعوا من غير usage data لو الـ finance DB
    // مش متاح.
    try {
      if (transformedUsers.length > 0) {
        const ids = transformedUsers.map(u => u.id);
        const placeholders = ids.map(() => '?').join(',');

        const fdb = await getFinanceDb();
        const activityRows = fdb.prepare(`
          SELECT user_id, MAX(created_at) as last_active
          FROM analytics_events
          WHERE user_id IN (${placeholders})
          GROUP BY user_id
        `).all(...ids) as Array<Record<string, unknown>>;
        const lastActiveById: Record<string, string | null> = {};
        for (const r of activityRows) {
          lastActiveById[r.user_id as string] = (r.last_active as string) || null;
        }

        let sessions: Array<{ userId: string; expires: string }> = [];
        try {
          sessions = await db.session.findMany({
            where: { userId: { in: ids } },
            select: { userId: true, expires: true },
          });
        } catch {
          // ignore if sessions table is unavailable in degraded mode
        }
        const loginCountById: Record<string, number> = {};
        const lastSessionExpiryById: Record<string, string> = {};
        for (const s of sessions) {
          loginCountById[s.userId] = (loginCountById[s.userId] || 0) + 1;
          if (!lastSessionExpiryById[s.userId] || s.expires > lastSessionExpiryById[s.userId]) {
            lastSessionExpiryById[s.userId] = s.expires;
          }
        }

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        response.users = transformedUsers.map(u => {
          const lastActive = lastActiveById[u.id] || null;
          const loginCount = loginCountById[u.id] || 0;
          const effectiveLastLogin = lastActive || lastSessionExpiryById[u.id] || u.lastLoginAt || null;
          const isActive = !!(
            effectiveLastLogin &&
            new Date(effectiveLastLogin) > new Date(sevenDaysAgo) &&
            u.status === 'active'
          );
          return {
            ...u,
            loginCount,
            lastActive,
            lastLoginAt: effectiveLastLogin,
            isActive,
          };
        });
      }
    } catch (activityErr) {
      // P15: لو analytics_events مش متاح، كمّل بالـ users من غير activity data.
      console.warn('[GET /api/admin/users] activity lookup failed (non-fatal):', activityErr);
    }

    try {
      if (withUsage && transformedUsers.length > 0) {
        const fdb = await getFinanceDb();
        const ids = transformedUsers.map(u => u.id);
        const placeholders = ids.map(() => '?').join(',');

        let lastActiveById: Record<string, string | null> = {};
        let loginCountById: Record<string, number> = {};
        let lastSessionExpiryById: Record<string, string> = {};
        let sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        if (response.users && response.users.length > 0) {
          for (const u of response.users) {
            lastActiveById[u.id] = (u as any).lastActive || null;
            loginCountById[u.id] = (u as any).loginCount || 0;
          }
        }

        const rows = fdb.prepare(`
          SELECT user_id,
            COUNT(*) as total_events,
            SUM(CASE WHEN type = 'page_view' THEN 1 ELSE 0 END) as page_views,
            SUM(CASE WHEN type = 'feature_use' THEN 1 ELSE 0 END) as feature_uses,
            SUM(CASE WHEN type = 'api_error' THEN 1 ELSE 0 END) as errors,
            MAX(created_at) as last_active
          FROM analytics_events
          WHERE user_id IN (${placeholders})
          GROUP BY user_id
        `).all(...ids) as Array<Record<string, unknown>>;

        const sectionRows = fdb.prepare(`
          SELECT user_id, view as section, COUNT(*) as cnt
          FROM analytics_events
          WHERE type = 'page_view' AND user_id IN (${placeholders}) AND view IS NOT NULL
          GROUP BY user_id, section
          ORDER BY user_id, cnt DESC
        `).all(...ids) as Array<Record<string, unknown>>;

        const featureRows = fdb.prepare(`
          SELECT user_id, action as feature, COUNT(*) as cnt
          FROM analytics_events
          WHERE type = 'feature_use' AND user_id IN (${placeholders}) AND action IS NOT NULL
          GROUP BY user_id, feature
          ORDER BY user_id, cnt DESC
        `).all(...ids) as Array<Record<string, unknown>>;

        const usageById: Record<string, {
          totalEvents: number;
          pageViews: number;
          featureUses: number;
          errors: number;
          lastActive: string | null;
          topSections: Array<{ section: string; count: number }>;
          topFeatures: Array<{ feature: string; count: number }>;
        }> = {};

        for (const r of rows) {
          usageById[r.user_id as string] = {
            totalEvents: Number(r.total_events || 0),
            pageViews: Number(r.page_views || 0),
            featureUses: Number(r.feature_uses || 0),
            errors: Number(r.errors || 0),
            lastActive: (r.last_active as string) || null,
            topSections: [],
            topFeatures: [],
          };
        }

        const sectionById: Record<string, Array<{ section: string; count: number }>> = {};
        for (const r of sectionRows) {
          const uid = r.user_id as string;
          if (!sectionById[uid]) sectionById[uid] = [];
          if (sectionById[uid].length < 3) {
            sectionById[uid].push({ section: r.section as string, count: Number(r.cnt || 0) });
          }
        }

        const featureById: Record<string, Array<{ feature: string; count: number }>> = {};
        for (const r of featureRows) {
          const uid = r.user_id as string;
          if (!featureById[uid]) featureById[uid] = [];
          if (featureById[uid].length < 3) {
            featureById[uid].push({ feature: r.feature as string, count: Number(r.cnt || 0) });
          }
        }

        response.users = transformedUsers.map(u => {
          const usage = usageById[u.id] || { totalEvents: 0, pageViews: 0, featureUses: 0, errors: 0, lastActive: null };
          const lastActive = usage.lastActive || lastActiveById[u.id] || null;
          const loginCount = loginCountById[u.id] || 0;
          const effectiveLastLogin = lastActive || lastSessionExpiryById[u.id] || u.lastLoginAt || null;
          const isActive = !!(
            effectiveLastLogin &&
            new Date(effectiveLastLogin) > new Date(sevenDaysAgo) &&
            u.status === 'active'
          );
          return {
            ...u,
            usage: {
              totalEvents: usage.totalEvents,
              pageViews: usage.pageViews,
              featureUses: usage.featureUses,
              errors: usage.errors,
              lastActive,
              topSections: sectionById[u.id] || [],
              topFeatures: featureById[u.id] || [],
            },
            loginCount,
            lastActive,
            lastLoginAt: effectiveLastLogin,
            isActive,
          };
        });
      }
    } catch (usageErr) {
      // P15: لو analytics_events مش متاح، كمّل بالـ users من غير usage data.
      console.warn('[GET /api/admin/users] usage lookup failed (non-fatal):', usageErr);
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/admin/users] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ أثناء جلب المستخدمين',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
