#!/usr/bin/env node
/**
 * سكريبت إدخال توصيات الخبراء
 * Usage: node scripts/seed-expert-recommendations.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('crypto').randomUUID ? require('crypto').randomUUID : () => Date.now().toString(36) + Math.random().toString(36).substr(2);

const DB_PATH = path.join(process.cwd(), 'db', 'stocks.db');

console.log('========================================');
console.log('إدخال توصيات الخبراء');
console.log('========================================\n');

const db = new Database(DB_PATH);

// إنشاء جدول الخبراء
db.exec(`
  CREATE TABLE IF NOT EXISTS ExpertRecommendation (
    id TEXT PRIMARY KEY,
    stock_symbol TEXT NOT NULL,
    stock_name_ar TEXT,
    expert_name TEXT NOT NULL DEFAULT 'خبير محلل',
    action TEXT NOT NULL,
    recommendation_type TEXT DEFAULT 'detailed',
    entry_price REAL,
    entry_price_from REAL,
    entry_price_to REAL,
    target_price REAL,
    target_price_2 REAL,
    investment_target REAL,
    stop_loss REAL,
    support_level REAL,
    resistance_level REAL,
    session_date TEXT,
    status TEXT DEFAULT 'PENDING',
    final_price REAL,
    profit_loss_percent REAL,
    hit_target INTEGER DEFAULT 0,
    hit_stop_loss INTEGER DEFAULT 0,
    notes TEXT,
    recommendation_date TEXT DEFAULT (datetime('now')),
    closed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_expert_symbol ON ExpertRecommendation(stock_symbol)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_expert_status ON ExpertRecommendation(status)`);

console.log('✅ تم إنشاء جدول ExpertRecommendation\n');

// بيانات التوصيات
const recommendations = [
  // التوصيات النشطة والمحققة
  { symbol: 'EHDR', name: 'المصريين للإسكان', type: 'دعم / ارتداد', entry: 2.27, status: 'PENDING', notes: 'اغلاق قرب دعم مهم جداً', date: '2026-05-19' },
  { symbol: 'FWRY', name: 'فوري', type: 'دعم / ارتداد', entry: 19.35, status: 'PENDING', notes: 'اغلاق قرب دعم مهم', date: '2026-05-19' },
  { symbol: 'EGTS', name: 'زهراء المعادي', type: 'دعم / ارتداد', entry: 6.09, status: 'PENDING', notes: 'قافل عند الدعم بالملي', date: '2026-05-19' },
  { symbol: 'SWDY', name: 'السويدي إلكتريك', type: 'شراء واحتفاظ', entry: 88.15, entry_from: 88.00, entry_to: 88.90, target: 91, target_2: 91.4, stop: 86.5, status: 'PENDING', notes: 'هدف استثماري 94.50', date: '2026-05-20' },
  { symbol: 'ETEL', name: 'المصرية للاتصالات', type: 'شراء واحتفاظ', entry: 94.75, entry_from: 94.50, entry_to: 95.75, target: 99, target_2: 101.8, stop: 91.00, status: 'PENDING', notes: 'هدف استثماري 107.75', date: '2026-05-20' },
  { symbol: 'RACC', name: 'راية خدمات', type: 'شراء واحتفاظ', entry: 9.96, entry_from: 9.92, entry_to: 10.10, target: 10.3, target_2: 10.55, stop: 9.70, status: 'PENDING', notes: 'هدف استثماري 11.00', date: '2026-05-25' },
  { symbol: 'DSCW', name: 'دايس للملابس', type: 'شراء واحتفاظ', entry: 1.73, target: 1.94, target_2: 1.97, stop: 1.68, status: 'PENDING', notes: 'هدف استثماري 2.02', date: '2026-05-25' },
  { symbol: 'EFIH', name: 'إي فاينانس', type: 'شراء واحتفاظ', entry: 22.10, entry_from: 22.00, entry_to: 22.50, target: 23.65, target_2: 24.5, stop: 21.30, status: 'PENDING', date: '2026-06-01' },
  { symbol: 'ORHD', name: 'أوراسكوم للتنمية', type: 'شراء واحتفاظ', entry: 35.80, entry_from: 35.10, entry_to: 37.85, target: 39, target_2: 39.5, stop: 34.70, status: 'PENDING', notes: 'هدف استثماري 42.00', date: '2026-06-01' },
  { symbol: 'MTIE', name: 'إم إم جروب', type: 'شراء واحتفاظ', entry: 8.95, entry_from: 8.90, entry_to: 9.20, target: 9.55, target_2: 9.85, stop: null, support: 8.8, status: 'PENDING', notes: 'هدف استثماري 10.25', date: '2026-06-01' },
  { symbol: 'BTFH', name: 'بلتون القابضة', type: 'T+1 / مضاربة', entry: 3.19, entry_from: 3.18, entry_to: 3.20, target: 3.35, target_2: 3.52, stop: 3.15, status: 'PENDING', notes: 'T+1 لجلسة 3/6', date: '2026-06-02' },
  { symbol: 'EGCH', name: 'كيما', type: 'شراء واحتفاظ', entry: 14.63, entry_from: 14.60, entry_to: 14.95, target: 15.6, target_2: 15.9, stop: 14.25, status: 'CLOSED', notes: 'هدف استثماري 16.50. وصل 15.15 ✅', date: '2026-06-03' },
  { symbol: 'ACAMD', name: 'العربية للأصول', type: 'شراء واحتفاظ', entry: 2.27, entry_from: 2.25, entry_to: 2.30, target: 2.40, target_2: 2.55, stop: 2.21, status: 'PENDING', notes: 'ورقة من بداية الأسبوع', date: '2026-06-03' },
  
  // التوصيات المحققة
  { symbol: 'IBNF', name: 'ابن سينا فارما', type: 'T+1 / مضاربة', entry: 11.86, target: 12.2, target_2: 12.52, stop: 11.6, status: 'TARGET_HIT', notes: 'T+1 لجلسة 3/6. الهدف 12.20 ✅', date: '2026-06-02' },
  { symbol: 'EGTS', name: 'زهراء المعادي', type: 'T+1 / مضاربة', entry: 6.04, entry_from: 6.00, target: 6.33, target_2: 6.5, stop: 5.95, status: 'TARGET_HIT', notes: 'T+1 لجلسة 3/6. تريدات زيرو 6.22 ✅', date: '2026-06-02' },
  { symbol: 'EHDR', name: 'المصريين للإسكان', type: 'شراء واحتفاظ', entry: 2.36, entry_from: 2.35, entry_to: 2.43, target: 2.56, target_2: 2.6, stop: 2.27, status: 'TARGET_HIT', notes: 'هدف استثماري 2.75. وصل 2.60 ✅', date: '2026-06-03' },
  { symbol: 'EGTS', name: 'زهراء المعادي', type: 'مضاربة لحظية', entry: 6.14, target: 6.22, target_2: 6.33, stop: 6.0, status: 'TARGET_HIT', notes: 'تريدات زيرو ✅', date: '2026-06-03' },
  { symbol: 'ETQA', name: 'عتاقة', type: 'تريدة T+1', entry: 9.75, target: 10.25, target_2: 10.4, stop: 9.67, status: 'TARGET_HIT', notes: 'أسرع صفقات زيرو ✅', date: '2026-06-03' },
];

// الصفقات المنفذة
const trades = [
  { symbol: 'ABUK', name: 'أبو قير للأسمدة', action: 'SELL', price: 86.5, buy_price: 87.22, pnl: -0.83, notes: 'خسارة -0.72 (-0.83%)', date: '2026-05-11' },
  { symbol: 'DSCW', name: 'دايس للملابس', action: 'AVG_BUY', price: 1.87, notes: 'متوسط شراء', date: '2026-05-17' },
  { symbol: 'RACC', name: 'راية خدمات', action: 'SELL', price: 9.99, notes: 'بيع', date: '2026-05-18' },
  { symbol: 'KRDI', name: 'نهر الخير', action: 'AVG_BUY', price: 0.343, notes: 'متوسط شراء', date: '2026-05-18' },
  { symbol: 'MOED', name: 'المصرية لنظم التعليم', action: 'BUY', price: 0.748, notes: 'شراء', date: '2026-05-19' },
  { symbol: 'DSCW', name: 'دايس للملابس', action: 'AVG_BUY', price: 1.82, notes: 'متوسط ثاني على DSCW', date: '2026-05-19' },
  { symbol: 'VALU', name: 'فاليو', action: 'BUY', price: 11.3, notes: 'شراء', date: '2026-05-20' },
  { symbol: 'MTIE', name: 'إم إم جروب', action: 'AVG_BUY', price: 8.83, notes: 'متوسط شراء', date: '2026-05-20' },
  { symbol: 'TANM', name: 'تنمية', action: 'BUY', price: 4.72, notes: 'شراء', date: '2026-05-21' },
  { symbol: 'VALU', name: 'فاليو', action: 'SELL', price: 11.58, buy_price: 11.3, pnl: 2.48, notes: 'ربح +0.28 (+2.48%)', date: '2026-05-24' },
  { symbol: 'GBCO', name: 'جي بي كورب', action: 'BUY', price: 25.75, notes: 'شراء', date: '2026-05-24' },
  { symbol: 'MOED', name: 'المصرية لنظم التعليم', action: 'AVG_BUY', price: 0.718, notes: 'متوسط أول على MOED', date: '2026-05-24' },
  { symbol: 'DAPH', name: 'دلتا للأدوية', action: 'BUY', price: 80.99, notes: 'شراء', date: '2026-05-25' },
  { symbol: 'TANM', name: 'تنمية', action: 'SELL', price: 4.82, buy_price: 4.72, pnl: 2.12, notes: 'ربح +0.10 (+2.12%)', date: '2026-05-25' },
  { symbol: 'VLMRA', name: 'فلورا', action: 'BUY', price: 28.79, notes: 'شراء', date: '2026-06-01' },
  { symbol: 'GBCO', name: 'جي بي كورب', action: 'SELL', price: 26.84, buy_price: 25.75, pnl: 4.23, notes: 'ربح +1.09 (+4.23%)', date: '2026-06-01' },
  { symbol: 'VLMRA', name: 'فلورا', action: 'SELL', price: 29.43, buy_price: 28.79, pnl: 2.22, notes: 'ربح +0.64 (+2.22%)', date: '2026-06-01' },
  { symbol: 'MOED', name: 'المصرية لنظم التعليم', action: 'AVG_BUY', price: 0.717, notes: 'متوسط ثاني على MOED', date: '2026-06-01' },
  { symbol: 'OBRI', name: 'العبور للإستثمار', action: 'BUY', price: 34.90, notes: 'شراء', date: '2026-06-02' },
  { symbol: 'DSCW', name: 'دايس للملابس', action: 'SELL', price: 1.79, buy_price: 1.845, pnl: -3.2, notes: 'خسارة ~-0.06 (~-3.2%)', date: '2026-06-02' },
  { symbol: 'OBRI', name: 'العبور للإستثمار', action: 'SELL', price: 36.5, buy_price: 34.90, pnl: 4.55, notes: 'ربح +1.55~1.65 (+4.4~4.7%)', date: '2026-06-02' },
  { symbol: 'EAST', name: 'الشرقية إيسترن', action: 'BUY', price: 37.58, notes: 'شراء', date: '2026-06-03' },
  { symbol: 'KRDI', name: 'نهر الخير', action: 'SELL', price: 0.353, buy_price: 0.343, pnl: 2.9, notes: 'ربح +0.01 (+2.9%)', date: '2026-06-03' },
  { symbol: 'MOED', name: 'المصرية لنظم التعليم', action: 'AVG_BUY', price: 0.7, notes: 'متوسط ثالث على MOED. متوسط التكلفة ~0.728', date: '2026-06-03' },
];

// إدخال التوصيات
console.log('إدخال التوصيات...');
const insertRec = db.prepare(`
  INSERT INTO ExpertRecommendation (
    id, stock_symbol, stock_name_ar, action, recommendation_type,
    entry_price, entry_price_from, entry_price_to, target_price, target_price_2,
    stop_loss, support_level, resistance_level, status, notes, recommendation_date
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertMany = db.transaction((items) => {
  for (const r of items) {
    const id = `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    insertRec.run(
      id,
      r.symbol,
      r.name,
      r.type || 'RECOMMENDATION',
      'detailed',
      r.entry || null,
      r.entry_from || null,
      r.entry_to || null,
      r.target || null,
      r.target_2 || null,
      r.stop || null,
      r.support || null,
      r.resistance || null,
      r.status || 'PENDING',
      r.notes || null,
      r.date || new Date().toISOString().split('T')[0]
    );
  }
});

insertMany(recommendations);
console.log(`✅ تم إدخال ${recommendations.length} توصية\n`);

// إدخال الصفقات كتوصيات مغلقة
console.log('إدخال الصفقات المنفذة...');
const insertTrade = db.prepare(`
  INSERT INTO ExpertRecommendation (
    id, stock_symbol, stock_name_ar, action, recommendation_type,
    entry_price, final_price, profit_loss_percent, status, notes, recommendation_date
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertTrades = db.transaction((items) => {
  for (const t of items) {
    const id = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const status = t.action === 'SELL' ? 'CLOSED' : 'ACTIVE';
    insertTrade.run(
      id,
      t.symbol,
      t.name,
      t.action,
      'trade',
      t.buy_price || t.price,
      t.price,
      t.pnl || null,
      status,
      t.notes || null,
      t.date || new Date().toISOString().split('T')[0]
    );
  }
});

insertTrades(trades);
console.log(`✅ تم إدخال ${trades.length} صفقة\n`);

// النتيجة النهائية
const totalRecs = db.prepare('SELECT COUNT(*) as cnt FROM ExpertRecommendation').get();
const pending = db.prepare("SELECT COUNT(*) as cnt FROM ExpertRecommendation WHERE status = 'PENDING'").get();
const targetHit = db.prepare("SELECT COUNT(*) as cnt FROM ExpertRecommendation WHERE status = 'TARGET_HIT'").get();
const closed = db.prepare("SELECT COUNT(*) as cnt FROM ExpertRecommendation WHERE status = 'CLOSED'").get();

console.log('========================================');
console.log('الملخص النهائي');
console.log('========================================');
console.log(`إجمالي التوصيات: ${totalRecs.cnt}`);
console.log(`قيد الانتظار: ${pending.cnt}`);
console.log(`حققت الهدف: ${targetHit.cnt}`);
console.log(`مغلقة: ${closed.cnt}`);

db.close();

console.log('\n✅ تم الانتهاء!');
