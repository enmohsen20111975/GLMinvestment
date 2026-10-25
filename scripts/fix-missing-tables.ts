/**
 * Fix Missing Database Tables
 * ===========================
 * يضيف الجداول الناقصة في stocks.db من غير مسح أي بيانات
 * 
 * الجداول المطلوبة:
 * - prediction_logs
 * - gold_prices
 * - financial_obligations
 * - portfolio_assets
 * - obligation_payments
 */

import { Database } from 'bun:sqlite';
import * as path from 'path';
import * as fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'db', 'stocks.db');

function main() {
  console.log('🔧 بدء إصلاح الجداول الناقصة...\n');
  
  // التحقق من وجود قاعدة البيانات
  if (!fs.existsSync(DB_PATH)) {
    console.error('❌ stocks.db غير موجودة!');
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.run('PRAGMA journal_mode = WAL');

  // الحصول على قائمة الجداول الموجودة
  const existingTables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const tableNames = existingTables.map(t => t.name);
  
  console.log('📋 الجداول الموجودة:', tableNames.join(', '));
  console.log('');

  // 1. إضافة جدول prediction_logs
  if (!tableNames.includes('prediction_logs')) {
    console.log('➕ إضافة جدول prediction_logs...');
    db.run(`
      CREATE TABLE prediction_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        prediction_date TEXT NOT NULL,
        recommendation TEXT,
        predicted_direction TEXT,
        confidence REAL,
        entry_price REAL,
        target_price REAL,
        stop_loss REAL,
        direction_correct_5d INTEGER DEFAULT 0,
        direction_correct_10d INTEGER DEFAULT 0,
        target_reached INTEGER DEFAULT 0,
        stop_hit INTEGER DEFAULT 0,
        actual_price_5d REAL,
        actual_price_10d REAL,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        verified_at TEXT
      )
    `);
    console.log('✅ تم إنشاء prediction_logs\n');
  } else {
    console.log('⏭️ prediction_logs موجود بالفعل\n');
  }

  // 2. إضافة جدول gold_prices
  if (!tableNames.includes('gold_prices')) {
    console.log('➕ إضافة جدول gold_prices...');
    db.run(`
      CREATE TABLE gold_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        karat TEXT NOT NULL,
        price_per_gram REAL NOT NULL,
        currency TEXT DEFAULT 'EGP',
        source TEXT,
        last_update TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(karat, currency)
      )
    `);
    
    // إضافة أسعار الذهب الافتراضية
    const now = new Date().toISOString();
    const insertGold = db.query('INSERT OR REPLACE INTO gold_prices (karat, price_per_gram, currency, source, last_update) VALUES ($karat, $price, $currency, $source, $update)');
    insertGold.run({ $karat: '24', $price: 3200, $currency: 'EGP', $source: 'default', $update: now });
    insertGold.run({ $karat: '21', $price: 2800, $currency: 'EGP', $source: 'default', $update: now });
    insertGold.run({ $karat: '18', $price: 2400, $currency: 'EGP', $source: 'default', $update: now });
    console.log('✅ تم إنشاء gold_prices مع أسعار افتراضية\n');
  } else {
    console.log('⏭️ gold_prices موجود بالفعل\n');
  }

  // 3. إضافة جدول financial_obligations
  if (!tableNames.includes('financial_obligations')) {
    console.log('➕ إضافة جدول financial_obligations...');
    db.run(`
      CREATE TABLE financial_obligations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        creditor TEXT,
        total_amount REAL NOT NULL,
        remaining_amount REAL NOT NULL,
        monthly_payment REAL,
        interest_rate REAL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        next_payment_date TEXT,
        status TEXT DEFAULT 'active',
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ تم إنشاء financial_obligations\n');
  } else {
    console.log('⏭️ financial_obligations موجود بالفعل\n');
  }

  // 4. إضافة جدول portfolio_assets
  if (!tableNames.includes('portfolio_assets')) {
    console.log('➕ إضافة جدول portfolio_assets...');
    db.run(`
      CREATE TABLE portfolio_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        total_invested REAL NOT NULL,
        current_value REAL,
        stock_ticker TEXT,
        quantity REAL,
        avg_buy_price REAL,
        weight_grams REAL,
        karat INTEGER,
        purchase_price_per_gram REAL,
        bank_name TEXT,
        interest_rate REAL,
        certificate_duration_months INTEGER,
        certificate_return_rate REAL,
        notes TEXT,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ تم إنشاء portfolio_assets\n');
  } else {
    console.log('⏭️ portfolio_assets موجود بالفعل\n');
  }

  // 5. إضافة جدول obligation_payments
  if (!tableNames.includes('obligation_payments')) {
    console.log('➕ إضافة جدول obligation_payments...');
    db.run(`
      CREATE TABLE obligation_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        obligation_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        amount REAL NOT NULL,
        payment_date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ تم إنشاء obligation_payments\n');
  } else {
    console.log('⏭️ obligation_payments موجود بالفعل\n');
  }

  // 6. التحقق من عمود dividend_yield في جدول stocks
  console.log('🔍 التحقق من أعمدة جدول stocks...');
  const stocksColumns = db.query("PRAGMA table_info(stocks)").all() as { name: string }[];
  const columnNames = stocksColumns.map(c => c.name);
  
  const requiredColumns = [
    { name: 'dividend_yield', sql: 'ALTER TABLE stocks ADD COLUMN dividend_yield REAL' },
    { name: 'support_level', sql: 'ALTER TABLE stocks ADD COLUMN support_level REAL' },
    { name: 'resistance_level', sql: 'ALTER TABLE stocks ADD COLUMN resistance_level REAL' },
    { name: 'roe', sql: 'ALTER TABLE stocks ADD COLUMN roe REAL' },
    { name: 'debt_to_equity', sql: 'ALTER TABLE stocks ADD COLUMN debt_to_equity REAL' },
    { name: 'egx30_member', sql: 'ALTER TABLE stocks ADD COLUMN egx30_member INTEGER DEFAULT 0' },
    { name: 'egx70_member', sql: 'ALTER TABLE stocks ADD COLUMN egx70_member INTEGER DEFAULT 0' },
    { name: 'is_halal', sql: 'ALTER TABLE stocks ADD COLUMN is_halal INTEGER' },
    { name: 'compliance_status', sql: 'ALTER TABLE stocks ADD COLUMN compliance_status TEXT' },
    { name: 'market', sql: 'ALTER TABLE stocks ADD COLUMN market TEXT DEFAULT "EGX"' },
  ];

  for (const col of requiredColumns) {
    if (!columnNames.includes(col.name)) {
      try {
        console.log(`➕ إضافة عمود ${col.name}...`);
        db.run(col.sql);
        console.log(`✅ تم إضافة ${col.name}\n`);
      } catch (e) {
        console.log(`⚠️ لم نستطع إضافة ${col.name}: ${e}\n`);
      }
    } else {
      console.log(`⏭️ عمود ${col.name} موجود بالفعل`);
    }
  }

  // 7. إضافة جدول user_stock_watchlists
  if (!tableNames.includes('user_stock_watchlists')) {
    console.log('\n➕ إضافة جدول user_stock_watchlists...');
    db.run(`
      CREATE TABLE user_stock_watchlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        stock_id INTEGER NOT NULL,
        alert_price_above REAL,
        alert_price_below REAL,
        alert_change_percent REAL,
        notes TEXT,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_viewed TEXT,
        view_count INTEGER DEFAULT 0,
        FOREIGN KEY (stock_id) REFERENCES stocks(id) ON DELETE CASCADE,
        UNIQUE(user_id, stock_id)
      )
    `);
    console.log('✅ تم إنشاء user_stock_watchlists\n');
  } else {
    console.log('⏭️ user_stock_watchlists موجود بالفعل\n');
  }

  // 8. إضافة جدول indicator_trust_scores
  if (!tableNames.includes('indicator_trust_scores')) {
    console.log('\n➕ إضافة جدول indicator_trust_scores...');
    db.run(`
      CREATE TABLE indicator_trust_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        indicator_name TEXT NOT NULL,
        persona TEXT DEFAULT 'balanced',
        asset_type TEXT DEFAULT 'egx',
        total_signals INTEGER DEFAULT 0,
        correct_signals INTEGER DEFAULT 0,
        win_rate REAL DEFAULT 50,
        avg_return REAL DEFAULT 0,
        last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(indicator_name, persona, asset_type)
      )
    `);
    console.log('✅ تم إنشاء indicator_trust_scores\n');
  }

  // 9. إضافة جدول signal_logs
  if (!tableNames.includes('signal_logs')) {
    console.log('\n➕ إضافة جدول signal_logs...');
    db.run(`
      CREATE TABLE signal_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        signal_value REAL,
        indicator_name TEXT,
        persona TEXT DEFAULT 'balanced',
        signal_date TEXT NOT NULL,
        outcome TEXT,
        return_pct REAL,
        verified INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ تم إنشاء signal_logs\n');
  }

  // 10. إضافة جدول stock_price_history
  if (!tableNames.includes('stock_price_history')) {
    console.log('\n➕ إضافة جدول stock_price_history...');
    db.run(`
      CREATE TABLE stock_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        date TEXT NOT NULL,
        open REAL,
        high REAL,
        low REAL,
        close REAL,
        volume INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(ticker, date)
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_price_history_ticker ON stock_price_history(ticker)');
    db.run('CREATE INDEX IF NOT EXISTS idx_price_history_date ON stock_price_history(date)');
    console.log('✅ تم إنشاء stock_price_history\n');
  }

  // 11. التحقق من وجود جدول cached_analysis
  if (!tableNames.includes('cached_analysis')) {
    console.log('\n➕ إضافة جدول cached_analysis...');
    db.run(`
      CREATE TABLE cached_analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        analysis_date TEXT NOT NULL,
        analysis_json TEXT NOT NULL,
        signal TEXT,
        master_score REAL,
        technical_score REAL,
        fundamental_score REAL,
        timing_score REAL,
        pattern_score REAL,
        market_regime_score REAL,
        liquidity_level TEXT,
        is_tradeable INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(ticker, analysis_date)
      )
    `);
    console.log('✅ تم إنشاء cached_analysis\n');
  }

  // عرض الملخص النهائي
  console.log('\n' + '='.repeat(50));
  console.log('📊 ملخص الجداول بعد الإصلاح:');
  console.log('='.repeat(50));
  
  const finalTables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  
  for (const t of finalTables) {
    try {
      const count = db.query(`SELECT COUNT(*) as cnt FROM ${t.name}`).get() as { cnt: number };
      console.log(`  ${t.name}: ${count?.cnt || 0} سجل`);
    } catch {
      console.log(`  ${t.name}: خطأ في العد`);
    }
  }
  
  console.log('='.repeat(50));
  console.log('✅ تم إصلاح جميع الجداول بنجاح!\n');

  db.close();
}

main();
