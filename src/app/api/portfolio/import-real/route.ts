import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { nanoid } from 'nanoid';

/**
 * Import Real Portfolio Data
 * استيراد بيانات المحفظة الحقيقية
 */

// Real portfolio data from user
const REAL_PORTFOLIO = [
  {
    ticker: 'EFID',
    name_ar: 'إيديتا',
    shares: 1357,
    avg_cost: 29.54,
    invested: 40857.78,
    current_value: 38781.32,
    profit_loss: -2076.46
  },
  {
    ticker: 'DSCW',
    name_ar: 'دايس',
    shares: 29938,
    avg_cost: 1.94,
    invested: 58793.76,
    current_value: 52391.50,
    profit_loss: -6402.26
  },
  {
    ticker: 'DAPH',
    name_ar: 'التعمير والاستشارات الهندسية',
    shares: 150,
    avg_cost: 80.47,
    invested: 13705.00,
    current_value: 13177.00,
    profit_loss: -528.00
  },
  {
    ticker: 'CIEB',
    name_ar: 'كريدي أجريكول',
    shares: 900,
    avg_cost: 24.41,
    invested: 21698.00,
    current_value: 21050.00,
    profit_loss: -648.00
  },
  {
    ticker: 'ATOA',
    name_ar: 'عتاقة',
    shares: 1000,
    avg_cost: 9.44,
    invested: 9440.00,
    current_value: 9420.00,
    profit_loss: -20.00
  }
];

// Default user ID for real portfolio
const REAL_USER_ID = 'real-portfolio-user';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body;
    
    // Simple auth check
    if (password !== 'glminvestment2024') {
      return NextResponse.json({ 
        success: false, 
        error: 'كلمة المرور غير صحيحة' 
      }, { status: 401 });
    }
    
    let addedCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];
    
    for (const position of REAL_PORTFOLIO) {
      try {
        // Check if position already exists
        const existing = await db.portfolioPosition.findUnique({
          where: {
            user_id_stock_symbol: {
              user_id: REAL_USER_ID,
              stock_symbol: position.ticker
            }
          }
        });
        
        const currentPrice = position.current_value / position.shares;
        const pnlPercent = (position.profit_loss / position.invested) * 100;
        
        if (existing) {
          // Update existing position
          await db.portfolioPosition.update({
            where: { id: existing.id },
            data: {
              shares: position.shares,
              avg_cost: position.avg_cost,
              total_invested: position.invested,
              current_price: currentPrice,
              market_value: position.current_value,
              cost_basis: position.invested,
              unrealized_pnl: position.profit_loss,
              unrealized_pnl_percent: pnlPercent,
              updated_at: new Date()
            }
          });
          updatedCount++;
        } else {
          // Create new position
          await db.portfolioPosition.create({
            data: {
              id: nanoid(),
              user_id: REAL_USER_ID,
              stock_symbol: position.ticker,
              shares: position.shares,
              avg_cost: position.avg_cost,
              entry_date: new Date(),
              total_invested: position.invested,
              current_price: currentPrice,
              market_value: position.current_value,
              cost_basis: position.invested,
              unrealized_pnl: position.profit_loss,
              unrealized_pnl_percent: pnlPercent,
              is_active: true,
              updated_at: new Date()
            }
          });
          addedCount++;
        }
      } catch (err) {
        errors.push(`${position.ticker}: ${err instanceof Error ? err.message : 'خطأ غير معروف'}`);
      }
    }
    
    // Update or create portfolio summary
    const totalInvested = REAL_PORTFOLIO.reduce((sum, p) => sum + p.invested, 0);
    const totalValue = REAL_PORTFOLIO.reduce((sum, p) => sum + p.current_value, 0);
    const totalPnL = REAL_PORTFOLIO.reduce((sum, p) => sum + p.profit_loss, 0);
    const totalPnLPercent = (totalPnL / totalInvested) * 100;
    
    await db.portfolioSummary.upsert({
      where: { user_id: REAL_USER_ID },
      create: {
        id: nanoid(),
        user_id: REAL_USER_ID,
        total_stocks_value: totalValue,
        total_portfolio_value: totalValue,
        total_profit_loss: totalPnL,
        total_profit_loss_percent: totalPnLPercent
      },
      update: {
        total_stocks_value: totalValue,
        total_portfolio_value: totalValue,
        total_profit_loss: totalPnL,
        total_profit_loss_percent: totalPnLPercent,
        last_updated: new Date()
      }
    });
    
    return NextResponse.json({
      success: true,
      message: 'تم استيراد المحفظة بنجاح',
      summary: {
        added: addedCount,
        updated: updatedCount,
        errors: errors.length,
        errorDetails: errors.length > 0 ? errors : undefined
      },
      portfolio: {
        total_invested: totalInvested,
        current_value: totalValue,
        profit_loss: totalPnL,
        profit_loss_percent: totalPnLPercent.toFixed(2)
      }
    });
    
  } catch (error) {
    console.error('Import portfolio error:', error);
    return NextResponse.json({
      success: false,
      error: 'حدث خطأ أثناء الاستيراد',
      details: error instanceof Error ? error.message : 'خطأ غير معروف'
    }, { status: 500 });
  }
}

export async function GET() {
  try {
    // Get current portfolio
    const positions = await db.portfolioPosition.findMany({
      where: { 
        user_id: REAL_USER_ID,
        is_active: true 
      },
      orderBy: { stock_symbol: 'asc' }
    });
    
    const summary = await db.portfolioSummary.findUnique({
      where: { user_id: REAL_USER_ID }
    });
    
    return NextResponse.json({
      success: true,
      user_id: REAL_USER_ID,
      positions,
      summary,
      count: positions.length
    });
    
  } catch (error) {
    console.error('Get portfolio error:', error);
    return NextResponse.json({
      success: false,
      error: 'حدث خطأ أثناء جلب المحفظة'
    }, { status: 500 });
  }
}
