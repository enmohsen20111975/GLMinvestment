import { NextResponse } from 'next/server';
import { checkAndAutoSeed } from '@/lib/seed-historical-data';

export const maxDuration = 120;

/**
 * GET /api/market/auto-seed
 *
 * فحص تلقائي وبذر البيانات التاريخية عند الحاجة.
 * نقطة نهاية عامة — لا تتطلب مصادقة.
 * يتم استدعاؤها تلقائياً من الواجهة الأمامية أو من نقاط النهاية الأخرى.
 *
 * Returns:
 *   - needs_seeding: هل البيانات تحتاج بذر؟
 *   - seeded: هل تم البذر فعلاً؟
 *   - rows: عدد الصفوف المُدرجة
 */
export async function GET() {
  try {
    console.log('[GET /api/market/auto-seed] Checking if seeding is needed...');

    const result = await checkAndAutoSeed();

    return NextResponse.json({
      success: true,
      needs_seeding: result.seeded,
      seeded: result.seeded,
      rows: result.rows,
      message: result.message,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[GET /api/market/auto-seed] Error:', error);
    return NextResponse.json(
      {
        success: false,
        needs_seeding: false,
        seeded: false,
        rows: 0,
        error: 'Auto-seed check failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
