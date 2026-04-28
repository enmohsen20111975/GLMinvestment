# EGX Investment Platform - Deployment Guide

## ✅ No Native Compilation Required!

This platform uses **pure JavaScript** for everything — no C++ addons, no native modules.
Works on **Hostinger shared hosting**, any VPS, and local development.

### What makes it Hostinger-compatible:
- **sql.js** (WASM) instead of better-sqlite3 — pure JavaScript SQLite
- **bcryptjs** (pure JS) instead of bcrypt — no native crypto
- **No sharp** — no native image processing
- **No Prisma CLI** needed at runtime — database auto-creates tables

---

## Quick Deploy (Source Code)

The deployment zip (`egx-platform-deployment.zip`) contains all source files.

### Requirements
- Node.js 18+ (Node 22 works on Hostinger)
- 512MB+ RAM minimum

### Steps

```bash
# 1. Extract
unzip egx-platform-deployment.zip -d egx-platform

# 2. Go to directory
cd egx-platform

# 3. Install dependencies (pure JS only — no compilation!)
npm install --legacy-peer-deps
# or: bun install

# 4. Create .env file
cat > .env << 'EOF'
DATABASE_URL="file:./db/egx_investment.db"
NEXTAUTH_SECRET="generate-a-random-secret-here"
NEXTAUTH_URL="https://your-domain.com"
EOF

# 5. Create database directory
mkdir -p db

# 6. Build for production
npm run build

# 7. Start the server
npm run start
# or: npx next start
```

The server runs on port 3000 by default.

### Hostinger-Specific Notes
- Use Node.js 22 from Hostinger's Node.js selector
- Set startup command: `npx next start -p 3000`
- Database auto-creates in `./db/egx_investment.db` on first run
- No Python, no node-gyp, no make needed!

---

## With PM2 (Recommended for VPS)

```bash
npm install -g pm2

# Start
pm2 start npm --name egx-platform -- start

# Save for auto-restart
pm2 save
pm2 startup
```

---

## Reverse Proxy Setup

### With Caddy

```
your-domain.com {
    reverse_proxy localhost:3000
}
```

### With Nginx

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | No | `file:./db/egx_investment.db` | SQLite database path |
| `NEXTAUTH_SECRET` | Yes | - | Secret for NextAuth sessions (generate random) |
| `NEXTAUTH_URL` | Yes | `http://localhost:3000` | Your domain URL |
| `PORT` | No | `3000` | Server port |

---

## API Endpoints for Mobile App

All features are accessible via REST API with Bearer token authentication:

```
Authorization: Bearer <userId>
```

### Core APIs
- `GET /api/stocks` - List all stocks
- `GET /api/stocks/[ticker]` - Stock details
- `GET /api/stocks/[ticker]/history` - Price history
- `GET /api/stocks/[ticker]/recommendation` - AI recommendation
- `GET /api/market/overview` - Market overview
- `GET /api/market/live-data` - Real-time market data

### User APIs
- `POST /api/auth/register` - Register
- `GET /api/subscription/current` - Current subscription
- `GET /api/subscription/plans` - Available plans
- `POST /api/subscription/start-trial` - Start free trial
- `POST /api/payment/initiate` - Initiate payment

### Watchlist APIs
- `GET /api/watchlist` - List watchlist
- `POST /api/watchlist` - Add to watchlist
- `DELETE /api/watchlist/[id]` - Remove from watchlist
- `POST /api/watchlist/alerts` - Create alert
- `GET /api/watchlist/alerts/check` - Check alerts

### V2 AI Engine APIs
- `POST /api/v2/recommend` - Get AI recommendations
- `GET /api/v2/stock/[symbol]/analysis` - Full analysis
- `GET /api/v2/feedback/status` - Feedback loop status

---

## Troubleshooting

### Hostinger: npm install fails
Make sure you're using the **latest zip** (April 2026 or later). Old versions had `better-sqlite3` which needs native compilation.

### Database errors
Delete `db/egx_investment.db` and restart — tables auto-create.

### Port already in use
Change PORT in .env or use: `npx next start -p 3001`
