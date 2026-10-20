/**
 * trial-abuse-guard.ts
 * ----------------------------------------------------
 * حماية الفترة التجريبية (Anti-Trial-Abuse System)
 * يتتبع الـ IP وبصمة المتصفح لمنع تكرار الحصول على 7 أيام مجانية
 * عبر إنشاء إيميلات وهمية متتالية من نفس الجهاز أو الشبكة.
 */

import Database from 'better-sqlite3';
import path from 'path';

let _db: Database.Database | null = null;
let _schemaInitialized = false;

function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = path.join(process.cwd(), 'db', 'auth.db');
  _db = new Database(dbPath);
  return _db;
}

function ensureSchema(db: Database.Database): void {
  if (_schemaInitialized) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS trial_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      fingerprint TEXT,
      email TEXT NOT NULL,
      claimed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trial_claims_ip ON trial_claims(ip);
    CREATE INDEX IF NOT EXISTS idx_trial_claims_fingerprint ON trial_claims(fingerprint);
  `);
  _schemaInitialized = true;
}

/**
 * فحص هل هذا الـ IP أو البصمة حصلوا بالفعل على فترة تجريبية خلال آخر 60 يوماً؟
 */
export function hasClaimedTrial(ip: string, fingerprint?: string): boolean {
  // استثناء الـ localhost والـ unknown أثناء التطوير
  if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') {
    return false;
  }

  try {
    const db = getDb();
    ensureSchema(db);

    // فحص بالـ IP خلال آخر 60 يوماً
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    const rowByIp = db
      .prepare('SELECT id FROM trial_claims WHERE ip = ? AND claimed_at >= ? LIMIT 1')
      .get(ip, sixtyDaysAgo);

    if (rowByIp) return true;

    // فحص بالبصمة إن وجدت
    if (fingerprint && fingerprint.length > 5) {
      const rowByFp = db
        .prepare('SELECT id FROM trial_claims WHERE fingerprint = ? AND claimed_at >= ? LIMIT 1')
        .get(fingerprint, sixtyDaysAgo);

      if (rowByFp) return true;
    }

    return false;
  } catch (err) {
    console.error('[trial-abuse-guard] Error checking trial claim:', err);
    return false; // Fail open defensively to not crash registration
  }
}

/**
 * تسجيل استفادة الـ IP أو البصمة من التجربة المجانية
 */
export function recordTrialClaim(ip: string, email: string, fingerprint?: string): void {
  if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') {
    return;
  }

  try {
    const db = getDb();
    ensureSchema(db);

    db.prepare('INSERT INTO trial_claims (ip, fingerprint, email, claimed_at) VALUES (?, ?, ?, datetime(\'now\'))')
      .run(ip, fingerprint || null, email.toLowerCase().trim());
  } catch (err) {
    console.error('[trial-abuse-guard] Error recording trial claim:', err);
  }
}
