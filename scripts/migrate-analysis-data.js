#!/usr/bin/env node
/**
 * سكريبت نقل بيانات التحليلات من stocks.db لـ stocks.db
 * محسن للتعامل مع كميات كبيرة (500K+ سجل)
 * 
 * Usage: node scripts/migrate-analysis-data.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const OLD_DB_PATH = path.join(process.cwd(), 'db', 'stocks.db');
const NEW_DB_PATH = path.join(process.cwd(), 'db', 'stocks.db');

const BATCH_SIZE = 10000; // عدد السجلات في كل دفعة

console.log('========================================');
console.log('نقل بيانات التحليلات (محسن للكميات الكبيرة)');
console.log('========================================\n');

// فتح القاعدتين
let oldDb, newDb;

try {
  oldDb = new Database(OLD_DB_PATH, { readonly: true });
  console.log('✅ تم فتح stocks.db');
} catch (e) {
  console.log('❌ stocks.db مش موجود');
  process.exit(0);
}

try {
  newDb = new Database(NEW_DB_PATH);
  newDb.pragma('journal_mode = WAL'); // تحسين الأداء
  newDb.pragma('synchronous = OFF'); // تحسين السرعة
  console.log('✅ تم فتح stocks.db\n');
} catch (e) {
  console.log('❌ خطأ في فتح stocks.db:', e.message);
  process.exit(1);
}

// دالة نقل البيانات بـ batches
function migrateTableBatch(sourceTable, targetTable, columns, idColumn = 'id') {
  console.log(`\n--- نقل ${sourceTable} ---`);
  
  try {
    // التحقق من وجود الجدول المصدر
    const tableExists = oldDb.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${sourceTable}'`
    ).get();
    
    if (!tableExists) {
      console.log(`⚠️ جدول ${sourceTable} مش موجود في القاعدة القديمة`);
      return 0;
    }
    
    // عدد السجلات في المصدر
    const sourceCount = oldDb.prepare(`SELECT COUNT(*) as cnt FROM ${sourceTable}`).get().cnt;
    console.log(`المصدر: ${sourceCount.toLocaleString()} سجل`);
    
    if (sourceCount === 0) {
      console.log('لا توجد بيانات للنقل');
      return 0;
    }
    
    // عدد السجلات الموجودة في الهدف
    const existingCount = newDb.prepare(`SELECT COUNT(*) as cnt FROM ${targetTable}`).get().cnt;
    if (existingCount > 0) {
      console.log(`الهدف به ${existingCount.toLocaleString()} سجل - تخطي النقل`);
      return existingCount;
    }
    
    // الحصول على أعلى ID في المصدر
    const maxIdResult = oldDb.prepare(`SELECT MAX(${idColumn}) as maxId FROM ${sourceTable}`).get();
    const maxId = maxIdResult.maxId || 0;
    
    console.log(`نقل من ID 1 إلى ${maxId.toLocaleString()}...`);
    
    // إنشاء query الإدخال
    const placeholders = columns.map(() => '?').join(', ');
    const insertSql = `INSERT OR IGNORE INTO ${targetTable} (${columns.join(', ')}) VALUES (${placeholders})`;
    const insert = newDb.prepare(insertSql);
    
    let totalInserted = 0;
    let currentId = 1;
    
    // النقل بـ batches
    while (currentId <= maxId) {
      const batchStart = currentId;
      const batchEnd = Math.min(currentId + BATCH_SIZE - 1, maxId);
      
      const rows = oldDb.prepare(
        `SELECT ${columns.join(', ')} FROM ${sourceTable} 
         WHERE ${idColumn} >= ? AND ${idColumn} <= ?`
      ).all(batchStart, batchEnd);
      
      if (rows.length > 0) {
        const insertMany = newDb.transaction((items) => {
          for (const item of items) {
            try {
              const values = columns.map(col => item[col] ?? null);
              insert.run(...values);
            } catch (e) {
              // تخطي السجلات الخاطئة
            }
          }
        });
        
        insertMany(rows);
        totalInserted += rows.length;
      }
      
      // عرض التقدم
      process.stdout.write(`\r✅ تم نقل ${totalInserted.toLocaleString()} سجل (${Math.round(totalInserted/sourceCount*100)}%)`);
      
      currentId = batchEnd + 1;
    }
    
    console.log(''); // سطر جديد
    
    const targetCount = newDb.prepare(`SELECT COUNT(*) as cnt FROM ${targetTable}`).get().cnt;
    console.log(`✅ اكتمل! المجموع: ${targetCount.toLocaleString()} سجل`);
    
    return targetCount;
  } catch (e) {
    console.log(`❌ خطأ: ${e.message}`);
    return 0;
  }
}

// 1. نقل prediction_logs (الجدول الكبير)
console.log('\n========================================');
console.log('1. prediction_logs (538K سجل)');
console.log('========================================');

// أولاً: التحقق من الأعمدة الموجودة
let predColumns = [];
try {
  const sample = oldDb.prepare('SELECT * FROM prediction_logs LIMIT 1').get();
  if (sample) {
    predColumns = Object.keys(sample);
  } else {
    // لو فاضي، استخدم الأعمدة الافتراضية
    predColumns = [
      'id', 'ticker', 'prediction_date', 'recommendation', 'predicted_direction',
      'confidence', 'entry_price', 'target_price', 'stop_loss',
      'direction_correct_5d', 'direction_correct_10d', 'target_reached', 'stop_hit',
      'actual_price_5d', 'actual_price_10d', 'notes', 'created_at', 'verified_at'
    ];
  }
} catch (e) {
  console.log('خطأ في قراءة الأعمدة:', e.message);
}

migrateTableBatch('prediction_logs', 'prediction_logs', predColumns);

// 2. نقل learned_lessons
console.log('\n========================================');
console.log('2. learned_lessons (18K سجل)');
console.log('========================================');

// التحقق من الأعمدة
let lessonColumns = [];
try {
  const sample = oldDb.prepare('SELECT * FROM learned_lessons LIMIT 1').get();
  if (sample) {
    lessonColumns = Object.keys(sample);
    console.log('الأعمدة:', lessonColumns.join(', '));
  }
} catch (e) {}

if (lessonColumns.length > 0) {
  // إعادة إنشاء الجدول بالشكل الصحيح
  newDb.exec('DROP TABLE IF EXISTS learned_lessons');
  
  const createSql = `CREATE TABLE learned_lessons (${lessonColumns.map(c => {
    if (c === 'id') return 'id INTEGER PRIMARY KEY';
    return `${c} TEXT`;
  }).join(', ')})`;
  
  newDb.exec(createSql);
  
  migrateTableBatch('learned_lessons', 'learned_lessons', lessonColumns);
}

// 3. نقل indicator_trust_scores
console.log('\n========================================');
console.log('3. indicator_trust_scores (10 سجل)');
console.log('========================================');

let indColumns = [];
try {
  const sample = oldDb.prepare('SELECT * FROM indicator_trust_scores LIMIT 1').get();
  if (sample) {
    indColumns = Object.keys(sample);
    console.log('الأعمدة:', indColumns.join(', '));
  }
} catch (e) {}

if (indColumns.length > 0) {
  // إعادة إنشاء الجدول بالشكل الصحيح
  newDb.exec('DROP TABLE IF EXISTS indicator_trust_scores');
  
  const createSql = `CREATE TABLE indicator_trust_scores (${indColumns.map(c => {
    if (c === 'id') return 'id INTEGER PRIMARY KEY';
    return `${c} TEXT`;
  }).join(', ')})`;
  
  newDb.exec(createSql);
  
  migrateTableBatch('indicator_trust_scores', 'indicator_trust_scores', indColumns);
}

// الملخص النهائي
console.log('\n========================================');
console.log('الملخص النهائي في stocks.db');
console.log('========================================');

const summary = [
  'prediction_logs',
  'signal_logs', 
  'outcome_logs',
  'learned_lessons',
  'indicator_trust_scores',
  'ExpertRecommendation'
];

summary.forEach(table => {
  try {
    const count = newDb.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get();
    console.log(`${table}: ${count.cnt.toLocaleString()} سجل`);
  } catch (e) {
    console.log(`${table}: غير موجود`);
  }
});

oldDb.close();
newDb.close();

console.log('\n✅ تم الانتهاء من النقل');
