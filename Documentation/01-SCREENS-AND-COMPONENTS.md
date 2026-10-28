# 01 — الشاشات والمكونات (Screens & Components)

> **المالك:** ألفا | آخر تحديث: 2026-10-28 (post-decomposition merge)

---

## 1. الصفحة الوحيدة (Rule: NO-NEW-SCREENS)

المستخدم يرى فقط `/` (src/app/page.tsx). كل الأقسام أ tabs داخل نفس الصفحة.

---

## 2. الأقسام الرئيسية (Tabs)

| القسم | المكوّن | المصدر |
|-------|---------|--------|
| رادار السيولة | `LiquidityRadarView` | `/api/v2/liquidity-radar` → `DbManager.openDb` |
| الفحص الحي | `IncubatorSection` (panel mode) | `/api/radar/incubator` → `DbManager.getIncubatorData()` |
| الفاحص المتقدم | `StockScreenerAdvanced` | `/api/screener/advanced` → `DbManager.openDb('stocks.db')` |
| تحليل السهم | `StockDetail` | `/api/stocks/[ticker]/*` + `CompanyFundamentalsCard` |
| المحفظة | `PortfolioView` + `BagHolderRescuePanel` | `/api/portfolio/*` |
| أفق الاستثمار | `UnifiedPredictionsTab` (4 sub-views) | `/api/unified/predictions` + `/api/radar/incubator` |
| التوقعات المزدوجة | `DualTrackPredictionsView` | `/api/predictions/dual-track/*` |
| الأخبار | `NewsFeed` | `/api/news/*` |

---

## 3. المكوّنات الموحدة (Shared Components)

### 3.1 UnifiedTable (`src/components/shared/UnifiedTable.tsx`)
- الجدول الموحد لكل شاشات العرض (radar, screener, predictions)
- يدعم: sort, filter, inline edit, dataRef pattern (in-place patching), column hiding
- Column definitions: `Column<T>` interface مع `sortValue`, `filterValue`, `render`, `hidden`, `hideable`

### 3.2 StockIcon / StockIconMini (`src/modules/stock-analysis/components/StockIcon.tsx`)
- يقرأ `logoUrl` (camelCase) أو `logo_url` (snake_case) — defensive
- Fallback: 2-letter avatar + sector emoji
- المصدر: `DbManager.getUnifiedLogos()` (حقن الخاصيتين معاً — ROOT FIX)

### 3.3 RelativeVolumeBadge (`src/components/shared/RelativeVolumeBadge.tsx`)
- شارة الحجم النسبي > 1.2x (per owner directive)
- مصادر: `relative_volume_10d` → `volume_ratio_10d_vs_20d` → `volume_surge`
- Rule 27: لو كل المصادر null → لا تعرض شيئًا (no fabrication)

### 3.4 CompanyFundamentalsCard (`src/components/shared/CompanyFundamentalsCard.tsx`)
- 8 تبويبات مالية (التقييم/الربحية/المركز المالي/قائمة الدخل/التدفقات النقدية/التوزيعات/الأداء/التحليل الفني)
- In-Place Patching: useRef للبيانات + 3-state loading
- المصدر: `/api/maker-radar/fundamentals` → `DbManager.getCompanyFundamentals()`

### 3.5 IntelligenceBadges (`src/components/shared/IntelligenceBadges.tsx`)
- **المصدر الموحد** لـ 4 طبقات ذكاء من برافو + خرائط الترجمة العربية
- يعرض: `price_action` + `participant_flow_assessment` + `continuation_assessment` + `data_quality_status`
- يصدّر: `PRICE_ACTION_AR`, `PARTICIPANT_FLOW_AR`, `CONTINUATION_AR`, `DATA_QUALITY_AR`, `dataQualityColor()`
- مستورد من: `LiquidityRadarView`, `IncubatorSection`, `RadarMomentumTab`
- Rule 27: لو كل الطبقات null → لا تعرض شيئًا (no fabrication)
- Expandable details (price_action_evidence, participant_evidence, data_quality_reasons)

### 3.6 RadarMomentumTab (`src/modules/predictions/components/RadarMomentumTab.tsx`)
- توقعات زخم الرادار — عالية المخاطر
- مدمج في `UnifiedPredictionsTab` (sub-view 4: «📡 زخم الرادار»)
- يقرأ من `/api/radar/incubator` → `DbManager.getIncubatorData()`
- يعرض: مرشحو الرادار (49 سهم) + IntelligenceBadges + trigger/stop/target
- تحذير ثابت: «توقعات مضاربية عالية المخاطر»

### 3.7 SystemTopologyView (`src/modules/admin/components/SystemTopologyView.tsx`)
- خريطة النظام الحية في الـ Admin (#admin → المراقبة)
- رسمين: تدفق القرار + المعمارية الكاملة (5 طبقات)
- KPI bar حية (6 كروت) + live log feed + node detail modal
- تحديث تلقائي كل 10s/30s/60s

### 3.8 WidgetCard (`src/components/shared/WidgetCard.tsx`)
- المكوّن الموحد لكل widget (title + icon + refresh + skeleton)
- مستخدم في 105+ ملف

---

## 4. طبقة الـ DAL (Data Access Layer)

### 4.1 DbManager (`src/lib/db-manager.ts`)
البوابة المقفلة الوحيدة لأي DB access في الـ frontend:

```typescript
import { DbManager } from '@/lib/db-manager';
const db = DbManager.openDb('stocks.db');        // readonly
const db = DbManager.openDbWritable('stocks.db'); // writable + WAL

// دوال معيارية:
DbManager.getLiveSparkline(ticker, days);         // stocks.db.stock_daily_prices
DbManager.getIncubatorData(market);              // maker_radar JSON + freshness filter
DbManager.getUnifiedLogos();                     // stocks.db + data_engine fallback
DbManager.getActivePredictions(market, limit);   // dedup + anomaly filter (15%)
DbManager.getCompanyFundamentals(ticker);        // 8 tabs + 66 columns
DbManager.getMarketTabData(tab, market, ticker); // tab_* tables
DbManager.enrichWithUnifiedLogos(items);         // inject logo_url + logoUrl (ROOT FIX)
```

- **0 `new Database()`** في `src/app/api/` + `src/modules/` (verified post-Wave 4)

---

## 5. المكوّنات التعليمية (Education)

### 5.1 LearningVisuals (`src/modules/education/components/LearningVisuals.tsx`)
- **2,192 سطر** (كانت 2,644 — تم استخراج 452 سطر)
- 17 local exports + 9 re-exports من modules منفصلة = 26 إجمالي

### 5.2 indicators-visuals (`src/modules/education/components/indicators-visuals.tsx`)
- مستخرج من LearningVisuals (284 LOC)
- 5 مكونات: RSIGauge, MACDVisual, SupportResistanceVisual, MovingAveragesVisual, BollingerBandsVisual

### 5.3 financial-visuals (`src/modules/education/components/financial-visuals.tsx`)
- مستخرج من LearningVisuals (209 LOC)
- 4 مكونات: PERatioVisual, DCFFlowVisual, ROEDuPontVisual, DCAStrategyVisual + Badge helper (internal)

---

## 6. الـ Modules

### 6.1 radar (`src/modules/radar/`)
- `IncubatorSection.tsx` (1,574 LOC) — 3-zone panel + ScannerAlertsSection + IntelligenceBadges
- `lib/radar-db.ts` — DAL-backed (openDb من DbManager)
- `lib/radar-signal-tracker.ts` — DAL-backed (openDbWritable)

### 6.2 stock-analysis (`src/modules/stock-analysis/`)
- `StockDetail.tsx` — صفحة تفاصيل السهم
- `StocksView.tsx` — قائمة الأسهم + فلاتر
- `TradingViewChart.tsx` — chart
- `stock-detail/` — sub-components (cards, flow-score, helpers)

### 6.3 market-analysis (`src/modules/market-analysis/`)
- `MarketAnalysisView.tsx` (273 LOC) — الحاوية الرئيسية
- `UnifiedPredictionsTab.tsx` — 4 sub-views: الحالية / الأداء / الملخص / 📡 زخم الرادار
- `persona/` — PersonaTab, PersonaTableView, PersonaCard, StockDetailPanel

### 6.4 screener (`src/modules/screener/`)
- `StockScreenerAdvanced.tsx` — الفاحص المتقدم
- `screener-advanced/` — sub-components (filters, columns, KPIs, presets)

### 6.5 portfolio (`src/modules/portfolio/`)
- `BagHolderRescuePanel.tsx` — حاسبة إنقاذ الأسهم المزنوقة
- `PortfolioView.tsx` — عرض المحفظة

### 6.6 predictions (`src/modules/predictions/`)
- `DualTrackPredictionsView.tsx` — التوقعات المزدوجة (4 tabs)
- `PredictionTrackingView.tsx` — تتبع التوقعات + RadarMomentumTab (مدمج)
- `maker-radar/StockTable.tsx` — جدول الرادار (value_traded + RelativeVolumeBadge)

---

## 7. شاشات الموبايل

كلها thin wrappers على نفس الـ APIs:
- `/api/mobile/dashboard` — لوحة الموبايل
- `/api/mobile/portfolio` — محفظة الموبايل
- `/api/mobile/predictions` — توقعات الموبايل
- `/api/mobile/watchlist` — قائمة المتابعة

---

## 8. الـ State Management

- **Zustand** (`src/lib/store.ts`) — client state (user, market, selected ticker)
- **TanStack Query** (`src/hooks/useApiQuery.ts`) — server state (cache + polling)
- **useAnalysisStore** (`src/lib/analysis-store.ts`) — stocks map (live prices)

---

## 9. الـ i18n

- ملفات: `messages/ar.json` + `messages/en.json`
- الـ hook: `useTranslation()` من `src/lib/i18n-context.tsx`
- كل الـ UI text بالعربية (Rule 5)
