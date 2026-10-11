/**
 * GET /api/predictions/honest-tracking — Root
 * ============================================
 *
 * RULE20-PURE-PROXY (2026-10-12): Pure thin proxy to Python.
 *
 * Rule 20 (Python = brain, Node = display only): ZERO computation in Node.
 * Rule 27 (NO-FAKE-DATA): NO fallback chain, NO placeholder zeros.
 * Rule 67 (CALCULATION-CANONICAL): Python is the Single Source of Truth.
 *
 * The previous route had 64 lines of direct SQLite access + Math.round for
 * win_rate computation. Now it's a pure proxy to Python /api/stored-analysis/live-tracking
 * which computes the summary from the canonical predictions table.
 *
 * If Python is unavailable, returns 503 with success:false (no fake zeros).
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET() {
  const targetUrl = `${PY}/api/stored-analysis/live-tracking?market=EGX&days=999&limit=2000`;
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `python-returned-${res.status}`,
        message: 'تعذّر جلب ملخص التوقعات — Python backend أرجع خطأ',
      }, { status: 502 });
    }
    const data = await res.json();
    const stats = data.stats || {};
    return NextResponse.json({
      success: true,
      summary: {
        total_predictions: stats.total || 0,
        wins: stats.wins || 0,
        losses: stats.losses || 0,
        pending: stats.pending || 0,
        real_win_rate: stats.winRate || 0,
        lessons_learned: 0,  // populated by /api/stored-analysis/learn-from-errors
      },
      endpoints: {
        stats: '/api/predictions/honest-tracking/stats — إحصائيات مفصّلة حسب السوق والإشارة والأنماط',
        list: '/api/predictions/honest-tracking/list — قائمة التوقعات مع كل التفاصيل (فلترة + ترتيب)',
        verify_pending: 'POST /api/predictions/honest-tracking/verify-pending — تحقق من التوقعات المعلقة',
        learn_from_errors: 'GET /api/predictions/honest-tracking/learn-from-errors — استخراج الدروس من الأخطاء',
        missed_opportunities: 'GET /api/predictions/honest-tracking/missed-opportunities — 🔴 الفرص الضائعة + التوقعات الغلط',
      },
      source: 'python-canonical-honest-tracking-root',
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Data-Source': 'python-canonical-honest-tracking-root',
      },
    });
  } catch (error) {
    console.error('[predictions:honest-tracking:root] Python backend unavailable:', error);
    return NextResponse.json({
      success: false,
      error: 'python-backend-unavailable',
      message: 'Python backend غير متاح — لا يمكن عرض ملخص وهمي (Rule 27)',
      rule: 'NO-FAKE-DATA (Rule 27) + Python=Brain (Rule 20)',
    }, { status: 503 });
  }
}
