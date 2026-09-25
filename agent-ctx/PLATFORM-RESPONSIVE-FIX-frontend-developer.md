---
Task ID: PLATFORM-RESPONSIVE-FIX
Agent: Frontend Developer (Subagent)
Date: 2026-09-24
---

# Work Record: إصلاح 4 شاشات مش responsive

## Context
العميل قال إن 99.9% من المستخدمين بيستعملو الموبايل، ولازم المنصة تكون responsive 100%.
اتحددت 4 شاشات مش responsive في تقرير الفحص وتم إصلاحهم.

## Files Modified (4 screens)

### 1. src/components/screener/StockScreenerAdvanced.tsx
**المشكلة:** جدول 11 عمود بـ `overflow-auto` عمودي بس، الأفقي ناقص، والـ headers بتتقطع.
**الإصلاح:**
- wrapper: `max-h-[600px] overflow-auto` → `max-h-[600px] overflow-y-auto overflow-x-auto -mx-3 px-3 md:mx-0 md:px-0` (full-bleed على الموبايل)
- `<Table>`: أضفت `min-w-[1100px]` عشان يفرض horizontal scroll على الموبايل
- SortableTh component: أضفت `whitespace-nowrap text-[10px] sm:text-xs px-1 sm:px-3 py-1 sm:py-2`
- static TableHeads (القطاع، الحجم): نفس الـ responsive classes
- arbitrary variants على Table: `[&_td]:whitespace-nowrap [&_td]:text-[10px] sm:[&_td]:text-xs [&_td]:px-1 [&_td]:py-1 sm:[&_td]:px-3 sm:[&_td]:py-2`
- نفس الإصلاحات على جدول Top Movers (7 أعمدة) بـ `min-w-[760px]`
- Commit: f5394e9

### 2. src/components/portfolio/PositionDeepDiveDrawer.tsx
**المشكلة:** chart loading placeholder بـ `h-72` ثابت، مش responsive.
**الإصلاح:**
- loading placeholder: `h-72` → `h-[40vh] sm:h-72`
- Drawer header: `p-5` → `p-3 sm:p-5` + `gap-2`
- Drawer body: `p-5 space-y-6` → `p-3 sm:p-5 space-y-4 sm:space-y-6`
- الـ Drawer panel أصلاً full-screen على الموبايل (`w-screen max-w-full md:max-w-xl lg:max-w-2xl`) — اتأكدت إنه صحيح
- Commit: 1ba8860

### 3. src/components/admin/WealthCharts.tsx + src/components/portfolio/WealthCharts.tsx
**المشكلة:** `grid-cols-1 lg:grid-cols-3` بدون `sm:` step (في portfolio) + `grid-cols-2 md:grid-cols-4` (في admin) — على الموبايل الـ KPI cards ضيقة.
**الإصلاح:**
- admin/WealthCharts.tsx line 231: `grid-cols-2 md:grid-cols-4` → `grid-cols-1 sm:grid-cols-2 md:grid-cols-4`
- portfolio/WealthCharts.tsx line 115 (loading): `grid-cols-1 lg:grid-cols-3` → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
- portfolio/WealthCharts.tsx line 131 (charts row): نفس التغيير
- col-span-2: `lg:col-span-2` → `sm:col-span-2 lg:col-span-2` عشان الـ layout يفضل صح على sm
- loading placeholders: `h-72` → `h-[40vh] sm:h-72`
- Commit: 87b51fb

### 4. src/components/admin/AdminView.tsx
**المشكلة:** `grid-cols-2 md:grid-cols-6` للـ KPI/Quick Actions cards — على الموبايل 2 cols ضيقين.
**الإصلاح:**
- KPI grid (line 1281): `grid-cols-2 md:grid-cols-6` → `grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6`
- Quick Stats grid (line 1185): `grid-cols-2 md:grid-cols-4` → `grid-cols-1 sm:grid-cols-2 md:grid-cols-4`
- Data Status grid (line 1240): نفس التغيير
- Engines status grid (line 1391): نفس التغيير
- Feedback types grid (line 1947): نفس التغيير
- كل KPI numbers (14 instance): `text-2xl font-bold` → `text-lg md:text-xl lg:text-2xl font-bold`
- Commit: 52feb66

## Notes
- `xs:` breakpoint مش مدعوم في tailwind.config.ts (Tailwind v3)، فاستخدمت `sm:` (640px) كـ step أول بدل `xs:`. التقدم بيكون: mobile (1 col) → sm (2-3) → md (3-4) → lg (6).
- ما غيرتش أي logic — بس styling (className).
- lint نقي بعد كل ملف (`bun run lint` بدون errors).
- مفيش حاجة في tailwind config اتغيرت (قررت أتجنب تعديل الـ config عشان الـ CRLF line endings، واستخدمت standard breakpoints).

## Git Commits (4 commits على origin/main)
1. f5394e9 — fix(responsive): StockScreenerAdvanced
2. 1ba8860 — fix(responsive): PositionDeepDiveDrawer
3. 87b51fb — fix(responsive): WealthCharts (admin + portfolio)
4. 52feb66 — fix(responsive): AdminView

كلهم متعملهم push على: https://github.com/enmohsen20111975/GLMinvestment.git
