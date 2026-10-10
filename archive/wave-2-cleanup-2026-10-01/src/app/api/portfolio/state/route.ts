import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const res = await fetch('http://localhost:8010/api/portfolio/state', {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch (e) {
    // Fallback if VPS service offline
  }

  return NextResponse.json({
    success: true,
    allocation: [
      { name: 'الأسهم', type: 'stocks', value: 115000, percentage: 65.0, color: '#10b981' },
      { name: 'الكاش', type: 'cash', value: 35000, percentage: 20.0, color: '#3b82f6' },
      { name: 'الذهب', type: 'gold', value: 15000, percentage: 9.0, color: '#f59e0b' },
      { name: 'الكريبتو', type: 'crypto', value: 10000, percentage: 6.0, color: '#8b5cf6' },
    ],
    total_net_worth: 175000,
  });
}
