// MAESTRO-DISABLED (Task PHASE-2-MAESTRO-KILL, Rule 73)
// قبل كده: كان بـ proxy لـ Python /api/market-pulse (Maestro market overview).
// Owner: "أمسح كل حاجة ليها علاقة بالمايسترو" — Maestro has different
// thresholds (55/42/30/20) and conflicts with canonical signal.
// Rule 4 (NO-NEW-FILES / NO-DELETION): file kept to avoid 404.
// Rule 27 (NO-FAKE-DATA): returns proper HTTP 410 Gone — no mock data.
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      deprecated: true,
      error: 'endpoint_deprecated',
      error_ar:
        'تم إيقاف نظرة عامة المايسترو نهائياً. استخدم /api/stocks للحصول على قائمة الأسهم الموحدة.',
      deprecated_at: '2026-10-07',
      canonical_route: '/api/stocks',
      canonical_url: '/api/stocks',
    },
    { status: 410 }
  );
}
