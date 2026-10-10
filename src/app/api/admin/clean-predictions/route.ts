import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { predictionsDb } from '@/lib/db-predictions';
import { requireAdminAsync } from '@/lib/admin-auth-server';

/**
 * تنظيف توقعات الذكاء الاصطناعي
 *
 * GET  /api/admin/clean-predictions - تحليل التوقعات
 * POST /api/admin/clean-predictions - تنظيف التوقعات
 *
 * يقوم بـ:
 * 1. حذف توقعات الإجازات (الجمعة والسبت)
 * 2. حذف التكرارات (نفس السهم في نفس اليوم)
 * 3. تقليل التوقعات لـ 5 كحد أقصى لكل يوم (الأعلى ثقة)
 * 4. حذف كل التوقعات (clearAll: true)
 */

const MAX_PREDICTIONS_PER_DAY = 5;

function isWeekend(dateStr: string): boolean {
  try {
    if (!dateStr) return false;
    const d = new Date(dateStr.slice(0, 10));
    const day = d.getDay();
    // في مصر: الجمعة والسبت هما الإجازة
    return day === 5 || day === 6;
  } catch { // silent fallback (safe-by-design)
    return false;
  }
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const total = await predictionsDb.prediction.count();

    if (total === 0) {
      return NextResponse.json({
        success: true,
        total: 0,
        message: 'لا توجد توقعات'
      });
    }

    // Get predictions grouped by date
    const predictions = await predictionsDb.prediction.findMany({
      select: {
        prediction_date: true,
        ticker: true
      }
    });

    // Count by date
    const dateCounts: Record<string, number> = {};
    for (const p of predictions) {
      const date = p.prediction_date?.split('T')[0] || '';
      dateCounts[date] = (dateCounts[date] || 0) + 1;
    }

    const dailyDistribution = Object.entries(dateCounts)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 10)
      .map(([date, count]) => ({ prediction_date: date, count }));

    // Count weekend predictions
    let weekendCount = 0;
    const weekendDates: { date: string; count: number }[] = [];
    for (const [date, count] of Object.entries(dateCounts)) {
      if (isWeekend(date)) {
        weekendCount += count;
        weekendDates.push({ date, count });
      }
    }

    const daysCount = Object.keys(dateCounts).length;
    const weekdayCount = daysCount - weekendDates.length;

    return NextResponse.json({
      success: true,
      total,
      days_count: daysCount,
      weekday_count: weekdayCount,
      daily_distribution: dailyDistribution,
      weekend_predictions: {
        count: weekendCount,
        dates: weekendDates
      },
      estimated_result: {
        max_predictions_per_day: MAX_PREDICTIONS_PER_DAY,
        estimated_final_count: weekdayCount * MAX_PREDICTIONS_PER_DAY,
        estimated_deleted: total - weekdayCount * MAX_PREDICTIONS_PER_DAY
      }
    });
  } catch (error) {
    console.error('[Clean Predictions] Error:', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const body = await request.json().catch(() => ({}));

    // Handle clearAll option for predictions table
    if (body.clearAll) {
      const before = await predictionsDb.prediction.count();
      await predictionsDb.prediction.deleteMany({});
      return NextResponse.json({
        success: true,
        before,
        after: 0,
        deleted: before,
        message: `تم حذف ${before} توقع`
      });
    }

    const maxPerDay = body.max_per_day || MAX_PREDICTIONS_PER_DAY;

    // Get current predictions
    const before = await predictionsDb.prediction.count();

    if (before === 0) {
      return NextResponse.json({
        success: true,
        before: 0,
        after: 0,
        deleted: 0,
        message: 'لا توجد توقعات'
      });
    }

    // Handle dry run
    if (body.dry_run !== false) {
      const predictions = await predictionsDb.prediction.findMany({
        select: { prediction_date: true }
      });

      const dateCounts: Record<string, number> = {};
      for (const p of predictions) {
        const date = p.prediction_date?.split('T')[0] || '';
        dateCounts[date] = (dateCounts[date] || 0) + 1;
      }

      let weekendCount = 0;
      let weekdayCount = 0;
      for (const [date, count] of Object.entries(dateCounts)) {
        if (isWeekend(date)) {
          weekendCount += count;
        } else {
          weekdayCount++;
        }
      }

      return NextResponse.json({
        success: true,
        dry_run: true,
        before,
        estimated_after: weekdayCount * maxPerDay,
        estimated_deleted: before - weekdayCount * maxPerDay,
        steps: [
          { step: 1, action: 'حذف توقعات الإجازات', count: weekendCount },
          { step: 2, action: `تقليل لـ ${maxPerDay} توقعات لكل يوم` }
        ],
        message: 'وضع العرض - استخدم dry_run: false للتنفيذ'
      });
    }

    // Execute cleanup
    let totalDeleted = 0;
    const steps: any[] = [];

    // 1. Delete weekend predictions
    const allPredictions = await predictionsDb.prediction.findMany({
      select: { id: true, prediction_date: true }
    });

    const weekendIds = allPredictions
      .filter(p => p.prediction_date && isWeekend(p.prediction_date))
      .map(p => p.id);

    if (weekendIds.length > 0) {
      await predictionsDb.prediction.deleteMany({
        where: { id: { in: weekendIds } }
      });
      totalDeleted += weekendIds.length;
      steps.push({ step: 1, action: 'حذف توقعات الإجازات', deleted: weekendIds.length });
    }

    // 2. Limit predictions per day
    const remainingPredictions = await predictionsDb.prediction.findMany({
      select: { id: true, prediction_date: true, confidence: true },
      orderBy: { confidence: 'desc' }
    });

    const dateGroups: Record<string, number[]> = {};
    for (const p of remainingPredictions) {
      const date = p.prediction_date?.split('T')[0] || '';
      if (!dateGroups[date]) dateGroups[date] = [];
      dateGroups[date].push(p.id);
    }

    let deletedOverLimit = 0;
    for (const [date, ids] of Object.entries(dateGroups)) {
      if (ids.length > maxPerDay) {
        const toDelete = ids.slice(maxPerDay);
        await predictionsDb.prediction.deleteMany({
          where: { id: { in: toDelete } }
        });
        deletedOverLimit += toDelete.length;
      }
    }
    totalDeleted += deletedOverLimit;
    steps.push({ step: 2, action: `تقليل لـ ${maxPerDay} توقعات لكل يوم`, deleted: deletedOverLimit });

    const after = await predictionsDb.prediction.count();

    return NextResponse.json({
      success: true,
      before,
      after,
      deleted: totalDeleted,
      steps,
      message: `تم حذف ${totalDeleted.toLocaleString()} توقع من أصل ${before.toLocaleString()} - بقى ${after.toLocaleString()} توقع`
    });
  } catch (error) {
    console.error('[Clean Predictions] Error:', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
