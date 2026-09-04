# News Agent — Integrated Submodule

> **الوظيفة:** وكيل أخبار مالي محلي متخصص في بورصة مصر (EGX).
> يجمع الأخبار + بيانات الأسعار + الذهب من مصادر متعددة ويكتب في `db/` بتاع المشروع الرئيسي.
>
> **الأصل:** https://github.com/enmohsen20111975/news/
> **التكامل:** 2026-09-03 (Rule 28: NO-DUPLICATION — كل البيانات في `/home/z/my-project/db/`)

---

## 🎯 المصادر النشطة

| # | Scraper | المصدر | الـ Destination | الحالة |
|---|---------|--------|-----------------|--------|
| 1 | `tradingview_rest.py` | scanner.tradingview.com (REST API) | `db/data_engine.db.stocks` | ✅ نشط |
| 2 | `tradingview_scraper.py` | TradingView (Playwright) | `db/data_engine.db.stocks` | ⚠️ محتاج Playwright |
| 3 | `tradingview_screener_lists.py` | TradingView screener | `db/data_engine.db.screener_lists` | ✅ نشط |
| 4 | `tradingview_market_movers.py` | TradingView 9 tabs | `db/data_engine.db.market_movers_tabs` | ✅ نشط |
| 5 | `egx_news_scraper.py` | EGX official site | `db/news.db.market_news` | ✅ نشط |
| 6 | `marketmaker_news_scraper.py` | MarketMaker | `db/news.db.market_news` | ✅ نشط |
| 7 | `telegram_collector.py` | Telegram channels | `db/news.db.market_news` | ⚠️ محتاج telethon |
| 8 | `web_scraper.py` | Web scraping | `db/news.db.market_news` | ⚠️ محتاج trafilatura |

## 🚫 المعطّلة (محتفظ بيها بس مش نشطة)

| Scraper | السبب |
|---------|------|
| `rss_collector.py.disabled` | محتاج `feedparser` (مش مثبت في الساندبوكس) |
| `investing_scraper.py.disabled` | محتاج Playwright + chromium |
| `investing_news_collector.py.disabled` | محتاج Playwright + chromium |

## 📦 الـ DBs (Rule 28: NO-DUPLICATION)

كل الـ scrapers بتكتب في `/home/z/my-project/db/` (الـ canonical):

| DB | الـ scrapers اللي بتكتب فيها | المحتوى |
|----|------------------------------|---------|
| `db/data_engine.db` | tradingview_* | 975 سهم + 162,946 price history + screener lists |
| `db/news.db` | egx_news + marketmaker + telegram | 8,012 خبر في `market_news` |
| `db/stocks.db` | (sync.py من المشروع الرئيسي) | 1,047 سهم metadata |

## ⚙️ التشغيل

```bash
# TradingView REST (الأخف — urllib فقط)
cd news-agent
python3 collectors/scrappers/tradingview_rest.py

# TradingView screener lists
python3 collectors/scrappers/tradingview_screener_lists.py

# TradingView market movers (9 tabs)
python3 collectors/scrappers/tradingview_market_movers.py

# EGX news scraper
python3 collectors/scrappers/egx_news_scraper.py
```

## 🔧 الإعدادات

- `config/paths.py` — مسارات الـ DBs الموحدة (Rule 29: UNIFIED-SYSTEM)
- `config/sources.py` — قائمة المصادر

## 📊 الإحصائيات الحالية

- **EGX stocks**: 975 (from TradingView REST)
- **Price history**: 162,946 rows (egksco_price_history)
- **News**: 8,012 (7,800 original + 212 merged from news-agent)
- **Screener lists**: 1,459 entries (5 categories)

## 🚫 AI محلي (معطّل)

المشروع الأصلي كان بيستخدم Ollama للـ AI محلي. **إحنا مش محتاجينه** — V40.2 بيعتمد على rules + indicators (مش AI).
الـ `expert_recommendations` اللي فيها "تحليل مجمّع (AI محلي)" — اتـ preserve بس مش بنستخدمها في الـ production.
