import type { MarketType } from '@/lib/store';
import type { SimState, StockSeed } from './types';

/* ============================================================
 * SimulationView — Constants
 * Per-market storage keys, market adapters, sector colors, and the
 * fallback seed list used when /api/stocks is unreachable.
 * ============================================================ */

export const INITIAL_BALANCE = 100_000;
export const COMMISSION_RATE = 0.0015; // 0.15%
export const TICK_INTERVAL = 5000; // 5 seconds — live random-walk tick

// Per-market state storage so switching markets keeps separate progress.
export const STORAGE_KEY_BY_MARKET: Record<MarketType, string> = {
  EGX: 'simulation_egx_sim',
  TADAWUL: 'simulation_tadawul_sim',
  KSE: 'simulation_kse_sim',
  QSE: 'simulation_qse_sim',
  US: 'simulation_us_sim',
  CRYPTO: 'simulation_crypto_sim',
};

export const SECTOR_COLORS: Record<string, string> = {
  'البناء والتشييد': '#f59e0b',
  'الإعلام والاتصالات': '#3b82f6',
  'العقارات': '#8b5cf6',
  'الخدمات المالية': '#10b981',
  'التأمين': '#ef4444',
  'الخدمات': '#06b6d4',
  'الأدوية': '#ec4899',
  'الصناعة': '#f97316',
  'الاستثمار': '#14b8a6',
  'البنوك': '#6366f1',
};

const EGX_STOCKS_RAW: StockSeed[] = [
  { ticker: 'ORAS', name_ar: 'أوراسكوم للإنشاء', sector: 'البناء والتشييد', basePrice: 18.5 },
  { ticker: 'COMI', name_ar: 'البنك التجاري الدولي (CIB)', sector: 'البنوك', basePrice: 38.5 },
  { ticker: 'GBAR', name_ar: 'جولدن بيتش', sector: 'العقارات', basePrice: 6.2 },
  { ticker: 'EMFD', name_ar: 'المهندسون للمعدات', sector: 'الخدمات المالية', basePrice: 32.8 },
  { ticker: 'DCRC', name_ar: 'دار الأهرام للتأمين', sector: 'التأمين', basePrice: 5.15 },
  { ticker: 'SWDY', name_ar: 'السويدى إلكتريك', sector: 'الخدمات', basePrice: 30.4 },
  { ticker: 'CCRS', name_ar: 'كرير للصناعات', sector: 'الخدمات المالية', basePrice: 48.9 },
  { ticker: 'EPCI', name_ar: 'إيبيكو للصناعات الدوائية', sector: 'الأدوية', basePrice: 42.5 },
  { ticker: 'HRHO', name_ar: 'حرم للتعمير', sector: 'العقارات', basePrice: 8.75 },
  { ticker: 'MTIE', name_ar: 'المصرية للاتصالات', sector: 'الإعلام والاتصالات', basePrice: 15.6 },
  { ticker: 'ALUM', name_ar: 'المصرية للألمنيوم', sector: 'الصناعة', basePrice: 12.3 },
  { ticker: 'EAST', name_ar: 'إيست كوست للاستثمار', sector: 'الاستثمار', basePrice: 3.4 },
  { ticker: 'ELSW', name_ar: 'السويس للأسمنت', sector: 'البناء والتشييد', basePrice: 72.5 },
  { ticker: 'OIIC', name_ar: 'أورينت للاستثمار', sector: 'الاستثمار', basePrice: 4.15 },
  { ticker: 'AMCH', name_ar: 'المصرية للبناء', sector: 'البناء والتشييد', basePrice: 7.8 },
  { ticker: 'PHAR', name_ar: 'فاركو للأدوية', sector: 'الأدوية', basePrice: 56.2 },
  { ticker: 'ETEL', name_ar: 'المصرية للاتصالات - تليفون مصر', sector: 'الإعلام والاتصالات', basePrice: 15.6 },
  { ticker: 'ALHI', name_ar: 'المصرية للغزل والنسيج', sector: 'الصناعة', basePrice: 10.2 },
  { ticker: 'MISR', name_ar: 'مصر للألمنيوم', sector: 'الصناعة', basePrice: 25.3 },
  { ticker: 'CIBK', name_ar: 'بنك مصر', sector: 'البنوك', basePrice: 28.4 },
  { ticker: 'TMGH', name_ar: 'المجموعة المالية هيرمس', sector: 'الخدمات المالية', basePrice: 19.8 },
  { ticker: 'FWRY', name_ar: 'فوري لتكنولوجيا الدفع', sector: 'التكنولوجيا', basePrice: 4.65 },
  { ticker: 'KIMA', name_ar: 'كيما للأسمدة', sector: 'الصناعة', basePrice: 22.7 },
  { ticker: 'MFPC', name_ar: 'شركة الماضي للتنمية والتعمير', sector: 'العقارات', basePrice: 4.55 },
];

// Per-market fallback seeds (offline default if /api/stocks is unreachable). The
// primary source is /api/stocks?market=<market>. These are minimal seeds so the
// simulation never shows an empty list, even with no backend.
export const FALLBACK_SEEDS: Record<MarketType, StockSeed[]> = {
  EGX: EGX_STOCKS_RAW,
  TADAWUL: [
    { ticker: '2222', name_ar: 'أرامكو السعودية', sector: 'الطاقة', basePrice: 31.5 },
    { ticker: '1180', name_ar: 'الأهلي السعودي', sector: 'البنوك', basePrice: 64.2 },
    { ticker: '7010', name_ar: 'STC', sector: 'الاتصالات', basePrice: 38.9 },
    { ticker: '1120', name_ar: 'الراجحي', sector: 'البنوك', basePrice: 88.4 },
    { ticker: '2010', name_ar: 'سابك', sector: 'البتروكيماويات', basePrice: 71.3 },
    { ticker: '2330', name_ar: 'تداول', sector: 'الخدمات المالية', basePrice: 122.5 },
    { ticker: '4190', name_ar: 'جرير', sector: 'التجزئة', basePrice: 14.8 },
    { ticker: '2280', name_ar: 'المملكة القابضة', sector: 'الاستثمار', basePrice: 6.9 },
    { ticker: '8230', name_ar: 'العثيم', sector: 'التجزئة', basePrice: 89.6 },
    { ticker: '7203', name_ar: 'سيرا', sector: 'النقل', basePrice: 71.4 },
    { ticker: '4001', name_ar: 'مجموعة سامبا', sector: 'البنوك', basePrice: 32.1 },
    { ticker: '4030', name_ar: 'بنك الرياض', sector: 'البنوك', basePrice: 28.5 },
  ],
  KSE: [
    { ticker: 'BKMB', name_ar: 'بنك الكويت المركزي', sector: 'البنوك', basePrice: 0.612 },
    { ticker: 'KFIN', name_ar: 'كاب', sector: 'الخدمات المالية', basePrice: 0.128 },
    { ticker: 'NBKK', name_ar: 'بنك الكويت الوطني', sector: 'البنوك', basePrice: 0.725 },
    { ticker: 'FOOD', name_ar: 'الأغذية المتحدة', sector: 'الأغذية', basePrice: 1.18 },
    { ticker: 'ZAIN', name_ar: 'زين', sector: 'الاتصالات', basePrice: 0.352 },
    { ticker: 'MABANEE', name_ar: 'المباني', sector: 'العقارات', basePrice: 0.418 },
    { ticker: 'BOUBYAN', name_ar: 'بنك بوبيان', sector: 'البنوك', basePrice: 0.612 },
    { ticker: 'AGRICO', name_ar: 'الزراعية', sector: 'الزراعة', basePrice: 0.478 },
    { ticker: 'KPC', name_ar: 'بتروكيماويات الكويت', sector: 'البتروكيماويات', basePrice: 0.712 },
    { ticker: 'FAST', name_ar: 'أجري', sector: 'النقل', basePrice: 0.385 },
  ],
  QSE: [
    { ticker: 'QNB', name_ar: 'بنك قطر الوطني', sector: 'البنوك', basePrice: 18.6 },
    { ticker: 'QIBK', name_ar: 'بنك قطر الإسلامي', sector: 'البنوك', basePrice: 36.2 },
    { ticker: 'OOREDOO', name_ar: 'أوريدو', sector: 'الاتصالات', basePrice: 8.9 },
    { ticker: 'IQCD', name_ar: 'الصناعات القطرية', sector: 'الصناعة', basePrice: 51.4 },
    { ticker: 'QATI', name_ar: 'الأسمنت القطري', sector: 'البناء والتشييد', basePrice: 14.8 },
    { ticker: 'MCCS', name_ar: 'المجموعة الطبية', sector: 'الرعاية الصحية', basePrice: 28.3 },
    { ticker: 'QNNS', name_ar: 'الأسمدة', sector: 'البتروكيماويات', basePrice: 12.5 },
    { ticker: 'UCIC', name_ar: 'الكابلات', sector: 'الصناعة', basePrice: 14.1 },
    { ticker: 'QIMC', name_ar: 'الصناعات القطرية', sector: 'الصناعة', basePrice: 7.2 },
    { ticker: 'MASQ', name_ar: 'مسقط القابضة', sector: 'الاستثمار', basePrice: 1.85 },
  ],
  US: [
    { ticker: 'AAPL', name_ar: 'آبل', sector: 'التكنولوجيا', basePrice: 188.5 },
    { ticker: 'MSFT', name_ar: 'مايكروسوفت', sector: 'التكنولوجيا', basePrice: 374.2 },
    { ticker: 'NVDA', name_ar: 'إنفيديا', sector: 'التكنولوجيا', basePrice: 875.4 },
    { ticker: 'TSLA', name_ar: 'تسلا', sector: 'السيارات', basePrice: 254.8 },
    { ticker: 'GOOGL', name_ar: 'ألفابيت', sector: 'التكنولوجيا', basePrice: 141.6 },
    { ticker: 'AMZN', name_ar: 'أمازون', sector: 'التجزئة', basePrice: 178.3 },
    { ticker: 'META', name_ar: 'ميتا', sector: 'التكنولوجيا', basePrice: 498.7 },
    { ticker: 'JPM', name_ar: 'جي بي مورغان', sector: 'البنوك', basePrice: 198.4 },
    { ticker: 'V', name_ar: 'فيزا', sector: 'الخدمات المالية', basePrice: 275.6 },
    { ticker: 'BRK.B', name_ar: 'بيركشاير', sector: 'التأمين', basePrice: 412.9 },
    { ticker: 'SPY', name_ar: 'مؤشر S&P 500', sector: 'المؤشرات', basePrice: 514.3 },
    { ticker: 'QQQ', name_ar: 'مؤشر نازداك 100', sector: 'المؤشرات', basePrice: 438.2 },
  ],
  CRYPTO: [
    { ticker: 'BTC', name_ar: 'بيتكوين', sector: 'العملات الرقمية', basePrice: 67250 },
    { ticker: 'ETH', name_ar: 'إيثيريوم', sector: 'العملات الرقمية', basePrice: 3512 },
    { ticker: 'BNB', name_ar: 'بينانس', sector: 'العملات الرقمية', basePrice: 588.4 },
    { ticker: 'SOL', name_ar: 'سولانا', sector: 'العملات الرقمية', basePrice: 168.2 },
    { ticker: 'XRP', name_ar: 'ريبل', sector: 'العملات الرقمية', basePrice: 0.524 },
    { ticker: 'ADA', name_ar: 'كاردانو', sector: 'العملات الرقمية', basePrice: 0.452 },
    { ticker: 'DOGE', name_ar: 'دوجكوين', sector: 'العملات الرقمية', basePrice: 0.128 },
    { ticker: 'AVAX', name_ar: 'أفالانش', sector: 'العملات الرقمية', basePrice: 36.5 },
    { ticker: 'DOT', name_ar: 'بولكادوت', sector: 'العملات الرقمية', basePrice: 7.85 },
    { ticker: 'MATIC', name_ar: 'بوليغون', sector: 'العملات الرقمية', basePrice: 0.742 },
    { ticker: 'LINK', name_ar: 'تشين لينك', sector: 'العملات الرقمية', basePrice: 14.3 },
    { ticker: 'LTC', name_ar: 'لايتكوين', sector: 'العملات الرقمية', basePrice: 84.6 },
  ],
};

// Map the MarketType used in the UI to the market code expected by /api/stocks.
export const API_MARKET_CODE: Record<MarketType, string> = {
  EGX: 'EGX',
  TADAWUL: 'KSA',
  KSE: 'KSE',
  QSE: 'QSE',
  US: 'US',
  CRYPTO: 'CRYPTO',
};

/* ─── Default sim state (initial balance + empty portfolio) ─── */

export function getDefaultState(): SimState {
  return {
    balance: INITIAL_BALANCE,
    positions: [],
    transactions: [],
    watchlist: [],
    history: [
      {
        date: new Date().toISOString().split('T')[0],
        portfolioValue: INITIAL_BALANCE,
        timestamp: Date.now(),
      },
    ],
    startedAt: new Date().toISOString(),
  };
}
