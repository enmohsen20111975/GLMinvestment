// Quick import script
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

// Resolve data dir relative to project root (Rule 17 + Rule 61 — RELATIVE-PATHS-ONLY)
const _DATA_DIR = path.resolve(process.cwd(), 'data', 'data-engine');

const prisma = new PrismaClient();

async function main() {
  // Import stocks
  const stocksData = JSON.parse(fs.readFileSync(path.join(_DATA_DIR, 'stocks_data.json'), 'utf-8'));
  console.log(`Found ${stocksData.length} stocks`);
  
  const MARKET_MAP = {
    'مصر': { code: 'EGX', flag: '🇪🇬', currency: 'EGP' },
    'السعودية': { code: 'TADAWUL', flag: '🇸🇦', currency: 'SAR' },
    'الكويت': { code: 'KSE', flag: '🇰🇼', currency: 'KWD' },
    'قطر': { code: 'QSE', flag: '🇶🇦', currency: 'QAR' },
  };
  
  let count = 0;
  for (const stock of stocksData) {
    const info = MARKET_MAP[stock.market] || { code: 'UNKNOWN', flag: '🌍', currency: 'USD' };
    try {
      await prisma.multiMarketStock.create({
        data: {
          ticker: stock.symbol,
          name: stock.name,
          name_ar: stock.name,
          market: stock.market,
          market_code: info.code,
          current_price: stock.price || 0,
          change_percent: stock.change_percent || 0,
          volume: stock.volume,
          market_cap: stock.market_cap,
          currency: info.currency,
          flag: info.flag,
        }
      });
      count++;
    } catch (e) {
      // Skip
    }
  }
  console.log(`Imported ${count} stocks`);
  
  // Import crypto
  const cryptoData = JSON.parse(fs.readFileSync(path.join(_DATA_DIR, 'crypto_latest.json'), 'utf-8'));
  let cryptoCount = 0;
  for (const c of cryptoData.all_cryptos || []) {
    try {
      await prisma.cryptoPrice.create({
        data: {
          symbol: c.symbol,
          name: c.name,
          rank: c.rank,
          price_usd: c.price_usd || 0,
          price_change_24h: c.price_change_24h,
          price_change_7d: c.price_change_7d,
          market_cap: c.market_cap,
          total_volume: c.total_volume,
          circulating_supply: c.circulating_supply,
          image: c.image,
        }
      });
      cryptoCount++;
    } catch (e) {}
  }
  console.log(`Imported ${cryptoCount} cryptos`);
  
  // Import gold
  const metalsData = JSON.parse(fs.readFileSync(path.join(_DATA_DIR, 'metals_forex_latest.json'), 'utf-8'));
  let goldCount = 0;
  let silverCount = 0;
  
  for (const [country, info] of Object.entries(metalsData.gold?.countries || {})) {
    const ci = info as any;
    for (const [karat, price] of Object.entries(ci.prices_by_karat || {})) {
      try {
        await prisma.goldPrice.create({
          data: {
            country,
            country_code: ci.currency,
            currency: ci.symbol,
            karat,
            price_per_gram: price as number,
            price_per_ounce: ci.gold_per_ounce_local,
            exchange_rate: ci.exchange_rate_to_usd,
            flag: ci.flag,
          }
        });
        goldCount++;
      } catch (e) {}
    }
  }
  
  for (const [country, info] of Object.entries(metalsData.silver?.countries || {})) {
    const ci = info as any;
    try {
      await prisma.silverPrice.create({
        data: {
          country,
          country_code: ci.currency,
          currency: ci.symbol,
          price_per_gram: ci.silver_per_gram_local || 0,
          price_per_ounce: ci.silver_per_ounce_local,
          flag: ci.flag,
        }
      });
      silverCount++;
    } catch (e) {}
  }
  
  console.log(`Imported ${goldCount} gold prices, ${silverCount} silver prices`);
  
  // Import exchange rates
  let rateCount = 0;
  const names = {
    'EGP': 'جنيه مصري', 'SAR': 'ريال سعودي', 'KWD': 'دينار كويتي',
    'QAR': 'ريال قطري', 'AED': 'درهم إماراتي', 'BHD': 'دينار بحريني',
    'OMR': 'ريال عماني', 'JOD': 'دينار أردني', 'USD': 'دولار أمريكي'
  };
  const flags = {
    'EGP': '🇪🇬', 'SAR': '🇸🇦', 'KWD': '🇰🇼', 'QAR': '🇶🇦',
    'AED': '🇦🇪', 'BHD': '🇧🇭', 'OMR': '🇴🇲', 'JOD': '🇯🇴', 'USD': '🇺🇸'
  };
  
  for (const [curr, rate] of Object.entries(metalsData.exchange_rates || {})) {
    try {
      await prisma.exchangeRate.create({
        data: {
          currency: curr,
          rate_to_usd: rate as number,
          name: names[curr] || curr,
          flag: flags[curr] || '🌍',
        }
      });
      rateCount++;
    } catch (e) {}
  }
  console.log(`Imported ${rateCount} exchange rates`);
  
  // Final count
  console.log('\n=== Database Counts ===');
  console.log('Stocks:', await prisma.multiMarketStock.count());
  console.log('Crypto:', await prisma.cryptoPrice.count());
  console.log('Gold:', await prisma.goldPrice.count());
  console.log('Silver:', await prisma.silverPrice.count());
  console.log('Exchange Rates:', await prisma.exchangeRate.count());
}

main().catch(console.error).finally(() => prisma.$disconnect());
