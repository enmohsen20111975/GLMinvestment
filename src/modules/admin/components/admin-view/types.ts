/**
 * admin-view/types.ts
 * ===================
 * All TypeScript interfaces + union types for the AdminView split
 * (Task F-Phase3-Split-Admin+Predictions).
 *
 * Originally inlined in AdminView.tsx (2,105 LOC). Pure type module — no
 * React, no JSX, no runtime side-effects. Imported by the container, the
 * state hook, and the navigation sub-components.
 */

// ==================== API SHAPES ====================

export interface AdminStats {
 success: boolean;
 timestamp: string;
 users: { total: number; active: number; premium: number };
 stocks: { total: number; active: number; sectors: number; last_update: string | null };
 platform: { watchlist_items: number; portfolio_items: number };
}

export interface ConnectionInfo {
 timestamp: string;
 summary: string;
 sources: Record<string, { available: boolean; message: string; latency_ms?: number }>;
}

export interface SystemIssue {
 id: string;
 severity: 'critical' | 'warning' | 'info';
 category: 'service' | 'data' | 'analysis' | 'system';
 title: string;
 description: string;
 solution?: string;
 timestamp: string;
 actions?: { label: string; action: () => void }[];
}

export interface ServiceStatus {
 name: string;
 nameAr: string;
 status: 'online' | 'offline' | 'degraded';
 latency?: number;
 lastCheck: string;
 message: string;
}

// Data status for each market/type
export interface DataStatusItem {
 category: string;
 name_ar: string;
 count: number;
 last_update: string | null;
 status: 'fresh' | 'stale' | 'old' | 'error';
 minutes_ago: number | null;
 message: string;
}

export interface DataStatus {
 success: boolean;
 timestamp: string;
 summary: {
 total: number;
 fresh: number;
 stale: number;
 old: number;
 error: number;
 health_score: number;
 };
 categories: DataStatusItem[];
}

// ============================================================================
// AdminTab — every tab identifier that can be rendered inside the admin shell.
// ============================================================================
// FIX-P3-P5-P6 (Group P6 — Fix 7) + Task 7-A: pruned dead tabs from the union.
// Tabs that no longer render (and their component files were deleted in 7-A):
// - 'egx' → was a dead alias; rewired to 'learning'
// - 'historical-predictions'→ iframe to /admin/honest-predictions (removed)
// - 'notebooks', 'behavior', 'expert-recs', 'educational-cards'
// - 'crypto', 'gold-silver', 'multi-market', 'forex', 'sectors', 'system-topology', 'data-engine'
// ============================================================================
export type AdminTab =
 | 'dashboard'
 | 'problems'
 | 'general'
 | 'data-engine'
 | 'engine-settings'
 | 'learning'
 | 'backtest'
 | 'users'
 | 'user-management'
 | 'telegram'
 | 'reports'
 | 'databases'
 | 'db-backup'
 | 'system-control'
 | 'system-monitor'
 | 'feedback'
 | 'promo-codes'
 | 'platform-performance'
 | 'news-control'
 | 'marketing-studio'
 // Task 28-B (Fix 1) — Fix Battalion: Sharia management tab (Rule 64).
 | 'sharia'
 // Task 28-B (Fix 2) — Fix Battalion: Source Authority tab (Rule 66).
 | 'source-authority'
 // Task 28-B (Fix 3) — Fix Battalion: Validation Monitor tab (Rule 65).
 | 'validation-monitor'
 // FRONTEND-1 — Data Health dashboard.
 | 'data-health'
 | 'investors-entry'
 // Task 28-B (Fix 4) — Fix Battalion: Cron Health dashboard.
 | 'cron-health'
 // Task 28-B (Fix 5) — Fix Battalion: Pricing + paywall gates status.
 | 'pricing'
 // Task 28-B (Fix 6) — Fix Battalion: News source health dashboard.
 | 'news-health'
 // Task 28-B (Fix 7) — Fix Battalion: Telegram published predictions audit.
 | 'telegram-predictions'
 // Task 31-B (Engine Monitor Battalion) — unified engine control room.
 | 'engine-control-room'
 // (ALPHA-SYSTEM-TOPOLOGY): خريطة النظام الحية — رسم هندسي تفاعلي + حالة كل node.
 | 'system-topology'
 // Legacy tab aliases referenced by older code paths.
 | 'engine-control'
 | 'performance'
 | 'subscriptions'
 | 'news'
 | 'quality';

// Stream C: 6 Core Admin Hubs — consolidates the flat tabs into 6 logical sectors.
export type HubId = 'health' | 'maestro' | 'learning' | 'data' | 'users' | 'telegram';

// ==================== NAV CONFIG TYPES ====================

export interface AdminHubTab {
 id: AdminTab;
 label: string;
 icon: React.ReactNode;
 count?: number;
 desc?: string;
}

export interface AdminHub {
 id: HubId;
 label: string;
 shortLabel: string;
 icon: React.ReactNode;
 accent: string;
 tabs: AdminHubTab[];
}

// ==================== FEEDBACK META ====================

export type FeedbackStatus = 'new' | 'reviewed' | 'resolved';
export type FeedbackType = 'bug' | 'suggestion' | 'opinion' | 'praise';

export interface FeedbackMetaEntry {
 label: string;
 cls: string;
}

// ==================== DEBUG LOG ====================

export interface DebugLogEntry {
 time: string;
 action: string;
 status: string;
 message: string;
 data?: any;
}
