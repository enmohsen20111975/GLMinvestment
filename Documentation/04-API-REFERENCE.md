<div dir="rtl">

# 04 — مرجع الـ API الكامل (API Reference)

> **المصدر:** `src/app/api/**/route.ts` (464 route) + `vps-service/lightweight_server.py` + `vps-service/api/*.py` (39 blueprint، ~448 route) + `vps-service/main.py` (FastAPI) + `data_engine/main.py` (Flask).
>
> **آخر تحديث:** 2026-10-24 — مكتوب من الكود الحي مباشرةً. أي تعارض بين هذا الملف والتوثيق المؤرشف — هذا هو الصحيح (Rule 22 SSOT).

---

## 📑 فهرس المحتويات

1. [النظرة العامة (Overview)](#1-النظرة-العامة-overview)
2. [الشكل الكنسي للاستجابة (Canonical Response Shape)](#2-الشكل-الكنسي-لاستجابة-canonical-response-shape)
3. [نموذج المصادقة (Auth Model)](#3-نموذج-المصادقة-auth-model)
4. [البوابة: نمط XTransformPort (Gateway Pattern)](#4-البوابة-نمط-xtransformport-gateway-pattern)
5. [طرق الـ Proxy الثلاثة (The 3 Proxy Routes)](#5-طرق-الـ-proxy-الثلاثة-the-3-proxy-routes)
6. [طرق Next.js (464 Route) — مُجمَّعة حسب الموديول](#6-طرق-nextjs-464-route--مجمّعة-حسب-الموديول)
7. [طرق Python Flask Blueprints (≈448 Route)](#7-طرق-python-flask-blueprints-448-route)
8. [طرق FastAPI (Portfolio + AI Routers)](#8-طرق-fastapi-portfolio--ai-routers)
9. [طرق Data Engine (Flask Port 5000)](#9-طرق-data-engine-flask-port-5000)
10. [طبقة الـ Caching](#10-طبقة-الـ-caching)
11. [روابط سريعة (Quick Links)](#11-روابط-سريعة-quick-links)

---

## 1. النظرة العامة (Overview)

النظام يقدم **≈912 endpoint** موزّعة كالتالي:

| المصدر | العدد | المنفذ | الـ runtime |
|---|---|---|---|
| Next.js App Router (`src/app/api/**/route.ts`) | **464** | 3000 | Node.js / Vercel |
| Python Flask Blueprints (`vps-service/api/*.py`) | **~448** | 8010 (مُحَمَّل تحت FastAPI) | Flask + a2wsgi |
| FastAPI routers (`vps-service/main.py` + `ai/portfolio_routes.py`) | **9** | 8010 | Uvicorn (FastAPI) |
| Data Engine (`data_engine/main.py`) | **19** | 5000 | Flask |
| **الإجمالي** | **≈940** | — | — |

### قاعدة التوجيه الحاكمة (Rule 20 — Python=Brain)

> Next.js **ما بيعملش أي منطق** — كل حساب/تحليل/قرار بيتولّد في Python على `:8010`. أي route في Next.js:
> - **إمّا endpoint واجهة خاص (auth, subscription, watchlist, mobile-specific) → بـ يقرأ من SQLite مباشرة** عبر Prisma / better-sqlite3.
> - **أو proxy شفّاف → Python** عبر `/api/proxy/[...path]` أو `/api/python/[...path]`.
>
> أي حساب في الواجهة = مخالفة Rule 20.

---

## 2. الشكل الكنسي للاستجابة (Canonical Response Shape)

كل الطرق (Python + Next.js) بتتبع نفس القالب الكنسي (Rule 22 SSOT):

```jsonc
{
  "success": true,                  // boolean — مطلوب
  "source": "stocks.db|predictions.db|data_engine.db|python-v40.2|ai|…",
  "data": { /* الـ payload الفعلي */ },
  "meta": {
    "cached": false,                 //ApiResponseCache: true لو من cache
    "cache_ttl": 300,                // TTL بالثواني (لو cached)
    "timestamp": "2026-10-24T12:00:00Z",
    "market_filter": "EGX",          // اختياري
    "request_id": "req_abc123"       // من middleware.ts (X-Request-ID)
  }
}
```

**حالة الخطأ (canonical error):**

```jsonc
{
  "success": false,
  "error": "internal_error|not_found|forbidden|rate_limit_exceeded|…",
  "detail": "human-readable message",
  "error_ar": "رسالة عربية للمستخدم النهائي"  // اختياري في proxy-prod
}
```

| HTTP Status | الاستخدام |
|---|---|
| `200 OK` | نجاح |
| `201 Created` | POST أنشأ كائن (نادر — أغلب POST بترجع 200) |
| `204 No Content` | DELETE نجح أو OPTIONS preflight |
| `400 Bad Request` | params/body غير صحيح |
| `401 Unauthorized` | لا يوجد session صالحة |
| `403 Forbidden` | المستخدم مسجّل لكن مش admin / لا يملك صلاحية |
| `404 Not Found` | المسار غير موجود (JSON 404 من `[...slug]` catch-all) |
| `405 Method Not Allowed` | proxy-prod مع POST/PUT/DELETE (للقراءة فقط) |
| `409 Conflict` | تكرار (مثلاً: مستخدم مسجّل مسبقاً) |
| `429 Too Many Requests` | rate limit (proxy-prod: 30/دقيقة) |
| `500 Internal Server Error` | خطأ في الكود |
| `502 Bad Gateway` | Python backend غير قابل للوصول (من proxy) |
| `503 Service Unavailable` | DB مقفولة / sqlite_cantopen / python غير شغّال |
| `410 Gone` | maestro endpoints (معطّلة — V40.2 هو العقل الوحيد) |

---

## 3. نموذج المصادقة (Auth Model)

النظام يستخدم **3 طبقات مصادقة مستقلة**:

### 3.1 — NextAuth.js (User Sessions)
- الـ middleware: `src/middleware.ts` (Edge runtime).
- الـ route: `src/app/api/auth/[...nextauth]/route.ts`.
- التخزين: `db/auth.db.Session` (Prisma `auth-schema.prisma`).
- الـ cookies: `next-auth.session-token` (httpOnly, secure في HTTPS).
- Env vars:
  - `NEXTAUTH_SECRET` — **إلزامي في الإنتاج**. fallback للـ sandbox فقط: `glminvestment-dev-fallback-secret-2026`.
  - `NEXTAUTH_URL` — مثلاً `https://invist.m2y.net`.
  - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — لـ Google OAuth.

### 3.2 — Admin Guard (requireAdminAsync)
- الـ file: `src/lib/admin-auth-server.ts`.
- يتحقّق بـ 3 طرق (مُرتّبة):
  1. `admin_session` cookie صحيح (HMAC-signed).
  2. `X-Admin-Token` header مطابق لـ `ADMIN_SESSION_TOKEN` env.
  3. NextAuth session للمستخدم admin (Role=admin في `auth.db.User`).
- في **production** (`NODE_ENV=production`)، الـ bypass لـ localhost **معطّل** — ما يقدرش أي request خارجي يصل لـ admin endpoints بدون cookie/token حقيقي.
- Env vars:
  - `ADMIN_USERNAME`, `ADMIN_PASSWORD` — لـ admin login page.
  - `ADMIN_SESSION_TOKEN` — token ثابت للـ API programmatic.
  - `ADMIN_EMAIL` — لأجل bypass المحذور في الإنتاج.
  - `ALLOW_ADMIN_BYPASS=true` — لتطوير محلي فقط.

### 3.3 — Python Auth Middleware
- الـ file: `vps-service/core/auth_middleware.py`.
- الـ decorators: `@require_auth` + `@require_admin`.
- التحقّق:
  - JWT في `Authorization: Bearer <token>` → validated ضد `auth.db.Session`.
  - `X-API-Key: <PROXY_API_KEY>` — للـ internal calls من Next.js (passed via `/api/proxy/*`).
  - `X-Admin-Session: <admin_cookie>` — forwarded من `/api/proxy/admin/*` لو الـ user admin.
  - **معطّل**: الـ trust لـ `127.0.0.1` كان بـ يـ bypass أي admin check — اتصلح في SEC-04 (الـ proxy الـ admin بيـ gate على Next.js أولاً).

### 3.4 — تصنيف الـ endpoints حسب الـ auth

| المستوى | الوصف | أمثلة |
|---|---|---|
| 🔓 **public** | ما فيش auth — أي حد يقدر يصل | `/api/health`, `/api/market/overview`, `/api/stocks`, `/api/predictions/eid` |
| 👤 **user** | يتطلب NextAuth session فعّالة | `/api/portfolio`, `/api/watchlist`, `/api/notifications`, `/api/subscription/current` |
| 🛡️ **admin** | يتطلب admin session/token | `/api/admin/*` (الـ 56+ route), `/api/proxy/admin/*` |
| 🔑 **bot** | يتطلب `BOT_API_SECRET` (للـ Telegram bot) | `/api/bot/*`, `/api/bot/link-token`, `/api/bot/check-subscription` |
| 💳 **webhook** | HMAC signature من Paymob | `/api/paymob/callback` (يتحقق `PAYMOB_HMAC`) |

---

## 4. البوابة: نمط XTransformPort (Gateway Pattern)

الـ production gateway هو **Caddy على port 81**. القاعدة في `Caddyfile`:

```caddy
:81 {
    # لو فيه ?XTransformPort=<port> في الـ query → وجّه الطلب لـ localhost:<port>
    @transform_port_query {
        query XTransformPort=*
    }
    handle @transform_port_query {
        reverse_proxy localhost:{query.XTransformPort} {
            header_up Host {host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
            header_up X-Real-IP {remote_host}
        }
    }

    # default → Next.js على 3000
    handle {
        reverse_proxy localhost:3000 { … }
    }
}
```

### كيف يعمل؟

1. الـ browser بـ يطلب من `https://invist.m2y.net/api/multi-market/sync?XTransformPort=8010`.
2. Caddy يشوف `?XTransformPort=8010` في الـ query → يعمل reverse_proxy لـ `localhost:8010` (Python مباشرةً).
3. Caddy بـ يـ strips الـ query عن الـ Python (عشان ما يأثرش على Flask parsing).
4. الـ browser بـ يستلم الرد من Python مباشرةً — **بدون ما Next.js يشارك**.

### ليه؟

- **تجاوز Next.js**: للـ endpoints اللي Python-only (مثل `/api/multi-market/sync`)، ما فيش داعي لـ Next.js يعمل proxy. السرعة + السرعة.
- **الـ admin tabs**: TelegramTab بـ يتصل بـ `/?XTransformPort=3003` (telegram-events service) مباشرةً عبر Socket.io.
- **الـ portfolio advanced**: `AdvancedPortfolioManager` بـ يـ call Python مباشرةً على `:8010` عبر `?XTransformPort=8010`.
- **الـ WebSocket**: `ws-client.ts` بـ يـ connect `/?XTransformPort=3005` لـ ws-service.
- **dev mode**: على اللابتوب (بدون Caddy)، الـ Next.js proxy routes بتـ تـ handle الـ request عادي.

### البورتات المتاحة عبر XTransformPort

| Port | الخدمة | الـ URL pattern |
|---|---|---|
| `3000` | Next.js (default) | `https://invist.m2y.net/api/...` (بدون XTransformPort) |
| `3003` | telegram-events (Socket.io) | `/?XTransformPort=3003` |
| `3005` | ws-service (Socket.io) | `/socket.io/?XTransformPort=3005` |
| `5000` | data-engine (Flask) | `/api/data-engine/...?XTransformPort=5000` |
| `8010` | Python backend (FastAPI + Flask) | `/api/...?XTransformPort=8010` |
| `11434` | Ollama (LLM محلي) | `http://127.0.0.1:11434` (داخلي فقط — ما ينفذش عبر Caddy) |

### الـ safe pattern في الكود (Rule 211)

```ts
// ❌ خطأ: ما تستخدمش localhost:8010 في الـ frontend
fetch('http://localhost:8010/api/market/overview')

// ✅ صحيح: relative URL + XTransformPort
fetch('/api/market/overview?XTransformPort=8010')

// ✅ أو: proxy عبر Next.js (default)
fetch('/api/python/market/overview')
fetch('/api/proxy/market/overview')
```

---

## 5. طرق الـ Proxy الثلاثة (The 3 Proxy Routes)

الـ 3 routes هي **الجسر** بين Next.js و Python. كلها تعمل بنفس `proxyRequest` handler.

### 5.1 — `/api/proxy/[...path]` (الـ canonical proxy)

| الخاصية | القيمة |
|---|---|
| الـ methods | `GET, POST, PUT, DELETE, PATCH, OPTIONS` |
| الـ runtime | `nodejs` (force-dynamic) |
| الـ target | `process.env.PYTHON_BACKEND_URL` (default `http://localhost:8010`) |
| الـ auth | Admin paths (`/api/proxy/admin/*`) بتـ gate عبر `requireAdminAsync` → 403 لو مش admin |
| الـ headers المُمرَّرة | `content-type`, `accept`, `authorization` |
| الـ headers المحذوفة | hop-by-hop (`connection`, `keep-alive`, `transfer-encoding`, `upgrade`, …) |
| الـ forwarded extras | `X-API-Key: <PROXY_API_KEY>` (لو موجود), `X-Admin-Session: <admin_cookie>` (لو موجود) |
| الـ CORS | same-origin فقط (ACAO = request Origin لو matches Host, not `*`) |
| الـ failure | 502 + `{detail: 'Backend service unavailable', error: 'internal_error'}` |
| الـ special cases | `/api/proxy/health` و `/api/proxy/keepalive` بيـروحوا لـ root (`/health` و `/keepalive`) مش `/api/health` |

**السلوك الأمني (SEC-04 HOTFIX):**
- `PROXY_API_KEY` مش hardcoded — بـ يقرأ من env بس. لو مش متعرّف، الـ proxy شغّال للـ public endpoints بس، admin endpoints محتاجة admin session.
- Admin paths محتاجة `requireAdminAsync` قبل التوجيه — يقطع سلسلة "public → localhost → Python admin".
- في الإنتاج (`NODE_ENV=production`)، الـ bypass لـ localhost معطّل.

### 5.2 — `/api/python/[...path]` (الـ alias — unified)

| الخاصية | القيمة |
|---|---|
| الـ methods | `GET, POST, PUT, DELETE, PATCH, OPTIONS` |
| الـ runtime | `nodejs` (force-dynamic) |
| الـ behavior | **identical** لـ `/api/proxy/*` — بـ يستدعي نفس `proxyRequest` |
| الـ history | كان في الأصل 308 redirect لـ `/api/proxy/*`، اتعمل fix في `REDIRECT-FIX` (2026-08-30) لأن الـ redirect كان بـ يـ break production behind Caddy (`net::ERR_SSL_PROTOCOL_ERROR`) |
| الـ special case | `/api/python/v4/stats` بـ يـ intercept ويعمل fallback لـ SQLite (`handleV4Stats`) لو Python مش شغّال (5s timeout) |

**للتوثيق الكامل شوف `Documentation/03-REFACTORING_REPORT.md` §P0.3 + §13 Example 3.**

### 5.3 — `/api/proxy-prod/[...path]` (الـ read-only proxy للإنتاج)

| الخاصية | القيمة |
|---|---|
| الـ methods | **GET فقط** — POST/PUT/DELETE بترجع 405 |
| الـ target | `process.env.PRODUCTION_SERVER_URL` (default `https://invist.m2y.net`) |
| الـ auth | ما فيش — public read-only |
| الـ rate limit | **30 req/min/IP** (in-memory). تجاوز → 429 + `Retry-After` |
| الـ timeout | 15s (`AbortSignal.timeout(15000)`) |
| الـ allowlist | 30+ prefix (news-feed, stocks, market, predictions, mobile, gold, currency, flow, explosive, unified-stocks, topology, health, keepalive, …) |
| الـ blocked | أي path يبدأ بـ `admin/` (defense in depth) |
| الـ headers | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-Proxied-From` |
| الـ failure | 502 + `{error: 'production_unavailable', error_ar: 'تعذر الوصول للسيرفر الإنتاجي'}` |

**الـ use case:** الساندبوكس / mobile dev / dashboard preview بـ يقرأ داتا حقيقية من الإنتاج بدل الـ stale local DBs.

```bash
# مثال: اقرأ news من الإنتاج في الساندبوكس
curl /api/proxy-prod/news-feed?limit=20
curl /api/proxy-prod/stocks?market=EGX
curl /api/proxy-prod/market/overview
```

---

## 6. طرق Next.js (464 Route) — مُجمَّعة حسب الموديول

الـ 464 route موزّعة على **267 top-level directory** تحت `src/app/api/`. التالي قائمة شاملة بكل route (الـ method الافتراضي `GET` لو ما اتـ ذكرش غيره).

### 6.1 — Admin Module (83 route under `/api/admin/*`)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/admin/ab-test` | GET, POST | A/B testing framework |
| `/api/admin/ai-analyze` | POST | تشغيل تحليل AI |
| `/api/admin/ai-predictions/generate` | POST | توليد توقعات AI |
| `/api/admin/analytics` | GET | إحصائيات admin |
| `/api/admin/auth` | GET, POST | تسجيل دخول admin |
| `/api/admin/auth/auto-cookie` | POST | set admin cookie تلقائياً |
| `/api/admin/auth/token` | POST | exchange credentials لـ token |
| `/api/admin/backtest/v40/run` | POST | تشغيل V40 backtest |
| `/api/admin/backtest/v40/stats` | GET | إحصائيات V40 backtest |
| `/api/admin/backtest/v40/status/[jobId]` | GET | status لـ backtest job |
| `/api/admin/clean-predictions` | POST | تنظيف التوقعات الفاسدة |
| `/api/admin/close-predictions` | POST | إغلاق التوقعات اليدوي |
| `/api/admin/code-backup` | GET, POST | backup للكود |
| `/api/admin/code-backup/download` | GET | download zip |
| `/api/admin/cron-health` | GET | حالة الـ cron jobs |
| `/api/admin/daily-analysis` | POST | تشغيل التحليل اليومي |
| `/api/admin/data-health` | GET | فحص صحة الداتا |
| `/api/admin/data-sources` | GET | قائمة مصادر البيانات |
| `/api/admin/db-backup` | GET, POST | backup الـ DBs |
| `/api/admin/db-manager/backup` | POST | backup عبر db-manager |
| `/api/admin/db-manager/checkpoint-all` | POST | WAL checkpoint لكل DBs |
| `/api/admin/db-manager/delete-backup` | POST | حذف backup |
| `/api/admin/db-manager/drop-table` | POST | drop table |
| `/api/admin/db-manager/export-all` | GET | export الكل |
| `/api/admin/db-manager/export` | GET | export DB واحد |
| `/api/admin/db-manager/historical-backups` | GET | list historical backups |
| `/api/admin/db-manager/import-all` | POST | import الكل |
| `/api/admin/db-manager/query` | POST | SQL query |
| `/api/admin/db-manager/recover-all` | POST | recover الكل |
| `/api/admin/db-manager/recover` | POST | recover DB واحد |
| `/api/admin/db-manager/reindex` | POST | reindex |
| `/api/admin/db-manager/repair` | POST | repair DB |
| `/api/admin/db-manager/restore` | POST | restore من backup |
| `/api/admin/db-manager/route` | GET | db-manager root |
| `/api/admin/db-manager/schema` | GET | schema inspection |
| `/api/admin/db-manager/truncate-table` | POST | truncate |
| `/api/admin/db/[db]` | GET | list tables in DB |
| `/api/admin/db/[db]/[table]` | GET, POST | rows in table |
| `/api/admin/db/[db]/[table]/[row]` | GET, DELETE | single row |
| `/api/admin/db/route` | GET | list all DBs |
| `/api/admin/educational-cards` | GET, POST | CRUD |
| `/api/admin/educational-cards/lessons` | GET, POST | lessons sub-endpoint |
| `/api/admin/educational-cards/[id]` | GET, PATCH, DELETE | single card |
| `/api/admin/educational-cards/[id]/image` | GET, POST | image upload |
| `/api/admin/engine-settings` | GET, POST | read/update engine settings |
| `/api/admin/engine-settings/reset` | POST | reset لـ defaults |
| `/api/admin/engines-status` | GET | حالة كل المحركات |
| `/api/admin/engines/control` | POST | start/stop engine |
| `/api/admin/engines/logs` | GET | logs |
| `/api/admin/engines/logs/control` | POST | control logging |
| `/api/admin/engines/start-all` | POST | start all |
| `/api/admin/engines/stop-all` | POST | stop all |
| `/api/admin/export-data` | GET | export data |
| `/api/admin/export-vps` | GET | export VPS config |
| `/api/admin/fix-dates` | POST | إصلاح تواريخ |
| `/api/admin/generate-historical-predictions` | POST | توليد توقعات تاريخية |
| `/api/admin/generate-predictions` | POST | توليد توقعات اليوم |
| `/api/admin/import-indices-csv` | POST | import indices من CSV |
| `/api/admin/import-stocks` | POST | import stocks |
| `/api/admin/investors-data` | GET | بيانات المستثمرين |
| `/api/admin/news-health` | GET | فحص صحة الأخبار |
| `/api/admin/news` | GET, POST | CRUD أخبار |
| `/api/admin/platform-performance` | GET | أداء المنصة |
| `/api/admin/pm2-control` | POST | تحكّم في PM2 |
| `/api/admin/promo-codes` | GET, POST | CRUD promo codes |
| `/api/admin/purge-cache` | POST | تنظيف الـ cache |
| `/api/admin/refresh-historical-data` | POST | refresh history |
| `/api/admin/reports/[id]` | GET, DELETE | تقرير واحد |
| `/api/admin/reports/[id]/image` | GET | صورة التقرير |
| `/api/admin/scrape-stocks` | POST | تشغيل scraper |
| `/api/admin/sharia/run` | POST | تشغيل توافق شرعي |
| `/api/admin/sources` | GET | مصادر البيانات |
| `/api/admin/stats` | GET | إحصائيات عامة |
| `/api/admin/sync-stocks-db` | POST | مزامنة stocks.db |
| `/api/admin/sync-vps` | POST | sync مع VPS |
| `/api/admin/system-health` | GET | صحة النظام |
| `/api/admin/system-resources/anomalies` | GET | anomalies |
| `/api/admin/system-resources/history` | GET | history |
| `/api/admin/system-resources/process-history` | GET | process history |
| `/api/admin/system-resources` | GET | CPU/RAM/disk |
| `/api/admin/system-topology` | GET | topology |
| `/api/admin/telegram-predictions` | GET | توقعات Telegram |
| `/api/admin/users` | GET | list users |
| `/api/admin/users/[id]` | GET, PATCH, DELETE | user CRUD |
| `/api/admin/users/[id]/promo` | POST | promo user |
| `/api/admin/users/cleanup-expired` | POST | cleanup expired |
| `/api/admin/validation` | GET | validation report |

### 6.2 — Auth Module (8 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | NextAuth.js catch-all (signin, signout, callback) |
| `/api/auth/google` | GET | Google OAuth entry |
| `/api/auth/google-signin` | POST | Google ID token exchange |
| `/api/auth/login` | POST | email/password login |
| `/api/auth/logout` | POST | logout |
| `/api/auth/me` | GET | current user profile |
| `/api/auth/profile` | GET, PATCH | get/update profile |
| `/api/auth/register` | POST | new user signup |

### 6.3 — Stocks Module (22 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/stocks` | GET | list stocks (with filters) |
| `/api/stocks/advanced-analysis` | GET | advanced analysis |
| `/api/stocks/data-coverage` | GET | data coverage report |
| `/api/stocks/delta-volume` | GET | delta volume |
| `/api/stocks/dual-persona/[ticker]` | GET | dual-persona analysis |
| `/api/stocks/presets` | GET | screener presets |
| `/api/stocks/search` | GET | search |
| `/api/stocks/sparkline` | GET | sparkline data |
| `/api/stocks/top-performers` | GET | top performers |
| `/api/stocks/[ticker]` | GET | single stock detail |
| `/api/stocks/[ticker]/comprehensive` | GET | comprehensive analysis |
| `/api/stocks/[ticker]/depth` | GET | market depth |
| `/api/stocks/[ticker]/expert-analysis` | GET | expert analysis |
| `/api/stocks/[ticker]/history` | GET | OHLCV history |
| `/api/stocks/[ticker]/news` | GET | ticker news |
| `/api/stocks/[ticker]/orderbook` | GET | order book |
| `/api/stocks/[ticker]/professional-analysis` | GET | professional-grade |
| `/api/stocks/[ticker]/publish-data` | POST | publish data |
| `/api/stocks/[ticker]/recommendation` | GET | recommendation |
| `/api/stocks/[ticker]/unified` | GET | unified analysis |

### 6.4 — Market Module (32 routes under `/api/market/*` + `/api/market-pulse`)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/market-pulse` | GET | نبض السوق اللحظي (Python) |
| `/api/market/connections` | GET | روابط بين الأسواق |
| `/api/market/continuation/[ticker]` | GET | continuation patterns |
| `/api/market/exit-status` | GET | exit status |
| `/api/market/gold` | GET | سعر الذهب |
| `/api/market/incremental-sync` | POST | incremental sync |
| `/api/market/indices` | GET | قائمة المؤشرات |
| `/api/market/indices/[symbol]/breakdown` | GET | breakdown |
| `/api/market/indices/[symbol]/history` | GET | تاريخ المؤشر |
| `/api/market/intraday-pressure` | GET | intraday pressure |
| `/api/market/investing` | GET | investing data |
| `/api/market/investor-flows` | GET | investor flows |
| `/api/market/liquidity-flow` | GET | liquidity flow |
| `/api/market/liquidity-radar` | GET | رادار السيولة |
| `/api/market/live-data` | GET | live data |
| `/api/market/metals-forex/summary` | GET | metals + forex summary |
| `/api/market/morning-bell` | GET | morning bell (top picks) |
| `/api/market/overview` | GET | overview |
| `/api/market/publish-status-image` | POST | publish status image |
| `/api/market/recommendations/ai-insights` | GET | AI insights |
| `/api/market/regime` | GET | market regime |
| `/api/market/report/daily` | GET | daily report |
| `/api/market/report/weekly` | GET | weekly report |
| `/api/market/scheduled-sync` | POST | scheduled sync |
| `/api/market/sectors` | GET | sectors list |
| `/api/market/sectors/intelligence` | GET | sector intelligence |
| `/api/market/status` | GET | market status |
| `/api/market/summary` | GET | summary |
| `/api/market/sync-live` | POST | live sync |
| `/api/market/sync` | POST | sync |
| `/api/market/top-movers` | GET | top movers |

### 6.5 — Predictions Module (35 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/predictions` | GET | list predictions |
| `/api/predictions/active-management` | GET | active management |
| `/api/predictions/backtest-list` | GET | backtest list |
| `/api/predictions/daily-picks` | GET | daily picks |
| `/api/predictions/dual-track/backtest` | POST | dual-track backtest |
| `/api/predictions/dual-track/list` | GET | dual-track list |
| `/api/predictions/dual-track/stats` | GET | dual-track stats |
| `/api/predictions/dual-track/threshold` | GET, POST | threshold |
| `/api/predictions/eid` | GET | predictions for Eid |
| `/api/predictions/expert-consensus` | GET | expert consensus |
| `/api/predictions/generate-all` | POST | generate all |
| `/api/predictions/historical-trades` | GET | historical trades |
| `/api/predictions/honest-tracking` | GET | honest tracking root |
| `/api/predictions/honest-tracking/learn-from-errors` | POST | learn from errors |
| `/api/predictions/honest-tracking/list` | GET | list |
| `/api/predictions/honest-tracking/live-tracking` | GET | live tracking |
| `/api/predictions/honest-tracking/missed-opportunities` | GET | missed opportunities |
| `/api/predictions/honest-tracking/stats` | GET | stats |
| `/api/predictions/honest-tracking/verify-pending` | POST | verify pending |
| `/api/predictions/league-report` | GET | league report |
| `/api/predictions/learned-lessons` | GET | learned lessons |
| `/api/predictions/monthly-league` | GET | monthly league |
| `/api/predictions/performance` | GET | performance |
| `/api/predictions/performance-dashboard` | GET | performance dashboard |
| `/api/predictions/refresh-v40` | POST | refresh V40.2 |
| `/api/predictions/tracking` | GET, POST | tracking root |
| `/api/predictions/tracking/list` | GET | list |
| `/api/predictions/tracking/stats` | GET | stats |
| `/api/predictions/tracking/verify` | POST | verify |
| `/api/prediction-performance` | GET | performance standalone |

### 6.6 — Portfolio Module (16 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/portfolio` | GET, POST | root |
| `/api/portfolio/accounts` | GET, POST | accounts CRUD |
| `/api/portfolio/accounts/[id]/equity-curve` | GET | equity curve |
| `/api/portfolio/accounts/[id]/state` | GET | state |
| `/api/portfolio/bag-holder-rescue` | GET | rescue |
| `/api/portfolio/cashflow` | GET | cashflow |
| `/api/portfolio/equity-curve` | GET | equity curve |
| `/api/portfolio/holdings` | GET | holdings |
| `/api/portfolio/intelligence` | GET | intelligence |
| `/api/portfolio/master` | GET | master |
| `/api/portfolio/rescue` | GET | rescue |
| `/api/portfolio/risk-summary` | GET | risk summary |
| `/api/portfolio/smart-monitor/signals` | GET | smart monitor signals |
| `/api/portfolio/unified-watch` | GET | unified watch |
| `/api/portfolio/watchlists` | GET, POST | watchlists |

### 6.7 — Maker Radar Module (16 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/maker-radar` | GET | root |
| `/api/maker-radar/entry-timing` | GET | entry timing |
| `/api/maker-radar/exit-radar` | GET | exit radar |
| `/api/maker-radar/footprint` | GET | footprint |
| `/api/maker-radar/fundamentals` | GET | fundamentals |
| `/api/maker-radar/live-watch` | GET | live watch |
| `/api/maker-radar/market-intelligence` | GET | market intelligence |
| `/api/maker-radar/multi-market` | GET | multi-market |
| `/api/maker-radar/net-picks` | GET | net picks |
| `/api/maker-radar/sector-treemap` | GET | sector treemap |
| `/api/maker-radar/signal-tracker` | GET | signal tracker |
| `/api/maker-radar/signal-tracker/verify` | POST | verify |
| `/api/maker-radar/stock` | GET | stock |
| `/api/maker-radar/stock-analysis` | GET | stock analysis |
| `/api/maker-radar/timeline` | GET | timeline |
| `/api/maker-radar/track` | POST | track |
| `/api/maker-radar/warmup` | POST | warmup |

### 6.8 — Crypto Module (16 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/crypto` | GET | list |
| `/api/crypto/[id]` | GET | detail |
| `/api/crypto/[id]/history` | GET | history |
| `/api/crypto/coins` | GET | list coins |
| `/api/crypto/explosive` | GET | explosive |
| `/api/crypto/explosive/[symbol]` | GET | single explosive |
| `/api/crypto/flow` | GET | flow |
| `/api/crypto/flow/[symbol]` | GET | flow for symbol |
| `/api/crypto/full-analysis` | GET | full analysis |
| `/api/crypto/live` | GET | live prices |
| `/api/crypto/portfolio` | GET, POST | portfolio |
| `/api/crypto/simulation` | GET, POST | simulation |
| `/api/crypto/stop` | POST | stop |
| `/api/crypto/watchlist` | GET, POST | watchlist |
| `/api/crypto-backtesting` | GET, POST | backtesting |
| `/api/crypto-lab` | GET | lab root |
| `/api/crypto-lab/predictions` | GET | lab predictions |
| `/api/crypto-predictions` | GET | predictions |

### 6.9 — Subscription / Payment Module (22 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/subscribe/[plan]` | POST | subscribe to plan |
| `/api/subscription/activate` | POST | activate |
| `/api/subscription/check-access` | GET | check access |
| `/api/subscription/checkout` | POST | checkout |
| `/api/subscription/current` | GET | current plan |
| `/api/subscription/developer-request` | POST | developer request |
| `/api/subscription/plans` | GET | list plans |
| `/api/subscription/start-trial` | POST | start trial |
| `/api/subscription/status` | GET | status |
| `/api/subscription/subscribe` | POST | subscribe |
| `/api/subscription/trial` | POST | trial |
| `/api/subscription/upgrade` | POST | upgrade |
| `/api/subscription/verify` | POST | verify payment |
| `/api/paymob/callback` | POST | Paymob webhook |
| `/api/paymob/create-payment` | POST | create payment |
| `/api/paymob/process-wallet` | POST | wallet payment |
| `/api/instapay` | GET, POST | InstaPay |
| `/api/instapay/verify` | POST | verify InstaPay |
| `/api/google-play/verify-receipt` | POST | Google Play receipt |
| `/api/redeem-promo` | POST | redeem promo code |
| `/api/b2b/signup` | POST | B2B signup |

### 6.10 — Mobile Module (18 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/mobile/alerts/settings` | GET, POST | alerts settings |
| `/api/mobile/crypto` | GET | crypto list |
| `/api/mobile/crypto/[id]` | GET | crypto detail |
| `/api/mobile/dashboard` | GET | dashboard |
| `/api/mobile/gold` | GET | gold price |
| `/api/mobile/gold/history` | GET | gold history |
| `/api/mobile/news` | GET | news |
| `/api/mobile/notifications` | GET | notifications |
| `/api/mobile/portfolio` | GET | portfolio |
| `/api/mobile/portfolio/analyze` | POST | analyze |
| `/api/mobile/portfolio/intelligence` | GET | intelligence |
| `/api/mobile/predictions` | GET | predictions |
| `/api/mobile/recommendations` | GET | recommendations |
| `/api/mobile/stocks/[ticker]` | GET | stock detail |
| `/api/mobile/stocks/[ticker]/professional-analysis` | GET | prof analysis |
| `/api/mobile/stocks/[ticker]/recommendation` | GET | recommendation |
| `/api/mobile/watchlist` | GET, POST | watchlist |
| `/api/mobile/watchlist/intelligence` | GET | watchlist intelligence |
| `/api/mobile/zakat-calculator` | GET, POST | zakat |

### 6.11 — Finance / Money Module (18 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/finance/assets` | GET, POST | assets |
| `/api/finance/assets/[id]` | GET, PATCH, DELETE | asset CRUD |
| `/api/finance/calculate-values` | POST | calculate |
| `/api/finance/inflation` | GET | inflation |
| `/api/finance/obligations` | GET, POST | obligations |
| `/api/finance/obligations/payments` | GET, POST | payments |
| `/api/finance/projection` | GET, POST | projection |
| `/api/finance/real-return` | GET | real return |
| `/api/finance/reports` | GET | reports |
| `/api/finance/schema` | GET | schema |
| `/api/finance/screener` | GET | screener |
| `/api/finance/smart-alerts` | GET, POST | smart alerts |
| `/api/finance/smart-analysis` | GET, POST | smart analysis |
| `/api/finance/smart-confluence` | GET | smart confluence |
| `/api/finance/smart-watchlist` | GET | smart watchlist |
| `/api/finance/transactions` | GET, POST | transactions |
| `/api/finance/transactions/[id]` | GET, PATCH, DELETE | transaction CRUD |
| `/api/money` | GET | money root |
| `/api/money/smart-monitor` | GET | smart monitor |
| `/api/money/wealth` | GET | wealth |

### 6.12 — Data Engine Module (10 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/data-engine/control` | GET, POST | control |
| `/api/data-engine/crypto` | GET | crypto |
| `/api/data-engine/forex` | GET | forex |
| `/api/data-engine/gold` | GET | gold |
| `/api/data-engine/health` | GET | health |
| `/api/data-engine/metals` | GET | metals |
| `/api/data-engine/silver` | GET | silver |
| `/api/data-engine/status` | GET | status |
| `/api/data-engine/stocks` | GET | stocks |

### 6.13 — AI Module (4 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/ai/analyze-stock` | POST | analyze stock via AI |
| `/api/ai/chat` | POST | chat |
| `/api/ai/models` | GET | list AI models |

### 6.14 — Telegram Module (4 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/telegram/[...path]` | ALL | catch-all proxy لـ Telegram endpoints |
| `/api/telegram/post` | POST | post message |
| `/api/telegram/publish-stock` | POST | publish stock card |
| `/api/telegram/send-daily-report` | POST | send daily report |

### 6.15 — V2 / V4 / V82 Modules (15 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/v2/chart/full-analysis` | GET | chart full analysis |
| `/api/v2/engines` | GET | engines |
| `/api/v2/feedback/run` | POST | feedback run |
| `/api/v2/liquidity-radar` | GET | liquidity radar |
| `/api/v2/live-analysis` | GET | live analysis |
| `/api/v2/pipeline/[name]/engine/[engine]/toggle` | POST | toggle engine |
| `/api/v2/pipeline/[name]/engine/[engine]/weight` | POST | weight engine |
| `/api/v2/pipeline/[name]/summary` | GET | pipeline summary |
| `/api/v2/pipelines` | GET, POST | pipelines |
| `/api/v2/presets` | GET | presets |
| `/api/v2/recommend` | GET | recommend |
| `/api/v2/unified/analyze` | POST | unified analyze |
| `/api/v2/unified/config` | GET | unified config |
| `/api/v2/unified/scan` | POST | unified scan |
| `/api/v4/stats` | GET | v4 stats (SQLite fallback) |
| `/api/v82` | GET | V82 decision |

### 6.16 — Unified Learning Module (6 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/unified-learning/indicators` | GET | indicators |
| `/api/unified-learning/intelligent` | POST | intelligent |
| `/api/unified-learning/iterative` | POST | iterative |
| `/api/unified-learning/mine-lessons` | POST | mine lessons |
| `/api/unified-learning/patterns` | GET | patterns |
| `/api/unified-learning/status` | GET | status |

### 6.17 — Radar Module (5 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/radar/accuracy` | GET | accuracy |
| `/api/radar/incubator` | GET | incubator |
| `/api/radar/personalized` | GET | personalized |
| `/api/radar/weekly-report` | GET | weekly report |
| `/api/radar/weekly-report/pdf` | GET | PDF |

### 6.18 — Alerts Module (5 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/alerts` | GET | list |
| `/api/alerts/[id]` | GET, PATCH, DELETE | single alert |
| `/api/alerts/create` | POST | create |
| `/api/alerts/quick-add` | POST | quick add |
| `/api/alerts/scheduler` | GET | scheduler |

### 6.19 — Bot Module (3 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/bot/check-subscription` | GET | check subscription |
| `/api/bot/link-account` | POST | link account |
| `/api/bot/link-token` | POST | link token |

### 6.20 — Watchlist / Tracking Module (5 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/watchlist` | GET, POST | list/create |
| `/api/watchlist/[id]` | GET, PATCH, DELETE | single |
| `/api/watchlist-enhanced` | GET | enhanced |
| `/api/track` | POST | track event |
| `/api/user-posts` | GET, POST | posts |
| `/api/user-posts/[id]` | GET, PATCH, DELETE | single post |
| `/api/user-posts/[id]/like` | POST | like |

### 6.21 — Metals / Currency Module (7 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/metals/gold` | GET | gold price |
| `/api/metals/gold/history` | GET | gold history |
| `/api/metals-forex/status` | GET | metals + forex status |
| `/api/currency` | GET | currency |
| `/api/currency/convert` | POST | convert |
| `/api/currency/list` | GET | list |

### 6.22 — Confluence Module (3 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/confluence/analyze/[ticker]` | GET | analyze |
| `/api/confluence/daily-picks` | GET | daily picks |
| `/api/confluence/market-scan` | GET | market scan |

### 6.23 — Backtest / Backtesting Module (5 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/backtest` | GET, POST | root |
| `/api/backtesting` | GET, POST | alias |
| `/api/backtesting/unified` | GET, POST | unified |
| `/api/kimi/backtest/run` | POST | Kimi backtest |
| `/api/sniper/backtest` | POST | sniper backtest |
| `/api/walk-forward/run` | POST | walk-forward |
| `/api/walk-forward-test` | GET, POST | walk-forward test |

### 6.24 — Paper Trading Module (6 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/paper-trading-v2/account` | GET | account |
| `/api/paper-trading-v2/order` | POST | order |
| `/api/paper-trading-v2/orders` | GET | orders |
| `/api/paper-trading-v2/orders/[id]/close` | POST | close order |
| `/api/paper-trading-v2/positions` | GET | positions |
| `/api/paper-trading-v2/reset` | POST | reset |

### 6.25 — Scanner / Screener Module (5 routes)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api/scanner/quick` | GET | quick scan |
| `/api/screener/advanced` | GET | advanced screener |
| `/api/stock-screener/analyze` | POST | screener analyze |
| `/api/sniper/scan` | GET | sniper scan |
| `/api/sniper/track` | POST | sniper track |
| `/api/sniper/learning/performance` | GET | learning performance |
| `/api/live/scan` | GET | live scan |
| `/api/live/analysis/[ticker]` | GET | live analysis |
| `/api/live-monitor` | GET | monitor root |
| `/api/live-monitor/trigger` | POST | trigger |
| `/api/live-monitor/ledger` | GET | ledger |

### 6.26 —剩下的 الـ Routes (Misc — 90+ route)

| Route | الـ methods | الوصف |
|---|---|---|
| `/api` | GET | hello world (root) |
| `/api/[...slug]` | ALL | catch-all JSON 404 |
| `/api/ads/capture-screenshot` | POST | capture |
| `/api/ads/educational-lessons` | GET | lessons |
| `/api/ads/generate-script` | POST | script gen |
| `/api/ads/successful-trades` | GET | trades |
| `/api/advanced-analysis` | GET, POST | root |
| `/api/advanced-analysis/results` | GET | results |
| `/api/app/version` | GET | app version |
| `/api/chart/[ticker]` | GET | chart data |
| `/api/cron/auto-sync` | POST | cron auto sync |
| `/api/currency` | GET | currency |
| `/api/data-status` | GET | data status |
| `/api/deal-advisor/[ticker]` | GET | deal advisor |
| `/api/disclosures/company/[symbol]` | GET | disclosures |
| `/api/egx/investors` | GET | EGX investors |
| `/api/egxpilot/news` | GET | EGXPilot news |
| `/api/expert-recommendations` | GET, POST | expert recs |
| `/api/expert-recommendations/batch` | POST | batch |
| `/api/expert-recommendations/import` | POST | import |
| `/api/explosive` | GET | explosive root |
| `/api/explosive/[ticker]` | GET | single explosive |
| `/api/export` | GET | export |
| `/api/features` | GET | features list |
| `/api/feedback` | POST | feedback |
| `/api/flow` | GET | flow |
| `/api/flow/[ticker]` | GET | flow for ticker |
| `/api/fomo/missed-opportunities` | GET | FOMO |
| `/api/global-predictions` | GET | global predictions |
| `/api/health` | GET | deep health check |
| `/api/hunter/publish-pick` | POST | publish pick |
| `/api/i18n/set-locale` | POST | set locale |
| `/api/import` | POST | import |
| `/api/init-db` | POST | init DB |
| `/api/iterative-learning` | POST | iterative learning |
| `/api/keepalive` | GET | keepalive |
| `/api/learning/progress` | GET | progress |
| `/api/maestro` | GET | maestro root (**410 Gone**) |
| `/api/maestro/overview` | GET | overview (**410 Gone**) |
| `/api/maestro/stock/[ticker]` | GET | stock (**410 Gone**) |
| `/api/market/investing` | GET | investing |
| `/api/multi-market/sync` | POST | multi-market sync |
| `/api/news` | GET | news root |
| `/api/news-feed` | GET | news feed |
| `/api/news/latest` | GET | latest news |
| `/api/notifications` | GET | notifications |
| `/api/parse-recommendations` | POST | parse |
| `/api/persona/analyze/[ticker]` | GET | persona analyze |
| `/api/persona/gambler` | GET | gambler |
| `/api/persona/investor` | GET | investor |
| `/api/points` | GET | points |
| `/api/points/leaderboard` | GET | leaderboard |
| `/api/push/register` | POST | push register |
| `/api/recommendations` | GET | root |
| `/api/recommendations/backtest` | POST | backtest |
| `/api/recommendations/expert` | GET | expert |
| `/api/recommendations/retroactive-evaluate` | POST | retroactive |
| `/api/recommendations/verify` | POST | verify |
| `/api/reports/morning` | GET | morning report |
| `/api/reports/proxy` | GET | proxy |
| `/api/rescue/analyze` | POST | rescue |
| `/api/risk/decision-table` | GET | decision table |
| `/api/risk/stock-types` | GET | stock types |
| `/api/seasonality-signals` | GET | seasonality |
| `/api/sectors/[sector]/stocks` | GET | sector stocks |
| `/api/sectors/tracking` | GET | tracking |
| `/api/self-learning` | POST | self learning |
| `/api/sharia` | GET | sharia root |
| `/api/sharia/purification` | POST | purification |
| `/api/smart-confluence/analysis/[symbol]` | GET | smart confluence |
| `/api/stock-profile/[ticker]` | GET | profile |
| `/api/stock/deep-analysis` | GET | deep analysis |
| `/api/stored-analysis/live-tracking` | GET | live tracking |
| `/api/stored-analysis/results` | GET | results |
| `/api/subscribe/[plan]` | POST | subscribe |
| `/api/sync-historical` | POST | sync historical |
| `/api/system-control` | GET | system control |
| `/api/tab-data` | GET | tab data |
| `/api/tips/random` | GET | random tip |
| `/api/trade-results` | GET, POST | trade results |
| `/api/trade-results/export-image` | POST | export image |
| `/api/trading-journal` | GET, POST | journal |
| `/api/trading-journal/stats` | GET | stats |
| `/api/unified` | GET | unified root |
| `/api/unified/predictions` | GET | unified predictions |
| `/api/unified-stocks` | GET | unified stocks |
| `/api/zakat/calculate` | POST | zakat calculate |

---

## 7. طرق Python Flask Blueprints (≈448 Route)

كل الـ Flask blueprints بتـ تسجّل في `vps-service/lightweight_server.py` (lines 31-123). الـ Flask app بـ يـ mount تحت FastAPI عبر `a2wsgi.WSGIMiddleware` على root `/` (شوف `main.py` line 355).

### 7.1 — قائمة الـ Blueprints المسجّلة (39 blueprint)

| الـ Blueprint | الـ Module | الـ url_prefix | الـ routes |
|---|---|---|---|
| `chart_bp` | `api.chart_routes` | `/api/chart` | 4 |
| `stock_analysis_bp` | `api.stock_analysis_routes` | `/api/analysis` | 1 |
| `public_bp` | `api.public_routes` | `/api` | 16 |
| `stored_analysis_bp` | `api.stored_analysis_routes` | `/api/stored-analysis` | 5 |
| `sector_tracking_bp` | `api.sector_tracking_routes` | `/api/sectors` | 2 |
| `advanced_screener_bp` | `api.advanced_screener_routes` | `/api/screener` | 1 |
| `top_performers_bp` | `api.top_performers_routes` | `/api/stocks/top-performers` | 1 |
| `market_bp` | `api.stored_analysis_routes` (مُعاد استخدامه) | `/api/market` | 4 |
| `v2_bp` | `api.v2_routes` | `/api/v2` و `/api/personas` | 17 |
| `unified_v2_bp` | `api.unified_v2_routes` | `/api/unified-v2` | 7 |
| `confluence_bp` | `api.confluence_routes` | `/api/confluence` | 5 |
| `screener_bp` | `api.screener_routes` | `/api/screener` | 3 |
| `ai_pred_bp` | `api.ai_predictions_routes` | `/api/ai-predictions` | 7 |
| `prediction_tracking_bp` | `api.prediction_tracking_routes` | `/api/predictions/tracking` | 4 |
| `tracking_bp` | `api.prediction_tracking_routes` (alias) | `/api/tracking` | 7 |
| `sniper_bp` | `api.sniper_routes` | `/api/sniper` | 11 |
| `reports_bp` | `api.reports_routes` | `/api/reports` | 12 |
| `risk_bp` | `api.risk_routes` | `/api/risk` | 22 |
| `notebook_bp` | `api.notebook_routes` | `/api/notebooks` | 7 |
| `learning_bp` | `api.learning_routes` | `/api/learning` | 5 |
| `unified_learning_bp` | `api.unified_learning_routes` | `/api/unified-learning` | 20 |
| `optimizer_params_bp` | `api.optimizer_params_routes` | `/api/prediction-optimizer` | 4 |
| `news_bp` | `api.news_routes` | `/api/news` | 9 |
| `telegram_bp` | `api.telegram_routes` | `/api/telegram` | 54 |
| `portfolio_bp` | `api.portfolio_routes` | `/api/portfolio` | 54 |
| `misc_bp` | `api.misc_routes` | `/api/*` (mixed) | 22 |
| `admin_bp` | `api.admin_routes` | `/api/admin` | 76 |
| `analytics_bp` | `api.analytics` | `/api/analytics` | 7 |
| `prof_analysis_bp` | `api.professional_analysis_routes` | `/api/professional-analysis` | 1 |
| `stocks_bp` | `api.stocks` | `/api/stocks` | 3 |
| `regime_bp` | `api.regime_routes` | `/api/regime` | 3 |
| `scanner_bp` | `api.scanner_routes` | `/api/scanner` | 3 |
| `persona_bp` | `api.persona_routes` | `/api/persona` | 4 |
| `ai_bp` | `api.ai_routes` | `/api/ai` | 20 |
| `admin_engine_settings_bp` | `api.admin_engine_settings_routes` | `/api/admin/engine-settings` | 3 |
| `historical_preds_v2_bp` | `api.historical_predictions_v2_routes` | `/api/admin/historical-predictions-v2` | 4 |
| `picks_mgmt_bp` | `api.picks_management_routes` | `/api/predictions` | 6 |
| `v38_backtest_bp` | `api.v38_backtest_routes` | `/api/v38-backtest` | 6 |
| `market_master_bp` | `api.market_master_endpoints` | `/api/market` | 5 |
| `market_data_bp` | `api.market_routes` | `/api/market` | 1 |
| `notifications_bp` | `api.notifications_routes` | `/api/notifications` | 1 |
| ~~`maestro_bp`~~ | ~~`api.maestro_routes`~~ | — | **معطّل** (410 Gone — V40.2 هو العقل الوحيد) |

### 7.2 — أهم الطرق حسب الـ Domain

#### Domain: Market

| Method | Path | الوصف |
|---|---|---|
| GET | `/api/stocks` | قائمة كل الأسهم |
| GET | `/api/stocks/<ticker>` | سهم مفرد |
| GET | `/api/stocks/<ticker>/local-history` | تاريخ محلي |
| GET | `/api/history/<ticker>` | OHLCV history |
| GET | `/api/prices/<ticker>` | recent ticks |
| GET | `/api/analysis/<ticker>` | تحليل شامل |
| GET | `/api/indicators/<ticker>` | كل المؤشرات |
| GET | `/api/patterns/<ticker>` | candlestick patterns |
| GET | `/api/fibonacci/<ticker>` | fibonacci levels |
| GET | `/api/predict/<ticker>` | predict للسهم |
| GET | `/api/timing` | timing analysis |
| GET | `/api/live/analysis/<ticker>` | live analysis |
| GET | `/api/live/scan` | live scan |
| GET | `/api/market/overview` | نظرة سوق (cache 300s) |
| GET | `/api/market/intraday-pressure` | intraday pressure (cache 60s) |
| GET | `/api/market/investor-flows` | investor flows (cache 300s) |
| GET | `/api/market/metals-forex/summary` | metals + forex |
| GET | `/api/market/liquidity-radar` | رادار السيولة |
| GET | `/api/market/indices/constituents` | مكونات المؤشرات |
| GET | `/api/market/top-movers` | top movers |
| GET | `/api/market/morning-bell` | morning bell |
| GET | `/api/market/morning-bell/live` | morning bell live |
| GET | `/api/market/morning-bell/stats` | morning bell stats |
| GET | `/api/market/continuation/<ticker>` | continuation |
| GET | `/api/market/exit-status` | exit status |
| GET | `/api/sectors/tracking` | sectors tracking (cache 300s) |
| GET | `/api/sectors/<sector_name>/stocks` | stocks in sector |
| GET | `/api/chart/<ticker>` | chart data |
| GET | `/api/chart/stats/intraday` | intraday stats |
| POST | `/api/chart/collect/now` | collect now |
| GET | `/api/chart/full-analysis` | full analysis |
| GET | `/api/stocks/top-performers` | top performers |
| GET | `/api/stocks/presets` | presets |
| GET | `/api/stocks/presets/list` | presets list |
| GET | `/api/stocks/computed` | computed stocks |

#### Domain: Predictions

| Method | Path | الوصف |
|---|---|---|
| GET | `/api/predictions/daily-picks` | top 5 picks |
| GET | `/api/predictions/daily-picks/history` | history |
| GET | `/api/predictions/active-management` | HOLD/TRAIL/EXIT |
| GET | `/api/predictions/<id>/management` | single |
| POST | `/api/predictions/management/refresh` | refresh |
| GET | `/api/predictions/management/health` | health |
| POST | `/api/predictions/tracking/save` | save prediction |
| GET | `/api/predictions/tracking/list` | list |
| GET | `/api/predictions/tracking/stats` | stats |
| POST | `/api/predictions/tracking/verify` | verify |
| GET | `/api/tracking/legacy-stats` | legacy stats |
| GET | `/api/tracking/history` | history |
| GET | `/api/tracking/pending` | pending |
| POST | `/api/tracking/evaluate` | evaluate |
| GET | `/api/tracking/check/<id>` | check |
| GET | `/api/tracking/export` | CSV export |
| GET | `/api/tracking/summary` | summary |
| GET | `/api/ai-predictions/info` | AI info |
| GET | `/api/ai-predictions/status` | AI status |
| POST | `/api/ai-predictions/generate` | generate AI |
| POST | `/api/ai-predictions/evaluate` | evaluate |
| GET | `/api/ai-predictions/stats` | stats |
| GET | `/api/ai-predictions/list` | list |
| POST | `/api/ai-predictions/clear` | clear |
| GET | `/api/admin/historical-predictions-v2/explosive-stocks` | explosive |
| POST | `/api/admin/historical-predictions-v2/preview` | preview |
| POST | `/api/admin/historical-predictions-v2/generate` | generate (SSE) |
| GET | `/api/admin/historical-predictions-v2/health` | health |
| GET | `/api/v38-backtest/results` | V38 results |
| GET | `/api/v38-backtest/summary` | V38 summary |
| GET | `/api/v38-backtest/trades` | V38 trades |
| POST | `/api/v38-backtest/run` | run V38 |
| GET | `/api/v38-backtest/status` | V38 status |
| GET | `/api/v38-backtest/health` | V38 health |

#### Domain: Portfolio (54 routes in `portfolio_bp`)

| Method | Path | الوصف |
|---|---|---|
| POST | `/api/portfolio/create` | create portfolio |
| GET | `/api/portfolio/state` | state |
| POST | `/api/portfolio/strategy/plan` | plan |
| POST | `/api/portfolio/strategy/recommend` | recommend |
| POST | `/api/portfolio/heat/calculate` | heat |
| POST | `/api/portfolio/heat/check-position` | check position |
| POST | `/api/portfolio/rebalance/suggest` | rebalance |
| POST | `/api/portfolio/position/evaluate` | evaluate |
| POST | `/api/portfolio/journal/open` | open trade |
| POST | `/api/portfolio/journal/close` | close trade |
| POST | `/api/portfolio/journal/reflect` | reflect |
| GET | `/api/portfolio/journal/stats` | stats |
| GET | `/api/portfolio/journal/recent` | recent |
| GET | `/api/portfolio/journal/open-trades` | open trades |
| GET | `/api/portfolio/dashboard` | dashboard |
| GET | `/api/portfolio/patterns` | patterns |
| GET | `/api/portfolio/rules` | rules |
| GET | `/api/portfolio/smart-monitor` | smart monitor |
| GET | `/api/portfolio/smart-monitor/signals` | signals |
| GET | `/api/portfolio/holdings` | holdings |
| POST | `/api/portfolio/trades/record-buy` | record buy |
| POST | `/api/portfolio/trades/record-sell` | record sell |
| GET | `/api/portfolio/trades/list` | trades |
| GET | `/api/portfolio/trades/outcomes` | outcomes |
| GET | `/api/portfolio/trades/performance` | performance |
| POST | `/api/portfolio/trades/learn` | learn |
| POST | `/api/portfolio/equity/snapshot` | snapshot |
| GET | `/api/portfolio/equity/curve` | curve |
| POST | `/api/portfolio/cash/record` | record cash |
| GET | `/api/portfolio/cash/transactions` | transactions |
| POST | `/api/portfolio/pnl/record` | record PnL |
| GET | `/api/portfolio/pnl/history` | PnL history |
| POST | `/api/portfolio/protection/check` | check |
| GET | `/api/portfolio/protection/state` | state |
| POST | `/api/portfolio/protection/record-trade` | record |
| POST | `/api/portfolio/protection/reset-daily` | reset |
| GET | `/api/portfolio/position-size` | size calc |
| GET | `/api/portfolio/available-cash` | cash |
| POST | `/api/portfolio/record-settlement` | settlement |
| GET | `/api/portfolio/pending-settlements` | pending |
| POST | `/api/portfolio/accounts/create` | create account |
| POST | `/api/portfolio/accounts/update` | update |
| GET | `/api/portfolio/accounts` | list accounts |
| POST | `/api/portfolio/accounts/delete` | delete |
| GET | `/api/portfolio/master` | master |
| GET | `/api/portfolio/accounts/<id>/state` | account state |
| GET | `/api/portfolio/accounts/<id>/equity-curve` | account curve |
| GET | `/api/portfolio/watchlists` | watchlists |
| POST | `/api/portfolio/watchlists/create` | create |
| POST | `/api/portfolio/watchlists/<id>/add` | add stock |
| POST | `/api/portfolio/watchlists/<id>/remove` | remove stock |
| DELETE | `/api/portfolio/watchlists/<id>` | delete watchlist |
| GET | `/api/portfolio/real-return` | real return |
| GET | `/api/portfolio/bag-holder-rescue` | bag holder rescue |

#### Domain: Risk (22 routes in `risk_bp`)

| Method | Path | الوصف |
|---|---|---|
| POST | `/api/risk/position-size` | position sizing |
| POST | `/api/risk/stop-loss` | stop loss calc |
| POST | `/api/risk/targets` | target levels |
| POST | `/api/risk/trade-plan` | trade plan |
| POST | `/api/risk/trailing-stop` | trailing stop |
| POST | `/api/risk/validate` | validate |
| GET | `/api/risk/trading-time` | trading time |
| POST | `/api/risk/portfolio` | portfolio risk |
| POST | `/api/risk/egyptian-model` | EGX model |
| POST | `/api/risk/psychology` | psychology |
| POST | `/api/risk/leverage` | leverage |
| GET | `/api/risk/decision-table` | decision table |
| GET | `/api/risk/stock-types` | stock types |
| POST | `/api/risk/position-plan` | plan |
| POST | `/api/risk/buy-safety` | buy safety |
| POST | `/api/risk/enforce-stop` | enforce |
| POST | `/api/risk/trailing-explain` | explain |
| POST | `/api/risk/dynamic-stop` | dynamic stop |
| POST | `/api/risk/dynamic-targets` | dynamic targets |
| POST | `/api/risk/dynamic-trailing` | dynamic trailing |
| POST | `/api/risk/dynamic-rr` | dynamic R/R |
| POST | `/api/risk/evaluate` | evaluate (canonical position sizing) |

#### Domain: AI (20 routes in `ai_bp`)

| Method | Path | الوصف |
|---|---|---|
| GET | `/api/ai/status` | AI status |
| GET | `/api/ai/decision/<ticker>` | decision |
| POST | `/api/ai/compare` | compare |
| POST | `/api/ai/ask` | ask AI |
| GET | `/api/ai/live/signals` | live signals |
| GET | `/api/ai/live/scan` | live scan |
| GET | `/api/ai/hot-stocks` | hot stocks |
| POST | `/api/ai/trades/record` | record trade |
| GET | `/api/ai/trades/<user_id>` | user trades |
| GET | `/api/ai/trades/<user_id>/performance` | performance |
| POST | `/api/ai/trades/learn` | learn |
| GET | `/api/ai/trades/outcomes` | outcomes |
| GET | `/api/ai/historical/generate` | generate |
| POST | `/api/ai/historical/feed-ai` | feed AI |
| GET | `/api/ai/historical/stats` | stats |
| POST | `/api/ai/telegram/import` | import |
| POST | `/api/ai/telegram/evaluate` | evaluate |
| GET | `/api/ai/telegram/stats` | stats |
| GET | `/api/ai/telegram/signals` | signals |
| GET | `/api/ai/premium/predictions` | premium (confluence = maestro×0.6 + ai×0.4) |

#### Domain: Admin (76 routes in `admin_bp`)

أهمها (للاطلاع على الـ 76 كاملة راجع `vps-service/api/admin_routes.py`):

| Method | Path | الوصف |
|---|---|---|
| GET | `/api/admin/health` | system health |
| GET | `/api/admin/status` | status |
| GET | `/api/admin/system-topology` | topology |
| POST | `/api/admin/sync` | sync |
| POST | `/api/admin/update-prices` | update prices |
| POST | `/api/admin/update-crypto` | update crypto |
| GET | `/api/admin/data-status` | data status |
| GET | `/api/admin/sync/status` | sync status |
| GET | `/api/admin/models` | ML models |
| GET/POST | `/api/admin/models/weights` | model weights |
| POST | `/api/admin/models/retrain` | retrain |
| POST | `/api/admin/backtest/run` | backtest |
| GET | `/api/admin/backtest/results` | results |
| GET/POST | `/api/admin/backtest/params` | params |
| POST | `/api/admin/backtest/run-enhanced` | enhanced |
| POST | `/api/admin/backtest/run-engine` | engine |
| GET | `/api/admin/backtest/v40/stats` | V40 stats |
| POST | `/api/admin/backtest/v40/run` | V40 run |
| GET | `/api/admin/backtest/v40/status/<job_id>` | V40 status |
| GET | `/api/admin/backtest/engine-results` | engine results |
| POST | `/api/admin/backtest/ab-test` | A/B test |
| POST | `/api/admin/iterative-learning/start` | start |
| POST | `/api/admin/iterative-learning/step` | step |
| POST | `/api/admin/iterative-learning/run-auto` | auto |
| GET | `/api/admin/iterative-learning/status` | status |
| POST | `/api/admin/iterative-learning/stop` | stop |
| POST | `/api/admin/iterative-learning/grid-search` | grid search |
| POST | `/api/admin/iterative-learning/smart-optimize` | optimize |
| GET | `/api/admin/forecasts/accuracy` | accuracy |
| GET | `/api/admin/forecasts/history` | history |
| GET/POST | `/api/admin/alerts/thresholds` | thresholds |
| POST | `/api/admin/macro/update` | macro |
| GET/POST | `/api/admin/sectors/benchmarks` | benchmarks |
| GET | `/api/admin/sectors/rotation` | rotation |
| POST | `/api/admin/sectors/classify-stocks` | classify |
| GET | `/api/admin/sectors/stats` | stats |
| GET | `/api/admin/database/tables` | tables |
| POST | `/api/admin/database/query` | SQL query |
| POST | `/api/admin/database/repair-all` | repair all |
| POST | `/api/admin/database/repair-engine` | repair engine |
| POST | `/api/admin/database/cleanup-symbols` | cleanup |
| POST | `/api/admin/database/import-egx30` | import EGX30 |
| POST | `/api/admin/database/recover` | recover |
| POST | `/api/admin/database/recover-all` | recover all |
| POST | `/api/admin/maestro-backfill/run` | maestro backfill |
| GET | `/api/admin/maestro-backfill/status` | status |
| POST | `/api/admin/user/<id>/reset-trial` | reset trial |
| POST | `/api/admin/user/<id>/extend-trial` | extend trial |

### 7.3 — Routes المسجّلة مباشرةً في `lightweight_server.py` (38 route)

هذه الـ routes بـ تـ register على `app` مباشرةً (مش في blueprint):

| Method | Path | الوصف |
|---|---|---|
| GET | `/api/market-pulse` | نبض السوق (cache 10s) |
| GET | `/api/live-monitor` | live monitor |
| GET | `/` | root health check |
| GET | `/api/flow/summary` | flow summary |
| GET | `/api/flow/top` | top flow |
| GET | `/api/flow/<ticker>` | flow for ticker |
| GET | `/api/flow/heatmap` | heatmap |
| GET | `/api/explosive/scan` | explosive scan |
| GET | `/api/explosive/top` | top explosive |
| GET | `/api/explosive/<ticker>` | single explosive |
| GET | `/api/explosive/hunt` | hunt |
| GET | `/api/exit/notifications` | exit notifications |
| GET | `/api/live/sniper-scan` | sniper scan |
| GET | `/api/expert-recommendations/active` | active recs |
| GET | `/api/eodhd/backfill-status` | EODHD status |
| POST | `/api/eodhd/bulk-update` | bulk update |
| POST | `/api/eodhd/sync-stocks` | sync stocks |
| POST | `/api/eodhd/clear-and-rebuild` | rebuild |
| POST | `/api/eodhd/backfill` | backfill |
| GET | `/api/stock-profile/<ticker>` | profile |
| GET | `/api/market-overview` | overview (legacy) |
| GET | `/api/smc/analyze/<ticker>` | SMC analysis |
| GET | `/api/crypto/live` | crypto live |
| GET | `/api/crypto/flow/top` | top flow |
| GET | `/api/crypto/flow/<symbol>` | flow |
| GET | `/api/crypto/explosive/top` | explosive |
| GET | `/api/crypto/explosive/<symbol>` | single |
| GET | `/api/ai/live/scan` | AI scan |
| GET | `/api/ai/historical/generate` | AI gen |
| POST | `/api/ai/historical/feed-ai` | feed |
| GET | `/api/health` | Python health |
| POST | `/api/health/circuits/reset` | reset circuits |
| GET | `/health` | root health |
| GET | `/keepalive` | keepalive (للـ cron) |
| POST | `/api/crypto/sync` | sync |
| GET | `/api/crypto/analyze/<coin_id>` | analyze |
| GET | `/api/crypto/<coin_id>/history` | history |
| GET/POST/DELETE | `/api/crypto/watchlist` | watchlist |
| GET/POST | `/api/crypto/portfolio` | portfolio |
| GET | `/api/crypto/simulation/portfolio` | sim portfolio |
| POST | `/api/crypto/simulation/trade` | sim trade |
| GET | `/api/crypto-phase4/events` | events |
| GET/POST | `/api/maestro/<path>` | **410 Gone** (V40.2 هو الوحيد) |
| GET/POST | `/api/maestro` | **410 Gone** |

---

## 8. طرق FastAPI (Portfolio + AI Routers)

الـ FastAPI app في `vps-service/main.py` بتـ mount الـ Flask عبر `a2wsgi.WSGIMiddleware` على `/`، لكن كمان بتـ register الـ FastAPI routers التالية مباشرةً:

### 8.1 — Portfolio Router (9 routes في `ai/portfolio_routes.py`)

| Method | Path | الوصف |
|---|---|---|
| GET | `/equity/curve` | equity curve |
| GET | `/state` | state |
| GET | `/cashflow` | cashflow |
| GET | `/holdings` | holdings |
| GET | `/watchlists` | watchlists |
| GET | `/risk-summary` | risk summary |
| GET | `/smart-monitor/signals` | signals |
| GET | `/real-return` | real return |
| GET | `/bag-holder-rescue` | rescue |

> ⚠️ الـ FastAPI routes دي **بتـ override** الـ Flask equivalents لأن Starlette بتـ match الأول. الـ paths بتـ duplicate عمداً — FastAPI بـ يـ serve الـ canonical والـ Flask fallback موجود لو الـ router فشل.

### 8.2 — AI Router (معطّل)

`api.ai_routes` (الـ FastAPI module) مش موجود — تم تعطيله في `BRAVO-FIX (2026-10-19)`. لو محتاج AI router في FastAPI، اعمل `ai/api_routes.py` الأول.

### 8.3 — Health (FastAPI native)

| Method | Path | الوصف |
|---|---|---|
| GET | `/health` | `{status: ok, service: GLM Finance Backend, version: 2.0.0}` |

---

## 9. طرق Data Engine (Flask Port 5000)

الـ Flask app في `data_engine/main.py` بـ expose 19 endpoint:

| Method | Path | الوصف |
|---|---|---|
| GET | `/` | root |
| GET | `/health` | health check |
| GET | `/status` | engine status (running, last updates) |
| GET | `/stats` | statistics |
| GET | `/logs` | recent logs |
| GET | `/market-status` | market status (open/closed لكل الأسواق) |
| POST | `/trigger/stocks` | trigger stocks scraper |
| POST | `/trigger/crypto` | trigger crypto |
| POST | `/trigger/metals` | trigger metals |
| POST | `/trigger/news` | trigger news |
| POST | `/trigger/sync` | trigger full sync |
| POST | `/trigger/all` | trigger all |
| POST | `/trigger/historical` | trigger historical backfill |
| POST | `/control/start` | start engine |
| POST | `/control/stop` | stop engine |
| POST | `/control/toggle/<scraper>` | toggle scraper |
| POST | `/control/clear-logs` | clear logs |

---

## 10. طبقة الـ Caching

نوعان من الـ caches بيشتغلوا مع بعض في Python:

### 10.1 — AnalysisCache (per-ticker, TTL=60s)
- الـ file: `vps-service/core/cache_manager.py::analysis_cache`.
- بيـ cache نتائج `DecisionRouter.analyze()` per ticker.

### 10.2 — ApiResponseCache (per-endpoint, TTL=60-300s)
- الـ file: `vps-service/core/cache_manager.py::api_cache`.
- بيـ cache الـ HTTP responses الكاملة.
- متطبّق على 4 endpoints:
  - `/api/market/overview` (TTL=300s)
  - `/api/market/intraday-pressure` (TTL=60s)
  - `/api/market/investor-flows` (TTL=300s)
  - `/api/sectors/tracking` (TTL=300s)
- الـ cached responses بتـضم `cached: true/false` + `cache_ttl` عشان الـ client يقدر يعرض الـ freshness.

### 10.3 — Market Pulse Cache (lightweight_server.py)
- in-memory `OrderedDict` (max 1000 entries).
- TTL=10s.
- key = `market_pulse_HHMM` (per-minute).
- يخدم `/api/market-pulse`.

### 10.4 — Next.js In-Memory Caches
- `/api/health`: TTL=60s (deep health check غالي).
- `/api/proxy-prod/*`: rate limit map (30 req/min/IP).

---

## 11. روابط سريعة (Quick Links)

### الـ docs ذات الصلة

- `Documentation/02-DATABASES-AND-DATA.md` — كل الـ DBs اللي الـ endpoints بتقرأ منها.
- `Documentation/03-ENGINES-AND-LOGIC.md` — الـ engines اللي بـ feed الـ endpoints.
- `Documentation/01-ARCHITECTURE.md` — الـ architecture العام + الـ data flow.
- `Documentation/07-DEPLOYMENT-AND-OPS.md` — الـ deployment + ops + PM2 + Caddy.

### الـ code references

- Next.js proxy: `src/app/api/proxy/[...path]/route.ts`
- Next.js Python alias: `src/app/api/python/[...path]/route.ts`
- Next.js production proxy: `src/app/api/proxy-prod/[...path]/route.ts`
- Telegram proxy: `src/app/api/telegram/[...path]/route.ts`
- Caddyfile: `Caddyfile` (port 81)
- Python Flask entry: `vps-service/lightweight_server.py`
- Python FastAPI entry: `vps-service/main.py`
- Python blueprints: `vps-service/api/*.py` (39 file)
- Data Engine: `data_engine/main.py`
- Auth middleware (Python): `vps-service/core/auth_middleware.py`
- Auth middleware (Next.js): `src/lib/admin-auth-server.ts` + `src/middleware.ts`
- Cache manager: `vps-service/core/cache_manager.py`

### قواعد الـ Constitution ذات الصلة

- **Rule 20** — Python=Brain: Next.js ما بيعملش منطق.
- **Rule 21** — Canonical: هذا الملف هو SSOT للـ API.
- **Rule 22** — Canonical response shape: `{success, source, data, meta}`.
- **Rule 35** — V40.2 هو العقل الوحيد (maestro معطّل).
- **Rule 211** — ما تستخدمش `localhost:PORT` في الـ frontend — استخدم XTransformPort.

---

*هذا التوثيق مكتوب من الكود الحي بواسطة جون (المدير التنفيذي) في 2026-10-24. أي تعارض بين هذا التوثيق والتوثيق المؤرشف — هذا هو الصحيح.*

</div>
