# 05 — الشاشات والمكونات

> **آخر تحديث:** 2026-10-25 | **Commit:** `a3d1d8b`

---

## 1. الشاشات النشطة (63 view)

### أهم الشاشات

| # | الشاشة | الـ Route | الـ Component | الـ API |
|---|--------|----------|---------------|---------|
| 1 | Dashboard | `#dashboard` | `DashboardView` | `/api/market/*` |
| 2 | Liquidity Radar | `#liquidity-radar` | `LiquidityRadarView` | `/api/v2/liquidity-radar` |
| 3 | Trading Chart | `#trading-chart` | `TradingChartView` + `PremiumChart` | `/api/v2/chart/full-analysis` |
| 4 | BagHolder Rescue | `#bagholder-rescue` | `BagHolderRescuePanel` | `/api/portfolio/rescue` |
| 5 | Admin | `#admin` | `AdminView` (18 tabs) | `/api/admin/*` |
| 6 | Portfolio | `#portfolio` | `EnhancedPortfolioView` | `/api/portfolio/*` |
| 7 | Stocks | `#stocks` | `StocksView` | `/api/stocks/*` |
| 8 | Recommendations | `#recommendations` | `PersonaTab` | `/api/v2/recommend` |

## 2. لوحة الأدمن (18 tabs بعد الدمج)

| Hub | Tabs |
|-----|------|
| المراقبة (2) | dashboard, system-monitor |
| المحركات (4) | engine-control, engine-settings, learning, performance |
| البيانات (6) | data-health, investors-entry, databases, system-control, news, quality |
| المستخدمين (3) | users, subscriptions, feedback |
| التسويق (3) | marketing-studio, reports, telegram |

## 3. المكونات الموحدة (shared/ui/)

| Component | الاستخدام | الملفات المستخدمة |
|-----------|---------|-----------------|
| `WidgetCard` | بطاقة موحدة للواجهات | 68 ملف |
| `UnifiedTable` | جدول موحد (فرز + skeleton + RTL) | 55 ملف |
| `UnifiedEmptyState` | حالة فارغة موحدة | 13 ملف (محتاج توسيع) |
| `GenericLiveLogConsole` | كونسول سجلات حي | DbBackupPanel |
| `PremiumChart` | شارت تفاعلي بـ 10 أدوات رسم | TradingChartView |

## 4. إصلاحات Issue #3

### البيانات الوهمية (Fabrication)
- **15 نمط** لسه موجودة في src/ (Issue #3 fixes ضاعت في force-push)
- الـ patterns: `entry*0.97`, `entry*1.05`, `current*1.03`, `price*1.005`
- **مطلوب**: إعادة تطبيق الـ fixes من branch `alpha/fix-issue-3-remove-fake-levels`

### تحسينات UX
- `isLoading` vs `isRefreshing` (منع flicker) — ✅ مطبق
- `React.memo` على InstitutionalDecisionPanel + CanonicalWhoIsBuyingBanner — ✅ مطبق
- عزل عداد 1Hz في MarketAnalysisView — ✅ مطبق
- `retryKey` بدل `window.location.reload()` — ✅ مطبق

## 5. مشاكل معروفة

| # | المشكلة | الخطورة | الحالة |
|---|---------|---------|--------|
| 1 | 6 views بلا error boundaries | 🔴 HIGH | محتاج إصلاح |
| 2 | 15 fabrication pattern في src/ | 🔴 HIGH | محتاج إعادة تطبيق |
| 3 | Turbopack CJS leak (dev only) | 🟡 MEDIUM | مش production issue |
| 4 | UnifiedEmptyState adoption 13/205 | 🟡 MEDIUM | محتاج توسيع |
| 5 | 40+ store subscriptions بدون selectors | 🟡 MEDIUM | محتاج migration |
