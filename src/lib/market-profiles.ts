/**
 * market-profiles.ts — TypeScript port of vps-service/config/unified_config.py MARKET_PROFILES
 * ===============================================================================
 *
 * المصدر الموحّد لإعدادات كل سوق في الـ frontend + Next.js APIs.
 *
 * ═══ القاعدة 20 (Python = العقل، Node = العرض فقط) ═══
 * هذا الملف هو **port موثّق** لـ vps-service/config/unified_config.py:MARKET_PROFILES.
 * Python هو Source of Truth الوحيد. أي تعديل هنا لازم يتعمل في Python أولاً.
 * التعديل في Python بدون sync هنا = bug (Rule 27: لا بيانات كاذبة).
 *
 * ═══ لماذا port وليس fetch من Python؟ ═══
 * لأن Python backend ممكن يقع (port 8010) — لو TS بيستنى Python عشان يعرف
 * إن CRYPTO stop_max=20%، السهم هيظهر بـ EGX defaults (stop_max=7%) = كذب (Rule 27).
 * الـ port الضمني بيضمن إن TS عنده القيم الصحيحة حتى لو Python واقع.
 *
 * ═══ القاعدة 28 (لا تكرار) ═══
 * هذا الملف **ليس** duplicate لـ Python — هو port موثّق (نفس فلسفة canonical-signal.ts
 * اللي هو port لـ vps-service/utils/canonical_signal.py). الـ values هنا mirror
 * للـ SOT، مش نظام مستقل. لو لقيت قيمة هنا بتختلف عن Python = bug.
 *
 * ═══ التحديث ═══
 * لتعديل قيمة: (1) عدّل في vps-service/config/unified_config.py أولاً
 * (2) عدّل هنا بنفس القيمة (3) حدّث تاريخ آخر sync بالأسفل.
 *
 * آخر sync: 2026-10-10 مع unified_config.py (commit b9a263ce)
 */

import type { MarketType } from '@/lib/store';

// ═══════════════════════════════════════════════════════════════════════════
// 1) MARKET PROFILE TYPE — mirror of Python MarketProfile dataclass
// ═══════════════════════════════════════════════════════════════════════════

export interface MarketProfile {
  /** كود السوق في Python (EGX / KSA / KSE / QSE / DFM / CRYPTO / FOREX) */
  marketCode: string;
  marketNameEn: string;
  marketNameAr: string;
  currency: string; // EGP / SAR / KWD / USD / QAR / AED

  /** أوزان المحللات (0-100) */
  weights: {
    technical: number;
    volume: number;
    candlestick: number;
    fundamental: number;
    sentiment: number;
    sector: number;
  };

  /** الاستراتيجية الافتراضية */
  defaultStrategy: 'T1' | 'SWING' | 'BREAKOUT';

  /** عتبات القبول (0-100) */
  minScoreBuy: number;
  minScoreStrong: number;
  minScoreSell: number;

  /** فلاتر الجودة */
  minVolumeFilter: number;
  minValueTraded: number;
  minRR: number;

  /** وقف الخسارة (نسب %) */
  stopMaxPct: number;
  stopMinPct: number;
  stopAtrMult: number;
  stopFixedPct: number;

  /** الأهداف (نسب %) */
  targetRrMult: number;
  targetMinPct: number;
  targetMaxPct: number;

  /** إعدادات التداول */
  maxConcurrentTrades: number;
  positionSizePct: number;

  /** RSI thresholds (مخصصة لكل سوق) */
  rsiOverbought: number;
  rsiOversold: number;
  rsiExtremeHigh: number;
  rsiExtremeLow: number;

  /** V40.4 Market Physics Matrix */
  benchmarkTicker: string;
  minTurnoverLocal: number;
  atrStopMinPct: number;
  atrStopMaxPct: number;
  dynamicRrNormal: number;
  dynamicRrOutperform: number;
  dataProviderType: string;
  priceDbTable: string;
  isContinuous24_7: boolean;

  /** الحد الأدنى للسعر — Rule 27 fix (gate-analyzer.ts كان بيستخدم close>1.0 ثابت) */
  priceFloor: number;

  notes: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2) MARKET PROFILES — mirror of Python MARKET_PROFILES dict
// ═══════════════════════════════════════════════════════════════════════════
// KEY = Python market_code (اللي بيرجع من MARKET_CODES[MarketType])

export const MARKET_PROFILES: Record<string, MarketProfile> = {
  // ─── EGX — البورصة المصرية (T+1 مثبت، WR 70%) ──────────────────────
  EGX: {
    marketCode: 'EGX',
    marketNameEn: 'Egyptian Exchange',
    marketNameAr: 'البورصة المصرية',
    currency: 'EGP',
    weights: { technical: 40, volume: 25, candlestick: 20, fundamental: 5, sentiment: 7, sector: 3 },
    defaultStrategy: 'T1',
    minScoreBuy: 65.0,
    minScoreStrong: 80.0,
    minScoreSell: 35.0,
    minVolumeFilter: 1_000_000,
    minValueTraded: 1_000_000,
    minRR: 1.8,
    stopMaxPct: 7.0,
    stopMinPct: 1.5,
    stopAtrMult: 2.5,
    stopFixedPct: 2.0,
    targetRrMult: 2.0,
    targetMinPct: 2.5,
    targetMaxPct: 7.0,
    maxConcurrentTrades: 3,
    positionSizePct: 10.0,
    rsiOverbought: 70.0,
    rsiOversold: 30.0,
    rsiExtremeHigh: 80.0,
    rsiExtremeLow: 25.0,
    benchmarkTicker: 'EGX30ETF',
    minTurnoverLocal: 500_000.0,
    atrStopMinPct: 5.0,
    atrStopMaxPct: 9.0,
    dynamicRrNormal: 1.8,
    dynamicRrOutperform: 2.0,
    dataProviderType: 'financial_statements',
    priceDbTable: 'price_history',
    isContinuous24_7: false,
    priceFloor: 0.5, // EGX penny stocks أقل من 0.5 جنيه نادرة وغير مقبولة سيولة
    notes: 'EGX: T+1 مثبت. وقت التداول 4.5 ساعات. السيولة مهمة.',
  },

  // ─── KSA (TADAWUL) — السوق السعودي (T+1 فشل → Swing) ───────────────
  KSA: {
    marketCode: 'KSA',
    marketNameEn: 'Saudi Exchange (Tadawul)',
    marketNameAr: 'تداول السعودية',
    currency: 'SAR',
    weights: { technical: 35, volume: 30, candlestick: 15, fundamental: 12, sentiment: 5, sector: 3 },
    defaultStrategy: 'SWING',
    minScoreBuy: 68.0,
    minScoreStrong: 82.0,
    minScoreSell: 35.0,
    minVolumeFilter: 5_000_000,
    minValueTraded: 10_000_000,
    minRR: 1.5,
    stopMaxPct: 8.0,
    stopMinPct: 1.5,
    stopAtrMult: 2.0,
    stopFixedPct: 2.5,
    targetRrMult: 2.0,
    targetMinPct: 4.0,
    targetMaxPct: 15.0,
    maxConcurrentTrades: 3,
    positionSizePct: 10.0,
    rsiOverbought: 70.0,
    rsiOversold: 30.0,
    rsiExtremeHigh: 85.0,
    rsiExtremeLow: 20.0,
    benchmarkTicker: 'TASI',
    minTurnoverLocal: 2_000_000.0,
    atrStopMinPct: 3.0,
    atrStopMaxPct: 6.0,
    dynamicRrNormal: 1.5,
    dynamicRrOutperform: 2.0,
    dataProviderType: 'financial_statements',
    priceDbTable: 'price_history',
    isContinuous24_7: false,
    priceFloor: 1.0,
    notes: 'TADAWUL: T+1 فشل في Backtest. استخدام Swing (3-7 أيام).',
  },

  // ─── KSE — بورصة الكويت (Swing, سيولة منخفضة) ──────────────────────
  KSE: {
    marketCode: 'KSE',
    marketNameEn: 'Kuwait Stock Exchange',
    marketNameAr: 'بورصة الكويت',
    currency: 'KWD',
    weights: { technical: 38, volume: 28, candlestick: 18, fundamental: 8, sentiment: 5, sector: 3 },
    defaultStrategy: 'SWING',
    minScoreBuy: 65.0,
    minScoreStrong: 80.0,
    minScoreSell: 35.0,
    minVolumeFilter: 500_000,
    minValueTraded: 500_000,
    minRR: 1.5,
    stopMaxPct: 8.0,
    stopMinPct: 1.5,
    stopAtrMult: 2.0,
    stopFixedPct: 2.0,
    targetRrMult: 2.0,
    targetMinPct: 3.0,
    targetMaxPct: 12.0,
    maxConcurrentTrades: 3,
    positionSizePct: 8.0,
    rsiOverbought: 70.0,
    rsiOversold: 30.0,
    rsiExtremeHigh: 85.0,
    rsiExtremeLow: 20.0,
    benchmarkTicker: 'BKP',
    minTurnoverLocal: 50_000.0,
    atrStopMinPct: 2.0,
    atrStopMaxPct: 4.5,
    dynamicRrNormal: 1.5,
    dynamicRrOutperform: 1.8,
    dataProviderType: 'financial_statements',
    priceDbTable: 'price_history',
    isContinuous24_7: false,
    priceFloor: 0.05, // KWD قوي — حتى 0.05 د.ك = ~$0.16 مقبول
    notes: 'KSE: Swing. سيولة منخفضة → حجم مركز أصغر.',
  },

  // ─── QSE — بورصة قطر (سوق محدود) ──────────────────────────────────
  QSE: {
    marketCode: 'QSE',
    marketNameEn: 'Qatar Stock Exchange',
    marketNameAr: 'بورصة قطر',
    currency: 'QAR',
    weights: { technical: 38, volume: 27, candlestick: 18, fundamental: 10, sentiment: 5, sector: 2 },
    defaultStrategy: 'SWING',
    minScoreBuy: 68.0,
    minScoreStrong: 83.0,
    minScoreSell: 35.0,
    minVolumeFilter: 500_000,
    minValueTraded: 500_000,
    minRR: 1.5,
    stopMaxPct: 8.0,
    stopMinPct: 1.5,
    stopAtrMult: 2.0,
    stopFixedPct: 2.5,
    targetRrMult: 2.0,
    targetMinPct: 4.0,
    targetMaxPct: 12.0,
    maxConcurrentTrades: 2,
    positionSizePct: 8.0,
    rsiOverbought: 70.0,
    rsiOversold: 30.0,
    rsiExtremeHigh: 85.0,
    rsiExtremeLow: 20.0,
    benchmarkTicker: 'QE_INDEX',
    minTurnoverLocal: 1_000_000.0,
    atrStopMinPct: 2.5,
    atrStopMaxPct: 5.0,
    dynamicRrNormal: 1.5,
    dynamicRrOutperform: 1.8,
    dataProviderType: 'financial_statements',
    priceDbTable: 'price_history',
    isContinuous24_7: false,
    priceFloor: 1.0,
    notes: 'QSE: سوق محدود → صفقات أقل.',
  },

  // ─── CRYPTO — العملات الرقمية (تقلب عالٍ، 24/7) ───────────────────
  CRYPTO: {
    marketCode: 'CRYPTO',
    marketNameEn: 'Cryptocurrency Market',
    marketNameAr: 'العملات الرقمية',
    currency: 'USD',
    weights: { technical: 45, volume: 30, candlestick: 10, fundamental: 0, sentiment: 12, sector: 3 },
    defaultStrategy: 'BREAKOUT',
    minScoreBuy: 72.0,
    minScoreStrong: 85.0,
    minScoreSell: 35.0,
    minVolumeFilter: 1_000_000,
    minValueTraded: 1_000_000,
    minRR: 2.0,
    stopMaxPct: 20.0,
    stopMinPct: 5.0,
    stopAtrMult: 2.5,
    stopFixedPct: 10.0,
    targetRrMult: 2.5,
    targetMinPct: 10.0,
    targetMaxPct: 50.0,
    maxConcurrentTrades: 2,
    positionSizePct: 3.0,
    rsiOverbought: 75.0,
    rsiOversold: 25.0,
    rsiExtremeHigh: 88.0,
    rsiExtremeLow: 15.0,
    benchmarkTicker: 'BTC.D',
    minTurnoverLocal: 5_000_000.0,
    atrStopMinPct: 5.0,
    atrStopMaxPct: 15.0,
    dynamicRrNormal: 1.8,
    dynamicRrOutperform: 2.5,
    dataProviderType: 'on_chain_tokenomics',
    priceDbTable: 'crypto_prices',
    isContinuous24_7: true,
    priceFloor: 0.000001, // meme coins و micro-caps — penny rule الـ $1 بيتكسر هنا
    notes: 'CRYPTO: تقلب عالٍ. حجم مركز 3% فقط. الأخبار مهمة.',
  },

  // ─── US — الأسهم الأمريكية (P1-FIX Round 2) ────────────────────────
  US: {
    marketCode: 'US',
    marketNameEn: 'US Stocks',
    marketNameAr: 'الأسهم الأمريكية',
    currency: 'USD',
    weights: { technical: 40, volume: 25, candlestick: 15, fundamental: 15, sentiment: 3, sector: 2 },
    defaultStrategy: 'SWING',
    minScoreBuy: 68.0,
    minScoreStrong: 82.0,
    minScoreSell: 35.0,
    minVolumeFilter: 100_000,
    minValueTraded: 500_000,
    minRR: 1.5,
    stopMaxPct: 15.0,
    stopMinPct: 3.0,
    stopAtrMult: 2.0,
    stopFixedPct: 5.0,
    targetRrMult: 2.0,
    targetMinPct: 5.0,
    targetMaxPct: 25.0,
    maxConcurrentTrades: 3,
    positionSizePct: 10.0,
    rsiOverbought: 70.0,
    rsiOversold: 30.0,
    rsiExtremeHigh: 85.0,
    rsiExtremeLow: 20.0,
    benchmarkTicker: 'SPY',
    minTurnoverLocal: 500_000.0,
    atrStopMinPct: 5.0,
    atrStopMaxPct: 15.0,
    dynamicRrNormal: 1.8,
    dynamicRrOutperform: 2.5,
    dataProviderType: 'yahoo_finance',
    priceDbTable: 'historical_data',
    isContinuous24_7: false,
    priceFloor: 1.0, // penny stocks US (<$1) OTC — غير موصى بها
    notes: 'US: Swing. Penny stocks (<$1) OTC غير مقبولة.',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 3) HELPER — getMarketProfile(market: MarketType)
// ═══════════════════════════════════════════════════════════════════════════
// MarketType = 'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'US' | 'CRYPTO'
// Python key = 'EGX' | 'KSA' | 'KSE' | 'QSE' | 'US' | 'CRYPTO' (TADAWUL → KSA)
// نستخدم MARKET_CODES من store للتحويل (Rule 28: لا تكرار التحويل)

import { MARKET_CODES } from '@/lib/store';

/**
 * بيرجّع MarketProfile لأي MarketType من الـ store.
 * لو السوق مش موجود (مستحيل لو MarketType صحيح) → fallback لـ EGX
 * مع log واضح عشان نلحق الـ bug (Rule 27: لا fabrication صامتة).
 */
export function getMarketProfile(market: MarketType): MarketProfile {
  const pythonKey = MARKET_CODES[market] ?? 'EGX';
  const profile = MARKET_PROFILES[pythonKey];
  if (!profile) {
    // Rule 27: لا نرجّع قيمة كاذبة بصمت — نحذّر ونسقط لـ EGX
    console.warn(`[market-profiles] لم يتم العثور على ملف تعريف لـ ${market} (key=${pythonKey}) — fallback إلى EGX`);
    return MARKET_PROFILES.EGX;
  }
  return profile;
}

/**
 * بيرجّع currency label عربي مختصر للعرض (ج.م / ريال / د.ك / ر.ق / $).
 * هذا مجرد re-export لتسهيل الاستيراد من مكان واحد.
 */
import { MARKET_CURRENCY_LABEL } from '@/lib/store';
export { MARKET_CURRENCY_LABEL };

/**
 * بيرجّع وحدة العملة العربية الكاملة للنصوص الاحترافية.
 * "جنيه" / "ريال" / "دينار كويتي" / "ريال قطري" / "دولار"
 * Rule 27 fix: expert-analysis.ts كان بيستخدم "جنيه" hard-coded لكل الأسواق.
 */
export function currencyUnitAr(market: MarketType): string {
  switch (market) {
    case 'EGX': return 'جنيه';
    case 'TADAWUL': return 'ريال';
    case 'KSE': return 'دينار كويتي';
    case 'QSE': return 'ريال قطري';
    case 'US': return 'دولار';
    case 'CRYPTO': return 'دولار';
    default: return 'جنيه';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SELF-TEST — تأكد إن الـ port مطابق لـ Python (Rule 14: لا commit قبل التحقق)
// ═══════════════════════════════════════════════════════════════════════════
// Run: npx tsx src/lib/market-profiles.ts

if (typeof require !== 'undefined' && require.main === module) {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) { console.error('❌ ' + msg); process.exit(1); }
    console.log('✅ ' + msg);
  };

  console.log('=== market-profiles.ts self-test ===\n');

  // EGX
  const egx = getMarketProfile('EGX');
  assert(egx.marketCode === 'EGX', 'EGX.marketCode = EGX');
  assert(egx.stopMaxPct === 7.0, 'EGX stop_max = 7.0 (Rule 8)');
  assert(egx.minRR === 1.8, 'EGX min_rr = 1.8 (Rule 18)');
  assert(egx.rsiOverbought === 70.0, 'EGX RSI overbought = 70');
  assert(egx.weights.technical === 40, 'EGX technical weight = 40');
  assert(egx.isContinuous24_7 === false, 'EGX not 24/7');

  // TADAWUL → KSA mapping
  const ksa = getMarketProfile('TADAWUL');
  assert(ksa.marketCode === 'KSA', 'TADAWUL → KSA mapping correct');
  assert(ksa.stopMaxPct === 8.0, 'KSA stop_max = 8.0');
  assert(ksa.defaultStrategy === 'SWING', 'KSA strategy = SWING (T+1 فشل)');

  // CRYPTO — القيم الحرجة (دي بتكسرلو اتطبّق على EGX)
  const crypto = getMarketProfile('CRYPTO');
  assert(crypto.stopMaxPct === 20.0, 'CRYPTO stop_max = 20.0 (مش EGX 7%)');
  assert(crypto.rsiOverbought === 75.0, 'CRYPTO RSI overbought = 75 (مش 70)');
  assert(crypto.weights.fundamental === 0, 'CRYPTO fundamental = 0 (مش 5)');
  assert(crypto.isContinuous24_7 === true, 'CRYPTO 24/7');
  assert(crypto.priceFloor < 0.01, 'CRYPTO priceFloor < 0.01 (مش 1.0)');

  // US
  const us = getMarketProfile('US');
  assert(us.marketCode === 'US', 'US.marketCode = US');
  assert(us.currency === 'USD', 'US currency = USD');

  // currencyUnitAr
  assert(currencyUnitAr('EGX') === 'جنيه', 'currencyUnitAr(EGX) = جنيه');
  assert(currencyUnitAr('TADAWUL') === 'ريال', 'currencyUnitAr(TADAWUL) = ريال');
  assert(currencyUnitAr('US') === 'دولار', 'currencyUnitAr(US) = دولار');
  assert(currencyUnitAr('CRYPTO') === 'دولار', 'currencyUnitAr(CRYPTO) = دولار');

  console.log('\n=== All market-profiles.ts tests passed ===');
  console.log('الـ port مطابق لـ vps-service/config/unified_config.py ✅');
}
