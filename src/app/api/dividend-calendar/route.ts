import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/dividend-calendar - Get dividend calendar entries
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const ticker = searchParams.get('ticker');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const status = searchParams.get('status');

    // Get dividends from database
    const dividends = await db.$queryRaw`
      SELECT * FROM DividendCalendar
      WHERE 1=1
      ${ticker ? `AND ticker = ${ticker}` : ''}
      ${status ? `AND status = ${status}` : ''}
      ${startDate ? `AND ex_dividend_date >= ${startDate}` : ''}
      ${endDate ? `AND ex_dividend_date <= ${endDate}` : ''}
      ORDER BY ex_dividend_date DESC
      LIMIT 100
    `;

    return NextResponse.json({
      success: true,
      count: Array.isArray(dividends) ? dividends.length : 0,
      data: dividends
    });

  } catch (error) {
    console.error('Error fetching dividend calendar:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch dividend calendar',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// POST /api/dividend-calendar - Add dividend calendar entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const {
      ticker,
      ex_dividend_date,
      dividend_amount,
      announcement_date,
      payment_date,
      dividend_type = 'CASH',
      source = 'manual',
      notes
    } = body;

    if (!ticker || !ex_dividend_date || !dividend_amount) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: ticker, ex_dividend_date, dividend_amount'
      }, { status: 400 });
    }

    // Insert into database
    await db.$executeRaw`
      INSERT INTO DividendCalendar (
        id, ticker, ex_dividend_date, dividend_amount,
        announcement_date, payment_date, dividend_type,
        status, source, notes
      ) VALUES (
        ${`${ticker}_${ex_dividend_date}`},
        ${ticker},
        ${ex_dividend_date},
        ${dividend_amount},
        ${announcement_date || null},
        ${payment_date || null},
        ${dividend_type},
        'ANNOUNCED',
        ${source},
        ${notes || null}
      )
      ON CONFLICT(ticker, ex_dividend_date) DO UPDATE SET
        dividend_amount = ${dividend_amount},
        announcement_date = ${announcement_date || null},
        payment_date = ${payment_date || null},
        updated_at = datetime('now')
    `;

    return NextResponse.json({
      success: true,
      message: 'Dividend entry added/updated successfully',
      ticker,
      ex_dividend_date
    });

  } catch (error) {
    console.error('Error adding dividend entry:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to add dividend entry',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
