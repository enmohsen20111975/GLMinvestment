import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';

// GET - جلب كل الصفقات
export async function GET() {
  try {
    const trades = await db.tradingJournal.findMany({
      orderBy: { entry_date: 'desc' }
    });
    
    return NextResponse.json({ trades });
  } catch (error) {
    console.error('Error fetching trades:', error);
    return NextResponse.json({ error: 'Failed to fetch trades' }, { status: 500 });
  }
}

// POST - إضافة صفقة جديدة
export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    
    // حساب الربح/الخسارة إذا كان سعر الخروج موجود
    let profit_loss = null;
    let profit_loss_pct = null;
    let result = 'OPEN';
    
    if (data.exit_price && data.exit_price > 0) {
      const entryValue = data.quantity * data.entry_price;
      const exitValue = data.quantity * data.exit_price;
      profit_loss = exitValue - entryValue;
      profit_loss_pct = ((data.exit_price - data.entry_price) / data.entry_price) * 100;
      result = profit_loss_pct >= 0 ? 'WIN' : 'LOSS';
    }
    
    const trade = await db.tradingJournal.create({
      data: {
        stock_symbol: data.stock_symbol,
        stock_name: data.stock_name || null,
        trade_type: data.trade_type || 'BUY',
        quantity: data.quantity,
        entry_price: data.entry_price,
        exit_price: data.exit_price || null,
        entry_date: data.entry_date || new Date().toISOString().split('T')[0],
        exit_date: data.exit_date || null,
        profit_loss,
        profit_loss_pct,
        notes: data.notes || null,
        strategy: data.strategy || null,
        result
      }
    });
    
    return NextResponse.json({ trade });
  } catch (error) {
    console.error('Error creating trade:', error);
    return NextResponse.json({ error: 'Failed to create trade' }, { status: 500 });
  }
}
