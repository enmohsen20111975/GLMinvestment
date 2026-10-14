# 02-SCREENS_AND_API_CONTRACTS.md

> **الملف المرجعي الثاني** — جرد الشاشات + عقود API + عقود البيانات.
> مصدر الحقيقة لكل ما يخص الواجهة والـ API.

---

## 1. جرد الشاشات (59 شاشة/حالة)

### أ. شاشات EGX (26)

| المعرف | Hash | الاسم | الأولوية | المكون |
|---|---|---|---|---|
| SCR-001 | `#dashboard` | لوحة المعلومات | P0 | DashboardView |
| SCR-002 | `#stocks` | قائمة الأسهم | P0 | StocksView |
| SCR-003 | `#stock-filters` | الفلترة المتقدمة | P1 | StockScreenerAdvancedView |
| SCR-004 | `#trading-chart` | الرسم البياني | P1 | TradingChartView |
| SCR-005 | `#portfolio` | المحفظة | P0 | PortfolioView |
| SCR-006 | `#watchlist` | قائمة المراقبة | P0 | EnhancedWatchlistView |
| SCR-007 | `#recommendations` | متابعة التوقعات | P0 | MarketAnalysisView |
| SCR-008 | `#smart-confluence` | توقعات Confluence | P1 | SmartConfluenceView |
| SCR-009 | `#specialist-analysis` | التحليل المتخصص | P2 | SpecialistAnalysisView |
| SCR-010 | `#prediction-tracking` | تتبع التوقعات | P1 | PredictionTrackingView |
| SCR-011 | `#dual-track` | التوقعات المزدوجة | P2 | DualTrackPredictionsView |
| SCR-012 | `#v82` | محرك القرار V82 | P2 | V82DecisionPanel |
| SCR-013 | `#reports` | التقارير | P2 | ExecutiveReportView |
| SCR-014 | `#news` | الأخبار | P1 | NewsFeedView |
| SCR-015 | `#simulation` | المحاكاة | P2 | SimulationView |
| SCR-016 | `#academy` | الأكاديمية | P2 | AcademyView |
| SCR-017 | `#bagholder-rescue` | إنقاذ سهم خسران | P1 | BagHolderRescuePanel |
| SCR-018 | `#advanced-portfolio` | المحفظة المتقدمة | P2 | AdvancedPortfolioView |
| SCR-019 | `#seasonality` | الموسمية | P3 | SeasonalityDashboard |
| SCR-020 | `#liquidity-radar` | رادار السيولة | P1 | LiquidityRadarView |
| SCR-021 | `#market-depth` | عمق السوق | P2 | MarketDepthView |
| SCR-022 | `#alerts-center` | مركز التنبيهات | P1 | AlertsCenterView |
| SCR-023 | `#live-monitor` | المراقبة الحية | P2 | LiveMonitor |
| SCR-024 | `#wealth` | الثروة | P2 | WealthView |
| SCR-025 | `#trading-memory` | ذاكرة التداول | P3 | TradingMemoryView |
| SCR-026 | `#publishing` | النشر | P3 | UserPublishingView |

### ب. شاشات Crypto المستقلة (3)
| المعرف | Hash | المكون |
|---|---|---|
| SCR-CR-001 | `#crypto-portfolio` | CryptoPortfolioView |
| SCR-CR-002 | `#crypto-watchlist` | EnhancedWatchlistView + CRYPTO |
| SCR-CR-003 | `#crypto-prediction-tracking` | CryptoPredictionTrackingView |

*(8 crypto views أخرى تُدمج في unified views مع `currentMarket='CRYPTO'` — UI-Mirror Protocol)*

### ج. الشاشات الإسلامية (3)
| المعرف | Hash | المكون |
|---|---|---|
| SCR-IS-001 | `#zakat` | ZakatView |
| SCR-IS-002 | `#tithes` | TithesView |
| SCR-IS-003 | `#sharia` | ShariaView |

### د. شاشات الحساب والاشتراك (5)
| المعرف | Hash/Path | المكون |
|---|---|---|
| SCR-AC-001 | `#auth` | AuthView |
| SCR-AC-002 | `#subscription` | SubscriptionView → PricingView |
| SCR-AC-003 | `#settings` | SettingsView |
| SCR-AC-004 | `#about` | AboutView |
| SCR-AC-005 | `/rescue` | BagHolderRescuePanel (page) |

### هـ. الصفحات القانونية والمساعدة (5)
| المعرف | Path | الملف |
|---|---|---|
| SCR-LG-001 | `/legal/terms` | legal/terms/page.tsx |
| SCR-LG-002 | `/legal/disclaimer` | legal/disclaimer/page.tsx |
| SCR-LG-003 | `/legal/privacy` | legal/privacy/page.tsx |
| SCR-PG-001 | `/payment/success` | payment/success/page.tsx |
| SCR-PG-002 | `/backtest` | backtest/page.tsx |

### و. شاشات الإدارة (4)
| المعرف | Path | المكون |
|---|---|---|
| SCR-AD-001 | `#admin` | AdminView (NotebookAdminTab — 20+ sub-tabs) |
| SCR-AD-002 | `/admin/honest-predictions` | honest-predictions/page.tsx |
| SCR-AD-003 | `/admin/educational-cards` | educational-cards/page.tsx |
| SCR-AD-004 | `/admin/reports` | reports/page.tsx |

### ز. Overlays (5)
| المعرف | النوع | المكون |
|---|---|---|
| SCR-OV-001 | Modal | LoginPromptModal |
| SCR-OV-002 | Banner | TrialCountdownBanner |
| SCR-OV-003 | Fullscreen | TrialExpiredModal |
| SCR-OV-004 | Non-dismissible | SessionExpiredModal |
| SCR-OV-005 | Modal | InstapayModal |

### ح. البنية التحتية (8)
| الملف | الوظيفة |
|---|---|
| `layout.tsx` | Root layout + Providers + RTL + i18n + SEO |
| `globals.css` | نظام الألوان + الخطوط + tabular-nums |
| `error.tsx` | App-level error boundary |
| `global-error.tsx` | Root boundary |
| `not-found.tsx` | 404 عربية |
| `loading.tsx` | Suspense skeleton |
| `robots.ts` | robots.txt |
| `sitemap.ts` | sitemap.xml |

---

## 2. نظام التصميم (Design System)

### لوحة الألوان (Light `:root`)
```css
--background:          #FFFFFF
--foreground:          #181A1B
--primary:             #10B981  (Emerald-600 — hsl 160 84% 39%)
--primary-foreground:   #FFFFFF
--secondary:           #F4F6F5
--muted:               #F4F6F5
--muted-foreground:    #6B7370
--accent:              #DCFCE7
--destructive:         #EF4444
--border:              #E2E8E6
--ring:                #10B981
--radius:              0.75rem (12px)

/* Semantic */
--success:             #22C55E  (أخضر صعود)
--warning:             #F59E0B  (amber تحذير)
--danger:              #EF4444  (أحمر هبوط)
--info:                #0EA5E9  (sky — استثناء محدود)

/* Chart palette (لا blue/indigo) */
--chart-1:             #10B981  (emerald)
--chart-2:             #14B8A6  (teal)
--chart-3:             #F59E0B  (amber)
--chart-4:             #F97316  (orange)
--chart-5:             #84CC16  (lime)
```

### لوحة الألوان (Dark `.dark`)
```css
--background:          #0C0F0E  (Bloomberg terminal feel)
--foreground:          #E2E8E6
--card:                #131817
--primary:             #10B981
--border:              #282F2D
```

### الخطوط
```css
--font-arabic:    'Cairo', 'Tajawal', system-ui, sans-serif;
--font-heading:   'Outfit', system-ui, sans-serif;
--font-mono:      'JetBrains Mono', monospace;

body {
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1, 'cv01' 1;
}
```

### أحجام الخطوط
| المستوى | الحجم | الوزن | الخط |
|---|---|---|---|
| Display | 36px (text-4xl) | 700 | Outfit |
| H1 | 30px (text-3xl) | 700 | Outfit |
| H2 | 24px (text-2xl) | 600 | Cairo |
| H3 | 20px (text-xl) | 600 | Cairo |
| Body | 16px (text-base) | 400 | Cairo |
| Numbers | 16px | 500 | JetBrains Mono |

### المكونات الإلزامية
- `UnifiedTable` — كل جدول (Rule 52)
- `UnifiedPublishButton` — كل زر نشر
- `StockSearchSelector` — بحث أسهم
- `ExchangeSelector` — مبدّل أسواق
- `SafeWidget` — ErrorBoundary لكل widget
- `withErrorBoundary` HOC — لكل view ثقيل
- `LazyTabLoader` — skeleton لـ lazy views

### الأزرار (shadcn/ui new-york)
| النوع | اللون | الاستخدام |
|---|---|---|
| Primary | bg-primary | الإجراء الرئيسي |
| Secondary | bg-secondary | إجراء ثانوي |
| Outline | border border-input | إجراء محايد |
| Ghost | hover:bg-accent | إجراء خفيف |
| Destructive | bg-destructive | حذف/إيقاف |
| Link | text-primary | رابط نصي |

### قواعد RTL
- `<html lang="ar" dir="rtl">`
- logical properties: `ms-2 me-2` بدل `ml-2 mr-2`
- الأرقام: `tabular-nums` + LTR
- Tabs تبدأ من اليمين

---

## 3. عقود الـ API

### Unified Response Envelope
```typescript
// نجاح
{ success: true, data: T, timestamp: string }

// خطأ
{ success: false, error: string | { code, message, details }, timestamp: string }
```

### Status Codes المعتمدة
| Code | الاستخدام |
|---|---|
| 200 | OK |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized (مطلوب تسجيل دخول) |
| 403 | Forbidden (صلاحية غير كافية) |
| 404 | Not Found |
| 409 | Conflict |
| 410 | Gone (tombstone routes) |
| 500 | Server Error |
| 502 | Bad Gateway (upstream parse error) |
| 503 | Service Unavailable (upstream unreachable) |
| 504 | Gateway Timeout |

### Pagination
3 أنظمة مختلطة (يُوحّد في Phase مستقبلية):
- `page_size` (snake_case)
- `pageSize` (camelCase)
- `limit`/`offset`

### المصادقة
3 آليات:
1. **NextAuth** (web) — Google OAuth + Credentials (dev only)
2. **Bearer token** (mobile) — `Authorization: Bearer egx_...`
3. **Admin session** — `admin_session` cookie + `X-Admin-Token` header

---

## 4. خريطة الـ API (463 routes في 100 مجموعة)

### المسارات الأساسية

#### Auth (8 routes)
```
POST   /api/auth/login              — mobile login (returns Bearer token)
POST   /api/auth/register           — register
POST   /api/auth/google             — mobile Google login
POST   /api/auth/google-signin      — web Google signin
GET    /api/auth/me                 — current user
POST   /api/auth/logout             — logout
GET    /api/auth/[...nextauth]      — NextAuth handler
POST   /api/admin/auth              — admin login (gated by ALLOW_FORM_LOGIN)
```

#### Stocks (22 routes)
```
GET    /api/stocks                  — list
GET    /api/stocks/[ticker]/unified — SSOT decision data (Rule 73)
GET    /api/stocks/[ticker]/history — price history
GET    /api/stocks/[ticker]/news    — news for ticker
GET    /api/stocks/[ticker]/orderbook — orderbook
GET    /api/stocks/top-performers   — top gainers/losers
GET    /api/stocks/search           — search
```

#### Market (26 routes)
```
GET    /api/market/summary          — market summary
GET    /api/market/indices          — EGX30/70/100
GET    /api/market/status           — market status (open/closed)
GET    /api/market/top-movers       — top movers
GET    /api/market/sectors          — sector performance
GET    /api/market/regime           — bull/bear/range
```

#### Predictions (33 routes)
```
GET    /api/predictions/honest-tracking/list    — honest predictions
GET    /api/predictions/honest-tracking/stats   — stats
GET    /api/predictions/tracking/list           — tracking
GET    /api/predictions/dual-track/list         — dual track
GET    /api/predictions/expert-consensus        — expert consensus
```

#### Portfolio (17 routes)
```
GET    /api/portfolio/holdings       — user holdings
GET    /api/portfolio/equity-curve   — equity curve
GET    /api/portfolio/risk-summary   — risk summary
POST   /api/portfolio/bag-holder-rescue — rescue analysis
```

#### Watchlist (5 routes → unified to /api/watchlist)
```
GET    /api/watchlist                — canonical
GET    /api/watchlist-enhanced       → delegates to /api/watchlist?enrich=live
GET    /api/mobile/watchlist         → delegates to /api/watchlist?shape=mobile
GET    /api/portfolio/watchlists    → delegates to /api/watchlist?shape=portfolio
GET    /api/crypto/watchlist        → delegates to /api/watchlist?market=CRYPTO
```

#### News (5 routes → unified to /api/news)
```
GET    /api/news                     — canonical (Python proxy)
GET    /api/news/latest              → delegates to /api/news?shape=latest
GET    /api/news-feed                → delegates to /api/news?shape=feed
GET    /api/mobile/news              → delegates to /api/news?shape=mobile
GET    /api/egxpilot/news            → 308 redirect (was empty stub)
```

#### Subscription (23 routes)
```
GET    /api/subscription/plans       — pricing plans
GET    /api/subscription/status     — current subscription
POST   /api/subscription/checkout    — checkout
POST   /api/subscription/instapay/submit — upload receipt
POST   /api/paymob/create-payment   — Paymob checkout
POST   /api/redeem-promo             — promo code
```

#### Alerts (11 routes)
```
GET    /api/alerts                   — list
POST   /api/alerts/create           — create alert
POST   /api/alerts/quick-add         — quick add (auth required after P0)
GET    /api/sniper/scan              — sniper scan (polling 60s)
```

### 308 Redirect Routes (23 alias → /api/market-pulse)
بعد Phase Arch (2026-10-14)، هذه الـ 23 routes تُرجع 308 permanent redirect لـ `/api/market-pulse`:
```
/api/recommendations           /api/recommendations/backtest
/api/subscribe/[plan]           /api/stocks/advanced-analysis
/api/self-learning              /api/v2/feedback/run
/api/v2/live-analysis           /api/advanced-analysis/results
/api/data-status                /api/init-db
/api/admin/ab-test              /api/admin/ai-analyze
/api/system-control             /api/walk-forward-test
/api/seasonality-signals        /api/market/status
/api/market/sectors             /api/iterative-learning
/api/features                   /api/mobile/stocks/[ticker]/recommendation
/api/mobile/stocks/[ticker]/professional-analysis
/api/mobile/watchlist/intelligence
/api/mobile/zakat-calculator
```

### Admin Routes (89 routes في `/api/admin/*`)
```
GET    /api/admin/users             — user management
GET    /api/admin/db/[db]/[table]   — DB browser
POST   /api/admin/db-manager/repair — DB repair
POST   /api/admin/db-backup        — backup (no --force after P0)
GET    /api/admin/engines-status    — engine status
POST   /api/admin/promo-codes       — promo CRUD
GET    /api/admin/system-health     — system health
```

### Mobile Routes (`/api/mobile/*` — Flutter app)
```
GET    /api/mobile/dashboard         — mobile dashboard
GET    /api/mobile/portfolio         — mobile portfolio
GET    /api/mobile/recommendations   — mobile recommendations
GET    /api/mobile/zakat-calculator  → 308 redirect
GET    /api/mobile/news              → delegates to /api/news?shape=mobile
GET    /api/mobile/watchlist         → delegates to /api/watchlist?shape=mobile
```

### Proxy Routes (4)
```
/api/proxy/[...path]       — canonical Python proxy (auth required)
/api/python/[...path]      — Python proxy (special-case v4/stats)
/api/proxy-prod/[...path]  — production Python proxy
/api/telegram/[...path]    — Telegram bot proxy
```

---

## 5. عقود البيانات (Prisma Schemas)

### auth.db (18 models)
```prisma
model User {
  id                String   @id @default(cuid())
  email             String   @unique
  username          String?  @unique
  password_hash     String?
  subscription_tier String   @default("free") // free|premium|pro|vip_pass|developer|admin
  trial_ends_at     DateTime?
  is_active         Int      @default(1)
  last_login        DateTime?
  last_active_at    DateTime?
  // relations: Account, Session, ApiToken, UserSubscription, UserTelegramLink
}

model ApiToken {
  id          String  @id
  user_id     String
  token       String  @unique  // SHA-256 hashed (P1 fix)
  device_info String?
  expires_at  String
  // P1: token stored as hashToken(rawToken), not plaintext
}

model SubscriptionPlan {
  id            String  @id
  name          String
  price         Float
  trial_days    Int
  max_watchlist Int
  max_portfolio Int
  ai_analysis   Boolean
}

model MarketPricing {
  tier          String  // free|premium|pro|b2b_starter|b2b_pro|b2b_enterprise
  market        String  // EGX|TADAWUL|KSE|QSE
  price_egp     Float
  price_local   Float
  currency      String
  billing_cycle String  // monthly|yearly
}
```

### predictions.db (10 models)
```prisma
model Prediction {
  ticker           String
  signal           String  // BUY|SELL|HOLD|WAIT|ACCUMULATE|AVOID
  signal_type      String
  prediction_date  String
  entry_price      Float
  target_price     Float
  stop_loss        Float
  master_score     Float
  technical_score  Float
  fundamental_score Float
  outcome_date     String?
  exit_price       Float?
  actual_return    Float?
  hit_target       Int?
  hit_stop         Int?
  was_published    Boolean @default(false)
  persona          String?
  // 21 @@index on critical columns
}
```

### stocks.db (SQLite — not Prisma managed)
```sql
-- Core tables
stocks (id, ticker, name, name_ar, sector, market, current_price, ...)
stock_daily_prices (ticker, price_date, open, high, low, close, volume)
user_stock_watchlists (id, user_id, ticker, alert_price_above, alert_price_below, ...)
portfolio_assets (id, user_id, symbol, shares, purchase_price, ...)
price_alerts (id, ticker, threshold_price, user_id, is_active, is_triggered, ...)
market_news (id, title, content, source, published_at, tickers, ...)
user_notifications (id, user_id, type, message, is_read, created_at, ...)
```

---

## 6. رحلات المستخدم الأساسية

### رحلة 1: زائر → مشترك مدفوع
```
1. /#dashboard (نسخة محدودة) → LoginPromptModal
2. /#auth → Google OAuth → /#dashboard (Free + Trial)
3. TrialCountdownBanner (آخر 7 أيام)
4. /#subscription → PricingView → checkout → InstapayModal
5. /payment/success → polling /api/subscription/status
6. TrialExpiredModal يُغلق → premium/pro/vip_pass/developer
```

### رحلة 2: استكشاف سهم → توصية
```
1. /#dashboard → TopMovers → click سهم
2. /#stocks?ticker=XXXX → StockDetail
3. Tab "التوصية" → /api/stocks/[ticker]/unified (Rule 73 SSOT)
4. Rule 78: BUY → TradePlanCard / SELL → شريط أحمر
5. Add to watchlist → POST /api/watchlist
```

### رحلة 3: إنقاذ سهم خسران
```
1. /#portfolio → P&L سلبي → "إنقاذ السهم"
2. /rescue?ticker=XXXX&buy_price=XX&quantity=XX
3. BagHolderRescuePanel → 3 قرارات (CUT_LOSS/AVERAGE_DOWN/HOLD)
```

---

*آخر تحديث: 2026-10-14 by سوسو (CEO Agent)*
