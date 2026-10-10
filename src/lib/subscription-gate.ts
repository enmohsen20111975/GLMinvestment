/**
 * Subscription gating utilities
 * Helps components check feature access based on user's subscription tier.
 */

export interface SubscriptionLimits {
  max_watchlist: number;
  max_portfolio: number;
  max_alerts: number;
  ai_analysis: boolean;
  deep_analysis: boolean;
  export_data: boolean;
  priority_support: boolean;
}

const TIER_LIMITS: Record<string, SubscriptionLimits> = {
  free: {
    max_watchlist: 3,
    max_portfolio: 1,
    max_alerts: 1,
    ai_analysis: false,
    deep_analysis: false,
    export_data: false,
    priority_support: false,
  },
  normal: {
    // legacy — للتوافق مع القديم
    max_watchlist: 25,
    max_portfolio: 3,
    max_alerts: 15,
    ai_analysis: false,
    deep_analysis: true,
    export_data: false,
    priority_support: false,
  },
  premium: {
    max_watchlist: 25,
    max_portfolio: 3,
    max_alerts: 15,
    ai_analysis: false,
    deep_analysis: true,
    export_data: false,
    priority_support: false,
  },
  pro: {
    max_watchlist: 9999,
    max_portfolio: 9999,
    max_alerts: 9999,
    ai_analysis: false,
    deep_analysis: true,
    export_data: true,
    priority_support: true,
  },
  vip_pass: {
    max_watchlist: 9999,
    max_portfolio: 9999,
    max_alerts: 9999,
    ai_analysis: false,
    deep_analysis: true,
    export_data: true,
    priority_support: true,
  },
  b2b_starter: {
    max_watchlist: 9999,
    max_portfolio: 9999,
    max_alerts: 9999,
    ai_analysis: true,
    deep_analysis: true,
    export_data: true,
    priority_support: true,
  },
  b2b_pro: {
    max_watchlist: 9999,
    max_portfolio: 9999,
    max_alerts: 9999,
    ai_analysis: true,
    deep_analysis: true,
    export_data: true,
    priority_support: true,
  },
  b2b_enterprise: {
    max_watchlist: 9999,
    max_portfolio: 9999,
    max_alerts: 9999,
    ai_analysis: true,
    deep_analysis: true,
    export_data: true,
    priority_support: true,
  },
  // legacy tiers
  developer: {
    max_watchlist: 9999,
    max_portfolio: 9999,
    max_alerts: 9999,
    ai_analysis: true,
    deep_analysis: true,
    export_data: true,
    priority_support: true,
  },
  admin: {
    max_watchlist: 9999,
    max_portfolio: 9999,
    max_alerts: 9999,
    ai_analysis: true,
    deep_analysis: true,
    export_data: true,
    priority_support: true,
  },
};

/**
 * Get the limits for a given subscription tier
 */
export function getTierLimits(tier: string): SubscriptionLimits {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

/**
 * Check if user can access a specific feature
 */
export function canAccessFeature(tier: string, feature: keyof SubscriptionLimits): boolean {
  const limits = getTierLimits(tier);
  return Boolean(limits[feature]);
}

/**
 * Check if user can add more items (watchlist/portfolio/alerts)
 */
export function canAddMore(tier: string, feature: 'max_watchlist' | 'max_portfolio' | 'max_alerts', currentCount: number): boolean {
  const limits = getTierLimits(tier);
  return currentCount < limits[feature];
}

// ============================================================================
// FIX-P3-P5-P6 (Group P3 — Fix 1): Server-side trial-expiry gate
// ============================================================================
//
// IMPORTANT — middleware cannot run this check:
//   `src/middleware.ts` runs in the Next.js EDGE runtime, which has no access
//   to the Prisma auth.db connection (Prisma requires Node.js runtime). For the
//   same reason the middleware cannot resolve NextAuth sessions (no DB access).
//   So trial-expiry enforcement is delegated to each protected API route in the
//   Node.js runtime. The route calls `await checkTrialNotExpired(userId)` right
//   after it has resolved the authenticated user.
//
// Behaviour:
//   - Returns { ok: true, ... } if the user's trial is still active OR the user
//     is on a paid tier (paid tiers bypass the trial check).
//   - Returns { ok: false, status: 'TRIAL_EXPIRED' } if the trial has expired
//     AND the user is on a non-paid tier. The caller should respond with
//     HTTP 403 + JSON body { error: 'TRIAL_EXPIRED', upgradeUrl: '/pricing' }.
//   - Non-fatal: any DB error is swallowed and treated as "trial OK" to avoid
//     locking paying users out when the auth DB is temporarily unavailable.
// ============================================================================

export type TrialGateResult =
  | { ok: true; tier: string; isPaid: boolean; trialEndsAt: Date | null }
  | { ok: false; status: 'TRIAL_EXPIRED'; tier: string; trialEndsAt: Date | null; upgradeUrl: string };

// ============================================================================
// Canonical PAID_TIERS constant (P0-5 — Fix Battalion: Unify PAID_TIERS).
// ----------------------------------------------------------------------------
// This is the SINGLE SOURCE OF TRUTH for the list of paid subscription tiers.
// Every route/helper/module that needs "is this user paid?" MUST import this
// constant and call `PAID_TIERS.has(tier)`. DO NOT inline a local array —
// inlining caused the BREACH where /api/admin/users/cleanup-expired treated
// b2b_starter users as free and DELETED their accounts (Rule 50 —
// MONEY-AS-CUSTOMER-LIFE). See worklog.md Task 16-A finding #7 + Task P0-5.
// ============================================================================

export const PAID_TIERS = new Set([
  'normal',
  'premium',
  'pro',
  'vip_pass',
  'developer',
  'admin',
  'enterprise',
  'b2b_starter',
  'b2b_pro',
  'b2b_enterprise',
]);

// ============================================================================
// P0-2 (Fix Battalion — Subscription Expiry Mechanism): TTL cache for the
// `UserSubscription.expires_at` lookup that `checkTrialNotExpired` performs
// on every API call. Without this cache, every protected route would issue
// an extra Prisma query per request. The cache is bounded (LRU-ish) so a
// long-running Next.js server process can never leak memory.
// ----------------------------------------------------------------------------
// TTL = 60s. A subscriber whose `expires_at` crosses NOW between two requests
// inside the same 60s window would be granted access for up to 60s past
// expiry — acceptable per Rule 50 (MONEY-AS-CUSTOMER-LIFE): erring on the
// side of granting access for ~1 minute is far safer than erring on the
// side of locking a paying customer out. The daily cron (Part 2) performs
// the authoritative downgrade regardless.
// ============================================================================
const SUB_STATUS_CACHE_TTL_MS = 60_000;
const SUB_STATUS_CACHE_MAX = 10_000;
const subStatusCache = new Map<string, { active: boolean; ts: number }>();

/**
 * Look up the user's UserSubscription row and return whether it is still
 * active (expires_at > now). Fail-open semantics (Rule 50):
 *   - No subscription row → assume lifetime/grandfathered → return true.
 *   - expires_at is null  → assume lifetime subscription    → return true.
 *   - DB error            → log + return true (don't lock paying users out).
 *   - expires_at <= now   → return false (sub expired, gate should apply).
 *
 * @param userId  Prisma User.id (CUID).
 */
async function isPaidSubscriptionActive(userId: string): Promise<boolean> {
  const now = Date.now();
  const cached = subStatusCache.get(userId);
  if (cached && now - cached.ts < SUB_STATUS_CACHE_TTL_MS) {
    return cached.active;
  }

  let active = true; // fail-open default — see docstring.
  try {
    // Lazy import — keeps the auth Prisma client out of any code path
    // that doesn't actually need it (and out of edge-runtime bundling).
    const { authDb } = await import('@/lib/db-auth');
    // UserSubscription has a UNIQUE constraint on user_id (per
    // prisma/auth-schema.prisma) so findFirst by user_id returns at most
    // one row. We don't filter by status='active' because we want to
    // detect "explicitly expired" rows too — if status='expired' OR
    // expires_at < now, the user is no longer actively subscribed.
    const sub = await authDb.userSubscription.findFirst({
      where: { user_id: userId },
      select: { expires_at: true, status: true },
    });

    if (!sub) {
      // No subscription row at all. Could be: admin tier set via env,
      // developer/manual grant without a row, or a legacy user from
      // before UserSubscription existed. Fail-open per Rule 50.
      active = true;
    } else if (sub.status === 'expired' || sub.status === 'cancelled') {
      // Explicitly marked as expired or cancelled.
      active = false;
    } else if (!sub.expires_at) {
      // expires_at is null → assume lifetime subscription (e.g. admin
      // grants, lifetime promo). Fail-open.
      active = true;
    } else {
      const exp = new Date(sub.expires_at);
      if (isNaN(exp.getTime())) {
        // Unparseable expires_at — fail-open rather than lock user out.
        active = true;
      } else {
        active = exp.getTime() > now;
      }
    }
  } catch (err) {
    // Fail-open: if we can't read the auth DB we MUST NOT lock paying
    // users out. Log + treat as active. The daily cron will reconcile.
    console.warn(
      '[subscription-gate] isPaidSubscriptionActive: auth DB read failed, failing open:',
      err
    );
    active = true;
  }

  // Bounded cache: if we've grown past MAX, drop the oldest entry
  // (Map preserves insertion-order iteration, so the first key is the
  // oldest). Prevents unbounded memory growth in long-running servers.
  if (subStatusCache.size >= SUB_STATUS_CACHE_MAX) {
    const firstKey = subStatusCache.keys().next().value;
    if (firstKey !== undefined) subStatusCache.delete(firstKey);
  }
  subStatusCache.set(userId, { active, ts: now });
  return active;
}

/**
 * Server-side trial expiry check.
 *
 * Reads the user's `subscription_tier`, `created_at`, and `trial_ends_at` from
 * the auth DB (Prisma) and applies the same `getTrialStatus` logic used by the
 * client. When the trial has expired AND the user is on a non-paid tier, the
 * function returns `{ ok: false, status: 'TRIAL_EXPIRED' }` so the route can
 * respond 403.
 *
 * P0-2 (Fix Battalion): previously a paid `subscription_tier` bypassed this
 * check FOREVER — `UserSubscription.status` was flipped to 'expired' but
 * `User.subscription_tier` was never downgraded, so `PAID_TIERS.has(tier)`
 * stayed true forever (direct revenue leak). Now we ALSO consult
 * `UserSubscription.expires_at`: if the latest subscription row is expired,
 * the user is treated as a free user and the trial check applies (which will
 * return TRIAL_EXPIRED for anyone whose 14-day window has also elapsed).
 *
 * @param userId  Prisma User.id (CUID) — obtained via `getSessionUserId()`
 */
export async function checkTrialNotExpired(userId: string | null): Promise<TrialGateResult> {
  // No userId → unauthenticated. We do NOT block here; the route's own auth
  // check will return 401 first. This keeps the gate strictly a trial check.
  if (!userId) {
    return { ok: true, tier: 'free', isPaid: false, trialEndsAt: null };
  }

  let tier = 'free';
  let createdAt: Date | null = null;
  let trialEndsAt: Date | null = null;

  try {
    // Lazy import — keeps the auth Prisma client out of any code path that
    // doesn't actually need it (and out of any edge-runtime bundling).
    const { authDb } = await import('@/lib/db-auth');
    const user = await authDb.user.findUnique({
      where: { id: userId },
      select: {
        subscription_tier: true,
        created_at: true,
        trial_ends_at: true,
      },
    });
    if (user) {
      tier = (user.subscription_tier || 'free').toLowerCase();
      createdAt = user.created_at ?? null;
      trialEndsAt = user.trial_ends_at ?? null;
    }
  } catch (err) {
    // Fail-open: if we can't read the auth DB we MUST NOT lock paying users
    // out. Log + allow the request through. The route can still enforce its
    // own auth checks.
    console.warn('[subscription-gate] checkTrialNotExpired: auth DB read failed, failing open:', err);
    return { ok: true, tier: 'free', isPaid: false, trialEndsAt: null };
  }

  // Paid users bypass the trial check — UNLESS their subscription has
  // actually expired (P0-2 fix: was bypass-forever bug).
  if (PAID_TIERS.has(tier)) {
    // `admin` tier is set via the ADMIN_EMAILS / ADMIN_USERNAMES env vars
    // (see src/lib/admin-identities.ts) and NEVER has a UserSubscription row.
    // It must bypass the expiry check unconditionally — admins are
    // permanent staff, not paying customers whose access can lapse.
    if (tier !== 'admin') {
      const subActive = await isPaidSubscriptionActive(userId);
      if (!subActive) {
        // Subscription expired → treat the user as a free user so the
        // trial check below applies (returns TRIAL_EXPIRED for anyone
        // whose 14-day trial window has also elapsed). We override the
        // tier passed to getTrialStatus to 'free' so its paid-tier
        // short-circuit doesn't kick in (otherwise the paid tier would
        // bypass the trial check from inside getTrialStatus too).
        const status = getTrialStatus({
          subscription_tier: 'free',
          created_at: createdAt,
          trial_ends_at: trialEndsAt,
        });
        if (status.isTrialExpired) {
          return {
            ok: false,
            status: 'TRIAL_EXPIRED',
            tier: 'free',
            trialEndsAt: status.trialEndsAt,
            upgradeUrl: '/pricing',
          };
        }
        return { ok: true, tier: 'free', isPaid: false, trialEndsAt: status.trialEndsAt };
      }
    }
    return { ok: true, tier, isPaid: true, trialEndsAt };
  }

  // Free users — apply the trial window using the same logic as the client.
  const status = getTrialStatus({
    subscription_tier: tier,
    created_at: createdAt,
    trial_ends_at: trialEndsAt,
  });

  if (status.isTrialExpired) {
    return {
      ok: false,
      status: 'TRIAL_EXPIRED',
      tier,
      trialEndsAt: status.trialEndsAt,
      upgradeUrl: '/pricing',
    };
  }

  return { ok: true, tier, isPaid: false, trialEndsAt: status.trialEndsAt };
}

/**
 * Convenience wrapper for API routes: returns a 403 response shape when the
 * trial has expired, or null when the request may proceed.
 *
 * Usage:
 *   const { userId } = await getSessionUserId();
 *   if (!userId) return NextResponse.json({...}, { status: 401 });
 *   const trialBlock = await trialExpiredResponse(userId);
 *   if (trialBlock) return NextResponse.json(trialBlock.body, { status: trialBlock.status });
 *   // ...rest of handler...
 */
export async function trialExpiredResponse(userId: string | null): Promise<
  | { status: 403; body: { error: 'TRIAL_EXPIRED'; upgradeUrl: string } }
  | null
> {
  const result = await checkTrialNotExpired(userId);
  if (!result.ok) {
    return {
      status: 403,
      body: { error: 'TRIAL_EXPIRED', upgradeUrl: result.upgradeUrl },
    };
  }
  return null;
}

/**
 * Get the remaining capacity for a feature
 */
export function getRemainingCapacity(tier: string, feature: 'max_watchlist' | 'max_portfolio' | 'max_alerts', currentCount: number): number {
  const limits = getTierLimits(tier);
  return Math.max(0, limits[feature] - currentCount);
}

/**
 * Get the Arabic name for a tier
 */
export function getTierNameAr(tier: string): string {
  const names: Record<string, string> = {
    free: 'مجانى',
    normal: 'عادى',
    premium: 'مميز',
  };
  return names[tier] || tier;
}

/**
 * Get the Arabic description for a tier
 */
export function getTierDescriptionAr(tier: string): string {
  const descriptions: Record<string, string> = {
    free: 'الخطة الأساسية — مجانية للجميع',
    normal: 'الخطة المتقدمة — للمستثمرين الجادين',
    premium: 'الخطة الاحترافية — الوصول الكامل لجميع الميزات',
  };
  return descriptions[tier] || '';
}

/**
 * Check if user needs to upgrade to access a feature, returns upgrade info
 */
export function getUpgradeInfo(tier: string, feature: keyof SubscriptionLimits): {
  needsUpgrade: boolean;
  requiredTier: string;
  requiredTierAr: string;
  message: string;
} | null {
  if (canAccessFeature(tier, feature)) return null;

  // Determine minimum tier needed
  if (TIER_LIMITS.normal[feature]) {
    return {
      needsUpgrade: true,
      requiredTier: 'normal',
      requiredTierAr: 'عادى',
      message: `هذه الميزة متاحة في باقة عادى أو أعلى. قم بالترقية للوصول إليها.`,
    };
  }

  return {
    needsUpgrade: true,
    requiredTier: 'premium',
    requiredTierAr: 'مميز',
    message: `هذه الميزة متاحة في باقة مميز فقط. قم بالترقية للوصول إليها.`,
  };
}

export interface TrialStatus {
  isFreeUser: boolean;
  isInTrial: boolean;
  isInWarning: boolean;
  isTrialExpired: boolean;
  isExpiredAndDeletionPending: boolean;
  daysPassed: number;
  daysLeft: number;
  warningDaysLeft: number;
  totalDays: number;
  warningDays: number;
  createdAt: Date | null;
  trialEndsAt: Date | null;
}

// ─── CANONICAL-CALCULATIONS (Task SUBSCRIPTION-FIX-2026-10-07, Rule 67) ─────
// TRIAL_DAYS exported — كان hardcoded في subscription/status/route.ts (14)
// مختلف عن القيمة هنا (7). الحل: استيرادها من هنا (مصدر واحد).
export const TRIAL_DAYS = 7;
const WARNING_DAYS = 0; // انتهاء الفترة التجريبية = حظر فوري (من غير فترة سماح)

/**
 * Calculate free trial status for a user based on registration date (created_at).
 * Free users get 30 days of full access from account creation date.
 * After 30 days, they are forced to subscribe to continue using protected features.
 */
export function getTrialStatus(
  user?: { subscription_tier?: string | null; created_at?: string | Date | null; trial_ends_at?: string | Date | null } | null
): TrialStatus {
  if (!user) {
    return {
      isFreeUser: true,
      isInTrial: false,
      isInWarning: false,
      isTrialExpired: false,
      isExpiredAndDeletionPending: false,
      daysPassed: 0,
      daysLeft: 0,
      warningDaysLeft: 0,
      totalDays: TRIAL_DAYS,
      warningDays: WARNING_DAYS,
      createdAt: null,
      trialEndsAt: null,
    };
  }

  const tier = (user.subscription_tier || 'free').toLowerCase();
  // P0-5: use the canonical PAID_TIERS Set (defined at the top of this file)
  // instead of an inline array. Same 9-tier list — single source of truth.
  const isPaidUser = PAID_TIERS.has(tier);

  if (isPaidUser) {
    return {
      isFreeUser: false,
      isInTrial: false,
      isInWarning: false,
      isTrialExpired: false,
      isExpiredAndDeletionPending: false,
      daysPassed: 0,
      daysLeft: TRIAL_DAYS,
      warningDaysLeft: 0,
      totalDays: TRIAL_DAYS,
      warningDays: WARNING_DAYS,
      createdAt: user.created_at ? new Date(user.created_at) : null,
      trialEndsAt: null,
    };
  }

  const createdAt = user.created_at ? new Date(user.created_at) : new Date();
  const validCreated = !isNaN(createdAt.getTime()) ? createdAt : new Date();
  const trialEndsAt = user.trial_ends_at ? new Date(user.trial_ends_at) : new Date(validCreated.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const now = new Date();
  const isTrialExpired = now.getTime() > trialEndsAt.getTime();
  const msLeft = trialEndsAt.getTime() - now.getTime();
  const daysLeft = isTrialExpired ? 0 : Math.max(1, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
  const daysPassed = Math.max(0, Math.floor((now.getTime() - validCreated.getTime()) / (1000 * 60 * 60 * 24)));

  const isInTrial = !isTrialExpired;

  const warningEndsAt = trialEndsAt; // مفيش فترة سماح — الحظر فوري
  const isInWarning = false;
  const isExpiredAndDeletionPending = isTrialExpired; // الحظر = الحذف فعلياً
  const warningDaysLeft = 0;

  return {
    isFreeUser: true,
    isInTrial,
    isInWarning,
    isTrialExpired,
    isExpiredAndDeletionPending,
    daysPassed,
    daysLeft,
    warningDaysLeft,
    totalDays: TRIAL_DAYS,
    warningDays: WARNING_DAYS,
    createdAt: validCreated,
    trialEndsAt,
  };
}

// ============================================================================
// AI Daily Usage + Radar Preview helpers (NEW — Task SUBSCRIPTION-SYSTEM)
// ============================================================================

/** الحد اليومي للـ AI لكل tier (Qwen محلي) */
export const AI_DAILY_LIMITS: Record<string, number> = {
  free: 3,
  normal: 9999,
  premium: 9999,
  pro: 9999,
  b2b_starter: 9999,
  b2b_pro: 9999,
  b2b_enterprise: 9999,
  developer: 9999,
  admin: 9999,
};

/**
 * تحديد هل المستخدم يقدر يستخدم AI دلوقتي (بناءً على الاستخدام اليومي).
 * Free: 3 رسائل/يوم. الباقي: غير محدود.
 */
export function canUseAI(tier: string, usedToday: number): { allowed: boolean; remaining: number; limit: number } {
  const limit = AI_DAILY_LIMITS[(tier || 'free').toLowerCase()] ?? 3;
  const remaining = Math.max(0, limit - usedToday);
  return { allowed: remaining > 0, remaining, limit };
}

/**
 * هل المستخدم يشوف رادار السيولة كامل ولا preview متأخر ساعة؟
 * Free (بعد انتهاء الـ trial) → preview متأخر ساعة
 * Premium+ → لحظي كامل
 */
export function getRadarAccess(tier: string): { live: boolean; delayMinutes: number; previewOnly: boolean } {
  const t = (tier || 'free').toLowerCase();
  const paid = ['premium', 'pro', 'b2b_starter', 'b2b_pro', 'b2b_enterprise', 'developer', 'admin'].includes(t);
  if (paid) return { live: true, delayMinutes: 0, previewOnly: false };
  return { live: false, delayMinutes: 60, previewOnly: true };
}

/**
 * هل المستخدم يقدر يدخل Pro features (backtest / Devil / Hunter / API access)?
 */
export function canAccessProFeatures(tier: string): boolean {
  const t = (tier || 'free').toLowerCase();
  return ['pro', 'b2b_starter', 'b2b_pro', 'b2b_enterprise', 'developer', 'admin'].includes(t);
}

/**
 * هل المستخدم B2B (مع API access)?
 */
export function isB2BTier(tier: string): boolean {
  const t = (tier || 'free').toLowerCase();
  return ['b2b_starter', 'b2b_pro', 'b2b_enterprise'].includes(t);
}

/**
 * أسماء الـ tiers الجديدة بالعربي
 */
export function getTierNameArExtended(tier: string): string {
  const names: Record<string, string> = {
    free: 'مجاني',
    normal: 'عادي (قديم)',
    premium: 'بريميوم',
    pro: 'برو',
    b2b_starter: 'B2B Starter',
    b2b_pro: 'B2B Pro',
    b2b_enterprise: 'B2B Enterprise',
    developer: 'مطوّر',
    admin: 'مدير',
  };
  return names[(tier || 'free').toLowerCase()] || tier;
}
