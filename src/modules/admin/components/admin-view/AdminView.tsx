/**
 * admin-view/AdminView.tsx (container)
 * ===================================
 * Thin orchestrator. Owns:
 *  - All `withErrorBoundary(dynamic(...))` lazy-loaded heavy sub-components
 *    (kept at module scope so they're created once per page load).
 *  - The `useAdminState()` hook call (delegates all state + fetches).
 *  - The mount guard (Loader2 spinner while mounting) + non-admin login gate
 *    (<AdminLoginCard />).
 *  - The render layout: <AdminHeader /> + <QuickAccessBar /> + <AdminNav />
 *    + a long sequence of `activeTab === 'X' && <ComponentX />` conditionals.
 *
 * Sub-components live in this folder:
 *  - types.ts             (interfaces + AdminTab + HubId unions)
 *  - admin-fetch.ts        (tryAutoCookie + adminFetch helpers)
 *  - useAdminState.ts      (the big state hook — all state + fetches + derived)
 *  - admin-hubs.tsx        (buildAdminHubs: the 6 hubs nav config builder)
 *  - AdminHeader.tsx       (top header w/ health badge)
 *  - QuickAccessBar.tsx    (shortcut bar)
 *  - AdminNav.tsx          (mobile + desktop hub nav)
 *  - AdminLoginCard.tsx    (login form for non-admins)
 *  - DashboardTab.tsx      (the `dashboard` tab content)
 *  - UsersTab.tsx          (the `users` tab content)
 *  - UserFeedbackTab.tsx   (the `feedback` tab sub-component)
 *
 * Total container LOC: ~270 (well under the <500 LOC constraint).
 */

'use client';

// MAESTRO-DISABLED (Task PHASE-2-MAESTRO-KILL, Rule 73)
// -----------------------------------------------------------------------------
// This file does NOT call `/api/maestro/*`. All fetches go to:
// /api/admin/*, /api/market/*, /api/prediction-performance,
// /api/self-learning, /api/data-status, /api/feedback, /api/multi-market/*,
// /api/track — none of which are maestro endpoints.
//
// Remaining "maestro" references in this file are:
// 1. `HubId = '...' | 'maestro' | '...'` — internal string identifier for a
// hub grouping (engines + learning). Renaming would require a UI-wide
// refactor. Left intact per conservative clause of PHASE-2-MAESTRO-UI.
// 2. `{ id: 'maestro', label: 'المحركات والتعلم الذكي' }` — hub definition
// using the legacy id; the Arabic label already says "engines + learning".
// 3. Button subtitle "Maestro Command Center" — cosmetic UI string.
// 4. Historical comments describing removed code (MaestroCommandCenter /
// MaestroDashboard monoliths, already deleted in FIX-P3-P5-P6) — kept
// for traceability.
//
// Per Rule 4 (NO-DELETION) and the conservative clause, these identifiers
// and comments are NOT modified. The legacy MaestroCommandCenter component
// itself was already deleted in earlier phases; only trace comments remain.
// -----------------------------------------------------------------------------

import React from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { useSession } from '@/lib/next-auth-shim'; // kept for hook parity
import { LazyTabLoader } from '@/components/shared/LazyTabLoader';
import { withErrorBoundary } from '@/components/shared/ErrorBoundary';
import { RegimeDetectionWidget } from '@/modules/admin/components/RegimeDetectionWidget';
import { PlatformPerformanceView } from '@/modules/admin/components/platform-performance/PlatformPerformanceView';
import { BacktestTab } from '@/modules/admin/components/BacktestTab';
import { DbBackupPanel } from '@/modules/admin/components/DbBackupPanel';
import { SystemMonitorPanel } from '@/modules/admin/components/SystemMonitorPanel';
// (ALPHA-SYSTEM-TOPOLOGY): خريطة النظام الحية — رسم هندسي تفاعلي + حالة كل node.
import { SystemTopologyView } from '@/modules/admin/components/SystemTopologyView';
// ADMIN-CLEANUP: switched from UserManagementPanel (legacy, 904 LOC, fetches /users/[id] directly)
// to UsersManagement (newer, split into users-mgmt/ folder, uses adminFetch helper)
import { UsersManagement } from '@/modules/admin/components/UsersManagement';

import { EnginesStatusTab } from '@/modules/admin/components/EnginesStatusTab';
import { DataEngineTab } from '@/modules/admin/components/DataEngineTab';
import { EngineSettingsTab } from '@/modules/admin/components/EngineSettingsTab';
import { TelegramTab } from '@/modules/admin/components/TelegramTab';
import { PromoCodesAdmin } from '@/modules/admin/components/PromoCodesAdmin';
import { SystemProblemsTab } from '@/modules/admin/components/SystemProblemsTab';
// Task 28-B (Fix 1) — Fix Battalion: Sharia management tab (Rule 64).
import { ShariaManagementTab } from '@/modules/admin/components/ShariaManagementTab';
// Task 28-B (Fix 2) — Fix Battalion: Source Authority tab (Rule 66).
import { SourceAuthorityTab } from '@/modules/admin/components/SourceAuthorityTab';
// Task 28-B (Fix 3) — Fix Battalion: Validation Monitor tab (Rule 65).
import { ValidationMonitorTab } from '@/modules/admin/components/ValidationMonitorTab';
// FRONTEND-1: Data Health dashboard — surfaces backend freshness to admin UI.
import { DataHealthTab } from '@/modules/admin/components/DataHealthTab';
import { InvestorsDataEntryTab } from '@/modules/admin/components/InvestorsDataEntryTab';
// Task 28-B (Fix 4) — Fix Battalion: Cron Health dashboard.
import { CronHealthTab } from '@/modules/admin/components/CronHealthTab';
// Task 28-B (Fix 5) — Fix Battalion: Pricing + paywall gates status.
import { PricingEditorTab } from '@/modules/admin/components/PricingEditorTab';
// Task 28-B (Fix 6) — Fix Battalion: News source health dashboard.
import { NewsHealthTab } from '@/modules/admin/components/NewsHealthTab';
// Task 28-B (Fix 7) — Fix Battalion: Telegram published predictions audit.
import { TelegramPredictionsTab } from '@/modules/admin/components/TelegramPredictionsTab';
// Task 28-B (Fix 9) — Fix Battalion: wire /api/admin/system-health into dashboard.
// (SystemHealthCard rendered inside DashboardTab — imported there.)
// Task 31-B (Engine Monitor Battalion) — unified engine control room.
import { EngineControlRoomTab } from '@/modules/admin/components/EngineControlRoomTab';

// ============================================================================
// Phase 3 — Next.js Bundle Diet (Lazy Loading Heavy Components)
// ============================================================================
// The following admin sub-components are 1000-3000+ lines each. Loading them
// all eagerly into AdminView's chunk would make the Admin tab's first paint
// very slow (multi-MB JS chunk). Using `next/dynamic` with `ssr: false` +
// `loading: <LazyTabLoader>` means each component only loads when the user
// actually navigates to that tab — the rest stay as separate chunks that
// are never fetched if the user doesn't open them.
//
// Backward compatible: the JSX usage `<SuperLearningSystem />` etc. is
// unchanged — only the import is replaced with a dynamic() call.
//
// Phase 4 Task 3 (Resilience & Observability):
// Each heavy sub-component is wrapped with `withErrorBoundary` so that a
// runtime error in one tab (e.g., SuperLearningSystem's 3000-line render)
// shows a friendly "حدث خطأ" message + Retry button instead of crashing
// the whole AdminView. The other admin tabs keep working.
// ============================================================================

const SuperLearningSystem = withErrorBoundary(
 dynamic(
 () => import('@/modules/admin/components/SuperLearningSystem').then(m => ({ default: m.SuperLearningSystem })),
 { ssr: false, loading: () => <LazyTabLoader label="نظام التعلّم الموحّد" /> }
 ),
 'نظام التعلّم الموحّد',
);

const DataScraperControl = withErrorBoundary(
 dynamic(
 () => import('@/modules/admin/components/DataScraperControl').then(m => ({ default: m.DataScraperControl })),
 { ssr: false, loading: () => <LazyTabLoader label="التحكم في سحب البيانات" /> }
 ),
 'التحكم في سحب البيانات',
);

const DatabaseManagerFull = withErrorBoundary(
 dynamic(
 () => import('@/modules/admin/components/DatabaseManagerFull').then(m => ({ default: m.DatabaseManagerFull })),
 { ssr: false, loading: () => <LazyTabLoader label="مدير قاعدة البيانات الكامل" /> }
 ),
 'مدير قاعدة البيانات الكامل',
);

const SystemControlPanel = withErrorBoundary(
 dynamic(
 () => import('@/modules/admin/components/SystemControlPanel').then(m => ({ default: m.SystemControlPanel })),
 { ssr: false, loading: () => <LazyTabLoader label="لوحة تحكم النظام" /> }
 ),
 'لوحة تحكم النظام',
);

const NewsManagementTab = withErrorBoundary(
 dynamic(
 () => import('@/modules/admin/components/NewsManagementTab').then(m => ({ default: m.NewsManagementTab })),
 { ssr: false, loading: () => <LazyTabLoader label="إدارة الأخبار" /> }
 ),
 'إدارة الأخبار',
);

// MarketingStudio — الاستوديو الموحّد (3 أدوات في مكان واحد).
// Hosts VideoEditor + ContentStudioHub + MarketingHub (lazy-loaded internally).
const MarketingStudio = withErrorBoundary(
 dynamic(
 () => import('@/modules/admin/components/MarketingStudio').then(m => ({ default: m.MarketingStudio })),
 { ssr: false, loading: () => <LazyTabLoader label="استوديو التسويق" /> },
 ),
 'استوديو التسويق',
);

// HistoricalPredictionsV2 — REMOVED (2026-08-13) — consolidated into Maestro

import { useAdminState } from './useAdminState';
import { buildAdminHubs } from './admin-hubs';
import { AdminHeader } from './AdminHeader';
import { QuickAccessBar } from './QuickAccessBar';
import { AdminNav } from './AdminNav';
import { AdminLoginCard } from './AdminLoginCard';
import { DashboardTab } from './DashboardTab';
import { UsersTab } from './UsersTab';
import { UserFeedbackTab } from './UserFeedbackTab';

export function AdminView() {
 const s = useAdminState();
 const hubs = buildAdminHubs(s.feedbackCount);

 if (!s.isMounted) {
 return (
 <div className="min-h-screen flex items-center justify-center" dir="rtl">
 <div className="flex items-center gap-3">
 <Loader2 className="w-6 h-6 animate-spin text-profit" />
 <span className="text-muted-foreground">جاري التحميل...</span>
 </div>
 </div>
 );
 }

 if (!s.canAccessAdmin) {
 return (
 <AdminLoginCard
 directLoginUsername={s.directLoginUsername}
 setDirectLoginUsername={s.setDirectLoginUsername}
 directLoginPassword={s.directLoginPassword}
 setDirectLoginPassword={s.setDirectLoginPassword}
 directLoginError={s.directLoginError}
 directLoginLoading={s.directLoginLoading}
 onLogin={s.handleDirectLogin}
 />
 );
 }

 const handleTabSelect = (tab: typeof s.activeTab, hub: Parameters<typeof s.setExpandedHub>[0] extends infer P ? P : never) => {
 s.setActiveTab(tab);
 s.setExpandedHub(hub);
 };

 return (
 <div className="min-h-screen p-4 md:p-6" dir="rtl">
 <AdminHeader
 healthScore={s.healthScore}
 criticalCount={s.criticalCount}
 warningCount={s.warningCount}
 statsLoading={s.statsLoading}
 onRefresh={s.refreshAll}
 />

 <QuickAccessBar activeTab={s.activeTab} onSelect={handleTabSelect} />

 <AdminNav
 hubs={hubs}
 expandedHub={s.expandedHub}
 setExpandedHub={s.setExpandedHub}
 activeTab={s.activeTab}
 onTabSelect={handleTabSelect}
 />

 {/* ==================== DASHBOARD TAB (merged: dashboard + problems) ==================== */}
 {s.activeTab === 'dashboard' && (
 <div className="space-y-4">
 <DashboardTab
 healthScore={s.healthScore}
 stats={s.stats}
 predictionStats={s.predictionStats}
 dataStatus={s.dataStatus}
 dataStatusLoading={s.dataStatusLoading}
 services={s.services}
 syncing={s.syncing}
 multiMarketSyncing={s.multiMarketSyncing}
 onSync={s.handleSync}
 onMultiMarketSync={s.handleMultiMarketSync}
 fetchDataStatus={s.fetchDataStatus}
 onNavigate={(tab) => handleTabSelect(tab, 'health')}
 lastUpdate={s.lastUpdate}
 dataAgeMinutes={s.dataAgeMinutes}
 />
 {/* ADMIN-CONSOLIDATION: merged problems into dashboard */}
 <SystemProblemsTab
 issues={s.systemIssues}
 criticalCount={s.criticalCount}
 warningCount={s.warningCount}
 onRefresh={s.refreshAll}
 refreshing={s.statsLoading || s.dataStatusLoading || s.connectionsLoading}
 />
 </div>
 )}

 {/* ==================== SYSTEM MONITOR TAB (merged: system-monitor + cron-health) ==================== */}
 {s.activeTab === 'system-monitor' && (
 <div className="space-y-4">
 <SystemMonitorPanel />
 {/* ADMIN-CONSOLIDATION: merged cron-health into system-monitor */}
 <CronHealthTab />
 </div>
 )}

 {/* ==================== SYSTEM TOPOLOGY TAB (ALPHA-SYSTEM-TOPOLOGY) ==================== */}
 {s.activeTab === 'system-topology' && (
 <SystemTopologyView />
 )}

 {/* ==================== ENGINE CONTROL TAB (merged: engine-control-room + general + data-engine) ==================== */}
 {s.activeTab === 'engine-control' && (
 <div className="space-y-4">
 <EngineControlRoomTab />
 {/* ADMIN-CONSOLIDATION: merged general (EnginesStatusTab) + data-engine (DataEngineTab) */}
 <EnginesStatusTab />
 <DataEngineTab />
 </div>
 )}

 {/* ==================== ENGINE SETTINGS TAB ==================== */}
 {s.activeTab === 'engine-settings' && (
 <EngineSettingsTab />
 )}

 {/* ==================== LEARNING TAB (Unified) ==================== */}
 {s.activeTab === 'learning' && (
 <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
 <div className="lg:col-span-2">
 <SuperLearningSystem />
 </div>
 <div>
 <RegimeDetectionWidget />
 </div>
 </div>
 )}

 {/* ==================== PERFORMANCE TAB (merged: backtest + platform-performance) ==================== */}
 {s.activeTab === 'performance' && (
 <div className="space-y-4">
 <BacktestTab />
 {/* ADMIN-CONSOLIDATION: merged platform-performance */}
 <PlatformPerformanceView />
 </div>
 )}

 {/* ==================== USERS TAB (merged: user-management + users analytics) ==================== */}
 {s.activeTab === 'users' && (
 <div className="space-y-4">
 {/* ADMIN-CONSOLIDATION: merged user-management (CRUD) + users (analytics) */}
 <UsersManagement />
 <UsersTab
 analyticsData={s.analyticsData}
 analyticsLoading={s.analyticsLoading}
 />
 </div>
 )}

 {/* ==================== SUBSCRIPTIONS TAB (merged: pricing + promo-codes) ==================== */}
 {s.activeTab === 'subscriptions' && (
 <div className="space-y-4">
 {/* ADMIN-CONSOLIDATION: merged pricing + promo-codes */}
 <PricingEditorTab />
 <PromoCodesAdmin />
 </div>
 )}

 {/* ==================== TELEGRAM TAB (merged: telegram + telegram-predictions) ==================== */}
 {s.activeTab === 'telegram' && (
 <div className="space-y-4">
 <div className="bg-background rounded-lg">
 <TelegramTab />
 </div>
 {/* ADMIN-CONSOLIDATION: merged telegram-predictions */}
 <TelegramPredictionsTab />
 </div>
 )}

 {/* ==================== REPORTS TAB ==================== */}
 {s.activeTab === 'reports' && (
 <div className="bg-background rounded-lg">
 <iframe
 src="/admin/reports"
 className="w-full"
 style={{ minHeight: '80vh', border: 'none' }}
 title="التقارير الذكية"
 />
 </div>
 )}

 {/* ==================== NEWS TAB (merged: news-control + news-health) ==================== */}
 {s.activeTab === 'news' && (
 <div className="space-y-4">
 {/* ADMIN-CONSOLIDATION: merged news-control + news-health */}
 <NewsManagementTab />
 <NewsHealthTab />
 </div>
 )}

 {/* ==================== QUALITY TAB (merged: source-authority + sharia) ==================== */}
 {s.activeTab === 'quality' && (
 <div className="space-y-4">
 {/* ADMIN-CONSOLIDATION: merged source-authority + sharia */}
 <SourceAuthorityTab />
 <ShariaManagementTab />
 </div>
 )}

 {/* ==================== DATA HEALTH TAB (merged: data-health + validation-monitor) ==================== */}
 {s.activeTab === 'data-health' && (
 <div className="space-y-4">
 {/* ADMIN-CONSOLIDATION: merged data-health + validation-monitor */}
 <DataHealthTab />
 <ValidationMonitorTab />
 </div>
 )}

 {/* ==================== INVESTORS DATA ENTRY TAB ==================== */}
 {s.activeTab === 'investors-entry' && (
 <InvestorsDataEntryTab />
 )}

 {/* ==================== DATABASES TAB (merged: databases + db-backup) ==================== */}
 {s.activeTab === 'databases' && (
 <div className="space-y-4">
 {/* ADMIN-CONSOLIDATION: merged databases + db-backup */}
 <DatabaseManagerFull />
 <DbBackupPanel />
 </div>
 )}

 {/* ==================== SYSTEM CONTROL TAB ==================== */}
 {s.activeTab === 'system-control' && (
 <div className="space-y-6">
 <DataScraperControl />
 <SystemControlPanel />
 </div>
 )}

 {/* ==================== MARKETING STUDIO TAB ==================== */}
 {s.activeTab === 'marketing-studio' && <MarketingStudio />}

 {/* ==================== USER FEEDBACK TAB ==================== */}
 {s.activeTab === 'feedback' && (
 <UserFeedbackTab
 feedback={s.feedback}
 loading={s.feedbackLoading}
 onRefresh={s.fetchFeedback}
 onStatusChange={s.setFeedbackStatus}
 />
 )}
 </div>
 );
}
