import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

// (ALPHA-DAL — المرحلة 3.2، التكليف المغلق 2026-10-27):
// «استدعِ DbManager.getIncubatorData(market) مباشرة لتوحيد منطق قراءة وفلترة الحاضنة.»
// المسار ده دلوقتي thin wrapper — كل الـ JSON read + freshness filter + logo enrichment
// بيحصل جوه DbManager (DAL المقفل).
// المحظور: «ممنوع كتابة SELECT أو new Database() داخل أي مسار UI أو component.»

import { getIncubatorData } from '@/lib/db-manager';

export async function GET(req: NextRequest) {
  const market = (req.nextUrl.searchParams.get('market') || 'EGX').toUpperCase();

  try {
    const incubator = getIncubatorData(market);

    // Determine the source label for transparency (matches old contract).
    const source = incubator.total_candidates > 0
      ? (incubator.is_fresh ? 'today_radar' : 'latest_radar')
      : 'no_radar_output';

    const message = incubator.total_candidates === 0
      ? 'الرادار لسه ما اشتغلش للسوق ده — مفيش مخرج JSON متاح.'
      : undefined;

    return NextResponse.json({
      success: true,
      market,
      total_candidates: incubator.total_candidates,
      candidates: incubator.candidates,
      // (ALPHA-SCANNER-ALERTS — owner directive 2026-10-27):
      // تنبيهات السكانر — نشاط غير معتاد (مش توصية شراء).
      scanner_alerts: incubator.scanner_alerts || [],
      under_microscope: incubator.under_microscope || [],
      timestamp: incubator.timestamp,
      source,
      is_fresh: incubator.is_fresh,
      message,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (e) {
    console.error('[/api/radar/incubator] read error:', e);
    return NextResponse.json({
      success: false,
      market,
      total_candidates: 0,
      candidates: [],
      timestamp: new Date().toISOString(),
      source: 'read_error',
      error: 'failed_to_read_radar_json',
      message: 'فشل قراءة مخرج الرادار — حاول تاني بعد ما الرادار يشتغل.',
    }, { status: 200 }); // 200 with empty candidates (graceful — not 500)
  }
}
