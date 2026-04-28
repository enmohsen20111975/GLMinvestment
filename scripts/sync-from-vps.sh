#!/bin/bash
# =============================================================================
# sync-from-vps.sh — Download latest DB files from VPS to Hostinger
# =============================================================================
# Run this on Hostinger via cron (every 6 hours recommended):
#   0 */6 * * * /home/uXXXXX/domains/invist.m2y.net/scripts/sync-from-vps.sh >> /home/uXXXXX/domains/invist.m2y.net/logs/sync.log 2>&1
#
# Or manually: bash scripts/sync-from-vps.sh
# =============================================================================

set -euo pipefail

# --- Configuration ---
VPS_HOST="72.61.137.86"
VPS_PORT="8010"
VPS_USER="root"  # Change if using a different user
DB_DIR="$(cd "$(dirname "$0")/.." && pwd)/db"
BACKUP_DIR="${DB_DIR}/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# VPS Python bridge endpoints
VPS_LIGHT_DB_URL="http://${VPS_HOST}:${VPS_PORT}/api/download-db?file=custom"
VPS_HEAVY_DB_URL="http://${VPS_HOST}:${VPS_PORT}/api/download-db?file=egx_investment"

# Direct SCP fallback (if HTTP download fails)
VPS_SCP_LIGHT="/root/egxpy-bridge/data/custom.db"
VPS_SCP_HEAVY="/root/egxpy-bridge/data/egx_investment.db"

# --- Functions ---
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

backup_db() {
  local file="$1"
  if [ -f "$file" ]; then
    mkdir -p "$BACKUP_DIR"
    cp "$file" "${BACKUP_DIR}/$(basename "$file").${TIMESTAMP}.bak"
    log "Backed up $(basename "$file")"
  fi
}

download_via_http() {
  local url="$1"
  local output="$2"
  local name="$3"

  log "Downloading $name via HTTP from VPS..."
  if command -v wget &>/dev/null; then
    wget -q --timeout=120 -O "$output.tmp" "$url" 2>/dev/null && mv "$output.tmp" "$output"
  elif command -v curl &>/dev/null; then
    curl -s -m 120 -o "$output.tmp" "$url" 2>/dev/null && mv "$output.tmp" "$output"
  else
    log "ERROR: Neither wget nor curl found"
    return 1
  fi

  if [ -f "$output" ] && [ -s "$output" ]; then
    log "SUCCESS: $name downloaded ($(du -h "$output" | cut -f1))"
    return 0
  else
    rm -f "$output.tmp" "$output"
    log "FAILED: $name download failed or empty"
    return 1
  fi
}

download_via_scp() {
  local remote="$1"
  local output="$2"
  local name="$3"

  log "Attempting SCP download for $name..."
  if scp -q -o ConnectTimeout=30 -o StrictHostKeyChecking=no "${VPS_USER}@${VPS_HOST}:${remote}" "$output" 2>/dev/null; then
    if [ -f "$output" ] && [ -s "$output" ]; then
      log "SUCCESS: $name downloaded via SCP ($(du -h "$output" | cut -f1))"
      return 0
    fi
  fi
  rm -f "$output"
  log "FAILED: $name SCP download failed"
  return 1
}

# --- Main ---
log "============================================"
log "Starting DB sync from VPS (${VPS_HOST})"
log "============================================"

mkdir -p "$DB_DIR" "$BACKUP_DIR"

# --- Sync Light DB (custom.db, ~200KB) ---
LIGHT_DB="${DB_DIR}/custom.db"
backup_db "$LIGHT_DB"

if ! download_via_http "$VPS_LIGHT_DB_URL" "$LIGHT_DB" "custom.db"; then
  download_via_scp "$VPS_SCP_LIGHT" "$LIGHT_DB" "custom.db"
fi

# --- Sync Heavy DB (egx_investment.db, ~55MB) ---
HEAVY_DB="${DB_DIR}/egx_investment.db"
backup_db "$HEAVY_DB"

if ! download_via_http "$VPS_HEAVY_DB_URL" "$HEAVY_DB" "egx_investment.db"; then
  download_via_scp "$VPS_SCP_HEAVY" "$HEAVY_DB" "egx_investment.db"
fi

# --- Cleanup old backups (keep last 5) ---
cd "$BACKUP_DIR"
ls -t *.bak 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true

# --- Summary ---
log "--- Sync Summary ---"
if [ -f "$LIGHT_DB" ]; then
  log "custom.db: OK ($(du -h "$LIGHT_DB" | cut -f1))"
else
  log "custom.db: MISSING"
fi

if [ -f "$HEAVY_DB" ]; then
  log "egx_investment.db: OK ($(du -h "$HEAVY_DB" | cut -f1))"
else
  log "egx_investment.db: MISSING"
fi

log "============================================"
log "Sync complete at $(date '+%Y-%m-%d %H:%M:%S')"
log "============================================"
