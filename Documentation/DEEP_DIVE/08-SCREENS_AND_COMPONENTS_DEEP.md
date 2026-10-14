# 08-SCREENS_AND_COMPONENTS_DEEP.md

> **Deep Dive 3** — جرد تفصيلي لكل شاشة + مكون + مسار تنقل + حالة بيانات.
> مصدر الحقيقة لكل ما يخص الواجهة الأمامية.

---

## 1. خريطة التنقل (Navigation Map)

### Desktop — TopBar (5 dropdowns)
```
الرئيسية → #dashboard
السوق    → #stocks / #stock-filters / #trading-chart / #screener / #smart-confluence
التوقعات → #recommendations / #picks-management / #specialist-analysis / #reports
أموالي   → #portfolio / #watchlist / #alerts-center / #live-monitor / #trading-memory
المزيد   → #news / #academy / #simulation / #crypto / #zakat / #settings
Market Switcher → 🇪🇬 EGX / 🇸🇦 TADAWUL / 🇰🇼 KSE / 🇶🇦 QSE / 🪙 CRYPTO
```

### Mobile — MobileNav (5 icons)
```
🏠 الرئيسية    → #dashboard
📈 التوقعات    → #recommendations
💰 المحفظة     → #portfolio
📡 الرادار      → #liquidity-radar
📊 الشارت      → #trading-chart
```

### MobileMoreSheet
```
🆘 إنقاذ سهم خسران → #bagholder-rescue
👁️ قوائم المراقبة  → #watchlist
🕌 التوافق الشرعي   → #sharia
🎯 المحاكاة        → #simulation
📚 الأكاديمية       → #academy
ℹ️ من نحن          → #about
⚙️ الإعدادات        → #settings
👤 حسابي           → #auth / #settings
```

---

## 2. شاشات EGX (26) — تفصيل كل واحدة

### SCR-001 — Dashboard (#dashboard)
- **المكون**: `DashboardView.tsx` (601 LOC)
- **الوصول**: افتراضي عند الدخول
- **الصلاحية**: لا (الزائر يرى نسخة محدودة)
- **الهيكل** (عمودي — لا tabs):
  1. MyStocksBriefing (للمسجّلين)
  2. AssetPreferenceOnboarding
  3. MarketSummary
  4. IndexCards (4 بطاقات)
  5. TopMovers (top 5 gainers/losers)
  6. RealtimeTicker (WS)
  7. CryptoSignalsWidget + SeasonalitySignalsWidget + EidPredictionsWidget + AutoAnalysisWidget (grid 2x2)
  8. LiveStockTicker
  9. MarketPulseWidget
  10. LiveMonitor (للمسجّلين)
  11. StockSelector
  12. ShareButton + UnifiedPublishButton
- **كل widget**: ملفوف بـ SafeWidget (ErrorBoundary)

### SCR-002 — Stocks List (#stocks)
- **المكون**: `StocksView` (dynamic import)
- **الصلاحية**: PROTECTED (LoginPromptModal للزائر)
- **الهيكل**: Header + StockSearchSelector + Filters bar + UnifiedTable
- **الأعمدة**: # / السهم / السعر / التغير / Volume / القيمة السوقية / قطاع / إشارة / إجراءات
- **Pagination**: 10/page
- **Rule 52**: UnifiedTable إلزامي

### SCR-003 — Stock Detail (داخل #stocks)
- **المكون**: `StockDetailView` (dynamic import)
- **Tabs**: نظرة عامة / التحليل الفني / التوصية / الأخبار / العمق
- **Rule 73**: كل قرار data من `/api/stocks/[ticker]/unified`
- **Rule 78**: TradePlanCard guards (BUY → card / SELL → red panel)

### SCR-005 — Portfolio (#portfolio)
- **المكون**: `PortfolioView` (dynamic import)
- **الصلاحية**: PROTECTED
- **الهيكل**: PortfolioSummary Card + Tabs (المراكز / المتقدمة / روبو-أدفايزر / اختبار المخاطر / Master)
- **Rule 50**: كل أرقام حقيقية من `portfolio_assets`

### SCR-006 — Watchlist (#watchlist)
- **المكون**: `EnhancedWatchlistView` (dynamic import)
- **Rule 52**: UnifiedTable

### SCR-007 — Recommendations (#recommendations)
- **المكون**: `MarketAnalysisView` (dynamic import)
- **Tabs** (7): التوقعات النشطة / تتبع التوقعات / ملخص التوقعات / الفرص الضائعة / دروس من الأخطاء / توقعات الخبراء / التتبع الحي
- **VIP gating**: VIPLiveSignalsFeed للـ vip_pass فقط

### SCR-017 — BagHolder Rescue (#bagholder-rescue)
- **المكون**: `BagHolderRescuePanel` (~760 LOC)
- **3 قرارات**: CUT_LOSS (red) / AVERAGE_DOWN (amber) / HOLD (emerald)
- **Rule 78**: لا توصية شراء على سهم خسران

### SCR-020 — Liquidity Radar (#liquidity-radar)
- **المكون**: `LiquidityRadarView` (712 LOC)
- **4 أعمدة**: الحوت / حالة السوق / المرحلة / الدخول والدفاع
- **Rule 80**: لا "سيولة داخلة" لو buy_pct<45%

### SCR-022 — Alerts Center (#alerts-center)
- **المكون**: `AlertsCenterView` (dynamic import)
- **Tabs**: التنبيهات النشطة / المُطلقة / Sniper scan (polling 60s)

### SCR-AD-001 — Admin (#admin)
- **المكون**: `AdminView` (NotebookAdminTab — 2097 LOC)
- **الصلاحية**: admin-only (server gate)
- **Sub-tabs** (20+): Dashboard / Users / Predictions / Educational / Reports / Telegram / Crypto / Forex / System / DB Manager / Backup / Engines / PM2 / Promo / News / Sharia / Source / Validation / Cron / Performance / AI / A/B

---

## 3. شاشات Crypto (UI-Mirror Protocol — Rule 53)

### مبدأ UI-Mirror
- crypto views تستخدم **نفس مكوّنات EGX** مع `currentMarket='CRYPTO'`
- ممنوع قائمة crypto منفصلة
- مبدّل الأسواق هو الطريق الوحيد للتبديل

### Redirects (8 crypto views → unified)
```
crypto                → dashboard        (DashboardView + CRYPTO)
crypto-live           → stocks           (StocksView + CRYPTO)
crypto-recommendations → recommendations  (MarketAnalysisView + CRYPTO)
crypto-trading-chart  → trading-chart   (TradingChartView + CRYPTO)
crypto-screener       → stock-filters    (StockScreenerAdvancedView + CRYPTO)
crypto-analysis       → smart-confluence  (SmartConfluenceView + CRYPTO)
crypto-learning       → academy           (AcademyView + CRYPTO)
crypto-simulation     → simulation       (SimulationView + CRYPTO)
```

### مستقلة (3 شاشات لها components خاصة)
- `#crypto-portfolio` → CryptoPortfolioView
- `#crypto-watchlist` → EnhancedWatchlistView + CRYPTO
- `#crypto-prediction-tracking` → CryptoPredictionTrackingView

---

## 4. مكونات Layout (6)

### TopBar.tsx (desktop)
- 5 dropdowns + Market Switcher + Display Currency Toggle
- Active state highlighting
- RTL support

### Header.tsx (local page header)
- MobileMoreButton + toggleSidebar (dead code) + Title + Dark mode toggle + Currency Toggle + Search + Notifications + Refresh

### MobileNav.tsx (mobile bottom bar)
- 5 أيقونات ثابتة (safe-area-inset-bottom)

### MobileMoreSheet.tsx
- يفتح من MobileMoreButton — إضافات nav

### ExchangeSelector.tsx
- Dropdown: 🇪🇬 EGX / 🇸🇦 TADAWUL / 🇰🇼 KSE / 🇶🇦 QSE / 🇺🇸 US / 🪙 CRYPTO

### Footer.tsx (sticky)
- روابط اجتماعية + قانونية + شعار
- Rule: sticky footer (`min-h-screen flex flex-col` + `mt-auto`)

---

## 5. مكونات Auth (4)

### AuthGate.tsx (473 LOC)
- 3 banners ديناميكية: AuthGateBanner / TrialWarningBanner / TrialExpiredBanner
- Route guard: PROTECTED_VIEWS (25+ view)
- Admin-only guard: ADMIN_VIEWS = {'admin'}

### AuthView.tsx (~650 LOC)
- Tabs: login / register
- Google OAuth + Credentials (dev only)
- zod validation + react-hook-form

### LoginPromptModal.tsx (285 LOC)
- يفتح عند `showLoginPrompt=true`
- 5 مميزات + CTA "سجّل مجاناً" / "دخول"
- X يتطلب تأكيد AlertDialog

### SessionExpiredModal.tsx (145 LOC)
- non-dismissible (Escape blocked)
- زر واحد: "تسجيل الدخول"

---

## 6. مكونات Subscription (4)

### PricingView.tsx (373 LOC)
- 4 خطط: Premium / Pro / VIP Pass / Developer
- 4 أسواق: EGX / TADAWUL / KSE / QSE
- auto-detect market من `navigator.language`

### TrialExpiredModal.tsx (167 LOC)
- Fullscreen (z-[100]) — لا X
- Promo code section
- يُغلق تلقائيًا عند نجاح الدفع

### TrialCountdownBanner.tsx (125 LOC)
- 3 مستويات لونية: sky ≥7 / amber 3-6 / rose 1-2

### InstapayModal.tsx (309 LOC)
- States: upload / copy / check / pending / verified / error

---

## 7. مكونات Dashboard (19)

| Widget | الوظيفة | المصدر |
|---|---|---|
| MyStocksBriefing | محفظتي + توقعاتي + أخباري | /api/portfolio + /api/predictions + /api/news |
| MarketSummary | مؤشرات EGX30/70/100 | /api/market/summary |
| IndexCards | 4 بطاقات | /api/market/indices |
| TopMovers | top 5 gainers/losers | /api/stocks/top-performers |
| RealtimeTicker | شريط أسعار متحرك | WS port 3005 |
| CryptoSignalsWidget | إشارات كريبتو | /api/crypto/live |
| SeasonalitySignalsWidget | أنماط موسمية | /api/seasonality-signals |
| EidPredictionsWidget | توقعات الأعياد | /api/predictions/eid |
| AutoAnalysisWidget | تحليل آلي | /api/ai/analyze-stock |
| LiveMonitor | مراقبة محفظة لحظية | /api/portfolio/master |
| SafeWidget | ErrorBoundary wrapper | — |
| LazyTabLoader | skeleton loader | — |
| PinnableWidget | HOC for pin/unpin | — |

---

## 8. مكونات shared (15)

| المكون | الوظيفة |
|---|---|
| UnifiedTable | كل جدول (Rule 52) — 2601 LOC |
| UnifiedPublishButton | كل زر نشر (Rule 52) |
| StockSearchSelector | بحث أسهم autocomplete |
| PredictionCard | بطاقة توقع |
| VIPLiveSignalsFeed | feed إشارات VIP (682 LOC) |
| AuditedPerformanceView | أداء موثّق |
| TimeHorizonBadge | شارة أفق زمني |
| LiquidityRadarView | رادار سيولة (712 LOC) |
| LazyTabLoader | skeleton لـ lazy views |
| SafeWidget | ErrorBoundary للـ widgets |
| ErrorBoundary (HOC) | حدود أخطاء لكل view |
| FlashingChangeCell/PriceCell | خلايا بأرقام متغيّرة |
| MarketSelector | مبدّل سوق مدمج |
| FormulaEngine.ts | محرك حسابات (TS port) |
| UnifiedTable | SSOT لكل الجداول |

---

## 9. مكتبة UI المشتركة (49 shadcn components)

| الفئة | المكونات |
|---|---|
| Layout | card, separator, scroll-area, resizable, aspect-ratio, sidebar, sheet, drawer, collapsible, accordion |
| Navigation | navigation-menu, menubar, breadcrumb, tabs, pagination, dropdown-menu, context-menu, hover-card, popover, tooltip |
| Forms | button, input, textarea, label, checkbox, radio-group, switch, slider, toggle, toggle-group, select, command, input-otp, calendar |
| Feedback | dialog, alert-dialog, alert, toast, toaster, sonner, progress, skeleton |
| Data | table, badge, avatar, carousel, chart (Recharts wrapper) |
| Custom | mini-sparkline, stat-card |

---

## 10. Aliases & Redirects

### ALIAS_VIEW_REDIRECTS (P2-ARCH-A5 fix)
```typescript
export const ALIAS_VIEW_REDIRECTS = {
  'analysis': 'recommendations',
  'advanced-analysis': 'recommendations',
  'v2-analysis': 'recommendations',
};
```

### CRYPTO_VIEW_REDIRECTS (Rule 53)
8 crypto views → unified views مع `setCurrentMarket('CRYPTO')`

### Hash Routing
```
URL: /#dashboard → page.tsx → useAppStore.setCurrentViewFromHash('dashboard')
                  → UrlHashSync → renderView() switch → <DashboardView />
```

---

## 11. شاشات مستبعدة (DEAD — لا تُصمّم)

| الشاشة | سبب الاستبعاد |
|---|---|
| #maestro | DELETE-MAESTRO 2026-10-12 (556KB dead code) |
| #learning | Archived → موحد في #academy |
| #community | Sidebar removed + orphan |
| #prediction-performance | Admin-only placeholder |
| #prediction-credibility | Admin-only placeholder |
| #trading-journal (مستقل) | DEAD — موزّع على admin/recommendations |
| #unified-analysis | DEAD |
| StoredAnalysisView | DEAD |

---

*آخر تحديث: 2026-10-14 by سوسو (CEO Agent)*
