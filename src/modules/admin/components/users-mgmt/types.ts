// UsersManagement types (Phase 3)
export interface UserPromoCode {
  code: string;
  is_active: boolean;
  days_left?: number;
  plan_label?: string;
  premium_days?: number;
  redeemed_at?: string | null;
  expires_at?: string | null;
  [key: string]: unknown;
}

export interface UserUsage {
  pageViews: number;
  featureUses: number;
  errors: number;
  totalEvents: number;
  lastActive?: string | null;
  topSections: Array<{ section: string; count: number }>;
  topFeatures: Array<{ feature: string; count: number }>;
  [key: string]: unknown;
}

export interface UserDetails {
  id: string;
  email: string;
  name: string | null;
  subscription_tier: string;
  created_at: string;
  is_admin: boolean;
  // Extended fields used by UserDetailsDialog
  image?: string | null;
  username?: string | null;
  role?: string;
  status?: string;
  emailVerified?: string | null;
  createdAt?: string;
  lastLoginAt?: string | null;
  loginCount?: number;
  promoCode?: UserPromoCode | null;
  _count?: {
    watchlist?: number;
    portfolio?: number;
    alerts?: number;
    [key: string]: number | undefined;
  };
  usage?: UserUsage | null;
  preferences?: {
    notifications?: boolean;
    darkMode?: boolean;
    language?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
