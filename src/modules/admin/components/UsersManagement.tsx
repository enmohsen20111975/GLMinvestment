// UsersManagement types (Phase 3)

/**
 * UsersManagement.tsx (shim)
 * ===========================
 * Re-export shim. The actual implementation now lives in the
 * `users-mgmt/` folder as part of Task F-Phase3-FinalPush
 * (split from 1,543 LOC).
 *
 * Sub-modules:
 *   - users-mgmt/UsersManagement.tsx       (container, ~290 LOC)
 *   - users-mgmt/types.ts                   (UserDetails + UsersResponse + NewUserForm + AvailablePromoCode)
 *   - users-mgmt/helpers.tsx                (adminFetch + formatDate/DateTime + getInitials + badge renderers + copyToClipboard)
 *   - users-mgmt/UsersFilters.tsx           (search + role/status/promo filter bar)
 *   - users-mgmt/UsersListCard.tsx          (users list + dropdown actions menu)
 *   - users-mgmt/UserDetailsDialog.tsx      (details + promo + activity + usage + preferences)
 *   - users-mgmt/AddUserDialog.tsx          (add user form dialog)
 *   - users-mgmt/DeleteUserDialog.tsx       (delete confirmation dialog)
 *   - users-mgmt/CleanupDialog.tsx          (cleanup-expired-users dialog)
 *   - users-mgmt/AssignPromoDialog.tsx      (assign / update promo modal)
 *
 * Backward compatible: existing import sites keep working unchanged.
 *   - src/modules/admin/index.ts barrel (re-exports UsersManagement).
 *   - src/modules/admin/components/admin-view/UsersTab.tsx (dynamic import with error boundary).
 */
export { UsersManagement, default } from './users-mgmt/UsersManagement';
