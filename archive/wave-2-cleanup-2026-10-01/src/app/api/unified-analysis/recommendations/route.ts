import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


/**
 * Unified Recommendations API
 * ============================
 * API للحصول على أفضل التحليلات
 */

// Use environment variable for Python Backend URL
const VPS_PYTHON_URL = process.env.VPS_API_URL || process.env.VPS_PYTHON_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get('limit') || '10');
  const signal = searchParams.get('signal')?.toUpperCase(); // BUY, SELL, ALL
  const assetType = searchParams.get('type') || 'STOCK';

  try {
    // Fetch all stocks (use /api/stocks endpoint)
    const stocksRes = await fetch(`${VPS_PYTHON_URL}/api/stocks`);
    const stocksData = await stocksRes.json();

    if (!stocksData?.success) {
      return NextResponse.json({
        success: false,
        error: 'Failed to fetch stocks'
      }, { status: 500 });
    }

    const stocks = stocksData.data || [];
    const recommendations = [];

    // Analyze each stock (limit for performance)
    const stocksToAnalyze = stocks.slice(0, 100);

    for (const stock of stocksToAnalyze) {
      if (!stock.current_price) continue;

      try {
        // Fetch indicators for this stock
        const indicatorsRes = await fetch(
          `${VPS_PYTHON_URL}/api/indicators/${stock.symbol}`
        ).catch(() => null);

        const indicatorsData = indicatorsRes ? await indicatorsRes.json() : null;
        const indicators = indicatorsData?.data?.indicators || {};

        // Calculate score
        const analysis = analyzeStock(stock, indicators);

        // Filter by signal if specified
        if (signal && signal !== 'ALL') {
          if (signal === 'BUY' && analysis.score < 2) continue;
          if (signal === 'SELL' && analysis.score > -2) continue;
        }

        recommendations.push({
          symbol: stock.symbol,
          name: stock.name || '',
          current_price: stock.current_price,
          change_percent: stock.change_percent,
          signal: analysis.signal,
          score: analysis.score,
          confidence: analysis.confidence,
          reasons: analysis.reasons,
          target_price: analysis.target,
          stop_loss: analysis.stopLoss
        });

      } catch (error) {
        console.error(`Error analyzing ${stock.symbol}:`, error);
      }
    }

    // Sort by score
    recommendations.sort((a, b) => b.score - a.score);

    // Return top results
    return NextResponse.json({
      success: true,
      count: recommendations.length,
      recommendations: recommendations.slice(0, limit),
      timestamp: new Date().toISOString(),
      filter: signal || 'ALL'
    });

  } catch (error) {
    console.error('Recommendations error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to generate recommendations'
    }, { status: 500 });
  }
}

function analyzeStock(
  stock: Record<string, unknown>,
  indicators: Record<string, unknown>
): { signal: string; score: number; confidence: number; reasons: string[]; target: number | null; stopLoss: number | null } {
  const reasons: string[] = [];
  let score = 0;
  
  const currentPrice = stock.current_price as number;

  // RSI Analysis
  const rsi = indicators.rsi as Record<string, unknown> | null;
  if (rsi?.value) {
    const rsiValue = rsi.value as number;
    if (rsiValue <= 30) {
      score += 2;
      reasons.push(`RSI تشبع بيعي (${rsiValue.toFixed(1)})`);
    } else if (rsiValue <= 40) {
      score += 1;
      reasons.push(`RSI قريب من التشبع (${rsiValue.toFixed(1)})`);
    } else if (rsiValue >= 70) {
      score -= 2;
      reasons.push(`RSI تشبع شرائي (${rsiValue.toFixed(1)})`);
    } else if (rsiValue >= 60) {
      score -= 1;
      reasons.push(`RSI مرتفع (${rsiValue.toFixed(1)})`);
    }
  }

  // MACD Analysis
  const macd = indicators.macd as Record<string, unknown> | null;
  if (macd?.trend) {
    if (macd.trend === 'bullish') {
      score += 1;
      reasons.push('MACD صاعد');
    } else if (macd.trend === 'bearish') {
      score -= 1;
      reasons.push('MACD هابط');
    }
  }

  // Moving Averages
  const sma = indicators.sma as Record<string, number> | null;
  if (sma?.[20] && sma?.[50]) {
    if (currentPrice > sma[20] && sma[20] > sma[50]) {
      score += 2;
      reasons.push('فوق المتوسطات');
    } else if (currentPrice < sma[20] && sma[20] < sma[50]) {
      score -= 2;
      reasons.push('تحت المتوسطات');
    }
  }

  // Bollinger Bands
  const bb = indicators.bollinger_bands as Record<string, number> | null;
  if (bb && currentPrice) {
    if (currentPrice <= bb.lower) {
      score += 1;
      reasons.push('عند بولينجر سفلي');
    } else if (currentPrice >= bb.upper) {
      score -= 1;
      reasons.push('عند بولينجر علوي');
    }
  }

  // Determine signal
  let signal = 'HOLD';
  if (score >= 5) signal = 'STRONG_BUY';
  else if (score >= 2) signal = 'BUY';
  else if (score <= -5) signal = 'STRONG_SELL';
  else if (score <= -2) signal = 'SELL';

  // Calculate confidence
  const confidence = Math.min(50 + Math.abs(score) * 5, 95);

  // Calculate targets
  let target: number | null = null;
  let stopLoss: number | null = null;

  if (bb) {
    target = bb.upper;
    stopLoss = bb.lower;
  } else {
    target = currentPrice * 1.05;
    stopLoss = currentPrice * 0.97;
  }

  return { signal, score, confidence, reasons, target, stopLoss };
}
