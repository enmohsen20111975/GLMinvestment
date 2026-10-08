#!/usr/bin/env bun
/**
 * DB Inventory & Recovery
 * ========================
 * جرد كل قواعد البيانات الموصى عليها في الكود + إنشاء الـ DBs الناقصة.
 *
 * PROTECT-FIX (2026-10-08): اتعمل بعد ما المستخدم مسح DBs مهمة من لوحة
 * التحكم. السكربت ده بيعمل:
 *   1. جرد كل الـ DBs الموصى عليها في الكود
 *   2. فحص اللي موجودة فعلاً
 *   3. إنشاء الـ DBs الناقصة مع schema أساسي
 *   4. تقرير واضح بالحالة
 *
 * Usage:
 *   bun run scripts/db-inventory-recover.ts          # فحص فقط
 *   bun run scripts/db-inventory-recover.ts --fix     # إنشاء الناقص
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';

const DB_DIR = join(process.cwd(), 'db');
const FIX_MODE = process.argv.includes('--fix');

// ─── كل الـ DBs الحرجة الموصى عليها في الكود ──────────────────────────
// (مطابقة لـ PROTECTED_DBS في src/lib/sqlite-admin.ts)
const CRITICAL_DBS = [
  { name: 'stocks.db', desc: 'بيانات أسهم EGX (279 سهم)', priority: 'CRITICAL' },
  { name: 'predictions.db', desc: 'توقعات V40.2', priority: 'CRITICAL' },
  { name: 'data_engine.db', desc: 'كاش محرك البيانات', priority: 'CRITICAL' },
  { name: 'price_history.db', desc: 'الأسعار التاريخية', priority: 'CRITICAL' },
  { name: 'auth.db', desc: 'المستخدمين والجلسات (Prisma)', priority: 'CRITICAL' },
  { name: 'custom.db', desc: 'Prisma default schema', priority: 'CRITICAL' },
  { name: 'news.db', desc: 'الأخبار', priority: 'IMPORTANT' },
  { name: 'intraday.db', desc: 'بيانات intraday', priority: 'IMPORTANT' },
  { name: 'core.db', desc: 'بيانات أساسية', priority: 'IMPORTANT' },
  { name: 'learned.db', desc: 'دروس التعلم الآلي', priority: 'IMPORTANT' },
  { name: 'crypto.db', desc: 'بيانات العملات الرقمية', priority: 'IMPORTANT' },
  { name: 'market.db', desc: 'بيانات السوق', priority: 'IMPORTANT' },
  { name: 'basic.db', desc: 'بيانات أساسية', priority: 'IMPORTANT' },
  { name: 'egx_investment.db', desc: 'بيانات EGX القديمة', priority: 'IMPORTANT' },
  { name: 'analytics.db', desc: 'تحليلات', priority: 'IMPORTANT' },
  { name: 'production_snapshot.db', desc: 'snapshot الإنتاج', priority: 'IMPORTANT' },
  { name: 'gold_prices.db', desc: 'أسعار الذهب', priority: 'IMPORTANT' },
  { name: 'content.db', desc: 'محتوى', priority: 'IMPORTANT' },
  { name: 'community.db', desc: 'مجتمع', priority: 'IMPORTANT' },
  { name: 'finance.db', desc: 'محفظة', priority: 'IMPORTANT' },
  { name: 'ai_search_cache.db', desc: 'كاش بحث AI', priority: 'IMPORTANT' },
  { name: 'crypto_learning.db', desc: 'تعلم العملات الرقمية', priority: 'IMPORTANT' },
  { name: 'crypto_disclosures.db', desc: 'إفصاحات العملات الرقمية', priority: 'IMPORTANT' },
  { name: 'paper_trading.db', desc: 'تداول ورقي', priority: 'IMPORTANT' },
  { name: 'live_journal.db', desc: 'يوميات live', priority: 'IMPORTANT' },
  { name: 'prediction_tracker.db', desc: 'تتبع التوقعات', priority: 'IMPORTANT' },
  { name: 'radarData.db', desc: 'بيانات الرادار', priority: 'IMPORTANT' },
  { name: 'telegram_data.db', desc: 'بيانات تيليجرام', priority: 'IMPORTANT' },
  { name: 'unified_stocks.db', desc: 'أسهم موحدة', priority: 'IMPORTANT' },
  { name: 'decision_log.db', desc: 'سجل القرارات', priority: 'IMPORTANT' },
];

// ─── Schemas أساسية للـ DBs الناقصة ──────────────────────────────────
// كل DB لازم يكون ليه schema أساسي عشان الكود يقدر يفتحه بدون error.
// الـ scrapers بتعمل CREATE TABLE IF NOT EXISTS، فهنا بنعمل بس جدول
// placeholder عشان الـ DB file يبقى موجود وقابل للقراءة.
const DB_SCHEMAS: Record<string, string[]> = {
  'stocks.db': [
    `CREATE TABLE IF NOT EXISTS stocks (
      ticker TEXT PRIMARY KEY,
      name TEXT,
      sector TEXT,
      market TEXT DEFAULT 'EGX',
      current_price REAL,
      change_percent REAL,
      volume REAL,
      market_cap REAL,
      signal REAL DEFAULT 0,
      last_updated TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS user_stock_watchlists (
      user_id TEXT, ticker TEXT, market TEXT DEFAULT 'EGX',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, ticker)
    )`,
  ],
  'predictions.db': [
    `CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT, signal TEXT, prediction_date TEXT,
      entry_price REAL, target_price REAL, stop_loss REAL,
      master_score REAL, confidence REAL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS cached_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT, signal TEXT, confidence REAL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  ],
  'data_engine.db': [
    `CREATE TABLE IF NOT EXISTS engine_cache (
      key TEXT PRIMARY KEY, value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
  ],
  'price_history.db': [
    `CREATE TABLE IF NOT EXISTS price_history (
      ticker TEXT, date TEXT, open REAL, high REAL,
      low REAL, close REAL, volume REAL,
      UNIQUE(ticker, date)
    )`,
  ],
  'news.db': [
    `CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT, title TEXT, url TEXT UNIQUE,
      source TEXT, published_at TEXT, summary TEXT,
      sentiment TEXT, relevance_score REAL DEFAULT 0,
      fetched_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS news_cache (
      query TEXT PRIMARY KEY, results TEXT,
      fetched_at TEXT DEFAULT (datetime('now'))
    )`,
  ],
  'intraday.db': [
    `CREATE TABLE IF NOT EXISTS intraday_prices (
      ticker TEXT, timestamp TEXT, price REAL, volume REAL,
      UNIQUE(ticker, timestamp)
    )`,
  ],
  'learned.db': [
    `CREATE TABLE IF NOT EXISTS learned_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT, persona TEXT, lesson TEXT,
      win_rate REAL, created_at TEXT DEFAULT (datetime('now'))
    )`,
  ],
  'core.db': [
    `CREATE TABLE IF NOT EXISTS core_data (
      key TEXT PRIMARY KEY, value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
  ],
  'crypto.db': [
    `CREATE TABLE IF NOT EXISTS crypto_prices (
      symbol TEXT PRIMARY KEY, price REAL,
      change_percent REAL, volume REAL,
      last_updated TEXT
    )`,
  ],
  'gold_prices.db': [
    `CREATE TABLE IF NOT EXISTS gold_prices (
      date TEXT PRIMARY KEY, price REAL,
      currency TEXT DEFAULT 'EGP',
      fetched_at TEXT DEFAULT (datetime('now'))
    )`,
  ],
  'analytics.db': [
    `CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT, user_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  ],
};

// ─── Default schema لكل DB مش معروف ──────────────────────────────────
const DEFAULT_SCHEMA = `CREATE TABLE IF NOT EXISTS _placeholder (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now'))
)`;

// ─── Helper functions ──────────────────────────────────────────────────
function log(msg: string, color: string = '') {
  const colors: Record<string, string> = {
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', blue: '\x1b[34m', reset: '\x1b[0m',
  };
  console.log(`${colors[color] || ''}${msg}${colors.reset || ''}`);
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getTableCount(dbPath: string): { tables: number; rows: number } {
  try {
    const db = new Database(dbPath, { readonly: true });
    const tbls = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as { name: string }[];
    let rows = 0;
    for (const t of tbls) {
      try {
        const r = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as { c: number };
        rows += r.c;
      } catch {}
    }
    db.close();
    return { tables: tbls.length, rows };
  } catch {
    return { tables: 0, rows: 0 };
  }
}

// ─── Main ──────────────────────────────────────────────────────────────
function main() {
  console.log('\n' + '═'.repeat(70));
  log('  📊 DB Inventory & Recovery — GLM Investment Platform', 'cyan');
  console.log('═'.repeat(70) + '\n');

  // 1. التأكد من وجود مجلد db/
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
    log('✅ تم إنشاء مجلد db/', 'green');
  }

  // 2. جرد كل الـ DBs
  log('┌─ جرد قواعد البيانات ─────────────────────────────────────────┐', 'blue');
  const status = CRITICAL_DBS.map(db => {
    const dbPath = join(DB_DIR, db.name);
    const exists = existsSync(dbPath);
    const size = exists ? statSync(dbPath).size : 0;
    const { tables, rows } = exists ? getTableCount(dbPath) : { tables: 0, rows: 0 };
    const isEmpty = exists && size === 0;
    return { ...db, exists, size, tables, rows, isEmpty };
  });

  let missing = 0, empty = 0, ok = 0;
  for (const s of status) {
    if (!s.exists) {
      log(`  ❌ ${s.name.padEnd(28)} MISSING  — ${s.desc}`, 'red');
      missing++;
    } else if (s.isEmpty || s.tables === 0) {
      log(`  ⚠️  ${s.name.padEnd(28)} EMPTY    — ${s.desc} (${formatSize(s.size)})`, 'yellow');
      empty++;
    } else {
      log(`  ✅ ${s.name.padEnd(28)} OK       — ${s.desc} (${s.tables} جدول, ${s.rows} صف, ${formatSize(s.size)})`, 'green');
      ok++;
    }
  }
  console.log('└──────────────────────────────────────────────────────────────┘');

  log(`\n📊 الإجمالي: ${ok} سليمة، ${empty} فارغة، ${missing} مفقودة`, 'cyan');

  // 3. FIX MODE — إنشاء الـ DBs الناقصة
  if (!FIX_MODE) {
    log('\n💡 لتشغيل الإصلاح: bun run scripts/db-inventory-recover.ts --fix', 'yellow');
    return;
  }

  console.log('\n' + '═'.repeat(70));
  log('  🔧 بدء الإصلاح — إنشاء الـ DBs الناقصة', 'cyan');
  console.log('═'.repeat(70) + '\n');

  let created = 0, fixed = 0;
  for (const s of status) {
    const dbPath = join(DB_DIR, s.name);
    const schemas = DB_SCHEMAS[s.name] || [DEFAULT_SCHEMA];

    try {
      const db = new Database(dbPath);
      for (const sql of schemas) {
        db.run(sql);
      }
      db.close();

      if (!s.exists) {
        log(`  ✅ تم إنشاء: ${s.name} (${schemas.length} جدول)`, 'green');
        created++;
      } else if (s.isEmpty || s.tables === 0) {
        log(`  🔧 تم إصلاح: ${s.name} (${schemas.length} جدول)`, 'yellow');
        fixed++;
      }
    } catch (e) {
      log(`  ❌ فشل: ${s.name} — ${e}`, 'red');
    }
  }

  console.log('\n' + '═'.repeat(70));
  log(`  ✅ اكتمل: ${created} DB جديدة، ${fixed} DB مُصلحة`, 'green');
  console.log('═'.repeat(70) + '\n');

  log('📋 الخطوات التالية:', 'cyan');
  console.log('   1. تشغيل scrapers لإعادة ملء البيانات:');
  console.log('      cd vps-service && python3 scrapers/update_market_indices.py');
  console.log('      cd vps-service && python3 scrapers/egx_scraper.py');
  console.log('      cd vps-service && python3 scrapers/news_scraper.py');
  console.log('   2. تشغيل daily_predictor لإعادة التوقعات:');
  console.log('      cd vps-service && python3 daily_predictor.py');
  console.log('   3. تشغيل prisma db push لـ auth.db:');
  console.log('      bunx prisma db push --schema=prisma/auth-schema.prisma');
  console.log('');
}

main();
