#!/bin/bash
# Hostinger deployment script (local build + upload)
set -e

echo "=== EGX Platform - Hostinger Deployment ==="

# Build with webpack (required for sql.js WASM compatibility)
echo "[1/6] Building Next.js (webpack mode)..."
NODE_ENV=production npx next build --webpack

# Verify build
echo "[2/6] Verifying build..."
if [ ! -d ".next/standalone" ]; then
  echo "ERROR: Build output not found!"
  exit 1
fi

# Prepare standalone package
echo "[3/6] Preparing standalone package..."
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static 2>/dev/null || true
# Copy db directory — preserve existing databases on server (never overwrite live data)
if [ -d ".next/standalone/db" ]; then
  echo "  db/: existing directory preserved (live data safe)"
else
  cp -r db .next/standalone/db 2>/dev/null || mkdir -p .next/standalone/db
  echo "  db/: copied (first deploy)"
fi

# Copy sql.js dist (entire directory — CRITICAL: sql-wasm.js + sql-wasm.wasm both needed)
echo "[4/6] Copying sql.js WASM runtime..."
SQLJS_DIST="node_modules/sql.js/dist"
if [ ! -d "$SQLJS_DIST" ]; then
  echo "FATAL: sql.js/dist not found! Database will NOT work on Hostinger."
  echo "  Run: npm install sql.js"
  exit 1
fi

mkdir -p .next/standalone/node_modules/sql.js/dist
cp -r "$SQLJS_DIST"/* .next/standalone/node_modules/sql.js/dist/
echo "  sql.js dist copied ($(ls "$SQLJS_DIST" | wc -l) files)"

# Verify sql-wasm.wasm exists in standalone (required for DB operations)
if [ ! -f ".next/standalone/node_modules/sql.js/dist/sql-wasm.wasm" ]; then
  echo "FATAL: sql-wasm.wasm missing from standalone build!"
  exit 1
fi
echo "  sql-wasm.wasm verified ($(du -h .next/standalone/node_modules/sql.js/dist/sql-wasm.wasm | cut -f1))"

# Copy the sql.js package.json for require('sql.js') resolution
if [ -f "node_modules/sql.js/package.json" ]; then
  mkdir -p .next/standalone/node_modules/sql.js
  cp node_modules/sql.js/package.json .next/standalone/node_modules/sql.js/
  echo "  sql.js package.json copied"
fi

# Verify database files in standalone
echo "[5/6] Verifying database files..."
STANDALONE_DB=".next/standalone/db"

if [ -f "$STANDALONE_DB/custom.db" ]; then
  echo "  custom.db: $(du -h "$STANDALONE_DB/custom.db" | cut -f1) ✅"
else
  echo "  WARNING: custom.db not found in standalone/db/"
fi

if [ -f "$STANDALONE_DB/egx_investment.db" ]; then
  echo "  egx_investment.db: $(du -h "$STANDALONE_DB/egx_investment.db" | cut -f1) ✅"
else
  echo "  WARNING: egx_investment.db not found in standalone/db/"
  echo "  Analysis features (recommendations, price history, portfolio) will be disabled."
fi

echo "[6/6] Build complete. Deploy steps:"
echo "  1. Upload .next/standalone/ contents to Hostinger ~/egx-platform/"
echo "  2. Set NODE_ENV=production"
echo "  3. Run: node server.js"
echo "  4. Or: npm i -g pm2 && pm2 start ecosystem.prod.cjs"
echo "  5. Verify: curl http://localhost:3000/api/health"

echo ""
echo "=== Ready for deployment ==="
