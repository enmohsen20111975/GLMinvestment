const http = require('http');

// P0-CRIT-2 FIX (2026-10-14): Removed hardcoded admin credentials.
// Credentials must be passed via environment variables (ADMIN_USERNAME / ADMIN_PASSWORD).
const adminUser = process.env.ADMIN_USERNAME || 'CHANGE_ME';
const adminPass = process.env.ADMIN_PASSWORD || 'CHANGE_ME';

if (adminUser === 'CHANGE_ME' || adminPass === 'CHANGE_ME') {
  console.error('ERROR: ADMIN_USERNAME / ADMIN_PASSWORD env vars not set. Refusing to run.');
  process.exit(1);
}

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/admin/stats',
  method: 'GET',
  headers: {
    'x-admin-token': Buffer.from(`${adminUser}:${adminPass}`).toString('base64')
  }
};

const req = http.request(options, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Response:', data));
});
req.end();
