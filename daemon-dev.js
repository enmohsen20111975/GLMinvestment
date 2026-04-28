const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const mode = process.argv[2] || 'production';
const logFile = fs.openSync(path.join(__dirname, 'dev.log'), 'a');

let cmd, args;
if (mode === 'dev') {
  cmd = 'bun';
  args = ['run', 'dev'];
} else {
  cmd = 'node';
  args = ['.next/standalone/server.js'];
}

// Ensure DB exists in standalone path
const standaloneDb = path.join(__dirname, '.next', 'standalone', 'db', 'egx_investment.db');
const mainDb = path.join(__dirname, 'db', 'egx_investment.db');
if (fs.existsSync(mainDb)) {
  const dir = path.dirname(standaloneDb);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(mainDb, standaloneDb);
}

const child = spawn(cmd, args, {
  detached: true,
  stdio: ['ignore', logFile, logFile],
  cwd: __dirname,
  env: {
    ...process.env,
    NODE_OPTIONS: '--max-old-space-size=256',
    UV_THREADPOOL_SIZE: '2',
    NEXT_TELEMETRY_DISABLED: '1',
    PORT: '3000',
    HOSTNAME: '0.0.0.0',
  },
});

child.unref();
console.log(`Started Next.js ${mode} server with PID: ${child.pid}`);
