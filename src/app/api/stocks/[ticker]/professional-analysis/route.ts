import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getStockByTicker, getPriceHistory, getStockAnalysis } from '@/lib/egx-db';
import { calculateEnhancedCompositeAnalysis } from '@/lib/analysis-engine';

export const maxDuration = 30;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    await ensureInitialized();
    const { ticker } = await params;

    // 1. Verify stock exists
    const stock = getStockByTicker(ticker);
    if (!stock) {
      return NextResponse.json(
        { error: 'Stock not found', detail: `No stock found with ticker: ${ticker}` },
        { status: 404 }
      );
    }

    // 2. Fetch price history (last 250 days for full analysis)
    const stockId = Number(stock.id);
    const priceHistory = getPriceHistory(stockId, 250);

    // 3. Fetch existing AI analysis snapshot (if available)
    const aiInsight = getStockAnalysis(ticker);

    // 4. Build basic stock info response
    const tickerStr = (stock.ticker as string).toUpperCase();
    const stockInfo = {
      ticker: stock.ticker,
      name: stock.name,
      name_ar: stock.name_ar,
      sector: stock.sector,
      current_price: stock.current_price,
      previous_close: stock.previous_close,
      price_change: stock.price_change,
      volume: stock.volume,
      market_cap: stock.market_cap,
      investment_type: stock.investment_type,
      is_halal: stock.is_halal,
      egx30_member: stock.egx30_member,
      egx70_member: stock.egx70_member,
      egx100_member: stock.egx100_member,
    };

    // 5. If we have enough price history, run the full analysis
    if (!priceHistory || priceHistory.length < 5) {
      // Return a partial response with available data instead of 422 error
      // This allows the UI to still show stock info even without full analysis
      let aiInsightData: Record<string, unknown> | null = null;
      if (aiInsight) {
        aiInsightData = {
          recommendation: aiInsight.recommendation,
          scores: aiInsight.scores,
          trend: aiInsight.trend,
          probabilities: aiInsight.probabilities,
          technical_indicators: aiInsight.technical_indicators,
          execution_plan: aiInsight.execution_plan,
          scenarios: aiInsight.scenarios,
          key_strengths: aiInsight.key_strengths,
          key_risks: aiInsight.key_risks,
          decision_basis_ar: aiInsight.decision_basis_ar,
          history_summary: aiInsight.history_summary,
          fetched_at: aiInsight.fetched_at,
        };
      }

      return NextResponse.json({
        success: true,
        ticker: tickerStr,
        stock: stockInfo,
        analysis: null,
        ai_insight: aiInsightData,
        data_available: false,
        data_points: priceHistory?.length || 0,
        minimum_required: 5,
        message: `لا توجد بيانات سعر كافية لتحليل سهم ${tickerStr}. يرجى المتابعة لاحقاً بعد توفر البيانات التاريخية.`,
        generated_at: new Date().toISOString(),
      });
    }

    // 6. Run ENHANCED analysis engine
    const analysis = calculateEnhancedCompositeAnalysis(stock, priceHistory);

    // If AI insight exists, pick the key fields
    let aiInsightData: Record<string, unknown> | null = null;
    if (aiInsight) {
      aiInsightData = {
        recommendation: aiInsight.recommendation,
        scores: aiInsight.scores,
        trend: aiInsight.trend,
        probabilities: aiInsight.probabilities,
        technical_indicators: aiInsight.technical_indicators,
        execution_plan: aiInsight.execution_plan,
        scenarios: aiInsight.scenarios,
        key_strengths: aiInsight.key_strengths,
        key_risks: aiInsight.key_risks,
        decision_basis_ar: aiInsight.decision_basis_ar,
        history_summary: aiInsight.history_summary,
        fetched_at: aiInsight.fetched_at,
      };
    }

    return NextResponse.json({
      success: true,
      ticker: tickerStr,
      stock: stockInfo,
      analysis,
      ai_insight: aiInsightData,
      data_available: true,
      data_points: priceHistory.length,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[GET /api/stocks/${(await params).ticker}/professional-analysis] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to generate professional analysis', detail: String(error) },
      { status: 500 }
    );
  }
}
