# 📐 خطة توحيد المكونات وإزالة التكرار — Component Unification Plan

> **المالك**: Z.ai Code (الفاحص التقني)
> **التاريخ**: 2026-10-20
> **الحالة**: خطة كاملة مبنية على أوديت فعلي لـ 4 فاحصين — بانتظار موافقة المالك
> **آخر commit مرجعي**: `0ac5b31 BRAVO-NEWS-CONSOLIDATE`
> **حجم المشروع**: 3213 ملف، 924 ملف TypeScript، 924 file scope للأوديت

---

## 📋 القسم 0: الملخص التنفيذي

الأوديت كشف إن المشروع فيه تكرار هائل. الأرقام صادمة لكنها حقيقية (موثقة بالـ line numbers في worklog.md):

| المقياس | العدد | المصدر |
|---------|------|--------|
| Inline `<table>` يدوية | **44+** | AUDIT-1 (7) + AUDIT-2 (7) + AUDIT-3 (28+) |
| Inline ternary chains للـ colors | **27+** | كل الفاحصين |
| Inline empty states | **36+** | AUDIT-1 (21) + AUDIT-2 (15) + AUDIT-3 (13+) |
| Inline Skeleton blocks | **328+** | AUDIT-1 (19) + AUDIT-2 (12) + AUDIT-3 (309) |
| Inline pagination | **7+** | AUDIT-1 (1) + AUDIT-2 (2) + AUDIT-3 (5+) |
| Manual `useEffect+fetch+setState` | **268+** | AUDIT-2 (14) + AUDIT-3 (254) |
| Direct `fetch('/api/...')` bypassing api-client | **420** | AUDIT-4 |
| Hardcoded raw colors (`text-emerald-*` etc) | **1,347** | AUDIT-4 |
| Inline `.toFixed()` calls | **286** | AUDIT-2 |
| Re-declared helpers (formatPrice in N files) | **19+ files** | AUDIT-1 + AUDIT-3 |
| Re-declared signal→color maps | **10+ copies** | كل الفاحصين |
| TanStack Query usages | **0** (مثبت بس مش متـوصل!) | AUDIT-3 + AUDIT-4 |
| UnifiedTable adoptions | **3 من 47+ candidates** | AUDIT-2 |
| UnifiedEmptyState adoptions | **1 من 36+ candidates** | AUDIT-3 |
| `lib/format.ts` imports | **0 من 22+ candidates** | AUDIT-1 |
| `lib/api-client.ts` imports | **2 من 98+ files** | AUDIT-3 |

**التشخيص**: المشروع فيه **أساسيات معمارية موجودة بس مش متـستخدمة**. العمل اللازم = activation + migration مش بناء من الصفر.

---

## 🩺 القسم 1: الأوديت على نفسي (10 شهادات)

| # | التكرار | الأثر الفعلي |
|---|---------|-------------|
| 1 | **44+ tables يدوية** بدل `UnifiedTable` | 7 in market-analysis + 22 in admin + باقي modules — كل واحد بـ HTML يدوي |
| 2 | **0 TanStack Query usages** رغم إنه مثبت v5.82.0 | 268 manual `useEffect+fetch` patterns — كل واحد بـ loading/error/data triples |
| 3 | **1,347 hardcoded color classes** | `PALETTE_MIGRATION` map موجود بس مش متـطبق |
| 4 | **36+ inline empty states** بدل `UnifiedEmptyState` (موجود بس 1 file بـ يستخدمه) | كل Tab بـ empty state بنسيج مختلف |
| 5 | **328+ inline Skeleton blocks** | كل Tab بـ skeleton يدوي |
| 6 | **10+ re-declared signal maps** (STRONG_BUY→bg-profit…) | لو اتغير لون، تعدّل 10+ أماكن |
| 7 | **3 re-implementations of `getStatusBadge()`** | في PredictionsTab + PersonaTab + ExpertRecommendationsPanel |
| 8 | **22 `text-X/40 ` bugs** (مسافة قبل /) | نفس الباج اللي اتصلح في `helpers.ts` رجع في 5 ملفات تانية |
| 9 | **5 Zustand stores بـ overlaps** | `notifications` في useAppStore + useNotificationStore غير متـزامنين |
| 10 | **`useAppStore` = 1,573 LOC mega-store** | ~50 field covering nav+auth+data+CRUD+UI+personalization |

**التشخيص الإضافي**:
- `lib/format.ts` و `lib/utils.ts` الاتنين عندهم formatters بس **DISAGREE** (قيم مختلفة لنفس الـ function).
- `MARKET_NAMES_AR` متـعرف 2 مرات بـ **conflicting TADAWUL translations** (`السوق السعودي` vs `تداول السعودية`).
- 8 separate fetch-wrapper modules بـ 4 conflicting Quote types (`EgxpyQuote`, `StockQuote`, `VpsStockQuote`, `UnifiedStockData`).
- `PredictionCard` متـعرف محلياً في `eid-predictions-widget.tsx:108-153` بدل ما يـimport من `shared/PredictionCard.tsx`.
- `MARKET_FLAGS` defined twice with identical content (MarketStatusImageCard + PredictionsImageCard).

---

## 🏗️ القسم 2: المعمارية — 4-Tier Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│ Tier 4: PAGES (src/app/*)                              │
│  بـ تركّب المكونات بس.                                   │
└─────────────────────────────────────────────────────────┘
                          ▲
┌─────────────────────────────────────────────────────────┐
│ Tier 3: FEATURE COMPONENTS (src/modules/{feature}/*)    │
│  بـ تركّب shared + تعرض business logic.                  │
└─────────────────────────────────────────────────────────┘
                          ▲
┌─────────────────────────────────────────────────────────┐
│ Tier 2: SHARED BUSINESS (src/components/shared/*)      │
│  UnifiedTable, SignalBadge, EmptyState, AsyncBoundary…  │
│  (بعضها موجود — لازم نـفعّله + نوسّعه)                   │
└─────────────────────────────────────────────────────────┘
                          ▲
┌─────────────────────────────────────────────────────────┐
│ Tier 1: UI PRIMITIVES (src/components/ui/*)           │
│  shadcn/ui primitives (50+ موجودين)                     │
└─────────────────────────────────────────────────────────┘
```

### المبادئ الذهبية (10 قواعد)

| # | القاعدة |
|---|---------|
| R1 | **Single Source of Truth** — كل مفهوم ليه مكان واحد |
| R2 | **Composition over Inheritance** — props مش subclass |
| R3 | **Props not forks** — `variant="compact"` مش نسخة جديدة |
| R4 | **Extract at 3** — لو اتكرر في 3+ أماكن → لازم يتـستخرج |
| R5 | **No inline business logic in JSX** — الـ ternary chains لازم تـتـextract |
| R6 | **Feature components don't write HTML primitives** — مفيش `<table>` يدوي |
| R7 | **One fetch pattern** — TanStack Query بس (مثبت أصلاً) |
| R8 | **Design tokens فقط** — `text-profit` مش `text-emerald-500` |
| R9 | **Accessibility built-in** — shadcn primitives فيها ARIA |
| R10 | **Naming over comments** — `PendingConfirmationsCard` أحسن من `Card2` |

---

## 📁 القسم 3: هيكل المجلدات (مبني على الموجود)

```
src/
├── app/                              # Tier 4 — Pages (موجود)
│   ├── layout.tsx
│   ├── page.tsx                      # renderView switch (~60 cases) — تبسيط مطلوب
│   ├── globals.css                   # design tokens موجودين + لازم migration
│   └── api/                           # 454 routes — فيها تكرارات (news 5x, predictions 11x)
│
├── components/
│   ├── ui/                           # Tier 1 — shadcn primitives (50+ موجودين)
│   │
│   ├── shared/                       # Tier 2 — Shared business (موجود جزئياً)
│   │   ├── ui/                       # موجود: UnifiedTable, UnifiedEmptyState
│   │   │   ├── UnifiedTable.tsx      # موجود بس 3 files بـ تستخدمه
│   │   │   ├── UnifiedEmptyState.tsx # موجود بس 1 file بـ يستخدمه
│   │   │   ├── SignalBadge.tsx       # جديد — مطلوب
│   │   │   ├── LifecycleBadge.tsx    # جديد
│   │   │   ├── StatusBadge.tsx       # جديد
│   │   │   ├── UnifiedPagination.tsx # جديد
│   │   │   ├── SkeletonRow.tsx        # جديد
│   │   │   ├── AsyncBoundary.tsx     # جديد
│   │   │   ├── ChangePill.tsx        # جديد
│   │   │   └── PriceText.tsx         # جديد
│   │   ├── PredictionCard.tsx        # موجود — لازم eid-widget يـستخدمه
│   │   ├── LiquidityRadarView.tsx    # موجود
│   │   └── ...
│   │
│   └── [feature folders]             # market/, alerts/, journal/, etc.
│
├── modules/                          # Tier 3 — Feature (موجود)
│   ├── market-analysis/
│   │   ├── components/               # 25 ملف، 19K LOC — أكتر تكرار
│   │   │   ├── PersonaTab.tsx        # ~2300 LOC — فيه PersonaCard inline
│   │   │   ├── PredictionsTab.tsx    # ~850 LOC — فيه PreviousPredictionsArchive
│   │   │   ├── helpers.ts            # ~1180 LOC — فيه formatters متكررة
│   │   │   └── ...
│   │   ├── hooks/                    # جديد مطلوب — TanStack Query wrappers
│   │   │   ├── usePersonaData.ts
│   │   │   ├── usePredictions.ts
│   │   │   ├── useLiquidityRadar.ts
│   │   │   └── useStocksList.ts
│   │   └── lib/                      # جديد مطلوب
│   │       ├── lifecycle.ts          # getLifecycle هنا بس
│   │       ├── signals.ts            # signalColorMap هنا بس
│   │       └── sector-map.ts         # SECTOR_ARABIC_MAP هنا بس
│   │
│   ├── admin/                        # 22 inline tables هنا
│   ├── stock-analysis/
│   ├── portfolio/
│   └── ...
│
├── hooks/                            # Shared hooks
│   ├── use-mobile.ts                 # موجود
│   ├── use-toast.ts                  # موجود
│   ├── use-async-resource.ts         # جديد مطلوب
│   ├── use-pagination.ts             # جديد مطلوب
│   └── use-debounce.ts               # جديد مطلوب
│
└── lib/
    ├── utils.ts                      # موجود — cn() + format helpers
    ├── format.ts                     # موجود — canonical formatters بس 0 imports!
    ├── api-client.ts                 # موجود — canonical fetcher بس 2 imports!
    ├── design-tokens.ts              # موجود — PALETTE_MIGRATION map موجود بس مش متـطبق
    ├── db.ts                         # موجود
    ├── store.ts                      # موجود — useAppStore = 1,573 LOC mega-store
    ├── signal-utils.ts               # موجود جزئياً
    ├── market-constants.ts           # جديد مطلوب — يـدمج 7 MARKET_MAP duplicates
    ├── sector-constants.ts           # جديد مطلوب — يـدمج SECTOR_COLOR maps
    ├── persona-config.ts             # جديد مطلوب
    └── server-data/                  # جديد مطلوب — يـدمج 8 fetch-wrapper modules
        ├── index.ts
        └── types.ts                  # UnifiedStockData type واحد
```

---

## 🧩 القسم 4: المكونات المطلوبة (11 جديد + 4 تفعيل)

### 4.1 مكونات جديدة لازم نبنيها

| # | المكون | المكان | يحل التكرار | تقدير LOC متوفّر |
|---|--------|--------|-------------|-----------------|
| 1 | **`SignalBadge`** | `shared/ui/` | 10+ re-declared signal maps | ~250 LOC |
| 2 | **`LifecycleBadge`** | `shared/ui/` | getLifecycle + badge في 2+ أماكن | ~50 LOC |
| 3 | **`StatusBadge`** | `shared/ui/` | 3 re-implementations of `getStatusBadge()` + 22 `text-X/40 ` bugs | ~80 LOC |
| 4 | **`UnifiedPagination`** | `shared/ui/` | 7+ inline paginations | ~100 LOC |
| 5 | **`SkeletonRow`** + **`TabSkeleton`** | `shared/ui/` | 328+ inline Skeleton blocks | ~400 LOC |
| 6 | **`AsyncBoundary`** | `shared/ui/` | 268 manual `useEffect+fetch` triples | ~600 LOC |
| 7 | **`ChangePill`** | `shared/ui/` | colored +/- change في كل مكان | ~80 LOC |
| 8 | **`PriceText`** | `shared/ui/` | 286 inline `.toFixed()` | ~150 LOC |
| 9 | **`SeverityBadge`** | `shared/ui/` | 5+ AlertCard severity maps | ~80 LOC |
| 10 | **`ConfidenceMeter`** | `shared/ui/` | 3+ confidence bar implementations | ~60 LOC |
| 11 | **`PersonaEmptyState`** | `shared/ui/` | 15+ inline persona empty states | ~150 LOC |

**إجمالي LOC متوفّر من المكونات الجديدة**: ~2000 LOC

### 4.2 مكونات موجودة لازم نـفعّلها (adoption migration)

| المكون | الموجود | المطلوب | الطريقة |
|--------|---------|---------|--------|
| `UnifiedTable` | 3 adoptions | **44+ adoptions** | Codemod: استبدال كل inline `<table>` |
| `UnifiedEmptyState` | 1 adoption | **36+ adoptions** | Codemod: استبدال كل inline empty state |
| `PredictionCard` (shared) | موجود بس eid-widget نسخته | **1 adoption** (eid-widget import) | Edit eid-predictions-widget.tsx:108-153 |
| `lib/format.ts` | 0 imports | **22+ imports** | Codemod: استبدال كل `toFixed/formatPrice` |
| `lib/api-client.ts` | 2 imports | **98+ imports** | Codemod: استبدال كل `fetch('/api/...')` |
| `PALETTE_MIGRATION` | موجود بس مش متـطبق | **1,347 applications** | Codemod: raw colors → tokens |
| `TanStack Query` v5.82.0 | 0 usages | **268 adoptions** | Wire QueryClientProvider + migrate |
| `UnifiedTable` columns helper | موجود | **44+ adoptions** | Define column configs per table |

### 4.3 lib/shared files جديدة

| # | الملف | يحل |
|---|------|-----|
| 1 | **`lib/market-constants.ts`** | 7 MARKET_MAP duplicates + MARKET_NAMES_AR conflicting translations |
| 2 | **`lib/sector-constants.ts`** | 2 SECTOR_COLOR maps بـ conventions مختلفة |
| 3 | **`lib/persona-config.ts`** | Persona config scattered |
| 4 | **`lib/server-data/index.ts`** | 8 fetch-wrapper modules بـ 4 conflicting Quote types |
| 5 | **`modules/market-analysis/lib/lifecycle.ts`** | 2 getLifecycle implementations |
| 6 | **`modules/market-analysis/lib/signals.ts`** | 4 sigColor maps + 10+ signal color/label maps |
| 7 | **`modules/market-analysis/lib/sector-map.ts`** | SECTOR_ARABIC_MAP في 2+ مكان |

### 4.4 Hooks جديدة

| # | الـ Hook | يحل |
|---|---------|-----|
| 1 | **`useApiQuery<T>`** | 268 manual `useEffect+fetch` patterns (wrapper around TanStack Query + api-client) |
| 2 | **`usePagination`** | 7+ inline paginations |
| 3 | **`useDebounce`** | search inputs |
| 4 | **`useVisibilityAwarePolling`** | موجود بس 0 adoptions — لازم نـفعّله |

### 4.5 تقسيم `useAppStore` (1,573 LOC) إلى 5 stores مـركّزة

| الـ Store الجديد | المسؤولية | الحقول المنقولة |
|------------------|----------|----------------|
| `useNavStore` | navigation state | currentView, market, etc. |
| `useAuthStore` | auth state | user, session, trialStatus |
| `useMarketDataStore` | market data | stocks, predictions, etc. (يزول التـ duplication مع useAnalysisStore) |
| `useUIStore` | UI state | modals, drawers, theme |
| `useNotificationStore` (موجود) | notifications | الـ notifications (بس لازم useAppStore يـوقف يـملكهم) |

---

## 🚫 القسم 5: قائمة التكرارات الممنوعة (Anti-Patterns)

### 5.1 ممنوع: Inline ternary chains للـ colors

```tsx
// ❌ ممنوع (وفيه bug /40)
const statusColor = p.status === 'TARGET_HIT'
  ? 'bg-success text-success /40 border-success'  // space قبل /!
  : 'bg-loss text-loss /40 border-loss'
  : 'bg-warning text-warning /40 border-warning';

// ✅ الصح
<StatusBadge status={p.status} />
```

**الانتشار**: 27+ حالة في 5+ ملفات. الـ bug `/40` موجود في 22 مكان (AUDIT-2).

### 5.2 ممنوع: Inline `<table>` في feature components

```tsx
// ❌ ممنوع
<table className="w-full text-sm"><thead>...</thead><tbody>{rows.map(...)}</tbody></table>

// ✅ الصح
<UnifiedTable columns={columns} data={rows} />
```

**الانتشار**: 44+ حالة (7 market-analysis + 22 admin + باقي).

### 5.3 ممنوع: `useEffect + fetch + setState` يدوي

```tsx
// ❌ ممنوع
useEffect(() => {
  fetch('/api/foo').then(r => r.json()).then(setData);
}, []);

// ✅ الصح
const { data, isLoading, error } = useApiQuery('/api/foo');
```

**الانتشار**: 268 حالة في 98 file.

### 5.4 ممنوع: Hardcoded colors

```tsx
// ❌ ممنوع
<span className="text-emerald-500">+5%</span>
<div className="bg-red-100">...</div>

// ✅ الصح
<span className="text-profit">+5%</span>
<div className="bg-loss/10">...</div>
```

**الانتشار**: 1,347 حالة في ~120 file. `PALETTE_MIGRATION` codemap موجود في `lib/design-tokens.ts:124-157`.

### 5.5 ممنوع: Inline empty states / skeletons / pagination

```tsx
// ❌ ممنوع
{items.length === 0 && <div className="text-center py-8">مفيش بيانات</div>}
{loading && <Skeleton className="h-4 w-full" />}

// ✅ الصح
<UnifiedEmptyState icon={TrendingUp} title="مفيش بيانات" />
<SkeletonRow rows={5} variant="table" />
```

**الانتشار**: 36 empty states + 328 skeletons + 7 paginations.

### 5.6 ممنوع: Re-defined helpers

```tsx
// ❌ ممنوع — fmtPrice في 19+ files
function fmtPrice(v: number) { return v.toFixed(2); }

// ✅ الصح
import { formatPrice } from '@/lib/format';
```

**الانتشار**: `formatPrice`/`fmtPrice` في 19+ files، `formatNumber` في 14، `formatPercent` في 15. `lib/format.ts` موجود بس 0 imports!

### 5.7 ممنوع: Re-defined constants/maps

```tsx
// ❌ ممنوع — MARKET_FLAGS مرتين
const MARKET_FLAGS: Record<MarketType, string> = { ... };  // في MarketStatusImageCard
const MARKET_FLAGS: Record<MarketType, string> = { ... };  // في PredictionsImageCard

// ✅ الصح
import { MARKET_FLAGS } from '@/lib/market-constants';
```

**الانتشار**: 7 MARKET_MAP duplicates (5 identical) + MARKET_NAMES_AR conflicting + SIGNAL_COLORS in 3 copies + SECTOR_COLOR in 2 copies.

### 5.8 ممنوع: Mega-store

```tsx
// ❌ ممنوع
export const useAppStore = create((set, get) => ({
  // ~50 fields covering EVERYTHING
  currentView: ...,
  user: ...,
  stocks: ...,
  predictions: ...,
  modalOpen: ...,
  theme: ...,
  // ... 1,573 LOC
}));

// ✅ الصح — تقسيم
export const useNavStore = create(...);    // navigation only
export const useAuthStore = create(...);   // auth only
export const useMarketDataStore = create(...);  // data only
```

### 5.9 ممنوع: Bypassing api-client

```tsx
// ❌ ممنوع
const res = await fetch('/api/stocks', { cache: 'no-store' });
const data = await res.json();

// ✅ الصح
const data = await apiGet<Stock[]>('/api/stocks');
```

**الانتشار**: 420 direct fetch calls vs 19 api-client imports.

### 5.10 ممنوع: Duplicate fetch wrappers

```tsx
// ❌ ممنوع — 8 separate fetch-wrapper modules
src/lib/api-client.ts          // canonical but ignored
src/lib/python-backend.ts      // duplicate
src/lib/vps-adapter.ts         // duplicate
src/lib/egxpy-bridge.ts        // duplicate
src/lib/multi-source-adapter.ts // duplicate
src/lib/data-adapter.ts        // duplicate
src/lib/market-data-access.ts  // duplicate
src/lib/reports/proxy-client.ts // duplicate

// ✅ الصح — adapter pattern
src/lib/server-data/index.ts   // واحد بـ adapter
```

---

## 🔄 القسم 6: Workflow إضافة مكون جديد (Checklist)

```
□ 1. هل في component في src/components/shared بيعمل ده؟
     → لو أيوه: استخدمه. ما تكتبش جديد.

□ 2. هل في pattern بـ يتكرر في 3+ أماكن؟
     → لو أيوه: استخرجه لـ shared component.

□ 3. هل ده feature-specific ولا shared business؟
     → feature-specific: في src/modules/{feature}/components/
     → shared business: في src/components/shared/

□ 4. هل أنا بـ أستخدم shadcn primitive (Tier 1) كـ base؟
     → لازم. ما بـ نـكتبش UI من الصفر.

□ 5. هل الألوان بـ تـجي من design tokens؟
     → لازم. مفيش hardcoded colors.

□ 6. هل أنا بـ import الـ helpers من lib/؟
     → لازم. مفيش re-definition.

□ 7. هل الـ component بـ يدعم RTL + Arabic؟
     → لازم (dir="rtl" + أسماء عربي).

□ 8. هل async بـ يـتم عبر useApiQuery (TanStack Query)؟
     → لازم. مفيش manual fetch.

□ 9. هل أنا بـ أستخدم UnifiedTable لو فيه جدول؟
     → لازم. مفيش inline `<table>`.

□ 10. هل في props كافية للـ customization بـ ما يضطر حد يـنسخ المكون؟
      → لو لأ، أضف prop `variant` / `size` / `tone`.
```

---

## 📋 القسم 7: Code Review Checklist

```
□ 1. مفيش `<table>` يدوي في feature component — لازم UnifiedTable.
□ 2. مفيش `useEffect + fetch` — لازم useApiQuery.
□ 3. مفيش inline ternary chain للـ colors — لازم *Badge component.
□ 4. مفيش hardcoded colors — لازم design tokens (PALETTE_MIGRATION).
□ 5. مفيش re-defined helpers — لازم import من lib/format.
□ 6. مفيش empty state / loading skeleton / pagination يدوي — لازم shared.
□ 7. مفيش component جديد بـ يـ duplicate موجود — لازم props/variant.
□ 8. مفيش direct `fetch('/api/...')` — لازم apiGet/apiPost من lib/api-client.
□ 9. الـ component في الـ tier الصح.
□ 10. الـ file في الـ folder الصح.
□ 11. ESLint Exit 0.
□ 12. `tsc --noEmit` ما أضافش errors جديدة.
□ 13. Grep للـ anti-patterns لازم 0 matches.
```

---

## 🚀 القسم 8: خطة التنفيذ المرحلية (5 Phases)

### Phase 0: التأسيس (قبل أي migration)
**الهدف**: بناء الأساسيات + تفعيل الـ infrastructure الموجودة.

- [ ] **0.1** أبني `lib/market-constants.ts` (يدمج 7 MARKET_MAP).
- [ ] **0.2** أبني `lib/sector-constants.ts` (يدمج 2 SECTOR_COLOR).
- [ ] **0.3** أبني `lib/persona-config.ts`.
- [ ] **0.4** أبني `modules/market-analysis/lib/lifecycle.ts` (يدمج 2 getLifecycle).
- [ ] **0.5** أبني `modules/market-analysis/lib/signals.ts` (يدمج 4 sigColor maps).
- [ ] **0.6** أبني `modules/market-analysis/lib/sector-map.ts` (يدمج SECTOR_ARABIC_MAP).
- [ ] **0.7** أبني `lib/server-data/index.ts` + `types.ts` (يدمج 8 fetch-wrappers + UnifiedStockData type).
- [ ] **0.8** أوصل `QueryClientProvider` في `components/Providers.tsx`.
- [ ] **0.9** أبني `useApiQuery<T>` hook (wrapper around TanStack Query + api-client).
- [ ] **0.10** أبني `usePagination` + `useDebounce` hooks.

### Phase 1: المكونات المشتركة
**الهدف**: بناء الـ 11 shared component جديد + تفعيل الـ 4 موجودين.

- [ ] **1.1** `SignalBadge` (يـستخدم lib/signals.ts).
- [ ] **1.2** `LifecycleBadge` (يـستخدم lib/lifecycle.ts).
- [ ] **1.3** `StatusBadge` (يـحل 22 bug `/40` + 3 re-implementations).
- [ ] **1.4** `UnifiedPagination` (يحل 7+ inline paginations).
- [ ] **1.5** `SkeletonRow` + `TabSkeleton` (يحل 328+ inline skeletons).
- [ ] **1.6** `AsyncBoundary` (loading+error+empty في واحد).
- [ ] **1.7** `ChangePill` + `PriceText` (يحل 286 toFixed + 19 fmtPrice duplicates).
- [ ] **1.8** `SeverityBadge` (يحل 5+ AlertCard severity maps).
- [ ] **1.9** `ConfidenceMeter` + `PersonaEmptyState`.
- [ ] **1.10** Update eid-predictions-widget.tsx:108-153 لـ import shared PredictionCard.

### Phase 2: Codemod Migrations (أكبر أثر)
**الهدف**: تطبيق الـ shared components على الـ codebase الموجود.

- [ ] **2.1** Codemod: 44+ inline `<table>` → `UnifiedTable`.
- [ ] **2.2** Codemod: 36+ inline empty states → `UnifiedEmptyState`.
- [ ] **2.3** Codemod: 328+ inline skeletons → `SkeletonRow`/`TabSkeleton`.
- [ ] **2.4** Codemod: 7+ inline paginations → `UnifiedPagination`.
- [ ] **2.5** Codemod: 268 manual `useEffect+fetch` → `useApiQuery`.
- [ ] **2.6** Codemod: 1,347 raw palette classes → design tokens (PALETTE_MIGRATION).
- [ ] **2.7** Codemod: 19+ fmtPrice copies → `import { formatPrice } from '@/lib/format'`.
- [ ] **2.8** Codemod: 420 direct `fetch('/api/...')` → `apiGet`/`apiPost`.

### Phase 3: Page.tsx + API Route Cleanup
**الهدف**: تبسيط الـ page router + حذف الـ duplicate API subsystems.

- [ ] **3.1** بسّط `page.tsx` renderView switch (~60 cases) — وحد الـ 8 crypto-* cases.
- [ ] **3.2** احذف dead `tracking/*` API routes (مـعلّمة 410 Gone).
- [ ] **3.3** دمج 5 news endpoints في `?shape=full|slim|mobile`.
- [ ] **3.4** دمج 11 predictions tracking endpoints (فيه 2 parallel systems).
- [ ] **3.5** دمج 5 expert recommendations endpoints.
- [ ] **3.6** دمج 17 crypto endpoints (3 namespaces).
- [ ] **3.7** دمج 16 portfolio endpoints (2 of them duplicate Python gateway).

### Phase 4: State Store Refactor
**الهدف**: تقسيم `useAppStore` (1,573 LOC) إلى 5 focused stores.

- [ ] **4.1** أبني `useNavStore` (navigation state بس).
- [ ] **4.2** أبني `useAuthStore` (auth state بس).
- [ ] **4.3** أبني `useMarketDataStore` (market data بس — يحل الـ overlap مع useAnalysisStore).
- [ ] **4.4** أبني `useUIStore` (UI state بس — modals, drawers, theme).
- [ ] **4.5** حل الـ notifications duplication بين useAppStore و useNotificationStore.
- [ ] **4.6** Codemod: migrate كل الـ consumers من useAppStore لـ الـ stores الجديدة.

### Phase 5: التدقيق النهائي
**الهدف**: التحقق إن الـ anti-patterns كلها اتمسحت.

- [ ] **5.1** `bun run lint` — Exit 0.
- [ ] **5.2** `bunx tsc --noEmit` — 0 new errors.
- [ ] **5.3** Grep للـ anti-patterns — لازم 0 matches:
  - `rg "text-success /|text-profit /|text-loss /|text-warning /" src/` → 0
  - `rg "<table" src/modules/ src/components/` → 0 (كله UnifiedTable)
  - `rg "useEffect.*fetch\(" src/` → 0 (كله useApiQuery)
  - `rg "text-emerald|text-green-|text-red-|text-blue-|text-indigo|text-slate-" src/` → 0
  - `rg "function fmtPrice|function formatPrice" src/` → 1 (lib/format.ts بس)
  - `rg "MARKET_FLAGS.*Record" src/` → 1 (lib/market-constants.ts بس)
  - `rg "fetch\('/api/" src/` → 0 (كله apiGet)
- [ ] **5.4** تقرير LOC savings (هدف: ~3000-5000 LOC removable).

---

## ✅ القسم 9: Definition of Done

الخطة دي تعتبر **متـنفذة** لما:

1. ✅ كل feature component بـ يستخدم Tier 2 shared components بس.
2. ✅ كل async بـ يـتم عبر TanStack Query + useApiQuery.
3. ✅ كل colors بـ تـجي من design tokens (0 raw palette).
4. ✅ كل helpers لهم مكان واحد في `lib/`.
5. ✅ كل constants/maps لهم مكان واحد في `lib/`.
6. ✅ كل fetch بـ يـمر عبر `lib/api-client.ts` (0 direct `fetch('/api/...')`).
7. ✅ `useAppStore` مـقسّم إلى 5 focused stores.
8. ✅ Grep للـ anti-patterns بـ يرجع 0 matches.
9. ✅ `bun run lint` Exit 0.
10. ✅ `tsc --noEmit` 0 new errors.
11. ✅ إضافة feature جديد بـ ياخد وقت أقل بـ 50%.

---

## 🎯 القسم 10: الخلاصة + تقديرات الجهد

### 10.1 تقديرات LOC Savings

| Phase | LOC متوفّر | الأولوية |
|-------|-----------|---------|
| Phase 0 (تأسيس) | ~200 (بناء shared lib files) | عالية |
| Phase 1 (shared components) | ~2,000 (11 new + 4 activation) | عالية |
| Phase 2 (codemods) | ~5,000+ (44 tables + 268 fetches + 1347 colors + 328 skeletons) | عالية جداً |
| Phase 3 (page.tsx + API cleanup) | ~1,500 (page simplification + dead routes) | متوسطة |
| Phase 4 (state refactor) | ~1,000 (useAppStore split) | متوسطة |
| **الإجمالي** | **~9,700 LOC** متوفّر | — |

### 10.2 الترتيب المقترح (Top 5 highest-impact wins)

| # | الـ win | الأثر | الجهد |
|---|---------|------|------|
| 1 | Wire TanStack Query + migrate 268 manual fetches | ~3000 LOC + cache + invalidation + devtools | متوسط (codemod) |
| 2 | Codemod 1,347 raw colors → tokens (PALETTE_MIGRATION موجود) | ~1500 LOC + consistency + dark mode fix | بسيط (codemod) |
| 3 | Codemod 44 inline tables → UnifiedTable | ~600 LOC + consistency | متوسط |
| 4 | Activate lib/format.ts + delete 19+ duplicates | ~120 LOC + single source | بسيط |
| 5 | Activate lib/api-client.ts + delete 420 direct fetches | ~400 LOC + retry/timeout/paywall logic | متوسط (codemod) |

### 10.3 ماذا يحصل لو لم ننفّذ الخطة؟

| الـ سيناريو | النتيجة |
|------------|--------|
| أضفنا feature جديد | هيتكرر فيه نفس الـ anti-patterns → ديون تقنية زيادة |
| حاولنا نـصلح bug في statusColor | لازم نـعدّل 10+ أماكن (وفيها bug `/40`) |
| أردنا dark mode صح | 1,347 hardcoded colors لازم تتـعدّل يدوي |
| أضفنا API route جديد | هيـنعمل fetch wrapper جديد (هـزيد الـ 8 لـ 9) |
| Onboarded developer جديد | محتاج يـعرف 8 fetch wrappers + 5 stores + 19 fmtPrice copies |

---

## 📌 القسم 11: ملاحظات للمالك

### 10 أماكن موجودة أصلاً لازم نـفعّلها (مش نبنيها من الصفر)

| الـ asset | المكان | ليه مش متـستخدم |
|-----------|--------|----------------|
| `UnifiedTable` | `shared/ui/UnifiedTable.tsx` | 3 adoptions فقط من 47+ candidates |
| `UnifiedEmptyState` | `shared/ui/UnifiedEmptyState.tsx` | 1 adoption فقط من 36+ candidates |
| `PredictionCard` (shared) | `shared/PredictionCard.tsx` | eid-widget نسخه بدل ما import |
| `lib/format.ts` | `src/lib/format.ts` | 0 imports من 22+ candidates |
| `lib/api-client.ts` | `src/lib/api-client.ts` | 2 imports من 98+ files |
| `lib/design-tokens.ts` | `src/lib/design-tokens.ts` | PALETTE_MIGRATION map موجود بس مش متـطبق |
| `TanStack Query` v5.82.0 | `package.json` | 0 usages — مثبت بس 0 QueryClientProvider |
| `useVisibilityAwarePolling` | `src/hooks/` | 0 adoptions |
| `lib/signal-utils.ts` | `src/lib/signal-utils.ts` | موجود جزئياً |
| Previous MERGE-PREDICTION-CARDS work | git history | PersonaImageCard/ExpertPredictionsImageCard/TopTradesImageCard بالفعل thin wrappers |

**الخلاصة**: 60% من الشغل = activation + migration مش بناء جديد. الخطة دي بـ تستثمر في اللي اتبنى قبل كده.

---

## 🎯 الخلاصة النهائية

| النقطة | الوضع |
|---------|------|
| **الأوديت على نفسي** | اتعمل — شفت 10 أنواع تكرار + الأرقام الفعلية (44+ tables، 268 manual fetches، 1,347 hardcoded colors). |
| **الـ codebase الحالي** | مشروع GLMinvestment الحقيقي رجع بالكامل. 3213 ملف. |
| **الخطة** | 5 phases، 11 shared components جديدة، 4 تفعيل، 7 lib/shared files جديدة، 4 hooks، تقسيم useAppStore لـ 5 stores. تقدير LOC savings ~9,700. |
| **الموجود أصلاً (60%)** | UnifiedTable، UnifiedEmptyState، PredictionCard، lib/format.ts، lib/api-client.ts، PALETTE_MIGRATION، TanStack Query v5.82.0 — كلهم موجودين بس مش متـفعّلين. |
| **اللي هيحصل لو نفّذناها** | maintenance أقل بـ كبيرة، features أسرع، bugs أقل، dark mode صح، onboarding أسهل. |
| **المطلوب منك** | موافقة على الخطة + ترتيب التنفيذ. |

---

> ⚠️ **ملاحظة تقنية**: الخطة دي مبنية على أوديت فعلي لـ 4 فاحصين بالتوازي. تفاصيلهم (line numbers, file paths) متـوثّقة في `/home/z/my-project/worklog.md` (1008 سطر).
> 
> **بانتظار موافقتك — نبدأ Phase 0 (التأسيس) فوراً ولا فيه تعديلات على الخطة؟**
