/**
 * GET /api/devil/calendar
 * ========================
 * 😈 تقويم الشيطان — الأحداث الجاية اللي هتحرك السوق
 *
 * بيرجع:
 * - events (كل الأحداث)
 * - upcomingWeek (خلال أسبوع)
 * - upcomingMonth (خلال شهر)
 * - proposedPlays (اللعب المقترح)
 */

import { NextResponse } from 'next/server';
import { getDevilsCalendar } from '@/lib/devil/event-calendar';

export async function GET() {
  try {
    const calendar = getDevilsCalendar();
    return NextResponse.json({
      success: true,
      ...calendar,
    });
  } catch (error) {
    console.error('[devil/calendar] Error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في جلب تقويم الأحداث' },
      { status: 500 }
    );
  }
}
