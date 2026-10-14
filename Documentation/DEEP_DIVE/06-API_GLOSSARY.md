# 06-API_GLOSSARY.md

> **Deep Dive 1** — مرجع شامل لكل API route في المشروع.
> مصدر الحقيقة لكل endpoint: المسار + الطريقة + المدخلات + المخرجات + المصادقة + المصدر.

---

## 1. التصنيف العام (463 routes في 100 مجموعة)

| الفئة | المجموعات | Routes | المصادقة |
|---|---|---|---|
| Admin | 1 (89 sub) | 89 | admin-only |
| Predictions | 1 (29 sub) | 29 | mixed |
| Market | 1 (26 sub) | 26 | public |
| Stocks | 1 (22 sub) | 22 | mixed |
| Mobile | 1 (19 sub) | 19 | Bearer token |
| Maker-Radar | 1 (18 sub) | 18 | mixed |
| Finance | 1 (17 sub) | 17 | user |
| V2 (unified) | 1 (15 sub) | 15 | mixed |
| Portfolio | 1 (15 sub) | 15 | user |
| Crypto | 1 (14 sub) | 14 | mixed |
| Subscription | 1 (13 sub) | 13 | mixed |
| Data-Engine | 1 (9 sub) | 9 | admin |
| Auth | 1 (8 sub) | 8 | public |
| Other (40 groups) | 40 | ~177 | mixed |

---

## 2. Auth API (8 routes)

### POST /api/auth/login
- **الوظيفة**: تسجيل دخول الموبايل — يُرجع Bearer token
- **المصادقة**: لا (public)
- **Rate limit**: 5 req/min/IP
- **Body**: `{ username_or_email, password }`
- **Response**: `{ success, user, api_key }` (api_key = `egx_${user.id}_${uuid}_${timestamp}`)
- **التخزين**: token يُخزّن كـ SHA-256 hash (P1 fix)
- **الملف**: `src/app/api/auth/login/route.ts`

### POST /api/auth/register
- **الوظيفة**: تسجيل مستخدم جديد
- **Rate limit**: 5 req/min/IP
- **Body**: `{ email, username, password (min 8 chars) }`
- **Response**: `{ success, user, api_key }`
- **Validation**: bcrypt 12 salt rounds
- **الملف**: `src/app/api/auth/register/route.ts`

### POST /api/auth/google
- **الوظيفة**: Google login للموبايل
- **Body**: `{ google_id_token }`
- **Response**: `{ success, user, api_key }`
- **الملف**: `src/app/api/auth/google/route.ts`

### POST /api/auth/google-signin
- **الوظيفة**: Google signin للويب
- **Fail-closed**: لو VALID_CLIENT_IDS فاضي → return 500 (P0 CRIT-5 fix)
- **Body**: `{ id_token }`
- **الملف**: `src/app/api/auth/google-signin/route.ts`

### GET /api/auth/me
- **الوظيفة**: بيانات المستخدم الحالي
- **المصادقة**: Bearer token أو NextAuth session
- **Response**: `{ id, email, username, subscription_tier, is_active }`
- **الملف**: `src/app/api/auth/me/route.ts`

### POST /api/auth/logout
- **الوظيفة**: تسجيل خروج
- **المصادقة**: Bearer token
- **Action**: حذف الـ token من api_tokens table
- **الملف**: `src/app/api/auth/logout/route.ts`

### GET /api/auth/[...nextauth]
- **الوظيفة**: NextAuth handler (Google OAuth + Credentials)
- **Providers**: GoogleProvider (إلزامي) + CredentialsProvider (dev only)
- **Cookies**: httpOnly + sameSite:lax + secure=isHttps
- **الملف**: `src/app/api/auth/[...nextauth]/route.ts`

### POST /api/admin/auth
- **الوظيفة**: admin login منفصل
- **Gated**: `ALLOW_FORM_LOGIN === 'true'` (dev only)
- **Response**: admin_session cookie + admin token
- **الملف**: `src/app/api/admin/auth/route.ts`

---

## 3. Stocks API (22 routes)

### GET /api/stocks
- **الوظيفة**: قائمة كل أسهم السوق
- **Query**: `?market=EGX&sector=...&limit=50&offset=0`
- **المصدر**: `stocks.db.stocks` table
- **الملف**: `src/app/api/stocks/route.ts`

### GET /api/stocks/[ticker]/unified ⭐ (Rule 73 SSOT)
- **الوظيفة**: المصدر الوحيد لبيانات القرار
- **المصادقة**: user
- **Response**: `{ ticker, signal, master_score, entry, target, stop, R:R, recommendation, reasons, risks, confidence, regime, regime_confidence, analysis_text }`
- **Rule 78**: TradePlanCard يظهر فقط لـ BUY/STRONG_BUY/ACCUMULATE
- **الملف**: `src/app/api/stocks/[ticker]/unified/route.ts`

### GET /api/stocks/[ticker]/history
- **Response**: `[{ date, open, high, low, close, volume }]`
- **المصدر**: Python proxy → `data_engine.db.egksco_price_history`

### GET /api/stocks/[ticker]/news
- **Response**: news filtered by ticker

### GET /api/stocks/[ticker]/orderbook
- **Response**: `{ bids: [...], asks: [...], spread }`
- **المصدر**: `stocks.db` direct

### GET /api/stocks/top-performers
- **Query**: `?limit=10&type=gainers|losers`
- **Response**: top gainers/losers

### GET /api/stocks/search
- **Query**: `?q=COMI`
- **Response**: `[{ ticker, name, name_ar, sector }]`

---

## 4. Market API (26 routes)

### GET /api/market/summary
- **Response**: `{ indices: { EGX30, EGX70, EGX100 }, advancers, decliners, volume }`

### GET /api/market/indices
- **Response**: `[{ name, value, change, change_pct }]`

### GET /api/market/status
- **Response**: `{ is_open, session, next_open, next_close }`

### GET /api/market/top-movers
- **Response**: `{ gainers: [...], losers: [...] }`

### GET /api/market/sectors
- **Response**: `[{ sector, change_pct, leaders: [...] }]`

### GET /api/market/regime
- **Response**: `{ regime: 'bull|bear|range', confidence, duration }`

### GET /api/market/morning-bell
- **Response**: morning report data

### GET /api/market/liquidity-flow
- **Response**: `{ net_flow, buy_pct, sell_pct, phase }`

### GET /api/market/intraday-pressure
- **Response**: intraday buying/selling pressure

---

## 5. Predictions API (29 routes)

### GET /api/predictions/honest-tracking/list ⭐
- **Response**: `[{ id, ticker, signal, entry, target, stop, confidence, date, status }]`
- **Rule 50**: كل أرقام حقيقية من DB

### GET /api/predictions/honest-tracking/stats
- **Response**: `{ total, win_rate, hit_target, hit_stop, pending, avg_return }`
- **Rule 20**: stats من Python (لا client-side calculation)

### GET /api/predictions/honest-tracking/live-tracking
- **Response**: live tracking data

### POST /api/predictions/honest-tracking/verify-pending
- **Action**: verify pending predictions against actual prices

### GET /api/predictions/honest-tracking/missed-opportunities
- **Response**: missed opportunities

### GET /api/predictions/honest-tracking/learn-from-errors
- **Response**: lessons from failed predictions

### GET /api/predictions/dual-track/list
- **Response**: dual-track predictions (gambler vs investor — historical)

### GET /api/predictions/tracking/list
- **Response**: verified predictions

### GET /api/predictions/expert-consensus
- **Response**: expert recommendations consensus

### GET /api/predictions/eid
- **Response**: Eid predictions

### GET /api/predictions/performance
- **Response**: performance dashboard data

---

## 6. Portfolio API (15 routes)

### GET /api/portfolio/holdings
- **المصادقة**: `requireAuthAsync()` (P0 fix)
- **Response**: `[{ ticker, shares, avg_cost, current_price, market_value, P&L, weight }]`
- **Rule 50**: كل أرقام حقيقية من `portfolio_assets` table

### GET /api/portfolio/equity-curve
- **Response**: `[{ date, total_value, total_cost, profit_loss }]`

### GET /api/portfolio/risk-summary
- **Response**: `{ total_exposure, diversification_score, risk_level }`

### GET /api/portfolio/master
- **Response**: master portfolio (aggregated)

### POST /api/portfolio/bag-holder-rescue
- **Body**: `{ ticker, buy_price, quantity }`
- **Response**: `{ diagnosis, institutional_analysis, decisions: [CUT_LOSS, AVERAGE_DOWN, HOLD] }`
- **Rule 78**: لا توصية شراء على سهم خسران

### GET /api/portfolio/accounts
- **المصادقة**: `requireAuthAsync()` (P0 CRIT-3 fix — no more hardcoded userId)
- **Response**: `{ portfolios: [...], master_portfolio_id }`

---

## 7. Watchlist API (5 routes → unified)

### GET /api/watchlist ⭐ (canonical)
- **المصادقة**: `requireAuthAsync()`
- **Query**: `?enrich=live|full&shape=mobile|portfolio&market=CRYPTO`
- **Response**: `[{ id, ticker, name, price, change, signal, target, stop, alert_price }]`
- **المصدر**: `stocks.db.user_stock_watchlists`

### GET /api/watchlist-enhanced → delegates to /api/watchlist?enrich=live
### GET /api/mobile/watchlist → delegates to /api/watchlist?shape=mobile
### GET /api/portfolio/watchlists → delegates to /api/watchlist?shape=portfolio
### GET /api/crypto/watchlist → delegates to /api/watchlist?market=CRYPTO

---

## 8. News API (5 routes → unified)

### GET /api/news ⭐ (canonical)
- **المصدر**: Python proxy (Rule 4 — no direct SQLite access)
- **Query**: `?market=EGX&tickers=COMI,EGBE&catalyst=true&limit=20&shape=latest|feed|mobile`
- **Response**: `[{ id, title, content, source, published_at, tickers, sentiment, importance }]`
- **Rule 27**: لو Python unreachable → honest empty response

### GET /api/news/latest → delegates to /api/news?shape=latest
### GET /api/news-feed → delegates to /api/news?shape=feed
### GET /api/mobile/news → delegates to /api/news?shape=mobile
### GET /api/egxpilot/news → 308 redirect (was empty stub)

---

## 9. Subscription API (13 routes)

### GET /api/subscription/plans
- **Response**: `[{ id, name, price, price_yearly, trial_days, features, max_watchlist }]`

### GET /api/subscription/status
- **المصادقة**: user
- **Response**: `{ isExpired, daysLeft, trialEndsAt, subscription_tier }`

### POST /api/subscription/checkout
- **Body**: `{ plan_id, market, billing_cycle }`
- **Response**: checkout URL or InstapayModal data

### POST /api/subscription/instapay/submit
- **Body**: `{ receipt_image, reference }`
- **Response**: `{ status: 'pending'|'verified'|'error' }`

### POST /api/redeem-promo
- **Body**: `{ code }`
- **Response**: `{ success, premium_days }`

### POST /api/paymob/create-payment
- **Body**: `{ amount, currency }`
- **Response**: Paymob payment key

---

## 10. Alerts API (5 routes)

### GET /api/alerts
- **المصادقة**: user
- **Response**: `[{ id, ticker, condition, target_price, status }]`

### POST /api/alerts/create
- **Body**: `{ ticker, condition, target_price }`
- **Response**: `{ success, alert }`

### POST /api/alerts/quick-add
- **المصادقة**: `requireAuthAsync()` (P0 CRIT-7 fix)
- **Body**: `{ ticker, current_price, drop_pct }`
- **Response**: `{ success, alert }`
- **Note**: user_id from session, NOT body

### GET /api/sniper/scan
- **Response**: sniper opportunities (polling 60s)

---

## 11. 308 Redirect Routes (23 alias → /api/market-pulse)

بعد Phase Arch (2026-10-14)، هذه الـ 23 routes تُرجع 308 permanent redirect:

```
/api/recommendations              /api/recommendations/backtest
/api/subscribe/[plan]             /api/stocks/advanced-analysis
/api/self-learning                /api/v2/feedback/run
/api/v2/live-analysis             /api/advanced-analysis/results
/api/data-status                  /api/init-db
/api/admin/ab-test                /api/admin/ai-analyze
/api/system-control               /api/walk-forward-test
/api/seasonality-signals          /api/market/status
/api/market/sectors               /api/iterative-learning
/api/features                     /api/mobile/stocks/[ticker]/recommendation
/api/mobile/stocks/[ticker]/professional-analysis
/api/mobile/watchlist/intelligence
/api/mobile/zakat-calculator
```

**طريقة العمل**: 308 يحافظ على HTTP method + query params تُمرّر كما هي.

---

## 12. Admin API (89 routes في `/api/admin/*`)

### User Management
```
GET    /api/admin/users            — list users
GET    /api/admin/users/[id]       — get user
POST   /api/admin/users/[id]/promo — grant promo
POST   /api/admin/users/cleanup-expired — cleanup expired
```

### Database Management
```
GET    /api/admin/db                      — DB browser
GET    /api/admin/db/[db]/[table]         — table browser
POST   /api/admin/db-manager/repair       — DB repair (6 steps)
POST   /api/admin/db-manager/truncate-table
POST   /api/admin/db-backup              — backup (no --force after P0)
POST   /api/admin/db-backup/restore     — restore
POST   /api/admin/db-backup/export-all  — export all
POST   /api/admin/db-backup/import-all  — import all
GET    /api/admin/db-backup/historical-backups — browse backups
```

### Engine Control
```
GET    /api/admin/engines-status         — engine status
POST   /api/admin/engines/start-all     — start all
POST   /api/admin/engines/stop-all      — stop all
POST   /api/admin/engines/control       — control individual
GET    /api/admin/system-topology        — system topology
GET    /api/admin/system-resources/history — resource history
GET    /api/admin/system-resources/anomalies — anomaly detection
```

### Content Management
```
GET/POST /api/admin/news                 — news CRUD
GET/POST /api/admin/educational-cards     — educational cards CRUD
GET/POST /api/admin/promo-codes          — promo codes CRUD
```

### Analytics & AI
```
GET    /api/admin/analytics              — analytics dashboard
GET    /api/admin/stats                  — stats
POST   /api/admin/ai-analyze             — AI analysis
POST   /api/admin/ai-predictions/generate — generate predictions
POST   /api/admin/ai-gatekeeper          — AI gatekeeper
GET    /api/admin/ab-test                — A/B tests
```

### Git Operations
```
GET    /api/admin/git-files              — git file browser
POST   /api/admin/git-files              — git add/remove (no --force)
GET    /api/admin/export-vps             — export VPS data
```

---

## 13. Mobile API (19 routes في `/api/mobile/*`)

```
GET    /api/mobile/dashboard             — mobile dashboard
GET    /api/mobile/portfolio              — mobile portfolio
GET    /api/mobile/portfolio/analyze      — portfolio analysis
GET    /api/mobile/portfolio/intelligence — portfolio intelligence
GET    /api/mobile/recommendations        — recommendations
GET    /api/mobile/stocks/[ticker]        — stock detail
GET    /api/mobile/stocks/[ticker]/professional-analysis
GET    /api/mobile/stocks/[ticker]/recommendation
GET    /api/mobile/watchlist              → delegates to /api/watchlist?shape=mobile
GET    /api/mobile/watchlist/intelligence
GET    /api/mobile/news                   → delegates to /api/news?shape=mobile
GET    /api/mobile/zakat-calculator       → 308 redirect
GET    /api/mobile/alerts/settings        — alert settings
GET    /api/mobile/notifications           — notifications
GET    /api/mobile/predictions            — predictions
GET    /api/mobile/gold/[route]            — gold prices
GET    /api/mobile/crypto/[route]          — crypto data
GET    /api/mobile/version                 — app version
```

---

## 14. Proxy API (4 routes)

### /api/proxy/[...path]
- **الوظيفة**: Canonical Python proxy (auth required)
- **الملف**: `src/app/api/proxy/[...path]/route.ts` (199 LOC)

### /api/python/[...path]
- **الوظيفة**: Python proxy (special-case v4/stats)
- **الملف**: `src/app/api/python/[...path]/route.ts` (70 LOC)

### /api/proxy-prod/[...path]
- **الوظيفة**: Production Python proxy
- **الملف**: `src/app/api/proxy-prod/[...path]/route.ts` (259 LOC)

### /api/telegram/[...path]
- **الوظيفة**: Telegram bot proxy
- **الملف**: `src/app/api/telegram/[...path]/route.ts` (124 LOC)

---

## 15. Unified Response Envelope

```typescript
// src/lib/api-response.ts

// نجاح
apiOk(data) → { success: true, data: T, timestamp: string }

// خطأ
apiErr(message, { code, status, details }) → { success: false, error: { code, message, details }, timestamp: string }

// Shortcuts
apiBadRequest(message)     → 400
apiUnauthorized(message)   → 401
apiForbidden(message)      → 403
apiNotFound(message)       → 404
```

---

## 16. Health & Monitoring API

### GET /api/health
- **Response**: `{ status, python, dbs: { auth, predictions, stocks, data_engine }, disk, uptime }`
- **Cache**: 60s TTL
- **Status codes**: 200 (healthy) / 200 (degraded) / 503 (down)

### GET /api/keepalive
- **Response**: `{ status, timestamp, uptime }`

### GET /api/metrics
- **Response**: Prometheus text format
- **Metrics**: `glm_process_uptime_seconds`, `glm_process_memory_rss_bytes`, `glm_health_status`, `glm_python_backend_reachable`

---

*آخر تحديث: 2026-10-14 by سوسو (CEO Agent)*
