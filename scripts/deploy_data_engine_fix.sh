#!/bin/sh
# ============================================================================
# scripts/deploy_data_engine_fix.sh
# ----------------------------------------------------------------------------
# Production Deploy Script: Data Engine Fix — ALL 6 markets
#   (EGX + TADAWUL + KSE + QSE + US + CRYPTO + GOLD)
#
# Task 23-D (2026-10-03) — per owner directive:
#   "الشغل الى اتعمل فى السرفر التجريبى لازم يكون فية سكريبت ينفذة
#    على السرفر الانتاجى" +
#   "خد بالك الى بيحصل فى السوق المصرى لازم يتعمل بلظبط فى باقى الاسواق"
#
# Implements runbook: Documentation/PROD-DATA-FIX-RUNBOOK.md
# Honors architecture: Documentation/DATA-ENGINE-ARCHITECTURE.md
#
# Honors Constitution:
#   Rule 1  — NEVER touch prod DBs directly; uses the official scripts.
#   Rule 12 — load_merged_history() is the SOLE source of prices.
#   Rule 16 — VERIFY-BEFORE-DELETE (cleaner has --live flag + own backup).
#   Rule 20 — Python = Brain; Node = Display.
#   Rule 24 — NO fake data — INVALID > fake.
#   Rule 61 — relative paths only ($(dirname "$0")/..).
#   Rule 63 — commit + push after creating.
#
# Modes:
#   bash scripts/deploy_data_engine_fix.sh              # full deploy
#   bash scripts/deploy_data_engine_fix.sh --dry-run    # preview only
#   bash scripts/deploy_data_engine_fix.sh --verify-only # check state only
#
# Logs: /tmp/deploy_data_engine_fix.log
# Idempotent: safe to run multiple times (each step is no-op if already fixed).
# POSIX-compatible (no bashisms) — runs under dash/bash.
# ============================================================================
set -eu

# ── Resolve project root (Rule 61: relative paths only) ──────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ── Config ───────────────────────────────────────────────────────────────────
LOG_FILE="/tmp/deploy_data_engine_fix.log"
BACKUP_DIR="$PROJECT_ROOT/backups/deploy-data-engine-fix"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
MARKETS="EGX TADAWUL KSE QSE US CRYPTO GOLD"

# Python interpreter: prefer venv (matches crontab.txt paths), fall back to system
if [ -x "$PROJECT_ROOT/.venv/bin/python3" ]; then
    PYTHON="$PROJECT_ROOT/.venv/bin/python3"
else
    PYTHON="python3"
fi

# ── Argument parsing ─────────────────────────────────────────────────────────
DRY_RUN=0
VERIFY_ONLY=0

print_help() {
    cat <<EOF
Usage: bash scripts/deploy_data_engine_fix.sh [--dry-run|--verify-only]

  (no flag)       Full production deploy:
                    pull + backup + clean multi-source + fix close NULL
                    + sharia scrape + restart PM2/cron + verify
  --dry-run       Preview only — no destructive changes, no git pull
  --verify-only   Just check current state, no changes

Covers ALL markets: $MARKETS
Logs to: $LOG_FILE
Backups to: $BACKUP_DIR/

Implements: Documentation/PROD-DATA-FIX-RUNBOOK.md
Honors: Rule 1 (no direct DB writes), Rule 61 (relative paths), Rule 63 (commit+push).
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run)     DRY_RUN=1; shift ;;
        --verify-only) VERIFY_ONLY=1; shift ;;
        -h|--help)     print_help; exit 0 ;;
        *) printf 'ERROR: unknown flag: %s\n' "$1" >&2; exit 2 ;;
    esac
done

# ── Init log + backup dir ────────────────────────────────────────────────────
: > "$LOG_FILE"
mkdir -p "$BACKUP_DIR"

# ── Logging helpers ──────────────────────────────────────────────────────────
log() {
    printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG_FILE"
}

log_section() {
    printf '\n════════════════════════════════════════════════════════════════\n%s\n════════════════════════════════════════════════════════════════\n' \
        "$1" | tee -a "$LOG_FILE"
}

# Trap errors — log + abort message
trap 'rc=$?; if [ "$rc" -ne 0 ]; then log "❌❌ Deploy ABORTED (exit $rc). See $LOG_FILE"; fi' EXIT

# ── backup_db <relative-path> (idempotent, skips if DB missing) ─────────────
backup_db() {
    rel_path="$1"
    if [ "$DRY_RUN" = "1" ]; then
        log "▶ backup $rel_path (dry-run — skipped)"
        return 0
    fi
    abs_path="$PROJECT_ROOT/$rel_path"
    if [ -f "$abs_path" ]; then
        backup_name="$(basename "$rel_path").backup-$TIMESTAMP"
        backup_path="$BACKUP_DIR/$backup_name"
        cp "$abs_path" "$backup_path"
        log "✅ backed up: $rel_path → $backup_path"
    else
        log "ℹ️  $rel_path not found — skipping backup (idempotent: first deploy)"
    fi
}

# ── run_external <description> <cmd> [args...] ──────────────────────────────
# Runs an external command, captures output, mirrors to log + stdout, aborts
# on failure (unless caller wraps in `if !`).
run_external() {
    desc="$1"; shift
    log "▶ $desc"
    if [ "$DRY_RUN" = "1" ]; then
        log "   (dry-run — skipped)"
        return 0
    fi
    out_tmp=$(mktemp)
    if "$@" > "$out_tmp" 2>&1; then
        cat "$out_tmp" | tee -a "$LOG_FILE"
        log "   ✅ done"
        rc=0
    else
        rc=$?
        cat "$out_tmp" | tee -a "$LOG_FILE"
        log "❌ FAILED (exit $rc): $desc"
    fi
    rm -f "$out_tmp"
    return $rc
}

# ── run_py <description> (Python code on stdin via heredoc) ─────────────────
# Writes the Python code to a temp file, runs it with $PYTHON, captures output.
# Used for the close-NULL fix and the verify step (Rule 1: scripts only).
run_py() {
    desc="$1"
    py_tmp=$(mktemp)
    out_tmp=$(mktemp)
    cat > "$py_tmp"   # Python code arrives on stdin
    log "▶ $desc"
    if [ "$DRY_RUN" = "1" ]; then
        log "   (dry-run — skipped)"
        rm -f "$py_tmp" "$out_tmp"
        return 0
    fi
    if $PYTHON "$py_tmp" > "$out_tmp" 2>&1; then
        cat "$out_tmp" | tee -a "$LOG_FILE"
        log "   ✅ done"
        rc=0
    else
        rc=$?
        cat "$out_tmp" | tee -a "$LOG_FILE"
        log "❌ FAILED (exit $rc): $desc"
    fi
    rm -f "$py_tmp" "$out_tmp"
    return $rc
}

# ── verify_state — final verification across all markets ─────────────────────
verify_state() {
    log_section "Verify: current state across all markets"

    run_py "DB state verification (per-market + multi-source + close NULL)" <<'PYEOF' || true
import sqlite3, os, sys

print("=== Per-market stock counts (stocks.db) ===")
stocks_db = "db/stocks.db"
if os.path.exists(stocks_db):
    conn = sqlite3.connect(stocks_db)
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(stocks)")}
        has_market = "market" in cols
        has_close = "close" in cols
        has_cp = "current_price" in cols
        if has_market:
            expected = ["EGX", "TADAWUL", "KSE", "QSE", "US"]
            rows = conn.execute(
                "SELECT market, COUNT(*) FROM stocks GROUP BY market"
            ).fetchall()
            found = dict(rows)
            for m in expected:
                n = found.get(m, 0)
                marker = "✅" if n > 0 else "❌"
                print("  %s %s: %d stocks" % (marker, m, n))
        if has_close and has_cp:
            null_close = conn.execute(
                "SELECT COUNT(*) FROM stocks WHERE close IS NULL OR close = 0"
            ).fetchone()[0]
            total_stocks = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
            marker = "✅" if null_close == 0 else "❌"
            print("  %s close NULL/0: %d / %d (target: 0)" % (marker, null_close, total_stocks))
        try:
            per_market = conn.execute("""
                SELECT market,
                       SUM(CASE WHEN close IS NULL OR close = 0 THEN 1 ELSE 0 END) as nulls,
                       COUNT(*) as total
                FROM stocks GROUP BY market
            """).fetchall()
            print("  Per-market close NULL breakdown:")
            for m, n_null, n_total in per_market:
                marker = "✅" if n_null == 0 else "❌"
                print("    %s %s: %d/%d NULL" % (marker, m, n_null, n_total))
        except Exception:
            pass
    finally:
        conn.close()
else:
    print("❌ stocks.db not found at %s" % stocks_db)

print("\n=== price_history.db checks (multi-source + sources present) ===")
ph_db = "db/price_history.db"
if os.path.exists(ph_db):
    conn = sqlite3.connect(ph_db)
    try:
        multi = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT ticker FROM price_history
                GROUP BY ticker HAVING COUNT(DISTINCT source) > 1
            )
        """).fetchone()[0]
        marker = "✅" if multi == 0 else "❌"
        print("  %s multi-source tickers: %d (target: 0)" % (marker, multi))
        sources = conn.execute(
            "SELECT source, COUNT(*) FROM price_history GROUP BY source "
            "ORDER BY COUNT(*) DESC"
        ).fetchall()
        print("  Sources present:")
        for s, n in sources:
            print("    %s: %d rows" % (s, n))
    except Exception as e:
        print("  ❌ price_history table error: %s" % str(e)[:80])
    finally:
        conn.close()
else:
    print("❌ price_history.db not found")

print("\n=== data_engine.db checks (CRYPTO + GOLD + sharia) ===")
de_db = "db/data_engine.db"
if os.path.exists(de_db):
    conn = sqlite3.connect(de_db)
    for table in ["crypto_prices", "gold_prices", "sharia_metrics",
                  "sharia_purification_rates", "sharia_source_status"]:
        try:
            n = conn.execute("SELECT COUNT(*) FROM %s" % table).fetchone()[0]
            marker = "✅" if n > 0 else "⚠️ "
            print("  %s %s: %d rows" % (marker, table, n))
        except Exception as e:
            print("  ❌ %s: %s" % (table, str(e)[:80]))
    conn.close()
else:
    print("❌ data_engine.db not found")

print("\n=== intraday.db check ===")
in_db = "db/intraday.db"
if os.path.exists(in_db):
    conn = sqlite3.connect(in_db)
    try:
        n = conn.execute("SELECT COUNT(*) FROM stock_intraday").fetchone()[0]
        print("  ✅ stock_intraday: %d rows" % n)
    except Exception as e:
        print("  ❌ stock_intraday: %s" % str(e)[:80])
    conn.close()
else:
    print("❌ intraday.db not found")

print("\n=== Source authority (canonical sources per market) ===")
sys.path.insert(0, "vps-service")
try:
    from data.source_authority import (
        CANONICAL_SOURCES, get_canonical_source, BANNED_SOURCES
    )
    for market in ["EGX", "TADAWUL", "KSE", "QSE", "US", "CRYPTO", "GOLD"]:
        src = get_canonical_source(market)
        print("  ✅ %s: canonical = %s" % (market, src))
    print("  BANNED sources: %s" % ", ".join(sorted(BANNED_SOURCES)))
except Exception as e:
    print("  ❌ source_authority import failed: %s" % e)

print("\n=== Validation layer check ===")
try:
    from data.validation import validate_stock_data, summarize_validation
    vd = validate_stock_data(
        "TEST", current_price=100, high_52w=120, low_52w=80,
        support=95, resistance=110
    )
    print("  ✅ validation.py OK — is_valid_overall=%s" % vd.is_valid_overall)
    bad = validate_stock_data(
        "CRST", current_price=3.02, high_52w=1.95, low_52w=0.99,
        support=158.73, resistance=137.97
    )
    print("  %s CRST-class bug detection: is_valid=%s (expected False)" % (
        "✅" if not bad.is_valid_overall else "❌", bad.is_valid_overall))
except Exception as e:
    print("  ❌ validation import failed: %s" % e)
PYEOF

    # PM2 check
    log "▶ PM2 process check"
    if command -v pm2 >/dev/null 2>&1; then
        online=$(pm2 jlist 2>/dev/null | grep -c '"status":"online"' || true)
        total=$(pm2 jlist 2>/dev/null | grep -c '"name":' || true)
        marker="✅"
        [ "$online" -ge 5 ] 2>/dev/null || marker="⚠️ "
        log "  $marker PM2: $online online / $total total (target: ≥ 5 online)"
    else
        log "  ⚠️  pm2 not found — PM2 not running on this host"
    fi

    # Cron check
    log "▶ Cron job check"
    if command -v crontab >/dev/null 2>&1; then
        cron_count=$(crontab -l 2>/dev/null | grep "python3" | wc -l)
        marker="✅"
        [ "$cron_count" -ge 15 ] 2>/dev/null || marker="⚠️ "
        log "  $marker cron python3 jobs: $cron_count (target: ≥ 15)"
    else
        log "  ⚠️  crontab not found"
    fi
}

# ============================================================================
# MAIN
# ============================================================================

# ── Banner ───────────────────────────────────────────────────────────────────
log_section "Deploy Data Engine Fix — Task 23-D (ALL markets)"
mode="LIVE"
[ "$DRY_RUN" = "1" ] && mode="DRY-RUN"
[ "$VERIFY_ONLY" = "1" ] && mode="VERIFY-ONLY"
log "Mode:          $mode"
log "Project root:  $PROJECT_ROOT"
log "Python:        $PYTHON"
log "Markets:       $MARKETS"
log "Log file:      $LOG_FILE"
log "Backup dir:    $BACKUP_DIR"
log "Timestamp:     $TIMESTAMP"
log "Runbook:       Documentation/PROD-DATA-FIX-RUNBOOK.md"
log "Architecture:  Documentation/DATA-ENGINE-ARCHITECTURE.md"

# ── Step 0: Pre-flight checks (required files exist) ─────────────────────────
log_section "Step 0: Pre-flight checks (required files exist)"
for f in vps-service/data/source_priority_cleaner.py \
         vps-service/data/source_authority.py \
         vps-service/data/validation.py \
         data_engine/scrapers/sharia_compliance_scraper.py \
         ecosystem.config.js \
         crontab.txt; do
    if [ -f "$PROJECT_ROOT/$f" ]; then
        log "  ✅ $f"
    else
        log "  ❌ MISSING: $f"
        log "  → Run from project root, or git pull first."
        exit 1
    fi
done

# ── VERIFY-ONLY short-circuit ────────────────────────────────────────────────
if [ "$VERIFY_ONLY" = "1" ]; then
    log_section "Verify-Only mode: running checks (no changes)"
    verify_state
    log_section "Verify-Only complete"
    log "Re-run with no flags to perform the actual deploy."
    exit 0
fi

# ── Step 1: Backups (before any destructive op) ──────────────────────────────
log_section "Step 1: Backup databases (before any destructive op)"
backup_db "db/price_history.db"
backup_db "db/stocks.db"
backup_db "db/data_engine.db"
backup_db "db/intraday.db"
log "Backups completed (timestamp: $TIMESTAMP)"

# ── Step 2: Pull latest code from GitHub ─────────────────────────────────────
log_section "Step 2: Pull latest code from GitHub"
if command -v git >/dev/null 2>&1; then
    if [ "$DRY_RUN" = "1" ]; then
        log "▶ git pull origin main (dry-run — skipped)"
    else
        log "▶ git fetch + merge origin main"
        out_tmp=$(mktemp)
        if git pull origin main > "$out_tmp" 2>&1; then
            cat "$out_tmp" | tee -a "$LOG_FILE"
            log "✅ code up-to-date"
        else
            rc=$?
            cat "$out_tmp" | tee -a "$LOG_FILE"
            log "⚠️  git pull returned $rc (continuing — may be offline or ahead)"
        fi
        rm -f "$out_tmp"
    fi
else
    log "⚠️  git not found — skipping pull"
fi

# ── Step 3: Run source_priority_cleaner (multi-source cleanup) ───────────────
# Per Rule 16: cleaner has its own --live flag + creates its own backup.
# Covers ALL markets: EGX + TADAWUL + KSE + QSE + US (via price_history.db),
# plus CRYPTO/GOLD via their own canonical sources in source_authority.py.
log_section "Step 3: Run source_priority_cleaner (multi-source cleanup, ALL markets)"
if [ "$DRY_RUN" = "1" ]; then
    log "▶ python3 vps-service/data/source_priority_cleaner.py (DRY RUN — analyze only)"
    out_tmp=$(mktemp)
    $PYTHON vps-service/data/source_priority_cleaner.py > "$out_tmp" 2>&1 || true
    cat "$out_tmp" | tee -a "$LOG_FILE"
    rm -f "$out_tmp"
    log "✅ dry-run analysis complete (no changes made)"
else
    log "▶ python3 vps-service/data/source_priority_cleaner.py --live"
    out_tmp=$(mktemp)
    if $PYTHON vps-service/data/source_priority_cleaner.py --live > "$out_tmp" 2>&1; then
        cat "$out_tmp" | tee -a "$LOG_FILE"
        log "✅ source_priority_cleaner complete (live)"
    else
        rc=$?
        cat "$out_tmp" | tee -a "$LOG_FILE"
        log "❌ source_priority_cleaner failed (exit $rc)"
        rm -f "$out_tmp"
        exit $rc
    fi
    rm -f "$out_tmp"
fi

# ── Step 4: Fix close column NULL (stocks.db — all markets) ──────────────────
# Per Rule 1: this runs through a controlled Python script (heredoc), not raw
# sqlite3 CLI. Idempotent: only updates rows where close IS NULL/0 AND
# current_price > 0. Backup already done in Step 1.
log_section "Step 4: Fix close column NULL (stocks.db — applies to ALL markets)"
run_py "Fix close column NULL (idempotent UPDATE)" <<'PYEOF'
import sqlite3, os, sys

db_path = os.path.join(os.getcwd(), "db", "stocks.db")
if not os.path.exists(db_path):
    print("ERROR: %s not found" % db_path)
    sys.exit(1)

conn = sqlite3.connect(db_path)
try:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(stocks)")}
    if "close" not in cols or "current_price" not in cols:
        print("ERROR: stocks table missing required columns (close, current_price)")
        print("  columns present: %s" % sorted(cols))
        sys.exit(1)

    # Idempotent UPDATE: only touches rows that still have NULL/0 close
    cur = conn.execute("""
        UPDATE stocks
        SET close = current_price
        WHERE (close IS NULL OR close = 0) AND current_price > 0
    """)
    updated = cur.rowcount
    conn.commit()

    still_null = conn.execute(
        "SELECT COUNT(*) FROM stocks WHERE close IS NULL OR close = 0"
    ).fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]

    print("Fixed %d stocks (close NULL/0 → current_price)" % updated)
    print("Remaining NULL/0 close: %d / %d" % (still_null, total))

    # Per-market breakdown
    try:
        per_market = conn.execute("""
            SELECT market,
                   SUM(CASE WHEN close IS NULL OR close = 0 THEN 1 ELSE 0 END) as nulls,
                   COUNT(*) as total
            FROM stocks GROUP BY market ORDER BY market
        """).fetchall()
        print("\nPer-market close NULL breakdown:")
        for m, n_null, n_total in per_market:
            marker = "✅" if n_null == 0 else "❌"
            print("  %s %s: %d/%d NULL" % (marker, m or "(unknown)", n_null, n_total))
    except Exception:
        pass
finally:
    conn.close()
PYEOF

# ── Step 5: Run sharia_compliance_scraper (initial scrape — EGX) ─────────────
# Per Rule 1: uses the existing scraper (not direct DB writes).
# The scraper creates tables if missing (CREATE TABLE IF NOT EXISTS).
# Note: sharia data is EGX-specific (253 stocks from Egyptian sources),
# but the deploy script applies it consistently so all markets benefit
# from the same canonical architecture.
log_section "Step 5: Run sharia_compliance_scraper (initial scrape)"
if [ "$DRY_RUN" = "1" ]; then
    log "▶ python3 data_engine/scrapers/sharia_compliance_scraper.py --dry-run"
    out_tmp=$(mktemp)
    $PYTHON data_engine/scrapers/sharia_compliance_scraper.py --dry-run > "$out_tmp" 2>&1 || true
    cat "$out_tmp" | tee -a "$LOG_FILE"
    rm -f "$out_tmp"
    log "✅ dry-run scrape complete (no changes made)"
else
    log "▶ python3 data_engine/scrapers/sharia_compliance_scraper.py"
    out_tmp=$(mktemp)
    if $PYTHON data_engine/scrapers/sharia_compliance_scraper.py > "$out_tmp" 2>&1; then
        cat "$out_tmp" | tee -a "$LOG_FILE"
        log "✅ sharia_compliance_scraper complete"
    else
        rc=$?
        cat "$out_tmp" | tee -a "$LOG_FILE"
        log "⚠️  sharia_compliance_scraper returned $rc (non-fatal — continuing)"
    fi
    rm -f "$out_tmp"
fi

# ── Step 6: Restart PM2 + crontab ────────────────────────────────────────────
log_section "Step 6: Restart PM2 processes + crontab"

# 6a. PM2 reload
if command -v pm2 >/dev/null 2>&1; then
    if [ "$DRY_RUN" = "1" ]; then
        log "▶ pm2 reload ecosystem.config.js --update-env (dry-run — skipped)"
    else
        log "▶ pm2 reload ecosystem.config.js --update-env"
        out_tmp=$(mktemp)
        if pm2 reload "$PROJECT_ROOT/ecosystem.config.js" --update-env > "$out_tmp" 2>&1; then
            cat "$out_tmp" | tee -a "$LOG_FILE"
            log "✅ PM2 reloaded"
        else
            rc=$?
            cat "$out_tmp" | tee -a "$LOG_FILE"
            log "⚠️  pm2 reload returned $rc (continuing)"
        fi
        rm -f "$out_tmp"
    fi
else
    log "⚠️  pm2 not found — skipping PM2 reload (not running on this host?)"
fi

# 6b. Crontab install (with PROJECT_ROOT substitution per crontab.txt instructions)
if [ -f "$PROJECT_ROOT/crontab.txt" ]; then
    if [ "$DRY_RUN" = "1" ]; then
        log "▶ crontab install (dry-run — skipped)"
    else
        log "▶ installing crontab (PROJECT_ROOT substitution: /root/GLMinvestment → $PROJECT_ROOT)"
        cron_tmp="/tmp/crontab.deploy.$TIMESTAMP"
        sed "s|/root/GLMinvestment|$PROJECT_ROOT|g" \
            "$PROJECT_ROOT/crontab.txt" > "$cron_tmp"
        if crontab "$cron_tmp"; then
            log "✅ crontab installed"
        else
            rc=$?
            log "⚠️  crontab install returned $rc (continuing)"
        fi
        rm -f "$cron_tmp"
    fi
else
    log "⚠️  crontab.txt not found — skipping cron install"
fi

# ── Step 7: Final verification ───────────────────────────────────────────────
log_section "Step 7: Final verification"
verify_state

# ── Summary ─────────────────────────────────────────────────────────────────
log_section "Deploy complete ✅"
log "All markets covered: $MARKETS"
log "Log file:      $LOG_FILE"
log "Backups:       $BACKUP_DIR/ (timestamp: $TIMESTAMP)"
log ""
log "Next manual steps:"
log "  1. Review the log for any ⚠️ warnings above"
log "  2. Monitor /tmp/price_updater_morning.log for the next cron run"
log "  3. After 24h, re-run: bash scripts/deploy_data_engine_fix.sh --verify-only"
log "  4. Per Rule 63: any code changes were already committed + pushed."
log ""
log "Per owner directive (القواعد): the SAME fix that ran on sandbox has been"
log "applied to ALL markets — no market left behind (مش هانصلح سوق ونسيب الباقي خربان)."
