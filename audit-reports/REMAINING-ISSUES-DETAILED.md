# 📋 التفصيل الكامل للمشاكل المتبقية
## تقسيم: الساندبوكس (كود) vs الكمبيوتر (بيانات)

> **تاريخ**: 2026-10-09  
> **المصدر**: Round 1 + Round 2 audit reports (10 فرق)  
> **الإجمالي**: 37 مشكلة متبقية

---

## 🟢 القسم الأول: مشاكل تتحل على الساندبوكس (كود فقط — آمنة)

دي مشاكل الكود اللي مفيهاش خطورة على البيانات. ممكن أصلحها دلوقتي وأرفعها على GitHub.

### P0 — حرجة (3 مشاكل)

| # | المشكلة | الملف | الإصلاح |
|---|---------|-------|---------|
| 1 | **news filter: `market_code` column مش موجود** | `src/app/api/news/route.ts` | fallback لو `market_code` مش موجود → استخدم `market` بس |
| 2 | **hardcoded admin emails في AdminView** | `src/modules/admin/components/AdminView.tsx:442` | استخدم `isAdmin()` من `admin-auth.ts` بدل hardcoded list |
| 3 | **PurgeCacheButton بدون confirmation** | `src/modules/admin/components/PurgeCacheButton.tsx:180` | إضافة `confirm()` dialog قبل الحذف |

### P1 — عالية (10 مشاكل)

| # | المشكلة | الملف | الإصلاح |
|---|---------|-------|---------|
| 4 | **daily query limit resets on restart** | `telegram_interactive_bot.py:532` | persist في `auth.db` بدل in-memory |
| 5 | **auto_poster لا يكتب audit trail** | `auto_poster.py` | إضافة `UPDATE predictions SET was_published=1` بعد كل post |
| 6 | **parse_mode inconsistency (md vs HTML)** | `auto_poster.py:236` | standardize على `'HTML'` |
| 7 | **TelegramBotClient orphaned** | `auto_poster.py` + `telegram_interactive_bot.py` | wire `TelegramBotClient` بدل inline |
| 8 | **send_photo بدون retry** | `auto_poster.py:319` | إضافة retry logic زي `send_message` |
| 9 | **no US MarketProfile في unified_config.py** | `vps-service/config/unified_config.py` | إضافة `MARKET_PROFILES['US']` |
| 10 | **5 duplicate alias maps** | `store.ts` + `market-data-access.ts` + 3 تانيين | توحيد على `market-utils.ts` |
| 11 | **hardcoded Windows path في scraper** | `marketmaker_news_scraper.py` | استبدال بـ `os.path.join(PROJECT_ROOT, ...)` |
| 12 | **3 broken RSS sources** | `news-health/route.ts:52-55` | استبدال بمصادر شغّالة |
| 13 | **V40_2_NEWS_IMPACT=0 (disabled)** | `daily_predictor.py:2247` | default → `'1'` |

### P2 — متوسطة (14 مشكلة)

| # | المشكلة | الملف | الإصلاح |
|---|---------|-------|---------|
| 14 | **ignoreBuildErrors: true** | `next.config.ts:7` | `false` + إصلاح TS errors |
| 15 | **ESLint all off** | `eslint.config.mjs` | re-enable rules تدريجياً |
| 16 | **20 god components >2000 line** | MakerRadarTab (3936) + EnhancedPortfolioView (3361) + 18 تانيين | split لـ sub-components |
| 17 | **~146 icon buttons بدون aria-label** | stock-analysis + admin components | إضافة `aria-label` |
| 18 | **0 React Query usages** (declared dep) | `package.json` | adopt أو remove |
| 19 | **934 `: any` types** | 250+ file | إضافة types صحيحة |
| 20 | **1196 console.* bypassing logger** | src/ | migrate لـ `logger.*` |
| 21 | **God store 1541 LOC** | `src/lib/store.ts` | split لـ slices |
| 22 | **9 overlapping HTTP clients** | src/lib/ | consolidate لـ 1-2 |
| 23 | **565 empty catch blocks** (with comments) | src/ | إضافة error handling |
| 24 | **215 broader blue-N violations** | 45 file | replace بـ emerald/slate |
| 25 | **3 unused @dnd-kit packages** | `package.json` | remove |
| 26 | **Lesson 8 label "متقدم" بدل "مبتدئ"** | `content/education/08*.md` | fix label |
| 27 | **AcademyView 3 different lesson counts** | `AcademyView.tsx` | unify لـ 22 |

**إجمالي الساندبوكس**: 27 مشكلة (كلها كود fixes — آمنة)

---

## 🔴 القسم الثاني: مشاكل لازم تتحل على الكمبيوتر (بيانات)

دي مشاكل فيها خطورة على البيانات الإنتاجية. لازم تشغلها على الـ laptop بنفسك.

### P0 — حرجة (4 عمليات)

#### 1. إضافة `market_code` column لـ `market_news` table
**السبب**: الكود بفلتر بـ `market_code` بس العمود مش موجود في الإنتاج  
**الخطر**: الـ API بيرجع 500 لو العمود مش موجود  
**التنفيذ**:
```bash
cd /root/GLMinvestment
# backup
cp db/news.db db/news.db.backup-$(date +%Y%m%d)

# إضافة العمود + populate من market field
sqlite3 db/news.db "ALTER TABLE market_news ADD COLUMN market_code TEXT;"
sqlite3 db/news.db "UPDATE market_news SET market_code = market WHERE market_code IS NULL;"
sqlite3 db/news.db "CREATE INDEX IF NOT EXISTS idx_market_news_market_code ON market_news(market_code);"

# تحقق
sqlite3 db/news.db "SELECT market_code, COUNT(*) FROM market_news GROUP BY market_code;"
```

#### 2. Drop duplicate tables (للسة موجودة في الإنتاج)
**التنفيذ**:
```bash
# predictions.db.aiPrediction (duplicate — نفس 9,339 صف في predictions)
sqlite3 db/predictions.db "DROP TABLE IF EXISTS aiPrediction;"

# stocks.db predictions + prediction_logs + stocks_backup
sqlite3 db/stocks.db "DROP TABLE IF EXISTS predictions;"
sqlite3 db/stocks.db "DROP TABLE IF EXISTS prediction_logs;"
sqlite3 db/stocks.db "DROP TABLE IF EXISTS stocks_backup;"

# news.db news_articles (duplicate — نفس 4,428 صف في market_news)
sqlite3 db/news.db "DROP TABLE IF EXISTS news_articles;"

# custom.db (Prisma tutorial default — 0 rows حقيقية)
rm -f db/custom.db
```

#### 3. إضافة indexes ناقصة (3 indexes)
**التنفيذ**:
```bash
# predictions.db (3 indexes معلنة في Prisma بس مش موجودة)
sqlite3 db/predictions.db "CREATE INDEX IF NOT EXISTS predictions_signal_idx ON predictions(signal);"
sqlite3 db/predictions.db "CREATE INDEX IF NOT EXISTS predictions_master_score_idx ON predictions(master_score);"
sqlite3 db/predictions.db "CREATE INDEX IF NOT EXISTS predictions_was_published_idx ON predictions(was_published);"

# data_engine.db (17 table بدون indexes)
sqlite3 db/data_engine.db "CREATE INDEX IF NOT EXISTS idx_crypto_prices_symbol ON crypto_prices(symbol);"
sqlite3 db/data_engine.db "CREATE INDEX IF NOT EXISTS idx_gold_prices_timestamp ON gold_prices(timestamp);"
sqlite3 db/data_engine.db "CREATE INDEX IF NOT EXISTS idx_historical_data_ticker ON historical_data(ticker);"

# stocks.db
sqlite3 db/stocks.db "CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker);"
sqlite3 db/stocks.db "CREATE INDEX IF NOT EXISTS idx_stock_daily_prices_ticker ON stock_daily_prices(ticker);"
```

#### 4. Prisma schema sync
**التنفيذ**:
```bash
cd /root/GLMinvestment
bunx prisma db push --schema=prisma/predictions-schema.prisma --accept-data-loss
bunx prisma db push --schema=prisma/auth-schema.prisma
bunx prisma generate
bunx prisma generate --schema=prisma/auth-schema.prisma
bunx prisma generate --schema=prisma/predictions-schema.prisma
```

### P1 — عالية (3 عمليات)

#### 5. تثبيت cron للـ news-agent
**السبب**: news-agent مش بيشتغل (مفيش cron) → 0 أخبار EGX  
**التنفيذ**:
```bash
# إضافة cron job
crontab -l > /tmp/crontab.txt
echo "*/15 * * * * cd /root/GLMinvestment && python3 news-agent/main.py >> /var/log/news-agent.log 2>&1" >> /tmp/crontab.txt
crontab /tmp/crontab.txt

# تفعيل V40_2_NEWS_IMPACT
echo "V40_2_NEWS_IMPACT=1" >> /root/GLMinvestment/.env

# إعادة تشغيل
pm2 restart python-backend
```

#### 6. تشغيل persona engine للـ TADAWUL
**السبب**: TADAWUL عنده 0 persona_predictions  
**التنفيذ**:
```bash
cd /root/GLMinvestment/vps-service
python3 -c "
from analyzers.persona_engines import analyze_gambler, analyze_investor
# شغّل على كل أسهم TADAWUL
import sqlite3
db = sqlite3.connect('../db/stocks.db')
tickers = db.execute(\"SELECT ticker FROM stocks WHERE market='TADAWUL'\").fetchall()
for (t,) in tickers:
    analyze_gambler(t, 'TADAWUL')
    analyze_investor(t, 'TADAWUL')
db.close()
"
```

#### 7. حذف 875 code references لـ DBs مش موجودة
**ملاحظة**: دي مش مشكلة على الإنتاج (DBs موجودة هناك) — بسsandbox-specific

### P2 — متوسطة (3 عمليات)

#### 8. Purge foreign news (AlphaVantage US/global)
**التنفيذ**:
```bash
# حذف الأخبار الأجنبية
sqlite3 db/news.db "DELETE FROM market_news WHERE market_code NOT IN ('EGX','TADAWUL','KSE','QSE','US','CRYPTO') OR market_code IS NULL;"
```

#### 9. تشغيل news_analyzer backfill
**التنفيذ**:
```bash
cd /root/GLMinvestment/news-agent
python3 -m news_analyzer --backfill
```

#### 10. إعادة تشغيل scrapers
**التنفيذ**:
```bash
cd /root/GLMinvestment/vps-service
python3 scrapers/egx_scraper.py
python3 scrapers/metals_forex_fetcher.py
python3 jobs/daily_predictor.py
```

**إجمالي الكمبيوتر**: 10 عمليات (كلها بيانات)

---

## 📊 ملخص نهائي

| القسم | العدد | الخطورة | المنفذ |
|-------|-------|---------|---------|
| 🟢 الساندبوكس (كود) | 27 | آمنة | أصلحها دلوقتي |
| 🔴 الكمبيوتر (بيانات) | 10 | خطيرة | المالك على laptop |
| **الإجمالي** | **37** | | |

## 🎯 ترتيب التنفيذ الموصى به

### على الساندبوكس (أنا هعملها):
1. news filter fallback (لو market_code مش موجود)
2. hardcoded admin emails → isAdmin()
3. PurgeCacheButton confirmation
4. daily query limit persistence
5. auto_poster audit trail
6. parse_mode standardization
7. send_photo retry
8. US MarketProfile
9. 5 duplicate alias maps
10. ignoreBuildErrors → false
11. aria-labels (146 buttons)
12. remove unused deps

### على الكمبيوتر (أنت تعملها):
1. إضافة `market_code` column (أهم واحد!)
2. Drop duplicate tables
3. Add missing indexes
4. Prisma schema sync
5. تثبيت cron للـ news-agent
6. تفعيل V40_2_NEWS_IMPACT=1
7. persona engine للـ TADAWUL
8. Purge foreign news
9. news_analyzer backfill
10. إعادة تشغيل scrapers
