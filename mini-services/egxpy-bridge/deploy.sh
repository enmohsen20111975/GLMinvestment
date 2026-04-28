#!/bin/bash
# =============================================================================
# deploy.sh — Deploy EGXPy Bridge to VPS
# =============================================================================
# Usage:
#   1. Copy this entire directory to your VPS:
#      scp -r egxpy-bridge/ user@72.61.137.86:/opt/egxpy-bridge/
#
#   2. SSH into VPS and run:
#      cd /opt/egxpy-bridge
#      chmod +x deploy.sh
#      ./deploy.sh
#
#   Or deploy remotely in one step:
#      scp -r egxpy-bridge/ user@72.61.137.86:/opt/egxpy-bridge/ && \
#      ssh user@72.61.137.86 "cd /opt/egxpy-bridge && chmod +x deploy.sh && ./deploy.sh"
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
SERVICE_NAME="egxpy-bridge"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
PORT="${EGXPY_PORT:-8010}"

echo "=============================================="
echo " EGXPy Bridge API — VPS Deployment"
echo "=============================================="
echo "Directory: $SCRIPT_DIR"
echo "Port:      $PORT"
echo ""

# ---- Step 0: Open firewall port ----
echo "[0/8] Opening firewall port $PORT..."
if command -v firewall-cmd &>/dev/null; then
    sudo firewall-cmd --permanent --add-port=$PORT/tcp 2>/dev/null || true
    sudo firewall-cmd --reload 2>/dev/null || true
    echo "  Firewall updated (firewalld)."
elif command -v ufw &>/dev/null; then
    sudo ufw allow $PORT/tcp 2>/dev/null || true
    echo "  Firewall updated (ufw)."
elif command -v iptables &>/dev/null; then
    sudo iptables -A INPUT -p tcp --dport $PORT -j ACCEPT 2>/dev/null || true
    echo "  Firewall updated (iptables)."
else
    echo "  No firewall tool found. Make sure port $PORT is open manually."
fi

# ---- Step 1: Check Python ----
echo "[1/8] Checking Python installation..."
if command -v python3 &>/dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1)
    echo "  Found: $PYTHON_VERSION"
    # Check Python version (need 3.8+ for FastAPI)
    PY_MAJOR=$(python3 -c "import sys; print(sys.version_info.major)")
    PY_MINOR=$(python3 -c "import sys; print(sys.version_info.minor)")
    if [ "$PY_MAJOR" -lt 3 ] || ([ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 8 ]); then
        echo "  WARNING: Python 3.8+ required (found $PYTHON_VERSION)"
        echo "  Install Python 3.10+:"
        echo "    CentOS/RHEL: sudo yum install python3.10 python3.10-pip python3.10-devel"
        echo "    Ubuntu: sudo apt install python3.10 python3.10-pip python3.10-venv"
        exit 1
    fi
else
    echo "  ERROR: python3 not found. Install Python 3.10+ first."
    echo "  CentOS/RHEL: sudo yum install python3.10 python3.10-pip python3.10-devel"
    echo "  Ubuntu: sudo apt install python3 python3-pip python3-venv"
    exit 1
fi

# ---- Step 2: Create virtual environment ----
echo "[2/8] Creating Python virtual environment..."
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
    echo "  Created venv at $VENV_DIR"
else
    echo "  Venv already exists at $VENV_DIR"
fi

# ---- Step 3: Install dependencies ----
echo "[3/8] Installing Python dependencies..."
source "$VENV_DIR/bin/activate"
pip install --upgrade pip --quiet
pip install -r "$SCRIPT_DIR/requirements.txt" --quiet
echo "  Dependencies installed."

# ---- Step 4: Create .env if missing ----
echo "[4/8] Configuring environment..."
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo "  Created .env from .env.example"
    echo "  IMPORTANT: Edit $SCRIPT_DIR/.env and set your EGXPY_SYNC_SECRET!"
else
    echo "  .env already exists"
fi

# ---- Step 5: Initialize database ----
echo "[5/8] Initializing database..."
python3 "$SCRIPT_DIR/db_schema.py"
echo "  Database ready."

# ---- Step 6: Install systemd service ----
echo "[6/8] Installing systemd service..."
USER="$(whoami)"
SERVICE_CONTENT="[Unit]
Description=EGXPy Bridge API
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$VENV_DIR/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1 --log-level warning
Restart=always
RestartSec=5
Environment=PATH=$VENV_DIR/bin:/usr/bin:/bin
Environment=EGXPY_PORT=$PORT
StandardOutput=append:$SCRIPT_DIR/logs/service.log
StandardError=append:$SCRIPT_DIR/logs/service-error.log

[Install]
WantedBy=multi-user.target
"

# Create logs directory
mkdir -p "$SCRIPT_DIR/logs"

if [ -w "/etc/systemd/system" ]; then
    echo "$SERVICE_CONTENT" > "$SERVICE_FILE"
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    echo "  Service installed and enabled."
else
    echo "  Cannot write to /etc/systemd/system (need sudo)."
    echo "  Copy the service file manually:"
    echo "    sudo cp $SCRIPT_DIR/${SERVICE_NAME}.service /etc/systemd/system/"
    echo "    sudo systemctl daemon-reload"
    echo "    sudo systemctl enable $SERVICE_NAME"
    echo "$SERVICE_CONTENT" > "$SCRIPT_DIR/${SERVICE_NAME}.service"
    echo "  Service file saved to $SCRIPT_DIR/${SERVICE_NAME}.service"
fi

# ---- Step 7: Start service ----
echo "[7/8] Starting service..."
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl restart "$SERVICE_NAME"
    echo "  Service restarted."
else
    # Try starting with systemctl (may need sudo)
    if systemctl start "$SERVICE_NAME" 2>/dev/null; then
        echo "  Service started via systemd."
    else
        echo "  Cannot start via systemd (need sudo). Starting in background..."
        nohup "$VENV_DIR/bin/python3" -m uvicorn main:app --host 0.0.0.0 --port "$PORT" --log-level warning \
            > "$SCRIPT_DIR/logs/nohup.log" 2>&1 &
        echo "  Started in background (PID: $!). Use start.sh for management."
    fi
fi

echo ""
echo "=============================================="
echo " Deployment Complete!"
echo "=============================================="
echo ""
echo " Service URL:  http://0.0.0.0:$PORT"
echo " Health Check: http://0.0.0.0:$PORT/health"
echo " API Docs:    http://0.0.0.0:$PORT/docs"
echo " Data Stats:  http://0.0.0.0:$PORT/api/data/stats"
echo ""
echo " Commands:"
echo "  sudo systemctl start $SERVICE_NAME    # Start"
echo "  sudo systemctl stop $SERVICE_NAME     # Stop"
echo "  sudo systemctl restart $SERVICE_NAME  # Restart"
echo "  sudo systemctl status $SERVICE_NAME   # Status"
echo "  journalctl -u $SERVICE_NAME -f        # Live logs"
echo ""
echo " Test health:"
echo "  curl http://localhost:$PORT/health"
echo ""
echo " External access (from outside VPS):"
echo "  curl http://72.61.137.86:$PORT/health"
echo ""
