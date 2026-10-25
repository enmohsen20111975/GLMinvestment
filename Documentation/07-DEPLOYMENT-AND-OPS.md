<div dir="rtl">

# 07 — النشر والتشغيل (Deployment & Ops)

> **المصدر:** `ecosystem.config.js` (8 خدمات PM2) + `Caddyfile` (gateway) + `next.config.mjs` (Next config) + `crontab.txt` (26 cron job) + `scripts/deploy*.sh` + `vps-service/scripts/smart_db_backup.py` + `vps-service/scripts/daily_backup.py` + `src/instrumentation.ts` (metrics) + `src/app/api/health/route.ts` (health).
>
> **آخر تحديث:** 2026-10-24 — مكتوب من الكود الحي. أي تعارض بين هذا الملف والتوثيق المؤرشف — هذا هو الصحيح.

---

## 📑 فهرس المحتويات

1. [نظرة عامة على الـ Topology](#1-نظرة-عامة-على-الـ-topology)
2. [المنافذ (Ports)](#2-المنافذ-ports)
3. [متغيرات البيئة (.env)](#3-متغيرات-البيئة-env)
4. [خدمات PM2 (8 خدمات)](#4-خدمات-pm2-8-خدمات)
5. [بوابة Caddy (Gateway)](#5-بوابة-caddy-gateway)
6. [نمط XTransformPort](#6-نمط-xtransformport)
7. [إعداد Next.js (next.config.mjs)](#7-إعداد-nextjs-nextconfigmjs)
8. [Cron Jobs (26 مهمة)](#8-cron-jobs-26-مهمة)
9. [النسخ الاحتياطي (Backup Strategy)](#9-النسخ-الاحتياطي-backup-strategy)
10. [المراقبة (Monitoring)](#10-المراقبة-monitoring)
11. [عملية النشر (Deploy Process)](#11-عملية-النشر-deploy-process)
12. [الاسترجاع (Rollback Strategy)](#12-الاسترجاع-rollback-strategy)
13. [أوامر سريعة (Cheat Sheet)](#13-أوامر-سريعة-cheat-sheet)

---

## 1. نظرة عامة على الـ Topology

```
                        ┌──────────────────────┐
                        │  Internet / Browser   │
                        │  (Flutter app / Web)   │
                        └──────────┬───────────┘
                                   │ HTTPS (port 443)
                                   ▼
                        ┌──────────────────────┐
                        │  Caddy Gateway :81   │  ← reverse_proxy
                        │  (Caddyfile)          │
                        └──────────┬───────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
            ▼                      ▼                      ▼
   ┌────────────────┐   ┌──────────────────┐   ┌──────────────────┐
   │ Next.js :3000   │   │ Python :8010     │   │ WS :3005         │
   │ (DISPLAY ONLY)  │   │ (BRAIN — V40.2)  │   │ (Socket.io push) │
   │ 8 PM2 services  │   │ FastAPI + Flask  │   │ Bun runtime      │
   └────────┬───────┘   └────────┬─────────┘   └──────────────────┘
            │                    │
            │                    ▼
            │           ┌──────────────────┐
            │           │ Data Engine :5000 │
            │           │ (Flask scrapers)  │
            │           └────────┬─────────┘
            │                    │
            │           ┌────────▼─────────┐
            │           │ SQLite DBs (17)   │
            │           │ /home/.../db/     │
            │           └──────────────────┘
            │
            ▼
   ┌──────────────────────────────┐
   │  خدمات مساندة:                │
   │  • telegram-events :3003      │
   │  • telegram-poster (no port)  │
   │  • telegram-interactive-bot   │
   │  • news-agent (no port)       │
   │  • Ollama LLM :11434         │
   │    (systemd — NOT PM2)       │
   └──────────────────────────────┘
```

**القاعدة الحاكمة (Rule 20):** Next.js = عرض فقط. كل المنطق في Python على `:8010`. أي تصحيح/تحديث في الواجهة بـ يمر عبر proxy لـ Python.

---

## 2. المنافذ (Ports)

| Port | الخدمة | الـ runtime | الـ env var |
|---|---|---|---|
| **3000** | Next.js (Frontend) | Node.js 22+ | `PORT=3000` |
| **3003** | telegram-events (Socket.io relay) | Bun | `PORT=3003` |
| **3005** | ws-service (Socket.io push) | Bun | (hardcoded) |
| **5000** | Data Engine (Flask scrapers) | Python 3.11 | `PORT=5000` |
| **8010** | Python backend (FastAPI + Flask) | Python 3.11 + uvicorn | `PORT=8010` |
| **8081** | (محرّر Caddy admin API — معطّل) | — | — |
| **81** | Caddy gateway (HTTP, مع TLS terminator) | Caddy | — |
| **443** | Caddy gateway (HTTPS, الـ public entry) | Caddy | — |
| **11434** | Ollama (LLM محلي) | systemd service | `OLLAMA_URL=http://127.0.0.1:11434` |

### قواعد المنافذ

- الـ public traffic بـ يدخل على **port 443 (HTTPS)** → Caddy بـ يـ terminate TLS → forward لـ `:81` (HTTP).
- الـ internal services بـ تتواصل عبر `127.0.0.1:<port>` فقط — ما ينفعش أي خدمة تـ publish على `0.0.0.0` غير Next.js + Python (عشان Caddy يشوفها).
- الـ admin tabs بـ تستخدم `?XTransformPort=<port>` في الـ query لاختيار الخدمة اللي Caddy بـ يوجّه لها.

---

## 3. متغيرات البيئة (.env)

الـ `.env` file في **جذر المشروع** (`/home/z/my-project/.env` أو `/root/GLMinvestment/.env` في الإنتاج). كل من PM2 (`ecosystem.config.js` line 76-94) و Python (`main.py` line 23-38) بـ يـ parse نفس الملف.

### 3.1 — Database & Prisma

| Variable | الوصف | الـ default |
|---|---|---|
| `DATABASE_URL` | Prisma connection string | `file:/home/z/my-project/db/custom.db` |

### 3.2 — NextAuth.js

| Variable | الوصف | الـ default |
|---|---|---|
| `NEXTAUTH_SECRET` | JWT signing secret (**إلزامي في الإنتاج**) | `glminvestment-dev-fallback-secret-2026` (sandbox فقط) |
| `NEXTAUTH_URL` | الـ public URL | `https://invist.m2y.net` |
| `GOOGLE_CLIENT_ID` | Google OAuth Web Client | (env) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | (env) |

### 3.3 — Admin Auth

| Variable | الوصف | الـ default |
|---|---|---|
| `ADMIN_USERNAME` | admin login username | (env) |
| `ADMIN_PASSWORD` | admin login password (**إلزامي في الإنتاج**) | (env) |
| `ADMIN_SESSION_TOKEN` | static token للـ programmatic admin API | (env) |
| `ADMIN_EMAIL` | admin email (لأجل bypass المحذور) | (env) |
| `ALLOW_ADMIN_BYPASS` | `true` لتطوير محلي فقط | (unset) |

### 3.4 — Python Backend

| Variable | الوصف | الـ default |
|---|---|---|
| `PYTHON_BACKEND_URL` | URL للـ Python backend | `http://localhost:8010` |
| `EGXPY_SERVICE_URL` | alias قديم لـ Python | `http://localhost:8010` |
| `EGX_VPS_API_URL` | alias قديم لـ Python | `http://localhost:8010` |
| `PYTHON_API_URL` | alias قديم لـ Python | `http://localhost:8010` |
| `VPS_API_URL` | alias قديم لـ Python | `http://localhost:8010` |
| `EGXPY_BRIDGE_URL` | alias قديم لـ bridge | — |
| `PROXY_API_KEY` | secret key للـ internal Next.js → Python calls | (env — بدون fallback) |
| `EGXPY_SYNC_SECRET` | secret للـ sync webhook | — |
| `VPS_API_KEY` / `EGXPY_API_KEY` | API key للـ VPS sync | (env) |

### 3.5 — Telegram

| Variable | الوصف | الـ default |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot API token | (env) |
| `TELEGRAM_API_ID` | Telegram API ID | (env) |
| `TELEGRAM_API_HASH` | Telegram API hash | (env) |
| `TELEGRAM_CHANNEL_ID` | الـ channel للـ auto-posting | (env) |
| `BOT_API_SECRET` | secret للـ bot→backend auth | (env) |

### 3.6 — Paymob (Payment Gateway)

| Variable | الوصف | الـ default |
|---|---|---|
| `PAYMOB_API_KEY` | Paymob API key (**إلزامي**، بدون fallback) | (env) |
| `PAYMOB_HMAC` | Paymob HMAC secret للـ webhook verification | (env — بدون fallback) |
| `PAYMOB_IFRAME_ID` | iframe ID | `993228` |
| `PAYMOB_CARD_INTEGRATION_ID` | card integration | `5716783` |
| `PAYMOB_INTEGRATION_ID_CARD` | alternative card integration | — |
| `PAYMOB_INTEGRATION_ID_WALLET` | wallet integration | — |
| `PAYMOB_PLAN_PREMIUM_MONTHLY_PRICE` | premium monthly (cents) | `9900` (99 EGP) |
| `PAYMOB_PLAN_PREMIUM_YEARLY_PRICE` | premium yearly | `99000` (990 EGP) |
| `PAYMOB_PLAN_NORMAL_MONTHLY_PRICE` | normal monthly | `19900` |
| `PAYMOB_PLAN_NORMAL_YEARLY_PRICE` | normal yearly | `199000` |
| `PAYMOB_PLAN_PRO_MONTHLY_PRICE` | pro monthly | `19900` |
| `PAYMOB_PLAN_PRO_YEARLY_PRICE` | pro yearly | `199000` |
| `PAYMOB_PLAN_DEVELOPER_MONTHLY_PRICE` | developer monthly | `59900` |
| `PAYMOB_PLAN_DEVELOPER_YEARLY_PRICE` | developer yearly | `599000` |

### 3.7 — Ollama (Local LLM)

| Variable | الوصف | الـ default |
|---|---|---|
| `OLLAMA_URL` | Ollama API URL | `http://127.0.0.1:11434` |
| `OLLAMA_BASE_URL` | alias | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | default text model | `glm-fast` (مبني من `qwen2.5:1.5b` + `models/Modelfile.qwen`) |
| `OLLAMA_TIMEOUT_MS` | request timeout | `180000` (3 min) |

### 3.8 — News Agent

| Variable | الوصف | الـ default |
|---|---|---|
| `PRODUCTION_SERVER_URL` | URL للـ Next.js (للـ POST الأخبار) | `http://127.0.0.1:3000` |
| `COLLECTION_INTERVAL_MINUTES` | فترة الجمع | `15` |
| `MIN_IMPORTANCE_SCORE` | عتبة الأهمية | `55` |
| `MAX_NEWS_PER_BATCH` | max batch size | `20` |
| `ENABLE_EGYPTIAN_SOURCES` | تفعيل المصادر المصرية | `0` (افتراضياً معطّل) |

### 3.9 — Production Proxy

| Variable | الوصف | الـ default |
|---|---|---|
| `PRODUCTION_SERVER_URL` | URL للإنتاج (proxy-prod) | `https://invist.m2y.net` |
| `MAIN_DOMAIN` | الـ public domain | `https://invist.m2y.net` |

### 3.10 — EODHD (Historical Data)

| Variable | الوصف | الـ default |
|---|---|---|
| `EODHD_API_KEY` | EODHD API key (لا fallback — ألغي الـ subscription) | (env) |

### 3.11 — Node/Bun Interpreters

| Variable | الوصف | الـ default |
|---|---|---|
| `NODE_BIN` | override Node binary path | (auto: نـ select أحدث nvm node ≥ 22) |
| `BUN_PATH` | override Bun binary path | (auto: `~/.bun/bin/bun` لو موجود) |

### 3.12 — Performance Tuning (Next.js)

| Variable | الوصف | الـ default |
|---|---|---|
| `UV_THREADPOOL_SIZE` | libuv thread pool | `2` |
| `SWC_THREADPOOL` | SWC compiler threads | `1` |
| `RAYON_NUM_THREADS` | Rust rayon threads (better-sqlite3) | `1` |
| `SKIP_CRYPTO_LAB` | تعطيل crypto scheduler (للـ low-RAM) | `0` |
| `ENABLE_BACKGROUND_SYNC` | تفعيل background sync (معطّل افتراضياً) | (unset) |

### 3.13 — Git / GitHub

| Variable | الوصف | ملاحظات |
|---|---|---|
| (git credentials) | `~/.git-credentials` + `credential.helper='!f() { echo "username=x-access-token"; echo "password=ghp_..."; }; f'` | للـ push من السيرفر. ** مهم**: rotate الـ tokens بشكل دوري |

### 3.14 — قالب الـ `.env` للإنتاج

```bash
# /root/GLMinvestment/.env
NODE_ENV=production
PORT=3000
DATABASE_URL=file:/root/GLMinvestment/db/custom.db

# NextAuth
NEXTAUTH_SECRET=<strong-random-secret>
NEXTAUTH_URL=https://invist.m2y.net
GOOGLE_CLIENT_ID=<google-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<google-secret>

# Admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong-password>
ADMIN_SESSION_TOKEN=<random-64-hex>
ADMIN_EMAIL=admin@invist.m2y.net
# ALLOW_ADMIN_BYPASS: NEVER set in production

# Python
PYTHON_BACKEND_URL=http://localhost:8010
PROXY_API_KEY=<random-32-hex>
VPS_API_KEY=<random-32-hex>

# Telegram
TELEGRAM_BOT_TOKEN=<bot-token>
TELEGRAM_API_ID=<api-id>
TELEGRAM_API_HASH=<api-hash>
TELEGRAM_CHANNEL_ID=@<channel>
BOT_API_SECRET=<random-32-hex>

# Paymob
PAYMOB_API_KEY=<paymob-key>
PAYMOB_HMAC=<paymob-hmac-secret>
PAYMOB_IFRAME_ID=993228
PAYMOB_CARD_INTEGRATION_ID=5716783

# Ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=glm-fast
OLLAMA_TIMEOUT_MS=180000

# News Agent
PRODUCTION_SERVER_URL=http://127.0.0.1:3000
COLLECTION_INTERVAL_MINUTES=15
MIN_IMPORTANCE_SCORE=55
MAX_NEWS_PER_BATCH=20
ENABLE_EGYPTIAN_SOURCES=0

# Production Proxy
PRODUCTION_SERVER_URL=https://invist.m2y.net
MAIN_DOMAIN=https://invist.m2y.net

# EODHD (optional — subscription cancelled)
# EODHD_API_KEY=

# Performance (low-RAM VPS)
UV_THREADPOOL_SIZE=2
SWC_THREADPOOL=1
RAYON_NUM_THREADS=1
# SKIP_CRYPTO_LAB=1  # uncomment if RAM < 4GB

# Next.js
NEXT_PUBLIC_API_URL=https://invist.m2y.net
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<same-as-GOOGLE_CLIENT_ID>
```

---

## 4. خدمات PM2 (8 خدمات)

الـ config في `ecosystem.config.js`. الـ env file بـ يـ load تلقائياً (line 76-94) قبل ما أي خدمة تشتغل.

### 4.1 — قائمة الخدمات

| # | Name | Script | CWD | Interpreter | Port | max_memory_restart |
|---|---|---|---|---|---|---|
| 1 | `python-backend` | `main.py` | `vps-service/` | `.venv/bin/python` | 8010 | 500M |
| 2 | `data-engine` | `main.py` (as args) | `data_engine/` | `.venv/bin/python` (as script) | 5000 | 500M |
| 3 | `nextjs` | `node_modules/next/dist/bin/next` | root | Node ≥ 22 (nvm) | 3000 | 1500M |
| 4 | `ws-service` | `index.ts` | `vps-service/ws-service/` | Bun | 3005 | 200M |
| 5 | `telegram-poster` | `telegram/auto_post_scheduler.py` | `vps-service/` | `.venv/bin/python` | — | 300M |
| 6 | `telegram-interactive-bot` | `telegram/telegram_interactive_bot.py` | `vps-service/` | `.venv/bin/python` | — | 300M |
| 7 | `telegram-events` | `index.ts` | `telegram-events/` | Bun | 3003 | 150M |
| 8 | `news-agent` | `main.py` | `news-agent/` | `news-agent/.venv/bin/python` (fallback: root venv / system) | — | 300M |

> **Ollama** (port 11434) مش خدمة PM2 — بيـ managed by `systemd` (`sudo systemctl enable ollama`). شغّال 24/7.

### 4.2 — أوامر PM2

```bash
# Start all 8 services
pm2 start ecosystem.config.js

# Status / table view
pm2 status
pm2 list

# Logs
pm2 logs                           # all services (streaming)
pm2 logs nextjs --lines 100        # last 100 lines for nextjs only
pm2 logs python-backend --lines 50
pm2 logs ws-service telegram-events --lines 50

# Live monitoring (CPU/RAM/restarts dashboard)
pm2 monit

# Restart
pm2 restart all                    # restart all
pm2 restart nextjs                 # restart single
pm2 reload nextjs                  # zero-downtime reload (cluster mode only)

# Stop / Delete
pm2 stop all
pm2 delete all                     # remove from PM2 list (keep code)
pm2 delete nextjs                  # delete single

# Detailed info
pm2 describe nextjs                # full config + env + logs paths
pm2 info python-backend

# Save / Resurrect (for boot persistence)
pm2 save                           # save current process list
pm2 startup                        # generate systemd unit for PM2
pm2 resurrect                       # restore saved list after reboot

# Flushing logs (free disk)
pm2 flush                          # clear all log files
pm2 flush nextjs                   # clear one service

# Reset restart counters
pm2 reset                          # reset restart_count for all
```

### 4.3 — ملفات الـ Logs

كل خدمة بـ تـ write لـ `./logs/`:

| Service | out_file | error_file |
|---|---|---|
| python-backend | `./logs/python-backend-out.log` | `./logs/python-backend-error.log` |
| data-engine | `./logs/data-engine-out.log` | `./logs/data-engine-error.log` |
| nextjs | `./logs/nextjs-out.log` | `./logs/nextjs-error.log` |
| ws-service | `./logs/ws-service-out.log` | `./logs/ws-service-error.log` |
| telegram-poster | `./logs/telegram-poster-out.log` | `./logs/telegram-poster-error.log` |
| telegram-interactive-bot | `./logs/telegram-interactive-bot-error.log` | `./logs/telegram-interactive-bot-error.log` |
| telegram-events | `./logs/telegram-events-out.log` | `./logs/telegram-events-error.log` |
| news-agent | `./logs/news-agent-out.log` | `./logs/news-agent-error.log` |

### 4.4 — Auto-restart Behavior

كل خدمة بـ تـ auto-restart على crash مع:
- `autorestart: true`
- `max_restarts: 10` (max restarts within window)
- `restart_delay: 5000` (5s delay between restarts)
- `kill_timeout: 10000-15000` (graceful shutdown wait)
- `max_memory_restart`: لو تجاوزت الـ RAM الـ specified → restart تلقائي

### 4.5 — PM2 Logs Rotation (مهم)

**Install مرة واحدة** عشان ما تـ overflow الـ disk:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M           # rotate عند 50MB
pm2 set pm2-logrotate:retain 7                # keep آخر 7 files
pm2 set pm2-logrotate:compress true           # gzip الـ old files
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:workerInterval 30       # check كل 30s
pm2 set pm2-logrotate:rotateInterval '0 * * * *'  # hourly check
```

---

## 5. بوابة Caddy (Gateway)

الـ `Caddyfile` على root الـ project. Caddy بيـ run على **port 81** + **port 443** (TLS terminator).

### 5.1 — الـ Caddyfile الكامل

```caddy
:81 {
    # Pattern: أي request فيه ?XTransformPort=<port> في الـ query
    @transform_port_query {
        query XTransformPort=*
    }
    handle @transform_port_query {
        # وجّه الطلب لـ localhost:<port> المُحدَّد في الـ query
        reverse_proxy localhost:{query.XTransformPort} {
            header_up Host {host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
            header_up X-Real-IP {remote_host}
        }
    }

    # Default: كل باقي الطلبات → Next.js على 3000
    handle {
        reverse_proxy localhost:3000 {
            header_up Host {host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
            header_up X-Real-IP {remote_host}
        }
    }
}
```

### 5.2 — قواعد التوجيه (Routing Rules)

| الـ URL | الـ target | الـ reason |
|---|---|---|
| `https://invist.m2y.net/` | `localhost:3000` (Next.js) | default |
| `https://invist.m2y.net/api/...` (بدون query) | `localhost:3000` | Next.js API routes |
| `https://invist.m2y.net/api/multi-market/sync?XTransformPort=8010` | `localhost:8010` (Python) | bypass Next.js proxy |
| `https://invist.m2y.net/?XTransformPort=3003` (Socket.io) | `localhost:3003` (telegram-events) | admin TelegramTab live |
| `https://invist.m2y.net/socket.io/?XTransformPort=3005` | `localhost:3005` (ws-service) | market push |
| `https://invist.m2y.net/api/data-engine/...?XTransformPort=5000` | `localhost:5000` (data-engine) | direct scraper control |

### 5.3 — Caddy أوامر

```bash
# Start Caddy (systemd)
sudo systemctl start caddy
sudo systemctl enable caddy
sudo systemctl status caddy

# Reload config (بعد تعديل Caddyfile)
sudo systemctl reload caddy
# أو
caddy reload --config /root/GLMinvestment/Caddyfile

# Validate config
caddy validate --config /root/GLMinvestment/Caddyfile

# Run in foreground (debug)
caddy run --config /root/GLMinvestment/Caddyfile

# Logs
sudo journalctl -u caddy -f
sudo journalctl -u caddy --since "1 hour ago"
```

### 5.4 — TLS Certificates

Caddy بيـ auto-issue + auto-renew شهادات Let's Encrypt لـ `invist.m2y.net` (ومن أي domain في الـ Caddyfile). مش محتاج certbot.

```bash
# الـ certs بتـ store في:
/var/lib/caddy/.local/share/caddy/certificates/
```

### 5.5 — تنبيه: HTTP → HTTPS Redirect

Caddyfile المختصر الحالي بيـ listen على `:81` (HTTP). للـ HTTPS redirect على الـ public، لازم تضيف block منفصل:

```caddy
# Optional: HTTP → HTTPS redirect
:80 {
    redir https://{host}{uri} permanent
}

# HTTPS listener
invist.m2y.net {
    # ... same logic as :81
}
```

> **الحالة الحالية:** الإنتاج بيـ run Caddy behind Cloudflare/nginx terminator — لذلك `:81` HTTP كافٍ.

---

## 6. نمط XTransformPort

> شوف أيضاً `Documentation/04-API-REFERENCE.md` §4 — البوابة.

### 6.1 — الفكرة

الـ XTransformPort query param بيـ let الـ frontend يختار الـ backend port ديناميكياً **بدون ما يـ hardcode URL**. هذا بـ يحل:

1. **الـ dev/prod parity**: على اللابتوب (بدون Caddy)، الـ Next.js proxy بيـ handle. على الإنتاج (مع Caddy)، الـ gateway بيـ route مباشرةً.
2. **bypass proxy overhead**: للـ endpoints الثقيلة (multi-market sync، chart data) بـ تتخطى Next.js تماماً.
3. **multi-service routing**: الـ admin tabs بـ تـ select الخدمة (telegram-events، ws-service) عبر الـ query.

### 6.2 — أمثلة في الكود

```ts
// src/lib/ws-client.ts (Socket.io client)
const socket = io('/?XTransformPort=3005', {
  // Caddy بـ يـ route لـ localhost:3005
  // على dev (localhost) بـ يـ connect /socket.io/ مباشرة على Next.js → rewrite لـ :3005
});

// src/modules/admin/components/telegram-tab/TelegramTab.tsx
const s = io('/?XTransformPort=3003', { /* socket.io opts */ });

// src/modules/admin/components/DataScraperControl.tsx
const response = await fetch('/api/multi-market/sync?XTransformPort=8010', { ... });

// src/modules/portfolio/components/AdvancedPortfolioManager.tsx
const url = path.includes('?')
  ? `${path}&XTransformPort=8010`
  : `${path}?XTransformPort=8010`;
```

### 6.3 — الـ safe pattern (Rule 211)

```ts
// ❌ خطأ: hardcoded localhost
fetch('http://localhost:8010/api/market/overview')

// ✅ صحيح: relative URL + XTransformPort
fetch('/api/market/overview?XTransformPort=8010')

// ✅ أو: proxy عبر Next.js (افتراضي لو مفيش XTransformPort)
fetch('/api/python/market/overview')
fetch('/api/proxy/market/overview')
```

### 6.4 — حدود الـ pattern

- مفيش `XTransformPort` للـ services اللي مش بتـ publish على localhost (مثلاً Ollama على 11434 — مش route عبر Caddy).
- الـ admin paths (`/api/admin/*`) ما ينفعش تـ bypass لـ Python مباشرةً — Next.js admin gate لازم يـ apply أولاً.

---

## 7. إعداد Next.js (next.config.mjs)

الـ file في `/root/GLMinvestment/next.config.mjs`. أهم الإعدادات:

### 7.1 — serverExternalPackages (Native Node Modules)

Next 16 نقل الـ config من `experimental.serverComponentsExternalPackages` لـ top-level. الـ packages دي لازم ما تـ bundle في الـ browser:

```js
serverExternalPackages: [
  "better-sqlite3",          // Native SQLite bindings
  "sql.js",                   // WASM SQLite
  "@prisma/client",           // Prisma client
  "@prisma/auth-client",
  "@prisma/predictions-client",
],
```

> بدون ده، Turbopack بيـ يحاول يـ bundle native modules → `ReferenceError: module is not defined` في الـ browser.

### 7.2 — staticPageGenerationTimeout

```js
staticPageGenerationTimeout: 300, // 5 دقايق (default 60s)
```

الـ VPS البطيء + الـ DBs الكبيرة بيـ cause timeout أثناء الـ static generation.

### 7.3 — experimental.optimizePackageImports

تقليل حجم الـ bundle عبر tree-shaking الـ heavy UI libs:

```js
experimental: {
  cpus: 1,                    // VPS محدود
  optimizePackageImports: [
    "lucide-react",
    "@radix-ui/react-accordion",
    "@radix-ui/react-dialog",
    // ... 20+ radix packages
    "date-fns",
    "framer-motion",
    "recharts",
    "react-markdown",
    "react-syntax-highlighter",
    "lightweight-charts",
    "@tanstack/react-table",
    "@tanstack/react-query",
  ],
  outputFileTracingRoot: __dirname,
  outputFileTracingExcludes: {
    "*": [
      "**/*.db",
      "**/*.db-wal",
      "**/*.db-shm",
      "**/*.db-journal",
      "**/*.zip",
      "./vps-service/data/egksco/*.pdf",
      "./node_modules/pm2/**/*",
      "./node_modules/playwright/**/*",
    ],
  },
},
```

### 7.4 — env (Public Runtime Vars)

```js
env: {
  EGXPY_SERVICE_URL: process.env.EGXPY_SERVICE_URL || process.env.EGX_VPS_API_URL || "http://localhost:8010",
  EGX_VPS_API_URL: process.env.EGX_VPS_API_URL || process.env.EGXPY_SERVICE_URL || "http://localhost:8010",
},
```

### 7.5 — webpack config

```js
webpack: (config) => {
  config.resolve.alias["@"] = path.resolve(__dirname, "src");
  return config;
},
```

### 7.6 — headers (Caching للـ static)

```js
async headers() {
  return [{
    source: "/_next/static/:path*",
    headers: [{ key: "Cache-Control", value: "public, max-age=3600, must-revalidate" }],
  }];
},
```

### 7.7 — rewrites (Next.js → Python passthrough)

```js
async rewrites() {
  return [
    { source: "/socket.io/:path*", destination: "http://127.0.0.1:3005/socket.io/:path*" },
    // Picks Management — proxy to Python backend (port 8010)
    { source: "/api/predictions/daily-picks", destination: "http://127.0.0.1:8010/api/predictions/daily-picks" },
    { source: "/api/predictions/daily-picks/history", destination: "http://127.0.0.1:8010/api/predictions/daily-picks/history" },
    { source: "/api/predictions/active-management", destination: "http://127.0.0.1:8010/api/predictions/active-management" },
    { source: "/api/predictions/management/refresh", destination: "http://127.0.0.1:8010/api/predictions/management/refresh" },
    { source: "/api/predictions/management/health", destination: "http://127.0.0.1:8010/api/predictions/management/health" },
  ];
},
```

### 7.8 — TypeScript + ESLint

```js
typescript: { ignoreBuildErrors: true },     // سرّع الـ build
eslint: { ignoreDuringBuilds: true },         // سرّع الـ build
reactStrictMode: false,                       // منع double-render في الإنتاج
```

### 7.9 — تنبيهات Rule 127

> **Rule 127 (CONSTITUTION):** ممنوع تعديل `next.config.mjs` بدون أمر المالك.

### 7.10 — Build Process

```bash
# Build (slow but production-ready)
bun run build
# أو
npm run build

# Output: .next/ directory (NOT standalone — see comment in next.config.mjs line 9-14)
# Note: standalone معطّل عشان pm2 بيـ شغّل `next start -p 3000` من .next/
```

---

## 8. Cron Jobs (26 مهمة)

الـ file في `crontab.txt` — **المصدر الكنسي الوحيد** (Rule 21 SSOT). كل المسارات بتـ reference `/root/GLMinvestment` (الـ production VPS path).

### 8.1 — التثبيت

```bash
# Install crontab
crontab crontab.txt

# Verify
crontab -l

# Adapt paths for staging/sandbox
sed "s|/root/GLMinvestment|$(pwd)|g" crontab.txt > /tmp/crontab.txt && crontab /tmp/crontab.txt
```

### 8.2 — جدول المهام (26 cron)

| # | Schedule (UTC) | Cron Expression | Command | الوصف |
|---|---|---|---|---|
| 1 | 03:00 Sun-Thu | `0 3 * * 0-4` | `vps-service/jobs/daily_predictor.py --today-only --max-picks 5` | V40.2 morning predictions (قبل فتح السوق) |
| 2 | 13:30 Sun-Thu | `30 13 * * 0-4` | `daily_predictor.py --yesterday-only --max-picks 5` | V40.2 evening predictions (بعد إغلاق السوق) |
| 3 | every 5min 08-12 UTC Sun-Thu | `*/5 8-12 * * 0-4` | `vps-service/jobs/intraday_scanner.py --limit 5` | V40.2 Intraday Scanner |
| 4 | every 2min 08-12 UTC Sun-Thu | `*/2 8-12 * * 0-4` | `data_engine/intraday_storage.py --stocks` | Intraday storage snapshots |
| 5 | 14:00 Sun-Thu | `0 14 * * 0-4` | `vps-service/jobs/daily_closer.py` | إغلاق الصفقات (وصلت للهدف/الوقف) |
| 6 | 15:00 Sun-Thu | `0 15 * * 0-4` | `vps-service/jobs/learning_engine.py` | محرك التعلم |
| 7 | 04:00 Sun-Thu | `0 4 * * 0-4` | `vps-service/jobs/fetch_corporate_actions.py` | توزيعات + اكتتاب |
| 8 | 07:00 + 13:00 Sun-Thu | `0 7,13 * * 0-4` | `vps-service/scripts/daily_price_updater.py` | EGX OHLC → price_history.db |
| 9 | every 5min 08-12 UTC Sun-Thu | `*/5 8-12 * * 0-4` | `data_engine/scrapers/tradingview_scraper.py` | TradingView scraper |
| 10 | 06:00 Sun-Thu | `0 6 * * 0-4` | `vps-service/jobs/price_history_safetynet.py` | Yahoo Finance fallback |
| 11 | 01:00 daily | `0 1 * * *` | `vps-service/scripts/data_heartbeat_checker.py` | فحص صحة DBs |
| 12 | 01:30 daily | `30 1 * * *` | `vps-service/scripts/smart_db_backup.py` | نسخة احتياطية ذكية |
| 13 | 14:00 Sat | `0 14 * * 6` | `vps-service/data/egx_fundamental_fetcher.py` | جلب الأساسيات |
| 14 | every 2h 08-12 UTC Sun-Thu | `0 8-12/2 * * 0-4` | `-c "from analyzers.egx_disclosure_engine import fetch_and_store_disclosures; print(fetch_and_store_disclosures(50))"` | EGX disclosures |
| 15 | 13:35 Sun-Thu | `35 13 * * 0-4` | `scripts/sync_hunter_pick_tracking.py` | مزامنة توقعات V40.2 → hunter_pick_tracking |
| 16 | 02:00 daily | `0 2 * * *` | `curl -s -X POST http://localhost:3000/api/maker-radar/signal-tracker/verify -H "Content-Type: application/json" -d '{"max_age_days": 45}'` | Radar Signal Tracker verify |
| 17 | 02:50 Sun-Thu | `50 2 * * 0-4` | `-c "from analyzers.market_regime_engine import MarketRegimeEngine; MarketRegimeEngine('EGX').update_regime()"` | Market Regime Engine (EGX) |
| 18 | 02:55 Sat | `55 2 * * 6` | `vps-service/analyzers/market_regime_engine.py --all` | Market Regime Engine (multi-market) |
| 19 | 06:00 Sun | `0 6 * * 0` | `scripts/weekly_radar_report.py --market EGX --send-telegram` | Weekly Radar Report |
| 20 | 22:00 Mon-Fri | `0 22 * * 1-5` | `data_engine/scrapers/us_stock_scraper.py` | US Stock Scraper (Yahoo) |
| 21 | hourly 09-22 UTC | `0 9-22 * * *` | `data_engine/scrapers/multi_market_scraper.py` | Multi-Market Scraper |
| 22 | 04:00 Sun | `0 4 * * 0` | `scripts/mine_learned_lessons.py` | Mine Learned Lessons |
| 23 | 05:00 monthly (1st) | `0 5 1 * *` | `scripts/exit_policy_optimizer.py` | Exit Policy Optimizer |
| 24 | 14:30 Sun-Thu | `30 14 * * 0-4` | `scripts/post_market_feedback.py` | Post-Market Feedback |
| 25 | every 15min 08-12 UTC Sun-Thu | `*/15 8-12 * * 0-4` | `vps-service/jobs/hot_candidate_detector.py` | Hot Candidate Detector |
| 26 | 14:30 Sun-Thu | `30 14 * * 0-4` | `scripts/telegram_comprehensive_report.py --send` | Telegram Comprehensive Report |
| 27 | 03:00 daily | `0 3 * * *` | `bun run scripts/downgrade-expired-subscriptions.ts` | Downgrade Expired Subscriptions |
| 28 | 15:30 Sat | `30 15 * * 6` | `data_engine/scrapers/sharia_compliance_scraper.py` | Sharia Compliance Scraper |
| 29 | every 5min 08-14 UTC Sun-Thu (×5 markets) | `*/5 8-14 * * 0-4` | `scripts/maker_radar.py --market <EGX/TADAWUL/KSE/QSE/US> --json-only` | Maker Radar (5 markets) |
| 30 | every 5min 24/7 (×2 markets) | `*/5 * * * *` | `scripts/maker_radar.py --market <CRYPTO/GOLD> --json-only` | Maker Radar (CRYPTO + GOLD) |

### 8.3 — Timezone Notes

- الـ VPS = **UTC**. Cairo = UTC + 2 (Africa/Cairo).
- أيام تداول EGX: الأحد-الخميس (cron: `0-4`).
- أيام تداول US: الإثنين-الجمعة (cron: `1-5`).
- CRYPTO + GOLD: 24/7 (cron: `*`).

### 8.4 — Logs

كل cron بـ write لـ `/tmp/<job-name>.log`. أمثلة:

```
/tmp/v40_2_morning.log
/tmp/v40_2_evening.log
/tmp/v40_2_intraday.log
/tmp/daily_closer.log
/tmp/learning_engine.log
/tmp/smart_db_backup.log
/tmp/heartbeat.log
/tmp/maker_radar_egx.log
/tmp/maker_radar_crypto.log
/tmp/weekly_report.log
/tmp/learned_lessons.log
```

---

## 9. النسخ الاحتياطي (Backup Strategy)

الـ backup بيـ run عبر **3 آليات متوازية**:

### 9.1 — Smart DB Backup (cron #12 — يومياً 01:30 UTC)

الـ file: `vps-service/scripts/smart_db_backup.py`. الأذكى منهم — بيـ protect من الـ catastrophic data loss:

**المنطق:**

1. WAL checkpoint لكل DB (لدمج الـ WAL في الـ main DB).
2. PRAGMA integrity_check لكل DB.
3. يقارن حجم الـ DB الحالي vs آخر backup سليم.
4. **لو حجم أي DB نقص ≥ 20%** (SHRINK_THRESHOLD = 0.20):
   - بـ يـ refuse يعمل backup جديد للملف ده.
   - بيعمل **Restore فوري** من آخر backup سليم.
   - بـ ينزل إنذار في الـ log.
5. لو الحجم سليم → بيعمل backup جديد.
6. **Rotation**: بيفضل آخر **7 backups** لكل DB.

**الـ DBs المراقبة:**

```python
WATCH_DBS = [
    'stocks.db',           # 29MB
    'data_engine.db',      # 482MB
    'price_history.db',    # 352MB (canonical)
    'predictions.db',     # 281MB
    'auth.db',             # 376KB
    'intraday.db',
    'crypto.db',
]
```

**الـ paths:**

- الـ backups: `db/backups/smart/`
- الـ log: `db/backups/smart_guard.log`

**Exit codes:**

| Code | المعنى |
|---|---|
| 0 | كل حاجة سليمة |
| 1 | فيه تحذيرات بس الـ restore اشتغل |
| 2 | خطأ حرج (مش قادر يكمل) |

### 9.2 — Daily Backup (backup قبل أي deploy)

الـ file: `vps-service/scripts/daily_backup.py`. بـ run **يدوياً قبل الـ deploy**:

**المنطق:**

1. WAL checkpoint لكل الـ DBs.
2. PRAGMA integrity_check لكل DB.
3. يعمل timestamped backups في `db/backups/daily/`.
4. **Rotation**: 
   - يحتفظ بآخر **7** backups يومية.
   - يحتفظ بآخر **4** backups أسبوعية (كل أحد).
   - يحتفظ بآخر **3** backups شهرية (أول كل شهر).
5. Log كل شيء في `db/backups/backup.log`.

**الـ exclude DBs:**

```python
EXCLUDE_DBS = {'_corrupt_backup_20260710_195845'}  # corrupt backup
# Skip: backup, corrupt, recover, original, temp, tmp, test في الاسم
```

### 9.3 — Pre-Deploy Backup (يدوي)

قبل أي deploy، `scripts/deploy.sh` و `scripts/deploy_production.sh` بـ يعملوا backup كامل:

```bash
# scripts/deploy.sh line 28-40
BACKUP_DIR="db/backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
for db in db/*.db; do
    [ -f "$db" ] && cp "$db" "$BACKUP_DIR/"
done
```

```bash
# scripts/deploy_production.sh line 44-56
BACKUP_DIR="$PROJECT_ROOT/db/pre_deploy_backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp db/*.db "$BACKUP_DIR/"
```

### 9.4 — Backup Strategy Summary

| النوع | متى | الـ path | rotation | الـ DBs |
|---|---|---|---|---|
| Smart (automated) | يومياً 01:30 UTC (cron #12) | `db/backups/smart/` | 7 لكل DB | 7 DBs حرجة |
| Daily (manual) | قبل deploy | `db/backups/daily/` | 7 daily + 4 weekly + 3 monthly | كل *.db |
| Pre-deploy (manual) | قبل كل deploy | `db/backup_<timestamp>/` أو `db/pre_deploy_backup_<timestamp>/` | يدوي | كل *.db |

### 9.5 — Restore Manual

لو احتجت تعمل restore يدوي:

```bash
# Stop services أولاً (مهم عشان ما تتعارضش مع الـ WAL)
pm2 stop python-backend data-engine

# Restore من smart backup
cp db/backups/smart/stocks.db.<timestamp> db/stocks.db
cp db/backups/smart/predictions.db.<timestamp> db/predictions.db
# ... etc

# Restore من pre-deploy backup
cp db/pre_deploy_backup_<timestamp>/*.db db/

# Restart services
pm2 start python-backend data-engine
```

---

## 10. المراقبة (Monitoring)

### 10.1 — Health Endpoint (Next.js)

الـ route: `GET /api/health` (Next.js, port 3000). بـ return JSON مفصّل:

```jsonc
{
  "status": "ok|degraded|down",
  "timestamp": "2026-10-24T12:00:00Z",
  "components": {
    "nextjs": { "status": "ok" },
    "python-backend": { "status": "ok", "port": 8010, "reachable": true, "pid": 12345 },
    "ws-service": { "status": "ok", "port": 3005, "reachable": true, "pid": 12346 },
    "telegram-events": { "status": "ok", "port": 3003, "reachable": true },
    "news-agent": { "status": "ok", "reachable": true, "pid": 12347 },
    "databases": {
      "stocks.db": { "status": "ok", "size_mb": 29.1, "rows": 1039 },
      "predictions.db": { "status": "ok", "size_mb": 281.4, "rows": 1488 },
      "price_history.db": { "status": "ok", "size_mb": 352.0, "rows": 274574, "latest_date": "2026-10-23" },
      "data_engine.db": { "status": "ok", "size_mb": 482.1, "rows": 2492 },
      "intraday.db": { "status": "ok", "size_mb": 12.3 },
      "auth.db": { "status": "ok", "size_mb": 0.4, "rows": 0 }
    },
    "disk": { "status": "ok", "free_gb": 12, "total_gb": 50, "used_pct": 76 }
  }
}
```

**الـ logic:**

- **status="ok"**: كل الـ components سليمة.
- **status="degraded"**: خدمة غير حرجة معطّلة (telegram-events / news-agent) **أو** DB غير حرج مش موجود.
- **status="down"**: DB حرج (stocks / predictions / auth) معطّل، **أو** disk > 95% ممتلئ، **أو** python-backend مش reachable.

**الـ cache:** 60s (in-memory). الـ health check غالي (بـ يفتح كل DB) — عشان كده الـ cache بيمنع الـ DOS.

**HTTP status:** `200` لو ok/degraded، `503` لو down.

### 10.2 — Python Backend Health

الـ route: `GET /health` (Python, port 8010). بسيط:

```jsonc
{ "status": "ok", "service": "GLM Finance Backend", "version": "2.0.0" }
```

كمان: `GET /api/health` (Python) — مفصّل، بـ يفحص كل الـ sub-components (DBs + engines + queue depth + circuit breakers).

`POST /api/health/circuits/reset` — reset كل الـ circuit breakers (للـ admin).

### 10.3 — Metrics Collector (Next.js instrumentation)

الـ file: `src/instrumentation.ts` + `src/lib/metrics-collector.ts` + `src/lib/metrics-db.ts`.

**السلوك:**

- بـ يبدأ مع الـ Next.js server (مرة واحدة).
- بـ يجمع snapshot كل **15s** (`setInterval(15_000)`).
- بـ يـ persist لـ `db/metrics.db` (SQLite).
- بـ يعمل retention كل **60 collection** (≈ 15 min) — بـ يحذف الـ snapshots القديمة حسب tiered retention.
- بـ يكتشف anomalies كل **4 collections** (≈ 1 min).

**الـ snapshot fields:**

```ts
interface SnapshotData {
  ts: string;              // ISO8601 UTC
  cpu: number;             // 0-100
  mem_pct: number;
  mem_used_mb: number;
  mem_total_mb: number;
  disk_pct: number;
  disk_used_gb: number;
  disk_total_gb: number;
  load1: number; load5: number; load15: number;
  pm2_online: number; pm2_total: number;
  pm2_total_cpu: number; pm2_total_mem_mb: number;
  node_rss_mb: number;
  net_rx_kb: number; net_tx_kb: number;
}
```

### 10.4 — Admin System Resources Endpoints

الـ admin dashboard بـ يـ consume الـ metrics من:

| Endpoint | الوصف |
|---|---|
| `GET /api/admin/system-resources` | snapshot حالي (CPU, RAM, disk, PM2) |
| `GET /api/admin/system-resources/history` | historical snapshots (last N) |
| `GET /api/admin/system-resources/process-history` | process history (per-PM2-service) |
| `GET /api/admin/system-resources/anomalies` | anomalies detected (CPU spikes, memory leaks, etc.) |
| `GET /api/admin/system-health` | high-level health (shortcut لـ /api/health) |
| `GET /api/admin/cron-health` | حالة الـ cron jobs (آخر run لكل job) |
| `GET /api/admin/data-health` | فحص صحة الداتا (rows, latest dates, missing tickers) |
| `GET /api/admin/news-health` | فحص صحة الأخبار |
| `GET /api/admin/platform-performance` | أداء المنصة (response times, error rates) |
| `GET /api/admin/system-topology` | topology (services + ports + dependencies) |

### 10.5 — PM2 Monitoring

```bash
# Live dashboard (CPU/RAM per process)
pm2 monit

# Process list with stats
pm2 jlist | jq '.[] | {name, status, cpu, memory, restarts, uptime}'

# Restart counts (high count = unstable)
pm2 list | awk '{print $2, $14}' | sort -k2 -rn | head
```

### 10.6 — Caddy Logs

```bash
# Access logs (HTTP requests)
sudo journalctl -u caddy -f | grep "GET\|POST"

# Error logs
sudo journalctl -u caddy -f -p err

# Specific time range
sudo journalctl -u caddy --since "1 hour ago" --until "now"
```

### 10.7 — Python Backend Logs

```bash
# Live
pm2 logs python-backend --lines 50

# Errors only
pm2 logs python-backend --err --lines 100

# Grep for specific error
rg "ERROR|Exception|Traceback" logs/python-backend-error.log | tail -50
```

### 10.8 — Cron Health

كل cron بـ write لـ `/tmp/<job>.log`. الـ admin endpoint `/api/admin/cron-health` بـ يـ parse الـ logs دي ويبلغ عن:
- آخر run ناجح لكل job.
- jobs معلّقة (ما اشتغلتش في الـ 24 ساعة الأخيرة).
- jobs بـ fail repeatedly.

---

## 11. عملية النشر (Deploy Process)

> **Workflow المرجعي (per `Documentation/06-TEAM-AND-WORKFLOW.md`):**
> 
> **Sandbox → Test → Merge → Deploy Night**

### 11.1 — Workflow Overview

```
┌─────────────┐      ┌───────────┐      ┌────────┐      ┌──────────┐
│ 1. Sandbox   │ ──→  │ 2. Test    │ ──→  │ 3. Merge│ ──→ │ 4. Deploy │
│ (Dev work)  │      │ (Verify)   │      │ (PR)   │      │ (Night)   │
│ /home/z/    │      │ smoke test │      │ origin │      │ VPS root  │
│ my-project  │      │ + manual   │      │  main  │      │ /root/    │
└─────────────┘      └───────────┘      └────────┘      └──────────┘
                                                ↑
                                                │
                                       ┌────────────────────┐
                                       │ 5. Verify (post-   │
                                       │    deploy health)   │
                                       │ /api/health          │
                                       │ pm2 status           │
                                       └────────────────────┘
```

### 11.2 — Step 1: Sandbox Development

الـ sandbox على `/home/z/my-project`. كل التطوير بيتم هنا:

```bash
# Start dev services
bun run dev                                   # Next.js على :3000
cd vps-service && .venv/bin/python main.py    # Python على :8010
cd data_engine && python main.py              # Data engine على :5000
cd vps-service/ws-service && bun run dev      # WS على :3005
```

**القواعد:**
- ممنوع `bun run build` في الساندبوكس (Rule 210) — استخدم `bun run dev` فقط.
- ممنوع `localhost:PORT` في الكود (Rule 211) — استخدم `?XTransformPort=`.
- ممنوع تعديل `next.config.mjs` (Rule 127).
- ممنوع لمس `schema.prisma` بدون إذن المالك (Rule 128).

### 11.3 — Step 2: Test (Pre-Merge)

```bash
# Smoke test (10 endpoints حرجة)
bash scripts/smoke_test.sh

# Output expected:
#   ✅ GET    /api/health                  → 200 (XXms)
#   ✅ GET    /api/market/overview         → 200 (XXms)
#   ✅ GET    /api/portfolio               → 401 (XXms)
#   ... 10/10 PASS
```

**Smoke test endpoints (10):**

| Method | Path | Expected |
|---|---|---|
| GET | `/api/health` | 200 |
| GET | `/api/market/overview` | 200 |
| GET | `/api/market/sectors` | 200 |
| GET | `/api/market/top-movers` | 200 |
| GET | `/api/portfolio` | 401 |
| GET | `/api/notifications/priority` | 401 |
| GET | `/api/screener/presets` | 200 |
| GET | `/api/market/regime` | 200 |
| POST | `/api/portfolio/create` | 401 |
| POST | `/api/ai/ask` | 401 |

### 11.4 — Step 3: Merge to main

```bash
# From sandbox
git add .
git commit -m "feat: <description>"
git push origin main

# Or via Pull Request on GitHub
```

### 11.5 — Step 4: Production Deploy (Night)

الـ deploy بيتم ليلاً (بعد إغلاق السوق المصري، عادة 22:00-02:00 Cairo). السبب: أقل traffic + الـ cron jobs اللي بـ run أثناء النهار مش هتتعارض.

#### Option A: Fast Deploy (`scripts/deploy.sh`)

```bash
cd /root/GLMinvestment
bash scripts/deploy.sh
# أو
bash scripts/deploy.sh --no-backup   # تخطي الـ backup (لو عملته يدوياً)
```

**Steps:**

1. **Backup** كل الـ DBs لـ `db/backup_<timestamp>/`.
2. **Git pull** (`git pull --rebase origin main`).
3. **Architecture check** (`scripts/check_architecture.py --strict --quiet`).
4. **Install deps** (`bun install` أو `npm install`).
5. **Build** (`bun run build` أو `npm run build`).
6. **Restart services** (`pm2 restart all`).
7. **Smoke test** (`bash scripts/smoke_test.sh`).

#### Option B: Production Deploy (`scripts/deploy_production.sh`)

أكثر تفصيلاً — بيـ verify كل phase:

```bash
cd /root/GLMinvestment
./scripts/deploy_production.sh
```

**Steps:**

0. **Backup** كل الـ DBs لـ `db/pre_deploy_backup_<timestamp>/`.
1. **Git pull** (`git pull origin main`).
2. **Check yfinance** (install لو ناقص).
3. **Audit** (`scripts/audit_production_db.py`).
4. **Phase 2 unify** (`scripts/unify_to_price_history.py`).
5. **Phase 5 verify** (`scripts/modify_get_tickers.py --verify` — expect 6/6 PASS).
6. **Phase 5b verify** (`scripts/verify_phase5b_liquidity_radar.py` — expect 8/8 PASS).
7. **Phase 6 verify** (`scripts/verify_phase6_safetynet.py` — expect 8/8 PASS).
8. **Runtime test** (`daily_predictor --today-only --max-tickers 10` + `liquidity_radar_v2 --ticker COMI`).

**_flags:**

```bash
./scripts/deploy_production.sh --backup-only      # Step 0 فقط
./scripts/deploy_production.sh --pull-only         # Step 1 فقط
./scripts/deploy_production.sh --phase2-only       # Step 4 فقط
./scripts/deploy_production.sh --phase5-only       # Step 5 فقط
./scripts/deploy_production.sh --phase5b-only      # Step 6 فقط
./scripts/deploy_production.sh --phase6-only       # Step 7 فقط
```

`set -e` بيوقف فوراً عند أي خطأ — ما يكملش.

### 11.6 — Step 5: Post-Deploy Verify

```bash
# 1. PM2 status (كل الخدمات online)
pm2 status
# Expected: 8 services, all "online", restart_count = 0

# 2. Health check
curl -s https://invist.m2y.net/api/health | jq '.status'
# Expected: "ok"

# 3. Logs (watch لأي errors)
pm2 logs --lines 50

# 4. price_history verification (آخر تاريخ)
sqlite3 db/price_history.db 'SELECT MAX(date) FROM price_history'
# Expected: تاريخ اليوم (أو أمس)

# 5. Smoke test
bash scripts/smoke_test.sh
# Expected: 10/10 PASS
```

---

## 12. الاسترجاع (Rollback Strategy)

### 12.1 — When to Rollback

- الـ smoke test فشل بعد الـ deploy.
- `/api/health` بترجع `down` أو `degraded` مع critical component.
- complaints من المستخدمين (errors في الـ dashboard / الـ Telegram bot مش شغّال).
- DB corruption اكتُشفت بعد الـ deploy.

### 12.2 — Rollback Procedure (Standard)

```bash
# Step 1: Stop services فوراً
pm2 stop all

# Step 2: Identify آخر pre-deploy backup
ls -lt db/pre_deploy_backup_*/ | head -5
# Example: db/pre_deploy_backup_20261024_140000/

# Step 3: Restore الـ DBs من الـ backup
BACKUP_DIR="db/pre_deploy_backup_20261024_140000"
cp $BACKUP_DIR/*.db db/

# Step 4: Rollback الكود لـ آخر commit صالح
git log --oneline -10                     # شوف آخر commit صالح
git reset --hard <last-good-commit-hash>

# Step 5: Restart services
pm2 start all

# Step 6: Verify
curl -s https://invist.m2y.net/api/health | jq '.status'
# Expected: "ok"
```

### 12.3 — Rollback Procedure (Smart DB Backup — DB Corruption Only)

لو الـ DB اتـ corrupt *بعد* الـ deploy (مش بعد الـ pre-deploy backup)، استخدم الـ smart_db_backup:

```bash
# الـ smart_db_backup.py بيعمل auto-restore لو حجم الـ DB نقص ≥ 20%
# لكن لو محتاج restore يدوي:

ls db/backups/smart/ | grep stocks.db
# stocks.db.20261023_013000
# stocks.db.20261022_013000
# stocks.db.20261021_013000
# ... (آخر 7)

# Stop Python services
pm2 stop python-backend data-engine

# Restore
cp db/backups/smart/stocks.db.20261023_013000 db/stocks.db

# Restart
pm2 start python-backend data-engine
```

### 12.4 — Rollback Procedure (Code Only — DB سليم)

لو الـ DB سليم والكود فقط مش شغّال:

```bash
# Step 1: Stop Next.js
pm2 stop nextjs

# Step 2: Git rollback
git log --oneline -5
git reset --hard <last-good-commit>

# Step 3: Rebuild
bun run build

# Step 4: Restart
pm2 start nextjs
```

### 12.5 — Rollback Procedure (Config Only — .env)

لو الـ deploy كسر الـ `.env`:

```bash
# Restore من git (لو الـ .env كان متـ commit — مش recommended)
# أو restore من backup يدوي
cp ~/.env.backup-20261023 .env

# Restart services عشان تـ pick up الـ new env
pm2 restart all
```

### 12.6 — Rollback Procedure (Caddy Config)

```bash
# الـ Caddyfile مش بـ version مع الـ code — بيـ store في /etc/caddy/Caddyfile
# لو اتعمل تعديل، rollback:
sudo cp /etc/caddy/Caddyfile.backup /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 12.7 — Post-Rollback Verification

```bash
# 1. Health check
curl -s https://invist.m2y.net/api/health | jq '.status'

# 2. Smoke test
bash scripts/smoke_test.sh

# 3. PM2 status
pm2 status

# 4. Notify stakeholders (Telegram)
# الـ admin بـ يـ send message لـ قناة الـ ops عن الـ rollback
```

### 12.8 — Rollback Tips

- **عايز تعمل rollback سريع بدون build؟** احتفظ بـ `.next/` من آخر deploy ناجح: `cp -r .next .next.last-good` قبل أي deploy.
- **عايز تعمل rollback DB بدون stop؟** مش ممكن — SQLite ما يدعمش online restore. لازم stop الـ services.
- **عايز تعمل rollback cron jobs؟** `crontab /tmp/crontab.previous` (لو عملت backup قبل التعديل).

---

## 13. أوامر سريعة (Cheat Sheet)

### 13.1 — Daily Ops

```bash
# Check status
pm2 status
curl -s https://invist.m2y.net/api/health | jq

# Restart single service
pm2 restart nextjs
pm2 restart python-backend

# View logs (live, last 100)
pm2 logs nextjs --lines 100
pm2 logs python-backend --lines 100 --err

# Check disk
df -h /root

# Check DB sizes
du -sh db/*.db | sort -h

# Check price_history latest date
sqlite3 db/price_history.db 'SELECT MAX(date) FROM price_history'

# Check predictions count
sqlite3 db/predictions.db 'SELECT status, COUNT(*) FROM predictions GROUP BY status'

# Run cron manually
cd /root/GLMinvestment && .venv/bin/python3 vps-service/jobs/daily_predictor.py --today-only --max-picks 5

# Trigger smart backup manually
.venv/bin/python3 vps-service/scripts/smart_db_backup.py

# Trigger daily backup manually
.venv/bin/python3 vps-service/scripts/daily_backup.py
```

### 13.2 — Emergency

```bash
# Stop everything NOW
pm2 stop all

# Restart everything
pm2 restart all

# Check what's listening on a port
ss -ltnp | grep :8010

# Kill a hung process
pm2 delete nextjs && pm2 start ecosystem.config.js --only nextjs

# View recent errors
pm2 logs --err --lines 200

# Force a WAL checkpoint
sqlite3 db/stocks.db 'PRAGMA wal_checkpoint(TRUNCATE);'

# Check cron log
tail -100 /tmp/v40_2_morning.log
tail -100 /tmp/daily_closer.log
tail -100 /tmp/smart_db_backup.log
```

### 13.3 — Deploy

```bash
# Full deploy
bash scripts/deploy.sh

# Backup only
bash scripts/deploy.sh --no-backup   # تخطي
./scripts/deploy_production.sh --backup-only

# Pull only
./scripts/deploy_production.sh --pull-only

# Phase-by-phase
./scripts/deploy_production.sh --phase2-only
./scripts/deploy_production.sh --phase5-only
./scripts/deploy_production.sh --phase5b-only
./scripts/deploy_production.sh --phase6-only
```

### 13.4 — Rollback

```bash
# Standard rollback
pm2 stop all
ls -lt db/pre_deploy_backup_*/ | head -3
BACKUP_DIR=db/pre_deploy_backup_<timestamp>
cp $BACKUP_DIR/*.db db/
git log --oneline -5
git reset --hard <last-good-commit>
pm2 start all
curl -s https://invist.m2y.net/api/health | jq '.status'
```

### 13.5 — Cron

```bash
# Install / update crontab
crontab crontab.txt

# List current crontab
crontab -l

# List with line numbers
crontab -l | cat -n

# Edit interactively
crontab -e

# Remove all
crontab -r

# Tail a cron log
tail -f /tmp/v40_2_morning.log
```

### 13.6 — Caddy

```bash
# Reload after Caddyfile change
sudo systemctl reload caddy

# Validate config
caddy validate --config /root/GLMinvestment/Caddyfile

# Live logs
sudo journalctl -u caddy -f
```

### 13.7 — Ollama (LLM)

```bash
# Check Ollama status
sudo systemctl status ollama

# Restart
sudo systemctl restart ollama

# List models
curl -s http://127.0.0.1:11434/api/tags | jq

# Pull a model
ollama pull qwen2.5:1.5b

# Build custom model
cd /root/GLMinvestment
ollama create glm-fast -f models/Modelfile.qwen

# Smoke test
ollama run glm-fast "What is the EGX30 index?"
```

### 13.8 — Database

```bash
# Open a DB
sqlite3 db/stocks.db

# Inspect schema
sqlite3 db/stocks.db '.schema' | head -50

# Count rows in each table
sqlite3 db/stocks.db "SELECT name FROM sqlite_master WHERE type='table'" | while read t; do
  echo "$t: $(sqlite3 db/stocks.db "SELECT COUNT(*) FROM $t")"
done

# Check WAL file size (لو كبير → trigger checkpoint)
ls -lh db/*.db-wal

# Force WAL checkpoint (all DBs)
for db in db/*.db; do
  echo "checkpointing $db"
  sqlite3 "$db" 'PRAGMA wal_checkpoint(TRUNCATE);'
done
```

---

## 📚 الـ docs ذات الصلة

- `Documentation/00-CONSTITUTION.md` — الـ 76 قاعدة الحاكمة.
- `Documentation/01-ARCHITECTURE.md` — الـ architecture العام.
- `Documentation/04-API-REFERENCE.md` — مرجع الـ API الكامل (912 endpoint).
- `Documentation/02-DATABASES-AND-DATA.md` — كل الـ DBs (17).
- `Documentation/06-TEAM-AND-WORKFLOW.md` — أدوار الفريق + workflow.
- `Caddyfile` — gateway config.
- `ecosystem.config.js` — PM2 config (8 خدمات).
- `crontab.txt` — الـ 26 cron job.
- `next.config.mjs` — Next.js config.
- `scripts/deploy.sh` + `scripts/deploy_production.sh` — deploy scripts.
- `scripts/smoke_test.sh` — 10-endpoint smoke test.
- `vps-service/scripts/smart_db_backup.py` — smart backup مع auto-restore.
- `vps-service/scripts/daily_backup.py` — daily backup مع rotation.
- `src/instrumentation.ts` — metrics collector hook.
- `src/lib/metrics-collector.ts` + `src/lib/metrics-db.ts` — metrics implementation.
- `src/app/api/health/route.ts` — deep health check endpoint.

---

*هذا التوثيق مكتوب من الكود الحي بواسطة جون (المدير التنفيذي) في 2026-10-24. أي تعارض بين هذا التوثيق والتوثيق المؤرشف — هذا هو الصحيح.*

</div>
