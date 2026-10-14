// ============================================================================
// P2-9 FIX (2026-10-14): PM2 production hardening.
// Before deploying, install pm2-logrotate:
//   pm2 install pm2-logrotate
//   pm2 set pm2-logrotate:max_size 10M
//   pm2 set pm2-logrotate:retain 7
//   pm2 set pm2-logrotate:compress true
//
// Healthcheck URLs: add `healthcheck_url` to each app for PM2 auto-recovery.
// Example: healthcheck_url: 'http://localhost:3000/api/health'
// ============================================================================

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

// Automatically load .env if present into process.env so PM2 services receive all secrets
const envFile = path.resolve(__dirname, '.env');
if (fs.existsSync(envFile)) {
  try {
    const raw = fs.readFileSync(envFile, 'utf8');
    raw.split('\n').forEach(line => {
      line = line.trim();
      if (line && !line.startsWith('#') && line.includes('=')) {
        const idx = line.indexOf('=');
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (k && !process.env[k]) {
          process.env[k] = v;
        }
      }
    });
  } catch (err) {
    console.error('Failed to parse .env in ecosystem:', err.message);
  }
}

// Dynamic Portable Bun Resolver (works in Production VPS, Laptop, and Cloud Sandbox)
function getBunInterpreter() {
  if (process.env.BUN_PATH) return process.env.BUN_PATH;
  const homeBun = path.join(os.homedir(), '.bun', 'bin', 'bun');
  if (fs.existsSync(homeBun)) return homeBun;
  return 'bun';
}

// Dynamic Portable Node Resolver
// FIX (Sept 2026): better-sqlite3@13.0.3 ships prebuilds that SEGFAULT (SIGSEGV)
// inside `new Database()` when loaded by Node 18/20 — the whole Next.js server died
// with ERR_CONNECTION_RESET/REFUSED on every API call. Node 22 is required.
// Override with NODE_BIN=/path/to/node if a different runtime is desired.
function getNodeInterpreter() {
  if (process.env.NODE_BIN) return process.env.NODE_BIN;

  const home = os.homedir();
  const candidates = [];
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmDir)) {
    for (const v of fs.readdirSync(nvmDir).sort().reverse()) {
      const bin = path.join(nvmDir, v, 'bin', 'node');
      if (fs.existsSync(bin)) {
        const major = parseInt(v.replace(/^v/, '').split('.')[0], 10);
        if (!Number.isNaN(major) && major >= 22) candidates.push(bin);
      }
    }
  }
  if (candidates.length > 0) return candidates[0];

  // Fallback: system node — verify it is new enough before using it.
  for (const bin of ['/usr/local/bin/node', '/usr/bin/node']) {
    if (fs.existsSync(bin)) {
      try {
        const major = parseInt(
          require('child_process').execSync(`${bin} -p "process.versions.node.split('.')[0]"`).toString().trim(),
          10
        );
        if (!Number.isNaN(major) && major >= 22) return bin;
      } catch { /* ignore and keep looking */ }
    }
  }

  return 'node';
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
        // Task SECURITY-P0: removed hardcoded EODHD_API_KEY fallback (was '6990ef9ee966c5.41761316' — Rule 5 violation).
        // If env var missing → empty string → eodhd_fetcher will skip (subscription cancelled anyway).
        EODHD_API_KEY: process.env.EODHD_API_KEY || ''
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
      interpreter: getNodeInterpreter(),
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
      // FIX (Task 14-B-FIX): system `python3` lacks telethon (and the rest of
      // the venv deps) → TelegramAutoPoster.connect() silently returns
      // {"success":False,"error":"Telethon not installed"} → daily picks /
      // morning bell / weekly / monthly summaries NEVER post to the channel.
      // Use the SAME .venv resolver pattern as `telegram-interactive-bot`
      // below. The .env loader above already populated process.env.
      interpreter: (() => {
        const rootVenv = path.resolve(__dirname, '.venv', 'bin', 'python');
        if (fs.existsSync(rootVenv)) return rootVenv;
        return 'python3';
      })(),
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
    // 5b. telegram-interactive-bot (Python)
    //    Interactive AI Stock Analysis Bot (@investusernamebot).
    //    Answers trader queries, stock picker, charts, maker radar,
    //    and marketing interactive keyboards.
    // ==============================================
    {
      name: 'telegram-interactive-bot',
      script: 'telegram/telegram_interactive_bot.py',
      interpreter: (() => {
        const rootVenv = path.resolve(__dirname, '.venv', 'bin', 'python');
        if (fs.existsSync(rootVenv)) return rootVenv;
        return 'python3';
      })(),
      cwd: path.resolve(__dirname, 'vps-service'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
        // Task SECURITY-P0: removed hardcoded channel fallback (was '@Arabian_investment_guide' — exposed production channel).
        TELEGRAM_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID || '',
        BOT_API_SECRET: process.env.BOT_API_SECRET || '',
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://invist.m2y.net',
      },
      error_file: './logs/telegram-interactive-bot-error.log',
      out_file: './logs/telegram-interactive-bot-out.log',
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
        TELEGRAM_WEB_ENABLED: process.env.TELEGRAM_WEB_ENABLED || '0',
        TELEGRAM_COLLECTOR_ENABLED: process.env.TELEGRAM_COLLECTOR_ENABLED || '0',
        TG_MIN_IMPORTANCE: process.env.TG_MIN_IMPORTANCE || '85',
        TG_MAX_PER_BATCH: process.env.TG_MAX_PER_BATCH || '1',
        TG_REQUIRE_TICKERS: process.env.TG_REQUIRE_TICKERS || '1',
        TG_MAX_PER_DAY: process.env.TG_MAX_PER_DAY || '3',
        TG_COOLDOWN_MINUTES: process.env.TG_COOLDOWN_MINUTES || '60',
        // Forward Telegram credentials
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
