import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getStockAnalysis, getStockByTicker, getPriceHistory } from '@/lib/egx-db';
import { calculateProfessionalAnalysis } from '@/lib/analysis-engine';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    await ensureInitialized();
    const { ticker } = await params;

    // Verify stock exists
    const stock = getStockByTicker(ticker);
    if (!stock) {
      return NextResponse.json(
        { error: 'Stock not found', detail: `No stock found with ticker: ${ticker}` },
        { status: 404 }
      );
    }

    // Get the analysis snapshot (already parsed in egx-db)
    const analysis = getStockAnalysis(ticker);

    // Run professional analysis engine alongside existing AI analysis
    let professionalAnalysis = null;
    try {
      const stockId = Number(stock.id);
      const priceHistory = getPriceHistory(stockId, 120);
      if (priceHistory && priceHistory.length >= 5) {
        professionalAnalysis = calculateProfessionalAnalysis(stock, priceHistory);
      }
    } catch (proErr) {
      // Don't let professional analysis failure break the existing response
      console.warn(`[GET /api/stocks/${ticker}/recommendation] Professional analysis failed:`, proErr);
    }

    if (analysis) {
      // The analysis object already has recommendation, scores, trend, etc. extracted
      // Return it directly for the frontend adaptDeepAnalysis to use,
      // with professional analysis attached as an extra field
      return NextResponse.json({
        ...analysis,
        professional_analysis: professionalAnalysis,
      });
    }

    // Return a default analysis object if no snapshot found
    const priceChange = Number(stock.price_change) || 0;
    const defaultAnalysis = {
      ticker: stock.ticker,
      recommendation: {
        action: 'hold',
        action_ar: 'احتفاظ',
        confidence: 0.5,
      },
      scores: {
        total_score: 50,
        technical_score: 50,
        fundamental_score: 50,
        momentum_score: 50,
        risk_score: 50,
        risk_adjusted_score: 50,
        market_context_score: 50,
        consensus_ratio: 50,
      },
      trend: {
        direction: priceChange > 0 ? 'bullish' : priceChange < 0 ? 'bearish' : 'sideways',
        direction_ar: priceChange > 0 ? 'صعودي' : priceChange < 0 ? 'هبوطي' : 'عرضي',
      },
      price_range: {
        support: Number((Number(stock.current_price) * 0.92).toFixed(2)),
        resistance: Number((Number(stock.current_price) * 1.12).toFixed(2)),
      },
      target_price: Number((Number(stock.current_price) * 1.1).toFixed(2)),
      key_strengths: [{ title: 'Default', title_ar: 'تحليل غير متوفر' }],
      key_risks: [{ title: 'No analysis', title_ar: 'لا يوجد تحليل مفصل متاح' }],
      note: 'Default analysis - no deep insight snapshot available',
    };

    // If professional analysis is available, enrich the default response
    if (professionalAnalysis) {
      defaultAnalysis.professional_analysis = professionalAnalysis;
    }

    return NextResponse.json(defaultAnalysis);
  } catch (error) {
    console.error(`[GET /api/stocks/${ticker}/recommendation] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch stock recommendation', detail: String(error) },
      { status: 500 }
    );
  }
}
