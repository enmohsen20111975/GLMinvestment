/**
 * PM2 Ecosystem Configuration
 * ===========================
 *
 * ✅ المعمارية الرباعية المعتمدة:
 * ==========================================
 *
 *  1. VPS-Service  (Python | port 8010) — THE BRAIN
 *     └── كل المنطق والحسابات والـ analysis
 *     └── توليد التوقعات، التحليل الفني، Confluence Engine
 *     └── glminvestment_engines package (Stage2/VCP/Donchian/ATR/Confluence)
 *     └── المسار: ./vps-service/main.py
 *
 *  2. Data-Engine  (Python | port 5000)
 *     └── جلب البيانات من كل المصادر
 *     └── TradingView, Yahoo Finance, Crypto, News, Metals
 *     └── تحضير البيانات وتخزينها في قواعد البيانات
 *     └── المسار: ./data_engine/main.py
 *
 *  3. Next.js      (Node.js | port 3000) — DISPLAY ONLY
 *     └── عرض البيانات فقط
 *     └── لا منطق ولا حسابات هنا أبداً
 *     └── المسار: ./
 *
 *  4. ws-service   (Bun/TypeScript | port 3005) — REAL-TIME PUSH
 *     └── خدمة socket.io للتحديثات اللحظية
 *     └── polling للـ Python backend كل 30s + push للواجهة
 *     └── المسار: ./vps-service/ws-service/ (moved from mini-services/)
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 status
 *   pm2 restart all
 *   pm2 logs
 */


// ==============================================
// 0. Ollama (Local AI / RAG) — managed by systemd, NOT PM2
// ==============================================
// Ollama ships with its own systemd unit and listens on port 11434.
// The Python backend (glm_finance_agent.py) talks to it at
// http://127.0.0.1:11434 and expects two models:
//   - qwen2.5:1.5b  (base model)
//   - glm-fast      (custom model built from models/Modelfile.qwen)
//
// ONE-TIME SETUP (idempotent — safe to re-run):
//   bash vps-service/scripts/setup_ollama.sh
//   # This will: install Ollama if missing, start it, pull qwen2.5:1.5b,
//   #            build glm-fast, and run a smoke test.
//
// Start on boot:
//   sudo systemctl enable ollama
//
// If Ollama is down, the Python AI layer falls back gracefully to
// internal narration (smart fallback) — see ai/glm_finance_agent.py.
const fs = require('fs');
const path = require('path');
const os = require('os');

// Dynamic Portable Bun Resolver (works in Production VPS, Laptop, and Cloud Sandbox)
function getBunInterpreter() {
  if (process.env.BUN_PATH) return process.env.BUN_PATH;
  const homeBun = path.join(os.homedir(), '.bun', 'bin', 'bun');
  if (fs.existsSync(homeBun)) return homeBun;
  return 'bun';
}

module.exports = {
  apps: [
    // ==============================================
    // 1. Python Backend - Port 8010 (THE BRAIN)
    // ==============================================
    // IMPORTANT: uses the service's own venv (./venv) which has telethon,
    // flask, etc. installed. Using the system `python3` previously left
    // telethon missing, which silently disabled Telegram auto-posting.
    {
      name: 'python-backend',
      script: 'main.py',
      interpreter: path.resolve(__dirname, '.venv', 'bin', 'python'),
      cwd: path.resolve(__dirname, 'vps-service'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 8010,
        // FIX (July 2026): Telegram credentials moved to .env — were hardcoded in repo!
        // The Python backend reads these from os.environ in telegram/telegram_client.py
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
        TELEGRAM_API_ID: process.env.TELEGRAM_API_ID || '',
        TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH || '',
        TELEGRAM_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID || '',
        // EODHD API - primary data source for historical + daily EOD data
        EODHD_API_KEY: process.env.EODHD_API_KEY || '6990ef9ee966c5.41761316'
      },
      error_file: './logs/python-backend-error.log',
      out_file: './logs/python-backend-out.log',
      time: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000
    },

    // ==============================================
    // 2. Data Engine (Python) - Port 5000
    // ==============================================
    {
      name: 'data-engine',
      script: path.resolve(__dirname, '.venv', 'bin', 'python'),
      args: 'main.py',
      cwd: path.resolve(__dirname, 'data_engine'),
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      error_file: './logs/data-engine-error.log',
      out_file: './logs/data-engine-out.log',
      time: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000
    },

    // ==============================================
    // 3. Next.js Frontend - Port 3000 (DISPLAY ONLY)
    // ==============================================
    {
      name: 'nextjs',
      script: './node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      cwd: path.resolve(__dirname),
      interpreter: 'node',
      node_args: '--max-old-space-size=2048 --no-warnings',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        UV_THREADPOOL_SIZE: 2,
        SWC_THREADPOOL: 1,
        RAYON_NUM_THREADS: 1
      },
      error_file: './logs/nextjs-error.log',
      out_file: './logs/nextjs-out.log',
      time: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 15000
    },

    // ==============================================
    // 4. ws-service (Bun/TypeScript) - Port 3005
    //    Real-time WebSocket updates (socket.io).
    //    Moved from mini-services/ into vps-service/ws-service/.
    //    Polls the Python backend (8010) every 30s and pushes
    //    market:snapshot / market:status / ticker:update / stock:alert
    //    to connected frontends.
    // ==============================================
    {
      name: 'ws-service',
      script: 'index.ts',
      interpreter: getBunInterpreter(),
      exec_mode: 'fork',
      cwd: './vps-service/ws-service',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        VPS_API_URL: 'http://localhost:8010'
      },
      error_file: './logs/ws-service-error.log',
      out_file: './logs/ws-service-out.log',
      time: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000
    },

    // ==============================================
    // 5. telegram-poster (Python)
    //    Continuous Telegram auto-posting scheduler.
    // ==============================================
    {
      name: 'telegram-poster',
      script: 'telegram/auto_post_scheduler.py',
      interpreter: 'python3',
      cwd: path.resolve(__dirname, 'vps-service'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8150921223:AAFteLXeaH_lutZC62auVorlaey9BfNJVP0',
        TELEGRAM_API_ID: process.env.TELEGRAM_API_ID || '34557076',
        TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH || 'fe604a9844bf753210acb4e648af4155',
        TELEGRAM_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID || '@Arabian_investment_guide'
      },
      error_file: './logs/telegram-poster-error.log',
      out_file: './logs/telegram-poster-out.log',
      time: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000
    }
  ]
};
