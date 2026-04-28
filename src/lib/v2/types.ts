/**
 * V2 Recommendation Engine Types
 * Self-Learning Investment Recommendation Engine
 * No external AI dependencies — pure calculations
 */

// ==================== CONFIGURATION ====================

export interface CalcWeight {
  parameter_name: string;
  parameter_group: string;
  current_value: number;
  min_bound: number | null;
  max_bound: number | null;
  auto_adjust: boolean;
  version: string;
  description: string;
  updated_at: string;
  updated_by: string;
}

export type MarketRegime = 'bull' | 'bear' | 'neutral';

export interface RegimeConfig {
  regime: MarketRegime;
  thresholdMultiplier: number;
  indexYTDChange: number;
  detectedAt: string;
}

// ==================== LAYER 1: SAFETY FILTER ====================

export interface SafetyFilterResult {
  passed: boolean;
  violations: SafetyViolation[];
  redFlags: RedFlag[];
  rejected: boolean;
  rejectReason?: string;
}

export interface SafetyViolation {
  rule: string;
  ruleAr: string;
  value: number;
  threshold: number;
  severity: 'hard' | 'soft';
}

export interface RedFlag {
  type: string;
  typeAr: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
}

// ==================== LAYER 2: QUALITY ENGINE ====================

export interface QualityScore {
  total: number;
  profitability: ProfitabilityScore;
  growth: GrowthScore;
  safety: FinancialSafetyScore;
  efficiency: EfficiencyScore;
  valuation: ValuationScore;
}

export interface ProfitabilityScore {
  score: number;
  roeVsSector: number;
  netMarginVsSector: number;
  epsGrowthYoY: number;
  details: string;
}

export interface GrowthScore {
  score: number;
  revenueCAGR: number;
  earningsCAGR: number;
  details: string;
}

export interface FinancialSafetyScore {
  score: number;
  currentRatio: number;
  interestCoverage: number;
  debtEquity: number;
  fcfPositive: number;
  details: string;
}

export interface EfficiencyScore {
  score: number;
  assetTurnover: number;
  details: string;
}

export interface ValuationScore {
  score: number;
  peVsSector: number;
  priceToBook: number;
  dividendYield: number;
  details: string;
}

export interface SectorAverages {
  sector: string;
  avgPE: number;
  avgPB: number;
  avgROE: number;
  avgDebtEquity: number;
  avgDividendYield: number;
  avgNetMargin: number;
  stockCount: number;
}

// ==================== LAYER 3: MOMENTUM ENGINE ====================

export interface MomentumResult {
  score: number;
  trendScore: TrendScore;
  supportResistance: SupportResistance;
  signalConfluence: SignalConfluence;
  volumeConfirm: boolean;
}

export interface TrendScore {
  score: number;
  weeklyMACDBullish: boolean;
  dailyAbove50EMA: boolean;
  dailyAbove200EMA: boolean;
  rsiSweetSpot: boolean;
  volumeAboveAvg: boolean;
  details: string;
}

export interface SupportResistance {
  strongSupport: number;
  strongResistance: number;
  positionPercent: number;
  zone: 'accumulation' | 'normal' | 'distribution';
  zoneAr: string;
}

export interface SignalConfluence {
  qualityAligned: boolean;
  technicalAligned: boolean;
  volumeAligned: boolean;
  alignedCount: number;
  requiredCount: number;
  allAligned: boolean;
}

// ==================== LAYER 4: PORTFOLIO ENGINE ====================

export interface UserProfile {
  capital: number;
  age?: number;
  timeHorizon: 'short' | 'medium' | 'long';
  incomeStability: 'fixed' | 'variable' | 'irregular';
  riskCapacity: number;
}

export interface PositionSizing {
  kellyPercent: number;
  adjustedPercent: number;
  percentOfPortfolio: number;
  amountEGP: number;
  sharesCount: number;
  maxRiskPerStock: number;
}

export interface EntryStrategy {
  immediateBuy: number;
  dipBuyPercent: number;
  dipBuyLevel: number;
  cashReserve: number;
}

export interface ExitStrategy {
  targetPrice: number;
  stopLoss: number;
  timeHorizonMonths: number;
}

export interface PortfolioRecommendation {
  allowed: boolean;
  diversificationIssues: string[];
  sectorAllocation: Record<string, number>;
}

// ==================== FAIR VALUE ====================

export interface FairValueResult {
  grahamNumber: number;
  peBased: number;
  dcfLight: number;
  averageFairValue: number;
  upsidePotential: number;
  verdict: 'undervalued' | 'fair' | 'overvalued';
  verdictAr: string;
  dataReliable?: boolean;
  details: {
    eps: number;
    bookValuePerShare: number;
    growthRate: number;
    sectorTargetPE: number;
    riskFreeRate: number;
    marginOfSafety: number;
  };
}

// ==================== CONFIDENCE BREAKDOWN ====================

export interface ConfidenceBreakdown {
  qualityScore: number;      // 0-100: company fundamentals quality
  technicalScore: number;    // 0-100: technical analysis timing
  valuationScore: number;    // 0-100: how undervalued it is
  momentumScore: number;     // 0-100: trend and momentum strength
  dataReliability: number;   // 0-100: how reliable the source data is
}

// ==================== DATA QUALITY ====================

export interface DataQuality {
  level: 'high' | 'medium' | 'low';
  levelAr: string;
  score: number; // 0-100
  reasons: string[]; // Arabic reasons for the quality rating
}

// ==================== VOLUME & MARKET DATA ====================

export interface VolumeData {
  currentVolume: number;
  avgVolume20: number;
  volumeRatio: number;       // current vs 20-day average
  avgValueTraded: number;    // average daily value traded in EGP
  liquidityRating: 'high' | 'medium' | 'low';
  liquidityRatingAr: string;
}

export type MarketCapCategory = 'large' | 'mid' | 'small';

// ==================== MAIN RECOMMENDATION OUTPUT ====================

export interface StockRecommendation {
  ticker: string;
  name: string;
  nameAr: string;
  sector: string;
  currentPrice: number;
  previousClose: number;
  
  // Safety
  safetyPassed: boolean;
  violations: SafetyViolation[];
  redFlags: RedFlag[];
  
  // Quality
  qualityScore: QualityScore;
  
  // Momentum
  momentumScore: MomentumResult;
  
  // Fair Value
  fairValue: FairValueResult;
  
  // Composite
  compositeScore: number;
  recommendation: 'Strong Buy' | 'Buy' | 'Hold' | 'Avoid' | 'Strong Avoid';
  recommendationAr: string;
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdown;
  
  // Volume & Market Data
  volume: VolumeData;
  marketCapCategory: MarketCapCategory;
  marketCapCategoryAr: string;
  
  // Entry / Exit
  entryPrice: number;
  entryStrategy: EntryStrategy;
  exitStrategy: ExitStrategy;
  
  // Position Sizing
  positionSizing: PositionSizing;
  
  // Risk
  riskAssessment: {
    level: 'Low' | 'Medium' | 'High' | 'Very High';
    levelAr: string;
    maxExpectedDrawdown: number;
    keyRisks: string[];
  };
  
  // Data Quality
  dataQuality: DataQuality;

  // Market Context
  marketRegime: MarketRegime;
  analysisVersion: string;
}

// ==================== MARKET ANALYSIS ====================

export interface MarketAnalysis {
  regime: MarketRegime;
  regimeMultiplier: number;
  indexYTDChange: number;
  sectorAverages: SectorAverages[];
  fearCashPercent: number;
  totalStocksAnalyzed: number;
  passedSafetyFilter: number;
  recommendations: {
    strongBuy: number;
    buy: number;
    hold: number;
    avoid: number;
    strongAvoid: number;
  };
  diversificationIssues?: string[];
  capDistribution?: {
    large: number;
    mid: number;
    small: number;
  };
}

// ==================== API REQUEST/RESPONSE ====================

export interface RecommendRequest {
  capital?: number;
  timeHorizon?: 'short' | 'medium' | 'long';
  incomeStability?: 'fixed' | 'variable' | 'irregular';
  age?: number;
  sector?: string;
  limit?: number;
}

export interface RecommendResponse {
  market: MarketAnalysis;
  stocks: StockRecommendation[];
  generatedAt: string;
  analysisVersion: string;
}

export type SingleStockAnalysisResponse = StockRecommendation;

// ==================== ADMIN CONFIG ====================

export interface AdminConfigResponse {
  weights: CalcWeight[];
  regime: RegimeConfig;
  lastFeedbackRun: string | null;
  modelAccuracy: {
    overall: number;
    fundamental: number;
    technical: number;
    predictionsValidated: number;
  } | null;
}

export interface UpdateWeightRequest {
  parameter_name: string;
  new_value: number;
  reason?: string;
}

// ==================== EXPERT ANALYSIS TYPES ====================

export interface DeadStockResult {
  isDead: boolean;
  reasons: string[];
  reasonsAr: string[];
  score: number; // 0-100, lower = deader
}

export interface FibonacciLevels {
  level_236: number;
  level_382: number;
  level_500: number;
  level_618: number;
  level_786: number;
  currentLevel: string;
  currentLevelAr: string;
  inBuyZone: boolean;
}

export interface IchimokuResult {
  tenkanSen: number;
  kijunSen: number;
  senkouA: number;
  senkouB: number;
  chikouSpan: number;
  cloudTop: number;
  cloudBottom: number;
  pricePosition: 'above_cloud' | 'in_cloud' | 'below_cloud';
  pricePositionAr: string;
  trend: 'bullish' | 'bearish' | 'neutral';
  trendAr: string;
  signalStrength: number;
  futureCloudBullish: boolean;
  tkCross: 'bullish' | 'bearish' | 'none';
  tkCrossAr: string;
}

export interface AdvancedPattern {
  name: string;
  nameAr: string;
  type: 'bullish' | 'bearish' | 'neutral';
  reliability: 'high' | 'medium' | 'low';
  reliabilityAr: string;
  targetPrice: number | null;
  stopLoss: number | null;
  confidence: number;
}

export interface ExpertScoring {
  total: number;
  breakdown: {
    marketDirection: { score: number; weight: number; reason: string; reasonAr: string };
    trendStrength: { score: number; weight: number; reason: string; reasonAr: string };
    supportResistance: { score: number; weight: number; reason: string; reasonAr: string };
    fibonacci: { score: number; weight: number; reason: string; reasonAr: string };
    candlePatterns: { score: number; weight: number; reason: string; reasonAr: string };
    momentum: { score: number; weight: number; reason: string; reasonAr: string };
    volume: { score: number; weight: number; reason: string; reasonAr: string };
    ichimoku: { score: number; weight: number; reason: string; reasonAr: string };
    rsi: { score: number; weight: number; reason: string; reasonAr: string };
  };
  verdict: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  verdictAr: string;
}

export interface ComprehensiveAnalysis {
  deadStock: DeadStockResult;
  fibonacci: FibonacciLevels | null;
  ichimoku: IchimokuResult | null;
  advancedPatterns: AdvancedPattern[];
  expertScore: ExpertScoring;
  marketRegime: MarketRegime;
}

export interface DividendAdjustment {
  needsAdjustment: boolean;
  adjustedPrices: number[];
  adjustmentType: 'cash' | 'stock' | 'none';
  dividendValue: number;
  exDividendDate: string | null;
  warning: string | null;
}
