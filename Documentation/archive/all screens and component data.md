# 📚 الوثائق الشاملة — GLMinvestment

# كل الشاشات والعناصر والمكونات و API Connections

> **المالك**: Z.ai Code (الفاحص التقني)
> **التاريخ**: 2026-10-21 (Updated)
> **المرجع**: آخر commit `7a4269a` (HEAD — merged all 4 indices sources)
> **التحديث**: بعد التظبيط الكامل (Phase 0-4 + Design System + Whale Radar + Screener Unification + Price Guards)
> **حجم المشروع**: 965 ملف TypeScript، 460 API route، 38 shared components، 29 module، 63 screen cases

---

## 📋 الفهرس

1. [Executive Summary — الأرقام المحدّثة](#1-executive-summary)
2. [Project Overview — الـ Stack + الهيكل](#2-project-overview)
3. [Architecture — 4-Tier Hierarchy](#3-architecture--4-tier-hierarchy)
4. [Screens Inventory — التحديثات الجديدة](#4-screens-inventory)
5. [Shared Components — 38 مكون (26 في ui/ + 12 في shared/)](#5-shared-components)
6. [New Systems — Whale Radar + Price Guards + Design System](#6-new-systems)
7. [API Routes — 460 route + 28 proxy + 5 Python master endpoints](#7-api-routes)
8. [Navigation — 6 بوابات + Legacy Redirects](#8-navigation)
9. [Canonical Indices — EGX30/70/100](#9-canonical-indices)
10. [Critical Findings + Recommendations — المحدّث](#10-critical-findings)

---

## 1. Executive Summary — الأرقام المحدّثة

| المقياس | قبل (dae1968) | بعد (7a4269a) | التغيير |
|---------|---------------|---------------|---------|
| ملفات TypeScript | 924 | **965** | +41 |
| API routes | 454 | **460** | +6 |
| Screen cases في renderView | 49 | **63** | +14 (fallthroughs) |
| Unique screen components | 43 | **35** | -8 (دمج + unified) |
| Shared UI components (ui/) | 20 | **26** | +6 (TrendIndicator + StockCard + MarketTable + FinancialBadge + WickLiquidityBar + StockRescueModal) |
| Shared components (shared/) | 13 | **12** | -1 (دمج) |
| shadcn/ui primitives | 50 | **50** | 0 |
| Feature modules | 18 | **29** | +11 |
| Navigation sections | 6 (قديمة) | **6** (جديدة) | إعادة هيكلة كاملة |
| Design token constants | 24 (CHART_GRID فقط) | **24 + 5 tones + FinancialTone + resolveFinancialTone** | نظام موحد |
| Button variants | 6 (shadcn default) | **10** (+success/danger/warning/whale) | +4 مالية |
| Raw palette instances | 1,325 | **0** | ✅ صفر |
| Files changed since doc | — | **247** | كل التغييرات |

### 🎯 الأنظمة الجديدة المضافة

| النظام | الوصف | الـ commit |
|--------|------|-----------|
| **Whale Radar Hunter Mode** | daily_predictor بـ يـinject أسهم الحيتان لما السوق دفاعي | `469fb7c` |
| **Incubator & Stalking Engine** | بيكشف أسهم 4/6 أو 5/6 شروط + trigger موصوف بالمليمتر | `fbd5a4e` |
| **Price Invariant Guard** | client-side safety: stop ≥ price → "ملغية" | `be2cae2` |
| **Design System** | FinancialBadge + resolveFinancialTone + 0 raw colors | `b5f36f3` |
| **Unified Theme** | 4 button variants (success/danger/warning/whale) + Typography + Shape + Shadow | `b5f36f3` |
| **Golden Retest Stages** | 🛡️ نهاية تصحيح / ⚡ بداية انطلاق / 💎 تجميع قيعان / ⏳ جاري التصحيح | `3438561` |
| **SovereignMetalsDesk** | مكتب ذهب + عملات مستقل (بدون كريبتو/أسهم) | `50fa8c1` |
| **InteractiveChart Modules** | 2,187 سطر → 5 modules (types/utils/indicators/sub-components/main) | `0f9e35c` |
| **Screener Unification** | #stocks = StockScreenerAdvancedView (مش جدول ميت) | `cc55370` |
| **Canonical Indices** | EGX30 (30) + EGX70 (70) + EGX100 (80) = 180 سهم | `7a4269a` |

---

## 2. Project Overview — الـ Stack

- **Framework**: Next.js 14.2.28 (App Router, Turbopack)
- **Language**: TypeScript 5 (strict)
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York)
- **Database**: SQLite (predictions.db + stocks.db + intraday.db + data_engine.db + auth.db)
- **ORM**: Prisma 5.22 (3 schemas)
- **Auth**: NextAuth.js v4
- **State**: Zustand (5 stores — useAppStore mega + 4 focused)
- **Server State**: TanStack Query v5.82.0 (wired via QueryClientProvider)
- **Backend**: Python Flask port 8010 (vps-service) + port 8012 (stock-screener)
- **Design Tokens**: CSS variables in globals.css + design-tokens.ts (resolveFinancialTone)

---

## 3. Architecture — 4-Tier Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│ Tier 4: PAGES (src/app/*)                               │
│  63 case branches → 35 unique components                │
│  + 6 Legacy redirects (market-depth→liquidity-radar, …)│
└─────────────────────────────────────────────────────────┘
                          ▲
┌─────────────────────────────────────────────────────────┐
│ Tier 3: FEATURE MODULES (src/modules/*)                │
│  29 modules — market-analysis (أكبر) + admin + crypto   │
│  + radar/ (جديد: IncubatorSection)                       │
│  + dashboard/ (جديد: SovereignMetalsDesk)               │
│  + interactive-chart/ (جديد: 5 modules منفصلة)         │
└─────────────────────────────────────────────────────────┘
                          ▲
┌─────────────────────────────────────────────────────────┐
│ Tier 2: SHARED BUSINESS (src/components/shared/*)       │
│  38 components (26 في ui/ + 12 في shared/)             │
│  + FinancialBadge (المركزي) + TrendIndicator + StockCard│
│  + MarketTable + WickLiquidityBar + StockRescueModal   │
│  + isWarningOrVeto + isBuyOpportunity (sanitization)   │
└─────────────────────────────────────────────────────────┘
                          ▲
┌─────────────────────────────────────────────────────────┐
│ Tier 1: UI PRIMITIVES (src/components/ui/*)            │
│  50 shadcn + Button بـ 10 variants (4 مالية جديدة)      │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Screens Inventory — التحديثات الجديدة

### الشاشات المدموجة (Unified)
| قبل | بعد | السبب |
|------|------|--------|
| `stocks` + `stock-filters` | **`stocks`** → `<StockScreenerAdvancedView />` | دمج الفاحص العملاق |
| `market-depth` | redirect → `liquidity-radar` | شاشة وهمية بدون Level 2 |
| `smart-confluence` | redirect → `recommendations` | مدمج في التوصيات |
| `v82` | redirect → `recommendations` | محرك القرار مدمج |
| `zakat` + `tithes` | **`sharia`** (الحسابات الشرعية والزكاة) | دمج |
| `eid-predictions` (BTC+ETH) | **محذوف** من Dashboard | ممنوع خلط كريبتو بـ EGX |
| 7 crypto-* cases | 7 fallthrough cases | shell handles CRYPTO market |

### الشاشات الجديدة
| الشاشة | المكون | المصدر |
|--------|--------|--------|
| `#stocks` | `<StockScreenerAdvancedView />` | دمج (جدول ميت → فاحص عملاق) |
| Dashboard | `<SovereignMetalsDesk />` | جديد (ذهب + عملات مستقل) |
| Dashboard | `<IntradayPressurePanel />` (rewrite) | rewrite (EGX30 كلي مش COMI) |
| `#recommendations` | مباشر (بدون Tabs خارجية) | إزالة Tabs العقيمة |
| `#liquidity-radar` | بـ /api/market/liquidity-radar | endpoint جديد + 4 RVOL statuses |

### شاشة التوصيات (#recommendations) — تطهير كامل
- **قبل**: `<Tabs>` بـ TabsTrigger واحد يتيم + تبويب تقارير مدفون
- **بعد**: مباشر `<UnifiedPredictionsTab />` — صيد القيعان + الصفقات الحية
- **Price Invariant Guard**: stop ≥ price → "🚫 ملغية - كسر الوقف" (مش "شراء قوي")
- **Stage Filter**: [📋 الكل | 🛡️ نهاية تصحيح | ⚡ بداية انطلاق | 💎 تجميع قيعان | ⏳ جاري التصحيح]

---

## 5. Shared Components — 38 مكون

### Part A: `shared/ui/` (26 components)

| Component | الحالة | الوصف |
|-----------|--------|------|
| **FinancialBadge** | ✅ NEW | المكون المركزي الموحد (resolveFinancialTone) |
| **TrendIndicator** | ✅ NEW | ▲▼▬ arrow + color (dumb component) |
| **StockCard** | ✅ NEW | compact + detailed variants + track badges + trade params + user_advice_ar |
| **MarketTable** | ✅ NEW | generic sortable table (columns + data + onRowClick) |
| **WickLiquidityBar** | ✅ NEW | lower wick + upper wick + dryness + Hard Gate 0 |
| **StockRescueModal** | ✅ NEW | user input + API verdict (exit_now / average_down / hold) |
| SignalBadge | ✅ Refactored | uses lib/signals.ts (canonical) |
| StatusBadge | ✅ Active | uses design-tokens.ts |
| LifecycleBadge | ✅ Active | proven/testing/closed |
| UnifiedPagination | ✅ Active | +disabled prop |
| Skeleton (4 variants) | ✅ Active | Row + Tab + Table + Card |
| AsyncBoundary | ✅ Active | loading+error+empty+success |
| ChangePill | ✅ Active | +/- value with arrow |
| PriceText | ✅ Active | uses lib/format.ts |
| SeverityBadge | ✅ Active | critical/high/medium/low/info |
| ConfidenceMeter | ✅ Active | 0-100 bar |
| PersonaEmptyState | ✅ Active | persona-themed |
| UnifiedEmptyState | ✅ Active | variant=loading/empty/error |
| + 9 more | ✅ Active | shadcn-based |

### Part B: `shared/` (12 components)

| Component | الوصف |
|-----------|------|
| **UnifiedTable** | 2,933 lines — Excel-like grid (calc + AutoFilter + drag-resize) |
| **PredictionCard** | canonical single-stock prediction card |
| **LiquidityRadarView** | بـ /api/market/liquidity-radar + 4 RVOL statuses |
| **IncubatorSection** | Glassmorphism + readiness meter + trigger box + bell button |
| **ExpertIntelligencePanel** | 4 fetch calls (predictions/sectors/consensus) |
| StockFeelCard | STOCK-FEEL API display |
| MarketSelector | market dropdown |
| StockSearchSelector | stock search input |
| FlashingPriceCell | live price with flash |
| FlashingChangeCell | live change with flash |
| ErrorBoundary | React error boundary |
| LazyTabLoader | lazy tab loading |

---

## 6. New Systems — الأنظمة الجديدة

### 6.1 Whale Radar Hunter Mode
- **Backend**: `daily_predictor.py` → `inject_whale_radar_picks()` (reads maker_radar JSON)
- **Trigger**: regime DEFENSIVE OR total_generated == 0
- **Output**: predictions بـ signal='WHALE_RADAR_BUY', persona='gambler', position_size=2%
- **Cap**: top 5 فقط (مرتبة بـ signal_count + net_flow_egp)
- **API**: /api/unified/predictions بـ track='WHALE_RADAR'

### 6.2 Incubator & Stalking Engine
- **Backend**: `scripts/maker_radar.py` → `extract_missing_trigger()` + `build_incubator_candidates()`
- **4 trigger types**: VOLUME_SURGE / RESISTANCE_BREAK / SUPPORT_CONFIRM / OTHER
- **readiness_pct**: `(passed/total) * 100` — رياضي، مفيش hardcoded
- **API**: `/api/radar/incubator?market=EGX`
- **Frontend**: `<IncubatorSection />` (Glassmorphism + pulsing badge + bell button)

### 6.3 Price Invariant Guard (Client-side)
- **4 checks** (كلها client-side، من API values):
  1. STOPPED_OUT: `pd.stop >= curPrice` → "🚫 ملغية - كسر الوقف"
  2. TARGET_HIT: `curPrice >= pd.target` → "✅ تحقق الهدف"
  3. STALE: `|curPrice - pd.entry| / pd.entry > 8%` → "⚠️ بيانات قديمة"
  4. R/R INVALID: stop ≥ current → R/R = "—"

### 6.4 Design System (Single Source of Truth)
- **globals.css**: 5 CSS variable tones (profit/loss/warning/whale/neutral)
- **design-tokens.ts**: SIGNAL_BADGE_STYLES + STATUS_BADGE_STYLES + resolveFinancialTone()
- **FinancialBadge**: المكون المركزي (auto-resolve tone from status)
- **Button**: 10 variants (default + success + danger + warning + whale + 4 shadcn)
- **0 raw colors**: 0 instance من emerald/rose/amber/cyan
- **0 dark: overrides**: CSS vars بـ تتغير اتوماتيك

### 6.5 InteractiveChart Modules (2,187 → 5 files)
```
interactive-chart/
├── types.ts              (181 lines — interfaces + 24 theme constants)
├── utils.ts              (141 lines — toTime/sanitizeCandles/fmtDateLabel)
├── indicators.ts         (99 lines — calcEMA/calcMACD/calcOBV/calcFibLevels)
├── sub-components.tsx    (123 lines — PlanLevel/ReasonCard/DetailItem/...)
└── InteractiveChart.tsx  (1,691 lines — main chart rendering)
```

---

## 7. API Routes — 460 route + 28 proxy

### Proxy Routes (Next.js → Python 8010)
| Route | Python Target | Status |
|-------|---------------|--------|
| `/api/market/intraday-pressure` | `/api/market/intraday-pressure` | ✅ 200 |
| `/api/market/liquidity-radar` | `/api/market/liquidity-radar` | ✅ 200 |
| `/api/market/metals-forex/summary` | `/api/market/metals-forex/summary` | ✅ 200 |
| `/api/market/investor-flows` | `/api/market/investor-flows` | ✅ 200 |
| `/api/radar/incubator` | reads `scripts/output/maker_radar_*.json` | ✅ 200 |
| `/api/unified/predictions` | Python + SQLite fallback | ✅ 200 |
| + 22 more in `/api/market/` | various | ✅ |

### Python Master Endpoints (port 8010)
| Endpoint | Purpose |
|----------|---------|
| `/api/market/intraday-pressure` | EGX30 cumulative pressure + top 10 stocks |
| `/api/market/investor-flows?market=EGX` | investors_data table (real EGX disclosure) |
| `/api/market/metals-forex/summary` | gold (24/21/18/coin) + FX (USD/EUR/SAR) |
| `/api/market/liquidity-radar` | RVOL + turnover + classification |
| `/api/market/indices/constituents?index=EGX30` | canonical indices constituents |

---

## 8. Navigation — 6 بوابات + Legacy Redirects

### TopBar Sections
| # | البوابة | الأيقونات |
|---|---------|----------|
| 1 | 📊 نبض السوق | dashboard + liquidity-radar + market-status + **reports** |
| 2 | 🎯 الفرص والتربص | recommendations + incubator + prediction-tracking |
| 3 | 🔬 مجهر الأسهم | **stocks** (StockScreenerAdvancedView) + trading-chart |
| 4 | 💼 محفظتي وحساباتي | portfolio + watchlist + trading-journal + alerts + bagholder-rescue |
| 5 | 🎓 التعلّم والمحاكاة | academy + simulation |
| 6 | ⚙️ المزيد | news + **sharia** (زكاة+شرعية) + subscription + settings |

### MobileNav
```
[الرئيسية] [الأسهم] [التحليلات] [المحفظة] [رادار السيولة]
```
(was: market-depth → replaced with liquidity-radar)

### Legacy Redirects (valid-views.ts)
```typescript
LEGACY_VIEW_REDIRECTS = {
  'market-depth':     'liquidity-radar',
  'smart-confluence': 'recommendations',
  'v82':              'recommendations',
  'tithes':           'sharia',
  'zakat':            'sharia',
};
```

---

## 9. Canonical Indices

### `vps-service/data/canonical_indices.json`
| Index | Stocks | مثال |
|-------|--------|------|
| **EGX30** | 30 | COMI, TMGH, ETEL, SWDY, HRHO, ABUK, MFPC, FWRY, ... |
| **EGX70** | 70 | + 40 سهم إضافي |
| **EGX100** | 80 | + 10 سهم إضافي |
| **Total** | **180** | (مع تداخل بين المؤشرات) |

### Migration Script
- `scripts/migrate_egx_indices.py` — يـثبت `is_egx30=1` في stocks.db
- API: `/api/market/indices/constituents?index=EGX30`

### Frontend Integration
- IndexCards clickable → `setCurrentView('stocks')` (EGX30/70/100 فقط)
- StockScreenerAdvancedView فيه أزرار فلترة: [الكل] [EGX 30] [EGX 70] [EGX 100]

---

## 10. Critical Findings + Recommendations — المحدّث

### ✅ Resolved (منذ آخر أوديت)
| # | المشكلة | الحل | Commit |
|---|---------|------|--------|
| 1 | 0 TanStack Query usages | QueryClientProvider wired | `a091022` |
| 2 | 1,325 raw palette instances | 0 — codemod + FinancialBadge | `b5f36f3` |
| 3 | 22 `text-X/40 ` bugs | 0 — cleaned | `b5f36f3` |
| 4 | Chart crash (CHART_TEXT) | full 24-constant import | `17b1e6c` |
| 5 | Prediction tracking 0.0% | read json.predictions | `f3b7b04` |
| 6 | Radar empty (wrong fields) | check turnover_egp | `17b1e6c` |
| 7 | BTC in EGX dashboard | removed EidPredictionsWidget | `b78d1c8` |
| 8 | Reports missing from nav | added to market-pulse | `17b1e6c` |
| 9 | Stocks table dead | merged StockScreenerAdvancedView | `cc55370` |
| 10 | 3 proxy routes 404 | created + 200 | `b78d1c8` |
| 11 | is_egx30 = 15/30 | canonical_indices.json + migration | `7a4269a` |
| 12 | Recommendations Tabs عقمية | removed, direct view | `cc55370` |

### ⚠️ Remaining (مـتبقية)
| # | المشكلة | الأولوية |
|---|---------|---------|
| 1 | useAppStore mega-store (1,573 LOC) | متوسطة |
| 2 | 268 manual fetch patterns → useApiQuery | متوسطة |
| 3 | MakerRadarTab.tsx (3,907 LOC) → split | متوسطة |
| 4 | EnhancedPortfolioView.tsx (3,369 LOC) → split | منخفضة |
| 5 | Phase 2 codemod: adopt shared components | مستمر |

---

> **الوثيقة دي محدّثة بناءً على آخر commit `7a4269a`.**
> **كل التغييرات موثّقة في `/home/z/my-project/worklog.md` (5,500+ lines).**
