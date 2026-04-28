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
    max_portfolio: 3,
    max_alerts: 10,
    ai_analysis: false,
    deep_analysis: false,
    export_data: false,
    priority_support: false,
  },
  plus: {
    max_watchlist: 20,
    max_portfolio: 10,
    max_alerts: 50,
    ai_analysis: true,
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
    free: 'مجاني',
    plus: 'بلس',
    premium: 'بريميوم',
  };
  return names[tier] || tier;
}

/**
 * Get the Arabic description for a tier
 */
export function getTierDescriptionAr(tier: string): string {
  const descriptions: Record<string, string> = {
    free: 'الخطة الأساسية — تجربة مجانية لمدة 7 أيام',
    plus: 'الخطة المتقدمة — للمرشحين الجادين في الاستثمار',
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
  if (TIER_LIMITS.plus[feature]) {
    return {
      needsUpgrade: true,
      requiredTier: 'plus',
      requiredTierAr: 'بلس',
      message: `هذه الميزة متاحة في باقة بلس أو أعلى. قم بالترقية للوصول إليها.`,
    };
  }

  return {
    needsUpgrade: true,
    requiredTier: 'premium',
    requiredTierAr: 'بريميوم',
    message: `هذه الميزة متاحة في باقة بريميوم فقط. قم بالترقية للوصول إليها.`,
  };
}
