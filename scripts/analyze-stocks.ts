import { Database } from 'bun:sqlite';

const egxDb = new Database('/home/z/my-project/db/stocks.db', { readonly: true });
const basicDb = new Database('/home/z/my-project/upload/basic.db', { readonly: true });

// Check stocks table structure in stocks
console.log('=== EGX Investment Stocks Table Structure ===');
const egxColumns = egxDb.query("PRAGMA table_info(stocks)").all() as { name: string, type: string }[];
egxColumns.forEach(c => console.log(`  ${c.name}: ${c.type}`));

// Check stocks table structure in basic
console.log('\n=== Basic.db Stocks Table Structure ===');
const basicColumns = basicDb.query("PRAGMA table_info(stocks)").all() as { name: string, type: string }[];
basicColumns.forEach(c => console.log(`  ${c.name}: ${c.type}`));

// Get exchange breakdown from basic.db
console.log('\n=== Exchange Breakdown (basic.db) ===');
const exchanges = basicDb.query("SELECT exchange, COUNT(*) as count FROM stocks GROUP BY exchange ORDER BY count DESC").all() as { exchange: string, count: number }[];
exchanges.forEach(e => console.log(`  ${e.exchange}: ${e.count}`));

// Sample EGX stocks
console.log('\n=== Sample EGX Stocks ===');
const egxSamples = egxDb.query("SELECT ticker, name, name_ar, sector, current_price FROM stocks LIMIT 5").all();
egxSamples.forEach(s => console.log(`  ${s.ticker} - ${s.name} (${s.name_ar}) - ${s.sector} - ${s.current_price}`));

// Sample Arab stocks from basic.db
console.log('\n=== Sample Arab Stocks (basic.db) ===');
const basicSamples = basicDb.query("SELECT ticker, name, name_ar, exchange, sector, current_price FROM stocks WHERE exchange != 'EGX' LIMIT 10").all();
basicSamples.forEach(s => console.log(`  ${s.ticker} - ${s.name} (${s.exchange}) - ${s.sector}`));

// Check if basic.db has price history
console.log('\n=== Price History Check ===');
try {
  const egxHistoryCount = egxDb.query("SELECT COUNT(*) as count FROM stock_price_history").get() as { count: number };
  console.log(`  EGX price history: ${egxHistoryCount.count}`);
} catch (e) {
  console.log('  EGX price history: error');
}

try {
  const basicHistoryCount = basicDb.query("SELECT COUNT(*) as count FROM stock_price_history").get() as { count: number };
  console.log(`  Basic price history: ${basicHistoryCount.count}`);
} catch (e) {
  console.log('  Basic price history: error or empty');
}

// Check prediction_logs structure
console.log('\n=== Prediction Logs Structure ===');
const predColumns = egxDb.query("PRAGMA table_info(prediction_logs)").all() as { name: string, type: string }[];
predColumns.slice(0, 10).forEach(c => console.log(`  ${c.name}: ${c.type}`));
console.log('  ... (more columns)');

egxDb.close();
basicDb.close();
import { Database } from 'bun:sqlite';

const egxDb = new Database('/home/z/my-project/db/egx_investment.db', { readonly: true });
const basicDb = new Database('/home/z/my-project/upload/basic.db', { readonly: true });

// Check stocks table structure in egx_investment
console.log('=== EGX Investment Stocks Table Structure ===');
const egxColumns = egxDb.query("PRAGMA table_info(stocks)").all() as { name: string, type: string }[];
egxColumns.forEach(c => console.log(`  ${c.name}: ${c.type}`));

// Check stocks table structure in basic
console.log('\n=== Basic.db Stocks Table Structure ===');
const basicColumns = basicDb.query("PRAGMA table_info(stocks)").all() as { name: string, type: string }[];
basicColumns.forEach(c => console.log(`  ${c.name}: ${c.type}`));

// Get exchange breakdown from basic.db
console.log('\n=== Exchange Breakdown (basic.db) ===');
const exchanges = basicDb.query("SELECT exchange, COUNT(*) as count FROM stocks GROUP BY exchange ORDER BY count DESC").all() as { exchange: string, count: number }[];
exchanges.forEach(e => console.log(`  ${e.exchange}: ${e.count}`));

// Sample EGX stocks
console.log('\n=== Sample EGX Stocks ===');
const egxSamples = egxDb.query("SELECT ticker, name, name_ar, sector, current_price FROM stocks LIMIT 5").all();
egxSamples.forEach(s => console.log(`  ${s.ticker} - ${s.name} (${s.name_ar}) - ${s.sector} - ${s.current_price}`));

// Sample Arab stocks from basic.db
console.log('\n=== Sample Arab Stocks (basic.db) ===');
const basicSamples = basicDb.query("SELECT ticker, name, name_ar, exchange, sector, current_price FROM stocks WHERE exchange != 'EGX' LIMIT 10").all();
basicSamples.forEach(s => console.log(`  ${s.ticker} - ${s.name} (${s.exchange}) - ${s.sector}`));

// Check if basic.db has price history
console.log('\n=== Price History Check ===');
try {
  const egxHistoryCount = egxDb.query("SELECT COUNT(*) as count FROM stock_price_history").get() as { count: number };
  console.log(`  EGX price history: ${egxHistoryCount.count}`);
} catch (e) {
  console.log('  EGX price history: error');
}

try {
  const basicHistoryCount = basicDb.query("SELECT COUNT(*) as count FROM stock_price_history").get() as { count: number };
  console.log(`  Basic price history: ${basicHistoryCount.count}`);
} catch (e) {
  console.log('  Basic price history: error or empty');
}

// Check prediction_logs structure
console.log('\n=== Prediction Logs Structure ===');
const predColumns = egxDb.query("PRAGMA table_info(prediction_logs)").all() as { name: string, type: string }[];
predColumns.slice(0, 10).forEach(c => console.log(`  ${c.name}: ${c.type}`));
console.log('  ... (more columns)');

egxDb.close();
basicDb.close();
