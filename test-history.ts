import { ensureInitialized, getStockByTicker, getPriceHistory } from './src/lib/egx-db';

async function testStockHistory(ticker: string) {
  try {
    console.log(`\n=== Testing ${ticker} ===`);
    await ensureInitialized();
    
    const stock = getStockByTicker(ticker);
    if (!stock) {
      console.log(`❌ Stock not found: ${ticker}`);
      return;
    }
    console.log(`✅ Stock found: id=${stock.id}, name=${stock.name_ar || stock.name}`);
    
    const history = getPriceHistory(Number(stock.id), 90);
    console.log(`   History rows: ${history.length}`);
    
    if (history.length > 0) {
      console.log(`   First: ${history[0].date} → ${history[0].close}`);
      console.log(`   Last:  ${history[history.length-1].date} → ${history[history.length-1].close}`);
    } else {
      console.log(`   ⚠️ EMPTY!`);
    }
  } catch (err) {
    console.error(`Error:`, err);
  }
}

async function main() {
  const tickers = ['EFID', 'COMI', 'MOIL', 'EAST', 'ZINC', 'ABUK', 'CLHO'];
  for (const t of tickers) {
    await testStockHistory(t);
  }
}

main();
