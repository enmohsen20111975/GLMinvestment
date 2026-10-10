/**
 * Database Verification Script
 * ============================
 * Run this to verify all databases are working correctly
 * 
 * Usage: bun run scripts/verify-migration.ts
 */

import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

const DB_DIR = path.join(process.cwd(), 'db');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function checkDatabase(dbName: string, checks: { table: string; minRows?: number; critical?: boolean }[]) {
  const dbPath = path.join(DB_DIR, dbName);
  
  if (!fs.existsSync(dbPath)) {
    log(`\n❌ ${dbName} - NOT FOUND`, colors.red);
    return false;
  }
  
  const size = fs.statSync(dbPath).size;
  log(`\n📁 ${dbName} (${(size / 1024).toFixed(1)} KB):`, colors.blue);
  
  const db = new Database(dbPath);
  let allPassed = true;
  
  for (const check of checks) {
    try {
      const countResult = db.prepare(`SELECT COUNT(*) as cnt FROM ${check.table}`).get() as { cnt: number };
      const count = countResult?.cnt || 0;
      const minRows = check.minRows || 0;
      
      if (count >= minRows) {
        log(`  ✅ ${check.table}: ${count} rows`, colors.green);
      } else if (check.critical) {
        log(`  ❌ ${check.table}: ${count} rows (need ≥ ${minRows})`, colors.red);
        allPassed = false;
      } else {
        log(`  ⚠️  ${check.table}: ${count} rows (need ≥ ${minRows})`, colors.yellow);
      }
    } catch (e) {
      if (check.critical) {
        log(`  ❌ ${check.table}: Error - ${e}`, colors.red);
        allPassed = false;
      } else {
        log(`  ⚠️  ${check.table}: Error - ${e}`, colors.yellow);
      }
    }
  }
  
  db.close();
  return allPassed;
}

function testPredictionPerformance() {
  log('\n🧪 Testing prediction-performance data...', colors.cyan);
  
  const predictionsPath = path.join(DB_DIR, 'predictions.db');
  if (!fs.existsSync(predictionsPath)) {
    log('  ❌ predictions.db not found', colors.red);
    return false;
  }
  
  const db = new Database(predictionsPath);
  
  // AI Predictions stats
  try {
    const aiStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) as hit_target,
        SUM(CASE WHEN hit_stop_loss = 1 THEN 1 ELSE 0 END) as hit_stop_loss
      FROM aiPrediction
    `).get() as { total: number; pending: number; hit_target: number; hit_stop_loss: number };
    
    log(`\n  📊 AI Predictions:`, colors.blue);
    log(`     Total: ${aiStats.total}`, colors.reset);
    log(`     Pending: ${aiStats.pending}`, colors.reset);
    log(`     Hit Target: ${aiStats.hit_target}`, colors.reset);
    log(`     Hit Stop Loss: ${aiStats.hit_stop_loss}`, colors.reset);
    
    if (aiStats.total > 0) {
      const closed = aiStats.hit_target + aiStats.hit_stop_loss;
      const successRate = closed > 0 ? (aiStats.hit_target / closed * 100).toFixed(1) : '0';
      log(`     Success Rate: ${successRate}%`, colors.green);
    }
  } catch (e) {
    log(`  ❌ Error querying aiPrediction: ${e}`, colors.red);
  }
  
  // Expert Recommendations stats
  try {
    const expertStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'PENDING' OR status = 'ACTIVE' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) as hit_target,
        SUM(CASE WHEN hit_stop_loss = 1 THEN 1 ELSE 0 END) as hit_stop_loss
      FROM expertRecommendation
    `).get() as { total: number; pending: number; hit_target: number; hit_stop_loss: number };
    
    log(`\n  📊 Expert Recommendations:`, colors.blue);
    log(`     Total: ${expertStats.total}`, colors.reset);
    log(`     Pending/Active: ${expertStats.pending}`, colors.reset);
    log(`     Hit Target: ${expertStats.hit_target}`, colors.reset);
    log(`     Hit Stop Loss: ${expertStats.hit_stop_loss}`, colors.reset);
    
    if (expertStats.total > 0) {
      const closed = expertStats.hit_target + expertStats.hit_stop_loss;
      const successRate = closed > 0 ? (expertStats.hit_target / closed * 100).toFixed(1) : '0';
      log(`     Success Rate: ${successRate}%`, colors.green);
    }
  } catch (e) {
    log(`  ❌ Error querying expertRecommendation: ${e}`, colors.red);
  }
  
  db.close();
  return true;
}

function testUsersData() {
  log('\n🧪 Testing users data...', colors.cyan);
  
  const authPath = path.join(DB_DIR, 'auth.db');
  if (!fs.existsSync(authPath)) {
    log('  ❌ auth.db not found', colors.red);
    return false;
  }
  
  const db = new Database(authPath);
  
  try {
    const userStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active
      FROM User
    `).get() as { total: number; active: number };
    
    log(`  📊 Users: ${userStats.total} total, ${userStats.active} active`, colors.green);
    
    // Sample users
    const sampleUsers = db.prepare(`
      SELECT email, name, subscription_tier, created_at 
      FROM User 
      LIMIT 5
    `).all() as { email: string; name: string; subscription_tier: string; created_at: string }[];
    
    if (sampleUsers.length > 0) {
      log(`  📋 Sample users:`, colors.blue);
      for (const user of sampleUsers) {
        log(`     - ${user.email} (${user.subscription_tier})`, colors.reset);
      }
    }
  } catch (e) {
    log(`  ❌ Error querying users: ${e}`, colors.red);
  }
  
  db.close();
  return true;
}

function testStocksData() {
  log('\n🧪 Testing stocks data...', colors.cyan);
  
  const stocksPath = path.join(DB_DIR, 'stocks.db');
  if (!fs.existsSync(stocksPath)) {
    log('  ❌ stocks.db not found', colors.red);
    return false;
  }
  
  const db = new Database(stocksPath);
  
  try {
    const stockStats = db.prepare(`
      SELECT 
        market,
        COUNT(*) as count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active
      FROM stocks
      GROUP BY market
      ORDER BY count DESC
    `).all() as { market: string; count: number; active: number }[];
    
    log(`  📊 Stocks by market:`, colors.blue);
    for (const stat of stockStats) {
      log(`     - ${stat.market}: ${stat.count} total, ${stat.active} active`, colors.reset);
    }
  } catch (e) {
    log(`  ❌ Error querying stocks: ${e}`, colors.red);
  }
  
  db.close();
  return true;
}

// Main
async function main() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('🔍 EGX Investment - Database Verification', colors.cyan);
  log('='.repeat(60), colors.cyan);
  
  // Check all databases
  const allPassed = [
    checkDatabase('auth.db', [
      { table: 'User', minRows: 1, critical: true },
      { table: 'Session', minRows: 0 },
      { table: 'SubscriptionPlan', minRows: 0 },
    ]),
    checkDatabase('predictions.db', [
      { table: 'aiPrediction', minRows: 1, critical: true },
      { table: 'expertRecommendation', minRows: 1, critical: true },
      { table: 'expertTrackRecord', minRows: 0 },
    ]),
    checkDatabase('stocks.db', [
      { table: 'stocks', minRows: 100, critical: true },
    ]),
    checkDatabase('price_history.db', [
      { table: 'price_history', minRows: 1000 },
    ]),
    checkDatabase('analytics.db', [
      { table: 'analytics_events', minRows: 0 },
    ]),
  ].every(x => x);
  
  // Test specific features
  testPredictionPerformance();
  testUsersData();
  testStocksData();
  
  log('\n' + '='.repeat(60), colors.cyan);
  if (allPassed) {
    log('✅ ALL CRITICAL CHECKS PASSED!', colors.green);
  } else {
    log('❌ SOME CHECKS FAILED - Review above', colors.red);
  }
  log('='.repeat(60) + '\n', colors.cyan);
}

main();
