#!/bin/bash
# Start Python Backend for EGX Investment Platform
# This script is called by PM2 to run the Python backend

cd "$(dirname "$0")/vps-service"
export PORT=8010
export PYTHONUNBUFFERED=1

# Run the Python backend
exec python3 main.py
