import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const res = await fetch('http://localhost:8010/api/portfolio/holdings', {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch (e) {}

  return NextResponse.json({
    success: true,
    holdings: [
      {
        ticker: 'COMI',
        name: 'البنك التجاري الدولي',
        sub_portfolio: 'محفظة الاستثمار',
        buy_price: 72.50,
        current_price: 84.00,
        quantity: 500,
        pnl_amount: 5750.0,
        pnl_percent: 15.86,
        current_score: 88,
        holding_days: 42,
        in_watchlist: true,
        is_holding: true,
      },
      {
        ticker: 'ABUK',
        name: 'أبو قير لسماد',
        sub_portfolio: 'محفظة المضاربة',
        buy_price: 64.00,
        current_price: 70.20,
        quantity: 300,
        pnl_amount: 1860.0,
        pnl_percent: 9.68,
        current_score: 82,
        holding_days: 14,
        in_watchlist: true,
        is_holding: true,
      },
      {
        ticker: 'EAST',
        name: 'الشرقية للدخان',
        sub_portfolio: 'محفظة الاستثمار',
        buy_price: 31.00,
        current_price: 28.50,
        quantity: 600,
        pnl_amount: -1500.0,
        pnl_percent: -8.06,
        current_score: 58,
        holding_days: 28,
        in_watchlist: false,
        is_holding: true,
      },
      {
        ticker: 'SWDY',
        name: 'السويدى إليكتريك',
        sub_portfolio: 'محفظة المضاربة',
        buy_price: 42.00,
        current_price: 49.50,
        quantity: 400,
        pnl_amount: 3000.0,
        pnl_percent: 17.85,
        current_score: 91,
        holding_days: 21,
        in_watchlist: true,
        is_holding: true,
      },
      {
        ticker: 'HRHO',
        name: 'مجموعة إي إف جي القابضة',
        sub_portfolio: 'محفظة الاستثمار',
        buy_price: 19.50,
        current_price: 21.80,
        quantity: 1000,
        pnl_amount: 2300.0,
        pnl_percent: 11.79,
        current_score: 79,
        holding_days: 35,
        in_watchlist: false,
        is_holding: true,
      },
    ],
    total_items: 5,
  });
}
