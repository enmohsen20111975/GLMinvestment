/**
 * Sync data from data-engine JSON files to database
 * Using upsert to avoid duplicates
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DATA_PATH = '/tmp/data-engine/data-engine/data';

async function syncGoldSilver() {
  console.log('🥇 Syncing gold and silver prices...');
  
  const data = await import(`${DATA_PATH}/metals_forex_latest.json`);
  const timestamp = new Date(data.timestamp);
  
  let goldCount = 0;
  let silverCount = 0;
  let forexCount = 0;
  
  // Sync gold prices
  for (const [country, info] of Object.entries(data.gold.countries)) {
    const countryInfo = info as any;
    
    for (const [karat, price] of Object.entries(countryInfo.prices_by_karat)) {
      await prisma.goldPrice.upsert({
        where: {
          timestamp_country_karat: { timestamp, country, karat }
        },
        update: {
          price_per_gram: price as number,
          exchange_rate: countryInfo.exchange_rate_to_usd,
        },
        create: {
          timestamp,
          country,
          country_code: countryInfo.currency,
          currency: countryInfo.currency,
          karat,
          price_per_gram: price as number,
          exchange_rate: countryInfo.exchange_rate_to_usd,
          flag: countryInfo.flag,
        }
      });
      goldCount++;
    }
  }
  
  // Sync silver prices
  if (data.silver?.countries) {
    for (const [country, info] of Object.entries(data.silver.countries)) {
      const countryInfo = info as any;
      await prisma.silverPrice.upsert({
        where: {
          timestamp_country: { timestamp, country }
        },
        update: {
          price_per_gram: countryInfo.silver_per_gram_local || countryInfo.price_per_gram || 0,
        },
        create: {
          timestamp,
          country,
          country_code: countryInfo.currency,
          currency: countryInfo.currency,
          price_per_gram: countryInfo.silver_per_gram_local || countryInfo.price_per_gram || 0,
          exchange_rate: countryInfo.exchange_rate_to_usd,
          flag: countryInfo.flag,
        }
      });
      silverCount++;
    }
  }
  
  // Sync exchange rates
  if (data.exchange_rates) {
    for (const [currency, rate] of Object.entries(data.exchange_rates)) {
      await prisma.exchangeRate.upsert({
        where: {
          timestamp_currency: { timestamp, currency }
        },
        update: { rate_to_usd: rate as number },
        create: {
          timestamp,
          currency,
          rate_to_usd: rate as number,
        }
      });
      forexCount++;
    }
  }
  
  console.log(`✅ Synced: ${goldCount} gold, ${silverCount} silver, ${forexCount} forex`);
}

async function syncStocks() {
  console.log('📈 Syncing stocks...');
  
  const data = await import(`${DATA_PATH}/stocks_data.json`);
  const stocks = Array.isArray(data) ? data : (data as any).default || [];
  
  let count = 0;
  
  for (const stock of stocks) {
    const marketCode = stock.market === 'مصر' ? 'EGX' :
                       stock.market === 'السعودية' ? 'TADAWUL' :
                       stock.market === 'الكويت' ? 'KSE' :
                       stock.market === 'قطر' ? 'QSE' : 'UNKNOWN';
    
    const flag = stock.market === 'مصر' ? '🇪🇬' :
                 stock.market === 'السعودية' ? '🇸🇦' :
                 stock.market === 'الكويت' ? '🇰🇼' :
                 stock.market === 'قطر' ? '🇶🇦' : '💱';
    
    const currency = stock.market === 'مصر' ? 'EGP' :
                     stock.market === 'السعودية' ? 'SAR' :
                     stock.market === 'الكويت' ? 'KWD' :
                     stock.market === 'قطر' ? 'QAR' : 'USD';
    
    await prisma.multiMarketStock.upsert({
      where: {
        ticker_market_code: { ticker: stock.symbol, market_code: marketCode }
      },
      update: {
        current_price: stock.price || stock.current_price,
        change_percent: stock.change_percent || 0,
        volume: stock.volume,
        market_cap: stock.market_cap,
        last_update: new Date(),
      },
      create: {
        ticker: stock.symbol,
        name: stock.name,
        name_ar: stock.name,
        market: stock.market,
        market_code: marketCode,
        current_price: stock.price || stock.current_price,
        change_percent: stock.change_percent || 0,
        volume: stock.volume,
        market_cap: stock.market_cap,
        currency,
        flag,
      }
    });
    count++;
  }
  
  console.log(`✅ Synced: ${count} stocks`);
}

async function syncCrypto() {
  console.log('₿ Syncing crypto prices...');
  
  const data = await import(`${DATA_PATH}/crypto_latest.json`);
  const cryptoData = data as any;
  const cryptos = cryptoData.all_cryptos || [];
  
  let count = 0;
  
  for (const crypto of cryptos) {
    await prisma.cryptoPrice.upsert({
      where: { symbol: crypto.symbol },
      update: {
        price_usd: crypto.price_usd,
        price_change_24h: crypto.price_change_24h,
        price_change_7d: crypto.price_change_7d,
        market_cap: crypto.market_cap,
        total_volume: crypto.total_volume,
        last_update: new Date(),
      },
      create: {
        symbol: crypto.symbol,
        name: crypto.name,
        rank: crypto.rank,
        price_usd: crypto.price_usd,
        price_change_24h: crypto.price_change_24h,
        price_change_7d: crypto.price_change_7d,
        market_cap: crypto.market_cap,
        total_volume: crypto.total_volume,
        circulating_supply: crypto.circulating_supply,
        image: crypto.image,
      }
    });
    count++;
  }
  
  // Sync BTC local prices
  if (cryptoData.btc_local_prices) {
    for (const [currency, info] of Object.entries(cryptoData.btc_local_prices)) {
      const localInfo = info as any;
      await prisma.btcLocalPrice.upsert({
        where: { currency },
        update: {
          btc_price: localInfo.btc_price,
          change_24h: localInfo.btc_change_24h,
        },
        create: {
          currency,
          country: localInfo.country,
          currency_name: localInfo.currency_name,
          flag: localInfo.flag,
          btc_price: localInfo.btc_price,
          change_24h: localInfo.btc_change_24h,
        }
      });
    }
  }
  
  console.log(`✅ Synced: ${count} cryptocurrencies`);
}

async function main() {
  console.log('🚀 Starting data sync from data-engine...');
  
  try {
    await syncGoldSilver();
    await syncStocks();
    await syncCrypto();
    
    console.log('✅ All data synced successfully!');
  } catch (error) {
    console.error('❌ Error syncing data:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
