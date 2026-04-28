import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getSessionUserId } from '@/lib/auth-helpers';

const prisma = new PrismaClient();

// GET - Analyze user's portfolio
export async function GET(request: NextRequest) {
  try {
    const userId = await getSessionUserId();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch user's portfolio with stock details
    const portfolio = await prisma.portfolio.findMany({
      where: { userId },
      include: {
        stock: true,
      },
    });

    if (portfolio.length === 0) {
      return NextResponse.json({
        totalValue: 0,
        totalInvested: 0,
        totalProfitLoss: 0,
        profitLossPercentage: 0,
        holdings: [],
        analysis: {
          recommendation: 'Add stocks to your portfolio to see analysis',
          riskLevel: 'N/A',
          diversification: 'N/A',
        },
      });
    }

    // Calculate portfolio metrics
    let totalInvested = 0;
    let totalCurrentValue = 0;
    const holdings = [];

    for (const entry of portfolio) {
      const invested = entry.quantity * (entry.buyPrice || 0);
      // Get current price from stock data (you might need to fetch live prices)
      const currentPrice = entry.stock?.currentPrice || entry.buyPrice || 0;
      const currentValue = entry.quantity * currentPrice;
      
      totalInvested += invested;
      totalCurrentValue += currentValue;

      holdings.push({
        symbol: entry.stockSymbol,
        quantity: entry.quantity,
        buyPrice: entry.buyPrice,
        currentPrice,
        invested,
        currentValue,
        profitLoss: currentValue - invested,
        profitLossPercentage: invested > 0 ? ((currentValue - invested) / invested) * 100 : 0,
      });
    }

    const totalProfitLoss = totalCurrentValue - totalInvested;
    const profitLossPercentage = totalInvested > 0 
      ? (totalProfitLoss / totalInvested) * 100 
      : 0;

    // Simple analysis
    const analysis = {
      recommendation: totalProfitLoss >= 0 
        ? 'Your portfolio is in profit. Consider holding or taking partial profits.'
        : 'Your portfolio is in loss. Review underperforming stocks.',
      riskLevel: portfolio.length > 5 ? 'Moderate' : 'High',
      diversification: portfolio.length > 3 ? 'Good' : 'Consider diversifying',
    };

    return NextResponse.json({
      totalValue: totalCurrentValue,
      totalInvested,
      totalProfitLoss,
      profitLossPercentage,
      holdings,
      analysis,
    });
  } catch (error) {
    console.error('Portfolio analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze portfolio' },
      { status: 500 }
    );
  }
}