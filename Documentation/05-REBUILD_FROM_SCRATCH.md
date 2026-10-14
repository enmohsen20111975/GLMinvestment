# 05-REBUILD_FROM_SCRATCH.md

> **الملف المرجعي الخامس** — دليل إعادة بناء المشروع من الصفر خطوة بخطوة.
> إذا فقدت كل شيء إلا هذه الـ 5 ملفات، يمكنك إعادة بناء المشروع بالكامل.

---

## المرحلة 0: الإعداد الأولي

### 0.1 المتطلبات
```bash
# Runtime
node --version    # v20+ (مطلوب لـ better-sqlite3@13)
python3 --version # 3.11+
bun --version     # latest

# System packages (Ubuntu/Debian)
sudo apt install -y build-essential python3-dev sqlite3 curl git

# PM2 + pm2-logrotate
sudo npm install -g pm2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

# Caddy (reverse proxy + auto-TLS)
sudo apt install -y caddy
```

### 0.2 Clone + Install
```bash
git clone https://github.com/enmohsen20111975/GLMinvestment.git
cd GLMinvestment
bun install
```

### 0.3 Environment Setup
```bash
# Copy template
cp .env.example .env.production

# Generate secrets
echo "NEXTAUTH_SECRET=$(openssl rand -base64 32)"
echo "ADMIN_SESSION_TOKEN=$(openssl rand -hex 32)"
echo "BOT_API_SECRET=$(openssl rand -hex 32)"

# Fill .env.production with real values:
# - NEXTAUTH_SECRET (generated above)
# - NEXTAUTH_URL=https://invist.m2y.net
# - GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (from Google Cloud Console)
# - SENTRY_DSN (from Sentry dashboard)
# - ADMIN_USERNAME + ADMIN_PASSWORD
# - DEEPSEEK_KEY (from DeepSeek dashboard)
# - BOT_API_SECRET (generated above)
# - TELEGRAM_BOT_TOKEN + TELEGRAM_API_ID/HASH/CHANNEL_ID
# - EODHD_API_KEY

# Copy for dev too
cp .env.production .env
```

---

## المرحلة 1: Database Setup

### 1.1 Create 3 SQLite Databases
```bash
cd db/

# Create empty DBs
sqlite3 auth.db "SELECT 1;"
sqlite3 predictions.db "SELECT 1;"
sqlite3 stocks.db "SELECT 1;"
sqlite3 data_engine.db "SELECT 1;"
sqlite3 intraday.db "SELECT 1;"
sqlite3 metrics.db "SELECT 1;"
cd ..
```

### 1.2 Push Prisma Schemas (3 schemas)
```bash
# Main schema (default — legacy User/Post)
bunx prisma db push

# Auth schema (18 models — User, Account, Session, ApiToken, ...)
bunx prisma db push --schema=prisma/auth-schema.prisma

# Predictions schema (10 models — Prediction, PersonaPrediction, ...)
bunx prisma db push --schema=prisma/predictions-schema.prisma

# Generate Prisma clients
bunx prisma generate
bunx prisma generate --schema=prisma/auth-schema.prisma
bunx prisma generate --schema=prisma/predictions-schema.prisma
```

### 1.3 Create SQLite Tables (non-Prisma)
```bash
# Create stocks.db tables (user_stock_watchlists + portfolio_assets + price_alerts + ...)
sqlite3 db/stocks.db << 'SQL'
CREATE TABLE IF NOT EXISTS user_stock_watchlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  stock_id INTEGER,
  ticker TEXT,
  alert_price_above REAL,
  alert_price_below REAL,
  alert_change_percent REAL,
  notes TEXT,
  purchase_price REAL,
  quantity REAL,
  added_at TEXT DEFAULT (datetime('now')),
  last_viewed TEXT,
  view_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS portfolio_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  shares REAL NOT NULL,
  purchase_price REAL NOT NULL,
  purchase_date TEXT,
  portfolio_id TEXT DEFAULT 'default',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  alert_type TEXT DEFAULT 'price_below',
  reference_price REAL NOT NULL,
  threshold_price REAL NOT NULL,
  drop_pct REAL DEFAULT -3.0,
  is_active INTEGER DEFAULT 1,
  is_triggered INTEGER DEFAULT 0,
  triggered_at TEXT,
  user_id TEXT,
  label TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user ON user_stock_watchlists(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolio_assets(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON price_alerts(is_active, is_triggered);
SQL

# Create data_engine.db tables
sqlite3 db/data_engine.db << 'SQL'
CREATE TABLE IF NOT EXISTS stocks (
  id INTEGER PRIMARY KEY,
  ticker TEXT UNIQUE NOT NULL,
  name TEXT,
  name_ar TEXT,
  sector TEXT,
  market TEXT DEFAULT 'EGX',
  current_price REAL,
  previous_close REAL,
  change REAL,
  change_percent REAL,
  volume REAL,
  market_cap REAL,
  is_active INTEGER DEFAULT 1,
  last_updated TEXT
);

CREATE TABLE IF NOT EXISTS egksco_price_history (
  id INTEGER PRIMARY KEY,
  ticker TEXT NOT NULL,
  price_date TEXT NOT NULL,
  open_price REAL,
  high_price REAL,
  low_price REAL,
  close_price REAL,
  volume REAL,
  UNIQUE(ticker, price_date)
);

CREATE TABLE IF NOT EXISTS market_news (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  source TEXT,
  url TEXT,
  published_at TEXT,
  tickers TEXT,
  sentiment TEXT,
  importance REAL DEFAULT 0.5,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_news_published ON market_news(published_at);
CREATE INDEX IF NOT EXISTS idx_news_tickers ON market_news(tickers);
SQL
```

### 1.4 Seed Subscription Plans
```bash
# Update prisma/seed-subscriptions.ts first (current is outdated — 3 plans vs 6)
# Then run:
bunx tsx prisma/seed-subscriptions.ts
```

### 1.5 Apply Guard Triggers (predictions.db)
```bash
cd vps-service
python3 scripts/apply_guard_triggers.py
cd ..
```

---

## المرحلة 2: Python Backend Setup

### 2.1 Create Virtual Environment
```bash
cd vps-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

### 2.2 Verify Python Compiles
```bash
# All Python files should compile
find vps-service/ -name "*.py" -not -path "*/venv/*" | while read f; do
  python3 -m py_compile "$f" || { echo "FAILED: $f"; exit 1; }
done
echo "✅ All Python files compile"
```

### 2.3 Run Tests
```bash
cd vps-service
python3 -m pytest tests/ -v
cd ..
```

---

## المرحلة 3: Build & Start

### 3.1 Build Next.js
```bash
# Generate Prisma clients (3 schemas)
bun run db:generate

# Build (skip lint — CI handles it)
NODE_OPTIONS='--max-old-space-size=4096' NEXT_TELEMETRY_DISABLED=1 bun run build
```

### 3.2 Verify Lint + TypeScript
```bash
# Lint (must pass with 0 errors)
bun run lint

# TypeScript (src/ only — scripts/ has pre-existing errors)
bunx tsc --noEmit --skipLibCheck 2>&1 | grep "^src/" || echo "✅ No src/ errors"
```

### 3.3 Start with PM2
```bash
# Start all 8 services
pm2 start ecosystem.config.js

# Verify all online
pm2 status

# Check logs
pm2 logs nextjs --lines 20
pm2 logs python-backend --lines 20

# Save PM2 process list (auto-restart on reboot)
pm2 save
pm2 startup
```

---

## المرحلة 4: Gateway (Caddy) Setup

### 4.1 Production Caddyfile
```bash
# Copy production config
sudo cp Caddyfile.production /etc/caddy/Caddyfile

# Verify syntax
caddy validate --config /etc/caddy/Caddyfile

# Reload
sudo systemctl reload caddy
```

### 4.2 DNS Setup
- A record: `invist.m2y.net` → VPS IP
- A record: `www.invist.m2y.net` → VPS IP
- Caddy auto-obtains Let's Encrypt TLS certificate

### 4.3 Firewall
```bash
sudo ufw allow 80/tcp    # HTTP (redirect)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 22/tcp    # SSH
sudo ufw enable
```

### 4.4 Verify
```bash
curl -I https://invist.m2y.net/api/health
# Should return 200 with health status
```

---

## المرحلة 5: Post-Deploy Verification

### 5.1 Health Checks
```bash
# Next.js health
curl -s https://invist.m2y.net/api/health | jq .

# Keepalive
curl -s https://invist.m2y.net/api/keepalive | jq .

# Prometheus metrics
curl -s https://invist.m2y.net/api/metrics | head -20
```

### 5.2 Auth Verification
```bash
# Try login (should fail without proper credentials)
curl -X POST https://invist.m2y.net/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username_or_email":"test","password":"wrong"}'
# Should return 401

# Try protected route without auth
curl -s https://invist.m2y.net/api/portfolio/holdings
# Should return 401
```

### 5.3 Python Backend Verification
```bash
# Check Python health
curl -s http://localhost:8010/health | jq .

# Check data engine
curl -s http://localhost:5000/status | jq .
```

### 5.4 PM2 Health
```bash
pm2 status
# All 8 services should be "online"

pm2 monit
# Check memory + CPU usage
```

---

## المرحلة 6: Data Population

### 6.1 Stock Data (via Data Engine)
```bash
# Trigger initial stock data fetch
curl -X POST http://localhost:5000/trigger/stocks \
  -H "Content-Type: application/json"

# Wait for completion, then check
sqlite3 db/data_engine.db "SELECT COUNT(*) FROM stocks;"
sqlite3 db/data_engine.db "SELECT COUNT(*) FROM egksco_price_history;"
```

### 6.2 News Data (via News Agent)
```bash
# News agent runs automatically (COLLECTION_INTERVAL_MINUTES=30)
# Check news:
sqlite3 db/data_engine.db "SELECT COUNT(*) FROM market_news;"
```

### 6.3 Predictions (via Python Backend)
```bash
# Generate initial predictions
curl -X POST http://localhost:8010/api/predictions/generate-all \
  -H "Authorization: Bearer <admin-token>"

# Check predictions
sqlite3 db/predictions.db "SELECT COUNT(*) FROM Prediction;"
```

---

## المرحلة 7: Monitoring & Alerting

### 7.1 Sentry
```bash
# Verify Sentry is receiving events
# Go to https://sentry.io → your project → Events
# Trigger a test error:
curl -s https://invist.m2y.net/api/health?test=error
```

### 7.2 Prometheus (optional)
```bash
# Scrape metrics every 15s
# Add to prometheus.yml:
# scrape_configs:
#   - job_name: 'glminvestment'
#     scrape_interval: 15s
#     static_configs:
#       - targets: ['localhost:3000']
#     metrics_path: /api/metrics
```

### 7.3 Log Rotation
```bash
# Already configured via pm2-logrotate
pm2 list
# Check log files:
ls -la ~/.pm2/logs/
```

---

## المرحلة 8: Backup Strategy

### 8.1 Database Backups
```bash
# Daily backup script (add to crontab)
#!/bin/bash
BACKUP_DIR="/backups/$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"

for db in auth predictions stocks data_engine intraday metrics; do
  sqlite3 "/home/z/my-project/db/${db}.db" ".backup '${BACKUP_DIR}/${db}.db'"
done

# Compress
tar -czf "${BACKUP_DIR}.tar.gz" "$BACKUP_DIR"
rm -rf "$BACKUP_DIR"

# Keep last 7 days
find /backups/ -name "*.tar.gz" -mtime +7 -delete
```

### 8.2 Code Backup
```bash
# Git is the source of truth — push regularly
git push origin main
```

---

## المرحلة 9: Troubleshooting

### 9.1 Common Issues

#### Next.js won't start
```bash
# Check if port 3000 is in use
lsof -i :3000

# Kill stale processes
pm2 kill
pm2 start ecosystem.config.js
```

#### Python backend unreachable
```bash
# Check if port 8010 is listening
lsof -i :8010

# Check Python logs
pm2 logs python-backend --lines 50

# Verify venv
cd vps-service && source venv/bin/activate && python3 main.py
```

#### Database locked
```bash
# Check for WAL files
ls -la db/*.db-wal

# Checkpoint WAL
sqlite3 db/auth.db "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 db/predictions.db "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 db/stocks.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

#### Memory issues
```bash
# Check PM2 memory usage
pm2 monit

# If nextjs is using too much memory:
pm2 restart nextjs

# Adjust max_memory_restart in ecosystem.config.js
```

### 9.2 Recovery from Backup
```bash
# Stop services
pm2 stop all

# Restore databases
BACKUP="/backups/2026-10-14"
for db in auth predictions stocks data_engine intraday metrics; do
  cp "${BACKUP}/${db}.db" "db/${db}.db"
done

# Restart
pm2 start all
```

---

## المرحلة 10: Maintenance

### 10.1 Regular Updates
```bash
# Weekly: pull latest
git pull --rebase origin main
bun install
cd vps-service && source venv/bin/activate && pip install -r requirements.txt && cd ..
bun run build
pm2 reload all
```

### 10.2 Log Cleanup
```bash
# pm2-logrotate handles this automatically
# Manual cleanup if needed:
pm2 flush  # Clear all logs
```

### 10.3 Database Maintenance
```bash
# Monthly: VACUUM + integrity check
sqlite3 db/auth.db "VACUUM; PRAGMA integrity_check;"
sqlite3 db/predictions.db "VACUUM; PRAGMA integrity_check;"
sqlite3 db/stocks.db "VACUUM; PRAGMA integrity_check;"
```

---

## Quick Reference Card

### Essential Commands
```bash
# Start
pm2 start ecosystem.config.js

# Stop
pm2 stop all

# Restart single service
pm2 restart nextjs

# Logs
pm2 logs nextjs --lines 50
pm2 logs python-backend --lines 50

# Status
pm2 status
pm2 monit

# Health
curl -s localhost:3000/api/health | jq .
curl -s localhost:8010/health | jq .

# Database
sqlite3 db/auth.db ".tables"
sqlite3 db/predictions.db ".tables"
sqlite3 db/stocks.db ".tables"

# Build
bun run build

# Lint
bun run lint

# Test
bun run test
cd vps-service && python3 -m pytest tests/ -v && cd ..

# Deploy
git pull --rebase origin main
bun install
bun run build
pm2 reload all
```

### Critical Files (if you can only keep 5)
1. `Documentation/01-CONSTITUTION_AND_ARCHITECTURE.md` — القواعد + البنية
2. `Documentation/02-SCREENS_AND_API_CONTRACTS.md` — الشاشات + API
3. `Documentation/03-ENGINEERING_AND_DEPLOYMENT.md` — الأدوات + النشر
4. `Documentation/04-SECURITY_AND_GOVERNANCE.md` — الأمن + الحوكمة
5. `Documentation/05-REBUILD_FROM_SCRATCH.md` — هذا الملف (دليل الإعادة)

### Critical Code Files (if you can only keep 10)
1. `src/lib/valid-views.ts` — SSOT لكل الشاشات
2. `src/app/page.tsx` — SPA shell + view router
3. `src/lib/cache-manager.ts` — central cache SSOT
4. `src/lib/canonical-signal.ts` — TS port of Python signal
5. `src/lib/token-hash.ts` — SHA-256 token hashing
6. `src/lib/api-response.ts` — unified error envelope
7. `prisma/auth-schema.prisma` — 18 models
8. `prisma/predictions-schema.prisma` — 10 models
9. `ecosystem.config.js` — PM2 config (8 services)
10. `package.json` — 27 scripts + 74 deps

---

*آخر تحديث: 2026-10-14 by سوسو (CEO Agent)*

**مع هذه الـ 5 ملفات، يمكنك إعادة بناء المشروع بالكامل من الصفر.**
