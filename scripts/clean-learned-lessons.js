#!/usr/bin/env node
/**
 * سكريبت تنظيف learned_lessons
 * يمسح كل التجارب الفاشلة
 * 
 * Usage: node scripts/clean-learned-lessons.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'db', 'stocks.db');

console.log('========================================');
console.log('تنظيف learned_lessons');
console.log('========================================\n');

const db = new Database(DB_PATH);

// تحليل البيانات قبل التنظيف
console.log('=== تحليل البيانات قبل التنظيف ===');

const beforeCount = db.prepare('SELECT COUNT(*) as cnt FROM learned_lessons').get().cnt;
console.log('إجمالي الدروس:', beforeCount);

// إحصائيات حسب الحالة
try {
  const statusStats = db.prepare(`
    SELECT status, COUNT(*) as cnt 
    FROM learned_lessons 
    GROUP BY status
  `).all();
  console.log('\nحسب الحالة:');
  statusStats.forEach(s => console.log(`  ${s.status}: ${s.cnt}`));
} catch(e) {
  console.log('خطأ في الإحصائيات:', e.message);
}

console.log('\n========================================');
console.log('بدء التنظيف...');
console.log('========================================\n');

// مسح كل الدروس اللي status = testing
try {
  const stmt = db.prepare("DELETE FROM learned_lessons WHERE status = 'testing'");
  const result = stmt.run();
  console.log('✅ تم مسح', result.changes, 'سجل');
} catch(e) {
  console.log('خطأ:', e.message);
}

// النتيجة النهائية
const afterCount = db.prepare('SELECT COUNT(*) as cnt FROM learned_lessons').get().cnt;
console.log('\n=== النتيجة النهائية ===');
console.log('قبل:', beforeCount, 'سجل');
console.log('بعد:', afterCount, 'سجل');
console.log('تم مسح:', beforeCount - afterCount, 'سجل');

// التحقق من باقي الجداول
console.log('\n=== حالة كل الجداول ===');
const tables = [
  'prediction_logs',
  'signal_logs', 
  'outcome_logs',
  'learned_lessons',
  'indicator_trust_scores',
  'ExpertRecommendation'
];

tables.forEach(t => {
  try {
    const count = db.prepare(`SELECT COUNT(*) as cnt FROM ${t}`).get();
    console.log(`${t}: ${count.cnt} سجل`);
  } catch(e) {
    console.log(`${t}: غير موجود أو خطأ`);
  }
});

db.close();

console.log('\n✅ تم الانتهاء!');
