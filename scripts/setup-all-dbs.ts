#!/usr/bin/env bun
/**
 * Setup All Databases
 * ====================
 * 
 * سكربت شامل لملء قواعد البيانات وتحديث الإعدادات
 * 
 * هيكل قواعد البيانات:
 * - stocks.db: الأسهم والعملات الرقمية
 * - price_history.db: الأسعار التاريخية
 * - predictions.db: التوقعات والتحليلات
 * - learned.db: دروس التعلم الآلي
 * - auth.db: المستخدمين (Prisma)
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const DB_DIR = join(process.cwd(), 'db');

// ألوان للطباعة
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function header(title: string) {
  console.log('\n' + '='.repeat(60));
  log(`  ${title}`, colors.cyan);
  console.log('='.repeat(60) + '\n');
}

function subheader(title: string) {
  log(`\n--- ${title} ---`, colors.blue);
}

// ===========================================================================
// 1. فحص وإنشاء المجلدات
// ===========================================================================

function ensureDirectories() {
  header('1. فحص المجلدات');
  
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
    log('✅ تم إنشاء مجلد db/', colors.green);
  } else {
    log('✅ مجلد db/ موجود', colors.green);
  }
}

// ===========================================================================
// 2. فحص قواعد البيانات
// ===========================================================================

function checkDatabases() {
  header('2. فحص قواعد البيانات');
  
  const dbs = [
    { name: 'stocks.db', desc: 'الأسهم والعملات الرقمية', table: 'stocks' },
    { name: 'price_history.db', desc: 'الأسعار التاريخية', table: 'price_history' },
    { name: 'predictions.db', desc: 'التوقعات والتحليلات', table: 'cached_analysis' },
    { name: 'learned.db', desc: 'دروس التعلم الآلي', table: 'learned_lessons' },
    { name: 'auth.db', desc: 'المستخدمين (Prisma)', table: 'User' },
  ];
  
  console.log('\n📊 حالة قواعد البيانات:\n');
  
  for (const db of dbs) {
    const dbPath = join(DB_DIR, db.name);
    const exists = existsSync(dbPath);
    
    if (exists) {
      try {
        const database = new Database(dbPath);
        const countRow = database.query(`SELECT COUNT(*) as count FROM ${db.table}`).get() as { count: number };
        const count = countRow?.count || 0;
        const size = Math.round(require('fs').statSync(dbPath).size / 1024);
        log(`   ✅ ${db.name}: ${count} سجل (${size} KB)`, colors.green);
        database.close();
      } catch (e) {
        log(`   ⚠️ ${db.name}: موجود لكن فيه خطأ`, colors.yellow);
      }
    } else {
      log(`   ❌ ${db.name}: غير موجود`, colors.red);
    }
  }
}

// ===========================================================================
// 3. إنشاء/تحديث predictions.db
// ===========================================================================

function setupPredictionsDb() {
  subheader('predictions.db - التوقعات والتحليلات');
  
  const dbPath = join(DB_DIR, 'predictions.db');
  const db = new Database(dbPath);
  
  // جدول التحليلات المخزنة
  db.run(`
    CREATE TABLE IF NOT EXISTS cached_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      market TEXT DEFAULT 'EGX',
      signal TEXT DEFAULT 'HOLD',
      confidence REAL DEFAULT 0.5,
      entry_price REAL,
      target_price REAL,
      stop_loss REAL,
      reasoning TEXT,
      indicators TEXT,
      ai_model TEXT DEFAULT 'deepseek',
      analysis_type TEXT DEFAULT 'technical',
      timeframe TEXT DEFAULT 'short_term',
      risk_level TEXT DEFAULT 'medium',
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      UNIQUE(ticker, created_at)
    )
  `);
  
  // جدول المؤشرات الفنية
  db.run(`
    CREATE TABLE IF NOT EXISTS technical_indicators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT UNIQUE NOT NULL,
      rsi_14 REAL,
      macd REAL,
      macd_signal REAL,
      bb_upper REAL,
      bb_middle REAL,
      bb_lower REAL,
      ma_20 REAL,
      ma_50 REAL,
      ma_200 REAL,
      support_level REAL,
      resistance_level REAL,
      trend_direction TEXT,
      last_updated TEXT DEFAULT (datetime('now'))
    )
  `);
  
  // جدول سجل التوقعات
  db.run(`
    CREATE TABLE IF NOT EXISTS prediction_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      market TEXT DEFAULT 'EGX',
      signal TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      entry_price REAL,
      target_price REAL,
      stop_loss REAL,
      reasoning TEXT,
      ai_model TEXT DEFAULT 'deepseek',
      created_at TEXT DEFAULT (datetime('now')),
      verify_date TEXT,
      verified INTEGER DEFAULT 0,
      final_price REAL,
      result TEXT,
      profit_loss_pct REAL
    )
  `);
  
  // إنشاء الفهارس
  db.run('CREATE INDEX IF NOT EXISTS idx_cached_analysis_ticker ON cached_analysis(ticker)');
  db.run('CREATE INDEX IF NOT EXISTS idx_technical_indicators_ticker ON technical_indicators(ticker)');
  db.run('CREATE INDEX IF NOT EXISTS idx_prediction_logs_ticker ON prediction_logs(ticker)');
  
  const analysisCount = db.query('SELECT COUNT(*) as count FROM cached_analysis').get() as { count: number };
  const indicatorsCount = db.query('SELECT COUNT(*) as count FROM technical_indicators').get() as { count: number };
  
  log(`✅ predictions.db: ${analysisCount?.count || 0} تحليل, ${indicatorsCount?.count || 0} مؤشر`, colors.green);
  
  db.close();
}

// ===========================================================================
// 4. إضافة خطط الاشتراك الافتراضية (لو مش موجودة)
// ===========================================================================

function seedSubscriptionPlans() {
  subheader('خطط الاشتراك');
  
  const dbPath = join(DB_DIR, 'auth.db');
  if (!existsSync(dbPath)) {
    log('⚠️ auth.db غير موجود', colors.yellow);
    return;
  }
  
  const db = new Database(dbPath);
  
  const existingPlans = db.query('SELECT COUNT(*) as count FROM SubscriptionPlan').get() as { count: number };
  
  if ((existingPlans?.count || 0) > 0) {
    log(`✅ خطط الاشتراك موجودة: ${existingPlans?.count} خطة`, colors.green);
    db.close();
    return;
  }
  
  const plans = [
    { id: 'free', name: 'Free', price: 0, duration_days: 0, features: JSON.stringify({ max_watchlist: 5, max_portfolio: 10 }) },
    { id: 'premium', name: 'Premium', price: 99, duration_days: 30, features: JSON.stringify({ max_watchlist: 50, max_portfolio: 100, ai_analysis: true }) },
    { id: 'pro', name: 'Pro', price: 199, duration_days: 30, features: JSON.stringify({ max_watchlist: -1, max_portfolio: -1, ai_analysis: true, expert_recommendations: true }) },
  ];
  
  const insertStmt = db.prepare('INSERT OR IGNORE INTO SubscriptionPlan (id, name, price, duration_days, features) VALUES (?, ?, ?, ?, ?)');
  
  for (const plan of plans) {
    insertStmt.run(plan.id, plan.name, plan.price, plan.duration_days, plan.features);
  }
  
  log('✅ تم إضافة 3 خطط اشتراك افتراضية', colors.green);
  
  db.close();
}

// ===========================================================================
// 5. إضافة باقات النقاط الافتراضية
// ===========================================================================

function seedPointsPackages() {
  subheader('باقات النقاط');
  
  const dbPath = join(DB_DIR, 'auth.db');
  if (!existsSync(dbPath)) {
    log('⚠️ auth.db غير موجود', colors.yellow);
    return;
  }
  
  const db = new Database(dbPath);
  
  const existingPackages = db.query('SELECT COUNT(*) as count FROM PointsPackage').get() as { count: number };
  
  if ((existingPackages?.count || 0) > 0) {
    log(`✅ باقات النقاط موجودة: ${existingPackages?.count} باقة`, colors.green);
    db.close();
    return;
  }
  
  const packages = [
    { id: 'pkg_100', name: 'Starter', name_ar: 'الباقة الأولية', points: 100, price_egp: 10, bonus_points: 0 },
    { id: 'pkg_500', name: 'Basic', name_ar: 'الباقة الأساسية', points: 500, price_egp: 45, bonus_points: 50 },
    { id: 'pkg_1000', name: 'Standard', name_ar: 'الباقة القياسية', points: 1000, price_egp: 85, bonus_points: 150 },
    { id: 'pkg_2500', name: 'Premium', name_ar: 'الباقة المميزة', points: 2500, price_egp: 200, bonus_points: 500 },
    { id: 'pkg_5000', name: 'Ultimate', name_ar: 'الباقة النهائية', points: 5000, price_egp: 380, bonus_points: 1200 },
  ];
  
  const insertStmt = db.prepare('INSERT OR IGNORE INTO PointsPackage (id, name, name_ar, points, price_egp, bonus_points) VALUES (?, ?, ?, ?, ?, ?)');
  
  for (const pkg of packages) {
    insertStmt.run(pkg.id, pkg.name, pkg.name_ar, pkg.points, pkg.price_egp, pkg.bonus_points);
  }
  
  log('✅ تم إضافة 5 باقات نقاط افتراضية', colors.green);
  
  db.close();
}

// ===========================================================================
// 6. ملخص
// ===========================================================================

function showSummary() {
  header('3. ملخص');
  
  console.log('\n🚀 الخطوات التالية:');
  console.log('   1. تشغيل: bunx prisma generate');
  console.log('   2. إعادة تشغيل: pm2 restart all');
  console.log('   3. التحقق من الموقع: https://invist.m2y.net/\n');
}

// ===========================================================================
// MAIN
// ===========================================================================

async function main() {
  console.log('\n' + '═'.repeat(60));
  log('  🚀 Setup All Databases - GLM Investment Platform', colors.cyan);
  console.log('═'.repeat(60));
  
  try {
    ensureDirectories();
    checkDatabases();
    setupPredictionsDb();
    seedSubscriptionPlans();
    seedPointsPackages();
    showSummary();
    
    console.log('\n' + '═'.repeat(60));
    log('  ✅ تم الإعداد بنجاح!', colors.green);
    console.log('═'.repeat(60) + '\n');
    
  } catch (error) {
    console.error('\n❌ حدث خطأ:', error);
    process.exit(1);
  }
}

main();
