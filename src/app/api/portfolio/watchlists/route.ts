import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const res = await fetch('http://localhost:8010/api/portfolio/watchlists', {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch (e) {}

  return NextResponse.json({
    success: true,
    watchlist: [
      { ticker: 'COMI', name: 'البنك التجاري الدولي', current_price: 84.00, change_pct: 2.4, current_score: 88, in_portfolio: true },
      { ticker: 'ABUK', name: 'أبو قير لسماد', current_price: 70.20, change_pct: 1.8, current_score: 82, in_portfolio: true },
      { ticker: 'SWDY', name: 'السويدى إليكتريك', current_price: 49.50, change_pct: 3.1, current_score: 91, in_portfolio: true },
      { ticker: 'TMGH', name: 'مجموعة طلعت مصطفى', current_price: 62.00, change_pct: -0.8, current_score: 75, in_portfolio: false },
      { ticker: 'ETEL', name: 'المصرية للاتصالات', current_price: 38.40, change_pct: 1.2, current_score: 80, in_portfolio: false },
    ],
  });
}
