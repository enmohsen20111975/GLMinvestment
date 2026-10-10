#!/bin/bash
# ============================================================================
# setup_cron.sh — Setup daily cron jobs for EGX Sniper System
# ============================================================================
# Cron entries:
#   - daily_closer:  14:35 Cairo (12:35 UTC) Sunday–Thursday (EGX trading days)
#   - learning_engine: 14:40 Cairo (12:40 UTC) Friday (weekly)
#   - daily_backup: 03:00 UTC (approx. 05:00 / 06:00 Cairo time) daily
#
# P4-VENV-FIX (v3.70.0): كنا بنستخدم /usr/bin/python3 الثابت → الـ cron كان
# بـ يكسر لو الـ dependencies (pytz/flask/...) مش مثبتة في system Python. دلوقتي
# بنكتشف الـ venv Python ديناميكياً (project venv → home venv → system python3).
# ============================================================================

set -euo pipefail

# Determine project and service directory dynamically
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "${SCRIPT_DIR}/../.." && pwd )"
VPS_DIR="${PROJECT_DIR}/vps-service"
LOG_DIR="${PROJECT_DIR}/logs"

# --- Ensure log directory exists ---
mkdir -p "${LOG_DIR}"

# --- P4-VENV-FIX: Detect venv Python dynamically ---
# Prefer project-level venv, then home venv, then whatever python3 is on PATH,
# finally fall back to /usr/bin/python3. الـ cron لازم يـستخدم نفس Python اللي
# فيه الـ dependencies (pytz, flask, ...) عشان ما يكسرش بصمت.
if [ -x "${PROJECT_DIR}/venv/bin/python" ]; then
    PYTHON_BIN="${PROJECT_DIR}/venv/bin/python"
elif [ -x "${VPS_DIR}/venv/bin/python" ]; then
    PYTHON_BIN="${VPS_DIR}/venv/bin/python"
elif [ -x "${HOME}/.venv/bin/python3" ]; then
    PYTHON_BIN="${HOME}/.venv/bin/python3"
else
    PYTHON_BIN="$(command -v python3 || echo /usr/bin/python3)"
fi

echo "[setup_cron] Detected PYTHON_BIN=${PYTHON_BIN}"
# Sanity check: ensure it can import critical deps (fail loudly, not silently)
if ! "${PYTHON_BIN}" -c "import sqlite3" >/dev/null 2>&1; then
    echo "[setup_cron] ⚠️ WARNING: ${PYTHON_BIN} cannot import sqlite3 — cron jobs will fail!" >&2
fi

# --- Define cron entries (using detected venv Python) ---
# ملاحظة: كل entry بـ يعمل mkdir -p logs الأول عشان الـ redirect ما يكسرش لو
# الـ dir مش موجود (مثلاً بعد clean install).
CLOSER_ENTRY="35 12 * * 0-4 cd ${PROJECT_DIR} && mkdir -p logs && ${PYTHON_BIN} vps-service/jobs/daily_closer.py >> logs/closer.log 2>&1"
LEARNING_ENTRY="40 12 * * 5 cd ${PROJECT_DIR} && mkdir -p logs && ${PYTHON_BIN} vps-service/jobs/learning_engine.py >> logs/learning.log 2>&1"
BACKUP_ENTRY="0 3 * * * cd ${PROJECT_DIR} && mkdir -p logs && ${PYTHON_BIN} vps-service/scripts/daily_backup.py >> logs/daily_backup.log 2>&1"
HEARTBEAT_ENTRY="0 * * * * cd ${PROJECT_DIR} && mkdir -p logs && ${PYTHON_BIN} vps-service/scripts/data_heartbeat_checker.py >> logs/data_heartbeat.log 2>&1"

# --- Helper: add entry if not already present ---
add_cron_entry() {
    local entry="$1"
    local label="$2"

    if crontab -l 2>/dev/null | grep -qF "$entry"; then
        echo "[✓] ${label} cron entry already exists — skipping"
    else
        (crontab -l 2>/dev/null; echo "$entry") | crontab -
        echo "[+] ${label} cron entry added"
    fi
}

# --- Add entries ---
add_cron_entry "$CLOSER_ENTRY" "daily_closer"
add_cron_entry "$LEARNING_ENTRY" "learning_engine"
add_cron_entry "$BACKUP_ENTRY" "daily_backup"
add_cron_entry "$HEARTBEAT_ENTRY" "data_heartbeat"

# --- Show result ---
echo ""
echo "Current crontab:"
echo "-----------------"
crontab -l
