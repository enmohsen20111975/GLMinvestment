# 02 — API Dictionary (قاموس الـ API)

> **المصدر الوحيد للحقيقة لكل HTTP endpoint في الـ Next.js layer.**
> كل الـ routes موجودة في `src/app/api/` (App Router). الإحصاء النهائي:
> **466 route** موزعة على ~100 section.
> **آخر تحديث:** 2026-10-27 | **Commit:** `ec41f61`

---

## 1. Overview

| | |
|---|---|
| **إجمالي الـ routes** | 466 (`src/app/api/**/route.ts`) |
| **الـ runtime** | Next.js 16 (App Router) + Bun |
| **البوابة الموحدة للـ DBs** | `src/lib/db-manager.ts` (`DbManager` namespace) |
| **الـ Brain** | Python backend (`vps-service/` + `data_engine/`) عبر `PYTHON_BACKEND_URL` |
| **الـ DBs المعزولة** | `price_history.db` (WAVE 1-3 purged) |

### المبدأ المعماري
الـ Next.js API routes بتلعب دورين:
1. **Thin proxy** → تحوّل الطلب للـ Python backend (`/api/python/[...path]`, `/api/proxy/[...path]`).
2. **Direct read** → بتقرأ من الـ DBs عبر `DbManager` (DAL المغلق).

> **Rule 20 (CONSTITUTION):** ممنوع `import Database from 'better-sqlite3'`
> في أي route. الـ DAL الوحيد هو `DbManager`. الـ route اللي بيكسر القاعدة
> بيُرفض في الـ review.

---

## 2. توزيع الـ Routes حسب القسم

| القسم | # Routes | الـ DB الأساسي | الدور |
|------|---------|---------------|-------|
| `admin/` | 88 | multiple (admin ops) | لوحة تحكم الإدارة |
| `market/` | 30 | stocks.db + Python proxy | بيانات السوق + المؤشرات |
| `predictions/` | 29 | predictions.db | التوقعات + honest tracking |
| `stocks/` | 20 | stocks.db | بيانات الأسهم + history |
| `mobile/` | 19 | proxy + stocks.db | API للموبايل (Flutter) |
| `maker-radar/` | 17 | maker_radar_*.json + stocks.db | رادار صانع السوق |
| `finance/` | 17 | finance.db (Prisma) | المالية + الالتزامات |
| `portfolio/` | 15 | stocks.db (stock_daily_prices) | المحفظة + rescue |
| `v2/` | 14 | Python proxy (unified engine) | V2 unified analysis |
| `crypto/` | 14 | data_engine.db.crypto_prices | العملات الرقمية |
| `subscription/` | 12 | auth.db + Paymob/Instapay | الاشتراكات + البوابات |
| `data-engine/` | 9 | data_engine.db | حالة محرك البيانات |
| `auth/` | 8 | auth.db | المصادقة (NextAuth) |
| `unified-learning/` | 6 | predictions.db | التعلّم الموحّد |
| `paper-trading-v2/` | 6 | paper-trading.db | تداول ورقي |
| `recommendations/` | 5 | predictions.db | التوصيات + backtest |
| `radar/` | 5 | predictions.db + json | رادار التوقعات |
| `alerts/` | 5 | alerts store | التنبيهات |
| `telegram/` | 4 | telegram.db | تكامل تيليجرام |
| `sniper/` | 4 | predictions.db | سكنابر فرص دقيقة |
| `ads/` | 4 | — | توليد إعلانات + screenshots |
| `persona/`, `paymob/`, `money/`, `maestro/`, `live-monitor/`, `expert-recommendations/`, `currency/`, `confluence/`, `bot/`, `ai/` | 3 each | mixed | أقسام مساعدة |
| باقي الأقسام (1–2 routes each) | ~85 | mixed | utilities + proxies |

> المجموع = 466 route.

---

## 3. Auth (`/api/auth/*`) — 8 routes

| Method | Endpoint | الوصف | Source DB |
|--------|----------|-------|-----------|
| `POST` | `/api/auth/login` | تسجيل دخول (email + password) | `auth.db.User` |
| `POST` | `/api/auth/register` | إنشاء حساب جديد | `auth.db.User` |
| `GET` | `/api/auth/me` | بيانات المستخدم الحالي (JWT) | `auth.db.Session` |
| `GET`/`POST` | `/api/auth/[...nextauth]` | NextAuth catch-all | `auth.db` |
| `POST` | `/api/auth/google-signin` | Google OAuth | `auth.db` |
| `GET` | `/api/auth/google` | بدء Google OAuth flow | `auth.db` |
| `POST` | `/api/auth/logout` | تسجيل خروج + حذف session | `auth.db.Session` |
| `GET`/`PATCH` | `/api/auth/profile` | بيانات + تعديل الملف الشخصي | `auth.db.User` |

---

## 4. Predictions (`/api/predictions/*`) — 29 routes

| Method | Endpoint | الوصف | Source DB |
|--------|----------|-------|-----------|
| `GET` | `/api/predictions` | قائمة التوقعات (filter: ticker, date, signal) | `predictions.db` |
| `POST` | `/api/predictions` | إنشاء توقع جديد | `predictions.db` |
| `GET` | `/api/predictions/honest-tracking` | التتبّع الصادق (thin wrapper) | `predictions.db` |
| `GET` | `/api/predictions/honest-tracking/list` | قائمة التتبّع | `predictions.db` |
| `GET` | `/api/predictions/honest-tracking/stats` | إحصائيات الأداء | `predictions.db` |
| `GET` | `/api/predictions/honest-tracking/live-tracking` | تتبّع لحظي | `predictions.db` |
| `GET` | `/api/predictions/honest-tracking/missed-opportunities` | فرص ضائعة | `predictions.db` |
| `GET` | `/api/predictions/honest-tracking/verify-pending` | تحقّق من المعلّقة | `predictions.db` |
| `POST` | `/api/predictions/honest-tracking/learn-from-errors` | تعلّم من الأخطاء | `predictions.db` |
| `GET` | `/api/predictions/tracking` | تتبّع عام | `predictions.db` |
| `GET` | `/api/predictions/tracking/list` | قائمة التتبّع | `predictions.db` |
| `GET` | `/api/predictions/tracking/stats` | إحصائيات | `predictions.db` |
| `POST` | `/api/predictions/tracking/verify` | تحقّق | `predictions.db` |
| `GET` | `/api/predictions/daily-picks` | أفضل اختيارات اليوم (DAL: predictions + stocks + regime) | `predictions.db` + `stocks.db` |
| `GET` | `/api/predictions/performance` | أداء التوقعات | `predictions.db` |
| `GET` | `/api/predictions/performance-dashboard` | لوحة الأداء | `predictions.db` |
| `GET` | `/api/predictions/expert-consensus` | إجماع الخبراء | `predictions.db` |
| `GET` | `/api/predictions/learned-lessons` | دروس متعلّمة | `predictions.db` |
| `POST` | `/api/predictions/refresh-v40` | تحديث V40 | `predictions.db` |
| `GET` | `/api/predictions/backtest-list` | قائمة backtests | `predictions.db` |
| `GET` | `/api/predictions/league-report` | تقرير الدوري الشهري | `predictions.db` |
| `GET` | `/api/predictions/monthly-league` | الدوري الشهري | `predictions.db` |
| `GET` | `/api/predictions/historical-trades` | صفقات تاريخية | `predictions.db` |
| `GET` | `/api/predictions/active-management` | إدارة نشطة | `predictions.db` |
| `GET` | `/api/predictions/eid` | توقعات موسمية | `predictions.db` |
| `GET`/`POST` | `/api/predictions/dual-track/*` | مسار مزدوج (list, stats, threshold, backtest) | `predictions.db` |
| `POST` | `/api/predictions/generate-all` | توليد كامل (admin) | `predictions.db` |

---

## 5. Stocks (`/api/stocks/*`) — 20 routes

| Method | Endpoint | الوصف | Source DB |
|--------|----------|-------|-----------|
| `GET` | `/api/stocks` | قائمة كل الأسهم + الأسعار الحالية | `stocks.db` (via DbManager) |
| `GET` | `/api/stocks/search` | بحث بالـ ticker/الاسم | `stocks.db` |
| `GET` | `/api/stocks/[ticker]` | تفاصيل سهم (proxy للـ Python) | Python backend |
| `GET` | `/api/stocks/[ticker]/history` | OHLCV تاريخي (fallback: `stocks.db`) | `stocks.db.stock_daily_prices` |
| `GET` | `/api/stocks/[ticker]/depth` | عمق السوق (DAL: stocks + intraday) | `stocks.db` + `intraday.db` |
| `GET` | `/api/stocks/[ticker]/comprehensive` | تحليل شامل | Python proxy |
| `GET` | `/api/stocks/[ticker]/unified` | تحليل موحّد | Python proxy |
| `GET` | `/api/stocks/[ticker]/recommendation` | توصية | Python proxy |
| `GET` | `/api/stocks/[ticker]/professional-analysis` | تحليل احترافي | Python proxy |
| `GET` | `/api/stocks/[ticker]/expert-analysis` | تحليل خبراء | Python proxy |
| `GET` | `/api/stocks/[ticker]/news` | أخبار السهم | `news.db` |
| `GET` | `/api/stocks/[ticker]/orderbook` | دفتر الأوامر | `intraday.db` |
| `POST` | `/api/stocks/[ticker]/publish-data` | نشر بيانات (admin) | `stocks.db` |
| `GET` | `/api/stocks/delta-volume` | حجم الدلتا (thin wrapper: `data_engine.db`) | `data_engine.db` |
| `GET` | `/api/stocks/sparkline` | Sparkline (DAL: stock_daily_prices FIRST) | `stocks.db` |
| `GET` | `/api/stocks/advanced-analysis` | تحليل متقدم | Python proxy |
| `GET` | `/api/stocks/top-performers` | الأفضل أداءً | `stocks.db` |
| `GET` | `/api/stocks/data-coverage` | تغطية البيانات | `stocks.db` |
| `GET` | `/api/stocks/presets` | إعدادات مسبقة | `stocks.db` |
| `GET` | `/api/stocks/dual-persona/[ticker]` | شخصية مزدوجة | Python proxy |

---

## 6. Market (`/api/market/*`) — 30 routes

| Method | Endpoint | الوصف | Source DB |
|--------|----------|-------|-----------|
| `GET` | `/api/market/overview` | نظرة عامة على السوق (cached) | Python proxy |
| `GET` | `/api/market/summary` | ملخّص السوق | Python proxy |
| `GET` | `/api/market/status` | حالة السوق (مفتوح/مغلق) | `stocks.db` |
| `GET` | `/api/market/indices` | مؤشرات EGX30/70/100 | `stocks.db` |
| `GET` | `/api/market/indices/[symbol]/history` | تاريخ مؤشر | `stocks.db` |
| `GET` | `/api/market/indices/[symbol]/breakdown` | تفصيل مكوّنات المؤشر | `stocks.db` |
| `GET` | `/api/market/sectors` | القطاعات | `stocks.db` |
| `GET` | `/api/market/sectors/intelligence` | ذكاء القطاعات | Python proxy |
| `GET` | `/api/market/top-movers` | الأكثر تحرّكًا | `stocks.db` |
| `GET` | `/api/market/intraday-pressure` | ضغط جلسة اليوم | Python proxy |
| `GET` | `/api/market/investor-flows` | تدفقات المستثمرين | Python proxy |
| `GET` | `/api/market/liquidity-radar` | رادار السيولة | Python proxy |
| `GET` | `/api/market/liquidity-flow` | تدفّق السيولة | Python proxy |
| `GET` | `/api/market/regime` | نظام السوق (BULL/BEAR/SIDEWAYS) | Python proxy |
| `GET` | `/api/market/continuation/[ticker]` | استمرارية | Python proxy |
| `GET` | `/api/market/exit-status` | حالة الخروج | Python proxy |
| `GET` | `/api/market/gold` | سعر الذهب | `data_engine.db.gold_prices` |
| `GET` | `/api/market/metals-forex/summary` | معادن + فوركس | `data_engine.db` |
| `GET` | `/api/market/investing` | استثمار | Python proxy |
| `GET` | `/api/market/morning-bell` | جرس الصباح | Python proxy |
| `GET` | `/api/market/live-data` | بيانات لحظية | Python proxy |
| `GET` | `/api/market/report/daily` | تقرير يومي | Python proxy |
| `GET` | `/api/market/report/weekly` | تقرير أسبوعي | Python proxy |
| `GET` | `/api/market/recommendations/ai-insights` | رؤى AI | Python proxy |
| `GET` | `/api/market/connections` | ارتباطات | Python proxy |
| `GET` | `/api/market/sync` | مزامنة | `stocks.db` |
| `GET` | `/api/market/sync-live` | مزامنة لحظية | `stocks.db` |
| `GET` | `/api/market/incremental-sync` | مزامنة تزايدية | `stocks.db` |
| `GET` | `/api/market/scheduled-sync` | مزامنة مجدولة | `stocks.db` |
| `GET` | `/api/market/publish-status-image` | صورة حالة السوق | generated |

---

## 7. Portfolio (`/api/portfolio/*`) — 15 routes

| Method | Endpoint | الوصف | Source DB |
|--------|----------|-------|-----------|
| `GET` | `/api/portfolio` | المحفظة الكاملة | `portfolio-store` |
| `GET` | `/api/portfolio/holdings` | الحيازات | `portfolio-store` |
| `GET` | `/api/portfolio/master` | محفظة ماستر (DAL: stock_daily_prices PRIMARY) | `stocks.db.stock_daily_prices` |
| `GET` | `/api/portfolio/equity-curve` | منحنى Equity | `portfolio-store` |
| `GET` | `/api/portfolio/risk-summary` | ملخّص المخاطر | `portfolio-store` |
| `GET` | `/api/portfolio/cashflow` | التدفّق النقدي | `portfolio-store` |
| `GET` | `/api/portfolio/intelligence` | ذكاء المحفظة | Python proxy |
| `GET` | `/api/portfolio/accounts` | الحسابات | `portfolio-store` |
| `GET` | `/api/portfolio/accounts/[id]/equity-curve` | منحنى equity لحساب | `portfolio-store` |
| `GET`/`PATCH` | `/api/portfolio/accounts/[id]/state` | حالة الحساب | `portfolio-store` |
| `GET` | `/api/portfolio/watchlists` | قوائم المراقبة | `portfolio-store` |
| `GET` | `/api/portfolio/unified-watch` | مراقبة موحّدة | `portfolio-store` |
| `GET` | `/api/portfolio/smart-monitor/signals` | إشارات مراقبة ذكية | Python proxy |
| `GET` | `/api/portfolio/bag-holder-rescue` | إنقاذ الحيازات الخاسرة | Python proxy |
| `GET` | `/api/portfolio/rescue` | إنقاذ (DAL: stock_daily_prices + sharia via openDb) | `stocks.db` |

---

## 8. Maker-Radar (`/api/maker-radar/*`) — 17 routes

| Method | Endpoint | الوصف | Source DB |
|--------|----------|-------|-----------|
| `GET` | `/api/maker-radar` | الرادار الرئيسي | `maker_radar_*.json` + `stocks.db` |
| `GET` | `/api/maker-radar/stock` | سهم واحد | json + `stocks.db` |
| `GET` | `/api/maker-radar/stock-analysis` | تحليل سهم | json + `stocks.db` |
| `GET` | `/api/maker-radar/sector-treemap` | خريطة القطاعات | json |
| `GET` | `/api/maker-radar/net-picks` | أفضل اختيارات صافية | json + `stocks.db` |
| `GET` | `/api/maker-radar/signal-tracker` | متتبّع إشارات | `predictions.db` |
| `GET` | `/api/maker-radar/signal-tracker/verify` | تحقّق إشارة | `predictions.db` |
| `GET` | `/api/maker-radar/entry-timing` | توقيت الدخول | json + `stocks.db` |
| `GET` | `/api/maker-radar/exit-radar` | رادار الخروج | `predictions.db` |
| `GET` | `/api/maker-radar/footprint` | أثر صانع السوق | json |
| `GET` | `/api/maker-radar/fundamentals` | الأساسيات | `stocks.db` |
| `GET` | `/api/maker-radar/market-intelligence` | ذكاء السوق | json |
| `GET` | `/api/maker-radar/timeline` | الخط الزمني | json |
| `GET` | `/api/maker-radar/multi-market` | أسواق متعددة | json |
| `GET` | `/api/maker-radar/live-watch` | مراقبة لحظية | json + `stocks.db` |
| `GET` | `/api/maker-radar/track` | تتبّع | `predictions.db` |
| `POST` | `/api/maker-radar/warmup` | تسخين الكاش | json |

---

## 9. Admin (`/api/admin/*`) — 88 routes

أكبر قسم. لوحة تحكم الإدارة الكاملة. الأقسام الفرعية الرئيسية:

### 9.1 المصادقة + المستخدمين
| Method | Endpoint | الوصف | Source DB |
|--------|----------|-------|-----------|
| `POST`/`DELETE` | `/api/admin/auth` | login/logout للأدمن | `auth.db` |
| `POST` | `/api/admin/auth/token` | توليد token | `auth.db` |
| `GET` | `/api/admin/auth/auto-cookie` | cookie تلقائي | `auth.db` |
| `GET` | `/api/admin/users` | قائمة المستخدمين | `auth.db` |
| `PATCH`/`DELETE` | `/api/admin/users/[id]` | تعديل/حذف مستخدم | `auth.db` |
| `POST` | `/api/admin/users/[id]/promo` | ترقية | `auth.db` |
| `POST` | `/api/admin/users/cleanup-expired` | تنظيف منتهي الصلاحية | `auth.db` |

### 9.2 إدارة الـ DBs (db-manager)
| Method | Endpoint | الوصف | Source DB |
|--------|----------|-------|-----------|
| `GET` | `/api/admin/db` | قائمة الـ DBs | filesystem |
| `GET` | `/api/admin/db/[db]` | جداول DB | selected DB |
| `GET`/`POST` | `/api/admin/db/[db]/[table]` | صفوف جدول | selected DB |
| `DELETE` | `/api/admin/db/[db]/[table]/[row]` | حذف صف | selected DB |
| `GET`/`POST` | `/api/admin/db-manager` | حالة DbManager | `DbManager` |
| `GET`/`POST` | `/api/admin/db-manager/query` | استعلام | `DbManager` |
| `POST` | `/api/admin/db-manager/repair` | إصلاح | `DbManager` |
| `POST` | `/api/admin/db-manager/recover` | استرجاع | `DbManager` |
| `POST` | `/api/admin/db-manager/recover-all` | استرجاع الكل | `DbManager` |
| `GET` | `/api/admin/db-manager/schema` | schema | `DbManager` |
| `GET` | `/api/admin/db-manager/export` | تصدير | `DbManager` |
| `GET` | `/api/admin/db-manager/export-all` | تصدير الكل | `DbManager` |
| `POST` | `/api/admin/db-manager/import-all` | استيراد | `DbManager` |
| `POST` | `/api/admin/db-manager/backup` | نسخ احتياطي | `DbManager` |
| `POST` | `/api/admin/db-manager/restore` | استرجاع نسخة | `DbManager` |
| `DELETE` | `/api/admin/db-manager/delete-backup` | حذف نسخة | `DbManager` |
| `GET` | `/api/admin/db-manager/historical-backups` | نسخ تاريخية | `DbManager` |
| `POST` | `/api/admin/db-manager/reindex` | إعادة فهرسة | `DbManager` |
| `POST` | `/api/admin/db-manager/checkpoint-all` | WAL checkpoint | `DbManager.openDbWritable` |
| `POST` | `/api/admin/db-manager/truncate-table` | تفريغ جدول | `DbManager` |
| `POST` | `/api/admin/db-manager/drop-table` | حذف جدول | `DbManager` |

### 9.3 المحركات + النظام
| Method | Endpoint | الوصف | Source DB |
|--------|----------|-------|-----------|
| `GET`/`POST` | `/api/admin/engines/control` | تحكّم بالمحركات | Python proxy |
| `POST` | `/api/admin/engines/start-all` | تشغيل الكل | Python proxy |
| `POST` | `/api/admin/engines/stop-all` | إيقاف الكل | Python proxy |
| `GET` | `/api/admin/engines-status` | حالة المحركات | Python proxy |
| `GET`/`POST` | `/api/admin/engine-settings` | إعدادات المحركات | `predictions.db` |
| `POST` | `/api/admin/engine-settings/reset` | إعادة ضبط | `predictions.db` |
| `GET` | `/api/admin/system-health` | صحة النظام | multiple |
| `GET` | `/api/admin/system-topology` | طوبولوجيا النظام | multiple |
| `GET` | `/api/admin/system-resources` | موارد النظام (VACUUM via `openDbWritable`) | multiple |
| `GET` | `/api/admin/system-resources/history` | تاريخ الموارد | metrics |
| `GET` | `/api/admin/system-resources/anomalies` | شذوذ | metrics |
| `GET` | `/api/admin/system-resources/process-history` | تاريخ العمليات | metrics |
| `GET`/`POST` | `/api/admin/pm2-control` | تحكّم PM2 | PM2 |
| `GET` | `/api/admin/cron-health` | صحة الـ cron | crontab |

### 9.4 التوقعات + التحليل
| Method | Endpoint | الوصف | Source DB |
|--------|----------|-------|-----------|
| `POST` | `/api/admin/clean-predictions` | تنظيف التوقعات | `predictions.db` |
| `POST` | `/api/admin/close-predictions` | إغلاق توقعات | `predictions.db` |
| `POST` | `/api/admin/generate-predictions` | توليد توقعات | `predictions.db` |
| `POST` | `/api/admin/generate-historical-predictions` | توليد تاريخي | `predictions.db` |
| `POST` | `/api/admin/ai-analyze` | تحليل AI | Ollama/DeepSeek |
| `POST` | `/api/admin/ai-predictions/generate` | توليد AI predictions | `predictions.db` |
| `GET` | `/api/admin/daily-analysis` | تحليل يومي | Python proxy |
| `GET` | `/api/admin/validation` | تحقّق | multiple |
| `POST` | `/api/admin/ab-test` | A/B test | `predictions.db` |
| `GET` | `/api/admin/backtest/v40/run` | تشغيل backtest V40 | `predictions.db` |
| `GET` | `/api/admin/backtest/v40/status/[jobId]` | حالة job | `predictions.db` |
| `GET` | `/api/admin/backtest/v40/stats` | إحصائيات backtest | `predictions.db` |

### 9.5 البيانات + المزامنة
| Method | Endpoint | الوصف | Source DB |
|--------|----------|-------|-----------|
| `POST` | `/api/admin/sync-stocks-db` | مزامنة stocks.db | `stocks.db` |
| `POST` | `/api/admin/sync-vps` | مزامنة VPS | remote |
| `GET`/`POST` | `/api/admin/data-sources` | مصادر البيانات | `data_engine.db` |
| `GET` | `/api/admin/data-health` | صحة البيانات | multiple |
| `GET` | `/api/admin/news-health` | صحة الأخبار | `news.db` |
| `GET` | `/api/admin/investors-data` | بيانات المستثمرين | `data_engine.db` |
| `POST` | `/api/admin/import-indices-csv` | استيراد مؤشرات CSV | `stocks.db` |
| `POST` | `/api/admin/import-stocks` | استيراد أسهم | `stocks.db` |
| `POST` | `/api/admin/scrape-stocks` | scrape أسهم | `data_engine.db` |
| `POST` | `/api/admin/refresh-historical-data` | تحديث تاريخي | `stocks.db` |
| `GET` | `/api/admin/sources` | المصادر | `data_engine.db` |
| `GET` | `/api/admin/export-data` | تصدير بيانات | multiple |
| `GET` | `/api/admin/export-vps` | تصدير VPS | remote |
| `POST` | `/api/admin/fix-dates` | إصلاح تواريخ | `stocks.db` |
| `GET`/`POST` | `/api/admin/db-backup` | نسخ احتياطي DB | filesystem |
| `GET` | `/api/admin/db-backup/status` | حالة النسخ | filesystem |
| `POST` | `/api/admin/code-backup` | نسخ كود | git |
| `GET` | `/api/admin/code-backup/download` | تنزيل نسخة كود | git |
| `POST` | `/api/admin/purge-cache` | تنظيف الكاش | in-memory |

### 9.6 الباقي (~20 routes)
`/api/admin/analytics`, `/api/admin/news`, `/api/admin/platform-performance`,
`/api/admin/telegram-predictions`, `/api/admin/stats`, `/api/admin/promo-codes`,
`/api/admin/sharia/run`, `/api/admin/educational-cards/*`, `/api/admin/reports/*`.

---

## 10. Mobile (`/api/mobile/*`) — 19 routes

API مخصّص لتطبيق Flutter. أغلبها proxy أو thin read.

| Method | Endpoint | الوصف | Source DB |
|--------|----------|-------|-----------|
| `GET` | `/api/mobile/dashboard` | لوحة الموبايل الرئيسية | proxy + `stocks.db` |
| `GET` | `/api/mobile/portfolio` | المحفظة | `portfolio-store` |
| `GET` | `/api/mobile/portfolio/analyze` | تحليل المحفظة | Python proxy |
| `GET` | `/api/mobile/portfolio/intelligence` | ذكاء المحفظة | Python proxy |
| `GET` | `/api/mobile/watchlist` | قائمة المراقبة | `portfolio-store` |
| `GET` | `/api/mobile/watchlist/intelligence` | ذكاء القائمة | Python proxy |
| `GET` | `/api/mobile/stocks/[ticker]` | تفاصيل سهم | Python proxy |
| `GET` | `/api/mobile/stocks/[ticker]/professional-analysis` | تحليل احترافي | Python proxy |
| `GET` | `/api/mobile/stocks/[ticker]/recommendation` | توصية | Python proxy |
| `GET` | `/api/mobile/recommendations` | توصيات | `predictions.db` |
| `GET` | `/api/mobile/predictions` | توقعات | `predictions.db` |
| `GET` | `/api/mobile/news` | أخبار | `news.db` |
| `GET` | `/api/mobile/notifications` | إشعارات | `auth.db` |
| `GET`/`POST` | `/api/mobile/alerts/settings` | إعدادات تنبيهات | alerts store |
| `GET` | `/api/mobile/gold` | ذهب | `data_engine.db` |
| `GET` | `/api/mobile/gold/history` | تاريخ الذهب | `data_engine.db` |
| `GET` | `/api/mobile/crypto` | عملات رقمية | `data_engine.db` |
| `GET` | `/api/mobile/crypto/[id]` | تفاصيل عملة | `data_engine.db` |
| `GET` | `/api/mobile/zakat-calculator` | حاسبة الزكاة | computed |

---

## 11. باقي الأقسام المهمة

### 11.1 Finance (`/api/finance/*`) — 17 routes
إدارة مالية شخصية. الـ DB الأساسي: `finance.db` (Prisma).
- `/api/finance/assets`, `/api/finance/assets/[id]`
- `/api/finance/transactions`, `/api/finance/transactions/[id]`
- `/api/finance/obligations`, `/api/finance/obligations/payments`
- `/api/finance/reports`, `/api/finance/schema`, `/api/finance/projection`
- `/api/finance/screener`, `/api/finance/smart-analysis`, `/api/finance/smart-alerts`
- `/api/finance/smart-confluence`, `/api/finance/smart-watchlist`
- `/api/finance/calculate-values`, `/api/finance/real-return`, `/api/finance/inflation`

### 11.2 Crypto (`/api/crypto/*`) — 14 routes
الـ DB الأساسي: `data_engine.db.crypto_prices`.
- `/api/crypto`, `/api/crypto/coins`, `/api/crypto/[id]`, `/api/crypto/[id]/history`
- `/api/crypto/live`, `/api/crypto/stop`, `/api/crypto/simulation`, `/api/crypto/full-analysis`
- `/api/crypto/watchlist`, `/api/crypto/portfolio`, `/api/crypto/flow`, `/api/crypto/flow/[symbol]`
- `/api/crypto/explosive`, `/api/crypto/explosive/[symbol]`

### 11.3 V2 Unified (`/api/v2/*`) — 14 routes
Proxy للمحرك الموحّد V2 في Python.
- `/api/v2/unified/analyze`, `/api/v2/unified/scan`, `/api/v2/unified/config`
- `/api/v2/recommend`, `/api/v2/live-analysis`, `/api/v2/chart/full-analysis`
- `/api/v2/engines`, `/api/v2/presets`, `/api/v2/pipelines`
- `/api/v2/pipeline/[name]/summary`, `/api/v2/pipeline/[name]/engine/[engine]/toggle`
- `/api/v2/pipeline/[name]/engine/[engine]/weight`, `/api/v2/liquidity-radar`, `/api/v2/feedback/run`

### 11.4 Subscription (`/api/subscription/*`) — 12 routes
الـ DB الأساسي: `auth.db` + بوابات دفع (Paymob/Instapay/Google Play).
- `/api/subscription/plans`, `/api/subscription/status`, `/api/subscription/current`
- `/api/subscription/checkout`, `/api/subscription/activate`, `/api/subscription/verify`
- `/api/subscription/trial`, `/api/subscription/start-trial`, `/api/subscription/subscribe`
- `/api/subscription/upgrade`, `/api/subscription/check-access`, `/api/subscription/developer-request`

### 11.5 Data-Engine (`/api/data-engine/*`) — 9 routes
مراقبة + تحكّم في `data_engine.db`.
- `/api/data-engine/health`, `/api/data-engine/status`, `/api/data-engine/control`
- `/api/data-engine/stocks`, `/api/data-engine/gold`, `/api/data-engine/silver`
- `/api/data-engine/metals`, `/api/data-engine/forex`, `/api/data-engine/crypto`

### 11.6 Radar (`/api/radar/*`) — 5 routes
- `/api/radar/personalized`, `/api/radar/incubator`, `/api/radar/accuracy`
- `/api/radar/weekly-report`, `/api/radar/weekly-report/pdf`

### 11.7 Alerts (`/api/alerts/*`) — 5 routes
- `GET`/`POST` `/api/alerts`, `/api/alerts/[id]`, `/api/alerts/create`, `/api/alerts/quick-add`, `/api/alerts/scheduler`

### 11.8 Recommendations (`/api/recommendations/*`) — 5 routes
- `/api/recommendations`, `/api/recommendations/expert`, `/api/recommendations/backtest`
- `/api/recommendations/retroactive-evaluate`, `/api/recommendations/verify`

### 11.9 Paper-Trading-V2 (`/api/paper-trading-v2/*`) — 6 routes
- `/api/paper-trading-v2/account`, `/api/paper-trading-v2/positions`, `/api/paper-trading-v2/orders`
- `/api/paper-trading-v2/order`, `/api/paper-trading-v2/orders/[id]/close`, `/api/paper-trading-v2/reset`

### 11.10 AI (`/api/ai/*`) — 3 routes
- `POST` `/api/ai/chat` — محادثة AI (Ollama/DeepSeek)
- `POST` `/api/ai/analyze-stock` — تحليل سهم بالـ LLM
- `GET` `/api/ai/models` — النماذج المتاحة

### 11.11 باقي الأقسام (1–4 routes each)
`/api/telegram/*` (4), `/api/sniper/*` (4), `/api/ads/*` (4),
`/api/persona/*` (3), `/api/paymob/*` (3), `/api/money/*` (3),
`/api/maestro/*` (3), `/api/live-monitor/*` (3), `/api/expert-recommendations/*` (3),
`/api/currency/*` (3), `/api/confluence/*` (3), `/api/bot/*` (3),
`/api/user-posts/*` (3), `/api/unified-learning/*` (6),
`/api/watchlist/*` (2), `/api/unified/*` (2), `/api/trading-journal/*` (2),
`/api/sharia/*` (2), `/api/sectors/*` (2), `/api/risk/*` (2),
`/api/stored-analysis/*` (2), `/api/trade-results/*` (2),
وأقسام utility مفردة: `/api/health`, `/api/keepalive`, `/api/track`,
`/api/features`, `/api/feedback`, `/api/points`, `/api/zakat/calculate`,
`/api/i18n/set-locale`, `/api/push/register`, `/api/notifications`,
`/api/redeem-promo`, `/api/b2b/signup`, `/api/instapay`, `/api/google-play/verify-receipt`,
`/api/python/[...path]` (catch-all proxy), `/api/proxy/[...path]`, `/api/proxy-prod/[...path]`,
`/api/[...slug]` (404 fallback), وغيرها.

---

## 12. DAL Gateway (DbManager)

كل الـ routes اللي بتقرأ DB مباشرة لازم تمرّ عبر `src/lib/db-manager.ts`.
الـ namespace `DbManager` بيوفّر:

| Method | الوصف |
|--------|-------|
| `DbManager.openDb(file)` | فتح DB readonly — يرجع `null` لو مش موجود |
| `DbManager.openDbWritable(file)` | فتح DB writable (للـ VACUUM, UPDATE) |
| `DbManager.columnExists(db, table, col)` | فحص وجود column |
| `DbManager.getLiveSparkline(ticker)` | sparkline — أولوية `stock_daily_prices` |
| `DbManager.getLiveSparklines(tickers[])` | نسخة batch |
| `DbManager.getIncubatorData(market)` | بيانات الـ incubator (آخر json + فلترة قدم البيانات) |
| `DbManager.getUnifiedLogos(tickers[])` | كاش الأيقونات (logo_url + logoUrl) |
| `DbManager.getLogoUrl(ticker)` | أيقونة سهم واحد |
| `DbManager.enrichWithUnifiedLogos(rows)` | إضافة logos لصفوف |
| `DbManager.getActivePredictions()` | توقعات نشطة بدون تكرار ticker |
| `DbManager.getCompanyFundamentals(ticker)` | أساسيات شركة |
| `DbManager.getMarketTabData(market)` | بيانات تبويب السوق |

> **القاعدة:** لو الـ route محتاج DB access و`DbManager` مش فيه function مناسب →
> أضف function جديد في `db-manager.ts` (مش في الـ route).

---

## 13. الـ DBs المعزولة (price_history.db)

`price_history.db` **معزول** بعد WAVE 1-3. لا route جديد يقرأه.
الـ fallback labels في الـ comments مسموحة، لكن `new Database('price_history.db')`
ممنوع. التطهير شمل:

| الموجة | الملفات المتأثرة | الحالة |
|-------|------------------|--------|
| WAVE 1 | `hunting/`, `sniper/`, `jobs/` (Python) | ✅ مُنظّف |
| WAVE 2 | `portfolio/` (rescue, master), `predictions/` (daily-picks, honest-tracking), `stocks/[ticker]/history`, `stocks/delta-volume` | ✅ 6 routes مُنظّفة |
| WAVE 3 | `screener/advanced`, `stocks/[ticker]/depth`, `admin/system-resources` + `DbManager` namespace | ✅ مُختوم |

المصدر الأساسي الحالي للأسعار اليومية: **`stocks.db.stock_daily_prices`**
(Rule 10 — CONSTITUTION). الـ fallback الوحيد المسموح: `data_engine.db.egksco_price_history`.

---

## 14. Auth & Caching

### 14.1 Auth
- **User auth:** NextAuth (`/api/auth/[...nextauth]`) + JWT في `auth.db.Session`.
- **Admin auth:** `/api/admin/auth` (login/token) + cookie-based session.
- **Bot linking:** `/api/bot/link-token` + `/api/bot/check-subscription` (Telegram bot gate).
- **Subscription gate:** `src/lib/subscription-gate.ts` — يتحقّق من `auth.db.User.subscription_status`.

### 14.2 Caching
- **AnalysisCache** (per-ticker, TTL=60s) — في Python backend.
- **ApiResponseCache** (per-endpoint, TTL=60-300s) — في Python backend.
- **Next.js Data Cache** — `fetch()` مع `next: { revalidate }` في بعض routes.

---

## 15. See Also

| المرجع | المحتوى |
|--------|---------|
| `Documentation/00-CONSTITUTION.md` | الدستور (Rules 20–23 للـ DAL) |
| `Documentation/02-DATABASES-AND-DATA.md` | تفاصيل كل DB + ownership |
| `Documentation/02-HOW-IT-THINKS.md` | كيف يفكر النظام (الـ engines) |
| `Documentation/01-SCREENS-AND-COMPONENTS.md` | الشاشات اللي بتستهلك الـ APIs دي |
| `src/lib/db-manager.ts` | الـ DAL layer (البوابة الوحيدة للـ DBs) |
| `src/lib/python-backend.ts` | helper للـ Python proxy |
| `vps-service/api/` | الـ Python backend routes (Flask) |

---

*آخر تحديث: 2026-10-27 — 466 route موثّق. لو أضفت route جديد، حدّث القاموس ده.*
