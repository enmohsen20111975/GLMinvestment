/**
 * Regression check for the BOT-SUBSCRIPTION-GATE DB layer.
 * Run: npx tsx scripts/verify-bot-link-db.ts
 *
 * Exercises the real src/lib/bot-link-db.ts against the real db/auth.db. Every
 * row it creates is deleted again; the two tables themselves are left in place,
 * which is the point — they are created on demand.
 */
import { randomUUID } from 'crypto';
import {
  ensureBotLinkSchema,
  getActiveTelegramLink,
  getBotLinkToken,
  insertBotLinkToken,
  linkTelegramChat,
  markBotLinkTokenUsed,
  purgeExpiredBotLinkTokens,
} from '../src/lib/bot-link-db';

const CHAT_A = '999000111';
const CHAT_B = '999000222';
const USER_1 = randomUUID();
const USER_2 = randomUUID();

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}`, extra !== undefined ? extra : '');
  }
}

console.log('1) ensureBotLinkSchema() creates both tables');
ensureBotLinkSchema();
{
  const Database = require('better-sqlite3');
  const path = require('path');
  const db = new Database(path.join(process.cwd(), 'db', 'auth.db'));
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r: any) => r.name);
  check('user_telegram_links exists', tables.includes('user_telegram_links'), tables);
  check('bot_link_tokens exists', tables.includes('bot_link_tokens'), tables);
  const idx = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='user_telegram_links'")
    .all()
    .map((r: any) => r.name);
  check('unique index on user_id', idx.includes('uq_user_telegram_links_user_id'), idx);
  check('unique index on telegram_chat_id', idx.includes('uq_user_telegram_links_chat_id'), idx);
  db.close();
}

console.log('2) link a chat to a user');
const r1 = linkTelegramChat({ userId: USER_1, chatId: CHAT_A, username: 'ahmed' });
check('row created for USER_1/CHAT_A', r1.user_id === USER_1 && r1.telegram_chat_id === CHAT_A, r1);
check('is_active = 1', r1.is_active === 1, r1.is_active);
check('username stored', r1.telegram_username === 'ahmed', r1.telegram_username);
check(
  'getActiveTelegramLink(CHAT_A) resolves',
  getActiveTelegramLink(CHAT_A)?.user_id === USER_1,
  getActiveTelegramLink(CHAT_A),
);
check('getActiveTelegramLink(unknown) = null', getActiveTelegramLink('123') === null);

console.log('3) re-link the SAME chat to a DIFFERENT user (the old UNIQUE-constraint bug)');
const r2 = linkTelegramChat({ userId: USER_2, chatId: CHAT_A, username: 'mona' });
check('new owner wins', r2.user_id === USER_2, r2);
check('old user row removed', getActiveTelegramLink(CHAT_A)?.user_id === USER_2);
{
  const Database = require('better-sqlite3');
  const path = require('path');
  const db = new Database(path.join(process.cwd(), 'db', 'auth.db'));
  const n = db
    .prepare('SELECT COUNT(*) AS c FROM user_telegram_links WHERE telegram_chat_id = ?')
    .get(CHAT_A) as { c: number };
  check('exactly one row for that chat_id', n.c === 1, n);
  db.close();
}

console.log('4) same user re-links to a different chat (no UNIQUE violation)');
const r3 = linkTelegramChat({ userId: USER_2, chatId: CHAT_B, username: 'mona' });
check('user row now points at CHAT_B', r3.telegram_chat_id === CHAT_B, r3);
check('CHAT_A is now unlinked', getActiveTelegramLink(CHAT_A) === null, getActiveTelegramLink(CHAT_A));
check('CHAT_B resolves to USER_2', getActiveTelegramLink(CHAT_B)?.user_id === USER_2);

console.log('5) token store + single-use + GC');
const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 60 * 1000).toISOString();
const liveToken = randomUUID();
const deadToken = randomUUID();
insertBotLinkToken(liveToken, 4242, 'ahmed', future);
insertBotLinkToken(deadToken, 4243, 'ahmed', past);
check('fresh token readable', getBotLinkToken(liveToken)?.chat_id === 4242);
check('used flag starts at 0', getBotLinkToken(liveToken)?.used === 0);
markBotLinkTokenUsed(liveToken);
check('used flag flips to 1', getBotLinkToken(liveToken)?.used === 1);
check('unknown token = null', getBotLinkToken(randomUUID()) === null);
const purged = purgeExpiredBotLinkTokens();
check('expired token was purged', getBotLinkToken(deadToken) === null, { purged });
check('live token survived the GC', getBotLinkToken(liveToken) !== null);

console.log('6) cleanup');
{
  const Database = require('better-sqlite3');
  const path = require('path');
  const db = new Database(path.join(process.cwd(), 'db', 'auth.db'));
  const del = db.transaction(() => {
    db.prepare('DELETE FROM user_telegram_links WHERE user_id IN (?, ?)').run(USER_1, USER_2);
    db.prepare('DELETE FROM bot_link_tokens WHERE token IN (?, ?)').run(liveToken, deadToken);
  });
  del();
  const left = db.prepare('SELECT COUNT(*) AS c FROM user_telegram_links').get() as { c: number };
  check('no test rows left behind', left.c === 0, left);
  db.close();
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
