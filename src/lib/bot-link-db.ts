/**
 * bot-link-db.ts — low-level SQLite access for the bot-link subsystem.
 *
 * BOT-SUBSCRIPTION-GATE (2026-10-01): the `bot_link_tokens` table lives in
 * the auth.db but is NOT modelled in Prisma (it is created on-demand by raw
 * SQL via this helper). It is a short-lived, throw-away token store used by
 * the Telegram bot to prove a chat_id is owned by a website user.
 *
 * The `user_telegram_links` table IS modelled in Prisma
 * (prisma/auth-schema.prisma → UserTelegramLink), but auth.db is never
 * migrated automatically in production (`npm run db:push` only targets
 * prisma/schema.prisma, and the deploy script runs no auth migration at all).
 * So both tables are created here, idempotently, on first use — that keeps the
 * bot gate working on a fresh production checkout instead of 500-ing on a
 * missing table.
 *
 * Schema (auth.db):
 *   CREATE TABLE IF NOT EXISTS user_telegram_links (
 *     id                 TEXT PRIMARY KEY,
 *     user_id            TEXT NOT NULL UNIQUE,
 *     telegram_chat_id   TEXT NOT NULL UNIQUE,
 *     telegram_username  TEXT,
 *     linked_at          TEXT NOT NULL,
 *     is_active          INTEGER NOT NULL DEFAULT 1
 *   );
 *   CREATE TABLE IF NOT EXISTS bot_link_tokens (
 *     token TEXT PRIMARY KEY,
 *     chat_id INTEGER NOT NULL,
 *     username TEXT,
 *     created_at TEXT DEFAULT (datetime('now')),
 *     expires_at TEXT,
 *     used INTEGER DEFAULT 0
 *   );
 *
 * `linked_at` / `expires_at` are stored as ISO-8601 UTC ("...Z") strings. Note
 * that the GC in purgeExpiredBotLinkTokens() must therefore compare against
 * strftime('%Y-%m-%dT%H:%M:%fZ','now') and NOT plain datetime('now'), which
 * would never sort correctly against ISO strings.
 *
 * No FOREIGN KEY on user_id is declared: SQLite only enforces FKs when
 * `PRAGMA foreign_keys=ON` (off by default here), and an unenforced ON DELETE
 * CASCADE would silently do nothing while pretending to guarantee cleanup.
 *
 * Security: all queries use parameterized SQL (Rule 56 — P0-WAVE-SQLI).
 */

import Database from 'better-sqlite3';
import path from 'path';
import { randomUUID } from 'crypto';

let _db: Database.Database | null = null;

let _schemaReady = false;

/**
 * Create/verify every table + index the bot-link subsystem needs.
 * Idempotent, and cheap: runs at most once per process.
 */
export function ensureBotLinkSchema(): void {
  if (_schemaReady) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_telegram_links (
      id                TEXT PRIMARY KEY NOT NULL,
      user_id           TEXT NOT NULL,
      telegram_chat_id  TEXT NOT NULL,
      telegram_username TEXT,
      linked_at         TEXT NOT NULL,
      is_active         INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS bot_link_tokens (
      token TEXT PRIMARY KEY NOT NULL,
      chat_id INTEGER NOT NULL,
      username TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_bot_link_tokens_chat_id ON bot_link_tokens(chat_id);
  `);

  // A table created by an earlier revision may predate the UNIQUE constraints
  // the upsert below relies on. Adding a unique index is idempotent; it only
  // fails if duplicate rows already exist, which must not break the request.
  for (const ddl of [
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_user_telegram_links_user_id ON user_telegram_links(user_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_user_telegram_links_chat_id ON user_telegram_links(telegram_chat_id)',
  ]) {
    try {
      db.exec(ddl);
    } catch {
      /* duplicates present — leave as-is, upsert handles it defensively */
    }
  }

  _schemaReady = true;
}

function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = path.join(process.cwd(), 'db', 'auth.db');
  _db = new Database(dbPath);
  return _db;
}

export interface BotLinkTokenRow {
  token: string;
  chat_id: number;
  username: string | null;
  created_at: string;
  expires_at: string;
  used: number;
}

/**
 * Insert a fresh link-token row.
 */
export function insertBotLinkToken(
  token: string,
  chat_id: number,
  username: string | null,
  expiresAtIso: string,
): void {
  ensureBotLinkSchema();
  getDb()
    .prepare(
      'INSERT INTO bot_link_tokens (token, chat_id, username, expires_at) VALUES (?, ?, ?, ?)',
    )
    .run(token, chat_id, username, expiresAtIso);
}

/**
 * Fetch a token row by token (regardless of used/expired state — caller decides).
 */
export function getBotLinkToken(token: string): BotLinkTokenRow | null {
  ensureBotLinkSchema();
  return (
    (getDb()
      .prepare(
        'SELECT token, chat_id, username, created_at, expires_at, used FROM bot_link_tokens WHERE token = ?',
      )
      .get(token) as BotLinkTokenRow | undefined) ?? null
  );
}

/**
 * Mark a token as used (1). Idempotent — re-marking a used token is a no-op.
 */
export function markBotLinkTokenUsed(token: string): void {
  ensureBotLinkSchema();
  getDb().prepare('UPDATE bot_link_tokens SET used = 1 WHERE token = ?').run(token);
}

/**
 * Best-effort GC: delete link tokens whose ISO-8601 expires_at is in the past.
 * Called opportunistically from the link-token route so the table doesn't grow
 * forever.
 *
 * expires_at is an ISO string like "2026-10-01T10:00:00.000Z", so the cutoff
 * must be produced in the SAME format. Comparing it against datetime('now')
 * ("2026-10-01 10:00:00") makes every row look like it expires in the future
 * (space < 'T'), which silently disabled this GC.
 */
export function purgeExpiredBotLinkTokens(): number {
  ensureBotLinkSchema();
  const info = getDb()
    .prepare(
      "DELETE FROM bot_link_tokens WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )
    .run();
  return info.changes;
}

// ─────────────────────────────────────────────────────────────────────────────
// user_telegram_links CRUD
// ─────────────────────────────────────────────────────────────────────────────

export interface TelegramLinkRow {
  id: string;
  user_id: string;
  telegram_chat_id: string;
  telegram_username: string | null;
  linked_at: string;
  is_active: number;
}

/**
 * Find the ACTIVE link for a Telegram chat_id, or null.
 */
export function getActiveTelegramLink(chatId: string): TelegramLinkRow | null {
  ensureBotLinkSchema();
  return (
    (getDb()
      .prepare(
        'SELECT id, user_id, telegram_chat_id, telegram_username, linked_at, is_active ' +
          'FROM user_telegram_links WHERE telegram_chat_id = ? AND is_active = 1',
      )
      .get(chatId) as TelegramLinkRow | undefined) ?? null
  );
}

/**
 * Link a website user to a Telegram chat, atomically.
 *
 * Semantics: one chat belongs to one user, and one user owns one chat
 * (last link wins). The two UNIQUE constraints make a plain UPSERT fragile —
 * deactivating a previous owner does NOT free the telegram_chat_id value, so the
 * write would abort with a constraint violation. So inside a single
 * transaction we: (1) free the chat_id from whoever else held it, (2) update
 * this user's existing row if there is one, else insert a fresh row.
 *
 * Implemented as explicit SELECT + INSERT/UPDATE rather than ON CONFLICT so it
 * stays correct even if a legacy table is missing one of the unique indexes.
 */
export function linkTelegramChat(opts: {
  userId: string;
  chatId: string;
  username: string | null;
}): TelegramLinkRow {
  ensureBotLinkSchema();
  const db = getDb();
  const { userId, chatId, username } = opts;
  const nowIso = new Date().toISOString();

  const selectByUser = db.prepare(
    'SELECT id, user_id, telegram_chat_id, telegram_username, linked_at, is_active ' +
      'FROM user_telegram_links WHERE user_id = ?',
  );

  const run = db.transaction((): TelegramLinkRow => {
    // 1. Free the chat_id from any other user that currently holds it.
    db.prepare('DELETE FROM user_telegram_links WHERE telegram_chat_id = ? AND user_id != ?').run(
      chatId,
      userId,
    );

    // 2. Update this user's row, or insert one.
    const existing = selectByUser.get(userId) as TelegramLinkRow | undefined;
    if (existing) {
      db.prepare(
        'UPDATE user_telegram_links SET telegram_chat_id = ?, telegram_username = ?, ' +
          'linked_at = ?, is_active = 1 WHERE user_id = ?',
      ).run(chatId, username, nowIso, userId);
    } else {
      db.prepare(
        'INSERT INTO user_telegram_links ' +
          '(id, user_id, telegram_chat_id, telegram_username, linked_at, is_active) ' +
          'VALUES (?, ?, ?, ?, ?, 1)',
      ).run(randomUUID(), userId, chatId, username, nowIso);
    }

    return selectByUser.get(userId) as TelegramLinkRow;
  });

  return run();
}
