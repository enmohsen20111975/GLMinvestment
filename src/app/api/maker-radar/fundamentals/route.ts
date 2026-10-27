import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// (ALPHA-DAL-WAVE1 — المرحلة 2.1، owner directive 2026-10-27):
// «حوّل src/app/api/maker-radar/fundamentals/route.ts ليكون Thin Wrapper بالكامل».
// المسار ده دلوقتي thin wrapper — كل الـ DB access بيحصل جوه DbManager.getCompanyFundamentals.
// المحظور: «ممنوع كتابة SELECT أو new Database() داخل أي مسار UI أو component.»

import { getCompanyFundamentals } from '@/lib/db-manager';

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get('ticker') || '';
  if (!ticker) {
    return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });
  }

  const data = getCompanyFundamentals(ticker);
  if (!data) {
    return NextResponse.json({ success: false, error: 'not_found', ticker }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    ticker: data.ticker,
    name_ar: data.name_ar,
    logo_url: data.logo_url,
    fundamentals: data.fundamentals,
  });
}
