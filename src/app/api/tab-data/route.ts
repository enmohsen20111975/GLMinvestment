import { NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

// (ALPHA-DAL-WAVE1 — المرحلة 2.2، owner directive 2026-10-27):
// «حوّل المسار لـ Thin Wrapper يستدعي getMarketTabData(market, tab) فقط».
// المسار ده دلوقتي thin wrapper — كل الـ DB access بيحصل جوه DbManager.getMarketTabData.
// المحظور: «ممنوع كتابة SELECT أو new Database() داخل أي مسار UI أو component.»

import { getMarketTabData } from '@/lib/db-manager';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'performance';
    const market = searchParams.get('market') || undefined;
    const ticker = searchParams.get('ticker') || undefined;
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 1000);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const result = getMarketTabData(tab, market, ticker, limit, offset);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[tab-data]', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
