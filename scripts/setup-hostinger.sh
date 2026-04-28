#!/bin/bash
# =============================================================================
# setup-hostinger.sh — First-time setup for Hostinger deployment
# =============================================================================
# Run this ONCE on Hostinger after git clone:
#   bash scripts/setup-hostinger.sh
# =============================================================================

set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_DIR="${APP_DIR}/db"
VPS_HOST="72.61.137.86"
VPS_PORT="8010"

echo "============================================"
echo "EGX Platform — Hostinger Setup"
echo "============================================"

# 1. Create db directory
mkdir -p "${DB_DIR}/backups"
echo "[OK] Created ${DB_DIR}"

# 2. Install dependencies
echo ""
echo "[1/4] Installing npm dependencies..."
npm install --production 2>&1 | tail -3

# 3. Generate Prisma client
echo ""
echo "[2/4] Generating Prisma client..."
npx prisma generate 2>&1 | tail -3

# 4. Download databases from VPS
echo ""
echo "[3/4] Downloading databases from VPS (${VPS_HOST})..."

# Try HTTP download from VPS Python bridge
LIGHT_URL="http://${VPS_HOST}:${VPS_PORT}/api/download-db?file=custom"
HEAVY_URL="http://${VPS_HOST}:${VPS_PORT}/api/download-db?file=egx_investment"

# Light DB
echo "  Downloading custom.db (~200KB)..."
if curl -s -m 60 -o "${DB_DIR}/custom.db" "$LIGHT_URL" 2>/dev/null && [ -s "${DB_DIR}/custom.db" ]; then
  echo "  [OK] custom.db downloaded"
else
  echo "  [WARN] HTTP download failed, trying to use git version..."
  if [ ! -f "${DB_DIR}/custom.db" ] || [ ! -s "${DB_DIR}/custom.db" ]; then
    echo "  [ERROR] No custom.db available. Please copy manually from VPS."
  fi
fi

# Heavy DB
echo "  Downloading egx_investment.db (~55MB)..."
if curl -s -m 300 -o "${DB_DIR}/egx_investment.db" "$HEAVY_URL" 2>/dev/null && [ -s "${DB_DIR}/egx_investment.db" ]; then
  echo "  [OK] egx_investment.db downloaded ($(du -h "${DB_DIR}/egx_investment.db" | cut -f1))"
else
  echo "  [WARN] HTTP download failed."
  echo "  Trying SCP fallback..."
  if scp -q -o ConnectTimeout=30 "root@${VPS_HOST}:/root/egxpy-bridge/data/egx_investment.db" "${DB_DIR}/egx_investment.db" 2>/dev/null && [ -s "${DB_DIR}/egx_investment.db" ]; then
    echo "  [OK] egx_investment.db downloaded via SCP"
  else
    echo "  [ERROR] Could not download egx_investment.db"
    echo "  Please copy manually: scp root@${VPS_HOST}:/root/egxpy-bridge/data/egx_investment.db ${DB_DIR}/"
  fi
fi

# 5. Build
echo ""
echo "[4/4] Building application..."
npm run build 2>&1 | tail -5

echo ""
echo "============================================"
echo "Setup complete!"
echo ""
echo "DB files:"
if [ -f "${DB_DIR}/custom.db" ]; then
  echo "  custom.db: $(du -h "${DB_DIR}/custom.db" | cut -f1)"
else
  echo "  custom.db: MISSING"
fi
if [ -f "${DB_DIR}/egx_investment.db" ]; then
  echo "  egx_investment.db: $(du -h "${DB_DIR}/egx_investment.db" | cut -f1)"
else
  echo "  egx_investment.db: MISSING — recommendations will not work"
fi
echo ""
echo "To start: pm2 start npm --name egx-platform -- start"
echo "To sync DBs later: bash scripts/sync-from-vps.sh"
echo "============================================"
