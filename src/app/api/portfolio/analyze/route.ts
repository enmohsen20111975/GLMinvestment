import { NextRequest, NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';

/**
 * Portfolio Analyze API
 *
 * Analyzes all positions and provides recommendations:
 * - HOLD: Keep position
 * - ADD: Buy more at support
 * - REDUCE: Sell partial position
 * - SELL: Exit position
 */

interface StockAnalysis {
  ticker: string;
  current_price: number;
  support: number | null;
  resistance: number | null;
  ma_50: number | null;
  ma_200: number | null;
  rsi: number | null;
  fair_value: number | null;
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('X-User-Id') || 'default-user';

    // Ensure DB is initialized
    await ensureInitialized();
    const db = getLightDb();

    // Get positions
    const positions = await prisma.portfolioPosition.findMany({
      where: {
        user_id: userId,
        is_active: true,
      },
    });

    if (positions.length === 0) {
      return NextResponse.json({
        success: true,
        positions: [],
        message: 'لا توجد أسهم في المحفظة',
      });
    }

    // Get stock data for all positions
    const symbols = positions.map(p => p.stock_symbol);
    const placeholders = symbols.map(() => '?').join(',');

    const stockRows = db.prepare(`
      SELECT ticker, current_price, support_level, resistance_level,
             ma_50, ma_200, rsi, pe_ratio, pb_ratio, eps
      FROM stocks
      WHERE ticker IN (${placeholders})
    `).all(...symbols) as Record<string, unknown>[];

    const stockData: Record<string, StockAnalysis> = {};
    for (const row of stockRows) {
      const r = row as { ticker: string; [key: string]: unknown };
      stockData[r.ticker] = {
        ticker: r.ticker,
        current_price: toNumber(r.current_price) || 0,
        support: toNumber(r.support_level),
        resistance: toNumber(r.resistance_level),
        ma_50: toNumber(r.ma_50),
        ma_200: toNumber(r.ma_200),
        rsi: toNumber(r.rsi),
        fair_value: calculateFairValue(r),
      };
    }

    // Analyze each position
    const analyzedPositions = positions.map(position => {
      const stock = stockData[position.stock_symbol] || {
        ticker: position.stock_symbol,
        current_price: 0,
        support: null,
        resistance: null,
        ma_50: null,
        ma_200: null,
        rsi: null,
        fair_value: null,
      };

      const currentPrice = stock.current_price || position.current_price || 0;
      const avgCost = position.avg_cost;
      const shares = position.shares;

      // Calculate P&L
      const costBasis = shares * avgCost;
      const marketValue = shares * currentPrice;
      const unrealizedPnl = marketValue - costBasis;
      const unrealizedPnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;

      // Calculate upside to fair value
      const upsideToFairValue = stock.fair_value && currentPrice > 0
        ? ((stock.fair_value - currentPrice) / currentPrice) * 100
        : null;

      // Calculate trailing stop
      const highestPrice = position.highest_price_since_entry || Math.max(currentPrice, avgCost);
      const trailingStopPercent = position.trailing_stop_percent || 5;
      const trailingStop = highestPrice * (1 - trailingStopPercent / 100);

      // Determine recommendation
      const recommendation = getRecommendation({
        pnlPercent: unrealizedPnlPercent,
        currentPrice,
        avgCost,
        support: stock.support,
        resistance: stock.resistance,
        rsi: stock.rsi,
        upsideToFairValue,
        avgDownCount: position.avg_down_count,
      });

      // Generate Arabic reasoning
      const reasoning = generateReasoning({
        ticker: position.stock_symbol,
        recommendation: recommendation.action,
        pnlPercent: unrealizedPnlPercent,
        currentPrice,
        avgCost,
        support: stock.support,
        resistance: stock.resistance,
        trailingStop,
        upsideToFairValue,
      });

      return {
        ...position,
        current_price: currentPrice,
        market_value: marketValue,
        cost_basis: costBasis,
        unrealized_pnl: unrealizedPnl,
        unrealized_pnl_percent: unrealizedPnlPercent,
        status: getStatus(unrealizedPnlPercent),
        status_ar: getStatusAr(unrealizedPnlPercent),
        support: stock.support,
        resistance: stock.resistance,
        fair_value: stock.fair_value,
        upside_to_fair_value: upsideToFairValue,
        rsi: stock.rsi,
        trailing_stop: trailingStop,
        highest_price: highestPrice,
        recommendation: recommendation.action,
        recommendation_ar: recommendation.actionAr,
        confidence: recommendation.confidence,
        reasoning: reasoning,
        actions: recommendation.actions,
      };
    });

    // Calculate portfolio summary
    const totalCostBasis = analyzedPositions.reduce((sum, p) => sum + (p.cost_basis || 0), 0);
    const totalMarketValue = analyzedPositions.reduce((sum, p) => sum + (p.market_value || 0), 0);
    const totalUnrealizedPnl = totalMarketValue - totalCostBasis;

    // Group by recommendation
    const byRecommendation = {
      HOLD: analyzedPositions.filter(p => p.recommendation === 'HOLD'),
      ADD: analyzedPositions.filter(p => p.recommendation === 'ADD'),
      REDUCE: analyzedPositions.filter(p => p.recommendation === 'REDUCE'),
      SELL: analyzedPositions.filter(p => p.recommendation === 'SELL'),
    };

    return NextResponse.json({
      success: true,
      positions: analyzedPositions,
      summary: {
        total_positions: analyzedPositions.length,
        total_cost_basis: totalCostBasis,
        total_market_value: totalMarketValue,
        total_unrealized_pnl: totalUnrealizedPnl,
        total_unrealized_pnl_percent: totalCostBasis > 0 ? (totalUnrealizedPnl / totalCostBasis) * 100 : 0,
        winning_count: analyzedPositions.filter(p => (p.unrealized_pnl || 0) > 0).length,
        losing_count: analyzedPositions.filter(p => (p.unrealized_pnl || 0) < 0).length,
      },
      by_recommendation: {
        HOLD: byRecommendation.HOLD.length,
        ADD: byRecommendation.ADD.length,
        REDUCE: byRecommendation.REDUCE.length,
        SELL: byRecommendation.SELL.length,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[GET /api/portfolio/analyze] Error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze portfolio', detail: String(error) },
      { status: 500 }
    );
  }
}

// Helper functions
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}

function calculateFairValue(stock: Record<string, unknown>): number | null {
  const pe = toNumber(stock.pe_ratio);
  const eps = toNumber(stock.eps);
  const pb = toNumber(stock.pb_ratio);
  const currentPrice = toNumber(stock.current_price);

  if (!currentPrice) return null;

  // Simple fair value estimation
  const peFairValue = pe && eps && pe > 0 && eps > 0 ? eps * 15 : null; // Assume fair PE of 15
  const pbFairValue = pb && pb > 0 ? (currentPrice / pb) * 1.5 : null; // Assume fair PB of 1.5

  const fairValues = [peFairValue, pbFairValue].filter(v => v !== null && v > 0) as number[];
  if (fairValues.length === 0) return null;

  return fairValues.reduce((a, b) => a + b, 0) / fairValues.length;
}

function getRecommendation(params: {
  pnlPercent: number;
  currentPrice: number;
  avgCost: number;
  support: number | null;
  resistance: number | null;
  rsi: number | null;
  upsideToFairValue: number | null;
  avgDownCount: number;
}): { action: string; actionAr: string; confidence: number; actions: string[] } {
  const {
    pnlPercent,
    currentPrice,
    avgCost,
    support,
    resistance,
    rsi,
    upsideToFairValue,
    avgDownCount,
  } = params;

  const actions: string[] = [];
  let action = 'HOLD';
  let actionAr = 'امسك';
  let confidence = 60;

  // Heavy loss scenario
  if (pnlPercent <= -15) {
    if (support && currentPrice <= support * 1.02) {
      // At support, might recover
      action = 'HOLD';
      actionAr = 'امسك وانتظر';
      confidence = 50;
      actions.push('السهم عند دعم قوي - انتظر ارتداد');
    } else {
      action = 'SELL';
      actionAr = 'بيع';
      confidence = 75;
      actions.push('خسارة كبيرة - ابيع لحماية رأس المال');
    }
  }
  // Moderate loss
  else if (pnlPercent <= -5) {
    if (support && currentPrice <= support * 1.05 && avgDownCount < 2) {
      action = 'ADD';
      actionAr = 'متوسط السعر';
      confidence = 65;
      actions.push('قريب من الدعم - فرصة لمتوسط السعر');
      actions.push(`متوسط السعر لو نزل لـ ${(support * 0.98).toFixed(2)}`);
    } else {
      action = 'HOLD';
      actionAr = 'امسك';
      confidence = 55;
      actions.push('انتظر تحسن السوق');
    }
  }
  // Slight loss or near breakeven
  else if (pnlPercent < 0) {
    action = 'HOLD';
    actionAr = 'امسك';
    confidence = 70;
    actions.push('قريب من نقطة التعادل');
  }
  // Slight gain
  else if (pnlPercent < 10) {
    if (resistance && currentPrice >= resistance * 0.95) {
      action = 'REDUCE';
      actionAr = 'بيع جزئي';
      confidence = 65;
      actions.push(`قريب من مقاومة ${resistance.toFixed(2)} - بيع 25%`);
    } else {
      action = 'HOLD';
      actionAr = 'امسك';
      confidence = 70;
      actions.push('احمي ربحك بوقف متحرك');
    }
  }
  // Moderate gain
  else if (pnlPercent < 25) {
    action = 'REDUCE';
    actionAr = 'بيع جزئي';
    confidence = 70;
    actions.push(`بيع 50% عند ${currentPrice.toFixed(2)}`);
    actions.push('خلي الباقي يجري مع وقف ربح متحرك');
  }
  // Heavy gain
  else {
    action = 'REDUCE';
    actionAr = 'بيع جزئي';
    confidence = 80;
    actions.push(`ربح ممتاز ${pnlPercent.toFixed(1)}% - بيع 75%`);
    actions.push('حرك الوقف خلف السعر');
  }

  // RSI consideration
  if (rsi !== null) {
    if (rsi > 70 && pnlPercent > 0) {
      confidence += 10;
      actions.push('⚠️ RSI مرتفع - احذر التصحيح');
    } else if (rsi < 30 && pnlPercent < 0) {
      actions.push('💡 RSI منخفض - قد يكون قاع');
    }
  }

  // Upside consideration
  if (upsideToFairValue !== null && upsideToFairValue > 20) {
    confidence += 5;
    actions.push(`📊 فرصة صعود ${upsideToFairValue.toFixed(1)}% للسعر العادل`);
  }

  // Average down warning
  if (avgDownCount >= 2) {
    actions.push('⚠️ تم متوسط السعر مرتين - لا تضف أكثر');
  }

  return { action, actionAr, confidence: Math.min(confidence, 95), actions };
}

function generateReasoning(params: {
  ticker: string;
  recommendation: string;
  pnlPercent: number;
  currentPrice: number;
  avgCost: number;
  support: number | null;
  resistance: number | null;
  trailingStop: number;
  upsideToFairValue: number | null;
}): string {
  const { ticker, recommendation, pnlPercent, currentPrice, avgCost, support, resistance, trailingStop, upsideToFairValue } = params;

  const lines: string[] = [];

  // Status line
  if (pnlPercent < 0) {
    lines.push(`السهم تحت التكلفة بمقدار ${Math.abs(pnlPercent).toFixed(1)}%`);
  } else {
    lines.push(`السهم فوق التكلفة بمقدار ${pnlPercent.toFixed(1)}%`);
  }

  // Support/Resistance
  if (support) {
    lines.push(`الدعم القادم: ${support.toFixed(2)}`);
  }
  if (resistance) {
    lines.push(`المقاومة القادمة: ${resistance.toFixed(2)}`);
  }

  // Trailing stop
  lines.push(`وقف الخسارة/الربح: ${trailingStop.toFixed(2)}`);

  // Fair value
  if (upsideToFairValue && upsideToFairValue > 0) {
    lines.push(`الفرصة للسعر العادل: ${upsideToFairValue.toFixed(1)}%`);
  }

  return lines.join(' | ');
}

function getStatus(pnlPercent: number): string {
  if (pnlPercent <= -15) return 'heavy_loss';
  if (pnlPercent <= -5) return 'moderate_loss';
  if (pnlPercent < 0) return 'slight_loss';
  if (pnlPercent < 10) return 'slight_gain';
  if (pnlPercent < 25) return 'moderate_gain';
  return 'heavy_gain';
}

function getStatusAr(pnlPercent: number): string {
  if (pnlPercent <= -15) return 'خسارة كبيرة';
  if (pnlPercent <= -5) return 'خسارة متوسطة';
  if (pnlPercent < 0) return 'تحت التكلفة';
  if (pnlPercent < 10) return 'ربح بسيط';
  if (pnlPercent < 25) return 'ربح جيد';
  return 'ربح كبير';
}
