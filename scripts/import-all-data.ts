/**
 * سكريبت استيراد جميع البيانات من data-engine
 * Import all data from data-engine to database
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

// Data file paths
const DATA_PATHS = {
  stocks: '/tmp/data-engine/data-engine/data/stocks_data.json',
  crypto: '/tmp/data-engine/data-engine/data/crypto_latest.json',
  metals_forex: '/tmp/data-engine/data-engine/data/metals_forex_latest.json',
  historical: '/tmp/data-engine/data-engine/data/historical_latest.json',
};

// Market mapping
const MARKET_MAP: Record<string, { code: string; flag: string; currency: string }> = {
  'مصر': { code: 'EGX', flag: '🇪🇬', currency: 'EGP' },
  'السعودية': { code: 'TADAWUL', flag: '🇸🇦', currency: 'SAR' },
  'الكويت': { code: 'KSE', flag: '🇰🇼', currency: 'KWD' },
  'قطر': { code: 'QSE', flag: '🇶🇦', currency: 'QAR' },
};

async function clearAllData() {
  console.log('🗑️ تنظيف قاعدة البيانات...');
  
  try {
    await prisma.goldPrice.deleteMany({});
    await prisma.silverPrice.deleteMany({});
    await prisma.exchangeRate.deleteMany({});
    await prisma.multiMarketStock.deleteMany({});
    await prisma.historicalPrice.deleteMany({});
    await prisma.cryptoPrice.deleteMany({});
    await prisma.btcLocalPrice.deleteMany({});
    await prisma.marketStatusRecord.deleteMany({});
    console.log('✅ تم تنظيف قاعدة البيانات');
  } catch (error) {
    console.log('⚠️ بعض الجداول غير موجودة');
  }
}

async function importStocks() {
  console.log('📊 استيراد بيانات الأسهم...');
  
  const rawData = fs.readFileSync(DATA_PATHS.stocks, 'utf-8');
  const data = JSON.parse(rawData);
  
  if (!Array.isArray(data) || data.length === 0) {
    console.log('❌ لا توجد بيانات أسهم');
    return 0;
  }
  
  console.log(`   📁 تم العثور على ${data.length} سجل`);
  
  const stocksToCreate = data.map((stock: any) => {
    const marketInfo = MARKET_MAP[stock.market] || { code: 'UNKNOWN', flag: '🌍', currency: 'USD' };
    
    return {
      ticker: stock.symbol,
      name: stock.name,
      name_ar: stock.name,
      market: stock.market,
      market_code: marketInfo.code,
      current_price: stock.price || 0,
      change_percent: stock.change_percent || 0,
      volume: stock.volume || null,
      market_cap: stock.market_cap || null,
      currency: marketInfo.currency,
      flag: marketInfo.flag,
      is_active: true,
    };
  });
  
  try {
    const result = await prisma.multiMarketStock.createMany({
      data: stocksToCreate,
      skipDuplicates: true,
    });
    console.log(`✅ تم استيراد ${result.count} سهم`);
    return result.count;
  } catch (error: any) {
    console.log(`❌ خطأ في استيراد الأسهم: ${error.message}`);
    
    // Try inserting one by one
    let count = 0;
    for (const stock of stocksToCreate) {
      try {
        await prisma.multiMarketStock.create({ data: stock });
        count++;
      } catch (e) {
        // Skip duplicates
      }
    }
    console.log(`✅ تم استيراد ${count} سهم (واحد تلو الآخر)`);
    return count;
  }
}

async function importCrypto() {
  console.log('₿ استيراد بيانات العملات الرقمية...');
  
  const rawData = fs.readFileSync(DATA_PATHS.crypto, 'utf-8');
  const data = JSON.parse(rawData);
  
  if (!data.all_cryptos || data.all_cryptos.length === 0) {
    console.log('❌ لا توجد بيانات عملات رقمية');
    return 0;
  }
  
  console.log(`   📁 تم العثور على ${data.all_cryptos.length} عملة`);
  
  const cryptosToCreate = data.all_cryptos.map((crypto: any) => ({
    symbol: crypto.symbol,
    name: crypto.name,
    rank: crypto.rank || null,
    price_usd: crypto.price_usd || 0,
    price_change_24h: crypto.price_change_24h || null,
    price_change_7d: crypto.price_change_7d || null,
    market_cap: crypto.market_cap || null,
    total_volume: crypto.total_volume || null,
    circulating_supply: crypto.circulating_supply || null,
    image: crypto.image || null,
  }));
  
  try {
    const result = await prisma.cryptoPrice.createMany({
      data: cryptosToCreate,
      skipDuplicates: true,
    });
    console.log(`✅ تم استيراد ${result.count} عملة رقمية`);
  } catch (error: any) {
    console.log(`❌ خطأ: ${error.message}`);
  }
  
  // Import BTC local prices
  if (data.btc_local_prices) {
    const btcPrices: any[] = [];
    for (const [currency, info] of Object.entries(data.btc_local_prices)) {
      const btcInfo = info as any;
      btcPrices.push({
        currency,
        country: btcInfo.country || null,
        currency_name: btcInfo.currency_name || null,
        flag: btcInfo.flag || null,
        btc_price: btcInfo.btc_price || 0,
        change_24h: btcInfo.btc_change_24h || null,
      });
    }
    
    try {
      const result = await prisma.btcLocalPrice.createMany({
        data: btcPrices,
        skipDuplicates: true,
      });
      console.log(`✅ تم استيراد ${result.count} سعر بيتكوين محلي`);
    } catch (error: any) {
      console.log(`❌ خطأ في BTC: ${error.message}`);
    }
  }
  
  return data.all_cryptos.length;
}

async function importGoldAndSilver() {
  console.log('🥇 استيراد بيانات الذهب والفضة...');
  
  const rawData = fs.readFileSync(DATA_PATHS.metals_forex, 'utf-8');
  const data = JSON.parse(rawData);
  
  const goldPrices: any[] = [];
  const silverPrices: any[] = [];
  
  // Import gold prices
  if (data.gold?.countries) {
    console.log(`   📁 تم العثور على ذهب لـ ${Object.keys(data.gold.countries).length} دولة`);
    
    for (const [country, info] of Object.entries(data.gold.countries)) {
      const countryInfo = info as any;
      
      if (countryInfo.prices_by_karat) {
        for (const [karat, price] of Object.entries(countryInfo.prices_by_karat)) {
          goldPrices.push({
            country,
            country_code: countryInfo.currency || 'XXX',
            currency: countryInfo.symbol || '',
            karat,
            price_per_gram: price as number,
            price_per_ounce: countryInfo.gold_per_ounce_local || null,
            exchange_rate: countryInfo.exchange_rate_to_usd || null,
            flag: countryInfo.flag || null,
          });
        }
      }
    }
  }
  
  // Import silver prices
  if (data.silver?.countries) {
    console.log(`   📁 تم العثور على فضة لـ ${Object.keys(data.silver.countries).length} دولة`);
    
    for (const [country, info] of Object.entries(data.silver.countries)) {
      const countryInfo = info as any;
      silverPrices.push({
        country,
        country_code: countryInfo.currency || 'XXX',
        currency: countryInfo.symbol || '',
        price_per_gram: countryInfo.silver_per_gram_local || 0,
        price_per_ounce: countryInfo.silver_per_ounce_local || null,
        exchange_rate: null,
        flag: countryInfo.flag || null,
      });
    }
  }
  
  let goldCount = 0;
  let silverCount = 0;
  
  if (goldPrices.length > 0) {
    try {
      const result = await prisma.goldPrice.createMany({
        data: goldPrices,
        skipDuplicates: true,
      });
      goldCount = result.count;
    } catch (error: any) {
      // Try one by one
      for (const gold of goldPrices) {
        try {
          await prisma.goldPrice.create({ data: gold });
          goldCount++;
        } catch (e) {}
      }
    }
  }
  
  if (silverPrices.length > 0) {
    try {
      const result = await prisma.silverPrice.createMany({
        data: silverPrices,
        skipDuplicates: true,
      });
      silverCount = result.count;
    } catch (error: any) {
      // Try one by one
      for (const silver of silverPrices) {
        try {
          await prisma.silverPrice.create({ data: silver });
          silverCount++;
        } catch (e) {}
      }
    }
  }
  
  console.log(`✅ تم استيراد ${goldCount} سعر ذهب و ${silverCount} سعر فضة`);
  return { goldCount, silverCount };
}

async function importExchangeRates() {
  console.log('💱 استيراد أسعار الصرف...');
  
  const rawData = fs.readFileSync(DATA_PATHS.metals_forex, 'utf-8');
  const data = JSON.parse(rawData);
  
  const currencyNames: Record<string, { name: string; country: string }> = {
    'EGP': { name: 'جنيه مصري', country: 'مصر' },
    'SAR': { name: 'ريال سعودي', country: 'السعودية' },
    'KWD': { name: 'دينار كويتي', country: 'الكويت' },
    'QAR': { name: 'ريال قطري', country: 'قطر' },
    'AED': { name: 'درهم إماراتي', country: 'الإمارات' },
    'BHD': { name: 'دينار بحريني', country: 'البحرين' },
    'OMR': { name: 'ريال عماني', country: 'عمان' },
    'JOD': { name: 'دينار أردني', country: 'الأردن' },
    'MAD': { name: 'درهم مغربي', country: 'المغرب' },
    'TND': { name: 'دينار تونسي', country: 'تونس' },
    'DZD': { name: 'دينار جزائري', country: 'الجزائر' },
    'SDG': { name: 'جنيه سوداني', country: 'السودان' },
    'IQD': { name: 'دينار عراقي', country: 'العراق' },
    'LBP': { name: 'ليرة لبنانية', country: 'لبنان' },
    'USD': { name: 'دولار أمريكي', country: 'الولايات المتحدة' },
  };
  
  const flags: Record<string, string> = {
    'EGP': '🇪🇬', 'SAR': '🇸🇦', 'KWD': '🇰🇼', 'QAR': '🇶🇦',
    'AED': '🇦🇪', 'BHD': '🇧🇭', 'OMR': '🇴🇲', 'JOD': '🇯🇴',
    'MAD': '🇲🇦', 'TND': '🇹🇳', 'DZD': '🇩🇿', 'SDG': '🇸🇩',
    'IQD': '🇮🇶', 'LBP': '🇱🇧', 'USD': '🇺🇸',
  };
  
  const rates = data.exchange_rates || {};
  console.log(`   📁 تم العثور على ${Object.keys(rates).length} سعر صرف`);
  
  const ratesToCreate: any[] = [];
  for (const [currency, rate] of Object.entries(rates)) {
    const info = currencyNames[currency] || { name: currency, country: '' };
    ratesToCreate.push({
      currency,
      rate_to_usd: rate as number,
      name: info.name,
      flag: flags[currency] || '🌍',
      country: info.country,
    });
  }
  
  try {
    const result = await prisma.exchangeRate.createMany({
      data: ratesToCreate,
      skipDuplicates: true,
    });
    console.log(`✅ تم استيراد ${result.count} سعر صرف`);
    return result.count;
  } catch (error: any) {
    let count = 0;
    for (const rate of ratesToCreate) {
      try {
        await prisma.exchangeRate.create({ data: rate });
        count++;
      } catch (e) {}
    }
    console.log(`✅ تم استيراد ${count} سعر صرف`);
    return count;
  }
}

async function main() {
  console.log('🚀 بدء استيراد البيانات من data-engine...\n');
  
  try {
    // Clear existing data first
    await clearAllData();
    console.log('');
    
    // Import all data
    const stocks = await importStocks();
    console.log('');
    
    const crypto = await importCrypto();
    console.log('');
    
    const metals = await importGoldAndSilver();
    console.log('');
    
    const rates = await importExchangeRates();
    console.log('');
    
    // Verify counts
    const counts = {
      stocks: await prisma.multiMarketStock.count(),
      crypto: await prisma.cryptoPrice.count(),
      gold: await prisma.goldPrice.count(),
      silver: await prisma.silverPrice.count(),
      exchangeRates: await prisma.exchangeRate.count(),
      btcLocal: await prisma.btcLocalPrice.count(),
    };
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 ملخص البيانات في قاعدة البيانات:');
    console.log(`   📈 الأسهم: ${counts.stocks}`);
    console.log(`   ₿ العملات الرقمية: ${counts.crypto}`);
    console.log(`   🥇 أسعار الذهب: ${counts.gold}`);
    console.log(`   🥈 أسعار الفضة: ${counts.silver}`);
    console.log(`   💱 أسعار الصرف: ${counts.exchangeRates}`);
    console.log(`   ₿ أسعار البيتكوين: ${counts.btcLocal}`);
    console.log('='.repeat(50));
    console.log('✅ تم استيراد جميع البيانات بنجاح!');
    
  } catch (error) {
    console.error('❌ خطأ في الاستيراد:', error);
    throw error;
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
