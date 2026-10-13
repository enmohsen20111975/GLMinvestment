# 🩻 AUDIT_FRONTEND_SCREENS_MAP.md
## الجرد التشريحي الكامل لشاشات منصة GLMinvestment (Frontend X-Ray Audit)

> **تاريخ الجرد:** 2026-10-13
> **المكلف:** كبير مهندسي الواجهات (Team Alpha — GLM 5.2)
> **النطاق:** مسح شامل لكل الصفحات والتبويبات والـ Drawers في `src/`
> **المحظور:** لم يتم تعديل سطر كود واحد — هذا تقرير توثيقي فقط (Read-Only Audit)
> **عدد الشاشات المجرودة:** 25 شاشة/مكون رئيسي
> **عدد مسارات الـ API:** 451 مسار (447 GET/POST/PUT/DELETE صريح)

---

## 📋 جدول المحتويات

1. [شاشة الرئيسية (Dashboard)](#1-شاشة-الرئيسية-dashboard)
2. [شاشة الأسهم (StocksView)](#2-شاشة-الأسهم-stocksview)
3. [شاشة تفاصيل السهم (StockDetail)](#3-شاشة-تفاصيل-السهم-stockdetail)
4. [الشارت التفاعلي (TradingChartView)](#4-الشارت-التفاعلي-tradingchartview)
5. [الشارت الاحترافي (ProfessionalTradingChart)](#5-الشارت-الاحترافي-professionaltradingchart)
6. [شارت TradingView المحلي (TradingViewChart)](#6-شارت-tradingview-المحلي-tradingviewchart)
7. [رادار صانع السوق (MakerRadarTab)](#7-رادار-صانع-السوق-makerradartab)
8. [الرادار المخصص (PersonalizedRadarTab)](#8-الرادار-المخصص-personalizedradartab)
9. [الرادار الموحد متعدد الأسواق (MultiMarketRadarTab)](#9-الرادار-الموحد-متعدد-الأسواق-multimarketradartab)
10. [متابعة التوقعات (PredictionTrackingDashboard)](#10-متابعة-التوقعات-predictiontrackingdashboard)
11. [تبويب التوقعات المبسط (PredictionTrackingView)](#11-تبويب-التوقعات-المبسط-predictiontrackingview)
12. [بطاقات إحصائيات الرادار (RadarStatsCards)](#12-بطاقات-إحصائيات-الرادار-radarstatscards)
13. [شاشة الفلاتر المتقدمة (StockScreenerAdvanced)](#13-شاشة-الفلاتر-المتقدمة-stockscreeneradvanced)
14. [شاشة المحفظة الموحدة (EnhancedPortfolioView)](#14-شاشة-المحفظة-الموحدة-enhancedportfolioview)
15. [إنقاذ الأسهم المزنوقة (BagHolderRescuePanel + Rescue Page)](#15-إنقاذ-الأسهم-المزنوقة-bagholderrescuepanel--rescue-page)
16. [قائمة المراقبة (EnhancedWatchlistView)](#16-قائمة-المراقبة-enhancedwatchlistview)
17. [شاشة التقارير (ReportsView)](#17-شاشة-التقارير-reportsview)
18. [تحليل البوابات (GateAnalysisView)](#18-تحليل-البوابات-gateanalysisview)
19. [التحليل الشامل (ComprehensiveStockAnalysis)](#19-التحليل-الشامل-comprehensivestockanalysis)
20. [التحليل الفني المتقدم (StockAdvancedAnalysisView)](#20-التحليل-الفني-المتقدم-stockadvancedanalysisview)
21. [التحليل العميق (DeepAnalysis)](#21-التحليل-العميق-deepanalysis)
22. [أخبار السهم (StockNews)](#22-أخبار-السهم-stocknews)
23. [عمق السوق — DOM (MarketDepthPanel)](#23-عمق-السوق--dom-marketdepthpanel)
24. [شريط الأسعار الحي (RealtimeTicker + LiveStockTicker)](#24-شريط-الأسعار-الحي-realtimeticker--livestockticker)
25. [ويدجت نبض السوق (MarketPulseWidget + MarketSentiment)](#25-ويدجت-نبض-السوق-marketpulsewidget--marketsentiment)
26. [لوحات السيولة اللحظية (IntradayPressurePanel + LiquidityFlowPanel)](#26-لوحات-السيولة-اللحظية-intradaypressurepanel--liquidityflowpanel)
27. [تفاصيل الحساب (CalculationBreakdown)](#27-تفاصيل-الحساب-calculationbreakdown)
28. [خريطة مسارات الـ API الشاملة](#28-خريطة-مسارات-الـ-api-الشاملة)
29. [النتائج العابرة للشاشات (Cross-Cutting Findings)](#29-النتائج-العابرة-للشاشات-cross-cutting-findings)

---

## 1. شاشة الرئيسية (Dashboard)

### المكون الرئيسي: `DashboardView.tsx`
**المسار:** `src/modules/dashboard/components/DashboardView.tsx` (591 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | لا يوجد `fetch` مباشر — يقرأ من `useAppStore()` (يستدعي `loadDashboard()` على mount) |
| **ملف مسار الـ API** | N/A (عبر store → `src/lib/store.ts` → endpoints متعددة) |
| **البيانات المعروضة** | widget registry: `marketOverview.indices[0].{value, change_percent, market_status.is_open}` + `v2Data.stocks[]` (compositeScore, recommendation, entryPrice, exitStrategy.{stopLoss, targetPrice, targetPrice2}, rrRatio, confidence, nameAr) + `v2Data.market.regime.{trend, regimeAr, advice_ar}` |
| **الـ Fallback** | `<DashboardSkeleton/>` بينما `!mounted \|\| isLoading`; قسم "فرص جاهزة" يتخفّى لو مفيش Strong Buy/Buy; "لا توجد ودجات متاحة" لو `eligibleWidgets.length === 0` |

### المكونات الفرعية للداشبورد

#### `MarketPulseWidget.tsx` (884 سطر)
| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/market-pulse?market={currentMarket}` (cache:'no-store', AbortController 12s) — كل 10s عبر `useVisibilityAwarePolling` |
| **ملف مسار الـ API** | `src/app/api/market-pulse/route.ts` |
| **البيانات المعروضة** | `pulse.{score, label, label_en, color}` + `egx30/egx70.{value, change_percent, previous_close}` + `divergence.{value, regime, regime_ar, action, action_ar}` + `breadth.{gainers, losers, unchanged, adv_dec_ratio, total_turnover, total_turnover_bn}` + `top_sector.{sector, turnover_pct, avg_change}` + `market_status, latest_update, cairo_time, weekday, is_trading_hours` |
| **الـ Fallback** | `<PulseSkeleton/>` عند loading; Card "انقطاع الاتصال" + retry button عند error; `return null` لو `!data`; Skeleton للـ breadth bar لو null; skip divergence/top_sector badges لو falsy |

#### `MarketSentiment.tsx` (197 سطر)
| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | لا يوجد — يقرأ `aiInsights` من `useAppStore()` |
| **ملف مسار الـ API** | N/A (عبر store) |
| **البيانات المعروضة** | `market_score` (0-100 gauge), `market_sentiment` (bullish/neutral/bearish), `volatility_index`, `market_breadth`, `gainers`, `losers` |
| **الـ Fallback** | `!aiInsights` → `return null`; NaN score → 50 (محايد); NaN volatility → 0.00; NaN breadth → 0.0%; totalMovers=0 → breadthPercent=50; sentiment غير معروف → neutral config |

#### `RealtimeTicker.tsx` (192 سطر)
| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/stocks?limit=20&market={currentMarket}` (fallback فقط لما WebSocket غير متصل) |
| **ملف مسار الـ API** | `src/app/api/stocks/route.ts` |
| **WebSocket** | `useRealtimeUpdates()` من `@/lib/ws-client` (يستهلك `stockPrices` + `isConnected`). الـ hook يسمع على `market:update`, `ticker:update`, `market:snapshot`, `stock:alert`, `market:status` |
| **البيانات المعروضة** | `ticker, name_ar, current_price, previous_price, price_change, volume` |
| **الـ Fallback** | لو WS متصل + has data → يتجاهل الـ fetch; `isLoading \|\| validStockPrices.length === 0` → `return null`; fetch error → catch صامت + return null; NaN values → 0 |

#### `LiveStockTicker.tsx` (297 سطر)
| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/market-pulse?market={currentMarket}` (cache:'no-store', AbortController 12s) — كل 20s |
| **ملف مسار الـ API** | `src/app/api/market-pulse/route.ts` |
| **البيانات المعروضة** | gainers (top 10) + losers (top 10) merged — `ticker, name/name_ar, current_price, change_percent, volume` + `market_status` للشارة "مباشر/مغلق" |
| **الـ Fallback** | `<TickerSkeleton/>` عند loading; لو error + hasData سابق → يحتفظ بالبيانات + يعرض شارة WifiOff; `!hasData && !loading` → "لا توجد بيانات أسهم متاحة"; NaN change_percent → '—' |

#### `IntradayPressurePanel.tsx` (373 سطر)
| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/market/intraday-pressure?ticker={ticker}&period={period}` (default ticker='COMI', period: 5min/15min/30min/1h/session) |
| **ملف مسار الـ API** | `src/app/api/market/intraday-pressure/route.ts` |
| **البيانات المعروضة** | Buckets (16 حقل: buy/sell/neutral_volume, buy/sell_pressure_pct, net_pressure, vwap, OHLC...) + SessionSummary (14 حقل: total_buy/sell/neutral_volume, buy_sell_ratio, session_vwap/open/close/high/low, tick_count) |
| **الـ Fallback** | 3 Skeletons عند loading; HTTP !ok → "تعذّر جلب البيانات" + retry; `!json.success` + note "no data" → "لا توجد بيانات لحظية لسهم {ticker}..."; `!session_summary` → "لا توجد بيانات تداول داخل الجلسة لهذا السهم"; `buckets.length === 0` → "لا توجد باكتات زمنية في هذه الجلسة"; `buy_sell_ratio` null → '—' |

#### `LiquidityFlowPanel.tsx` (468 سطر)
| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/market/liquidity-flow?market={currentMarket}&days={period}` (period: 7/30/90 يوم) |
| **ملف مسار الـ API** | `src/app/api/market/liquidity-flow/route.ts` |
| **البيانات المعروضة** | SectorFlow table (sector, total_turnover, total_volume, stocks_count, avg_change_pct, flow_direction) + top_inflow_stocks + top_outflow_stocks + investor_type_estimate (institutional_pct, retail_pct, block_trades_count, avg_trade_value, large_blocks[]) + summary (total_turnover, total_volume, net_flow_direction, advancing/declining_sectors) |
| **الـ Fallback** | 3 Skeletons عند loading; HTTP !ok → "تعذّر جلب البيانات" داخل Card; `!json.success` → note \|\| generic; `!data \|\| !summary` → "لا توجد بيانات سيولة لهذا السوق"; كل المصفوفات فاضية → "لا توجد بيانات سيولة لهذا السوق في النافذة المحددة"; `investor_type_estimate` null → skip القسم كله |

#### `MaestroWidget.tsx` (90 سطر) — معطل (DEPRECATED)
| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | لا يوجد نشط — الـ call الأصلي `/api/maestro/overview` معلّق كتعليقات (Rule 73, Task PHASE-2-MAESTRO-KILL) |
| **الـ Fallback** | دائماً `return null` (الكود القديم محفوظ للـ traceability) |

---

## 2. شاشة الأسهم (StocksView)

### `StocksView.tsx`
**المسار:** `src/modules/stock-analysis/components/StocksView.tsx` (2,306 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/stocks/presets?preset={p}&period={y}&market={m}&limit=50` (مباشر) + `GET /api/stocks?page={p}&page_size=500&query={q}&market={m}` (عبر `useAppStore.loadStocks`) + `GET /api/crypto/coins?limit=250` (عبر `useAppStore.loadCryptoList`) + Python live-price refresh (عبر `useAppStore.refreshLivePrices`) |
| **ملف مسار الـ API** | `src/app/api/stocks/presets/route.ts` + `src/app/api/stocks/route.ts` + `src/app/api/crypto/coins/route.ts` |
| **البيانات المعروضة** | Filter controls (stockTab, localSearch, sector, index filter, priceRange, changeFilter, advanced filters) + Quick filter chips + Preset buttons row + OverviewSummary (total, gainers, losers, unchanged, avg change) + UnifiedTable columns (ticker, name_ar, sector, current_price, change_1d/1w, fair_value, upside_percent, canonical signal, sparkline, egx30/70 badges) + Mobile list + TreasuryBondsView |
| **الـ Fallback** | `isInitialLoading` → `<TableSkeleton />` + `<SummarySkeleton />`; `paginatedStocks.length === 0` + presetMode → "preset missing" + reset filters; `paginatedStocks.length === 0` → "لا توجد نتائج مطابقة" + reset filters; Empty sectors dropdown → "لا توجد قطاعات متاحة"; Preset fetch catch → silent `presetData([])` |
| **Live updates** | `setInterval`: EGX 30s + Crypto 60s |

---

## 3. شاشة تفاصيل السهم (StockDetail)

### `StockDetail.tsx`
**المسار:** `src/modules/stock-analysis/components/StockDetail.tsx` (1,654 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/flow/${ticker}` (FlowScoreCard) + `GET /api/explosive/${ticker}` (FlowScoreCard) + `GET /api/stock-profile/${ticker}` (FundamentalsCard) + `GET /api/flow/${encodeURIComponent(selectedTicker)}` (footprintData) + `GET /api/stocks/${selectedTicker}/unified?market=${mkt}` (canonical SSOT) |
| **ملفات مسار الـ API** | `src/app/api/flow/[ticker]/route.ts` + `src/app/api/explosive/[ticker]/route.ts` + `src/app/api/stock-profile/[ticker]/route.ts` + `src/app/api/stocks/[ticker]/unified/route.ts` |
| **البيانات المعروضة** | ticker, name_ar, name, sector, EGX30/70/100 badges, compliance_status, ShariaBadge, current_price, price_change, previous_close, OHLCV info cards, canonical signal card (signal_ar, accumulation, money_flow, master_score + prediction entry/target/stop), P/E, P/B, dividend_yield, EPS, ROE, debt/equity, RSI, MA50, MA200, support/resistance, value_traded + EvidenceScorecard (6 أعمدة: MA cross, liquidity flow, accumulation, RS, falling knife, decision+R:R) |
| **الـ Fallback** | `DetailSkeleton` while loading; "اختر سهماً" empty state when no selectedStock; `ErrorBoundary` retry card wraps every child; canonical card shows "—" when unified null (Rule 27); FundamentalsCard `animate-pulse` skeleton + "(تقديري)" badge; FlowScoreCard returns null when both flow+explosive null |

### المكونات الفرعية داخل StockDetail

#### `DeepAnalysis.tsx` (1,148 سطر)
| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | لا يوجد — يستهلك `useAppStore` (deepAnalysis, professionalAnalysis, selectedStock, isLoading) |
| **البيانات المعروضة** | HeaderCard (action_ar, overall_score, confidence, current_price) + 6 score cards (composite/technical/value/quality/momentum/risk) + RecommendationCard (entry_price/target_price/stop_loss/risk_reward_ratio/time_horizon_ar/summary_ar) + IndicatorsCard (RSI/MACD/Bollinger/StochRSI/ATR/OBV/VWAP/ROC) + PriceLevelsCard (S1/S2/R1/R2/pivot) + PatternCard + VolumeCard + RiskMetricsCard (Sharpe/maxDD/VaR/beta/volatility) + StrengthsRisksCard |
| **الـ Fallback** | `AnalysisSkeleton` while loading → `null` when no deepAnalysis → amber "البيانات غير مكتملة" warning when currentPrice=0; default values: scores→50, action→'hold', time_horizon→'medium_term' |

#### `StockNews.tsx` (617 سطر)
| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | لا يوجد مباشر — يستخدم `loadStockNews(selectedTicker)` من store (الأب StockDetail يستدعي مع limit=15) |
| **البيانات المعروضة** | overall_sentiment (score/label/label_ar/confidence) + sentiment distribution bar + news cards (title/title_ar/source/url/published_at/summary/summary_ar/sentiment/sentiment_score/relevance_score/categories/impact_type/is_catalyst) + tabs (all/positive/negative/neutral) + fetched_at timestamp |
| **الـ Fallback** | `NewsSkeleton` while loading → `EmptyState` ("اضغط لتحميل الأخبار" \|\| "لا توجد أخبار متاحة") → per-tab "لا توجد أخبار إيجابية/سلبية/محايدة"; refresh button disabled when no selectedTicker |

#### `DeltaVolumeBar.tsx` (229 سطر)
| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/stocks/delta-volume?ticker=${ticker}&days=14` |
| **ملف مسار الـ API** | `src/app/api/stocks/delta-volume/route.ts` |
| **البيانات المعروضة** | latest (date/volume/buy_volume/sell_volume/delta_volume/delta_pct/pressure/close) + pressure label (STRONG_BUY/BUY/NEUTRAL/SELL/STRONG_SELL) + animated buy/sell bar + maker direction (ACCUMULATION/ACCUMULATION_LIGHT/NEUTRAL/DISTRIBUTION_LIGHT/DISTRIBUTION) + 14-day history mini-chart + summary stats (buy_days/neutral_days/sell_days) |
| **الـ Fallback** | `animate-pulse` skeleton while loading → **returns null** when no data (silent fail in catch, no error UI); `formatVolume` returns '0' for null/0 |

#### `MarketDepthPanel.tsx` (280 سطر)
| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/market/intraday-pressure?ticker=${encodeURIComponent(ticker.toUpperCase())}&period=${period}` |
| **ملف مسار الـ API** | `src/app/api/market/intraday-pressure/route.ts` |
| **البيانات المعروضة** | ticker input + period selector + interpretation badge + date stamp + overall buy/sell pressure bar + net pressure + timeline buckets (time_label/buy_volume/sell_volume/neutral_volume/total_volume/net_pressure/vwap/tick_count) + session summary cards (VWAP/open/close/high/low/buy-sell ratio) |
| **الـ Fallback** | `Loader2` spinner while loading → "لا توجد بيانات لحظية لهذا السهم" → "لا توجد بيانات للفترة المحددة"; per-card "—" when value null; default ticker 'COMI' if initialTicker not provided |

#### `CalculationBreakdown.tsx` (634 سطر)
| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | لا يوجد — يستهلك `useAppStore` (selectedStock, professionalAnalysis, user) |
| **البيانات المعروضة** | Fair Value (currentPrice, avgFairValue, upsideToFair%, verdict, Graham Number, P/E-based, Lynch value, DCF, growth_rate, risk_free_rate) + Technical (RSI, MA50/MA200, MACD) + Scores (composite formula + 5 sub-scores + risk-adjusted momentum bars) |
| **الـ Fallback** | Each section returns `null` when no selectedStock; Fair Value: "غير متاح" + verdict='unknown' → "لا يمكن حساب القيمة العادلة"; Technical: "بيانات MACD غير متاحة"; Scores: "نتائج التحليل المهني غير متاحة"; **PAYWALL Gate 1**: Fair Value details locked for free users post-trial → "🔒 متاحة للمشتركين" + CTA card |

---

## 4. الشارت التفاعلي (TradingChartView)

### `TradingChartView.tsx`
**المسار:** `src/modules/market-analysis/components/TradingChartView.tsx` (309 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `POST /api/market/publish-status-image` (نشر جميع الشارتات على تيليجرام) |
| **ملف مسار الـ API** | `src/app/api/market/publish-status-image/route.ts` |
| **البيانات المعروضة** | Workspace title + market overview badges (gainers/losers) + StockSearchSelector + selected tickers badges with remove button + 1-col/2-col grid toggle + "نشر الكل" button + يعرض `ProfessionalTradingChart` لكل سهم مختار |
| **الـ Fallback** | `cards.length === 0` → toast.error; cannot remove last stock → toast.info; max 6 stocks → toast.warning; publish failure → console.error + continue; successCount>0 → toast.success with count |

---

## 5. الشارت الاحترافي (ProfessionalTradingChart)

### `ProfessionalTradingChart.tsx`
**المسار:** `src/modules/market-analysis/components/ProfessionalTradingChart.tsx` (826 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/stocks/${encodeURIComponent(tk)}/unified?_t=${Date.now()}` (canonical) + `GET /api/v2/chart/full-analysis?ticker=${tk}&timeframe=${tf}&limit=${limit}` (OHLCV, non-CRYPTO) + `GET /api/crypto/full-analysis?ticker=${tk}&timeframe=${tf}&limit=${limit}` (CRYPTO branch) + `POST /api/alerts/quick-add` + **fallback** `GET /api/chart/${tk}?interval=D&period=1y&asset=stock` (عند فشل full-analysis) |
| **ملفات مسار الـ API** | `src/app/api/stocks/[ticker]/unified/route.ts` + `src/app/api/v2/chart/full-analysis/route.ts` + `src/app/api/crypto/full-analysis/route.ts` + `src/app/api/alerts/quick-add/route.ts` + `src/app/api/chart/[ticker]/route.ts` |
| **WebSocket** | `useLiveTicker(ticker)` من `@/lib/ws-client`: `socket.emit('subscribe:ticker', ticker)` + `socket.on('ticker:live', ...)` + `socket.on('ticker:update', ...)` + `socket.on('connect')` / `socket.on('disconnect')` / `socket.on('connect_error')` |
| **البيانات المعروضة** | ticker, name_ar, livePrice, chgPct, LIVE/DELAYED badge, signal badge (STRONG_BUY → AVOID), trade plan (BUY-only: entry/stop/target1/target2/RR/techScore), regime badge (falling knife / correction / sideways / healthy uptrend), 5 reason cards, collapsible technical details (RSI/MACD/ATR + InstitutionalDecisionPanel + SMC), suggested_position_size_pct, **R:R Gate warning** (R:R < 1.0 → red banner), **EGREF auto-fallback** (UNSUPPORTED_TV_SYMBOLS → local Canvas) |
| **الـ Fallback** | 3-skeleton layout while loading → error card with retry → "بانتظار تحميل الشموع" empty state; **buy-valve (ALPHA-P0)**: entry/stop/target/RR all NULL for non-BUY signals → "لا توجد صفقة شراء مفعلة لهذا السهم حالياً"; signalFinal empty → "— بيانات غير متاحة"; rescue banner `/rescue?ticker=...`; Chart blank state fix: `/api/chart` fallback when full-analysis returns empty ohlcv |

---

## 6. شارت TradingView المحلي (TradingViewChart)

### `TradingViewChart.tsx`
**المسار:** `src/modules/stock-analysis/components/TradingViewChart.tsx` (1,896 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | Primary: `GET /api/chart/${ticker}?interval=${timeframe}&period=${currentRange}&asset=stock&_t=${Date.now()}` + Fallback #1: `GET /api/v2/chart/full-analysis?ticker=${ticker}&timeframe=${v2Tf}&limit=365` + Fallback #2: `GET /api/stocks/${ticker}/history?days=${days}` |
| **ملفات مسار الـ API** | `src/app/api/chart/[ticker]/route.ts` + `src/app/api/v2/chart/full-analysis/route.ts` + `src/app/api/stocks/[ticker]/history/route.ts` |
| **البيانات المعروضة** | OHLCV candles + volume histogram + SMA20/50/200 + EMA20 + Bollinger Bands + RSI (canonical from `@/lib/canonical-rsi`) + MACD + Stochastic + ATR + OBV + price/change/change% + market status chip + TradingView iframe widget (tvSymbol: EGX/TADAWUL/NASDAQ/BINANCE) + dataSource label + **T-04: EGREF auto-fallback** (UNSUPPORTED_TV_SYMBOLS → local Canvas + 12s runtime fallback + iframe onError) |
| **الـ Fallback** | Skeleton while loading → error card "خطأ في تحميل الشارت" with retry (window.location.reload) → "لا توجد بيانات تاريخية لهذا السهم"; fallback #2 sets `dataSource='fallback_daily'` + amber "السوق مغلق" banner; `sanitizeCandles` rejects bad candles, falls back to raw data if all filtered; **3-tier fetch cascade** ensures chart never renders empty |

---

## 7. رادار صانع السوق (MakerRadarTab)

### `MakerRadarTab.tsx`
**المسار:** `src/modules/predictions/components/MakerRadarTab.tsx` (3,936 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/maker-radar?market={m}&minQuietSignals=5&minPrice=1.0` + `GET /api/stocks?market={m}&page_size=1000` + `GET /api/unified/predictions?market={m}&limit=1000` + `POST /api/maker-radar/track` (×3: toggle/GET/auto-track loop) + `GET /api/portfolio/unified-watch` + `POST /api/maker-radar/warmup?market={m}&timeout=120000` + `POST /api/predictions/refresh-v40?mode=today&timeout=240000` + `GET /api/maker-radar/stock?ticker={t}&days=30` (Drawer) + `GET /api/maker-radar/market-intelligence?ticker={t}` |
| **ملفات مسار الـ API** | `src/app/api/maker-radar/route.ts` + `src/app/api/stocks/route.ts` + `src/app/api/unified/predictions/route.ts` + `src/app/api/maker-radar/track/route.ts` + `src/app/api/portfolio/unified-watch/route.ts` + `src/app/api/maker-radar/warmup/route.ts` + `src/app/api/predictions/refresh-v40/route.ts` + `src/app/api/maker-radar/stock/route.ts` + `src/app/api/maker-radar/market-intelligence/route.ts` |
| **WebSocket** | `useRealtimeUpdates()` → `{ stockPrices, wsConnected }`; WS push → silent refetch throttled 3s (Rule 67) |
| **الـ Visibility-aware polling** | `useVisibilityAwarePolling(fetchStockMap + fetchData(true), 15s, { market, allowOffMarket: true })` |
| **البيانات المعروضة** | RadarStock (40+ fields incl. freshness: `last_close_date`, `staleness_days`, `data_quality`, `live_price`, `price_source`, `data_date`) + 4 path lists (quiet/pre_surge/explosive/early_break) + market_regime + prediction stitching + StockDetailDrawer (smart entry card with entry zone, targets, stop, signal strength meter, support/resistance levels, dynamic analysis) |
| **الـ Fallback** | `loading && !data`: 5 Skeletons · `error && !data`: AlertTriangle + retry · `warming_up`: silent keep + Badge "بيشتغل" · empty lists: "لا توجد فرص حالياً — الرادار بيفحص الأسهم" · `filter !== 'all'`: "لا توجد أسهم مطابقة للفلتر الحالي" + زر "عرض الكل" · `cache_stale`: "قديم {N}د" · `last_warmup_status==='failed'`: "⚠️ خطأ آخر تشغيل" |

---

## 8. الرادار المخصص (PersonalizedRadarTab)

### `PersonalizedRadarTab.tsx`
**المسار:** `src/modules/radar/components/PersonalizedRadarTab.tsx` (711 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/radar/personalized` (cache: 'no-store', auth required) |
| **ملف مسار الـ API** | `src/app/api/radar/personalized/route.ts` |
| **البيانات المعروضة** | UserProfile (userId, preferredSectors[], preferredTickers[], preferredMarkets[], riskProfile, averageHoldingDays, holdingPeriodCategory, preferredPriceRange, totalTrades, winRate, profileComputedAt, hasTradeHistory) + PersonalizedPick (ticker, current_price, path, position_size, roc_10d, reason, base_score, personalized_score, sector, personalization_reasons[], adjusted_position_size) + ExcludedPick (ticker, reason, detail) + `radar_status: 'ready' \| 'warming_up'` |
| **الـ Fallback (5 distinct states)** | loading: 3 Skeletons · error: AlertTriangle + retry · `res.status === 401`: UserX icon + "سجّل دخولك الأول" CTA (#login) · `data.profile === null`: Sparkles + "الرادار المخصّص لسه بيتعلّم منك" + "أضف لمحفظتك" CTA (#portfolio) · `picks.length === 0` + warming_up: "الرادار قيد التحميل — حاول مرة أخرى خلال دقيقة" · `picks.length === 0` + ready: "لا توجد توقعات مخصّصة متاحة حالياً" · `excluded.length === 0`: "لا توجد أسهم تم استبعادها" · `hasTradeHistory !== false`: hides totalTrades/winRate/averageHoldingDays stat boxes (Task 9-B — prevents fake "0/0%/0 يوم" display) |

---

## 9. الرادار الموحد متعدد الأسواق (MultiMarketRadarTab)

### `MultiMarketRadarTab.tsx`
**المسار:** `src/modules/radar/components/MultiMarketRadarTab.tsx` (707 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/maker-radar/multi-market?markets={EGX,TADAWUL,KSE,QSE,US,CRYPTO,GOLD}` (URL-encoded comma list) |
| **ملف مسار الـ API** | `src/app/api/maker-radar/multi-market/route.ts` |
| **WebSocket** | `useRealtimeUpdates()` → `{ stockPrices, wsConnected }`; WS push → silent refetch throttled 3s |
| **البيانات المعروضة** | MarketSection (market, name_ar, currency, is_open, regime, regime_ar, market_score, market_open_utc, market_close_utc, count, top_picks[], warming_up, first_generation, cached, cache_age_seconds, last_generated_at, db_source) + RadarPick (ticker, current_price, path, position_size, roc_10d, target_price, market, market_name_ar, currency) + MultiMarketResponse (markets: Record, unified_top_5[]) + 7 markets with flags (🇪🇬🇸🇦🇰🇼🇶🇦🇺🇸₿🥇) + Regime labels: defensive/normal/aggressive/bull/bear/sideways/unknown |
| **الـ Fallback** | loading: 4 Skeletons · error: AlertTriangle + retry · `section.warming_up && first_generation`: "تحميل لأول مرة — حاول تاني خلال دقيقة" · `section.warming_up && !first_generation`: `t('radar.multiMarket.warmingUp')` · `unifiedTop5.length === 0`: AlertTriangle + empty text · `section.top_picks.length === 0 + warming_up`: "جاري التحميل لأول مرة" · `selectedMarkets` toggle prevents empty selection |

---

## 10. متابعة التوقعات (PredictionTrackingDashboard)

### `PredictionTrackingDashboard.tsx`
**المسار:** `src/modules/predictions/components/PredictionTrackingDashboard.tsx` (2,099 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/predictions/honest-tracking/live-tracking?market={m}&days={fetchDays}&limit=200&minScore={minScore}` (cache: 'no-store', AbortController) + `POST /api/predictions/honest-tracking/verify-pending` body `{limit:500}` |
| **ملفات مسار الـ API** | `src/app/api/predictions/honest-tracking/live-tracking/route.ts` + `src/app/api/predictions/honest-tracking/verify-pending/route.ts` |
| **البيانات المعروضة** | LivePrediction (35+ fields): ticker, persona, signal, entry/target/stop, target2, target3 (DNA), highest/lowest, exit_type (TRAILING_PROFIT), liveOutcome, who_is_buying_state, hmm_regime_ar, analysis_reason, support/resistance, ml_confidence_pct + PersonaStats: netReturn, grossProfit/Loss, maxLoss, rrRatio, profitFactor + Proof dialog exports PNG via `html-to-image` |
| **الـ Fallback** | `loading && !data`: 3 Skeletons · `error && !data`: "تعذّر تحميل بيانات التوقعات" + "إعادة المحاولة" · `filteredPredictions.length === 0`: "لا توجد صفقات تطابق خيارات الفلترة المحددة" · UnifiedTable `emptyTextAr="لا توجد صفقات تطابق الفلاتر الحالية"` |
| **ملاحظات** | PERSONA_CONFIG has gambler+balanced+conservative — **but KILL-MAESTRO (2026-08-31)** renders only `['balanced']`. Rule 7 HARD cap: `computeStatsFromPredictions` skips `|returnPct| > 50%` (toxic returns). PERSONA-DEDUP: `aggregateByTicker` — 1 ticker × entryDate = 1 trade. |

---

## 11. تبويب التوقعات المبسط (PredictionTrackingView)

### `PredictionTrackingView.tsx`
**المسار:** `src/modules/predictions/components/PredictionTrackingView.tsx` (718 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/predictions/tracking/stats?market={m}&days=30` + `GET /api/predictions/honest-tracking/list?market={m}&limit=200[&status={status}]` (UNIFY-FIX Rule 73 — migrated from `/api/predictions/tracking/list` 410) + `POST /api/predictions/tracking/verify` body `{market}` |
| **ملفات مسار الـ API** | `src/app/api/predictions/tracking/stats/route.ts` + `src/app/api/predictions/honest-tracking/list/route.ts` + `src/app/api/predictions/tracking/verify/route.ts` |
| **الـ Visibility-aware polling** | `useVisibilityAwarePolling(silent fetchStats+fetchList, 60s, { allowOffMarket: true })` |
| **البيانات المعروضة** | TrackedPick (id, ticker, market, entry_price, stop_loss, target_price, risk_reward, pick_date, status, current_price, verification_date, profit_loss_pct, narrative[], personas{}) + TrackingStats (total, pending, target_hit, stop_hit, expired, resolved, success_rate, failure_rate, avg_return, by_market) + StockPublisher button per row (BUY/SELL/HOLD by status) |
| **الـ Fallback** | `loadingStats && !stats`: 4 Skeletons · `stats === null`: display uses '—' · `stats exists`: summary strip · UnifiedTable `loading=loadingList && picks.length === 0` (8 loadingRows) · `emptyTextAr = t('predictions.tracking.table.empty')` · UI-STABILITY fix (2026-09-28): `silent=true` — `loadingStats`/`loadingList` only flip on first load |

---

## 12. بطاقات إحصائيات الرادار (RadarStatsCards)

### `RadarStatsCards.tsx`
**المسار:** `src/modules/radar/components/RadarStatsCards.tsx` (847 سطر)
يصدّر: `RadarSignalStatsCard` / `SectorTreemapCard` / `EntryTimingCard` / `LiquidityFootprintCard`

| Widget | الـ API المستدعى | ملف مسار الـ API | البيانات المعروضة | الـ Fallback |
|--------|-----------------|------------------|-------------------|--------------|
| `RadarSignalStatsCard` | `GET /api/maker-radar/signal-tracker?days=30` + `POST /api/maker-radar/signal-tracker/verify` body `{max_age_days:45}` | `src/app/api/maker-radar/signal-tracker/route.ts` + `src/app/api/maker-radar/signal-tracker/verify/route.ts` | total_signals, pending, verified, win_rate_pct, avg_outcome_7d/14d/30d, by_signal_type[], recent_signals[] | loading: Skeleton · error: dashed Card "تعذّر تحميل إحصائيات الإشارات" · `total_signals===0`: "لا توجد إشارات مسجّلة بعد" |
| `SectorTreemapCard` | `GET /api/maker-radar/sector-treemap?days=30` | `src/app/api/maker-radar/sector-treemap/route.ts` | sectors[]: sector, stocks_count, total_turnover, total_volume, avg_change_pct, avg_roc_10d, direction (inflow/outflow/neutral), color, top_tickers[] | loading: Skeleton · error: dashed Card "الرادار قيد التحميل" · shows top 12 sectors · DIRECTION_STYLE: inflow 🟢 / outflow 🔴 / neutral 🟡 |
| `EntryTimingCard({ticker})` | `GET /api/maker-radar/entry-timing?ticker={ticker}` | `src/app/api/maker-radar/entry-timing/route.ts` | score (0-100), label, label_color, breakdown (accumulation/volume/support/momentum), recommendation, computed_at | loading: Skeleton · error: dashed Card "تعذّر حساب توقيت الدخول" · color thresholds ≥70% emerald / ≥40% amber / <40% rose |
| `LiquidityFootprintCard({ticker})` | `GET /api/flow/{ticker}` (PHASE4-APIS Rule 27 — migrated from `/api/maker-radar/footprint` 410; Python `compute_money_flow`) | `src/app/api/flow/[ticker]/route.ts` | bin_count, price_min/max, poc_price, vah_price, val_price, value_area_volume_pct, total_volume, buy/sell_volume, delta_volume, buy_sell_ratio, levels[] | loading: Skeleton · error: dashed Card "تعذّر تحميل بصمة السيولة" · `levels.length === 0`: "لا يتوفر مخطط توزيع الحجم" — skips POC/VAH/VAL tiles (Rule 27: no fabrication) |

---

## 13. شاشة الفلاتر المتقدمة (StockScreenerAdvanced)

### `StockScreenerAdvanced.tsx`
**المسار:** `src/modules/screener/components/StockScreenerAdvanced.tsx` (2,724 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/screener/advanced?{params}` (cache: 'no-store') + `GET /api/maker-radar?market={m}&minQuietSignals=5&minPrice=1.0` (cache: 'no-store', `.catch(() => null)` — optional fail-silent) + `GET /api/stocks/top-performers?{params}` (TopPerformersTab) |
| **ملفات مسار الـ API** | `src/app/api/screener/advanced/route.ts` + `src/app/api/maker-radar/route.ts` + `src/app/api/stocks/top-performers/route.ts` |
| **البيانات المعروضة** | AdvancedFiltersTab: full filter card (market, sector, sort/order/limit, price/volume/turnover, trend, above_ma, RSI, volume_surge, near_52w_high/low, PE, ROE, dividend_yield, market_cap, stock_state) + 4 client-side trader presets (🌟 زبدة الرادار / 🚀 انفجار سعري / 💎 قيعان ارتدادية / 🛡️ استثمار دفاعي) + Inline KPIs + UnifiedTable columns (ticker, name, sector, current_price, change_percent, volume, turnover_egp, pe_ratio, roe, rsi, momentum_score, stock_state, sparkline, entry/stop/target/R:R/opportunity_quality, above_ma_50, maker_activity, buy_pct, net_flow_egp, accumulation, life_cycle, expected) + CSV export + **Paywall Gate 5**: free users see only first 5 results. TopPerformersTab: filter + UnifiedTable (ticker, name_ar, sector, start_price, end_price, change_pct, period_days, end_volume) |
| **الـ Fallback** | loading: spinner "جاري تحميل الأسهم..." · error: red error card + "إعادة المحاولة" · `filteredStocks.length === 0`: dashed empty state · `derivedSummary` null: "لا توجد أسهم تحقق شروط الفلتر الحالي" · Radar fetch failure: silently ignored · TopPerformers `sortedResults.length === 0`: empty text |

---

## 14. شاشة المحفظة الموحدة (EnhancedPortfolioView)

### `EnhancedPortfolioView.tsx`
**المسار:** `src/modules/portfolio/components/EnhancedPortfolioView.tsx` (3,362 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى (19 total)** | `GET /api/stocks/search?q={term}` + `GET /api/crypto/coins?limit=250` + `GET /api/portfolio/accounts?user_id=default` + `GET /api/finance/calculate-values{?portfolio_id=}` + `GET /api/finance/obligations?status=active` + `GET /api/finance/assets{?portfolio_id=}` (fallback) + `POST /api/watchlist` + `POST /api/finance/assets` + `PUT /api/finance/assets/{id}` + `DELETE /api/finance/assets/{id}` + `GET /api/finance/transactions?month={m}&year={y}` + `POST /api/finance/transactions` + `DELETE /api/finance/transactions/{id}` + `GET /api/finance/obligations?status=active` + `POST /api/finance/obligations` + `PUT /api/finance/obligations/{id}` + `DELETE /api/finance/obligations/{id}` + `POST /api/finance/obligations/payments` + `GET /api/finance/reports` |
| **ملفات مسار الـ API** | `src/app/api/stocks/search/route.ts` + `src/app/api/crypto/coins/route.ts` + `src/app/api/portfolio/accounts/route.ts` + `src/app/api/finance/calculate-values/route.ts` + `src/app/api/finance/obligations/route.ts` + `src/app/api/finance/assets/route.ts` + `src/app/api/finance/assets/[id]/route.ts` + `src/app/api/watchlist/route.ts` + `src/app/api/finance/transactions/route.ts` + `src/app/api/finance/transactions/[id]/route.ts` + `src/app/api/finance/obligations/[id]/route.ts` + `src/app/api/finance/obligations/payments/route.ts` + `src/app/api/finance/reports/route.ts` |
| **الـ Visibility-aware polling** | `useVisibilityAwarePolling(() => loadAssets(true), 30_000, [loadAssets])` — pauses when tab hidden |
| **البيانات المعروضة** | Assets (gross assets / debts / net worth / monthly yield / annual yield + asset groups by type + gold live prices 24k/21k/18k + persona badge + currency toggle + severe-loss banner) + Income/Expense (transactions table + monthly summary cards) + Obligations (summary cards + table) + Reports (total assets, total liabilities, net worth, monthly savings, savings rate, income vs expenses bars, alerts, assets distribution, investment returns, portfolio health score, money distribution plan 50/20/20/10) |
| **الـ Fallback** | loading: skeleton placeholders · `filteredAssets.length === 0`: dashed Card "لا توجد أصول" · `transactions.length === 0`: "لا توجد معاملات لهذا الشهر" · `obligations.length === 0`: dashed Card "لا توجد التزامات" · `!reports`: dashed Card "لا توجد بيانات كافية" · Silent polling: `refreshing=true` without wiping rows · `goldPrices=null`: "—" (Rule 27 fix) · `/api/finance/calculate-values` failure: falls back to `/api/finance/assets` then empty array silently |

---

## 15. إنقاذ الأسهم المزنوقة (BagHolderRescuePanel + Rescue Page)

### `BagHolderRescuePanel.tsx`
**المسار:** `src/modules/portfolio/components/BagHolderRescuePanel.tsx` (1,118 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/portfolio/bag-holder-rescue?ticker={t}&buy_price={bp}&quantity={qty}` (cache: 'no-store') + `GET /api/finance/calculate-values` (find matching holding) + `PUT /api/finance/assets/{match.id}` (fallback if store helper fails) + `POST /api/trading-journal` (saves decision + reason) + `GET /api/finance/calculate-values` (portfolio net worth for AVERAGE_DOWN ceiling) |
| **ملفات مسار الـ API** | `src/app/api/portfolio/bag-holder-rescue/route.ts` + `src/app/api/finance/calculate-values/route.ts` + `src/app/api/finance/assets/[id]/route.ts` + `src/app/api/trading-journal/route.ts` |
| **البيانات المعروضة** | Inputs (ticker, buy_price, quantity, buy_date) + Result metrics grid (buy_price, current_price, loss_pct, invested_egp, market_value_egp, recovery_needed_pct, all_time_high/low, buy_zone, peak_ratio, is_profitable, fundamentals_note) + Recommendation badge (HOLD/AVERAGE_DOWN/CUT_LOSS) + 5 sub-tabs (Technical/Fundamentals/Scenarios/Rescue Plan/Decision Journal) + Persona-scaled rescue advice + Debt paydown card |
| **الـ Fallback** | loading: `Loader2` spinner · `result=null`: only input form · API error: `toast.error('فشل التحليل')` · Network error: `toast.error('فشل الاتصال بالخادم')` · Apply rescue — no matching holding: `toast.error('لم يتم العثور على السهم في محفظتك')` · AVERAGE_DOWN ceiling exceeded: red warning banner |

### `rescue/page.tsx` (Standalone Rescue Clinic)
**المسار:** `src/app/rescue/page.tsx` (407 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/stocks/{ticker}/comprehensive` (auto-fetch live price) + `GET /api/rescue/analyze?ticker={TICKER}&buy_price={entry}&quantity={qty}` (Python `analyze_clinic()` — Rule 20) |
| **ملفات مسار الـ API** | `src/app/api/stocks/[ticker]/comprehensive/route.ts` + `src/app/api/rescue/analyze/route.ts` |
| **البيانات المعروضة** | RescueResponse: decision (CUT_LOSS/AVERAGE_DOWN/HOLD), decision_ar, verdict_badge, current_price, buy_price, loss_amount, loss_pct, autopsy (bought_near_peak, is_falling_knife, ignored_stop_loss, summary), asset_health (is_profitable, pe_ratio, institutional_flow, support_level, resistance_exit_level, dividend_yield), action_plan (recommended_action, average_down_allowed, average_down_reason), lessons_learned[] |
| **الـ Fallback** | loading: 3 Skeletons · `!json.success`: `toast.error(...)` · `is_profitable === null`: "—" · `pe_ratio === null`: row hidden · `dividend_yield === 0`: row hidden · `support_level === null \|\| ≤0`: hidden · `current_price ≤ 0`: "—" · `verdict_badge === 'danger'`: shows "السيولة المستردة" · conditional autopsy badges: "شراء في قمة" / "سكين ساقطة" / "تجاهل الوقف" |

---

## 16. قائمة المراقبة (EnhancedWatchlistView)

### `EnhancedWatchlistView.tsx`
**المسار:** `src/components/watchlist/EnhancedWatchlistView.tsx` (1,357 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/stocks?query={q}&page_size=10` (search dropdown) + `POST /api/watchlist-enhanced?market={currentMarket}` + `PUT /api/watchlist-enhanced/{item.id}?market={currentMarket}` + `GET /api/watchlist-enhanced?market={currentMarket}` + `DELETE /api/watchlist-enhanced/{deleteId}` |
| **ملفات مسار الـ API** | `src/app/api/stocks/route.ts` + `src/app/api/watchlist-enhanced/route.ts` + `src/app/api/watchlist-enhanced/[id]/route.ts` |
| **Live updates** | `setInterval(() => fetchData(true), 30000)` — 30s silent polling |
| **البيانات المعروضة** | Header (title, subtitle, lastUpdate, "تحديث" + "نشر" + "إضافة سهم" + Brain toggle) + Summary cards (4: total items, total invested, current value, total gain/loss) + Desktop UnifiedTable (ticker + StockPublisher, current_price, sparkline, purchase_price, quantity, total_invested, current_value, gain_loss, price_change_percent, alert_price_above/below, alert_change_percent, actions) + Mobile card + Add/Edit/Delete dialogs |
| **الـ Fallback** | loading: skeleton grid · `loadError=true`: error-state Card + Retry + support mailto · `items.length === 0 && !loadError`: dashed Card + EyeOff + "إضافة سهم" button (UI-FIX-P2-P3 issue 2.10: empty state hidden when API failed) · Silent refresh every 30s · Search dropdown empty: closes silently · Add/Edit/Delete failures: `toast.error(...)` |

---

## 17. شاشة التقارير (ReportsView)

### `ReportsView.tsx`
**المسار:** `src/modules/reports/components/ReportsView.tsx` (956 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/reports/proxy?type=daily&market={currentMarket}` (SectorReport — via `fetchDailyReport`) + `GET /api/reports/proxy?type=weekly&market={currentMarket}` (PredictionsReport — via `fetchWeeklyReport`) + `GET /api/reports/proxy?type=monthly&market={market}` (available via `fetchMonthlyReport` but not called directly here) |
| **ملفات مسار الـ API** | `src/app/api/reports/proxy/route.ts` (unified proxy — Rule 67/Rule 20) + `src/modules/reports/lib/proxy-client.ts` (helper) |
| **البيانات المعروضة** | SectorReport (daily): summary.{total_stocks, gainers, losers, unchanged, market_breadth} + sectors[] (name, count, avg_change_percent) + gold.price_21 + usd_rate + KPIs + heatmap + sector comparison table. PredictionsReport (weekly): egx30_perf, gold_perf, usd_perf, best_stock, worst_stock, lessons[], watchlist[], sparkline_egx[], top_performers[] + AI Summary text (`<pre>` Python-generated). ProfessionalHeader with title, market badge "EGX · LIVE", Arabic date. PNG export via `html-to-image.toPng`, PDF via `window.print()`. |
| **الـ Fallback** | loading: `<LoadingSkeleton />` · `!report \|\| report.skipped \|\| report.success === false`: `<OfflineState />` — AlertTriangle + "تعذّر تحميل التقرير" + note "محرك التقارير (Python) هو المسؤول عن توليد كل التقارير — Node.js للعرض فقط" · `sectors.length === 0`: "بيانات القطاعات متاحة عند تضمينها في تقرير Python اليومي" · `safeFmtNum()` / `safeFmtPct()` return "—" for NaN (Rule 67 — never fabricate) · Python-down (502/504): proxy-client.ts returns `{success:false, skipped:true, reason:'محرك التقارير غير متاح حالياً'}` |

---

## 18. تحليل البوابات (GateAnalysisView)

### `GateAnalysisView.tsx`
**المسار:** `src/modules/stock-analysis/components/GateAnalysisView.tsx` (266 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/stocks/${ticker}/unified` (canonical) + `GET /api/python/v2/cached-analysis/${ticker}` (legacy v2 fallback) — parallel via `Promise.allSettled` |
| **ملفات مسار الـ API** | `src/app/api/stocks/[ticker]/unified/route.ts` + `src/app/api/python/v2/cached-analysis/[ticker]/route.ts` |
| **البيانات المعروضة** | persona toggle (gambler/investor) + signal banner (BUY_STRONG→AVOID) + info table (signal_ar/price/target+%/stop-%/R:R/RSI/market stage/gates passed/5/ATR%/stock strength/100/narrative) + 5 gates visual with passed (🟢/🔴) + tooltip reasonAr + Pine Script copy button |
| **الـ Fallback** | Skeleton while loading → "التحليل غير متاح حالياً" + retry when both unified+v2 fail; **⚠️ Rule-27 flag**: price-derived defaults when NULL (rsi=50, atr=price*0.02, support=price*0.95, etc.) — fabricated values shown as if real rather than "—" (borderline violation worth reviewing) |

---

## 19. التحليل الشامل (ComprehensiveStockAnalysis)

### `ComprehensiveStockAnalysis.tsx`
**المسار:** `src/modules/stock-analysis/components/ComprehensiveStockAnalysis.tsx` (1,430 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | Primary: `GET /api/stocks/${encodeURIComponent(ticker)}/comprehensive?market=${encodeURIComponent(market)}` (cache: no-store) + Best-effort: `GET /api/stocks/${encodeURIComponent(ticker)}/unified` (overrides technical fields: rsi, ma_50, ma_200, support, resistance) |
| **ملفات مسار الـ API** | `src/app/api/stocks/[ticker]/comprehensive/route.ts` + `src/app/api/stocks/[ticker]/unified/route.ts` |
| **البيانات المعروضة (7 tabs)** | Overview (basic/price/keyMetrics/board/hunter/maestro) + Expert (ExpertAnalysisPanel) + Technical (rsi/ma_50/ma_200/support/resistance/high_52w/low_52w/priceHistory chart) + Fundamental (market_cap/pe_ratio/pb_ratio/roe/eps/debt_to_equity/dividend_yield) + Chart (recharts LineChart/BarChart/ComposedChart) + News (title/source/published_at/sentiment) + Predictions (signal/prediction_date/entry_price/target_price/outcome/actual_return) + AI (professional.analysis/recommendation/target_price/risks/summary) |
| **الـ Fallback** | `LoadingSkeleton` while loading → red-bordered error card with retry → null when no data; per-tab empty states ("لا توجد أخبار"/"لا توجد توقعات"/"التحليل الاحترافي بالـ AI غير متاح"); `formatPrice`/`formatPct`/`formatVolume` return "—" for null; Financial Sanity Gate enforces support<price<resistance |

---

## 20. التحليل الفني المتقدم (StockAdvancedAnalysisView)

### `StockAdvancedAnalysisView.tsx`
**المسار:** `src/modules/stock-analysis/components/StockAdvancedAnalysisView.tsx` (700 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/chart/${ticker}?interval=1d&period=${periodParam}` (periodParam maps to 1m/3m/1y) + `GET /api/python/v2/cached-analysis/${ticker}?XTransformPort=8010` (primary analysis) + `GET /api/python/v2/analyze/${ticker}?XTransformPort=8010` (on-demand if cached-analysis missing) |
| **ملفات مسار الـ API** | `src/app/api/chart/[ticker]/route.ts` + `src/app/api/python/v2/cached-analysis/[ticker]/route.ts` + `src/app/api/python/v2/analyze/[ticker]/route.ts` |
| **البيانات المعروضة** | Python analysis banner (master_score circle/signal_ar/is_tradeable/confidence) + score breakdown (master/technical/fundamental/momentum/risk circles) + price chart (recharts AreaChart with target+stop reference lines) + risk profile (entry_low/entry_high/entry_price/target_price/stop_loss_price/risk_reward_ratio/position_size_pct) + market regime + sector overview (market_regime_ar/market_regime_strength/sector_relative_score) + reasons[] + warnings[] + price info (currentPrice/priceChangePercent24h/SMA20/SMA50) + disclaimer |
| **الـ Fallback** | `LoadingSkeleton` while loading → red-bordered error card with retry → "لا يوجد تحليل متاح" + "طلب التحليل" button when no pythonAnalysis → "لا توجد بيانات رسم بياني" when no chartData.ohlcv; `formatPrice` returns "-- ج.م" for null |

---

## 21. التحليل العميق (DeepAnalysis)

### `DeepAnalysis.tsx`
**المسار:** `src/modules/stock-analysis/components/DeepAnalysis.tsx` (1,148 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | لا يوجد — يستهلك `useAppStore` (deepAnalysis, professionalAnalysis, selectedStock, isLoading) |
| **البيانات المعروضة** | HeaderCard (action_ar, overall_score, confidence, current_price) + 6 score cards (composite/technical/value/quality/momentum/risk) + RecommendationCard (entry_price/target_price/stop_loss/risk_reward_ratio/time_horizon_ar/summary_ar) + IndicatorsCard (RSI/MACD/Bollinger/StochRSI/ATR/OBV/VWAP/ROC) + PriceLevelsCard (S1/S2/R1/R2/pivot) + PatternCard (detected patterns + ma_cross) + VolumeCard + RiskMetricsCard (Sharpe/maxDD/VaR/beta/volatility) + StrengthsRisksCard |
| **الـ Fallback** | `AnalysisSkeleton` while loading → `null` when no deepAnalysis → amber "البيانات غير مكتملة" warning when currentPrice=0; default values: scores→50, action→'hold', time_horizon→'medium_term' |

---

## 22. أخبار السهم (StockNews)

### `StockNews.tsx`
**المسار:** `src/modules/stock-analysis/components/StockNews.tsx` (617 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | لا يوجد مباشر — يستخدم `loadStockNews(selectedTicker)` من store (الأب StockDetail يستدعي مع limit=15) |
| **البيانات المعروضة** | overall_sentiment (score/label/label_ar/confidence) + sentiment distribution bar (positive/neutral/negative counts) + news cards (title/title_ar/source/url/published_at/summary/summary_ar/sentiment/sentiment_score/relevance_score/categories/impact_type/is_catalyst) + tabs (all/positive/negative/neutral) + fetched_at timestamp |
| **الـ Fallback** | `NewsSkeleton` while loading → `EmptyState` ("اضغط لتحميل الأخبار" or "لا توجد أخبار متاحة حالياً") → per-tab "لا توجد أخبار إيجابية/سلبية/محايدة"; refresh button disabled when no selectedTicker |

---

## 23. عمق السوق — DOM (MarketDepthPanel)

### `MarketDepthPanel.tsx`
**المسار:** `src/modules/stock-analysis/components/MarketDepthPanel.tsx` (280 سطر)

| الحقل | القيمة |
|-------|--------|
| **الـ API المستدعى** | `GET /api/market/intraday-pressure?ticker=${encodeURIComponent(ticker.toUpperCase())}&period=${period}` |
| **ملف مسار الـ API** | `src/app/api/market/intraday-pressure/route.ts` |
| **البيانات المعروضة** | ticker input + period selector (5min/15min/30min/1h) + interpretation badge (متوازن/ضغط شرائي/ضغط شرائي قوي/ضغط بيعي/ضغط بيعي قوي) + date stamp + overall buy/sell pressure bar + net pressure + timeline buckets (time_label/buy_volume/sell_volume/neutral_volume/total_volume/net_pressure/vwap/tick_count) + session summary cards (VWAP/open/close/high/low/buy-sell ratio) |
| **الـ Fallback** | `Loader2` spinner while loading → "لا توجد بيانات لحظية لهذا السهم" → "لا توجد بيانات للفترة المحددة" (empty buckets); per-card "—" when value null; default ticker 'COMI' if initialTicker not provided |

---

## 24. شريط الأسعار الحي (RealtimeTicker + LiveStockTicker)

تم تفصيله في القسم [1. شاشة الرئيسية (Dashboard)](#1-شاشة-الرئيسية-dashboard) — نفس المكونات.

---

## 25. ويدجت نبض السوق (MarketPulseWidget + MarketSentiment)

تم تفصيله في القسم [1. شاشة الرئيسية (Dashboard)](#1-شاشة-الرئيسية-dashboard) — نفس المكونات.

---

## 26. لوحات السيولة اللحظية (IntradayPressurePanel + LiquidityFlowPanel)

تم تفصيله في القسم [1. شاشة الرئيسية (Dashboard)](#1-شاشة-الرئيسية-dashboard) — نفس المكونات.

---

## 27. تفاصيل الحساب (CalculationBreakdown)

تم تفصيله في القسم [3. شاشة تفاصيل السهم (StockDetail)](#3-شاشة-تفاصيل-السهم-stockdetail) — مكون فرعي.

---

## 28. خريطة مسارات الـ API الشاملة

### إحصائيات عامة

| المقياس | القيمة |
|---------|--------|
| إجمالي ملفات `route.ts` تحت `src/app/api/` | **451** |
| ملفات بـ `export async function GET/POST/PUT/DELETE/PATCH` صريح | **447** |
| ملفات بدون method exports (handler-style re-exports) | **4** |
| مسارات تـ proxy إلى Python backend | **144** (≈32%) |
| مسارات تقرأ SQLite/local data فقط | **303** (≈68%) |
| توزيع الـ methods | GET 371, POST 167, DELETE 29, PUT 14, PATCH 6 |

### أهم الـ modules حسب عدد المسارات

| Module | Routes |
|--------|--------|
| admin | 83 (17 db-manager + 5 engines + 4 system-resources + 4 users + 4 educational-cards + 4 db + 3 backtest/v40 + 3 auth + …) |
| predictions | 29 (7 honest-tracking + 4 tracking + 4 dual-track + …) |
| market | 25 |
| stocks | 20 (11 under [ticker]) |
| mobile | 19 |
| finance | 17 |
| maker-radar | 16 |
| portfolio | 15 |
| crypto | 14 |
| v2 | 13 |

### الأنماط المعمارية

1. **Central Python backend URL**: `src/lib/python-backend.ts` exports `PYTHON_BACKEND_URL` (default `http://127.0.0.1:8010`) honoring 6 env vars: `PYTHON_BACKEND_URL` → `VPS_API_URL` → `PYTHON_API_URL` → `EGXPY_SERVICE_URL` → `EGX_VPS_API_URL` → `EGXPY_BRIDGE_URL`.
2. **Two catch-all proxies to Python**:
   - `/api/proxy/[...path]` — SEC-04 hardened, admin-gated, no hardcoded API key fallback.
   - `/api/python/[...path]` — same `proxyRequest` handler, transparent alias.
3. **One JSON catch-all**: `/api/[...slug]` returns clean JSON 404 for mobile-friendly error handling.
4. **Canonical single-source-of-truth**: `/api/stocks/[ticker]/unified` (Rule 67 CALCULATION-CANONICAL).
5. **SQLite-direct lightweight replacement**: `/api/predictions/honest-tracking/*` (7 sub-routes) bypasses Python dependency for prediction tracking.
6. **Admin DB-manager surface**: 17 sub-routes exposing CRUD, backup, restore, recover, export/import, schema, query, truncate, drop, reindex, repair, checkpoint, delete-backup, historical-backups.

### المسارات المنتهية (410 Gone) التي تم ترحيلها

| المسار القديم | المسار الجديد | السبب |
|---------------|---------------|-------|
| `/api/predictions/tracking/list` | `/api/predictions/honest-tracking/list` | UNIFY-FIX Rule 73 |
| `/api/stored-analysis/live-tracking` | `/api/predictions/honest-tracking/live-tracking` | HONEST-TRACKING-FIX |
| `/api/maker-radar/footprint` | `/api/flow/{ticker}` | PHASE4-APIS Rule 27 |
| `/api/admin/generate-predictions` | disabled; cron `daily_predictor.py` instead | cron-driven |

---

## 29. النتائج العابرة للشاشات (Cross-Cutting Findings)

### 1. أنماط استدعاء البيانات
- **Canonical SSOT هو `/api/stocks/[ticker]/unified`** — يُستهلك من 4 مكونات (StockDetail, GateAnalysisView, ComprehensiveStockAnalysis, ProfessionalTradingChart).
- **WebSocket usage محدود**: فقط 3 مكونات تستخدم `useRealtimeUpdates()` (RealtimeTicker, MakerRadarTab, MultiMarketRadarTab) + مكون واحد يستخدم `useLiveTicker` (ProfessionalTradingChart). باقي المكونات على HTTP polling.
- **`useVisibilityAwarePolling`**: مستخدم في 4 مكونات (MarketPulseWidget 10s, LiveStockTicker 20s, MakerRadarTab 15s, PredictionTrackingView 60s, EnhancedPortfolioView 30s). باقي المكونات تستخدم `setInterval` خام.

### 2. أنماط الـ Fallback (متناسقة عبر كل الشاشات)
- **Skeleton** (loading) → **Error card with retry** (failure) → **"—" / "غير متاح" / "N/A"** per NULL field (Rule 27 NO-FAKE-DATA).
- **Empty states**: dashed Card + Lucide icon + Arabic title + optional subtitle + CTA button.
- **`warming_up` handling**: silent في كل المكونات — يحتفظ بالبيانات + يعرض Badge بدلاً من مسح الشاشة (UI-STABILITY fix 2026-09-28).

### 3. بروتوكولات الـ Rules المطبقة
- **Rule 4 (PYTHON=BRAIN)**: كل الحسابات المالية في Python. الواجهة تعرض فقط. الاستثناء الوحيد: CalculationBreakdown يحسب Graham Number (`√(22.5×EPS×BVPS)`) client-side (محدود).
- **Rule 20 (Python=Brain for Rescue)**: `/api/rescue/analyze` يـ spawn Python `analyze_clinic()` — لا منطق قرار في Node.
- **Rule 27 (NO-FAKE-DATA)**: مطبق في كل مكان. القيم الناقصة → "—" وليس "0".
- **Rule 67 (CALCULATION-CANONICAL)**: RSI يأتي من `@/lib/canonical-rsi` (computeRSISeries) — لا حساب مكرر.
- **Rule 72 (SINGLE-DISPLAY-SOURCE)**: signal/score/entry/stop/target تأتي ONLY من canonical unified API.
- **Rule 73 (SINGLE-DISPLAY-SOURCE)**: لا fallback من `data.confluence` للإشارة في ProfessionalTradingChart.
- **Rule 78 (No TradePlanCard for HOLD/WAIT)**: ALPHA-P0 buy-valve في ProfessionalTradingChart — entry/stop/target/RR كلها NULL للإشارات غير الشرائية.

### 4. Paywall Gates (5 بوابات اشتراك)
| Gate | المكون | المحتوى المقفل |
|------|--------|----------------|
| Gate 1 | CalculationBreakdown | Fair Value details (Graham/Lynch/DCF/P/E) |
| Gate 5 | StockScreenerAdvanced | أول 5 نتائج فقط للمستخدمين المجانيين |
| Radar Access | MakerRadarTab | `getRadarAccess`/`getTrialStatus` من store |

### 5. ⚠️ ملاحظات للمراجعة
- **GateAnalysisView (Rule-27 flag)**: يستخدم price-derived defaults عندما تكون حقول unified فارغة (rsi=50, atr=price*0.02, support=price*0.95, resistance=price*1.05, sma20=price, sma50=price, sma200=price*1.05, volume=50000, MACD hardcoded to {0,0,0}). هذه قيم مختلقة تُعرض كأنها حقيقية بدلاً من "—" — مخالفة محتملة لـ Rule 27 تستحق المراجعة.
- **DeltaVolumeBar**: silent fail في catch بدون error UI — يرجع `null` بدون إخبار المستخدم.
- **6 env vars للـ Python backend**: يُنصح بتوحيد كل المسارات لاستيراد `PYTHON_BACKEND_URL` من `@/lib/python-backend` وحذف inline `EGXPY_SERVICE_URL` constants (~50 مسار لا يزال يستخدم الأنماط القديمة).
- **Orphan detection**: يُنصح بمرجعة `/tmp/full_mapping.txt` (447 صف) مقابل frontend `fetch()` calls لإيجاد المسارات غير المستخدمة أو المكررة.
- **Mobile/v2 surface review**: `mobile/` (19 routes) و `v2/` (13 routes) يبدوان متداخلين مع الـ API surface الرئيسي — يُنصح بالتحقق من إيقاف أي منها.

---

## 📊 ملخص تنفيذي

| المقياس | القيمة |
|---------|--------|
| **إجمالي الشاشات المجرودة** | 25 شاشة/مكون رئيسي |
| **إجمالي ملفات الـ API** | 451 ملف (447 بصريح methods) |
| **مسارات Python proxy** | 144 (32%) |
| **مسارات SQLite-direct** | 303 (68%) |
| **مكونات تستخدم WebSocket** | 4 فقط (RealtimeTicker, MakerRadarTab, MultiMarketRadarTab, ProfessionalTradingChart) |
| **مكونات تستخدم visibility-aware polling** | 5 |
| **مسارات منتهية (410 Gone) مترحلة** | 4 |
| **Paywall Gates** | 5 بوابات |
| **⚠️ مخالفات Rule 27 محتملة** | 1 (GateAnalysisView price-derived defaults) |
| **محظورات محترمة** | ✅ لم يتم تعديل سطر كود واحد — تقرير توثيقي فقط |

---

*نهاية التقرير — الجرد التشريحي الكامل لشاشات منصة GLMinvestment*
