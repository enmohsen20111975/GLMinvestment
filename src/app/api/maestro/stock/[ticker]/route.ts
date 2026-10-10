// MAESTRO-DISABLED (Task PHASE-2-MAESTRO-KILL, Rule 73)
// قبل كده: كان بـ يجيب Maestro analysis لسهم واحد من Python
// (/api/maestro/stock/<ticker>) مع SQLite fallback. Maestro بـ يستخدم
// thresholds مختلفة (55/42/30/20) تتعارض مع canonical signal.
// Owner: "أمسح كل حاجة ليها علاقة بالمايسترو".
// Rule 4 (NO-NEW-FILES / NO-DELETION): file kept — returns 410 Gone.
// Rule 27 (NO-FAKE-DATA): proper HTTP 410, no mock data, no silent pass-through.
// Rule 73 (SINGLE-DISPLAY-SOURCE): canonical = /api/stocks/[ticker]/unified.
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const tickerUpper = (ticker || '').toUpperCase();
  return NextResponse.json(
    {
      success: false,
      deprecated: true,
      error: 'endpoint_deprecated',
      error_ar:
        'تم إيقاف تحليل المايسترو نهائياً. استخدم /api/stocks/[ticker]/unified للحصول على الإشارة الموحدة.',
      deprecated_at: '2026-10-07',
      canonical_route: `/api/stocks/${tickerUpper}/unified`,
      canonical_url: `/api/stocks/${tickerUpper}/unified`,
    },
    { status: 410 }
  );
}
