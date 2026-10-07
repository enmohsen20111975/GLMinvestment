import Database from 'better-sqlite3';
import path from 'path';

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = path.join(process.cwd(), 'db', 'community.db');
  _db = new Database(dbPath);

  // FIX July 2026: Enable WAL mode + busy_timeout to prevent 'database is locked'
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 30000');
  _db.pragma('foreign_keys = ON');

  // Create tables if not exist
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      avatar TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      likes INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS post_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  return _db;
}

/**
 * Lazy database proxy.
 *
 * Defers `new Database()` — and therefore the native `better-sqlite3`
 * binding load — to the first actual query at request time. This prevents
 * `next build`'s "Collecting page data" phase from triggering the native
 * module load, which would crash the build if the binding hasn't been
 * compiled yet (e.g. right after `git pull` on a fresh machine, before
 * `npm rebuild better-sqlite3` has run).
 *
 * All `db.prepare(...)`, `db.exec(...)`, `db.pragma(...)` etc. calls in
 * route files continue to work unchanged.
 */
export const db = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const realDb = getDb();
    const value = Reflect.get(realDb, prop as keyof Database.Database);
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(realDb)
      : value;
  },
});
