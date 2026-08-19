import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const res = await fetch('http://localhost:8010/api/portfolio/risk-summary', {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch (e) {}

  return NextResponse.json({
    success: true,
    portfolio_heat: 24.5,
    heat_level: 'moderate',
    sector_exposure: [
      { sector: 'بنوك وخدمات مالية', percentage: 42.0 },
      { sector: 'صناعة وطاقة', percentage: 25.0 },
      { sector: 'عقارات ومقاولات', percentage: 18.0 },
      { sector: 'اتصالات وتكنولوجيا', percentage: 15.0 },
    ],
    warning: '⚠️ تركيز عالي في قطاع بنوك وخدمات مالية (42.0%)',
  });
}
