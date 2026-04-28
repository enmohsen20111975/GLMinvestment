/**
 * V2 Recommendation Engine — Main Orchestrator (v2.2.0)
 * Combines all 4 layers: Safety → Quality → Momentum → Portfolio
 * 
 * CHANGES in v2.2.0:
 * - Added Expert Analysis Integration (Fibonacci, Ichimoku, Advanced Patterns)
 * - Dead Stock Detection incorporated into safety filter
 * - Human-like scoring system with weighted breakdown
 * - Enhanced pattern recognition (Wedges, Flags, Head & Shoulders)
 * 
 * CHANGES in v2.1.0:
 * - Real ATR calculation from price history (not hardcoded)
 * - Confidence score breakdown (quality, technical, valuation, momentum, data reliability)
 * - Volume analysis (current vs avg, liquidity rating)
 * - Market cap category (Large/Mid/Small)
 * - Risk assessment considers volatility AND liquidity
 */

import { applySafetyFilter, checkRedFlags } from './safety-filter';
import { calculateQualityScore } from './quality-engine';
import { calculateMomentum, checkSignalConfluence } from './momentum-engine';
import { calculateFairValue } from './fair-value';
import { calculatePositionSizing, calculateEntryStrategy, calculateExitStrategy } from './portfolio-engine';
import { getWeight, getMarketRegime, loadSectorAverages, clearCache } from './config-service';
import { runExpertAnalysis, detectDeadStock } from './expert-analysis';
import type {
  StockRecommendation,
  MarketAnalysis,
  MarketRegime,
  RecommendRequest,
  RecommendResponse,
  SafetyViolation,
  RedFlag,
  ConfidenceBreakdown,
  VolumeData,
  MarketCapCategory,
  DataQuality,
  ComprehensiveAnalysis,
} from './types';

// ==================== HELPERS ====================

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

// ==================== ATR CALCULATION ====================

/**
 * Calculate real Average True Range (ATR) from price history.
 * Uses Wilder's smoothing method over 14 periods.
 * Returns ATR as percentage of current price.
 */
function calculateRealATR(
  priceHistory: Array<Record<string, unknown>>,
  currentPrice: number
): number {
  if (!priceHistory || priceHistory.length < 2 || currentPrice <= 0) return 3; // fallback 3%

  const trueRanges: number[] = [];
  for (let i = 1; i < priceHistory.length; i++) {
    const high = toNum(priceHistory[i].high);
    const low = toNum(priceHistory[i].low);
    const prevClose = toNum(priceHistory[i - 1].close) || toNum(priceHistory[i - 1].close_price);

    if (high > 0 && low > 0 && prevClose > 0) {
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trueRanges.push(tr);
    }
  }

  if (trueRanges.length < 5) return 3;

  // Wilder's smoothing (14-period ATR)
  const period = Math.min(14, trueRanges.length);
  let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return currentPrice > 0 ? round2((atr / currentPrice) * 100) : 3;
}

// ==================== VOLUME ANALYSIS ====================

/**
 * Analyze volume data: current vs 20-day average, liquidity rating.
 */
function analyzeVolume(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>
): VolumeData {
  const currentVolume = toNum(stock.volume);

  // Calculate 20-day average volume from price history
  let avgVolume20 = 0;
  if (priceHistory && priceHistory.length >= 5) {
    const volumes = priceHistory
      .slice(-20)
      .map(h => toNum(h.volume))
      .filter(v => v > 0);
    if (volumes.length > 0) {
      avgVolume20 = Math.round(volumes.reduce((s, v) => s + v, 0) / volumes.length);
    }
  }

  // Fallback to stock's stored volume if no history
  if (avgVolume20 === 0) avgVolume20 = currentVolume;

  const volumeRatio = avgVolume20 > 0 ? round2(currentVolume / avgVolume20) : 1;

  // Average value traded (approximate)
  const currentPrice = toNum(stock.current_price);
  const avgValueTraded = round2(avgVolume20 * currentPrice);

  // Liquidity rating based on daily average value traded (EGP)
  // EGX thresholds: >10M EGP = high, >2M = medium, <2M = low
  let liquidityRating: VolumeData['liquidityRating'] = 'low';
  let liquidityRatingAr = 'منخفضة';
  if (avgValueTraded >= 10_000_000) {
    liquidityRating = 'high';
    liquidityRatingAr = 'عالية';
  } else if (avgValueTraded >= 2_000_000) {
    liquidityRating = 'medium';
    liquidityRatingAr = 'متوسطة';
  }

  return {
    currentVolume,
    avgVolume20,
    volumeRatio,
    avgValueTraded,
    liquidityRating,
    liquidityRatingAr,
  };
}

// ==================== MARKET CAP CATEGORY ====================

/**
 * Classify stock by market cap category.
 * EGX thresholds (approximate):
 * - Large Cap: > 10B EGP
 * - Mid Cap: 1B - 10B EGP
 * - Small Cap: < 1B EGP
 */
function classifyMarketCap(
  stock: Record<string, unknown>
): { category: MarketCapCategory; categoryAr: string } {
  const marketCap = toNum(stock.market_cap);
  const currentPrice = toNum(stock.current_price);
  const volume = toNum(stock.volume);

  // Use market_cap if available, else estimate from price × volume (rough heuristic)
  let effectiveCap = marketCap;
  if (effectiveCap <= 0 && currentPrice > 0) {
    // Rough estimate: assume ~100M shares outstanding (very rough for EGX)
    effectiveCap = currentPrice * 100_000_000;
  }

  // Also use volume as a proxy: high-volume stocks tend to be larger caps
  const isHighVolume = volume > 5_000_000;
  const isEGX30 = toNum(stock.egx30_member) === 1 || toNum(stock.egx30_member) === true;

  // EGX30 members are almost always large cap
  if (isEGX30 || effectiveCap >= 10_000_000_000) {
    return { category: 'large', categoryAr: 'سهم كبير (Large Cap)' };
  }
  if (effectiveCap >= 1_000_000_000 || (isHighVolume && currentPrice > 20)) {
    return { category: 'mid', categoryAr: 'سهم متوسط (Mid Cap)' };
  }
  return { category: 'small', categoryAr: 'سهم صغير (Small Cap)' };
}

// ==================== CONFIDENCE BREAKDOWN ====================

/**
 * Calculate confidence score with detailed breakdown.
 * 
 * Final confidence = weighted average of sub-scores:
 * - Quality: 30% (fundamental analysis reliability)
 * - Technical: 25% (timing and pattern reliability)
 * - Valuation: 20% (fair value data quality)
 * - Momentum: 15% (trend strength and volume confirmation)
 * - Data Reliability: 10% (how complete the source data is)
 */
function calculateConfidenceBreakdown(
  qualityScore: number,
  technicalScore: number,
  fairValue: { upsidePotential: number; dataReliable?: boolean; details: { eps: number } },
  momentumScore: number,
  volumeConfirm: boolean,
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>
): ConfidenceBreakdown {
  // Quality sub-score: based on quality engine total
  const quality = clamp(qualityScore, 20, 95);

  // Technical sub-score: based on momentum engine total
  const technical = clamp(technicalScore, 20, 95);

  // Valuation sub-score: based on data quality and fair value reasonableness
  let valuation = 50;
  if (fairValue.dataReliable) {
    valuation = 70;
    if (fairValue.details.eps > 0) valuation += 10;
    // Penalize extreme upside (likely wrong data)
    if (fairValue.upsidePotential > 50) valuation -= 20;
    else if (fairValue.upsidePotential > 30) valuation -= 10;
  } else {
    valuation = 30; // Low confidence in unreliable data
  }
  valuation = clamp(valuation, 20, 95);

  // Momentum sub-score: trend strength + volume confirmation
  let momentum = clamp(momentumScore, 20, 95);
  if (volumeConfirm) momentum = clamp(momentum + 5, 20, 95);
  else momentum = clamp(momentum - 10, 20, 95);

  // Data reliability: check data completeness
  let dataReliability = 50;
  const eps = toNum(stock.eps);
  const pe = toNum(stock.pe_ratio);
  const pb = toNum(stock.pb_ratio);
  const historyLen = priceHistory?.length || 0;

  if (eps > 0) dataReliability += 10;
  if (pe > 0 && pe < 100) dataReliability += 10;
  if (pb > 0 && pb < 20) dataReliability += 5;
  if (historyLen >= 60) dataReliability += 10;
  else if (historyLen >= 30) dataReliability += 5;
  if (toNum(stock.market_cap) > 0) dataReliability += 5;

  dataReliability = clamp(dataReliability, 20, 95);

  return {
    qualityScore: Math.round(quality),
    technicalScore: Math.round(technical),
    valuationScore: Math.round(valuation),
    momentumScore: Math.round(momentum),
    dataReliability: Math.round(dataReliability),
  };
}

/**
 * Calculate overall confidence from breakdown.
 * Weighted average: Quality 30%, Technical 25%, Valuation 20%, Momentum 15%, Data 10%
 */
function computeOverallConfidence(breakdown: ConfidenceBreakdown): number {
  const weighted = (
    breakdown.qualityScore * 0.30 +
    breakdown.technicalScore * 0.25 +
    breakdown.valuationScore * 0.20 +
    breakdown.momentumScore * 0.15 +
    breakdown.dataReliability * 0.10
  );
  return Math.round(clamp(weighted, 25, 95));
}

// ==================== DATA QUALITY ====================

/**
 * Assess the quality of available data for a stock.
 *
 * High (>=70):   Has EPS, P/E, P/B, market_cap, AND price history >= 60 days
 * Medium (>=40): Has EPS OR P/E, AND price history >= 30 days
 * Low (<40):     Missing fundamental data or insufficient history
 */
function calculateDataQuality(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>
): DataQuality {
  const reasons: string[] = [];
  let score = 0;

  const eps = toNum(stock.eps);
  const pe = toNum(stock.pe_ratio);
  const pb = toNum(stock.pb_ratio);
  const marketCap = toNum(stock.market_cap);
  const historyLen = priceHistory?.length || 0;

  // Fundamental data checks (max 60 points)
  if (eps > 0) { score += 15; reasons.push('بيانات الأرباح لكل سهم (EPS) متوفرة'); }
  else { reasons.push('بيانات الأرباح لكل سهم (EPS) غير متوفرة'); }

  if (pe > 0 && pe < 200) { score += 15; reasons.push('مضاعف الربحية (P/E) متوفر'); }
  else { reasons.push('مضاعف الربحية (P/E) غير متوفر أو غير منطقي'); }

  if (pb > 0 && pb < 50) { score += 15; reasons.push('مضاعف القيمة الدفترية (P/B) متوفر'); }
  else { reasons.push('مضاعف القيمة الدفترية (P/B) غير متوفر'); }

  if (marketCap > 0) { score += 15; reasons.push('القيمة السوقية متوفرة'); }
  else { reasons.push('القيمة السوقية غير متوفرة'); }

  // Price history check (max 40 points)
  if (historyLen >= 60) {
    score += 40;
    reasons.push(`تاريخ سعر كافٍ (${historyLen} يوم)`);
  } else if (historyLen >= 30) {
    score += 25;
    reasons.push(`تاريخ سعر متوسط (${historyLen} يوم - يُفضل 60+ يوم)`);
  } else if (historyLen >= 10) {
    score += 10;
    reasons.push(`تاريخ سعر قصير (${historyLen} يوم - غير كافٍ لتحليل موثوق)`);
  } else {
    reasons.push(`تاريخ سعر غير كافٍ (${historyLen} يوم فقط)`);
  }

  score = Math.min(score, 100);

  // Determine level
  let level: DataQuality['level'];
  let levelAr: string;

  if (score >= 70) {
    level = 'high';
    levelAr = 'عالية';
  } else if (score >= 40) {
    level = 'medium';
    levelAr = 'متوسطة';
  } else {
    level = 'low';
    levelAr = 'منخفضة';
  }

  return { level, levelAr, score, reasons };
}

// ==================== MAIN ORCHESTRATOR ====================

const ANALYSIS_VERSION = '2.2.0';

/**
 * Analyze a single stock through all 4 layers + Expert Analysis.
 */
export function analyzeSingleStock(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>,
  capital: number = 100000
): StockRecommendation | null {
  const currentPrice = toNum(stock.current_price);
  if (currentPrice <= 0) return null;

  const regime = getMarketRegime();

  // Normalize price history for expert analysis
  const normalizedHistory = priceHistory.map(p => ({
    date: String(p.date ?? ''),
    open: toNum(p.open_price ?? p.open),
    high: toNum(p.high_price ?? p.high),
    low: toNum(p.low_price ?? p.low),
    close: toNum(p.close_price ?? p.close),
    volume: toNum(p.volume),
  })).filter(p => p.close > 0);

  // ===== EXPERT ANALYSIS (New in v2.2.0) =====
  const expertAnalysis = runExpertAnalysis(stock, normalizedHistory, regime);

  // ===== DEAD STOCK CHECK =====
  // If stock is dead, return early with avoid recommendation
  if (expertAnalysis.deadStock.isDead) {
    const deadViolations: SafetyViolation[] = expertAnalysis.deadStock.reasons.map((reason, i) => ({
      rule: `DEAD_STOCK_${i}`,
      ruleAr: expertAnalysis.deadStock.reasonsAr[i] || reason,
      value: 0,
      threshold: 40,
      severity: 'hard' as const,
    }));
    
    const volumeData = analyzeVolume(stock, priceHistory);
    const { category: marketCapCategory, categoryAr: marketCapCategoryAr } = classifyMarketCap(stock);
    
    return buildAvoidRecommendation(
      stock, 
      deadViolations, 
      [{ type: 'DEAD_STOCK', typeAr: 'سهم ميت', description: expertAnalysis.deadStock.reasons.join(', '), severity: 'critical' }],
      regime, 
      volumeData, 
      marketCapCategory, 
      marketCapCategoryAr
    );
  }

  // ===== VOLUME ANALYSIS =====
  const volumeData = analyzeVolume(stock, priceHistory);

  // ===== MARKET CAP CLASSIFICATION =====
  const { category: marketCapCategory, categoryAr: marketCapCategoryAr } = classifyMarketCap(stock);

  // ===== REAL ATR CALCULATION =====
  const atrPercent = calculateRealATR(priceHistory, currentPrice);

  // ===== LAYER 1: SAFETY FILTER =====
  const safety = applySafetyFilter(stock, priceHistory);
  const redFlags = checkRedFlags(stock);

  // If hard-rejected, return early with avoid
  if (safety.rejected) {
    return buildAvoidRecommendation(stock, safety.violations, redFlags, regime, volumeData, marketCapCategory, marketCapCategoryAr);
  }

  // ===== LAYER 2: QUALITY ENGINE =====
  const quality = calculateQualityScore(stock, priceHistory);

  // ===== LAYER 3: MOMENTUM & TIMING =====
  const momentum = calculateMomentum(stock, priceHistory);

  // ===== SIGNAL CONFLUENCE CHECK =====
  const confluence = checkSignalConfluence(
    quality.total,
    momentum.score,
    momentum.volumeConfirm
  );

  // ===== FAIR VALUE (quality-aware cap) =====
  const fairValue = calculateFairValue(stock, priceHistory, quality.total);

  // ===== COMPOSITE SCORE (regime-aware weights) =====
  const composite = calculateCompositeScore(
    quality.total,
    momentum.score,
    safety.violations.length,
    redFlags.length,
    fairValue.upsidePotential,
    confluence.allAligned,
    regime
  );

  // ===== RECOMMENDATION =====
  const strongBuy = getWeight('strong_buy_threshold', 65);
  const buy = getWeight('buy_threshold', 52);
  const hold = getWeight('hold_threshold', 42);
  const sell = getWeight('sell_threshold', 32);

  let recommendation: StockRecommendation['recommendation'];
  let recommendationAr: string;

  // Signal confluence boosts thresholds but doesn't change recommendation
  const confluenceBonus = confluence.allAligned ? 3 : 0;

  if (composite >= strongBuy + confluenceBonus) {
    recommendation = 'Strong Buy';
    recommendationAr = 'شراء قوي';
  } else if (composite >= buy + confluenceBonus) {
    recommendation = 'Buy';
    recommendationAr = 'شراء';
  } else if (composite >= hold) {
    recommendation = 'Hold';
    recommendationAr = 'احتفاظ';
  } else if (composite >= sell) {
    recommendation = 'Avoid';
    recommendationAr = 'تجنب';
  } else {
    recommendation = 'Strong Avoid';
    recommendationAr = 'تجنب قوي';
  }

  // ===== CONFIDENCE BREAKDOWN =====
  const confidenceBreakdown = calculateConfidenceBreakdown(
    quality.total,
    momentum.score,
    fairValue,
    momentum.score,
    momentum.volumeConfirm,
    stock,
    priceHistory
  );
  const confidence = computeOverallConfidence(confidenceBreakdown);

  // ===== ENTRY / EXIT STRATEGIES =====
  const isBuySignal = recommendation === 'Strong Buy' || recommendation === 'Buy';
  const entryPrice = isBuySignal
    ? Math.round(currentPrice * 0.995 * 100) / 100  // 0.5% below current
    : currentPrice;

  const entryStrategy = isBuySignal
    ? calculateEntryStrategy(currentPrice, momentum.supportResistance.strongSupport, momentum.score)
    : { immediateBuy: 0, dipBuyPercent: 0, dipBuyLevel: 0, cashReserve: 100 };

  // Use REAL ATR for exit strategy (not hardcoded 3%)
  // Pass quality score for dynamic upside cap in target price
  const exitStrategy = calculateExitStrategy(
    currentPrice,
    fairValue.averageFairValue,
    momentum.supportResistance.strongSupport,
    atrPercent,
    quality.total
  );

  // ===== DATA QUALITY =====
  const dataQuality = calculateDataQuality(stock, priceHistory);

  // ===== POSITION SIZING (liquidity-aware) =====
  const positionSizing = isBuySignal
    ? calculatePositionSizing(
        currentPrice,
        fairValue.averageFairValue,
        momentum.supportResistance.strongSupport,
        exitStrategy.stopLoss,
        quality.total,
        momentum.score,
        capital,
        volumeData.avgVolume20,
        volumeData.avgValueTraded
      )
    : {
        kellyPercent: 0,
        adjustedPercent: 0,
        percentOfPortfolio: 0,
        amountEGP: 0,
        sharesCount: 0,
        maxRiskPerStock: getWeight('max_risk_per_stock', 0.10),
      };

  // ===== RISK ASSESSMENT =====
  const maxDrawdown = Math.round(Math.abs(exitStrategy.stopLoss - currentPrice) / currentPrice * 100);

  // Risk level considers BOTH drawdown potential AND liquidity
  let riskLevel: StockRecommendation['riskAssessment']['level'];
  let riskLevelAr: string;

  if (maxDrawdown > 20 || volumeData.liquidityRating === 'low') {
    riskLevel = 'Very High';
    riskLevelAr = 'مرتفعة جداً';
  } else if (maxDrawdown > 12 || (maxDrawdown > 8 && volumeData.liquidityRating === 'medium')) {
    riskLevel = 'High';
    riskLevelAr = 'مرتفعة';
  } else if (maxDrawdown > 6) {
    riskLevel = 'Medium';
    riskLevelAr = 'متوسطة';
  } else {
    riskLevel = 'Low';
    riskLevelAr = 'منخفضة';
  }

  // Small caps get risk penalty in label
  if (marketCapCategory === 'small' && riskLevel === 'Low') {
    riskLevel = 'Medium';
    riskLevelAr = 'متوسطة (سهم صغير)';
  }

  const keyRisks: string[] = [];
  if (momentum.supportResistance.zone === 'distribution') keyRisks.push('توزيع - سعر بالقرب من المقاومة');
  if (redFlags.length > 0) keyRisks.push(redFlags.map(r => r.description).slice(0, 2).join('، '));
  if (toNum(stock.debt_to_equity) > 1.5) keyRisks.push('مديونية مرتفعة');
  if (regime === 'bear') keyRisks.push('سوق هابطة');
  if (volumeData.liquidityRating === 'low') keyRisks.push('سيولة منخفضة - صعوبة في البيع');
  if (marketCapCategory === 'small') keyRisks.push('سهم صغير - تذبذب عالي');
  if (!fairValue.dataReliable) keyRisks.push('بيانات أساسية غير موثوقة');

  return {
    ticker: String(stock.ticker || ''),
    name: String(stock.name || ''),
    nameAr: String(stock.name_ar || ''),
    sector: String(stock.sector || ''),
    currentPrice,
    previousClose: toNum(stock.previous_close),

    safetyPassed: safety.passed,
    violations: safety.violations,
    redFlags,

    qualityScore: quality,
    momentumScore: momentum,

    fairValue,
    compositeScore: Math.round(composite),
    recommendation,
    recommendationAr,
    confidence,
    confidenceBreakdown,

    volume: volumeData,
    marketCapCategory,
    marketCapCategoryAr,

    entryPrice,
    entryStrategy,
    exitStrategy,
    positionSizing,

    riskAssessment: {
      level: riskLevel,
      levelAr: riskLevelAr,
      maxExpectedDrawdown: maxDrawdown,
      keyRisks,
    },

    dataQuality,

    marketRegime: regime,
    analysisVersion: ANALYSIS_VERSION,
  };
}

/**
 * Generate recommendations for all (or filtered) stocks.
 */
export function generateRecommendations(request: RecommendRequest = {}): RecommendResponse {
  // Clear cache to get fresh data
  clearCache();

  const regime = getMarketRegime();
  const sectorAvgs = loadSectorAverages();

  // Load all active stocks with price history
  const stocks = loadStocksWithHistory(request);

  const capital = request.capital || 100000;
  const limit = request.limit || 500;

  // Analyze each stock
  const recommendations: StockRecommendation[] = [];
  let passedSafety = 0;
  let strongBuyCount = 0;
  let buyCount = 0;
  let holdCount = 0;
  let avoidCount = 0;
  let strongAvoidCount = 0;
  let largeCapCount = 0;
  let midCapCount = 0;
  let smallCapCount = 0;

  for (const { stock, history } of stocks) {
    const rec = analyzeSingleStock(stock, history, capital);
    if (!rec) continue;

    if (rec.safetyPassed) passedSafety++;

    switch (rec.recommendation) {
      case 'Strong Buy': strongBuyCount++; break;
      case 'Buy': buyCount++; break;
      case 'Hold': holdCount++; break;
      case 'Avoid': avoidCount++; break;
      case 'Strong Avoid': strongAvoidCount++; break;
    }

    switch (rec.marketCapCategory) {
      case 'large': largeCapCount++; break;
      case 'mid': midCapCount++; break;
      case 'small': smallCapCount++; break;
    }

    recommendations.push(rec);
  }

  // Sort by composite score descending
  recommendations.sort((a, b) => b.compositeScore - a.compositeScore);

  // Limit results
  const limited = recommendations.slice(0, limit);

  // ===== DIVERSIFICATION ANALYSIS =====
  const buyStocks = limited.filter(s => s.recommendation === 'Strong Buy' || s.recommendation === 'Buy');
  const sectorCounts: Record<string, number> = {};
  const sectorIssues: string[] = [];

  for (const s of buyStocks) {
    const sector = s.sector || 'غير محدد';
    sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
  }

  for (const [sector, count] of Object.entries(sectorCounts)) {
    if (count > 2) {
      sectorIssues.push(`تركز في قطاع "${sector}": ${count} أسهم (الحد الأقصى 2)`);
    }
  }

  if (buyStocks.length > 0 && smallCapCount > buyStocks.length * 0.7) {
    sectorIssues.push(`${Math.round(smallCapCount / buyStocks.length * 100)}% من التحليلات أسهم صغيرة - تنويع مطلوب`);
  }

  if (buyStocks.length > 0 && largeCapCount === 0) {
    sectorIssues.push('لا توجد أسهم كبيرة (Large Caps) في التحليلات - مخاطرة مرتفعة');
  }

  // ===== SECTOR CORRELATION CHECK =====
  const CORRELATED_SECTORS: Record<string, string[]> = {
    'البنوك': ['التأمين', 'الخدمات المالية', 'الاستثمار والصناديق'],
    'التأمين': ['البنوك', 'الخدمات المالية'],
    'الخدمات المالية': ['البنوك', 'التأمين', 'الاستثمار والصناديق'],
    'الاستثمار والصناديق': ['البنوك', 'الخدمات المالية'],
    'المواد الأساسية': ['الأسمدة', 'الكيماويات', 'الأسمنت'],
    'الأسمنت': ['المواد الأساسية', 'البناء والتشييد'],
    'البناء والتشييد': ['الأسمنت', 'المواد الأساسية', 'العقارات'],
    'العقارات': ['البناء والتشييد'],
  };

  // Collect all sectors present in buy recommendations
  const buySectors = new Set<string>();
  for (const s of buyStocks) {
    const sector = s.sector || 'غير محدد';
    buySectors.add(sector);
  }

  // Track which sector pairs have already been reported to avoid duplicates
  const reportedPairs = new Set<string>();

  // Correlation group labels for warning messages
  const CORRELATION_LABELS: Record<string, string> = {
    'البنوك': 'القطاع المالي',
    'التأمين': 'القطاع المالي',
    'الخدمات المالية': 'القطاع المالي',
    'الاستثمار والصناديق': 'القطاع المالي',
    'المواد الأساسية': 'القطاع الصناعي',
    'الأسمدة': 'القطاع الصناعي',
    'الكيماويات': 'القطاع الصناعي',
    'الأسمنت': 'القطاع الصناعي',
    'البناء والتشييد': 'قطاع البناء والعقارات',
    'العقارات': 'قطاع البناء والعقارات',
  };

  for (const sector of buySectors) {
    const correlated = CORRELATED_SECTORS[sector];
    if (!correlated) continue;

    for (const relatedSector of correlated) {
      if (!buySectors.has(relatedSector)) continue;

      // Create a canonical pair key (sorted alphabetically) to avoid duplicate warnings
      const pairKey = [sector, relatedSector].sort().join('|||');
      if (reportedPairs.has(pairKey)) continue;
      reportedPairs.add(pairKey);

      // Determine correlation group label
      const label = CORRELATION_LABELS[sector] || 'قطاع مرتبط';

      // Count stocks in both sectors for the warning
      const countA = sectorCounts[sector] || 0;
      const countB = sectorCounts[relatedSector] || 0;
      const totalCount = countA + countB;

      sectorIssues.push(
        `قطاعات مرتبطة: ${sector} + ${relatedSector} — خطر تركز ${label} (${totalCount} أسهم)`
      );
    }
  }

  // Market analysis summary
  const market: MarketAnalysis = {
    regime,
    regimeMultiplier: regime === 'bull' ? getWeight('regime_bull_multiplier', 1.3)
      : regime === 'bear' ? getWeight('regime_bear_multiplier', 0.7) : 1.0,
    indexYTDChange: 0,
    sectorAverages: Array.from(sectorAvgs.values()).filter(s => s.sector !== '_global'),
    fearCashPercent: regime === 'bear' ? 40 : regime === 'bull' ? 10 : 20,
    totalStocksAnalyzed: recommendations.length,
    passedSafetyFilter: passedSafety,
    recommendations: {
      strongBuy: strongBuyCount,
      buy: buyCount,
      hold: holdCount,
      avoid: avoidCount,
      strongAvoid: strongAvoidCount,
    },
    diversificationIssues: sectorIssues,
    capDistribution: {
      large: largeCapCount,
      mid: midCapCount,
      small: smallCapCount,
    },
  };

  return {
    market,
    stocks: limited,
    generatedAt: new Date().toISOString(),
    analysisVersion: ANALYSIS_VERSION,
  };
}

// ==================== COMPOSITE SCORE ====================

function calculateCompositeScore(
  quality: number,
  technical: number,
  violationCount: number,
  redFlagCount: number,
  upsidePotential: number,
  allSignalsAligned: boolean,
  regime: MarketRegime = 'neutral'
): number {
  // Dynamic base score weights based on market regime:
  // - Bull market:  quality 0.65 + technical 0.35 (fundamentals dominate)
  // - Neutral:      quality 0.60 + technical 0.40 (current default)
  // - Bear market:  quality 0.50 + technical 0.50 (timing matters more)
  let qualityWeight: number;
  let technicalWeight: number;
  if (regime === 'bull') {
    qualityWeight = 0.65;
    technicalWeight = 0.35;
  } else if (regime === 'bear') {
    qualityWeight = 0.50;
    technicalWeight = 0.50;
  } else {
    qualityWeight = 0.60;
    technicalWeight = 0.40;
  }

  let score = quality * qualityWeight + technical * technicalWeight;

  // Penalty for violations and red flags
  score -= violationCount * 15;
  score -= redFlagCount * 5;

  // Bonus for upside potential (capped and gradual)
  if (upsidePotential > 20 && upsidePotential <= 40) score += 6;
  else if (upsidePotential > 10 && upsidePotential <= 20) score += 4;

  // Bonus for signal confluence
  if (allSignalsAligned) score += 5;

  return clamp(Math.round(score), 0, 100);
}

// ==================== AVOID RECOMMENDATION ====================

function buildAvoidRecommendation(
  stock: Record<string, unknown>,
  violations: SafetyViolation[],
  redFlags: RedFlag[],
  regime: MarketRegime,
  volumeData: VolumeData,
  marketCapCategory: MarketCapCategory,
  marketCapCategoryAr: string
): StockRecommendation {
  const composite = violations.length >= 3 ? 15 : violations.length >= 2 ? 25 : 35;
  const isStrong = composite <= 15;

  const confidenceBreakdown: ConfidenceBreakdown = {
    qualityScore: 20,
    technicalScore: 20,
    valuationScore: 20,
    momentumScore: 20,
    dataReliability: 30,
  };

  return {
    ticker: String(stock.ticker || ''),
    name: String(stock.name || ''),
    nameAr: String(stock.name_ar || ''),
    sector: String(stock.sector || ''),
    currentPrice: toNum(stock.current_price),
    previousClose: toNum(stock.previous_close),

    safetyPassed: false,
    violations,
    redFlags,

    qualityScore: {
      total: 20,
      profitability: { score: 20, roeVsSector: 0, netMarginVsSector: 0, epsGrowthYoY: 0, details: 'لم يتم الحساب - فشل فلتر الأمان' },
      growth: { score: 20, revenueCAGR: 0, earningsCAGR: 0, details: 'لم يتم الحساب' },
      safety: { score: 20, currentRatio: 0, interestCoverage: 0, debtEquity: 0, fcfPositive: 0, details: 'لم يتم الحساب' },
      efficiency: { score: 20, assetTurnover: 0, details: 'لم يتم الحساب' },
      valuation: { score: 20, peVsSector: 0, priceToBook: 0, dividendYield: 0, details: 'لم يتم الحساب' },
    },
    momentumScore: {
      score: 30,
      trendScore: {
        score: 30, weeklyMACDBullish: false, dailyAbove50EMA: false,
        dailyAbove200EMA: false, rsiSweetSpot: false, volumeAboveAvg: false,
        details: 'لم يتم الحساب - فشل فلتر الأمان',
      },
      supportResistance: {
        strongSupport: 0, strongResistance: 0, positionPercent: 0.5,
        zone: 'normal', zoneAr: 'عادي',
      },
      signalConfluence: {
        qualityAligned: false, technicalAligned: false, volumeAligned: false,
        alignedCount: 0, requiredCount: 3, allAligned: false,
      },
      volumeConfirm: false,
    },

    fairValue: {
      grahamNumber: toNum(stock.current_price),
      peBased: toNum(stock.current_price),
      dcfLight: toNum(stock.current_price),
      averageFairValue: toNum(stock.current_price),
      upsidePotential: 0,
      verdict: 'overvalued',
      verdictAr: 'تجنب - لم يتم التقييم',
      details: { eps: 0, bookValuePerShare: 0, growthRate: 0, sectorTargetPE: 0, riskFreeRate: 0, marginOfSafety: 0 },
    },

    compositeScore: composite,
    recommendation: isStrong ? 'Strong Avoid' : 'Avoid',
    recommendationAr: isStrong ? 'تجنب قوي' : 'تجنب',
    confidence: isStrong ? 90 : 75,
    confidenceBreakdown,

    volume: volumeData,
    marketCapCategory,
    marketCapCategoryAr,

    entryPrice: toNum(stock.current_price),
    entryStrategy: { immediateBuy: 0, dipBuyPercent: 0, dipBuyLevel: 0, cashReserve: 100 },
    exitStrategy: {
      targetPrice: toNum(stock.current_price) * 0.9,
      stopLoss: toNum(stock.current_price) * 1.1,
      timeHorizonMonths: 0,
    },
    positionSizing: {
      kellyPercent: 0, adjustedPercent: 0, percentOfPortfolio: 0,
      amountEGP: 0, sharesCount: 0, maxRiskPerStock: 0.10,
    },

    riskAssessment: {
      level: 'High',
      levelAr: 'مرتفعة',
      maxExpectedDrawdown: 20,
      keyRisks: violations.map(v => v.ruleAr),
    },

    dataQuality: calculateDataQuality(stock, []),

    marketRegime: regime,
    analysisVersion: ANALYSIS_VERSION,
  };
}

// ==================== DATA LOADING ====================

interface StockWithHistory {
  stock: Record<string, unknown>;
  history: Array<Record<string, unknown>>;
}

import { createDatabase, isInitialized } from '@/lib/sqlite-wrapper';
import * as path from 'path';
import { existsSync } from 'fs';

function loadStocksWithHistory(request: RecommendRequest): StockWithHistory[] {
  try {
    // Ensure sql.js is initialized before accessing the heavy DB
    if (!isInitialized()) {
      console.warn('[recommendation-engine] sql.js not initialized, skipping stock loading');
      return [];
    }

    const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db');
    if (!existsSync(dbPath)) {
      console.warn('[recommendation-engine] Heavy DB not found:', dbPath);
      return [];
    }

    const db = createDatabase(dbPath, { readonly: true });

    try {
      let stocks: Array<Record<string, unknown>>;

      if (request.sector) {
        stocks = db.prepare(`
          SELECT * FROM stocks 
          WHERE is_active = 1 AND sector = ? AND current_price > 0
          ORDER BY volume DESC
        `).all(request.sector) as Array<Record<string, unknown>>;
      } else {
        stocks = db.prepare(`
          SELECT * FROM stocks 
          WHERE is_active = 1 AND current_price > 0
          ORDER BY volume DESC
        `).all() as Array<Record<string, unknown>>;
      }

      const results: StockWithHistory[] = [];
      const histStmt = db.prepare(`
        SELECT date, open_price as open, high_price as high, low_price as low, 
               close_price as close, volume
        FROM stock_price_history 
        WHERE stock_id = ? 
        ORDER BY date DESC 
        LIMIT 120
      `);

      for (const stock of stocks) {
        const rows = histStmt.all(stock.id) as Array<Record<string, unknown>>;
        // Reverse to chronological order
        results.push({ stock, history: rows.reverse() });
      }

      return results;
    } finally {
      db.close();
    }
  } catch (err) {
    console.error('[recommendation-engine] Failed to load stocks with history (heavy DB unavailable):', err);
    return [];
  }
}
