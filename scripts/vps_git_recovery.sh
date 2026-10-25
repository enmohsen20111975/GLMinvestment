#!/bin/bash
# VPS Git Recovery Script — Safe recovery from unrelated histories
# Usage: bash vps_git_recovery.sh
# Run on VPS: /root/GLMinvestment

set -e

REPO_DIR="/root/GLMinvestment"
BACKUP_DIR="/root/GLMinvestment_backup_$(date +%Y%m%d_%H%M%S)"

echo "════════════════════════════════════════════════════════════════"
echo "  VPS Git Recovery — Safe backup + clean clone"
echo "════════════════════════════════════════════════════════════════"

# Step 1: Backup current state
echo ""
echo "Step 1: Backing up current repo to $BACKUP_DIR"
cp -r "$REPO_DIR" "$BACKUP_DIR"
echo "  ✅ Backup created"

# Step 2: Save DBs + .env + config
echo ""
echo "Step 2: Saving production DBs + .env"
mkdir -p /tmp/vps_recovery
cp "$REPO_DIR/db/"*.db /tmp/vps_recovery/ 2>/dev/null || true
cp "$REPO_DIR/.env" /tmp/vps_recovery/ 2>/dev/null || true
cp "$REPO_DIR/.env.local" /tmp/vps_recovery/ 2>/dev/null || true
echo "  ✅ DBs + .env saved to /tmp/vps_recovery/"

# Step 3: Remove old repo
echo ""
echo "Step 3: Removing old repo (backup is safe)"
rm -rf "$REPO_DIR"
echo "  ✅ Old repo removed"

# Step 4: Fresh clone
echo ""
echo "Step 4: Fresh clone from GitHub"
cd "$(dirname "$REPO_DIR")"
git clone https://github.com/enmohsen20111975/GLMinvestment.git
echo "  ✅ Fresh clone complete"

# Step 5: Restore DBs + .env
echo ""
echo "Step 5: Restoring production DBs + .env"
mkdir -p "$REPO_DIR/db"
cp /tmp/vps_recovery/*.db "$REPO_DIR/db/" 2>/dev/null || true
cp /tmp/vps_recovery/.env "$REPO_DIR/" 2>/dev/null || true
cp /tmp/vps_recovery/.env.local "$REPO_DIR/" 2>/dev/null || true
echo "  ✅ DBs + .env restored"

# Step 6: Install dependencies
echo ""
echo "Step 6: Installing dependencies"
cd "$REPO_DIR"
bun install 2>&1 | tail -5
echo "  ✅ Dependencies installed"

# Step 7: Verify
echo ""
echo "Step 7: Verification"
echo "  Git HEAD: $(git rev-parse HEAD)"
echo "  Git branch: $(git branch --show-current)"
echo "  DBs:"
ls -la db/*.db 2>/dev/null | awk '{print "    "$5, $9}'
echo "  .env exists: $([ -f .env ] && echo 'YES' || echo 'NO')"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  ✅ Recovery complete!"
echo "  Backup at: $BACKUP_DIR"
echo "  DBs + .env restored from: /tmp/vps_recovery/"
echo ""
echo "  Next steps:"
echo "    cd $REPO_DIR"
echo "    pm2 start ecosystem.config.js"
echo "════════════════════════════════════════════════════════════════"
