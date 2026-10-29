import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import { getFinanceDb } from '@/lib/finance-db';
import { PAID_TIERS } from '@/lib/subscription-gate';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/admin/users
// Return all registered users - Python handles auth, Node.js just displays
// ---------------------------------------------------------------------------

// ANALYTICS-FIX (2026-10-01): activity-status helper.
// Uses User.last_active_at (written by /api/track + auth-helper) with
// fallback to User.last_login when last_active_at is null.
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type ActivityStatus = 'active_now' | 'active_recent' | 'active_month' | 'inactive';

function parseSafeDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'number') return new Date(raw < 10000000000 ? raw * 1000 : raw);
  if (typeof raw === 'string') {
    if (/^\d+$/.test(raw)) {
      const n = parseInt(raw, 10);
      return new Date(n < 10000000000 ? n * 1000 : n);
    }
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function computeActivityStatus(
  lastActiveAt: unknown,
  lastLogin: unknown,
): ActivityStatus {
  let ms = 0;
  for (const raw of [lastActiveAt, lastLogin]) {
    const d = parseSafeDate(raw);
    if (d && !isNaN(d.getTime())) { ms = d.getTime(); break; }
  }
  if (!ms) return 'inactive';
  const delta = Date.now() - ms;
  if (delta <= FIFTEEN_MIN_MS) return 'active_now';
  if (delta <= SEVEN_DAYS_MS) return 'active_recent';
  if (delta <= THIRTY_DAYS_MS) return 'active_month';
  return 'inactive';
}

// Rule 30 (CLIENT-FACING-STYLE): Arabic labels for the admin UI.
const ACTIVITY_LABEL: Record<ActivityStatus, string> = {
  active_now: 'نشط الآن',
  active_recent: 'نشط مؤخراً',
  active_month: 'نشط هذا الشهر',
  inactive: 'غير نشط',
};

const ACTIVITY_EMOJI: Record<ActivityStatus, string> = {
  active_now: '🟢',
  active_recent: '🟡',
  active_month: '🟠',
  inactive: '⚪',
};

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
          // ANALYTICS-FIX: new column drives real activity status.
          last_active_at: true,
          email_verified: true,
          created_at: true,
          updated_at: true,
          trial_ends_at: true,
          trial_warning_sent_at: true,
          trial_deletion_scheduled_at: true,
        },
      });
    } catch (dbError) {
      console.warn('[GET /api/admin/users] Standard findMany query failed, falling back to auto-heal and raw SQL query:', dbError);
      try {
        // Step 1: Auto-heal any epoch millisecond strings in auth.db User table
        try {
          await db.$executeRawUnsafe(`
            UPDATE User 
            SET last_active_at = datetime(CAST(last_active_at AS REAL) / 1000, 'unixepoch')
            WHERE last_active_at IS NOT NULL
              AND typeof(last_active_at) = 'text' 
              AND CAST(last_active_at AS REAL) > 1000000000000
          `);
          await db.$executeRawUnsafe(`
            UPDATE User 
            SET last_login = datetime(CAST(last_login AS REAL) / 1000, 'unixepoch')
            WHERE last_login IS NOT NULL
              AND typeof(last_login) = 'text' 
              AND CAST(last_login AS REAL) > 1000000000000
          `);
          await db.$executeRawUnsafe(`
            UPDATE User 
            SET created_at = datetime(CAST(created_at AS REAL) / 1000, 'unixepoch')
            WHERE typeof(created_at) = 'text' 
              AND CAST(created_at AS REAL) > 1000000000000
          `);
        } catch {
          // ignore auto-heal error if table or column varies
        }

        // Step 2: Try Prisma findMany again
        try {
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
              last_active_at: true,
              email_verified: true,
              created_at: true,
              updated_at: true,
              trial_ends_at: true,
              trial_warning_sent_at: true,
              trial_deletion_scheduled_at: true,
            },
          });
        } catch {
          // Step 3: Raw SQL fallback (completely immune to Prisma DateTime parsing failures)
          users = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT id, email, name, username, image, is_active, subscription_tier, default_risk_tolerance, last_login, last_active_at, email_verified, created_at, updated_at, trial_ends_at, trial_warning_sent_at, trial_deletion_scheduled_at FROM User ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            pageSize,
            (page - 1) * pageSize
          );
          if (total === 0) {
            const countRow = await db.$queryRawUnsafe<Array<{ count: number }>>('SELECT COUNT(*) as count FROM User');
            total = Number(countRow?.[0]?.count || users.length);
          }
        }
      } catch (fatalFallbackError) {
        console.error('[GET /api/admin/users] Both standard and raw fallback failed:', fatalFallbackError);
        return NextResponse.json(
          {
            success: false,
            error: 'DB_UNAVAILABLE',
            details: fatalFallbackError instanceof Error ? fatalFallbackError.message : String(fatalFallbackError),
          },
          { status: 500 }
        );
      }
    }

    // Promo code lookup for all users
    const promoByUserId: Record<string, any> = {};
    try {
      await db.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS PromoRedemption (
          id TEXT PRIMARY KEY,
          promo_code_id TEXT,
          code TEXT NOT NULL,
          user_id TEXT NOT NULL,
          plan_tier TEXT NOT NULL,
          premium_days INTEGER NOT NULL,
          redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME
        )
      `);
      
      const redemptions = await db.$queryRawUnsafe<Array<any>>(`
        SELECT id, promo_code_id, code, user_id, plan_tier, premium_days, redeemed_at, expires_at
        FROM PromoRedemption
        ORDER BY redeemed_at DESC
      `);

      for (const r of redemptions) {
        if (!promoByUserId[r.user_id]) {
          const now = Date.now();
          const expMs = r.expires_at ? new Date(r.expires_at).getTime() : null;
          const isExpired = expMs !== null ? expMs <= now : false;
          const daysLeft = expMs !== null ? Math.max(0, Math.ceil((expMs - now) / (1000 * 60 * 60 * 24))) : (r.premium_days || 30);
          
          let planLabel = 'باقة المحترفين (Premium)';
          if (r.plan_tier === 'all' || r.plan_tier === 'developer') {
            planLabel = 'VIP شامل (جميع المميزات)';
          } else if (r.plan_tier === 'normal') {
            planLabel = 'الباقة العادية';
          }

          promoByUserId[r.user_id] = {
            id: r.id,
            promo_code_id: r.promo_code_id,
            code: r.code,
            plan_tier: r.plan_tier,
            plan_label: planLabel,
            premium_days: r.premium_days,
            redeemed_at: parseSafeDate(r.redeemed_at)?.toISOString() || r.redeemed_at,
            expires_at: parseSafeDate(r.expires_at)?.toISOString() || r.expires_at,
            days_left: daysLeft,
            is_active: !isExpired,
            is_expired: isExpired,
          };
        }
      }

      // Also fallback for PromoCode where redeemed_by is set
      const promoCodes = await db.promoCode.findMany({
        where: { redeemed_by: { not: null } },
      });
      for (const pc of promoCodes) {
        if (pc.redeemed_by && !promoByUserId[pc.redeemed_by]) {
          const now = Date.now();
          const expMs = pc.expires_at ? pc.expires_at.getTime() : null;
          const isExpired = expMs !== null ? expMs <= now : false;
          const daysLeft = expMs !== null ? Math.max(0, Math.ceil((expMs - now) / (1000 * 60 * 60 * 24))) : (pc.premium_days || 30);
          let planLabel = 'باقة المحترفين (Premium)';
          if (pc.plan_tier === 'all' || pc.plan_tier === 'developer') {
            planLabel = 'VIP شامل (جميع المميزات)';
          } else if (pc.plan_tier === 'normal') {
            planLabel = 'الباقة العادية';
          }
          promoByUserId[pc.redeemed_by] = {
            id: `legacy_${pc.id}`,
            promo_code_id: pc.id,
            code: pc.code,
            plan_tier: pc.plan_tier,
            plan_label: planLabel,
            premium_days: pc.premium_days,
            redeemed_at: pc.updated_at ? pc.updated_at.toISOString() : pc.created_at.toISOString(),
            expires_at: pc.expires_at ? pc.expires_at.toISOString() : null,
            days_left: daysLeft,
            is_active: !isExpired,
            is_expired: isExpired,
          };
        }
      }
    } catch (promoErr) {
      console.warn('[GET /api/admin/users] PromoRedemption lookup failed (non-fatal):', promoErr);
    }

    const transformedUsers = users.map((user: any) => {
      const tier = (user.subscription_tier as string) || 'free';
      const isPaid = PAID_TIERS.has(tier.toLowerCase());
      let trialStatus: any = null;

      const createdAtDate = parseSafeDate(user.created_at);
      if (!isPaid && createdAtDate) {
        const now = new Date();
        const diffMs = now.getTime() - createdAtDate.getTime();
        const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const daysLeft = Math.max(0, 30 - daysPassed);
        const isInTrial = daysLeft > 0;

        const trialEndsDate = parseSafeDate(user.trial_ends_at) || new Date(createdAtDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        const warningEndsAt = new Date(trialEndsDate.getTime() + 7 * 24 * 60 * 60 * 1000);
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
          trialEndsAt: trialEndsDate.toISOString(),
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
        status: Boolean(user.is_active) ? 'active' : 'inactive',
        emailVerified: parseSafeDate(user.email_verified)?.toISOString() || user.email_verified,
        createdAt: parseSafeDate(user.created_at)?.toISOString() || user.created_at,
        updatedAt: parseSafeDate(user.updated_at)?.toISOString() || user.updated_at,
        lastLoginAt: parseSafeDate(user.last_login)?.toISOString() || user.last_login,
        last_active_at: parseSafeDate(user.last_active_at)?.toISOString() || null,
        activity_status: computeActivityStatus(
          user.last_active_at,
          user.last_login,
        ),
        activity_label: ACTIVITY_LABEL[computeActivityStatus(
          user.last_active_at as string | Date | null,
          user.last_login as string | Date | null,
        )],
        activity_emoji: ACTIVITY_EMOJI[computeActivityStatus(
          user.last_active_at as string | Date | null,
          user.last_login as string | Date | null,
        )],
        loginCount: 0,
        preferences: {
          notifications: true,
          darkMode: false,
          language: 'ar',
        },
        trialStatus,
        promoCode: promoByUserId[user.id] || null,
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
        const ids = transformedUsers.map((u: any) => u.id);
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

        let sessions: Array<{ userId: string; expires: any }> = [];
        try {
          sessions = await db.session.findMany({
            where: { userId: { in: ids } },
            select: { userId: true, expires: true },
          }) as any;
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
        response.users = transformedUsers.map((u: any) => {
          // ANALYTICS-FIX (2026-10-01): prefer analytics_events last_active
          // (most granular) — but fall back to last_active_at / lastLoginAt
          // when analytics_events is empty (the common case for real users
          // who only just started being tracked).
          const lastActive = lastActiveById[u.id]
            || (u as any).last_active_at
            || null;
          const loginCount = loginCountById[u.id] || 0;
          const effectiveLastLogin = lastActive
            || lastSessionExpiryById[u.id]
            || (u as any).last_active_at
            || u.lastLoginAt
            || null;
          const isActive = !!(
            effectiveLastLogin &&
            new Date(effectiveLastLogin) > new Date(sevenDaysAgo) &&
            u.status === 'active'
          );
          // Re-derive activity_status_* from the merged signal (analytics_events
          // last_active OR User.last_active_at OR User.last_login) so the
          // status reflects the freshest timestamp we have.
          const mergedStatus = computeActivityStatus(
            lastActive || (u as any).last_active_at || null,
            u.lastLoginAt as string | Date | null,
          );
          return {
            ...u,
            loginCount,
            lastActive,
            lastLoginAt: effectiveLastLogin,
            isActive,
            activity_status: mergedStatus,
            activity_label: ACTIVITY_LABEL[mergedStatus],
            activity_emoji: ACTIVITY_EMOJI[mergedStatus],
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
        const ids = transformedUsers.map((u: any) => u.id);
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

        response.users = transformedUsers.map((u: any) => {
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

    // Promo filtering and stats calculation
    const promoFilter = searchParams.get('promo') || searchParams.get('promoFilter') || 'all';
    const allUsers = response.users || transformedUsers;
    const totalWithPromo = allUsers.filter((u: any) => !!u.promoCode).length;
    const activePromoUsers = allUsers.filter((u: any) => u.promoCode && u.promoCode.is_active).length;
    const expiredPromoUsers = totalWithPromo - activePromoUsers;

    response.promoStats = {
      totalWithPromo,
      activePromoUsers,
      expiredPromoUsers,
    };

    if (promoFilter !== 'all') {
      response.users = allUsers.filter((u: any) => {
        if (promoFilter === 'with_promo') return !!u.promoCode;
        if (promoFilter === 'active_promo') return u.promoCode && u.promoCode.is_active;
        if (promoFilter === 'expired_promo') return u.promoCode && u.promoCode.is_expired;
        if (promoFilter === 'vip') return u.promoCode && (u.promoCode.plan_tier === 'all' || u.promoCode.plan_tier === 'developer');
        if (promoFilter === 'premium') return u.promoCode && u.promoCode.plan_tier === 'premium';
        if (promoFilter === 'normal') return u.promoCode && u.promoCode.plan_tier === 'normal';
        if (promoFilter === 'without_promo') return !u.promoCode;
        return true;
      });
      response.total = response.users.length;
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
