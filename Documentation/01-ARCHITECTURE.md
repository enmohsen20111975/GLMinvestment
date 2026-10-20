# 01 — المعمارية التقنية الكاملة

> **مصدر الحقيقة:** الكود الفعلي (`.ts`/`.tsx`/`.py`/`.json`). كل اسم مذكور هنا موجود فعلياً في الـ filesystem. آخر مراجعة: 2026-10-19.

---

## 🧱 الطبقات الثلاث + الخدمات المساعدة

| الطبقة | المسؤول | المنفذ | التقنية | الدور |
|---|---|---|---|---|
| **ألفا (العرض)** | `src/` | 3000 | Next.js 14 + React 18 + TS | عرض فقط — SPA + 113 API route + 3 proxy للـ Python |
| **برافو (العقل)** | `vps-service/` | 8010 | Python + FastAPI + Flask | كل المنطق: محركات، تحليل، مخاطر، توقعات، باك تست |
| **برافو (السحب)** | `data_engine/` | 5000 | Python + Flask | سحب الأسعار الحية من 20+ مصدر → DBs |
| **برافو (push)** | `vps-service/ws-service/` | 3005 | Socket.io + Bun | push لحظي للأسعار للمتصفح |
| **برافو (Telegram)** | `vps-service/telegram/` + `telegram-events/` | — | Python + TS | نشر تلقائي + بوت تفاعلي + events |
| **news-agent** | `news-agent/` | — | Python | جمع الأخبار (RSS/Telegram/mubasher/...) |

**القاعدة الحاكمة (Rule 20 — Python=Brain):** `Next.js = العرض، Python = العقل`. أي حساب أو منطق في الواجهة = مخالفة. الـ 3 proxy routes هي الجسر الوحيد.

---

## 🅰️ ألفا — الفرونت (`src/`)

### المعمارية العامة
- **تطبيق SPA بشاشة وحيدة**: `src/app/page.tsx` (1081 سطر، `'use client'`).
- **التنقل**: عبر `useAppStore` (zustand) → `currentView` (string) + URL hash (مثلاً `#admin`, `#stocks`). مفيش routes فعلية لكل شاشة — كل حاجة جوّه `page.tsx` بـ `switch(currentView)`.
- **~50 view** مسموح بيها (قائمة `VALID_VIEWS_SET` في `src/lib/valid-views.ts`). Default → `dashboard`.
- **Lazy loading**: كل view بـ `dynamicImport(() => ..., { ssr: false })` + `withErrorBoundary(...)` عشان أي crash ما يقتلش الصفحة.
- **Auth**: `useSession()` (NextAuth) + `authStatus` + Guest Mode (`isGuestUser` + `isViewAllowedForGuest` من `@/lib/subscription-gate`).

### `src/app/` — الصفحات (خارج api/)
| المسار | الوظيفة |
|---|---|
| `page.tsx` | الشاشة الرئيسية (SPA switch) |
| `layout.tsx` | Root: `Providers` + `SonnerToaster` + `FeedbackWidget` + `StructuredDataScripts` (JSON-LD SEO) |
| `admin/` | Server-side guard (`getServerSession` + `isServerAdmin`) + 4 صفحة (reports, honest-predictions, educational-cards) |
| `backtest/` | لوحة Backtest مستقلة (Phase1/Phase2/Walk-forward) |
| `rescue/` | "عيادة إنقاذ الصفقات" (autopsy + asset_health + recommendation) |
| `payment/success/` | polls `/api/subscription/status` كل 2s لـ 30s (متفعّلش ذاتياً — بتعتمد على Paymob webhook) |
| `legal/` | disclaimer + terms + privacy |
| `sitemap.ts` + `robots.ts` | SEO |

### `src/app/api/` — 113 route handler (أكبر التصنيفات)
| التصنيف | العدد | أمثلة |
|---|---|---|
| `admin/` | 83 | db-manager (17 route: backup/restore/export/import/query/...), engines control, users, predictions, backtest, news, promo-codes, educational-cards — كلها محمية بـ `requireAdminAsync` |
| `predictions/` | 29 | honest-tracking, dual-track, tracking, generate-all, refresh-v40, performance, eid, monthly-league |
| `market/` | 25 | overview, status, summary, indices, sectors, top-movers, gold, liquidity-flow, intraday-pressure, morning-bell, regime |
| `stocks/` | 20 | `[ticker]/{route,depth,expert-analysis,recommendation,history,orderbook,news,comprehensive,unified,dual-persona}`, search, sparkline |
| `mobile/` | 19 | واجهة Flutter: dashboard, news, watchlist, portfolio, predictions, gold, crypto, zakat |
| `maker-radar/` | 16 | signal-tracker, footprint, warmup, timeline, exit-radar, net-picks, market-intelligence, multi-market, entry-timing, fundamentals |
| `portfolio/` | 15 | holdings, equity-curve, watchlists, master, cashflow, risk-summary, intelligence, rescue, bag-holder-rescue |
| `v2/` | 14 | unified (scan/config/analyze), pipelines, engines, presets, chart/full-analysis, recommend, feedback/run, live-analysis, liquidity-radar |
| `crypto/` | 14 | flow, live, simulation, watchlist, portfolio, stop, coins, full-analysis, explosive, `[id]/{route,history}` |
| `subscription/` | 12 | plans, upgrade, start-trial, subscribe, checkout, activate, current, status, trial, check-access, verify |
| `finance/` | 16 | assets, transactions, obligations, screener, reports, projection, inflation, real-return, smart-*, calculate-values, schema |
| `auth/` | 8 | `[...nextauth]`, login, register, logout, me, profile, google, google-signin |
| `ai/` | 3 | chat, analyze-stock, models |
| `data-engine/` | 9 | crypto, forex, health, stocks, silver, metals, control, gold, status |
| `radar/` | 4 | personalized, accuracy, weekly-report, weekly-report/pdf |
| `unified-learning/` | 6 | intelligent, mine-lessons, iterative, patterns, status, indicators |
| باقي | ~40 | alerts, paymob, telegram, bot, paper-trading-v2, currency, sectors, flow, explosive, confluence, live, live-monitor, sniper, sharia, notifications, push, points, feedback, health, keepalive, i18n, deal-advisor, disclosures, egx, egxpilot, hunter, instapay, money, multi-market, news, news-feed, persona, rescue, risk, scanner, screener, seasonality-signals, self-learning, smart-confluence, stock-profile, stored-analysis, trade-results, trading-journal, unified-stocks, user-posts, v4, v82, walk-forward, watchlist, zakat, b2b, ads, cron, ... |
| `[...slug]/route.ts` | catch-all | يرجّع JSON 404 نظيف لأي route غير موجود (عشان Flutter ما يقعش) |

### الـ 3 Proxy Routes (الجسر الوحيد للـ Python)
| Route | السلوك |
|---|---|
| `app/api/proxy/[...path]/route.ts` | **البروكسي الكنوني** (SEC-04 hardened). بيـ forward لأي method لـ `${PYTHON_BACKEND_URL}/api/{path}`. المسارات اللي بتبدأ بـ `admin/` لازم `requireAdminAsync`. بيبعت `X-Admin-Session` + `X-API-Key` (`PROXY_API_KEY` env — **لا hardcoded fallback**). CORS same-origin. |
| `app/api/python/[...path]/route.ts` | **alias** لنفس `proxyRequest`. استثناء: `v4/stats` بيـ intercept + fallback لـ SQLite لو Python down. |
| `app/api/proxy-prod/[...path]/route.ts` | **GET-only** لـ `https://invist.m2y.net` (production mirror). 30 req/min. Whitelist 35+ path prefix. يـ block admin/* تماماً. |

### `src/modules/` — 18 موديول
| Module | الوظيفة |
|---|---|
| `admin/` | AdminView + 22 tab (Backtest, DatabaseManager, DataEngine, EngineSettings, EnginesStatus, Marketing, NewsManagement, Pricing, PromoCodes, Regime, ResourceAlerts, Sharia, SourceAuthority, SuperLearning, SystemControl, Telegram, UserManagement, Validation, VideoEditor, ContentStudio, NewsHealth, CronHealth, PlatformPerformance, EngineControlRoom) |
| `auth/` | `DevLoginForm` (لـ `?dev=1`) |
| `crypto/` | CryptoPortfolioView + CryptoPredictionTrackingView (SimulationView مؤرشف) |
| `dashboard/` | DashboardView + 16 widget (RealtimeTicker, LiveMonitor, MarketSummary, IndexCards, TopMovers, MarketSentiment, CryptoSignals, SeasonalitySignals, MarketPulse, InvestorsFlow, LiquidityFlow, IntradayPressure, MultiMarket, AssetPreferenceOnboarding, PinnableWidget, SafeWidget). MaestroWidget معطّل (Rule 73). |
| `education/` | AcademyView + AcademyEncyclopedia + CandlestickSimulator + LessonPDFExporter + PaperTradingWorkstation + StrategySandbox + MathRenderer + LearningVisuals |
| `market-analysis/` | MarketAnalysisView + UnifiedAnalysisView + TradingChartView + SingleStockAnalysis + InteractiveChart + InstitutionalDecisionPanel + LiveDashboard + AlertPanel + HistoricalTradesTable + MarketDepthLiquidityWidget + ExpertRecommendationsPanel + LearnedLessonsDashboard + tabs (CryptoPredictions, MorningBell, LiveTracking, SectorTracking, Persona, MarketStatus, Predictions, ExpertPredictions) |
| `news/` | NewsFeedView |
| `portfolio/` | AdvancedPortfolioManager + BagHolderRescuePanel + EnhancedPortfolioView + MasterPortfolioSummary + MultiPortfolioSelector + PortfolioIntelligencePanel + RealReturnPanel + RiskProfilerQuiz + RoboAdvisorPanel + SmartAssistantPanel + StockSearchDropdown + TopUpRecommendationsPanel |
| `predictions/` | PredictionTrackingView + DualTrackPredictionsView + PredictionTrackingDashboard + MakerRadarTab |
| `publishing/` | StockPublisher + UnifiedPublishButton + ShareButton + StockInfographicCard/Modal + lib (official-links, table-share-formatter, stock-publish-text, TradeResultsTemplates) |
| `radar/` | RadarStatsCards + SignalStrengthMeter + ExitRadarTab + SignalTrackingTimeline + WeeklyReportTab + MultiMarketRadarTab + AccuracyDashboard + PersonalizedRadarTab + lib (radar-cache, radar-signal-tracker, radar-db) |
| `reports/` | ReportsView + DataManager + StockAnalysisReport + DailyMarketReport + ExecutiveReportView |
| `screener/` | StockScreenerAdvanced (+ WhatsAppIcon + ExportDropdown) |
| `sharia/` | ShariaView + ShariaBadge + ShariaStockCard |
| `simulation/` | SimulationView (موحّد للأسهم + الكريبتو) |
| `stock-analysis/` | StocksView + StockDetail + StockSelector + StockAdvancedAnalysisView + ComprehensiveStockAnalysis + DeepAnalysis + CalculationBreakdown + DeltaVolumeBar + GateAnalysisView + MarketDepthPanel + StockNews + TradingViewChart + TreasuryBondsView |
| `subscription/` | PricingView + TrialExpiredModal + TrialCountdownBanner |
| `personalized/` | lib/personalized-radar.ts |

### `src/lib/` — DB Clients + Helpers الحرجة

#### DB Clients
| الملف | بيفتح أنهي DB | ملاحظات |
|---|---|---|
| `db.ts` | alias — re-export `authDb` | الـ default `db` = auth.db (backward compat) |
| `db-auth.ts` | **`db/auth.db`** (Prisma `@prisma/auth-client`) | Users, Sessions, Subscriptions, ApiTokens, MarketPricing, Referrals, UsageDaily, B2bApiKey |
| `db-predictions.ts` | **`db/predictions.db`** (Prisma `@prisma/predictions-client`) | AiPrediction, ExpertRecommendation, PredictionLog |
| `data-engine-db.ts` | **`db/data_engine.db`** + **`db/stocks.db`** (better-sqlite3) | read-write (WAL reconcile). `getPriceHistoryDb()` بيـ route لنفس data_engine.db |
| `data-engine-db-sqljs.ts` | نفس الـ DBs بس عبر **sql.js (WASM)** | بديل لـ better-sqlite3 لو الـ native module مش متاح |
| `shared-db.ts` | **DEPRECATED** (RESTRUCT-A-DB-1) | بياخد data_engine/stocks/price_history/historical/intraday/predictions. الكومنت: "New code MUST use api-client.ts → /api/*" |
| `sqlite-admin.ts` | ملف إدارة — بيوصل أي `db/*.db` | PROTECTED_DBs set (23 DB) |
| `egx-db.ts` | EGX-specific helper | stocks.db + price_history.db |
| `community-db.ts` | community.db | (layer mismatch — شوف 02) |
| `metrics-db.ts` | metrics.db | Resource Monitoring |
| `bot-link-db.ts` | **بيفتح auth.db** (مش bot-link.db — الاسم مضلل) | جدول `user_telegram_links` |
| `paper-trading-v2-db.ts` | paper_trading.db | |
| `finance-db.ts` | stocks.db (custom.db اتشال) | |

#### Helpers الكبرى
| الملف | الوظيفة |
|---|---|
| `api-client.ts` | **نقطة دخول موحّدة** لكل `fetch('/api/*')`. enforce canonical response `{success, source, data, meta}` + retry على 502/503/504 + paywall event على 402/403 (`paywall:blocked` window event). 30s timeout. |
| `python-backend.ts` | **مصدر Python URL الموحّد**: `PYTHON_BACKEND_URL` env → default `http://127.0.0.1:8010`. Fallbacks: `VPS_API_URL`, `PYTHON_API_URL`, `EGXPY_SERVICE_URL`, `EGX_VPS_API_URL`, `EGXPY_BRIDGE_URL`. |
| `auth-helper.ts` | `getSessionUserId()` — userId من NextAuth session **أو** Bearer token (mobile). |
| `admin-guard.ts` + `admin-auth-server.ts` | `requireAuthAsync` + `requireAdminAsync` (3 طرق: admin_session cookie / X-Admin-Token / NextAuth admin session). **لا hardcoded backdoor** (CRIT-6 fix). |
| `admin-identities.ts` | admin emails/usernames من env (`ADMIN_EMAILS`/`ADMIN_USERNAMES`). |
| `data-adapter.ts` | Multi-source EGX fetcher (Twelve Data → Alpha Vantage → Mubasher scraping → Web Search) + cache 5min. |
| `canonical-signal.ts` | TS port لـ `vps-service/utils/canonical_signal.py`. **Thresholds: STRONG_BUY=78, BUY=65, ACCUMULATE=55, REDUCE=40, STRONG_SELL=25** (Rule 67). |
| `canonical-rsi.ts` | Wilder's RSI (pure, client-safe). |
| `egxpy-bridge.ts` | EGX fetcher: VPS API (PRIMARY) → Python `tv_fetcher.py` (fallback). |
| `server-url.ts` | `getSelfBaseUrl(request)` — resolve self URL من `x-forwarded-host`. |
| `subscription-gate.ts` | `isGuestUser`, `isViewAllowedForGuest`, `PAID_TIERS`, `checkTrialNotExpired`. |
| `subscription-enforcement.ts` | `enforceWatchlistLimit`/`enforcePortfolioLimit`/`enforceAlertLimit`/`enforceAILimit`. |
| `paywall.ts` + `plans.ts` + `payment.ts` | خطط + paywall + Paymob. |
| `logger.ts` | structured logger (Rule 58). |
| `safe-error.ts` | sanitized errors. |
| `rate-limiter.ts` | rate limiter. |
| `ws-client.ts` | WebSocket client. |
| `ai/deepseek-client.ts` + `ai/ollama.ts` + `ai/memory.ts` + `ai/tools.ts` + `ai/tts.ts` | AI integrations (DeepSeek + Ollama + TTS). |
| `schedulers/alert-engine.ts` + `schedulers/radar-alerts.ts` + `scheduler/index.ts` | background schedulers. |

### `src/components/` — التصنيفات
- `ui/` — **shadcn/ui** primitives كاملة (~50 مكون).
- `shared/` — أعمال مشتركة (`LiquidityRadarView`, `FormulaEngine`, `StockSearchSelector`, `UnifiedTable`, `MarketSelector`, `ExpertIntelligencePanel`, `PredictionCard`, ...).
- `layout/` — `TopBar`, `Header`, `Footer`, `MobileNav`, `ExchangeSelector`.
- `auth/` — `AuthView`, `AuthGate`, `LockModal`, `PaywallListener`.
- `notifications/` — `NotificationCenter`, `CentralAlertMonitor`, `RoboNotifierToggle`.
- `alerts/`, `watchlist/`, `publishing/`, `market/`, `memory/`, `journal/`, `seasonality/`, `recommendations/`, `deal-advisor/`, `daily-picks/`, `smart-assistant/`, `backtesting/`, `advanced-analysis/`, `v82/`, `intelligence/`, `legal/`, `settings/`, `about/`, `help/`, `share/`, `smart-tips/`, `persona/`, `subscription/`, `zakat/`, `tithes/`, `ai/`, `crypto/`.

### `src/middleware.ts` (241 سطر — Edge runtime)
- بيشتغل في **Edge runtime** (مش Node.js) — **ما يقدرش** يفتح Prisma أو NextAuth sessions.
- بيـ generate/forward `x-request-id` header لكل request (UUIDv4).
- بيـ categorize routes: public vs protected (`/api/auth/*`, `/api/health`, `/api/keepalive`, `/api/market/*`, `/api/v2/recommend`, `/_next/*` = public).
- **Auth + trial expiry** بيـ delegate لـ API routes (Node runtime) عبر `getSessionUserId()` + `checkTrialNotExpired()`.
- مفيش routing guards فعلية — أساساً request-ID injector + route categorizer.

### State Management (Zustand فقط — React Query صفر استخدام)
| Store | الوظيفة |
|---|---|
| `lib/store.ts` (1552 سطر) | **Main app store** — `currentView`, `currentMarket`, user, stocks, predictions, watchlist, notifications, market overview |
| `lib/alerts-store.ts` | Price & score alerts (7 types). Persisted لـ localStorage. |
| `lib/portfolio-store.ts` | Unified portfolio (assets, master, real-return) — single source of truth |
| `lib/notification-store.ts` | Notifications list + unread count |
| `lib/analysis-store.ts` | Cache للـ stocks/predictions/closedPredictions/storedAnalysis + `liveMode` flag |
| `lib/crypto-learning-store.ts` | Crypto learning progress. Persisted. |
| `lib/engine-control-store.ts` | Per-engine state (active, weights, threshold, logs) — **JSON مش store** (يقرا/يكتب `db/engine_control.json`) |

---

## 🅱️ برافو — الباك بايثون (`vps-service/`)

### `main.py` (367 سطر) — نقطة الدخول
- **FastAPI app** (`title="GLM Finance Backend"`, v2.0.0) — **مش Flask** (التوثيق القديم كدب).
- بيـ load `.env` من جذر المشروع (parser يدوي بدون dependency).
- قبل بناء الـ app: (1) `core.logging_config.setup_logging()` (2) `core.migrator.run_migrations()` (3) `core.scheduler_manager` (APScheduler مركزي).
- **Routers مسجّلة**: `ai.portfolio_routes.portfolio_router` (Wealth Command Center) + `ai.api_routes.ai_router`.
- **`startup_event`**: يسجّل `MarketScheduler.tick` (كل 60ث) + `EgyptScheduler.tick_once` (`setup_nightly_quant_job` 03:00 القاهرة + `setup_egksco_scheduler` 9:00–14:30) + `jobs.wal_checkpoint` ساعيًا على 4 DBs + `jobs.crypto_lab_scheduler` كل 15 دقيقة.
- **Mount**: `lightweight_server.app` (Flask) على `/` عبر `a2wsgi.WSGIMiddleware`.
- **Port**: `uvicorn.run("main:app", host="0.0.0.0", port=8010)`.

### `lightweight_server.py` (1919 سطر) — Flask خفيف
- بيـ mount ~30 Blueprint. أهمهم: `chart_bp`, `stock_analysis_bp`, `public_bp`, `stored_analysis_bp`, `sector_tracking_bp`, `advanced_screener_bp`, `top_performers_bp`, `v2_bp`, `unified_v2_bp`, `confluence_bp`, `screener_bp`, `ai_pred_bp`, `prediction_tracking_bp`, `sniper_bp`, `reports_bp`, `risk_bp`, `notebook_bp`, `learning_bp`, `unified_learning_bp`, `optimizer_params_bp`, `news_bp`, `telegram_bp`, `portfolio_bp`, `misc_bp`, `admin_bp`, `analytics_bp`, `prof_analysis_bp`, `stocks_bp`, `regime_bp`, `scanner_bp`, `persona_bp`, `ai_bp`, `admin_engine_settings_bp`, `historical_preds_v2_bp`, `picks_mgmt_bp`, `v38_backtest_bp`.
- **`maestro_bp` معطّل** (410 Gone) — V40.2 هو المحرك الوحيد.
- **`v4_bp` مش معرّف** — الـ frontend بيستخدم SQLite fallback في Node.
- Routes مباشرة على الـ Flask app: `/api/market-pulse`, `/api/live-monitor`, `/api/flow/*`, explosive/hunting endpoints, smc endpoints, crypto endpoints, AI monitor, `/health`.

### `engines/` — محرك التنفيذ
| الملف | الوظيفة |
|---|---|
| `market_regime.py` | EGX30/EGX100 Stage Detection (Minervini stages 1-4) من `price_history.db` |
| `backtest_engine.py` (2402 سطر) | **V38 Institutional Decision Engine — Backtester**. ATB/RSI/Bollinger/Makers/DNA/Fundamentals/Sector/5 Proofs/Adaptive Threshold/VWAP/Order Blocks. **`daily_predictor.py` بـ يستورد منه `V38BacktestEngine, Trade, simulate_trade, calc_atr`** — V40.2 بـ يستخدم V38 كمحرك تنفيذ. |

### `engine/` — محركات متخصصة
| الملف | الوظيفة |
|---|---|
| `flow_system.py` | Flow System — 4 طبقات (Macro 25% + Sector 30% + Stock 25% + Cross-validation 20%) |
| `persona_engine.py` | 7 شخصيات مستثمرة (conservative→gambler→hedger) + `get_adjusted_threshold` |
| `crypto_engine.py` | محرك كريبتو مخفف (يقرأ من `db/data_engine.db`) |
| `explosive_scanner.py` | ماسح القنابل (Volume_Surge×25% + Price×30% + Sector×20% + SmartMoney×15% + Market×10%) |
| `stock_fundamentals.py` | يجمع 9 جداول من data-engine.db + stocks.db |
| `historical_backfill_engine.py` | تعلم من 180 يوم → prediction_logs + outcome_logs + learned_lessons |
| `paper_trade_tracker.py` | تتبع صفقات افتراضية + قياس بعد 1/5/10/20 يوم |

### `glminvestment_engines/` — Minervini/Turtle-style (منفصل منطقياً)
- `core/base.py` — أنواع موحدة: `SignalType` (STRONG_BUY→STRONG_AVOID), `Timeframe`, `EngineResult`.
- `core/indicators.py` — مؤشرات فنية.
- `engines/vcp_detector.py` — Volatility Contraction Pattern (Minervini).
- `engines/donchian_breakout.py`, `engines/atr_risk_engine.py`, `engines/take_profit_tiers.py`, `engines/stage2_filter.py`.
- `confluence/confluence_scorer.py` — Confluence v4: Donchian 30% + ATR 25% + Stage2 20% + VCP 10% + Persona 15%، مع EGX30 Hard Gate (SMA200).
- `backtest/strategy_backtester.py` — محاكاة بار ببار (Win Rate / Avg R / Profit Factor / Max DD / Expectancy).
- `integration/expert_gate_patch.py` + `integration/risk_engine_patch.py`.
- `cli_analyze.py` + `examples/demo_confluence.py`.

### `analyzers/` — 30+ محلل (التفصيل في `03-ENGINES-AND-LOGIC.md`)
أبرز: `master_analyzer.py` (THE BRAIN)، `core_scoring_engine.py`، `sniper_engine.py`، `confluence_engine_v3.py`، `v82_analyzer.py`، `v68_oracle.py`، `multi_path_detector.py`، `golden_hunter.py`، `institutional_decision_engine.py`، `liquidity_filter.py`، `engine_settings.py` (DYNAMIC)، `expert_quality_gate.py`، `crypto_quality_gate.py`، `prediction_optimizer.py`، `market_regime_engine.py`، `regime_filter.py`، `hmm_market_regime.py` (Rule 71 Layer 2)، `smc_engine.py`، `volume_profile.py`، `expert_memory.py`، `unified_learning_engine.py`، `feedback_loop.py`، `adaptive_weights.py`، `seasonality_engine_v2.py`، `persona_investor.py`/`persona_gambler.py`/`persona_screener.py`، `multi_timeframe_engine.py`، `live_indicator_engine.py`، `news_impact_scorer.py`/`news_stop_filter.py`/`live_news_integration.py`، `fundamental_engine.py`/`fundamental_relative.py`، `garch_exit_engine.py` (Rule 71 Layer 3)، `institutional_levels.py` (Falling Knife Guard)، `feature_extractor.py`، `radar_integration.py`، `quant_engine.py`/`quant_overdrive.py`.

> **maestro_orchestrator.py اتمسح** فعلياً (MAESTRO-CANCER-1). `unified_maestro.py` موجود كبديل.

### `ml_models/`
- **ملف واحد بس**: `ml_overlay_v1.pkl` — sklearn pickled model. مفيش `.py` ML model تدريبية حية (التدريب بيحصل عبر `analyzers/train_ml_model.py`).

### `ai/` — 11 ملف (AI integration)
| الملف | الوظيفة |
|---|---|
| `portfolio_routes.py` | Wealth Command Center endpoints (FastAPI router) |
| `decision_engine.py` + `glm_finance_agent.py` | LLM/agent integration |
| `deepseek_news_service.py` | DeepSeek Financial News AI Service |
| `news_agent.py` | وكيل أخبار بالـ AI المحلي (Ollama) |
| `news_signals_reader.py` | يقرأ أخبار Local News Agent المحقونة |
| `live_ai_monitor.py` | مراقبة AI أثناء الجلسة |
| `nightly_analysis.py` | تحليل ليلي بالـ AI |
| `historical_trade_generator.py` | مولّد صفقات تاريخية |
| `hot_stocks_detector.py` | كاشف أسهم ساخنة |
| `telegram_signal_importer.py` | مستورد توصيات من جروبات Telegram |
| `trade_recorder.py` | مسجّل صفقات + learning loop |

**AI stack**: Ollama محلي (LLM) + DeepSeek API + keyword-based sentiment fallback. **مفيش VLM** في هذا المجلد.

### `api/` — 36 blueprint
أهمهم: `admin_routes.py`, `admin_engine_settings_routes.py`, `ai_routes.py`, `ai_predictions_routes.py`, **`canonical_flow.py`** (classify_liquidity_bucket — Mutually Exclusive), `v2_routes.py`, `unified_v2_routes.py`, `confluence_routes.py`, `sniper_routes.py`, `scanner_routes.py`, `screener_routes.py`, `advanced_screener_routes.py`, `chart_routes.py`, `stock_analysis_routes.py`, `stocks.py`, `sector_tracking_routes.py`, `top_performers_routes.py`, `risk_routes.py`, `portfolio_routes.py`, `regime_routes.py`, `persona_routes.py`, `news_routes.py`, `telegram_routes.py`, `learning_routes.py`, `unified_learning_routes.py`, `prediction_tracking_routes.py`, `historical_predictions_v2_routes.py` (SSE), `picks_management_routes.py` (Daily Picks Top 5), `v38_backtest_routes.py`, `maestro_routes.py` (**معطّل**), `reports_routes.py`, `notebook_routes.py`, `professional_analysis_routes.py`, `optimizer_params_routes.py`, `misc_routes.py`, `analytics.py`, `public_routes.py`, `stored_analysis_routes.py`.

### `core/` — 16 ملف (العمود الفقري)
| الملف | الوظيفة |
|---|---|
| `migrator.py` | Central Migration Manager — استبدل 67 CREATE TABLE متكرر |
| `db_manager.py` | البوابة المركزية لكل DBs (استبدل 100+ `sqlite3.connect`) — aliases: stocks, predictions, auth, data_engine, price_history, crypto, community, crypto_learning |
| `scheduler_manager.py` | APScheduler مركزي (استبدل 3 threads منفصلة) |
| `egypt_scheduler.py` | جدول داخلي لتوقيت مصر |
| `router.py` | "موحّد العقل" — Decision Router بين المحركات |
| `analysis_runner.py` | "THE single write path for stock analysis" — استبدل duplicate loops |
| `opportunity_quality.py` | فرص المضارب vs المستثمر + فلتر الأسهم الحية |
| `persona_db.py` | Safe storage لـ Unified Persona Engine (ممنوع ALTER TABLE، بس CREATE IF NOT EXISTS) |
| `cache_manager.py` | In-Memory TTL Cache |
| `data_source_circuit_breaker.py` | قاطع دائرة لمحركات البيانات (TradingView/EGKSCO/...) |
| `models.py` | نماذج بيانات موحدة |
| `auth_middleware.py` | `@require_admin` + `@require_role` + `@require_trial_or_paid` |
| `http_client.py` | HTTP client مع retry |
| `logging_config.py` | قمع ضجيج المكتبات |
| `database.py` + `crypto_database.py` | connection pooling + DB كريبتو منفصل |

### `jobs/` — 13 cron (الجدولة الكبرى)
| الملف | الوظيفة |
|---|---|
| `daily_predictor.py` (4425 سطر) | **V40.2 generator** — المحرك الرئيسي (cron يومي 14:30). بـ يستخدم V38BacktestEngine + liquidity_filter + radar. خيارات: `--today-only`, `--yesterday-only`, `--start/--end`, `--dry-run`, `--keep-old`. |
| `market_scheduler.py` | الجدول المركزي (tick كل 60ث) |
| `daily_closer.py` | إغلاق التوقعات يوميًا (trailing stop = FLOOR) |
| `intraday_scanner.py` | V40.2 Unified Intraday Engine (كل 5 دقائق) |
| `intraday_aggregator.py` | تجميع شموع لحظية → يومية |
| `crypto_lab_scheduler.py` | Crypto 24/7 Lab (15 دقيقة) — يُلغى بـ `SKIP_CRYPTO_LAB=1` |
| `learning_engine.py` | التعلم الذاتي |
| `hot_candidate_detector.py` | كاشف المرشحين الساخنين |
| `price_history_safetynet.py` + `price_history_stale_monitor.py` | أمان ومراقبة `price_history.db` |
| `fetch_corporate_actions.py` | توزيعات + اكتتابات + جمعيات |
| `fetch_inflation_worldbank.py` | تضخم من World Bank |
| `daily_portfolio_yield.py` | عائد المحفظة اليومي |
| `wal_checkpoint.py` | PRAGMA wal_checkpoint ساعيًا على 4 DBs |

### `scripts/` — 80+ سكريبت (باك تست + backfill + cleanup + migration)
أبرز: `run_full_analysis.py`, `run_backtest.py`/`v2`/`v3`/`all`, `backtesting_engine.py`, `liquidity_backtest_engine.py`, `ab_backtest_harness.py`, `explosive_opportunity_hunter.py`, `v40_2_historical_backfill.py`, `data_heartbeat_checker.py` (**Dead Man's Switch** كل 10 دقايق), `setup_cron.sh`/`check_cron.sh`, باك تست per-market (`backtest_egx/crypto/tadawul/kse/qse.py`), `v40_4_multi_market_backtest.py`, `db_cleanup.py`, `cleanup_catastrophic.py`, `migrate_*.py`, `smart_db_backup.py`, `daily_backup.py`, `paper_trading.py`, `generate_persona_predictions.py`, `build_stock_profiles.py`, `dynamic_exit_optimizer.py`, `optimization_loop.py`, `multi_target_backtest.py`, `setup_ollama.sh`.

### `portfolio/` — 9 ملف (إدارة الصفقات)
`position_manager.py`, `stop_manager.py`, `smart_exit_engine.py`, **`multi_target_exit.py`** (T1/T2/T3 + dynamic stop), `hard_protection.py`, `portfolio_heat.py`, **`purification_calculator.py`** (Tazkiyah تطهير الأرباح), `strategies.py` (Entry Strategies), `trade_journal.py`.

### `strategies_merge/` — 4 استراتيجيات A/B-testable
- `correction_strategy.py` — Strategy A: Correction-only (WHERE).
- `chase_strategy.py` — Strategy B: Chase-only momentum (WHEN).
- `merged_strategy.py` — Strategy C: MERGED (Correction WHERE + Chase WHEN sequentially).
- `merged_strict_strategy.py` — Strategy D: MERGED-STRICT.
- `common.py` — primitives: indicators + structural exit + trade metrics.
- `regime_filter.py` — wrappers لكل strategy.

### `telegram/` — 15 ملف
`auto_post_scheduler.py` (جدولة نشر تلقائي: يومي 3م + أحد 10ص + تقارير)، `telegram_interactive_bot.py` (**بوت تفاعلي** — منافس egxbot.com)، `telegram_notifier.py` (canonical OUTBOUND — target-hit alerts + تقارير + intraday)، `telegram_bot_api.py`, `telegram_client.py` + `auto_poster.py`, `telegram_chart_generator.py` (شارتات رادار الميكرز), `telegram_report_card.py`, `telegram_daily_lessons.py`, `telegram_target_hit_tracker.py`, `telegram_branding.py`, `liquidity_alerts.py`, `ai_processor.py`, `database.py`, `egx_arabic_lookup.py` (قاموس أسماء عربية).

### `ws-service/index.ts` (622 سطر — Socket.io + Bun)
- **PORT 3005**. يـ poll Python backend (8010) وبيـ emit أحدث الأسعار للمشتركين.
- **Hyper Polling**: وقت الجلسة (10:00–14:30 القاهرة) poll كل 2 ثانية. خارج الجلسة كل 30 ثانية.
- **Live Score poll**: 5 ثواني وقت الجلسة، أو 15 دقيقة لو `DELAYED_DATA_MINUTES>0`.
- **PAYWALL-043**: premium 5s / free 15s.
- Events يبثها: `market:update`, `market:snapshot`, `market:status`, `stock:alert`, `ticker:update`, `ticker:live`.
- Events يستقبلها: `subscribe:ticker`, `unsubscribe:ticker`, `getMarketOverview`.
- `/broadcast` POST endpoint — `data_engine/sync.py` يبعتله الأسعار بعد كل sync.

### ملفات root في vps-service
- `risk_management_advanced.py` (1901 سطر) — **CANONICAL advanced risk API**. يـ expose: `calculate_position_size`, `calculate_stop_loss`, `calculate_targets`, `calculate_trailing_stop`, `evaluate_buy_safety`, `enforce_stop_loss`, `validate_trade_with_2_percent_rule`, `calculate_egyptian_confidence`, `DECISION_TABLE`.
- `analysis_engine_v2.py` (984 سطر) — **Analysis Engine V2 Plugin-Based**. `AnalysisOrchestrator` بيوزع 4 plugins (Fundamental / Technical / Candlestick / MeanReversion) — كل واحد ON/OFF + weight. Presets: EGX Conservative / Aggressive / Balanced / Crypto Scalp.
- `scanner_cron.py` — Day Trading Scanner كل 15 دقيقة.
- `reset_predictions.py` — Production v13 (يضع توقعات عالية الثقة).
- `crypto_predictions_reset.py` + `crypto_live_predictions.py`.
- `repair_data_engine.py` — Repair SQLite corruption.
- `import_egx30_production.py` — استيراد EGX30 تاريخي.
- `align_production_symbols.py` — محاذاة tickers بين DBs.
- `cleanup_corrupted_symbols.py`.

---

## 🔄 data_engine — محرك البيانات (`data_engine/`)

### `main.py` (1166 سطر) — Flask app + CORS
- بـ patch `sqlite3.connect` globally (WAL + busy_timeout=30s + foreign_keys=ON).
- DBs: `data_engine.db` + `stocks.db` + `news.db` في `db/`.
- `engine_state` global (حالة كل scraper) → `db/engine_status.json`.
- **24 endpoint**: `/`, `/health`, `/status`, `/stats`, `/logs`, `/market-status`, `/trigger/{stocks,crypto,metals,news,sync,all,historical}`, `/control/{start,stop,toggle/<scraper>,clear-logs}`.
- بيتكامل مع `realtime_sync.post_scrape_hook` + `intraday_storage`.
- **Port**: `5000` (default).

### `sync.py` (793 سطر) — Full System Sync
1. نسخ الأسعار الحالية لـ `stocks.db` (تاريخ اليوم).
2. UPSERT شمعة اليوم في `stock_daily_prices` (Live Developing Candle — بتحافظ على open/high/low).
3. بث الأسعار للـ WebSocket service على `http://localhost:3005/broadcast`.

### `realtime_sync.py` (176 سطر) — Webhook
- `notify_nextjs(event, payload)` بـ POST لـ `http://localhost:3000/api/data-engine/reload` + shared secret. non-blocking + retry + timeout 5ث.

### `intraday_storage.py` (1123 سطر) — v2 Multi-Asset
- DB منفصلة `intraday.db`. 3 جداول: `stock_intraday` (أثناء التداول), `crypto_intraday` (24/7), `commodity_intraday` (24/5).
- **Smart Dedup** (تغيير >0.01% أو 15 دقيقة checkpoint) — بيوفّر 66% مساحة.
- الاحتفاظ 7 أيام.

### `scrapers/` — 20 مصدر بيانات (التفصيل في `02-DATABASES-AND-DATA.md`)
`fallback_chain.py` (universal orchestrator), `tradingview_rest.py`, `tradingview_scraper.py` (Playwright), `tradingview_market_movers.py`, `tradingview_screener_lists.py`, `egxpilot_scraper.py`, `egksco_scraper.py`, `yahoo_scraper.py`, `crypto_fetcher.py` (CoinGecko), `metals_forex_fetcher.py` (metals.dev + Daleelak), `us_stock_scraper.py`, `news_scraper.py`, `historical_fetcher.py` + `historical_fetcher_5years.py`, `technical_fetcher.py`, `multi_market_scraper.py`, `update_fundamentals.py`, `sharia_compliance_scraper.py`, `fetch_logos.py`, `auto_refresh_scheduler.py`, `smart_scheduler.py`.

### `config/`
- **ملف واحد**: `market_hours.py` — أوقات عمل البورصات بتوقيت Africa/Cairo. `is_market_open`, `get_market_status`, `get_all_markets_status`, `should_fetch_data`, `MARKET_HOURS_LOCAL`.

---

## 📰 news-agent + telegram-events (خدمات منفصلة)

### `news-agent/`
- خدمة أخبار منفصلة بـ collectors متعددة: RSS / Telegram / mubasher / investing (disabled) / egx_news / tradingview / daleelak / marketmaker.
- بيكتب لـ `news.db.market_news` (Rule 44 — NEWS-DB-SOT).
- Python + main.py.

### `telegram-events/`
- خدمة events تليجرام بـ TS (Bun).
- `index.ts`.

---

## 🔌 الـ Services والـ Ports (من `ecosystem.config.js`)

| # | name | script | cwd | port | runtime |
|---|---|---|---|---|---|
| 1 | `python-backend` | `main.py` | `vps-service/` | 8010 | Python (FastAPI + Flask) |
| 2 | `data-engine` | `main.py` | `data_engine/` | 5000 | Python (Flask) |
| 3 | `nextjs` | `next start -p 3000` | root | 3000 | Node (Next.js 14) |
| 4 | `ws-service` | `index.ts` | `vps-service/ws-service/` | 3005 | Bun (Socket.io) |
| 5 | `telegram-poster` | `telegram/auto_post_scheduler.py` | `vps-service/` | — | Python |
| 6 | `telegram-interactive-bot` | `telegram/telegram_interactive_bot.py` | `vps-service/` | — | Python |
| 7 | `telegram-events` | `index.ts` | `telegram-events/` | — | Bun |
| 8 | `news-agent` | `main.py` | `news-agent/` | — | Python |

**Gateway**: Caddy على port 81. الـ `/` default → localhost:3000. `/?XTransformPort=<port>` → توجيه ديناميكي.

---

## 🔗 عقد الـ API (ألفا ↔ برافو)

### Tier order
`guest` (no token) < `free` < `normal` < `premium` < `pro` < `admin`

### Auth propagation
- **Next.js هو الـ auth gateway**. بيـ resolve المستخدم عبر NextAuth (session) أو Bearer token (mobile).
- بيبعت للـ Python headers: `X-User-Id` + `X-User-Tier` (+ `X-Admin-Session` للمسارات الإدارية + `X-API-Key`).
- Python بـ يـ enforce عبر `@require_admin` / `@require_role(min_tier, require_trial)` / `@require_trial_or_paid` في `core/auth_middleware.py`.
- **fail-SAFE** للـ guest/public reads؛ **fail-CLOSED** للـ paid gates (B-P2).

### الـ 3 proxy routes (الجسر)
1. `/api/proxy/[...path]` → `${PYTHON_BACKEND_URL}/api/{path}` (canonical، SEC-04 hardened).
2. `/api/python/[...path]` → alias (مع `v4/stats` fallback لـ SQLite).
3. `/api/proxy-prod/[...path]` → GET-only لـ `https://invist.m2y.net` (production mirror).

### Canonical response shape (api-client.ts)
```json
{ "success": true, "source": "python|sqlite|cache", "data": {...}, "meta": {...} }
```
- retry على 502/503/504.
- paywall event على 402/403 → `paywall:blocked` window event → `PaywallListener`.

---

## 🌊 تدفق البيانات (نموذجي)

```
1. data_engine/scrapers/ (EGKSCO/EGXPilot/Yahoo/TradingView/CoinGecko/metals.dev/Daleelak)
   → data_engine.db (live) + stocks.db (snapshot)
   ↓
2. data_engine/sync.py
   → UPSERT stocks.db.stock_daily_prices
   → POST localhost:3005/broadcast (WS push)
   → POST localhost:3000/api/data-engine/reload (Next.js cache invalidate)
   ↓
3. vps-service/jobs/daily_predictor.py (V40.2, cron 14:30)
   → engines/backtest_engine.py (V38)
   → analyzers/* (30+ محلل)
   → predictions.db (write)
   ↓
4. Next.js /api/proxy/[...path]
   → Python :8010 (للمنطق)
   → أو better-sqlite3 مباشر (للقراءة السريعة — DEPRECATED per RESTRUCT-A-DB-1)
   ↓
5. المتصفح (api-client.ts → /api/*)
   → React component (zustand store)
```

---

*هذا الملف مكتوب من الكود الحقيقي. لأي تعديل أو إضافة، ارجع للكود الفعلي أولاً.*
