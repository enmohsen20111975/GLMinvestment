/**
 * Unified Maestro Orchestrator - The Conductor
 * موحد المايسترو - القائد
 * 
 * Combines all 6 phases of EGX stock analysis and produces the final Maestro Score (0-100).
 * يجمع جميع مراحل التحليل الـ 6 وينتج درجة المايسترو النهائية (0-100).
 * 
 * Phases:
 * 1. Regime Detection - كشف حالة السوق
 * 2. Timeframe Confluence - تقارب الأطر الزمنية
 * 3. Volume Context - سياق الحجم
 * 4. News Context - سياق الأخبار
 * 5. Maestro Score Calculation - حساب درجة المايسترو
 * 6. Persona Refinement - تخصيص الشخصية
 * 
 * @version 1.0.0
 * @authorM2yDevelopers Team
 */

import { detectMarketRegime } from '@/lib/analysis-engine';
import { applySafetyFilter, detectManipulation } from './safety-filter';
import { 
  analyzeTimeframes, 
  type TimeframeAnalysis, 
  type TimeframeTrend 
} from './multi-timeframe-engine';
import { 
  analyzeNewsSentiment, 
  getTickerNewsSentiment,
  calculateSentimentScore,
  calculateImpactScore,
  extractKeywords,
  checkNewsStopFilter,
  hasRecentCBENews,
  type NewsSentiment,
  type TickerSentimentSummary,
  type NewsStopFilterResult
} from './news-sentiment-engine';
import { 
  calculateQualityScore,
  type QualityScore 
} from './quality-engine';
import {
  calculateMomentum,
  checkSignalConfluence,
  type MomentumResult
} from './momentum-engine';
import { calculateFairValue, type FairValueResult } from './fair-value';
import { getMarketRegime, getWeight } from './config-service';
import { db } from '@/lib/db';
import type { MarketRegime, RedFlag, SafetyViolation } from './types';

// ==================== TYPES ====================

/**
 * نتيجة مرحلة كشف حالة السوق
 */
export interface RegimePhaseResult {
  phase: 'bull' | 'bear' | 'range';
  confidence: number;
  score: number; // 0-100
  signals: string[];
  details?: {
    smaAlignment?: string;
    rocValue?: number;
    adxValue?: number;
  };
}

/**
 * نتيجة مرحلة تقارب الأطر الزمنية
 */
export interface TimeframePhaseResult {
  confluenceScore: number;
  aligned: boolean;
  alignedCount: number;
  dailyTrend: string;
  signals: string[];
  details?: TimeframeAnalysis;
}

/**
 * نتيجة مرحلة سياق الحجم
 */
export interface VolumePhaseResult {
  liquidityRating: 'high' | 'medium' | 'low';
  volumeRatio: number;
  volumeAboveAvg: boolean;
  signals: string[];
  details?: {
    currentVolume: number;
    avgVolume20: number;
    avgValueTraded: number;
    manipulationFlags?: RedFlag[];
  };
}

/**
 * نتيجة مرحلة سياق الأخبار
 */
export interface NewsPhaseResult {
  sentiment: 'positive' | 'negative' | 'neutral';
  sentimentScore: number;
  impactScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  signals: string[];
  details?: {
    recentNewsCount?: number;
    dominantSentiment?: string;
    keywords?: string[];
  };
}

/**
 * نتيجة تحليل الشخصية
 */
export interface PersonaResult {
  type: string;
  adjustedScore: number;
  positionSizePercent: number;
  notes: string[];
}

/**
 * نتيجة المايسترو الكاملة
 */
export interface MaestroResult {
  ticker: string;
  timestamp: string;
  
  // Phase Results
  phases: {
    regime: RegimePhaseResult;
    timeframe: TimeframePhaseResult;
    volume: VolumePhaseResult;
    news: NewsPhaseResult;
  };
  
  // Final Score
  maestroScore: number; // 0-100
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  recommendationAr: string;
  confidence: number;
  
  // Trading Details
  entry: {
    price: number;
    strategy: string;
    strategyAr: string;
  };
  stopLoss: number;
  target: number;
  riskReward: number;
  
  // Persona-specific
  persona?: PersonaResult;
  
  // Signal Logging
  signalId?: number;
  
  // Warnings
  warnings: string[];
  warningsAr: string[];
}

/**
 * خيارات التحليل
 */
export interface MaestroOptions {
  personaType?: string;
  skipPhases?: number[];
  forceRegime?: 'bull' | 'bear' | 'range';
  capital?: number;
}

// ==================== CONSTANTS ====================

/**
 * أوزان المراحل حسب حالة السوق
 */
const REGIME_WEIGHTS = {
  bull: {
    technical: 0.40,
    quality: 0.30,
    timeframe: 0.20,
    news: 0.10,
  },
  bear: {
    quality: 0.50,
    technical: 0.20,
    timeframe: 0.15,
    news: 0.15,
  },
  range: {
    technical: 0.35,
    quality: 0.35,
    timeframe: 0.20,
    news: 0.10,
  },
};

/**
 * إعدادات الشخصيات
 */
const PERSONA_CONFIGS: Record<string, {
  minScore: number;
  maxPositionPercent: number;
  stopLossMultiplier: number;
  targetMultiplier: number;
  riskTolerance: 'low' | 'medium' | 'high';
}> = {
  conservative: {
    minScore: 70,
    maxPositionPercent: 5,
    stopLossMultiplier: 0.85,
    targetMultiplier: 0.8,
    riskTolerance: 'low',
  },
  cautious: {
    minScore: 65,
    maxPositionPercent: 7,
    stopLossMultiplier: 0.9,
    targetMultiplier: 0.9,
    riskTolerance: 'low',
  },
  balanced: {
    minScore: 55,
    maxPositionPercent: 10,
    stopLossMultiplier: 1.0,
    targetMultiplier: 1.0,
    riskTolerance: 'medium',
  },
  active_trader: {
    minScore: 50,
    maxPositionPercent: 12,
    stopLossMultiplier: 1.0,
    targetMultiplier: 1.1,
    riskTolerance: 'medium',
  },
  adventurer: {
    minScore: 45,
    maxPositionPercent: 15,
    stopLossMultiplier: 1.1,
    targetMultiplier: 1.2,
    riskTolerance: 'high',
  },
  gambler: {
    minScore: 35,
    maxPositionPercent: 20,
    stopLossMultiplier: 1.2,
    targetMultiplier: 1.3,
    riskTolerance: 'high',
  },
  hedger: {
    minScore: 60,
    maxPositionPercent: 8,
    stopLossMultiplier: 0.9,
    targetMultiplier: 0.85,
    riskTolerance: 'low',
  },
};

// ==================== HELPER FUNCTIONS ====================

function toNum(v: unknown, fallback: number = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * تحويل حالة السوق للعربية
 */
function getRegimeArabic(regime: 'bull' | 'bear' | 'range'): string {
  switch (regime) {
    case 'bull': return 'صاعد';
    case 'bear': return 'هابط';
    case 'range': return 'متراوح';
  }
}

/**
 * تحويل التوقعة للعربية
 */
function getRecommendationArabic(rec: MaestroResult['recommendation']): string {
  switch (rec) {
    case 'strong_buy': return 'شراء قوي';
    case 'buy': return 'شراء';
    case 'hold': return 'احتفاظ';
    case 'sell': return 'بيع';
    case 'strong_sell': return 'بيع قوي';
  }
}

// ==================== PHASE 1: REGIME DETECTION ====================

/**
 * Phase 1: كشف حالة السوق
 */
async function runRegimePhase(
  ticker: string,
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>,
  forceRegime?: 'bull' | 'bear' | 'range'
): Promise<RegimePhaseResult> {
  const signals: string[] = [];
  const closes = priceHistory
    .map(p => toNum(p.close_price ?? p.close))
    .filter(c => c > 0);

  // إذا تم تحديد النظام بالقوة
  if (forceRegime) {
    const confidence = 0.95;
    const score = forceRegime === 'bull' ? 80 : forceRegime === 'bear' ? 25 : 50;
    signals.push(`حالة السوق محددة يدوياً: ${getRegimeArabic(forceRegime)}`);
    return {
      phase: forceRegime,
      confidence,
      score,
      signals,
    };
  }

  // كشف حالة السوق من البيانات
  const detectedRegime = detectMarketRegime(closes);
  
  // تحويل النتيجة للصيغة المطلوبة
  let phase: 'bull' | 'bear' | 'range';
  let confidence: number;
  let score: number;

  if (detectedRegime === 'BULL') {
    phase = 'bull';
    confidence = 0.75;
    score = 75;
    signals.push('الاتجاه صاعد - SMA20 > SMA50 والسعر فوق المتوسطات');
  } else if (detectedRegime === 'BEAR') {
    phase = 'bear';
    confidence = 0.75;
    score = 30;
    signals.push('الاتجاه هابط - SMA20 < SMA50 والسعر تحت المتوسطات');
  } else {
    phase = 'range';
    confidence = 0.60;
    score = 50;
    signals.push('السوق متراوح - لا يوجد اتجاه واضح');
  }

  // حساب التفاصيل الإضافية
  const sma20 = closes.length >= 20 
    ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 
    : 0;
  const sma50 = closes.length >= 50 
    ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 
    : 0;

  return {
    phase,
    confidence,
    score,
    signals,
    details: {
      smaAlignment: sma20 > sma50 ? 'bullish' : sma20 < sma50 ? 'bearish' : 'neutral',
      rocValue: closes.length >= 10 
        ? ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100 
        : 0,
    },
  };
}

// ==================== PHASE 2: TIMEFRAME CONFLUENCE ====================

/**
 * Phase 2: تقارب الأطر الزمنية
 */
async function runTimeframePhase(
  ticker: string,
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>
): Promise<TimeframePhaseResult> {
  const signals: string[] = [];

  // تحليل الأطر الزمنية
  const analysis = analyzeTimeframes(ticker, priceHistory, stock);

  // حساب درجة التقارب
  const confluenceScore = analysis.confluence.score;
  const aligned = analysis.confluence.aligned;
  const alignedCount = analysis.confluence.alignedCount;

  // تحديد الاتجاه اليومي
  const dailyTrend = analysis.daily.trend;
  const dailyTrendAr = dailyTrend === 'bullish' ? 'صاعد' 
    : dailyTrend === 'bearish' ? 'هابط' 
    : 'محايد';

  // إشارات التحليل
  if (aligned && alignedCount >= 3) {
    signals.push(`تقارب قوي: ${alignedCount} أطر زمنية متوافقة (${dailyTrendAr})`);
  } else if (alignedCount >= 2) {
    signals.push(`تقارب جزئي: ${alignedCount} أطر زمنية متوافقة`);
  } else {
    signals.push('لا يوجد تقارب واضح بين الأطر الزمنية');
  }

  // إضافة إشارات الإطار اليومي
  signals.push(...analysis.daily.signals.slice(0, 2));

  return {
    confluenceScore,
    aligned,
    alignedCount,
    dailyTrend: dailyTrendAr,
    signals,
    details: analysis,
  };
}

// ==================== PHASE 3: VOLUME CONTEXT ====================

/**
 * Phase 3: سياق الحجم
 */
async function runVolumePhase(
  ticker: string,
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>
): Promise<VolumePhaseResult> {
  const signals: string[] = [];
  const currentVolume = toNum(stock.volume, 0);
  const currentPrice = toNum(stock.current_price, 0);

  // حساب متوسط الحجم لـ 20 يوم
  const volumes = priceHistory
    .slice(-20)
    .map(p => toNum(p.volume, 0))
    .filter(v => v > 0);

  const avgVolume20 = volumes.length > 0 
    ? volumes.reduce((a, b) => a + b, 0) / volumes.length 
    : currentVolume;

  const volumeRatio = avgVolume20 > 0 ? round2(currentVolume / avgVolume20) : 1;
  const volumeAboveAvg = volumeRatio > 1.2;

  // حساب متوسط قيمة التداول
  const avgValueTraded = avgVolume20 * currentPrice;

  // تحديد مستوى السيولة
  let liquidityRating: 'high' | 'medium' | 'low';
  let liquidityRatingAr: string;

  if (avgValueTraded >= 10_000_000) {
    liquidityRating = 'high';
    liquidityRatingAr = 'عالية';
    signals.push(`سيولة عالية (${(avgValueTraded / 1_000_000).toFixed(1)} مليون جنيه يومياً)`);
  } else if (avgValueTraded >= 2_000_000) {
    liquidityRating = 'medium';
    liquidityRatingAr = 'متوسطة';
    signals.push(`سيولة متوسطة (${(avgValueTraded / 1_000_000).toFixed(1)} مليون جنيه يومياً)`);
  } else {
    liquidityRating = 'low';
    liquidityRatingAr = 'منخفضة';
    signals.push(`⚠️ سيولة منخفضة (${(avgValueTraded / 1_000_000).toFixed(1)} مليون جنيه يومياً)`);
  }

  // إشارات الحجم
  if (volumeAboveAvg) {
    signals.push(`حجم التداول مرتفع ${volumeRatio}x المتوسط`);
  } else if (volumeRatio < 0.7) {
    signals.push(`حجم التداول منخفض ${volumeRatio}x المتوسط`);
  }

  // كشف التلاعب
  const manipulationFlags = detectManipulation(stock, priceHistory);
  if (manipulationFlags.length > 0) {
    signals.push(`⚠️ تحذير: ${manipulationFlags.map(f => f.typeAr).join('، ')}`);
  }

  return {
    liquidityRating,
    volumeRatio,
    volumeAboveAvg,
    signals,
    details: {
      currentVolume,
      avgVolume20,
      avgValueTraded,
      manipulationFlags,
    },
  };
}

// ==================== PHASE 4: NEWS CONTEXT ====================

/**
 * Phase 4: سياق الأخبار - مبسط (Stop Filter)
 * 
 * كيمي اقترح تبسيط الـ News لـ Stop Filter فقط
 * ده أوثق من الـ sentiment المعقد اللي ممكن يدي false positives
 */
async function runNewsPhase(
  ticker: string,
  stock: Record<string, unknown>
): Promise<NewsPhaseResult> {
  const signals: string[] = [];

  try {
    // استخدام Stop Filter المبسط
    const newsFilter = await checkNewsStopFilter(ticker, 1);

    // تحديد المخاطرة
    let riskLevel: 'low' | 'medium' | 'high';
    let sentiment: 'positive' | 'negative' | 'neutral';
    let sentimentScore: number;
    let impactScore: number;

    if (newsFilter.hasCBENews) {
      // قرار بنك مركزي = مخاطرة عالية
      riskLevel = 'high';
      sentiment = 'neutral'; // لا نحدد المشاعر، بس نقول "فيه خبر"
      sentimentScore = 0;
      impactScore = 0.9;
      signals.push('⚠️ قرار بنك مركزي في آخر 24 ساعة');
      signals.push(newsFilter.reasonAr);
    } else if (newsFilter.hasNews) {
      // فيه أخبار على السهم = مخاطرة متوسطة
      riskLevel = 'medium';
      sentiment = 'neutral';
      sentimentScore = 0;
      impactScore = 0.5;
      signals.push(`📰 ${newsFilter.newsCount} خبر في آخر 24 ساعة`);
      signals.push(newsFilter.reasonAr);
    } else {
      // مفيش أخبار = مخاطرة منخفضة
      riskLevel = 'low';
      sentiment = 'neutral';
      sentimentScore = 0;
      impactScore = 0;
      signals.push('لا توجد أخبار حديثة');
    }

    return {
      sentiment,
      sentimentScore,
      impactScore,
      riskLevel,
      signals,
      details: {
        recentNewsCount: newsFilter.newsCount,
        dominantSentiment: newsFilter.shouldHold ? 'hold_recommended' : 'proceed',
      },
    };
  } catch (error) {
    // في حالة الخطأ، أرجع قيم افتراضية
    return {
      sentiment: 'neutral',
      sentimentScore: 0,
      impactScore: 0,
      riskLevel: 'low',
      signals: ['لا توجد أخبار متاحة', 'No news available'],
    };
  }
}

// ==================== PHASE 5: MAESTRO SCORE CALCULATION ====================

/**
 * Phase 5: حساب درجة المايسترو
 */
function calculateMaestroScore(
  regimePhase: RegimePhaseResult,
  timeframePhase: TimeframePhaseResult,
  volumePhase: VolumePhaseResult,
  newsPhase: NewsPhaseResult,
  qualityScore: QualityScore,
  technicalScore: MomentumResult,
  fairValue: FairValueResult
): number {
  const regime = regimePhase.phase;
  const weights = REGIME_WEIGHTS[regime];

  // تحويل الدرجات لنطاق 0-100
  const technicalNormalized = technicalScore.score;
  const qualityNormalized = qualityScore.total;
  const timeframeNormalized = timeframePhase.confluenceScore;
  
  // تحويل درجة الأخبار من -1~1 إلى 0-100
  const newsNormalized = ((newsPhase.sentimentScore + 1) / 2) * 100;

  // حساب الدرجة الأساسية
  let maestroScore = 
    technicalNormalized * weights.technical +
    qualityNormalized * weights.quality +
    timeframeNormalized * weights.timeframe +
    newsNormalized * weights.news;

  // تعديلات خاصة

  // تخفيض في حالة السوق الهابط
  if (regime === 'bear') {
    maestroScore *= 0.85;
  }

  // تخفيض في حالة السيولة المنخفضة
  if (volumePhase.liquidityRating === 'low') {
    maestroScore *= 0.90;
  }

  // تخفيض في حالة الأخبار السلبية
  if (newsPhase.riskLevel === 'high') {
    maestroScore *= 0.85;
  }

  // مكافأة التقارب
  if (timeframePhase.aligned && timeframePhase.alignedCount >= 3) {
    maestroScore += 5;
  }

  // مكافأة القيمة العادلة
  if (fairValue.upsidePotential > 30) {
    maestroScore += 3;
  }

  return clamp(Math.round(maestroScore), 0, 100);
}

/**
 * تحديد التوقعة بناءً على الدرجة
 */
function determineRecommendation(
  maestroScore: number,
  regime: 'bull' | 'bear' | 'range'
): MaestroResult['recommendation'] {
  // عتبات ديناميكية حسب حالة السوق
  let strongBuyThreshold: number;
  let buyThreshold: number;
  let holdThreshold: number;
  let sellThreshold: number;

  switch (regime) {
    case 'bull':
      strongBuyThreshold = 75;
      buyThreshold = 60;
      holdThreshold = 45;
      sellThreshold = 35;
      break;
    case 'bear':
      strongBuyThreshold = 80;
      buyThreshold = 70;
      holdThreshold = 55;
      sellThreshold = 45;
      break;
    case 'range':
    default:
      strongBuyThreshold = 70;
      buyThreshold = 55;
      holdThreshold = 40;
      sellThreshold = 30;
      break;
  }

  if (maestroScore >= strongBuyThreshold) return 'strong_buy';
  if (maestroScore >= buyThreshold) return 'buy';
  if (maestroScore >= holdThreshold) return 'hold';
  if (maestroScore >= sellThreshold) return 'sell';
  return 'strong_sell';
}

// ==================== PHASE 6: PERSONA REFINEMENT ====================

/**
 * Phase 6: تخصيص الشخصية
 */
function applyPersonaRefinement(
  maestroScore: number,
  recommendation: MaestroResult['recommendation'],
  personaType: string,
  entryPrice: number,
  stopLoss: number,
  target: number
): PersonaResult {
  const config = PERSONA_CONFIGS[personaType.toLowerCase()] || PERSONA_CONFIGS.balanced;
  const notes: string[] = [];

  // تعديل الدرجة حسب الشخصية
  let adjustedScore = maestroScore;
  let positionSizePercent = 0;

  // التحقق من الحد الأدنى للدرجة
  if (maestroScore < config.minScore && 
      (recommendation === 'buy' || recommendation === 'strong_buy')) {
    // تخفيض التوقعة
    adjustedScore = maestroScore - 10;
    notes.push(`الدرجة ${maestroScore} أقل من الحد الأدنى ${config.minScore} لهذه الشخصية`);
  }

  // حساب حجم المركز
  if (recommendation === 'strong_buy') {
    positionSizePercent = config.maxPositionPercent;
  } else if (recommendation === 'buy') {
    positionSizePercent = config.maxPositionPercent * 0.75;
  } else if (recommendation === 'hold') {
    positionSizePercent = config.maxPositionPercent * 0.25;
  }

  // ملاحظات حسب الشخصية
  if (config.riskTolerance === 'low') {
    notes.push('توقعة محافظة - تم تطبيق معايير صارمة');
  } else if (config.riskTolerance === 'high') {
    notes.push('توقعة عالية المخاطرة - توخي الحذر');
  }

  return {
    type: personaType,
    adjustedScore,
    positionSizePercent,
    notes,
  };
}

// ==================== DATABASE LOGGING ====================

/**
 * تسجيل الإشارة في قاعدة البيانات
 */
async function logSignalToDatabase(
  ticker: string,
  result: MaestroResult
): Promise<number | undefined> {
  try {
    const { getLightDb } = await import('@/lib/egx-db');
    const stocksDb = getLightDb();
    
    // التحقق من وجود جدول signal_logs
    const stmt = stocksDb.prepare(`
      INSERT INTO signal_logs (
        ticker, 
        signal_type, 
        score, 
        price, 
        target, 
        stop_loss, 
        confidence, 
        regime, 
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    
    const info = stmt.run(
      ticker,
      result.recommendation,
      result.maestroScore,
      result.entry.price,
      result.target,
      result.stopLoss,
      result.confidence,
      result.phases.regime.phase
    );
    
    return Number(info.lastInsertRowid);
  } catch (error) {
    console.error('[MaestroOrchestrator] Error logging signal:', error);
    return undefined;
  }
}

// ==================== MAIN ORCHESTRATOR ====================

/**
 * تشغيل تحليل المايسترو الكامل
 */
export async function runMaestroAnalysis(
  ticker: string,
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>,
  options: MaestroOptions = {}
): Promise<MaestroResult> {
  const {
    personaType = 'balanced',
    skipPhases = [],
    forceRegime,
    capital = 100000,
  } = options;

  const warnings: string[] = [];
  const warningsAr: string[] = [];

  // ===== PHASE 1: REGIME DETECTION =====
  const regimePhase = skipPhases.includes(1)
    ? { phase: 'range' as const, confidence: 0.5, score: 50, signals: ['تم تخطي هذه المرحلة'] }
    : await runRegimePhase(ticker, stock, priceHistory, forceRegime);

  // ===== PHASE 2: TIMEFRAME CONFLUENCE =====
  const timeframePhase = skipPhases.includes(2)
    ? { confluenceScore: 50, aligned: false, alignedCount: 0, dailyTrend: 'محايد', signals: ['تم تخطي هذه المرحلة'] }
    : await runTimeframePhase(ticker, stock, priceHistory);

  // ===== PHASE 3: VOLUME CONTEXT =====
  const volumePhase = skipPhases.includes(3)
    ? { liquidityRating: 'medium' as const, volumeRatio: 1, volumeAboveAvg: false, signals: ['تم تخطي هذه المرحلة'] }
    : await runVolumePhase(ticker, stock, priceHistory);

  // ===== PHASE 4: NEWS CONTEXT =====
  const newsPhase = skipPhases.includes(4)
    ? { sentiment: 'neutral' as const, sentimentScore: 0, impactScore: 0, riskLevel: 'low' as const, signals: ['تم تخطي هذه المرحلة'] }
    : await runNewsPhase(ticker, stock);

  // ===== QUALITY & TECHNICAL ANALYSIS =====
  const qualityScore = calculateQualityScore(stock, priceHistory);
  const technicalScore = calculateMomentum(stock, priceHistory);
  const fairValue = calculateFairValue(stock, priceHistory, qualityScore.total);

  // ===== PHASE 5: MAESTRO SCORE =====
  const maestroScore = calculateMaestroScore(
    regimePhase,
    timeframePhase,
    volumePhase,
    newsPhase,
    qualityScore,
    technicalScore,
    fairValue
  );

  // ===== DETERMINE RECOMMENDATION =====
  const recommendation = determineRecommendation(maestroScore, regimePhase.phase);
  const recommendationAr = getRecommendationArabic(recommendation);

  // ===== CALCULATE CONFIDENCE =====
  const confidence = Math.round(
    (regimePhase.confidence * 0.2 +
    (timeframePhase.aligned ? 0.8 : 0.5) * 0.3 +
    (volumePhase.liquidityRating === 'high' ? 0.9 : volumePhase.liquidityRating === 'medium' ? 0.7 : 0.5) * 0.25 +
    (1 - Math.abs(newsPhase.sentimentScore)) * 0.25) * 100
  );

  // ===== CALCULATE ENTRY, STOP, TARGET =====
  const currentPrice = toNum(stock.current_price, 0);
  const entryPrice = recommendation === 'buy' || recommendation === 'strong_buy'
    ? round2(currentPrice * 0.995)
    : currentPrice;

  // حساب Stop Loss
  const atrPercent = 3; // افتراضي
  const stopLoss = round2(entryPrice * (1 - atrPercent / 100 * (recommendation.includes('buy') ? 1.5 : 1)));

  // حساب الهدف
  const target = round2(entryPrice * (1 + fairValue.upsidePotential / 100 * 0.6));

  // نسبة المخاطرة للعائد
  const riskReward = round2((target - entryPrice) / (entryPrice - stopLoss));

  // ===== PHASE 6: PERSONA REFINEMENT =====
  const persona = personaType
    ? applyPersonaRefinement(maestroScore, recommendation, personaType, entryPrice, stopLoss, target)
    : undefined;

  // ===== WARNINGS =====
  if (regimePhase.phase === 'bear') {
    warnings.push('Market is in bear regime - reduce position sizes');
    warningsAr.push('السوق في حالة هبوط - قلل أحجام المراكز');
  }
  if (volumePhase.liquidityRating === 'low') {
    warnings.push('Low liquidity - difficulty in execution');
    warningsAr.push('سيولة منخفضة - صعوبة في التنفيذ');
  }
  if (newsPhase.riskLevel === 'high') {
    warnings.push('High news risk - negative sentiment detected');
    warningsAr.push('مخاطرة أخبار عالية - مشاعر سلبية مكتشفة');
  }

  // ===== BUILD RESULT =====
  const result: MaestroResult = {
    ticker,
    timestamp: new Date().toISOString(),
    phases: {
      regime: regimePhase,
      timeframe: timeframePhase,
      volume: volumePhase,
      news: newsPhase,
    },
    maestroScore,
    recommendation,
    recommendationAr,
    confidence,
    entry: {
      price: entryPrice,
      strategy: recommendation.includes('buy') ? 'Limit order 0.5% below current' : 'Market',
      strategyAr: recommendation.includes('buy') ? 'أمر محدد 0.5% تحت الحالي' : 'سوقي',
    },
    stopLoss,
    target,
    riskReward,
    persona,
    warnings,
    warningsAr,
  };

  // ===== LOG TO DATABASE =====
  try {
    const signalId = await logSignalToDatabase(ticker, result);
    if (signalId) {
      result.signalId = signalId;
    }
  } catch (error) {
    console.error('[MaestroOrchestrator] Database logging failed:', error);
  }

  return result;
}

// ==================== EXPORT UTILITY FUNCTIONS ====================

/**
 * تحليل سريع لسهم واحد
 */
export async function quickAnalyze(
  ticker: string,
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>
): Promise<{
  score: number;
  recommendation: string;
  confidence: number;
}> {
  const result = await runMaestroAnalysis(ticker, stock, priceHistory);
  return {
    score: result.maestroScore,
    recommendation: result.recommendation,
    confidence: result.confidence,
  };
}

/**
 * تحليل دفعة من الأسهم
 */
export async function batchMaestroAnalysis(
  stocks: Array<{
    ticker: string;
    stock: Record<string, unknown>;
    priceHistory: Array<Record<string, unknown>>;
  }>,
  options?: MaestroOptions
): Promise<MaestroResult[]> {
  const results: MaestroResult[] = [];

  for (const { ticker, stock, priceHistory } of stocks) {
    try {
      const result = await runMaestroAnalysis(ticker, stock, priceHistory, options);
      results.push(result);
    } catch (error) {
      console.error(`[MaestroOrchestrator] Error analyzing ${ticker}:`, error);
    }
  }

  // ترتيب حسب الدرجة
  return results.sort((a, b) => b.maestroScore - a.maestroScore);
}

/**
 * الحصول على أفضل فرص الشراء
 */
export async function getTopBuyOpportunities(
  stocks: Array<{
    ticker: string;
    stock: Record<string, unknown>;
    priceHistory: Array<Record<string, unknown>>;
  }>,
  limit: number = 10,
  options?: MaestroOptions
): Promise<MaestroResult[]> {
  const results = await batchMaestroAnalysis(stocks, options);

  return results
    .filter(r => r.recommendation === 'buy' || r.recommendation === 'strong_buy')
    .slice(0, limit);
}

// تصدير الأنواع للاستخدام الخارجي
export type {
  RegimePhaseResult,
  TimeframePhaseResult,
  VolumePhaseResult,
  NewsPhaseResult,
  PersonaResult,
  MaestroOptions,
};

// ==================== CIRCUIT BREAKER ====================
// كيمي اقترحت الـ Circuit Breaker لحماية المستخدم من "أيام البلطجة"

/**
 * نتيجة فحص Circuit Breaker
 */
export interface CircuitBreakerResult {
  triggered: boolean;           // هل الـ Circuit Breaker شغال؟
  level: 'none' | 'warning' | 'critical' | 'extreme';
  action: 'proceed' | 'caution' | 'hold_all' | 'no_signals';
  reason: string;
  reasonAr: string;
  egx30Change?: number;
  consecutiveDownDays?: number;
}

/**
 * Circuit Breaker - حماية من تقلبات السوق الشديدة
 * 
 * القواعد:
 * 1. EGX30 نازل >2% في يوم واحد → HOLD (تحذير)
 * 2. EGX30 نازل >3% في 3 أيام متتالية → NO_SIGNAL (خطر)
 * 3. EGX30 طالع >3% في 3 أيام متتالية → رفع الحد الأدنى للدرجة (السوق سخن)
 * 
 * @param egx30History تاريخ مؤشر EGX30 (آخر 5 أيام)
 * @returns نتيجة الـ Circuit Breaker
 */
export function checkCircuitBreaker(
  egx30History: Array<{ date: string; close: number; change_percent: number }>
): CircuitBreakerResult {
  // افتراضي: لا يوجد Circuit Breaker
  const defaultResult: CircuitBreakerResult = {
    triggered: false,
    level: 'none',
    action: 'proceed',
    reason: 'Normal market conditions',
    reasonAr: 'ظروف سوق طبيعية',
  };

  if (!egx30History || egx30History.length === 0) {
    return defaultResult;
  }

  // ترتيب حسب التاريخ (الأحدث أولاً)
  const sorted = [...egx30History].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const latest = sorted[0];
  const changeToday = latest?.change_percent || 0;

  // القاعدة 1: نزول حاد في يوم واحد (>2%)
  if (changeToday < -2) {
    return {
      triggered: true,
      level: 'warning',
      action: 'caution',
      reason: `EGX30 down ${Math.abs(changeToday).toFixed(1)}% today - reduce position sizes`,
      reasonAr: `EGX30 نزل ${Math.abs(changeToday).toFixed(1)}% اليوم - قلل أحجام المراكز`,
      egx30Change: changeToday,
    };
  }

  // القاعدة 2: نزول حاد في يوم واحد (>3%)
  if (changeToday < -3) {
    return {
      triggered: true,
      level: 'critical',
      action: 'hold_all',
      reason: `EGX30 crashed ${Math.abs(changeToday).toFixed(1)}% - HOLD all positions`,
      reasonAr: `EGX30 انهار ${Math.abs(changeToday).toFixed(1)}% - احتفظ بكل المراكز`,
      egx30Change: changeToday,
    };
  }

  // القاعدة 3: نزول متتالي (3 أيام)
  if (sorted.length >= 3) {
    const last3Days = sorted.slice(0, 3);
    const allDown = last3Days.every(d => d.change_percent < 0);
    const totalDrop = last3Days.reduce((sum, d) => sum + d.change_percent, 0);

    if (allDown && totalDrop < -3) {
      return {
        triggered: true,
        level: 'extreme',
        action: 'no_signals',
        reason: `EGX30 down ${Math.abs(totalDrop).toFixed(1)}% over 3 consecutive days - NO SIGNALS`,
        reasonAr: `EGX30 نزل ${Math.abs(totalDrop).toFixed(1)}% خلال 3 أيام متتالية - لا إشارات`,
        consecutiveDownDays: 3,
        egx30Change: totalDrop,
      };
    }
  }

  // القاعدة 4: صعود متتالي (السوق سخن)
  if (sorted.length >= 3) {
    const last3Days = sorted.slice(0, 3);
    const allUp = last3Days.every(d => d.change_percent > 0);
    const totalRise = last3Days.reduce((sum, d) => sum + d.change_percent, 0);

    if (allUp && totalRise > 3) {
      return {
        triggered: true,
        level: 'warning',
        action: 'caution',
        reason: `EGX30 up ${totalRise.toFixed(1)}% over 3 days - market is "hot", raise min score to 80`,
        reasonAr: `EGX30 طلع ${totalRise.toFixed(1)}% خلال 3 أيام - السوق سخن، ارفع الحد الأدنى للدرجة لـ 80`,
        consecutiveDownDays: 0,
        egx30Change: totalRise,
      };
    }
  }

  return defaultResult;
}

/**
 * تطبيق Circuit Breaker على نتيجة المايسترو
 */
export function applyCircuitBreaker(
  result: MaestroResult,
  circuitBreaker: CircuitBreakerResult
): MaestroResult {
  if (!circuitBreaker.triggered) {
    return result;
  }

  const modifiedResult = { ...result };

  switch (circuitBreaker.action) {
    case 'hold_all':
      // تحويل كل التحليلات لـ HOLD
      modifiedResult.recommendation = 'hold';
      modifiedResult.recommendationAr = 'احتفاظ (Circuit Breaker)';
      modifiedResult.warnings.push(circuitBreaker.reason);
      modifiedResult.warningsAr.push(circuitBreaker.reasonAr);
      break;

    case 'no_signals':
      // لا توجد إشارات - تحويل لـ HOLD مع تحذير قوي
      modifiedResult.recommendation = 'hold';
      modifiedResult.recommendationAr = 'لا إشارات (Circuit Breaker)';
      modifiedResult.maestroScore = Math.min(modifiedResult.maestroScore, 40);
      modifiedResult.warnings.push('⚠️ CRITICAL: ' + circuitBreaker.reason);
      modifiedResult.warningsAr.push('⚠️ تحذير حرج: ' + circuitBreaker.reasonAr);
      break;

    case 'caution':
      // تحذير مع تقليص حجم المركز
      modifiedResult.warnings.push(circuitBreaker.reason);
      modifiedResult.warningsAr.push(circuitBreaker.reasonAr);
      if (modifiedResult.persona) {
        modifiedResult.persona.positionSizePercent *= 0.5;
        modifiedResult.persona.notes.push('Position size reduced due to market conditions');
      }
      break;
  }

  return modifiedResult;
}
