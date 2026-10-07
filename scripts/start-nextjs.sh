#!/bin/bash
# Start Next.js Frontend for EGX Investment Platform
# This script is called by PM2 to run the Next.js frontend

cd "$(dirname "$0")/.."
export PORT=3000
export EGXPY_SERVICE_URL=http://localhost:8010
export NODE_ENV=production

# Run Next.js in production mode
exec bun run start
