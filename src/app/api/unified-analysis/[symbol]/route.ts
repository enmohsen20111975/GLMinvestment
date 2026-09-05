import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


/**
 * Unified Analysis API
 * =====================
 * تحليل موحد للأسهم والعملات الرقمية
 * 
 * Features:
 * - تحليل مالي (Financial Analysis)
 * - تحليل فني (Technical Analysis)
 * - تحليل التوقيت (Timing Analysis)
 * - تحليل الأحداث (Event Analysis)
 */

// Use environment variable for Python Backend URL
const VPS_PYTHON_URL = process.env.VPS_API_URL || process.env.VPS_PYTHON_URL || 'http://127.0.0.1:8010';

interface UnifiedAnalysisResponse {
  success: boolean;
  data?: {
    symbol: string;
    name: string;
    asset_type: string;
    current_price: number;
    previous_close?: number;
    
    // Analysis
    financial?: Record<string, number | null>;
    technical?: {
      rsi?: number;
      rsi_signal?: string;
      macd_trend?: string;
      sma_20?: number;
      sma_50?: number;
      bb_position?: string;
      support?: number;
      resistance?: number;
    };
    timing?: {
      current_session: string;
      timing_score: number;
      timing_recommendation: string;
      best_buy_hours: number[];
      best_sell_hours: number[];
    };
    
    // Signal
    overall_signal: string;
    overall_score: number;
    confidence: number;
    
    // Targets
    entry_price?: number;
    target_price?: number;
    stop_loss?: number;
    
    // Reasons
    buy_reasons: string[];
    sell_reasons: string[];
    warnings: string[];
    
    // Meta
    analysis_timestamp: string;
    data_quality: string;
  };
  error?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
): Promise<NextResponse<UnifiedAnalysisResponse>> {
  const { symbol: paramSymbol } = await params;
  const symbol = paramSymbol.toUpperCase();
  const searchParams = request.nextUrl.searchParams;
  const assetType = searchParams.get('type') || 'STOCK';

  try {
    // Fetch data from VPS Python backend
    const [stockRes, historyRes, indicatorsRes] = await Promise.all([
      fetch(`${VPS_PYTHON_URL}/api/stock/${symbol}`, {
        headers: { 'Accept': 'application/json' }
      }).catch(() => null),
      fetch(`${VPS_PYTHON_URL}/api/history/${symbol}?days=365`, {
        headers: { 'Accept': 'application/json' }
      }).catch(() => null),
      fetch(`${VPS_PYTHON_URL}/api/indicators/${symbol}`, {
        headers: { 'Accept': 'application/json' }
      }).catch(() => null)
    ]);

    // Parse responses
    const stockData = stockRes ? await stockRes.json() : null;
    const historyData = historyRes ? await historyRes.json() : null;
    const indicatorsData = indicatorsRes ? await indicatorsRes.json() : null;

    if (!stockData?.success || !stockData?.data) {
      return NextResponse.json({
        success: false,
        error: `Stock ${symbol} not found`
      }, { status: 404 });
    }

    const stock = stockData.data;
    const history = historyData?.data?.rows || [];
    const indicators = indicatorsData?.data?.indicators || {};

    // Calculate prices for analysis
    const prices = history.map((h: { close: number }) => h.close).reverse();
    
    // Perform unified analysis
    const analysis = performUnifiedAnalysis(
      stock,
      prices,
      indicators,
      assetType
    );

    return NextResponse.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('Unified analysis error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to perform analysis'
    }, { status: 500 });
  }
}

function performUnifiedAnalysis(
  stock: Record<string, unknown>,
  prices: number[],
  indicators: Record<string, unknown>,
  assetType: string
): UnifiedAnalysisResponse['data'] {
  const buyReasons: string[] = [];
  const sellReasons: string[] = [];
  const warnings: string[] = [];
  let totalScore = 0;

  const currentPrice = typeof stock.current_price === 'number' ? stock.current_price : 0;
  const previousClose = typeof stock.previous_close === 'number' ? stock.previous_close : undefined;

  // ============ TECHNICAL ANALYSIS ============
  const technical = analyzeTechnical(indicators, currentPrice, prices, buyReasons, sellReasons);
  totalScore += technical.score;

  // ============ TIMING ANALYSIS ============
  const timing = analyzeTiming(assetType, buyReasons, sellReasons);
  totalScore += timing.score;

  // ============ PRICE TARGETS ============
  const targets = calculatePriceTargets(currentPrice, prices, technical);

  // ============ OVERALL SIGNAL ============
  const signal = determineSignal(totalScore);

  // ============ CONFIDENCE ============
  const confidence = calculateConfidence(totalScore, prices.length);

  // ============ DATA QUALITY ============
  const dataQuality = prices.length >= 200 ? 'GOOD' : prices.length >= 50 ? 'PARTIAL' : 'POOR';
  if (dataQuality === 'POOR') {
    warnings.push('بيانات غير كافية للتحليل الدقيق');
  }

  return {
    symbol: stock.symbol as string,
    name: (stock.name as string) || '',
    asset_type: assetType,
    current_price: currentPrice,
    previous_close: previousClose,
    
    technical: {
      rsi: technical.rsi,
      rsi_signal: technical.rsiSignal,
      macd_trend: technical.macdTrend,
      sma_20: technical.sma20,
      sma_50: technical.sma50,
      bb_position: technical.bbPosition,
      support: technical.support,
      resistance: technical.resistance
    },
    
    timing: {
      current_session: timing.session,
      timing_score: timing.score,
      timing_recommendation: timing.recommendation,
      best_buy_hours: timing.bestBuyHours,
      best_sell_hours: timing.bestSellHours
    },
    
    overall_signal: signal.signal,
    overall_score: totalScore,
    confidence: confidence,
    
    entry_price: targets.entry,
    target_price: targets.target,
    stop_loss: targets.stopLoss,
    
    buy_reasons: buyReasons,
    sell_reasons: sellReasons,
    warnings: warnings,
    
    analysis_timestamp: new Date().toISOString(),
    data_quality: dataQuality
  };
}

function analyzeTechnical(
  indicators: Record<string, unknown>,
  currentPrice: number,
  prices: number[],
  buyReasons: string[],
  sellReasons: string[]
): { score: number; [key: string]: unknown } {
  let score = 0;
  const result: Record<string, unknown> = { score: 0 };

  // RSI Analysis
  const rsi = indicators.rsi as Record<string, unknown> | null;
  if (rsi?.value) {
    result.rsi = rsi.value;
    result.rsiSignal = rsi.signal;
    
    if (rsi.signal === 'oversold') {
      score += 2;
      buyReasons.push(`RSI تشبع بيعي (${rsi.value})`);
    } else if (rsi.signal === 'overbought') {
      score -= 2;
      sellReasons.push(`RSI تشبع شرائي (${rsi.value})`);
    }
  }

  // MACD Analysis
  const macd = indicators.macd as Record<string, unknown> | null;
  if (macd?.trend) {
    result.macdTrend = macd.trend;
    
    if (macd.trend === 'bullish') {
      score += 1;
      buyReasons.push('MACD صاعد');
    } else if (macd.trend === 'bearish') {
      score -= 1;
      sellReasons.push('MACD هابط');
    }
  }

  // Moving Averages
  const sma = indicators.sma as Record<string, number> | null;
  const ema = indicators.ema as Record<string, number> | null;
  
  if (sma) {
    result.sma20 = sma[20];
    result.sma50 = sma[50];
    
    if (sma[20] && sma[50]) {
      if (currentPrice > sma[20] && sma[20] > sma[50]) {
        score += 2;
        buyReasons.push('السعر فوق المتوسطات - اتجاه صاعد');
      } else if (currentPrice < sma[20] && sma[20] < sma[50]) {
        score -= 2;
        sellReasons.push('السعر تحت المتوسطات - اتجاه هابط');
      }
    }
  }

  // Bollinger Bands
  const bb = indicators.bollinger_bands as Record<string, number> | null;
  if (bb) {
    if (currentPrice <= bb.lower) {
      result.bbPosition = 'LOWER';
      score += 1;
      buyReasons.push('السعر عند النطاق السفلي لبولينجر');
    } else if (currentPrice >= bb.upper) {
      result.bbPosition = 'UPPER';
      score -= 1;
      sellReasons.push('السعر عند النطاق العلوي لبولينجر');
    } else {
      result.bbPosition = 'MIDDLE';
    }
  }

  // Support/Resistance
  if (prices.length >= 20) {
    const recentPrices = prices.slice(-20);
    const support = Math.min(...recentPrices);
    const resistance = Math.max(...recentPrices);
    
    result.support = support;
    result.resistance = resistance;
    
    const distToSupport = ((currentPrice - support) / currentPrice) * 100;
    const distToResistance = ((resistance - currentPrice) / currentPrice) * 100;
    
    if (distToSupport < 2) {
      score += 1;
      buyReasons.push(`قريب من الدعم (${support.toFixed(2)})`);
    } else if (distToResistance < 2) {
      score -= 1;
      sellReasons.push(`قريب من المقاومة (${resistance.toFixed(2)})`);
    }
  }

  result.score = score;
  return result as { score: number; [key: string]: unknown };
}

function analyzeTiming(
  assetType: string,
  buyReasons: string[],
  sellReasons: string[]
): { score: number; session: string; recommendation: string; bestBuyHours: number[]; bestSellHours: number[] } {
  const now = new Date();
  const hour = now.getUTCHours();

  let score = 0;
  let session = 'UNKNOWN';
  let recommendation = 'NEUTRAL';

  // Market session (EGX: Cairo time UTC+2)
  if (assetType === 'STOCK') {
    const cairoHour = hour + 2; // Simplified
    if (cairoHour >= 9 && cairoHour < 11) {
      session = 'MARKET_OPEN';
      score += 1;
    } else if (cairoHour >= 11 && cairoHour < 14) {
      session = 'MARKET_MID';
    } else if (cairoHour >= 14 && cairoHour < 15) {
      session = 'MARKET_CLOSE';
      score -= 1;
    } else {
      session = 'MARKET_CLOSED';
    }

    // Best hours for EGX
    const bestBuyHours = [9, 10, 14];
    const bestSellHours = [12, 13, 14];

    if (bestBuyHours.includes(cairoHour)) {
      score += 1;
      recommendation = 'GOOD_TIMING';
      buyReasons.push('توقيت جيد للشراء');
    } else if (bestSellHours.includes(cairoHour)) {
      recommendation = 'FAIR_TIMING';
    }

    return {
      score,
      session,
      recommendation,
      bestBuyHours,
      bestSellHours
    };
  } else {
    // Crypto is 24/7
    session = '24/7';
    
    // Crypto patterns (UTC)
    const bestBuyHours = [2, 3, 4, 14, 15, 16];
    const bestSellHours = [8, 9, 10, 20, 21, 22];

    if (bestBuyHours.includes(hour)) {
      score += 1;
      recommendation = 'GOOD_TIMING';
      buyReasons.push('توقيت جيد للشراء');
    } else if (bestSellHours.includes(hour)) {
      recommendation = 'FAIR_TIMING';
    }

    return {
      score,
      session,
      recommendation,
      bestBuyHours,
      bestSellHours
    };
  }
}

function calculatePriceTargets(
  currentPrice: number,
  prices: number[],
  technical: Record<string, unknown>
): { entry: number; target: number | null; stopLoss: number | null } {
  const entry = currentPrice;

  // Use technical levels if available
  let target = technical.resistance as number | null;
  let stopLoss = technical.support as number | null;

  // Calculate from price history if not available
  if (!target || !stopLoss) {
    if (prices.length >= 20) {
      const recentPrices = prices.slice(-20);
      const support = Math.min(...recentPrices);
      const resistance = Math.max(...recentPrices);
      
      if (!target) target = resistance;
      if (!stopLoss) stopLoss = support;
    }
  }

  // Default values if still not available
  if (!target) target = currentPrice * 1.05;
  if (!stopLoss) stopLoss = currentPrice * 0.97;

  return { entry, target, stopLoss };
}

function determineSignal(score: number): { signal: string } {
  if (score >= 5) return { signal: 'STRONG_BUY' };
  if (score >= 2) return { signal: 'BUY' };
  if (score <= -5) return { signal: 'STRONG_SELL' };
  if (score <= -2) return { signal: 'SELL' };
  return { signal: 'HOLD' };
}

function calculateConfidence(score: number, dataPoints: number): number {
  let baseConfidence = 50;
  
  // Score contribution
  baseConfidence += Math.abs(score) * 5;
  
  // Data quality contribution
  if (dataPoints >= 200) {
    baseConfidence += 15;
  } else if (dataPoints >= 100) {
    baseConfidence += 10;
  } else if (dataPoints >= 50) {
    baseConfidence += 5;
  }
  
  return Math.min(baseConfidence, 95);
}
