/**
 * V2 Recommendation Engine Types — Client-side copy
 * These mirror the server types in @/lib/v2/types.ts
 * but are safe to import in 'use client' components.
 */

// ==================== MARKET ====================

export type MarketRegime = 'bull' | 'bear' | 'neutral';

export interface SectorAverages {
  sector: string;
  avgPE: number;
  avgPB: number;
  avgROE: number;
  avgDebtEquity: number;
  avgDividendYield: number;
  avgNetMargin?: number;
  stockCount: number;
}

export interface MarketAnalysis {
  regime: MarketRegime;
  regimeMultiplier: number;
  indexYTDChange?: number;
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

// ==================== SAFETY ====================

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

// ==================== QUALITY ====================

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

// ==================== MOMENTUM ====================

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

// ==================== FAIR VALUE ====================

export interface FairValueResult {
  grahamNumber: number;
  peBased: number;
  dcfLight: number;
  averageFairValue: number;
  upsidePotential: number;
  verdict: 'undervalued' | 'fair' | 'overvalued';
  verdictAr: string;
  details?: {
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
  qualityScore: number;
  technicalScore: number;
  valuationScore: number;
  momentumScore: number;
  dataReliability: number;
}

// ==================== VOLUME & MARKET DATA ====================

export interface VolumeData {
  currentVolume: number;
  avgVolume20: number;
  volumeRatio: number;
  avgValueTraded: number;
  liquidityRating: 'high' | 'medium' | 'low';
  liquidityRatingAr: string;
}

export type MarketCapCategory = 'large' | 'mid' | 'small';

// ==================== DATA QUALITY ====================

export interface DataQuality {
  level: 'high' | 'medium' | 'low';
  levelAr: string;
  score: number;
  reasons: string[];
}

// ==================== ENTRY / EXIT / POSITION ====================

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

export interface PositionSizing {
  kellyPercent: number;
  adjustedPercent: number;
  percentOfPortfolio: number;
  amountEGP: number;
  sharesCount: number;
  maxRiskPerStock: number;
}

// ==================== STOCK RECOMMENDATION ====================

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
  confidenceBreakdown?: ConfidenceBreakdown;
  volume?: VolumeData;
  marketCapCategory?: MarketCapCategory;
  marketCapCategoryAr?: string;

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
  dataQuality?: DataQuality;

  // Market Context
  marketRegime: MarketRegime;
  analysisVersion: string;
}

// ==================== MAIN RESPONSE ====================

export interface RecommendResponse {
  market: MarketAnalysis;
  stocks: StockRecommendation[];
  generatedAt: string;
  analysisVersion: string;
}
