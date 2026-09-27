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
 *  5. telegram-events (Bun/TypeScript | port 3003) — TELEGRAM LIVE EVENTS
 *     └── خدمة socket.io relay لأحداث تيليجرام اللحظية
 *     └── admin TelegramTab.tsx بيتصل بـ /?XTransformPort=3003
 *     └── المسار: ./telegram-events/
 *
 *  6. news-agent (Python) — NEWS INTELLIGENCE
 *     └── وكيل أخبار مالي محلي متخصص في بورصة مصر (EGX)
 *     └── يجمع الأخبار من Telegram + Web + RSS + Egyptian sources
 *     └── يحللها بنموذج Ollama محلي ويرسلها للسيرفر الإنتاجي
 *     └── POSTs analyzed news to /api/news/receive-from-news-agent
 *     └── المسار: ./news-agent/main.py
 *     └── P0 #7 fix (2026-09-27): agent was running standalone (run.sh),
 *         never started by PM2/cron → endpoint never received data.
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
        // Telegram credentials MUST come from environment / .env file.
        // NO hardcoded tokens/api_hashes in the repo — security rule.
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
        TELEGRAM_API_ID: process.env.TELEGRAM_API_ID || '',
        TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH || '',
        TELEGRAM_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID || ''
      },
      error_file: './logs/telegram-poster-error.log',
      out_file: './logs/telegram-poster-out.log',
      time: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000
    },

    // ==============================================
    // 6. telegram-events (Bun/TypeScript) - Port 3003
    //    Socket.io relay service for live Telegram events.
    //    Polled by admin TelegramTab.tsx via /?XTransformPort=3003
    //    P0 #4 fix (2026-09-27): service was missing from PM2 → admin tab was failing silently
    // ==============================================
    {
      name: 'telegram-events',
      script: 'index.ts',
      interpreter: getBunInterpreter(),
      exec_mode: 'fork',
      cwd: './telegram-events',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '150M',
      env: {
        NODE_ENV: 'production',
        PORT: '3003',
        PYTHON_BACKEND_URL: 'http://127.0.0.1:8010'
      },
      error_file: './logs/telegram-events-error.log',
      out_file: './logs/telegram-events-out.log',
      time: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000
    },

    // ==============================================
    // 7. news-agent (Python) — NEWS INTELLIGENCE
    //    Standalone news scraping/analysis agent for EGX.
    //    Collects from Telegram + Web + RSS + Egyptian sources,
    //    analyzes via local Ollama, POSTs results to
    //    /api/news/receive-from-news-agent on the Next.js backend.
    //    P0 #7 fix (2026-09-27): agent was only runnable via run.sh
    //    (standalone, manual) — never started by PM2 nor cron, so
    //    /api/news/receive-from-news-agent never received any data.
    //    Now wired into PM2 so it auto-starts on boot and auto-restarts
    //    on crash. Uses news-agent/.venv if present (created by run.sh),
    //    otherwise falls back to system python3.
    // ==============================================
    {
      name: 'news-agent',
      script: 'main.py',
      // Prefer news-agent's own .venv (created by run.sh via `python3 -m venv .venv`),
      // fall back to project-root .venv (used by python-backend + data-engine),
      // finally fall back to system python3.
      interpreter: (() => {
        const newsVenv = path.resolve(__dirname, 'news-agent', '.venv', 'bin', 'python');
        if (fs.existsSync(newsVenv)) return newsVenv;
        const rootVenv = path.resolve(__dirname, '.venv', 'bin', 'python');
        if (fs.existsSync(rootVenv)) return rootVenv;
        return 'python3';
      })(),
      cwd: path.resolve(__dirname, 'news-agent'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        // Agent reads these from .env via python-dotenv (load_dotenv() in main.py).
        // We pass them through explicitly so PM2 starts work even before .env is edited.
        PRODUCTION_SERVER_URL: process.env.PRODUCTION_SERVER_URL || 'http://127.0.0.1:3000',
        OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b',
        COLLECTION_INTERVAL_MINUTES: process.env.COLLECTION_INTERVAL_MINUTES || '15',
        MIN_IMPORTANCE_SCORE: process.env.MIN_IMPORTANCE_SCORE || '55',
        MAX_NEWS_PER_BATCH: process.env.MAX_NEWS_PER_BATCH || '20',
        ENABLE_EGYPTIAN_SOURCES: process.env.ENABLE_EGYPTIAN_SOURCES || '0',
        // Forward Telegram credentials (used by TelegramCollector when present).
        TELEGRAM_API_ID: process.env.TELEGRAM_API_ID || '',
        TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH || '',
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
        TELEGRAM_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID || ''
      },
      error_file: './logs/news-agent-error.log',
      out_file: './logs/news-agent-out.log',
      time: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000
    }
  ]
};
