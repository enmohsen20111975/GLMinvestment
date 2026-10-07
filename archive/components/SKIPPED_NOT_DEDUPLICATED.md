# Admin components NOT deduplicated — Phase 5 §5.3

> Per **Rule 16 (VERIFY-BEFORE-DELETE)** and the explicit task instruction
> *"Keep the one that's actually imported"*, the following component
> pairs flagged by the audit could NOT be deduplicated because BOTH
> members are actively imported and serve distinct purposes in the UI.

## 1. `admin/UsersManagement.tsx` (1086 LOC) + `admin/UserManagementPanel.tsx` (599 LOC)

### Audit claim:
"same purpose" (ENGINEERING_AUDIT_REPORT.md:344)

### Actual grep results:
Both are imported by `src/components/admin/AdminView.tsx`:

```
src/components/admin/AdminView.tsx:81:
  import { UserManagementPanel } from './UserManagementPanel';
src/components/admin/AdminView.tsx:173-178:
  const UsersManagement = withErrorBoundary(
    dynamic(() => import('./UsersManagement').then(m => ({ default: m.UsersManagement })), ...),
    'إدارة المستخدمين',
  );
```

### How they are used (AdminView.tsx):
- **Tab `users`** (line 1679): renders `<UsersManagement />` —
  legacy, analytics-heavy view (per inline comment at line 378 + 1684).
- **Tab `user-management`** (line 1687): renders `<UserManagementPanel />` —
  NEW bulk-operations panel (per inline comment at line 1684-1685:
  *"Distinct from legacy 'users' tab (which is analytics-focused)."*).

### Verdict:
SKIP. The audit's "same purpose" claim is contradicted by the inline
comment in AdminView.tsx and by the actual rendered UI (two tabs).
A proper consolidation would require merging the analytics views of
`UsersManagement` into `UserManagementPanel` (or vice-versa) as a
refactor, not a simple rename. Out of scope for Phase 5 archive sprint.

---

## 2. `watchlist/ProfessionalWatchlistView.tsx` (472 LOC)

### Audit claim:
"orphan (only self-imports)" (per Phase 5 task description)

### Actual grep results:
Imported by `src/components/memory/TradingMemoryView.tsx:23`:

```
import { ProfessionalWatchlistView } from '@/components/watchlist/ProfessionalWatchlistView';
```

Rendered at line 125:

```
{/* قائمة المراقبة الاحترافية */}
<ProfessionalWatchlistView />
```

`TradingMemoryView` is itself actively imported by
`src/app/page.tsx:128-129` (dynamic import) and rendered at line 501
inside `case 'trading-memory':`.

### Verdict:
SKIP. NOT an orphan — actively rendered through the chain
`page.tsx → TradingMemoryView → ProfessionalWatchlistView`.
The audit's "only self-imports" claim is incorrect.
The earlier worklog line 8572 already noted this:
*"حذف WatchlistView (EnhancedWatchlistView + ProfessionalWatchlistView
مختلفان ومستخدمان)"* — both are different and both are used.

---

## Summary

| Pair / Component | Audit said | Actual grep | Decision |
|---|---|---|---|
| `admin/WealthCharts.tsx` (465) + `portfolio/WealthCharts.tsx` (346) | duplicate chart code | admin: 1 importer (page.tsx); portfolio: 0 | ✅ portfolio → `.DEPRECATED.tsx` (commit 875e0bb) |
| `admin/UsersManagement.tsx` (1086) + `admin/UserManagementPanel.tsx` (599) | same purpose | BOTH imported by AdminView (different tabs) | ⏭️ SKIP — distinct tabs (analytics vs bulk ops) |
| `watchlist/ProfessionalWatchlistView.tsx` (472) | orphan (only self-imports) | actively imported by TradingMemoryView → page.tsx | ⏭️ SKIP — not an orphan |

**Net result:** 1 of 3 dedupes performed (346 LOC removed from active
import path); 2 of 3 skipped with documented grep evidence.
