/**
 * AdminView.tsx (shim)
 * ====================
 * Re-export shim. The actual implementation now lives in the `admin-view/`
 * folder as part of Task F-Phase3-Split-Admin+Predictions (split from
 * 2,105 LOC).
 *
 * Sub-modules:
 *   - admin-view/AdminView.tsx        (container, < 500 LOC)
 *   - admin-view/useAdminState.ts     (state hook: all fetches + derived)
 *   - admin-view/admin-fetch.ts       (adminFetch + tryAutoCookie helpers)
 *   - admin-view/admin-hubs.tsx       (buildAdminHubs: 6 hubs nav config)
 *   - admin-view/AdminHeader.tsx      (top header)
 *   - admin-view/QuickAccessBar.tsx   (quick-access shortcut bar)
 *   - admin-view/AdminNav.tsx         (mobile + desktop hub nav)
 *   - admin-view/AdminLoginCard.tsx   (login form for non-admins)
 *   - admin-view/DashboardTab.tsx     (the `dashboard` tab content)
 *   - admin-view/UsersTab.tsx         (the `users` tab content)
 *   - admin-view/UserFeedbackTab.tsx  (the `feedback` tab sub-component)
 *   - admin-view/types.ts             (interfaces + AdminTab + HubId unions)
 *
 * Backward compatible: existing import sites keep working unchanged.
 *   - src/modules/admin/index.ts barrel (re-exports AdminView + SystemIssue type).
 *   - src/modules/admin/components/SystemProblemsTab.tsx (imports SystemIssue type).
 *   - src/app/page.tsx (dynamic import with `ssr: false`).
 */
export { AdminView } from './admin-view/AdminView';
export type { SystemIssue } from './admin-view/types';
