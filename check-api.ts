import { ensureInitialized, getStockByTicker, getPriceHistory } from './src/lib/egx-db';

async function checkStock(ticker: string) {
  try {
    await ensureInitialized();
    const stock = getStockByTicker(ticker);
    if (!stock) {
      console.log(`❌ Stock ${ticker} not found in light DB`);
      return;
    }
    console.log(`✅ Found stock: ${ticker} (id=${stock.id})`);
    
    const history = getPriceHistory(Number(stock.id), 90);
    console.log(`   History rows returned: ${history.length}`);
    if (history.length > 0) {
      console.log(`   First: ${history[0].date} open=${history[0].open} close=${history[0].close}`);
      console.log(`   Last:  ${history[history.length-1].date} open=${history[history.length-1].open} close=${history[history.length-1].close}`);
    } else {
      console.log(`   ⚠️ No history data for stock_id ${stock.id}`);
    }
  } catch (err) {
    console.error(`Error for ${ticker}:`, err);
  }
}

async function main() {
  const tickers = ['EFID', 'COMI', 'MOIL', 'EAST'];
  for (const t of tickers) {
    await checkStock(t);
    console.log('');
  }
}

main();
