/**
 * Regression check for the BOT-SUBSCRIPTION-GATE HTTP routes.
 * Run: npx tsx scripts/verify-bot-routes.ts
 *
 * Calls the real route handlers (no dev server needed) with real NextRequests,
 * against the real db/auth.db. Every row it creates is deleted again.
 */
process.env.BOT_API_SECRET = process.env.BOT_API_SECRET || 'test-secret-abc123';
process.env.NEXT_PUBLIC_SITE_URL = 'https://invist.m2y.net';

import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { linkTelegramChat, getBotLinkToken } from '../src/lib/bot-link-db';

const SECRET = process.env.BOT_API_SECRET as string;
const CHAT = '777000999';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}`, extra !== undefined ? extra : '');
  }
}

async function main() {
  const { GET: checkSub } = await import('../src/app/api/bot/check-subscription/route');
  const { POST: linkToken } = await import('../src/app/api/bot/link-token/route');

  function req(url: string, secret?: string) {
    const headers: Record<string, string> = {};
    if (secret !== undefined) headers['x-bot-secret'] = secret;
    return new NextRequest(new Request(`http://localhost${url}`, { headers }));
  }

  console.log('1) /api/bot/check-subscription — auth');
  {
    const r = await checkSub(req(`/api/bot/check-subscription?chat_id=${CHAT}`));
    check('no secret -> 401', r.status === 401, r.status);
    check(
      'no secret -> unauthorized body',
      (await r.json()).error === 'unauthorized',
    );
  }
  {
    const r = await checkSub(req(`/api/bot/check-subscription?chat_id=${CHAT}`, 'wrong-secret'));
    check('wrong secret -> 401', r.status === 401, r.status);
  }

  console.log('2) /api/bot/check-subscription — validation');
  {
    const r = await checkSub(req('/api/bot/check-subscription?chat_id=abc', SECRET));
    check('non-numeric chat_id -> 400', r.status === 400, r.status);
  }
  {
    const r = await checkSub(req('/api/bot/check-subscription?chat_id=-5', SECRET));
    check('negative chat_id -> 400', r.status === 400, r.status);
  }

  console.log('3) /api/bot/check-subscription — unlinked chat');
  {
    const r = await checkSub(req(`/api/bot/check-subscription?chat_id=${CHAT}`, SECRET));
    const body = await r.json();
    check('200', r.status === 200, r.status);
    check('linked=false', body.linked === false, body);
    check('no PII leaked', !('user_id' in body) && !('display_name' in body), body);
  }

  console.log('4) /api/bot/link-token — mints a usable token');
  let mintedToken = '';
  {
    const r = await linkToken(
      new NextRequest(
        new Request('http://localhost/api/bot/link-token', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-bot-secret': SECRET },
          body: JSON.stringify({ chat_id: 555000111, username: 'ahmed' }),
        }),
      ),
    );
    const body = await r.json();
    mintedToken = body.token || '';
    check('200', r.status === 200, r.status);
    check('token present', typeof mintedToken === 'string' && mintedToken.length > 10, body);
    check(
      'link_url carries the token',
      body.link_url === `https://invist.m2y.net/?bot_link=${mintedToken}`,
      body.link_url,
    );
    check('ttl is 10 minutes', body.ttl_minutes === 10, body);
    check('token row exists in db', getBotLinkToken(mintedToken)?.chat_id === 555000111);
  }
  {
    const r = await linkToken(
      new NextRequest(
        new Request('http://localhost/api/bot/link-token', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-bot-secret': SECRET },
          body: JSON.stringify({ chat_id: -1 }),
        }),
      ),
    );
    check('negative chat_id -> 400', r.status === 400, r.status);
  }
  {
    const r = await linkToken(
      new NextRequest(
        new Request('http://localhost/api/bot/link-token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: 5 }),
        }),
      ),
    );
    check('no secret -> 401', r.status === 401, r.status);
  }

  console.log('5) linked + free user is reported as linked but NOT allowed');
  const db = new Database(path.join(process.cwd(), 'db', 'auth.db'));
  const freeUser = db
    .prepare(
      "SELECT id FROM User WHERE is_active = 1 AND (subscription_tier IS NULL OR LOWER(subscription_tier) = 'free') LIMIT 1",
    )
    .get() as { id: string } | undefined;
  if (freeUser) {
    linkTelegramChat({ userId: freeUser.id, chatId: CHAT, username: 'tester' });
    const r = await checkSub(req(`/api/bot/check-subscription?chat_id=${CHAT}`, SECRET));
    const body = await r.json();
    check('linked=true', body.linked === true, body);
    check('is_paid=false for a free user', body.is_paid === false, body);
    check('tier reported', typeof body.subscription_tier === 'string', body);
    check('is_trial_active is a boolean', typeof body.is_trial_active === 'boolean', body);
    db.prepare('DELETE FROM user_telegram_links WHERE user_id = ?').run(freeUser.id);
  } else {
    console.log('  SKIP  no free-tier user available in this auth.db');
  }

  console.log('6) cleanup');
  {
    db.prepare('DELETE FROM user_telegram_links WHERE telegram_chat_id = ?').run(CHAT);
    db.prepare('DELETE FROM bot_link_tokens WHERE token = ?').run(mintedToken);
    const left = db.prepare('SELECT COUNT(*) AS c FROM user_telegram_links').get() as { c: number };
    check('no test rows left behind', left.c === 0, left);
  }
  db.close();

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('harness error:', e);
  process.exit(1);
});
