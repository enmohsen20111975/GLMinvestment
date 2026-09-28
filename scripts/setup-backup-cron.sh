#!/usr/bin/env bash
#
# GLMinvestment — Setup Daily Backup Cron Job
# ============================================
# Adds a cron entry that runs scripts/auto-backup.sh daily at 3:00 AM
# Cairo time (Africa/Cairo, UTC+2 standard / UTC+3 DST).
#
# Usage:
#   bash scripts/setup-backup-cron.sh
#
# The cron entry (runs in system timezone, so set TZ if needed):
#   0 3 * * * cd <PROJECT_DIR> && bash scripts/auto-backup.sh >> db/backups/cron.log 2>&1
#

set -euo pipefail

# Resolve PROJECT_DIR dynamically (Rule 17 + Rule 61 — RELATIVE-PATHS-ONLY)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CRON_MARKER="GLMinvestment-auto-backup"
CRON_ENTRY="0 3 * * * cd ${PROJECT_DIR} && bash scripts/auto-backup.sh >> db/backups/cron.log 2>&1"

echo "═══════════════════════════════════════════════════════"
echo "  GLMinvestment — Backup Cron Setup"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── Check if the cron job already exists ───────────────────────────────────
if crontab -l 2>/dev/null | grep -qF "${CRON_MARKER}"; then
    echo "✓  Cron job for auto-backup is already installed."
    echo ""
    echo "  Current entry:"
    crontab -l 2>/dev/null | grep -F "${CRON_MARKER}"
    echo ""
    echo "  Schedule: Daily at 3:00 AM (system timezone)"
    echo "  Log file: ${PROJECT_DIR}/db/backups/cron.log"
    echo ""
    echo "  No changes made."
    exit 0
fi

# ── Add the cron entry ─────────────────────────────────────────────────────
# We use a marker comment so we can detect duplicates
MARKED_ENTRY="# ${CRON_MARKER} — DO NOT EDIT\n${CRON_ENTRY}"

(crontab -l 2>/dev/null; printf "${MARKED_ENTRY}\n") | crontab -

echo "✓  Cron job installed successfully!"
echo ""
echo "  Entry added:"
echo "  ─────────────────────────────────────────────────"
echo "  0 3 * * * cd ${PROJECT_DIR} && bash scripts/auto-backup.sh >> db/backups/cron.log 2>&1"
echo "  ─────────────────────────────────────────────────"
echo ""
echo "  Schedule: Daily at 3:00 AM (system timezone)"
echo "  Backup script: scripts/auto-backup.sh"
echo "  Log output: db/backups/cron.log"
echo ""
echo "  Note: Ensure the system timezone is set to Africa/Cairo"
echo "  for the 3:00 AM schedule to run at Cairo local time."
echo "  Check with: timedatectl"
echo ""
echo "  To remove later, run: crontab -e and delete the line"
echo "  marked with '${CRON_MARKER}'"
echo ""
echo "═══════════════════════════════════════════════════════"