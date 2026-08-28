/**
 * Seed Expert Recommendations
 * يضيف توقعات خبراء تجريبية للعرض
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { randomUUID } from 'crypto';

const STOCKS_DB = path.join(process.cwd(), 'db', 'stocks.db');

// Sample expert recommendations
const SAMPLE_RECOMMENDATIONS = [
  { symbol: 'COMI', name: 'البنك التجاري الدولي', expert: 'محلل A', action: 'BUY', entry: 45.50, target: 52.00, stop: 42.00 },
  { symbol: 'ETAL', name: 'الصناعات المعدنية', expert: 'محلل B', action: 'BUY', entry: 12.30, target: 15.00, stop: 11.00 },
  { symbol: 'AMER', name: 'أموك', expert: 'محلل A', action: 'BUY', entry: 28.75, target: 35.00, stop: 25.00 },
  { symbol: 'HRHO', name: 'هيرمس', expert: 'محلل C', action: 'SELL', entry: 18.20, target: 15.00, stop: 20.00 },
  { symbol: 'ESRS', name: 'الإسكندرية للأغذية', expert: 'محلل B', action: 'BUY', entry: 35.00, target: 42.00, stop: 32.00 },
  { symbol: 'SWDY', name: 'السويدي الكهربائية', expert: 'محلل A', action: 'BUY', entry: 8.50, target: 10.50, stop: 7.50 },
  { symbol: 'PHDC', name: 'بالم هيلز', expert: 'محلل C', action: 'BUY', entry: 4.80, target: 6.00, stop: 4.20 },
  { symbol: 'ORHD', name: 'أورا هيدرو', expert: 'محلل B', action: 'SELL', entry: 1.25, target: 0.90, stop: 1.50 },
  { symbol: 'EMFD', name: 'المتحدة للإسكان', expert: 'محلل A', action: 'BUY', entry: 22.00, target: 28.00, stop: 19.00 },
  { symbol: 'MNHD', name: 'مدينة نصر للإسكان', expert: 'محلل C', action: 'BUY', entry: 45.00, target: 55.00, stop: 40.00 },
];

export async function POST(request: NextRequest) {
  // CRITICAL FIX (2026-08-28): Disabled — generates FAKE expert recommendations
  // (محلل A, محلل B, etc.) with fake prices. This is a financial platform —
  // fake recommendations = legal liability + mixes with real data in stocks.db.
  return NextResponse.json({
    success: false,
    disabled: true,
    error: 'تم إيقاف توليد توقعات الخبراء المُصطنعة — هذا تطبيق إنتاجي',
    message: 'Expert recommendation seeder removed. Use real analyst data only.',
  }, { status: 410 });
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    success: false,
    disabled: true,
    error: 'تم إيقاف توليد توقعات الخبراء المُصطنعة — هذا تطبيق إنتاجي',
  }, { status: 410 });
}

// ─── OLD CODE (disabled — kept for reference) ─────────────────────────────
/*
async function _seedExperts() {
  try {
    const db = new Database(STOCKS_DB);

    // Create table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS ExpertRecommendation (
        id TEXT PRIMARY KEY,
        stock_symbol TEXT NOT NULL,
        stock_name_ar TEXT,
        expert_name TEXT,
        expert_source TEXT,
        action TEXT,
        recommendation_type TEXT DEFAULT 'detailed',
        entry_price REAL,
        entry_price_from REAL,
        entry_price_to REAL,
        entry_condition TEXT,
        target_price REAL,
        target_price_2 REAL,
        investment_target REAL,
        support_level REAL,
        resistance_level REAL,
        expected_profit_min REAL,
        expected_profit_max REAL,
        expected_profit_investment REAL,
        stop_loss REAL,
        stop_loss_condition TEXT,
        technical_analysis TEXT,
        fundamental_analysis TEXT,
        recommendation_reason TEXT,
        session_date TEXT,
        session_type TEXT DEFAULT 'صباحية',
        expected_duration TEXT,
        expected_duration_days INTEGER,
        notes TEXT,
        status TEXT DEFAULT 'PENDING',
        final_price REAL,
        profit_loss_percent REAL,
        hit_target INTEGER DEFAULT 0,
        hit_stop_loss INTEGER DEFAULT 0,
        closed_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        market TEXT DEFAULT 'EGX'
      )
    `);
    
    // Clear existing sample data
    db.exec(`DELETE FROM ExpertRecommendation WHERE expert_name LIKE 'محلل%'`);
    
    // Insert sample recommendations
    const insertStmt = db.prepare(`
      INSERT INTO ExpertRecommendation (
        id, stock_symbol, stock_name_ar, expert_name, action, 
        entry_price, target_price, stop_loss, status, session_date,
        hit_target, hit_stop_loss, profit_loss_percent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const today = new Date().toISOString().split('T')[0];
    let inserted = 0;
    
    for (const rec of SAMPLE_RECOMMENDATIONS) {
      try {
        const id = randomUUID();
        // Randomly set some as closed with results
        const isClosed = Math.random() > 0.5;
        const isHit = Math.random() > 0.4;
        const status = isClosed ? (isHit ? 'TARGET_HIT' : 'STOPPED') : 'PENDING';
        const plPercent = isClosed ? (isHit ? Math.random() * 15 + 5 : -(Math.random() * 10 + 3)) : 0;
        
        insertStmt.run(
          id,
          rec.symbol,
          rec.name,
          rec.expert,
          rec.action,
          rec.entry,
          rec.target,
          rec.stop,
          status,
          today,
          isClosed && isHit ? 1 : 0,
          isClosed && !isHit ? 1 : 0,
          plPercent.toFixed(2)
        );
        
        inserted++;
      } catch (e) {
        console.error('Error inserting:', e);
      }
    }
    
    db.close();
    
    return NextResponse.json({
      success: true,
      message: `تم إضافة ${inserted} توقعة خبراء تجريبية`,
      inserted
    });
    
  } catch (error) {
    console.error('[Seed Experts] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 });
  }
}

*/

