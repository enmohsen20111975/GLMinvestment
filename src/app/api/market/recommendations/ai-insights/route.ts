import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getAllStocks, getMarketOverviewStats, getSectorStats, getPriceHistory } from '@/lib/egx-db';
import { calculateEnhancedCompositeAnalysis } from '@/lib/analysis-engine';
import type { AiInsights, StockStatusItem } from '@/types';

/**
 * Build AI Insights response using DYNAMIC calculation.
 * 
 * UNIFIED APPROACH: Same calculation method and data period (250 days) as professional-analysis
 * Both endpoints now produce consistent scores using calculateEnhancedCompositeAnalysis.
 * 
 * This is the main endpoint for the recommendations page.
 */
export const maxDuration = 60;

export async function GET(_request: NextRequest) {
  try {
    await ensureInitialized();
    
    // Fetch stocks from Light DB (always available)
    const stocks = getAllStocks();
    const marketStats = getMarketOverviewStats();
    const sectorStats = getSectorStats();

    if (!stocks || stocks.length === 0) {
      return NextResponse.json({
        market_sentiment: 'neutral' as const,
        market_score: 50,
        market_breadth: 0,
        avg_change_percent: 0,
        volatility_index: 0,
        gainers: 0,
        losers: 0,
        unchanged: 0,
        top_sectors: [],
        stock_statuses: [],
        decision: 'hold_and_rebalance',
        risk_assessment: 'medium' as const,
        generated_at: new Date().toISOString(),
        _error: 'No stocks available',
      });
    }

    // Calculate scores dynamically for each stock
    const stockScores: Array<{
      stock: Record<string, unknown>;
      score: number;
      technicalScore: number;
      fundamentalScore: number;
      momentumScore: number;
      riskScore: number;
      analysisAvailable: boolean;
    }> = [];

    let totalScore = 0;
    let gainersCount = 0;
    let losersCount = 0;
    let unchangedCount = 0;

    for (const stock of stocks) {
      const priceChange = Number(stock.price_change) || 0;
      
      // Count gainers/losers
      if (priceChange > 0.1) gainersCount++;
      else if (priceChange < -0.1) losersCount++;
      else unchangedCount++;

      // Calculate dynamic score based on multiple factors
      let score = 50; // Base score
      let technicalScore = 50;
      let fundamentalScore = 50;
      let momentumScore = 50;
      let riskScore = 50;
      let analysisAvailable = false;

      // Try to get price history for advanced analysis
      // Using 250 days to match professional-analysis for consistent results
      const stockId = Number(stock.id);
      const priceHistory = getPriceHistory(stockId, 250);
      
      if (priceHistory && priceHistory.length >= 5) {
        try {
          // Use the same analysis engine as professional-analysis
          const analysis = calculateEnhancedCompositeAnalysis(stock, priceHistory);
          
          if (analysis && analysis.scores) {
            score = analysis.scores.composite || 50;
            technicalScore = analysis.scores.technical || 50;
            fundamentalScore = analysis.scores.value || 50;
            momentumScore = analysis.scores.momentum || 50;
            riskScore = analysis.scores.risk || 50;
            analysisAvailable = true;
          }
        } catch {
          // Fall back to basic scoring
          score = calculateBasicScore(stock);
        }
      } else {
        // Basic scoring without price history
        score = calculateBasicScore(stock);
        technicalScore = score;
        fundamentalScore = score;
        momentumScore = score;
        riskScore = score;
      }

      totalScore += score;
      
      stockScores.push({
        stock,
        score,
        technicalScore,
        fundamentalScore,
        momentumScore,
        riskScore,
        analysisAvailable,
      });
    }

    // Calculate market metrics
    const market_score = stocks.length > 0 ? Number((totalScore / stocks.length).toFixed(1)) : 50;
    
    // Market sentiment based on gainers vs losers
    const totalMoving = gainersCount + losersCount || 1;
    const bullishRatio = gainersCount / totalMoving;
    
    let market_sentiment: 'bullish' | 'bearish' | 'neutral';
    if (bullishRatio > 0.6) market_sentiment = 'bullish';
    else if (bullishRatio < 0.4) market_sentiment = 'bearish';
    else market_sentiment = 'neutral';

    // Market breadth
    const totalStocks = stocks.length || 1;
    const market_breadth = Number(((gainersCount / totalStocks) * 100).toFixed(1));
    
    // Average change
    const avg_change_percent = Number(
      ((gainersCount > losersCount ? 1 : -1) * Math.abs(gainersCount - losersCount) / totalStocks * 2).toFixed(2)
    );

    // Volatility estimation
    const volatility_index = Number(Math.min(3, Math.abs(avg_change_percent) / 10).toFixed(2));

    // Decision based on market_score
    let decision: string;
    if (market_score >= 60) decision = 'accumulate_selectively';
    else if (market_score >= 40) decision = 'hold_and_rebalance';
    else decision = 'reduce_risk';

    // Risk assessment
    let risk_assessment: 'low' | 'medium' | 'high';
    if (market_score >= 65) risk_assessment = 'low';
    else if (market_score >= 45) risk_assessment = 'medium';
    else risk_assessment = 'high';

    // Build top sectors
    const top_sectors = sectorStats.slice(0, 7).map((s: Record<string, unknown>) => ({
      name: String(s.sector || ''),
      count: Number(s.stock_count || 0),
      avg_change_percent: Number(Number(s.avg_change || 0).toFixed(2)),
    }));

    // Sector P/E ratios
    const SECTOR_PE: Record<string, number> = {
      'Financials': 9, 'Real Estate': 6, 'Basic Materials': 7,
      'Food & Beverage': 10, 'Healthcare': 11, 'Technology': 14,
      'Industrials': 8, 'Consumer Goods': 9, 'Energy': 7,
      'Telecommunications': 8, 'Consumer Services': 7,
    };

    // Build stock statuses
    const stock_statuses: StockStatusItem[] = stockScores.map(({ stock, score, technicalScore, fundamentalScore, momentumScore, riskScore }) => {
      const currentPrice = Number(stock.current_price) || 0;
      const priceChange = Number(stock.price_change) || 0;
      const volume = Number(stock.volume) || 0;
      const valueTraded = Number(stock.value_traded) || 0;
      const eps = Number(stock.eps) || 0;
      const pb = Number(stock.pb_ratio) || 0;

      // Status based on score
      let status: 'strong' | 'positive' | 'neutral' | 'weak';
      if (score >= 75) status = 'strong';
      else if (score >= 60) status = 'positive';
      else if (score >= 40) status = 'neutral';
      else status = 'weak';

      // Fair value calculation
      const epsOk = eps > 0 && eps < currentPrice * 1.5;
      const pbOk = pb > 0 && pb < 20;
      const bvps = pbOk && currentPrice > 0 ? currentPrice / pb : 0;
      
      let grahamNumber = 0;
      if (epsOk && bvps > 0) {
        grahamNumber = Math.min(Math.sqrt(22.5 * eps * bvps), currentPrice * 1.5);
      }

      const sectorPE = SECTOR_PE[String(stock.sector)] || 12;
      let peBased = 0;
      if (epsOk) {
        peBased = Math.min(sectorPE * eps, currentPrice * 1.5);
      }

      const validValues = [grahamNumber, peBased].filter(v => v > 0);
      const avgFairValue = validValues.length > 0 
        ? validValues.reduce((s, v) => s + v, 0) / validValues.length 
        : currentPrice;
      const cappedFairValue = Math.min(avgFairValue, currentPrice * 1.5) || currentPrice;

      const upsideToFair = currentPrice > 0 
        ? ((cappedFairValue - currentPrice) / currentPrice) * 100 
        : 0;

      const verdict = upsideToFair >= 25 ? 'undervalued' as const 
        : upsideToFair >= -10 ? 'fair' as const 
        : 'overvalued' as const;
      const verdictAr = upsideToFair >= 25 ? 'مقوم بأقل من قيمته' 
        : upsideToFair >= -10 ? 'عادل التقييم' 
        : 'مقوم بأكثر من قيمته';

      return {
        ticker: String(stock.ticker || ''),
        name: String(stock.name || ''),
        name_ar: String(stock.name_ar || ''),
        sector: String(stock.sector || ''),
        current_price: currentPrice,
        price_change: priceChange,
        volume: volume,
        value_traded: valueTraded,
        score: Number(score.toFixed(1)),
        status,
        components: {
          momentum: Number(momentumScore.toFixed(1)),
          liquidity: Number(riskScore.toFixed(1)),
          valuation: Number(fundamentalScore.toFixed(1)),
          income: Number(score.toFixed(1)),
          traded_value: Number(technicalScore.toFixed(1)),
        },
        fair_value: Math.round(cappedFairValue * 100) / 100,
        upside_to_fair: Math.round(upsideToFair * 100) / 100,
        data_quality_reliable: epsOk && pbOk,
        verdict,
        verdict_ar: verdictAr,
      };
    });

    // Sort by score descending
    stock_statuses.sort((a, b) => b.score - a.score);

    const response: AiInsights = {
      market_sentiment,
      market_score,
      market_breadth,
      avg_change_percent,
      volatility_index,
      gainers: gainersCount,
      losers: losersCount,
      unchanged: unchangedCount,
      top_sectors,
      stock_statuses,
      decision,
      risk_assessment,
      generated_at: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/market/recommendations/ai-insights] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch AI insights', detail: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Calculate basic score from stock data without price history
 */
function calculateBasicScore(stock: Record<string, unknown>): number {
  let score = 50; // Base

  // Price change impact (±15 points)
  const priceChange = Number(stock.price_change) || 0;
  if (priceChange > 5) score += 15;
  else if (priceChange > 2) score += 10;
  else if (priceChange > 0) score += 5;
  else if (priceChange < -5) score -= 15;
  else if (priceChange < -2) score -= 10;
  else if (priceChange < 0) score -= 5;

  // RSI impact (±10 points)
  const rsi = Number(stock.rsi) || 50;
  if (rsi < 30) score += 10; // Oversold - buy signal
  else if (rsi < 40) score += 5;
  else if (rsi > 70) score -= 10; // Overbought - sell signal
  else if (rsi > 60) score -= 5;

  // P/E ratio impact (±10 points)
  const pe = Number(stock.pe_ratio) || 0;
  if (pe > 0 && pe < 8) score += 10; // Undervalued
  else if (pe > 0 && pe < 12) score += 5;
  else if (pe > 25) score -= 10; // Overvalued
  else if (pe > 20) score -= 5;

  // ROE impact (±10 points)
  const roe = Number(stock.roe) || 0;
  if (roe > 20) score += 10;
  else if (roe > 15) score += 5;
  else if (roe < 5) score -= 10;
  else if (roe < 10) score -= 5;

  // EGX membership bonus
  if (stock.egx30_member) score += 5;
  else if (stock.egx70_member) score += 3;

  // Clamp to 0-100
  return Math.max(0, Math.min(100, score));
}
