#!/usr/bin/env node
/**
 * سكربت نقل التوقعات من stocks.db لstocks.db
 * 
 * Usage: node scripts/migrate-predictions-from-old-db.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const OLD_DB_PATH = path.join(process.cwd(), 'db', 'stocks.db');
const NEW_DB_PATH = path.join(process.cwd(), 'db', 'stocks.db');

console.log('========================================');
console.log('نقل التوقعات من stocks.db لstocks.db');
console.log('========================================\n');

// التحقق من وجود القاعدة القديمة
if (!fs.existsSync(OLD_DB_PATH)) {
  console.error('❌ stocks.db غير موجودة!');
  process.exit(1);
}

const oldDb = new Database(OLD_DB_PATH, { readonly: true });
const newDb = new Database(NEW_DB_PATH);

console.log('✓ تم فتح القاعدتين\n');

// فحص الأعمدة الموجودة فى prediction_logs
console.log('--- فحص أعمدة prediction_logs ---');
const columns = oldDb.prepare("PRAGMA table_info(prediction_logs)").all();
const columnNames = columns.map(c => c.name);
console.log('الأعمدة الموجودة:', columnNames.join(', '));

// بناء الاستعلام بناءً على الأعمدة المتاحة
const selectFields = [
  'id', 'ticker', 'prediction_date', 'recommendation', 'predicted_direction',
  'confidence', 'entry_price', 'target_price', 'stop_loss',
  'direction_correct_5d', 'direction_correct_10d', 'target_reached', 'stop_hit',
  'actual_price_5d', 'actual_price_10d'
];

// إضافة أعمدة اختيارية لو موجودة
if (columnNames.includes('notes')) selectFields.push('notes');
if (columnNames.includes('created_at')) selectFields.push('created_at');
if (columnNames.includes('verified_at')) selectFields.push('verified_at');

const selectSQL = `SELECT ${selectFields.join(', ')} FROM prediction_logs ORDER BY prediction_date DESC`;

// جلب البيانات
console.log('\n--- جلب البيانات ---');
const oldPredictions = oldDb.prepare(selectSQL).all();
console.log('تم جلب', oldPredictions.length, 'توقع');

// إحصائيات
const verified = oldPredictions.filter(p => p.verified_at).length;
const pending = oldPredictions.filter(p => !p.verified_at).length;
const targetReached = oldPredictions.filter(p => p.target_reached === 1).length;
const stopHit = oldPredictions.filter(p => p.stop_hit === 1).length;

console.log('- تم التحقق:', verified);
console.log('- قيد الانتظار:', pending);
console.log('- حققت الهدف:', targetReached);
console.log('- وقف خسارة:', stopHit);

// إنشاء الجدول فى القاعدة الجديدة
console.log('\n--- إنشاء الجدول فى stocks.db ---');

newDb.exec(`
  CREATE TABLE IF NOT EXISTS prediction_logs (
    id TEXT PRIMARY KEY,
    ticker TEXT NOT NULL,
    prediction_date TEXT,
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
    created_at TEXT DEFAULT (datetime('now')),
    verified_at TEXT
  )
`);

newDb.exec(`CREATE INDEX IF NOT EXISTS idx_pred_ticker ON prediction_logs(ticker)`);
newDb.exec(`CREATE INDEX IF NOT EXISTS idx_pred_date ON prediction_logs(prediction_date)`);
newDb.exec(`CREATE INDEX IF NOT EXISTS idx_pred_rec ON prediction_logs(recommendation)`);

console.log('✓ تم إنشاء الجدول');

// نقل البيانات
console.log('\n--- نقل البيانات ---');

// حذف البيانات القديمة
newDb.exec('DELETE FROM prediction_logs');

const insertPred = newDb.prepare(`
  INSERT INTO prediction_logs (
    id, ticker, prediction_date, recommendation, predicted_direction,
    confidence, entry_price, target_price, stop_loss,
    direction_correct_5d, direction_correct_10d, target_reached, stop_hit,
    actual_price_5d, actual_price_10d, notes, created_at, verified_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertMany = newDb.transaction((preds) => {
  for (const p of preds) {
    insertPred.run(
      p.id || `pred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      p.ticker,
      p.prediction_date,
      p.recommendation,
      p.predicted_direction,
      p.confidence,
      p.entry_price,
      p.target_price,
      p.stop_loss,
      p.direction_correct_5d || 0,
      p.direction_correct_10d || 0,
      p.target_reached || 0,
      p.stop_hit || 0,
      p.actual_price_5d,
      p.actual_price_10d,
      p.notes || null,
      p.created_at,
      p.verified_at
    );
  }
});

insertMany(oldPredictions);
console.log('✓ تم نقل', oldPredictions.length, 'توقع');

// التحقق النهائى
console.log('\n========================================');
console.log('النتيجة النهائية');
console.log('========================================');

const finalPred = newDb.prepare('SELECT COUNT(*) as cnt FROM prediction_logs').get();
console.log('prediction_logs:', finalPred.cnt, 'سجل');

// إحصائيات التوقعات
const stats = newDb.prepare(`
  SELECT 
    recommendation,
    COUNT(*) as total,
    SUM(CASE WHEN target_reached = 1 THEN 1 ELSE 0 END) as target_reached,
    SUM(CASE WHEN stop_hit = 1 THEN 1 ELSE 0 END) as stop_hit,
    SUM(CASE WHEN direction_correct_5d = 1 THEN 1 ELSE 0 END) as correct_5d
  FROM prediction_logs
  GROUP BY recommendation
`).all();

console.log('\nإحصائيات التوقعات:');
stats.forEach(s => {
  const success = s.target_reached + s.stop_hit;
  const rate = success > 0 ? ((s.target_reached / success) * 100).toFixed(1) : 0;
  console.log(`- ${s.recommendation || 'NULL'}: ${s.total} توقع، ${s.target_reached} نجح، ${s.stop_hit} خسارة، نسبة النجاح: ${rate}%`);
});

// إغلاق القواعد
oldDb.close();
newDb.close();

console.log('\n✅ تم الانتهاء بنجاح!');
console.log('\n⚠️ القاعدة القديمة stocks.db لم يتم حذفها');
console.log('   لو البيانات صحيحة، يمكنك حذفها يدوياً: rm db/stocks.db');
