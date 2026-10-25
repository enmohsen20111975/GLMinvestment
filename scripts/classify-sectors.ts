/**
 * Sector Classification Script
 * =============================
 * سكريبت تصنيف الأسهم إلى قطاعات
 * 
 * Run: npx tsx scripts/classify-sectors.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// تعريف القطاعات والكلمات المفتاحية
const SECTOR_KEYWORDS: Record<string, {
  arabic: string[];
  english: string[];
  tickers: string[];
}> = {
  'Banks': {
    arabic: ['بنك', 'مصرف', 'بنوك'],
    english: ['bank', 'banks', 'banking', 'cib', 'adib', 'fait', 'qnbe', 'saud'],
    tickers: ['COMI', 'CIEB', 'ADIB', 'FAIT', 'SAUD', 'ABUK', 'QNBE', 'ETBA', 'BUEI', 'CABK', 'MIDG', 'CAIH'],
  },
  'Real Estate': {
    arabic: ['عقار', 'عقارات', 'إسكان', 'تطوير عقاري', 'مدن'],
    english: ['real estate', 'properties', 'housing', 'development', 'construction', 'talaat', 'madinet'],
    tickers: ['TMGH', 'MNHD', 'ORHD', 'HELI', 'ALCN', 'MCIE', 'ELQA', 'UDCI', 'NIRE', 'OCDI'],
  },
  'Telecom': {
    arabic: ['اتصال', 'اتصالات', 'موبايل', 'تليفون'],
    english: ['telecom', 'telecommunications', 'mobile', 'phone', 'communication'],
    tickers: ['ETEL', 'ESRS', 'MOBI'],
  },
  'Food & Beverage': {
    arabic: ['غذاء', 'أغذية', 'طعام', 'مشروبات', 'مطاحن', 'زيت', 'سكر', 'دجاج'],
    english: ['food', 'beverage', 'mills', 'oils', 'sugar', 'poultry', 'chicken', 'juice', 'edible'],
    tickers: ['JUFO', 'SKPC', 'AJWA', 'EFID', 'SWDY', 'CAID', 'ZEOT', 'CICH', 'SPMD', 'DOMT', 'KABO'],
  },
  'Energy & Utilities': {
    arabic: ['طاقة', 'كهرباء', 'غاز', 'بترول', 'نفط', 'محروقات'],
    english: ['energy', 'electricity', 'gas', 'petroleum', 'oil', 'fuel', 'power', 'utility'],
    tickers: ['EGAS', 'AMOC', 'ESRS', 'EGPC', 'SAMP', 'ESPA', 'ELPA', 'CCPA'],
  },
  'Industrial': {
    arabic: ['صناعة', 'صناعات', 'مصنع', 'مصانع', 'ألومنيوم', 'حديد', 'صلب', 'أسمنت'],
    english: ['industrial', 'industries', 'factory', 'manufacturing', 'aluminum', 'steel', 'cement', 'pipes'],
    tickers: ['SWDY', 'ESGH', 'ALUM', 'AMER', 'ORWE', 'AINP', 'NIPD', 'EIPM', 'UNBP'],
  },
  'Healthcare & Pharmaceuticals': {
    arabic: ['صحة', 'طبية', 'دواء', 'أدوية', 'مستشفى', 'صيدلة'],
    english: ['healthcare', 'health', 'medical', 'pharma', 'pharmaceutical', 'hospital', 'drug', 'medicine'],
    tickers: ['PHDC', 'RMDA', 'EGCH', 'PACH', 'EKRI', 'MOIC'],
  },
  'Investment & Financial Services': {
    arabic: ['استثمار', 'استثمارات', 'تداول', 'وساطة', 'محافظ', 'تمويل'],
    english: ['investment', 'investments', 'trading', 'brokerage', 'portfolio', 'finance', 'financial services', 'capital'],
    tickers: ['HRHO', 'EKHO', 'GTHE', 'BFRI', 'HELI', 'ACI', 'EFIH', 'EFA', 'AIOC', 'FICT'],
  },
  'Technology': {
    arabic: ['تكنولوجيا', 'تقنية', 'برمجيات', 'حاسب', 'آلي'],
    english: ['technology', 'tech', 'software', 'it ', 'digital', 'computer', 'electronics', 'automation'],
    tickers: ['MTIE', 'EGTS', 'EGS1', 'IORA', 'EDNV', 'ATLC'],
  },
  'Tourism & Entertainment': {
    arabic: ['سياحة', 'فنادق', 'سفر', 'ترفيه', 'منتجعات'],
    english: ['tourism', 'hotel', 'hotels', 'travel', 'entertainment', 'resort', 'leisure'],
    tickers: ['EGTH', 'MENA', 'HRHO', 'EGTS', 'ALCN', 'ZMKD', 'EEEG'],
  },
  'Retail & Consumer Services': {
    arabic: ['تجزئة', 'متاجر', 'سوبر ماركت', 'مولات'],
    english: ['retail', 'stores', 'supermarket', 'mall', 'consumer services', 'shopping'],
    tickers: ['OAHA', 'CIRA', 'PRDC', 'BMHI'],
  },
  'Education': {
    arabic: ['تعليم', 'مدارس', 'جامعات', 'كليات', 'معاهد'],
    english: ['education', 'schools', 'universities', 'colleges', 'institutes', 'learning'],
    tickers: ['CIRA', 'ERES', 'SEDI'],
  },
};

// خريطة الشركات المعروفة
const COMPANY_SECTOR_MAP: Record<string, string> = {
  'COMI': 'Banks', 'CIEB': 'Banks', 'ADIB': 'Banks', 'FAIT': 'Banks',
  'SAUD': 'Banks', 'ABUK': 'Banks', 'QNBE': 'Banks', 'ETBA': 'Banks',
  'TMGH': 'Real Estate', 'MNHD': 'Real Estate', 'ORHD': 'Real Estate',
  'ETEL': 'Telecom', 'ESRS': 'Telecom',
  'JUFO': 'Food & Beverage', 'SKPC': 'Food & Beverage', 'AJWA': 'Food & Beverage',
  'EGAS': 'Energy & Utilities', 'AMOC': 'Energy & Utilities',
  'PHDC': 'Healthcare & Pharmaceuticals', 'RMDA': 'Healthcare & Pharmaceuticals',
  'HRHO': 'Investment & Financial Services', 'EKHO': 'Investment & Financial Services',
  'ALUM': 'Industrial', 'AMER': 'Industrial',
  'CIRA': 'Education',
};

/**
 * تصنيف سهم بناءً على رمزه واسمه
 */
function classifyStock(ticker: string, name: string | null, nameAr: string | null): string {
  const upperTicker = ticker.toUpperCase().trim();
  const lowerName = `${name || ''} ${nameAr || ''}`.toLowerCase();
  
  // تحقق من القطاع المعروف
  if (COMPANY_SECTOR_MAP[upperTicker]) {
    return COMPANY_SECTOR_MAP[upperTicker];
  }
  
  // تحقق من الكلمات المفتاحية
  let bestMatch: string | null = null;
  let bestScore = 0;
  
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    let score = 0;
    
    // تحقق من Ticker
    for (const kw of keywords.tickers) {
      if (upperTicker.includes(kw) || kw.includes(upperTicker)) {
        score += 10;
      }
    }
    
    // تحقق من الكلمات الإنجليزية
    for (const kw of keywords.english) {
      if (lowerName.includes(kw)) {
        score += 3;
      }
    }
    
    // تحقق من الكلمات العربية
    for (const kw of keywords.arabic) {
      if (lowerName.includes(kw)) {
        score += 3;
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = sector;
    }
  }
  
  return bestMatch || 'Diversified';
}

async function main() {
  console.log('🔍 Sector Classification Script');
  console.log('==============================\n');
  
  // الحصول على كل الأسهم بدون قطاع
  const stocksWithoutSector = await prisma.stocks.findMany({
    where: {
      OR: [
        { sector: null },
        { sector: '' },
      ],
    },
  });
  
  console.log(`📊 Found ${stocksWithoutSector.length} stocks without sector\n`);
  
  if (stocksWithoutSector.length === 0) {
    console.log('✅ All stocks already have sectors!');
    
    // عرض إحصائيات القطاعات الحالية
    const sectorStats = await prisma.stocks.groupBy({
      by: ['sector'],
      _count: { ticker: true },
      orderBy: { _count: { ticker: 'desc' } },
    });
    
    console.log('\n📊 Current Sector Distribution:');
    for (const stat of sectorStats) {
      console.log(`   ${stat.sector || 'Unknown'}: ${stat._count.ticker} stocks`);
    }
    return;
  }
  
  // تصنيف الأسهم
  const classified: Record<string, string> = {};
  const sectorCounts: Record<string, number> = {};
  const unclassified: string[] = [];
  
  for (const stock of stocksWithoutSector) {
    const sector = classifyStock(stock.ticker, stock.name, stock.name_ar);
    
    if (sector && sector !== 'Diversified') {
      classified[stock.ticker] = sector;
      sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
      
      // تحديث قاعدة البيانات
      await prisma.stocks.update({
        where: { ticker: stock.ticker },
        data: { sector },
      });
      
      console.log(`✅ ${stock.ticker} → ${sector}`);
    } else {
      unclassified.push(stock.ticker);
      console.log(`⚠️ ${stock.ticker} → Diversified`);
      
      // Set Diversified as default
      await prisma.stocks.update({
        where: { ticker: stock.ticker },
        data: { sector: 'Diversified' },
      });
    }
  }
  
  // الإحصائيات النهائية
  console.log('\n==============================');
  console.log('📈 Classification Results:');
  console.log(`   ✅ Classified: ${Object.keys(classified).length}`);
  console.log(`   ⚠️ Set to Diversified: ${unclassified.length}`);
  console.log('\n📊 Sector Distribution:');
  
  for (const [sector, count] of Object.entries(sectorCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${sector}: ${count} stocks`);
  }
  
  if (unclassified.length > 0) {
    console.log('\n⚠️ Diversified samples:', unclassified.slice(0, 20).join(', '));
  }
  
  // التحقق من التغطية الكلية
  const totalStocks = await prisma.stocks.count();
  const stocksWitSector = await prisma.stocks.count({
    where: { NOT: [{ sector: null }] },
  });
  
  console.log(`\n📊 Total Coverage: ${stocksWitSector}/${totalStocks} (${((stocksWitSector / totalStocks) * 100).toFixed(1)}%)`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('\n✅ Done!');
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
