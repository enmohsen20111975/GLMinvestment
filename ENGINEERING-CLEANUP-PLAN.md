# ENGINEERING CLEANUP PLAN — Alpha Architecture Remediation

> **Task:** FRONTEND-CLEANUP-A-2 (Architecture remediation)
> **Principle:** هندسة محترمة، مش رص طوب. كل مكون بـ يـ built مرة في مكتبة موحدة.

## الـ Problem (العك المكتشف)

### 1. Direct palette usage (174+ file)
- `text-emerald-600` / `text-red-500` / `text-amber-500` بدل semantic tokens (`text-profit` / `text-loss` / `text-warning`).
- السبب: tokens كانت مش wired لحد BLUEPRINT Phase 1. دلوقتي wired بس الـ migration مش معمول.
- Top offenders: admin (35), market-analysis (21), dashboard (21), stock-analysis (15).

### 2. lib/ overflow (94 files flat)
- 94 ملف في `src/lib/` بدون subfolders. مفيش تنظيم: admin-auth + ad-card-generator + api-client + canonical-signal كله في نفس المستوى.
- محتاج subfolders: `lib/admin/`, `lib/data/`, `lib/format/`, `lib/auth/`.

### 3. Duplicate component locations
- `components/auth/` + `modules/auth/components/` — نفس الميزة في مكانين.
- `components/subscription/` + `modules/subscription/components/` — نفس المشكلة.
- `components/watchlist/` + لا module مقابل — بس فيه 2 views متشابهين.

## الـ Plan (4 phases — كل phase وراها testing)

### Phase A: Tokenize direct palette → semantic tokens (highest visual impact)
- Codemod: `text-emerald-{500,600,700}` → `text-profit` في كل `src/components/` + `src/modules/`.
- `text-red-{500,600}` / `text-rose-{500,600}` → `text-loss`.
- `text-amber-{500,600}` → `text-warning`.
- `text-teal-{500,600}` → `text-whale`.
- `bg-emerald-*` → `bg-profit`, `bg-red-*` → `bg-loss`, etc.
- Test: lint 0 + browser renders + tokens verified in computed style.

### Phase B: Consolidate lib/ into subfolders (structural)
- `lib/admin/` — admin-auth, admin-db-manager, admin-guard, admin-identities.
- `lib/data/` — data-engine-db, egx-db, new-db, shared-db, sqlite-admin.
- `lib/format/` — format helpers.
- الباقي يفضل في `lib/` root.
- Test: lint 0 + tsc + browser.

### Phase C: Remove dead/orphaned code
- audit: components غير مستوردة في أي مكان.
- audit: scripts/ migration files مش مستخدمة.
- Test: lint 0 + browser.

### Phase D: Final verification
- lint 0 + tsc + browser full verify + git push.

## الـ Rule (إلزامي)
- مفيش مكون جديد outside `shared/ui/`.
- كل مكون بـ يستخدم design tokens (ممنوع direct palette).
- imports منظمة (barrel exports من `shared/ui/index.ts`).
