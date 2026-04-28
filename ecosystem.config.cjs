module.exports = {
  apps: [{
    name: 'egx-platform',
    script: '.next/standalone/server.js',
    cwd: '/home/z/my-project',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      // Thread-limiting for Hostinger shared hosting (prevents uv_thread_create crash)
      // UV_THREADPOOL_SIZE: 1 = minimum possible, prevents thread creation errors
      UV_THREADPOOL_SIZE: '1',
      // Memory limit: 256MB max for weak servers
      NODE_OPTIONS: '--max-old-space-size=256 --no-warnings',
      // EGXPy Bridge — Python FastAPI service for live TradingView data
      // Set to the URL where egxpy-bridge is running (default port: 8010)
      EGXPY_SERVICE_URL: process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010',
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    // Prevent infinite restart loops
    max_restarts: 5,
    // Keep server alive with longer uptime requirement
    min_uptime: '30s',
    restart_delay: 10000,
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
  }]
};
