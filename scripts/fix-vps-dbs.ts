#!/usr/bin/env bun
/**
 * Fix VPS Databases
 * =================
 * 
 * سكربت لإصلاح قواعد البيانات على VPS
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const DB_DIR = join(process.cwd(), 'db');

console.log('🔧 إصلاح قواعد البيانات...\n');

// 1. فك ضغط price_history.db
const priceHistoryGz = join(DB_DIR, 'price_history.db.gz');
const priceHistoryDb = join(DB_DIR, 'price_history.db');

if (existsSync(priceHistoryGz) && !existsSync(priceHistoryDb)) {
  console.log('📦 فك ضغط price_history.db...');
  try {
    execSync(`gunzip -k -f "${priceHistoryGz}"`, { stdio: 'inherit' });
    console.log('✅ تم فك ضغط price_history.db');
  } catch (e) {
    // gunzip -k مش مدعوم في بعض الإصدارات
    try {
      execSync(`cd "${DB_DIR}" && gunzip -f price_history.db.gz`, { stdio: 'inherit' });
      console.log('✅ تم فك ضغط price_history.db');
    } catch (e2) {
      console.log('⚠️ تعذر فك ضغط price_history.db');
    }
  }
}

// 2. فك ضغط learned.db
const learnedGz = join(DB_DIR, 'learned.db.gz');
const learnedDb = join(DB_DIR, 'learned.db');

if (existsSync(learnedGz) && !existsSync(learnedDb)) {
  console.log('📦 فك ضغط learned.db...');
  try {
    execSync(`gunzip -k -f "${learnedGz}"`, { stdio: 'inherit' });
    console.log('✅ تم فك ضغط learned.db');
  } catch (e) {
    try {
      execSync(`cd "${DB_DIR}" && gunzip -f learned.db.gz`, { stdio: 'inherit' });
      console.log('✅ تم فك ضغط learned.db');
    } catch (e2) {
      console.log('⚠️ تعذر فك ضغط learned.db');
    }
  }
}

console.log('\n✨ تم الإصلاح!\n');
console.log('الآن شغّل:');
console.log('  bunx prisma db push');
console.log('  pm2 restart all');
