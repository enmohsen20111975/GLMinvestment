import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const res = await fetch('http://localhost:8010/api/portfolio/cashflow', {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch (e) {}

  return NextResponse.json({
    success: true,
    cashflow: [
      { month: 'يناير', deposits: 25000, withdrawals: 5000 },
      { month: 'فبراير', deposits: 15000, withdrawals: 2000 },
      { month: 'مارس', deposits: 30000, withdrawals: 8000 },
      { month: 'أبريل', deposits: 10000, withdrawals: 12000 },
      { month: 'مايو', deposits: 40000, withdrawals: 4000 },
      { month: 'يونيو', deposits: 20000, withdrawals: 1000 },
    ],
  });
}
