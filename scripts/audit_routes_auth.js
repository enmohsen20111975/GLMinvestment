// F1.1 — Audit Routes Auth
// Classify all 464 API routes in src/app/api/**/route.ts
// Output: docs/route-auth-audit.csv + console summary.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'src', 'app', 'api');
const OUT_CSV = path.join(ROOT, 'docs', 'route-auth-audit.csv');

const USER_KEYWORDS = [
  'portfolio', 'alert', 'watchlist', 'notification', 'setting',
  'subscription', 'payment', 'paymob', 'ai-tools', 'robo-advisor',
  'learning', 'journal', 'user', 'personal', 'mobile', 'telegram',
  'auth', 'session', 'profile', 'account', 'tithes', 'zakat',
];

const PUBLIC_KEYWORDS = [
  'market', 'news', 'stocks', 'stock', 'sectors', 'morning-bell',
  'cron', 'health', 'manifest', 'top-movers', 'predictions',
  'market-pulse', 'index', 'indices', 'regime', 'scanner',
  'screener', 'radar', 'stored-analysis', 'v2', 'v82', 'v38',
  'chart', 'flow', 'liquidity', 'confluence', 'seasonality',
  'honest-tracking', 'snapshot', 'engines', 'candle', 'gap',
];

const ADMIN_KEYWORDS = ['admin', 'db-manager', 'promo', 'engine-settings'];

function listRoutes(dir, found) {
  found = found || [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      listRoutes(full, found);
    } else if (e.name === 'route.ts' || e.name === 'route.tsx') {
      found.push(full);
    }
  }
  return found;
}

function readMethods(file) {
  const src = fs.readFileSync(file, 'utf-8');
  const methods = [];
  if (/export\s+async\s+function\s+GET/.test(src)) methods.push('GET');
  if (/export\s+async\s+function\s+POST/.test(src)) methods.push('POST');
  if (/export\s+async\s+function\s+PUT/.test(src)) methods.push('PUT');
  if (/export\s+async\s+function\s+DELETE/.test(src)) methods.push('DELETE');
  if (/export\s+async\s+function\s+PATCH/.test(src)) methods.push('PATCH');
  return methods;
}

function classify(file) {
  const src = fs.readFileSync(file, 'utf-8');
  const rel = path.relative(path.join(ROOT, 'src', 'app', 'api'), file).replace(/\/route\.tsx?$/, '');
  const lower = rel.toLowerCase();

  const hasServerSession = /getServerSession/.test(src);
  const hasGetSessionUserId = /getSessionUserId|requireAuth|getAuthSession/.test(src);
  const hasRequireAdmin = /requireAdmin|requireAdminAsync|isServerAdmin/.test(src);
  const usesUserId = /user_id|userId|user\.id/.test(src);

  let category = 'mixed';
  if (ADMIN_KEYWORDS.some((k) => lower.includes(k))) category = 'admin';
  else if (USER_KEYWORDS.some((k) => lower.includes(k))) category = 'user';
  else if (PUBLIC_KEYWORDS.some((k) => lower.includes(k))) category = 'public';

  if (usesUserId && !hasServerSession && !hasGetSessionUserId && !hasRequireAdmin && category !== 'admin') {
    category = 'user (NEEDS AUTH)';
  }

  const authFns = [];
  if (hasRequireAdmin) authFns.push('requireAdmin');
  if (hasServerSession) authFns.push('getServerSession');
  if (hasGetSessionUserId) authFns.push('getSessionUserId');

  return { route: rel, category, authFunctions: authFns.join('|') || 'none', usesUserId };
}

function main() {
  const routes = listRoutes(API_DIR);
  console.log('Found ' + routes.length + ' routes in src/app/api');

  const rows = routes.map((file) => {
    const r = classify(file);
    const methods = readMethods(file).join('|');
    return { route: r.route, methods, category: r.category, auth: r.authFunctions, usesUserId: r.usesUserId ? 'yes' : 'no' };
  });

  const byCat = {};
  for (const r of rows) byCat[r.category] = (byCat[r.category] || 0) + 1;
  console.log('\n=== Summary ===');
  const cats = Object.keys(byCat).sort();
  for (const c of cats) console.log('  ' + c.padEnd(22) + byCat[c]);

  fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });
  const lines = ['route,methods,category,auth_functions,uses_user_id'];
  for (const r of rows) {
    const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    lines.push([esc(r.route), esc(r.methods), esc(r.category), esc(r.auth), esc(r.usesUserId)].join(','));
  }
  fs.writeFileSync(OUT_CSV, lines.join('\n') + '\n');
  console.log('\nCSV: ' + path.relative(ROOT, OUT_CSV) + ' (' + rows.length + ' rows)');

  const vulnerable = rows.filter((r) => r.category === 'user (NEEDS AUTH)');
  console.log('\n=== Vulnerable (user routes WITHOUT auth): ' + vulnerable.length + ' ===');
  for (const r of vulnerable.slice(0, 30)) console.log('  ' + r.route + ' [' + r.methods + ']');
  if (vulnerable.length > 30) console.log('  ... +' + (vulnerable.length - 30) + ' more (see CSV)');
}

main();
