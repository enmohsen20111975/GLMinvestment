# 02 — API Dictionary

> **المالك:** ألفا | آخر تحديث: 2026-10-28 (post-DAL Wave 4 + intelligence layers)
> كل الـ endpoints في Next.js + Python backend.

---

## 1. Next.js API Routes (src/app/api/)

كل الـ routes thin wrappers — ممنوع `new Database()` (DAL gatekeeper).

### Market & Stocks

| Endpoint | DAL Function | Description |
|----------|-------------|-------------|
| `GET /api/stocks` | `openDb('stocks.db')` | List all stocks |
| `GET /api/stocks/[ticker]` | (proxy to Python) | Single stock detail |
| `GET /api/stocks/[ticker]/history` | `openDb('stocks.db')` | OHLCV history (stock_daily_prices) |
| `GET /api/stocks/[ticker]/depth` | `DbManager.openDb` | Market depth DOM |
| `GET /api/stocks/[ticker]/fundamentals` | `DbManager.getCompanyFundamentals` | 8 tabs financials (66 columns) |
| `GET /api/stocks/sparkline` | `DbManager.getLiveSparkline` | Live sparkline (stocks.db first) |
| `GET /api/stocks/delta-volume` | `openDb('data_engine.db')` | Buy/sell pressure |
| `GET /api/stocks/top-performers` | `openDb('stocks.db')` | Top movers |
| `GET /api/screener/advanced` | `DbManager.openDb('stocks.db')` | Advanced screener |
| `GET /api/tab-data` | `DbManager.getMarketTabData` | Tab financials (8 tabs) |

### Maker Radar & Incubator

| Endpoint | DAL Function | Response Fields |
|----------|-------------|-----------------|
| `GET /api/maker-radar` | `openDb` | Radar cache (JSON) |
| `GET /api/maker-radar/fundamentals` | `DbManager.getCompanyFundamentals` | 8 tabs: valuation, profitability, balance_sheet, income_statement, cash_flow, dividends, performance, technical_analysis |
| `GET /api/radar/incubator` | `DbManager.getIncubatorData` | `candidates[]` + `scanner_alerts[]` + `under_microscope[]` |

#### `/api/radar/incubator` Response Contract

```typescript
{
  success: boolean;
  market: string;
  total_candidates: number;
  candidates: IncubatorCandidate[];      // quiet_accumulation + pre_surge
  scanner_alerts: ScannerAlert[];        // SCANNER_ALERT (نشاط غير معتاد)
  under_microscope: IncubatorCandidate[]; // quiet_accumulation تحت الميكروسكوب
  timestamp: string;
  source: 'today_radar' | 'latest_radar' | 'no_radar_output';
  is_fresh: boolean;
}
```

#### IncubatorCandidate Fields

```typescript
{
  ticker: string;
  name_ar?: string;
  current_price: number;
  readiness_pct: number;
  signals_passed: number;
  total_signals: number;
  passed_reasons: string[];
  trigger: { type, condition_ar, trigger_price, distance_to_trigger_pct };
  target_if_promoted: number;
  stop_loss_if_promoted: number;
  risk_reward: number;
  stage: string;
  path: string;
  // Intelligence layers (merged from results by DbManager)
  price_action?: string | null;
  price_action_evidence?: Record<string, unknown> | null;
  participant_flow_assessment?: string | null;
  participant_evidence_level?: string | null;
  participant_evidence?: Record<string, unknown> | null;
  continuation_assessment?: string | null;
  data_quality_status?: string | null;
  data_quality_reasons?: string[] | null;
  classification_timestamp?: string | null;
  // Enrichment (from scanner)
  volume_surge?: boolean;
  change_percent?: number;
  rsi_scanner?: number | null;
  value_traded_official?: number | null;
  relative_volume_10d_official?: number | null;
  turnover_egp?: number;
  logo_url?: string | null;
  logoUrl?: string | null;
}
```

#### ScannerAlert Fields

```typescript
{
  ticker: string;
  classification: 'SCANNER_ALERT';
  path: 'F_scanner_alert';
  movement_type: 'SURGE_UP' | 'SURGE_DOWN' | 'UP' | 'DOWN' | 'FLAT';
  movement_desc?: string;
  change_percent: number;
  volume_surge: boolean;
  current_price: number;
  relative_volume_10d_official?: number | null;
  value_traded_official?: number | null;
  rsi_scanner?: number | null;
  turnover_egp?: number;
  signal: 'HOLD';           // مش توصية شراء
  signal_ar: 'مراقبة';
  readiness_pct: 0;
  under_microscope: false;
  logo_url?: string | null;
  logoUrl?: string | null;
  // Intelligence layers (same as IncubatorCandidate)
  price_action?: string | null;
  participant_flow_assessment?: string | null;
  continuation_assessment?: string | null;
  data_quality_status?: string | null;
  data_quality_reasons?: string[] | null;
  classification_timestamp?: string | null;
}
```

### Predictions

| Endpoint | DAL Function | Description |
|----------|-------------|-------------|
| `GET /api/predictions` | `openDb('predictions.db')` | All predictions |
| `GET /api/predictions/daily-picks` | `openDb` + `openDb('stocks.db')` | Daily picks (dedup + 15% anomaly filter) |
| `GET /api/predictions/honest-tracking` | `openDb('predictions.db')` | Tracking root (wins/losses/pending) |
| `GET /api/predictions/honest-tracking/list` | `openDbWritable` | Predictions list (with ensureSchema) |
| `GET /api/predictions/honest-tracking/stats` | `openDbWritable` | Tracking stats |
| `GET /api/predictions/expert-consensus` | `openDb` | Expert consensus |
| `GET /api/unified/predictions` | `enrichWithUnifiedLogos` | Unified predictions (with logos) |

#### Predictions Safety Filters (DAL)

```
entry_price > 0 AND entry_price < 100000
stop_loss >= 0 (يمنع negative stop)
BUY: stop_loss < entry_price (ممنوع وقف فوق الدخول)
abs(current - entry) / current <= 0.15 (15% anomaly threshold)
Dedup by ticker (يمنع تكرار ADP×5)
```

### Portfolio

| Endpoint | DAL Function | Description |
|----------|-------------|-------------|
| `GET /api/portfolio/master` | `openDb` + `stock_daily_prices` | Portfolio master (live price) |
| `POST /api/portfolio/rescue` | `getStocksDb` + `getPriceHistoryDb` | Bag holder rescue |
| `GET /api/portfolio/cashflow` | `openDb` | Cash flow |
| `GET /api/portfolio/unified-watch` | `openDb` | Unified watchlist |

### Admin

| Endpoint | DAL Function | Description |
|----------|-------------|-------------|
| `GET /api/admin/system-resources` | `DbManager.openDbWritable` | System resources + VACUUM |
| `GET /api/admin/engines-status` | `openDb` | Engine status |
| `GET /api/admin/cron-health` | `openDb` | Cron job health |
| `GET /api/admin/db-manager/repair` | `openDb` | DB repair |

### Liquidity Radar

| Endpoint | DAL Function | Response Fields |
|----------|-------------|-----------------|
| `GET /api/v2/liquidity-radar` | `openDb` + cache JSON | `stocks[]` (460 stocks) |

#### LiquidityRadarView Stock Fields (intelligence + enrichment)

```typescript
{
  ticker: string;
  current_price: number;
  change_percent: number;
  classification: string;
  // Intelligence layers (4 columns in UI)
  price_action?: string | null;
  price_action_evidence?: Record<string, unknown> | null;
  participant_flow_assessment?: string | null;
  participant_evidence_level?: string | null;
  participant_evidence?: Record<string, unknown> | null;
  continuation_assessment?: string | null;
  data_quality_status?: string | null;
  data_quality_reasons?: string[] | null;
  classification_timestamp?: string | null;
  // Scanner enrichment
  volume_surge?: boolean | null;
  rsi_scanner?: number | null;
  value_traded_official?: number | null;
  relative_volume_10d_official?: number | null;
  movement_type?: string | null;
  movement_desc?: string | null;
  // Other fields
  turnover_egp?: number;
  net_flow_5d?: number;
  liquidity_bucket?: string;
  phase: string;
  entry_defense: { entry_level, defense_level, resistance_level };
  whale: { net_flow_egp, buy_pct, sell_pct };
  scan_timestamp?: string;
}
```

### Other

| Endpoint | DAL Function | Description |
|----------|-------------|-------------|
| `GET /api/market/overview` | `openDb` | Market overview |
| `GET /api/market/regime` | `openDb` | Market regime (DEFENSIVE/NORMAL/AGGRESSIVE) |
| `GET /api/market/liquidity-flow` | `openDb` | Liquidity flow |
| `GET /api/chart/[ticker]` | `openDb` | Chart candles |
| `GET /api/news-feed` | `openDb` | News feed |
| `GET /api/health` | `openDb` | Health check (6 DBs) |
| `GET /api/sharia` | `openDb` | Sharia compliance |
| `POST /api/auth/[...nextauth]` | `openDb('auth.db')` | NextAuth |

---

## 2. Python API Routes (vps-service/api/)

Flask Blueprints — ~80 endpoints عبر 5 domains.

### Market Domain (12 endpoints)

| Endpoint | File | Description |
|----------|------|-------------|
| `GET /api/stocks` | `public_routes.py` | List all stocks |
| `GET /api/stocks/<ticker>` | `public_routes.py` | Stock detail |
| `GET /api/stocks/<ticker>/history` | `public_routes.py` | OHLCV history |
| `GET /api/market/overview` | `public_routes.py` | Market overview (cached 300s) |
| `GET /api/market/liquidity-radar` | `market_master_endpoints.py` | Liquidity radar |
| `GET /api/market/indices` | `market_master_endpoints.py` | EGX30/70/100 constituents |

### Predictions Domain (14 endpoints)

| Endpoint | File | Description |
|----------|------|-------------|
| `GET /api/predictions/daily-picks` | `picks_management_routes.py` | Daily picks (V40.2) |
| `GET /api/stored-analysis/results` | `stored_analysis_routes.py` | Stored analysis |

### Analysis Domain (18 endpoints)

| Endpoint | File | Description |
|----------|------|-------------|
| `GET /api/professional-analysis/<ticker>` | `professional_analysis_routes.py` | Pro analysis |
| `GET /api/screener` | `screener_routes.py` | Screener |
| `GET /api/sniper/scan` | `sniper_routes.py` | Sniper scan |

---

## 3. الـ Gateway (Caddy)

- **الـ port الوحيد المعرض**: 3000 (Next.js)
- **Python backend**: يُصل له عبر `?XTransformPort=8010` في الـ URL query
- **WebSocket**: `io("/?XTransformPort={Port}")` — path دائماً `/`
- ممنوع كتابة port في الـ URL (مباشر) — فقط في الـ query param

---

## 4. Intelligence Layers (4 طبقات ذكاء)

كل API response من الرادار بـ يحتوي على 4 طبقات:

| الطبقة | الحقل | القيم المسموحة | الوصف |
|--------|------|-----------------|--------|
| 1. price_action | `price_action` | SURGE_UP, SURGE_DOWN, BULLISH_WAVE_START, BEARISH_WAVE_START, BULLISH_CONTINUATION, BEARISH_CONTINUATION, BOUNCE_AFTER_DECLINE, PULLBACK_AFTER_RALLY, BREAKOUT, BREAKDOWN, SIDEWAYS, MOMENTUM_EXHAUSTION, UNCONFIRMED, INSUFFICIENT_DATA | تصنيف الحركة السعرية |
| 2. participant_flow | `participant_flow_assessment` | INSTITUTIONAL_EVIDENCE, SPECULATIVE_PATTERN, MIXED_PARTICIPATION, UNCONFIRMED, UNAVAILABLE | تقييم المشاركين |
| 2b. evidence_level | `participant_evidence_level` | DIRECT, INDIRECT, WEAK, UNAVAILABLE | مستوى الدليل |
| 3. continuation | `continuation_assessment` | SUPPORTIVE, MIXED, WEAK, UNCONFIRMED, INSUFFICIENT_DATA | قابلية الاستمرار |
| 4. data_quality | `data_quality_status` | FRESH, STALE, VERY_STALE, INSUFFICIENT_HISTORY, GAPS, UNAVAILABLE, OK | حالة البيانات |

**مهم**: كل الحقول ممكن تكون `null` لو مش متاحة (Rule 27). الـ UI بـ يخفي الـ badge لو null.
