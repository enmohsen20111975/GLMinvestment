const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'db', 'data_engine.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

console.log('=== HISTORICAL DATA ===');
try {
    const rows = db.prepare(`
    SELECT market, MIN(date) as min_date, MAX(date) as max_date, 
           COUNT(*) as total, COUNT(DISTINCT symbol) as stocks 
    FROM historical_data GROUP BY market ORDER BY market
  `).all();
    rows.forEach(r => console.log(`${r.market}: ${r.min_date} to ${r.max_date} | ${r.total} records | ${r.stocks} stocks`));
} catch (e) { console.log('Error:', e.message); }

console.log('\n=== DATA FROM JAN 2026 ===');
try {
    const rows = db.prepare(`
    SELECT market, COUNT(DISTINCT symbol), COUNT(*), MIN(date), MAX(date)
    FROM historical_data WHERE date >= '2026-01-01' GROUP BY market
  `).all();
    if (rows.length === 0) console.log('NO DATA from Jan 2026');
    else rows.forEach(r => console.log(`${r.market}: ${r['MIN(date)']} to ${r['MAX(date)']} | ${r['COUNT(*)']} records | ${r['COUNT(DISTINCT symbol)']} stocks`));
} catch (e) { console.log('Error:', e.message); }

console.log('\n=== TECHNICAL ANALYSIS ===');
try {
    const total = db.prepare('SELECT COUNT(*) as c FROM tab_technical_analysis').get();
    console.log('Total:', total.c);
    const ratings = db.prepare('SELECT technical_rating, COUNT(*) as c FROM tab_technical_analysis GROUP BY technical_rating ORDER BY c DESC LIMIT 10').all();
    ratings.forEach(r => console.log(`  ${r.technical_rating}: ${r.c}`));
} catch (e) { console.log('Error:', e.message); }

console.log('\n=== VALUATION ===');
try {
    const total = db.prepare('SELECT COUNT(*) as c FROM tab_valuation').get();
    const withPe = db.prepare(`SELECT COUNT(*) as c FROM tab_valuation WHERE pe_ratio IS NOT NULL AND pe_ratio != ''`).get();
    console.log(`Total: ${total.c}, With PE: ${withPe.c}`);
} catch (e) { console.log('Error:', e.message); }

console.log('\n=== PROFITABILITY ===');
try {
    const total = db.prepare('SELECT COUNT(*) as c FROM tab_profitability').get();
    const withRoe = db.prepare(`SELECT COUNT(*) as c FROM tab_profitability WHERE roe IS NOT NULL AND roe != ''`).get();
    console.log(`Total: ${total.c}, With ROE: ${withRoe.c}`);
} catch (e) { console.log('Error:', e.message); }

console.log('\n=== STOCKS ===');
try {
    const markets = db.prepare('SELECT market, COUNT(*) as c FROM stocks GROUP BY market ORDER BY c DESC').all();
    markets.forEach(r => console.log(`  ${r.market}: ${r.c} stocks`));
} catch (e) { console.log('Error:', e.message); }

db.close();