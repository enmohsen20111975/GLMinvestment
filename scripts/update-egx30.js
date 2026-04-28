const ZAI = require('z-ai-web-dev-sdk').default;
const Database = require('better-sqlite3');

function parseNum(s) {
  if (!s) return null;
  return parseFloat(String(s).replace(/,/g, ''));
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function invokeWithRetry(zai, query, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await zai.functions.invoke('web_search', { query, num: 10 });
    } catch (e) {
      if (e.message && e.message.includes('429') && attempt < retries) {
        const wait = 10000 * attempt;
        process.stdout.write(`[RATE-LIMIT wait ${wait/1000}s] `);
        await sleep(wait);
      } else {
        throw e;
      }
    }
  }
}

function parseStockFromResults(results, ticker) {
  for (let i = 0; i < 15; i++) {
    const r = results[i] || results[String(i)];
    if (!r) continue;
    const text = ((r.snippet || '') + ' ' + (r.title || '') + ' ' + (r.content || '') + ' ' + (r.text || '')).toLowerCase();
    const textOrig = ((r.snippet || '') + ' ' + (r.title || '') + ' ' + (r.content || '') + ' ' + (r.text || ''));
    if (!text.includes(ticker.toLowerCase()) && !(r.url || '').includes(ticker)) continue;

    // TradingView: "COMI. Last update: 02:29 PM. 137.47. 3.51. 2.62%. Open 133.99."
    const m1 = textOrig.match(new RegExp(ticker + '\\s*\\).{0,80}?([\\d]+[.,][\\d]+)\\.\\s*([\\d.,]+)\\.\\s*([+-]?[\\d.,]+)%', 'i'));
    if (m1) { const c = parseNum(m1[1]); if (c > 0 && c < 100000) return { close: c, change: parseNum(m1[2]), changePercent: parseNum(m1[3]) }; }

    // "trading at a price of 22.63 EGP"
    const m2 = text.match(/trading at a price of ([\d.,]+)\s*egp/);
    if (m2) { const c = parseNum(m2[1]); if (c > 0 && c < 100000) return { close: c }; }

    // "current price of ORWE is 22.690 EGP"
    const m3 = textOrig.match(new RegExp('current price of\\s+' + ticker + '\\s+is\\s+([\\d.,]+)', 'i'));
    if (m3) { const c = parseNum(m3[1]); if (c > 0 && c < 100000) return { close: c }; }

    // "TICKER. Price 137.47" or "TICKER 137.47 EGP"
    const m4 = textOrig.match(new RegExp(ticker + '[^\\d]{0,20}([\\d]+[.,][\\d]+)\\s*egp', 'i'));
    if (m4) { const c = parseNum(m4[1]); if (c > 0 && c < 100000) return { close: c }; }

    // TradingView: just price after ticker
    const m5 = textOrig.match(new RegExp('\\(' + ticker + '\\)\\s*[.]?\\s*([\\d]+[.,][\\d]+)', 'i'));
    if (m5) { const c = parseNum(m5[1]); if (c > 0 && c < 100000) return { close: c }; }
  }
  return null;
}

async function run() {
  const zai = await ZAI.create();
  const db = new Database('/home/z/my-project/db/egx_investment.db');
  db.pragma('journal_mode = WAL');

  // Only update EGX30 stocks first
  const stocks = db.prepare(`
    SELECT id, ticker, name_ar, current_price, previous_close, volume
    FROM stocks WHERE is_active = 1 AND egx30_member = 1 ORDER BY volume DESC
  `).all();
  console.log('EGX30 stocks to update:', stocks.length);

  let updated = 0;
  for (let i = 0; i < stocks.length; i += 5) {
    const batch = stocks.slice(i, i + 5);
    const tickers = batch.map(s => s.ticker).join(' ');
    process.stdout.write(`[${i/5+1}/${Math.ceil(stocks.length/5)}] Searching: ${tickers}... `);

    try {
      const result = await invokeWithRetry(zai, `EGX stock price ${tickers} EGP today`);

      for (const stock of batch) {
        const data = parseStockFromResults(result, stock.ticker);
        if (data && data.close && data.close > 0 && data.close < 50000) {
          const old = Number(stock.current_price) || 0;
          db.prepare(`UPDATE stocks SET previous_close = CASE WHEN ABS(?-?) > 0.001 THEN ? ELSE previous_close END, current_price = ?, last_update = datetime('now') WHERE id = ?`)
            .run(data.close, old, old, data.close, stock.id);

          const today = new Date().toISOString().split('T')[0];
          const exists = db.prepare("SELECT 1 FROM stock_price_history WHERE stock_id = ? AND date LIKE ? LIMIT 1").get(stock.id, today + '%');
          if (!exists) {
            db.prepare(`INSERT INTO stock_price_history (stock_id, date, open_price, high_price, low_price, close_price, volume, adjusted_close, created_at) VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, datetime('now'))`)
              .run(stock.id, data.close, data.close, data.close, data.close, 0, data.close);
          }
          updated++;
          process.stdout.write(`${stock.ticker}=${data.close} `);
        } else {
          process.stdout.write(`${stock.ticker}=SKIP `);
        }
      }
      process.stdout.write('\n');
    } catch (e) {
      process.stdout.write(`ERROR: ${e.message}\n`);
    }
    await sleep(5000);
  }

  // Now update top volume non-EGX30 stocks
  const otherStocks = db.prepare(`
    SELECT id, ticker, name_ar, current_price, previous_close, volume
    FROM stocks WHERE is_active = 1 AND egx30_member = 0 ORDER BY volume DESC LIMIT 100
  `).all();
  console.log('\nTop volume non-EGX30 stocks:', otherStocks.length);

  for (let i = 0; i < otherStocks.length; i += 5) {
    const batch = otherStocks.slice(i, i + 5);
    const tickers = batch.map(s => s.ticker).join(' ');
    process.stdout.write(`[${i/5+1}/${Math.ceil(otherStocks.length/5)}] `);

    try {
      const result = await invokeWithRetry(zai, `EGX Egypt ${tickers} stock price today EGP`);

      for (const stock of batch) {
        const data = parseStockFromResults(result, stock.ticker);
        if (data && data.close && data.close > 0 && data.close < 50000) {
          const old = Number(stock.current_price) || 0;
          db.prepare(`UPDATE stocks SET previous_close = CASE WHEN ABS(?-?) > 0.001 THEN ? ELSE previous_close END, current_price = ?, last_update = datetime('now') WHERE id = ?`)
            .run(data.close, old, old, data.close, stock.id);

          const today = new Date().toISOString().split('T')[0];
          const exists = db.prepare("SELECT 1 FROM stock_price_history WHERE stock_id = ? AND date LIKE ? LIMIT 1").get(stock.id, today + '%');
          if (!exists) {
            db.prepare(`INSERT INTO stock_price_history (stock_id, date, open_price, high_price, low_price, close_price, volume, adjusted_close, created_at) VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, datetime('now'))`)
              .run(stock.id, data.close, data.close, data.close, data.close, 0, data.close);
          }
          updated++;
          process.stdout.write(`${stock.ticker}=${data.close} `);
        } else {
          process.stdout.write(`${stock.ticker}=- `);
        }
      }
      process.stdout.write('\n');
    } catch (e) {
      process.stdout.write(`ERR\n`);
    }
    await sleep(5000);
  }

  console.log(`\n=== DONE: ${updated} stocks updated ===`);
  db.close();
}

run().catch(e => console.error('Fatal:', e));
