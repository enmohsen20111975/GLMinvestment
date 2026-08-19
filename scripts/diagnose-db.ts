#!/usr/bin/env bun
/**
 * تشخيص قاعدة البيانات
 * =====================
 * 
 * يفحص البيانات في قاعدة البيانات ويعرض:
 * - الجداول الموجودة
 * - عدد السجلات في كل جدول
 * - توزيع التواريخ في prediction_logs و ExpertRecommendation
 */

import { Database } from 'bun:sqlite';
import * as path from 'path';
import * as fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'db');
const DB_FILES = ['stocks.db', 'stocks.db', 'stocks.db', 'predictions.db'];

console.log('='.repeat(70));
console.log('📊 تشخيص قاعدة البيانات');
console.log('='.repeat(70));
console.log(`\n📂 مجلد قواعد البيانات: ${DB_DIR}\n`);

// List all DB files
console.log('📋 الملفات الموجودة:');
for (const file of fs.readdirSync(DB_DIR)) {
  if (file.endsWith('.db') || file.endsWith('.sqlite')) {
    const filePath = path.join(DB_DIR, file);
    const stats = fs.statSync(filePath);
    console.log(`   - ${file}: ${(stats.size / 1024).toFixed(1)} KB`);
  }
}
console.log('');

// Check each database
for (const dbFile of DB_FILES) {
  const dbPath = path.join(DB_DIR, dbFile);
  
  if (!fs.existsSync(dbPath)) {
    continue;
  }
  
  console.log('─'.repeat(70));
  console.log(`📊 قاعدة البيانات: ${dbFile}`);
  console.log('─'.repeat(70));
  
  try {
    const db = new Database(dbPath, { readonly: true });
    
    // Get all tables
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    
    if (tables.length === 0) {
      console.log('   ⚠️ لا توجد جداول');
      db.close();
      continue;
    }
    
    console.log(`\n   📋 الجداول (${tables.length}):`);
    
    for (const table of tables) {
      try {
        const count = db.query(`SELECT COUNT(*) as cnt FROM "${table.name}"`).get() as { cnt: number };
        const status = count.cnt > 0 ? '✅' : '⚠️ ';
        console.log(`      ${status} ${table.name}: ${count.cnt.toLocaleString()} سجل`);
      } catch (e) {
        console.log(`      ❌ ${table.name}: خطأ في القراءة`);
      }
    }
    
    // Check prediction_logs if exists
    const hasPredLogs = tables.some(t => t.name === 'prediction_logs');
    if (hasPredLogs) {
      console.log('\n   📅 توزيع التوقعات حسب الشهر (prediction_logs):');
      try {
        const monthly = db.query(`
          SELECT 
            substr(prediction_date, 1, 7) as month,
            COUNT(*) as cnt
          FROM prediction_logs
          GROUP BY month
          ORDER BY month DESC
          LIMIT 12
        `).all() as { month: string; cnt: number }[];
        
        for (const row of monthly) {
          console.log(`      - ${row.month}: ${row.cnt} توقع`);
        }
      } catch (e) {
        console.log(`      ❌ خطأ: ${e}`);
      }
    }
    
    // Check ExpertRecommendation if exists
    const expertTableName = tables.find(t => 
      t.name === 'ExpertRecommendation' || t.name === 'expertRecommendation'
    )?.name;
    
    if (expertTableName) {
      console.log(`\n   📅 توزيع التوصيات حسب الشهر (${expertTableName}):`);
      try {
        const monthly = db.query(`
          SELECT 
            substr(COALESCE(session_date, recommendation_date, created_at), 1, 7) as month,
            COUNT(*) as cnt
          FROM "${expertTableName}"
          GROUP BY month
          ORDER BY month DESC
          LIMIT 12
        `).all() as { month: string; cnt: number }[];
        
        for (const row of monthly) {
          console.log(`      - ${row.month}: ${row.cnt} توصية`);
        }
        
        // Status distribution
        console.log('\n   📊 توزيع الحالات:');
        const statusDist = db.query(`
          SELECT status, COUNT(*) as cnt
          FROM "${expertTableName}"
          GROUP BY status
          ORDER BY cnt DESC
        `).all() as { status: string; cnt: number }[];
        
        for (const row of statusDist) {
          console.log(`      - ${row.status || 'غير محدد'}: ${row.cnt}`);
        }
      } catch (e) {
        console.log(`      ❌ خطأ: ${e}`);
      }
    }
    
    db.close();
  } catch (e) {
    console.log(`   ❌ خطأ في فتح قاعدة البيانات: ${e}`);
  }
  
  console.log('');
}

console.log('='.repeat(70));
console.log('✅ انتهى التشخيص');
console.log('='.repeat(70));
#!/usr/bin/env bun
/**
 * تشخيص قاعدة البيانات
 * =====================
 * 
 * يفحص البيانات في قاعدة البيانات ويعرض:
 * - الجداول الموجودة
 * - عدد السجلات في كل جدول
 * - توزيع التواريخ في prediction_logs و ExpertRecommendation
 */

import { Database } from 'bun:sqlite';
import * as path from 'path';
import * as fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'db');
const DB_FILES = ['stocks.db', 'custom.db', 'egx_investment.db', 'predictions.db'];

console.log('='.repeat(70));
console.log('📊 تشخيص قاعدة البيانات');
console.log('='.repeat(70));
console.log(`\n📂 مجلد قواعد البيانات: ${DB_DIR}\n`);

// List all DB files
console.log('📋 الملفات الموجودة:');
for (const file of fs.readdirSync(DB_DIR)) {
  if (file.endsWith('.db') || file.endsWith('.sqlite')) {
    const filePath = path.join(DB_DIR, file);
    const stats = fs.statSync(filePath);
    console.log(`   - ${file}: ${(stats.size / 1024).toFixed(1)} KB`);
  }
}
console.log('');

// Check each database
for (const dbFile of DB_FILES) {
  const dbPath = path.join(DB_DIR, dbFile);
  
  if (!fs.existsSync(dbPath)) {
    continue;
  }
  
  console.log('─'.repeat(70));
  console.log(`📊 قاعدة البيانات: ${dbFile}`);
  console.log('─'.repeat(70));
  
  try {
    const db = new Database(dbPath, { readonly: true });
    
    // Get all tables
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    
    if (tables.length === 0) {
      console.log('   ⚠️ لا توجد جداول');
      db.close();
      continue;
    }
    
    console.log(`\n   📋 الجداول (${tables.length}):`);
    
    for (const table of tables) {
      try {
        const count = db.query(`SELECT COUNT(*) as cnt FROM "${table.name}"`).get() as { cnt: number };
        const status = count.cnt > 0 ? '✅' : '⚠️ ';
        console.log(`      ${status} ${table.name}: ${count.cnt.toLocaleString()} سجل`);
      } catch (e) {
        console.log(`      ❌ ${table.name}: خطأ في القراءة`);
      }
    }
    
    // Check prediction_logs if exists
    const hasPredLogs = tables.some(t => t.name === 'prediction_logs');
    if (hasPredLogs) {
      console.log('\n   📅 توزيع التوقعات حسب الشهر (prediction_logs):');
      try {
        const monthly = db.query(`
          SELECT 
            substr(prediction_date, 1, 7) as month,
            COUNT(*) as cnt
          FROM prediction_logs
          GROUP BY month
          ORDER BY month DESC
          LIMIT 12
        `).all() as { month: string; cnt: number }[];
        
        for (const row of monthly) {
          console.log(`      - ${row.month}: ${row.cnt} توقع`);
        }
      } catch (e) {
        console.log(`      ❌ خطأ: ${e}`);
      }
    }
    
    // Check ExpertRecommendation if exists
    const expertTableName = tables.find(t => 
      t.name === 'ExpertRecommendation' || t.name === 'expertRecommendation'
    )?.name;
    
    if (expertTableName) {
      console.log(`\n   📅 توزيع التوصيات حسب الشهر (${expertTableName}):`);
      try {
        const monthly = db.query(`
          SELECT 
            substr(COALESCE(session_date, recommendation_date, created_at), 1, 7) as month,
            COUNT(*) as cnt
          FROM "${expertTableName}"
          GROUP BY month
          ORDER BY month DESC
          LIMIT 12
        `).all() as { month: string; cnt: number }[];
        
        for (const row of monthly) {
          console.log(`      - ${row.month}: ${row.cnt} توصية`);
        }
        
        // Status distribution
        console.log('\n   📊 توزيع الحالات:');
        const statusDist = db.query(`
          SELECT status, COUNT(*) as cnt
          FROM "${expertTableName}"
          GROUP BY status
          ORDER BY cnt DESC
        `).all() as { status: string; cnt: number }[];
        
        for (const row of statusDist) {
          console.log(`      - ${row.status || 'غير محدد'}: ${row.cnt}`);
        }
      } catch (e) {
        console.log(`      ❌ خطأ: ${e}`);
      }
    }
    
    db.close();
  } catch (e) {
    console.log(`   ❌ خطأ في فتح قاعدة البيانات: ${e}`);
  }
  
  console.log('');
}

console.log('='.repeat(70));
console.log('✅ انتهى التشخيص');
console.log('='.repeat(70));
