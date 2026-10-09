# Team 6: News System Audit

**Audit Date**: 2026-10-09
**Scope**: News collection, filtering, publishing, and utilization across the EGX investment platform
**Auditor**: News/Media Specialist
**Mode**: PURE RESEARCH — no code modifications

---

## 1. News Database

### 1.1 Canonical Database: `/home/z/my-project/db/news.db` (18 MB, WAL mode)

**Tables found** (4):

| Table | Row count | Status |
|---|---|---|
| `news_articles` | 4,428 | legacy/mirror — same content as `market_news` |
| `market_news` | 4,428 | canonical (CONSTITUTION Rule: NEWS-DB-SOT) |
| `news_api_keys` | 0 | empty — never populated |
| `news_agent_articles` | **does not exist** | would be created by `vps-service/api/news_routes.py` on first POST |

### 1.2 Schema of `market_news` (canonical table)
Columns: `id, title, content, summary, summary_ar, source, source_url, image_url, market, market_code, symbol, category, language, published_at, fetched_at, created_at, is_catalyst, source_type, summary_ar (dup), url, tickers, importance, sentiment, sentiment_score, impact_score, image_paths, tags, keywords, is_published`

### 1.3 Article Statistics (from `market_news`)

**Sources**:
| Source | Count | Language | EGX-relevant? |
|---|---|---|---|
| AlphaVantage | 3,736 | en | ❌ NO — US/global stocks (NYSE, TSX, S&P 500) |
| GNews | 631 | ar | mixed — some EGX-relevant |
| NewsAPI | 61 | ar | mixed — mostly global |

**Languages**: 3,736 English / 692 Arabic
**Date range**: `2026-05-17 → 2026-06-24` (≈ 4 months stale — system running Oct 2026)
**Markets**: 4,428 rows have `market = 'general'` (NONE tagged EGX)
**Categories**: all NULL
**Symbol linkage**: 0/4,428 articles have `symbol` populated
**Tickers**: 0/4,428 articles have `tickers` populated (all NULL or `'[]'`)
**Importance**: 0/4,428 articles have non-zero importance (all are 0)
**Sentiment**: 0/4,428 articles have sentiment classified (all NULL)
**Is_catalyst**: 0/4,428 articles flagged as catalyst

### 1.4 Sample Article Titles (most recent)
- AlphaVantage: "Dividend reinvestment adds MDV shares for Modiv Industrial CEO (MDV)"
- AlphaVantage: "Manulife (TSX:MFC) Launches Protection VUL Through John Hancock..."
- AlphaVantage: "S&P 500 Futures Rise in Premarket Trading..."
- GNews (Arabic): "انخفاض جماعي لمؤشرات البورصة في بداية جلسة اليوم" (EGX-relevant!)
- GNews: "قطر: سنعارض أي رسوم عبور إيرانية في مضيق هرمز" (irrelevant)

### 1.5 Related Databases Checked
- `db/data_engine.db`: contains stocks, stock_prices, gold_prices, crypto_prices, financials — **no news tables**
- `db/predictions.db`: **`news_signals` table DOES NOT EXIST** (but is referenced by `/api/news-feed/route.ts` and `/api/admin/news/route.ts` DELETE handler — silent failure)
- `news-agent/data/news.db`: **does not exist** (news-agent NewsStore expects to create it but news-agent has never run)

---

## 2. News Collection

### 2.1 Architecture: Two Parallel News Collection Systems

**System A — `news-agent/` (Python standalone service)**
- Uses `NewsStore` writing to `news-agent/data/news.db` (does not exist on this sandbox)
- Configured to run every 15 min (`COLLECTION_INTERVAL_MINUTES=15`)
- Run script `news-agent/run.sh` requires `.env` file with Telegram API creds
- Requires `ollama serve` running on `localhost:11434` for AI analysis
- README confirms: "AI محلي معطّل — V40.2 يعتمد على rules + indicators (مش AI)"

**System B — `vps-service/ai/news_agent.py` (inline, lazy fetch)**
- Called lazily by V40.2 daily_predictor when `V40_2_NEWS_IMPACT=1`
- Uses DuckDuckGo Search (`ddgs` library) + trafilatura + Ollama
- `KILL-OLLAMA` flag (2026-08-31): Ollama connection skipped entirely — keyword fallback is production

### 2.2 Collectors Available in `news-agent/collectors/`

| Collector | Source | Active? | Quality |
|---|---|---|---|
| `web_scraper.py` | DuckDuckGo via GLMinvestment news_fetcher_analyzer | ✅ | depends on network |
| `rss_collector.py` | Amwal Al-Ghad, Masrawy, Hapi Journal, Argaam, Youm7 | ✅ | **3 sources BROKEN** per admin/news-health: argaam, amwal, youm7 return HTML not RSS |
| `telegram_web_collector.py` | 4 channels: ostoulcapital, elelhamy, BorsaBelArabi96, sahmmisr | ✅ | good quality (no auth needed) |
| `telegram_collector.py` | 13 channels (sahmmisr, borsablarabi, ostoulcapital, etc.) | ⚠️ needs telethon + TELEGRAM_API_ID/HASH | high quality if creds present |
| `egyptian_sources.py` | alborsaanews | ⚠️ `ENABLE_EGYPTIAN_SOURCES=0` (disabled by default) | good EGX source |
| `mubasher_scraper.py` | mubasher.info HTML scraping | ⚠️ blocked by Cloudflare per source comment | high quality when reachable |

### 2.3 Standalone Scrapers in `news-agent/collectors/scrappers/`

| Scraper | Target | Status |
|---|---|---|
| `egx_news_scraper.py` | `beta.egx.com.eg` official EGX news | ✅ Active per README but writes to `news` table that doesn't exist in canonical news.db |
| `marketmaker_news_scraper.py` | marketmakerseg.com (Playwright) | ❌ Hardcoded Windows path `D:\My WebStie Applications\news_agent\data\marketmaker_news.json` — won't run on Linux |
| `tradingview_*.py` (3 files) | scanner.tradingview.com + screener lists | stock data, not news |
| `investing_scraper.py.disabled` | investing.com | disabled — needs Playwright |

### 2.4 Collection Frequency
**CRITICAL**: No cron entry in `/home/z/my-project/crontab.txt` (201 lines) runs `news-agent/main.py` or any news collector. The crontab has 23 entries for V40.2, EGX disclosures, intraday scanner, daily closer, learning engine, regime detector, market scheduler, etc. — **ZERO for news collection**. The news-agent is documented as running every 15 min but is never scheduled.

### 2.5 Quality of Sources
- **Telegram channels**: excellent EGX-specific (13 channels covering technical analysis, news, breaking alerts)
- **RSS feeds**: 3 of 5 sources known broken (HTML instead of RSS — argaam, amwal, youm7)
- **EGX official site**: scraper exists but never wrote to canonical DB
- **AlphaVantage / GNews / NewsAPI** (currently in DB): foreign news APIs with NO EGX filter — 3,736 of 4,428 articles are US/global stocks

---

## 3. News Filtering

### 3.1 Relevance Filtering
Located in `news-agent/collectors/keyword_filter.py`:
- 100+ EGX tickers (COMI, HRHO, EAST, EFIH, etc.)
- EGX indices (EGX30, EGX70, EGX100, EGX50, EGX20)
- EGX Arabic keywords: البورصة, البورصة المصرية, الأسهم, إدراج, الفي %الرقابة المالية, توزيعات أرباح, etc.
- EGX English keywords: stock, shares, EGX, Cairo, Egyptian Exchange, FRA, etc.
- AI fallback via Ollama (asks: "هل الخبر عن البورصة المصرية؟")
- Ticker-pattern detection: `[A-Z]{3,5}(\.|-)CA` (e.g., COMI.CA)
- Filtering is applied to news-agent-collected news — **NOT** to the 4,428 pre-existing articles in news.db (those came unfiltered)

### 3.2 Sentiment Analysis (`news-agent/analyzer/news_analyzer.py`)
- Ollama + DeepSeek enrichment + keyword fallback
- Output: bullish/bearish/neutral + impact_type (earnings/dividend/ipo/acquisition/macro/regulation/price_move/general)
- Importance 0-100 with critical keywords weighting (تشتري=30, مليار سهم=30, زيادة رأس المال=25)
- Spam filtering (YouTube/Facebook/promotional patterns, short text, URL-only)
- **Currently NO articles have sentiment** because news-agent has never run successfully against the canonical DB

### 3.3 Duplicate Detection (`news-agent/data/news_store.py`)
- SHA256 hash of `body[:200]` for deduplication
- `_make_id()` returns 16-char hex hash
- `INSERT OR IGNORE` on primary key
- `news.db` itself has DUPLICATED data: `news_articles` and `market_news` tables both have 4,428 rows (likely same content migrated but originals never purged)

### 3.4 Stock Symbol Linking (`vps-service/analyzers/news_fetcher_analyzer.py`)
- Uses `egx_stocks_dictionary.py` `extract_tickers_accurately(text)` for 100% accuracy
- Tickers stored as JSON array `["COMI","TMGH"]` in `tickers` column
- **0/4,428 articles have tickers populated** → stock-specific news linking completely broken

### 3.5 News Impact Scorer (`news_impact_scorer.py`)
Excellent EGX-calibrated event taxonomy (13 types):
- IPO_SUBSCRIPTION: +18 BOOST
- EARNINGS_BEAT: +14 BOOST
- MA_ACQUISITION: +12 BOOST
- DIVIDEND_ANNOUNCE: +6 BOOST
- DIVIDEND_EX_DATE: -12 REDUCE (note: dividend ex-date is negative on EGX)
- EARNINGS_MISS: -14 REDUCE
- INVESTIGATION_FRAUD: -22 VETO
- TRADING_HALT: -25 VETO
- CBE_DECISION: -8 REDUCE
- Verdict → V40.2 score_delta: BOOST_STRONG(+2), BOOST(+1), NEUTRAL(0), REDUCE(-1), VETO(-2)

### 3.6 News Stop Filter (`news_stop_filter.py`)
- Simplified version per "Kimi suggestion"
- Uses `news_items` table (which **does not exist** in any DB on the sandbox)
- 24h news window → HOLD; CBE news → all predictions HOLD
- Currently non-functional (would crash on missing table)

---

## 4. News Display

### 4.1 API Endpoints (Next.js)

| Route | Method | Purpose | Auth |
|---|---|---|---|
| `/api/news` | GET | Read market_news (supports `market`, `tickers`, `catalyst`, `limit`, `offset` filters) | public |
| `/api/news` | POST | Receive news from local News Agent (X-Agent-Key header) | optional |
| `/api/news/latest` | GET | Lightweight (id, title, source, url, published_at) | public |
| `/api/news-feed` | GET | Unified multi-source: news.db market_news + predictions.db news_signals + EGXPilot + CoinGecko + Alternative.me (Fear & Greed) | public |
| `/api/mobile/news` | GET | Flutter app news feed (50 latest, optional market filter) | public |
| `/api/stocks/[ticker]/news` | GET | Stock-specific news (Python backend first → SQLite fallback) | public |
| `/api/admin/news` | GET/POST/PUT/DELETE | Admin CRUD with min_importance filter, source filter, search | admin |
| `/api/admin/news-health` | GET | Per-source health dashboard with broken source detection | admin |
| `/api/egxpilot/news` | GET | **Returns hardcoded empty news** (`news: []`) | public |

### 4.2 Frontend Components

**`src/modules/news/components/NewsFeedView.tsx`** (891 lines):
- 2-column responsive layout, RTL Arabic
- Search input (filters title/body/summary/tickers/source)
- Market filter tabs: `all` / `EGX` / `global`
- Auto-refresh every 3 minutes
- Pagination: 12 articles per "Load More" page
- Each card: source badge, importance badge (high only), ticker chips, date/time, source image viewer with lightbox
- `InvestmentDecisionInsight` sub-component: shows AI reasoning ONLY if `item.reasoning.length > 10`
- `ShareAndActions` sub-component: social sharing (Facebook, Twitter X, WhatsApp, Telegram, LinkedIn) via `UnifiedPublishButton`
- `EGX` filter logic: `n.source.includes('مصر') || n.source.includes('EGX') || n.source.includes('البورصة')` — **but no article in DB has any of these in source field**, so EGX filter currently returns nothing or only the rare GNews Arabic items
- `global` filter: `n.category === 'crypto' || n.category === 'market'`

**`src/modules/stock-analysis/components/StockNews.tsx`** (617 lines):
- Per-stock news view shown in stock detail page
- Calls `/api/stocks/[ticker]/news` via `loadStockNews(selectedTicker)`
- Shows overall sentiment badge + bar (-1 to +1)
- `SentimentDistribution`: stacked bar of positive/neutral/negative counts
- Tabs: All / Positive / Negative / Neutral with counts
- `NewsCard` shows: title, source, date, `summary_ar` ("خلاصة المحلل المالي للمستثمر"), catalyst badge, impact_type badge, sentiment badge, relevance score badge, category badges
- Clickable source URL (ExternalLink icon)
- Manual "تحميل الأخبار" (Load News) button when news not fetched

### 4.3 Search/Filter/Sort Capabilities

**Search**: title + body + summary + tickers + source (case-insensitive substring)
**Filter**: market (all/EGX/global), tickers (comma-separated, server-side LIKE on JSON column)
**Sort**: `fetched_at DESC` (most recent first) on canonical table
**Catalyst filter**: `?catalyst=true` returns only `is_catalyst = 1` (currently 0 articles)

---

## 5. News Publishing

### 5.1 Telegram Publishing (`news-agent/sender/social_publisher.py`)
- Channel: `@Arabian_investment_guide` (configured via env `TELEGRAM_CHAT_ID`)
- Bot token via env `TELEGRAM_BOT_TOKEN` (SECURITY-P0: hardcoded token removed)
- HTML-formatted messages with: title, stock labels, sentiment badge, impact badge, importance score, summary, source attribution, hashtags
- Sends up to 1 image per article (URL or local file via multipart)
- Inline keyboard with 6 buttons: read full, official site, smart bot, radar, chart, filters, WhatsApp
- Robust error handling: HTTP 4xx → retry without reply_markup, then full retry

### 5.2 Publishing Filter (in `news-agent/main.py::_send_important()`)
**PHASE-2-COMPLETE (2026-10-07) filter** — addressed customer complaint of 80+ messages per batch:

| Criterion | Default | Env var |
|---|---|---|
| Min importance | 70 | `TG_MIN_IMPORTANCE` |
| Require tickers linked | true | `TG_REQUIRE_TICKERS` |
| Market filter | EGX only | `TG_MARKET_FILTER` |
| Max per batch | 10 | `TG_MAX_PER_BATCH` |

Sort by importance DESC, top 10 prioritized. `is_catalyst` OR `importance >= 70` required.

**Current state**: Since 0/4,428 articles in news.db have importance ≥ 70, tickers populated, OR market = 'EGX', the publisher would publish ZERO articles with current data.

### 5.3 News Digest / Summary Features
**NONE FOUND.** No daily/weekly news digest, no morning briefing, no breaking news alerts beyond the standard article-level publishing. There is:
- `vps-service/telegram/telegram_daily_lessons.py` (educational content, not news digest)
- `vps-service/scripts/weekly_radar_report.py` (radar-based weekly report, not news digest)
- `vps-service/telegram/telegram_comprehensive_report.py` (prediction performance report, not news digest)

### 5.4 Other Auto-Posting (`vps-service/telegram/auto_poster.py`)
- Separate Telethon-based poster for predictions, stock alerts, market open/close announcements
- Does NOT publish news articles
- Requires Telethon + `credentials.json` (session-based, not bot-based)

---

## 6. News Utilization

### 6.1 Integration with V40.2 Prediction Engine

**`vps-service/jobs/daily_predictor.py`** (lines 2247, 3149, 3852):
```python
if os.environ.get('V40_2_NEWS_IMPACT', '0') == '1':
    from analyzers.news_fetcher_analyzer import get_news_with_impact
    _news_result = get_news_with_impact(ticker, max_news=3)
    _news_score = _news_result['overall_score']  # -2 to +2
    _news_verdict = _news_result['overall_verdict']  # BOOST/VETO/etc
```
**Toggle default: OFF** (`V40_2_NEWS_IMPACT=0`) — news is NOT used in production predictions unless explicitly enabled.

### 6.2 News Fetcher Source Priority (`news_fetcher_analyzer.py::fetch_news_for_ticker`)
1. **PRIMARY**: Production server `/api/proxy-prod/news-feed?limit=50` (loopback to self in sandbox)
2. **FALLBACK 1**: `news.db → market_news` filtered by `tickers LIKE '%"TICKER"%' OR title LIKE '%TICKER%'` + `importance > 0` (skips all current articles since they have 0 importance)
3. **FALLBACK 2**: DuckDuckGo HTML search with queries:
   - `'"Commercial International Bank" Egypt stock news'`
   - `'"البنك التجاري الدولي" بورصة مصر'`
   - `'COMI EGX news'`

### 6.3 News Verdict Impact on V40.2 Score
| Verdict | Score Δ | Action |
|---|---|---|
| BOOST_STRONG | +2 | Strong buy signal |
| BOOST | +1 | Buy signal |
| NEUTRAL | 0 | No change |
| REDUCE | -1 | Reduce confidence |
| VETO | -2 | Hard veto on the trade |

### 6.4 Expert Recommendations Integration (`get_expert_recommendations_impact`)
- Pulls from production `/api/expert-recommendations?symbol=TICKER`
- Aggregates buy/sell/hold counts → STRONG_BUY (+20), BUY (+10), HOLD (0), SELL (-10), NO_DATA (0)
- Verdict from `news-agent/analyzer/recommendation_aggregator.py` → stocks.db `expertRecommendation` table

### 6.5 Live News Integration (`live_news_integration.py`)
- `get_news_impact_for_live_prediction(ticker)`: reads from production news-feed, scores via `news_impact_scorer`, returns level + score_delta + client_message
- `check_news_for_open_position(ticker, entry_date)`: monitors news after position opened → suggests exit if news turns negative
- `generate_news_aware_recommendation(ticker, v40_2_result, news_result)`: combines V40.2 technical verdict with news verdict for final recommendation

### 6.6 News-Based Alerts
**None found in news-agent.** No dedicated news-alert system that triggers user notifications when:
- High-importance catalyst detected
- Sentiment shift on a watchlist stock
- CBE rate decision news
- Trading halt announcement

The existing alerts system (`/api/alerts` and `src/lib/alerts-store.ts`) focuses on price-based and signal-based alerts, not news-based.

---

## 7. Quality Issues

### 7.1 Stale News (CRITICAL)
- **All 4,428 articles dated May 17 → June 24, 2026**
- Sandbox is operating October 2026
- News is 4+ months old → completely irrelevant for trading decisions
- No fresh news collection has happened in the sandbox

### 7.2 Irrelevant News — Global vs EGX (CRITICAL)
- **3,736 articles (84%) from AlphaVantage** are pure US/global market news:
  - "Dividend reinvestment adds MDV shares for Modiv Industrial CEO (MDV)"
  - "Manulife (TSX:MFC) Launches Protection VUL..."
  - "S&P 500 Futures Rise in Premarket Trading..."
  - "Teledyne wins $28.8M border security contract from CBP"
- ZERO relevance to EGX users
- 631 GNews Arabic articles are mixed: some EGX-relevant, many about Qatar PM, sports, Ukraine, etc.

### 7.3 No Symbol Linking (CRITICAL)
- 0/4,428 articles have `symbol` column populated
- 0/4,428 articles have `tickers` populated (all NULL or `'[]'`)
- Stock-specific news API `/api/stocks/COMI/news` would return 0 articles via DB fallback
- The `getStockNewsFallback()` function in `flutter-sqlite-fallback.ts` queries `WHERE tickers LIKE '%COMI%' OR title LIKE '%COMI%'` — would return zero rows since tickers are all NULL

### 7.4 No Sentiment / Importance Analysis (CRITICAL)
- 0/4,428 articles have non-zero `importance` (all = 0)
- 0/4,428 articles have `sentiment` classified (all NULL)
- 0/4,428 articles flagged as `is_catalyst`
- News-analyzer (`news-agent/analyzer/news_analyzer.py`) exists but has never been run against these articles
- The `InvestmentDecisionInsight` UI component renders NOTHING (requires `reasoning.length > 10`)

### 7.5 Duplicate Database Tables
- `news_articles` and `market_news` both have 4,428 rows with same data
- Wastes ~9 MB of storage
- Confusing: which is canonical? (CONSTITUTION Rule NEWS-DB-SOT says `market_news`)

### 7.6 Missing Tables Referenced in Code
- `predictions.db.news_signals` — referenced by `/api/news-feed/route.ts` and `/api/admin/news/route.ts` DELETE — **does not exist** → silent failures
- `news_items` — referenced by `news_stop_filter.py` — **does not exist** → would crash if invoked
- `news_agent_articles` — created on first POST to `/api/news/agent` (Python backend), but no agent is currently calling it

### 7.7 Broken Scrapers / Collectors
- `marketmaker_news_scraper.py`: hardcoded Windows path `D:\My WebStie Applications\news_agent\data\marketmaker_news.json` — completely unusable on Linux server
- `egx_news_scraper.py`: writes to a `news` table that doesn't exist in canonical news.db (different schema than `market_news`)
- `rss_collector`: 3 of 5 sources known broken (argaam, amwal, youm7 return HTML not RSS per admin/news-health hardcoded list)
- `mubasher_scraper.py`: blocked by Cloudflare per source comment
- `news-agent/data/news.db`: file doesn't exist — NewsStore would create on first run, but news-agent has never been run

### 7.8 News-Agent Service Not Scheduled
- `crontab.txt` has 23 entries — **ZERO for news-agent or news collection**
- README claims news-agent runs every 15 minutes — never actually scheduled
- News collection is fully dormant

### 7.9 Missing Key Financial News Sources
The `news-agent/config/sources.py` declares good sources but most are not actually pulling data:

| Source | Declared? | Actually in DB? |
|---|---|---|
| Telegram channels (13) | ✅ | ❌ 0 articles |
| Amwal Al-Ghad (RSS) | ✅ | ❌ 0 articles (RSS broken) |
| Masrawy (RSS) | ✅ | ❌ 0 articles |
| Hapi Journal (RSS) | ✅ | ❌ 0 articles |
| Youm7 (RSS) | ✅ | ❌ 0 articles (RSS broken) |
| Argaam (RSS) | ✅ | ❌ 0 articles (RSS broken) |
| Alborsaa (web) | ✅ | ❌ 0 articles (only in news_agent_articles if posted) |
| Almalnews (web) | ✅ | ❌ 0 articles |
| Mubasher (web) | ✅ | ❌ 0 articles (Cloudflare block) |
| EGX official site | ✅ | ❌ 0 articles (writes to non-existent table) |
| AlphaVantage | ❌ (not declared) | ✅ 3,736 articles (foreign news) |
| GNews | ❌ (not declared) | ✅ 631 articles (mixed Arabic) |
| NewsAPI | ❌ (not declared) | ✅ 61 articles (mixed Arabic) |

### 7.10 Poor Arabic Translation / Quality
- AlphaVantage articles are pure English (not translated)
- GNews Arabic articles are original Arabic (no translation needed) — quality varies
- No DeepSeek enrichment running → no `summary_ar` for any article
- No OCR text extraction (image-based news articles not processed)

### 7.11 Telegram Publishing Would Publish Nothing
- Filter requires: `importance >= 70` AND `tickers` populated AND `market = 'EGX'`
- 0 articles in DB satisfy any of these criteria → publisher would skip every batch with "مفيش أخبار جاية معايير التليجرام"

### 7.12 Frontend EGX Filter Broken
- `NewsFeedView.tsx` EGX filter: `n.source.includes('مصر') || n.source.includes('EGX') || n.source.includes('البورصة')`
- All 4,428 articles have source = "AlphaVantage" / "GNews" / "NewsAPI" — none contain those substrings
- EGX filter effectively returns empty list (or shows only the rare Arabic-source article)

### 7.13 EGXPilot Endpoint Stubbed
- `/api/egxpilot/news/route.ts` returns hardcoded `{ success: true, count: 0, news: [] }`
- Comment says "Return empty news - no fake data"
- News-feed API calls this and gets nothing

### 7.14 No Daily News Digest / Breaking News Alerts
- No morning news brief feature
- No breaking news alert mechanism (e.g., flash when CBE decision announced)
- No aggregated news recap sent to Telegram
- Existing Telegram auto-poster (`vps-service/telegram/auto_poster.py`) is for predictions/analysis, not news

---

## Critical Issues

### P0 — Complete News System Failure
1. **News-agent service is not scheduled**: No cron entry exists. The entire collection pipeline is dormant. News.db contains only legacy data from foreign APIs (AlphaVantage/GNews/NewsAPI) that has nothing to do with EGX.

2. **84% of articles are foreign US/global news**: 3,736 AlphaVantage articles cover NYSE, TSX, S&P 500 — completely irrelevant to Egyptian investors browsing the platform.

3. **Zero articles are EGX-tagged**: `market = NULL/'general'` for all 4,428 rows. The Telegram publisher, frontend EGX filter, and stock-specific news linking ALL silently produce empty results.

4. **Zero sentiment/importance/tickers populated**: The entire AI analysis pipeline (Ollama + DeepSeek + keyword filter) has never run against canonical news.db data. The `InvestmentDecisionInsight` UI card renders nothing.

5. **News is 4 months stale**: Most recent article is 2026-06-24; sandbox operates October 2026. Trading decisions based on stale news are harmful.

### P1 — Architecture Inconsistencies
6. **Multiple news DB paths**: `news-agent/data/news.db` (NewsStore expectation, doesn't exist) vs `/home/z/my-project/db/news.db` (canonical). If news-agent ever runs, it would write to a DIFFERENT file than what the frontend reads.

7. **Multiple news tables referenced but missing**:
   - `predictions.db.news_signals` — referenced by `/api/news-feed/route.ts` (silent failure on read) and `/api/admin/news` DELETE (will crash if user attempts batch delete of "news_signals")
   - `news_items` — referenced by `news_stop_filter.py` (would crash on invocation)
   - `news` table — created by `egx_news_scraper.py` but never read by any frontend route

8. **`marketmaker_news_scraper.py` has hardcoded Windows path**: Will never work on Linux production server.

9. **`egx_news_scraper.py` writes to non-canonical table**: Creates its own `news` table instead of writing to `market_news` (canonical per NEWS-DB-SOT rule).

### P2 — Quality Issues
10. **3 of 5 RSS sources broken**: argaam, amwal, youm7 return HTML instead of RSS. Per `/api/admin/news-health` hardcoded broken list.

11. **EGXPilot endpoint stubbed**: Returns hardcoded empty news — third-party EGX news source not actually integrated.

12. **Duplicate articles**: 4,428 rows appear in BOTH `news_articles` and `market_news` tables — same content duplicated.

13. **Telegram publisher would publish zero articles**: With current data (no importance, no tickers, no EGX tag), the filter rejects every candidate batch.

14. **Frontend EGX filter is broken**: Source-string matching doesn't match any actual source name (AlphaVantage, GNews, NewsAPI).

### P3 — Missing Features
15. **No news digest / morning brief**: No daily summary of important news.
16. **No breaking news alerts**: No special trigger for INVESTIGATION_FRAUD / TRADING_HALT / CBE_DECISION events.
17. **No news-based alerts**: Existing alerts system is price/signal-only, not news-driven.
18. **V40.2 news impact is disabled by default** (`V40_2_NEWS_IMPACT=0`): Even if news were collected, predictions wouldn't use it unless explicitly enabled.

---

## Recommendations

### R1 — Restore News Collection (Critical, P0)
1. **Add cron entry** in `crontab.txt` for news-agent:
   ```
   */15 * * * * cd /home/z/my-project/news-agent && .venv/bin/python3 main.py --once >> /tmp/news_agent.log 2>&1
   ```
2. **Or run news-agent as a systemd service** with auto-restart.
3. **Fix news-agent NewsStore path**: Change `news-agent/data/news_store.py` line 11 from `DB_PATH = Path(__file__).parent.parent / 'data' / 'news.db'` to use `config/paths.py`'s `NEWS_DB` constant.
4. **Purge the 4,428 foreign AlphaVantage articles** from `news.db` — they have no EGX relevance and pollute the news feed.

### R2 — Fix News-Agent / Canonical DB Sync (P0)
1. **Fix `egx_news_scraper.py`** to write to `market_news` table (canonical) instead of creating a new `news` table.
2. **Fix `marketmaker_news_scraper.py`** to use `config/paths.py` for output path (remove hardcoded Windows path).
3. **Enable `ENABLE_EGYPTIAN_SOURCES=1`** in news-agent env to activate alborsaanews collector.
4. **Configure Telegram credentials** (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`) to activate `telegram_collector.py` for 13 EGX channels.

### R3 — Repair Missing Tables (P1)
1. **Create `news_signals` table in `predictions.db`** matching the schema expected by `/api/news-feed/route.ts` (columns: id, title, body, source, url, published_at, tickers, importance, sentiment, impact_type, summary_ar, reasoning, received_at).
2. **Replace `news_items` references in `news_stop_filter.py`** with `market_news` (the actual table name).
3. **Migrate `news_articles` table data to `market_news`** then DROP `news_articles` to remove duplication.

### R4 — Restore Sentiment/Importance Analysis (P0)
1. **Run `news_analyzer.py` against all unanalyzed `market_news` rows** (importance = 0) — backfill sentiment, importance, tickers, summary_ar.
2. **Verify Ollama availability** or permanently switch to DeepSeek API for Arabic news analysis (since Ollama is documented as broken on production CPU per `KILL-OLLAMA` flag).
3. **Run ticker extraction** (`extract_tickers_accurately`) against all 4,428 articles — many GNews Arabic articles mention EGX stocks by name but lack ticker linkage.

### R5 — Fix RSS Sources (P2)
1. **Replace broken RSS sources** (argaam, amwal, youm7) with HTML scrapers since they return HTML instead of RSS.
2. **Add new high-quality sources**:
   - `Mubasher.info` HTML scraping (currently blocked by Cloudflare — add proper headers + retry)
   - `Reuters Arabic` RSS feed
   - `Bloomberg Arabic` RSS
   - `Enterprise Press` (egyptianstreets.com/enterprise)
3. **Disable `investing_news_collector.py.disabled`** and `investing_scraper.py.disabled` once Playwright is installed.

### R6 — Add News Digest & Breaking News Alerts (P3)
1. **Daily morning news digest**: at 05:00 Cairo time, send top 5 EGX-relevant news from past 24h to Telegram channel as a single "📰 نبض البورصة اليوم" message.
2. **Breaking news alerts**: when `news_impact_scorer` returns VETO verdict (e.g., INVESTIGATION_FRAUD, TRADING_HALT), immediately push Telegram alert.
3. **CBE decision alerts**: when news contains "بنك مركزي" / "أسعار الفائدة" / "CBE", send priority alert.
4. **News-based alert subscription**: allow users to subscribe to news alerts for their watchlist tickers.

### R7 — Enable News Impact on V40.2 (P3)
1. **Set `V40_2_NEWS_IMPACT=1`** in production env once news collection is restored and articles have sentiment/importance populated.
2. **Verify `news_impact_scorer` integration** by running test predictions on a stock with recent catalyst news (e.g., dividend announcement).
3. **Add news verdict to prediction proof string** for transparency in the Telegram published predictions.

### R8 — Improve Frontend EGX Filter (P2)
1. **Replace source-string matching** with `market = 'EGX'` filter at SQL query level (already supported by API).
2. **Auto-classify articles as EGX** during collection: if title contains Arabic EGX keywords (البورصة, البورصة المصرية, EGX, مصر, Cairo, etc.), set `market = 'EGX'`.
3. **Show source-quality badges**: distinguish "موثوق" (trusted: Alborsaa, Mubasher, Reuters) from "بحث ويب" (DuckDuckGo) in the UI.

### R9 — Implement Stock-Specific News Linking (P1)
1. **Run ticker extraction** on all collected news (currently 0 articles have tickers).
2. **Verify `/api/stocks/COMI/news` returns real articles** by querying `market_news WHERE tickers LIKE '%"COMI"%'`.
3. **Add news section to StockDetail page** showing per-stock news with sentiment distribution chart (the `StockNews.tsx` component already supports this — just needs data).

---

## Summary Statistics

| Metric | Value | Health |
|---|---|---|
| Total articles in news.db | 4,428 | ⚠️ All foreign/mixed |
| Articles with EGX market tag | 0 / 4,428 | ❌ Critical |
| Articles with sentiment | 0 / 4,428 | ❌ Critical |
| Articles with importance > 0 | 0 / 4,428 | ❌ Critical |
| Articles with tickers | 0 / 4,428 | ❌ Critical |
| Articles flagged as catalyst | 0 / 4,428 | ❌ Critical |
| News collection cron entries | 0 | ❌ Critical |
| News-agent service status | not running | ❌ Critical |
| Telegram publishing rate | 0 messages / cycle | ❌ Critical |
| Days since last fresh news | ~108 days | ❌ Critical |
| News sources declared | 13 (Telegram) + 5 (RSS) + 4 (web) | ✅ Good coverage |
| News sources actually pulling data | 3 (AlphaVantage, GNews, NewsAPI) | ❌ None are EGX-specific |
| News tables in canonical DB | 4 (news_articles, market_news, news_api_keys, sqlite_sequence) | ⚠️ Duplicated + empty |
| News tables referenced but missing | 3 (news_signals, news_items, news_agent_articles) | ❌ Architectural debt |
| V40.2 news impact enabled | false (env default 0) | ⚠️ Disabled |
| News fetcher source priority | 3 tiers (production / DB / DuckDuckGo) | ✅ Good fallback design |
| News impact event taxonomy | 13 EGX-calibrated types | ✅ Excellent design |
| News UI components | 2 (NewsFeedView 891 LOC, StockNews 617 LOC) | ✅ Rich UI |
| News API endpoints | 9 routes | ✅ Comprehensive |
| News publishing filter quality | 4 strict criteria | ✅ Well-designed |
| News digest / breaking alerts | 0 features | ❌ Missing |

---

## Conclusion

The EGX investment platform has a **comprehensive news system design** with excellent components (news impact scorer, ticker extraction, sentiment analyzer, multi-source collectors, Telegram publisher with strict filters). However, **the entire news collection pipeline is dormant**:

1. The news-agent service is not scheduled (no cron)
2. News.db contains only legacy foreign news (AlphaVantage S&P 500 / NYSE / TSX content) — 0% EGX-relevant
3. No sentiment, importance, tickers, or catalyst flags are populated on any article
4. News is 4+ months stale
5. News-agent's local DB (`news-agent/data/news.db`) doesn't even exist

The platform's news UI (NewsFeedView, StockNews) and backend analyzers (news_fetcher_analyzer, news_impact_scorer, live_news_integration) are well-built and ready to consume analyzed news — but the analysis pipeline has never produced any output.

**Highest-impact actions**:
1. **Schedule news-agent** to run every 15 minutes via cron or systemd
2. **Fix news-agent NewsStore path** to write to canonical `db/news.db`
3. **Purge foreign AlphaVantage articles** and replace with EGX-specific collection
4. **Run news_analyzer backfill** on any newly collected articles
5. **Enable `V40_2_NEWS_IMPACT=1`** once news has sentiment/importance populated

Without these fixes, the news system provides **zero value** to EGX investors and the frontend news feed displays irrelevant foreign stock news.
