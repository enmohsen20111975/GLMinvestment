#!/bin/bash
# Low-Memory Startup Script for GLMinvestment
# Optimized for weak/shared hosting servers (like Hostinger)

set -e

# Minimum thread pool to prevent uv_thread_create crash
export UV_THREADPOOL_SIZE=1

# Strict memory limit (256MB max)
export NODE_OPTIONS='--max-old-space-size=256 --no-warnings'

# Production mode
export NODE_ENV=production

# Ensure databases exist before starting
node scripts/ensure-databases.js

# Start the server
exec node .next/standalone/server.js
