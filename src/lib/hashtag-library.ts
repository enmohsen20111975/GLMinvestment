/**
 * hashtag-library.ts — مكتبة هاشتاجات منظمة لكل سوق وميزة
 * ====================================================================
 *
 * هاشتاجات مجرّبة عالي الـ reach في السوق المصري والعربي.
 * منظمة حسب: السوق + الميزة + نوع المحتوى.
 *
 * الاستخدام:
 *   const tags = getHashtags('radar', 'egx');
 *   // → ['#رادار_السيولة', '#بورصة_مصر', '#EGX', ...]
 */

export type Market = 'egx' | 'tadawul' | 'kse' | 'qse' | 'us' | 'crypto';
export type ContentType = 'video' | 'image' | 'text' | 'story';

// هاشتاجات عامة لكل سوق (أعلى reach)
const MARKET_TAGS: Record<Market, string[]> = {
  egx: [
    '#بورصة_مصر', '#EGX', '#البورصة_المصرية', '#أسهم_مصر', '#تداول_مصر',
    '#بورصة', '#استثمار', '#تداول', '#أسهم', '#مصر',
    '#EGX30', '#EGX70', '#سوق_المال', '#بورصة_القاهرة',
  ],
  tadawul: [
    '#تداول_السعودية', '#Tadawul', '#السعودية', '#أسهم_السعودية', '#بورصة_السعودية',
    '#تداول', '#استثمار', '#الرياض', '#رؤية_2030', '#SaudiStocks',
  ],
  kse: [
    '#بورصة_الكويت', '#KSE', '#الكويت', '#أسهم_الكويت', '#تداول_الكويت',
    '#استثمار', '#الكويت_بورصة',
  ],
  qse: [
    '#بورصة_قطر', '#QSE', '#قطر', '#أسهم_قطر', '#تداول_قطر',
    '#استثمار', '#الدوحة',
  ],
  us: [
    '#WallStreet', '#StockMarket', '#Investing', '#Trading', '#Stocks',
    '#NYSE', '#NASDAQ', '#USStocks', '#Finance',
  ],
  crypto: [
    '#بيتكوين', '#Bitcoin', '#كريبتو', '#Crypto', '#عملات_رقمية',
    '#BTC', '#Ethereum', '#ETH', '#كريبتو_عربي', '#تداول_العملات',
  ],
};

// هاشتاجات خاصة بكل ميزة
const FEATURE_TAGS: Record<string, string[]> = {
  radar: ['#رادار_السيولة', '#تجميع_الأسهم', '#سيولة', '#رادار_المتداولين', '#فرص_استثمارية'],
  predictions: ['#توقعات_الأسهم', '#باك_تست', '#توقعات', '#تحليل_أسهم', '#V40'],
  portfolio: ['#محفظة_استثمارية', '#إدارة_المحافظ', '#محفظتي', '#تنويع_المخاطر'],
  risk: ['#وقف_الخسارة', '#إدارة_المخاطر', '#مخاطر_التداول', '#حماية_رأس_المال'],
  stockcard: ['#تحليل_السهم', '#كارت_السهم', '#تحليل_فني', '#تحليل_أساسي'],
  alerts: ['#تنبيهات_البورصة', '#متابعة_الأسهم', '#إشعارات_التداول', '#إنذار_السهم'],
  exit: ['#رادار_الخروج', '#متى_تبيع', '#بيع_الأسهم', '#حماية_الأرباح'],
  academy: ['#تعلم_التداول', '#أكاديمية_التداول', '#تعليم_بورصة', '#مبتدئ_تداول'],
};

// هاشتاجات حسب نوع المحتوى (لزيادة الـ reach على المنصات)
const CONTENT_TAGS: Record<ContentType, string[]> = {
  video: ['#فيديو', '#Reels', '#TikTok', '#شرح', '#مونتاج'],
  image: ['#إنفوجرافيك', '#كارت', '#تصميم', '# infographic'],
  text: ['#تحليل', '#مقال', '#تقرير', '#قراءة'],
  story: ['#ستوري', '#Story', '#يومي', '#متابعة'],
};

// هاشتاجات الـ trending العامة (عشان الـ algorithm)
const TRENDING_TAGS = [
  '#استثمار_ذكي', '#حرية_مالية', '#ريال_سعودي', '#جنيه_مصري',
  '#اللهم_بارك', '#فرصة', '#نصيحة_مالية', '#تطبيق_استثمار',
];

/**
 * جلب هاشتاجات لميزة + سوق + نوع محتوى
 * بيرجّع مزيج من: السوق + الميزة + النوع + trending (حد 15 هاشتاج)
 */
export function getHashtags(
  feature: string,
  market: Market = 'egx',
  contentType: ContentType = 'video',
  limit = 15,
): string[] {
  const marketTags = MARKET_TAGS[market] || MARKET_TAGS.egx;
  const featureTags = FEATURE_TAGS[feature] || [];
  const contentTags = CONTENT_TAGS[contentType] || [];

  // ندمج ونشيل التكرار
  const all = [...featureTags, ...marketTags, ...contentTags, ...TRENDING_TAGS];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const tag of all) {
    const k = tag.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(tag);
    }
    if (unique.length >= limit) break;
  }
  return unique;
}

/**
 * هاشتاجات للـ Instagram (حد 30 هاشتاج مسموح)
 */
export function getInstagramHashtags(feature: string, market: Market = 'egx'): string[] {
  return getHashtags(feature, market, 'image', 30);
}

/**
 * هاشتاجات للـ Twitter/X (حد 3-5 للأداء الأمثل)
 */
export function getTwitterHashtags(feature: string, market: Market = 'egx'): string[] {
  return getHashtags(feature, market, 'text', 5);
}

/**
 * هاشتاجات للـ Telegram (حد 5-8)
 */
export function getTelegramHashtags(feature: string, market: Market = 'egx'): string[] {
  return getHashtags(feature, market, 'text', 8);
}

/** قائمة كل الأسواق المتاحة (للـ UI) */
export const MARKET_OPTIONS: { value: Market; label: string; flag: string }[] = [
  { value: 'egx', label: 'مصر', flag: '🇪🇬' },
  { value: 'tadawul', label: 'السعودية', flag: '🇸🇦' },
  { value: 'kse', label: 'الكويت', flag: '🇰🇼' },
  { value: 'qse', label: 'قطر', flag: '🇶🇦' },
  { value: 'us', label: 'أمريكا', flag: '🇺🇸' },
  { value: 'crypto', label: 'كريبتو', flag: '₿' },
];
