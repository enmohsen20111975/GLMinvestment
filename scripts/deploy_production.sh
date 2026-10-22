#!/bin/bash
# =============================================================================
# Production Deployment Script — GLMinvestment Phase 5b + Phase 6
# =============================================================================
#
# الـ script ده بيشغل كل خطوات الـ deploy بالترتيب:
#   1. Backup كل الـ DBs
#   2. git pull
#   3. تثبيت yfinance
#   4. audit (تأكيد نهائي)
#   5. Phase 2 unify
#   6. Phase 5 verify
#   7. Phase 5b verify
#   8. Phase 6 verify
#   9. runtime test
#
# لو أي خطوة فشلت، الـ script بيقف فوراً و ما يكملش.
#
# Usage:
#   cd /root/GLMinvestment
#   chmod +x scripts/deploy_production.sh
#   ./scripts/deploy_production.sh
#
# أو خطوة بخطوة (آمن أكثر):
#   ./scripts/deploy_production.sh --backup-only
#   ./scripts/deploy_production.sh --pull-only
#   ./scripts/deploy_production.sh --phase2-only
#   ... إلخ
# =============================================================================

set -e  # أي خطأ = وقف فوراً

PROJECT_ROOT="/root/GLMinvestment"
BACKUP_DIR="$PROJECT_ROOT/db/pre_deploy_backup_$(date +%Y%m%d_%H%M%S)"
VENV="$PROJECT_ROOT/.venv/bin/python3"

cd "$PROJECT_ROOT"

echo "================================================================"
echo "🚀 Production Deployment — $(date)"
echo "================================================================"
echo ""

# ── Step 0: Backup ─────────────────────────────────────────────────
echo "📊 Step 0: Backup كل الـ DBs..."
mkdir -p "$BACKUP_DIR"
cp db/*.db "$BACKUP_DIR/"
DB_COUNT=$(ls "$BACKUP_DIR"/*.db | wc -l)
echo "  ✅ Backup done: $DB_COUNT DBs in $BACKUP_DIR"
echo "  Size: $(du -sh $BACKUP_DIR | cut -f1)"
echo ""

if [ "$1" = "--backup-only" ]; then
    echo "✅ Backup only — exiting"
    exit 0
fi

# ── Step 1: Git Pull ───────────────────────────────────────────────
echo "📥 Step 1: git pull origin main..."
git pull origin main
echo "  ✅ git pull done"
echo ""

if [ "$1" = "--pull-only" ]; then
    echo "✅ Pull only — exiting"
    exit 0
fi

# ── Step 2: yfinance ───────────────────────────────────────────────
echo "📦 Step 2: Check yfinance..."
if $VENV -c "import yfinance" 2>/dev/null; then
    echo "  ✅ yfinance installed"
else
    echo "  📦 Installing yfinance..."
    $VENV -m pip install yfinance
    echo "  ✅ yfinance installed"
fi
echo ""

# ── Step 3: Audit ──────────────────────────────────────────────────
echo "🔍 Step 3: Production DB audit..."
$VENV scripts/audit_production_db.py
echo ""

# ── Step 4: Phase 2 Unify ──────────────────────────────────────────
echo "🔧 Step 4: Phase 2 — unify to price_history.db..."
$VENV scripts/unify_to_price_history.py
echo ""

if [ "$1" = "--phase2-only" ]; then
    echo "✅ Phase 2 only — exiting"
    exit 0
fi

# ── Step 5: Phase 5 Verify ─────────────────────────────────────────
echo "🔍 Step 5: Phase 5 verify (expect 6/6 PASS)..."
$VENV scripts/modify_get_tickers.py --verify
echo ""

if [ "$1" = "--phase5-only" ]; then
    echo "✅ Phase 5 only — exiting"
    exit 0
fi

# ── Step 6: Phase 5b Verify ────────────────────────────────────────
echo "🔍 Step 6: Phase 5b verify (expect 8/8 PASS)..."
$VENV scripts/verify_phase5b_liquidity_radar.py
echo ""

if [ "$1" = "--phase5b-only" ]; then
    echo "✅ Phase 5b only — exiting"
    exit 0
fi

# ── Step 7: Phase 6 Verify ──────────────────────────────────────────
echo "🔍 Step 7: Phase 6 verify (expect 8/8 PASS)..."
$VENV scripts/verify_phase6_safetynet.py
echo ""

if [ "$1" = "--phase6-only" ]; then
    echo "✅ Phase 6 only — exiting"
    exit 0
fi

# ── Step 8: Runtime test ───────────────────────────────────────────
echo "⚡ Step 8: Runtime test (daily_predictor + radar)..."
echo ""
echo "  --- daily_predictor (today, 10 tickers) ---"
cd vps-service
$VENV -m jobs.daily_predictor --today-only --max-tickers 10 2>&1 | tail -20
cd "$PROJECT_ROOT"
echo ""
echo "  --- liquidity_radar_v2 (COMI) ---"
$VENV scripts/liquidity_radar_v2.py --market EGX --ticker COMI --json 2>&1 | tail -15
echo ""

# ── Done ───────────────────────────────────────────────────────────
echo "================================================================"
echo "✅ Deployment complete — $(date)"
echo "================================================================"
echo ""
echo "📋 ما يجب عمله الآن:"
echo "  1. راقب pm2 logs nextjs --lines 50"
echo "  2. راقب pm2 logs python-backend --lines 50"
echo "  3. تحقق من price_history.db: sqlite3 db/price_history.db 'SELECT MAX(date) FROM price_history'"
echo "  4. لو فيه مشكلة، استخدم الـ rollback:"
echo "     pm2 stop all"
echo "     cp $BACKUP_DIR/*.db db/"
echo "     pm2 start all"
echo ""
echo "📁 Backup location: $BACKUP_DIR"
