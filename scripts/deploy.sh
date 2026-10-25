#!/usr/bin/env bash
# deploy.sh — سكريبت النشر الآمن (Phase 9 — Deploy Prep)
# ========================================================
# بيـ:
#   1. Backup كل الـ DBs
#   2. git pull origin main
#   3. bun install + bun run build
#   4. pm2 restart all
#   5. smoke test
#
# Usage:
#   bash scripts/deploy.sh
#   bash scripts/deploy.sh --no-backup   # تخطي الـ backup
#
# Author: برافو (Phase 9 — Deploy Prep)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "════════════════════════════════════════════════════════════════"
echo "  🚀 GLMinvestment Deploy Script — $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════════════"
echo ""

# ─── Step 1: Backup DBs ───
if [ "${1:-}" != "--no-backup" ]; then
    echo "📦 Step 1: Backing up databases..."
    BACKUP_DIR="db/backup_$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    for db in db/*.db; do
        if [ -f "$db" ]; then
            cp "$db" "$BACKUP_DIR/" && echo "  ✅ $(basename $db)"
        fi
    done
    echo "  Backup saved: $BACKUP_DIR"
else
    echo "📦 Step 1: SKIPPED (--no-backup)"
fi
echo ""

# ─── Step 2: Git Pull ───
echo "📥 Step 2: Git pull..."
git pull --rebase origin main 2>&1 | tail -3
echo ""

# ─── Step 3: Architecture Check ───
echo "🔍 Step 3: Architecture check..."
if [ -f scripts/check_architecture.py ]; then
    python3 scripts/check_architecture.py --strict --quiet 2>&1 | grep -E "Violations|CLEAN" || true
fi
echo ""

# ─── Step 4: Install Dependencies ───
echo "📦 Step 4: Installing dependencies..."
if command -v bun &> /dev/null; then
    bun install 2>&1 | tail -3
elif command -v npm &> /dev/null; then
    npm install 2>&1 | tail -3
fi
echo ""

# ─── Step 5: Build ───
echo "🔨 Step 5: Building..."
if command -v bun &> /dev/null; then
    bun run build 2>&1 | tail -5
elif command -v npm &> /dev/null; then
    npm run build 2>&1 | tail -5
fi
echo ""

# ─── Step 6: Restart Services ───
echo "🔄 Step 6: Restarting services..."
if command -v pm2 &> /dev/null; then
    pm2 restart all 2>&1 | tail -5
    echo "  ✅ PM2 services restarted"
else
    echo "  ⚠️  PM2 not available — manual restart needed"
fi
echo ""

# ─── Step 7: Smoke Test ───
echo "🧪 Step 7: Smoke test..."
if [ -f scripts/smoke_test.sh ]; then
    bash scripts/smoke_test.sh 2>&1 || true
fi
echo ""

echo "════════════════════════════════════════════════════════════════"
echo "  ✅ Deploy complete — $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════════════"
