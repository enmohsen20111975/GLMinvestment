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
    max_watchlist: 5,
    max_portfolio: 1,
    max_alerts: 3,
    ai_analysis: false,
    deep_analysis: false,
    export_data: false,
    priority_support: false,
  },
  normal: {
    max_watchlist: 25,
    max_portfolio: 5,
    max_alerts: 9999,
    ai_analysis: false,
    deep_analysis: true,
    export_data: true,
    priority_support: false,
  },
  premium: {
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

const TRIAL_DAYS = 30;
const WARNING_DAYS = 7;

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
  const isPaidUser = ['normal', 'premium', 'developer', 'admin', 'pro', 'enterprise'].includes(tier);

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
  const diffMs = now.getTime() - validCreated.getTime();
  const daysPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const daysLeft = Math.max(0, TRIAL_DAYS - daysPassed);

  const isInTrial = daysLeft > 0;
  const isTrialExpired = daysLeft <= 0;

  const warningEndsAt = new Date(trialEndsAt.getTime() + WARNING_DAYS * 24 * 60 * 60 * 1000);
  const isInWarning = isTrialExpired && now < warningEndsAt;
  const isExpiredAndDeletionPending = isTrialExpired && now >= warningEndsAt;
  const warningDaysLeft = isInWarning ? Math.max(0, Math.ceil((warningEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;

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
