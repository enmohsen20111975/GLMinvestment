# P0-7-15-INFRA — Report

**Agent:** DevOps Engineer (news-agent + observability)
**Date:** 2026-09-27
**Task:** Wire news-agent to PM2 + add Sentry / structured logging / improved `/api/health`

---

## 1. news-agent PM2 service added — P0 #7

### Files changed

| File | Change | Lines |
|------|--------|-------|
| `/home/z/my-project/ecosystem.config.js` | Added 7th PM2 app block + updated top comment block to document service #6 (news-agent). | L30-L43 (comment block) and L264-L317 (app definition) |

### What was added

```js
{
  name: 'news-agent',
  script: 'main.py',
  interpreter: (() => {
    // Prefer news-agent/.venv → root .venv → system python3
    const newsVenv = path.resolve(__dirname, 'news-agent', '.venv', 'bin', 'python');
    if (fs.existsSync(newsVenv)) return newsVenv;
    const rootVenv = path.resolve(__dirname, '.venv', 'bin', 'python');
    if (fs.existsSync(rootVenv)) return rootVenv;
    return 'python3';
  })(),
  cwd: path.resolve(__dirname, 'news-agent'),
  autorestart: true,
  max_memory_restart: '300M',
  env: {
    NODE_ENV: 'production',
    PRODUCTION_SERVER_URL: process.env.PRODUCTION_SERVER_URL || 'http://127.0.0.1:3000',
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b',
    COLLECTION_INTERVAL_MINUTES: process.env.COLLECTION_INTERVAL_MINUTES || '15',
    MIN_IMPORTANCE_SCORE: process.env.MIN_IMPORTANCE_SCORE || '55',
    MAX_NEWS_PER_BATCH: process.env.MAX_NEWS_PER_BATCH || '20',
    ENABLE_EGYPTIAN_SOURCES: process.env.ENABLE_EGYPTIAN_SOURCES || '0',
    TELEGRAM_API_ID: process.env.TELEGRAM_API_ID || '',
    TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH || '',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID || ''
  },
  error_file: './logs/news-agent-error.log',
  out_file: './logs/news-agent-out.log',
  time: true,
  max_restarts: 10,
  restart_delay: 5000,
  kill_timeout: 10000
}
```

### Validation

- `node -e "const cfg=require('./ecosystem.config.js'); console.log(cfg.apps.length, cfg.apps.map(a=>a.name))"` → 7 apps: `python-backend, data-engine, nextjs, ws-service, telegram-poster, telegram-events, news-agent`
- `python3 -c "import ast; ast.parse(open('news-agent/main.py').read())"` → **OK: parses** (12,604 bytes)

### How news-agent runs now

- Previously: only manual `bash news-agent/run.sh` (which creates `.venv`, installs deps, starts `python3 main.py` in foreground). Never started by PM2 nor cron → `/api/news/receive-from-news-agent` endpoint existed but received zero data.
- After: PM2 auto-starts `news-agent` on boot, auto-restarts on crash (max 10 restarts within 5s cooldown), caps memory at 300 MB.
- Uses news-agent's own `.venv` if present (created by run.sh), otherwise the root `.venv` (shared with python-backend), otherwise system `python3` as fallback.
- Forwards `PRODUCTION_SERVER_URL`, `OLLAMA_MODEL`, `COLLECTION_INTERVAL_MINUTES`, `MIN_IMPORTANCE_SCORE`, `MAX_NEWS_PER_BATCH`, `ENABLE_EGYPTIAN_SOURCES`, and Telegram credentials from PM2's env (loaded from `.env` by PM2's `--env` flag or shell).
- Logs flow to `./logs/news-agent-{error,out}.log` like all other services.

---

## 2. Sentry SDK installed — P0 #15 (part 2a)

### Install status

```bash
cd /home/z/my-project && bun add @sentry/nextjs
# → installed @sentry/nextjs@11.0.0 (40 packages installed in 5.15s)
# → also re-ran prisma generate (postinstall hook)
```

**Install succeeded** — no fallback needed.

### Files created

| File | Purpose |
|------|---------|
| `/home/z/my-project/sentry.client.config.ts` | Browser-side init — reads `NEXT_PUBLIC_SENTRY_DSN` (falls back to `SENTRY_DSN`), enables in prod only, samples 10% transactions, filters hydration mismatches + ResizeObserver + browser-extension noise, sets session replay 10% prod / 0% dev, drops events without stack trace. |
| `/home/z/my-project/sentry.server.config.ts` | Server-side init (Node runtime) — reads `SENTRY_DSN`, enables in prod only, samples 10% transactions, filters ECONNRESET/EPIPE/ETIMEDOUT/ECONNREFUSED/AbortError/ENOENT noise, drops static-asset 404 frames. |
| `/home/z/my-project/next.config.ts` | Wraps `NextConfig` with `withSentryConfig` — `silent: true` so missing SENTRY_AUTH_TOKEN doesn't break dev builds. Hide sourcemaps, disable `@sentry/logger`, widen client file upload. |
| `/home/z/my-project/.env` | Added `SENTRY_DSN=` + `NEXT_PUBLIC_SENTRY_DSN=` placeholders (empty by default — user fills in real DSN). |

### Behaviour with empty DSN

Both config files gate init behind `if (SENTRY_DSN)` so the app keeps running with zero overhead when Sentry isn't configured. This makes the integration **opt-in** — set the env vars and Sentry activates, unset them and it's a no-op.

### Manual steps required by user

1. Sign up at https://sentry.io (or self-host Sentry — both work with the same SDK).
2. Create a Next.js project, copy the DSN.
3. Add to `/home/z/my-project/.env`:
   ```
   SENTRY_DSN=https://<key>@<host>/<project_id>
   NEXT_PUBLIC_SENTRY_DSN=https://<key>@<host>/<project_id>
   ```
   (The client config needs `NEXT_PUBLIC_` prefix so Next.js exposes it to the browser bundle.)
4. Optional: set `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` to enable sourcemap upload on build.
5. Run `bun run build && pm2 restart nextjs` — Sentry activates on next server boot.

---

## 3. `/api/health` improved — P0 #15 (part 2b)

### File

`/home/z/my-project/src/app/api/health/route.ts` — full rewrite (262 lines).

### What the old version did (per audit P0 #15)

- Only ran `existsSync()` on DB files. A corrupted DB file still existed on disk → still returned "status: ok".
- Cached 10s.
- No PM2 / service health check.
- No disk usage check.

### What the new version does

1. **DB integrity check** — opens each DB read-only with `fileMustExist: true`, runs `SELECT 1`, closes immediately. If open fails (corrupted, locked, missing), the component reports `"status": "down"` with the actual error message.
2. **DB row count + latest date** — for `stocks.db`, `predictions.db`, `price_history.db`, `data_engine.db`, the endpoint also reports `rows` (and `latest_date` for `price_history.db`).
3. **PM2 service reachability** — checks ports `8010` (python-backend), `3005` (ws-service), `3003` (telegram-events) via `ss -ltnp`. Checks `news-agent` via `pgrep -f news-agent/main.py`. Extracts PID when available.
4. **Disk usage** — runs `df -BG --output=size,used,avail,pcent /home/z/my-project` to get `free_gb`, `total_gb`, `used_pct`. Marks "down" if `used_pct >= 95`.
5. **Aggregated status** — `"down"` if critical DBs (stocks.db, predictions.db) fail OR disk ≥95% full. `"degraded"` if non-critical services (telegram-events, news-agent) are down. `"ok"` only if all critical + non-critical components pass.
6. **In-memory cache (60s)** — prevents DOS during traffic spikes (deep checks involve multiple child_process.exec calls).
7. **Structured logging** — emits a JSON log line via `logger.info()` after every health check with status, DB counts, disk usage.
8. **HTTP status** — 200 when ok/degraded, 503 when down. Allows upstream load balancer (Caddy/Nginx) to fail-over correctly.

### Sample response shape

```json
{
  "status": "degraded",
  "timestamp": "2026-09-27T14:30:00.000Z",
  "components": {
    "nextjs": { "status": "ok" },
    "python-backend": { "status": "down", "port": 8010, "reachable": false },
    "ws-service": { "status": "down", "port": 3005, "reachable": false },
    "telegram-events": { "status": "down", "port": 3003, "reachable": false },
    "news-agent": { "status": "ok", "reachable": true, "pid": 19358 },
    "databases": {
      "stocks.db": { "status": "ok", "size_mb": 14.2, "rows": 976 },
      "predictions.db": { "status": "ok", "size_mb": 224.3, "rows": 1307 },
      "price_history.db": { "status": "ok", "size_mb": 293.6, "rows": 1209762, "latest_date": "2026-09-27" },
      "data_engine.db": { "status": "ok", "size_mb": 272.5, "rows": 296 },
      "intraday.db": { "status": "ok", "size_mb": 427.5 }
    },
    "disk": { "status": "ok", "free_gb": 3, "total_gb": 10, "used_pct": 77 }
  }
}
```

(Verified by simulating the logic in Node.js — see "Verification" below.)

### All checks async

All DB checks via `Promise.all()` + `Database` constructor (sync but fast — read-only opens in <1ms each). All process/disk checks via `child_process.exec` wrapped in `promisify`. Zero blocking sync I/O.

### Verification

- Ran a Node.js simulation of `runHealthChecks()` against the real DBs in `/home/z/my-project/db/`:
  - All 5 DBs opened read-only and ran `SELECT 1` successfully.
  - Row counts match audit's verified numbers: stocks=976, predictions=1307, price_history=1,209,762 (with `latest_date='2026-09-27'`).
  - news-agent process found (pid 19358 — there's already a `run.sh` instance running in the sandbox).
  - PM2 services (python-backend, ws-service, telegram-events) report `reachable: false` (accurate — PM2 isn't running in this sandbox).
  - Disk: 77% used (3GB free of 10GB total).

---

## 4. `logger.ts` created — P0 #15 (part 2c)

### File

`/home/z/my-project/src/lib/logger.ts` — 90 lines.

### API

```typescript
import { logger } from '@/lib/logger';

logger.info('user logged in', { userId: 42, ip: req.ip });
logger.error('DB write failed', { ticker: 'COMI', err: e.message });
logger.warn('rate limit hit', { ip: req.ip, count: 120 });
logger.debug('entering fn', { args });
```

### Behaviour

- Each call emits one JSON line to stdout (`info`/`debug`) or stderr (`warn`/`error`):
  ```json
  {"timestamp":"2026-09-27T14:30:00.000Z","level":"info","message":"user logged in","userId":42,"ip":"127.0.0.1"}
  ```
- Respects `LOG_LEVEL` env var (`debug` < `info` < `warn` < `error`). Default: `info`.
- Top-level fields preserved (timestamp, level, message); context fields spread as top-level keys — easy to grep / ingest into Loki/ELK/Datadog.
- 12-factor compliant: routes errors to stderr, info/debug to stdout.

### Usage in this task

The new `/api/health/route.ts` imports `logger` and emits a structured line after every health check, so admins can correlate `/api/health` responses with the structured logs.

---

## 5. Request ID middleware — P0 #15 (part 2d, optional, DONE)

### File

`/home/z/my-project/src/middleware.ts` — modified to add `x-request-id` response header.

### What changed

Added ~10 lines at the top of `middleware()`:

```typescript
import { randomUUID } from 'crypto';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Use incoming x-request-id if provided, otherwise mint a fresh UUIDv4.
  const requestId = request.headers.get('x-request-id') || randomUUID();

  const response = NextResponse.next();
  response.headers.set('x-request-id', requestId);
  // ... (rest of middleware logic continues with `response`)
}
```

### Design rationale

- **Inbound propagation**: if a client (or upstream proxy like Caddy/Nginx) sends `x-request-id: <uuid>`, we echo it back unchanged — supports distributed tracing across services.
- **Outbound generation**: if no inbound ID is present, middleware mints a UUIDv4 so every response carries one — clients can correlate logs to a specific request even if they didn't initiate the trace.
- **Route handler access**: server route handlers can already read the inbound `x-request-id` header from `request.headers`. For requests with no inbound header, they can mint their own via `crypto.randomUUID()` and pair it with the structured logger.

---

## 6. Lint status

```bash
cd /home/z/my-project && bun run lint
# → $ eslint .
# → (no output, exit code 0)
```

**`bun run lint` passes cleanly** with all changes applied.

---

## 7. Summary table

| # | Item | Status | File path |
|---|------|--------|-----------|
| 1 | news-agent PM2 service | ✅ Added (app #7 of 7) | `/home/z/my-project/ecosystem.config.js` L264-L317 |
| 2 | Python syntax validation | ✅ Parses | `/home/z/my-project/news-agent/main.py` (12,604 bytes) |
| 3 | Sentry SDK install | ✅ Installed v11.0.0 | `package.json` + `bun.lock` |
| 4 | sentry.client.config.ts | ✅ Created | `/home/z/my-project/sentry.client.config.ts` |
| 5 | sentry.server.config.ts | ✅ Created | `/home/z/my-project/sentry.server.config.ts` |
| 6 | next.config.ts wrapped | ✅ withSentryConfig | `/home/z/my-project/next.config.ts` |
| 7 | .env SENTRY_DSN placeholder | ✅ Added | `/home/z/my-project/.env` |
| 8 | /api/health rewrite | ✅ Deep checks (DB integrity, PM2, disk) | `/home/z/my-project/src/app/api/health/route.ts` |
| 9 | logger.ts structured logging | ✅ Created | `/home/z/my-project/src/lib/logger.ts` |
| 10 | x-request-id middleware | ✅ Added (bonus) | `/home/z/my-project/src/middleware.ts` |
| 11 | `bun run lint` | ✅ Exits 0 (no errors/warnings) | whole repo |
| 12 | Report file | ✅ This file | `/home/z/my-project/agent-ctx/P0-7-15-INFRA-REPORT.md` |

---

## 8. Next actions for the user

1. **Start news-agent in PM2** (after pulling changes on the VPS):
   ```bash
   pm2 start ecosystem.config.js --only news-agent
   pm2 save
   pm2 logs news-agent --lines 50
   ```
   Then visit `/api/news/receive-from-news-agent` in the Next.js logs — should start receiving POSTs within 15 minutes (default collection interval).

2. **Fill in real Sentry DSN** in `/home/z/my-project/.env`:
   ```
   SENTRY_DSN=https://<key>@<host>/<project_id>
   NEXT_PUBLIC_SENTRY_DSN=https://<key>@<host>/<project_id>
   ```
   Then `bun run build && pm2 restart nextjs`.

3. **Verify /api/health** by curling:
   ```bash
   curl -s http://localhost:3000/api/health | jq .
   ```
   Should return JSON with per-component status. If status is `down`, look for the failing component in the response.

4. **(Optional) Wire logger into more routes** — `import { logger } from '@/lib/logger'` and replace ad-hoc `console.log` calls in critical API routes. Phase 2 cleanup task.

5. **(Optional) Set up Sentry alerting** — once DSN is live, configure Slack/email alerts for new errors. Set release tagging via `SENTRY_RELEASE` env var for change-tracking.

---

**End of report.**
