# EGX Investment Platform — Project Details

> **Version**: 2.1.0 | **Engine Version**: V2.1.0  
> **Stack**: Next.js 16 + TypeScript + Tailwind CSS 4 + SQLite  
> **Language**: Arabic (RTL) — بورصة مصر  
> **Purpose**: Full-stack Egyptian Stock Exchange (EGX) investment analysis and recommendation platform with a self-learning AI engine

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Core Features](#4-core-features)
5. [V2 Recommendation Engine](#5-v2-recommendation-engine)
6. [Self-Learning System](#6-self-learning-system)
7. [API Endpoints](#7-api-endpoints)
8. [Database Schema](#8-database-schema)
9. [Deployment](#9-deployment)
10. [Mini Services](#10-mini-services--websocket)
11. [Configuration](#11-configuration--environment-variables)
12. [Scripts & Tooling](#12-scripts--tooling)

---

## 1. Project Overview

The EGX Investment Platform is a production-grade, full-stack web application for analyzing and investing in the Egyptian Stock Exchange (Borsa). It provides:

- **Real-time market data** for all EGX-listed stocks (~295 stocks)
- **AI-powered recommendations** via a self-learning V2.1.0 calculation engine (no external AI APIs — pure mathematical analysis)
- **Portfolio management** with diversification analysis and position sizing
- **Deep analysis reports** with technical indicators, fair value estimation, and risk assessment
- **Admin panel** with feedback dashboard and weight tuning controls
- **WebSocket notifications** for real-time price alerts
- **RTL Arabic interface** designed for Egyptian investors

### Key Metrics

| Metric | Value |
|--------|-------|
| Direction Accuracy | 74.1% |
| Total Predictions Validated | 4,277 |
| Stocks Analyzed | ~295 |
| Analysis Version | V2.1.0 |

---

## 2. Tech Stack

### Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 16.1.1 | Full-stack React framework |
| React | 19.0.0 | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 4.x | Utility-first CSS |
| shadcn/ui | — | 45+ UI components (Radix primitives) |
| Zustand | 5.0.6 | Global state management |
| TanStack React Query | 5.82.0 | Server state & caching |
| TanStack React Table | 8.21.3 | Data tables |
| Socket.IO Client | 4.8.3 | Real-time WebSocket |
| Recharts | 2.15.4 | Charts & visualizations |
| Framer Motion | 12.23.2 | Animations |
| html2pdf.js | 0.14.0 | PDF export |
| next-themes | 0.4.6 | Dark/light theme |
| next-intl | 4.3.4 | Internationalization |
| Sonner | 2.0.6 | Toast notifications |

### Backend

| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js API Routes | 16.x | Serverless API endpoints |
| Prisma ORM | 6.11.1 | User/Auth database (SQLite) |
| better-sqlite3 | 12.9.0 | Direct SQLite access for EGX data |
| NextAuth.js | 4.24.11 | Authentication (JWT) |
| bcryptjs | 3.0.3 | Password hashing |
| Zod | 4.0.2 | Schema validation |
| React Hook Form | 7.60.0 | Form handling |

### Database

| Database | Purpose |
|----------|---------|
| **SQLite (Prisma)** `db/custom.db` | Users, sessions, accounts, auth |
| **SQLite (better-sqlite3)** `db/egx_investment.db` | Stocks, price history, gold, currency, predictions, engine config |

---

## 3. Project Structure

```
src/
├── app/
│   ├── layout.tsx                    # Root layout (RTL, Arabic, Providers)
│   ├── page.tsx                      # SPA shell — AppShell with view routing
│   ├── globals.css                   # Global styles
│   └── api/
│       ├── route.ts                  # API root/health check
│       ├── auth/
│       │   ├── register/route.ts     # POST: user registration
│       │   └── [...nextauth]/route.ts # NextAuth handler (Google + Credentials)
│       ├── admin/
│       │   ├── auth/route.ts         # Admin authentication
│       │   ├── gold/route.ts         # POST: update gold prices
│       │   ├── currency/route.ts     # POST: update currency rates
│       │   └── recommendations/route.ts # GET/POST: manual recommendation management
│       ├── export/route.ts           # GET: export data (JSON/CSV)
│       ├── import/route.ts           # POST: import data
│       ├── proxy/[...path]/route.ts  # Reverse proxy
│       ├── market/
│       │   ├── overview/route.ts     # GET: market summary
│       │   ├── indices/route.ts      # GET: EGX indices data
│       │   ├── status/route.ts       # GET: market open/closed
│       │   ├── live-data/route.ts    # GET: real-time scraped data
│       │   ├── sync-live/route.ts    # POST: sync live prices
│       │   ├── sync-historical/route.ts # POST: sync historical data
│       │   ├── bulk-update/route.ts  # POST: bulk stock update
│       │   ├── recommendations/
│       │   │   └── ai-insights/route.ts # GET: AI recommendation insights
│       │   ├── gold/
│       │   │   ├── route.ts          # GET: gold/silver prices
│       │   │   ├── history/route.ts  # GET: gold price history
│       │   │   └── sync/route.ts     # POST: sync gold prices
│       │   └── currency/route.ts     # GET: currency exchange rates
│       ├── stocks/
│       │   ├── route.ts              # GET: list all stocks (paginated, searchable)
│       │   └── [ticker]/
│       │       ├── route.ts          # GET: single stock details
│       │       ├── history/route.ts  # GET: price history
│       │       ├── recommendation/route.ts # GET: stock recommendation
│       │       ├── professional-analysis/route.ts # GET: professional analysis
│       │       └── news/route.ts     # GET: stock news
│       └── v2/
│           ├── recommend/route.ts    # POST: V2 recommendation engine
│           ├── admin/
│           │   └── config/route.ts   # GET/POST: engine weight config
│           ├── stock/[symbol]/
│           │   └── analysis/route.ts # GET: V2 single stock analysis
│           └── feedback/
│               ├── run/route.ts      # POST: run feedback loop
│               ├── backtest/route.ts # POST: historical backtest
│               ├── status/route.ts   # GET: learning system status
│               └── predictions/route.ts # GET: prediction logs
├── components/
│   ├── Providers.tsx                 # SessionProvider + ThemeProvider
│   ├── layout/
│   │   ├── Header.tsx               # App header
│   │   ├── Sidebar.tsx              # Desktop sidebar navigation
│   │   └── MobileNav.tsx            # Mobile bottom navigation
│   ├── dashboard/
│   │   ├── DashboardView.tsx        # Main dashboard container
│   │   ├── RealtimeTicker.tsx       # Live scrolling price ticker
│   │   ├── MarketSummary.tsx        # Market overview cards
│   │   ├── MarketSentiment.tsx      # Market sentiment indicator
│   │   ├── IndexCards.tsx           # EGX30/70/100 index cards
│   │   ├── TopMovers.tsx            # Top gainers/losers/most active
│   │   ├── GoldSilverChart.tsx      # Gold/silver price chart
│   │   ├── GoldMarket.tsx           # Gold market widget
│   │   └── CurrencyExchange.tsx     # Currency rates widget
│   ├── stocks/
│   │   ├── StocksView.tsx           # Stock list + search
│   │   ├── StockList.tsx            # Stock table/grid
│   │   ├── StockDetail.tsx          # Single stock detail page
│   │   ├── StockChart.tsx           # Price chart (Recharts)
│   │   ├── DeepAnalysis.tsx         # Deep analysis panel
│   │   ├── CalculationBreakdown.tsx # V2 calculation breakdown
│   │   └── StockNews.tsx            # Stock news feed
│   ├── recommendations/
│   │   ├── RecommendationsView.tsx  # Recommendations dashboard
│   │   └── AiRecommendations.tsx    # AI insight cards
│   ├── portfolio/
│   │   └── PortfolioView.tsx        # Portfolio management
│   ├── watchlist/
│   │   └── WatchlistView.tsx        # Watchlist management
│   ├── reports/
│   │   ├── ReportsView.tsx          # Reports hub
│   │   ├── DailyMarketReport.tsx    # Daily market report
│   │   ├── StockAnalysisReport.tsx  # Stock analysis report (PDF export)
│   │   └── DataManager.tsx          # Import/export data
│   ├── admin/
│   │   ├── AdminPanel.tsx           # Admin panel
│   │   └── FeedbackDashboard.tsx    # Feedback loop dashboard
│   ├── learning/
│   │   └── LearningView.tsx         # Investment learning center
│   ├── auth/
│   │   └── AuthView.tsx             # Login/register view
│   ├── settings/
│   │   └── SettingsView.tsx         # User settings
│   ├── notifications/
│   │   ├── NotificationCenter.tsx   # Notification center
│   │   └── NotificationBell.tsx     # Notification bell icon
│   └── ui/                          # 45+ shadcn/ui components
│       ├── button.tsx, card.tsx, dialog.tsx, table.tsx,
│       ├── tabs.tsx, select.tsx, input.tsx, badge.tsx,
│       ├── chart.tsx, skeleton.tsx, tooltip.tsx, ...
│       └── sonner.tsx, toaster.tsx  # Toast notifications
├── lib/
│   ├── store.ts                     # Zustand global store (app state)
│   ├── notification-store.ts        # Notification state store
│   ├── api-client.ts                # API client (fetch wrapper)
│   ├── db.ts                        # Prisma client instance
│   ├── egx-db.ts                    # better-sqlite3 EGX database layer
│   ├── analysis-engine.ts           # V1 analysis engine
│   ├── data-sync.ts                 # Data synchronization
│   ├── ws-client.ts                 # Socket.IO WebSocket client
│   ├── utils.ts                     # Utility functions (cn, etc.)
│   ├── mock-data.ts                 # Mock data generators (fallback)
│   └── v2/                          # V2 Recommendation Engine
│       ├── types.ts                 # Engine types (server-side)
│       ├── recommendation-engine.ts # Main orchestrator (v2.1.0)
│       ├── safety-filter.ts         # Layer 1: Safety filter
│       ├── quality-engine.ts        # Layer 2: Quality scoring
│       ├── momentum-engine.ts       # Layer 3: Momentum analysis
│       ├── fair-value.ts            # Fair value calculator
│       ├── portfolio-engine.ts      # Layer 4: Position sizing
│       ├── config-service.ts        # Weight config loader
│       ├── prediction-logger.ts     # Prediction logging
│       └── feedback-loop.ts         # Self-learning feedback loop
├── hooks/
│   ├── use-toast.ts                 # Toast hook
│   └── use-mobile.ts               # Mobile detection hook
└── types/
    ├── index.ts                     # Frontend types
    └── v2.ts                        # V2 client-side types (mirrors lib/v2/types.ts)
```

---

## 4. Core Features

### 4.1 Dashboard

The main dashboard provides a comprehensive market overview:

- **Real-time ticker** — scrolling price ticker with live updates via WebSocket
- **Market summary** — total stocks, gainers, losers, unchanged
- **EGX indices** — EGX30, EGX70, EGX100 with values and changes
- **Top movers** — top gainers, losers, and most active stocks
- **Gold & silver** — karat 24/21/18 prices (EGP/gram) and silver prices
- **Currency exchange** — USD, EUR, GBP, SAR, AED, KWD rates
- **Market sentiment** — bullish/bearish indicator
- **Market status** — open/closed with trading hours

### 4.2 Stock Search & Analysis

- Full-text search across ticker, name (English), and name (Arabic)
- Filter by sector, EGX index membership (EGX30/70/100)
- Paginated results (up to 500 per page)
- Individual stock detail page with:
  - Price chart with OHLCV data (up to 365 days)
  - Technical indicators (RSI, MACD, Bollinger Bands, Stochastic RSI, ATR)
  - Trend analysis (direction, strength, support/resistance levels)
  - Risk metrics (Sharpe ratio, max drawdown, beta, volatility)
  - Pattern detection (Golden Cross, Death Cross, etc.)
  - ATR-based stop loss levels

### 4.3 AI Recommendations (V2.1.0 Engine)

See [Section 5](#5-v2-recommendation-engine) for detailed engine documentation.

### 4.4 Portfolio Management

- Portfolio creation and holdings tracking
- Diversification analysis by sector and market cap
- Position sizing with Kelly criterion
- Risk assessment per position

### 4.5 Watchlist

- Add/remove stocks to watchlist
- Quick price monitoring
- Real-time price alerts via WebSocket

### 4.6 Reports

- Daily market report generation
- Individual stock analysis reports with professional formatting
- PDF export via html2pdf.js
- Data import/export (JSON/CSV)

### 4.7 Learning Center

- Investment education content
- Market concepts and terminology
- Strategy guides for Egyptian market

### 4.8 Admin Panel

- Manual recommendation management (override AI decisions)
- Gold and silver price updates
- Currency rate updates
- Admin authentication system
- Feedback dashboard with accuracy metrics

### 4.9 Authentication

- **Credentials auth** — email/username + password (bcryptjs hashing)
- **Google OAuth** — Google account login with auto-provisioning
- JWT session strategy (30-day expiry)
- User profiles with subscription tiers and risk preferences
- Session sync between NextAuth and Zustand store

---

## 5. V2 Recommendation Engine

### 5.1 Architecture

The V2.1.0 engine is a **4-layer pipeline** that processes each stock through:

```
Layer 1: Safety Filter → Layer 2: Quality Engine → Layer 3: Momentum → Layer 4: Portfolio
                                                                       ↓
                                                              Fair Value Calculator
                                                                       ↓
                                                              Composite Score
                                                                       ↓
                                                              Recommendation
```

### 5.2 Layer 1 — Safety Filter

Hard-rejects stocks that fail fundamental safety checks before any further analysis.

**Hard violations** (immediate reject → "Strong Avoid"):
| Rule | Threshold |
|------|-----------|
| Negative EPS (3+ years) | `eps <= 0` |
| Extremely high P/E | `pe_ratio > 80` |
| Extreme debt | `debt_to_equity > 3.0` |
| Negative book value | `pb_ratio <= 0` |
| Near-zero volume | `volume < 1,000` |

**Soft violations** (penalty, not rejection):
| Rule | Threshold |
|------|-----------|
| High P/E | `pe_ratio > 50` |
| Low liquidity | `volume < 100,000` |
| Elevated debt | `debt_to_equity > 1.5` |

**Red flags** (warning):
- Negative earnings growth
- Declining revenue
- High dividend payout ratio
- Suspicious valuation

### 5.3 Layer 2 — Quality Engine

Scores stocks across 5 dimensions (0-100 each):

| Dimension | Weight | Components |
|-----------|--------|------------|
| Profitability | 25% | ROE vs sector, Net margin vs sector, EPS growth YoY |
| Growth | 20% | Revenue CAGR, Earnings CAGR |
| Financial Safety | 20% | Current ratio, Interest coverage, Debt/Equity, FCF positive |
| Efficiency | 15% | Asset turnover |
| Valuation | 20% | P/E vs sector, Price/Book, Dividend yield |

All sub-scores are compared against **sector averages** loaded dynamically from the database.

### 5.4 Layer 3 — Momentum Engine

Technical analysis layer:

| Component | Details |
|-----------|---------|
| **Trend Score** | Weekly MACD bullish, Daily above 50/200 EMA, RSI sweet spot (40-65), Volume above average |
| **Support/Resistance** | Calculated from price history; positions classified as accumulation/normal/distribution |
| **Signal Confluence** | Checks if quality, technical, and volume signals are all aligned |

**Real ATR Calculation** (Wilder's 14-period smoothing):
```typescript
// True Range = max(High-Low, |High-PrevClose|, |Low-PrevClose|)
// ATR = EMA of True Range over 14 periods
// Used for: stop-loss placement, risk assessment, volatility rating
```

### 5.5 Fair Value Calculator

Three independent valuation methods, averaged:

#### Method 1: DCF Light (Primary)
```
FairValue = EPS × Sector_Target_PE × (1 + Growth_Rate)^3 × Margin_of_Safety
```

- `Sector_Target_PE = Sector_Avg_PE × Sector_PE_Premium (1.1)`
- `Growth_Rate` = CAGR estimated from price history (capped at 25%)
- `Margin_of_Safety` = 0.85 (configurable)
- Fair value capped at **1.5× current price**

#### Method 2: Graham Number
```
Graham = √(22.5 × EPS × BVPS)
```

#### Method 3: P/E Based
```
PE_Based = Sector_Avg_PE × EPS
```

#### Target Price Cap
```
Target = min(FairValue × 0.85, CurrentPrice × 1.20)
```

### 5.6 Composite Score & Recommendation

```typescript
Composite = Quality × 0.60 + Technical × 0.40
          - (Violation_Count × 15)
          - (RedFlag_Count × 5)
          + Upside_Bonus (up to +6)
          + Confluence_Bonus (+5 if all aligned)
```

| Recommendation | Threshold |
|---------------|-----------|
| Strong Buy | Composite ≥ 65 |
| Buy | Composite ≥ 52 |
| Hold | Composite ≥ 42 |
| Avoid | Composite ≥ 32 |
| Strong Avoid | Composite < 32 |

### 5.7 Confidence Score (Weighted Breakdown)

| Sub-score | Weight | Description |
|-----------|--------|-------------|
| Quality Score | 30% | Fundamental analysis reliability |
| Technical Score | 25% | Timing and pattern reliability |
| Valuation Score | 20% | Fair value data quality |
| Momentum Score | 15% | Trend strength + volume confirmation |
| Data Reliability | 10% | Source data completeness |

**Range**: 25-95, calculated as weighted average of sub-scores.

### 5.8 Position Sizing

- **Kelly Criterion**: `Kelly = (WinProb × WinAmount - LoseProb × LoseAmount) / WinAmount`
- **Adjusted Kelly**: Half-Kelly for safety
- **Max risk per stock**: 10% of portfolio (configurable)
- **Entry strategy**: Split between immediate buy and dip-buy with cash reserve
- **Exit strategy**: Target price + ATR-based stop loss + time horizon

### 5.9 Risk Assessment

| Risk Level | Criteria |
|-----------|----------|
| Low | Max drawdown < 6%, High liquidity |
| Medium | Max drawdown 6-12% |
| High | Max drawdown 12-20%, or Medium drawdown + Medium liquidity |
| Very High | Max drawdown > 20%, or Low liquidity |

Key risk factors: distribution zone, red flags, high debt, bear market, low liquidity, small cap, unreliable data.

### 5.10 Market Regime Detection

| Regime | Multiplier | Conditions |
|--------|-----------|------------|
| Bull | 1.3 | Index trending up, broad participation |
| Neutral | 1.0 | Sideways market |
| Bear | 0.7 | Index trending down, risk-off |

---

## 6. Self-Learning System

### 6.1 Overview

The self-learning system continuously improves recommendation accuracy by:

1. **Logging predictions** every time the engine runs
2. **Validating predictions** against actual price movements (5d, 10d, 20d horizons)
3. **Computing accuracy metrics** by recommendation type, market regime, and sector
4. **Auto-tuning weights** based on what works and what doesn't
5. **Running historical backtests** to rapidly build validation data

### 6.2 Prediction Logger

Each prediction records:
- Ticker, sector, prediction date, entry price
- Direction (up/down/neutral), target price, stop loss
- Composite score, quality score, momentum score
- Market regime, confidence level
- Predicted prices at 5d, 10d, 20d horizons

### 6.3 Feedback Loop Pipeline

```
Step 1: Validate unvalidated predictions (compare against actual prices)
Step 2: Calculate accuracy metrics (by horizon, recommendation, regime)
Step 3: Run historical backtest (optional, simulates past predictions)
Step 4: Compute weight adjustments (if accuracy < target)
Step 5: Apply weight adjustments (with ±20% circuit breaker)
Step 6: Save accuracy summary to database
```

### 6.4 Weight Auto-Tuning

The system analyzes:
- **Quality score correlation**: If higher quality scores correlate with correct predictions → boost quality weights
- **Momentum score correlation**: Same analysis for momentum
- **Regime-specific accuracy**: If bull/bear regime accuracy is low → adjust regime multiplier
- **Recommendation accuracy**: If "Strong Buy" accuracy < 50% → raise threshold; if "Buy" > 65% → lower threshold

**Circuit breaker**: All adjustments capped at ±15% of current value, within configured min/max bounds.

### 6.5 Backtesting

- Generates synthetic predictions at historical snapshots (every 10 trading days)
- Validates against known future prices at 5d, 10d, 20d horizons
- Tests up to 150 stocks with 80+ days of history
- Tracks sector-level accuracy, score correlations, top/worst performers

### 6.6 Current Performance

| Horizon | Accuracy | Predictions |
|---------|----------|-------------|
| 5-day | 74.3% | 1,578 |
| 10-day | ~73.9% | ~1,500 |
| 20-day | ~74.1% | ~1,400 |
| **Overall** | **74.1%** | **4,277** |

---

## 7. API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new account |
| POST | `/api/auth/[...nextauth]/signin` | Login (credentials) |
| GET | `/api/auth/[...nextauth]/signin/google` | Google OAuth redirect |
| GET | `/api/auth/[...nextauth]/session` | Get current session |
| POST | `/api/auth/[...nextauth]/signout` | Logout |

### Market Data

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/market/overview` | Market summary |
| GET | `/api/market/indices` | EGX indices |
| GET | `/api/market/status` | Market open/closed |
| GET | `/api/market/live-data` | Real-time scraped data |
| POST | `/api/market/sync-live` | Sync live prices to DB |
| POST | `/api/market/sync-historical` | Sync historical data |
| POST | `/api/market/bulk-update` | Bulk stock update |
| GET | `/api/market/gold` | Gold/silver prices |
| GET | `/api/market/gold/history` | Gold price history |
| POST | `/api/market/gold/sync` | Sync gold prices |
| GET | `/api/market/currency` | Currency exchange rates |

### Stocks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stocks` | List stocks (paginated, searchable) |
| GET | `/api/stocks/[ticker]` | Single stock details |
| GET | `/api/stocks/[ticker]/history` | Price history |
| GET | `/api/stocks/[ticker]/recommendation` | Stock recommendation (V1) |
| GET | `/api/stocks/[ticker]/professional-analysis` | Professional analysis |
| GET | `/api/stocks/[ticker]/news` | Stock news |

### Recommendations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/market/recommendations/ai-insights` | AI insights for all stocks |

### V2 Engine

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v2/recommend` | V2 full recommendation engine |
| GET | `/api/v2/stock/[symbol]/analysis` | V2 single stock analysis |

### Self-Learning

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v2/feedback/run` | Run feedback loop |
| POST | `/api/v2/feedback/backtest` | Historical backtest |
| GET | `/api/v2/feedback/status` | Learning system status |
| GET | `/api/v2/feedback/predictions` | Prediction logs |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v2/admin/config` | Engine weight configuration |
| POST | `/api/v2/admin/config` | Update engine weight |
| GET | `/api/admin/recommendations` | Manual recommendation management |
| POST | `/api/admin/recommendations` | Update recommendation |
| POST | `/api/admin/gold` | Update gold prices |
| POST | `/api/admin/currency` | Update currency rates |
| POST | `/api/admin/auth` | Admin authentication |

### Import/Export

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/export?type=stocks&format=json` | Export data |
| POST | `/api/import` | Import data (CSV/JSON) |

---

## 8. Database Schema

### 8.1 Prisma Database (User/Auth) — `db/custom.db`

```prisma
model User {
  id                    String    @id @default(cuid())
  email                 String    @unique
  name                  String?
  username              String?   @unique
  password_hash         String?
  image                 String?
  is_active             Boolean   @default(true)
  subscription_tier     String    @default("free")
  default_risk_tolerance String   @default("medium")
  last_login            DateTime?
  email_verified        DateTime?
  created_at            DateTime  @default(now())
  updated_at            DateTime  @updatedAt
  accounts              Account[]
  sessions              Session[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime
  @@unique([identifier, token])
}

model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  published Boolean  @default(false)
  authorId  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 8.2 EGX Database (Market Data) — `db/egx_investment.db`

Key tables (accessed via better-sqlite3):

| Table | Description |
|-------|-------------|
| `stocks` | ~295 EGX-listed stocks with prices, financials, technical indicators |
| `stock_price_history` | OHLCV price history (date, open, high, low, close, volume) |
| `stock_deep_insight_snapshots` | Cached deep analysis results (JSON payload) |
| `market_indices` | EGX30, EGX70, EGX100, EWI, HDG index data |
| `gold_prices` | Current gold/silver prices by karat |
| `gold_price_history` | Historical gold/silver prices |
| `currency_rates` | USD, EUR, GBP, SAR, AED, KWD exchange rates |
| `calculation_weights` | V2 engine configurable weights (~50+ parameters) |
| `prediction_logs` | Logged predictions for self-learning |
| `feedback_accuracy_summary` | Historical accuracy snapshots |
| `weight_adjustment_logs` | Record of weight auto-tuning changes |
| `admin_settings` | Admin configuration (password, etc.) |

---

## 9. Deployment

### 9.1 Development

```bash
# Install dependencies
bun install

# Database setup
bun run db:generate    # Generate Prisma client
bun run db:push        # Push schema to SQLite
bun run db:migrate     # Run migrations

# Run dev server (port 3000)
bun run dev
```

### 9.2 Production Build

```bash
# Build Next.js standalone
bun run build

# Start production server
bun run start
# Runs: NODE_ENV=production bun .next/standalone/server.js
```

### 9.3 Caddy Reverse Proxy

The `Caddyfile` provides:

```
:81 {
    # Dynamic port forwarding via query param
    @transform_port_query {
        query XTransformPort=*
    }
    handle @transform_port_query {
        reverse_proxy localhost:{query.XTransformPort}
    }
    # Default: proxy to Next.js on port 3000
    handle {
        reverse_proxy localhost:3000
    }
}
```

WebSocket connections use the `XTransformPort` query parameter to route to the market service (port 3005).

### 9.4 Next.js Configuration

```typescript
const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  reactStrictMode: false,
};
```

Build script copies static assets and `public/` into the standalone output:
```bash
next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
```

---

## 10. Mini Services & WebSocket

### 10.1 WebSocket Market Service

A separate Socket.IO server provides real-time market data. Connected via:

```typescript
const socket = io('/?XTransformPort=3005', {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10,
});
```

#### Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `market:update` | Server→Client | Price changes for all tracked stocks (~30s interval) |
| `market:snapshot` | Server→Client | Initial snapshot on connect |
| `market:status` | Server→Client | Market open/closed status |
| `stock:alert` | Server→Client | Price threshold alert |
| `ticker:update` | Server→Client | Individual ticker price update |
| `subscribe:ticker` | Client→Server | Subscribe to specific ticker |
| `unsubscribe:ticker` | Client→Server | Unsubscribe from ticker |
| `getMarketOverview` | Client→Server | Request market overview |

#### Client Hook

```typescript
import { useRealtimeUpdates } from '@/lib/ws-client';

const {
  isConnected,
  stockPrices,
  marketStatus,
  subscribeTicker,
  unsubscribeTicker,
  getMarketOverview,
} = useRealtimeUpdates();
```

---

## 11. Configuration & Environment Variables

### 11.1 Required Environment Variables

```bash
# .env file

# Database — Prisma (user/auth)
DATABASE_URL=file:./db/custom.db

# NextAuth
NEXTAUTH_SECRET=your-secret-key-min-32-chars
NEXTAUTH_URL=https://your-domain.com

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Database — EGX (market data) — referenced in code as db/egx_investment.db
# No env var needed; path is hardcoded relative to cwd
```

### 11.2 Engine Configuration (Database)

The V2 engine weights are stored in `calculation_weights` table and loaded via `config-service.ts`. Key configurable parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `weight_profitability` | 0.25 | Profitability weight in quality engine |
| `weight_growth` | 0.20 | Growth weight in quality engine |
| `weight_safety` | 0.20 | Financial safety weight |
| `weight_efficiency` | 0.15 | Efficiency weight |
| `weight_valuation` | 0.20 | Valuation weight |
| `strong_buy_threshold` | 65 | Composite score for Strong Buy |
| `buy_threshold` | 52 | Composite score for Buy |
| `hold_threshold` | 42 | Composite score for Hold |
| `sell_threshold` | 32 | Composite score for Avoid |
| `margin_of_safety` | 0.85 | Fair value margin of safety |
| `sector_pe_premium` | 1.1 | Sector PE premium multiplier |
| `max_growth_cap` | 25 | Max growth rate for fair value (%) |
| `regime_bull_multiplier` | 1.3 | Bull market regime multiplier |
| `regime_bear_multiplier` | 0.7 | Bear market regime multiplier |
| `max_risk_per_stock` | 0.10 | Max 10% portfolio per stock |
| `feedback_enabled` | 1 | Enable auto weight tuning |
| `feedback_min_predictions` | 30 | Min predictions before auto-tuning |
| `feedback_direction_accuracy_target` | 55 | Target accuracy for tuning |
| `feedback_boost_factor` | 0.05 | Weight boost factor |
| `feedback_decay_factor` | 0.03 | Weight decay factor |
| `feedback_max_weight_adjustment` | 15 | Max ±15% per adjustment |
| `risk_free_rate` | 17.5 | Egyptian risk-free rate (%) |

---

## 12. Scripts & Tooling

### 12.1 Package Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `next dev -p 3000 2>&1 \| tee dev.log` | Development server with logging |
| `build` | `next build && cp -r ...` | Production build with static asset copy |
| `start` | `NODE_ENV=production bun .next/standalone/server.js` | Production server |
| `lint` | `eslint .` | Lint check |
| `db:push` | `prisma db push` | Push Prisma schema to DB |
| `db:generate` | `prisma generate` | Generate Prisma client |
| `db:migrate` | `prisma migrate dev` | Run DB migrations |
| `db:reset` | `prisma migrate reset` | Reset DB (destructive) |

### 12.2 Database Initialization (Legacy)

The original project includes a Node.js initialization script at `download/investment_fullstack/scripts/init_db.js` that:
- Creates all database tables
- Seeds ~295 EGX stocks with realistic financial data
- Generates 100 days of price history per stock
- Calculates technical indicators (MA50, MA200, RSI)
- Creates market indices (EGX30, EGX50, EGX70, EGX100, EGX33 Shariah)
- Creates a default admin user with API key

### 12.3 Data Seeding Scripts

| Script | Location | Description |
|--------|----------|-------------|
| `init_db.js` | `download/investment_fullstack/scripts/` | Full DB initialization |
| `egx_stock_data.js` | `download/investment_fullstack/scripts/` | EGX stock master data |
| `seed_egx100_incremental.js` | `download/investment_fullstack/scripts/` | Incremental data seeding |

### 12.4 Data Collection (Scraper)

| Script | Location | Description |
|--------|----------|-------------|
| `runOnce.js` | `download/investment_fullstack/scripts/egypt_scraper/` | Single scrape run |
| `runLoop.js` | `download/investment_fullstack/scripts/egypt_scraper/` | Continuous scrape loop |
| `collectAndFormat.js` | `download/investment_fullstack/scripts/egypt_scraper/` | Data collection & formatting |
| `runAnalysis.js` | `download/investment_fullstack/scripts/egypt_scraper/` | Run analysis pipeline |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Caddy (:81)                           │
│         Reverse Proxy + Port Forwarding                  │
└──────────┬──────────────────────────┬───────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────┐    ┌───────────────────────┐
│  Next.js (:3000) │    │  WS Market (:3005)    │
│  ┌──────────────┐ │    │  Socket.IO Server     │
│  │  App Shell   │ │    │  - market:update      │
│  │  (page.tsx)  │ │    │  - stock:alert        │
│  │  View Router │ │    │  - ticker:update      │
│  └──────┬───────┘ │    └───────────────────────┘
│         │         │
│  ┌──────┴───────┐ │
│  │  API Routes  │ │
│  └──────┬───────┘ │
│         │         │
│  ┌──────┴───────────────────────┐
│  │  V2 Recommendation Engine   │
│  │  ┌─────────┐ ┌────────────┐ │
│  │  │ Safety  │→│  Quality   │ │
│  │  │ Filter  │ │  Engine    │ │
│  │  └─────────┘ └─────┬──────┘ │
│  │                     │        │
│  │  ┌──────────────────┘        │
│  │  │  Momentum Engine          │
│  │  │  + Fair Value Calculator  │
│  │  │  + Portfolio Engine       │
│  │  └──────────────────────────┘ │
│  │  Self-Learning Feedback Loop │
│  └──────────┬───────────────────┘
│             │
│  ┌──────────┴───────────────────┐
│  │  SQLite: egx_investment.db   │
│  │  - stocks, price_history     │
│  │  - gold, currency            │
│  │  - predictions, weights      │
│  └──────────────────────────────┘
│  ┌──────────────────────────────┐
│  │  SQLite: custom.db (Prisma)  │
│  │  - users, sessions, accounts │
│  └──────────────────────────────┘
└──────────────────────────────────┘
```

---

## Notes for Developers

1. **Dual Database**: The app uses two SQLite databases — Prisma for auth, better-sqlite3 for EGX market data
2. **RTL/Arabic**: The UI is entirely in Arabic with `dir="rtl"`. All user-facing strings are in Arabic
3. **Mock Data Fallback**: The Zustand store has `USE_REAL_API = true` flag. When API calls fail, it falls back to generated mock data
4. **No External AI**: The V2 engine is pure mathematical computation — no calls to OpenAI, Together.ai, or any LLM
5. **Caching**: Several endpoints use internal caching (5-15 min). Use `?no_cache=true` to bypass
6. **Currency**: All stock prices are in Egyptian Pounds (EGP)
7. **Timezone**: Africa/Cairo (UTC+2)
8. **Circuit Breaker**: Admin weight changes are limited to ±20% per single adjustment
9. **Data Source**: Live market data scraped from Mubasher (Egyptian financial portal)
10. **WAL Mode**: The EGX database uses `journal_mode = WAL` for better concurrent read performance
