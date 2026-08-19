import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const trades = await db.tradingJournal.findMany();
    
    // إحصائيات أساسية
    const closedTrades = trades.filter(t => t.result === 'WIN' || t.result === 'LOSS');
    const wins = trades.filter(t => t.result === 'WIN');
    const losses = trades.filter(t => t.result === 'LOSS');
    const openTrades = trades.filter(t => t.result === 'OPEN');
    
    const totalTrades = trades.length;
    const winCount = wins.length;
    const lossCount = losses.length;
    const winRate = closedTrades.length > 0 
      ? (winCount / closedTrades.length) * 100 
      : 0;
    
    // إجمالي الربح
    const totalProfit = trades
      .filter(t => t.profit_loss_pct !== null)
      .reduce((sum, t) => sum + (t.profit_loss_pct || 0), 0);
    
    // متوسط الربح والخسارة
    const avgWin = wins.length > 0
      ? wins.reduce((sum, t) => sum + (t.profit_loss_pct || 0), 0) / wins.length
      : 0;
    
    const avgLoss = losses.length > 0
      ? losses.reduce((sum, t) => sum + (t.profit_loss_pct || 0), 0) / losses.length
      : 0;
    
    // أفضل وأسوأ صفقة
    const sortedByPct = [...trades]
      .filter(t => t.profit_loss_pct !== null)
      .sort((a, b) => (b.profit_loss_pct || 0) - (a.profit_loss_pct || 0));
    
    const bestTrade = sortedByPct[0] 
      ? { symbol: sortedByPct[0].stock_symbol, pct: sortedByPct[0].profit_loss_pct! }
      : null;
    
    const worstTrade = sortedByPct[sortedByPct.length - 1]
      ? { symbol: sortedByPct[sortedByPct.length - 1].stock_symbol, pct: sortedByPct[sortedByPct.length - 1].profit_loss_pct! }
      : null;
    
    // أفضل وأسوأ الأسهم
    const stockStats = new Map<string, { trades: number; profit: number }>();
    
    trades.forEach(t => {
      if (t.profit_loss_pct !== null) {
        const current = stockStats.get(t.stock_symbol) || { trades: 0, profit: 0 };
        current.trades++;
        current.profit += t.profit_loss_pct;
        stockStats.set(t.stock_symbol, current);
      }
    });
    
    const stockArray = Array.from(stockStats.entries())
      .map(([symbol, data]) => ({ symbol, ...data }))
      .sort((a, b) => b.profit - a.profit);
    
    const bestStocks = stockArray.filter(s => s.profit > 0).slice(0, 5);
    const worstStocks = stockArray.filter(s => s.profit < 0).slice(-5).reverse();
    
    return NextResponse.json({
      totalTrades,
      wins: winCount,
      losses: lossCount,
      openTrades: openTrades.length,
      winRate,
      totalProfit,
      avgWin,
      avgLoss,
      bestTrade,
      worstTrade,
      bestStocks,
      worstStocks
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
