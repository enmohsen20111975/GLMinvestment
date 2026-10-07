import { Database } from 'bun:sqlite';

const basicDb = new Database('/home/z/my-project/upload/basic.db', { readonly: true });

// Get exchange breakdown from basic.db
console.log('=== Exchange Breakdown (basic.db) ===');
const exchanges = basicDb.query("SELECT exchange_code, COUNT(*) as count FROM stocks GROUP BY exchange_code ORDER BY count DESC").all() as { exchange_code: string, count: number }[];
exchanges.forEach(e => console.log(`  ${e.exchange_code}: ${e.count}`));

// Sample Arab stocks from basic.db
console.log('\n=== Sample Arab Stocks (basic.db) ===');
const basicSamples = basicDb.query("SELECT ticker, name, name_ar, exchange_code, country, sector, current_price FROM stocks WHERE exchange_code != 'EGX' OR exchange_code IS NULL LIMIT 20").all();
basicSamples.forEach(s => console.log(`  ${s.ticker} - ${s.name} (${s.exchange_code || 'N/A'}, ${s.country || 'N/A'})`));

// Check if EGX stocks are duplicated
console.log('\n=== EGX Stocks in basic.db ===');
const egxInBasic = basicDb.query("SELECT COUNT(*) as count FROM stocks WHERE exchange_code = 'EGX'").get() as { count: number };
console.log(`  EGX stocks in basic.db: ${egxInBasic.count}`);

// Check country field
console.log('\n=== Country Breakdown ===');
const countries = basicDb.query("SELECT country, COUNT(*) as count FROM stocks GROUP BY country ORDER BY count DESC").all() as { country: string, count: number }[];
countries.forEach(c => console.log(`  ${c.country || 'NULL'}: ${c.count}`));

basicDb.close();
