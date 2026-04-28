const ZAI = require('z-ai-web-dev-sdk').default;
const Database = require('better-sqlite3');
const path = require('path');

function parseNum(s) {
  if (!s) return null;
  return parseFloat(String(s).replace(/,/g, ''));
}

function parseStockFromSearchResults(results, ticker) {
  for (let i = 0; i < 15; i++) {
    const r = results[i] || results[String(i)];
    if (!r) continue;

    const text = ((r.snippet || '') + ' ' + (r.title || '') + ' ' + (r.content || '') + ' ' + (r.text || '')).toLowerCase();
    const textOrig = ((r.snippet || '') + ' ' + (r.title || '') + ' ' + (r.content || '') + ' ' + (r.text || ''));
    const tickerLower = ticker.toLowerCase();

    if (!text.includes(tickerLower) && !(r.url || '').includes(ticker)) continue;

    // Pattern 1: TradingView - "COMI. Last update: 02:29 PM. 137.47. 3.51. 2.62%. Open 133.99."
    const tvMatch = textOrig.match(
      new RegExp(ticker + '\\s*\\).{0,50}?([\\d.,]+)\\.\\s*([\\d.,]+)\\.\\s*([+-]?[\\d.,]+)%\\s*\\.\\s*open\\s*([\\d.,]+)', 'i')
    );
    if (tvMatch) {
      const close = parseNum(tvMatch[1]);
      if (close && close > 0 && close < 100000) {
        return { close, change: parseNum(tvMatch[2]), changePercent: parseNum(tvMatch[3]), open: parseNum(tvMatch[4]) };
      }
    }

    // Pattern 2: "trading at a price of 22.63 EGP, with a previous close of 22.63 EGP"
    const simpleMatch = text.match(/trading at a price of ([\d.,]+)\s*egp[^.]*previous close of ([\d.,]+)/);
    if (simpleMatch) {
      return { close: parseNum(simpleMatch[1]), previousClose: parseNum(simpleMatch[2]) };
    }

    // Pattern 3: "current price of ORWE is 22.690 EGP"
    const currentMatch = textOrig.match(
      new RegExp('current price of\\s+' + ticker + '\\s+is\\s+([\\d.,]+)\\s*egp', 'i')
    );
    if (currentMatch) {
      return { close: parseNum(currentMatch[1]) };
    }

    // Pattern 4: "stock price today is Y.YY EGP"
    const todayMatch = text.match(new RegExp(ticker + '\\s+stock price today is\\s+([\\d.,]+)', 'i'));
    if (todayMatch) {
      return { close: parseNum(todayMatch[1]) };
    }

    // Pattern 5: "(TICKER). Price. 137.47" or "TICKER 137.47 EGP"
    const directMatch = textOrig.match(
      new RegExp(ticker + '\\s*[).:]\\s*([\\d]+[.,][\\d]+)\\s*egp', 'i')
    );
    if (directMatch) {
      const close = parseNum(directMatch[1]);
      if (close && close > 0 && close < 100000) return { close };
    }

    // Pattern 6: price near ticker
    const priceNear = textOrig.match(
      new RegExp(ticker + '[^\\d]{0,20}([\\d]+[.,][\\d]+)\\s*egp', 'i')
    );
    if (priceNear) {
      const close = parseNum(priceNear[1]);
      if (close && close > 0 && close < 100000) return { close };
    }

    // Pattern 7: TradingView alternative format
    const tvMatch2 = textOrig.match(
      new RegExp(ticker + '\\)\\.\\s*last update[^.]*?([\\d]+[.,][\\d]+)\\.\\s*([\\d.,]+)\\.\\s*([+-]?[\\d.,]+)%', 'i')
    );
    if (tvMatch2) {
      const close = parseNum(tvMatch2[1]);
      if (close && close > 0 && close < 100000) {
        return { close, change: parseNum(tvMatch2[2]), changePercent: parseNum(tvMatch2[3]) };
      }
    }
  }
  return null;
}

async function bulkUpdate() {
  const zai = await ZAI.create();
  const dbPath = path.join('/home/z/my-project', 'db', 'egx_investment.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const stocks = db.prepare(`
    SELECT id, ticker, name_ar, current_price, previous_close, volume
    FROM stocks WHERE is_active = 1
    ORDER BY egx30_member DESC, volume DESC
  `).all();
  console.log('Total stocks to update:', stocks.length);

  const BATCH_SIZE = 3;
  let updated = 0;
  let failed = 0;
  const updatedTickers = [];
  const failedTickers = [];

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(stocks.length / BATCH_SIZE);

    process.stdout.write(`Batch ${batchNum}/${totalBatches}: `);

    const tickerList = batch.map(s => s.ticker).join(' ');
    const query = `EGX Egypt stock price today ${tickerList} EGP`;

    try {
      const result = await zai.functions.invoke('web_search', { query, num: 10 });

      for (const stock of batch) {
        const stockData = parseStockFromSearchResults(result, stock.ticker);
        if (stockData && stockData.close) {
          if (stockData.close > 0 && stockData.close < 50000) {
            const oldPrice = Number(stock.current_price) || 0;
            const newPrice = stockData.close;

            db.prepare(`
              UPDATE stocks SET
                previous_close = CASE WHEN ABS(? - ?) > 0.001 THEN ? ELSE previous_close END,
                current_price = ?,
                open_price = COALESCE(?, open_price),
                high_price = COALESCE(?, high_price),
                low_price = COALESCE(?, low_price),
                volume = CASE WHEN ? > 0 THEN ? ELSE volume END,
                last_update = datetime('now')
              WHERE id = ?
            `).run(newPrice, oldPrice, oldPrice, newPrice,
              stockData.open, stockData.high, stockData.low,
              stockData.volume || 0, stockData.volume || 0, stock.id);

            const today = new Date().toISOString().split('T')[0];
            const exists = db.prepare("SELECT 1 FROM stock_price_history WHERE stock_id = ? AND date LIKE ? LIMIT 1")
              .get(stock.id, today + '%');

            if (!exists) {
              db.prepare(`
                INSERT INTO stock_price_history (stock_id, date, open_price, high_price, low_price, close_price, volume, adjusted_close, created_at)
                VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, datetime('now'))
              `).run(stock.id,
                stockData.open || newPrice,
                stockData.high || newPrice,
                stockData.low || newPrice,
                newPrice,
                stockData.volume || 0,
                newPrice);
            }

            updated++;
            updatedTickers.push(stock.ticker);
            process.stdout.write('\u2713' + stock.ticker + '(' + newPrice + ') ');
          } else {
            failed++;
            failedTickers.push(stock.ticker + ' (invalid price)');
            process.stdout.write('\u2717' + stock.ticker + ' ');
          }
        } else {
          failed++;
          failedTickers.push(stock.ticker + ' (not found)');
          process.stdout.write('\u2717' + stock.ticker + ' ');
        }
      }
      process.stdout.write('\n');

    } catch (e) {
      console.error('Error in batch ' + batchNum + ':', e.message);
      failed += batch.length;
      batch.forEach(s => failedTickers.push(s.ticker + ' (batch error)'));
    }

    if (i + BATCH_SIZE < stocks.length) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('Updated: ' + updated + '/' + stocks.length);
  console.log('Failed: ' + failed + '/' + stocks.length);
  if (failedTickers.length > 0 && failedTickers.length <= 50) {
    console.log('\nFailed tickers:', failedTickers.join(', '));
  } else if (failedTickers.length > 50) {
    console.log('\nFirst 50 failed tickers:', failedTickers.slice(0, 50).join(', '));
  }

  db.close();
  console.log('\nDone!');
}

bulkUpdate().catch(e => console.error('Fatal:', e));
